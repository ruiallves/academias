#!/usr/bin/env node
/**
 * Uma conta de desenvolvimento com os três chapéus ao mesmo tempo.
 *
 * `tudo@lifeclub.pt` fica a ser, no life-club, **staff** (treinador do Sub-11),
 * **família** (encarregado de dois educandos, um em cada escalão) e **sócio**
 * (ficha activa, com quotas). É o caso que o produto tem de aguentar e que
 * nenhuma conta semeada cobria: o pai que treina e que também paga a quota é a
 * pessoa mais comum de um clube português, e é exactamente onde o selector de
 * contextos da app e o `escolherMembership` do servidor se partem.
 *
 * ## O sócio liga-se pelo caminho normal
 *
 * A ficha **não** é ligada à conta por SQL. O script cria o convite de sócio (o
 * mesmo token que o email levaria) e resgata-o pela API, como a pessoa faria no
 * ecrã: é isso que liga a ficha à conta *e* grava as aceitações dos documentos
 * legais da audiência MEMBER. Escrever a ligação à mão deixava uma conta que
 * aceitou termos que nunca viu — e um gate a bloquear a área de sócio no
 * primeiro arranque.
 *
 * Por isso este script **precisa da API a correr** em :3000. Sem ela faz o que
 * pode (contas, vínculos, ficha) e diz o que ficou por fazer; correr outra vez
 * com a API de pé termina o trabalho.
 *
 * Idempotente: correr duas vezes não duplica nada.
 *
 * Uso: node scripts/criar-conta-tres-chapeus.mjs
 */
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const env = (k) => {
  const l = readFileSync(path.join(HERE, "..", ".env"), "utf8").split("\n").find((x) => x.startsWith(`${k}=`));
  if (!l) throw new Error(`${k} não está em .env`);
  return l.slice(k.length + 1).trim().replace(/^"|"$/g, "");
};

const SUPABASE_URL = env("SUPABASE_URL").replace(/\/$/, "");
const SERVICE_KEY = env("SUPABASE_SERVICE_ROLE_KEY");
const ANON_KEY = env("SUPABASE_ANON_KEY");
const ADMIN_DB = env("MIGRATE_DATABASE_URL");
const API = process.env.API ?? "http://localhost:3000";

const ACADEMY = { id: "acd_lifeclub", slug: "life-club" };
const PASSWORD = "academia2026";

/** A pessoa. O apelido é uma piada interna: três chapéus, uma trindade. */
const PESSOA = {
  email: "tudo@lifeclub.pt",
  name: "Paulo Trindade",
  phone: "916 330 214",
  /** Treinador **com equipa**: sem `TeamStaff` o âmbito é vazio e a consola abre sem atletas. */
  team: { id: "t_sub11", title: "Treinador de guarda-redes" },
  /**
   * Dois educandos, de propósito, e em escalões diferentes.
   *
   * Um filho só nunca exercita o selector de educandos da app — e é aí que o
   * ecrã costuma partir-se. Estes dois não tinham encarregado nenhum na seed,
   * por isso ninguém fica com dois.
   */
  filhos: [
    { id: "ath_dinis", relation: "Pai", payer: true },
    { id: "ath_rodrigo", relation: "Pai", payer: true },
  ],
};

const mes = (n) => {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const rotulo = (periodo) => {
  const [ano, m] = periodo.split("-");
  return `Quota de ${MESES[Number(m) - 1]} ${ano}`;
};

/* -------------------------------------------------------------------------- */

/** A conta no Supabase. Igual à da seed: cria, ou encontra a que já lá está. */
async function contaAuth(email, name) {
  const cabecalho = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" };

  const criar = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: cabecalho,
    body: JSON.stringify({ email, password: PASSWORD, email_confirm: true, user_metadata: { name } }),
  });
  if (criar.ok) return { id: (await criar.json()).id, nova: true };

  const lista = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=200`, { headers: cabecalho });
  const users = (await lista.json()).users ?? [];
  const existente = users.find((u) => (u.email ?? "").toLowerCase() === email.toLowerCase());
  if (!existente) throw new Error(`não foi possível criar nem encontrar ${email}`);

  /* A password é reposta: uma conta de desenvolvimento que ninguém sabe abrir
     não serve para nada, e o segredo aqui é público de propósito. */
  await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${existente.id}`, {
    method: "PUT",
    headers: cabecalho,
    body: JSON.stringify({ password: PASSWORD, email_confirm: true }),
  });
  return { id: existente.id, nova: false };
}

async function entrar(email) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  return r.ok ? (await r.json()).access_token : null;
}

/** Aceita o que estiver pendente para um dos chapéus (o `x-app` escolhe qual). */
async function aceitarTermos(token, app) {
  const h = { Authorization: `Bearer ${token}`, "x-academy-slug": ACADEMY.slug, "x-app": app, "Content-Type": "application/json" };
  const estado = await (await fetch(`${API}/api/legal/status`, { headers: h })).json();
  if (!estado.pending?.length) return "em dia";
  const ok = await fetch(`${API}/api/legal/accept`, {
    method: "POST",
    headers: h,
    body: JSON.stringify({ documentIds: estado.pending.map((p) => p.id), confirmAuthority: estado.canBindClub || undefined }),
  });
  return ok.ok ? `aceites ${estado.pending.length}` : `falhou (${ok.status})`;
}

/* -------------------------------------------------------------------------- */

const db = new pg.Client({ connectionString: ADMIN_DB, ssl: { rejectUnauthorized: false } });
await db.connect();

const porFazer = [];

try {
  console.log(`\n=== ${PESSOA.email} · ${PESSOA.name} ===\n`);

  const auth = await contaAuth(PESSOA.email, PESSOA.name);
  console.log(`Conta Supabase: ${auth.nova ? "criada" : "já existia (password reposta)"}`);

  const u = await db.query(
    `INSERT INTO "User" (id,"authId",email,name,phone,"updatedAt")
     VALUES ($1,$2,$3,$4,$5,now())
     ON CONFLICT ("authId") DO UPDATE SET email = EXCLUDED.email, name = EXCLUDED.name, phone = EXCLUDED.phone
     RETURNING id`,
    ["usr_trio", auth.id, PESSOA.email, PESSOA.name, PESSOA.phone],
  );
  const userId = u.rows[0].id;

  /*
   * Duas memberships na mesma academia — é isso que faz os três chapéus.
   *
   * A chave única é (academia, utilizador, papel), por isso convivem. Quem
   * escolhe qual vale em cada pedido é o `escolherMembership`, pelo cabeçalho
   * `x-app`: a consola prefere a de staff, a app da família exige a de família.
   */
  const staff = await db.query(
    `INSERT INTO "Membership" (id,"academyId","userId",role,title,department,"updatedAt")
     VALUES ($1,$2,$3,'COACH'::"Role",$4,'TECHNICAL'::"StaffDepartment",now())
     ON CONFLICT ("academyId","userId",role) DO UPDATE SET title = EXCLUDED.title, department = EXCLUDED.department
     RETURNING id`,
    ["mem_trio_staff", ACADEMY.id, userId, PESSOA.team.title],
  );
  const familia = await db.query(
    `INSERT INTO "Membership" (id,"academyId","userId",role,title,department,"updatedAt")
     VALUES ($1,$2,$3,'GUARDIAN'::"Role",NULL,NULL,now())
     ON CONFLICT ("academyId","userId",role) DO UPDATE SET title = NULL
     RETURNING id`,
    ["mem_trio_familia", ACADEMY.id, userId],
  );
  console.log("Vínculos:      treinador + encarregado");

  await db.query(
    `INSERT INTO "TeamStaff" (id,"teamId","membershipId",title)
     VALUES ($1,$2,$3,$4) ON CONFLICT ("teamId","membershipId") DO NOTHING`,
    ["ts_trio_11", PESSOA.team.id, staff.rows[0].id, PESSOA.team.title],
  );

  for (const f of PESSOA.filhos) {
    await db.query(
      `INSERT INTO "GuardianLink" (id,"athleteId","membershipId",relation)
       VALUES ($1,$2,$3,$4) ON CONFLICT ("athleteId","membershipId") DO NOTHING`,
      [`gl_trio_${f.id}`, f.id, familia.rows[0].id, f.relation],
    );
  }
  const filhos = await db.query(
    `SELECT a.name, t.name AS equipa FROM "GuardianLink" g
       JOIN "Athlete" a ON a.id = g."athleteId"
       JOIN "TeamMembership" tm ON tm."athleteId" = a.id
       JOIN "Team" t ON t.id = tm."teamId"
      WHERE g."membershipId" = $1`,
    [familia.rows[0].id],
  );
  console.log(`Educandos:     ${filhos.rows.map((r) => `${r.name} (${r.equipa})`).join(", ")}`);

  /* A ficha de sócio. Categoria mensal com preço, para as quotas fazerem sentido. */
  const tier = await db.query(
    `SELECT id, name, "feeCents" FROM "MemberTier"
      WHERE "academyId" = $1 AND "archivedAt" IS NULL AND "feeCents" IS NOT NULL AND billing = 'MONTHLY'
      ORDER BY "feeCents" DESC LIMIT 1`,
    [ACADEMY.id],
  );
  if (tier.rowCount === 0) throw new Error("o life-club não tem categoria de sócio mensal com preço");
  const categoria = tier.rows[0];

  const numero = await db.query(
    `SELECT coalesce(max(number), 0) + 1 AS proximo FROM "Member" WHERE "academyId" = $1`,
    [ACADEMY.id],
  );

  const m = await db.query(
    `INSERT INTO "Member" (id,"academyId",number,"tierId",name,email,"phoneCountry",phone,status,"updatedAt")
     VALUES ($1,$2,$3,$4,$5,$6,'+351',$7,'ACTIVE'::"MemberStatus",now())
     ON CONFLICT (id) DO UPDATE SET
       "tierId" = EXCLUDED."tierId", email = EXCLUDED.email, status = 'ACTIVE'::"MemberStatus", "updatedAt" = now()
     RETURNING id, number, "userId"`,
    ["mbr_trio", ACADEMY.id, numero.rows[0].proximo, categoria.id, PESSOA.name, PESSOA.email, PESSOA.phone],
  );
  const socio = m.rows[0];
  console.log(`Sócio:         nº ${socio.number} · ${categoria.name} · ${(categoria.feeCents / 100).toFixed(2)}€/mês`);

  /*
   * Duas quotas: a do mês passado paga, a deste mês em aberto.
   *
   * Uma ficha sem histórico abre a área de sócio num ecrã vazio, e um ecrã vazio
   * não mostra se o que lá está desenhado funciona.
   */
  for (const [periodo, estado] of [[mes(-1), "SETTLED"], [mes(0), "OPEN"]]) {
    await db.query(
      `INSERT INTO "MemberFee" (id,"academyId","memberId",period,label,"amountCents","dueOn",status,"settledAt",method,"updatedAt")
       VALUES ($1,$2,$3,$4,$5,$6,($4 || '-08')::date,$7::"ChargeStatus",$8,$9::"PaymentMethod",now())
       ON CONFLICT ("memberId",period) DO NOTHING`,
      [
        `mfee_trio_${periodo}`, ACADEMY.id, socio.id, periodo, rotulo(periodo), categoria.feeCents,
        estado, estado === "SETTLED" ? new Date() : null, estado === "SETTLED" ? "TRANSFER" : null,
      ],
    );
  }
  console.log(`Quotas:        ${rotulo(mes(-1))} paga · ${rotulo(mes(0))} em aberto`);

  /* ---------------------------------------------------------------------- */
  /* O que só a API pode fazer: ligar a ficha e aceitar os termos             */
  /* ---------------------------------------------------------------------- */

  const apiViva = await fetch(`${API}/l/${ACADEMY.slug}`).then((r) => r.ok).catch(() => false);
  if (!apiViva) {
    porFazer.push("a API não respondeu em " + API + " — liga-a e corre este script outra vez");
  } else if (socio.userId) {
    console.log("Ligação:       a ficha já estava ligada a esta conta");
  } else {
    /* O convite que o email levaria, criado aqui e resgatado a seguir. O token
       nunca é guardado — só o seu sha256, como em produção. */
    const token = randomBytes(32).toString("base64url");
    await db.query(
      `UPDATE "Member" SET "inviteTokenHash" = $1, "inviteSentAt" = now(), "updatedAt" = now() WHERE id = $2`,
      [createHash("sha256").update(token).digest("hex"), socio.id],
    );

    const r = await fetch(`${API}/api/convite-socio/${encodeURIComponent(token)}/registar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: PASSWORD, acceptLegal: true }),
    });
    const corpo = await r.json().catch(() => null);
    if (r.ok && corpo?.accessToken) {
      console.log("Ligação:       ficha ligada à conta pelo convite (termos de sócio aceites)");
    } else {
      porFazer.push(`o resgate do convite de sócio falhou (${r.status}): ${JSON.stringify(corpo).slice(0, 140)}`);
    }
  }

  if (apiViva) {
    const token = await entrar(PESSOA.email);
    if (!token) {
      porFazer.push("não foi possível entrar com a conta para aceitar os termos");
    } else {
      console.log(`Termos:        família — ${await aceitarTermos(token, "family")}`);
      console.log(`               staff   — ${await aceitarTermos(token, "console")}`);
    }
  }

  console.log(`\nEntra com  ${PESSOA.email}  ·  ${PASSWORD}`);
  console.log(`  app      http://localhost:5174   (Família · Sócio · Staff)`);
  console.log(`  consola  http://localhost:3000/l/${ACADEMY.slug}\n`);

  if (porFazer.length > 0) {
    console.log("Ficou por fazer:");
    for (const p of porFazer) console.log(`  · ${p}`);
    console.log();
  }
} finally {
  await db.end();
}

process.exit(porFazer.length > 0 ? 1 : 0);

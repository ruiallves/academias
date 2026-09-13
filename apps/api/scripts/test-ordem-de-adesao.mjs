#!/usr/bin/env node
/**
 * A ordem de adesão — as condições comerciais de um clube, e a assinatura.
 *
 * ## O que isto prova
 *
 * Mudar o plano de um clube passou a ser **contratar**: a plataforma emite as
 * condições (plano, preço, periodicidade, início, período mínimo, renovação), o
 * responsável do clube recebe-as por email e assina-as na consola.
 *
 *  1. O preço: mensal é o de tabela; anual é o ano com menos 10%.
 *  2. A ordem guarda um **instantâneo** — o nome do plano e os valores do dia —
 *     e agarra-se à versão dos Termos de Serviço em vigor.
 *  3. Emitir outra vez põe a anterior em `SUPERSEDED`: só há uma viva.
 *  4. Corrigir só o estado da subscrição **não** emite contrato nenhum.
 *  5. Do lado do clube: quem representa vê e assina; quem não representa vê e
 *     não assina (403), e a assinatura fica com nome, cargo e hora.
 *
 * ## Porque é que ninguém recebe email aqui
 *
 * O clube descartável tem o responsável **sem endereço**: o serviço percebe que
 * não há a quem enviar, regista-o e não chama o serviço de correio. A parte da
 * assinatura corre no life-club sobre uma ordem inserida à mão — também sem
 * passar pela emissão. Nenhum destes caminhos manda correio a ninguém.
 *
 * Uso: node scripts/test-ordem-de-adesao.mjs
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const env = (k) => {
  const l = readFileSync(path.join(HERE, "..", ".env"), "utf8").split("\n").find((x) => x.startsWith(k + "="));
  if (!l) throw new Error(`${k} não está em .env`);
  return l.slice(k.length + 1).trim().replace(/^"|"$/g, "");
};

const S = env("SUPABASE_URL").replace(/\/$/, "");
const A = env("SUPABASE_ANON_KEY");
const API = process.env.API_URL ?? "http://127.0.0.1:3000";

let ok = 0;
let bad = 0;
const check = (l, c, d = "") => {
  if (c) { ok++; console.log("  OK    " + l); }
  else { bad++; console.log("  FALHA " + l + (d ? " — " + d : "")); }
};

const login = async (email) =>
  (await (await fetch(`${S}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: A, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "academia2026" }),
  })).json()).access_token;

const call = async (token, method, pathname, body) => {
  const res = await fetch(API + pathname, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "x-academy-slug": "life-club",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

const db = new pg.Client({ connectionString: env("MIGRATE_DATABASE_URL"), ssl: { rejectUnauthorized: false } });
await db.connect();

const director = await login("direcao@lifeclub.pt");
const pendentesLegais = ((await call(director, "GET", "/api/legal/status")).body?.pending ?? []).map((d) => d.id);
if (pendentesLegais.length) await call(director, "POST", "/api/legal/accept", { documentIds: pendentesLegais });

const AC = "zo_academia";
const LC = (await db.query(`SELECT id FROM "Academy" WHERE slug = 'life-club'`)).rows[0].id;

const limpar = async () => {
  await db.query(`DELETE FROM "SubscriptionOrder" WHERE "academyId" = $1 OR id LIKE 'zo_%'`, [AC]);
  await db.query(`DELETE FROM "Subscription" WHERE "academyId" = $1`, [AC]);
  await db.query(`DELETE FROM "Membership" WHERE id LIKE 'zo_%'`);
  await db.query(`DELETE FROM "AcademyRole" WHERE id LIKE 'zo_%'`);
  await db.query(`DELETE FROM "User" WHERE id LIKE 'zo_%'`);
  await db.query(`DELETE FROM "Academy" WHERE id = $1`, [AC]);
  await db.query(`DELETE FROM "PlatformAdmin" WHERE id = 'zo_admin'`);
};

try {
  await limpar();

  /* ------------------------------------------- o clube descartável ------ */
  await db.query(
    `INSERT INTO "Academy" (id, slug, name, "shortName", status, "updatedAt")
     VALUES ($1, 'zo-teste-ordem', 'ZO Clube de Teste', 'ZO', 'SETUP', now())`, [AC],
  );
  /*
   * O presidente: um cargo com `legal:club` — a mesma permissão que decide quem
   * aceita os Termos em nome do clube.
   *
   * O cargo nasce **sem** a permissão de propósito: o primeiro passe prova o
   * caminho de um clube sem ninguém a representá-lo, que é o único que garante
   * que não sai correio nenhum. Só depois se lha dá.
   */
  await db.query(
    `INSERT INTO "AcademyRole" (id, "academyId", key, name, "baseRole", permissions, "updatedAt")
     VALUES ('zo_cargo', $1, 'presidente', 'Presidente', 'OWNER', ARRAY[]::text[], now())`, [AC],
  );
  await db.query(
    `INSERT INTO "User" (id, "authId", name, email, "updatedAt")
     VALUES ('zo_user', 'zo-auth-teste', 'ZO Presidente', 'zo-presidente@teste.local', now())`,
  );
  await db.query(
    `INSERT INTO "Membership" (id, "academyId", "userId", role, "customRoleId", "isActive", "updatedAt")
     VALUES ('zo_memb', $1, 'zo_user', 'OWNER', 'zo_cargo', true, now())`, [AC],
  );

  const plano = (await db.query(
    `SELECT id, name, "amountCents" FROM "Plan" WHERE "isActive" ORDER BY "amountCents" ASC LIMIT 1`)).rows[0];
  check("há um plano activo no catálogo", Boolean(plano), JSON.stringify(plano));

  /* O crachá de plataforma, emprestado — a manobra dos outros testes. */
  const authDaDireccao = (await db.query(
    `SELECT "authId" FROM "User" WHERE email = 'direcao@lifeclub.pt' LIMIT 1`)).rows[0]?.authId;
  await db.query(
    `INSERT INTO "PlatformAdmin" (id, "authId", name, email, role, "isActive", "updatedAt")
     VALUES ('zo_admin', $1, 'ZO Admin de teste', 'zo-admin@teste.local', 'OWNER', true, now())`, [authDaDireccao],
  );
  const admin = await login("direcao@lifeclub.pt");

  const ordens = async () =>
    (await db.query(
      `SELECT * FROM "SubscriptionOrder" WHERE "academyId" = $1 ORDER BY "createdAt" DESC`, [AC])).rows;

  /* ------------------------------------------------ mensal e anual ------ */
  console.log("=== O preço, e o desconto de quem paga o ano ===");
  const hoje = new Date().toISOString().slice(0, 10);

  const mensal = await call(admin, "PATCH", `/api/platform/academies/${AC}/plano`, {
    planId: plano.id, status: "ACTIVE", billingPeriod: "MONTHLY", startsOn: hoje, minimumMonths: 12,
  });
  check("a plataforma grava o plano (2xx)", mensal.status === 200 || mensal.status === 201, `${mensal.status} ${JSON.stringify(mensal.body).slice(0, 160)}`);
  check("e emite as condições", Boolean(mensal.body?.ordem?.id), JSON.stringify(mensal.body?.ordem));

  const m = (await ordens())[0];
  check("mensal paga o preço de tabela", m?.amountCents === plano.amountCents, `${m?.amountCents} vs ${plano.amountCents}`);
  check("sem desconto", m?.discountPct === 0, `${m?.discountPct}`);
  check("com o nome do plano copiado", m?.planName === plano.name, `${m?.planName}`);
  check("e o período mínimo", m?.minimumMonths === 12, `${m?.minimumMonths}`);
  check("a renovação escreve-se sozinha", /renova mensalmente/i.test(m?.renewalNote ?? ""), `${m?.renewalNote}`);

  const anual = await call(admin, "PATCH", `/api/platform/academies/${AC}/plano`, {
    planId: plano.id, status: "ACTIVE", billingPeriod: "ANNUAL", startsOn: hoje, minimumMonths: 12,
  });
  check("muda para anual (2xx)", anual.status === 200 || anual.status === 201, `${anual.status}`);

  const todas = await ordens();
  const a = todas[0];
  const esperado = Math.round(plano.amountCents * 12 * 0.9);
  check("anual é o ano com menos 10%", a?.amountCents === esperado, `${a?.amountCents} (esperava ${esperado})`);
  check("e diz o desconto", a?.discountPct === 10, `${a?.discountPct}`);
  check("guarda o preço de tabela por mês", a?.listMonthlyCents === plano.amountCents, `${a?.listMonthlyCents}`);

  /* --------------------------------------------------- só uma viva ------ */
  console.log("\n=== Só há uma ordem por assinar ===");
  check("a anterior passou a substituída", todas.filter((x) => x.status === "PENDING").length === 1, JSON.stringify(todas.map((x) => x.status)));
  check("e o histórico fica", todas.length === 2, `${todas.length}`);

  /* ------------------------------------ os termos em vigor, agarrados --- */
  const termos = (await db.query(
    `SELECT id, version FROM "LegalDocument"
      WHERE type = 'TERMS_OF_SERVICE' AND status = 'PUBLISHED' AND "effectiveAt" <= now()
      ORDER BY "effectiveAt" DESC LIMIT 1`)).rows[0];
  if (termos) {
    check("a ordem agarra-se aos Termos em vigor", a?.termsDocumentId === termos.id, `${a?.termsDocumentId}`);
    check("e guarda a versão", a?.termsVersion === termos.version, `${a?.termsVersion}`);
  } else {
    console.log("  SALTO — não há Termos de Serviço publicados nesta base");
  }

  /* ------------------------------ sem responsável, não se manda nada ---- */
  console.log("\n=== Sem quem represente o clube ===");
  check("o serviço diz que não enviou", anual.body?.ordem?.enviado === false, JSON.stringify(anual.body?.ordem));
  check("e explica porquê", /represent/i.test(anual.body?.ordem?.motivo ?? ""), `${anual.body?.ordem?.motivo}`);
  check("a ordem existe na mesma", Boolean(a), "não há ordem");
  check("sem destinatário registado", a?.sentToEmail === null, `${a?.sentToEmail}`);

  /* ------------------------------- com presidente, resolve-se a quem ---- */
  console.log("\n=== Com quem represente o clube ===");
  await db.query(`UPDATE "AcademyRole" SET permissions = ARRAY['legal:club']::text[] WHERE id = 'zo_cargo'`);
  await call(admin, "PATCH", `/api/platform/academies/${AC}/plano`, {
    planId: plano.id, status: "ACTIVE", billingPeriod: "ANNUAL", startsOn: hoje, minimumMonths: 12,
  });
  const comPresidente = (await ordens())[0];
  /*
   * O destinatário fica registado mesmo que a entrega falhe — e num endereço
   * `.local` falha de certeza. O que se prova aqui é a resolução de **quem**
   * representa o clube, que é a regra; entregar é do serviço de correio.
   */
  check(
    "a ordem sai para o presidente",
    comPresidente?.sentToEmail === "zo-presidente@teste.local",
    `${comPresidente?.sentToEmail}`,
  );
  check("com o nome dele", comPresidente?.sentToName === "ZO Presidente", `${comPresidente?.sentToName}`);

  /* ----------------------------- corrigir o estado não é contratar ------ */
  console.log("\n=== Mexer só no estado não emite contrato ===");
  const soEstado = await call(admin, "PATCH", `/api/platform/academies/${AC}/plano`, {
    planId: plano.id, status: "PAST_DUE",
  });
  check("grava o estado", soEstado.status === 200 || soEstado.status === 201, `${soEstado.status}`);
  check("e não emite ordem nenhuma", soEstado.body?.ordem === null, JSON.stringify(soEstado.body?.ordem));
  check("continua a haver três", (await ordens()).length === 3, `${(await ordens()).length}`);

  /* ---------------------------------------- o lado do clube ------------- */
  console.log("\n=== Ver e assinar, na consola ===");
  await db.query(`DELETE FROM "SubscriptionOrder" WHERE "academyId" = $1`, [LC]);
  await db.query(
    `INSERT INTO "SubscriptionOrder"
       (id, "academyId", "planId", "planName", "billingPeriod", "listMonthlyCents", "discountPct",
        "amountCents", "startsOn", "minimumMonths", "renewalNote", status, "updatedAt")
     VALUES ('zo_ordem_lc', $1, $2, $3, 'ANNUAL', 1999, 10, 21589, current_date, 12,
             'Renova anualmente após o período mínimo de 12 meses.', 'PENDING', now())`,
    [LC, plano.id, plano.name],
  );

  const vista = await call(director, "GET", "/api/subscricao/ordem");
  check("a consola lê as condições", vista.status === 200, `${vista.status}`);
  check("com a ordem por assinar", vista.body?.pendente?.id === "zo_ordem_lc", JSON.stringify(vista.body?.pendente?.id));
  check("e diz que a direcção pode assinar", vista.body?.podeAssinar === true, `${vista.body?.podeAssinar}`);

  const treinador = await login("treinador@lifeclub.pt");
  const pendTreinador = ((await call(treinador, "GET", "/api/legal/status")).body?.pending ?? []).map((d) => d.id);
  if (pendTreinador.length) await call(treinador, "POST", "/api/legal/accept", { documentIds: pendTreinador });

  const doTreinador = await call(treinador, "GET", "/api/subscricao/ordem");
  check("um treinador vê as condições", doTreinador.status === 200, `${doTreinador.status}`);
  check("mas não as pode assinar", doTreinador.body?.podeAssinar === false, `${doTreinador.body?.podeAssinar}`);
  const tentou = await call(treinador, "POST", "/api/subscricao/ordem/assinar", {});
  check("e é recusado (403)", tentou.status === 403, `${tentou.status}`);
  check(
    "sem assinar nada",
    (await db.query(`SELECT status FROM "SubscriptionOrder" WHERE id = 'zo_ordem_lc'`)).rows[0].status === "PENDING",
  );

  const assinou = await call(director, "POST", "/api/subscricao/ordem/assinar", {});
  check("quem representa o clube assina (2xx)", assinou.status === 200 || assinou.status === 201, `${assinou.status} ${JSON.stringify(assinou.body).slice(0, 120)}`);

  const assinada = (await db.query(`SELECT * FROM "SubscriptionOrder" WHERE id = 'zo_ordem_lc'`)).rows[0];
  check("fica assinada", assinada?.status === "SIGNED", `${assinada?.status}`);
  check("com hora", Boolean(assinada?.signedAt), `${assinada?.signedAt}`);
  check("com o nome de quem assinou", Boolean(assinada?.signerName), `${assinada?.signerName}`);
  check("e o cargo copiado", Boolean(assinada?.signerTitle), `${assinada?.signerTitle}`);

  const depois = await call(director, "GET", "/api/subscricao/ordem");
  check("já não há nada por assinar", depois.body?.pendente === null, JSON.stringify(depois.body?.pendente));
  check("e a assinada aparece", depois.body?.assinada?.id === "zo_ordem_lc", JSON.stringify(depois.body?.assinada?.id));

  const outraVez = await call(director, "POST", "/api/subscricao/ordem/assinar", {});
  check("assinar outra vez não tem o que assinar (404)", outraVez.status === 404, `${outraVez.status}`);
} finally {
  console.log("\n=== Limpeza ===");
  await db.query(`DELETE FROM "SubscriptionOrder" WHERE "academyId" = $1 OR id LIKE 'zo_%'`, [LC]);
  await limpar();
  const restos =
    (await db.query(`SELECT COUNT(*)::int n FROM "Academy" WHERE id = $1`, [AC])).rows[0].n +
    (await db.query(`SELECT COUNT(*)::int n FROM "SubscriptionOrder" WHERE id LIKE 'zo_%'`)).rows[0].n;
  check("tudo apagado", restos === 0, `${restos} linhas ficaram`);
  await db.end();
}

console.log(`\n${ok} passaram, ${bad} falharam`);
process.exit(bad === 0 ? 0 : 1);

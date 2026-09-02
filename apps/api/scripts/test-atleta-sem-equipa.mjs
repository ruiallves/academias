#!/usr/bin/env node
/**
 * O atleta sem equipa — o fantasma.
 *
 * ## O que aconteceu a um clube a sério
 *
 * Apagar uma equipa leva as ligações ao plantel atrás. Os atletas ficam — é o
 * que o produto promete no diálogo — mas ficam **sem equipa nenhuma**. E todas
 * as listas de atletas do produto perguntavam a mesma coisa, *"a equipa dele é
 * uma das minhas?"*, a que um atleta sem equipa responde "não" a toda a gente.
 *
 * O resultado era um fantasma perfeito:
 *
 *  - invisível na consola, até para o presidente, e até na pesquisa;
 *  - a ocupar o NIF, logo impossível de reinscrever (e a recusa saía com uma
 *    mensagem sobre números de camisola, que não ajudava ninguém);
 *  - impossível de editar para lhe dar equipa — "fora do teu âmbito";
 *  - **invisível para a própria família**: o pai abria a app e não via o filho
 *    nem as mensalidades dele.
 *
 * Este teste prova que cada uma destas portas está aberta a quem deve, e
 * fechada a quem não deve.
 *
 * Uso: node scripts/test-atleta-sem-equipa.mjs
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
const API = process.env.API_URL ?? "http://localhost:3000";

let ok = 0;
let bad = 0;
const check = (l, c, d = "") => {
  if (c) {
    ok++;
    console.log("  OK    " + l);
  } else {
    bad++;
    console.log("  FALHA " + l + (d ? " — " + d : ""));
  }
};

const login = async (email) =>
  (
    await (
      await fetch(`${S}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: { apikey: A, "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: "academia2026" }),
      })
    ).json()
  ).access_token;

const call = async (token, method, pathname, body, app = "console") => {
  const r = await fetch(API + pathname, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "x-academy-slug": "life-club",
      "x-app": app,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};

const db = new pg.Client({ connectionString: env("MIGRATE_DATABASE_URL"), ssl: { rejectUnauthorized: false } });
await db.connect();

const academia = (await db.query(`SELECT id FROM "Academy" WHERE slug = 'life-club'`)).rows[0].id;

const limpar = async () => {
  await db.query(`DELETE FROM "Charge" WHERE "athleteId" IN (SELECT id FROM "Athlete" WHERE name LIKE 'ZO %')`);
  await db.query(`DELETE FROM "Athlete" WHERE name LIKE 'ZO %'`);
  await db.query(`DELETE FROM "Team" WHERE name LIKE 'ZO %'`);
};
await limpar();

const director = await login("direcao@lifeclub.pt");
const coach = await login("treinador@lifeclub.pt");
const familia = await login("familia@lifeclub.pt");

/* ================================================= o clube fica órfão ==== */

console.log("=== Apagar a equipa deixa o atleta sem equipa ===");
const sport = (await db.query(`SELECT id FROM "Sport" WHERE "academyId" = $1 LIMIT 1`, [academia])).rows[0].id;
const epoca = (await db.query(`SELECT label FROM "Season" WHERE "academyId" = $1 AND "isCurrent" = true`, [academia]))
  .rows[0].label;
const equipa = await call(director, "POST", "/api/teams", {
  name: "ZO Sub-99",
  sportId: sport,
  maxAge: 99,
  season: epoca,
  schedule: [],
});
check("a equipa de teste cria-se", equipa.status === 201, `${equipa.status} ${JSON.stringify(equipa.body).slice(0, 120)}`);

const NIF = "245678903";
const atleta = await call(director, "POST", "/api/athletes", {
  name: "ZO Fantasma da Silva",
  birthdate: "2012-05-04",
  taxId: NIF,
  teamId: equipa.body.id,
  squadNumber: 77,
});
check("o atleta inscreve-se nela", atleta.status === 201, `${atleta.status} ${JSON.stringify(atleta.body).slice(0, 120)}`);
const atletaId = atleta.body?.id;

// Uma mensalidade dele, para provar que a família continua a vê-la depois.
await db.query(
  `INSERT INTO "Charge" (id, "academyId", "athleteId", period, "amountCents", "dueDate", status, "updatedAt")
   VALUES ('zoch1', $1, $2, '2031-11', 4000, now(), 'OPEN', now())`,
  [academia, atletaId],
);

// E é dele um encarregado, para o caminho da app do pai.
const membershipFamilia = (
  await db.query(
    `SELECT m.id FROM "Membership" m JOIN "User" u ON u.id = m."userId"
      WHERE u.email = 'familia@lifeclub.pt' AND m."academyId" = $1 LIMIT 1`,
    [academia],
  )
).rows[0].id;
await db.query(
  `INSERT INTO "GuardianLink" (id, "athleteId", "membershipId", relation, "isPayer")
   VALUES ('zoglink1', $1, $2, 'Pai', true)`,
  [atletaId, membershipFamilia],
);

const apagada = await call(director, "DELETE", `/api/teams/${equipa.body.id}`, { confirmName: "ZO Sub-99" });
check("a equipa apaga-se", apagada.status === 200, `${apagada.status} ${JSON.stringify(apagada.body).slice(0, 120)}`);

const semEquipa = await db.query(
  `SELECT COUNT(*)::int AS n FROM "TeamMembership" WHERE "athleteId" = $1`,
  [atletaId],
);
check("e o atleta fica mesmo sem equipa nenhuma", semEquipa.rows[0].n === 0, `${semEquipa.rows[0].n}`);
check(
  "mas continua no clube, activo",
  (await db.query(`SELECT status FROM "Athlete" WHERE id = $1`, [atletaId])).rows[0]?.status === "ACTIVE",
);

/* ======================================================== quem o vê ====== */

console.log("\n=== Quem vê um atleta sem equipa ===");
const listaDirector = await call(director, "GET", "/api/athletes");
check(
  "a direcção vê-o (é quem o pode recolocar)",
  listaDirector.body?.some?.((a) => a.id === atletaId),
  `${listaDirector.body?.length} atletas, nenhum é ele`,
);
check(
  "e vem sem equipa, em vez de vir com uma inventada",
  listaDirector.body?.find?.((a) => a.id === atletaId)?.teamId === null,
);

const listaCoach = await call(coach, "GET", "/api/athletes");
check(
  "um treinador não o vê — não é da equipa dele",
  !listaCoach.body?.some?.((a) => a.id === atletaId),
  "o treinador está a ver um atleta que não é dele",
);

/* ================================================== a app do pai ========= */

console.log("\n=== A app do pai continua a ver o filho ===");
const filhos = await call(familia, "GET", "/api/athletes", undefined, "family");
check(
  "o encarregado vê o educando sem equipa",
  filhos.body?.some?.((a) => a.id === atletaId),
  `${filhos.status} — ${filhos.body?.length ?? 0} educandos`,
);

/*
 * As mensalidades do filho sem equipa.
 *
 * Se as colunas novas de `Charge` (kind/slot/title/notes — as cobranças
 * avulsas) estiverem no `schema.prisma` mas ainda não na base, estes dois
 * pedidos rebentam com 500 **antes** de chegarem ao filtro que aqui se testa.
 * Nesse caso o teste diz que ficou bloqueado, em vez de dar uma falha que
 * manda procurar o problema no sítio errado.
 */
let bloqueados = 0;
const semColunas =
  (await call(familia, "GET", "/api/charges?period=2031-11", undefined, "family")).status === 500;

if (semColunas) {
  bloqueados += 2;
  console.log("  BLOQUEADO  as mensalidades — faltam colunas de `Charge` na base (migração das cobranças avulsas)");
  console.log("             corre `node scripts/check-schema.mjs` e cria a migração; depois estes dois testes valem.");
} else {
  const mensalidades = await call(familia, "GET", "/api/charges?period=2031-11", undefined, "family");
  check(
    "e vê as mensalidades dele",
    mensalidades.body?.some?.((c) => c.athleteId === atletaId),
    `${mensalidades.status} ${JSON.stringify(mensalidades.body?.length)}`,
  );

  const doBilling = await call(familia, "GET", "/billing/charges?period=2031-11", undefined, "family");
  check(
    "e pode chegar a elas para pagar",
    doBilling.status === 200 && doBilling.body?.some?.((c) => c.athleteId === atletaId),
    `${doBilling.status}`,
  );
}

/* ===================================================== recolocá-lo ======= */

console.log("\n=== E consegue-se pô-lo noutra equipa ===");
const outraEquipa = (
  await db.query(`SELECT id, name FROM "Team" WHERE "academyId" = $1 LIMIT 1`, [academia])
).rows[0];

const tentativaCoach = await call(coach, "PATCH", `/api/athletes/${atletaId}`, { teamId: outraEquipa.id });
check("um treinador não o recoloca (403)", tentativaCoach.status === 403, `${tentativaCoach.status}`);

const recolocado = await call(director, "PATCH", `/api/athletes/${atletaId}`, { teamId: outraEquipa.id });
check("a direcção recoloca-o", recolocado.status === 200, `${recolocado.status} ${JSON.stringify(recolocado.body).slice(0, 140)}`);
check(
  "e a ligação à equipa existe outra vez",
  (await db.query(`SELECT COUNT(*)::int AS n FROM "TeamMembership" WHERE "athleteId" = $1`, [atletaId])).rows[0].n === 1,
);

/* ================================================== o NIF repetido ======= */

console.log("\n=== O NIF repetido diz quem já o tem ===");
const repetido = await call(director, "POST", "/api/athletes", {
  name: "ZO Outro Qualquer",
  birthdate: "2013-01-01",
  taxId: NIF,
  teamId: outraEquipa.id,
});
check("a segunda inscrição com o mesmo NIF é recusada (400)", repetido.status === 400, `${repetido.status}`);
check(
  "e a mensagem nomeia o atleta que já lá está",
  String(repetido.body?.message ?? "").includes("ZO Fantasma da Silva"),
  JSON.stringify(repetido.body?.message),
);
check(
  "sem falar em camisolas, que não é o problema",
  !String(repetido.body?.message ?? "").toLowerCase().includes("camisola"),
  JSON.stringify(repetido.body?.message),
);

/* =========================================================== limpeza ===== */

await limpar();
await db.query(`DELETE FROM "GuardianLink" WHERE id = 'zoglink1'`);
const restos = await db.query(`SELECT COUNT(*)::int AS n FROM "Athlete" WHERE name LIKE 'ZO %'`);
check("\ntudo limpo no fim", restos.rows[0].n === 0);

await db.end();
console.log(
  `\n${ok} OK, ${bad} FALHA${bad === 1 ? "" : "S"}${bloqueados ? `, ${bloqueados} bloqueados por migração em falta` : ""}`,
);
process.exit(bad ? 1 : 0);

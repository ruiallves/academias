#!/usr/bin/env node
/**
 * A viragem de época, e o percurso que ela deixa escrito.
 *
 * O pedido: um botão nas Definições para começar época nova, com os atletas a
 * subir de escalão por idade, os treinadores a ir atrás, e "tanto uma equipa
 * como o atleta a manter track por onde já passou".
 *
 * O que se guarda aqui:
 *
 * 1. **A proposta** (não grava nada): o nome e as datas da época seguinte, os
 *    escalões com atletas, treinadores e preço, e cada atleta com a sugestão de
 *    onde fica. A regra da idade é a das federações — idade a 31 de Dezembro do
 *    ano em que a época começa —, e um Sub-11 joga **até** aos 11.
 * 2. **A viragem**: cria a época (que passa a ser a corrente), copia os
 *    escalões com a linhagem (`previousTeamId`), move os atletas, leva os
 *    treinadores e copia os preços.
 * 3. **O percurso**: a passagem antiga fecha com data, a nova abre, e as três
 *    leituras (atleta, treinador, equipa) contam a história.
 * 4. Quem sai fica `LEFT`; quem fica por renovar fica sem equipa, e é assim que
 *    aparece depois na lista de quem falta resolver.
 * 5. Mudar de escalão **no dia a dia** também escreve percurso, em vez de
 *    reescrever a passagem que havia.
 *
 * Uso: API_URL=http://127.0.0.1:3011 node scripts/test-nova-epoca.mjs
 */
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
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
  if (c) {
    ok++;
    console.log("  OK    " + l);
  } else {
    bad++;
    console.log("  FALHA " + l + (d ? " — " + d : ""));
  }
};

const Z = "zf-teste-epoca";
const ZF = "zf_academia";

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

const call = async (token, method, pathname, body) => {
  const r = await fetch(API + pathname, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "x-academy-slug": Z,
      "x-app": "console",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};

const db = new pg.Client({ connectionString: env("MIGRATE_DATABASE_URL"), ssl: { rejectUnauthorized: false } });
await db.connect();

const direcao = (await db.query(`SELECT id FROM "User" WHERE email = 'direcao@lifeclub.pt'`)).rows[0];

const limpar = async () => {
  await db.query(`DELETE FROM "SubscriptionPlan" WHERE "academyId" = $1`, [ZF]);
  await db.query(`DELETE FROM "TeamStaff" WHERE "teamId" IN (SELECT id FROM "Team" WHERE "academyId" = $1)`, [ZF]);
  await db.query(`DELETE FROM "TeamMembership" WHERE "athleteId" LIKE 'zf_%'`);
  await db.query(`DELETE FROM "Athlete" WHERE "academyId" = $1`, [ZF]);
  await db.query(`UPDATE "Team" SET "previousTeamId" = NULL WHERE "academyId" = $1`, [ZF]);
  await db.query(`DELETE FROM "Team" WHERE "academyId" = $1`, [ZF]);
  await db.query(`DELETE FROM "Season" WHERE "academyId" = $1`, [ZF]);
  await db.query(`DELETE FROM "LegalAcceptance" WHERE "academyId" = $1`, [ZF]).catch(() => undefined);
  await db.query(`DELETE FROM "Membership" WHERE "academyId" = $1`, [ZF]);
  await db.query(`DELETE FROM "Sport" WHERE "academyId" = $1`, [ZF]);
  await db.query(`DELETE FROM "Academy" WHERE id = $1`, [ZF]);
  await db.query(`DELETE FROM "User" WHERE id = 'zf_user_treinador'`);
};
await limpar();

const passagens = async (atleta) =>
  (await db.query(
    `SELECT t.name, to_char(m."joinedAt", 'YYYY-MM-DD') entrada, to_char(m."leftAt", 'YYYY-MM-DD') saida
       FROM "TeamMembership" m JOIN "Team" t ON t.id = m."teamId"
      WHERE m."athleteId" = $1 ORDER BY m."joinedAt"`,
    [atleta],
  )).rows;

try {
  /* ---------------------------------------------------- o clube de teste --- */
  await db.query(
    `INSERT INTO "Academy" (id, slug, name, "shortName", status, "updatedAt")
     VALUES ($1, $2, 'ZF Teste Época', 'ZF', 'ACTIVE', now())`, [ZF, Z],
  );
  await db.query(`INSERT INTO "Sport" (id, "academyId", name, positions, skills) VALUES ('zf_sport', $1, 'Futebol', ARRAY[]::text[], ARRAY[]::text[])`, [ZF]);
  await db.query(
    `INSERT INTO "Season" (id, "academyId", label, "startsOn", "endsOn", "isCurrent")
     VALUES ('zf_season', $1, '2026/27', '2026-08-01', '2027-07-31', true)`, [ZF],
  );
  for (const [id, nome, idade] of [["zf_t11", "ZF Sub-11", 11], ["zf_t13", "ZF Sub-13", 13], ["zf_t15", "ZF Sub-15", 15]]) {
    await db.query(
      `INSERT INTO "Team" (id, "academyId", "sportId", "seasonId", name, "maxAge", "maxCallUps", "updatedAt")
       VALUES ($1, $2, 'zf_sport', 'zf_season', $3, $4, 16, now())`,
      [id, ZF, nome, idade],
    );
    await db.query(
      `INSERT INTO "SubscriptionPlan" (id, "academyId", "teamId", name, "amountCents") VALUES ($1, $2, $3, $4, $5)`,
      [`plan_${id}`, ZF, id, nome, 3000 + idade * 100],
    );
  }

  /*
   * Os atletas, pelo ano de nascimento — que é o que a regra usa:
   * na época 2027/28 conta a idade a 31/12/2027.
   */
  const plantel = [
    ["zf_a1", "ZF Ana", "2016-03-02", "zf_t11"],   // 11 em 2027 → fica no Sub-11
    ["zf_a2", "ZF Bruno", "2015-11-20", "zf_t11"], // 12 em 2027 → sobe ao Sub-13
    ["zf_a3", "ZF Carla", "2014-01-05", "zf_t13"], // 13 em 2027 → fica no Sub-13
    ["zf_a4", "ZF Diogo", "2013-06-30", "zf_t13"], // 14 em 2027 → sobe ao Sub-15
    ["zf_a5", "ZF Elsa", "2012-09-09", "zf_t15"],  // 15 em 2027 → fica no Sub-15
    ["zf_a6", "ZF Faro", "2011-04-04", "zf_t15"],  // 16 em 2027 → sem escalão
  ];
  for (const [id, nome, nascimento, equipa] of plantel) {
    await db.query(
      `INSERT INTO "Athlete" (id, "academyId", name, birthdate, status, "joinedAt", "updatedAt")
       VALUES ($1, $2, $3, $4, 'ACTIVE', '2024-09-01', now())`,
      [id, ZF, nome, nascimento],
    );
    await db.query(
      `INSERT INTO "TeamMembership" (id, "teamId", "athleteId", position, "joinedAt") VALUES ($1, $2, $3, 'Defesa', '2026-08-01')`,
      [`tm_${id}`, equipa, id],
    );
  }

  await db.query(`INSERT INTO "Membership" (id, "academyId", "userId", role, "isActive", "updatedAt") VALUES ('zf_memb_dir', $1, $2, 'OWNER', true, now())`, [ZF, direcao.id]);
  await db.query(`INSERT INTO "User" (id, "authId", name, email, "updatedAt") VALUES ('zf_user_treinador', $1, 'ZF Treinador', 'zf-treinador@teste.local', now())`, [randomUUID()]);
  await db.query(`INSERT INTO "Membership" (id, "academyId", "userId", role, "isActive", "updatedAt") VALUES ('zf_memb_coach', $1, 'zf_user_treinador', 'COACH', true, now())`, [ZF]);
  await db.query(`INSERT INTO "TeamStaff" (id, "teamId", "membershipId", title, "joinedAt") VALUES ('zf_ts', 'zf_t11', 'zf_memb_coach', 'Treinador principal', '2026-08-01')`);

  const director = await login("direcao@lifeclub.pt");
  const pend = ((await call(director, "GET", "/api/legal/status")).body?.pending ?? []).map((d) => d.id);
  if (pend.length) {
    const aceite = await call(director, "POST", "/api/legal/accept", { documentIds: pend, confirmAuthority: true });
    check("(preparação) termos do clube aceites", aceite.status === 200 || aceite.status === 201, `${aceite.status}`);
  }

  /* ----------------------------------------------------------- a proposta --- */
  console.log("=== A proposta ===");
  const prop = await call(director, "GET", "/api/seasons/proposta");
  check("responde (200)", prop.status === 200, `${prop.status} ${JSON.stringify(prop.body).slice(0, 200)}`);
  check("diz a época em curso", prop.body?.actual?.label === "2026/27", `${prop.body?.actual?.label}`);
  check("propõe a seguinte", prop.body?.sugestao?.label === "2027/28", `${prop.body?.sugestao?.label}`);
  check("com as datas um ano à frente", prop.body?.sugestao?.startsOn === "2027-08-01" && prop.body?.sugestao?.endsOn === "2028-07-31", JSON.stringify(prop.body?.sugestao));
  check("traz os três escalões", prop.body?.equipas?.length === 3, `${prop.body?.equipas?.length}`);
  const sub11 = (prop.body?.equipas ?? []).find((e) => e.id === "zf_t11");
  check("com os atletas contados", sub11?.atletas === 2, `${sub11?.atletas}`);
  check("o treinador", sub11?.treinadores?.[0] === "ZF Treinador", JSON.stringify(sub11?.treinadores));
  check("e o preço de hoje", sub11?.amountCents === 4100, `${sub11?.amountCents}`);

  const sugestao = Object.fromEntries((prop.body?.atletas ?? []).map((a) => [a.id, a]));
  check("quem ainda cabe no escalão fica (Sub-11 aos 11)", sugestao.zf_a1?.sugestaoTeamId === "zf_t11" && sugestao.zf_a1?.sobe === false, JSON.stringify(sugestao.zf_a1));
  check("quem passa a idade sobe (Sub-11 → Sub-13)", sugestao.zf_a2?.sugestaoTeamId === "zf_t13" && sugestao.zf_a2?.sobe === true, JSON.stringify(sugestao.zf_a2));
  check("e a idade é a de 31/12 do ano que começa", sugestao.zf_a2?.idadeNaEpoca === 12, `${sugestao.zf_a2?.idadeNaEpoca}`);
  check("o Sub-13 que fez 14 sobe ao Sub-15", sugestao.zf_a4?.sugestaoTeamId === "zf_t15", JSON.stringify(sugestao.zf_a4));
  check("quem já não cabe em nenhum fica por decidir", sugestao.zf_a6?.semEscalao === true && sugestao.zf_a6?.sugestaoTeamId === null, JSON.stringify(sugestao.zf_a6));
  check("e a proposta não gravou nada", (await db.query(`SELECT count(*)::int n FROM "Season" WHERE "academyId" = $1`, [ZF])).rows[0].n === 1);

  /* ------------------------------------------------------------ a viragem --- */
  console.log("\n=== A viragem ===");
  const virar = await call(director, "POST", "/api/seasons/virar", {
    label: "2027/28",
    startsOn: "2027-08-01",
    endsOn: "2028-07-31",
    equipas: [
      { fromTeamId: "zf_t11", amountCents: 4200 },
      { fromTeamId: "zf_t13", amountCents: 4400 },
      { fromTeamId: "zf_t15", amountCents: null },
    ],
    atletas: [
      { athleteId: "zf_a1", destino: "zf_t11" },
      { athleteId: "zf_a2", destino: "zf_t13" },
      { athleteId: "zf_a3", destino: "zf_t13" },
      { athleteId: "zf_a4", destino: "zf_t15" },
      { athleteId: "zf_a5", destino: "POR_RENOVAR" },
      { athleteId: "zf_a6", destino: "SAI" },
    ],
  });
  check("responde (2xx)", virar.status === 200 || virar.status === 201, `${virar.status} ${JSON.stringify(virar.body).slice(0, 200)}`);
  check("diz o que fez", virar.body?.equipas === 3 && virar.body?.transitaram === 4 && virar.body?.porRenovar === 1 && virar.body?.sairam === 1, JSON.stringify(virar.body));

  const epocas = (await db.query(`SELECT label, "isCurrent" FROM "Season" WHERE "academyId" = $1 ORDER BY "startsOn"`, [ZF])).rows;
  check("a época nova existe e é a corrente", epocas.length === 2 && epocas[1].label === "2027/28" && epocas[1].isCurrent === true, JSON.stringify(epocas));
  check("e a antiga deixou de o ser", epocas[0].isCurrent === false, JSON.stringify(epocas[0]));

  const novas = (await db.query(
    `SELECT t.id, t.name, t."maxAge", t."previousTeamId", t."maxCallUps" FROM "Team" t JOIN "Season" s ON s.id = t."seasonId"
      WHERE s.label = '2027/28' AND t."academyId" = $1 ORDER BY t."maxAge"`, [ZF],
  )).rows;
  check("três escalões novos", novas.length === 3, JSON.stringify(novas.map((t) => t.name)));
  check("com o mesmo nome e idade", novas[0].name === "ZF Sub-11" && novas[0].maxAge === 11, JSON.stringify(novas[0]));
  check("a dizer de onde vieram", novas[0].previousTeamId === "zf_t11" && novas[1].previousTeamId === "zf_t13", JSON.stringify(novas.map((t) => t.previousTeamId)));
  check("e com as definições da equipa atrás", novas[0].maxCallUps === 16, `${novas[0].maxCallUps}`);

  const precos = (await db.query(
    `SELECT p."amountCents", t.name FROM "SubscriptionPlan" p JOIN "Team" t ON t.id = p."teamId"
      JOIN "Season" s ON s.id = t."seasonId" WHERE s.label = '2027/28' ORDER BY t."maxAge"`,
  )).rows;
  check("os preços copiados, já com o valor novo", precos.length === 2 && precos[0].amountCents === 4200 && precos[1].amountCents === 4400, JSON.stringify(precos));
  check("e o escalão sem preço fica sem plano", precos.every((p) => p.name !== "ZF Sub-15"), JSON.stringify(precos));

  /* ----------------------------------------------------------- o percurso --- */
  console.log("\n=== O percurso ===");
  const bruno = await passagens("zf_a2");
  check("o Bruno tem duas passagens", bruno.length === 2, JSON.stringify(bruno));
  const HOJE = new Date().toISOString().slice(0, 10);
  check("a do Sub-11 fechou no dia da viragem", bruno[0].name === "ZF Sub-11" && bruno[0].saida === HOJE, JSON.stringify(bruno[0]));
  check("e a do Sub-13 abriu nesse dia", bruno[1].name === "ZF Sub-13" && bruno[1].entrada === HOJE && bruno[1].saida === null, JSON.stringify(bruno[1]));

  const percurso = await call(director, "GET", "/api/athletes/zf_a2/percurso");
  check("a API conta a mesma história", percurso.body?.length === 2, JSON.stringify(percurso.body).slice(0, 200));
  check("com a época de cada passagem", percurso.body?.[0]?.season === "2027/28" && percurso.body?.[1]?.season === "2026/27", JSON.stringify(percurso.body?.map?.((p) => p.season)));
  check("e a posição que o atleta levava", percurso.body?.[0]?.position === "Defesa", `${percurso.body?.[0]?.position}`);

  const doTreinador = await call(director, "GET", "/api/staff/zf_memb_coach/percurso");
  check("o treinador foi atrás da equipa", doTreinador.body?.length === 2, JSON.stringify(doTreinador.body).slice(0, 200));
  check("com a passagem antiga fechada", doTreinador.body?.some((p) => p.season === "2026/27" && p.leftAt), JSON.stringify(doTreinador.body));

  const daEquipa = await call(director, "GET", `/api/teams/${novas[0].id}/percurso`);
  check("a equipa nova diz de onde veio", daEquipa.body?.veioDe?.season === "2026/27", JSON.stringify(daEquipa.body?.veioDe));
  check("e quem lá está", daEquipa.body?.atletas?.length === 1 && daEquipa.body.atletas[0].name === "ZF Ana", JSON.stringify(daEquipa.body?.atletas));
  const velha = await call(director, "GET", "/api/teams/zf_t11/percurso");
  check("a equipa velha guarda quem passou por ela", velha.body?.atletas?.length === 2 && velha.body.atletas.every((a) => a.leftAt), JSON.stringify(velha.body?.atletas));

  console.log("\n=== Quem não transita ===");
  const elsa = await passagens("zf_a5");
  check("quem fica por renovar fica sem equipa", elsa.length === 1 && elsa[0].saida === HOJE, JSON.stringify(elsa));
  const estados = Object.fromEntries((await db.query(`SELECT id, status FROM "Athlete" WHERE "academyId" = $1`, [ZF])).rows.map((r) => [r.id, r.status]));
  check("e continua activo (falta decidir, não saiu)", estados.zf_a5 === "ACTIVE", `${estados.zf_a5}`);
  check("quem sai fica marcado como saído", estados.zf_a6 === "LEFT", `${estados.zf_a6}`);

  console.log("\n=== Mudar de escalão no dia a dia ===");
  const mudou = await call(director, "PATCH", "/api/athletes/zf_a1", { teamId: novas[1].id });
  check("responde (2xx)", mudou.status === 200 || mudou.status === 201, `${mudou.status} ${JSON.stringify(mudou.body).slice(0, 160)}`);
  const ana = await passagens("zf_a1");
  check("fecha a passagem e abre outra", ana.length === 3 && ana[1].saida !== null && ana[2].saida === null, JSON.stringify(ana));
  check("e leva a posição atrás", (await call(director, "GET", "/api/athletes/zf_a1/percurso")).body?.[0]?.position === "Defesa");

  console.log("\n=== O que não se deixa fazer ===");
  const repetida = await call(director, "POST", "/api/seasons/virar", {
    label: "2027/28", startsOn: "2027-08-01", endsOn: "2028-07-31",
    equipas: [{ fromTeamId: "zf_t11" }], atletas: [],
  });
  check("uma época com nome repetido é recusada", repetida.status === 400, `${repetida.status}`);
  const aoContrario = await call(director, "POST", "/api/seasons/virar", {
    label: "2028/29", startsOn: "2028-08-01", endsOn: "2028-07-31",
    equipas: [{ fromTeamId: "zf_t11" }], atletas: [],
  });
  check("uma época que acaba antes de começar também", aoContrario.status === 400, `${aoContrario.status}`);
} catch (error) {
  bad++;
  console.log("  FALHA (excepção) " + (error?.stack ?? error));
} finally {
  await limpar();
  await db.end();
}

console.log(`\n${ok} OK, ${bad} falha(s)`);
process.exit(bad ? 1 : 0);

#!/usr/bin/env node
/**
 * Um atleta em várias equipas — inscrever, editar e importar.
 *
 * O que interessa:
 *  - inscrever com duas equipas (de modalidades diferentes), cada uma com o seu
 *    número e posição, e a lista de atletas devolver as duas;
 *  - o número não se repete dentro de uma equipa;
 *  - editar com a lista inteira: mudar o número numa, sair da outra (a passagem
 *    fica com data de saída), e o número da ficha seguir a principal;
 *  - a forma antiga (`teamId` solto) trocar só a principal;
 *  - importar duas linhas com o mesmo NIF juntar as equipas no mesmo atleta, sem
 *    parar a perguntar "substituir?".
 *
 * Cria uma equipa temporária noutra modalidade do Life Club (`zz_t_2eq`) e
 * atletas com nomes "ZZ …"; apaga tudo no fim.
 *
 * Uso: node scripts/test-varias-equipas.mjs  (API na :3000)
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
const API = "http://localhost:3000";

let ok = 0, bad = 0;
const check = (l, c, d = "") => { if (c) { ok++; console.log("  OK    " + l); } else { bad++; console.log("  FALHA " + l + (d ? " — " + d : "")); } };

const login = async (email) =>
  (await (await fetch(`${S}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: A, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "academia2026" }),
  })).json()).access_token;

const call = async (token, method, pathname, body) => {
  const r = await fetch(API + pathname, {
    method,
    headers: { Authorization: `Bearer ${token}`, "x-academy-slug": "life-club", ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};

const db = new pg.Client({ connectionString: env("MIGRATE_DATABASE_URL"), ssl: { rejectUnauthorized: false } });
await db.connect();

const limpar = async () => {
  await db.query(`DELETE FROM "Athlete" WHERE name LIKE 'ZZ Várias %'`);
  await db.query(`DELETE FROM "TeamMembership" WHERE "teamId" = 'zz_t_2eq'`);
  await db.query(`DELETE FROM "Team" WHERE id = 'zz_t_2eq'`);
};

const direcao = await login("direcao@lifeclub.pt");
const sub11 = (await db.query(`SELECT id, "academyId", "sportId", "seasonId", name FROM "Team" WHERE id = 't_sub11'`)).rows[0];
const outra = (await db.query(
  `SELECT id FROM "Sport" WHERE "academyId" = $1 AND id <> $2 ORDER BY name LIMIT 1`,
  [sub11.academyId, sub11.sportId],
)).rows[0];
if (!outra) {
  console.log("O Life Club precisa de uma segunda modalidade para este teste.");
  process.exit(1);
}

await limpar();
await db.query(
  `INSERT INTO "Team" (id, "academyId", "sportId", "seasonId", name, "maxAge", "updatedAt")
   VALUES ('zz_t_2eq', $1, $2, $3, 'ZZ Futsal Várias', 13, NOW())`,
  [sub11.academyId, outra.id, sub11.seasonId],
);

// NIFs de teste, distintos a cada corrida (o índice é único por academia).
const nif = () => String(900000000 + Math.floor(Math.random() * 99999999)).slice(0, 9);
const passagens = async (athleteId) =>
  (await db.query(
    `SELECT "teamId", "squadNumber", position, "leftAt" FROM "TeamMembership" WHERE "athleteId" = $1 ORDER BY "joinedAt", id`,
    [athleteId],
  )).rows;

try {
  console.log("=== Inscrever em duas equipas ===");
  const nifA = nif();
  const criado = await call(direcao, "POST", "/api/athletes", {
    name: "ZZ Várias Equipas",
    birthdate: "2015-05-05",
    taxId: nifA,
    equipas: [
      { teamId: "t_sub11", squadNumber: 87, position: null },
      { teamId: "zz_t_2eq", squadNumber: 88, position: null },
    ],
  });
  check("inscreve (201)", criado.status === 201 || criado.status === 200, JSON.stringify(criado.body));
  const id = criado.body?.id;
  const p1 = await passagens(id);
  check("fica nas duas equipas", p1.length === 2 && p1.every((p) => p.leftAt === null), JSON.stringify(p1));
  check("cada uma com o seu número", p1[0]?.squadNumber === 87 && p1[1]?.squadNumber === 88, JSON.stringify(p1));
  const ficha = (await db.query(`SELECT "squadNumber" FROM "Athlete" WHERE id = $1`, [id])).rows[0];
  check("o número da ficha é o da principal", ficha.squadNumber === 87, JSON.stringify(ficha));

  const lista = await call(direcao, "GET", "/api/athletes");
  const naLista = lista.body?.find?.((a) => a.id === id);
  check(
    "a lista de atletas devolve as duas equipas",
    naLista?.equipas?.length === 2 && naLista.teamId === "t_sub11" && naLista.equipas[1].squadNumber === 88,
    JSON.stringify(naLista?.equipas),
  );

  console.log("\n=== O número não se repete dentro de uma equipa ===");
  const choque = await call(direcao, "POST", "/api/athletes", {
    name: "ZZ Várias Choque",
    birthdate: "2015-06-06",
    taxId: nif(),
    equipas: [{ teamId: "zz_t_2eq", squadNumber: 88 }],
  });
  check("recusa o 88 que já é de outro nessa equipa (400)", choque.status === 400, JSON.stringify(choque.body));
  const repetida = await call(direcao, "POST", "/api/athletes", {
    name: "ZZ Várias Repetida",
    birthdate: "2015-06-06",
    taxId: nif(),
    equipas: [{ teamId: "t_sub11" }, { teamId: "t_sub11" }],
  });
  check("recusa a mesma equipa duas vezes (400)", repetida.status === 400, JSON.stringify(repetida.body));

  console.log("\n=== Editar com a lista inteira ===");
  const muda = await call(direcao, "PATCH", `/api/athletes/${id}`, {
    equipas: [{ teamId: "zz_t_2eq", squadNumber: 89, position: null }],
  });
  check("grava (200)", muda.status === 200, JSON.stringify(muda.body));
  const p2 = await passagens(id);
  const sub11Depois = p2.find((p) => p.teamId === "t_sub11");
  const futsalDepois = p2.find((p) => p.teamId === "zz_t_2eq");
  check("sai do Sub-11: a passagem fica, com data de saída", sub11Depois && sub11Depois.leftAt !== null, JSON.stringify(sub11Depois));
  check("fica na outra, com o número novo", futsalDepois?.leftAt === null && futsalDepois?.squadNumber === 89, JSON.stringify(futsalDepois));
  const ficha2 = (await db.query(`SELECT "squadNumber" FROM "Athlete" WHERE id = $1`, [id])).rows[0];
  check("o número da ficha segue a principal nova", ficha2.squadNumber === 89, JSON.stringify(ficha2));

  const semNenhuma = await call(direcao, "PATCH", `/api/athletes/${id}`, { equipas: [] });
  check("não deixa o atleta sem equipa nenhuma (400)", semNenhuma.status === 400, JSON.stringify(semNenhuma.body));

  console.log("\n=== Voltar a uma equipa por onde já passou ===");
  const volta = await call(direcao, "PATCH", `/api/athletes/${id}`, {
    equipas: [{ teamId: "zz_t_2eq", squadNumber: 89 }, { teamId: "t_sub11", squadNumber: 86 }],
  });
  check("grava (200), sem rebentar no índice único", volta.status === 200, JSON.stringify(volta.body));
  const p3 = await passagens(id);
  check("está outra vez nas duas", p3.filter((p) => p.leftAt === null).length === 2, JSON.stringify(p3));

  console.log("\n=== A forma antiga troca só a principal ===");
  const antiga = await call(direcao, "PATCH", `/api/athletes/${id}`, { squadNumber: 85 });
  check("grava (200)", antiga.status === 200, JSON.stringify(antiga.body));
  const p4 = (await passagens(id)).filter((p) => p.leftAt === null);
  check(
    "o número muda na principal e a outra fica",
    p4.length === 2 && p4[0].squadNumber === 85 && p4.some((p) => p.teamId === "t_sub11" && p.squadNumber === 86),
    JSON.stringify(p4),
  );

  console.log("\n=== Importar: duas linhas, o mesmo NIF ===");
  const nifB = nif();
  const importa = await call(direcao, "POST", "/api/athletes/import", {
    rows: [
      { name: "ZZ Várias Importado", birthdate: "2014-04-04", taxId: nifB, teamId: "t_sub11", squadNumber: 84 },
      { name: "ZZ Várias Importado", birthdate: "2014-04-04", taxId: nifB, teamId: "zz_t_2eq", squadNumber: 83 },
    ],
  });
  check("importa sem perguntar nada (200/201)", (importa.status === 200 || importa.status === 201) && importa.body?.existingTotal === 0, JSON.stringify(importa.body));
  check("um atleta criado, uma equipa juntada", importa.body?.created === 1 && importa.body?.equipasJuntadas === 1, JSON.stringify(importa.body));
  const importado = (await db.query(`SELECT id FROM "Athlete" WHERE "taxId" = $1`, [nifB])).rows;
  check("é um atleta só", importado.length === 1, JSON.stringify(importado));
  const p5 = importado[0] ? await passagens(importado[0].id) : [];
  check(
    "nas duas equipas, com o número de cada linha",
    p5.length === 2 && p5.some((p) => p.teamId === "t_sub11" && p.squadNumber === 84) && p5.some((p) => p.teamId === "zz_t_2eq" && p.squadNumber === 83),
    JSON.stringify(p5),
  );
} finally {
  console.log("\n=== Limpeza ===");
  await limpar();
  await db.end();
  console.log("  feito");
}

console.log(`\n${ok} passaram, ${bad} falharam`);
process.exit(bad === 0 ? 0 : 1);

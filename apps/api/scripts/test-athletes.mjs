#!/usr/bin/env node
/**
 * Escrita de atletas: criar um, e importar em lote.
 *
 * O que interessa: a permissão (`athlete:write`), o âmbito (um treinador só
 * inscreve nas equipas dele), a validação por linha na importação (uma linha má não
 * derruba as boas), e a rejeição de duplicados.
 *
 * Uso: node scripts/test-athletes.mjs
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

/**
 * Um NIF por atleta de teste.
 *
 * O NIF passou a ser obrigatório em qualquer escrita nova de atletas — é o que liga
 * a família à app. Sem um aqui, cada `POST` morria em 400 na validação, muito antes
 * de chegar ao que estes testes existem para provar: permissão, âmbito, duplicados
 * e mass-assignment. São únicos por academia, daí o contador.
 */
let nifSeq = 0;
const nif = () => String(500000000 + ((Date.now() % 1000) * 1000) + nifSeq++).slice(0, 9);

let ok = 0, bad = 0;
const check = (l, c, d = "") => { if (c) { ok++; console.log("  OK    " + l); } else { bad++; console.log("  FALHA " + l + (d ? " — " + d : "")); } };

const login = async (email) =>
  (await (await fetch(`${S}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: A, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "academia2026" }),
  })).json()).access_token;

const call = async (token, method, pathname, body) => {
  const r = await fetch(API + pathname, {
    method, headers: { Authorization: `Bearer ${token}`, "x-academy-slug": "life-club", ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};

const db = new pg.Client({ connectionString: env("MIGRATE_DATABASE_URL"), ssl: { rejectUnauthorized: false } });
await db.connect();
// Estado limpo — remove atletas de corridas anteriores.
await db.query(`DELETE FROM "Athlete" WHERE name LIKE 'ZZ Teste%'`);

const director = await login("direcao@lifeclub.pt");
const coach = await login("treinador@lifeclub.pt");
const parent = await login("familia@lifeclub.pt");

console.log("=== Criar um atleta ===");
const created = await call(director, "POST", "/api/athletes", {
  name: "ZZ Teste Um", taxId: nif(), birthdate: "2015-05-05", teamId: "t_sub11", position: "Médio", squadNumber: 77,
});
check("a direção inscreve um atleta", created.status === 201 || created.status === 200, JSON.stringify(created.body).slice(0, 120));
check("com o nome certo", created.body?.name === "ZZ Teste Um");

console.log("\n=== Permissão e âmbito ===");
const byParent = await call(parent, "POST", "/api/athletes", { name: "ZZ Teste X", taxId: nif(), birthdate: "2015-01-01", teamId: "t_sub11" });
check("um encarregado não inscreve atletas (403)", byParent.status === 403, `${byParent.status}`);
// O treinador tem athlete:write por omissão — inscreve, mas só nas suas equipas.
const byCoach = await call(coach, "POST", "/api/athletes", { name: "ZZ Teste Coach", taxId: nif(), birthdate: "2015-01-01", teamId: "t_sub11" });
check("um treinador inscreve na sua equipa por omissão (201)", byCoach.status === 201 || byCoach.status === 200, `${byCoach.status}`);
// A direção pode retirar-lhe athlete:write pessoa a pessoa. O contexto relê a
// membership a cada pedido, por isso o mesmo token já reflecte a retirada.
const revoke = await call(director, "PATCH", "/api/staff/mem_coach/access", { grants: [], revokes: ["athlete:write"] });
check("a direção retira athlete:write ao treinador (200)", revoke.status === 200 || revoke.status === 201, `${revoke.status}`);
const byCoachDenied = await call(coach, "POST", "/api/athletes", { name: "ZZ Teste Y", taxId: nif(), birthdate: "2015-01-01", teamId: "t_sub11" });
check("sem athlete:write o treinador já não inscreve (403)", byCoachDenied.status === 403, `${byCoachDenied.status}`);
// Repõe o treinador ao que o papel dá, para não deixar a base num estado alterado.
const restore = await call(director, "PATCH", "/api/staff/mem_coach/access", { grants: [], revokes: [] });
check("a direção repõe o acesso do treinador (200)", restore.status === 200 || restore.status === 201, `${restore.status}`);
// A direção tem athlete:write mas uma equipa inexistente é sempre recusada (400).
const badTeam = await call(director, "POST", "/api/athletes", { name: "ZZ Teste Y2", taxId: nif(), birthdate: "2015-01-01", teamId: "t_nao_existe" });
check("equipa inexistente é recusada (400)", badTeam.status === 400, `${badTeam.status}`);

console.log("\n=== Validação de forma (DTO) ===");
const badDate = await call(director, "POST", "/api/athletes", { name: "ZZ Teste Z", taxId: nif(), birthdate: "nao-e-data", teamId: "t_sub11" });
check("data inválida rejeitada com 400", badDate.status === 400, `${badDate.status}`);
const massAssign = await call(director, "POST", "/api/athletes", { name: "ZZ Teste W", taxId: nif(), birthdate: "2015-01-01", teamId: "t_sub11", academyId: "acd_outra", status: "LEFT" });
check("campos extra (academyId/status) rejeitados", massAssign.status === 400, `${massAssign.status}`);

console.log("\n=== Data improvável ===");
const future = await call(director, "POST", "/api/athletes", { name: "ZZ Teste Futuro", taxId: nif(), birthdate: "2105-01-01", teamId: "t_sub11" });
check("nascido no futuro (2105) rejeitado", future.status === 400, JSON.stringify(future.body).slice(0, 80));

console.log("\n=== Importação em lote ===");
const rows = [
  { name: "ZZ Teste Ana", taxId: nif(), birthdate: "2015-03-03", teamId: "t_sub11", position: "Defesa" },
  { name: "ZZ Teste Bruno", taxId: nif(), birthdate: "2015-04-04", teamId: "t_sub11", squadNumber: 10 },
  { name: "ZZ Teste Carla", taxId: nif(), birthdate: "2013-06-06", teamId: "t_sub13" },
  // linha má: equipa desconhecida
  { name: "ZZ Teste Erro", taxId: nif(), birthdate: "2015-07-07", teamId: "t_nao_existe" },
  // duplicado do primeiro criado
  { name: "ZZ Teste Um", taxId: nif(), birthdate: "2015-05-05", teamId: "t_sub11" },
  // número repetido dentro do ficheiro (Bruno usou o 10)
  { name: "ZZ Teste Dup10", taxId: nif(), birthdate: "2015-08-08", teamId: "t_sub11", squadNumber: 10 },
];
const imp = await call(director, "POST", "/api/athletes/import", { rows });
check("a importação responde", imp.status === 201 || imp.status === 200, JSON.stringify(imp.body).slice(0, 120));
check("as três boas entram", imp.body?.created === 3, `criou ${imp.body?.created}`);
check("e as três más voltam com erro", imp.body?.errors?.length === 3, `${imp.body?.errors?.length} erros`);
check("o erro traz o número da linha", imp.body?.errors?.every((e) => typeof e.row === "number"));
check("equipa desconhecida é apanhada", imp.body?.errors?.some((e) => /Equipa/.test(e.error)));
check("duplicado é apanhado", imp.body?.errors?.some((e) => /Já existe/.test(e.error)));
check("número repetido no ficheiro é apanhado", imp.body?.errors?.some((e) => /repetido/.test(e.error)));

console.log("\n=== Tudo isto ficou mesmo na base ===");
const total = (await db.query(`SELECT count(*)::int n FROM "Athlete" WHERE name LIKE 'ZZ Teste%'`)).rows[0].n;
check("5 atletas de teste na base (1 direção + 1 treinador + 3 importados)", total === 5, `${total}`);

console.log("\n=== Limpeza ===");
await db.query(`DELETE FROM "Athlete" WHERE name LIKE 'ZZ Teste%'`);
await db.end();
console.log("  feito");

console.log(`\n${ok} passaram, ${bad} falharam`);
process.exit(bad === 0 ? 0 : 1);

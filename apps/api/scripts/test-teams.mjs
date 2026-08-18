#!/usr/bin/env node
/**
 * Criação de equipas via API.
 *
 * O que interessa: a permissão (`team:write` — direção sim, treinador não), a
 * resolução da época pelo rótulo (reusa a existente, cria a nova), a validação de
 * forma (horário, mass-assignment) e a persistência real na base.
 *
 * Uso: node scripts/test-teams.mjs
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
    method, headers: { Authorization: `Bearer ${token}`, "x-academy-slug": "life-club", ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};

const db = new pg.Client({ connectionString: env("MIGRATE_DATABASE_URL"), ssl: { rejectUnauthorized: false } });
await db.connect();
// Estado limpo — remove equipas e a época de teste de corridas anteriores.
await db.query(`DELETE FROM "Team" WHERE name LIKE 'ZZ Equipa%'`);
await db.query(`DELETE FROM "Season" WHERE label = '2098/99'`);

const director = await login("direcao@lifeclub.pt");
const coach = await login("treinador@lifeclub.pt");
const parent = await login("familia@lifeclub.pt");

const slot = [{ weekday: 2, start: "18:00", end: "19:30", venue: "Campo 1" }];

console.log("=== Criar uma equipa ===");
const created = await call(director, "POST", "/api/teams", {
  name: "ZZ Equipa Um", sportId: "sp_fut", ageGroup: "Sub-11", season: "2026/27", schedule: slot,
});
check("a direção cria uma equipa", created.status === 201 || created.status === 200, JSON.stringify(created.body).slice(0, 140));
check("com o nome certo", created.body?.name === "ZZ Equipa Um");
check("e a época reutilizada pelo rótulo", created.body?.season === "2026/27");

console.log("\n=== Permissão ===");
const byCoach = await call(coach, "POST", "/api/teams", { name: "ZZ Equipa Coach", sportId: "sp_fut", ageGroup: "Sub-11", season: "2026/27", schedule: slot });
check("um treinador não cria equipas (403)", byCoach.status === 403, `${byCoach.status}`);
const byParent = await call(parent, "POST", "/api/teams", { name: "ZZ Equipa Pai", sportId: "sp_fut", ageGroup: "Sub-11", season: "2026/27", schedule: slot });
check("um encarregado não cria equipas (403)", byParent.status === 403, `${byParent.status}`);

console.log("\n=== Regras ===");
const badSport = await call(director, "POST", "/api/teams", { name: "ZZ Equipa Sp", sportId: "sp_nao_existe", ageGroup: "Sub-11", season: "2026/27", schedule: slot });
check("modalidade desconhecida recusada (400)", badSport.status === 400, `${badSport.status}`);
const badCoach = await call(director, "POST", "/api/teams", { name: "ZZ Equipa Tr", sportId: "sp_fut", ageGroup: "Sub-11", season: "2026/27", coachId: "mem_nao_existe", schedule: slot });
check("treinador desconhecido recusado (400)", badCoach.status === 400, `${badCoach.status}`);

console.log("\n=== Treinador principal ===");
const withCoach = await call(director, "POST", "/api/teams", { name: "ZZ Equipa Com Treinador", sportId: "sp_fut", ageGroup: "Sub-13", season: "2026/27", coachId: "mem_coach", schedule: slot });
check("cria com treinador principal (201)", withCoach.status === 201 || withCoach.status === 200, `${withCoach.status}`);
check("o treinador aparece nos coaches", withCoach.body?.coaches?.some((c) => c.id === "mem_coach"), JSON.stringify(withCoach.body?.coaches));

console.log("\n=== Época nova ===");
const newSeason = await call(director, "POST", "/api/teams", { name: "ZZ Equipa Futuro", sportId: "sp_fut", ageGroup: "Sub-11", season: "2098/99", schedule: slot });
check("cria equipa numa época nova (201)", newSeason.status === 201 || newSeason.status === 200, `${newSeason.status}`);
const seasonRow = (await db.query(`SELECT "startsOn","endsOn" FROM "Season" WHERE label = '2098/99'`)).rows[0];
check("a época nova foi criada na base", !!seasonRow);
check("com datas inferidas do rótulo (agosto→julho)", seasonRow && new Date(seasonRow.startsOn).getUTCFullYear() === 2098);

console.log("\n=== Validação de forma (DTO) ===");
const badTime = await call(director, "POST", "/api/teams", { name: "ZZ Equipa Hora", sportId: "sp_fut", ageGroup: "Sub-11", season: "2026/27", schedule: [{ weekday: 2, start: "25:99", end: "19:30", venue: "Campo 1" }] });
check("hora de horário inválida rejeitada (400)", badTime.status === 400, `${badTime.status}`);
const massAssign = await call(director, "POST", "/api/teams", { name: "ZZ Equipa Extra", sportId: "sp_fut", ageGroup: "Sub-11", season: "2026/27", schedule: slot, academyId: "acd_outra", maxCallUps: 99 });
check("campos extra (academyId/maxCallUps) rejeitados", massAssign.status === 400, `${massAssign.status}`);

console.log("\n=== Ficou mesmo na base ===");
const total = (await db.query(`SELECT count(*)::int n FROM "Team" WHERE name LIKE 'ZZ Equipa%'`)).rows[0].n;
check("3 equipas de teste na base (Um, Com Treinador, Futuro)", total === 3, `${total}`);

console.log("\n=== Limpeza ===");
await db.query(`DELETE FROM "Team" WHERE name LIKE 'ZZ Equipa%'`);
await db.query(`DELETE FROM "Season" WHERE label = '2098/99'`);
await db.end();
console.log("  feito");

console.log(`\n${ok} passaram, ${bad} falharam`);
process.exit(bad === 0 ? 0 : 1);

#!/usr/bin/env node
/**
 * Acesso configurável por pessoa, persistido no servidor.
 *
 * O caso central: um treinador importa atletas por omissão; a direção pode
 * retirar-lho, e a retirada **tem efeito no servidor** e sobrevive a um reload.
 * Mais as guardas contra escalada.
 *
 * Uso: node scripts/test-access.mjs
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
// Estado limpo — sem excepções do treinador de corridas anteriores.
await db.query(`UPDATE "Membership" SET grants='{}', revokes='{}' WHERE id='mem_coach'`);
await db.query(`DELETE FROM "Athlete" WHERE name LIKE 'ZZ Acc%'`);

const director = await login("direcao@lifeclub.pt");
const coach = await login("treinador@lifeclub.pt");

console.log("=== Por omissão, o treinador importa/inscreve ===");
const boot = await call(coach, "GET", "/api/bootstrap");
check("o treinador tem athlete:write por omissão", boot.body?.me?.grants !== undefined && await coachCanCreate(coach), "");
async function coachCanCreate(tok) {
  const r = await call(tok, "POST", "/api/athletes", { name: "ZZ Acc Um", birthdate: "2015-05-05", teamId: "t_sub11" });
  return r.status < 300;
}
check("o me traz revokes (vazio)", Array.isArray(boot.body?.me?.revokes) && boot.body.me.revokes.length === 0);

console.log("\n=== A direção retira athlete:write a este treinador ===");
const patch = await call(director, "PATCH", "/api/staff/mem_coach/access", { grants: [], revokes: ["athlete:write"] });
check("o PATCH funciona", patch.status < 300, `${patch.status}`);
check("guarda a retirada", patch.body?.revokes?.includes("athlete:write"), JSON.stringify(patch.body));

// Persistido mesmo na base?
const stored = (await db.query(`SELECT revokes FROM "Membership" WHERE id='mem_coach'`)).rows[0].revokes;
check("a retirada ficou na base de dados", stored.includes("athlete:write"), JSON.stringify(stored));

console.log("\n=== E agora o treinador já NÃO importa — em sessão nova ===");
const coach2 = await login("treinador@lifeclub.pt"); // sessão nova = contexto relido do servidor
const blocked = await call(coach2, "POST", "/api/athletes", { name: "ZZ Acc Dois", birthdate: "2015-06-06", teamId: "t_sub11" });
check("inscrever é agora recusado (403)", blocked.status === 403, `${blocked.status}`);
const boot2 = await call(coach2, "GET", "/api/bootstrap");
check("e o me reflecte a retirada", boot2.body?.me?.revokes?.includes("athlete:write"));

console.log("\n=== Devolver o acesso ===");
await call(director, "PATCH", "/api/staff/mem_coach/access", { grants: [], revokes: [] });
const coach3 = await login("treinador@lifeclub.pt");
const restored = await call(coach3, "POST", "/api/athletes", { name: "ZZ Acc Tres", birthdate: "2015-07-07", teamId: "t_sub11" });
check("volta a poder inscrever", restored.status < 300, `${restored.status}`);

console.log("\n=== Guardas contra escalada ===");
check("um treinador não gere acessos (sem access:write)", (await call(coach3, "PATCH", "/api/staff/mem_med/access", { grants: ["billing:read"], revokes: [] })).status === 403);
// A direção não pode conceder access:write (fabricar um co-admin).
const escalate = await call(director, "PATCH", "/api/staff/mem_coach/access", { grants: ["access:write", "settings:write"], revokes: [] });
const stored2 = (await db.query(`SELECT grants FROM "Membership" WHERE id='mem_coach'`)).rows[0].grants;
check("access:write não é delegável (ignorado)", !stored2.includes("access:write"), JSON.stringify(stored2));
check("settings:write também não", !stored2.includes("settings:write"));
// A direção não altera o próprio acesso.
const meId = (await db.query(`SELECT id FROM "Membership" WHERE "userId"='usr_dir'`)).rows[0].id;
const self = await call(director, "PATCH", `/api/staff/${meId}/access`, { grants: [], revokes: ["billing:read"] });
check("a direção não mexe no próprio acesso (400)", self.status === 400, `${self.status}`);

console.log("\n=== Limpeza ===");
await db.query(`UPDATE "Membership" SET grants='{}', revokes='{}' WHERE id='mem_coach'`);
await db.query(`DELETE FROM "Athlete" WHERE name LIKE 'ZZ Acc%'`);
await db.end();
console.log("  feito");

console.log(`\n${ok} passaram, ${bad} falharam`);
process.exit(bad === 0 ? 0 : 1);

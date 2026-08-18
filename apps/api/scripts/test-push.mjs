#!/usr/bin/env node
/**
 * Push — endpoints do servidor.
 *
 * O que interessa: a chave pública é pública, subscrever exige sessão (é o que liga
 * a subscrição a um utilizador), a subscrição fica gravada para essa pessoa, o teste
 * encontra-a, e cancelar apaga-a. O envio real a um telemóvel não se testa aqui —
 * precisa de um endpoint de push verdadeiro do browser —, mas todo o caminho até lá
 * fica coberto.
 *
 * Uso: node scripts/test-push.mjs
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
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "x-academy-slug": "life-club", ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};

const db = new pg.Client({ connectionString: env("MIGRATE_DATABASE_URL"), ssl: { rejectUnauthorized: false } });
await db.connect();
await db.query(`DELETE FROM "PushSubscription" WHERE endpoint LIKE '%ZZ-test%'`);

const parent = await login("familia@lifeclub.pt");

const endpoint = `https://fcm.googleapis.com/fcm/send/ZZ-test-${Date.now()}`;
const sub = { endpoint, expirationTime: null, keys: { p256dh: "BOZ_test_p256dh_key_placeholder_value_0000000000", auth: "ZZ_test_auth_00" } };

console.log("=== A chave pública ===");
const key = await call(null, "GET", "/api/push/key");
check("GET /api/push/key é público (200)", key.status === 200, `${key.status}`);
check("devolve uma chave VAPID", typeof key.body?.publicKey === "string" && key.body.publicKey.length > 80, `len=${key.body?.publicKey?.length}`);

console.log("\n=== Subscrever exige sessão ===");
const noAuth = await call(null, "POST", "/api/push/subscribe", sub);
check("subscrever sem sessão é recusado (401)", noAuth.status === 401, `${noAuth.status}`);

const subd = await call(parent, "POST", "/api/push/subscribe", sub);
check("o pai subscreve com sessão (201/200)", subd.status === 201 || subd.status === 200, JSON.stringify(subd.body).slice(0, 120));

const row = (await db.query(`SELECT "userId" FROM "PushSubscription" WHERE endpoint = $1`, [endpoint])).rows[0];
const parentUser = (await db.query(`SELECT id FROM "User" WHERE email = 'familia@lifeclub.pt'`)).rows[0];
check("a subscrição fica ligada ao utilizador certo", row && row.userId === parentUser?.id, `${row?.userId}`);

console.log("\n=== Campos extra do browser não rebentam ===");
const withExtra = await call(parent, "POST", "/api/push/subscribe", { ...sub, expirationTime: null });
check("aceita a forma do browser (endpoint/keys/expirationTime)", withExtra.status === 201 || withExtra.status === 200, `${withExtra.status}`);
const malformed = await call(parent, "POST", "/api/push/subscribe", { endpoint });
check("sem chaves é recusado (400)", malformed.status === 400, `${malformed.status}`);

console.log("\n=== Teste encontra a subscrição ===");
const test = await call(parent, "POST", "/api/push/test", { endpoint, kind: "payment-overdue" });
check("o teste encontra a subscrição (ok:true)", test.status === 201 && test.body?.ok === true, JSON.stringify(test.body));
const testMissing = await call(parent, "POST", "/api/push/test", { endpoint: "https://fcm.googleapis.com/fcm/send/ZZ-test-inexistente", kind: "x" });
check("um endpoint desconhecido devolve ok:false", testMissing.body?.ok === false, JSON.stringify(testMissing.body));

console.log("\n=== Cancelar ===");
const unsub = await call(parent, "POST", "/api/push/unsubscribe", { endpoint });
check("cancelar responde ok", unsub.status === 201 && unsub.body?.ok === true, `${unsub.status}`);
const gone = (await db.query(`SELECT count(*)::int n FROM "PushSubscription" WHERE endpoint = $1`, [endpoint])).rows[0].n;
check("a subscrição desaparece da base", gone === 0, `${gone}`);

console.log("\n=== Limpeza ===");
await db.query(`DELETE FROM "PushSubscription" WHERE endpoint LIKE '%ZZ-test%'`);
await db.end();
console.log("  feito");

console.log(`\n${ok} passaram, ${bad} falharam`);
process.exit(bad === 0 ? 0 : 1);

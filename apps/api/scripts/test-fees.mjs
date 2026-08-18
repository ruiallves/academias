#!/usr/bin/env node
/**
 * Ajuste manual do estado de uma mensalidade (direção).
 *
 * O que interessa: só a direção o pode fazer (`billing:write`), os três estados
 * reais, o registo de um pagamento manual ao marcar como paga, e a validação.
 *
 * Uso: node scripts/test-fees.mjs
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

const director = await login("direcao@lifeclub.pt");
const parent = await login("familia@lifeclub.pt");

// Escolhe uma cobrança qualquer e guarda o estado original, para o repor no fim.
const all = await call(director, "GET", "/api/charges?period=all");
const charges = await call(director, "GET", "/api/charges");
const target = (Array.isArray(charges.body) ? charges.body : []).find((c) => c.status !== "VOID") ?? all.body?.[0];
if (!target) { console.log("Sem cobranças para testar."); process.exit(1); }
const original = (await db.query(`SELECT status, "settledAt" FROM "Charge" WHERE id=$1`, [target.id])).rows[0];

console.log(`=== Cobrança de teste: ${target.id} (estava ${original.status}) ===`);

const paid = await call(director, "PATCH", `/api/charges/${target.id}/status`, { status: "SETTLED" });
check("a direção marca como paga (200)", paid.status === 200 && paid.body?.status === "SETTLED", `${paid.status}`);
const afterPaid = (await db.query(`SELECT status, "settledAt" FROM "Charge" WHERE id=$1`, [target.id])).rows[0];
check("a cobrança fica SETTLED com data de liquidação", afterPaid.status === "SETTLED" && afterPaid.settledAt !== null);
const manual = (await db.query(`SELECT method, provider, status FROM "Payment" WHERE "chargeId"=$1 AND provider='manual' ORDER BY "createdAt" DESC LIMIT 1`, [target.id])).rows[0];
check("fica registado um pagamento manual (CASH/PAID)", manual?.method === "CASH" && manual?.status === "PAID", JSON.stringify(manual));

const reopen = await call(director, "PATCH", `/api/charges/${target.id}/status`, { status: "OPEN" });
check("volta a por pagar (200)", reopen.status === 200 && reopen.body?.status === "OPEN", `${reopen.status}`);
const afterOpen = (await db.query(`SELECT status, "settledAt" FROM "Charge" WHERE id=$1`, [target.id])).rows[0];
check("fica OPEN e sem data de liquidação", afterOpen.status === "OPEN" && afterOpen.settledAt === null);
const refunded = (await db.query(`SELECT status FROM "Payment" WHERE "chargeId"=$1 AND provider='manual' ORDER BY "createdAt" DESC LIMIT 1`, [target.id])).rows[0];
check("o pagamento manual passa a reembolsado", refunded?.status === "REFUNDED", JSON.stringify(refunded));

const voided = await call(director, "PATCH", `/api/charges/${target.id}/status`, { status: "VOID" });
check("a direção anula (200)", voided.status === 200 && voided.body?.status === "VOID", `${voided.status}`);

console.log("\n=== Quem não pode ===");
const byParent = await call(parent, "PATCH", `/api/charges/${target.id}/status`, { status: "SETTLED" });
check("um encarregado não altera mensalidades (403)", byParent.status === 403, `${byParent.status}`);
const bad1 = await call(director, "PATCH", `/api/charges/${target.id}/status`, { status: "PAGO" });
check("estado inválido recusado (400)", bad1.status === 400, `${bad1.status}`);
const bad2 = await call(director, "PATCH", `/api/charges/nao_existe/status`, { status: "OPEN" });
check("cobrança inexistente recusada (404)", bad2.status === 404, `${bad2.status}`);

console.log("\n=== Repor estado original ===");
// Limpa os pagamentos manuais de teste e repõe a cobrança como estava.
await db.query(`DELETE FROM "Payment" WHERE "chargeId"=$1 AND provider='manual'`, [target.id]);
await db.query(`UPDATE "Charge" SET status=$1, "settledAt"=$2 WHERE id=$3`, [original.status, original.settledAt, target.id]);
await db.end();
console.log("  feito");

console.log(`\n${ok} passaram, ${bad} falharam`);
process.exit(bad === 0 ? 0 : 1);

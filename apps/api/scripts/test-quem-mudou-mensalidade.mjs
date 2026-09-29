#!/usr/bin/env node
/**
 * Transferência bancária como método manual, e quem mudou o estado à mão.
 *
 * - marcar como paga por transferência grava um pagamento manual TRANSFER;
 * - cada mudança à mão (paga, por pagar, anulada) guarda quem e quando, e a
 *   lista de mensalidades devolve-o em `changedBy`/`changedAt`;
 * - um método que não é manual (Multibanco) continua recusado.
 *
 * Numa cobrança avulsa criada aqui no Life Club, apagada no fim.
 *
 * Uso: API_URL=http://localhost:3012 node scripts/test-quem-mudou-mensalidade.mjs
 * Nunca contra a :3000 nem a :3001 (as do Rui).
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
const API = process.env.API_URL ?? "http://localhost:3012";
if (/:300[01]\b/.test(API)) throw new Error("Não corras isto contra a :3000 nem a :3001.");
const ID = "zz_charge_quem_mudou";

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
const limpar = () => db.query(`DELETE FROM "Charge" WHERE id = $1`, [ID]);

try {
  await limpar();
  const atleta = (await db.query(`SELECT id FROM "Athlete" WHERE "academyId"='acd_lifeclub' AND status='ACTIVE' ORDER BY "createdAt" LIMIT 1`)).rows[0];
  const periodo = new Date().toISOString().slice(0, 7);
  await db.query(
    `INSERT INTO "Charge" (id, "academyId", "athleteId", kind, period, slot, title, "amountCents", "dueDate", status, "updatedAt")
     VALUES ($1, 'acd_lifeclub', $2, 'EXTRA', $3, $1, 'Teste: quem mudou', 1234, CURRENT_DATE, 'OPEN', now())`,
    [ID, atleta.id, periodo],
  );

  const direcao = await login("direcao@lifeclub.pt");
  const quem = (await db.query(`SELECT u.id, u.name FROM "User" u WHERE u.email = 'direcao@lifeclub.pt'`)).rows[0];
  const linha = async () => (await call(direcao, "GET", `/api/charges?period=${periodo}`)).body?.find?.((c) => c.id === ID);

  const antes = await linha();
  check("nunca mexida: sem changedBy", antes && antes.changedBy === null && antes.changedAt === null, JSON.stringify(antes && { b: antes.changedBy, a: antes.changedAt }));

  const mb = await call(direcao, "PATCH", `/api/charges/${ID}/status`, { status: "SETTLED", method: "MULTIBANCO" });
  check("Multibanco à mão continua recusado (400)", mb.status === 400, String(mb.status));

  const pago = await call(direcao, "PATCH", `/api/charges/${ID}/status`, { status: "SETTLED", method: "TRANSFER" });
  check("marcar como paga por transferência (200)", pago.status === 200, `${pago.status} ${JSON.stringify(pago.body)}`);
  const pag = (await db.query(`SELECT method, provider, status FROM "Payment" WHERE "chargeId"=$1 ORDER BY "createdAt" DESC LIMIT 1`, [ID])).rows[0];
  check("fica um pagamento manual TRANSFER/PAID", pag?.method === "TRANSFER" && pag?.provider === "manual" && pag?.status === "PAID", JSON.stringify(pag));
  const c1 = (await db.query(`SELECT "statusChangedById", "statusChangedAt" FROM "Charge" WHERE id=$1`, [ID])).rows[0];
  check("a mensalidade guarda quem a marcou", c1.statusChangedById === quem.id && c1.statusChangedAt, JSON.stringify(c1));
  const l1 = await linha();
  check("a lista diz o método e quem marcou", l1?.paidMethod === "TRANSFER" && l1?.changedBy === quem.name && !!l1?.changedAt, JSON.stringify(l1 && { m: l1.paidMethod, b: l1.changedBy }));

  const anulada = await call(direcao, "PATCH", `/api/charges/${ID}/status`, { status: "VOID" });
  const l2 = await linha();
  check("anular também fica com quem anulou", anulada.status === 200 && l2?.status === "VOID" && l2?.changedBy === quem.name, JSON.stringify(l2 && { s: l2.status, b: l2.changedBy }));

  const reaberta = await call(direcao, "PATCH", `/api/charges/${ID}/status`, { status: "OPEN" });
  const l3 = await linha();
  check("reabrir também fica com quem reabriu", reaberta.status === 200 && l3?.status === "OPEN" && l3?.changedBy === quem.name, JSON.stringify(l3 && { s: l3.status, b: l3.changedBy }));

  // Paga online depois de mexida à mão: quem a liquidou foi a euPago, não se mostra ninguém.
  await db.query(`INSERT INTO "Payment" (id, "chargeId", "amountCents", method, status, provider, "paidAt", "updatedAt") VALUES ('zz_pay_quem_mudou', $1, 1234, 'MBWAY', 'PAID', 'eupago', now(), now())`, [ID]);
  await db.query(`UPDATE "Charge" SET status='SETTLED', "settledAt"=now() WHERE id=$1`, [ID]);
  const l4 = await linha();
  check("paga online: sem 'Marcada por'", l4?.status === "SETTLED" && l4?.changedBy === null && l4?.changedAt === null, JSON.stringify(l4 && { b: l4.changedBy, p: l4.paidMethod }));
} finally {
  await limpar();
  await db.end();
}

console.log(`\n${ok} OK, ${bad} falhas`);
process.exit(bad ? 1 : 0);

#!/usr/bin/env node
/**
 * O webhook da euPago por clube.
 *
 * Um clube com canal próprio configura o webhook em `/webhooks/eupago/<slug>`,
 * com uma chave dele. O que se guarda aqui é o que torna seguro dar essa chave
 * ao clube:
 *
 *  1. um aviso assinado com a chave do clube, ao endereço dele, põe o
 *     pagamento dele como pago;
 *  2. a mesma coisa com a chave errada é recusada (401) e não mexe em nada;
 *  3. **a chave de um clube não confirma pagamentos de outro** — o aviso é
 *     aceite (200, para a euPago não repetir) mas ignorado, e o pagamento do
 *     outro clube fica por pagar;
 *  4. o endereço de um clube sem chave, ou de um clube que não existe, recusa;
 *  5. o aviso de um clube mandado ao webhook global não passa: a chave do
 *     clube não é a do servidor.
 *
 * Em dois clubes descartáveis, com pagamentos escritos directamente na base.
 * Nunca chama a euPago: os avisos são fabricados e assinados aqui.
 *
 * Uso (API de teste, sem chave euPago, fora da 3000 e da 3001):
 *   EUPAGO_API_KEY= TZ=UTC PORT=3011 AUTO_BILLING_INTERVAL_MIN=0 \
 *     AUTO_MEMBER_FEES_INTERVAL_MIN=0 RECONCILE_INTERVAL_MIN=0 node dist/main
 *   API_URL=http://127.0.0.1:3011 node scripts/test-webhook-por-clube.mjs
 */
import { createHmac, randomUUID } from "node:crypto";
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

const API = process.env.API_URL ?? "";
if (!API || /:(3000|3001)(\/|$)/.test(API)) {
  console.log("Recusado: indica API_URL de uma API arrancada SEM EUPAGO_API_KEY, fora da 3000 e da 3001.");
  process.exit(1);
}

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

/* Dois clubes: A tem chave de webhook, B não tem. */
const A = { id: "zw_acad_a", slug: "zw-teste-webhook-a", chave: `zw-chave-A-${randomUUID()}` };
const B = { id: "zw_acad_b", slug: "zw-teste-webhook-b" };

const aviso = (identifier) => {
  const payload = {
    transactions: {
      identifier,
      reference: 999_000_444,
      trid: `zw-trid-${identifier}-${randomUUID().slice(0, 6)}`,
      method: "Multibanco",
      amount: { value: 30, currency: "EUR" },
      date: new Date().toISOString(),
      status: "PAID",
    },
    channel: { name: "teste" },
  };
  return JSON.stringify(payload);
};

const enviar = async (caminho, raw, chave) => {
  const sig = createHmac("sha256", chave).update(raw, "utf8").digest("base64");
  const r = await fetch(`${API}${caminho}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Signature": sig },
    body: raw,
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};

const db = new pg.Client({ connectionString: env("MIGRATE_DATABASE_URL"), ssl: { rejectUnauthorized: false } });
await db.connect();

const estado = async (paymentId) =>
  (
    await db.query(
      `SELECT p.status AS pagamento, c.status AS cobranca FROM "Payment" p JOIN "Charge" c ON c.id = p."chargeId" WHERE p.id = $1`,
      [paymentId],
    )
  ).rows[0];

async function limpar() {
  for (const id of [A.id, B.id]) {
    await db.query(`DELETE FROM "Notification" WHERE "academyId" = $1`, [id]);
    await db.query(`DELETE FROM "Payment" WHERE "chargeId" IN (SELECT id FROM "Charge" WHERE "academyId" = $1)`, [id]);
    await db.query(`DELETE FROM "Charge" WHERE "academyId" = $1`, [id]);
    await db.query(`DELETE FROM "Athlete" WHERE "academyId" = $1`, [id]);
    await db.query(`DELETE FROM "Academy" WHERE id = $1`, [id]);
  }
  await db.query(`DELETE FROM "WebhookEvent" WHERE "eventId" LIKE 'zw-trid-%'`);
}

try {
  await limpar();

  for (const [c, chave] of [
    [A, A.chave],
    [B, null],
  ]) {
    await db.query(
      `INSERT INTO "Academy" (id, slug, name, "shortName", status, "eupagoWebhookSecret", "updatedAt")
       VALUES ($1, $2, $3, 'ZW', 'ACTIVE', $4, now())`,
      [c.id, c.slug, `ZW Teste Webhook ${c === A ? "A" : "B"}`, chave],
    );
    await db.query(
      `INSERT INTO "Athlete" (id, "academyId", name, birthdate, status, "joinedAt", "updatedAt")
       VALUES ($1, $2, 'Atleta de Teste', '2012-05-05', 'ACTIVE', '2024-01-10', now())`,
      [`${c.id}_atleta`, c.id],
    );
  }

  /* Três mensalidades por pagar: duas de A, uma de B. Cada uma com um pagamento a decorrer. */
  const cobranca = async (clube, n) => {
    const chargeId = `${clube.id}_ch${n}`;
    const paymentId = `${clube.id}_pg${n}`;
    const identificador = `ZW-${clube === A ? "A" : "B"}${n}-${randomUUID().slice(0, 6)}`;
    await db.query(
      `INSERT INTO "Charge" (id, "academyId", "athleteId", kind, period, slot, "amountCents", "dueDate", status, "updatedAt")
       VALUES ($1, $2, $3, 'FEE', $4, '', 3000, '2026-09-08', 'OPEN', now())`,
      [chargeId, clube.id, `${clube.id}_atleta`, `2026-0${n}`],
    );
    await db.query(
      `INSERT INTO "Payment" (id, "chargeId", "amountCents", method, status, provider, "providerRef", identificador, "updatedAt")
       VALUES ($1, $2, 3000, 'MULTIBANCO', 'PENDING', 'eupago', $3, $4, now())`,
      [paymentId, chargeId, `dev-${identificador}`, identificador],
    );
    return { paymentId, identificador };
  };
  const a1 = await cobranca(A, 1);
  const a2 = await cobranca(A, 2);
  const b1 = await cobranca(B, 1);

  console.log("=== O webhook do clube, com a chave do clube ===");
  let r = await enviar(`/webhooks/eupago/${A.slug}`, aviso(a1.identificador), A.chave);
  check("é aceite (200)", r.status === 200, `${r.status} ${JSON.stringify(r.body)}`);
  let e = await estado(a1.paymentId);
  check("e o pagamento do clube fica pago", e?.pagamento === "PAID" && e?.cobranca === "SETTLED", JSON.stringify(e));

  console.log("\n=== Chave errada ===");
  r = await enviar(`/webhooks/eupago/${A.slug}`, aviso(a2.identificador), `outra-chave-${randomUUID()}`);
  check("é recusado (401)", r.status === 401, String(r.status));
  e = await estado(a2.paymentId);
  check("e o pagamento fica por pagar", e?.pagamento === "PENDING" && e?.cobranca === "OPEN", JSON.stringify(e));

  console.log("\n=== A chave de um clube não confirma pagamentos de outro ===");
  r = await enviar(`/webhooks/eupago/${A.slug}`, aviso(b1.identificador), A.chave);
  check("a euPago recebe 200 (não fica a repetir)", r.status === 200, `${r.status} ${JSON.stringify(r.body)}`);
  check("mas o aviso é ignorado", r.body?.ignored === "outro clube", JSON.stringify(r.body));
  e = await estado(b1.paymentId);
  check("e o pagamento do outro clube fica por pagar", e?.pagamento === "PENDING" && e?.cobranca === "OPEN", JSON.stringify(e));

  console.log("\n=== Clubes sem chave, e endereços que não existem ===");
  r = await enviar(`/webhooks/eupago/${B.slug}`, aviso(b1.identificador), A.chave);
  check("um clube sem chave de webhook recusa (401)", r.status === 401, String(r.status));
  r = await enviar(`/webhooks/eupago/zw-clube-que-nao-existe`, aviso(b1.identificador), A.chave);
  check("um endereço desconhecido recusa como uma assinatura errada (401)", r.status === 401, String(r.status));
  e = await estado(b1.paymentId);
  check("e nada mexeu no pagamento", e?.pagamento === "PENDING", JSON.stringify(e));

  console.log("\n=== A chave do clube não serve no webhook global ===");
  r = await enviar(`/webhooks/eupago`, aviso(a2.identificador), A.chave);
  check("o webhook global recusa-a (401)", r.status === 401, String(r.status));
  e = await estado(a2.paymentId);
  check("e o pagamento fica por pagar", e?.pagamento === "PENDING", JSON.stringify(e));
} finally {
  await limpar().catch((err) => console.log("  (limpeza falhou: " + err.message + ")"));
  await db.end();
}

console.log(`\n${ok} OK, ${bad} FALHA`);
if (bad > 0) process.exitCode = 1;

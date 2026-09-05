#!/usr/bin/env node
/**
 * A reconciliação de pagamentos — a rede por baixo do webhook.
 *
 * ## O que este teste existe para provar
 *
 * Que um pagamento em voo **não fica em voo para sempre** quando o webhook da
 * euPago não chega, e que ao acertá-lo ninguém marca dinheiro que não entrou:
 *
 * 1. Uma referência simulada (`dev-*`) expira — nunca houve dinheiro atrás.
 * 2. Uma tentativa cuja cobrança já foi liquidada por outro caminho (a direcção
 *    marcou em dinheiro) fica substituída e expira — a app deixa de a mostrar
 *    "a confirmar".
 * 3. Um MB Way com mais de dez minutos e sem confirmação expira; um com dois
 *    minutos fica em voo.
 * 4. **Expirar não é negar**: se a euPago vier depois dizer que o MB Way
 *    expirado foi pago, o webhook liquida-o na mesma.
 * 5. Só quem tem `billing:write` dispara a reconciliação da academia.
 *
 * ## O que este teste NUNCA faz
 *
 * Chamar a euPago. As referências semeadas são `dev-*` ou MB Way (que não têm
 * consulta na API antiga), e não há credenciais OAuth no `.env` de teste — por
 * isso a lista de pagos vem `null` e a reconciliação decide só pelo relógio e
 * pelo estado da cobrança, que é exactamente o ramo que se quer provar.
 *
 * Uso: node scripts/test-eupago-reconciliar.mjs
 */
import { createHmac } from "node:crypto";
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
const SECRET = env("EUPAGO_WEBHOOK_SECRET");
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

const call = async (token, method, pathname, body) => {
  const r = await fetch(API + pathname, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "x-academy-slug": "life-club",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};

/** Um webhook como a euPago o envia: POST JSON com `X-Signature` em base64. */
const webhook = async (payload) => {
  const raw = JSON.stringify(payload);
  const sig = createHmac("sha256", SECRET).update(raw, "utf8").digest("base64");
  const r = await fetch(`${API}/webhooks/eupago`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Signature": sig },
    body: raw,
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};

const evento = (id, status) => ({
  transactions: {
    identifier: id,
    reference: 999_000_222,
    trid: `zr-trid-${id}-${status}`,
    method: "Mbway",
    amount: { value: 40.0, currency: "EUR" },
    date: new Date().toISOString(),
    status,
  },
  channel: { name: "teste" },
});

const db = new pg.Client({ connectionString: env("MIGRATE_DATABASE_URL"), ssl: { rejectUnauthorized: false } });
await db.connect();

const academia = (await db.query(`SELECT id FROM "Academy" WHERE slug = 'life-club'`)).rows[0].id;
const atleta = (
  await db.query(
    `SELECT g."athleteId" AS id FROM "GuardianLink" g
       JOIN "Membership" m ON m.id = g."membershipId"
       JOIN "User" u ON u.id = m."userId"
      WHERE u.email = 'familia@lifeclub.pt' AND m."academyId" = $1 LIMIT 1`,
    [academia],
  )
).rows[0].id;

const limpar = async () => {
  await db.query(`DELETE FROM "Payment" WHERE id LIKE 'zr%'`);
  await db.query(`DELETE FROM "Charge" WHERE id LIKE 'zr%'`);
  await db.query(`DELETE FROM "WebhookEvent" WHERE "eventId" LIKE 'zr-%'`);
};
await limpar();

// Cobranças em períodos que nunca existem (2032), para não colidir com nada real.
const cobranca = async (n, status = "OPEN") => {
  await db.query(
    `INSERT INTO "Charge" (id, "academyId", "athleteId", period, "amountCents", "dueDate", status, "settledAt", "updatedAt")
     VALUES ($1, $2, $3, $4, 4000, now(), $5, $6, now())`,
    [`zrch${n}`, academia, atleta, `2032-0${n}`, status, status === "SETTLED" ? new Date() : null],
  );
  return `zrch${n}`;
};
const pagamento = async (n, chargeId, { method = "MBWAY", status = "PROCESSING", ref = `zr-ref-${n}`, minutosAtras = 0 } = {}) => {
  await db.query(
    `INSERT INTO "Payment" (id, "chargeId", "amountCents", method, status, provider, "providerRef", "createdAt", "updatedAt")
     VALUES ($1, $2, 4000, $3, $4, 'eupago', $5, now() - ($6 || ' minutes')::interval, now())`,
    [`zrpay${n}`, chargeId, method, status, ref, String(minutosAtras)],
  );
  return `zrpay${n}`;
};
const estadoDe = async (tabela, id) => (await db.query(`SELECT status FROM "${tabela}" WHERE id = $1`, [id])).rows[0]?.status;
const motivoDe = async (id) => (await db.query(`SELECT "rawPayload"->>'reconciliacao' AS m FROM "Payment" WHERE id = $1`, [id])).rows[0]?.m ?? "";

/* ================================================================ semear ===== */

const cDev = await cobranca(1);
const pDev = await pagamento(1, cDev, { method: "MULTIBANCO", status: "PENDING", ref: `dev-mb-zrpay1` });

const cPagaAMao = await cobranca(2, "SETTLED");
const pSubstituido = await pagamento(2, cPagaAMao, { minutosAtras: 30 });

const cVelha = await cobranca(3);
const pVelho = await pagamento(3, cVelha, { minutosAtras: 25 });

const cFresca = await cobranca(4);
const pFresco = await pagamento(4, cFresca, { minutosAtras: 2 });

/* ============================================================ permissões ===== */

console.log("=== Só a direcção reconcilia ===");
const coach = await login("treinador@lifeclub.pt");
const recusado = await call(coach, "POST", "/api/charges/reconciliar");
check("um treinador não dispara a reconciliação (403)", recusado.status === 403, `${recusado.status}`);
check("e nada mudou entretanto", (await estadoDe("Payment", pVelho)) === "PROCESSING");

/* ============================================================ o passe ===== */

console.log("\n=== Um passe de reconciliação ===");
const direcao = await login("direcao@lifeclub.pt");
const passe = await call(direcao, "POST", "/api/charges/reconciliar");
check("a direcção dispara (2xx)", passe.status === 200 || passe.status === 201, `${passe.status} ${JSON.stringify(passe.body)}`);
check("e o passe viu os quatro em voo", passe.body?.vistos >= 4, JSON.stringify(passe.body));

check("a referência simulada expira", (await estadoDe("Payment", pDev)) === "EXPIRED");
check("  com o motivo escrito", /simulada/.test(await motivoDe(pDev)), await motivoDe(pDev));

check("a tentativa da cobrança já liquidada fica substituída", (await estadoDe("Payment", pSubstituido)) === "EXPIRED");
check("  com o motivo escrito", /substitu/.test(await motivoDe(pSubstituido)), await motivoDe(pSubstituido));
check("  e a cobrança continua liquidada", (await estadoDe("Charge", cPagaAMao)) === "SETTLED");

check("o MB Way com 25 minutos expira", (await estadoDe("Payment", pVelho)) === "EXPIRED");
check("  e a cobrança dele fica por pagar (honesto)", (await estadoDe("Charge", cVelha)) === "OPEN");

check("o MB Way com 2 minutos fica em voo", (await estadoDe("Payment", pFresco)) === "PROCESSING");

/* ==================================================== expirar não é negar ===== */

console.log("\n=== Expirar não é negar ===");
const tarde = await webhook(evento(pVelho, "PAID"));
check("o webhook do MB Way expirado entra (200)", tarde.status === 200, JSON.stringify(tarde.body));
check("o pagamento passa a PAID", (await estadoDe("Payment", pVelho)) === "PAID");
check("e a cobrança liquida", (await estadoDe("Charge", cVelha)) === "SETTLED");

const segundoPasse = await call(direcao, "POST", "/api/charges/reconciliar");
check("um segundo passe não mexe no que já está pago", (segundoPasse.status === 200 || segundoPasse.status === 201) && (await estadoDe("Payment", pVelho)) === "PAID");

/* ============================================================== limpeza ===== */

await limpar();
const restos = await db.query(`SELECT COUNT(*)::int AS n FROM "Charge" WHERE id LIKE 'zr%'`);
check("\ntudo limpo no fim", restos.rows[0].n === 0);

await db.end();
console.log(`\n${ok} OK, ${bad} FALHA${bad === 1 ? "" : "S"}`);
process.exit(bad ? 1 : 0);

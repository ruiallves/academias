#!/usr/bin/env node
/**
 * As chaves euPago de um clube, configuradas na plataforma.
 *
 * O painel "Pagamentos euPago" da ficha do clube grava a chave de API do canal
 * e a Chave Criptográfica do webhook. O que se prova é que isso chega, sem
 * reiniciar nada:
 *
 *  1. a ficha diz o que está definido e o endereço a dar ao clube, e nunca
 *     devolve as chaves;
 *  2. gravar pelo painel põe o webhook do clube a funcionar logo a seguir: um
 *     aviso assinado com a chave acabada de gravar marca o pagamento como pago;
 *  3. a auditoria regista quem mudou, sem os valores;
 *  4. chave curta recusada; quem não é da plataforma não chega lá;
 *  5. "Apagar chaves" desliga o webhook do clube na hora.
 *
 * A chave de API usada aqui é falsa e nenhum pagamento é criado pela API — os
 * pagamentos são escritos na base — por isso nunca se chama a euPago.
 *
 * Uso: API_URL=http://127.0.0.1:3011 node scripts/test-eupago-na-plataforma.mjs
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

const S = env("SUPABASE_URL").replace(/\/$/, "");
const ANON = env("SUPABASE_ANON_KEY");
const SERVICE = env("SUPABASE_SERVICE_ROLE_KEY");

/*
 * Um admin da plataforma descartável, com palavra-passe ao acaso que ninguém
 * conhece, só enquanto o teste corre — apagado no fim, com a conta de sessão.
 */
const ADMIN_EMAIL = `zp-admin-${randomUUID().slice(0, 8)}@teste.academias.pt`;
const ADMIN_PASS = randomUUID() + randomUUID();
let adminAuthId = null;

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

const login = async (email, password) =>
  (
    await (
      await fetch(`${S}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: { apikey: ANON, "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      })
    ).json()
  ).access_token;

const call = async (token, method, pathname, body) => {
  const r = await fetch(API + pathname, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};

const CLUBE = { id: "zp_acad_eupago", slug: "zp-teste-eupago-plataforma" };
const API_KEY = "zp00-fake-0000-0000-0000";
const CHAVE = `zp-chave-${randomUUID()}`;

const aviso = (identifier) =>
  JSON.stringify({
    transactions: {
      identifier,
      reference: 999_000_555,
      trid: `zp-trid-${randomUUID().slice(0, 8)}`,
      method: "Multibanco",
      amount: { value: 30, currency: "EUR" },
      date: new Date().toISOString(),
      status: "PAID",
    },
    channel: { name: "teste" },
  });

const webhook = async (raw, chave) => {
  const r = await fetch(`${API}/webhooks/eupago/${CLUBE.slug}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Signature": createHmac("sha256", chave).update(raw, "utf8").digest("base64"),
    },
    body: raw,
  });
  return r.status;
};

const db = new pg.Client({ connectionString: env("MIGRATE_DATABASE_URL"), ssl: { rejectUnauthorized: false } });
await db.connect();

const estado = async (paymentId) =>
  (await db.query(`SELECT status FROM "Payment" WHERE id = $1`, [paymentId])).rows[0]?.status;

async function limpar() {
  await db.query(`DELETE FROM "Notification" WHERE "academyId" = $1`, [CLUBE.id]);
  await db.query(`DELETE FROM "Payment" WHERE "chargeId" IN (SELECT id FROM "Charge" WHERE "academyId" = $1)`, [CLUBE.id]);
  await db.query(`DELETE FROM "Charge" WHERE "academyId" = $1`, [CLUBE.id]);
  await db.query(`DELETE FROM "Athlete" WHERE "academyId" = $1`, [CLUBE.id]);
  await db.query(`DELETE FROM "AuditLog" WHERE "targetId" = $1`, [CLUBE.id]).catch(() => {});
  await db.query(`DELETE FROM "Academy" WHERE id = $1`, [CLUBE.id]);
  await db.query(`DELETE FROM "WebhookEvent" WHERE "eventId" LIKE 'zp-trid-%' OR payload->>'webhook' LIKE 'zp-%'`);
  await db.query(`DELETE FROM "AuditLog" WHERE "adminId" IN (SELECT id FROM "PlatformAdmin" WHERE email LIKE 'zp-admin-%@teste.academias.pt')`).catch(() => {});
  await db.query(`DELETE FROM "PlatformAdmin" WHERE email LIKE 'zp-admin-%@teste.academias.pt'`);
  if (adminAuthId) {
    await fetch(`${S}/auth/v1/admin/users/${adminAuthId}`, {
      method: "DELETE",
      headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
    });
    adminAuthId = null;
  }
}

const pagamento = async (n) => {
  const chargeId = `${CLUBE.id}_ch${n}`;
  const paymentId = `${CLUBE.id}_pg${n}`;
  const identificador = `ZP-${n}-${randomUUID().slice(0, 6)}`;
  await db.query(
    `INSERT INTO "Charge" (id, "academyId", "athleteId", kind, period, slot, "amountCents", "dueDate", status, "updatedAt")
     VALUES ($1, $2, $3, 'FEE', $4, '', 3000, '2026-09-08', 'OPEN', now())`,
    [chargeId, CLUBE.id, `${CLUBE.id}_atleta`, `2026-0${n}`],
  );
  await db.query(
    `INSERT INTO "Payment" (id, "chargeId", "amountCents", method, status, provider, "providerRef", identificador, "updatedAt")
     VALUES ($1, $2, 3000, 'MULTIBANCO', 'PENDING', 'eupago', $3, $4, now())`,
    [paymentId, chargeId, `dev-${identificador}`, identificador],
  );
  return { paymentId, identificador };
};

try {
  await limpar();
  await db.query(
    `INSERT INTO "Academy" (id, slug, name, "shortName", status, "updatedAt")
     VALUES ($1, $2, 'ZP Teste euPago na plataforma', 'ZP', 'ACTIVE', now())`,
    [CLUBE.id, CLUBE.slug],
  );
  await db.query(
    `INSERT INTO "Athlete" (id, "academyId", name, birthdate, status, "joinedAt", "updatedAt")
     VALUES ($1, $2, 'Atleta de Teste', '2012-05-05', 'ACTIVE', '2024-01-10', now())`,
    [`${CLUBE.id}_atleta`, CLUBE.id],
  );
  const p1 = await pagamento(1);
  const p2 = await pagamento(2);

  const criado = await (
    await fetch(`${S}/auth/v1/admin/users`, {
      method: "POST",
      headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" },
      body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASS, email_confirm: true }),
    })
  ).json();
  adminAuthId = criado.id;
  if (!adminAuthId) throw new Error("não criou o admin de teste: " + JSON.stringify(criado));
  await db.query(
    `INSERT INTO "PlatformAdmin" (id, "authId", email, name, role, "isActive", "updatedAt") VALUES ($1, $2, $3, 'Admin de teste', 'ADMIN', true, now())`,
    [`zp_admin_${randomUUID().slice(0, 8)}`, adminAuthId, ADMIN_EMAIL],
  );
  const admin = await login(ADMIN_EMAIL, ADMIN_PASS);
  const director = await login("direcao@lifeclub.pt", "academia2026");

  console.log("=== A ficha do clube, antes ===");
  let r = await call(admin, "GET", `/api/platform/academies/${CLUBE.id}`);
  check("abre (200)", r.status === 200, `${r.status} ${JSON.stringify(r.body)?.slice(0, 160)}`);
  const e0 = r.body?.eupago;
  check("nada definido", e0?.apiKey === false && e0?.webhookSecret === false, JSON.stringify(e0));
  check("e mostra o endereço a dar ao clube", e0?.webhookUrl?.endsWith(`/webhooks/eupago/${CLUBE.slug}`), e0?.webhookUrl);
  check("sem chave, o webhook do clube recusa", (await webhook(aviso(p1.identificador), CHAVE)) === 401);

  console.log("\n=== O que se recusa ===");
  r = await call(admin, "PATCH", `/api/platform/academies/${CLUBE.id}/eupago`, { webhookSecret: "curta" });
  check("chave do webhook com menos de 16 caracteres (400)", r.status === 400, String(r.status));
  r = await call(director, "PATCH", `/api/platform/academies/${CLUBE.id}/eupago`, { apiKey: API_KEY, webhookSecret: CHAVE });
  check("um director de clube não chega lá", r.status === 401 || r.status === 403, String(r.status));

  console.log("\n=== Gravar pelo painel ===");
  r = await call(admin, "PATCH", `/api/platform/academies/${CLUBE.id}/eupago`, { apiKey: API_KEY, webhookSecret: CHAVE });
  check("grava (200)", r.status === 200, `${r.status} ${JSON.stringify(r.body)}`);
  check("e responde que as duas estão definidas", r.body?.apiKey === true && r.body?.webhookSecret === true, JSON.stringify(r.body));
  check("sem devolver as chaves", !JSON.stringify(r.body).includes(CHAVE) && !JSON.stringify(r.body).includes(API_KEY));
  const guardado = (await db.query(`SELECT "eupagoApiKey", "eupagoWebhookSecret" FROM "Academy" WHERE id = $1`, [CLUBE.id])).rows[0];
  check("ficam no clube", guardado?.eupagoApiKey === API_KEY && guardado?.eupagoWebhookSecret === CHAVE);
  r = await call(admin, "GET", `/api/platform/academies/${CLUBE.id}`);
  check("a ficha também não as mostra", !JSON.stringify(r.body).includes(CHAVE) && !JSON.stringify(r.body).includes(API_KEY));

  console.log("\n=== E o webhook do clube funciona logo, sem reiniciar ===");
  check("aviso assinado com a chave gravada (200)", (await webhook(aviso(p1.identificador), CHAVE)) === 200);
  check("e o pagamento fica pago", (await estado(p1.paymentId)) === "PAID");

  console.log("\n=== Auditoria ===");
  const audit = await db
    .query(`SELECT action, detail::text AS d FROM "AuditLog" WHERE "targetId" = $1 ORDER BY "createdAt"`, [CLUBE.id])
    .catch((err) => ({ rows: [], err }));
  const linha = audit.rows.find((x) => x.action === "academy.eupago");
  check("fica registado", Boolean(linha), audit.err?.message ?? JSON.stringify(audit.rows));
  check("sem os valores", linha && !linha.d.includes(CHAVE) && !linha.d.includes(API_KEY), linha?.d);

  console.log("\n=== Apagar chaves ===");
  r = await call(admin, "PATCH", `/api/platform/academies/${CLUBE.id}/eupago`, { apiKey: "", webhookSecret: "" });
  check("apaga (200)", r.status === 200 && r.body?.apiKey === false && r.body?.webhookSecret === false, JSON.stringify(r.body));
  check("e o webhook do clube volta a recusar logo", (await webhook(aviso(p2.identificador), CHAVE)) === 401);
  check("sem mexer no pagamento", (await estado(p2.paymentId)) === "PENDING");
} finally {
  await limpar().catch((err) => console.log("  (limpeza falhou: " + err.message + ")"));
  await db.end();
}

console.log(`\n${ok} OK, ${bad} FALHA`);
if (bad > 0) process.exitCode = 1;

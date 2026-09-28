#!/usr/bin/env node
/**
 * Contactos por clube, e a mensalidade da plataforma marcada à mão.
 *
 * Contactos:
 *  1. um contacto é um clube: nasce com o nome do clube, modalidade e associação,
 *     sem nome de ninguém;
 *  2. marcar "email enviado" / "ligámos" guarda a data, escreve no histórico e
 *     passa "por contactar" a "à espera de resposta"; desmarcar limpa a data;
 *  3. a resposta nova fica no histórico com o que responderam.
 *
 * Mensalidades da plataforma, num clube com condições **por assinar**:
 *  4. a ficha mostra o período a correr e o seguinte, mesmo sem aviso emitido;
 *  5. "Recebido" num período sem aviso cria o aviso já pago e o ganho nas Contas;
 *  6. desmarcar um período cujo aviso ainda não saiu apaga a linha (a varredura
 *     manda o aviso no dia certo) e tira o ganho das Contas;
 *  7. um período que não é do contrato é recusado.
 *
 * Um clube e um admin descartáveis, apagados no fim.
 *
 * Uso: API_URL=http://127.0.0.1:3011 node scripts/test-contactos-e-mensalidades.mjs
 */
import { randomUUID } from "node:crypto";
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
  console.log("Recusado: indica API_URL de uma API de teste, fora da 3000 e da 3001.");
  process.exit(1);
}

const S = env("SUPABASE_URL").replace(/\/$/, "");
const ANON = env("SUPABASE_ANON_KEY");
const SERVICE = env("SUPABASE_SERVICE_ROLE_KEY");

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

const call = async (token, method, pathname, body) => {
  const r = await fetch(API + pathname, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};

const ADMIN_EMAIL = `zc-admin-${randomUUID().slice(0, 8)}@teste.academias.pt`;
const ADMIN_PASS = randomUUID() + randomUUID();
let adminAuthId = null;
const CLUBE = { id: "zc_acad_mens", slug: "zc-teste-mensalidades" };
const NOME = `ZC Clube de Teste ${randomUUID().slice(0, 6)}`;
let contactId = null;

const db = new pg.Client({ connectionString: env("MIGRATE_DATABASE_URL"), ssl: { rejectUnauthorized: false } });
await db.connect();

async function limpar() {
  if (contactId) await db.query(`DELETE FROM "Contact" WHERE id = $1`, [contactId]);
  await db.query(`DELETE FROM "Contact" WHERE name LIKE 'ZC Clube de Teste %'`);
  await db.query(`DELETE FROM "PlatformTransaction" WHERE "academyId" = $1`, [CLUBE.id]);
  await db.query(`DELETE FROM "SubscriptionNotice" WHERE "academyId" = $1`, [CLUBE.id]);
  await db.query(`DELETE FROM "SubscriptionOrder" WHERE "academyId" = $1`, [CLUBE.id]);
  await db.query(`DELETE FROM "Academy" WHERE id = $1`, [CLUBE.id]);
  await db.query(`DELETE FROM "AuditLog" WHERE "adminId" IN (SELECT id FROM "PlatformAdmin" WHERE email LIKE 'zc-admin-%@teste.academias.pt')`).catch(() => {});
  await db.query(`DELETE FROM "PlatformAdmin" WHERE email LIKE 'zc-admin-%@teste.academias.pt'`);
  if (adminAuthId) {
    await fetch(`${S}/auth/v1/admin/users/${adminAuthId}`, {
      method: "DELETE",
      headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
    });
    adminAuthId = null;
  }
}

const ymd = (d) => d.toISOString().slice(0, 10);

try {
  await limpar();

  const criado = await (
    await fetch(`${S}/auth/v1/admin/users`, {
      method: "POST",
      headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" },
      body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASS, email_confirm: true }),
    })
  ).json();
  adminAuthId = criado.id;
  await db.query(
    `INSERT INTO "PlatformAdmin" (id, "authId", email, name, role, "isActive", "updatedAt") VALUES ($1, $2, $3, 'Admin de teste', 'ADMIN', true, now())`,
    [`zc_admin_${randomUUID().slice(0, 8)}`, adminAuthId, ADMIN_EMAIL],
  );
  const admin = (
    await (
      await fetch(`${S}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: { apikey: ANON, "Content-Type": "application/json" },
        body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASS }),
      })
    ).json()
  ).access_token;

  /* ------------------------------------------------------------ contactos */
  console.log("=== Um contacto é um clube ===");
  let r = await call(admin, "POST", "/api/platform/contactos", { name: NOME, sport: "Futebol", association: "AF Braga" });
  check("cria só com o nome do clube (201)", r.status === 201, `${r.status} ${JSON.stringify(r.body)?.slice(0, 200)}`);
  contactId = r.body?.id;
  check("com a associação e a modalidade", r.body?.association === "AF Braga" && r.body?.sport === "Futebol");
  check("sem pessoa, por contactar, nada marcado", r.body?.personName === null && r.body?.status === "NOVO" && !r.body?.emailedAt && !r.body?.calledAt);

  console.log("\n=== Email enviado e Ligámos ===");
  r = await call(admin, "PATCH", `/api/platform/contactos/${contactId}`, { emailed: true });
  check("marcar email guarda a data", Boolean(r.body?.emailedAt), JSON.stringify(r.body));
  check("e passa a à espera de resposta", r.body?.status === "CONTACTADO", r.body?.status);
  check("e fica no histórico", r.body?.touches?.some((t) => t.channel === "EMAIL"), JSON.stringify(r.body?.touches));
  r = await call(admin, "PATCH", `/api/platform/contactos/${contactId}`, { called: true });
  check("marcar a chamada guarda a data", Boolean(r.body?.calledAt));
  check("sem mexer no email", Boolean(r.body?.emailedAt));
  r = await call(admin, "PATCH", `/api/platform/contactos/${contactId}`, { emailed: false });
  check("desmarcar limpa a data", r.body?.emailedAt === null);
  check("e não apaga o histórico", r.body?.touches?.filter((t) => t.channel === "EMAIL").length === 1);

  console.log("\n=== A resposta ===");
  r = await call(admin, "PATCH", `/api/platform/contactos/${contactId}`, { status: "REUNIAO", replyNote: "Querem ver uma demo em outubro" });
  check("fica com a resposta e o que disseram", r.body?.status === "REUNIAO" && r.body?.replyNote === "Querem ver uma demo em outubro");
  const linha = r.body?.touches?.find((t) => t.status === "REUNIAO");
  check("e o histórico regista a mudança com o que disseram", linha?.note === "Querem ver uma demo em outubro", JSON.stringify(linha));
  r = await call(admin, "PATCH", `/api/platform/contactos/${contactId}`, { association: "" });
  check("associação vazia fica sem associação", r.body?.association === null);

  /* ---------------------------------------------------- mensalidades à mão */
  console.log("\n=== Mensalidade da plataforma, condições por assinar ===");
  const hoje = new Date();
  const inicio = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate() - 3));
  await db.query(
    `INSERT INTO "Academy" (id, slug, name, "shortName", status, "updatedAt") VALUES ($1, $2, 'ZC Teste Mensalidades', 'ZC', 'ACTIVE', now())`,
    [CLUBE.id, CLUBE.slug],
  );
  await db.query(
    `INSERT INTO "SubscriptionOrder" (id, "academyId", "planId", "planName", "billingPeriod", "listMonthlyCents",
       "amountCents", "startsOn", status, "updatedAt")
     VALUES ('zc_ordem', $1, (SELECT id FROM "Plan" LIMIT 1), 'Connect', 'MONTHLY', 1999, 1999, $2, 'PENDING', now())`,
    [CLUBE.id, ymd(inicio)],
  );

  r = await call(admin, "GET", `/api/platform/contas/clubes/${CLUBE.id}/mensalidades`);
  check("abre (200)", r.status === 200, `${r.status} ${JSON.stringify(r.body)?.slice(0, 200)}`);
  check("conta as condições por assinar", r.body?.condicoes?.assinadas === false && r.body?.condicoes?.amountCents === 1999);
  const periodos = r.body?.periodos ?? [];
  check("mostra o período a correr e o seguinte", periodos.length === 2, JSON.stringify(periodos.map((p) => p.chave)));
  const aCorrer = periodos.find((p) => p.chave === ymd(inicio));
  check("o período a correr começa no início do contrato", Boolean(aCorrer), JSON.stringify(periodos.map((p) => p.chave)));

  r = await call(admin, "POST", `/api/platform/contas/clubes/${CLUBE.id}/mensalidades`, { periodStart: aCorrer?.chave });
  check("dar como recebido (201)", r.status === 201, `${r.status} ${JSON.stringify(r.body)}`);
  const noticeId = r.body?.noticeId;
  const aviso = (await db.query(`SELECT "paidAt", "sentAt" FROM "SubscriptionNotice" WHERE id = $1`, [noticeId])).rows[0];
  check("cria o aviso já pago e sem email", aviso?.paidAt && !aviso?.sentAt, JSON.stringify(aviso));
  const ganho = (await db.query(`SELECT "amountCents", kind FROM "PlatformTransaction" WHERE "noticeId" = $1`, [noticeId])).rows[0];
  check("e o ganho nas Contas", ganho?.kind === "INCOME" && ganho.amountCents > 0, JSON.stringify(ganho));

  r = await call(admin, "GET", `/api/platform/contas/clubes/${CLUBE.id}/mensalidades`);
  const depois = r.body?.periodos?.find((p) => p.chave === aCorrer?.chave);
  check("a ficha mostra-o recebido", Boolean(depois?.paidAt) && depois?.noticeId === noticeId, JSON.stringify(depois));

  r = await call(admin, "DELETE", `/api/platform/contas/mensalidades/${noticeId}/pago`);
  check("desmarcar (200)", r.status === 200, `${r.status} ${JSON.stringify(r.body)}`);
  const resta = (await db.query(`SELECT count(*)::int n FROM "SubscriptionNotice" WHERE id = $1`, [noticeId])).rows[0].n;
  check("o aviso que ainda não saiu desaparece", resta === 0);
  const ganhoResta = (await db.query(`SELECT count(*)::int n FROM "PlatformTransaction" WHERE "academyId" = $1`, [CLUBE.id])).rows[0].n;
  check("e o ganho sai das Contas", ganhoResta === 0);

  r = await call(admin, "POST", `/api/platform/contas/clubes/${CLUBE.id}/mensalidades`, { periodStart: "2020-01-01" });
  check("um período fora do contrato é recusado (400)", r.status === 400, String(r.status));
} finally {
  await limpar().catch((err) => console.log("  (limpeza falhou: " + err.message + ")"));
  await db.end();
}

console.log(`\n${ok} OK, ${bad} FALHA`);
if (bad > 0) process.exitCode = 1;

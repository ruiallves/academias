#!/usr/bin/env node
/**
 * Lembretes de mensalidades vencidas.
 *
 * O que interessa: só a direção dispara (`billing:write`); vai só para os
 * encarregados pagadores das mensalidades **vencidas**; cria uma `Notification`
 * do tipo certo com o `chargeId` no payload; e não reenvia o mesmo lembrete no
 * mesmo dia — carregar duas vezes seguidas não duplica.
 *
 * Uso: node scripts/test-reminders.mjs
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
const PERIOD = "2099-01"; // no futuro, para nunca colidir com dados reais.

let ok = 0, bad = 0;
const check = (l, c, d = "") => { if (c) { ok++; console.log("  OK    " + l); } else { bad++; console.log("  FALHA " + l + (d ? " — " + d : "")); } };

const login = async (email) =>
  (await (await fetch(`${S}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: A, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "academia2026" }),
  })).json()).access_token;

const call = async (token, method, pathname, body) => {
  const r = await fetch(API + pathname, {
    method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "x-academy-slug": "life-club", ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};

const db = new pg.Client({ connectionString: env("MIGRATE_DATABASE_URL"), ssl: { rejectUnauthorized: false } });
await db.connect();

const cleanup = async () => {
  const ids = (await db.query(`SELECT id FROM "Charge" WHERE period = $1`, [PERIOD])).rows.map((r) => r.id);
  for (const id of ids) {
    await db.query(`DELETE FROM "Notification" WHERE payload->>'chargeId' = $1`, [id]);
  }
  await db.query(`DELETE FROM "Charge" WHERE period = $1`, [PERIOD]);
};
await cleanup();

// Duas mensalidades vencidas de teste, cada uma de um atleta diferente — para
// confirmar que os dois recebem, não só o primeiro.
const chargeMartim = "ZZ_ch_martim";
const chargeGustavo = "ZZ_ch_gustavo";
await db.query(
  `INSERT INTO "Charge" (id,"academyId","athleteId",period,"amountCents","dueDate",status,"updatedAt")
   VALUES ($1,'acd_lifeclub','ath_martim',$2,4000, now() - interval '10 days','OPEN', now())`,
  [chargeMartim, PERIOD],
);
await db.query(
  `INSERT INTO "Charge" (id,"academyId","athleteId",period,"amountCents","dueDate",status,"updatedAt")
   VALUES ($1,'acd_lifeclub','ath_gustavo',$2,4000, now() - interval '3 days','OPEN', now())`,
  [chargeGustavo, PERIOD],
);

const director = await login("direcao@lifeclub.pt");
const coach = await login("treinador@lifeclub.pt");
const parent = await login("familia@lifeclub.pt");

console.log("=== Permissão ===");
const coachSend = await call(coach, "POST", "/api/charges/reminders");
check("um treinador não envia lembretes (403)", coachSend.status === 403, `${coachSend.status}`);
const parentSend = await call(parent, "POST", "/api/charges/reminders");
check("um encarregado não envia lembretes (403)", parentSend.status === 403, `${parentSend.status}`);

console.log("\n=== Enviar ===");
const before = await call(director, "POST", "/api/charges/reminders");
check("a direção envia lembretes (200/201)", before.status === 200 || before.status === 201, JSON.stringify(before.body));
check("inclui as nossas duas mensalidades de teste no envio", before.body?.sent >= 2, `sent=${before.body?.sent}`);

const notifMartim = (await db.query(`SELECT n.id, n.type, n.title, n.body, u.email FROM "Notification" n JOIN "User" u ON u.id = n."userId" WHERE n.payload->>'chargeId' = $1`, [chargeMartim])).rows;
check("o encarregado de Martim recebeu uma notificação PAYMENT_DUE", notifMartim.length === 1 && notifMartim[0].type === "PAYMENT_DUE" && notifMartim[0].email === "familia@lifeclub.pt", JSON.stringify(notifMartim));
check("o texto é concreto — mês e nome do atleta", /Martim/.test(notifMartim[0]?.body ?? "") && /2099/.test(notifMartim[0]?.body ?? ""), notifMartim[0]?.body);

const notifGustavo = (await db.query(`SELECT n.id, u.email FROM "Notification" n JOIN "User" u ON u.id = n."userId" WHERE n.payload->>'chargeId' = $1`, [chargeGustavo])).rows;
check("o encarregado de Gustavo também recebeu", notifGustavo.length === 1 && notifGustavo[0].email === "familia2@lifeclub.pt", JSON.stringify(notifGustavo));

console.log("\n=== Não duplica no mesmo dia ===");
const again = await call(director, "POST", "/api/charges/reminders");
check("enviar outra vez responde bem (200/201)", again.status === 200 || again.status === 201, `${again.status}`);
const notifMartimAgain = (await db.query(`SELECT count(*)::int n FROM "Notification" WHERE payload->>'chargeId' = $1`, [chargeMartim])).rows[0].n;
check("continua a haver só uma notificação para a mesma mensalidade", notifMartimAgain === 1, `${notifMartimAgain}`);

console.log("\n=== Uma mensalidade paga não gera lembrete ===");
await db.query(`UPDATE "Charge" SET status = 'SETTLED' WHERE id = $1`, [chargeGustavo]);
await db.query(`DELETE FROM "Notification" WHERE payload->>'chargeId' = $1`, [chargeGustavo]);
await call(director, "POST", "/api/charges/reminders");
const notifGustavoAfterPaid = (await db.query(`SELECT count(*)::int n FROM "Notification" WHERE payload->>'chargeId' = $1`, [chargeGustavo])).rows[0].n;
check("uma mensalidade paga não recebe lembrete", notifGustavoAfterPaid === 0, `${notifGustavoAfterPaid}`);

console.log("\n=== Limpeza ===");
await cleanup();
await db.end();
console.log("  feito");

console.log(`\n${ok} passaram, ${bad} falharam`);
process.exit(bad === 0 ? 0 : 1);

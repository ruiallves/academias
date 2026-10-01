#!/usr/bin/env node
/**
 * Os pagamentos pela app só se ligam com o euPago do clube configurado.
 *
 * - um clube sem as chaves do seu canal não consegue ligar os pagamentos pela
 *   app (400, com a explicação); desligar dá sempre;
 * - o arranque da consola diz `eupagoConfigured`, e nunca manda as chaves;
 * - mexer na outra regra (a taxa) continua a dar.
 *
 * No Life Club, que fica como estava no fim. A API de teste tem de correr com
 * uma chave geral qualquer (`EUPAGO_API_KEY=teste`): sem chave geral o servidor
 * está em modo simulado e a regra não se aplica. Não se inicia pagamento nenhum.
 *
 * Uso: API_URL=http://localhost:3012 node scripts/test-pagamentos-so-com-eupago.mjs
 * Nunca contra a :3000 nem a :3001 (as do Rui).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const env = (k) => {
  const l = readFileSync(path.join(HERE, "..", ".env"), "utf8").split(/\r?\n/).find((x) => x.startsWith(k + "="));
  if (!l) throw new Error(`${k} não está em .env`);
  return l.slice(k.length + 1).trim().replace(/^"|"$/g, "");
};
const S = env("SUPABASE_URL").replace(/\/$/, "");
const A = env("SUPABASE_ANON_KEY");
const API = process.env.API_URL ?? "http://localhost:3012";
if (/:300[01]\b/.test(API)) throw new Error("Não corras isto contra a :3000 nem a :3001.");

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
    headers: { Authorization: `Bearer ${token}`, "x-academy-slug": "life-club", ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const texto = await r.text();
  let json = null; try { json = JSON.parse(texto); } catch { /* não é JSON */ }
  return { status: r.status, body: json, texto };
};

const db = new pg.Client({ connectionString: env("MIGRATE_DATABASE_URL"), ssl: { rejectUnauthorized: false } });
await db.connect();
const antes = (await db.query(`SELECT "paymentsEnabled", "feesOnPayer", "eupagoApiKey", "eupagoWebhookSecret" FROM "Academy" WHERE id = 'acd_lifeclub'`)).rows[0];
const repor = () => db.query(`UPDATE "Academy" SET "paymentsEnabled" = $1, "feesOnPayer" = $2 WHERE id = 'acd_lifeclub'`, [antes.paymentsEnabled, antes.feesOnPayer]);

try {
  if (antes.eupagoApiKey || antes.eupagoWebhookSecret) throw new Error("O Life Club tem chaves euPago: este teste conta com ele sem canal.");
  const presidente = await login("presidente@lifeclub.pt");

  const boot = await call(presidente, "GET", "/api/bootstrap");
  check("o arranque diz que o euPago não está configurado", boot.status === 200 && boot.body?.academy?.eupagoConfigured === false, `${boot.status} ${boot.body?.academy?.eupagoConfigured}`);
  check("e não manda chave nenhuma", !/eupagoApiKey|eupagoWebhookSecret/.test(boot.texto));

  const off = await call(presidente, "PATCH", "/api/pagamentos/regras", { paymentsEnabled: false });
  check("desligar dá sempre", off.status === 200 && off.body?.paymentsEnabled === false, `${off.status} ${off.texto.slice(0, 120)}`);

  const on = await call(presidente, "PATCH", "/api/pagamentos/regras", { paymentsEnabled: true });
  const naBase = (await db.query(`SELECT "paymentsEnabled" FROM "Academy" WHERE id = 'acd_lifeclub'`)).rows[0].paymentsEnabled;
  check("ligar sem euPago é recusado (400), com a explicação", on.status === 400 && /euPago do clube estar configurado/.test(on.body?.message ?? ""), `${on.status} ${on.texto.slice(0, 160)}`);
  check("e na base continua desligado", naBase === false);

  const taxa = await call(presidente, "PATCH", "/api/pagamentos/regras", { feesOnPayer: !antes.feesOnPayer });
  check("a outra regra (a taxa) continua a gravar-se", taxa.status === 200 && taxa.body?.feesOnPayer === !antes.feesOnPayer, `${taxa.status}`);
} finally {
  await repor();
  await db.end();
}
console.log(`\n${ok} OK, ${bad} falhas`);
process.exit(bad ? 1 : 0);

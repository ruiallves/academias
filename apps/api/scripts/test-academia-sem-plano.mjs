#!/usr/bin/env node
/**
 * Criar uma academia **sem plano**.
 *
 * A regra do produto: nem todos os clubes sabem o que querem à partida. A maior
 * parte entra em período experimental e decide o plano no fim dele, com a coisa
 * já a funcionar. Por isso o plano é opcional na criação.
 *
 * O que isto testa, e o bug que apanha: o serviço escolhia **o plano mais
 * barato** quando `planId` não vinha, o que significava que não havia forma
 * nenhuma de criar um clube sem plano — nascia sempre com uma subscrição que
 * ninguém tinha escolhido, e a plataforma mostrava um plano que o cliente nunca
 * viu.
 *
 * Uso: node scripts/test-academia-sem-plano.mjs
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
const SR = env("SUPABASE_SERVICE_ROLE_KEY");
const API = "http://localhost:3000";

let ok = 0, bad = 0;
const check = (l, c, d = "") => {
  if (c) { ok++; console.log("  OK    " + l); }
  else { bad++; console.log("  FALHA " + l + (d ? " — " + d : "")); }
};

const db = new pg.Client({ connectionString: env("MIGRATE_DATABASE_URL"), ssl: { rejectUnauthorized: false } });
await db.connect();

const EMAIL = "zz.admin.plano@exemplo.pt";
const SLUGS = ["zz-sem-plano", "zz-com-plano"];

const adminApi = (p, init) =>
  fetch(`${S}/auth/v1/admin/users${p}`, {
    ...init,
    headers: { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });

async function limpar() {
  for (const slug of SLUGS) {
    const a = (await db.query(`SELECT id FROM "Academy" WHERE slug = $1`, [slug])).rows[0];
    if (!a) continue;
    // As dependências que não têm cascade a partir da academia.
    await db.query(`DELETE FROM "Subscription" WHERE "academyId" = $1`, [a.id]);
    await db.query(`DELETE FROM "Academy" WHERE id = $1`, [a.id]);
  }
  await db.query(`DELETE FROM "PlatformAdmin" WHERE email = $1`, [EMAIL]);
  const lista = await (await adminApi(`?page=1&per_page=200`)).json();
  const antigo = (lista.users ?? []).find((u) => u.email === EMAIL);
  if (antigo) await adminApi(`/${antigo.id}`, { method: "DELETE" });
}

await limpar();

/*
 * Um administrador de plataforma temporário.
 *
 * A única conta real é a do dono, cuja palavra-passe não está aqui. Cria-se uma
 * com a palavra-passe de demonstração, usa-se, e apaga-se no fim — conta do
 * Supabase incluída.
 */
const criado = await (
  await adminApi("", { method: "POST", body: JSON.stringify({ email: EMAIL, password: "academia2026", email_confirm: true }) })
).json();
if (!criado.id) throw new Error("supabase: " + JSON.stringify(criado));

await db.query(
  `INSERT INTO "PlatformAdmin" (id, "authId", email, name, role, "isActive", "createdAt", "updatedAt")
   VALUES ('zz_admin_plano', $1, $2, 'ZZ Admin Plano', 'OWNER', true, NOW(), NOW())`,
  [criado.id, EMAIL],
);

const token = (await (await fetch(`${S}/auth/v1/token?grant_type=password`, {
  method: "POST", headers: { apikey: A, "Content-Type": "application/json" },
  body: JSON.stringify({ email: EMAIL, password: "academia2026" }),
})).json()).access_token;

const call = async (method, p, body) => {
  const r = await fetch(API + p, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};

/* -------------------------------------------------------------------------- */

console.log("=== Criar sem plano ===");

const sem = await call("POST", "/api/platform/academies", {
  name: "ZZ Clube Sem Plano",
  slug: "zz-sem-plano",
  directorName: "ZZ Director",
  directorEmail: "zz.dir1@exemplo.pt",
});
check("a plataforma cria sem indicar plano", sem.status === 201 || sem.status === 200, JSON.stringify(sem.body).slice(0, 140));

const criada = (await db.query(
  `SELECT id, status, "trialEndsAt" FROM "Academy" WHERE slug = 'zz-sem-plano'`,
)).rows[0];
check("a academia existe", Boolean(criada), "");

/*
 * O ponto todo: **nenhuma** subscrição. Antes nascia uma, com o plano mais
 * barato, sem ninguém a ter escolhido.
 */
const subs = (await db.query(`SELECT count(*)::int n FROM "Subscription" WHERE "academyId" = $1`, [criada.id])).rows[0].n;
check("e nasce sem subscrição nenhuma", subs === 0, `${subs}`);

/* Mas com período experimental — é isso que ela vai ver no menu lateral. */
check("com período experimental", criada.trialEndsAt !== null, "");
const dias = Math.round((new Date(criada.trialEndsAt) - Date.now()) / 86_400_000);
check("de 30 dias por omissão", dias >= 29 && dias <= 30, `${dias}`);
check("e em SETUP", criada.status === "SETUP", criada.status);

console.log("\n=== A plataforma lê-a sem rebentar ===");
/*
 * A listagem faz `LEFT JOIN` ao plano e `COALESCE` ao MRR. Vale a pena
 * confirmá-lo a sério: uma academia sem plano é agora um caso normal, não uma
 * anomalia, e a lista é o primeiro sítio onde apareceria partida.
 */
const lista = await call("GET", "/api/platform/academies");
check("a lista responde", lista.status === 200, `${lista.status}`);
const naLista = (lista.body ?? []).find((x) => x.slug === "zz-sem-plano");
check("e traz a academia nova", Boolean(naLista), "");
check("com plano a null", naLista?.plan === null, JSON.stringify(naLista?.plan));
check("e MRR a zero — não gera receita", naLista?.mrrCents === 0, `${naLista?.mrrCents}`);
check("e sem estado de subscrição", naLista?.subscriptionStatus === null, JSON.stringify(naLista?.subscriptionStatus));

console.log("\n=== Com plano continua a funcionar ===");
const plano = (await db.query(`SELECT id, name FROM "Plan" WHERE "isActive" = true ORDER BY "amountCents" LIMIT 1`)).rows[0];
check("há um plano activo para o teste", Boolean(plano), "");

const com = await call("POST", "/api/platform/academies", {
  name: "ZZ Clube Com Plano",
  slug: "zz-com-plano",
  directorName: "ZZ Director",
  directorEmail: "zz.dir2@exemplo.pt",
  planId: plano.id,
});
check("cria com plano indicado", com.status === 201 || com.status === 200, `${com.status}`);

const comId = (await db.query(`SELECT id FROM "Academy" WHERE slug = 'zz-com-plano'`)).rows[0].id;
const subCom = (await db.query(
  `SELECT s.status, p.name FROM "Subscription" s JOIN "Plan" p ON p.id = s."planId" WHERE s."academyId" = $1`,
  [comId],
)).rows[0];
check("e nasce com subscrição", Boolean(subCom), "");
check("no plano escolhido", subCom?.name === plano.name, `${subCom?.name}`);
check("em TRIALING", subCom?.status === "TRIALING", subCom?.status);

console.log("\n=== Um plano que não existe não trava a criação ===");
/*
 * Recusar a criação de um clube por causa de um id de plano inválido é pior do
 * que abri-lo sem ele: o clube quer entrar, e o plano corrige-se depois.
 */
await db.query(`DELETE FROM "Academy" WHERE slug = 'zz-sem-plano'`);
const inventado = await call("POST", "/api/platform/academies", {
  name: "ZZ Clube Sem Plano",
  slug: "zz-sem-plano",
  directorName: "ZZ Director",
  directorEmail: "zz.dir3@exemplo.pt",
  planId: "plano_que_nao_existe",
});
check("cria à mesma", inventado.status === 201 || inventado.status === 200, `${inventado.status}`);
const semSub = (await db.query(
  `SELECT count(*)::int n FROM "Subscription" WHERE "academyId" = (SELECT id FROM "Academy" WHERE slug = 'zz-sem-plano')`,
)).rows[0].n;
check("e sem subscrição — não inventa um plano", semSub === 0, `${semSub}`);

console.log("\n=== Limpeza ===");
await limpar();
await db.end();
console.log("  feito");

console.log(`\n${ok} passaram, ${bad} falharam`);
process.exit(bad === 0 ? 0 : 1);

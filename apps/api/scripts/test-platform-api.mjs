#!/usr/bin/env node
/**
 * O painel da plataforma, contra o servidor a correr.
 *
 * A parte que mais interessa está nas primeiras secções: a porta da plataforma
 * fechada a quem é de uma academia, e a porta das academias fechada a quem é da
 * plataforma. As duas direcções, porque uma separação só verificada num sentido
 * não é uma separação.
 *
 * Pressupõe `node dist/main.js`, `npm run seed` e `node prisma/seed-platform.mjs`.
 *
 * Uso: node scripts/test-platform-api.mjs
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

const S = env("SUPABASE_URL").replace(/\/$/, ""), A = env("SUPABASE_ANON_KEY"), API = "http://localhost:3000";
let ok = 0, bad = 0;
const check = (l, c, d = "") => { if (c) { ok++; console.log("  OK    " + l); } else { bad++; console.log("  FALHA " + l + (d ? " — " + d : "")); } };
const login = async (e, p) => (await (await fetch(`${S}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: A, "Content-Type": "application/json" }, body: JSON.stringify({ email: e, password: p }) })).json()).access_token;
const get = async (t, p) => { const r = await fetch(API + p, { headers: t ? { Authorization: `Bearer ${t}` } : {} }); return { status: r.status, body: await r.json().catch(() => null) }; };

const admin = await login("admin@academias.pt", "plataforma2026");
const director = await login("direcao@lifeclub.pt", "academia2026");

console.log("=== A porta da plataforma ===");
check("sem sessão é 401", (await get(null, "/api/platform/overview")).status === 401);
for (const rota of ["/api/platform/overview", "/api/platform/academies", "/api/platform/audit", "/api/platform/me"]) {
  const r = await get(director, rota);
  check(`um diretor de academia leva 403 em ${rota.replace("/api/platform", "")}`, r.status === 403, `deu ${r.status}`);
}

console.log("\n=== E a porta das academias, ao contrário ===");
const inConsole = await fetch(`${API}/api/bootstrap`, { headers: { Authorization: `Bearer ${admin}`, "x-academy-slug": "life-club" } });
check("um admin da plataforma não entra numa consola", inConsole.status === 403, `deu ${inConsole.status}`);

console.log("\n=== Quem sou ===");
const me = (await get(admin, "/api/platform/me")).body;
check("o painel reconhece-me como OWNER", me?.role === "OWNER", JSON.stringify(me).slice(0, 80));
check("e diz que ainda não tenho MFA", me?.mfaEnabled === false);

console.log("\n=== Overview ===");
const ov = (await get(admin, "/api/platform/overview")).body;
check("conta academias", ov.academies.total >= 1, `${ov.academies.total}`);
check("MRR reflecte a subscrição activa", ov.revenue.mrrCents === 6900, `${ov.revenue.mrrCents}`);
check("ARR são doze meses de MRR", ov.revenue.arrCents === ov.revenue.mrrCents * 12);
check("conta pessoas", ov.people.athletes === 9 && ov.people.guardians >= 2);
check("mede utilização", ov.usage === null || (ov.usage >= 0 && ov.usage <= 100), `${ov.usage}`);
check("traz alertas", Array.isArray(ov.alerts));
check("e cada alerta aponta a uma academia", ov.alerts.every((x) => x.academyId && x.title && x.detail));

console.log("\n=== Academias ===");
const list = (await get(admin, "/api/platform/academies")).body;
check("lista com progresso de onboarding", list[0]?.onboarding?.percent > 0, `${list[0]?.onboarding?.percent}%`);
check("sem nomes de atletas", !JSON.stringify(list).includes("Martim"));
check("sem contactos de ninguém", !JSON.stringify(list).includes("@lifeclub.pt"));

console.log("\n=== Séries para os gráficos ===");
check("seis pontos quando se pedem seis", (await get(admin, "/api/platform/series?months=6")).body.length === 6);

console.log("\n=== Criar academia e convidar o diretor ===");
const stamp = Date.now().toString(36);
const res = await fetch(`${API}/api/platform/academies`, {
  method: "POST", headers: { Authorization: `Bearer ${admin}`, "Content-Type": "application/json" },
  body: JSON.stringify({ name: `Clube de Teste ${stamp}`, directorName: "Ana Diretora", directorEmail: `dir-${stamp}@exemplo.pt`, planId: "plan_arranque" }),
});
const nova = await res.json();
check("cria a academia", res.status === 201 || res.status === 200, JSON.stringify(nova).slice(0, 120));
check("com endereço gerado do nome", nova.academy?.slug?.startsWith("clube-de-teste"), nova.academy?.slug);
check("devolve o link do convite", typeof nova.inviteLink === "string" && nova.inviteLink.includes("/convite/"));
check("e o trial a contar", Boolean(nova.trialEndsAt));

// O convite tem de funcionar mesmo — é o mecanismo que já existia, reutilizado.
const page = await fetch(nova.inviteLink);
const html = await page.text();
check("o link abre a página de resgate", page.status === 200, `deu ${page.status}`);
check("dirigida ao diretor certo", html.includes("Ana Diretora"));

console.log("\n=== Quem pode criar clientes ===");
// SUPPORT lê e acompanha; não cria clientes nem mexe em faturação.
const db = new pg.Client({ connectionString: env("MIGRATE_DATABASE_URL"), ssl: { rejectUnauthorized: false } });
await db.connect();
await db.query(`UPDATE "PlatformAdmin" SET role='SUPPORT' WHERE email='admin@academias.pt'`);
const asSupport = await fetch(`${API}/api/platform/academies`, {
  method: "POST", headers: { Authorization: `Bearer ${admin}`, "Content-Type": "application/json" },
  body: JSON.stringify({ name: "Nao Devia Existir", directorName: "X", directorEmail: "x@exemplo.pt" }),
});
check("SUPPORT não cria academias", asSupport.status === 403, `deu ${asSupport.status}`);
check("mas continua a ler o overview", (await get(admin, "/api/platform/overview")).status === 200);
await db.query(`UPDATE "PlatformAdmin" SET role='OWNER' WHERE email='admin@academias.pt'`);

console.log("\n=== Auditoria ===");
const audit = (await get(admin, "/api/platform/audit")).body;
const entry = audit.find((x) => x.targetId === nova.academy?.id);
check("a criação ficou registada", Boolean(entry), `${audit.length} entradas`);
check("com quem a fez", entry?.admin?.email === "admin@academias.pt");
check("e com o quê", entry?.action === "academy.create");

console.log("\n=== Limpeza ===");
await db.query(`DELETE FROM "Academy" WHERE slug LIKE 'clube-de-teste-%'`);
await db.end();
console.log("  feito");

console.log(`\n${ok} passaram, ${bad} falharam`);
process.exit(bad === 0 ? 0 : 1);

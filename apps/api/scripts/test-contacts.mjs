#!/usr/bin/env node
/**
 * Contactos, contra o servidor a correr.
 *
 * Duas coisas interessam aqui, e são as duas que se partem em silêncio:
 *
 *  1. **A fronteira.** Um diretor de academia não vê esta lista, e o papel
 *     `academia_app` — o papel com que o servidor serve os pedidos de academia —
 *     não consegue sequer ler a tabela. A segunda parte verifica-se no Postgres,
 *     não na API: é a diferença entre um `if` e uma garantia.
 *  2. **O feed do Google.** Um token errado não devolve nada; o certo devolve um
 *     `.ics` com o seguimento marcado lá dentro. E rodar o token invalida o antigo.
 *
 * Pressupõe `node dist/main.js`, `npm run seed` e `npm run seed:platform`.
 *
 * Uso: node scripts/test-contacts.mjs
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

const admin = await login("admin@academias.pt", "plataforma2026");
const director = await login("direcao@lifeclub.pt", "academia2026");

const call = async (token, method, p, body) => {
  const r = await fetch(API + p, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  return { status: r.status, body: text.startsWith("{") || text.startsWith("[") ? JSON.parse(text) : text };
};

console.log("=== A porta ===");
check("sem sessão é 401", (await call(null, "GET", "/api/platform/contactos")).status === 401);
check("um diretor de academia leva 403", (await call(director, "GET", "/api/platform/contactos")).status === 403);

console.log("\n=== Criar ===");
const stamp = Date.now().toString(36);
const novo = await call(admin, "POST", "/api/platform/contactos", {
  name: `Teste ${stamp}`,
  phone: "912 345 678",
  club: "Clube de Teste",
  role: "Diretor",
  status: "NOVO",
});
check("cria o contacto", novo.status === 201 || novo.status === 200, JSON.stringify(novo.body).slice(0, 120));
check("com as quatro colunas da lista", novo.body.name && novo.body.phone && novo.body.club && novo.body.status === "NOVO");
check("e com dono — quem o criou", novo.body.owner?.name?.length > 0);
const id = novo.body.id;

console.log("\n=== Registar uma conversa ===");
const amanha = new Date(Date.now() + 86_400_000);
const touched = await call(admin, "POST", `/api/platform/contactos/${id}/interacoes`, {
  channel: "CHAMADA",
  note: "Interessado. Volto a ligar.",
  status: "CONTACTADO",
  nextActionAt: amanha.toISOString(),
});
check("regista a chamada", touched.status === 201 || touched.status === 200);
check("muda o estado", touched.body.status === "CONTACTADO", touched.body.status);
check("marca a data do último contacto", Boolean(touched.body.lastContactAt));
check("guarda o próximo passo", Boolean(touched.body.nextActionAt));
check("e fica no histórico", touched.body.touches?.length === 1 && touched.body.touches[0].note.includes("Interessado"));

// Uma chamada antiga lançada depois não pode fazer o contacto parecer mais fresco.
await call(admin, "POST", `/api/platform/contactos/${id}/interacoes`, {
  channel: "EMAIL",
  happenedAt: new Date(Date.now() - 30 * 86_400_000).toISOString(),
});
const depois = (await call(admin, "GET", `/api/platform/contactos/${id}`)).body;
check("o último contacto não recua com um registo antigo", new Date(depois.lastContactAt).getTime() > Date.now() - 86_400_000, depois.lastContactAt);
check("mas o registo antigo entra no histórico", depois.touches.length === 2);

console.log("\n=== Alterar ===");
const patched = await call(admin, "PATCH", `/api/platform/contactos/${id}`, { status: "REUNIAO", phone: "" });
check("muda o estado sem repetir o nome", patched.body.status === "REUNIAO");
check("e um campo esvaziado fica mesmo vazio", patched.body.phone === null, `${patched.body.phone}`);

console.log("\n=== O feed do Google Calendar ===");
await call(admin, "PATCH", `/api/platform/contactos/${id}`, { phone: "912 345 678", status: "CONTACTADO" });
const feed = await call(admin, "POST", "/api/platform/contactos/agenda", {});
check("devolve um endereço .ics", feed.body.url?.endsWith(".ics"), feed.body.url);
check("e diz se o Google lhe chega", typeof feed.body.reachable === "boolean");

const ics = await call(null, "GET", new URL(feed.body.url).pathname);
check("o feed abre sem sessão — é o token que autentica", ics.status === 200, `deu ${ics.status}`);
check("é um calendário", ics.body.startsWith("BEGIN:VCALENDAR"));
check("com o seguimento lá dentro", ics.body.includes(`contacto-${id}@academias.pt`));
check("e o nome de quem se vai ligar", ics.body.includes(`Teste ${stamp}`));

check("um token inventado não devolve nada", (await call(null, "GET", "/api/agenda/contactos/naoexisteestetoken1234.ics")).status === 404);

const rodado = await call(admin, "POST", "/api/platform/contactos/agenda", { rotate: true });
check("rodar dá um endereço novo", rodado.body.url !== feed.body.url);
check("e o antigo deixa de servir", (await call(null, "GET", new URL(feed.body.url).pathname)).status === 404);

console.log("\n=== Um contacto fechado não gera trabalho ===");
await call(admin, "PATCH", `/api/platform/contactos/${id}`, { status: "PERDIDO" });
const semPerdidos = await call(null, "GET", new URL(rodado.body.url).pathname);
check("perdidos ficam fora do calendário", !semPerdidos.body.includes(`contacto-${id}@academias.pt`));

console.log("\n=== E o papel das academias não lê a tabela ===");
const db = new pg.Client({ connectionString: env("MIGRATE_DATABASE_URL"), ssl: { rejectUnauthorized: false } });
await db.connect();
await db.query("BEGIN");
await db.query("SET LOCAL ROLE academia_app");
let recusado = false;
try {
  await db.query('SELECT * FROM "Contact" LIMIT 1');
} catch (e) {
  recusado = /permission denied/i.test(e.message);
}
await db.query("ROLLBACK");
check("o Postgres recusa `Contact` a academia_app", recusado);

await db.query("BEGIN");
await db.query("SET LOCAL ROLE academia_app");
let recusadoTouch = false;
try {
  await db.query('SELECT * FROM "ContactTouch" LIMIT 1');
} catch (e) {
  recusadoTouch = /permission denied/i.test(e.message);
}
await db.query("ROLLBACK");
check("e recusa `ContactTouch` também", recusadoTouch);

console.log("\n=== Limpeza ===");
check("apagar devolve ok", (await call(admin, "DELETE", `/api/platform/contactos/${id}`)).status === 200);
check("e o histórico vai com ele", (await db.query('SELECT count(*)::int AS n FROM "ContactTouch" WHERE "contactId" = $1', [id])).rows[0].n === 0);
await db.end();

console.log(`\n${ok} passaram, ${bad} falharam`);
process.exit(bad === 0 ? 0 : 1);

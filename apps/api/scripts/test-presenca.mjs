#!/usr/bin/env node
/**
 * Quem está online, por clube.
 *
 * A plataforma passou a mostrar quantas pessoas cada academia tem a usar o
 * produto **neste momento**. O que aqui se mede é a cadeia toda:
 *
 *  - qualquer pedido autenticado marca presença, e o heartbeat mantém-na viva;
 *  - a contagem é **por academia** e não se mistura entre clubes;
 *  - staff e famílias contam separados;
 *  - a mesma pessoa em dois separadores é uma pessoa, não duas;
 *  - o heartbeat exige sessão — não é uma porta aberta.
 *
 * O que **não** se testa aqui é a expiração ao fim da janela: são dois minutos,
 * e um teste que dorme dois minutos é um teste que ninguém corre. A lógica está
 * isolada em `porAcademia()` e é uma comparação de datas.
 *
 * Uso: node scripts/test-presenca.mjs
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

const login = async (email) =>
  (await (await fetch(`${S}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: A, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "academia2026" }),
  })).json()).access_token;

const call = async (token, method, pathname, slug = "life-club") => {
  const r = await fetch(API + pathname, {
    method,
    headers: { Authorization: `Bearer ${token}`, "x-academy-slug": slug },
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};

/** A lista da plataforma, que é onde o número aparece. */
async function academias(tokenPlataforma) {
  const r = await fetch(`${API}/api/platform/academies`, {
    headers: { Authorization: `Bearer ${tokenPlataforma}` },
  });
  return r.json();
}

const onlineDe = (lista, slug) => lista.find((a) => a.slug === slug)?.online ?? null;

/* -------------------------------------------------------------------------- */

/*
 * Um administrador de plataforma temporário.
 *
 * A conta real é a do dono e a palavra-passe não está aqui. Cria-se uma, usa-se,
 * e apaga-se no fim — conta do Supabase incluída. O mesmo padrão de
 * `test-academia-sem-plano.mjs`.
 */
const EMAIL = "zz.admin.presenca@exemplo.pt";
const db = new pg.Client({ connectionString: env("MIGRATE_DATABASE_URL"), ssl: { rejectUnauthorized: false } });
await db.connect();

const adminApi = (p, init) =>
  fetch(`${S}/auth/v1/admin/users${p}`, {
    ...init,
    headers: { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });

async function limpar() {
  await db.query(`DELETE FROM "PlatformAdmin" WHERE email = $1`, [EMAIL]);
  const lista = await (await adminApi(`?page=1&per_page=200`)).json();
  const antigo = (lista.users ?? []).find((u) => u.email === EMAIL);
  if (antigo) await adminApi(`/${antigo.id}`, { method: "DELETE" });
}

await limpar();

const criado = await (
  await adminApi("", { method: "POST", body: JSON.stringify({ email: EMAIL, password: "academia2026", email_confirm: true }) })
).json();
if (!criado.id) throw new Error("supabase: " + JSON.stringify(criado));

await db.query(
  `INSERT INTO "PlatformAdmin" (id, "authId", email, name, role, "isActive", "createdAt", "updatedAt")
   VALUES ('zz_admin_presenca', $1, $2, 'ZZ Admin Presenca', 'OWNER', true, NOW(), NOW())`,
  [criado.id, EMAIL],
);

const plataforma = await login(EMAIL);

console.log("=== O heartbeat exige sessão ===");
const semToken = await fetch(`${API}/api/presence`, { method: "POST", headers: { "x-academy-slug": "life-club" } });
check("sem token, 401", semToken.status === 401, `${semToken.status}`);

console.log("\n=== Um pedido qualquer já marca presença ===");
const direcao = await login("direcao@lifeclub.pt");
await call(direcao, "GET", "/api/bootstrap");
let lista = await academias(plataforma);
let life = onlineDe(lista, "life-club");
check("a lista traz o campo online", life !== null, JSON.stringify(lista?.[0] ?? null).slice(0, 80));
check("a direção conta", life.total >= 1, JSON.stringify(life));
check("e conta como staff", life.staff >= 1, JSON.stringify(life));

console.log("\n=== O heartbeat mantém-na viva ===");
const bate = await fetch(`${API}/api/presence`, {
  method: "POST",
  headers: { Authorization: `Bearer ${direcao}`, "x-academy-slug": "life-club" },
});
check("responde 204 e sem corpo", bate.status === 204, `${bate.status}`);
check("mesmo sem tocar na base de dados", (await bate.text()) === "", "");

console.log("\n=== Dois separadores da mesma pessoa são uma pessoa ===");
const antes = onlineDe(await academias(plataforma), "life-club").total;
// Uma sessão nova do mesmo utilizador é o mesmo `membershipId`.
const direcaoOutraAba = await login("direcao@lifeclub.pt");
await call(direcaoOutraAba, "GET", "/api/bootstrap");
const depois = onlineDe(await academias(plataforma), "life-club").total;
check("o total não sobe", depois === antes, `${antes} → ${depois}`);

console.log("\n=== As famílias contam do outro lado ===");
const pai = await login("familia@lifeclub.pt");
await call(pai, "GET", "/api/bootstrap");
life = onlineDe(await academias(plataforma), "life-club");
check("a família entrou na conta", life.family >= 1, JSON.stringify(life));
check("e o total é a soma dos dois lados", life.total === life.staff + life.family, JSON.stringify(life));

console.log("\n=== Não se mistura entre clubes ===");
/*
 * A parte que interessa a sério: o número é *por clube*. Uma academia onde
 * ninguém entrou tem de aparecer a zero enquanto a outra tem gente lá dentro.
 */
const outras = (await academias(plataforma)).filter((a) => a.slug !== "life-club");
check("há outra academia para comparar", outras.length > 0, "");
const semNinguem = outras.filter((a) => a.online.total === 0);
check(
  "as academias sem ninguém ficam a zero",
  semNinguem.length === outras.length,
  outras.map((a) => `${a.slug}=${a.online.total}`).join(" "),
);

console.log("\n=== A forma do que a plataforma recebe ===");
const qualquer = (await academias(plataforma))[0];
check("tem total, staff e family", ["total", "staff", "family"].every((k) => typeof qualquer.online[k] === "number"), JSON.stringify(qualquer.online));

console.log("\n=== Limpeza ===");
await limpar();
await db.end();
console.log("  feito");

console.log(`\n${ok} passaram, ${bad} falharam`);
process.exit(bad === 0 ? 0 : 1);

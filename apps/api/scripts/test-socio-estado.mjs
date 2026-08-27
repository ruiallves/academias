#!/usr/bin/env node
/**
 * O estado de um sócio, e o apagar.
 *
 * A ficha do sócio tinha dois botões que trocavam de lugar — "Suspender" quando
 * activo, "Reactivar" quando não. Faltavam duas coisas que a base já suportava:
 * **cancelar** (o estado existia e não havia caminho para lá chegar) e **apagar**
 * (a inscrição pública produz duplicados e não havia como os tirar do livro).
 *
 * O que aqui se mede não é o menu — é a regra por baixo dele:
 *
 *  - os três estados chegam todos ao servidor;
 *  - passar a activo pela primeira vez **atribui** o número de sócio;
 *  - suspender e cancelar **guardam** esse número;
 *  - apagar só funciona em quem nunca teve número, e a recusa diz porquê;
 *  - quem não tem `member:write` não muda nem apaga nada.
 *
 * Uso: node scripts/test-socio-estado.mjs
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

const db = new pg.Client({ connectionString: env("MIGRATE_DATABASE_URL"), ssl: { rejectUnauthorized: false } });
await db.connect();

const limpar = () => db.query(`DELETE FROM "Member" WHERE name LIKE 'ZZ Socio%'`);
await limpar();

const academia = (await db.query(`SELECT id FROM "Academy" WHERE slug = 'life-club'`)).rows[0].id;

/** Um sócio por aprovar, como o site os cria: sem número. */
async function semear(nome, taxId) {
  const r = await db.query(
    `INSERT INTO "Member" (id, "academyId", name, email, birthdate, address, "postalCode", city,
                           phone, "documentNumber", "taxId", status, source, "createdAt", "updatedAt")
     VALUES (gen_random_uuid()::text, $1, $2, $3, '1990-01-01', 'Rua ZZ 1', '4000-000', 'Porto',
             '910000000', '00000000', $4, 'PENDING', 'site', NOW(), NOW())
     RETURNING id`,
    [academia, nome, `${taxId}@exemplo.pt`, taxId],
  );
  return r.rows[0].id;
}

const estado = async (id) =>
  (await db.query(`SELECT status, number FROM "Member" WHERE id = $1`, [id])).rows[0] ?? null;

const director = await login("direcao@lifeclub.pt");
const coach = await login("treinador@lifeclub.pt");

/* -------------------------------------------------------------------------- */

console.log("=== Aprovar atribui o número ===");
const a = await semear("ZZ Socio Um", "299000001");
check("nasce por aprovar e sem número", (await estado(a)).number === null, "");

const aprovado = await call(director, "PATCH", `/api/members/${a}`, { status: "ACTIVE" });
check("a direção põe-no activo", aprovado.status === 200, `${aprovado.status}`);
const depois = await estado(a);
check("ficou activo", depois.status === "ACTIVE", depois.status);
check("e recebeu um número", depois.number !== null, `${depois.number}`);

console.log("\n=== Suspender e cancelar guardam o número ===");
/*
 * É a diferença entre os dois e o apagar. Quem foi sócio não deixa de o ter sido:
 * o número é a prova de que passou pelo livro, e sai das listas sem sair de lá.
 */
await call(director, "PATCH", `/api/members/${a}`, { status: "SUSPENDED" });
let s = await estado(a);
check("suspenso", s.status === "SUSPENDED", s.status);
check("com o número intacto", s.number === depois.number, `${s.number}`);

await call(director, "PATCH", `/api/members/${a}`, { status: "CANCELLED" });
s = await estado(a);
check("cancelado — o estado que não tinha caminho na consola", s.status === "CANCELLED", s.status);
check("com o número intacto", s.number === depois.number, `${s.number}`);

await call(director, "PATCH", `/api/members/${a}`, { status: "ACTIVE" });
s = await estado(a);
check("volta a activo", s.status === "ACTIVE", s.status);
check("e não lhe dão um número novo", s.number === depois.number, `${s.number}`);

console.log("\n=== Apagar: só quem nunca teve número ===");
const recusa = await call(director, "DELETE", `/api/members/${a}`);
check("recusa apagar um sócio numerado (409)", recusa.status === 409, `${recusa.status}`);
check("e diz o número na explicação", String(recusa.body?.message ?? "").includes(String(depois.number)), String(recusa.body?.message).slice(0, 90));
check("e manda cancelar em vez disso", String(recusa.body?.message ?? "").includes("cancela"), "");
check("o sócio continua lá", (await estado(a)) !== null, "");

const b = await semear("ZZ Socio Dois", "299000002");
const apagado = await call(director, "DELETE", `/api/members/${b}`);
check("apaga uma inscrição que nunca foi aprovada", apagado.status === 200, `${apagado.status}`);
check("e desapareceu mesmo", (await estado(b)) === null, "");

console.log("\n=== Sem member:write não se mexe ===");
const c = await semear("ZZ Socio Tres", "299000003");
const porTreinador = await call(coach, "PATCH", `/api/members/${c}`, { status: "ACTIVE" });
check("um treinador não muda o estado (403)", porTreinador.status === 403, `${porTreinador.status}`);
const apagaTreinador = await call(coach, "DELETE", `/api/members/${c}`);
check("nem apaga (403)", apagaTreinador.status === 403, `${apagaTreinador.status}`);
check("e o sócio ficou como estava", (await estado(c))?.status === "PENDING", "");

console.log("\n=== Um sócio que não existe ===");
const fantasma = await call(director, "DELETE", `/api/members/nao_existe`);
check("apagar o que não há dá 404", fantasma.status === 404, `${fantasma.status}`);

console.log("\n=== Limpeza ===");
await limpar();
await db.end();
console.log("  feito");

console.log(`\n${ok} passaram, ${bad} falharam`);
process.exit(bad === 0 ? 0 : 1);

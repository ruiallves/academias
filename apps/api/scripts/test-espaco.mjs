#!/usr/bin/env node
/**
 * O espaço de ficheiros de cada clube: medir, mostrar e travar.
 *
 * O que interessa:
 *  - `GET /api/espaco` devolve o usado, o limite (5 GB por omissão) e as
 *    categorias, e bate certo com o que a função mede;
 *  - uma família não o lê;
 *  - um clube no limite não recebe autorização para carregar uma fotografia, e
 *    a mensagem diz porquê;
 *  - fora do limite, a autorização volta a sair.
 *
 * Mexe no limite do Life Club (baixa-o para 1 MB para forçar o travão) e repõe
 * o que encontrou, em qualquer saída.
 *
 * Uso: node scripts/test-espaco.mjs  (API na :3000)
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
const check = (l, c, d = "") => { if (c) { ok++; console.log("  OK    " + l); } else { bad++; console.log("  FALHA " + l + (d ? " — " + d : "")); } };

const login = async (email) =>
  (await (await fetch(`${S}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: A, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "academia2026" }),
  })).json()).access_token;

const call = async (token, method, pathname, body, app) => {
  const r = await fetch(API + pathname, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "x-academy-slug": "life-club",
      ...(app ? { "x-app": app } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};

const db = new pg.Client({ connectionString: env("MIGRATE_DATABASE_URL"), ssl: { rejectUnauthorized: false } });
await db.connect();

const clube = (await db.query(`SELECT id, "storageLimitMb" FROM "Academy" WHERE slug = 'life-club'`)).rows[0];
const atleta = (await db.query(`SELECT id FROM "Athlete" WHERE "academyId" = $1 AND status = 'ACTIVE' LIMIT 1`, [clube.id])).rows[0];
const repor = () => db.query(`UPDATE "Academy" SET "storageLimitMb" = $1 WHERE id = $2`, [clube.storageLimitMb, clube.id]);

const direcao = await login("direcao@lifeclub.pt");
const familia = await login("familia@lifeclub.pt");

try {
  console.log("=== Ler o espaço ===");
  const espaco = await call(direcao, "GET", "/api/espaco");
  check("a direção lê o espaço (200)", espaco.status === 200, JSON.stringify(espaco.body));
  check(
    "o limite é o do clube, em bytes",
    espaco.body?.limitBytes === clube.storageLimitMb * 1024 * 1024,
    `${espaco.body?.limitBytes}`,
  );
  const medido = (await db.query(`SELECT COALESCE(SUM(bytes), 0)::bigint AS b FROM app.storage_by_academy($1)`, [clube.id])).rows[0].b;
  check("o usado bate certo com a medição", espaco.body?.usedBytes === Number(medido), `${espaco.body?.usedBytes} vs ${medido}`);
  check(
    "as categorias somam o usado",
    (espaco.body?.categorias ?? []).reduce((s, c) => s + c.bytes, 0) === espaco.body?.usedBytes,
    JSON.stringify(espaco.body?.categorias),
  );
  const daFamilia = await call(familia, "GET", "/api/espaco", undefined, "family");
  check("uma família não o lê (403)", daFamilia.status === 403, `${daFamilia.status}`);

  console.log("\n=== O limite por omissão é 5 GB ===");
  const omissao = (await db.query(
    `SELECT column_default FROM information_schema.columns WHERE table_name = 'Academy' AND column_name = 'storageLimitMb'`,
  )).rows[0]?.column_default;
  check("a coluna nasce com 5120 MB", String(omissao) === "5120", `${omissao}`);

  console.log("\n=== No limite, não carrega ===");
  if (Number(medido) < 1024 * 1024) {
    console.log("  (o Life Club usa menos de 1 MB — o travão não se consegue provar sem carregar ficheiros)");
  } else {
    await db.query(`UPDATE "Academy" SET "storageLimitMb" = 1 WHERE id = $1`, [clube.id]);
    const recusado = await call(direcao, "POST", `/api/athletes/${atleta.id}/foto/upload`, { contentType: "image/jpeg" });
    check("a autorização de carregamento é recusada (400)", recusado.status === 400, JSON.stringify(recusado.body));
    check("e a mensagem diz que é o limite de espaço", /limite de espaço/.test(recusado.body?.message ?? ""), recusado.body?.message);

    await repor();
    const aceite = await call(direcao, "POST", `/api/athletes/${atleta.id}/foto/upload`, { contentType: "image/jpeg" });
    check("com espaço, volta a sair a autorização (200/201)", aceite.status === 200 || aceite.status === 201, JSON.stringify(aceite.body).slice(0, 120));
  }
} finally {
  await repor();
  await db.end();
}

console.log(`\n${ok} passaram, ${bad} falharam`);
process.exit(bad === 0 ? 0 : 1);

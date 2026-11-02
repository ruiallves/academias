#!/usr/bin/env node
/**
 * Vários sócios de uma vez: `POST /api/members/varios`, o "Novo sócio" com
 * várias pessoas escolhidas em "Já está no clube?".
 *
 * O que se defende:
 *   - só quem gere sócios cria (o treinador leva 403);
 *   - cada ficha é independente: as boas entram, as recusadas voltam com o
 *     motivo, pela mesma ordem do pedido;
 *   - um atleta passa a sócio sem email nem telemóvel (sócio-atleta);
 *   - quem não é atleta continua a precisar de um contacto;
 *   - o mesmo atleta duas vezes no mesmo pedido: a segunda é recusada;
 *   - mais de 25 num pedido é recusado (400).
 *
 * Não manda convites (`sendInvite: false`) nem inicia pagamentos. Recusa as
 * portas 3000 e 3001 na mesma, como os outros testes de sócios. Deixa o Life
 * Club como o encontrou.
 *
 * Uso: API=http://localhost:3011 node scripts/test-socios-varios.mjs
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const env = (k) => {
  const l = readFileSync(path.join(HERE, "..", ".env"), "utf8").split(/\r?\n/).find((x) => x.startsWith(`${k}=`));
  if (!l) throw new Error(`${k} não está em .env`);
  return l.slice(k.length + 1).trim().replace(/^"|"$/g, "");
};

const API = process.env.API ?? "http://localhost:3011";
if (/:(3000|3001)\b/.test(API)) throw new Error("Nunca contra a 3000 nem a 3001: são as APIs do Rui.");
const SUPABASE_URL = env("SUPABASE_URL").replace(/\/$/, "");
const ANON = env("SUPABASE_ANON_KEY");
const SLUG = "life-club";

let passed = 0;
let failed = 0;
const check = (label, ok, detail = "") => {
  if (ok) passed++;
  else failed++;
  console.log(`  ${ok ? "OK   " : "FALHA"} ${label}${!ok && detail ? ` — ${detail}` : ""}`);
};

async function signIn(email) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "academia2026" }),
  });
  if (!r.ok) throw new Error(`login de ${email}: ${r.status}`);
  return (await r.json()).access_token;
}

async function api(token, method, caminho, body) {
  const r = await fetch(`${API}${caminho}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "x-academy-slug": SLUG, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const t = await r.text();
  let json = null;
  try { json = t ? JSON.parse(t) : null; } catch { json = t; }
  return { status: r.status, body: json };
}

const db = new pg.Client({ connectionString: env("MIGRATE_DATABASE_URL"), ssl: { rejectUnauthorized: false } });
await db.connect();

const direcao = await signIn("direcao@lifeclub.pt");
const treinador = await signIn("treinador@lifeclub.pt");
const criados = [];

try {
  console.log("\n=== Preparar ===");
  const socios = (await api(direcao, "GET", "/api/members")).body?.members ?? [];
  const jaSocios = new Set(socios.filter((s) => s.athlete).map((s) => s.athlete.id));
  const atletas = ((await api(direcao, "GET", "/api/athletes")).body ?? []).filter((a) => !jaSocios.has(a.id)).slice(0, 2);
  check("há dois atletas que ainda não são sócios", atletas.length === 2, `${atletas.length}`);
  if (atletas.length < 2) throw new Error("sem atletas para o teste");

  const base = { status: "PENDING", sendInvite: false };
  const pedido = [
    { ...base, name: `[TESTE-VARIOS] ${atletas[0].name}`, athleteId: atletas[0].id },
    { ...base, name: `[TESTE-VARIOS] ${atletas[1].name}`, athleteId: atletas[1].id },
    { ...base, name: "[TESTE-VARIOS] Repetido", athleteId: atletas[0].id },
    { ...base, name: "[TESTE-VARIOS] Sem contacto" },
    { ...base, name: "[TESTE-VARIOS] Com telemóvel", phone: "910000009" },
  ];

  console.log("\n=== Permissão ===");
  check("o treinador não cria (403)", (await api(treinador, "POST", "/api/members/varios", { socios: pedido })).status === 403);

  console.log("\n=== Um pedido com fichas boas e más ===");
  const r = await api(direcao, "POST", "/api/members/varios", { socios: pedido });
  const res = r.body?.resultados ?? [];
  for (const x of res) if (x.ok) criados.push(x.id);
  check("responde 201 com uma linha por ficha", r.status === 201 && res.length === pedido.length, `${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  check("os dois atletas entram sem email nem telemóvel", res[0]?.ok === true && res[1]?.ok === true, JSON.stringify(res.slice(0, 2)));
  check("o mesmo atleta outra vez é recusado com o motivo", res[2]?.ok === false && /já é sócio/i.test(res[2]?.error ?? ""), JSON.stringify(res[2]));
  check("quem não é atleta continua a precisar de contacto", res[3]?.ok === false && /contacto/i.test(res[3]?.error ?? ""), JSON.stringify(res[3]));
  check("a ficha boa depois das recusadas entra na mesma", res[4]?.ok === true, JSON.stringify(res[4]));

  const ligadas = (await db.query(`SELECT "athleteId", "inviteSentAt" FROM "Member" WHERE id = ANY($1)`, [criados])).rows;
  check(
    "as fichas dos atletas ficam ligadas a eles",
    atletas.every((a) => ligadas.some((m) => m.athleteId === a.id)),
    JSON.stringify(ligadas),
  );
  check("não saiu convite nenhum", ligadas.every((m) => m.inviteSentAt === null));

  console.log("\n=== O perfil do atleta pede só a ficha dele ===");
  const doAtleta = (await api(direcao, "GET", `/api/members?athleteId=${atletas[0].id}`)).body?.members ?? [];
  check("a lista filtrada por atleta traz só a ficha desse atleta", doAtleta.length === 1 && doAtleta[0].athlete?.id === atletas[0].id, `${doAtleta.length}`);

  console.log("\n=== Limite ===");
  const muitos = Array.from({ length: 26 }, (_, i) => ({ ...base, name: `[TESTE-VARIOS] ${i}`, phone: "910000009" }));
  const grande = await api(direcao, "POST", "/api/members/varios", { socios: muitos });
  check("mais de 25 num pedido é recusado (400)", grande.status === 400, `${grande.status}`);
  const nenhum = (await db.query(`SELECT count(*)::int n FROM "Member" WHERE name LIKE '[TESTE-VARIOS] %' AND name ~ '\\] [0-9]+$'`)).rows[0].n;
  check("e não criou nenhum", nenhum === 0, `${nenhum}`);
} catch (e) {
  failed++;
  console.log(`  FALHA ${e.message}`);
} finally {
  console.log("\n=== Arrumar ===");
  for (const id of criados) await api(direcao, "DELETE", `/api/members/${id}`);
  const restos = (await db.query(`SELECT count(*)::int n FROM "Member" WHERE name LIKE '[TESTE-VARIOS]%'`)).rows[0].n;
  check("nada do teste ficou na base", restos === 0, `${restos} linhas`);
  await db.end();
}

console.log(`\n${failed === 0 ? "TUDO OK" : "FALHAS"} — ${passed} ok, ${failed} falhas\n`);
process.exit(failed === 0 ? 0 : 1);

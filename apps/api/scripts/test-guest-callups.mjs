#!/usr/bin/env node
/**
 * Convocar atletas de outro escalão.
 *
 * O que interessa provar: **sobe, nunca desce**. Um Sub-11 pode reforçar um jogo
 * de Sub-13; o contrário — um Sub-13 a "descer" para jogar com os Sub-11 — é
 * irregular em qualquer federação, e o servidor tem de o recusar mesmo que o
 * pedido venha com um id válido e uma sessão autenticada.
 *
 * E que a fronteira de dados se mantém: o treinador dos Sub-13 não ganha acesso
 * ao boletim clínico dos Sub-11 só porque pode ver os nomes deles.
 *
 * Uso: node scripts/test-guest-callups.mjs
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

let ok = 0;
let bad = 0;
const check = (l, c, d = "") => {
  if (c) { ok++; console.log("  OK    " + l); }
  else { bad++; console.log("  FALHA " + l + (d ? " — " + d : "")); }
};

const login = async (email) =>
  (await (await fetch(`${S}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: A, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "academia2026" }),
  })).json()).access_token;

const call = async (token, method, pathname, body) => {
  const res = await fetch(API + pathname, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "x-academy-slug": "life-club",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

// Rui Machado treina os Sub-9/11; André Peixoto (adjunto) treina só os Sub-11.
const coach11 = await login("treinador@lifeclub.pt");
const coach13Login = await login("treinador@lifeclub.pt"); // Rui também treina os Sub-13 na seed

const db = new pg.Client({ connectionString: env("MIGRATE_DATABASE_URL"), ssl: { rejectUnauthorized: false } });
await db.connect();

await db.query(`UPDATE "Match" SET "callUpsClosedAt" = NULL WHERE id IN ('mt_proximo','mt_seguinte')`);
await db.query(`DELETE FROM "MatchCallUp" WHERE "matchId" IN ('mt_proximo','mt_seguinte')`);

console.log("=== Quem pode subir ===");
// mt_proximo é dos Sub-11; mt_seguinte é dos Sub-13.
const pool13 = await call(coach13Login, "GET", "/api/matches/mt_seguinte/convidados-elegiveis");
check("o jogo dos Sub-13 tem candidatos dos Sub-11", pool13.status === 200 && pool13.body.length > 0, `${pool13.body?.length}`);
check("vêm com o nome da equipa de origem", pool13.body.every((a) => a.teamName), pool13.body[0]?.teamName);
check("sem diagnóstico — só se está bloqueado", pool13.body.every((a) => !("clinicalTitle" in a) && typeof a.blocked === "boolean"));

const pool11 = await call(coach11, "GET", "/api/matches/mt_proximo/convidados-elegiveis");
check("o jogo dos Sub-11 não tem candidatos dos Sub-13 (não se desce)", pool11.status === 200 && pool11.body.length === 0, `${pool11.body?.length}`);

console.log("\n=== Convocar para cima funciona ===");
const algumSub11 = pool13.body[0];
check("há pelo menos um Sub-11 disponível para convocar", Boolean(algumSub11), JSON.stringify(pool13.body[0]));

if (algumSub11) {
  const guardou = await call(coach13Login, "POST", "/api/matches/mt_seguinte/convocatoria", {
    athleteIds: [algumSub11.id],
  });
  check("guarda a convocatória com o convidado", guardou.status < 300, JSON.stringify(guardou.body).slice(0, 100));

  const lido = await call(coach13Login, "GET", "/api/matches");
  const jogo = lido.body.find((m) => m.id === "mt_seguinte");
  const entrada = jogo?.calledUp.find((c) => c.athleteId === algumSub11.id);
  check("aparece marcado como convidado", entrada?.isGuest === true, JSON.stringify(entrada));
  check("com a equipa de origem", entrada?.guestFromTeam === algumSub11.teamName, entrada?.guestFromTeam);
}

console.log("\n=== Convocar para baixo é recusado ===");
// Tentar meter um atleta dos Sub-13 na convocatória dos Sub-11.
const sub13Athlete = await db.query(`SELECT id FROM "Athlete" WHERE "academyId"='acd_lifeclub' AND id='ath_rodrigo'`);
const desce = await call(coach11, "POST", "/api/matches/mt_proximo/convocatoria", {
  athleteIds: [sub13Athlete.rows[0].id],
});
check("um Sub-13 não pode ser convocado para um jogo de Sub-11", desce.status === 400, `${desce.status}`);

console.log("\n=== Um convidado de baixa continua bloqueado ===");
// A Matilde (Sub-11) está de baixa aberta na seed.
const matilde = pool13.body.find((a) => a.name.includes("Matilde"));
check("aparece na lista, mas marcada como bloqueada", matilde?.blocked === true, JSON.stringify(matilde));

if (matilde) {
  const tenta = await call(coach13Login, "POST", "/api/matches/mt_seguinte/convocatoria", {
    athleteIds: [matilde.id],
  });
  check("e continua recusada ao convocar", tenta.status === 400, `${tenta.status}`);
}

console.log("\n=== Limpeza ===");
await db.query(`UPDATE "Match" SET "callUpsClosedAt" = NULL WHERE id IN ('mt_proximo','mt_seguinte')`);
await db.query(`DELETE FROM "MatchCallUp" WHERE "matchId" IN ('mt_proximo','mt_seguinte')`);
await db.end();
console.log("  feito");

console.log(`\n${ok} passaram, ${bad} falharam`);
process.exit(bad === 0 ? 0 : 1);

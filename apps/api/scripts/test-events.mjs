#!/usr/bin/env node
/**
 * Eventos do calendário via API.
 *
 * O que interessa: a permissão (`calendar:write`), o âmbito (um treinador cria para
 * as suas equipas mas não "toda a academia"), cancelar/reativar sem apagar, a
 * validação de forma, e a persistência real na base.
 *
 * Uso: node scripts/test-events.mjs
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

const call = async (token, method, pathname, body) => {
  const r = await fetch(API + pathname, {
    method, headers: { Authorization: `Bearer ${token}`, "x-academy-slug": "life-club", ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};

const db = new pg.Client({ connectionString: env("MIGRATE_DATABASE_URL"), ssl: { rejectUnauthorized: false } });
await db.connect();
await db.query(`DELETE FROM "CalendarEvent" WHERE title LIKE 'ZZ Evento%'`);

const director = await login("direcao@lifeclub.pt");
const coach = await login("treinador@lifeclub.pt");
const parent = await login("familia@lifeclub.pt");

const S1 = "2026-09-01T18:00:00.000Z";
const E1 = "2026-09-01T19:30:00.000Z";
const base = (title, extra = {}) => ({ kind: "TRAINING", title, startsAt: S1, endsAt: E1, venue: "Campo 1", ...extra });

console.log("=== Criar ===");
const teamEv = await call(director, "POST", "/api/events", base("ZZ Evento Equipa", { teamId: "t_sub11" }));
check("a direção cria um evento de equipa", teamEv.status === 201 || teamEv.status === 200, JSON.stringify(teamEv.body).slice(0, 140));
check("nasce por cancelar", teamEv.body?.cancelled === false);
check("com a equipa certa", teamEv.body?.teamId === "t_sub11");
const wideEv = await call(director, "POST", "/api/events", base("ZZ Evento Academia", { kind: "OTHER" }));
check("a direção cria um evento de toda a academia (sem equipa)", wideEv.status === 201 && wideEv.body?.teamId === null, `${wideEv.status}`);

console.log("\n=== Permissão e âmbito ===");
const coachOwn = await call(coach, "POST", "/api/events", base("ZZ Evento Treinador", { teamId: "t_sub11" }));
check("um treinador cria para a sua equipa", coachOwn.status === 201 || coachOwn.status === 200, `${coachOwn.status}`);
const coachWide = await call(coach, "POST", "/api/events", base("ZZ Evento TreinadorAcademia"));
check("um treinador não cria 'toda a academia' (403)", coachWide.status === 403, `${coachWide.status}`);
const byParent = await call(parent, "POST", "/api/events", base("ZZ Evento Pai", { teamId: "t_sub11" }));
check("um encarregado não cria eventos (403)", byParent.status === 403, `${byParent.status}`);

console.log("\n=== Regras de forma ===");
const badRange = await call(director, "POST", "/api/events", base("ZZ Evento Ordem", { teamId: "t_sub11", endsAt: S1, startsAt: E1 }));
check("fim antes do início recusado (400)", badRange.status === 400, `${badRange.status}`);
const badKind = await call(director, "POST", "/api/events", { kind: "FESTA", title: "ZZ Evento Kind", startsAt: S1, endsAt: E1, venue: "Campo 1" });
check("tipo inválido recusado (400)", badKind.status === 400, `${badKind.status}`);
const massAssign = await call(director, "POST", "/api/events", base("ZZ Evento Extra", { teamId: "t_sub11", academyId: "acd_outra", cancelled: true }));
check("campos extra (academyId/cancelled) rejeitados", massAssign.status === 400, `${massAssign.status}`);
const badTeam = await call(director, "POST", "/api/events", base("ZZ Evento TeamX", { teamId: "t_nao_existe" }));
check("equipa desconhecida recusada (400)", badTeam.status === 400, `${badTeam.status}`);

console.log("\n=== Ler no intervalo ===");
const list = await call(director, "GET", "/api/events?from=2026-08-01&to=2026-10-01");
check("a leitura devolve os eventos criados", Array.isArray(list.body) && list.body.filter((e) => e.title.startsWith("ZZ Evento")).length === 3, `${list.body?.length}`);

console.log("\n=== Cancelar e reativar ===");
const id = teamEv.body.id;
const cancelled = await call(director, "PATCH", `/api/events/${id}`, { cancelled: true });
check("cancela o evento (cancelled=true)", cancelled.status === 200 && cancelled.body?.cancelled === true, `${cancelled.status}`);
const reactivated = await call(director, "PATCH", `/api/events/${id}`, { cancelled: false });
check("reativa o evento (cancelled=false)", reactivated.status === 200 && reactivated.body?.cancelled === false, `${reactivated.status}`);
const coachCancelWide = await call(coach, "PATCH", `/api/events/${wideEv.body.id}`, { cancelled: true });
check("um treinador não cancela evento de toda a academia (403)", coachCancelWide.status === 403, `${coachCancelWide.status}`);

console.log("\n=== Ficou na base ===");
const total = (await db.query(`SELECT count(*)::int n FROM "CalendarEvent" WHERE title LIKE 'ZZ Evento%'`)).rows[0].n;
check("3 eventos de teste na base", total === 3, `${total}`);

console.log("\n=== Limpeza ===");
await db.query(`DELETE FROM "CalendarEvent" WHERE title LIKE 'ZZ Evento%'`);
await db.end();
console.log("  feito");

console.log(`\n${ok} passaram, ${bad} falharam`);
process.exit(bad === 0 ? 0 : 1);

#!/usr/bin/env node
/**
 * Marcar um jogo no calendário — e encontrá-lo nas convocatórias.
 *
 * O sintoma que isto trava: o calendário gravava `CalendarEvent` e as
 * convocatórias liam `Match`, por isso um jogo marcado no calendário nunca
 * aparecia para convocar. Um evento de tipo `MATCH` passa a ser gravado como
 * `Match`, e este teste segue-o pelos dois ecrãs.
 *
 * Uso: node scripts/test-match-events.mjs
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
    method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "x-academy-slug": "life-club", ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};

const db = new pg.Client({ connectionString: env("MIGRATE_DATABASE_URL"), ssl: { rejectUnauthorized: false } });
await db.connect();
const cleanup = async () => {
  await db.query(`DELETE FROM "Match" WHERE opponent LIKE 'ZZ %'`);
  await db.query(`DELETE FROM "CalendarEvent" WHERE title LIKE 'ZZ %'`);
};
await cleanup();

const director = await login("direcao@lifeclub.pt");

// Uma data no futuro, para o jogo contar como "a chegar" nas convocatórias.
const day = new Date(Date.now() + 7 * 86_400_000);
day.setHours(11, 0, 0, 0);
const startsAt = day.toISOString();
const endsAt = new Date(day.getTime() + 90 * 60_000).toISOString();

console.log("=== Marcar um jogo no calendário ===");
const created = await call(director, "POST", "/api/events", {
  kind: "MATCH", teamId: "t_sub11", title: "ZZ Jogo Teste",
  startsAt, endsAt, venue: "Campo 1", opponent: "ZZ Adversário FC", isHome: true,
});
check("a direção marca um jogo (201)", created.status === 201 || created.status === 200, JSON.stringify(created.body).slice(0, 160));
check("devolve o jogo com o tipo certo", created.body?.kind === "MATCH", `${created.body?.kind}`);

console.log("\n=== Foi gravado como Match, não como evento genérico ===");
const asMatch = (await db.query(`SELECT id, "teamId", opponent, "isHome", status FROM "Match" WHERE opponent = 'ZZ Adversário FC'`)).rows;
check("existe uma linha em Match", asMatch.length === 1, JSON.stringify(asMatch));
check("com a equipa e o adversário certos", asMatch[0]?.teamId === "t_sub11" && asMatch[0]?.isHome === true, JSON.stringify(asMatch[0]));
const asEvent = (await db.query(`SELECT count(*)::int n FROM "CalendarEvent" WHERE title = 'ZZ Jogo Teste'`)).rows[0].n;
check("e NÃO uma linha em CalendarEvent", asEvent === 0, `${asEvent}`);

console.log("\n=== Aparece nas convocatórias ===");
const matches = await call(director, "GET", "/api/matches");
const found = (Array.isArray(matches.body) ? matches.body : []).find((m) => m.opponent === "ZZ Adversário FC");
check("o jogo aparece em /api/matches", Boolean(found), `${matches.body?.length} jogos`);
check("pronto a convocar — sem convocatória ainda", found?.submitted === false && Array.isArray(found?.calledUp), JSON.stringify(found?.submitted));
check("traz o tecto de convocados da equipa", typeof found?.maxCallUps === "number", `${found?.maxCallUps}`);

console.log("\n=== Aparece também no calendário ===");
const from = new Date(Date.now() - 86_400_000).toISOString();
const to = new Date(Date.now() + 30 * 86_400_000).toISOString();
const events = await call(director, "GET", `/api/events?from=${from}&to=${to}`);
const inEvents = (Array.isArray(events.body) ? events.body : []).some((e) => e.title === "ZZ Jogo Teste");
check("não está em /api/events (é um Match, lido à parte)", !inEvents);
// O calendário da consola funde /api/events com /api/matches — o que a torna
// visível nos dois sítios é o jogo estar em /api/matches, já confirmado acima.

console.log("\n=== Um jogo precisa de equipa e adversário ===");
const noOpponent = await call(director, "POST", "/api/events", {
  kind: "MATCH", teamId: "t_sub11", title: "ZZ Jogo SemAdv", startsAt, endsAt, venue: "Campo 1",
});
check("sem adversário é recusado (400)", noOpponent.status === 400, `${noOpponent.status}`);
const noTeam = await call(director, "POST", "/api/events", {
  kind: "MATCH", title: "ZZ Jogo SemEquipa", startsAt, endsAt, venue: "Campo 1", opponent: "ZZ Outro",
});
check("sem equipa é recusado (400)", noTeam.status === 400, `${noTeam.status}`);

console.log("\n=== A mesma equipa não joga duas vezes à mesma hora ===");
const clash = await call(director, "POST", "/api/events", {
  kind: "MATCH", teamId: "t_sub11", title: "ZZ Jogo Choque", startsAt, endsAt, venue: "Campo 2", opponent: "ZZ Outro FC",
});
check("choque de horário recusado com mensagem clara (400)", clash.status === 400 && /já tem um jogo/i.test(clash.body?.message ?? ""), JSON.stringify(clash.body?.message));

console.log("\n=== Cancelar e reactivar um jogo pelo calendário ===");
const matchId = created.body.id;
const cancelled = await call(director, "PATCH", `/api/events/${matchId}`, { cancelled: true });
check("cancela o jogo pelo mesmo endpoint dos eventos (200)", cancelled.status === 200 && cancelled.body?.cancelled === true, JSON.stringify(cancelled.body).slice(0, 120));
const stillThere = (await db.query(`SELECT status FROM "Match" WHERE id = $1`, [matchId])).rows[0];
check("continua a existir, marcado como cancelado (não apagado)", stillThere?.status === "CANCELLED", JSON.stringify(stillThere));
const gone = await call(director, "GET", "/api/matches");
const inUpcoming = (Array.isArray(gone.body) ? gone.body : []).find((m) => m.id === matchId);
check("um jogo cancelado sai das convocatórias", inUpcoming?.status === "CANCELLED" || !inUpcoming, `${inUpcoming?.status}`);
const revived = await call(director, "PATCH", `/api/events/${matchId}`, { cancelled: false });
check("reactiva o jogo (200)", revived.status === 200 && revived.body?.cancelled === false, `${revived.status}`);
const backAgain = (await db.query(`SELECT status FROM "Match" WHERE id = $1`, [matchId])).rows[0];
check("volta a estar agendado — convocável outra vez", backAgain?.status === "SCHEDULED", JSON.stringify(backAgain));

console.log("\n=== Um jogo cancelado liberta o horário ===");
// Cancela o nosso jogo e marca outro adversário para a mesma equipa e hora: um
// jogo desmarcado não ocupa o campo.
await call(director, "PATCH", `/api/events/${matchId}`, { cancelled: true });
const reuse = await call(director, "POST", "/api/events", {
  kind: "MATCH", teamId: "t_sub11", title: "ZZ Jogo Substituto",
  startsAt, endsAt, venue: "Campo 1", opponent: "ZZ Substituto FC",
});
check("marca outro jogo no horário do cancelado (201)", reuse.status === 201 || reuse.status === 200, JSON.stringify(reuse.body?.message ?? reuse.status));

const cantRevive = await call(director, "PATCH", `/api/events/${matchId}`, { cancelled: false });
check("reactivar o antigo é recusado — o horário já é de outro (400)", cantRevive.status === 400 && /já tem um jogo/i.test(cantRevive.body?.message ?? ""), JSON.stringify(cantRevive.body?.message));

console.log("\n=== Um treino continua a ser um evento genérico ===");
const training = await call(director, "POST", "/api/events", {
  kind: "TRAINING", teamId: "t_sub11", title: "ZZ Treino Extra",
  startsAt: new Date(day.getTime() + 86_400_000).toISOString(),
  endsAt: new Date(day.getTime() + 86_400_000 + 60 * 60_000).toISOString(),
  venue: "Campo 1",
});
check("treino criado (201)", training.status === 201 || training.status === 200, `${training.status}`);
const trainingRow = (await db.query(`SELECT count(*)::int n FROM "CalendarEvent" WHERE title = 'ZZ Treino Extra'`)).rows[0].n;
check("gravado em CalendarEvent, como antes", trainingRow === 1, `${trainingRow}`);

console.log("\n=== Limpeza ===");
await cleanup();
await db.end();
console.log("  feito");

console.log(`\n${ok} passaram, ${bad} falharam`);
process.exit(bad === 0 ? 0 : 1);

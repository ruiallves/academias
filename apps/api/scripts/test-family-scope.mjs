#!/usr/bin/env node
/**
 * O que uma família vê — e o que não vê.
 *
 * Um encarregado tem dois âmbitos: os **filhos** (o que é pessoal) e as **equipas
 * deles** (o que é do grupo). Sem o segundo, a agenda da app vinha vazia; sem o
 * primeiro a filtrar por cima, o pai via a lista de colegas do filho e as
 * mensalidades das outras famílias. Este teste guarda essa fronteira.
 *
 * Uso: node scripts/test-family-scope.mjs
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
      // De que app vem o pedido. Sem isto, o servidor escolhe a membership como
      // sempre escolheu — é o caminho das apps antigas ainda em cache.
      ...(app ? { "x-app": app } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};

// familia@lifeclub.pt é encarregado do Martim (Sub-11) e da Leonor (Sub-13).
const parent = await login("familia@lifeclub.pt");
const director = await login("direcao@lifeclub.pt");

console.log("=== Vê os filhos, e só os filhos ===");
const athletes = await call(parent, "GET", "/api/athletes");
check("a lista de atletas abre (200)", athletes.status === 200, `${athletes.status}`);
const names = (Array.isArray(athletes.body) ? athletes.body : []).map((a) => a.name).sort();
check("vê exactamente os dois filhos", names.length === 2 && names.every((n) => /Bragança/.test(n)), JSON.stringify(names));

const allAthletes = await call(director, "GET", "/api/athletes");
check("a direção vê mais do que isso (prova que o filtro é do pai)", allAthletes.body.length > names.length, `${allAthletes.body.length} vs ${names.length}`);

console.log("\n=== Vê a agenda das equipas dos filhos ===");
const from = new Date(Date.now() - 30 * 86_400_000).toISOString();
const to = new Date(Date.now() + 30 * 86_400_000).toISOString();
const sessions = await call(parent, "GET", `/api/sessions?from=${from}&to=${to}`);
check("os treinos abrem (200)", sessions.status === 200, `${sessions.status}`);
check("e não vêm vazios — é a agenda da app", Array.isArray(sessions.body) && sessions.body.length > 0, `${sessions.body?.length} treinos`);

const teams = await call(parent, "GET", "/api/teams");
check("vê as equipas dos filhos", teams.status === 200 && teams.body.length > 0, `${teams.body?.length}`);
const teamNames = (teams.body ?? []).map((t) => t.name);
check("só essas — não a academia toda", teams.body.length <= 2, JSON.stringify(teamNames));

const matches = await call(parent, "GET", "/api/matches");
check("vê os jogos das equipas dos filhos", matches.status === 200 && matches.body.length > 0, `${matches.body?.length}`);

console.log("\n=== Dinheiro: só o dos filhos ===");
const charges = await call(parent, "GET", "/api/charges");
check("as mensalidades abrem (200)", charges.status === 200, `${charges.status}`);
const chargeAthletes = new Set((charges.body ?? []).map((c) => c.athleteName));
check("só de atletas da própria família", [...chargeAthletes].every((n) => /Bragança/.test(n)), JSON.stringify([...chargeAthletes]));

const allCharges = await call(director, "GET", "/api/charges");
check("a direção vê as de toda a gente (prova o filtro)", allCharges.body.length > (charges.body?.length ?? 0), `${allCharges.body.length} vs ${charges.body?.length}`);

console.log("\n=== Avisos: só os que lhe são dirigidos ===");
// A direção publica um aviso só para treinadores.
const forCoaches = await call(director, "POST", "/api/announcements", {
  title: "ZZ Reunião técnica", body: "Só para a equipa técnica.", audience: "coaches",
});
const forParents = await call(director, "POST", "/api/announcements", {
  title: "ZZ Aviso às famílias", body: "Para os pais.", audience: "guardians",
});

const seen = await call(parent, "GET", "/api/announcements");
const titles = (seen.body ?? []).map((a) => a.title);
check("vê o aviso dirigido às famílias", titles.includes("ZZ Aviso às famílias"), JSON.stringify(titles.slice(0, 5)));
check("NÃO vê o aviso dirigido aos treinadores", !titles.includes("ZZ Reunião técnica"), JSON.stringify(titles.slice(0, 5)));

const directorSees = await call(director, "GET", "/api/announcements");
check("a direção vê os dois (é o registo dela)", (directorSees.body ?? []).map((a) => a.title).includes("ZZ Reunião técnica"));

console.log("\n=== Notificações: as suas, e só as suas ===");
const notifs = await call(parent, "GET", "/api/notifications");
check("a lista de notificações abre (200)", notifs.status === 200, `${notifs.status}`);
check("devolve uma lista", Array.isArray(notifs.body), typeof notifs.body);
const otherParentNotifs = await call(await login("familia2@lifeclub.pt"), "GET", "/api/notifications");
const mineIds = new Set((notifs.body ?? []).map((n) => n.id));
const theirs = (otherParentNotifs.body ?? []).map((n) => n.id);
check("as de outra família não se misturam", theirs.every((id) => !mineIds.has(id)), `${theirs.length} do outro`);

console.log("\n=== O que continua fechado ===");
// O corpo vai **completo**, NIF incluído. Sem ele a `ValidationPipe` responde 400
// antes de a permissão sequer ser lida — e um 400 aqui não prova nada sobre âmbito.
check("não escreve atletas (403)", (await call(parent, "POST", "/api/athletes", { name: "ZZ Teste", birthdate: "2015-01-01", teamId: "t_sub11", taxId: "123456789" })).status === 403);
check("não vê o staff (403)", (await call(parent, "GET", "/api/staff")).status === 403);
check("não cria eventos (403)", (await call(parent, "POST", "/api/events", { kind: "TRAINING", teamId: "t_sub11", title: "ZZ", startsAt: new Date().toISOString(), endsAt: new Date(Date.now() + 3600000).toISOString(), venue: "x" })).status === 403);

console.log("\n=== A app da família é da família ===");
/*
 * O bug que isto fecha.
 *
 * Um treinador que também é pai tem duas memberships na mesma academia, e o
 * servidor escolhia a primeira que encontrasse. Com a de treinador, a app da
 * família recebia o plantel inteiro de `/api/athletes` — e essa app trata essa
 * lista como "os meus filhos". O escalão todo aparecia como filhos daquele pai.
 *
 * Agora a app diz de que lado vem (`x-app: family`) e o servidor exige um vínculo
 * de família. Quem não o tiver leva 403 em vez de receber o chapéu errado.
 */
const coach = await login("treinador@lifeclub.pt");
const coachNaApp = await call(coach, "GET", "/api/athletes", undefined, "family");
check("um treinador não entra na app da família (403)", coachNaApp.status === 403, `${coachNaApp.status}`);

const paiNaApp = await call(parent, "GET", "/api/athletes", undefined, "family");
check("um encarregado entra (200)", paiNaApp.status === 200, `${paiNaApp.status}`);
check(
  "e continua a ver só os filhos dele",
  Array.isArray(paiNaApp.body) && paiNaApp.body.length === names.length,
  `${paiNaApp.body?.length} vs ${names.length}`,
);

const coachNaConsola = await call(coach, "GET", "/api/athletes", undefined, "console");
check("e continua a ser treinador na consola (200)", coachNaConsola.status === 200, `${coachNaConsola.status}`);

console.log("\n=== Limpeza ===");
for (const t of ["ZZ Reunião técnica", "ZZ Aviso às famílias"]) {
  const found = (directorSees.body ?? []).find((a) => a.title === t) ?? (seen.body ?? []).find((a) => a.title === t);
  if (found) await call(director, "DELETE", `/api/announcements/${found.id}`);
}
// Os que acabaram de ser criados podem não estar nas listas lidas acima.
const after = await call(director, "GET", "/api/announcements");
for (const a of after.body ?? []) if (a.title.startsWith("ZZ ")) await call(director, "DELETE", `/api/announcements/${a.id}`);
console.log("  feito");

console.log(`\n${ok} passaram, ${bad} falharam`);
process.exit(bad === 0 ? 0 : 1);

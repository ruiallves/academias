#!/usr/bin/env node
/**
 * Configuração de mensalidades — preço por equipa e ajuste individual.
 *
 * O que interessa: só `billing:write` (direção) configura; `billing:read`
 * (direção + o próprio encarregado) lê; o preço da equipa é a omissão, o ajuste
 * individual sobrepõe-se-lhe; reverter volta ao preço da equipa; e um treinador
 * sem `billing:read` não vê preços em `/api/teams`.
 *
 * Uso: node scripts/test-fee-config.mjs
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

// Estado limpo: sem inscrições nem planos de teste anteriores.
const cleanup = async () => {
  await db.query(`DELETE FROM "Enrollment" WHERE "athleteId" IN ('ath_martim', 'ath_gustavo')`);
  await db.query(`DELETE FROM "SubscriptionPlan" WHERE name LIKE 'Individual — %' OR "teamId" = 't_sub11'`);
};
await cleanup();

const director = await login("direcao@lifeclub.pt");
const coach = await login("treinador@lifeclub.pt");
const parentOwn = await login("familia@lifeclub.pt"); // encarregado de ath_martim
const parentOther = await login("familia2@lifeclub.pt"); // encarregado de outro atleta

console.log("=== Preço da equipa ===");
const setTeam = await call(director, "PATCH", "/api/teams/t_sub11/fee", { amountCents: 4000 });
check("a direção define o preço da equipa (200)", setTeam.status === 200 && setTeam.body?.amountCents === 4000, JSON.stringify(setTeam.body));

const coachSetTeam = await call(coach, "PATCH", "/api/teams/t_sub11/fee", { amountCents: 5000 });
check("um treinador não define preços (403)", coachSetTeam.status === 403, `${coachSetTeam.status}`);

const parentSetTeam = await call(parentOwn, "PATCH", "/api/teams/t_sub11/fee", { amountCents: 5000 });
check("um encarregado não define preços (403)", parentSetTeam.status === 403, `${parentSetTeam.status}`);

console.log("\n=== O preço só sai para quem tem billing:read ===");
const teamsAsDirector = await call(director, "GET", "/api/teams");
const sub11Dir = teamsAsDirector.body.find((t) => t.id === "t_sub11");
check("a direção vê o preço em /api/teams", sub11Dir?.feeCents === 4000, `${sub11Dir?.feeCents}`);
const teamsAsCoach = await call(coach, "GET", "/api/teams");
const sub11Coach = teamsAsCoach.body.find((t) => t.id === "t_sub11");
check("o treinador não vê preços (null)", sub11Coach?.feeCents === null, `${sub11Coach?.feeCents}`);

console.log("\n=== Actualizar o preço da equipa não duplica o plano ===");
const setTeamAgain = await call(director, "PATCH", "/api/teams/t_sub11/fee", { amountCents: 4200 });
check("actualiza o mesmo plano (200)", setTeamAgain.status === 200 && setTeamAgain.body?.amountCents === 4200, `${setTeamAgain.status}`);
const planCount = (await db.query(`SELECT count(*)::int n FROM "SubscriptionPlan" WHERE "teamId" = 't_sub11' AND "isActive" = true`)).rows[0].n;
check("continua a haver só um plano activo para a equipa", planCount === 1, `${planCount}`);

console.log("\n=== Um atleta sem ajuste paga o preço da equipa ===");
const feeBefore = await call(director, "GET", "/api/athletes/ath_martim/fee");
check("fonte é 'team'", feeBefore.body?.source === "team", JSON.stringify(feeBefore.body));
check("o valor efectivo é o da equipa", feeBefore.body?.effectiveAmountCents === 4200, `${feeBefore.body?.effectiveAmountCents}`);
check("o encarregado do próprio atleta lê o mesmo", (await call(parentOwn, "GET", "/api/athletes/ath_martim/fee")).status === 200);
check("outro encarregado não lê (403)", (await call(parentOther, "GET", "/api/athletes/ath_martim/fee")).status === 403);

console.log("\n=== Ajuste individual sobrepõe-se ===");
const setIndividual = await call(director, "PUT", "/api/athletes/ath_martim/fee", { amountCents: 3000 });
check("a direção ajusta individualmente (200)", setIndividual.status === 200 && setIndividual.body?.amountCents === 3000, JSON.stringify(setIndividual.body));

const feeAfter = await call(director, "GET", "/api/athletes/ath_martim/fee");
check("fonte passa a 'individual'", feeAfter.body?.source === "individual", JSON.stringify(feeAfter.body));
check("o valor efectivo é o individual", feeAfter.body?.effectiveAmountCents === 3000, `${feeAfter.body?.effectiveAmountCents}`);
check("o preço da equipa continua visível para comparação", feeAfter.body?.teamAmountCents === 4200, `${feeAfter.body?.teamAmountCents}`);

const coachSetIndividual = await call(coach, "PUT", "/api/athletes/ath_martim/fee", { amountCents: 1000 });
check("um treinador não ajusta individualmente (403)", coachSetIndividual.status === 403, `${coachSetIndividual.status}`);

console.log("\n=== Ajustar outra vez actualiza, não duplica ===");
const setIndividualAgain = await call(director, "PUT", "/api/athletes/ath_martim/fee", { amountCents: 3500 });
check("actualiza o valor (200)", setIndividualAgain.status === 200 && setIndividualAgain.body?.amountCents === 3500, `${setIndividualAgain.status}`);
const enrollCount = (await db.query(`SELECT count(*)::int n FROM "Enrollment" WHERE "athleteId" = 'ath_martim' AND ("endsOn" IS NULL)`)).rows[0].n;
check("continua a haver só uma inscrição activa", enrollCount === 1, `${enrollCount}`);

console.log("\n=== Validação de forma ===");
const badAmount = await call(director, "PUT", "/api/athletes/ath_martim/fee", { amountCents: 0 });
check("valor a zero recusado (400)", badAmount.status === 400, `${badAmount.status}`);
const hugeAmount = await call(director, "PATCH", "/api/teams/t_sub11/fee", { amountCents: 999_999 });
check("valor absurdo recusado (400)", hugeAmount.status === 400, `${hugeAmount.status}`);

console.log("\n=== Reverter para o preço da equipa ===");
const clear = await call(director, "DELETE", "/api/athletes/ath_martim/fee");
check("a direção reverte o ajuste (200)", clear.status === 200 && clear.body?.cleared === true, `${clear.status}`);
const feeReverted = await call(director, "GET", "/api/athletes/ath_martim/fee");
check("volta a pagar o preço da equipa", feeReverted.body?.source === "team" && feeReverted.body?.effectiveAmountCents === 4200, JSON.stringify(feeReverted.body));
const endedEnroll = (await db.query(`SELECT "endsOn" FROM "Enrollment" WHERE "athleteId" = 'ath_martim' ORDER BY "startsOn" DESC LIMIT 1`)).rows[0];
check("a inscrição individual ficou terminada, não apagada (histórico)", endedEnroll && endedEnroll.endsOn !== null, JSON.stringify(endedEnroll));

console.log("\n=== Ajuste em lote — vários atletas de uma vez ===");
const bulk = await call(director, "PUT", "/api/athletes/fee", { athleteIds: ["ath_martim", "ath_gustavo"], amountCents: 2800 });
check("a direção ajusta dois atletas de uma vez (200)", bulk.status === 200 && bulk.body?.updated?.length === 2, JSON.stringify(bulk.body));
const martimAfterBulk = await call(director, "GET", "/api/athletes/ath_martim/fee");
const gustavoAfterBulk = await call(director, "GET", "/api/athletes/ath_gustavo/fee");
check("o primeiro atleta fica com o ajuste", martimAfterBulk.body?.source === "individual" && martimAfterBulk.body?.effectiveAmountCents === 2800, JSON.stringify(martimAfterBulk.body));
check("o segundo atleta também", gustavoAfterBulk.body?.source === "individual" && gustavoAfterBulk.body?.effectiveAmountCents === 2800, JSON.stringify(gustavoAfterBulk.body));

const bulkAgain = await call(director, "PUT", "/api/athletes/fee", { athleteIds: ["ath_martim", "ath_gustavo"], amountCents: 3100 });
check("repetir actualiza, não duplica (200)", bulkAgain.status === 200, `${bulkAgain.status}`);
const martimEnrollCount = (await db.query(`SELECT count(*)::int n FROM "Enrollment" WHERE "athleteId" = 'ath_martim' AND "endsOn" IS NULL`)).rows[0].n;
check("continua a haver só uma inscrição activa por atleta", martimEnrollCount === 1, `${martimEnrollCount}`);

const bulkWithMissing = await call(director, "PUT", "/api/athletes/fee", { athleteIds: ["ath_martim", "ath_nao_existe"], amountCents: 3200 });
check("um id inexistente aparece em 'missing', não bloqueia o resto", bulkWithMissing.status === 200 && bulkWithMissing.body?.missing?.includes("ath_nao_existe") && bulkWithMissing.body?.updated?.includes("ath_martim"), JSON.stringify(bulkWithMissing.body));

const coachBulk = await call(coach, "PUT", "/api/athletes/fee", { athleteIds: ["ath_martim"], amountCents: 3000 });
check("um treinador não ajusta em lote (403)", coachBulk.status === 403, `${coachBulk.status}`);

const emptyBulk = await call(director, "PUT", "/api/athletes/fee", { athleteIds: [], amountCents: 3000 });
check("lista vazia recusada (400)", emptyBulk.status === 400, `${emptyBulk.status}`);

console.log("\n=== Limpeza ===");
await cleanup();
await db.end();
console.log("  feito");

console.log(`\n${ok} passaram, ${bad} falharam`);
process.exit(bad === 0 ? 0 : 1);

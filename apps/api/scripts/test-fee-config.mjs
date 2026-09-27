#!/usr/bin/env node
/**
 * Configuração de mensalidades — preço por equipa e ajuste individual.
 *
 * O que interessa: só `billing:write` (direção) configura; `billing:read`
 * (direção + o próprio encarregado) lê; o preço da equipa é a omissão, o ajuste
 * individual sobrepõe-se-lhe; reverter volta ao preço da equipa; e um treinador
 * sem `billing:read` não vê preços em `/api/teams`.
 *
 * E o preço por modalidade: o ajuste individual é de uma modalidade, e um
 * atleta em duas modalidades paga a soma. Para isso cria uma equipa temporária
 * noutra modalidade do Life Club (`zz_t_fee_2mod`), põe lá o Martim, e apaga
 * tudo no fim.
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

/*
 * Estado limpo — e só o que é deste teste.
 *
 * A segunda linha apagava `name LIKE 'Individual — %'` sem mais nenhuma
 * condição: **todos** os planos individuais da base, incluindo os que a academia
 * criou a sério pela aplicação. Só não chegou a acontecer porque a chave
 * estrangeira da inscrição o travou — e o que este teste dava era um
 * rebentamento na limpeza, não um aviso de que estava prestes a apagar dados de
 * alguém.
 *
 * Agora só desaparece o que fica sem dono depois de apagadas as inscrições dos
 * dois atletas de teste: um plano individual sem inscrição nenhuma é lixo desta
 * corrida; um plano com inscrição é de uma pessoa.
 */
/*
 * O preço da equipa **repõe-se**, não se apaga.
 *
 * `sp."teamId" = 't_sub11'` estava na mesma cláusula de apagar, e o Sub-11 é uma
 * equipa a sério do clube de demonstração: correr este teste deixava-a sem preço
 * nenhum. Ninguém dava por isso enquanto não corresse outro teste a seguir — e
 * quando deu, o que se via era o teste seguinte a rebentar, não a causa.
 *
 * O que este teste faz ao preço do Sub-11 é mudá-lo várias vezes; o que tem de
 * deixar para trás é o valor com que o encontrou.
 */
const precoOriginalSub11 = (await db.query(
  `SELECT id, "amountCents" FROM "SubscriptionPlan"
    WHERE "teamId" = 't_sub11' AND "isActive" ORDER BY id DESC LIMIT 1`,
)).rows[0] ?? null;

const cleanup = async () => {
  await db.query(`DELETE FROM "Enrollment" WHERE "athleteId" IN ('ath_martim', 'ath_gustavo')`);
  // A segunda modalidade: a passagem, o preço e a equipa temporária.
  await db.query(`DELETE FROM "TeamMembership" WHERE "teamId" = 'zz_t_fee_2mod'`);
  await db.query(`DELETE FROM "SubscriptionPlan" WHERE "teamId" = 'zz_t_fee_2mod'`);
  await db.query(`DELETE FROM "Team" WHERE id = 'zz_t_fee_2mod'`);
  // Os planos individuais órfãos desta corrida — um plano com inscrição é de
  // uma pessoa, e fica.
  await db.query(`
    DELETE FROM "SubscriptionPlan" sp
     WHERE sp.name LIKE 'Individual — %'
       AND NOT EXISTS (SELECT 1 FROM "Enrollment" e WHERE e."planId" = sp.id)`);

  if (precoOriginalSub11) {
    await db.query(`UPDATE "SubscriptionPlan" SET "amountCents" = $1 WHERE id = $2`, [
      precoOriginalSub11.amountCents, precoOriginalSub11.id,
    ]);
  } else {
    // Não havia preço à entrada: o que este teste criou é que é lixo.
    await db.query(`DELETE FROM "SubscriptionPlan" WHERE "teamId" = 't_sub11'`);
  }
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

// A modalidade do Sub-11 — o ajuste individual diz sempre de que modalidade é.
const sub11 = (await db.query(`SELECT "academyId", "sportId", "seasonId" FROM "Team" WHERE id = 't_sub11'`)).rows[0];
const fut = sub11.sportId;

console.log("\n=== Um atleta sem ajuste paga o preço da equipa ===");
const feeBefore = await call(director, "GET", "/api/athletes/ath_martim/fee");
check("o valor efectivo é o da equipa", feeBefore.body?.effectiveAmountCents === 4200, JSON.stringify(feeBefore.body));
const futBefore = feeBefore.body?.modalidades?.find((m) => m.sportId === fut);
check(
  "uma linha por modalidade, com o preço da equipa e sem individual",
  feeBefore.body?.modalidades?.length === 1 && futBefore?.teamAmountCents === 4200 && futBefore?.individualAmountCents === null,
  JSON.stringify(feeBefore.body?.modalidades),
);
check("o encarregado do próprio atleta lê o mesmo", (await call(parentOwn, "GET", "/api/athletes/ath_martim/fee")).status === 200);
check("outro encarregado não lê (403)", (await call(parentOther, "GET", "/api/athletes/ath_martim/fee")).status === 403);

console.log("\n=== Ajuste individual sobrepõe-se, na modalidade dele ===");
const semModalidade = await call(director, "PUT", "/api/athletes/ath_martim/fee", { amountCents: 3000 });
check("sem modalidade é recusado a quem tem equipa (400)", semModalidade.status === 400, `${semModalidade.status}`);
const outraModalidade = await call(director, "PUT", "/api/athletes/ath_martim/fee", { amountCents: 3000, sportId: "nao_existe" });
check("numa modalidade que ele não pratica é recusado (400)", outraModalidade.status === 400, `${outraModalidade.status}`);

const setIndividual = await call(director, "PUT", "/api/athletes/ath_martim/fee", { amountCents: 3000, sportId: fut });
check("a direção ajusta individualmente (200)", setIndividual.status === 200 && setIndividual.body?.amountCents === 3000, JSON.stringify(setIndividual.body));

const feeAfter = await call(director, "GET", "/api/athletes/ath_martim/fee");
const futAfter = feeAfter.body?.modalidades?.find((m) => m.sportId === fut);
check("o valor efectivo é o individual", feeAfter.body?.effectiveAmountCents === 3000, `${feeAfter.body?.effectiveAmountCents}`);
check(
  "o preço da equipa continua visível para comparação",
  futAfter?.teamAmountCents === 4200 && futAfter?.individualAmountCents === 3000,
  JSON.stringify(futAfter),
);
const planoCriado = (await db.query(
  `SELECT sp."sportId" FROM "Enrollment" e JOIN "SubscriptionPlan" sp ON sp.id = e."planId"
    WHERE e."athleteId" = 'ath_martim' AND e."endsOn" IS NULL`,
)).rows;
check("o plano individual guarda a modalidade", planoCriado.length === 1 && planoCriado[0].sportId === fut, JSON.stringify(planoCriado));

const coachSetIndividual = await call(coach, "PUT", "/api/athletes/ath_martim/fee", { amountCents: 1000, sportId: fut });
check("um treinador não ajusta individualmente (403)", coachSetIndividual.status === 403, `${coachSetIndividual.status}`);

console.log("\n=== Ajustar outra vez actualiza, não duplica ===");
const setIndividualAgain = await call(director, "PUT", "/api/athletes/ath_martim/fee", { amountCents: 3500, sportId: fut });
check("actualiza o valor (200)", setIndividualAgain.status === 200 && setIndividualAgain.body?.amountCents === 3500, `${setIndividualAgain.status}`);
const enrollCount = (await db.query(`SELECT count(*)::int n FROM "Enrollment" WHERE "athleteId" = 'ath_martim' AND ("endsOn" IS NULL)`)).rows[0].n;
check("continua a haver só uma inscrição activa", enrollCount === 1, `${enrollCount}`);

console.log("\n=== Validação de forma ===");
const badAmount = await call(director, "PUT", "/api/athletes/ath_martim/fee", { amountCents: 25, sportId: fut });
check("valor entre zero e um euro recusado (400)", badAmount.status === 400, `${badAmount.status}`);
const hugeAmount = await call(director, "PATCH", "/api/teams/t_sub11/fee", { amountCents: 999_999 });
check("valor absurdo recusado (400)", hugeAmount.status === 400, `${hugeAmount.status}`);

console.log("\n=== Duas modalidades: paga a soma ===");
const outra = (await db.query(
  `SELECT id FROM "Sport" WHERE "academyId" = $1 AND id <> $2 ORDER BY name LIMIT 1`,
  [sub11.academyId, fut],
)).rows[0];
if (!outra) {
  check("o Life Club tem uma segunda modalidade para o teste", false, "só há uma");
} else {
  await db.query(
    `INSERT INTO "Team" (id, "academyId", "sportId", "seasonId", name, "maxAge", "updatedAt")
     VALUES ('zz_t_fee_2mod', $1, $2, $3, 'ZZ Segunda Modalidade', 13, NOW())`,
    [sub11.academyId, outra.id, sub11.seasonId],
  );
  await db.query(`INSERT INTO "TeamMembership" (id, "teamId", "athleteId") VALUES ('zz_tm_fee_2mod', 'zz_t_fee_2mod', 'ath_martim')`);

  const semPrecoNaSegunda = await call(director, "GET", "/api/athletes/ath_martim/fee");
  const segunda = semPrecoNaSegunda.body?.modalidades?.find((m) => m.sportId === outra.id);
  check("a segunda modalidade aparece, por configurar", segunda && segunda.amountCents === null, JSON.stringify(semPrecoNaSegunda.body?.modalidades));
  check("sem preço, a segunda não entra na soma", semPrecoNaSegunda.body?.effectiveAmountCents === 3500, `${semPrecoNaSegunda.body?.effectiveAmountCents}`);

  const precoSegunda = await call(director, "PATCH", "/api/teams/zz_t_fee_2mod/fee", { amountCents: 2000, aplicarEm: "proximo" });
  check("a direção define o preço da equipa da segunda modalidade (200)", precoSegunda.status === 200, JSON.stringify(precoSegunda.body));
  const soma = await call(director, "GET", "/api/athletes/ath_martim/fee");
  check("paga a soma: 35 € individual numa + 20 € da equipa na outra", soma.body?.effectiveAmountCents === 5500, `${soma.body?.effectiveAmountCents}`);

  const ajusteSegunda = await call(director, "PUT", "/api/athletes/ath_martim/fee", { amountCents: 1500, sportId: outra.id, aplicarEm: "proximo" });
  check("ajuste individual na segunda modalidade (200)", ajusteSegunda.status === 200, JSON.stringify(ajusteSegunda.body));
  const soma2 = await call(director, "GET", "/api/athletes/ath_martim/fee");
  check("o ajuste de uma modalidade não mexe na outra: 35 + 15", soma2.body?.effectiveAmountCents === 5000, `${soma2.body?.effectiveAmountCents}`);
  const vivos = (await db.query(`SELECT count(*)::int n FROM "Enrollment" WHERE "athleteId" = 'ath_martim' AND "endsOn" IS NULL`)).rows[0].n;
  check("uma inscrição activa por modalidade (2)", vivos === 2, `${vivos}`);

  const tiraSegunda = await call(director, "DELETE", `/api/athletes/ath_martim/fee?sportId=${outra.id}`);
  check("tirar o ajuste de uma modalidade (200)", tiraSegunda.status === 200 && tiraSegunda.body?.cleared === true, `${tiraSegunda.status}`);
  const soma3 = await call(director, "GET", "/api/athletes/ath_martim/fee");
  check("essa modalidade volta ao preço da equipa, a outra fica: 35 + 20", soma3.body?.effectiveAmountCents === 5500, `${soma3.body?.effectiveAmountCents}`);

  // Sai da segunda modalidade para o resto do teste voltar a ser de uma só.
  await db.query(`DELETE FROM "TeamMembership" WHERE "teamId" = 'zz_t_fee_2mod'`);
}

console.log("\n=== Reverter para o preço da equipa ===");
const clear = await call(director, "DELETE", `/api/athletes/ath_martim/fee?sportId=${fut}`);
check("a direção reverte o ajuste (200)", clear.status === 200 && clear.body?.cleared === true, `${clear.status}`);
const feeReverted = await call(director, "GET", "/api/athletes/ath_martim/fee");
check(
  "volta a pagar o preço da equipa",
  feeReverted.body?.effectiveAmountCents === 4200 && feeReverted.body?.modalidades?.[0]?.individualAmountCents === null,
  JSON.stringify(feeReverted.body),
);
const endedEnroll = (await db.query(`SELECT "endsOn" FROM "Enrollment" WHERE "athleteId" = 'ath_martim' ORDER BY "startsOn" DESC LIMIT 1`)).rows[0];
check("a inscrição individual ficou terminada, não apagada (histórico)", endedEnroll && endedEnroll.endsOn !== null, JSON.stringify(endedEnroll));

console.log("\n=== O ajuste para vários atletas de uma vez deixou de existir ===");
const bulk = await call(director, "PUT", "/api/athletes/fee", { athleteIds: ["ath_martim", "ath_gustavo"], amountCents: 2800 });
check("PUT /api/athletes/fee já não aplica nada (404)", bulk.status === 404, `${bulk.status}`);

console.log("\n=== Limpeza ===");
await cleanup();
await db.end();
console.log("  feito");

console.log(`\n${ok} passaram, ${bad} falharam`);
process.exit(bad === 0 ? 0 : 1);

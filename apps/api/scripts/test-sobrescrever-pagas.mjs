#!/usr/bin/env node
/**
 * Lançar por pagar num mês em que alguém já pagou pergunta antes.
 *
 * O pedido: "lanço Outubro por pagar para todos, e alguém já pagou Outubro;
 * depois de clicar em Lançar tem de aparecer outro popup a perguntar se quer
 * sobrescrever o pagamento."
 *
 * - sem `sobrescreverPagas`, e havendo pagas à mão: a resposta é
 *   `porConfirmar` (quem, que mês, que valor) e **nada** se grava;
 * - `false`: as pagas ficam, lança-se aos outros;
 * - `true`: as pagas à mão voltam a por pagar, com o valor do lançamento, e o
 *   pagamento manual fica `REFUNDED`;
 * - pagas online (euPago) nunca entram na pergunta nem se sobrescrevem;
 * - lançar **como pagas** não pergunta nada, como antes.
 *
 * Num clube descartável, atletas sem encarregado (ninguém é avisado). Nunca
 * chama a euPago.
 *
 * Uso: node scripts/test-sobrescrever-pagas.mjs   (API_URL opcional)
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
const API = process.env.API_URL ?? "http://127.0.0.1:3000";

let ok = 0;
let bad = 0;
const check = (l, c, d = "") => {
  if (c) {
    ok++;
    console.log("  OK    " + l);
  } else {
    bad++;
    console.log("  FALHA " + l + (d ? " — " + d : ""));
  }
};

const login = async (email) =>
  (
    await (
      await fetch(`${S}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: { apikey: A, "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: "academia2026" }),
      })
    ).json()
  ).access_token;

const Z = "zs-teste-sobrescrever";
const ZS = "zs_academia";
const call = async (token, method, pathname, body) => {
  const r = await fetch(API + pathname, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "x-academy-slug": Z,
      "x-app": "console",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};

const db = new pg.Client({ connectionString: env("MIGRATE_DATABASE_URL"), ssl: { rejectUnauthorized: false } });
await db.connect();

const agora = new Date();
const ANO_EPOCA = agora.getMonth() + 1 >= 8 ? agora.getFullYear() : agora.getFullYear() - 1;
const OUTUBRO = `${ANO_EPOCA}-10`;
const TODOS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

const direcaoUser = (await db.query(`SELECT id FROM "User" WHERE email = 'direcao@lifeclub.pt'`)).rows[0];

const limpar = async () => {
  await db.query(`DELETE FROM "Notification" WHERE "academyId" = $1`, [ZS]);
  await db.query(`DELETE FROM "Payment" WHERE "chargeId" IN (SELECT id FROM "Charge" WHERE "academyId" = $1)`, [ZS]);
  await db.query(`DELETE FROM "ChargeSkip" WHERE "academyId" = $1`, [ZS]);
  await db.query(`DELETE FROM "Charge" WHERE "academyId" = $1`, [ZS]);
  await db.query(`DELETE FROM "TeamMembership" WHERE "athleteId" LIKE 'zs_%'`);
  await db.query(`DELETE FROM "SubscriptionPlan" WHERE "academyId" = $1`, [ZS]);
  await db.query(`DELETE FROM "Athlete" WHERE "academyId" = $1`, [ZS]);
  await db.query(`DELETE FROM "Team" WHERE "academyId" = $1`, [ZS]);
  await db.query(`DELETE FROM "Season" WHERE "academyId" = $1`, [ZS]);
  await db.query(`DELETE FROM "LegalAcceptance" WHERE "academyId" = $1`, [ZS]).catch(() => undefined);
  await db.query(`DELETE FROM "Membership" WHERE "academyId" = $1`, [ZS]);
  await db.query(`DELETE FROM "Sport" WHERE "academyId" = $1`, [ZS]);
  await db.query(`DELETE FROM "Academy" WHERE id = $1`, [ZS]);
};
await limpar();

const estado = async (athleteId) =>
  (await db.query(`SELECT id, status, "amountCents" FROM "Charge" WHERE "athleteId" = $1 AND period = $2 AND kind = 'FEE'`, [athleteId, OUTUBRO])).rows[0] ?? null;
const pagamento = async (id) => (await db.query(`SELECT status FROM "Payment" WHERE id = $1`, [id])).rows[0]?.status ?? null;
const quantas = async () => (await db.query(`SELECT count(*)::int n FROM "Charge" WHERE "academyId" = $1`, [ZS])).rows[0].n;

try {
  /* ------------------------------------------------ o clube descartável --- */
  await db.query(
    `INSERT INTO "Academy" (id, slug, name, "shortName", status, "billingDueDay", "billingMonths", "updatedAt")
     VALUES ($1, $2, 'ZS Teste Sobrescrever', 'ZS', 'ACTIVE', 8, $3, now())`, [ZS, Z, TODOS],
  );
  await db.query(`INSERT INTO "Sport" (id, "academyId", name, positions, skills) VALUES ('zs_sport', $1, 'Futebol', ARRAY[]::text[], ARRAY[]::text[])`, [ZS]);
  await db.query(`INSERT INTO "Season" (id, "academyId", label, "startsOn", "endsOn", "isCurrent") VALUES ('zs_season', $1, 'época', $2::date, ($2::date + interval '1 year' - interval '1 day'), true)`, [ZS, `${ANO_EPOCA}-08-01`]);
  await db.query(`INSERT INTO "Team" (id, "academyId", "sportId", "seasonId", name, "maxAge", "updatedAt") VALUES ('zs_team', $1, 'zs_sport', 'zs_season', 'ZS Sub-13', 13, now())`, [ZS]);
  await db.query(`INSERT INTO "SubscriptionPlan" (id, "academyId", "teamId", name, "amountCents", "isActive") VALUES ('zs_plan', $1, 'zs_team', 'ZS Plano', 3500, true)`, [ZS]);
  for (const [id, nome] of [["zs_a", "ZS Ana"], ["zs_b", "ZS Bruno"], ["zs_c", "ZS Carla"], ["zs_d", "ZS Duarte"]]) {
    await db.query(`INSERT INTO "Athlete" (id, "academyId", name, birthdate, status, "joinedAt", "updatedAt") VALUES ($1, $2, $3, '2013-05-05', 'ACTIVE', '2024-01-10', now())`, [id, ZS, nome]);
    await db.query(`INSERT INTO "TeamMembership" (id, "teamId", "athleteId") VALUES ($1, 'zs_team', $2)`, [`${id}_tm`, id]);
  }
  await db.query(`INSERT INTO "Membership" (id, "academyId", "userId", role, "isActive", "updatedAt") VALUES ('zs_memb', $1, $2, 'OWNER', true, now())`, [ZS, direcaoUser.id]);

  /* Ana pagou à mão (2000), Bruno pagou online, Duarte tem por pagar, Carla não tem nada. */
  const cobranca = (id, athleteId, status, valor) =>
    db.query(
      `INSERT INTO "Charge" (id, "academyId", "athleteId", kind, period, slot, "amountCents", "dueDate", status, "settledAt", "updatedAt")
       VALUES ($1, $2, $3, 'FEE', $4, '', $5, ($4 || '-08')::date, $6, ${status === "SETTLED" ? "now()" : "NULL"}, now())`,
      [id, ZS, athleteId, OUTUBRO, valor, status],
    );
  await cobranca("zs_ch_a", "zs_a", "SETTLED", 2000);
  await db.query(`INSERT INTO "Payment" (id, "chargeId", "amountCents", method, status, provider, "paidAt", "updatedAt") VALUES ('zs_pay_a', 'zs_ch_a', 2000, 'CASH', 'PAID', 'manual', now(), now())`);
  await cobranca("zs_ch_b", "zs_b", "SETTLED", 3500);
  await db.query(`INSERT INTO "Payment" (id, "chargeId", "amountCents", method, status, provider, "providerRef", "paidAt", "updatedAt") VALUES ('zs_pay_b', 'zs_ch_b', 3500, 'MULTIBANCO', 'PAID', 'eupago', 'zs_ref_b', now(), now())`);
  await cobranca("zs_ch_d", "zs_d", "OPEN", 3500);

  const director = await login("direcao@lifeclub.pt");
  const pend = ((await call(director, "GET", "/api/legal/status")).body?.pending ?? []).map((d) => d.id);
  if (pend.length) {
    const aceite = await call(director, "POST", "/api/legal/accept", { documentIds: pend, confirmAuthority: true });
    check("(preparação) termos do clube aceites", aceite.status === 200 || aceite.status === 201, `${aceite.status}`);
  }

  console.log("=== Primeira ida: pergunta, não grava ===");
  const antes = await quantas();
  const pergunta = await call(director, "POST", "/api/charges/mensalidade", { alvo: "todos", periods: [OUTUBRO] });
  check("responde (2xx)", pergunta.status === 201 || pergunta.status === 200, `${pergunta.status} ${JSON.stringify(pergunta.body).slice(0, 160)}`);
  const lista = pergunta.body?.porConfirmar ?? [];
  check("traz porConfirmar", Array.isArray(pergunta.body?.porConfirmar), JSON.stringify(pergunta.body).slice(0, 160));
  check("só com a Ana (paga à mão)", lista.length === 1 && lista[0].athleteId === "zs_a", JSON.stringify(lista));
  check("com nome, mês e valor pago", lista[0]?.name === "ZS Ana" && lista[0]?.period === OUTUBRO && lista[0]?.amountCents === 2000, JSON.stringify(lista[0]));
  check("o Bruno (pago online) não entra na pergunta", !lista.some((l) => l.athleteId === "zs_b"));
  check("e nada foi gravado — a Carla continua sem mensalidade", (await quantas()) === antes && (await estado("zs_c")) === null);

  console.log("\n=== Manter pagas ===");
  const manter = await call(director, "POST", "/api/charges/mensalidade", { alvo: "todos", periods: [OUTUBRO], sobrescreverPagas: false });
  check("responde (2xx) sem nova pergunta", (manter.status === 201 || manter.status === 200) && !manter.body?.porConfirmar, JSON.stringify(manter.body).slice(0, 160));
  check("lança à Carla", manter.body?.criadas === 1 && (await estado("zs_c"))?.status === "OPEN", JSON.stringify(manter.body));
  check("a Ana continua paga", (await estado("zs_a"))?.status === "SETTLED");
  check("e o resultado diz que havia pagas", (manter.body?.jaPagas ?? []).includes(OUTUBRO), JSON.stringify(manter.body?.jaPagas));
  check("nada reaberto", !manter.body?.reabertas, `${manter.body?.reabertas}`);

  console.log("\n=== Sobrescrever ===");
  const sobrescrever = await call(director, "POST", "/api/charges/mensalidade", { alvo: "todos", periods: [OUTUBRO], sobrescreverPagas: true });
  check("responde (2xx)", sobrescrever.status === 201 || sobrescrever.status === 200, `${sobrescrever.status} ${JSON.stringify(sobrescrever.body).slice(0, 160)}`);
  check("reabre uma", sobrescrever.body?.reabertas === 1, JSON.stringify(sobrescrever.body));
  const ana = await estado("zs_a");
  check("a Ana volta a estar por pagar", ana?.status === "OPEN", JSON.stringify(ana));
  check("com o valor do lançamento (preço da equipa, 35 €)", ana?.amountCents === 3500, JSON.stringify(ana));
  check("o pagamento à mão fica REFUNDED", (await pagamento("zs_pay_a")) === "REFUNDED");
  check("o Bruno (pago online) não se mexe", (await estado("zs_b"))?.status === "SETTLED" && (await pagamento("zs_pay_b")) === "PAID");
  check("o Duarte (já por pagar) fica como estava", (await estado("zs_d"))?.status === "OPEN");

  console.log("\n=== Um atleta pago online, sozinho ===");
  const soBruno = await call(director, "POST", "/api/charges/mensalidade", { alvo: "atletas", athleteIds: ["zs_b"], periods: [OUTUBRO] });
  check("não pergunta nada", !soBruno.body?.porConfirmar, JSON.stringify(soBruno.body).slice(0, 160));
  check("e diz que já estava pago", (soBruno.body?.jaPagas ?? []).includes(OUTUBRO), JSON.stringify(soBruno.body));

  console.log("\n=== Lançar como pagas continua sem pergunta ===");
  const comoPagas = await call(director, "POST", "/api/charges/mensalidade", { alvo: "todos", periods: [OUTUBRO], estado: "SETTLED", metodo: "CASH" });
  check("não pergunta", !comoPagas.body?.porConfirmar, JSON.stringify(comoPagas.body).slice(0, 160));
  check("e marca as por pagar como pagas", comoPagas.body?.marcadas === 3 && (await estado("zs_a"))?.status === "SETTLED", JSON.stringify(comoPagas.body));
} finally {
  console.log("\n=== Limpeza ===");
  await limpar();
  check("tudo apagado", (await db.query(`SELECT count(*)::int n FROM "Academy" WHERE id = $1`, [ZS])).rows[0].n === 0);
  await db.end();
}

console.log(`\n${ok} OK · ${bad} falhas`);
process.exit(bad === 0 ? 0 : 1);

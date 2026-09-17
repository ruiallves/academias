#!/usr/bin/env node
/**
 * Uma mensalidade de 0 € nasce paga.
 *
 * O pedido: "deve ser possível um atleta ter mensalidades de 0 €, e se lançar
 * mensalidades como por pagar, esses com 0 € aparecem logo como pagas."
 *
 * O caso real é o atleta isento — bolsa, filho de treinador, acordo com a
 * escola. Antes, 0 € era recusado ("Valor entre 1 € e 1000 €") e a alternativa
 * era não lhe pôr preço, o que o punha na lista de quem "falta configurar" para
 * sempre. Agora:
 *
 * - 0 € vale como preço de equipa, como ajuste individual e a lançar à mão;
 * - a mensalidade nasce `SETTLED`, **sem** registo de pagamento (não entrou
 *   dinheiro nenhum);
 * - a família não é avisada de nada;
 * - baixar o preço a 0 € liquida a mensalidade do mês que estava por pagar;
 * - uma cobrança avulsa de 0 € continua recusada: é dinheiro que não se pede.
 *
 * Num clube descartável, atletas sem encarregado. Uso:
 *   node scripts/test-mensalidade-zero.mjs   (API_URL opcional)
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

const Z = "zz-teste-zero";
const ZZ = "zz_zero_academia";
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
const PERIODO = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, "0")}`;
const MES = agora.getMonth() + 1;
const OUTRO = MES === 12 ? `${agora.getFullYear()}-01` : `${agora.getFullYear()}-${String(MES + 1).padStart(2, "0")}`;
const TODOS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

const direcaoUser = (await db.query(`SELECT id FROM "User" WHERE email = 'direcao@lifeclub.pt'`)).rows[0];

const limpar = async () => {
  await db.query(`DELETE FROM "Notification" WHERE "academyId" = $1`, [ZZ]);
  await db.query(`DELETE FROM "Payment" WHERE "chargeId" IN (SELECT id FROM "Charge" WHERE "academyId" = $1)`, [ZZ]);
  await db.query(`DELETE FROM "ChargeSkip" WHERE "academyId" = $1`, [ZZ]);
  await db.query(`DELETE FROM "Charge" WHERE "academyId" = $1`, [ZZ]);
  await db.query(`DELETE FROM "Enrollment" WHERE "athleteId" LIKE 'zzz_%'`);
  await db.query(`DELETE FROM "TeamMembership" WHERE "athleteId" LIKE 'zzz_%'`);
  await db.query(`DELETE FROM "SubscriptionPlan" WHERE "academyId" = $1`, [ZZ]);
  await db.query(`DELETE FROM "Athlete" WHERE "academyId" = $1`, [ZZ]);
  await db.query(`DELETE FROM "Team" WHERE "academyId" = $1`, [ZZ]);
  await db.query(`DELETE FROM "Season" WHERE "academyId" = $1`, [ZZ]);
  await db.query(`DELETE FROM "LegalAcceptance" WHERE "academyId" = $1`, [ZZ]).catch(() => undefined);
  await db.query(`DELETE FROM "Membership" WHERE "academyId" = $1`, [ZZ]);
  await db.query(`DELETE FROM "Sport" WHERE "academyId" = $1`, [ZZ]);
  await db.query(`DELETE FROM "Academy" WHERE id = $1`, [ZZ]);
};
await limpar();

const cobranca = async (athleteId, period = PERIODO) =>
  (await db.query(
    `SELECT c.id, c.status, c."amountCents", c."settledAt",
            (SELECT count(*)::int FROM "Payment" p WHERE p."chargeId" = c.id) pagamentos
       FROM "Charge" c WHERE c."athleteId" = $1 AND c.period = $2 AND c.kind = 'FEE'`,
    [athleteId, period],
  )).rows[0] ?? null;
const avisos = async () =>
  (await db.query(`SELECT count(*)::int n FROM "Notification" WHERE "academyId" = $1`, [ZZ])).rows[0].n;

try {
  /* ------------------------------------------------ o clube descartável --- */
  await db.query(
    `INSERT INTO "Academy" (id, slug, name, "shortName", status, "billingDueDay", "billingMonths", "updatedAt")
     VALUES ($1, $2, 'ZZ Teste Zero', 'ZZ', 'ACTIVE', 8, $3, now())`, [ZZ, Z, TODOS],
  );
  await db.query(`INSERT INTO "Sport" (id, "academyId", name, positions, skills) VALUES ('zzz_sport', $1, 'Futebol', ARRAY[]::text[], ARRAY[]::text[])`, [ZZ]);
  await db.query(`INSERT INTO "Season" (id, "academyId", label, "startsOn", "endsOn", "isCurrent") VALUES ('zzz_season', $1, 'época', '2026-08-01', '2027-07-31', true)`, [ZZ]);
  await db.query(`INSERT INTO "Team" (id, "academyId", "sportId", "seasonId", name, "maxAge", "updatedAt") VALUES ('zzz_team', $1, 'zzz_sport', 'zzz_season', 'ZZ Sub-13', 13, now())`, [ZZ]);
  for (const [id, nome] of [["zzz_isento", "ZZ Isento"], ["zzz_normal", "ZZ Normal"], ["zzz_bolsa", "ZZ Bolseiro"]]) {
    await db.query(`INSERT INTO "Athlete" (id, "academyId", name, birthdate, status, "joinedAt", "updatedAt") VALUES ($1, $2, $3, '2013-05-05', 'ACTIVE', '2024-01-10', now())`, [id, ZZ, nome]);
    await db.query(`INSERT INTO "TeamMembership" (id, "teamId", "athleteId") VALUES ($1, 'zzz_team', $2)`, [`${id}_tm`, id]);
  }
  await db.query(`INSERT INTO "Membership" (id, "academyId", "userId", role, "isActive", "updatedAt") VALUES ('zzz_memb', $1, $2, 'OWNER', true, now())`, [ZZ, direcaoUser.id]);

  const director = await login("direcao@lifeclub.pt");
  const pend = ((await call(director, "GET", "/api/legal/status")).body?.pending ?? []).map((d) => d.id);
  if (pend.length) {
    const aceite = await call(director, "POST", "/api/legal/accept", { documentIds: pend, confirmAuthority: true });
    check("(preparação) termos do clube aceites", aceite.status === 200 || aceite.status === 201, `${aceite.status}`);
  }

  console.log("=== Preço da equipa a 0 € ===");
  const equipa = await call(director, "PATCH", "/api/teams/zzz_team/fee", { amountCents: 0, aplicarEm: "atual" });
  check("a equipa aceita 0 € (2xx)", equipa.status === 200 || equipa.status === 201, `${equipa.status} ${JSON.stringify(equipa.body).slice(0, 140)}`);
  const doIsento = await cobranca("zzz_isento");
  check("a mensalidade do mês nasceu", Boolean(doIsento), "não nasceu nenhuma");
  check("a 0 €", doIsento?.amountCents === 0, `${doIsento?.amountCents}`);
  check("e já paga", doIsento?.status === "SETTLED", `${doIsento?.status}`);
  check("com data de liquidação", Boolean(doIsento?.settledAt));
  check("sem registo de pagamento", doIsento?.pagamentos === 0, `${doIsento?.pagamentos}`);
  check("e sem avisar a família", (await avisos()) === 0, `${await avisos()}`);

  console.log("\n=== Lançar por pagar a quem tem 0 € ===");
  await db.query(`DELETE FROM "Charge" WHERE "academyId" = $1 AND "athleteId" = 'zzz_normal'`, [ZZ]);
  const lancar = await call(director, "POST", "/api/charges/mensalidade", {
    alvo: "atletas", athleteIds: ["zzz_normal"], amountCents: 0, periods: [OUTRO],
  });
  check("lança (2xx)", lancar.status === 200 || lancar.status === 201, `${lancar.status} ${JSON.stringify(lancar.body).slice(0, 140)}`);
  check("conta como criada", lancar.body?.criadas === 1, JSON.stringify(lancar.body));
  const lancada = await cobranca("zzz_normal", OUTRO);
  check("nasce paga, apesar de se ter pedido por pagar", lancada?.status === "SETTLED", `${lancada?.status}`);
  check("sem pagamento registado", lancada?.pagamentos === 0, `${lancada?.pagamentos}`);
  check("e ninguém avisado", lancar.body?.avisados === 0, `${lancar.body?.avisados}`);

  console.log("\n=== Baixar o preço de um atleta a 0 € ===");
  /* Primeiro com preço a sério, para haver uma por pagar. */
  await call(director, "PATCH", "/api/teams/zzz_team/fee", { amountCents: 3500, aplicarEm: "atual" });
  await db.query(`DELETE FROM "Charge" WHERE "academyId" = $1 AND "athleteId" = 'zzz_bolsa'`, [ZZ]);
  await call(director, "POST", `/api/charges/gerar?periodo=${PERIODO}`);
  const antes = await cobranca("zzz_bolsa");
  check("(preparação) tem mensalidade por pagar", antes?.status === "OPEN" && antes?.amountCents === 3500, JSON.stringify(antes));

  const bolsa = await call(director, "PUT", "/api/athletes/zzz_bolsa/fee", { amountCents: 0, aplicarEm: "atual" });
  check("o ajuste individual aceita 0 € (2xx)", bolsa.status === 200 || bolsa.status === 201, `${bolsa.status} ${JSON.stringify(bolsa.body).slice(0, 140)}`);
  const depois = await cobranca("zzz_bolsa");
  check("a mensalidade do mês passa a 0 €", depois?.amountCents === 0, `${depois?.amountCents}`);
  check("e a pagas", depois?.status === "SETTLED", `${depois?.status}`);
  check("sem inventar um pagamento", depois?.pagamentos === 0, `${depois?.pagamentos}`);

  console.log("\n=== Marcar como paga uma de 0 € não cria pagamento ===");
  await db.query(`UPDATE "Charge" SET status = 'OPEN', "settledAt" = NULL WHERE id = $1`, [depois.id]);
  const marcar = await call(director, "PATCH", `/api/charges/${depois.id}/status`, { status: "SETTLED", method: "CASH" });
  check("marca (2xx)", marcar.status === 200 || marcar.status === 201, `${marcar.status}`);
  const marcada = await cobranca("zzz_bolsa");
  check("fica paga", marcada?.status === "SETTLED", `${marcada?.status}`);
  check("e continua sem pagamento", marcada?.pagamentos === 0, `${marcada?.pagamentos}`);

  console.log("\n=== O que continua recusado ===");
  const avulsa = await call(director, "POST", "/api/charges/avulsa", {
    athleteId: "zzz_normal", title: "ZZ Equipamento", amountCents: 0, dueDate: `${PERIODO}-20`,
  });
  check("uma avulsa de 0 € é recusada (400)", avulsa.status === 400, `${avulsa.status} ${avulsa.body?.message}`);
  const cinquenta = await call(director, "PUT", "/api/athletes/zzz_normal/fee", { amountCents: 50 });
  check("50 cêntimos continuam recusados (400)", cinquenta.status === 400, `${cinquenta.status} ${cinquenta.body?.message}`);
  check("e a mensagem diz o que se aceita", /0 €/.test(cinquenta.body?.message ?? ""), `${cinquenta.body?.message}`);

  console.log("\n=== A consola vê-as como pagas ===");
  const lista = await call(director, "GET", "/api/charges");
  const zeros = (lista.body ?? []).filter((c) => c.amountCents === 0);
  check("as de 0 € chegam à consola", zeros.length >= 2, `${zeros.length}`);
  check("todas como pagas", zeros.every((c) => c.status === "SETTLED"), JSON.stringify(zeros.map((c) => c.status)));
  check("e nenhuma vencida", zeros.every((c) => !c.overdue), JSON.stringify(zeros.map((c) => c.overdue)));
} finally {
  console.log("\n=== Limpeza ===");
  await limpar();
  check("tudo apagado", (await db.query(`SELECT count(*)::int n FROM "Academy" WHERE id = $1`, [ZZ])).rows[0].n === 0);
  await db.end();
}

console.log(`\n${ok} OK · ${bad} falhas`);
process.exit(bad === 0 ? 0 : 1);

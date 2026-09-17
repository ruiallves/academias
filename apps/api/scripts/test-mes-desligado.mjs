#!/usr/bin/env node
/**
 * Um mês desligado nos pagamentos não existe na plataforma.
 *
 * ## O pedido, dito duas vezes
 *
 * *"Tenho o mês de Agosto desligado nos pagamentos nas definições. Não quero
 * que seja possível lançar mensalidades para Agosto; Agosto ainda aparece nas
 * mensalidades e não deve; não deve ser possível ver Agosto nas mensalidades do
 * perfil do atleta. Tudo o que envolva Agosto não deve aparecer."*
 *
 * A emissão automática já respeitava o calendário (`gerarCobrancas`). O que
 * deixava Agosto à vista eram três portas:
 *
 * 1. **lançar à mão** (`createManualFees`) aceitava um mês desligado;
 * 2. **a avulsa** aceitava um vencimento num mês desligado, e punha lá o mês;
 * 3. **a limpeza ao desligar** poupava as mensalidades marcadas como pagas, e só
 *    olhava para os meses desligados naquele pedido — seis de Agosto, pagas,
 *    ficaram na ficha dos atletas e puseram Agosto no selector das Mensalidades.
 *
 * ## O que este teste guarda
 *
 * - lançar à mão e criar avulsa num mês desligado são recusados, **com o nome
 *   do mês** na mensagem, e não nasce linha nenhuma;
 * - a emissão e o botão "Gerar mensalidades" não criam nada no mês;
 * - gravar as definições esvazia **todos** os meses desligados da época: por
 *   pagar, anuladas, pagas sem pagamento, marcadas pagas à mão — tudo sai;
 * - só ficam as com **pagamento online** (dinheiro que passou pela euPago), e
 *   a resposta diz quantas; uma com referência Multibanco viva fica anulada, não
 *   apagada, para o webhook ter onde pousar o dinheiro;
 * - épocas passadas não se tocam;
 * - avulsas já existentes não se tocam (não são mensalidades);
 * - um mês ligado continua a funcionar.
 *
 * ## Onde corre
 *
 * Num clube descartável com um atleta sem encarregado. A direcção do Life Club
 * empresta a conta com uma membership de dono (OWNER), que é quem aceita os
 * termos de âmbito de clube. Nunca chama a euPago.
 *
 * Uso: node scripts/test-mes-desligado.mjs   (com a API em :3000)
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

const Z = "zm-teste-mes";
const ZM = "zm_academia";
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

const mm = (m) => String(m).padStart(2, "0");
const agora = new Date();
/* A época corrente abre em Agosto: o mês desligado do teste é o Agosto desta época. */
const ANO_EPOCA = agora.getMonth() + 1 >= 8 ? agora.getFullYear() : agora.getFullYear() - 1;
const AGOSTO = `${ANO_EPOCA}-08`;
const AGOSTO_PASSADO = `${ANO_EPOCA - 1}-08`;
/* Um mês ligado, da mesma época, para provar que o resto continua a funcionar. */
const SETEMBRO = `${ANO_EPOCA}-09`;
const TODOS_MENOS_AGOSTO = [1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12];

const direcaoUser = (await db.query(`SELECT id, "authId" FROM "User" WHERE email = 'direcao@lifeclub.pt'`)).rows[0];

const limpar = async () => {
  await db.query(`DELETE FROM "Notification" WHERE "academyId" = $1`, [ZM]);
  await db.query(`DELETE FROM "Payment" WHERE id LIKE 'zm_%'`);
  await db.query(`DELETE FROM "ChargeSkip" WHERE "academyId" = $1`, [ZM]);
  await db.query(`DELETE FROM "Charge" WHERE "academyId" = $1`, [ZM]);
  await db.query(`DELETE FROM "TeamMembership" WHERE "athleteId" LIKE 'zm_%'`);
  await db.query(`DELETE FROM "SubscriptionPlan" WHERE "academyId" = $1`, [ZM]);
  await db.query(`DELETE FROM "Athlete" WHERE "academyId" = $1`, [ZM]);
  await db.query(`DELETE FROM "Team" WHERE "academyId" = $1`, [ZM]);
  await db.query(`DELETE FROM "Season" WHERE "academyId" = $1`, [ZM]);
  await db.query(`DELETE FROM "LegalAcceptance" WHERE "academyId" = $1`, [ZM]).catch(() => undefined);
  await db.query(`DELETE FROM "Membership" WHERE "academyId" = $1`, [ZM]);
  await db.query(`DELETE FROM "Sport" WHERE "academyId" = $1`, [ZM]);
  await db.query(`DELETE FROM "Academy" WHERE id = $1`, [ZM]);
};
await limpar();

const cobranca = (id, period, status, { kind = "FEE", slot = "" } = {}) =>
  db.query(
    `INSERT INTO "Charge" (id, "academyId", "athleteId", kind, period, slot, "amountCents", "dueDate", status, "settledAt", "updatedAt")
     VALUES ($1, $2, 'zm_atleta', $3, $4, $5, 3500, ($4 || '-08')::date, $6, ${status === "SETTLED" ? "now()" : "NULL"}, now())`,
    [id, ZM, kind, period, slot, status],
  );
const pagamento = (id, chargeId, { status, provider = "eupago", expira = null }) =>
  db.query(
    `INSERT INTO "Payment" (id, "chargeId", "amountCents", method, status, provider, "providerRef", "expiresAt", "paidAt", "updatedAt")
     VALUES ($1, $2, 3500, 'MULTIBANCO', $3, $4, $1, ${expira ?? "NULL"}, ${status === "PAID" ? "now()" : "NULL"}, now())`,
    [id, chargeId, status, provider],
  );
const existe = async (id) => (await db.query(`SELECT status FROM "Charge" WHERE id = $1`, [id])).rows[0]?.status ?? null;
const noMes = async (period, kind = "FEE") =>
  (await db.query(`SELECT count(*)::int n FROM "Charge" WHERE "academyId" = $1 AND period = $2 AND kind = $3`, [ZM, period, kind])).rows[0].n;

try {
  /* ------------------------------------------------ o clube descartável --- */
  await db.query(
    `INSERT INTO "Academy" (id, slug, name, "shortName", status, "billingDueDay", "billingMonths", "updatedAt")
     VALUES ($1, $2, 'ZM Teste Mês', 'ZM', 'ACTIVE', 8, $3, now())`, [ZM, Z, TODOS_MENOS_AGOSTO],
  );
  await db.query(`INSERT INTO "Sport" (id, "academyId", name, positions, skills) VALUES ('zm_sport', $1, 'Futebol', ARRAY[]::text[], ARRAY[]::text[])`, [ZM]);
  await db.query(`INSERT INTO "Season" (id, "academyId", label, "startsOn", "endsOn", "isCurrent") VALUES ('zm_season', $1, 'época', $2::date, ($2::date + interval '1 year' - interval '1 day'), true)`, [ZM, `${ANO_EPOCA}-08-01`]);
  await db.query(`INSERT INTO "Team" (id, "academyId", "sportId", "seasonId", name, "maxAge", "updatedAt") VALUES ('zm_team', $1, 'zm_sport', 'zm_season', 'ZM Sub-13', 13, now())`, [ZM]);
  await db.query(`INSERT INTO "SubscriptionPlan" (id, "academyId", "teamId", name, "amountCents", "isActive") VALUES ('zm_plan', $1, 'zm_team', 'ZM Plano', 3500, true)`, [ZM]);
  await db.query(`INSERT INTO "Athlete" (id, "academyId", name, birthdate, status, "joinedAt", "updatedAt") VALUES ('zm_atleta', $1, 'ZM Atleta', '2013-05-05', 'ACTIVE', '2024-01-10', now())`, [ZM]);
  await db.query(`INSERT INTO "TeamMembership" (id, "teamId", "athleteId") VALUES ('zm_tm', 'zm_team', 'zm_atleta')`);
  await db.query(`INSERT INTO "Membership" (id, "academyId", "userId", role, "isActive", "updatedAt") VALUES ('zm_memb', $1, $2, 'OWNER', true, now())`, [ZM, direcaoUser.id]);

  const director = await login("direcao@lifeclub.pt");
  const pend = ((await call(director, "GET", "/api/legal/status")).body?.pending ?? []).map((d) => d.id);
  if (pend.length) {
    const aceite = await call(director, "POST", "/api/legal/accept", { documentIds: pend, confirmAuthority: true });
    check("(preparação) termos do clube aceites", aceite.status === 200 || aceite.status === 201, `${aceite.status}`);
  }

  /* ================================================= as portas de criação === */
  console.log("=== Lançar à mão num mês desligado ===");
  const manual = await call(director, "POST", "/api/charges/mensalidade", { athleteId: "zm_atleta", amountCents: 3500, periods: [AGOSTO] });
  check("recusado (400)", manual.status === 400, `${manual.status} ${JSON.stringify(manual.body).slice(0, 140)}`);
  check("a mensagem diz o nome do mês", /Agosto/.test(manual.body?.message ?? ""), `${manual.body?.message}`);
  check("e não nasceu linha nenhuma", (await noMes(AGOSTO)) === 0);

  const misto = await call(director, "POST", "/api/charges/mensalidade", { athleteId: "zm_atleta", amountCents: 3500, periods: [SETEMBRO, AGOSTO] });
  check("com um mês ligado pelo meio, recusa o pedido todo (400)", misto.status === 400, `${misto.status}`);
  check("e não lança nem o ligado — o pedido é um só", (await noMes(SETEMBRO)) === 0);

  const ligado = await call(director, "POST", "/api/charges/mensalidade", { athleteId: "zm_atleta", amountCents: 3500, periods: [SETEMBRO] });
  check("um mês ligado lança-se normalmente", ligado.status === 200 || ligado.status === 201, `${ligado.status} ${JSON.stringify(ligado.body).slice(0, 120)}`);
  check("e existe", (await noMes(SETEMBRO)) === 1);

  console.log("\n=== Avulsa com vencimento num mês desligado ===");
  const avulsa = await call(director, "POST", "/api/charges/avulsa", {
    athleteId: "zm_atleta", title: "ZM Equipamento", amountCents: 2000, dueDate: `${ANO_EPOCA}-08-20`,
  });
  check("recusada (400)", avulsa.status === 400, `${avulsa.status} ${JSON.stringify(avulsa.body).slice(0, 140)}`);
  check("a dizer o mês", /Agosto/.test(avulsa.body?.message ?? ""), `${avulsa.body?.message}`);
  check("e não nasceu avulsa em Agosto", (await noMes(AGOSTO, "EXTRA")) === 0);
  const avulsaOk = await call(director, "POST", "/api/charges/avulsa", {
    athleteId: "zm_atleta", title: "ZM Equipamento", amountCents: 2000, dueDate: `${ANO_EPOCA}-09-20`,
  });
  check("com vencimento num mês ligado, cria-se", avulsaOk.status === 200 || avulsaOk.status === 201, `${avulsaOk.status}`);

  console.log("\n=== Gerar num mês desligado ===");
  const gerar = await call(director, "POST", `/api/charges/gerar?periodo=${AGOSTO}`);
  check("o botão responde (2xx)", gerar.status === 200 || gerar.status === 201, `${gerar.status}`);
  check("e não cria nada em Agosto", (await noMes(AGOSTO)) === 0, `${await noMes(AGOSTO)}`);

  /* ================================================ a limpeza ao gravar ===== */
  console.log("\n=== Gravar as definições esvazia o mês desligado ===");
  /*
   * O que já lá estava antes de o mês ser desligado — o caso do Life Club.
   * Uma linha por situação.
   */
  /* `(athleteId, period, slot)` é único: um slot por linha, para caberem seis no mesmo mês. */
  const slots = ["a", "b", "c", "d", "e", "f"];
  await cobranca("zm_c_aberta", AGOSTO, "OPEN", { slot: slots[0] });
  await cobranca("zm_c_anulada", AGOSTO, "VOID", { slot: slots[1] });
  await cobranca("zm_c_paga_seca", AGOSTO, "SETTLED", { slot: slots[2] });
  await cobranca("zm_c_paga_mao", AGOSTO, "SETTLED", { slot: slots[3] });
  await pagamento("zm_p_mao", "zm_c_paga_mao", { status: "PAID", provider: "manual" });
  await cobranca("zm_c_paga_online", AGOSTO, "SETTLED", { slot: slots[4] });
  await pagamento("zm_p_online", "zm_c_paga_online", { status: "PAID" });
  await cobranca("zm_c_mb_viva", AGOSTO, "OPEN", { slot: slots[5] });
  await pagamento("zm_p_viva", "zm_c_mb_viva", { status: "PENDING", expira: "now() + interval '2 days'" });
  /* Uma época passada, e uma avulsa — nenhuma das duas se toca. */
  await cobranca("zm_c_epoca_passada", AGOSTO_PASSADO, "OPEN");
  await cobranca("zm_c_avulsa_agosto", AGOSTO, "OPEN", { kind: "EXTRA", slot: "zm-avulsa" });

  const gravou = await call(director, "PATCH", "/api/pagamentos", { months: TODOS_MENOS_AGOSTO });
  check("gravar responde (2xx)", gravou.status === 200 || gravou.status === 201, `${gravou.status} ${JSON.stringify(gravou.body).slice(0, 160)}`);

  check("a por pagar saiu", (await existe("zm_c_aberta")) === null);
  check("a anulada saiu", (await existe("zm_c_anulada")) === null);
  check("a paga sem pagamento nenhum saiu", (await existe("zm_c_paga_seca")) === null);
  check("a marcada paga à mão saiu — e o pagamento manual com ela", (await existe("zm_c_paga_mao")) === null &&
    (await db.query(`SELECT count(*)::int n FROM "Payment" WHERE id = 'zm_p_mao'`)).rows[0].n === 0);
  check("a paga online ficou — é dinheiro que passou pela euPago", (await existe("zm_c_paga_online")) === "SETTLED");
  check("a com referência Multibanco viva ficou anulada, não apagada", (await existe("zm_c_mb_viva")) === "VOID");
  check("a da época passada não se tocou", (await existe("zm_c_epoca_passada")) === "OPEN");
  check("a avulsa não se tocou", (await existe("zm_c_avulsa_agosto")) === "OPEN");

  check("a resposta diz quantas saíram", gravou.body?.apagadas === 4, `${gravou.body?.apagadas}`);
  check("quantas ficaram anuladas", gravou.body?.anuladas === 1, `${gravou.body?.anuladas}`);
  check("e quantas ficaram por terem pagamento online", gravou.body?.comDinheiro === 1, `${gravou.body?.comDinheiro}`);

  console.log("\n=== O que a consola recebe ===");
  const lista = await call(director, "GET", "/api/charges");
  const deAgosto = (lista.body ?? []).filter((c) => c.period === AGOSTO && c.kind === "FEE");
  check("de Agosto só chega a paga online (e a anulada à espera do Multibanco)", deAgosto.length === 2, JSON.stringify(deAgosto.map((c) => c.id)));

  console.log("\n=== Gravar outra vez não mexe em mais nada ===");
  const outraVez = await call(director, "PATCH", "/api/pagamentos", { months: TODOS_MENOS_AGOSTO });
  check("zero retiradas", outraVez.body?.apagadas === 0 && outraVez.body?.anuladas === 0, JSON.stringify(outraVez.body));
  check("a anulada com referência viva continua lá, para o webhook", (await existe("zm_c_mb_viva")) === "VOID");
  check("e a mensalidade de Setembro continua lá", (await noMes(SETEMBRO)) === 1);

  /* ============================================ só a partir da próxima época */
  console.log("\n=== Só a partir da próxima época ===");
  const PROXIMA = `${ANO_EPOCA + 1}-08`;
  const OUTUBRO = `${ANO_EPOCA}-10`;
  const OUTUBRO_PROX = `${ANO_EPOCA + 1}-10`;
  const SETEMBRO_PROX = `${ANO_EPOCA + 1}-09`;
  const SEM_AGO_OUT = [1, 2, 3, 4, 5, 6, 7, 9, 11, 12];
  const academia = async () =>
    (await db.query(`SELECT "billingMonths", "billingDueDay", "billingNextFrom", "billingNextMonths", "billingNextDueDay" FROM "Academy" WHERE id = $1`, [ZM])).rows[0];

  /* Uma de Outubro desta época e uma já lançada para Outubro da próxima. */
  await cobranca("zm_c_out", OUTUBRO, "OPEN");
  await cobranca("zm_c_out_prox", OUTUBRO_PROX, "OPEN");

  const agendar = await call(director, "PATCH", "/api/pagamentos", { months: SEM_AGO_OUT, dueDay: 15, aplicarEm: "proxima" });
  check("agendar responde (2xx)", agendar.status === 200, `${agendar.status} ${JSON.stringify(agendar.body).slice(0, 160)}`);
  check("e diz desde quando", agendar.body?.agendadoDesde === PROXIMA, `${agendar.body?.agendadoDesde}`);
  const agendada = await academia();
  check("esta época não mudou", JSON.stringify(agendada.billingMonths) === JSON.stringify(TODOS_MENOS_AGOSTO) && agendada.billingDueDay === 8, JSON.stringify(agendada));
  check("o calendário ficou agendado", agendada.billingNextFrom === PROXIMA && JSON.stringify(agendada.billingNextMonths) === JSON.stringify(SEM_AGO_OUT) && agendada.billingNextDueDay === 15, JSON.stringify(agendada));
  check("a de Outubro desta época fica", (await existe("zm_c_out")) === "OPEN");
  check("a já lançada para Outubro da próxima sai", (await existe("zm_c_out_prox")) === null);
  check("e a resposta conta-a", agendar.body?.apagadas === 1, `${agendar.body?.apagadas}`);

  const outProx = await call(director, "POST", "/api/charges/mensalidade", { athleteId: "zm_atleta", amountCents: 3500, periods: [OUTUBRO_PROX] });
  check("lançar Outubro da próxima época é recusado (400)", outProx.status === 400 && /Outubro/.test(outProx.body?.message ?? ""), `${outProx.status} ${outProx.body?.message}`);
  const setProx = await call(director, "POST", "/api/charges/mensalidade", { athleteId: "zm_atleta", amountCents: 3500, periods: [SETEMBRO_PROX] });
  check("Setembro da próxima lança-se", setProx.status === 201 || setProx.status === 200, `${setProx.status}`);
  const venc = (await db.query(`SELECT to_char("dueDate", 'DD') d FROM "Charge" WHERE "athleteId" = 'zm_atleta' AND period = $1 AND kind = 'FEE'`, [SETEMBRO_PROX])).rows[0]?.d;
  check("com o dia de vencimento agendado (15)", venc === "15", `${venc}`);
  const emFalta = await call(director, "GET", `/api/charges/em-falta?periodo=${OUTUBRO_PROX}`);
  check("as Mensalidades sabem que Outubro da próxima não se cobra", emFalta.body?.cobraEsteMes === false, JSON.stringify(emFalta.body).slice(0, 120));
  const emFaltaAgora = await call(director, "GET", `/api/charges/em-falta?periodo=${OUTUBRO}`);
  check("e que Outubro desta se cobra", emFaltaAgora.body?.cobraEsteMes === true, JSON.stringify(emFaltaAgora.body).slice(0, 120));

  const boot = await call(director, "GET", "/api/bootstrap");
  check("a consola recebe o agendamento", boot.body?.academy?.billingNextFrom === PROXIMA, `${boot.status} ${boot.body?.academy?.billingNextFrom}`);

  console.log("\n=== Anular o agendamento ===");
  const anular = await call(director, "PATCH", "/api/pagamentos", { months: TODOS_MENOS_AGOSTO, dueDay: 8, aplicarEm: "proxima" });
  check("agendar o calendário de hoje anula (agendadoDesde nulo)", anular.status === 200 && anular.body?.agendadoDesde === null, JSON.stringify(anular.body));
  const anulada = await academia();
  check("e as colunas ficam limpas", anulada.billingNextFrom === null && anulada.billingNextMonths.length === 0 && anulada.billingNextDueDay === null, JSON.stringify(anulada));

  console.log("\n=== Quando a época vira ===");
  /* Simula a viragem: um agendamento cujo início já chegou. */
  const agora = new Date();
  const periodoDeHoje = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, "0")}`;
  await db.query(`UPDATE "Academy" SET "billingNextFrom" = $2, "billingNextMonths" = $3, "billingNextDueDay" = 20 WHERE id = $1`, [ZM, periodoDeHoje, SEM_AGO_OUT]);
  const emitir = await call(director, "POST", `/api/charges/gerar?periodo=${periodoDeHoje}`);
  check("a emissão corre (2xx)", emitir.status === 200 || emitir.status === 201, `${emitir.status}`);
  const virada = await academia();
  check("o agendado passou a ser o calendário", JSON.stringify(virada.billingMonths) === JSON.stringify(SEM_AGO_OUT) && virada.billingDueDay === 20, JSON.stringify(virada));
  check("e o agendamento foi limpo", virada.billingNextFrom === null, JSON.stringify(virada));
} finally {
  console.log("\n=== Limpeza ===");
  await limpar();
  check("tudo apagado", (await db.query(`SELECT count(*)::int n FROM "Academy" WHERE id = $1`, [ZM])).rows[0].n === 0);
  await db.end();
}

console.log(`\n${ok} OK · ${bad} falhas`);
process.exit(bad === 0 ? 0 : 1);

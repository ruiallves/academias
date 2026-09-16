#!/usr/bin/env node
/**
 * Uma categoria de sócio pode ser mensal ou anual.
 *
 * ## O que isto existe para provar
 *
 * A periodicidade por categoria já existiu e foi removida (ver a migração
 * `quotas_mensais`), porque a quota nascia no formato da categoria e todos os
 * ecrãs mudavam de unidade. O que voltou é mais estreito: só mensal ou anual, e
 * o período de uma quota continua a ser **sempre** `AAAA-MM`. Numa categoria
 * anual nasce **uma** quota por época, no mês em que a época abre.
 *
 * É essa promessa que se verifica aqui:
 *
 *  1. A emissão automática dá uma quota por mês às mensais e **uma só** às
 *     anuais — e repetir a varredura não dá ao sócio anual uma quota nova todos
 *     os meses, que era o erro óbvio deste desenho.
 *  2. A ficha diz "Época 2026/27" em vez de "este mês" a quem é anual.
 *  3. A categoria guarda e muda a periodicidade pela API.
 *  4. A página pública de adesão escreve "/ano" no preço.
 *  5. A app do sócio recebe uma quota (não doze) e recusa "pagar até ao mês X".
 *  6. **O clube diz em que mês o ano de quotas abre**
 *     (`Academy.memberAnnualStartMonth`, para todas as categorias anuais). Era
 *     Agosto para toda a gente, fixo no código; com o clube em Janeiro as
 *     quotas anuais são `AAAA-01`, rótulo "Quota anual 2026" (um ano só, não
 *     "2026/27"), a ficha diz "Ano 2026", e lançar Agosto é recusado.
 *  7. O prazo de uma quota anual do período corrente é o fim do mês em que ela
 *     nasce — e não o fim do mês em que o período abriu, que punha quem entrava
 *     em Março "fora de prazo" desde Agosto. Um período já acabado leva o prazo
 *     no último dia dele, para contar como atraso.
 *
 * Uso: node scripts/test-quotas-anuais.mjs
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

const db = new pg.Client({ connectionString: env("MIGRATE_DATABASE_URL"), ssl: { rejectUnauthorized: false } });
await db.connect();

const director = await login("direcao@lifeclub.pt");
const pendentes = ((await call(director, "GET", "/api/legal/status")).body?.pending ?? []).map((d) => d.id);
if (pendentes.length) await call(director, "POST", "/api/legal/accept", { documentIds: pendentes });

/* O mês corrente e a época a que pertence — o teste não fixa datas. */
const agora = new Date();
const PERIODO = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, "0")}`;
const ANO_EPOCA = agora.getMonth() + 1 >= 8 ? agora.getFullYear() : agora.getFullYear() - 1;
const EPOCA = `${ANO_EPOCA}-08`;
const ROTULO_EPOCA = `${ANO_EPOCA}/${String((ANO_EPOCA + 1) % 100).padStart(2, "0")}`;

/* ===================================================== clube descartável === */

const AC = "za_academia";
const limparClube = async () => {
  await db.query(`DELETE FROM "Notification" WHERE "academyId" = $1`, [AC]);
  await db.query(`DELETE FROM "MemberFee" WHERE "academyId" = $1`, [AC]);
  await db.query(`DELETE FROM "Member" WHERE "academyId" = $1`, [AC]);
  await db.query(`DELETE FROM "MemberTier" WHERE "academyId" = $1`, [AC]);
  await db.query(`DELETE FROM "Academy" WHERE id = $1`, [AC]);
  await db.query(`DELETE FROM "PlatformAdmin" WHERE id = 'za_admin'`);
};

/* ======================================================= no life-club ===== */

const LC = (await db.query(`SELECT id FROM "Academy" WHERE slug = 'life-club'`)).rows[0].id;
/*
 * A abertura do ano de quotas é do clube, e o clube pode estar em qualquer dia
 * — a direcção mexe nela pela consola, e um teste que assumisse Agosto falhava
 * no dia em que alguém escolhesse Janeiro (aconteceu). Por isso guarda-se a que
 * lá está, põe-se a que este teste precisa (1 de Agosto, a época de sempre), e
 * repõe-se a original no fim.
 *
 * Enquanto a abertura está mudada, a varredura horária pode nascer quotas a
 * sócios anuais a sério no período errado — tira-se uma fotografia antes e
 * apaga-se o que aparecer.
 */
const ABERTURA_ORIGINAL = (await db.query(
  `SELECT "memberAnnualStartMonth" AS m, "memberAnnualStartDay" AS d FROM "Academy" WHERE id = $1`, [LC])).rows[0];
const quotasAntes = new Set((await db.query(`SELECT id FROM "MemberFee" WHERE "academyId" = $1`, [LC])).rows.map((r) => r.id));
const limparLifeClub = async () => {
  const alheias = (await db.query(`SELECT id FROM "MemberFee" WHERE "academyId" = $1 AND "memberId" NOT LIKE 'za_%'`, [LC]))
    .rows.map((r) => r.id).filter((id) => !quotasAntes.has(id));
  if (alheias.length) {
    await db.query(`DELETE FROM "Notification" WHERE "academyId" = $1 AND payload->>'memberFeeId' = ANY($2)`, [LC, alheias]);
    await db.query(`DELETE FROM "MemberFee" WHERE id = ANY($1)`, [alheias]);
  }
  await db.query(`DELETE FROM "MemberFee" WHERE "memberId" LIKE 'za_%'`);
  await db.query(`DELETE FROM "Member" WHERE id LIKE 'za_%'`);
  await db.query(`DELETE FROM "MemberTier" WHERE "academyId" = $1 AND name LIKE 'ZA %'`, [LC]);
  await db.query(
    `UPDATE "Academy" SET "memberAnnualStartMonth" = $2, "memberAnnualStartDay" = $3 WHERE id = $1`,
    [LC, ABERTURA_ORIGINAL.m, ABERTURA_ORIGINAL.d],
  );
};

try {
  await limparClube();
  await limparLifeClub();
  /* A época de sempre, para os blocos que falam em "Época 2026/27" fazerem sentido. */
  const emAgosto = await call(director, "PATCH", "/api/member-annual-period", { startMonth: 8, startDay: 1 });
  check("(preparação) o clube fica a abrir o ano de quotas a 1 de Agosto", emAgosto.status === 200, `${emAgosto.status} ${JSON.stringify(emAgosto.body)}`);

  /* ------------------------------------------------- a emissão ---------- */
  console.log("=== Uma quota por época, e não uma por mês ===");
  await db.query(
    `INSERT INTO "Academy" (id, slug, name, "shortName", status, "updatedAt")
     VALUES ($1, 'za-teste-anual', 'ZA Teste Anual', 'ZA', 'SETUP', now())`, [AC],
  );
  await db.query(
    `INSERT INTO "MemberTier" (id, "academyId", name, "feeCents", billing, "updatedAt") VALUES
       ('za_tier_mensal', $1, 'ZA Mensal', 1000, 'MONTHLY', now()),
       ('za_tier_anual',  $1, 'ZA Anual',  6000, 'ANNUAL',  now())`, [AC],
  );
  await db.query(
    `INSERT INTO "Member" (id, "academyId", "tierId", name, number, status, source, "updatedAt") VALUES
       ('za_mensal', $1, 'za_tier_mensal', 'ZA Sócio Mensal', 1, 'ACTIVE', 'secretaria', now()),
       ('za_anual',  $1, 'za_tier_anual',  'ZA Sócio Anual',  2, 'ACTIVE', 'secretaria', now())`, [AC],
  );

  /* O crachá de plataforma, emprestado — a mesma manobra de `test-quotas-automaticas`. */
  const authDaDireccao = (await db.query(
    `SELECT "authId" FROM "User" WHERE email = 'direcao@lifeclub.pt' LIMIT 1`)).rows[0]?.authId;
  await db.query(
    `INSERT INTO "PlatformAdmin" (id, "authId", name, email, role, "isActive", "updatedAt")
     VALUES ('za_admin', $1, 'ZA Admin de teste', 'za-admin@teste.local', 'OWNER', true, now())`, [authDaDireccao],
  );
  const admin = await login("direcao@lifeclub.pt");

  const emitir = () => call(admin, "POST", `/api/platform/billing/emitir?academia=${AC}`);
  const quotas = async (memberId) =>
    (await db.query(`SELECT period, label, "amountCents" FROM "MemberFee" WHERE "memberId" = $1 ORDER BY period`, [memberId])).rows;

  const passe = await emitir();
  check("a emissão corre (2xx)", passe.status === 200 || passe.status === 201, `${passe.status}`);

  const doMensal = await quotas("za_mensal");
  check("o sócio mensal recebe a quota do mês", doMensal.length === 1 && doMensal[0].period === PERIODO, JSON.stringify(doMensal));

  const doAnual = await quotas("za_anual");
  check("o sócio anual recebe uma só", doAnual.length === 1, JSON.stringify(doAnual));
  check("no mês em que a época abre", doAnual[0]?.period === EPOCA, `${doAnual[0]?.period} (esperava ${EPOCA})`);
  check("com o rótulo da época", doAnual[0]?.label === `Quota anual ${ROTULO_EPOCA}`, `${doAnual[0]?.label}`);
  check("e o valor da categoria", doAnual[0]?.amountCents === 6000, `${doAnual[0]?.amountCents}`);

  /*
   * O erro óbvio deste desenho: a varredura corre todos os meses, e sem a
   * distinção o sócio anual ficava com uma quota nova de cada vez.
   */
  await emitir();
  await emitir();
  check("repetir a emissão não cria nada ao mensal", (await quotas("za_mensal")).length === 1);
  check("nem ao anual", (await quotas("za_anual")).length === 1);

  /* ------------------------------------------ a ficha do sócio ---------- */
  console.log("\n=== A ficha fala em época, não em mês ===");
  await db.query(
    `INSERT INTO "MemberTier" (id, "academyId", name, "feeCents", billing, "isPublic", "updatedAt")
     VALUES ('za_lc_anual', $1, 'ZA Anual Pública', 6000, 'ANNUAL', true, now())`, [LC],
  );
  await db.query(
    `INSERT INTO "Member" (id, "academyId", "tierId", name, number, status, source, "updatedAt")
     VALUES ('za_lc_socio', $1, 'za_lc_anual', 'ZA Sócio Anual LC', 98801, 'ACTIVE', 'secretaria', now())`, [LC],
  );

  const lista = await call(director, "GET", "/api/members");
  const linha = (lista.body?.members ?? []).find((m) => m.id === "za_lc_socio");
  check("a lista traz o sócio", Boolean(linha), `${lista.status}`);
  check("com a periodicidade da categoria", linha?.tier?.billing === "ANNUAL", JSON.stringify(linha?.tier));
  /*
   * A situação de quotas é da **ficha**, não da lista: a lista de sócios não a
   * traz (uma por sócio seriam tantas leituras quantas as linhas). Foi aqui que
   * este teste se enganou à primeira, e pediu ao sítio errado.
   */
  const ficha = await call(director, "GET", "/api/members/za_lc_socio");
  check("a ficha do sócio abre", ficha.status === 200, `${ficha.status}`);
  check("o período corrente é a época", ficha.body?.fees?.currentKind === "season", JSON.stringify(ficha.body?.fees?.currentKind));
  check("e diz-se pelo nome", ficha.body?.fees?.currentLabel === `Época ${ROTULO_EPOCA}`, `${ficha.body?.fees?.currentLabel}`);

  /* ---------------------------------------- a categoria pela API -------- */
  console.log("\n=== A categoria guarda e muda a periodicidade ===");
  const criada = await call(director, "POST", "/api/members/tiers", {
    name: "ZA Criada Anual", feeCents: 5000, billing: "ANNUAL", isPublic: false,
  });
  check("cria-se uma categoria anual", criada.status === 201 || criada.status === 200, `${criada.status} ${JSON.stringify(criada.body)}`);
  const tiers = await call(director, "GET", "/api/members/tiers");
  const nova = (tiers.body ?? []).find((t) => t.name === "ZA Criada Anual");
  check("e lê-se como anual", nova?.billing === "ANNUAL", JSON.stringify(nova?.billing));

  /*
   * O corpo vai completo, e não só o campo que muda: o DTO da categoria exige
   * `name`. É o que o formulário da consola manda, e um PATCH só com `billing`
   * era recusado — foi assim que este teste falhou à primeira, a acusar o
   * produto de uma coisa que era do teste.
   */
  const mudou = await call(director, "PATCH", `/api/members/tiers/${nova.id}`, {
    name: "ZA Criada Anual", feeCents: 5000, billing: "MONTHLY", isPublic: false,
  });
  check("a mudança é aceite", mudou.status === 200 || mudou.status === 201, `${mudou.status} ${JSON.stringify(mudou.body).slice(0, 140)}`);
  const depois = ((await call(director, "GET", "/api/members/tiers")).body ?? []).find((t) => t.id === nova.id);
  check("muda para mensal", depois?.billing === "MONTHLY", JSON.stringify(depois?.billing));

  /* ------------------------------------ lançar quotas à mão ------------- */
  console.log("\n=== Lançar quotas a um sócio anual ===");
  const periodos = await call(director, "GET", "/api/members/za_lc_socio/fees/periods");
  check("o ecrã de lançar sabe que a categoria é anual", periodos.body?.billing === "ANNUAL", `${periodos.body?.billing}`);

  /*
   * Um mês qualquer que não seja o de abertura da época. Lançá-lo criava uma
   * segunda quota do mesmo ano, com rótulo de mês, ao lado da da época.
   */
  const uMes = `${ANO_EPOCA}-10`;
  const recusou = await call(director, "POST", "/api/members/za_lc_socio/fees", {
    periods: [uMes], amountCents: 6000,
  });
  check("lançar um mês é recusado (400)", recusou.status === 400, `${recusou.status}`);
  check("e a mensagem explica que é anual", /anual|época/i.test(recusou.body?.message ?? ""), `${recusou.body?.message}`);
  check(
    "e não ficou nada na base",
    (await db.query(`SELECT COUNT(*)::int n FROM "MemberFee" WHERE "memberId" = 'za_lc_socio' AND period = $1`, [uMes])).rows[0].n === 0,
  );

  /* A época anterior — o acerto de quem entrou e ficou a dever o ano passado. */
  const epocaAnterior = `${ANO_EPOCA - 1}-08`;
  const lancou = await call(director, "POST", "/api/members/za_lc_socio/fees", {
    periods: [epocaAnterior], amountCents: 6000,
  });
  check("lançar uma época passa", lancou.body?.created === 1, `${lancou.status} ${JSON.stringify(lancou.body)}`);
  const lancada = (await db.query(
    `SELECT label FROM "MemberFee" WHERE "memberId" = 'za_lc_socio' AND period = $1`, [epocaAnterior])).rows[0];
  check(
    "com o rótulo da época, e não de um mês",
    lancada?.label === `Quota anual ${ANO_EPOCA - 1}/${String(ANO_EPOCA % 100).padStart(2, "0")}`,
    `${lancada?.label}`,
  );

  /* --------------------------------- o prazo da quota anual ------------- */
  console.log("\n=== O prazo é o fim do mês em que a quota nasce, não o de Agosto ===");
  /*
   * A quota do `za_anual` nasceu na emissão de hoje, para o período corrente.
   * Com o prazo no fim do mês em que o período abriu, quem estivesse em Março
   * estava "fora de prazo desde Agosto" no dia em que a quota nascia.
   */
  const fimDoMesCorrente = new Date(Date.UTC(agora.getFullYear(), agora.getMonth() + 1, 0)).toISOString().slice(0, 10);
  const prazoAnual = (await db.query(
    `SELECT to_char("dueOn", 'YYYY-MM-DD') AS d FROM "MemberFee" WHERE "memberId" = 'za_anual'`)).rows[0]?.d;
  check("a quota da época corrente vence no fim deste mês", prazoAnual === fimDoMesCorrente, `${prazoAnual} (esperava ${fimDoMesCorrente})`);

  const prazoAnterior = (await db.query(
    `SELECT to_char("dueOn", 'YYYY-MM-DD') AS d FROM "MemberFee" WHERE "memberId" = 'za_lc_socio' AND period = $1`, [epocaAnterior])).rows[0]?.d;
  check(`a época anterior vence no último dia dela (31 de Julho de ${ANO_EPOCA})`, prazoAnterior === `${ANO_EPOCA}-07-31`, `${prazoAnterior}`);

  /* ------------------------------ o clube escolhe o mês de abertura ----- */
  console.log("\n=== O clube passa o ano de quotas para Janeiro a Dezembro ===");
  const ANO = agora.getFullYear();
  /*
   * O mês é do **clube**, não da categoria: muda-se uma vez e vale para todas
   * as anuais. Daqui até ao fim deste bloco o Life Club está em Janeiro; volta
   * a Agosto antes do bloco da app, que espera a época de sempre.
   */
  const paraJaneiro = await call(director, "PATCH", "/api/member-annual-period", { startMonth: 1 });
  check("a direcção põe o ano de quotas do clube a abrir em Janeiro", paraJaneiro.status === 200 && paraJaneiro.body?.startMonth === 1, `${paraJaneiro.status} ${JSON.stringify(paraJaneiro.body)}`);
  const naCategoria = await call(director, "POST", "/api/members/tiers", {
    name: "ZA Mês na categoria", feeCents: 4000, billing: "ANNUAL", annualStartMonth: 1, isPublic: false,
  });
  check("o mês já não se aceita na categoria (400) — é do clube", naCategoria.status === 400, `${naCategoria.status}`);
  const criadaJan = await call(director, "POST", "/api/members/tiers", {
    name: "ZA Anual Janeiro", feeCents: 4000, billing: "ANNUAL", isPublic: false,
  });
  check("cria-se uma categoria anual", criadaJan.status === 201, `${criadaJan.status} ${JSON.stringify(criadaJan.body).slice(0, 120)}`);
  const tierJan = ((await call(director, "GET", "/api/members/tiers")).body ?? []).find((t) => t.name === "ZA Anual Janeiro");
  check("e existe", Boolean(tierJan?.id));

  check("um mês 13 é recusado (400)", (await call(director, "PATCH", "/api/member-annual-period", { startMonth: 13 })).status === 400);

  await db.query(
    `INSERT INTO "Member" (id, "academyId", "tierId", name, number, status, source, "updatedAt")
     VALUES ('za_lc_jan', $1, $2, 'ZA Sócio de Janeiro', 98802, 'ACTIVE', 'secretaria', now())`, [LC, tierJan.id],
  );

  const fichaJan = await call(director, "GET", "/api/members/za_lc_jan");
  check("o período corrente abre em Janeiro", fichaJan.body?.fees?.currentPeriod === `${ANO}-01`, `${fichaJan.body?.fees?.currentPeriod}`);
  check("e chama-se pelo ano, não por dois", fichaJan.body?.fees?.currentLabel === `Ano ${ANO}`, `${fichaJan.body?.fees?.currentLabel}`);

  const periodosJan = await call(director, "GET", "/api/members/za_lc_jan/fees/periods");
  check("o ecrã de lançar sabe em que mês o período abre", periodosJan.body?.annualStartMonth === 1, `${periodosJan.body?.annualStartMonth}`);

  /* Agosto é o mês de abertura do clube ao lado — não deste. */
  const agostoJan = await call(director, "POST", "/api/members/za_lc_jan/fees", { periods: [`${ANO}-08`], amountCents: 4000 });
  check("lançar Agosto a um sócio de Janeiro é recusado (400)", agostoJan.status === 400, `${agostoJan.status}`);
  check("e a mensagem diz em que mês abre", /Janeiro/.test(agostoJan.body?.message ?? ""), `${agostoJan.body?.message}`);

  const anoAnterior = await call(director, "POST", "/api/members/za_lc_jan/fees", { periods: [`${ANO - 1}-01`], amountCents: 4000 });
  check("lançar o ano anterior passa", anoAnterior.body?.created === 1, `${anoAnterior.status} ${JSON.stringify(anoAnterior.body)}`);
  const quotaAnoAnterior = (await db.query(
    `SELECT label, to_char("dueOn", 'YYYY-MM-DD') AS d FROM "MemberFee" WHERE "memberId" = 'za_lc_jan' AND period = $1`, [`${ANO - 1}-01`])).rows[0];
  check(`com o rótulo de um ano só — "Quota anual ${ANO - 1}"`, quotaAnoAnterior?.label === `Quota anual ${ANO - 1}`, `${quotaAnoAnterior?.label}`);
  check(`e o prazo a 31 de Dezembro de ${ANO - 1}, o último dia do período`, quotaAnoAnterior?.d === `${ANO - 1}-12-31`, `${quotaAnoAnterior?.d}`);

  const anoCorrente = await call(director, "POST", "/api/members/za_lc_jan/fees", { periods: [`${ANO}-01`], amountCents: 4000 });
  check("lançar o ano corrente passa", anoCorrente.body?.created === 1, `${anoCorrente.status} ${JSON.stringify(anoCorrente.body)}`);
  const quotaAnoCorrente = (await db.query(
    `SELECT to_char("dueOn", 'YYYY-MM-DD') AS d FROM "MemberFee" WHERE "memberId" = 'za_lc_jan' AND period = $1`, [`${ANO}-01`])).rows[0];
  check("com o prazo no fim deste mês, e não a 31 de Janeiro", quotaAnoCorrente?.d === fimDoMesCorrente, `${quotaAnoCorrente?.d} (esperava ${fimDoMesCorrente})`);

  const fichaJanDepois = await call(director, "GET", "/api/members/za_lc_jan");
  check("a ficha passa a dizer que o ano corrente está por pagar", fichaJanDepois.body?.fees?.currentStatus === "open", `${fichaJanDepois.body?.fees?.currentStatus}`);

  /* E o sócio de Agosto de há bocado passou a ser de Janeiro também — o mês é do clube. */
  const fichaLcJan = await call(director, "GET", "/api/members/za_lc_socio");
  check("o outro sócio anual mudou de ano com o clube", fichaLcJan.body?.fees?.currentPeriod === `${ANO}-01`, `${fichaLcJan.body?.fees?.currentPeriod}`);

  const paraAgosto = await call(director, "PATCH", "/api/member-annual-period", { startMonth: 8 });
  check("e volta a Agosto", paraAgosto.status === 200 && paraAgosto.body?.startMonth === 8, `${paraAgosto.status}`);

  /* ------------------------------------- a página pública de adesão ----- */
  console.log("\n=== A página de adesão escreve /ano ===");
  const html = await (await fetch(`${API}/l/life-club/sersocio`)).text();
  check("a página abre", html.includes("Faz-te sócio") || html.includes("sócio"), `${html.length} caracteres`);
  check("a categoria anual aparece", html.includes("ZA Anual Pública"));
  check("com o preço por ano", /ZA Anual Pública[\s\S]{0,400}?\/ano/.test(html), "não encontrei /ano junto da categoria");

  /* ------------------------------------------- a app do sócio ----------- */
  console.log("\n=== A app do sócio ===");
  const emailSocio = "familia@lifeclub.pt";
  const jaTem = (await db.query(
    `SELECT m.id FROM "Member" m JOIN "User" u ON u.id = m."userId" WHERE u.email = $1 AND m."academyId" = $2`,
    [emailSocio, LC])).rows[0];

  if (jaTem) {
    console.log(`  SALTO — ${emailSocio} já tem ficha de sócio neste clube (${jaTem.id})`);
  } else {
    const userId = (await db.query(`SELECT id FROM "User" WHERE email = $1`, [emailSocio])).rows[0].id;
    await db.query(`UPDATE "Member" SET "userId" = $1 WHERE id = 'za_lc_socio'`, [userId]);

    const socio = await login(emailSocio);
    const pend = ((await call(socio, "GET", "/api/legal/status")).body?.pending ?? []).map((d) => d.id);
    if (pend.length) await call(socio, "POST", "/api/legal/accept", { documentIds: pend });

    const inicio = await call(socio, "GET", "/api/socio/inicio");
    check("o início abre", inicio.status === 200, `${inicio.status} ${JSON.stringify(inicio.body).slice(0, 120)}`);
    check("a app sabe que a categoria é anual", inicio.body?.member?.tierBilling === "ANNUAL", `${inicio.body?.member?.tierBilling}`);
    check("e oferece uma quota, não doze", inicio.body?.upcoming?.length === 1, JSON.stringify(inicio.body?.upcoming?.length));
    check("a da época", inicio.body?.upcoming?.[0]?.period === EPOCA, `${inicio.body?.upcoming?.[0]?.period}`);

    /*
     * "Pagar até Março" é um gesto de quem tem quotas mensais. Recusa-se antes
     * de chegar à euPago — a chave em `.env` é de produção.
     */
    const ate = await call(socio, "POST", `/api/socio/quotas/ate/${PERIODO}/pagar`, { method: "MULTIBANCO" });
    check("não se paga \"até ao mês X\" numa quota anual (400)", ate.status === 400, `${ate.status}`);
    check("e a mensagem explica", /anual/i.test(ate.body?.message ?? ""), `${ate.body?.message}`);
  }
} finally {
  console.log("\n=== Limpeza ===");
  await limparClube();
  await limparLifeClub();
  await db.query(`DELETE FROM "MemberTier" WHERE name LIKE 'ZA %'`);
  const restos =
    (await db.query(`SELECT COUNT(*)::int n FROM "Member" WHERE id LIKE 'za_%'`)).rows[0].n +
    (await db.query(`SELECT COUNT(*)::int n FROM "MemberTier" WHERE name LIKE 'ZA %'`)).rows[0].n;
  check("tudo apagado", restos === 0, `${restos} linhas ficaram`);
  await db.end();
}

console.log(`\n${ok} passaram, ${bad} falharam`);
process.exit(bad === 0 ? 0 : 1);

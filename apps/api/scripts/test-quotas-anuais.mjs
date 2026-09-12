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
const limparLifeClub = async () => {
  await db.query(`DELETE FROM "MemberFee" WHERE "memberId" LIKE 'za_%'`);
  await db.query(`DELETE FROM "Member" WHERE id LIKE 'za_%'`);
  await db.query(`DELETE FROM "MemberTier" WHERE "academyId" = $1 AND name LIKE 'ZA %'`, [LC]);
};

try {
  await limparClube();
  await limparLifeClub();

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
  check("e a mensagem fala em épocas", /época/i.test(recusou.body?.message ?? ""), `${recusou.body?.message}`);
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

#!/usr/bin/env node
/**
 * As contas da plataforma: gastos, ganhos e a previsão.
 *
 * ## O que isto prova
 *
 *  1. **Os gastos fixos** entram na previsão pelo líquido, no mês que lhes toca:
 *     um mensal em todos, um anual só no mês dele.
 *  2. **A receita vem dos clubes**, pelo contrato assinado e pelo relógio dele
 *     (ver `subscription/ciclo.ts`). Um clube com contrato mensal conta uma vez
 *     por mês; um anual conta uma vez no ano.
 *  3. **Marcar uma mensalidade como paga** escreve o ganho no livro, uma vez só,
 *     e com o IVA que as definições mandam. Desmarcar apaga-o.
 *  4. Um ganho que veio de uma mensalidade **não se edita nem se apaga** à mão.
 *  5. A **simulação** soma à parte e não se mistura com o contratado.
 *
 * Dados próprios, criados e apagados aqui.
 *
 * Uso:
 *   MAIL_API_KEY= PORT=3012 npm run start:dev --workspace=@academia/api
 *   API=http://127.0.0.1:3012 node scripts/test-contas-plataforma.mjs
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
const API = process.env.API ?? process.env.API_URL ?? "http://127.0.0.1:3012";

let ok = 0, bad = 0;
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
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

const db = new pg.Client({ connectionString: env("MIGRATE_DATABASE_URL"), ssl: { rejectUnauthorized: false } });
await db.connect();

const AC = "zc_academia";
const dia = (d) => d.toISOString().slice(0, 10);
const mesChave = (d) => d.toISOString().slice(0, 7);
/** O líquido, como o serviço o calcula. */
const liquido = (comIva, taxa) => (taxa ? Math.round(comIva / (1 + taxa / 100)) : comIva);

const limpar = async () => {
  await db.query(`DELETE FROM "PlatformTransaction" WHERE id LIKE 'zc_%' OR description LIKE 'ZC %' OR "academyId" = $1`, [AC]);
  await db.query(`DELETE FROM "PlatformRecurringExpense" WHERE description LIKE 'ZC %'`);
  await db.query(`DELETE FROM "SubscriptionNotice" WHERE "academyId" = $1`, [AC]);
  await db.query(`DELETE FROM "SubscriptionOrder" WHERE "academyId" = $1`, [AC]);
  await db.query(`DELETE FROM "Subscription" WHERE "academyId" = $1`, [AC]);
  await db.query(`DELETE FROM "Academy" WHERE id = $1`, [AC]);
  await db.query(`DELETE FROM "PlatformAdmin" WHERE id = 'zc_admin'`);
};

try {
  await limpar();

  console.log("=== Preparar ===");
  const authDaDireccao = (await db.query(`SELECT "authId" FROM "User" WHERE email = 'direcao@lifeclub.pt' LIMIT 1`)).rows[0]?.authId;
  await db.query(
    `INSERT INTO "PlatformAdmin" (id, "authId", name, email, role, "isActive", "updatedAt")
     VALUES ('zc_admin', $1, 'ZC Admin de teste', 'zc-admin@teste.local', 'OWNER', true, now())`, [authDaDireccao],
  );
  const admin = await login("direcao@lifeclub.pt");
  check("sessão de plataforma", Boolean(admin));

  const plano = (await db.query(`SELECT id, name, "amountCents" FROM "Plan" WHERE "isActive" ORDER BY "amountCents" ASC LIMIT 1`)).rows[0];

  /* Um clube com contrato assinado há um mês: hoje é dia de mensalidade. */
  const hoje = new Date();
  const assinatura = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() - 1, Math.min(hoje.getUTCDate(), 28), 12));
  const MENSALIDADE = 3990;
  await db.query(
    `INSERT INTO "Academy" (id, slug, name, "shortName", status, "updatedAt")
     VALUES ($1, 'zc-teste-contas', 'ZC Clube das Contas', 'ZC', 'ACTIVE', now())`, [AC],
  );
  await db.query(
    `INSERT INTO "Subscription" (id, "academyId", "planId", status, "createdAt", "updatedAt")
     VALUES ('zc_sub', $1, $2, 'ACTIVE', now(), now())`, [AC, plano.id],
  );
  /* Definições conhecidas: preço sem IVA, taxa 23. */
  await call(admin, "PATCH", "/api/platform/contas/definicoes", { subscriptionVatRate: 23, subscriptionVatIncluded: false });

  /*
   * A régua.
   *
   * A plataforma a sério já tem clubes e gastos — este teste corre contra a
   * mesma base. O que se mede é a **diferença** que ele provoca, e não o total:
   * um teste que exigisse "12 meses com receita" passava hoje e falhava no dia
   * em que outro clube assinasse.
   */
  const previsao = async (extra = "") => (await call(admin, "GET", `/api/platform/contas/previsao?meses=12${extra}`)).body;
  const base = await previsao();
  const delta = (depois, campo) => depois.meses.map((m, i) => m[campo] - base.meses[i][campo]);
  check("a régua tem doze meses", base?.meses?.length === 12, `${base?.meses?.length}`);

  console.log("\n=== Os gastos fixos entram na previsão ===");
  const mensal = await call(admin, "POST", "/api/platform/contas/fixos", {
    description: "ZC Servidores", amountCents: 12300, vatRate: 23, recurrence: "MONTHLY", dayOfMonth: 5, startsOn: dia(new Date(Date.UTC(hoje.getUTCFullYear() - 1, 0, 1))),
  });
  check("cria um gasto fixo mensal", mensal.status < 300, `${mensal.status} ${JSON.stringify(mensal.body).slice(0, 120)}`);

  const mesDoAnual = ((hoje.getUTCMonth() + 3) % 12) + 1;
  const anual = await call(admin, "POST", "/api/platform/contas/fixos", {
    description: "ZC Seguro anual", amountCents: 24600, vatRate: 23, recurrence: "ANNUAL", dayOfMonth: 10, month: mesDoAnual,
    startsOn: dia(new Date(Date.UTC(hoje.getUTCFullYear() - 1, 0, 1))),
  });
  check("cria um gasto fixo anual", anual.status < 300, `${anual.status}`);

  const p1 = await previsao();
  const mensalLiquido = liquido(12300, 23);
  const anualLiquido = liquido(24600, 23);
  const gastos = delta(p1, "gastosCents");
  const mesesComAnual = p1.meses.map((m, i) => (Number(m.mes.slice(5)) === mesDoAnual ? i : -1)).filter((i) => i >= 0);
  check("o mensal entra em todos os meses", gastos.every((g, i) => g === mensalLiquido + (mesesComAnual.includes(i) ? anualLiquido : 0)),
    JSON.stringify(gastos));
  check("e o anual só no mês dele", mesesComAnual.length === 1 && gastos[mesesComAnual[0]] === mensalLiquido + anualLiquido,
    JSON.stringify(mesesComAnual));
  check("o resumo dos fixos diz o valor por mês",
    p1.fixos.mensalCents - base.fixos.mensalCents === mensalLiquido && p1.fixos.anualCents - base.fixos.anualCents === anualLiquido,
    JSON.stringify(p1.fixos));

  console.log("\n=== A receita vem dos clubes ===");
  await db.query(
    `INSERT INTO "SubscriptionOrder"
       (id, "academyId", "planId", "planName", "billingPeriod", "listMonthlyCents", "discountPct", "amountCents",
        "startsOn", "minimumMonths", status, "signedAt", "createdAt", "updatedAt")
     VALUES ('zc_ordem', $1, $2, $3, 'MONTHLY', $4, 0, $4, $5::date, 1, 'SIGNED', $6::timestamptz, now(), now())`,
    [AC, plano.id, plano.name, MENSALIDADE, dia(assinatura), assinatura.toISOString()],
  );
  const p2 = await previsao();
  const receita = delta(p2, "receitaCents");
  check("um contrato mensal conta em todos os meses", receita.every((r) => r === MENSALIDADE), JSON.stringify(receita));
  check("e o clube entra na contagem", delta(p2, "clubes").every((c) => c === 1), JSON.stringify(delta(p2, "clubes")));

  /* Um contrato anual conta uma vez por ano, e não doze. */
  await db.query(`UPDATE "SubscriptionOrder" SET "billingPeriod" = 'ANNUAL' WHERE id = 'zc_ordem'`);
  const p2b = await previsao();
  const anualReceita = delta(p2b, "receitaCents");
  check("um contrato anual conta uma vez no ano", anualReceita.filter((r) => r > 0).length === 1, JSON.stringify(anualReceita));
  check("e no mês em que faz anos", anualReceita[11] === MENSALIDADE, JSON.stringify(anualReceita));
  await db.query(`UPDATE "SubscriptionOrder" SET "billingPeriod" = 'MONTHLY' WHERE id = 'zc_ordem'`);

  console.log("\n=== A simulação soma à parte ===");
  const p3 = await previsao("&novosPorMes=2&valorNovoCents=4000");
  check("a receita contratada não muda", p3.meses[0].receitaCents === p2.meses[0].receitaCents,
    `${p3.meses[0].receitaCents} vs ${p2.meses[0].receitaCents}`);
  check("o primeiro mês ainda não tem simulados", p3.meses[0].receitaSimuladaCents === 0, `${p3.meses[0].receitaSimuladaCents}`);
  check("e no segundo já entram dois", p3.meses[1].receitaSimuladaCents === 8000, `${p3.meses[1].receitaSimuladaCents}`);

  console.log("\n=== Marcar a mensalidade como paga ===");
  const emitir = await call(admin, "POST", `/api/platform/subscricao/avisos?academia=${AC}`);
  check("a varredura emite o aviso do clube", emitir.body?.criados === 1, JSON.stringify(emitir.body));

  const avisos = (await call(admin, "GET", "/api/platform/contas/mensalidades?estado=por-pagar")).body ?? [];
  const meu = avisos.find((a) => a.academyId === AC);
  check("o aviso aparece por pagar", Boolean(meu), `${avisos.length} avisos`);

  const pago = await call(admin, "POST", `/api/platform/contas/mensalidades/${meu.id}/pago`, {});
  check("marca como paga", pago.status < 300, `${pago.status} ${JSON.stringify(pago.body).slice(0, 120)}`);

  const linhas = (await db.query(`SELECT * FROM "PlatformTransaction" WHERE "noticeId" = $1`, [meu.id])).rows;
  check("escreve um ganho no livro", linhas.length === 1, `${linhas.length} linhas`);
  check("com o IVA por cima do preço combinado", linhas[0]?.amountCents === Math.round(MENSALIDADE * 1.23),
    `${linhas[0]?.amountCents} (esperava ${Math.round(MENSALIDADE * 1.23)})`);
  check("e com o clube ligado", linhas[0]?.academyId === AC, `${linhas[0]?.academyId}`);

  await call(admin, "POST", `/api/platform/contas/mensalidades/${meu.id}/pago`, {});
  const outraVez = (await db.query(`SELECT count(*)::int n FROM "PlatformTransaction" WHERE "noticeId" = $1`, [meu.id])).rows[0].n;
  check("marcar duas vezes não soma duas", outraVez === 1, `${outraVez}`);

  const editar = await call(admin, "PATCH", `/api/platform/contas/movimentos/${linhas[0].id}`, { amountCents: 100 });
  check("um ganho de mensalidade não se edita à mão", editar.status === 400, `${editar.status}`);
  const apagarGanho = await call(admin, "DELETE", `/api/platform/contas/movimentos/${linhas[0].id}`);
  check("nem se apaga", apagarGanho.status === 400, `${apagarGanho.status}`);

  console.log("\n=== O resumo ===");
  const gasto = await call(admin, "POST", "/api/platform/contas/movimentos", {
    kind: "EXPENSE", description: "ZC Portátil", amountCents: 61500, vatRate: 23, occurredAt: dia(hoje), category: "Equipamento",
  });
  check("lança um gasto avulso", gasto.status < 300, `${gasto.status}`);

  const resumo = (await call(admin, "GET", "/api/platform/contas/resumo")).body;
  check("o mês conta o ganho da mensalidade", resumo.mes.ganhosLiquidosCents >= MENSALIDADE, JSON.stringify(resumo.mes));
  check("e o gasto do portátil, a líquido", resumo.mes.gastosLiquidosCents >= liquido(61500, 23), JSON.stringify(resumo.mes));
  check("o saldo é a diferença",
    resumo.mes.saldoLiquidoCents === resumo.mes.ganhosLiquidosCents - resumo.mes.gastosLiquidosCents, JSON.stringify(resumo.mes));

  console.log("\n=== Desmarcar apaga o ganho ===");
  const desmarcar = await call(admin, "DELETE", `/api/platform/contas/mensalidades/${meu.id}/pago`);
  check("desmarca", desmarcar.status < 300, `${desmarcar.status}`);
  const depois = (await db.query(`SELECT count(*)::int n FROM "PlatformTransaction" WHERE "noticeId" = $1`, [meu.id])).rows[0].n;
  check("o ganho sai do livro", depois === 0, `${depois}`);

  console.log("\n=== Lançar um gasto fixo do mês ===");
  /* A régua é logo antes de lançar: o gasto avulso de cima já entrou na previsão. */
  const antesDeLancar = await previsao();
  const lancado = await call(admin, "POST", `/api/platform/contas/fixos/${mensal.body.id}/lancar`, {});
  check("lança o fixo no livro", lancado.status < 300 && lancado.body?.amountCents === 12300, `${lancado.status}`);
  const p4 = await previsao();
  check("e a previsão não o conta duas vezes", p4.meses[0].gastosCents === antesDeLancar.meses[0].gastosCents,
    `${p4.meses[0].gastosCents} vs ${antesDeLancar.meses[0].gastosCents}`);
} finally {
  console.log("\n=== Limpeza ===");
  await limpar();
  await db.end();
  console.log("  feito");
}

console.log(`\n${ok} passaram, ${bad} falharam`);
process.exit(bad === 0 ? 0 : 1);

#!/usr/bin/env node
/**
 * As quotas de um sócio: a situação, e lançá-las à mão.
 *
 * ## A queixa
 *
 * *"Não está claro que um sócio tem ou não a mensalidade paga — só diz o plano
 * dele no perfil."* A ficha mostrava a categoria (o **preço**) e o livro de
 * quotas encavalitado na coluna da direita, mas não respondia à pergunta que se
 * faz ao balcão: está em dia?
 *
 * E faltava o gesto: lançar a quota deste sócio, incluindo períodos em atraso.
 * Só havia "Gerar quotas", que trabalha sobre o livro todo e só cria o período
 * corrente — quem entrasse a meio do ano a dever três meses não tinha por onde.
 *
 * ## O que este teste guarda
 *
 * - as quotas são **mensais e só mensais**: a categoria já não tem
 *   periodicidade, o período é sempre `AAAA-MM`, e um `2026` ou `2026-T3` é
 *   recusado à entrada;
 * - o resumo vem **com a ficha** (`GET :id`), e distingue os três estados que
 *   não se podem confundir: pago, por pagar e **por lançar** (ninguém cobrou —
 *   não é dívida do sócio). Sem categoria o mês corrente continua a ser o mês
 *   corrente — a pergunta "este mês está pago?" faz sentido para toda a gente;
 * - lançar aceita vários meses de uma vez e **salta** os que já existem em
 *   vez de recusar tudo — a intenção de quem escolheu seis é ter os seis;
 * - o prazo de uma quota lançada em atraso é o fim do **mês dela**, e não o
 *   de hoje: é isso que a faz contar como fora de prazo;
 * - o estado muda pelo menu da ficha (`PATCH fees/:id/status`), igual ao das
 *   mensalidades: marcar como paga deixa um `Payment` manual, voltar atrás
 *   marca-o reembolsado, e uma paga **online** não se reabre por aqui.
 *
 * Uso: node scripts/test-quotas-socio.mjs
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
const API = process.env.API_URL ?? "http://localhost:3000";

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

const call = async (token, method, pathname, body) => {
  const r = await fetch(API + pathname, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "x-academy-slug": "life-club",
      "x-app": "console",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};

const db = new pg.Client({ connectionString: env("MIGRATE_DATABASE_URL"), ssl: { rejectUnauthorized: false } });
await db.connect();

const limpar = async () => {
  await db.query(`DELETE FROM "Payment" WHERE "memberFeeId" IN (SELECT f.id FROM "MemberFee" f JOIN "Member" m ON m.id = f."memberId" WHERE m.name LIKE 'ZQ %')`);
  await db.query(`DELETE FROM "MemberFee" WHERE "memberId" IN (SELECT id FROM "Member" WHERE name LIKE 'ZQ %')`);
  await db.query(`DELETE FROM "Member" WHERE name LIKE 'ZQ %'`);
  await db.query(`DELETE FROM "MemberTier" WHERE name LIKE 'ZQ %'`);
};
await limpar();

const director = await login("direcao@lifeclub.pt");

/* Os períodos de referência, calculados aqui como o servidor os calcula. */
const agora = new Date();
const mes = (recuo) => {
  const d = new Date(agora.getFullYear(), agora.getMonth() - recuo, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
const CORRENTE = mes(0);
const ATRASADO = mes(2);
/* Dois anos atrás: o que o tecto dos "doze mais recentes" tornava inalcançável. */
const ANTIGO = `${agora.getFullYear() - 2}-09`;

/* ================================================ o sócio com categoria === */

console.log("=== Um sócio mensal, acabado de aprovar ===");
const tier = await call(director, "POST", "/api/members/tiers", {
  name: "ZQ Efectivo",
  feeCents: 1000,
});
check("categoria mensal de 10 €", tier.status === 201, `${tier.status} ${JSON.stringify(tier.body).slice(0, 140)}`);
const tierId = tier.body?.id;

const criado = await call(director, "POST", "/api/members", {
  name: "ZQ Rita Nunes",
  phone: "912000101",
  tierId,
  status: "ACTIVE",
});
check("sócio criado", criado.status === 201, `${criado.status} ${JSON.stringify(criado.body).slice(0, 140)}`);
const id = criado.body?.id;

let ficha = await call(director, "GET", `/api/members/${id}`);
check("a ficha traz a situação de quotas", ficha.body?.fees != null, JSON.stringify(ficha.body?.fees));
check(
  "sem quota lançada diz 'por lançar', não 'por pagar'",
  ficha.body?.fees?.currentStatus === "missing" && ficha.body?.fees?.openCount === 0,
  JSON.stringify(ficha.body?.fees),
);
check("o período corrente é o do mês", ficha.body?.fees?.currentPeriod === CORRENTE, ficha.body?.fees?.currentPeriod);

/* ============================================== os períodos que se oferecem === */

console.log("\n=== O que o ecrã de lançar oferece ===");
const periodos = await call(director, "GET", `/api/members/${id}/fees/periods`);
check("já não há frequência — é sempre mensal", periodos.body?.period === undefined, JSON.stringify(periodos.body));
check("o valor por omissão vem da categoria", periodos.body?.defaultAmountCents === 1000, `${periodos.body?.defaultAmountCents}`);
check("ainda nenhum período ocupado", periodos.body?.taken?.length === 0, JSON.stringify(periodos.body?.taken));
check(
  "não vem lista de períodos — a grelha é do cliente, sem tecto de anos",
  periodos.body?.periods === undefined,
  JSON.stringify(Object.keys(periodos.body ?? {})),
);

/* ==================================================== lançar em atraso === */

console.log("\n=== Lançar dois períodos, um deles em atraso ===");
const lancou = await call(director, "POST", `/api/members/${id}/fees`, {
  periods: [CORRENTE, ATRASADO],
  amountCents: 1000,
});
check("lança os dois", lancou.body?.created === 2, JSON.stringify(lancou.body));

const fees = await call(director, "GET", `/api/members/${id}/fees`);
const atrasada = fees.body?.find((f) => f.period === ATRASADO);
check("a quota em atraso existe", atrasada != null);
check(
  "o prazo dela é o fim do período dela, não o de hoje",
  atrasada?.dueOn?.slice(0, 7) === ATRASADO,
  `dueOn=${atrasada?.dueOn}`,
);

ficha = await call(director, "GET", `/api/members/${id}`);
check("a situação passa a dizer duas em aberto", ficha.body?.fees?.openCount === 2, JSON.stringify(ficha.body?.fees));
check("e 20 € por pagar", ficha.body?.fees?.openCents === 2000, `${ficha.body?.fees?.openCents}`);
check("uma delas fora de prazo", ficha.body?.fees?.overdueCount === 1, `${ficha.body?.fees?.overdueCount}`);
check("o corrente agora é 'por pagar'", ficha.body?.fees?.currentStatus === "open", ficha.body?.fees?.currentStatus);

/* ============================================ repetir salta, não recusa === */

console.log("\n=== Lançar outra vez, com um novo pelo meio ===");
const outroMes = mes(3);
const repetiu = await call(director, "POST", `/api/members/${id}/fees`, {
  periods: [CORRENTE, outroMes],
  amountCents: 1000,
});
check("cria só o que faltava", repetiu.body?.created === 1, JSON.stringify(repetiu.body));
check("e diz qual já existia", repetiu.body?.alreadyExisted?.[0] === CORRENTE, JSON.stringify(repetiu.body?.alreadyExisted));

const periodos2 = await call(director, "GET", `/api/members/${id}/fees/periods`);
check("o ecrã passa a saber quais riscar", periodos2.body?.taken?.length === 3, JSON.stringify(periodos2.body?.taken));

/* ============================================ o tecto que já não existe === */

console.log("\n=== Um atraso de dois anos ===");
const antigo = await call(director, "POST", `/api/members/${id}/fees`, { periods: [ANTIGO], amountCents: 1000 });
check(`lança ${ANTIGO} — fora dos doze períodos recentes`, antigo.body?.created === 1, JSON.stringify(antigo.body));

const feesAntigo = await call(director, "GET", `/api/members/${id}/fees`);
const oAntigo = feesAntigo.body?.find((f) => f.period === ANTIGO);
check(
  "com o prazo do ano dele, não do corrente",
  oAntigo?.dueOn?.slice(0, 4) === String(agora.getFullYear() - 2),
  `dueOn=${oAntigo?.dueOn}`,
);

const periodos3 = await call(director, "GET", `/api/members/${id}/fees/periods`);
check("e passa a constar dos ocupados", periodos3.body?.taken?.includes(ANTIGO) === true, JSON.stringify(periodos3.body?.taken));

/* ==================================================== receber ao balcão === */

console.log("\n=== O menu de estado: marcar como paga, por pagar, anular ===");
const doMes = fees.body?.find((f) => f.period === CORRENTE);
const pagou = await call(director, "PATCH", `/api/members/fees/${doMes?.id}/status`, { status: "SETTLED" });
check("marca como paga", pagou.status === 200 && pagou.body?.status === "SETTLED", `${pagou.status} ${JSON.stringify(pagou.body)}`);

ficha = await call(director, "GET", `/api/members/${id}`);
check("o corrente passa a 'paga'", ficha.body?.fees?.currentStatus === "settled", ficha.body?.fees?.currentStatus);
check("e a última paga é essa", ficha.body?.fees?.lastSettled?.period === CORRENTE, JSON.stringify(ficha.body?.fees?.lastSettled));
check("sobram três em atraso", ficha.body?.fees?.overdueCount === 3, `${ficha.body?.fees?.overdueCount}`);

const rasto = (await db.query(`SELECT method, status, provider FROM "Payment" WHERE "memberFeeId" = $1`, [doMes?.id])).rows;
check("fica um pagamento manual em numerário como rasto", rasto.length === 1 && rasto[0].provider === "manual" && rasto[0].method === "CASH" && rasto[0].status === "PAID", JSON.stringify(rasto));
const linha = (await db.query(`SELECT method FROM "MemberFee" WHERE id = $1`, [doMes?.id])).rows[0];
check("e a quota diz CASH", linha?.method === "CASH", `${linha?.method}`);

const outraVez = await call(director, "PATCH", `/api/members/fees/${doMes?.id}/status`, { status: "SETTLED" });
check("marcar paga duas vezes não empilha pagamentos", outraVez.status === 200 && (await db.query(`SELECT count(*)::int AS n FROM "Payment" WHERE "memberFeeId" = $1`, [doMes?.id])).rows[0].n === 1);

const reabriu = await call(director, "PATCH", `/api/members/fees/${doMes?.id}/status`, { status: "OPEN" });
check("volta a 'por pagar'", reabriu.status === 200 && reabriu.body?.status === "OPEN", `${reabriu.status}`);
const reembolsado = (await db.query(`SELECT status FROM "Payment" WHERE "memberFeeId" = $1`, [doMes?.id])).rows[0];
check("o pagamento manual passa a reembolsado", reembolsado?.status === "REFUNDED", `${reembolsado?.status}`);
ficha = await call(director, "GET", `/api/members/${id}`);
check("a ficha volta a dizer 'por pagar'", ficha.body?.fees?.currentStatus === "open", ficha.body?.fees?.currentStatus);

const anulou = await call(director, "PATCH", `/api/members/fees/${doMes?.id}/status`, { status: "VOID" });
check("anula", anulou.status === 200 && anulou.body?.status === "VOID", `${anulou.status}`);
ficha = await call(director, "GET", `/api/members/${id}`);
check("o corrente passa a 'anulada'", ficha.body?.fees?.currentStatus === "void", ficha.body?.fees?.currentStatus);

const estadoMau = await call(director, "PATCH", `/api/members/fees/${doMes?.id}/status`, { status: "PAID" });
check("um estado fora dos três é recusado", estadoMau.status === 400, `${estadoMau.status}`);

/* Uma paga online: o dinheiro está na euPago, e o menu não a reabre. */
const online = fees.body?.find((f) => f.period === ATRASADO);
await db.query(
  `INSERT INTO "Payment" (id, "memberFeeId", "amountCents", method, status, provider, "providerRef", "paidAt", "updatedAt")
   VALUES ($1, $2, 1000, 'MBWAY', 'PAID', 'eupago', $1, now(), now())`,
  [`zq_pay_${Date.now().toString(36)}`, online?.id],
);
await db.query(`UPDATE "MemberFee" SET status = 'SETTLED', "settledAt" = now() WHERE id = $1`, [online?.id]);
const teimoso = await call(director, "PATCH", `/api/members/fees/${online?.id}/status`, { status: "OPEN" });
check("uma paga online não se reabre pelo menu (400)", teimoso.status === 400, `${teimoso.status} ${JSON.stringify(teimoso.body).slice(0, 100)}`);

/* ======================================================== o que se recusa === */

console.log("\n=== O que não passa ===");
const anual = await call(director, "POST", `/api/members/${id}/fees`, { periods: [String(agora.getFullYear())], amountCents: 1000 });
check("um período anual é recusado — as quotas são mensais", anual.status === 400, `${anual.status}`);
const trimestre = await call(director, "POST", `/api/members/${id}/fees`, { periods: [`${agora.getFullYear()}-T3`], amountCents: 1000 });
check("um trimestre também", trimestre.status === 400, `${trimestre.status}`);
const mes13 = await call(director, "POST", `/api/members/${id}/fees`, { periods: [`${agora.getFullYear()}-13`], amountCents: 1000 });
check("e o mês 13", mes13.status === 400, `${mes13.status}`);

const formato = await call(director, "POST", `/api/members/${id}/fees`, {
  periods: ["setembro"],
  amountCents: 1000,
});
check("um período fora do formato é recusado", formato.status === 400, `${formato.status}`);

const vazio = await call(director, "POST", `/api/members/${id}/fees`, { periods: [], amountCents: 1000 });
check("sem períodos nenhuns é recusado", vazio.status === 400, `${vazio.status}`);

const negativo = await call(director, "POST", `/api/members/${id}/fees`, { periods: [mes(5)], amountCents: -100 });
check("um valor negativo é recusado", negativo.status === 400, `${negativo.status}`);

/* ================================================== o sócio sem categoria === */

console.log("\n=== Um sócio sem categoria ===");
const semTier = await call(director, "POST", "/api/members", {
  name: "ZQ Bruno Sá",
  phone: "912000102",
  status: "ACTIVE",
});
const semTierId = semTier.body?.id;
const fichaSem = await call(director, "GET", `/api/members/${semTierId}`);
check(
  "o mês corrente é o mesmo para toda a gente — e está por lançar",
  fichaSem.body?.fees?.currentStatus === "missing" && fichaSem.body?.fees?.currentPeriod === CORRENTE,
  JSON.stringify(fichaSem.body?.fees),
);

const periodosSem = await call(director, "GET", `/api/members/${semTierId}/fees/periods`);
check("o ecrã diz que não tem categoria", periodosSem.body?.hasTier === false);
check("sem valor por omissão", periodosSem.body?.defaultAmountCents === null, `${periodosSem.body?.defaultAmountCents}`);

const lancouSem = await call(director, "POST", `/api/members/${semTierId}/fees`, {
  periods: [CORRENTE],
  amountCents: 500,
});
check("mesmo assim pode receber uma quota à medida", lancouSem.body?.created === 1, JSON.stringify(lancouSem.body));

/* ================================================= a categoria sem período === */

console.log("\n=== A categoria já não tem periodicidade ===");
const comPeriodo = await call(director, "POST", "/api/members/tiers", { name: "ZQ Antiga", feeCents: 3000, period: "ANNUAL" });
check("`period` no corpo é recusado — a API é estrita (400)", comPeriodo.status === 400, `${comPeriodo.status} ${JSON.stringify(comPeriodo.body).slice(0, 100)}`);
await call(director, "POST", "/api/members/tiers", { name: "ZQ Antiga", feeCents: 3000 });
const lista = await call(director, "GET", "/api/members/tiers");
const antiga = lista.body?.find((t) => t.name === "ZQ Antiga");
check("e a categoria vem sem `period`", antiga && !("period" in antiga), JSON.stringify(antiga));

/* =============================================================== fecho === */

await limpar();
await db.end();

console.log(`\n${ok} OK · ${bad} falhas`);
process.exit(bad === 0 ? 0 : 1);

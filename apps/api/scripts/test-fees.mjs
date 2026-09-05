#!/usr/bin/env node
/**
 * Ajuste manual do estado de uma mensalidade (direção).
 *
 * O que interessa: só a direção o pode fazer (`billing:write`), os três estados
 * reais, o registo de um pagamento manual ao marcar como paga, e a validação.
 *
 * Uso: node scripts/test-fees.mjs
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
    method, headers: { Authorization: `Bearer ${token}`, "x-academy-slug": "life-club", ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};

const db = new pg.Client({ connectionString: env("MIGRATE_DATABASE_URL"), ssl: { rejectUnauthorized: false } });
await db.connect();

const director = await login("direcao@lifeclub.pt");
const parent = await login("familia@lifeclub.pt");

// Escolhe uma cobrança qualquer e guarda o estado original, para o repor no fim.
const all = await call(director, "GET", "/api/charges?period=all");
const charges = await call(director, "GET", "/api/charges");
const target = (Array.isArray(charges.body) ? charges.body : []).find((c) => c.status !== "VOID") ?? all.body?.[0];
if (!target) { console.log("Sem cobranças para testar."); process.exit(1); }
const original = (await db.query(`SELECT status, "settledAt" FROM "Charge" WHERE id=$1`, [target.id])).rows[0];

console.log(`=== Cobrança de teste: ${target.id} (estava ${original.status}) ===`);

const paid = await call(director, "PATCH", `/api/charges/${target.id}/status`, { status: "SETTLED" });
check("a direção marca como paga (200)", paid.status === 200 && paid.body?.status === "SETTLED", `${paid.status}`);
const afterPaid = (await db.query(`SELECT status, "settledAt" FROM "Charge" WHERE id=$1`, [target.id])).rows[0];
check("a cobrança fica SETTLED com data de liquidação", afterPaid.status === "SETTLED" && afterPaid.settledAt !== null);
const manual = (await db.query(`SELECT method, provider, status FROM "Payment" WHERE "chargeId"=$1 AND provider='manual' ORDER BY "createdAt" DESC LIMIT 1`, [target.id])).rows[0];
check("fica registado um pagamento manual (CASH/PAID)", manual?.method === "CASH" && manual?.status === "PAID", JSON.stringify(manual));

const reopen = await call(director, "PATCH", `/api/charges/${target.id}/status`, { status: "OPEN" });
check("volta a por pagar (200)", reopen.status === 200 && reopen.body?.status === "OPEN", `${reopen.status}`);
const afterOpen = (await db.query(`SELECT status, "settledAt" FROM "Charge" WHERE id=$1`, [target.id])).rows[0];
check("fica OPEN e sem data de liquidação", afterOpen.status === "OPEN" && afterOpen.settledAt === null);
const refunded = (await db.query(`SELECT status FROM "Payment" WHERE "chargeId"=$1 AND provider='manual' ORDER BY "createdAt" DESC LIMIT 1`, [target.id])).rows[0];
check("o pagamento manual passa a reembolsado", refunded?.status === "REFUNDED", JSON.stringify(refunded));

const voided = await call(director, "PATCH", `/api/charges/${target.id}/status`, { status: "VOID" });
check("a direção anula (200)", voided.status === 200 && voided.body?.status === "VOID", `${voided.status}`);

console.log("\n=== Quem não pode ===");
const byParent = await call(parent, "PATCH", `/api/charges/${target.id}/status`, { status: "SETTLED" });
check("um encarregado não altera mensalidades (403)", byParent.status === 403, `${byParent.status}`);
const bad1 = await call(director, "PATCH", `/api/charges/${target.id}/status`, { status: "PAGO" });
check("estado inválido recusado (400)", bad1.status === 400, `${bad1.status}`);
const bad2 = await call(director, "PATCH", `/api/charges/nao_existe/status`, { status: "OPEN" });
check("cobrança inexistente recusada (404)", bad2.status === 404, `${bad2.status}`);

console.log("\n=== Lançar mensalidade à mão ===");

/*
 * O que isto cobre.
 *
 * A emissão automática deriva o valor do plano e salta quem não tem preço. O
 * lançamento à mão é o gesto directo — este atleta, este valor, estes meses —
 * e serve o atleta sem preço, o mês fora do calendário do clube, e o acerto de
 * quem entrou a meio da época. O que interessa provar: as linhas nascem como
 * mensalidade (`FEE`, `slot` vazio, para a emissão automática as reconhecer),
 * um mês repetido salta em vez de rebentar o pedido inteiro, e a fronteira é a
 * do costume.
 */
const ANO_TESTE = 2031;
const mesesTeste = [`${ANO_TESTE}-03`, `${ANO_TESTE}-04`, `${ANO_TESTE}-05`];
await db.query(`DELETE FROM "Charge" WHERE period LIKE $1`, [`${ANO_TESTE}-%`]);

/*
 * Um atleta **com encarregado activo** — e não o primeiro que aparecer.
 *
 * Era `LIMIT 1` sobre os activos, e calhava o Dinis, que no plantel semeado não
 * tem ninguém ligado a ele. As mensalidades nasciam bem e o aviso à família não
 * saía, porque não havia família a quem sair: a asserção do fim falhava a
 * acusar o produto de uma coisa que o produto faz. O que este bloco tem de
 * provar inclui o aviso, e por isso o atleta tem de poder recebê-lo.
 */
const alvoAtleta = (
  await db.query(
    `SELECT a.id, a.name FROM "Athlete" a
      JOIN "Academy" ac ON ac.id = a."academyId"
      JOIN "GuardianLink" g ON g."athleteId" = a.id
      JOIN "Membership" m ON m.id = g."membershipId" AND m."isActive"
     WHERE ac.slug = 'life-club' AND a.status = 'ACTIVE' LIMIT 1`,
  )
).rows[0];
check("há um atleta com encarregado para lançar", Boolean(alvoAtleta));

const lancadas = await call(director, "POST", "/api/charges/mensalidade", {
  athleteId: alvoAtleta.id,
  amountCents: 3500,
  periods: mesesTeste,
  notes: "ZF acerto de teste",
});
check("a direção lança três meses", lancadas.status === 201 || lancadas.status === 200, `${lancadas.status} ${JSON.stringify(lancadas.body).slice(0, 140)}`);
check("e diz que criou três", lancadas.body?.criadas === 3, JSON.stringify(lancadas.body));

const naBase = (
  await db.query(
    `SELECT period, kind, slot, "amountCents", status FROM "Charge"
      WHERE "athleteId" = $1 AND period LIKE $2 ORDER BY period`,
    [alvoAtleta.id, `${ANO_TESTE}-%`],
  )
).rows;
check("as três linhas existem na base", naBase.length === 3, `${naBase.length}`);
check("nascem como mensalidade (FEE)", naBase.every((c) => c.kind === "FEE"), JSON.stringify(naBase.map((c) => c.kind)));
check(
  "com o slot vazio — é o que impede uma segunda no mesmo mês",
  naBase.every((c) => c.slot === ""),
  JSON.stringify(naBase.map((c) => c.slot)),
);
check("com o valor escolhido", naBase.every((c) => c.amountCents === 3500), JSON.stringify(naBase.map((c) => c.amountCents)));
check("e por pagar", naBase.every((c) => c.status === "OPEN"), JSON.stringify(naBase.map((c) => c.status)));

/* O vencimento é o dia do clube, como nas automáticas. */
const diaClube = (
  await db.query(`SELECT "billingDueDay" FROM "Academy" WHERE slug = 'life-club'`)
).rows[0]?.billingDueDay;
const vencimentos = (
  await db.query(
    `SELECT EXTRACT(DAY FROM "dueDate")::int AS dia FROM "Charge" WHERE "athleteId" = $1 AND period LIKE $2`,
    [alvoAtleta.id, `${ANO_TESTE}-%`],
  )
).rows;
check(
  "o vencimento é o dia de cobrança do clube",
  vencimentos.every((v) => v.dia === diaClube),
  `esperado ${diaClube}, veio ${JSON.stringify(vencimentos.map((v) => v.dia))}`,
);

/* Repetir: os meses que já existem saltam, os novos entram. */
const repetido = await call(director, "POST", "/api/charges/mensalidade", {
  athleteId: alvoAtleta.id,
  amountCents: 3500,
  periods: [`${ANO_TESTE}-05`, `${ANO_TESTE}-06`],
});
check("repetir um mês não rebenta o pedido", repetido.status === 201 || repetido.status === 200, `${repetido.status}`);
check("cria só o mês novo", repetido.body?.criadas === 1, JSON.stringify(repetido.body));
check(
  "e diz qual já existia",
  Array.isArray(repetido.body?.jaExistiam) && repetido.body.jaExistiam.includes(`${ANO_TESTE}-05`),
  JSON.stringify(repetido.body?.jaExistiam),
);

console.log("\n=== O que o lançamento à mão recusa ===");
const semPermissao = await call(parent, "POST", "/api/charges/mensalidade", {
  athleteId: alvoAtleta.id,
  amountCents: 3500,
  periods: [`${ANO_TESTE}-07`],
});
check("um encarregado não lança mensalidades (403)", semPermissao.status === 403, `${semPermissao.status}`);

const mesInvalido = await call(director, "POST", "/api/charges/mensalidade", {
  athleteId: alvoAtleta.id,
  amountCents: 3500,
  periods: ["2031-13"],
});
check("um mês impossível é recusado (400)", mesInvalido.status === 400, `${mesInvalido.status}`);

const semMeses = await call(director, "POST", "/api/charges/mensalidade", {
  athleteId: alvoAtleta.id,
  amountCents: 3500,
  periods: [],
});
check("sem meses nenhum é recusado (400)", semMeses.status === 400, `${semMeses.status}`);

const atletaFantasma = await call(director, "POST", "/api/charges/mensalidade", {
  athleteId: "nao_existe",
  amountCents: 3500,
  periods: [`${ANO_TESTE}-07`],
});
check("um atleta que não existe dá 404", atletaFantasma.status === 404, `${atletaFantasma.status}`);

/* A família fica avisada — é o que faz a mensalidade aparecer no telemóvel. */
const avisos = (
  await db.query(
    `SELECT COUNT(*)::int AS n FROM "Notification"
      WHERE type = 'PAYMENT_PENDING' AND title = 'Nova mensalidade' AND "createdAt" > now() - interval '2 minutes'`,
  )
).rows[0];
check("a família foi avisada das mensalidades novas", avisos.n >= 1, `${avisos.n} notificações`);

await db.query(`DELETE FROM "Charge" WHERE period LIKE $1`, [`${ANO_TESTE}-%`]);

console.log("\n=== Repor estado original ===");
// Limpa os pagamentos manuais de teste e repõe a cobrança como estava.
await db.query(`DELETE FROM "Payment" WHERE "chargeId"=$1 AND provider='manual'`, [target.id]);
await db.query(`UPDATE "Charge" SET status=$1, "settledAt"=$2 WHERE id=$3`, [original.status, original.settledAt, target.id]);
await db.end();
console.log("  feito");

console.log(`\n${ok} passaram, ${bad} falharam`);
process.exit(bad === 0 ? 0 : 1);

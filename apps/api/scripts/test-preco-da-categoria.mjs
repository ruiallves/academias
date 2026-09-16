#!/usr/bin/env node
/**
 * Mudar o preço de uma categoria: entra já, ou só a partir do próximo período?
 *
 * ## O caso
 *
 * Um Sócio Gold estava com 1 € de anualidade. A direcção pôs a categoria a
 * 0,01 € — e a ficha e a app continuaram a dizer 1 €. Mudar a categoria nunca
 * tocava no que já estava lançado: certo para o passado, errado para o ano em
 * curso, e a direcção não tinha onde dizer qual dos dois queria.
 *
 * ## A regra
 *
 * Ao guardar um preço diferente numa categoria que já existe, pergunta-se
 * (`applyToCurrent`):
 *
 * - **já neste período**: as quotas **por pagar** do período corrente dos sócios
 *   activos da categoria passam ao valor novo. As pagas não se tocam — é
 *   dinheiro recebido. Os atrasos de períodos anteriores não se tocam — são de
 *   outros preços. Uma tentativa de pagamento em voo sobre uma quota repreçada
 *   expira, porque a referência tem o valor antigo e o webhook recusá-la-ia;
 * - **só a partir do próximo**: nada do que está lançado muda.
 *
 * Uso: node scripts/test-preco-da-categoria.mjs
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
const LC = (await db.query(`SELECT id FROM "Academy" WHERE slug = 'life-club'`)).rows[0].id;
const MES_DO_CLUBE = (await db.query(`SELECT "memberAnnualStartMonth" AS m FROM "Academy" WHERE id = $1`, [LC])).rows[0].m;

const agora = new Date();
const mm = (m) => String(m).padStart(2, "0");
const MES_CORRENTE = `${agora.getFullYear()}-${mm(agora.getMonth() + 1)}`;
const MES_ANTERIOR = (() => { const d = new Date(agora.getFullYear(), agora.getMonth() - 1, 1); return `${d.getFullYear()}-${mm(d.getMonth() + 1)}`; })();
const ANO_ABERTURA = agora.getMonth() + 1 >= MES_DO_CLUBE ? agora.getFullYear() : agora.getFullYear() - 1;
const PERIODO_ANUAL = `${ANO_ABERTURA}-${mm(MES_DO_CLUBE)}`;

const limpar = async () => {
  const ids = (await db.query(`SELECT id FROM "MemberFee" WHERE "memberId" LIKE 'zp_%'`)).rows.map((r) => r.id);
  if (ids.length) {
    await db.query(`DELETE FROM "PaymentMemberFee" WHERE "memberFeeId" = ANY($1)`, [ids]).catch(() => undefined);
    await db.query(`DELETE FROM "Payment" WHERE "memberFeeId" = ANY($1)`, [ids]);
    await db.query(`DELETE FROM "MemberFee" WHERE id = ANY($1)`, [ids]);
  }
  await db.query(`DELETE FROM "Member" WHERE id LIKE 'zp_%'`);
  await db.query(`DELETE FROM "MemberTier" WHERE "academyId" = $1 AND name LIKE 'ZP %'`, [LC]);
};
await limpar();

const director = await login("direcao@lifeclub.pt");
const valor = async (id) => (await db.query(`SELECT "amountCents" AS v, status FROM "MemberFee" WHERE id = $1`, [id])).rows[0];

try {
  /* ======================================================= mensal ======== */
  console.log("=== Categoria mensal a 10 €: um sócio com o mês corrente por pagar, o anterior pago ===");
  const mensal = (await call(director, "POST", "/api/members/tiers", { name: "ZP Mensal", feeCents: 1000, billing: "MONTHLY", isPublic: false })).body;
  await db.query(
    `INSERT INTO "Member" (id, "academyId", "tierId", name, number, status, source, "updatedAt")
     VALUES ('zp_socio', $1, $2, 'ZP Sócio Mensal', 98821, 'ACTIVE', 'secretaria', now())`, [LC, mensal.id],
  );
  await db.query(
    `INSERT INTO "MemberFee" (id, "academyId", "memberId", period, label, "amountCents", "dueOn", status, "settledAt", "updatedAt") VALUES
       ('zp_fee_anterior', $1, 'zp_socio', $2, 'Quota anterior', 1000, now() - interval '20 days', 'SETTLED', now() - interval '25 days', now()),
       ('zp_fee_corrente', $1, 'zp_socio', $3, 'Quota corrente', 1000, now() + interval '10 days', 'OPEN', NULL, now())`,
    [LC, MES_ANTERIOR, MES_CORRENTE],
  );
  /* Uma referência em voo sobre a corrente, com o valor antigo. */
  await db.query(
    `INSERT INTO "Payment" (id, "memberFeeId", "amountCents", method, status, provider, "providerRef", "updatedAt")
     VALUES ('zp_pay_voo', 'zp_fee_corrente', 1000, 'MULTIBANCO', 'PENDING', 'eupago', 'zp-ref', now())`,
  );

  console.log("\n--- só a partir do próximo: nada muda");
  const soProximo = await call(director, "PATCH", `/api/members/tiers/${mensal.id}`, {
    name: "ZP Mensal", feeCents: 500, billing: "MONTHLY", isPublic: false, applyToCurrent: false,
  });
  check("a mudança é aceite", soProximo.status === 200, `${soProximo.status} ${JSON.stringify(soProximo.body)}`);
  check("e não repreçou nada", soProximo.body?.repriced === 0, `${soProximo.body?.repriced}`);
  check("a quota corrente continua a 10 €", (await valor("zp_fee_corrente"))?.v === 1000);
  check("a categoria ficou a 5 €", ((await call(director, "GET", "/api/members/tiers")).body ?? []).find((t) => t.id === mensal.id)?.feeCents === 500);
  check("a referência em voo continua viva", (await db.query(`SELECT status FROM "Payment" WHERE id = 'zp_pay_voo'`)).rows[0].status === "PENDING");

  console.log("\n--- já neste mês: a corrente por pagar muda, a paga não");
  const jaAgora = await call(director, "PATCH", `/api/members/tiers/${mensal.id}`, {
    name: "ZP Mensal", feeCents: 250, billing: "MONTHLY", isPublic: false, applyToCurrent: true,
  });
  check("a mudança é aceite", jaAgora.status === 200, `${jaAgora.status}`);
  check("repreçou uma quota", jaAgora.body?.repriced === 1, `${jaAgora.body?.repriced}`);
  check("a corrente por pagar passou a 2,50 €", (await valor("zp_fee_corrente"))?.v === 250, JSON.stringify(await valor("zp_fee_corrente")));
  check("a anterior, paga, ficou a 10 € — dinheiro recebido não se reescreve", (await valor("zp_fee_anterior"))?.v === 1000);
  check("a referência em voo com o valor antigo expirou", (await db.query(`SELECT status FROM "Payment" WHERE id = 'zp_pay_voo'`)).rows[0].status === "EXPIRED");
  const ficha = await call(director, "GET", "/api/members/zp_socio");
  check("a ficha diz 2,50 € por pagar", ficha.body?.fees?.openCents === 250, `${ficha.body?.fees?.openCents}`);

  console.log("\n--- o mesmo preço outra vez: não há o que repreçar");
  const igual = await call(director, "PATCH", `/api/members/tiers/${mensal.id}`, {
    name: "ZP Mensal", feeCents: 250, billing: "MONTHLY", isPublic: false, applyToCurrent: true,
  });
  check("aceite, e zero repreçadas", igual.status === 200 && igual.body?.repriced === 0, `${igual.status} ${igual.body?.repriced}`);

  /* ======================================================= anual ========= */
  console.log("\n=== Categoria anual a 1 €: o caso do Sócio Gold ===");
  const anual = (await call(director, "POST", "/api/members/tiers", { name: "ZP Gold", feeCents: 100, billing: "ANNUAL", isPublic: false })).body;
  await db.query(
    `INSERT INTO "Member" (id, "academyId", "tierId", name, number, status, source, "updatedAt") VALUES
       ('zp_gold',      $1, $2, 'ZP Gold Por Pagar', 98822, 'ACTIVE',    'secretaria', now()),
       ('zp_gold_pago', $1, $2, 'ZP Gold Pago',      98823, 'ACTIVE',    'secretaria', now()),
       ('zp_gold_susp', $1, $2, 'ZP Gold Suspenso',  98824, 'SUSPENDED', 'secretaria', now())`, [LC, anual.id],
  );
  await db.query(
    `INSERT INTO "MemberFee" (id, "academyId", "memberId", period, label, "amountCents", "dueOn", status, "settledAt", "updatedAt") VALUES
       ('zp_gold_fee',      $1, 'zp_gold',      $2, 'Quota anual', 100, now() + interval '10 days', 'OPEN',    NULL,   now()),
       ('zp_gold_fee_pago', $1, 'zp_gold_pago', $2, 'Quota anual', 100, now() + interval '10 days', 'SETTLED', now(),  now()),
       ('zp_gold_fee_susp', $1, 'zp_gold_susp', $2, 'Quota anual', 100, now() + interval '10 days', 'OPEN',    NULL,   now())`,
    [LC, PERIODO_ANUAL],
  );

  const gold = await call(director, "PATCH", `/api/members/tiers/${anual.id}`, {
    name: "ZP Gold", feeCents: 1, billing: "ANNUAL", isPublic: false, applyToCurrent: true,
  });
  check("passa a 0,01 € já neste ano", gold.status === 200 && gold.body?.repriced === 1, `${gold.status} repriced=${gold.body?.repriced}`);
  check("o sócio activo por pagar passou a 0,01 €", (await valor("zp_gold_fee"))?.v === 1);
  check("o que já pagou 1 € fica a 1 €", (await valor("zp_gold_fee_pago"))?.v === 100);
  check("o suspenso não é tocado — não gera nem recebe quotas", (await valor("zp_gold_fee_susp"))?.v === 100);

  console.log("\n--- sem a resposta, o servidor assume 'só a partir do próximo'");
  const semResposta = await call(director, "PATCH", `/api/members/tiers/${anual.id}`, {
    name: "ZP Gold", feeCents: 5, billing: "ANNUAL", isPublic: false,
  });
  check("aceite", semResposta.status === 200, `${semResposta.status}`);
  check("e nada repreçado", semResposta.body?.repriced === 0 && (await valor("zp_gold_fee"))?.v === 1);
} finally {
  console.log("\n=== Limpeza ===");
  await limpar();
  const restos = (await db.query(`SELECT COUNT(*)::int n FROM "Member" WHERE id LIKE 'zp_%'`)).rows[0].n
    + (await db.query(`SELECT COUNT(*)::int n FROM "MemberTier" WHERE name LIKE 'ZP %'`)).rows[0].n;
  check("tudo apagado", restos === 0, `${restos} linhas ficaram`);
  await db.end();
}

console.log(`\n${ok} OK · ${bad} falhas`);
process.exit(bad === 0 ? 0 : 1);

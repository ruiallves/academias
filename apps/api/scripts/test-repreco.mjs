#!/usr/bin/env node
/**
 * Mudar um preço aplica-se às mensalidades já emitidas.
 *
 * ## O que estava errado
 *
 * O diálogo pergunta "aplicar já em Agosto?" e `gerarCobrancas` só cria o que
 * falta. Para quem já tinha a mensalidade de Agosto emitida — ou seja, toda a
 * gente — a resposta era não fazer nada. O plano da equipa passava a 35 €, a
 * ficha do atleta dizia 35 €, e a tabela das mensalidades continuava a dizer
 * 40 €. A app do pai lê a mesma cobrança, por isso mostrava 40 € também.
 *
 * ## O que este teste protege
 *
 * Sobretudo o que **não** se mexe: pagas, anuladas, e as que já têm um pagamento
 * a caminho. Essa última é a que se perde de vista mais depressa e a que custa
 * mais caro — uma referência Multibanco de 40 € já no telemóvel do pai, com a
 * cobrança mudada para 35 € por baixo dela.
 *
 * Uso: node scripts/test-repreco.mjs
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
const check = (l, c, d = "") => {
  if (c) { ok++; console.log("  OK    " + l); }
  else { bad++; console.log("  FALHA " + l + (d ? " — " + d : "")); }
};

const login = async (email) =>
  (await (await fetch(`${S}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: A, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "academia2026" }),
  })).json()).access_token;

const call = async (token, method, pathname, body) => {
  const r = await fetch(API + pathname, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "x-academy-slug": "life-club",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};

const db = new pg.Client({ connectionString: env("MIGRATE_DATABASE_URL"), ssl: { rejectUnauthorized: false } });
await db.connect();

const academia = (await db.query(`SELECT id FROM "Academy" WHERE slug = 'life-club'`)).rows[0].id;
const equipa = "t_sub11";
const periodo = new Date().toISOString().slice(0, 7);

/*
 * O preço original da equipa, para o repor no fim.
 *
 * Se não houver nenhum, este teste não tem sobre o que trabalhar — e sair a
 * dizê-lo é melhor do que criar um preço numa equipa que não o tinha e deixá-lo
 * lá. Foi assim que se descobriu que outro teste apagava este plano na limpeza.
 */
const original = (await db.query(
  `SELECT id, "amountCents" FROM "SubscriptionPlan" WHERE "teamId" = $1 AND "isActive" ORDER BY id DESC LIMIT 1`,
  [equipa],
)).rows[0];
if (!original) {
  console.log(`  SALTA tudo — a equipa ${equipa} não tem preço configurado.`);
  console.log("  Configura-lhe uma mensalidade na consola e corre outra vez.");
  await db.end();
  process.exit(0);
}

const cobrancasAntes = (await db.query(
  `SELECT id, "athleteId", "amountCents", status FROM "Charge" WHERE "academyId" = $1 AND period = $2`,
  [academia, periodo],
)).rows;

/*
 * Os pagamentos deste período, guardados linha a linha.
 *
 * O teste precisa de deixar as cobranças sem pagamentos a caminho para medir a
 * reprecificação — e apagá-los sem os repor era destruir dados de um clube. Numa
 * academia de demonstração isso passa despercebido; no dia em que alguém corra
 * isto apontado a outra base, não passa.
 */
const pagamentosAntes = (await db.query(
  `SELECT p.* FROM "Payment" p JOIN "Charge" c ON c.id = p."chargeId"
    WHERE c."academyId" = $1 AND c.period = $2`,
  [academia, periodo],
)).rows;

async function repor() {
  if (original) {
    await db.query(`UPDATE "SubscriptionPlan" SET "amountCents" = $1 WHERE id = $2`, [original.amountCents, original.id]);
  }
  for (const c of cobrancasAntes) {
    await db.query(`UPDATE "Charge" SET "amountCents" = $1, status = $2 WHERE id = $3`, [c.amountCents, c.status, c.id]);
  }
  await db.query(`DELETE FROM "Payment" WHERE "providerRef" LIKE 'zz-repreco-%'`);

  // E os que este teste apagou para montar o cenário voltam como estavam.
  for (const p of pagamentosAntes) {
    await db.query(
      `INSERT INTO "Payment" (id, "chargeId", "amountCents", method, status, provider, "providerRef",
                              entity, reference, "paidAt", "expiresAt", "rawPayload", "createdAt", "updatedAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (id) DO NOTHING`,
      [p.id, p.chargeId, p.amountCents, p.method, p.status, p.provider, p.providerRef,
       p.entity, p.reference, p.paidAt, p.expiresAt, p.rawPayload, p.createdAt, p.updatedAt],
    );
  }
  await db.query(`DELETE FROM "Charge" WHERE "academyId" = $1 AND period = $2 AND id <> ALL($3::text[])`, [
    academia, periodo, cobrancasAntes.map((c) => c.id),
  ]);
}

const doAtleta = async (athleteId) =>
  (await db.query(`SELECT "amountCents", status FROM "Charge" WHERE "athleteId" = $1 AND period = $2`, [athleteId, periodo])).rows[0];

const director = await login("direcao@lifeclub.pt");

try {
  /* Os atletas desta equipa que pagam o preço dela. */
  const daEquipa = (await db.query(
    `SELECT a.id, a.name FROM "Athlete" a
       JOIN "TeamMembership" tm ON tm."athleteId" = a.id
      WHERE tm."teamId" = $1 AND a.status = 'ACTIVE'
        -- Sem ajuste individual activo: esses pagam o preço deles e ficam de
        -- fora da reprecificação da equipa por desenho, não por engano.
        AND NOT EXISTS (
          SELECT 1 FROM "Enrollment" e
            JOIN "SubscriptionPlan" p ON p.id = e."planId"
           WHERE e."athleteId" = a.id AND p."teamId" IS NULL AND p."isActive"
             AND (e."endsOn" IS NULL OR e."endsOn" >= CURRENT_DATE)
        )
      ORDER BY a.name`,
    [equipa],
  )).rows;
  check("há atletas nesta equipa para testar", daEquipa.length >= 3, `${daEquipa.length}`);

  /* Garante que todos têm cobrança deste período, como em produção. */
  await call(director, "PATCH", `/api/teams/${equipa}/fee`, { amountCents: 4000, aplicarEm: "atual" });

  /*
   * Deixa toda a equipa por pagar e sem pagamentos a caminho.
   *
   * A academia de demonstração tem mensalidades já pagas e uma com referência
   * emitida — que é bom, porque é o mundo real, mas transforma "todos deviam
   * mudar" numa expectativa errada. Este teste mede a reprecificação; os casos em
   * que ela **não** se aplica têm secções próprias mais abaixo, montadas de
   * propósito e uma de cada vez.
   */
  await db.query(
    `UPDATE "Charge" SET status = 'OPEN' WHERE "academyId" = $1 AND period = $2 AND "athleteId" = ANY($3::text[])`,
    [academia, periodo, daEquipa.map((a) => a.id)],
  );
  await db.query(
    `DELETE FROM "Payment" WHERE "chargeId" IN (
       SELECT id FROM "Charge" WHERE "academyId" = $1 AND period = $2 AND "athleteId" = ANY($3::text[])
     )`,
    [academia, periodo, daEquipa.map((a) => a.id)],
  );
  await call(director, "PATCH", `/api/teams/${equipa}/fee`, { amountCents: 4000, aplicarEm: "atual" });

  console.log("=== O caso reportado: mudar o preço muda a tabela ===");
  const antes = await doAtleta(daEquipa[0].id);
  check("a cobrança começa a 40 €", antes.amountCents === 4000, `${antes?.amountCents}`);

  const r = await call(director, "PATCH", `/api/teams/${equipa}/fee`, { amountCents: 3500, aplicarEm: "atual" });
  check("a direção baixa para 35 €", r.status === 200, `${r.status}`);
  check(
    "e o servidor diz quantas actualizou",
    r.body?.reprecadas?.actualizadas === daEquipa.length,
    JSON.stringify(r.body?.reprecadas) + ` para ${daEquipa.length} atletas`,
  );

  const depois = await doAtleta(daEquipa[0].id);
  check("a cobrança passou a 35 €", depois.amountCents === 3500, `${depois.amountCents}`);
  check("continua por pagar", depois.status === "OPEN", depois.status);

  // Sequencial: um `pg.Client` só corre uma consulta de cada vez, e em paralelo
  // devolve resultados trocados sem dar erro nenhum.
  const todas = [];
  for (const a of daEquipa) todas.push(await doAtleta(a.id));
  check("e todas as da equipa acompanharam", todas.every((c) => c.amountCents === 3500), todas.map((c) => c.amountCents).join(","));

  console.log("\n=== Uma mensalidade paga não se reescreve ===");
  /*
   * O dinheiro entrou por aquele valor. Mudá-lo era mudar o passado e deixar a
   * conta do clube a não bater certo com o banco.
   */
  const pago = daEquipa[1].id;
  await db.query(`UPDATE "Charge" SET status = 'SETTLED' WHERE "athleteId" = $1 AND period = $2`, [pago, periodo]);
  await call(director, "PATCH", `/api/teams/${equipa}/fee`, { amountCents: 2500, aplicarEm: "atual" });
  const aindaPago = await doAtleta(pago);
  check("fica com o valor por que foi paga", aindaPago.amountCents === 3500, `${aindaPago.amountCents}`);
  check("e continua paga", aindaPago.status === "SETTLED", aindaPago.status);
  check("as outras desceram para 25 €", (await doAtleta(daEquipa[0].id)).amountCents === 2500, `${(await doAtleta(daEquipa[0].id)).amountCents}`);

  console.log("\n=== Uma anulada não ressuscita ===");
  const anulado = daEquipa[2].id;
  await db.query(`UPDATE "Charge" SET status = 'VOID' WHERE "athleteId" = $1 AND period = $2`, [anulado, periodo]);
  const valorAnulado = (await doAtleta(anulado)).amountCents;
  await call(director, "PATCH", `/api/teams/${equipa}/fee`, { amountCents: 2000, aplicarEm: "atual" });
  const aindaAnulado = await doAtleta(anulado);
  check("fica como estava", aindaAnulado.amountCents === valorAnulado, `${aindaAnulado.amountCents} vs ${valorAnulado}`);
  check("e continua anulada", aindaAnulado.status === "VOID", aindaAnulado.status);

  console.log("\n=== Com um pagamento a caminho, não se mexe ===");
  /*
   * O caso que se perde de vista: a referência Multibanco de 20 € já está no
   * telemóvel do pai e no sistema da euPago. Mudar a cobrança por baixo dela
   * deixa-o a pagar um valor que a plataforma já não reconhece.
   */
  const aPagar = daEquipa[0].id;
  const chargeId = (await db.query(`SELECT id FROM "Charge" WHERE "athleteId" = $1 AND period = $2`, [aPagar, periodo])).rows[0].id;
  await db.query(
    `INSERT INTO "Payment" (id, "chargeId", "amountCents", method, status, provider, "providerRef", "createdAt", "updatedAt")
     VALUES (gen_random_uuid()::text, $1, 2000, 'MULTIBANCO', 'PENDING', 'eupago', 'zz-repreco-1', NOW(), NOW())`,
    [chargeId],
  );

  const comPagamento = await call(director, "PATCH", `/api/teams/${equipa}/fee`, { amountCents: 3000, aplicarEm: "atual" });
  const travada = await doAtleta(aPagar);
  check("a cobrança com pagamento pendente não muda", travada.amountCents === 2000, `${travada.amountCents}`);
  check("e o servidor diz que ficou de fora", comPagamento.body?.reprecadas?.intocadas >= 1, JSON.stringify(comPagamento.body?.reprecadas));

  console.log("\n=== \"Aplicar no próximo mês\" não mexe em nada ===");
  const antesDoProximo = (await doAtleta(daEquipa[3]?.id ?? daEquipa[0].id)).amountCents;
  await call(director, "PATCH", `/api/teams/${equipa}/fee`, { amountCents: 4500, aplicarEm: "proximo" });
  const depoisDoProximo = (await doAtleta(daEquipa[3]?.id ?? daEquipa[0].id)).amountCents;
  check("as cobranças deste mês ficam como estavam", depoisDoProximo === antesDoProximo, `${antesDoProximo} → ${depoisDoProximo}`);
  const plano = (await db.query(`SELECT "amountCents" FROM "SubscriptionPlan" WHERE id = $1`, [original.id])).rows[0];
  check("mas o preço da equipa mudou", plano.amountCents === 4500, `${plano.amountCents}`);

  console.log("\n=== O tecto explica-se em português e em euros ===");
  /*
   * O bug de produção: o campo vem preenchido com "60.00", quem escreve sem
   * seleccionar fica com "3560.00", e 3560 € passa o tecto. A mensagem que
   * chegava era "amountCents must not be greater than 100000".
   */
  const acima = await call(director, "PATCH", `/api/teams/${equipa}/fee`, { amountCents: 356000, aplicarEm: "atual" });
  check("recusa acima de 1000 € (400)", acima.status === 400, `${acima.status}`);
  const msg = [].concat(acima.body?.message ?? []).join(" ");
  check("e diz porquê, em euros", msg.includes("1000 €"), msg);
  check("sem falar em cêntimos nem no nome do campo", !msg.includes("amountCents") && !msg.includes("100000"), msg);

  const abaixo = await call(director, "PATCH", `/api/teams/${equipa}/fee`, { amountCents: 0, aplicarEm: "atual" });
  const msgBaixa = [].concat(abaixo.body?.message ?? []).join(" ");
  check("recusa abaixo de 1 €, também em português", abaixo.status === 400 && msgBaixa.includes("1 €"), msgBaixa);
} finally {
  console.log("\n=== Repor o estado original ===");
  await repor();
  const conferir = (await db.query(
    `SELECT "amountCents" FROM "SubscriptionPlan" WHERE id = $1`, [original.id],
  )).rows[0];
  check("o preço da equipa voltou ao que estava", conferir?.amountCents === original.amountCents, `${conferir?.amountCents} vs ${original.amountCents}`);
  await db.end();
}

console.log(`\n${ok} passaram, ${bad} falharam`);
process.exit(bad === 0 ? 0 : 1);

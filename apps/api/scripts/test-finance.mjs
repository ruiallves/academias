#!/usr/bin/env node
/**
 * As contas do clube.
 *
 * ## O que este teste existe para provar
 *
 * Que **o saldo diz a verdade**. As quatro coisas que não podem falhar:
 *
 * 1. **Previsto ≠ realizado.** Só `COMPLETED` mexe no saldo; `PLANNED` e
 *    `PENDING` vivem nas previsões, dentro do horizonte pedido. Confirmar um
 *    previsto move o valor de uma coluna para a outra — nunca conta duas vezes.
 * 2. **As mensalidades derivam-se, nunca se copiam.** As linhas automáticas vêm
 *    de `Charge` a cada leitura; desligar a fonte muda o saldo e não toca num
 *    pagamento; nenhuma cópia aparece em `FinancialTransaction`.
 * 3. **Nada se apaga.** Cancelar risca e mantém a linha; reactivar um cancelado
 *    é recusado — regista-se um movimento novo.
 * 4. **Isolamento e permissões no servidor.** Um treinador não vê as contas;
 *    outro clube não vê nem mexe nas nossas.
 *
 * Uso: node scripts/test-finance.mjs
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

const call = async (token, method, pathname, body, slug = "life-club") => {
  const r = await fetch(API + pathname, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "x-academy-slug": slug,
      "x-app": "console",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};

const db = new pg.Client({ connectionString: env("MIGRATE_DATABASE_URL"), ssl: { rejectUnauthorized: false } });
await db.connect();

const academia = (await db.query(`SELECT id FROM "Academy" WHERE slug = 'life-club'`)).rows[0].id;

const limpar = async () => {
  await db.query(`DELETE FROM "FinancialTransaction" WHERE description LIKE 'ZF %'`);
  await db.query(`DELETE FROM "FinancialBudget" WHERE "academyId" = $1`, [academia]);
  await db.query(`DELETE FROM "CalendarEvent" WHERE title LIKE 'ZF %'`);
};
await limpar();

const director = await login("direcao@lifeclub.pt");
const coach = await login("treinador@lifeclub.pt");

const dia = (mais = 0) => new Date(Date.now() + mais * 86_400_000).toISOString().slice(0, 10);
const overview = async (horizon) =>
  (await call(director, "GET", `/api/finance/overview${horizon ? `?horizon=${horizon}` : ""}`)).body;

// Ponto de partida conhecido: saldo inicial a zero, mensalidades ligadas.
await call(director, "PUT", "/api/finance/settings", { initialBalanceCents: 0, initialBalanceAt: "", includeFees: true });

/* ======================================================== permissões ==== */

console.log("=== As contas não são de todos ===");
const coachVe = await call(coach, "GET", "/api/finance/overview");
check("um treinador não vê as contas (403)", coachVe.status === 403, `${coachVe.status}`);
const coachRegista = await call(coach, "POST", "/api/finance/transactions", {
  kind: "EXPENSE", description: "ZF Tentativa", amountCents: 100, occurredAt: dia(),
});
check("nem regista movimentos (403)", coachRegista.status === 403, `${coachRegista.status}`);
const coachMexeNasDefinicoes = await call(coach, "PUT", "/api/finance/settings", { initialBalanceCents: 1 });
check("nem mexe nas definições (403)", coachMexeNasDefinicoes.status === 403, `${coachMexeNasDefinicoes.status}`);

/* ================================================== saldo e previsto ==== */

console.log("\n=== Saldo inicial e movimentos ===");
const defs = await call(director, "GET", "/api/finance/settings");
check("as definições existem à primeira leitura", defs.status === 200 && defs.body?.initialBalanceCents === 0, JSON.stringify(defs.body));

const ov0 = await overview();
check("o painel responde", typeof ov0?.saldo === "number", JSON.stringify(ov0).slice(0, 120));

await call(director, "PUT", "/api/finance/settings", { initialBalanceCents: 250_000 });
const ov1 = await overview();
check("o saldo inicial entra no saldo (+2500€)", ov1.saldo === ov0.saldo + 250_000, `${ov0.saldo} -> ${ov1.saldo}`);
check("e aparece como saldo inicial", ov1.saldoInicial === 250_000, `${ov1.saldoInicial}`);

const receita = await call(director, "POST", "/api/finance/transactions", {
  kind: "INCOME", description: "ZF Patrocínio Café Central", amountCents: 5_000, occurredAt: dia(), method: "TRANSFER",
});
check("uma receita concluída regista-se", receita.status === 201, `${receita.status} ${JSON.stringify(receita.body).slice(0, 120)}`);
const ov2 = await overview();
check("e soma ao saldo", ov2.saldo === ov1.saldo + 5_000, `${ov1.saldo} -> ${ov2.saldo}`);
check("e às receitas do mês", ov2.receitasMes === ov1.receitasMes + 5_000, `${ov1.receitasMes} -> ${ov2.receitasMes}`);

const despesa = await call(director, "POST", "/api/finance/transactions", {
  kind: "EXPENSE", description: "ZF Arbitragem", amountCents: 2_000, occurredAt: dia(),
});
const ov3 = await overview();
check("uma despesa concluída desconta do saldo", ov3.saldo === ov2.saldo - 2_000, `${ov2.saldo} -> ${ov3.saldo}`);

const autocarro = await call(director, "POST", "/api/finance/transactions", {
  kind: "EXPENSE", status: "PLANNED", description: "ZF Autocarro para Braga", amountCents: 3_000, occurredAt: dia(10),
});
const ov4 = await overview();
check("uma despesa prevista NÃO mexe no saldo", ov4.saldo === ov3.saldo, `${ov3.saldo} -> ${ov4.saldo}`);
check("mas entra nas despesas previstas", ov4.despesasPrevistas === ov3.despesasPrevistas + 3_000, `${ov3.despesasPrevistas} -> ${ov4.despesasPrevistas}`);
check(
  "o saldo projetado é saldo + previsto − previsto",
  ov4.saldoProjetado === ov4.saldo + ov4.receitasPrevistas - ov4.despesasPrevistas,
  `${ov4.saldoProjetado}`,
);

console.log("\n=== O horizonte da previsão ===");
await call(director, "POST", "/api/finance/transactions", {
  kind: "EXPENSE", status: "PLANNED", description: "ZF Estágio de Páscoa", amountCents: 7_000, occurredAt: dia(60),
});
const ovCurto = await overview(30);
const ovLongo = await overview(90);
check("a 30 dias, o estágio a 60 dias não conta", ovCurto.despesasPrevistas === ov4.despesasPrevistas, `${ovCurto.despesasPrevistas}`);
check("a 90 dias, já conta", ovLongo.despesasPrevistas === ov4.despesasPrevistas + 7_000, `${ovLongo.despesasPrevistas}`);

/* ================================================= confirmar previsto ==== */

console.log("\n=== Confirmar: o previsto vira realizado ===");
const confirmado = await call(director, "PATCH", `/api/finance/transactions/${autocarro.body.id}`, { status: "COMPLETED" });
check("o autocarro confirma-se", confirmado.status === 200, `${confirmado.status}`);
const ov6 = await overview();
check("o saldo desce o valor confirmado", ov6.saldo === ov4.saldo - 3_000, `${ov4.saldo} -> ${ov6.saldo}`);
check("e as previsões largam-no", ov6.despesasPrevistas === ov4.despesasPrevistas - 3_000, `${ov6.despesasPrevistas}`);

/* ============================================= cancelar, nunca apagar ==== */

console.log("\n=== Cancelar risca, não apaga ===");
await call(director, "PATCH", `/api/finance/transactions/${despesa.body.id}`, { status: "CANCELLED" });
const ov7 = await overview();
check("um cancelado sai do saldo", ov7.saldo === ov6.saldo + 2_000, `${ov6.saldo} -> ${ov7.saldo}`);

const aindaExiste = await db.query(`SELECT status FROM "FinancialTransaction" WHERE id = $1`, [despesa.body.id]);
check("mas a linha continua na base", aindaExiste.rows[0]?.status === "CANCELLED", JSON.stringify(aindaExiste.rows));

const listaComCancelado = await call(director, "GET", "/api/finance/transactions?status=CANCELLED");
check(
  "e continua a ler-se, riscada",
  listaComCancelado.body?.some?.((t) => t.id === despesa.body.id),
  JSON.stringify(listaComCancelado.body?.length),
);

const reactivar = await call(director, "PATCH", `/api/finance/transactions/${despesa.body.id}`, { status: "COMPLETED" });
check("reactivar um cancelado é recusado (400)", reactivar.status === 400, `${reactivar.status}`);

const trocarTipo = await call(director, "PATCH", `/api/finance/transactions/${autocarro.body.id}`, { kind: "INCOME" });
const tipoDepois = await db.query(`SELECT kind FROM "FinancialTransaction" WHERE id = $1`, [autocarro.body.id]);
check(
  "o tipo não se edita — despesa fica despesa",
  trocarTipo.status === 400 || tipoDepois.rows[0]?.kind === "EXPENSE",
  `${trocarTipo.status} ${tipoDepois.rows[0]?.kind}`,
);

/* ============================================ mensalidades derivadas ==== */

console.log("\n=== As mensalidades entram sozinhas — e nunca em duplicado ===");
const cobrancas = await db.query(
  `SELECT COUNT(*)::int AS n, COALESCE(SUM("amountCents"), 0)::int AS soma FROM "Charge" WHERE "academyId" = $1 AND status = 'SETTLED'`,
  [academia],
);
const { n: pagas, soma: somaPagas } = cobrancas.rows[0];
console.log(`  (${pagas} mensalidades pagas na base, ${somaPagas} cêntimos)`);

const lista = (await call(director, "GET", "/api/finance/transactions")).body;
const automaticas = lista.filter((t) => t.source === "fees");
check("as pagas aparecem na lista como automáticas", pagas === 0 || automaticas.length > 0, `${automaticas.length}`);
check(
  "todas com id derivado da cobrança (charge_…)",
  automaticas.every((t) => t.id.startsWith("charge_")),
  automaticas.map((t) => t.id).join(","),
);
check(
  "sem duplicados",
  new Set(automaticas.map((t) => t.id)).size === automaticas.length,
  `${automaticas.length} linhas`,
);

const copiadas = await db.query(
  `SELECT COUNT(*)::int AS n FROM "FinancialTransaction" WHERE "academyId" = $1 AND description LIKE 'Mensalidade %'`,
  [academia],
);
check("nenhuma cobrança foi copiada para a tabela de movimentos", copiadas.rows[0].n === 0, `${copiadas.rows[0].n}`);

await call(director, "PUT", "/api/finance/settings", { includeFees: false });
const ov8 = await overview();
check("desligar a fonte tira-as do saldo", ov8.saldo === ov7.saldo - somaPagas, `${ov7.saldo} -> ${ov8.saldo}`);
const listaSem = (await call(director, "GET", "/api/finance/transactions")).body;
check("e da lista", listaSem.every((t) => t.source !== "fees"), `${listaSem.filter((t) => t.source === "fees").length}`);

const cobrancasDepois = await db.query(
  `SELECT COUNT(*)::int AS n FROM "Charge" WHERE "academyId" = $1 AND status = 'SETTLED'`,
  [academia],
);
check("sem tocar em pagamento nenhum", cobrancasDepois.rows[0].n === pagas, `${cobrancasDepois.rows[0].n}`);

await call(director, "PUT", "/api/finance/settings", { includeFees: true });
const ov9 = await overview();
check("religar repõe o saldo exacto", ov9.saldo === ov7.saldo, `${ov9.saldo}`);

/* ======================================================== categorias ==== */

console.log("\n=== A categoria tem de ser do tipo certo ===");
const catReceita = (
  await db.query(`SELECT id FROM "CatalogItem" WHERE "academyId" = $1 AND kind = 'financeIncome' LIMIT 1`, [academia])
).rows[0];
const catTransportes = (
  await db.query(
    `SELECT id, label FROM "CatalogItem" WHERE "academyId" = $1 AND kind = 'financeExpense' AND label = 'Transportes'`,
    [academia],
  )
).rows[0];
check("os catálogos de contas estão semeados", Boolean(catReceita && catTransportes));

const categoriaTrocada = await call(director, "POST", "/api/finance/transactions", {
  kind: "EXPENSE", description: "ZF Despesa em categoria de receita", amountCents: 1_000, occurredAt: dia(), categoryId: catReceita.id,
});
check("uma despesa numa categoria de receita é recusada (400)", categoriaTrocada.status === 400, `${categoriaTrocada.status}`);

/* ========================================================= orçamento ==== */

console.log("\n=== Orçamento da época ===");
const epoca = (
  await db.query(
    `SELECT id, label, "startsOn", "endsOn" FROM "Season" WHERE "academyId" = $1 AND "isCurrent" = true`,
    [academia],
  )
).rows[0];
const meioDaEpoca = new Date((new Date(epoca.startsOn).getTime() + new Date(epoca.endsOn).getTime()) / 2)
  .toISOString()
  .slice(0, 10);

const bud0 = (await call(director, "GET", "/api/finance/budgets")).body;
check("o orçamento abre na época corrente", bud0?.season?.id === epoca.id, JSON.stringify(bud0?.season));
const linhaAntes = bud0.rows.find((r) => r.categoryId === catTransportes.id);
check("com as categorias de despesa todas", Boolean(linhaAntes), JSON.stringify(bud0.rows?.length));

await call(director, "PUT", "/api/finance/budgets", { seasonId: epoca.id, categoryId: catTransportes.id, amountCents: 50_000 });
const bud1 = (await call(director, "GET", "/api/finance/budgets")).body;
check(
  "fixar um tecto de 500€ em Transportes",
  bud1.rows.find((r) => r.categoryId === catTransportes.id)?.budgetCents === 50_000,
);

await call(director, "POST", "/api/finance/transactions", {
  kind: "EXPENSE", description: "ZF Carrinha para o torneio", amountCents: 2_500, occurredAt: meioDaEpoca, categoryId: catTransportes.id,
});
const bud2 = (await call(director, "GET", "/api/finance/budgets")).body;
check(
  "o gasto da época soma na categoria",
  bud2.rows.find((r) => r.categoryId === catTransportes.id)?.spentCents === linhaAntes.spentCents + 2_500,
  JSON.stringify(bud2.rows.find((r) => r.categoryId === catTransportes.id)),
);

await call(director, "PUT", "/api/finance/budgets", { seasonId: epoca.id, categoryId: catTransportes.id, amountCents: 0 });
const semTecto = await db.query(`SELECT COUNT(*)::int AS n FROM "FinancialBudget" WHERE "categoryId" = $1`, [catTransportes.id]);
check("um tecto a zero apaga a linha do orçamento", semTecto.rows[0].n === 0, `${semTecto.rows[0].n}`);

/* ================================================ eventos e previstas ==== */

console.log("\n=== O custo estimado de um evento ===");
const jogo = (await db.query(`SELECT id, opponent FROM "Match" WHERE "academyId" = $1 LIMIT 1`, [academia])).rows[0];

// Um evento genérico criado pelo próprio calendário — o caminho real de quem
// marca um torneio e lhe pendura o custo estimado.
await call(director, "POST", "/api/events", {
  kind: "OTHER",
  title: "ZF Torneio de apresentação",
  startsAt: new Date(Date.now() + 5 * 86_400_000).toISOString(),
  endsAt: new Date(Date.now() + 5 * 86_400_000 + 3 * 3_600_000).toISOString(),
  venue: "Pavilhão Municipal",
});
const evento = (
  await db.query(`SELECT id, title FROM "CalendarEvent" WHERE "academyId" = $1 AND title LIKE 'ZF %' LIMIT 1`, [academia])
).rows[0];

if (jogo) {
  const custoDoJogo = await call(director, "POST", "/api/finance/transactions", {
    kind: "EXPENSE", status: "PLANNED", description: "ZF Autocarro do jogo", amountCents: 4_000, occurredAt: dia(5), matchId: jogo.id,
  });
  check("um custo previsto liga-se ao jogo", custoDoJogo.status === 201, `${custoDoJogo.status}`);

  const doJogo = (await call(director, "GET", `/api/finance/transactions?matchId=${jogo.id}`)).body;
  check(
    "filtrar pelo jogo devolve só o que é dele",
    doJogo.some((t) => t.id === custoDoJogo.body.id) && doJogo.every((t) => t.match?.id === jogo.id),
    JSON.stringify(doJogo.map((t) => t.description)),
  );

  const ovComJogo = await overview();
  const naLista = ovComJogo.proximasDespesas.find((d) => d.id === custoDoJogo.body.id);
  check("e aparece nas próximas despesas do painel", Boolean(naLista), JSON.stringify(ovComJogo.proximasDespesas.map((d) => d.description)));
  check(
    "com o jogo como referência",
    naLista?.eventLabel?.includes(jogo.opponent),
    JSON.stringify(naLista?.eventLabel),
  );
} else {
  console.log("  (sem jogos na base — salto a ligação a jogos)");
}

if (evento) {
  const receitaDoEvento = await call(director, "POST", "/api/finance/transactions", {
    kind: "INCOME", status: "PLANNED", description: "ZF Bar do torneio", amountCents: 1_500, occurredAt: dia(5), calendarEventId: evento.id,
  });
  const doEvento = (await call(director, "GET", `/api/finance/transactions?calendarEventId=${evento.id}`)).body;
  check(
    "uma receita prevista liga-se a um evento do calendário",
    receitaDoEvento.status === 201 && doEvento.some((t) => t.id === receitaDoEvento.body.id),
    `${receitaDoEvento.status}`,
  );
  check("sem mensalidades misturadas no filtro do evento", doEvento.every((t) => t.source === "manual"));
} else {
  console.log("  (sem eventos genéricos na base — salto a ligação a eventos)");
}

/* ==================================================== despesas fixas ==== */

console.log("\n=== Despesas fixas mensais, de X a Y ===");
const serie = await call(director, "POST", "/api/finance/transactions", {
  kind: "EXPENSE",
  description: "ZF Renda do pavilhão",
  amountCents: 30_000,
  occurredAt: "2027-01-31",
  repeatMonthly: true,
  repeatUntil: "2027-12-31",
});
check("uma série de doze meses cria-se de uma vez", serie.status === 201 && serie.body?.created === 12, JSON.stringify(serie.body));

const linhasDaSerie = (
  await db.query(
    `SELECT "occurredAt"::text AS d, status, "amountCents" FROM "FinancialTransaction"
      WHERE "seriesId" = $1 ORDER BY "occurredAt"`,
    [serie.body?.seriesId],
  )
).rows;
check("com uma linha por mês", linhasDaSerie.length === 12, `${linhasDaSerie.length}`);
check("todas previstas — nenhum mês por vir já foi pago", linhasDaSerie.every((l) => l.status === "PLANNED"));
check("todas com o mesmo valor", linhasDaSerie.every((l) => l.amountCents === 30_000));

/*
 * O caso que estraga as repetições mensais: dia 31.
 *
 * O calendário salta os meses sem dia 31 — bem, para um treino. Uma renda não
 * desaparece em Fevereiro: encosta ao último dia do mês. Perder o mês era
 * perder uma renda inteira na previsão.
 */
const dias = linhasDaSerie.map((l) => l.d.slice(0, 10));
check("Janeiro no dia 31", dias[0] === "2027-01-31", dias[0]);
check("Fevereiro encosta ao dia 28, não salta o mês", dias[1] === "2027-02-28", dias[1]);
check("Março volta ao dia 31", dias[2] === "2027-03-31", dias[2]);
check("Abril encosta ao dia 30", dias[3] === "2027-04-30", dias[3]);
check("e Dezembro fecha a série", dias[11] === "2027-12-31", dias[11]);

const semFim = await call(director, "POST", "/api/finance/transactions", {
  kind: "EXPENSE", description: "ZF Sem fim", amountCents: 1_000, occurredAt: dia(), repeatMonthly: true,
});
check("uma série sem fim é recusada (400)", semFim.status === 400, `${semFim.status}`);

const aoContrario = await call(director, "POST", "/api/finance/transactions", {
  kind: "EXPENSE", description: "ZF Ao contrário", amountCents: 1_000, occurredAt: "2027-06-01", repeatMonthly: true, repeatUntil: "2027-01-01",
});
check("um fim antes do início é recusado (400)", aoContrario.status === 400, `${aoContrario.status}`);

console.log("\n=== Corrigir e cancelar uma série ===");
const idsDaSerie = (
  await db.query(`SELECT id, "occurredAt"::text AS d FROM "FinancialTransaction" WHERE "seriesId" = $1 ORDER BY "occurredAt"`, [
    serie.body.seriesId,
  ])
).rows;

// Março pago; a renda sobe a partir de Abril.
await call(director, "PATCH", `/api/finance/transactions/${idsDaSerie[2].id}`, { status: "COMPLETED" });
const subiu = await call(director, "PATCH", `/api/finance/transactions/${idsDaSerie[3].id}`, {
  scope: "series", amountCents: 35_000,
});
check("a renda sobe de Abril em diante", subiu.status === 200, `${subiu.status}`);

const depoisDaSubida = (
  await db.query(
    `SELECT "occurredAt"::text AS d, "amountCents", status FROM "FinancialTransaction" WHERE "seriesId" = $1 ORDER BY "occurredAt"`,
    [serie.body.seriesId],
  )
).rows;
check("Janeiro e Fevereiro ficam ao valor antigo", depoisDaSubida.slice(0, 2).every((l) => l.amountCents === 30_000));
check(
  "Março, que já foi pago, não é reescrito",
  depoisDaSubida[2].amountCents === 30_000 && depoisDaSubida[2].status === "COMPLETED",
  JSON.stringify(depoisDaSubida[2]),
);
check("de Abril a Dezembro ficam ao valor novo", depoisDaSubida.slice(3).every((l) => l.amountCents === 35_000));

// O contrato acaba em Setembro: cancelar de Outubro em diante.
await call(director, "PATCH", `/api/finance/transactions/${idsDaSerie[9].id}`, { scope: "series", status: "CANCELLED" });
const depoisDoCancelamento = (
  await db.query(
    `SELECT "occurredAt"::text AS d, status FROM "FinancialTransaction" WHERE "seriesId" = $1 ORDER BY "occurredAt"`,
    [serie.body.seriesId],
  )
).rows;
check(
  "Outubro, Novembro e Dezembro ficam cancelados",
  depoisDoCancelamento.slice(9).every((l) => l.status === "CANCELLED"),
  JSON.stringify(depoisDoCancelamento.slice(9).map((l) => l.status)),
);
check(
  "e os meses anteriores continuam de pé",
  depoisDoCancelamento.slice(0, 9).every((l) => l.status !== "CANCELLED"),
);
check(
  "nenhuma linha desapareceu — doze continuam doze",
  depoisDoCancelamento.length === 12,
  `${depoisDoCancelamento.length}`,
);

const listaComSerie = (await call(director, "GET", "/api/finance/transactions?tipo=&estado=PLANNED")).body;
check(
  "a lista identifica as linhas de série",
  listaComSerie.some((t) => t.seriesId === serie.body.seriesId),
  "nenhuma linha traz seriesId",
);

/* ============================================ corrigir e apagar ============ */

/*
 * Um clube pôs a categoria errada num movimento e perguntou como a mudava. Não
 * mudava: a API já aceitava a correcção, mas não havia por onde a pedir, e a
 * única saída era cancelar a linha e registá-la de novo — o extracto ficava com
 * o engano riscado ao lado do certo.
 *
 * Estes testes cobrem os dois lados que faltavam: corrigir uma linha (incluindo
 * a categoria, que foi o pedido) e apagar o que nunca devia ter sido lançado.
 */
console.log("\n=== Corrigir um movimento ===");

/* A categoria de destino: outra qualquer de despesa, que não a de partida. */
const catOutra = (
  await db.query(
    `SELECT id, label FROM "CatalogItem"
      WHERE "academyId" = $1 AND kind = 'financeExpense' AND id <> $2 AND "archivedAt" IS NULL
      LIMIT 1`,
    [academia, catTransportes.id],
  )
).rows[0];
check("há uma segunda categoria de despesa para onde mudar", Boolean(catOutra));

const diaDeHoje = new Date().toISOString().slice(0, 10);

const paraCorrigir = await call(director, "POST", "/api/finance/transactions", {
  kind: "EXPENSE",
  status: "COMPLETED",
  description: "ZF Estojo de primeiros socorros",
  amountCents: 4500,
  occurredAt: diaDeHoje,
  categoryId: catTransportes.id,
});
check("movimento criado para corrigir", paraCorrigir.status === 201 || paraCorrigir.status === 200, `${paraCorrigir.status}`);
const corrigirId = paraCorrigir.body?.id ?? paraCorrigir.body?.ids?.[0];

const corrigido = await call(director, "PATCH", `/api/finance/transactions/${corrigirId}`, {
  description: "ZF Estojo de primeiros socorros (corrigido)",
  amountCents: 5200,
  categoryId: catOutra ? catOutra.id : "",
});
check("a correcção é aceite", corrigido.status === 200, `${corrigido.status} ${JSON.stringify(corrigido.body).slice(0, 120)}`);

const depoisDaCorreccao = (
  await db.query(`SELECT description, "amountCents", "categoryId" FROM "FinancialTransaction" WHERE id = $1`, [corrigirId])
).rows[0];
check("a descrição mudou", depoisDaCorreccao?.description.endsWith("(corrigido)"), depoisDaCorreccao?.description);
check("o valor mudou", depoisDaCorreccao?.amountCents === 5200, `${depoisDaCorreccao?.amountCents}`);
check(
  "e a categoria mudou — o pedido que deu origem a isto",
  depoisDaCorreccao?.categoryId !== catTransportes.id,
  `continua ${depoisDaCorreccao?.categoryId}`,
);

/* Tirar a categoria por completo: vazio limpa, que é a regra da casa. */
const semCategoria = await call(director, "PATCH", `/api/finance/transactions/${corrigirId}`, { categoryId: "" });
check("tirar a categoria é aceite", semCategoria.status === 200, `${semCategoria.status}`);
const limpa = (await db.query(`SELECT "categoryId" FROM "FinancialTransaction" WHERE id = $1`, [corrigirId])).rows[0];
check("e a linha fica sem categoria", limpa?.categoryId === null, `${limpa?.categoryId}`);

console.log("\n=== Apagar ===");

const semPermissao = await call(coach, "DELETE", `/api/finance/transactions/${corrigirId}`, {});
check("um treinador não apaga movimentos (403)", semPermissao.status === 403, `${semPermissao.status}`);

const apagado = await call(director, "DELETE", `/api/finance/transactions/${corrigirId}`, {});
check("a direção apaga", apagado.status === 200, `${apagado.status} ${JSON.stringify(apagado.body).slice(0, 120)}`);
check("e diz quantas linhas foram", apagado.body?.deleted === 1, JSON.stringify(apagado.body));
const sumiu = (await db.query(`SELECT COUNT(*)::int AS n FROM "FinancialTransaction" WHERE id = $1`, [corrigirId])).rows[0];
check("a linha desapareceu mesmo da base", sumiu.n === 0, `${sumiu.n}`);

const outraVez = await call(director, "DELETE", `/api/finance/transactions/${corrigirId}`, {});
check("apagar o que já não existe dá 404", outraVez.status === 404, `${outraVez.status}`);

/*
 * A série inteira.
 *
 * Quem cria trinta e seis meses por engano não vai apagar trinta e seis linhas
 * à mão. Apaga este mês e os seguintes — e os anteriores ficam, porque não são
 * deste engano.
 */
const serieParaApagar = await call(director, "POST", "/api/finance/transactions", {
  kind: "EXPENSE",
  description: "ZF Serie a apagar",
  amountCents: 1000,
  occurredAt: `${new Date().getFullYear()}-01-10`,
  repeatMonthly: true,
  repeatUntil: `${new Date().getFullYear()}-12-10`,
});
const linhasApagar = (
  await db.query(
    `SELECT id, "occurredAt" AS d FROM "FinancialTransaction" WHERE description LIKE 'ZF Serie a apagar%' ORDER BY "occurredAt"`,
  )
).rows;
check("a série de teste nasceu com doze meses", linhasApagar.length === 12, `${linhasApagar.length}`);

const apagouSerie = await call(director, "DELETE", `/api/finance/transactions/${linhasApagar[9].id}`, { scope: "series" });
check("apagar em série é aceite", apagouSerie.status === 200, `${apagouSerie.status}`);
check("apagou os três últimos meses", apagouSerie.body?.deleted === 3, JSON.stringify(apagouSerie.body));

const sobraram = (
  await db.query(`SELECT COUNT(*)::int AS n FROM "FinancialTransaction" WHERE description LIKE 'ZF Serie a apagar%'`)
).rows[0];
check("e os nove primeiros meses ficaram de pé", sobraram.n === 9, `${sobraram.n}`);

/* Só este mês, agora — a outra metade da pergunta. */
const soUm = await call(director, "DELETE", `/api/finance/transactions/${linhasApagar[0].id}`, { scope: "one" });
check("apagar só um mês de uma série é aceite", soUm.status === 200, `${soUm.status}`);
check("e leva uma linha, não a série", soUm.body?.deleted === 1, JSON.stringify(soUm.body));
const sobraram2 = (
  await db.query(`SELECT COUNT(*)::int AS n FROM "FinancialTransaction" WHERE description LIKE 'ZF Serie a apagar%'`)
).rows[0];
check("ficam oito", sobraram2.n === 8, `${sobraram2.n}`);

/* ================================================ saldo inicial datado ==== */

/*
 * O painel deriva as mensalidades das linhas dos últimos seis meses quando o
 * saldo inicial é recente, e só pergunta o total à base quando é mais antigo.
 * São dois caminhos, e ambos têm de dar a mesma conta — a de somar tudo o que
 * conta desde a data do saldo inicial.
 */
console.log("\n=== O saldo conta a partir da data do saldo inicial ===");
const saldoEsperado = async (desde) => {
  const t = await db.query(
    `SELECT COALESCE(SUM(CASE WHEN kind = 'INCOME' THEN "amountCents" ELSE -"amountCents" END), 0)::int AS v
       FROM "FinancialTransaction"
      WHERE "academyId" = $1 AND status = 'COMPLETED' AND "occurredAt" >= $2`,
    [academia, desde],
  );
  const c = await db.query(
    `SELECT COALESCE(SUM("amountCents"), 0)::int AS v
       FROM "Charge" WHERE "academyId" = $1 AND status = 'SETTLED' AND "settledAt" >= $2`,
    [academia, desde],
  );
  return t.rows[0].v + c.rows[0].v;
};

for (const [quando, dias] of [
  ["dentro dos últimos 6 meses (derivado das linhas)", 30],
  ["antes dos últimos 6 meses (perguntado à base)", 400],
]) {
  const data = dia(-dias);
  await call(director, "PUT", "/api/finance/settings", { initialBalanceCents: 100_000, initialBalanceAt: data });
  const ov = await overview();
  const esperado = 100_000 + (await saldoEsperado(data));
  check(`saldo inicial ${quando}`, ov.saldo === esperado, `esperado ${esperado}, veio ${ov.saldo}`);
}

/* ====================================================== multi-tenant ==== */

console.log("\n=== As contas são de um clube só ===");
const outra = (await db.query(`SELECT slug FROM "Academy" WHERE id <> $1 LIMIT 1`, [academia])).rows[0];
if (outra) {
  const deFora = await call(director, "GET", "/api/finance/overview", undefined, outra.slug);
  check(`o painel do Life Club não abre em ${outra.slug} (403/404)`, deFora.status === 403 || deFora.status === 404, `${deFora.status}`);

  const mexerDeFora = await call(director, "PATCH", `/api/finance/transactions/${autocarro.body.id}`, { amountCents: 1 }, outra.slug);
  check("nem se mexe num movimento de fora (403/404)", mexerDeFora.status === 403 || mexerDeFora.status === 404, `${mexerDeFora.status}`);
} else {
  console.log("  (só existe uma academia nesta base — salto)");
}

/* =========================================================== limpeza ==== */

await limpar();
await call(director, "PUT", "/api/finance/settings", { initialBalanceCents: 0, initialBalanceAt: "", includeFees: true });
const ovFinal = await overview();
check("\nlimpo, o saldo volta ao ponto de partida", ovFinal.saldo === ov0.saldo, `${ov0.saldo} -> ${ovFinal.saldo}`);

await db.end();
console.log(`\n${ok} OK, ${bad} FALHA${bad === 1 ? "" : "S"}`);
process.exit(bad ? 1 : 0);

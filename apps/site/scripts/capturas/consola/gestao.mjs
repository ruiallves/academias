/**
 * Inventário e contas do CD Academias, à data de 12 de outubro de 2026.
 *
 * Tudo inventado. As mensalidades cobradas em outubro (1540 €) e em setembro
 * (1545 €) são as que saem de `clube.mjs`; o resto das receitas e as despesas
 * são as de um clube de formação com quatro equipas.
 */
import { em } from "./clube.mjs";

const semAcentos = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
const chave = (s) => semAcentos(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/* -------------------------------------------------------------------------- */
/* Inventário                                                                  */
/* -------------------------------------------------------------------------- */

const CAT = {
  jogo: { id: "cat-inventoryCategories-1", label: "Equipamento de jogo" },
  treino: { id: "cat-inventoryCategories-2", label: "Material de treino" },
  medico: { id: "cat-inventoryCategories-3", label: "Material médico" },
};

/** [nome, categoria, marca, mínimo por variante, [variante, total, entregues, danificadas]...]. */
const ARTIGOS = [
  ["Camisola de jogo principal", "jogo", "Macron", 4, ["8 anos", 14, 9, 0], ["10 anos", 22, 16, 0], ["12 anos", 24, 21, 1], ["14 anos", 20, 12, 0], ["S", 18, 11, 0], ["M", 16, 8, 0]],
  ["Camisola de jogo alternativa", "jogo", "Macron", 4, ["10 anos", 18, 14, 0], ["12 anos", 20, 16, 0], ["14 anos", 18, 10, 0], ["S", 14, 8, 0]],
  ["Calção de jogo", "jogo", "Macron", 4, ["10 anos", 22, 16, 0], ["12 anos", 24, 18, 0], ["14 anos", 20, 12, 0], ["S", 18, 11, 0]],
  ["Meias de jogo", "jogo", "Macron", 6, ["31-34", 30, 16, 0], ["35-38", 36, 30, 0], ["39-42", 30, 19, 0]],
  ["Fato de treino", "jogo", "Macron", 3, ["10 anos", 16, 14, 0], ["12 anos", 18, 16, 0], ["14 anos", 18, 12, 0], ["S", 14, 9, 0], ["M", 12, 6, 0]],
  ["Camisola de guarda-redes", "jogo", "Macron", 2, ["12 anos", 4, 3, 0], ["14 anos", 4, 2, 0], ["M", 4, 2, 0]],
  ["Colete de treino", "treino", null, 10, ["Amarelo", 24, 0, 0], ["Laranja", 24, 0, 2], ["Azul", 18, 0, 11]],
  ["Bola de futebol tamanho 4", "treino", "Select", 12, ["Tamanho 4", 30, 0, 4]],
  ["Bola de futebol tamanho 5", "treino", "Select", 12, ["Tamanho 5", 14, 0, 5]],
  ["Cone de marcação", "treino", null, 40, ["Conjunto de 50", 120, 0, 0]],
  ["Mini-baliza desmontável", "treino", null, 2, ["1,2 × 0,8 m", 6, 0, 1]],
  ["Saco de gelo instantâneo", "medico", null, 20, ["Unidade", 12, 0, 0]],
];

function estado(disponiveis, minimo) {
  return disponiveis <= 0 ? "out" : disponiveis < minimo ? "low" : "ok";
}

function inventario() {
  const itens = ARTIGOS.map(([nome, cat, marca, minimo, ...variantes], i) => {
    const sku = `CDA-${String(i + 1).padStart(3, "0")}`;
    const vs = variantes.map(([label, total, entregues, danificadas], k) => {
      const disponiveis = total - entregues - danificadas;
      return {
        id: `var-${chave(nome)}-${k + 1}`, label, sku: `${sku}-${k + 1}`, order: k,
        minimumStock: minimo, ownMinimum: null, total, assigned: entregues, available: disponiveis,
        damaged: danificadas, lost: 0, status: estado(disponiveis, minimo),
      };
    });
    const total = vs.reduce((n, v) => n + v.total, 0);
    const entregues = vs.reduce((n, v) => n + v.assigned, 0);
    const disponiveis = vs.reduce((n, v) => n + v.available, 0);
    return {
      id: `art-${chave(nome)}`, name: nome, sku, brand: marca, description: null, minimumStock: minimo,
      category: CAT[cat], variants: vs, thumbnail: null, total, assigned: entregues, available: disponiveis,
      // O artigo está como a sua pior variante.
      status: vs.some((v) => v.status === "out") ? "out" : vs.some((v) => v.status === "low") ? "low" : "ok",
    };
  });

  const m = (dia, hora, type, quantity, artigo, variante, atleta, por, motivo) => ({
    id: `mov-${dia}-${hora.replace(":", "")}-${chave(artigo).slice(0, 12)}`, type, quantity, reason: motivo ?? null,
    at: em(dia, hora).toISOString(), variantId: `var-${chave(artigo)}-1`, variantLabel: variante,
    itemId: `art-${chave(artigo)}`, itemName: artigo,
    athleteId: atleta ? `a-${chave(atleta)}` : null, athleteName: atleta ?? null, by: por,
  });
  const movimentos = [
    m("2026-10-10", "13:50", "ASSIGNMENT", 1, "Camisola de jogo principal", "10 anos", "Simão Alves", "Marta Silva", "Sobe aos Sub-13 no jogo de sábado"),
    m("2026-10-09", "18:20", "DAMAGE", 2, "Bola de futebol tamanho 5", "Tamanho 5", null, "Nuno Barros", "Furadas no treino dos seniores"),
    m("2026-10-08", "17:05", "ASSIGNMENT", 1, "Fato de treino", "12 anos", "Gonçalo Vaz", "Marta Silva"),
    m("2026-10-08", "17:02", "ASSIGNMENT", 1, "Fato de treino", "12 anos", "Vicente Maia", "Marta Silva"),
    m("2026-10-07", "20:25", "EXIT", 8, "Saco de gelo instantâneo", "Unidade", null, "Inês Carvalho", "Usados nos treinos da semana"),
    m("2026-10-06", "10:40", "ENTRY", 10, "Bola de futebol tamanho 4", "Tamanho 4", null, "Marta Silva", "Encomenda de início de época"),
    m("2026-10-05", "19:10", "DAMAGE", 11, "Colete de treino", "Azul", null, "Miguel Antunes", "Rasgados, para substituir"),
    m("2026-10-02", "18:45", "RETURN", 1, "Camisola de jogo principal", "12 anos", "Salvador Cruz", "Marta Silva", "Trocou de tamanho"),
    m("2026-10-02", "18:47", "ASSIGNMENT", 1, "Camisola de jogo principal", "14 anos", "Salvador Cruz", "Marta Silva"),
    m("2026-09-29", "11:15", "ENTRY", 120, "Cone de marcação", "Conjunto de 50", null, "Marta Silva"),
    m("2026-09-25", "17:30", "ASSIGNMENT", 1, "Camisola de guarda-redes", "12 anos", "Martim Rocha", "Marta Silva"),
    m("2026-09-22", "16:00", "ENTRY", 24, "Meias de jogo", "35-38", null, "Marta Silva"),
  ];

  const variantes = itens.flatMap((i) => i.variants);
  const resumo = {
    artigos: itens.length,
    unidades: variantes.reduce((n, v) => n + v.total, 0),
    atribuidas: variantes.reduce((n, v) => n + v.assigned, 0),
    disponiveis: variantes.reduce((n, v) => n + v.available, 0),
    stockBaixo: variantes.filter((v) => v.status !== "ok").length,
    danificadas: variantes.reduce((n, v) => n + v.damaged, 0),
    perdidas: 0,
  };
  return { itens, movimentos, resumo };
}

/* -------------------------------------------------------------------------- */
/* Contas                                                                      */
/* -------------------------------------------------------------------------- */

const RECEITA = { mens: ["cat-financeIncome-1", "Mensalidades"], quotas: ["cat-financeIncome-2", "Quotas de sócio"], patr: ["cat-financeIncome-3", "Patrocínios"], bar: ["cat-financeIncome-4", "Bar"] };
const DESPESA = { arb: ["cat-financeExpense-1", "Arbitragem"], transp: ["cat-financeExpense-2", "Transportes"], inst: ["cat-financeExpense-3", "Instalações"], mat: ["cat-financeExpense-4", "Material"] };

/** [dia, tipo, categoria, descrição, euros, estado, método, contraparte, origem]. */
const MOVIMENTOS = [
  ["2026-10-24", "EXPENSE", "arb", "Arbitragem: Sub-13 vs Atlético do Castelo", 60, "PLANNED", null, "Associação de Futebol"],
  ["2026-10-20", "INCOME", "patr", "Patrocínio da época, 2.ª prestação", 750, "PLANNED", "TRANSFER", "Talho da Serra"],
  ["2026-10-17", "EXPENSE", "transp", "Autocarro: Sub-13 ao CF Pinhal", 180, "PLANNED", null, "Transportes Vale do Rio"],
  ["2026-10-15", "EXPENSE", "inst", "Aluguer do Campo 1, outubro (2.ª quinzena)", 150, "PENDING", "TRANSFER", "Câmara Municipal"],
  ["2026-10-14", "EXPENSE", "mat", "12 bolas tamanho 5", 216, "PENDING", "TRANSFER", "Desporto & Companhia"],
  ["2026-10-11", "INCOME", "bar", "Bar: jogos do fim de semana", 172, "COMPLETED", "CASH", null],
  ["2026-10-10", "EXPENSE", "arb", "Arbitragem: Sub-13 vs União da Serra", 60, "COMPLETED", "TRANSFER", "Associação de Futebol"],
  ["2026-10-08", "INCOME", "mens", "Mensalidades de outubro", 1540, "COMPLETED", null, null, "fees"],
  ["2026-10-08", "INCOME", "quotas", "Quotas de sócio de outubro", 178, "COMPLETED", null, null],
  ["2026-10-06", "EXPENSE", "mat", "10 bolas tamanho 4 e 30 coletes", 315, "COMPLETED", "TRANSFER", "Desporto & Companhia"],
  ["2026-10-04", "EXPENSE", "arb", "Arbitragem: Sub-15 e Seniores", 180, "COMPLETED", "TRANSFER", "Associação de Futebol"],
  ["2026-10-03", "EXPENSE", "transp", "Autocarro: Sub-13 ao Sporting da Lagoa", 140, "COMPLETED", "TRANSFER", "Transportes Vale do Rio"],
  ["2026-10-01", "EXPENSE", "inst", "Aluguer do Campo 1, outubro (1.ª quinzena)", 150, "COMPLETED", "TRANSFER", "Câmara Municipal"],
  ["2026-09-30", "INCOME", "bar", "Bar: setembro", 410, "COMPLETED", "CASH", null],
  ["2026-09-28", "EXPENSE", "inst", "Eletricidade e água, setembro", 286, "COMPLETED", "DIRECT_DEBIT", null],
  ["2026-09-27", "EXPENSE", "arb", "Arbitragem: jornada 3", 240, "COMPLETED", "TRANSFER", "Associação de Futebol"],
  ["2026-09-20", "EXPENSE", "transp", "Autocarro: Seniores ao CF Pinhal", 190, "COMPLETED", "TRANSFER", "Transportes Vale do Rio"],
  ["2026-09-15", "INCOME", "patr", "Patrocínio da época, 1.ª prestação", 750, "COMPLETED", "TRANSFER", "Talho da Serra"],
  ["2026-09-12", "EXPENSE", "mat", "Equipamentos de jogo 2026/27", 1240, "COMPLETED", "TRANSFER", "Macron Store"],
  ["2026-09-08", "INCOME", "mens", "Mensalidades de setembro", 1545, "COMPLETED", null, null, "fees"],
  ["2026-09-08", "INCOME", "quotas", "Quotas de sócio de setembro", 183, "COMPLETED", null, null],
  ["2026-09-01", "EXPENSE", "inst", "Aluguer do Campo 1, setembro", 300, "COMPLETED", "TRANSFER", "Câmara Municipal"],
];

function contas() {
  const linhas = MOVIMENTOS.map(([dia, kind, cat, description, valor, status, method, counterparty, source], i) => {
    const [id, label] = (kind === "INCOME" ? RECEITA : DESPESA)[cat];
    return {
      id: `fin-${dia}-${i}`, source: source ?? "manual", kind, status, description, amountCents: valor * 100,
      occurredAt: em(dia, "12:00").toISOString(), dueDate: null, method, counterparty, notes: null, seriesId: null,
      category: { id, label }, athlete: null, member: null, team: null, staffName: null, match: null, calendarEvent: null,
      createdBy: source === "fees" ? null : "Marta Silva",
    };
  });
  const soma = (mes, kind, estados = ["COMPLETED"]) =>
    linhas.filter((l) => l.kind === kind && estados.includes(l.status) && l.occurredAt.startsWith(mes)).reduce((n, l) => n + l.amountCents, 0);
  const receitasMes = soma("2026-10", "INCOME");
  const despesasMes = soma("2026-10", "EXPENSE");
  const porVir = (kind) => linhas.filter((l) => l.kind === kind && l.status !== "COMPLETED");
  const previsto = (kind) => porVir(kind).reduce((n, l) => n + l.amountCents, 0);
  const proximas = (kind) =>
    porVir(kind).reverse().map((l) => ({ id: l.id, description: l.description, amountCents: l.amountCents, occurredAt: l.occurredAt, status: l.status, category: l.category.label, eventLabel: null }));

  const receitasPrevistas = previsto("INCOME");
  const despesasPrevistas = previsto("EXPENSE");
  const saldo = 612400;
  const porCategoria = Object.entries({ ...RECEITA, ...DESPESA })
    .map(([k, [, label]]) => {
      const kind = k in RECEITA ? "INCOME" : "EXPENSE";
      return { kind, label, amountCents: linhas.filter((l) => l.category.label === label && l.status === "COMPLETED" && l.occurredAt.startsWith("2026-10")).reduce((n, l) => n + l.amountCents, 0) };
    })
    .filter((c) => c.amountCents > 0)
    .sort((a, b) => b.amountCents - a.amountCents);

  return {
    linhas,
    resumo: {
      saldo, saldoInicial: 380000, receitasMes, despesasMes, resultadoMes: receitasMes - despesasMes, mensalidadesMes: 154000,
      receitasPrevistas, despesasPrevistas, saldoProjetado: saldo + receitasPrevistas - despesasPrevistas, horizonDays: 30,
      forecast: [
        { days: 30, income: receitasPrevistas, expense: despesasPrevistas },
        { days: 90, income: receitasPrevistas + 356000, expense: despesasPrevistas + 248000 },
        { days: 180, income: receitasPrevistas + 872000, expense: despesasPrevistas + 655000 },
        { days: 365, income: receitasPrevistas + 1695000, expense: despesasPrevistas + 1402000 },
      ],
      includeFees: true,
      monthly: [
        { month: "2026-05", income: 214000, expense: 158000 },
        { month: "2026-06", income: 198500, expense: 171000 },
        { month: "2026-07", income: 46000, expense: 73500 },
        { month: "2026-08", income: 112000, expense: 139000 },
        { month: "2026-09", income: soma("2026-09", "INCOME"), expense: soma("2026-09", "EXPENSE") },
        { month: "2026-10", income: receitasMes, expense: despesasMes },
      ],
      proximasDespesas: proximas("EXPENSE"), proximasReceitas: proximas("INCOME"), porCategoria,
    },
  };
}

export function criarGestao() {
  const inv = inventario();
  const fin = contas();
  return {
    GET: {
      "/api/inventory/overview": inv.resumo,
      "/api/inventory/items": (q) => inv.itens.filter((i) => (!q.get("status") || i.status === q.get("status")) && (!q.get("categoryId") || i.category.id === q.get("categoryId"))),
      "/api/inventory/movements": inv.movimentos,
      "/api/inventory/assignments": [],
      "/api/finance/overview": fin.resumo,
      "/api/finance/transactions": (q) => fin.linhas.filter((l) => (!q.get("kind") || l.kind === q.get("kind")) && (!q.get("status") || l.status === q.get("status"))),
      "/api/finance/settings": { id: "fin-def", initialBalanceCents: 380000, initialBalanceAt: "2026-08-01T00:00:00.000Z", includeFees: true, includeQuotas: true },
    },
    PADROES: [],
  };
}

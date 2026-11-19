import { signalOnSurface } from "@academia/ui/tokens";
import { academy } from "@/lib/store";
import { shortDate } from "@/lib/format";
import {
  ESTADO_DO_MES_LABEL,
  METHOD_LABEL,
  STATUS_LABEL,
  euros,
  mesCurto,
  mesLongo,
  type Folha,
  type Overview,
  type TransactionRow,
} from "@/lib/finance";

/**
 * O relatório das Contas, em Excel e em PDF.
 *
 * ## O que sai
 *
 * O mesmo que a página mostra, para o período que está escolhido em cima:
 * o saldo e o mês; a série mensal de receitas e despesas; o que entrou e saiu
 * por categoria; os movimentos do período; a folha de vencimentos; o orçamento
 * da época. Uma assembleia geral ou um contabilista recebem isto em vez de uma
 * fotografia do ecrã.
 *
 * ## Duas saídas, uma fonte
 *
 * O Excel é para quem quer continuar a fazer contas (folhas separadas, filtros,
 * datas reconhecidas). O PDF é para quem só quer ler, com as tabelas já
 * desenhadas. As duas recebem os mesmos dados, já carregados pela página — a
 * exportação não volta ao servidor.
 *
 * As bibliotecas entram a pedido (`await import`): são centenas de kilobytes e
 * quase ninguém exporta.
 */

export type DadosDoRelatorio = {
  overview: Overview;
  movimentos: TransactionRow[];
  folha: Folha | null;
  orcamento: { epoca: string; rows: { label: string; budgetCents: number; spentCents: number }[] } | null;
  /** O primeiro e o último mês da série, `AAAA-MM`. */
  periodo: { de: string; ate: string };
};

const n = (cents: number) => Math.round(cents) / 100;

/* -------------------------------------------------------------------------- */
/* Excel                                                                       */
/* -------------------------------------------------------------------------- */

export async function exportarContasExcel(d: DadosDoRelatorio): Promise<void> {
  const XLSX = await import("xlsx");
  const livro = XLSX.utils.book_new();
  const o = d.overview;

  const folha = (nome: string, linhas: (string | number)[][], larguras?: number[]) => {
    const f = XLSX.utils.aoa_to_sheet(linhas);
    f["!cols"] = (larguras ?? linhas[0].map(() => 16)).map((w) => ({ wch: w }));
    f["!freeze"] = { xSplit: 0, ySplit: 1 };
    XLSX.utils.book_append_sheet(livro, f, nome.slice(0, 31));
  };

  folha(
    "Resumo",
    [
      ["Indicador", "Valor (€)"],
      ["Saldo atual", n(o.saldo)],
      ["Saldo inicial", n(o.saldoInicial)],
      ["Receitas este mês", n(o.receitasMes)],
      ["Despesas este mês", n(o.despesasMes)],
      ["Resultado este mês", n(o.resultadoMes)],
      ["Mensalidades e cobranças este mês", n(o.mensalidadesMes)],
      ["Quotas de sócios este mês", n(o.quotasMes ?? 0)],
      ["Receitas previstas (30 dias)", n(o.forecast.find((f) => f.days === 30)?.income ?? 0)],
      ["Despesas previstas (30 dias)", n(o.forecast.find((f) => f.days === 30)?.expense ?? 0)],
      ["Saldo projetado (30 dias)", n(o.saldo + (o.forecast.find((f) => f.days === 30)?.income ?? 0) - (o.forecast.find((f) => f.days === 30)?.expense ?? 0))],
      ...(o.vencimentos
        ? [
            ["Folha de vencimentos mensal", n(o.vencimentos.folhaMensal)],
            ["Vencimentos pagos este mês", n(o.vencimentos.pagoEsteMes.amountCents)],
            ["Vencimentos por pagar este mês", n(o.vencimentos.porPagarEsteMes.amountCents)],
            ["Vencimentos em atraso", n(o.vencimentos.emAtraso.amountCents)],
          ]
        : []),
      ["Período do relatório", `${mesLongo(d.periodo.de)} a ${mesLongo(d.periodo.ate)}`],
      ["Gerado em", new Date().toLocaleString("pt-PT")],
    ],
    [36, 18],
  );

  const saldos = saldoPorMes(o);
  folha(
    "Por mês",
    [
      ["Mês", "Receitas (€)", "Despesas (€)", "Resultado (€)", "Saldo no fim do mês (€)"],
      ...o.monthly.map((m, i) => [mesLongo(m.month), n(m.income), n(m.expense), n(m.income - m.expense), n(saldos[i])]),
    ],
    [22, 16, 16, 16, 24],
  );

  folha(
    "Por categoria",
    [
      ["Tipo", "Categoria", "Valor (€)", "Parte (%)"],
      ...(["INCOME", "EXPENSE"] as const).flatMap((kind) => {
        const linhas = o.porCategoria.filter((c) => c.kind === kind);
        const total = linhas.reduce((s, c) => s + c.amountCents, 0);
        return linhas.map((c) => [kind === "INCOME" ? "Receita" : "Despesa", c.label, n(c.amountCents), total ? Math.round((c.amountCents / total) * 1000) / 10 : 0]);
      }),
    ],
    [10, 32, 14, 10],
  );

  folha(
    "Movimentos",
    [
      ["Data", "Tipo", "Descrição", "Categoria", "Valor (€)", "Estado", "Método", "Origem/destino", "Equipa", "Evento", "Mês do vencimento", "Registado por"],
      ...d.movimentos.map((t) => [
        t.occurredAt.slice(0, 10),
        t.kind === "INCOME" ? "Receita" : "Despesa",
        t.description,
        t.category?.label ?? "",
        n((t.kind === "INCOME" ? 1 : -1) * t.amountCents),
        STATUS_LABEL[t.status],
        t.method ? (METHOD_LABEL[t.method] ?? t.method) : "",
        t.counterparty ?? "",
        t.team?.name ?? t.match?.teamName ?? "",
        t.match?.label ?? t.calendarEvent?.title ?? "",
        t.salaryPeriod ? mesLongo(t.salaryPeriod) : "",
        t.createdBy ?? (t.source === "fees" ? "Automático (cobranças)" : t.source === "quotas" ? "Automático (quotas)" : ""),
      ]),
    ],
    [12, 9, 40, 22, 12, 11, 14, 24, 18, 24, 18, 22],
  );

  if (d.folha && d.folha.pessoas.length > 0) {
    const meses = d.folha.pessoas[0]?.meses.map((m) => m.period) ?? [];
    folha(
      "Vencimentos",
      [
        ["Pessoa", "Tipo", "Cargo ou equipa", "Vencimento mensal (€)", "Desde", "Dia de pagamento", "Em atraso (meses)", "Em atraso (€)", ...meses.map((m) => mesCurto(m, true))],
        ...d.folha.pessoas.map((p) => [
          p.nome,
          p.tipo === "staff" ? "Staff" : "Atleta",
          p.detalhe ?? "",
          p.atual ? n(p.atual.amountCents) : "",
          p.atual ? p.atual.startsOn : "",
          p.atual ? (p.atual.payDay ? String(p.atual.payDay) : "Último dia") : "",
          p.emAtraso.length,
          n(p.emAtraso.reduce((s, m) => s + m.amountCents, 0)),
          ...meses.map((mes) => {
            const m = p.meses.find((x) => x.period === mes);
            return m ? (m.pagamento ? `Pago ${n(m.pagamento.amountCents)}` : ESTADO_DO_MES_LABEL[m.estado]) : "";
          }),
        ]),
      ],
      [28, 8, 22, 18, 12, 14, 14, 14, ...meses.map(() => 12)],
    );
  }

  if (d.orcamento && d.orcamento.rows.length > 0) {
    folha(
      `Orçamento ${d.orcamento.epoca.replace("/", "-")}`,
      [
        ["Categoria", "Orçado (€)", "Gasto (€)", "Diferença (€)"],
        ...d.orcamento.rows.map((r) => [r.label, n(r.budgetCents), n(r.spentCents), n(r.budgetCents - r.spentCents)]),
      ],
      [30, 14, 14, 14],
    );
  }

  XLSX.writeFile(livro, `contas-${slug(academy.shortName || academy.name)}-${hoje()}.xlsx`);
}

/* -------------------------------------------------------------------------- */
/* PDF                                                                         */
/* -------------------------------------------------------------------------- */

const PAG = { w: 210, h: 297, m: 14 };

export async function exportarContasPdf(d: DadosDoRelatorio): Promise<void> {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const o = d.overview;
  const cor = rgb(signalOnSurface(academy.signalColor || "#0f6b62"));

  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait", compress: true });
  doc.setProperties({ title: `Contas · ${academy.name}`, author: academy.name });
  doc.setFont("helvetica", "normal");

  const cabecalho = () => {
    doc.setFontSize(8.5);
    doc.setTextColor(120);
    doc.text(academy.shortName || academy.name, PAG.m, PAG.m - 4);
    doc.text("Contas do clube", PAG.w - PAG.m, PAG.m - 4, { align: "right" });
    doc.setDrawColor(...cor);
    doc.setLineWidth(0.6);
    doc.line(PAG.m, PAG.m - 2, PAG.w - PAG.m, PAG.m - 2);
    doc.setTextColor(0);
  };
  cabecalho();

  let y = PAG.m + 8;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text("Contas", PAG.m, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.setTextColor(110);
  y += 6;
  doc.text(`${mesLongo(d.periodo.de)} a ${mesLongo(d.periodo.ate)} · gerado a ${new Date().toLocaleDateString("pt-PT")}`, PAG.m, y);
  doc.setTextColor(0);

  /* O saldo e o mês, em quatro números grandes. */
  y += 10;
  const colunas = [
    ["Saldo atual", euros(o.saldo)],
    ["Receitas este mês", euros(o.receitasMes)],
    ["Despesas este mês", euros(o.despesasMes)],
    ["Resultado este mês", eurosSinal(o.resultadoMes)],
  ];
  const larg = (PAG.w - PAG.m * 2) / colunas.length;
  colunas.forEach(([rotulo, valor], i) => {
    const x = PAG.m + i * larg;
    doc.setFontSize(8);
    doc.setTextColor(120);
    doc.text(rotulo, x, y);
    doc.setFontSize(13);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(0);
    doc.text(valor, x, y + 6);
    doc.setFont("helvetica", "normal");
  });
  y += 14;

  const tabela = (titulo: string, head: string[], body: (string | number)[][], alinharDireita: number[] = []) => {
    const posicao = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY;
    let inicio = posicao && posicao > y ? posicao + 9 : y;
    if (inicio > PAG.h - 40) {
      doc.addPage();
      cabecalho();
      inicio = PAG.m + 8;
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(...cor);
    doc.text(titulo.toUpperCase(), PAG.m, inicio);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(0);
    autoTable(doc, {
      startY: inicio + 2.5,
      margin: { top: PAG.m + 6, right: PAG.m, bottom: 14, left: PAG.m },
      head: [head],
      body,
      theme: "plain",
      showHead: "everyPage",
      styles: { font: "helvetica", fontSize: 8.5, cellPadding: { top: 1.8, bottom: 1.8, left: 1.5, right: 1.5 }, textColor: [26, 25, 23], lineColor: [229, 226, 220], lineWidth: 0 },
      headStyles: { fontStyle: "bold", textColor: [82, 79, 72], fillColor: [246, 245, 242] },
      bodyStyles: { lineWidth: { bottom: 0.2 } },
      columnStyles: Object.fromEntries(alinharDireita.map((i) => [i, { halign: "right" as const }])),
      didDrawPage: () => cabecalho(),
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 9;
  };

  const saldos = saldoPorMes(o);
  tabela(
    "Receitas e despesas por mês",
    ["Mês", "Receitas", "Despesas", "Resultado", "Saldo no fim do mês"],
    o.monthly.map((m, i) => [mesLongo(m.month), euros(m.income), euros(m.expense), eurosSinal(m.income - m.expense), euros(saldos[i])]),
    [1, 2, 3, 4],
  );

  for (const kind of ["EXPENSE", "INCOME"] as const) {
    const linhas = o.porCategoria.filter((c) => c.kind === kind);
    if (linhas.length === 0) continue;
    const total = linhas.reduce((s, c) => s + c.amountCents, 0);
    tabela(
      kind === "INCOME" ? "Receitas por categoria" : "Despesas por categoria",
      ["Categoria", "Valor", "Parte"],
      linhas.map((c) => [c.label, euros(c.amountCents), total ? `${Math.round((c.amountCents / total) * 100)}%` : "—"]),
      [1, 2],
    );
  }

  if (d.folha && d.folha.pessoas.length > 0) {
    tabela(
      "Vencimentos",
      ["Pessoa", "Cargo ou equipa", "Por mês", "Este mês", "Em atraso"],
      d.folha.pessoas.map((p) => [
        p.nome,
        p.detalhe ?? (p.tipo === "staff" ? "Staff" : "Atleta"),
        p.atual ? euros(p.atual.amountCents) : "—",
        p.esteMes ? ESTADO_DO_MES_LABEL[p.esteMes.estado] : "—",
        p.emAtraso.length ? `${p.emAtraso.length} ${p.emAtraso.length === 1 ? "mês" : "meses"} · ${euros(p.emAtraso.reduce((s, m) => s + m.amountCents, 0))}` : "—",
      ]),
      [2],
    );
  }

  if (d.orcamento && d.orcamento.rows.length > 0) {
    tabela(
      `Orçamento da época ${d.orcamento.epoca}`,
      ["Categoria", "Orçado", "Gasto", "Diferença"],
      d.orcamento.rows.map((r) => [r.label, r.budgetCents ? euros(r.budgetCents) : "—", euros(r.spentCents), r.budgetCents ? eurosSinal(r.budgetCents - r.spentCents) : "—"]),
      [1, 2, 3],
    );
  }

  tabela(
    `Movimentos (${d.movimentos.length})`,
    ["Data", "Descrição", "Categoria", "Estado", "Valor"],
    d.movimentos.map((t) => [
      shortDate(new Date(t.occurredAt)),
      t.description,
      t.category?.label ?? "",
      STATUS_LABEL[t.status],
      `${t.kind === "INCOME" ? "+" : "−"}${euros(t.amountCents)}`,
    ]),
    [4],
  );

  /* O rodapé em todas as páginas: número e aviso. */
  const paginas = doc.getNumberOfPages();
  for (let p = 1; p <= paginas; p++) {
    doc.setPage(p);
    doc.setFontSize(7.5);
    doc.setTextColor(140);
    doc.text("Documento interno do clube. Contém dados pessoais (vencimentos).", PAG.m, PAG.h - 7);
    doc.text(`${p} / ${paginas}`, PAG.w - PAG.m, PAG.h - 7, { align: "right" });
  }

  doc.save(`contas-${slug(academy.shortName || academy.name)}-${hoje()}.pdf`);
}

/* -------------------------------------------------------------------------- */
/* Contas partilhadas                                                          */
/* -------------------------------------------------------------------------- */

/**
 * O saldo no fim de cada mês da série, andando para trás a partir do saldo de
 * hoje: o do mês anterior é o de hoje menos o resultado do mês corrente, e
 * assim por diante. É a mesma linha que o gráfico do saldo desenha.
 */
export function saldoPorMes(o: Overview): number[] {
  const out = new Array<number>(o.monthly.length);
  let acumulado = o.saldo;
  for (let i = o.monthly.length - 1; i >= 0; i--) {
    out[i] = acumulado;
    acumulado -= o.monthly[i].income - o.monthly[i].expense;
  }
  return out;
}

function eurosSinal(cents: number): string {
  return `${cents >= 0 ? "+" : "−"}${euros(Math.abs(cents))}`;
}

function rgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const v = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

function slug(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "clube";
}

function hoje(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

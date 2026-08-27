import { academy } from "@/lib/store";
import { periodLabel } from "@/lib/format";
import type { Fee, FeeStatus } from "@/data/types";

/**
 * Exportar mensalidades para Excel.
 *
 * ## Porquê no browser e não no servidor
 *
 * A consola já tem todas as mensalidades da academia em memória — vieram no
 * arranque, e é delas que a página vive. Um endpoint de exportação seria uma
 * segunda cópia da mesma pergunta, com o mesmo âmbito para reimplementar e para
 * divergir. O que o utilizador vê no ecrã é exactamente o que sai no ficheiro,
 * porque é a mesma lista.
 *
 * O `xlsx` entra por `import()` dinâmico: são umas centenas de kilobytes que só
 * fazem falta a quem carrega em Exportar, e não a quem abre a consola.
 *
 * ## O que sai
 *
 * Duas folhas. **Mensalidades** é a lista, uma linha por mensalidade, com o
 * valor em número e o vencimento em data — não em texto: um ficheiro que não se
 * consegue somar nem ordenar por data é uma fotografia, não uma exportação.
 * **Resumo** responde ao que se pergunta a seguir: quanto foi facturado, quanto
 * está cobrado, e como se reparte por equipa.
 *
 * O nome do ficheiro diz o clube e o intervalo — `ad-fafe_mensalidades_2026-01_a_2026-08.xlsx`.
 * A data em que foi gerado vai **dentro**, no Resumo: dois intervalos de tempo
 * no mesmo nome de ficheiro só se confundem um com o outro.
 */

const ESTADO: Record<FeeStatus, string> = {
  paid: "Pago",
  processing: "A confirmar",
  pending: "Pendente",
  overdue: "Vencido",
  void: "Anulada",
};

/** Uma mensalidade com o que o ficheiro precisa de dizer sobre ela. */
export type FeeExportRow = {
  fee: Fee;
  athlete: string;
  team: string;
  guardians: string;
  contact: string;
};

const EUROS = '#,##0.00 "€"';
const DATA = "dd/mm/yyyy";

export type ExportRange = {
  /** `AAAA-MM`, inclusive. */
  from: string;
  to: string;
  /** O rótulo do filtro de estado, para o Resumo dizer o que ficou de fora. */
  statusLabel: string;
};

export async function exportFees(rows: FeeExportRow[], range: ExportRange): Promise<void> {
  const XLSX = await import("xlsx");

  const cabecalho = ["Período", "Atleta", "Equipa", "Encarregado", "Contacto", "Estado", "Valor", "Vencimento"];
  const linhas = rows.map((r) => [
    r.fee.period,
    r.athlete,
    r.team,
    r.guardians,
    r.contact,
    ESTADO[r.fee.status],
    r.fee.amountCents / 100,
    serieDeData(r.fee.dueDate),
  ]);

  const folha = XLSX.utils.aoa_to_sheet([cabecalho, ...linhas]);
  folha["!cols"] = [
    { wch: 10 }, { wch: 26 }, { wch: 18 }, { wch: 26 }, { wch: 20 }, { wch: 13 }, { wch: 12 }, { wch: 13 },
  ];
  /*
   * O filtro do Excel, já ligado: quem abre isto vai ordenar e filtrar, e
   * fazê-lo à mão em cada ficheiro é trabalho que o ficheiro podia poupar.
   *
   * Congelar o cabeçalho ficava bem aqui ao lado, mas o escritor do `xlsx` que
   * usamos não escreve painéis — punha-se a linha e não acontecia nada. Um
   * `!freeze` que ninguém lê é pior do que a sua ausência: parece configurado.
   */
  folha["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: linhas.length, c: cabecalho.length - 1 } }) };
  formatarColuna(XLSX, folha, 6, linhas.length, EUROS);
  formatarColuna(XLSX, folha, 7, linhas.length, DATA);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, folha, "Mensalidades");
  XLSX.utils.book_append_sheet(wb, resumo(XLSX, rows, range), "Resumo");

  const out = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  const blob = new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });

  descarregar(blob, nomeDoFicheiro(range));
}

/** `ad-fafe_mensalidades_2026-08.xlsx`, ou `..._2026-01_a_2026-08.xlsx` num intervalo. */
export function nomeDoFicheiro(range: ExportRange): string {
  const clube = (academy.slug || academy.shortName || "academia")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const intervalo = range.from === range.to ? range.from : `${range.from}_a_${range.to}`;
  return `${clube}_mensalidades_${intervalo}.xlsx`;
}

/* -------------------------------------------------------------------------- */

/**
 * O Resumo.
 *
 * A pergunta a seguir a "exporta-me isto" é sempre a mesma — *quanto é que isto
 * dá?* — e a resposta não devia obrigar a escrever um `SUMIF`. Traz também a
 * repartição por equipa, que é a segunda pergunta, e a data de geração, que é o
 * que torna o ficheiro legível daqui a seis meses.
 */
function resumo(
  XLSX: typeof import("xlsx"),
  rows: FeeExportRow[],
  range: ExportRange,
): import("xlsx").WorkSheet {
  const cents = (rs: FeeExportRow[]) => rs.reduce((n, r) => n + r.fee.amountCents, 0) / 100;
  const pagas = rows.filter((r) => r.fee.status === "paid");
  const vencidas = rows.filter((r) => r.fee.status === "overdue");
  const porCobrar = rows.filter((r) => r.fee.status === "pending" || r.fee.status === "processing");
  const anuladas = rows.filter((r) => r.fee.status === "void");

  const equipas = new Map<string, FeeExportRow[]>();
  for (const r of rows) equipas.set(r.team, [...(equipas.get(r.team) ?? []), r]);

  const dados: (string | number)[][] = [
    [academy.name || "Academia"],
    ["Mensalidades exportadas"],
    [],
    ["Período", range.from === range.to ? periodLabel(range.from) : `${periodLabel(range.from)} a ${periodLabel(range.to)}`],
    ["Filtro", range.statusLabel],
    ["Gerado em", serieDeInstante(new Date())],
    [],
    ["", "Mensalidades", "Valor"],
    ["Total", rows.length, cents(rows)],
    ["Pagas", pagas.length, cents(pagas)],
    ["Por cobrar", porCobrar.length, cents(porCobrar)],
    ["Vencidas", vencidas.length, cents(vencidas)],
    ["Anuladas", anuladas.length, cents(anuladas)],
    [],
    ["Por equipa", "Mensalidades", "Valor", "Cobrado"],
    ...[...equipas.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([nome, rs]) => [
        nome,
        rs.length,
        cents(rs),
        cents(rs.filter((r) => r.fee.status === "paid")),
      ]),
  ];

  const folha = XLSX.utils.aoa_to_sheet(dados);
  folha["!cols"] = [{ wch: 26 }, { wch: 14 }, { wch: 14 }, { wch: 14 }];

  // Os valores em euros: a coluna C de "Total" para baixo, e a D das equipas.
  for (let linha = 8; linha < dados.length; linha += 1) {
    for (const coluna of [2, 3]) {
      const celula = folha[XLSX.utils.encode_cell({ r: linha, c: coluna })];
      if (celula && typeof celula.v === "number") celula.z = EUROS;
    }
  }
  const gerado = folha[XLSX.utils.encode_cell({ r: 5, c: 1 })];
  if (gerado) gerado.z = "dd/mm/yyyy hh:mm";

  return folha;
}

/**
 * Uma data como o Excel a guarda: dias desde 30/12/1899.
 *
 * ## Porque é que não se escreve um `Date`
 *
 * O escritor do `xlsx` converte um `Date` de JS com o fuso do browser à mistura,
 * e o resultado não é a meia-noite exacta do dia: uma mensalidade a vencer a 8
 * de Setembro saía como `46272,99948` — que com um formato de data se lê **7 de
 * Setembro**. Um dia a menos em cada linha, em todos os fusos a leste de
 * Greenwich, incluindo o nosso.
 *
 * O número inteiro não tem fuso nenhum. É a mesma data em Lisboa, nos Açores e
 * em Tóquio, e o Excel mostra-a como data por causa do formato da célula.
 */
function serieDeData(iso: string): number {
  const [ano, mes, dia] = iso.slice(0, 10).split("-").map(Number);
  return (Date.UTC(ano, mes - 1, dia) - Date.UTC(1899, 11, 30)) / 86_400_000;
}

/** O mesmo, com hora — para o "Gerado em" dizer a hora do relógio de quem exportou. */
function serieDeInstante(d: Date): number {
  const dias = (Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(1899, 11, 30)) / 86_400_000;
  return dias + (d.getHours() * 60 + d.getMinutes()) / 1440;
}

/** Aplica um formato a todas as células de uma coluna, saltando o cabeçalho. */
function formatarColuna(
  XLSX: typeof import("xlsx"),
  folha: import("xlsx").WorkSheet,
  coluna: number,
  linhas: number,
  formato: string,
): void {
  for (let i = 1; i <= linhas; i += 1) {
    const celula = folha[XLSX.utils.encode_cell({ r: i, c: coluna })];
    if (celula) celula.z = formato;
  }
}

function descarregar(blob: Blob, nome: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  a.click();
  URL.revokeObjectURL(url);
}

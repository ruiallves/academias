/**
 * Exportar uma lista para Excel.
 *
 * ## Porque é que isto é uma coisa só
 *
 * Porque havia três exportações no produto — mensalidades, inventário, o modelo
 * de sócios — e cada uma escrevia o seu ficheiro à sua maneira: uma com
 * larguras de coluna, outra sem; uma com o nome do clube no ficheiro, outra
 * com "export.xlsx". Quem exporta a lista de atletas e a de sócios no mesmo dia
 * reparava.
 *
 * ## O ida-e-volta é a razão de existir
 *
 * A exportação de **sócios** e de **atletas** sai com exactamente as colunas
 * que a importação lê. Não é um detalhe de arrumação: é o que permite o que os
 * clubes pediram — exportar, mudar um campo em toda a gente numa folha de
 * cálculo, e voltar a carregar. Uma coluna com outro nome parte isso em
 * silêncio, e a pessoa só descobre quando a reimportação diz "faltam colunas".
 *
 * Por isso as colunas dessas duas listas vivem ao lado das da importação
 * (`member-sheet.ts` e `import.ts`) e não aqui: aqui está só a mecânica.
 *
 * ## O `xlsx` entra a pedido
 *
 * `await import("xlsx")` e não um `import` no topo: a biblioteca são umas
 * centenas de kilobytes e a esmagadora maioria das visitas a uma lista não
 * exporta nada. É o mesmo que `fees-export.ts` já fazia.
 */

/** Uma coluna: o cabeçalho que vai no ficheiro, e como se tira o valor da linha. */
export type ColunaExport<T> = {
  header: string;
  valor: (linha: T) => string | number | null | undefined;
  /** Largura em caracteres. Sem isto, calcula-se a partir do cabeçalho. */
  largura?: number;
};

/**
 * Escreve o ficheiro e devolve quantas linhas foram.
 *
 * O nome leva a data: um clube que exporte a lista duas vezes no mesmo mês fica
 * com dois ficheiros distinguíveis na pasta das transferências, em vez de
 * `socios (3).xlsx`.
 */
export async function exportarParaExcel<T>(
  linhas: T[],
  colunas: ColunaExport<T>[],
  opts: { ficheiro: string; folha: string },
): Promise<number> {
  const XLSX = await import("xlsx");

  const cabecalho = colunas.map((c) => c.header);
  const corpo = linhas.map((linha) =>
    colunas.map((c) => {
      const v = c.valor(linha);
      // Vazio é vazio: um `null` escrito como "null" numa célula é o género de
      // coisa que volta para dentro da base de dados na reimportação seguinte.
      return v === null || v === undefined ? "" : v;
    }),
  );

  const folha = XLSX.utils.aoa_to_sheet([cabecalho, ...corpo]);
  folha["!cols"] = colunas.map((c) => ({ wch: c.largura ?? Math.max(12, c.header.length + 2) }));
  // A primeira linha fica presa ao topo: uma lista de trezentos sócios perde o
  // cabeçalho ao segundo rolar, e a partir daí ninguém sabe que coluna é qual.
  folha["!freeze"] = { xSplit: 0, ySplit: 1 };
  if (corpo.length > 0) {
    folha["!autofilter"] = {
      ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: corpo.length, c: cabecalho.length - 1 } }),
    };
  }

  const livro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(livro, folha, opts.folha.slice(0, 31));
  XLSX.writeFile(livro, `${opts.ficheiro}-${hoje()}.xlsx`);

  return linhas.length;
}

/** `2026-09-20`, para o nome do ficheiro ordenar sozinho na pasta. */
function hoje(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** `AAAA-MM-DD` a partir do que vier, ou vazio. O Excel reconhece-o como data. */
export function dataISO(v: string | Date | null | undefined): string {
  if (!v) return "";
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

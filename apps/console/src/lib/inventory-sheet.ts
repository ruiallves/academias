import * as XLSX from "xlsx";
import type { ImportRow } from "@/lib/inventory";

/**
 * A folha de material do clube, lida no browser.
 *
 * ## Uma linha por tamanho
 *
 * É assim que se conta uma prateleira, e é assim que a folha do clube está
 * escrita. O servidor é que junta as linhas com o mesmo nome num artigo com
 * vários tamanhos — a folha não tem de conhecer o modelo do produto.
 *
 * ## Porquê aqui e não no servidor
 *
 * Um `.xlsx` é um zip com XML lá dentro; abri-lo do lado do servidor era
 * acrescentar superfície de ataque (zip bombs, entidades XML) para não ganhar
 * nada — o que a API precisa são linhas, e linhas viajam em JSON. O ficheiro
 * nunca sai do computador de quem o abriu. A mesma decisão da folha de sócios.
 *
 * ## Um campo obrigatório
 *
 * O **nome**. Um clube que só saiba o que tem, sem contagens, importa na mesma e
 * conta depois — e é isso que faz a diferença entre uma importação que acontece
 * e uma folha que fica por carregar. Ver `MemberImportRowDto` para a mesma
 * lição, aprendida à força.
 */

const COLUMNS = {
  name: { label: "Artigo", required: true, aliases: ["artigo", "nome", "designacao", "descricao", "item", "material"] },
  size: { label: "Tamanho", required: false, aliases: ["tamanho", "variante", "medida", "size"] },
  quantity: { label: "Quantidade", required: false, aliases: ["quantidade", "qtd", "stock", "unidades", "total"] },
  category: { label: "Categoria", required: false, aliases: ["categoria", "tipo", "familia"] },
  brand: { label: "Marca", required: false, aliases: ["marca", "fabricante"] },
  sku: { label: "Referência", required: false, aliases: ["referencia", "ref", "codigo", "sku"] },
  minimumStock: { label: "Stock mínimo", required: false, aliases: ["stock minimo", "minimo", "alerta"] },
} as const;

type Key = keyof typeof COLUMNS;

export const REQUIRED_COLUMNS = (Object.keys(COLUMNS) as Key[])
  .filter((k) => COLUMNS[k].required)
  .map((k) => COLUMNS[k].label);

export const OPTIONAL_COLUMNS = (Object.keys(COLUMNS) as Key[])
  .filter((k) => !COLUMNS[k].required)
  .map((k) => COLUMNS[k].label);

export type ParsedRow = { row: ImportRow; errors: string[] };
export type ParsedSheet = { missing: string[]; rows: ParsedRow[] };

/** Um texto como uma pessoa o leria: sem acentos, sem caixa, sem espaços a mais. */
function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[.ºª]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function text(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

/** Lê o ficheiro e devolve as linhas com os erros de cada uma ao lado. */
export async function readInventorySheet(file: File): Promise<ParsedSheet> {
  const book = XLSX.read(await file.arrayBuffer(), { cellDates: true });
  const sheet = book.Sheets[book.SheetNames[0]];
  if (!sheet) return { missing: REQUIRED_COLUMNS, rows: [] };

  const table = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: false });
  if (table.length === 0) return { missing: REQUIRED_COLUMNS, rows: [] };

  const byKey = new Map<Key, string>();
  for (const header of Object.keys(table[0])) {
    const folded = fold(header);
    for (const key of Object.keys(COLUMNS) as Key[]) {
      if (byKey.has(key)) continue;
      const col = COLUMNS[key];
      if (folded === fold(col.label) || (col.aliases as readonly string[]).some((a) => fold(a) === folded)) {
        byKey.set(key, header);
      }
    }
  }

  const missing = (Object.keys(COLUMNS) as Key[])
    .filter((k) => COLUMNS[k].required && !byKey.has(k))
    .map((k) => COLUMNS[k].label);
  if (missing.length > 0) return { missing, rows: [] };

  const cell = (raw: Record<string, unknown>, key: Key): string => {
    const header = byKey.get(key);
    return header ? text(raw[header]) : "";
  };

  const rows: ParsedRow[] = [];
  /** Artigo + tamanho repetidos na mesma folha: quase sempre uma linha colada. */
  const vistos = new Set<string>();

  table.forEach((raw, i) => {
    // +2: a folha conta a partir de 1 e a primeira linha é o cabeçalho. É este
    // número que a pessoa vê no Excel quando for corrigir.
    const line = i + 2;

    const name = cell(raw, "name");
    const size = cell(raw, "size");
    const quantidadeRaw = cell(raw, "quantity").replace(/[^\d-]/g, "");
    const minimoRaw = cell(raw, "minimumStock").replace(/[^\d-]/g, "");

    const errors: string[] = [];
    if (name.length < 2) errors.push("Artigo em falta");

    const quantity = quantidadeRaw ? Number(quantidadeRaw) : 0;
    if (quantidadeRaw && (Number.isNaN(quantity) || quantity < 0)) errors.push("Quantidade inválida");

    const chave = `${fold(name)}|${fold(size || "unico")}`;
    if (name && vistos.has(chave)) errors.push("Artigo e tamanho repetidos nesta folha");
    else if (name) vistos.add(chave);

    rows.push({
      row: {
        line,
        name,
        ...(size ? { size } : {}),
        ...(quantidadeRaw ? { quantity } : {}),
        ...(cell(raw, "category") ? { category: cell(raw, "category") } : {}),
        ...(cell(raw, "brand") ? { brand: cell(raw, "brand") } : {}),
        ...(cell(raw, "sku") ? { sku: cell(raw, "sku") } : {}),
        ...(minimoRaw ? { minimumStock: Number(minimoRaw) } : {}),
      },
      errors,
    });
  });

  return { missing: [], rows };
}

/**
 * A folha modelo.
 *
 * Com um artigo de vestuário em vários tamanhos e outro sem tamanho nenhum: são
 * os dois casos que existem num armazém, e um modelo que só mostre o primeiro
 * deixa por dizer que uma bola se regista numa linha só.
 */
export function downloadTemplate(categorias: string[]): void {
  const cat = categorias[0] ?? "Equipamento de treino";
  const linhas = [
    { Artigo: "T-shirt de aquecimento", Tamanho: "S", Quantidade: 12, Categoria: cat, Marca: "", Referência: "", "Stock mínimo": 5 },
    { Artigo: "T-shirt de aquecimento", Tamanho: "M", Quantidade: 24, Categoria: cat, Marca: "", Referência: "", "Stock mínimo": 5 },
    { Artigo: "T-shirt de aquecimento", Tamanho: "L", Quantidade: 18, Categoria: cat, Marca: "", Referência: "", "Stock mínimo": 5 },
    // Sem tamanho: fica com a variante "Único". É o caso das bolas e do material.
    { Artigo: "Bola de treino n.º 4", Tamanho: "", Quantidade: 30, Categoria: cat, Marca: "", Referência: "", "Stock mínimo": 10 },
  ];

  const sheet = XLSX.utils.json_to_sheet(linhas);
  sheet["!cols"] = Object.keys(linhas[0]).map((k) => ({ wch: Math.max(14, k.length + 4) }));

  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Material");
  XLSX.writeFile(book, "modelo-inventario.xlsx");
}

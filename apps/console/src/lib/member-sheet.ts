import * as XLSX from "xlsx";
import type { ImportRow, Sex } from "@/lib/members";

/**
 * A folha de sócios do clube, lida no browser.
 *
 * ## Porquê aqui e não no servidor
 *
 * Porque um .xlsx é um zip com XML lá dentro, e abri-lo do lado do servidor era
 * acrescentar ao produto uma superfície de ataque (zip bombs, entidades XML) para
 * não ganhar nada: o que a API precisa são linhas, e linhas viajam em JSON. O
 * ficheiro nunca sai do computador de quem o abriu.
 *
 * ## Porquê validar duas vezes
 *
 * Isto não é a validação — a validação é a do servidor, que é a única que conta.
 * O que se faz aqui é **mostrar** os erros antes de enviar, com o número da linha
 * da folha ao lado. Uma importação de 400 sócios recusada com "email inválido" e
 * sem dizer onde é uma tarde perdida a procurar.
 *
 * ## O nome das colunas
 *
 * Compara-se sem acentos, sem maiúsculas e sem espaços a mais. Cada clube escreve
 * o cabeçalho à sua maneira e nenhum deles está errado; obrigar a folha a chamar
 * "postalCode" ao código postal era fazer a secretaria trabalhar para o programa.
 */

/** As colunas que a folha tem de trazer, e os nomes por que respondem. */
const COLUMNS = {
  name: { label: "Nome", required: true, aliases: ["nome", "nome completo", "socio", "sócio"] },
  email: { label: "Email", required: true, aliases: ["email", "e-mail", "correio electronico"] },
  birthdate: {
    label: "Data de nascimento",
    required: true,
    aliases: ["data de nascimento", "nascimento", "data nascimento", "dt nascimento"],
  },
  address: { label: "Morada", required: true, aliases: ["morada", "endereco", "rua"] },
  postalCode: { label: "Código postal", required: true, aliases: ["codigo postal", "cod postal", "cp"] },
  city: { label: "Localidade", required: true, aliases: ["localidade", "cidade"] },
  phone: { label: "Telemóvel", required: true, aliases: ["telemovel", "telefone", "contacto", "tlm"] },
  documentNumber: {
    label: "N.º de documento",
    required: true,
    aliases: ["n de documento", "no de documento", "numero de documento", "documento", "cc", "cartao de cidadao"],
  },
  taxId: { label: "NIF", required: true, aliases: ["nif", "contribuinte", "n contribuinte"] },
  tier: { label: "Categoria", required: false, aliases: ["categoria", "tipo de socio", "tipo"] },
  number: { label: "N.º de sócio", required: false, aliases: ["n de socio", "no de socio", "numero de socio", "numero"] },
  sex: { label: "Sexo", required: false, aliases: ["sexo", "genero"] },
} as const;

type Key = keyof typeof COLUMNS;

export const REQUIRED_COLUMNS = (Object.keys(COLUMNS) as Key[])
  .filter((k) => COLUMNS[k].required)
  .map((k) => COLUMNS[k].label);

export const OPTIONAL_COLUMNS = (Object.keys(COLUMNS) as Key[])
  .filter((k) => !COLUMNS[k].required)
  .map((k) => COLUMNS[k].label);

export type ParsedRow = { row: ImportRow; errors: string[] };

export type ParsedSheet = {
  /** Cabeçalhos obrigatórios que a folha não trazia. Vazio quer dizer que serve. */
  missing: string[];
  rows: ParsedRow[];
};

/* -------------------------------------------------------------------------- */

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
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).trim();
}

/**
 * A data, venha ela como vier.
 *
 * O Excel guarda datas como número de dias desde 1900 e a folha do clube pode
 * trazê-las como texto em qualquer das três ordens habituais. Aceitam-se todas —
 * excepto a ambígua: `03/04/1990` é lido como dia/mês, que é como se escreve em
 * Portugal e como o resto do formulário as pede.
 */
function parseDate(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return iso(value);

  if (typeof value === "number" && value > 0) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return null;
    return iso(new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d)));
  }

  const raw = text(value);
  if (!raw) return null;

  const ymd = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(raw);
  if (ymd) return iso(new Date(Date.UTC(+ymd[1], +ymd[2] - 1, +ymd[3])));

  const dmy = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(raw);
  if (dmy) return iso(new Date(Date.UTC(+dmy[3], +dmy[2] - 1, +dmy[1])));

  return null;
}

function iso(date: Date): string | null {
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

const SEXES: Record<string, Sex> = {
  f: "FEMALE", feminino: "FEMALE", mulher: "FEMALE", female: "FEMALE",
  m: "MALE", masculino: "MALE", homem: "MALE", male: "MALE",
};

/* -------------------------------------------------------------------------- */

/** Lê o ficheiro e devolve as linhas com os erros de cada uma ao lado. */
export async function readMemberSheet(file: File): Promise<ParsedSheet> {
  const book = XLSX.read(await file.arrayBuffer(), { cellDates: true });
  const sheet = book.Sheets[book.SheetNames[0]];
  if (!sheet) return { missing: REQUIRED_COLUMNS, rows: [] };

  const table = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: false });
  if (table.length === 0) return { missing: REQUIRED_COLUMNS, rows: [] };

  // Cada cabeçalho da folha para a chave que lhe corresponde.
  const headers = Object.keys(table[0]);
  const byKey = new Map<Key, string>();
  for (const header of headers) {
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

  const cell = (raw: Record<string, unknown>, key: Key): unknown => {
    const header = byKey.get(key);
    return header ? raw[header] : "";
  };

  const rows: ParsedRow[] = [];
  const seenTaxIds = new Set<string>();

  table.forEach((raw, i) => {
    // +2: a folha conta a partir de 1 e a primeira linha é o cabeçalho. É este
    // número que a pessoa vê no Excel quando for corrigir.
    const line = i + 2;

    const name = text(cell(raw, "name"));
    const email = text(cell(raw, "email")).toLowerCase();
    const birthdate = parseDate(cell(raw, "birthdate"));
    const address = text(cell(raw, "address"));
    const city = text(cell(raw, "city"));
    const taxId = text(cell(raw, "taxId")).replace(/[\s.]/g, "");
    const documentNumber = text(cell(raw, "documentNumber"));
    const tier = text(cell(raw, "tier"));

    // 1234-567, 1234 567 ou 1234567 — todas dizem a mesma coisa.
    const postalRaw = text(cell(raw, "postalCode")).replace(/\s/g, "");
    const postalCode = /^\d{7}$/.test(postalRaw) ? `${postalRaw.slice(0, 4)}-${postalRaw.slice(4)}` : postalRaw;

    // O indicativo, se vier colado ao número, fica no campo dele.
    const phoneRaw = text(cell(raw, "phone")).replace(/[\s.-]/g, "");
    const withCode = /^\+(\d{1,4}?)(\d{9})$/.exec(phoneRaw);
    const phoneCountry = withCode ? `+${withCode[1]}` : "+351";
    const phone = withCode ? withCode[2] : phoneRaw.replace(/^00\d{2,4}/, "").replace(/^\+/, "");

    const numberRaw = text(cell(raw, "number")).replace(/\D/g, "");
    const sex = SEXES[fold(text(cell(raw, "sex")))];

    const errors: string[] = [];
    if (name.length < 3) errors.push("Nome em falta");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) errors.push("Email inválido");
    if (!birthdate) errors.push("Data de nascimento inválida");
    if (address.length < 3) errors.push("Morada em falta");
    if (!/^\d{4}-\d{3}$/.test(postalCode)) errors.push("Código postal no formato 0000-000");
    if (city.length < 2) errors.push("Localidade em falta");
    if (!/^\d{6,15}$/.test(phone)) errors.push("Telemóvel inválido");
    if (documentNumber.length < 4) errors.push("N.º de documento em falta");
    if (!/^\d{9}$/.test(taxId)) errors.push("O NIF tem nove dígitos");

    // O mesmo NIF duas vezes na mesma folha é quase sempre a mesma pessoa
    // colada por engano — e o servidor recusava a importação inteira por causa
    // dela. Apanha-se aqui, com o número da linha.
    if (taxId && seenTaxIds.has(taxId)) errors.push("NIF repetido nesta folha");
    else if (taxId) seenTaxIds.add(taxId);

    rows.push({
      row: {
        line,
        name,
        email,
        birthdate: birthdate ?? "",
        address,
        postalCode,
        city,
        phoneCountry,
        phone,
        documentNumber,
        taxId,
        ...(sex ? { sex } : {}),
        ...(tier ? { tier } : {}),
        ...(numberRaw ? { number: Number(numberRaw) } : {}),
      },
      errors,
    });
  });

  return { missing: [], rows };
}

/* -------------------------------------------------------------------------- */

/**
 * A folha modelo.
 *
 * Com uma linha de exemplo lá dentro, de propósito: um modelo só com cabeçalhos
 * deixa por dizer que a data se escreve em dia/mês/ano e que o código postal leva
 * hífen — e é aí que as importações falham.
 */
export function downloadTemplate(tierNames: string[]): void {
  const example: Record<string, string> = {
    Nome: "Maria Alves Ferreira",
    Email: "maria.ferreira@exemplo.pt",
    "Data de nascimento": "14/03/1987",
    Morada: "Rua das Oliveiras, 24, 3.º Esq.",
    "Código postal": "4700-025",
    Localidade: "Braga",
    Telemóvel: "912 345 678",
    "N.º de documento": "12345678 9 ZZ4",
    NIF: "212345678",
    Categoria: tierNames[0] ?? "",
    "N.º de sócio": "1",
    Sexo: "F",
  };

  const sheet = XLSX.utils.json_to_sheet([example]);
  sheet["!cols"] = Object.keys(example).map((k) => ({ wch: Math.max(14, k.length + 4) }));

  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Sócios");
  XLSX.writeFile(book, "modelo-socios.xlsx");
}

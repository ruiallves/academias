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

/**
 * As colunas que a folha pode trazer, e os nomes por que respondem.
 *
 * **Quatro são obrigatórias**: nome, número de sócio, telemóvel e categoria. As
 * outras entram se lá estiverem e ficam por preencher se não. Eram quase todas
 * obrigatórias — email, data de nascimento, morada, código postal, localidade,
 * documento, NIF — e a queixa que trouxe isto foi exactamente essa: *"exige muita
 * informação que o Excel não tem"*. Um livro de sócios real é o nome, o número, um
 * contacto e a categoria; exigir o resto não enchia as fichas, impedia a
 * importação.
 */
const COLUMNS = {
  name: { label: "Nome", required: true, aliases: ["nome", "nome completo", "socio", "sócio"] },
  number: { label: "N.º de sócio", required: true, aliases: ["n de socio", "no de socio", "numero de socio", "numero", "n socio"] },
  phone: { label: "Telemóvel", required: true, aliases: ["telemovel", "telefone", "contacto", "tlm", "telm"] },
  tier: { label: "Categoria", required: true, aliases: ["categoria", "tipo de socio", "tipo", "tipo socio", "escalao"] },
  email: { label: "Email", required: false, aliases: ["email", "e-mail", "correio electronico"] },
  birthdate: {
    label: "Data de nascimento",
    required: false,
    aliases: ["data de nascimento", "nascimento", "data nascimento", "dt nascimento"],
  },
  address: { label: "Morada", required: false, aliases: ["morada", "endereco", "rua"] },
  postalCode: { label: "Código postal", required: false, aliases: ["codigo postal", "cod postal", "cp"] },
  city: { label: "Localidade", required: false, aliases: ["localidade", "cidade"] },
  documentNumber: {
    label: "N.º de documento",
    required: false,
    aliases: ["n de documento", "no de documento", "numero de documento", "documento", "cc", "cartao de cidadao"],
  },
  taxId: { label: "NIF", required: false, aliases: ["nif", "contribuinte", "n contribuinte"] },
  sex: { label: "Sexo", required: false, aliases: ["sexo", "genero"] },
  /**
   * O dia e o mês em que abre o ano de quotas do sócio — `DD/MM`.
   *
   * Só conta nas categorias **anuais**: é a data em que a anuidade dele corre,
   * todos os anos. Vazio assume o dia da importação, que é a mesma regra de
   * quem se inscreve à mão. Preenchido **refaz a anuidade** desse sócio — ver o
   * aviso no ecrã de importação.
   */
  annualStart: {
    label: "Início do ano de quotas",
    required: false,
    aliases: [
      "inicio do ano de quotas", "ano de quotas", "inicio das quotas", "periodo das quotas",
      "periodo de quotas", "abertura das quotas", "inicio da anuidade", "anuidade",
    ],
  },
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

/**
 * O dia e o mês em que abre o ano de quotas — devolvido como `MM-DD`, que é o
 * que a API lê.
 *
 * Aceita-se tudo o que uma folha real traz: `22/09`, `22-09`, `22.9`, uma data
 * completa (de onde se tira só o dia e o mês), e o que o Excel fizer disso.
 *
 * O Excel é o caso que obriga a isto: escrever `22/09` numa célula faz dele uma
 * **data** do ano corrente, e o que chega aqui já não é texto nenhum. Exportar
 * e voltar a importar sem perder a coluna depende de se aceitar as duas formas.
 */
function parseDiaMes(value: unknown): string | null {
  const doDia = (dia: number, mes: number) =>
    mes >= 1 && mes <= 12 && dia >= 1 && dia <= 31
      ? `${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`
      : null;

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return doDia(value.getUTCDate(), value.getUTCMonth() + 1);
  }
  if (typeof value === "number" && value > 0) {
    const p = XLSX.SSF.parse_date_code(value);
    return p ? doDia(p.d, p.m) : null;
  }

  const raw = text(value);
  if (!raw) return null;

  /* Uma data completa: fica o dia e o mês, o ano não interessa. */
  const completa = parseDate(raw);
  if (completa) {
    const [, m, d] = completa.split("-").map(Number);
    return doDia(d, m);
  }

  const dm = /^(\d{1,2})[-/.](\d{1,2})$/.exec(raw);
  return dm ? doDia(+dm[1], +dm[2]) : null;
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
  const seenNumbers = new Set<number>();

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
    const annualStart = parseDiaMes(cell(raw, "annualStart"));

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

    const number = numberRaw ? Number(numberRaw) : 0;

    /*
     * Os quatro que são mesmo precisos — e a **forma** de tudo o que vier.
     *
     * Um campo vazio é um campo por preencher, e isso é a vida de um livro de
     * sócios em papel. Um campo preenchido ao lado é outra coisa: um NIF com oito
     * dígitos entra na base como se fosse bom e ninguém volta lá.
     */
    const errors: string[] = [];
    if (name.length < 3) errors.push("Nome em falta");
    if (!number) errors.push("N.º de sócio em falta");
    if (!/^\d{6,15}$/.test(phone)) errors.push("Telemóvel inválido");
    if (!tier) errors.push("Categoria em falta");

    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) errors.push("Email inválido");
    if (text(cell(raw, "birthdate")) && !birthdate) errors.push("Data de nascimento inválida");
    if (text(cell(raw, "annualStart")) && !annualStart) {
      errors.push("Início do ano de quotas inválido — usa dia/mês, por exemplo 22/09");
    }
    if (postalRaw && !/^\d{4}-\d{3}$/.test(postalCode)) errors.push("Código postal no formato 0000-000");
    if (taxId && !/^\d{9}$/.test(taxId)) errors.push("O NIF tem nove dígitos");

    /*
     * O mesmo sócio duas vezes na mesma folha é quase sempre uma linha colada por
     * engano — e o servidor recusava a importação inteira por causa dela.
     * Apanha-se aqui, com o número da linha, que é o que se vê no Excel.
     *
     * Pelo **número** primeiro: é ele que identifica o sócio no livro do clube, e
     * o NIF pode nem lá vir.
     */
    if (number && seenNumbers.has(number)) errors.push("N.º de sócio repetido nesta folha");
    else if (number) seenNumbers.add(number);

    if (taxId && seenTaxIds.has(taxId)) errors.push("NIF repetido nesta folha");
    else if (taxId) seenTaxIds.add(taxId);

    rows.push({
      row: {
        line,
        name,
        number,
        phone,
        tier,
        phoneCountry,
        ...(email ? { email } : {}),
        ...(birthdate ? { birthdate } : {}),
        ...(address ? { address } : {}),
        ...(postalCode ? { postalCode } : {}),
        ...(city ? { city } : {}),
        ...(documentNumber ? { documentNumber } : {}),
        ...(taxId ? { taxId } : {}),
        ...(sex ? { sex } : {}),
        ...(annualStart ? { annualStart } : {}),
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
 *
 * As quatro colunas obrigatórias vêm primeiro, e a segunda linha do exemplo tem
 * **só essas** preenchidas: é a maneira de dizer, sem uma nota de rodapé que
 * ninguém lê, que o resto pode ficar em branco.
 */
export function downloadTemplate(tierNames: string[]): void {
  const example: Record<string, string> = {
    Nome: "Maria Alves Ferreira",
    "N.º de sócio": "1",
    Telemóvel: "912 345 678",
    Categoria: tierNames[0] ?? "Sócio efectivo",
    Email: "maria.ferreira@exemplo.pt",
    "Data de nascimento": "14/03/1987",
    Morada: "Rua das Oliveiras, 24, 3.º Esq.",
    "Código postal": "4700-025",
    Localidade: "Braga",
    "N.º de documento": "12345678 9 ZZ4",
    NIF: "212345678",
    Sexo: "F",
    /* Vazio assume o dia da importação — a linha de baixo mostra-o. */
    "Início do ano de quotas": "22/09",
  };

  const minimo: Record<string, string> = Object.fromEntries(
    Object.keys(example).map((k) => [k, ""]),
  );
  minimo.Nome = "António Sousa";
  minimo["N.º de sócio"] = "2";
  minimo.Telemóvel = "913 000 111";
  minimo.Categoria = tierNames[0] ?? "Sócio efectivo";

  const sheet = XLSX.utils.json_to_sheet([example, minimo]);
  sheet["!cols"] = Object.keys(example).map((k) => ({ wch: Math.max(14, k.length + 4) }));

  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Sócios");
  XLSX.writeFile(book, "modelo-socios.xlsx");
}

/* -------------------------------------------------------------------------- */
/* Exportar                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * O livro de sócios para Excel, **com as colunas que a importação lê**.
 *
 * Vive aqui e não em `exportar.ts` por uma razão que vale a pena dizer: é o
 * mesmo `COLUMNS` acima que define os dois lados. Um clube exporta a lista,
 * muda a categoria de toda a gente numa folha de cálculo, e volta a carregar —
 * e isso só fecha enquanto os cabeçalhos forem os mesmos. Separar as duas
 * listas garantia que, à primeira coluna renomeada, uma delas ficava para trás
 * sem ninguém dar por isso.
 *
 * O **número de sócio** é o que liga as duas pontas: é por ele que a
 * reimportação reconhece a ficha. Sai sempre, mesmo vazio num sócio por
 * aprovar — e uma linha sem número entra como sócio novo, que é a leitura
 * certa.
 */
export const EXPORT_COLUMNS: { header: string; key: Key; largura?: number }[] = [
  { header: COLUMNS.number.label, key: "number", largura: 12 },
  { header: COLUMNS.name.label, key: "name", largura: 28 },
  { header: COLUMNS.tier.label, key: "tier", largura: 18 },
  { header: COLUMNS.phone.label, key: "phone", largura: 14 },
  { header: COLUMNS.email.label, key: "email", largura: 26 },
  { header: COLUMNS.birthdate.label, key: "birthdate", largura: 16 },
  { header: COLUMNS.address.label, key: "address", largura: 30 },
  { header: COLUMNS.postalCode.label, key: "postalCode", largura: 14 },
  { header: COLUMNS.city.label, key: "city", largura: 18 },
  { header: COLUMNS.documentNumber.label, key: "documentNumber", largura: 18 },
  { header: COLUMNS.taxId.label, key: "taxId", largura: 12 },
  { header: COLUMNS.sex.label, key: "sex", largura: 8 },
  { header: COLUMNS.annualStart.label, key: "annualStart", largura: 20 },
];

/** `FEMALE` → `F`, que é o que a importação volta a ler. Ver `SEXES`. */
export function sexoParaFolha(sex: string | null | undefined): string {
  if (sex === "FEMALE") return "F";
  if (sex === "MALE") return "M";
  return "";
}

/**
 * `09-22` → `22/09`, que é o que a importação volta a ler. Ver `parseDiaMes`.
 *
 * Nunca devolve vazio para um sócio que exista: a API já resolve quem herda a
 * abertura do clube antes de a lista sair. Se mesmo assim vier vazio, vazio
 * fica — inventar uma data aqui era escrever um ano de quotas que ninguém
 * escolheu.
 */
export function diaMesParaFolha(mmdd: string | null | undefined): string {
  const m = /^(\d{2})-(\d{2})$/.exec(mmdd ?? "");
  return m ? `${m[2]}/${m[1]}` : "";
}

/**
 * A exportação, e o ida-e-volta que é a razão de ela existir.
 *
 * ## O que se está a proteger
 *
 * Os clubes pediram isto para uma coisa concreta: **exportar a lista, corrigir
 * um campo em toda a gente numa folha de cálculo, e voltar a carregá-la**. Isso
 * só fecha enquanto os cabeçalhos que a exportação escreve forem os que a
 * importação sabe ler — e é uma ligação que se parte em silêncio. Uma coluna
 * renomeada de um lado não dá erro nenhum: dá um ficheiro que volta a entrar
 * com um campo a menos, ou não entra de todo.
 *
 * Por isso este teste não verifica a exportação sozinha. **Exporta a sério, com
 * o mesmo código da consola, e volta a ler o ficheiro com o mesmo leitor da
 * importação.** Se alguém mudar um cabeçalho num dos lados, isto cai.
 *
 * ## Corre o código verdadeiro
 *
 * Agrupado com esbuild e executado em node, como os outros testes da consola.
 * Uma reimplementação das colunas num script só testaria a reimplementação.
 *
 * Uso: npm run test:exportar
 */
import * as XLSX from "xlsx";
import { COLUNAS_EXPORT_ATLETAS, COLUNAS_EXPORT_SOCIOS } from "../src/lib/colunas-export";
import { readMemberSheet } from "../src/lib/member-sheet";
import { COLUMNS as COLUNAS_ATLETA, parseFile } from "../src/lib/import";
import type { ColunaExport } from "../src/lib/exportar";
import type { MemberRow } from "../src/lib/members";
import type { Athlete } from "../src/data/types";

let ok = 0;
let bad = 0;
const check = (label: string, cond: unknown, detalhe = "") => {
  if (cond) {
    ok++;
    console.log("  OK    " + label);
  } else {
    bad++;
    console.log("  FALHA " + label + (detalhe ? " — " + detalhe : ""));
  }
};

/**
 * Escreve as linhas como a consola as escreve, e devolve o ficheiro.
 *
 * Gémeo de `exportarParaExcel` na parte que interessa aqui: as mesmas colunas,
 * os mesmos valores, o mesmo vazio. O que não se repete é a escrita para disco
 * (`XLSX.writeFile`), que num teste não serve de nada — fica-se pelos bytes.
 */
function folhaDe<T>(linhas: T[], colunas: ColunaExport<T>[]): Uint8Array {
  const cabecalho = colunas.map((c) => c.header);
  const corpo = linhas.map((l) =>
    colunas.map((c) => {
      const v = c.valor(l);
      return v === null || v === undefined ? "" : v;
    }),
  );
  const folha = XLSX.utils.aoa_to_sheet([cabecalho, ...corpo]);
  const livro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(livro, folha, "Folha");
  return XLSX.write(livro, { type: "array", bookType: "xlsx" }) as Uint8Array;
}

/** O ficheiro como o `<input type="file">` o daria ao leitor. */
const comoFicheiro = (bytes: Uint8Array, nome: string): File =>
  new File([bytes as unknown as BlobPart], nome, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });

/* -------------------------------------------------------------------------- */
/* Sócios                                                                      */
/* -------------------------------------------------------------------------- */

console.log("\n=== Sócios: exportar e voltar a ler ===");

const socio = (over: Partial<MemberRow> = {}): MemberRow =>
  ({
    id: "m1",
    number: 42,
    name: "Maria Alves Ferreira",
    email: "maria@exemplo.pt",
    phone: "912345678",
    phoneCountry: "+351",
    birthdate: "1987-03-14",
    address: "Rua das Oliveiras, 24",
    postalCode: "4700-025",
    city: "Braga",
    country: "PT",
    documentKind: "CC",
    documentNumber: "12345678 9 ZZ4",
    taxId: "212345678",
    sex: "FEMALE",
    annualStart: "09-22",
    status: "ACTIVE",
    createdAt: "2026-01-02T10:00:00.000Z",
    approvedAt: "2026-01-03T10:00:00.000Z",
    source: "secretaria",
    tier: { id: "t1", name: "Sócio Efectivo", feeCents: 1000, billing: "MONTHLY" },
    photoUrl: null,
    app: "none",
    inviteSentAt: null,
    lastPaidPeriod: null,
    ...over,
  }) as MemberRow;

const socios = [
  socio(),
  socio({ id: "m2", number: 43, name: "António Sousa", email: null, taxId: null, sex: "MALE", annualStart: "01-31" }),
];
const ficheiroSocios = folhaDe(socios, COLUNAS_EXPORT_SOCIOS);
const lidoSocios = await readMemberSheet(comoFicheiro(ficheiroSocios, "socios.xlsx"));

check("o leitor não acusa colunas em falta", lidoSocios.missing.length === 0, lidoSocios.missing.join(", "));
check("duas linhas", lidoSocios.rows.length === 2, String(lidoSocios.rows.length));
check(
  "nenhuma com erros",
  lidoSocios.rows.every((r) => r.errors.length === 0),
  JSON.stringify(lidoSocios.rows.map((r) => r.errors)),
);

const primeiro = lidoSocios.rows[0]?.row;
check("o número volta igual", primeiro?.number === 42, String(primeiro?.number));
check("o nome volta igual", primeiro?.name === "Maria Alves Ferreira", primeiro?.name);
check("a categoria volta pelo nome", primeiro?.tier === "Sócio Efectivo", primeiro?.tier);
check("o telemóvel volta sem indicativo", primeiro?.phone === "912345678", primeiro?.phone);
check("o email volta igual", primeiro?.email === "maria@exemplo.pt", primeiro?.email);
check("a data de nascimento volta em ISO", primeiro?.birthdate === "1987-03-14", primeiro?.birthdate);
check("a morada volta igual", primeiro?.address === "Rua das Oliveiras, 24", primeiro?.address);
check("o código postal volta igual", primeiro?.postalCode === "4700-025", primeiro?.postalCode);
check("a localidade volta igual", primeiro?.city === "Braga", primeiro?.city);
check("o NIF volta igual", primeiro?.taxId === "212345678", primeiro?.taxId);
check("o documento volta igual", primeiro?.documentNumber === "12345678 9 ZZ4", primeiro?.documentNumber);
check("o sexo volta como F/M", primeiro?.sex === "FEMALE", String(primeiro?.sex));
check("o ano de quotas volta igual", primeiro?.annualStart === "09-22", String(primeiro?.annualStart));

/*
 * Um sócio sem email e sem NIF é o caso normal de metade dos livros antigos.
 * Tem de atravessar o ida-e-volta sem inventar um "null" na célula.
 */
const segundo = lidoSocios.rows[1]?.row;
check("um sócio sem email volta sem email", !segundo?.email, String(segundo?.email));
check("e sem NIF volta sem NIF", !segundo?.taxId, String(segundo?.taxId));
check("com o sexo masculino", segundo?.sex === "MALE", String(segundo?.sex));
check("e com o seu próprio ano de quotas", segundo?.annualStart === "01-31", String(segundo?.annualStart));

/*
 * O ano de quotas **nunca sai vazio**, e isto é mais do que uma preocupação
 * estética: uma célula em branco volta a entrar como "assume hoje", e assumir
 * hoje num sócio que já tem anuidade a correr é apagar-lhe as quotas do ano.
 * Quem está na plataforma tem sempre um ano de quotas — a API resolve o
 * herdado antes de a lista sair — e a folha tem de o dizer em todas as linhas.
 */
const colunaAno = COLUNAS_EXPORT_SOCIOS.find((c) => c.header === "Início do ano de quotas");
check("a coluna do ano de quotas vai na folha", Boolean(colunaAno), "");
check(
  "e vem preenchida em todas as linhas",
  socios.every((m) => String(colunaAno?.valor(m) ?? "").trim() !== ""),
  socios.map((m) => String(colunaAno?.valor(m))).join(" | "),
);
check(
  "no formato dia/mês que a importação lê",
  socios.every((m) => /^\d{2}\/\d{2}$/.test(String(colunaAno?.valor(m)))),
  socios.map((m) => String(colunaAno?.valor(m))).join(" | "),
);

/*
 * A coluna que **não** volta: o estado existe para quem lê a folha, e a
 * importação não a conhece. O que se garante é que a presença dela não parte a
 * leitura — uma coluna a mais é ignorada, e era assim que tinha de ser.
 */
check(
  "a coluna Estado vai na folha",
  COLUNAS_EXPORT_SOCIOS.some((c) => c.header === "Estado"),
  "",
);

/* -------------------------------------------------------------------------- */
/* Atletas                                                                     */
/* -------------------------------------------------------------------------- */

console.log("\n=== Atletas: os cabeçalhos são os da importação ===");

/*
 * Aqui a verificação é sobre os **cabeçalhos** e não sobre um ida-e-volta
 * completo: o leitor de atletas resolve a equipa contra a academia carregada
 * no `store`, que num teste sem sessão está vazia. O que se pode garantir sem
 * inventar um clube inteiro é o essencial — que a folha que sai tem as colunas
 * que a folha que entra exige, pela mesma ordem.
 */
const cabecalhosExportados = COLUNAS_EXPORT_ATLETAS.map((c) => c.header);
const cabecalhosImportados = COLUNAS_ATLETA.map((c) => c.header);

check(
  "todas as colunas da importação saem na exportação",
  cabecalhosImportados.every((h) => cabecalhosExportados.includes(h)),
  cabecalhosImportados.filter((h) => !cabecalhosExportados.includes(h)).join(", "),
);
check(
  "e pela mesma ordem",
  cabecalhosExportados.slice(0, cabecalhosImportados.length).join("|") === cabecalhosImportados.join("|"),
  cabecalhosExportados.join("|"),
);
check(
  "as obrigatórias estão lá",
  COLUNAS_ATLETA.filter((c) => c.required).every((c) => cabecalhosExportados.includes(c.header)),
  "",
);

/*
 * O ida-e-volta do atleta, na parte que não precisa de clube: as colunas
 * escrevem-se, o leitor reconhece-as todas, e o que falha é só a equipa.
 */
const atleta = {
  id: "a1",
  name: "Martim Bragança",
  birthdate: "2015-03-14",
  taxId: "123456789",
  teamId: "t1",
  position: "Médio",
  guardianIds: [],
  joinedAt: "2026-01-02",
  status: "active",
  medicalValidUntil: "2027-01-20",
  email: "martim@mail.pt",
  app: "none",
  inviteSentAt: null,
  appInstalled: false,
  heightCm: 148,
  weightKg: 41.5,
  dominantSide: "Direito",
  squadNumber: 7,
} as unknown as Athlete;

const ficheiroAtletas = folhaDe([atleta], COLUNAS_EXPORT_ATLETAS);
const lidoAtletas = await parseFile(comoFicheiro(ficheiroAtletas, "atletas.xlsx"));

check("o leitor não acusa colunas em falta", lidoAtletas.missingColumns.length === 0, lidoAtletas.missingColumns.join(", "));
check("a linha é lida", lidoAtletas.valid.length + lidoAtletas.errors.length === 1, "");

const linhaAtleta = lidoAtletas.valid[0];
if (linhaAtleta) {
  check("o nome volta igual", linhaAtleta.name === "Martim Bragança", linhaAtleta.name);
  check("a data volta em ISO", linhaAtleta.birthdate === "2015-03-14", linhaAtleta.birthdate);
  check("o NIF volta igual", linhaAtleta.taxId === "123456789", String(linhaAtleta.taxId));
  check("o número volta igual", linhaAtleta.squadNumber === 7, String(linhaAtleta.squadNumber));
  check("o lado dominante volta a ser RIGHT", linhaAtleta.dominantSide === "RIGHT", String(linhaAtleta.dominantSide));
  check("a altura volta igual", linhaAtleta.heightCm === 148, String(linhaAtleta.heightCm));
} else {
  // Sem clube carregado a equipa não resolve, e a linha sai como erro. O que
  // interessa continua a ser verificável: o motivo é a equipa, e mais nada.
  const motivo = lidoAtletas.errors[0]?.error ?? "";
  check("a única coisa que falha é a equipa", /equipa/i.test(motivo), motivo);
}

/* -------------------------------------------------------------------------- */

console.log(`\n${ok} OK, ${bad} FALHA`);
process.exit(bad ? 1 : 0);

/**
 * A folha da convocatória, em PDF.
 *
 * Corre o desenho a sério — o mesmo `buildCallUpPdf` que o botão chama — e
 * inspecciona o ficheiro que sai. O que se guarda aqui é o que não se vê a olho
 * numa exportação de teste com cinco convocados:
 *
 * - **a paginação**, que é a razão de isto ser um documento e não uma imagem:
 *   vinte e dois convocados passam para a segunda página, e o cabeçalho da
 *   tabela tem de ir com eles;
 * - **as colunas que lá estão e as que não estão**, porque uma coluna a mais numa
 *   folha que se assina em pé é uma coluna que fica em branco;
 * - **a regra da casa**: um rascunho não se exporta.
 *
 * O texto é lido de dentro dos fluxos comprimidos do PDF, e não de uma variável
 * intermédia: o que se verifica é o que o ficheiro diz, não o que o código
 * tencionava dizer.
 *
 * Uso: npm run test:pdf --workspace @academia/console
 */
import { inflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { buildCallUpPdf, type CallUpSheet, type SheetRow } from "@/lib/callup-sheet";

let ok = 0;
let bad = 0;
const check = (l: string, c: boolean, d = "") => {
  if (c) {
    ok++;
    console.log("  OK    " + l);
  } else {
    bad++;
    console.log("  FALHA " + l + (d ? " — " + d : ""));
  }
};

const NOMES = [
  "Afonso Ribeiro", "Bruno Salgado", "Carlos Mendes", "Diogo Faria", "Eduardo Pinto",
  "Filipe Marques", "Gonçalo Nunes", "Hugo Teixeira", "Ivo Carvalho", "João Pereira",
  "Luís Cardoso", "Miguel Antunes", "Nuno Rocha", "Pedro Sousa", "Rafael Lima",
  "Rui Barbosa", "Simão Costa", "Tiago Moreira", "Vasco Duarte", "Xavier Neves",
  "Zé Oliveira", "André Fonseca",
];

const atletas = (n: number): SheetRow[] =>
  NOMES.slice(0, n).map((name, i) => ({
    squadNumber: i + 1,
    name,
    position: i === 0 ? "Guarda-redes" : null,
    status: i % 3 === 0 ? "CONFIRMED" : i % 3 === 1 ? "CALLED" : "DECLINED",
    guestFrom: i === 5 ? "Sub-11" : null,
  }));

const folha = (rows: SheetRow[], extra: Partial<CallUpSheet> = {}): CallUpSheet => ({
  competition: "Campeonato Distrital",
  round: "Jornada 7",
  meetingPoint: "Sede do clube",
  meetingTime: "13:30",
  arrivalTime: "14:00",
  notes: "",
  order: "name",
  academy: { name: "Life Club", logoUrl: "", signalColor: "#2f6f4f" },
  season: "2026/27",
  team: "Sub-13 Futebol",
  opponent: "SC Vilarinho",
  isHome: true,
  venue: "Campo Municipal",
  kickOff: new Date("2026-11-08T15:00:00"),
  submitted: true,
  coachName: "Rui Steam",
  staff: [{ name: "Rui Steam", role: "Treinador" }, { name: "Ana Lopes", role: "Adjunta" }],
  rows,
  ...extra,
});

/** O texto que o ficheiro traz mesmo lá dentro, fluxos comprimidos incluídos. */
function textoDoPdf(bytes: Uint8Array): string {
  const bruto = Buffer.from(bytes);
  // `latin1` mapeia byte a byte, por isso os índices da string são os do buffer
  // — é o que permite procurar as marcas como texto e cortar como bytes.
  const cru = bruto.toString("latin1");
  let saida = cru;

  // Cada `stream ... endstream` que descomprimir entra também na leitura: é lá
  // que jsPDF escreve o que se lê na página. O `(?<!end)` evita apanhar o fim de
  // um fluxo como se fosse o princípio do seguinte.
  const marca = /(?<!end)stream\r?\n/g;
  for (let m = marca.exec(cru); m; m = marca.exec(cru)) {
    const inicio = m.index + m[0].length;
    const fim = cru.indexOf("endstream", inicio);
    if (fim < 0) break;
    for (const recuo of [0, 1, 2]) {
      try {
        saida += "\n" + inflateSync(bruto.subarray(inicio, fim - recuo)).toString("latin1");
        break;
      } catch {
        /* Nem todos os fluxos são deflate, e o fim pode trazer uma quebra de linha. */
      }
    }
  }
  return saida;
}

const bytesDe = (doc: Awaited<ReturnType<typeof buildCallUpPdf>>): Uint8Array =>
  new Uint8Array(doc.output("arraybuffer") as ArrayBuffer);

/* ========================================================================== */

console.log("=== Um rascunho não se exporta ===");
/*
 * A folha é o documento que as famílias assinam, e a lista que elas receberam é
 * a submetida. Um rascunho ainda muda — sai o papel, entra um lesionado, e no
 * ponto de encontro há assinaturas por um plantel que já não é aquele.
 */
let recusou = false;
try {
  await buildCallUpPdf(folha(atletas(5), { submitted: false }));
} catch {
  recusou = true;
}
check("uma convocatória por submeter é recusada", recusou);

console.log("\n=== O documento sai ===");
const doc = await buildCallUpPdf(folha(atletas(22), { notes: "Levar equipamento alternativo." }));
const bytes = bytesDe(doc);
check("é um PDF", Buffer.from(bytes.subarray(0, 5)).toString("latin1") === "%PDF-");
check("com corpo a sério", bytes.length > 3000, `${bytes.length} bytes`);

const texto = textoDoPdf(bytes);

console.log("\n=== As cinco colunas, e só elas ===");
for (const coluna of ["#", "N.", "Atleta", "T", "Assinatura"]) {
  check(`a coluna ${coluna} está lá`, texto.includes(coluna));
}
/*
 * As duas que saíram. A das respostas das famílias e a das observações por
 * atleta enchiam a folha de espaço que ninguém preenchia em pé, no parque de
 * estacionamento — e roubavam largura à única coluna que se escreve mesmo: a
 * assinatura.
 */
check("a coluna Resp. saiu", !texto.includes("Resp."));
check(
  "e a assinatura já não é 'do encarregado'",
  !texto.includes("encarregado"),
  "sobrou o cabeçalho antigo",
);

console.log("\n=== O que a folha diz à volta da lista ===");
check("o nome do clube", texto.includes("Life Club"));
check("o tipo de documento", texto.includes("CONVOCAT"));
check("a prova e a jornada", texto.includes("Campeonato Distrital") && texto.includes("Jornada 7"));
check("o ponto de encontro", texto.includes("Sede do clube"));
check("a legenda do transporte", texto.includes("transporte pelo clube"));
check("o quadro das observações", texto.includes("OBSERVA"));
check("o que lá foi escrito", texto.includes("Levar equipamento alternativo."));
check("quem assina por baixo", texto.includes("Treinador respons"));
check("a contagem", texto.includes("22 convocados"));

console.log("\n=== Os atletas ===");
check("o primeiro da lista", texto.includes("Afonso Ribeiro"));
check("e o último", texto.includes("Zé Oliveira") || texto.includes("Z\\351 Oliveira"));
// O convidado tem de se ver: é um miúdo de outro escalão, e quem assina por ele
// não é a pessoa que o treinador está à espera de ver.
check("o convidado traz o escalão de origem", texto.includes("convidado"));

console.log("\n=== A paginação ===");
check("vinte e dois convocados dão duas páginas", doc.getNumberOfPages() === 2, `${doc.getNumberOfPages()}`);
// O cabeçalho repete-se na segunda: uma página de assinaturas sem saber a que
// coluna corresponde cada espaço é uma página perdida.
check("o cabeçalho da tabela repete-se", (texto.match(/Assinatura/g) ?? []).length >= 2);
check("e o rodapé numera as páginas", texto.includes("1 de 2") && texto.includes("2 de 2"));

const curta = await buildCallUpPdf(folha(atletas(8)));
check("oito convocados cabem numa", curta.getNumberOfPages() === 1, `${curta.getNumberOfPages()}`);
const textoCurto = textoDoPdf(bytesDe(curta));
check("e aí o rodapé não numera nada", !textoCurto.includes(" de 1"));

console.log("\n=== Ordenar por número ===");
const porNumero = await buildCallUpPdf(folha(atletas(8), { order: "number" }));
check("também sai", porNumero.getNumberOfPages() === 1);

/* Fica um exemplar em disco — para se abrir e olhar, que é o que nenhum teste faz. */
const destino = process.env.PDF_OUT;
if (destino) {
  writeFileSync(destino, bytes);
  console.log(`\nExemplar gravado em ${destino}`);
}

console.log(`\n${ok} passaram, ${bad} falharam`);
process.exit(bad ? 1 : 0);

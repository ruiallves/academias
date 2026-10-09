import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PDFArray, PDFDocument, PDFName, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import type { Categoria, Folha, Tipo } from "./regras";

/**
 * O Modelo 2 da FPF (jogador amador), preenchido.
 *
 * ## Escrever por cima, e não preencher o formulário
 *
 * O PDF da federação é um formulário com campos. Preenchê-los parecia o óbvio,
 * mas várias folhas num só PDF partilhavam os nomes dos campos ("Text Field
 * 40120" em todas), e um leitor de PDF mostrava o nome do primeiro atleta em
 * todas as páginas. Por isso os campos saem do modelo e o texto desenha-se nas
 * posições deles. As caixas que se vêem são do desenho da página, não dos
 * campos, e ficam.
 *
 * ## Um fundo para todas as folhas
 *
 * O modelo pesa ~700 KB, quase tudo letra e desenho. As páginas copiam-se de
 * uma vez (`copyPages` com o mesmo índice repetido), e o que é igual em todas
 * fica uma vez só no ficheiro: cem folhas não pesam cem modelos.
 *
 * ## Até onde se preenche
 *
 * Até ao clube onde se inscreve, como foi pedido. As autorizações, as
 * assinaturas, a data de subscrição e a declaração do encarregado ficam em
 * branco: são de quem assina.
 */

type Caixa = { x1: number; y1: number; x2: number; y2: number; casas?: number };

/** As posições dos campos no modelo de 2024/25, em pontos. Lidas do próprio PDF. */
const C = {
  epocaInicio: { x1: 461, y1: 795, x2: 487, y2: 808 },
  epocaFim: { x1: 488, y1: 795, x2: 514, y2: 808 },
  associacao: { x1: 391, y1: 766, x2: 499, y2: 778 },
  futebol: { x1: 427, y1: 751, x2: 438, y2: 762 },
  futsal: { x1: 487, y1: 751, x2: 499, y2: 762 },
  masculino: { x1: 427, y1: 736, x2: 438, y2: 747 },
  feminino: { x1: 487, y1: 736, x2: 499, y2: 747 },
  licenca: { x1: 424, y1: 673, x2: 522, y2: 685, casas: 8 },
  nome1: { x1: 82, y1: 609, x2: 547, y2: 621, casas: 38 },
  nome2: { x1: 82, y1: 597, x2: 547, y2: 609, casas: 38 },
  dia: { x1: 91, y1: 573, x2: 116, y2: 585, casas: 2 },
  mes: { x1: 128, y1: 573, x2: 153, y2: 585, casas: 2 },
  ano: { x1: 165, y1: 573, x2: 214, y2: 585, casas: 4 },
  docSigla: { x1: 327, y1: 573, x2: 364, y2: 585, casas: 3 },
  docNumero: { x1: 376, y1: 573, x2: 547, y2: 585, casas: 14 },
  checkDigit: { x1: 96, y1: 547, x2: 109, y2: 559 },
  paisNascimento: { x1: 169, y1: 546, x2: 274, y2: 560 },
  paisNascimentoCodigo: { x1: 277, y1: 547, x2: 314, y2: 560, casas: 3 },
  nacionalidade: { x1: 402, y1: 546, x2: 507, y2: 560 },
  nacionalidadeCodigo: { x1: 510, y1: 547, x2: 547, y2: 560, casas: 3 },
  email: { x1: 74, y1: 526, x2: 273, y2: 540 },
  telefone: { x1: 312, y1: 526, x2: 394, y2: 540 },
  estatuto: { x1: 440, y1: 526, x2: 547, y2: 540 },
  clubeCodigo: { x1: 195, y1: 261, x2: 245, y2: 274, casas: 4 },
  clubeNome: { x1: 288, y1: 261, x2: 516, y2: 275 },
} satisfies Record<string, Caixa>;

const TIPO: Record<Tipo, Caixa> = {
  FIRST: { x1: 178, y1: 677, x2: 192, y2: 691 },
  TRANSFER_NATIONAL: { x1: 353, y1: 677, x2: 367, y2: 691 },
  RENEWAL: { x1: 178, y1: 652, x2: 192, y2: 666 },
  TRANSFER_INTERNATIONAL: { x1: 353, y1: 652, x2: 367, y2: 666 },
};

const CATEGORIA: Record<Categoria, Caixa> = {
  "01": { x1: 98, y1: 459, x2: 110, y2: 471 },
  "03": { x1: 160, y1: 459, x2: 172, y2: 471 },
  "05": { x1: 221, y1: 459, x2: 233, y2: 471 },
  "07": { x1: 283, y1: 459, x2: 295, y2: 471 },
  "09": { x1: 345, y1: 459, x2: 357, y2: 471 },
  "12": { x1: 407, y1: 459, x2: 419, y2: 471 },
  "15": { x1: 468, y1: 459, x2: 480, y2: 471 },
  "17": { x1: 530, y1: 459, x2: 542, y2: 471 },
};

/* -------------------------------------------------------------------------- */

let modelo: Uint8Array | null = null;

/**
 * O PDF da federação, lido uma vez.
 *
 * Vive em `apps/api/assets/fpf/`. A API compilada corre de `dist/inscricoes/`
 * e os testes de `scripts/`: procura-se nos dois sítios.
 */
function bytesDoModelo(): Uint8Array {
  if (modelo) return modelo;
  // `__dirname` não existe quando os testes correm isto como módulo ES.
  const aqui = typeof __dirname === "string" ? __dirname : null;
  const candidatos = [
    ...(aqui ? [resolve(aqui, "..", "..", "assets", "fpf", "modelo-2-nao-profissionais.pdf")] : []),
    resolve(process.cwd(), "assets", "fpf", "modelo-2-nao-profissionais.pdf"),
    resolve(process.cwd(), "apps", "api", "assets", "fpf", "modelo-2-nao-profissionais.pdf"),
  ];
  const caminho = candidatos.find((c) => existsSync(c));
  if (!caminho) throw new Error("O modelo da FPF não está no servidor (assets/fpf)");
  modelo = new Uint8Array(readFileSync(caminho));
  return modelo;
}

/** As folhas, uma página por jogador, num PDF só. */
export async function gerarModelo2(folhas: Folha[]): Promise<Uint8Array> {
  if (folhas.length === 0) throw new Error("Nenhuma folha para gerar");

  const fonte = await PDFDocument.load(bytesDoModelo());
  // Sem os campos: ver a nota do topo.
  for (const p of fonte.getPages()) p.node.delete(PDFName.of("Annots"));
  fonte.catalog.delete(PDFName.of("AcroForm"));

  const doc = await PDFDocument.create();
  doc.setTitle(folhas.length === 1 ? `Modelo 2 — ${folhas[0].nome}` : `Modelo 2 — ${folhas.length} jogadores`);
  doc.setProducer("Academias");
  const letra = await doc.embedFont(StandardFonts.Helvetica);
  const negrito = await doc.embedFont(StandardFonts.HelveticaBold);

  const paginas = await doc.copyPages(fonte, folhas.map(() => 0));
  folhas.forEach((f, i) => {
    const page = doc.addPage(paginas[i]);
    /*
     * A lista de conteúdos também veio partilhada, e o pdf-lib junta o texto
     * novo a essa lista: sem uma lista própria por página, cada jogador
     * aparecia desenhado em todas as folhas. Os fluxos lá dentro (o desenho
     * do modelo) continuam partilhados, que é o que se quer.
     */
    const conteudos = page.node.Contents();
    if (conteudos instanceof PDFArray) page.node.set(PDFName.of("Contents"), doc.context.obj(conteudos.asArray()));
    desenhar(page, f, letra, negrito);
  });

  return doc.save();
}

function desenhar(page: PDFPage, f: Folha, letra: PDFFont, negrito: PDFFont) {
  const texto = (c: Caixa, v: string | null | undefined, max = 9) => v && escrever(page, letra, c, v, max);
  const casas = (c: Caixa, v: string | null | undefined) => v && escreverEmCasas(page, letra, c, v);
  const cruz = (c: Caixa) => marcar(page, negrito, c);

  texto(C.epocaInicio, String(f.epoca[0]));
  texto(C.epocaFim, String(f.epoca[1]));
  texto(C.associacao, f.associacao);
  cruz(f.disciplina === "futsal" ? C.futsal : C.futebol);
  if (f.genero) cruz(f.genero === "FEMALE" ? C.feminino : C.masculino);

  cruz(TIPO[f.tipo]);
  casas(C.licenca, f.licenca);

  const [l1, l2] = partirNome(maiusculas(f.nome), C.nome1.casas);
  casas(C.nome1, l1);
  casas(C.nome2, l2);

  const d = f.nascimento;
  casas(C.dia, String(d.getUTCDate()).padStart(2, "0"));
  casas(C.mes, String(d.getUTCMonth() + 1).padStart(2, "0"));
  casas(C.ano, String(d.getUTCFullYear()));

  if (f.documento) {
    casas(C.docSigla, f.documento.sigla);
    casas(C.docNumero, f.documento.numero);
    texto(C.checkDigit, f.documento.checkDigit);
  }

  if (f.paisNascimento) {
    texto(C.paisNascimento, f.paisNascimento.nome);
    casas(C.paisNascimentoCodigo, f.paisNascimento.codigo);
  }
  if (f.nacionalidade) {
    texto(C.nacionalidade, f.nacionalidade.nome);
    casas(C.nacionalidadeCodigo, f.nacionalidade.codigo);
  }
  texto(C.email, f.email);
  texto(C.telefone, f.telefone);
  texto(C.estatuto, f.estatuto);

  cruz(CATEGORIA[f.categoria]);

  // Um código maior do que as quatro casas do modelo escreve-se seguido.
  if (f.clube.codigo && f.clube.codigo.length <= (C.clubeCodigo.casas ?? 0)) casas(C.clubeCodigo, f.clube.codigo);
  else texto(C.clubeCodigo, f.clube.codigo);
  texto(C.clubeNome, f.clube.nome);
}

/* -------------------------------------------------------------------------- */
/* Desenho                                                                     */
/* -------------------------------------------------------------------------- */

/** Texto numa caixa, encolhido até caber, centrado na vertical. */
function escrever(page: PDFPage, font: PDFFont, c: Caixa, v: string, max: number) {
  const s = codificavel(font, v);
  const largura = c.x2 - c.x1 - 3;
  let size = max;
  while (size > 5 && font.widthOfTextAtSize(s, size) > largura) size -= 0.5;
  const h = c.y2 - c.y1;
  page.drawText(s, { x: c.x1 + 1.5, y: c.y1 + (h - size * 0.72) / 2, size, font });
}

/** Uma letra por casa, centrada em cada uma — os campos às casinhas do boletim. */
function escreverEmCasas(page: PDFPage, font: PDFFont, c: Caixa, v: string) {
  const n = c.casas ?? v.length;
  const s = codificavel(font, v).slice(0, n);
  const casa = (c.x2 - c.x1) / n;
  const h = c.y2 - c.y1;
  const size = Math.min(9, h * 0.75);
  [...s].forEach((ch, i) => {
    const w = font.widthOfTextAtSize(ch, size);
    page.drawText(ch, { x: c.x1 + i * casa + (casa - w) / 2, y: c.y1 + (h - size * 0.72) / 2, size, font });
  });
}

function marcar(page: PDFPage, font: PDFFont, c: Caixa) {
  const h = c.y2 - c.y1;
  const size = Math.min(10, h * 0.85);
  const w = font.widthOfTextAtSize("X", size);
  page.drawText("X", { x: c.x1 + (c.x2 - c.x1 - w) / 2, y: c.y1 + (h - size * 0.72) / 2, size, font });
}

/**
 * Só os caracteres que a letra do PDF tem.
 *
 * A Helvetica do PDF fala WinAnsi: tem os acentos portugueses, mas não um "ł"
 * ou um "ă". Esses perdem o acento em vez de rebentarem a folha inteira.
 */
function codificavel(font: PDFFont, v: string): string {
  let out = "";
  for (const ch of v) {
    try {
      font.encodeText(ch);
      out += ch;
    } catch {
      const base = SEM_TRACO[ch] ?? ch.normalize("NFD").replace(/[̀-ͯ]/g, "");
      try {
        font.encodeText(base);
        out += base;
      } catch {
        out += "?";
      }
    }
  }
  return out;
}

/** As letras com traço, que a decomposição não separa. */
const SEM_TRACO: Record<string, string> = { "ł": "l", "Ł": "L", "đ": "d", "Đ": "D", "ħ": "h", "Ħ": "H" };

const maiusculas = (s: string) => s.toLocaleUpperCase("pt-PT");

/**
 * O nome em duas linhas de casas.
 *
 * Parte-se entre palavras: "MARIA DA CONCEIÇÃO" não fica "MARIA DA CONCE" numa
 * linha e "IÇÃO" na outra. Uma palavra maior do que a linha parte-se onde for.
 */
export function partirNome(nome: string, casas = 38): [string, string] {
  if (nome.length <= casas) return [nome, ""];
  const palavras = nome.split(" ");
  let l1 = "";
  let i = 0;
  while (i < palavras.length && (l1 ? l1.length + 1 : 0) + palavras[i].length <= casas) {
    l1 = l1 ? `${l1} ${palavras[i]}` : palavras[i];
    i++;
  }
  if (!l1) return [nome.slice(0, casas), nome.slice(casas, casas * 2)];
  return [l1, palavras.slice(i).join(" ").slice(0, casas)];
}

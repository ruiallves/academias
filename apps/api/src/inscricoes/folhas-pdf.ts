import { PDFArray, PDFDocument, PDFName, StandardFonts, type PDFPage } from "pdf-lib";
import { bytesDoModelo } from "./desenho";
import { desenharModelo2 } from "./modelo-2";
import { desenharModeloFpb } from "./modelo-fpb";
import type { Federacao, Folha } from "./regras";

/**
 * As folhas, uma página por jogador, num PDF só — de futebol, de basquetebol,
 * ou das duas misturadas, pela ordem em que vêm.
 *
 * ## Escrever por cima, e não preencher o formulário
 *
 * Os PDFs das federações têm campos de formulário. Preenchê-los parecia o
 * óbvio, mas várias folhas num só PDF partilhavam os nomes dos campos, e um
 * leitor de PDF mostrava o nome do primeiro jogador em todas as páginas. Por
 * isso os campos saem e o texto desenha-se nas posições deles.
 *
 * ## Um fundo para todas as folhas
 *
 * Os modelos pesam centenas de KB, quase tudo letra e desenho. As páginas de
 * cada modelo copiam-se de uma vez (`copyPages` com o mesmo índice repetido),
 * e o que é igual em todas fica uma vez só no ficheiro: cem folhas não pesam
 * cem modelos.
 */
const MODELO: Record<Federacao, { ficheiro: string[]; desenhar: typeof desenharModelo2 }> = {
  FPF: { ficheiro: ["fpf", "modelo-2-nao-profissionais.pdf"], desenhar: desenharModelo2 },
  FPB: { ficheiro: ["fpb", "modelo-1-jogador.pdf"], desenhar: desenharModeloFpb },
};

export async function gerarFolhas(folhas: Folha[]): Promise<Uint8Array> {
  if (folhas.length === 0) throw new Error("Nenhuma folha para gerar");

  const doc = await PDFDocument.create();
  doc.setTitle(folhas.length === 1 ? `Inscrição — ${folhas[0].nome}` : `Inscrições — ${folhas.length} jogadores`);
  doc.setProducer("Academias");
  const letra = await doc.embedFont(StandardFonts.Helvetica);
  const negrito = await doc.embedFont(StandardFonts.HelveticaBold);

  // As páginas de cada federação, copiadas de uma vez por modelo.
  const paginas = new Map<Federacao, PDFPage[]>();
  for (const fed of ["FPF", "FPB"] as const) {
    const n = folhas.filter((f) => f.federacao === fed).length;
    if (n === 0) continue;
    const fonte = await PDFDocument.load(bytesDoModelo(...MODELO[fed].ficheiro));
    for (const p of fonte.getPages()) p.node.delete(PDFName.of("Annots"));
    fonte.catalog.delete(PDFName.of("AcroForm"));
    paginas.set(fed, await doc.copyPages(fonte, Array.from({ length: n }, () => 0)));
  }

  for (const f of folhas) {
    const page = doc.addPage(paginas.get(f.federacao)!.shift()!);
    /*
     * A lista de conteúdos também veio partilhada, e o pdf-lib junta o texto
     * novo a essa lista: sem uma lista própria por página, cada jogador
     * aparecia desenhado em todas as folhas. Os fluxos lá dentro (o desenho
     * do modelo) continuam partilhados, que é o que se quer.
     */
    const conteudos = page.node.Contents();
    if (conteudos instanceof PDFArray) page.node.set(PDFName.of("Contents"), doc.context.obj(conteudos.asArray()));
    MODELO[f.federacao].desenhar(page, f, letra, negrito);
  }

  return doc.save();
}

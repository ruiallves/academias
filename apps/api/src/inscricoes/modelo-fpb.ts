import type { PDFFont, PDFPage } from "pdf-lib";
import { escrever, marcar, type Caixa } from "./desenho";
import type { Folha } from "./regras";

/**
 * O Modelo 1 da FPB (inscrição de jogadores, v202405), preenchido.
 *
 * Até ao seguro desportivo, inclusive: época, associação, tipo de boletim,
 * licença, estatuto, clube, sexo, escalão, a identificação toda do jogador e
 * o seguro. As autorizações, as assinaturas e a declaração do encarregado
 * ficam em branco: são de quem assina. O "Telefone" (fixo) também, porque a
 * ficha só tem um número, e esse vai para o telemóvel.
 *
 * O PDF da FPB tem caixas de formulário sem formulário (não há AcroForm): as
 * posições abaixo são as delas, lidas do próprio ficheiro.
 */

const C = {
  primeira: { x1: 145, y1: 744, x2: 157, y2: 755 },
  revalidacao: { x1: 145, y1: 726, x2: 156, y2: 737 },
  licenca: { x1: 107, y1: 705, x2: 155, y2: 719 },
  fbp: { x1: 225, y1: 744, x2: 237, y2: 755 },
  comunitario: { x1: 225, y1: 727, x2: 237, y2: 738 },
  naoComunitario: { x1: 225, y1: 709, x2: 237, y2: 721 },
  clube: { x1: 88, y1: 679, x2: 368, y2: 692 },
  epocaInicio: { x1: 453, y1: 742, x2: 484, y2: 756 },
  epocaFim: { x1: 488, y1: 741, x2: 519, y2: 755 },
  associacao: { x1: 398, y1: 705, x2: 531, y2: 719 },
  feminino: { x1: 437, y1: 680, x2: 448, y2: 692 },
  masculino: { x1: 505, y1: 680, x2: 516, y2: 692 },
  nome: { x1: 133, y1: 588, x2: 531, y2: 602 },
  nascAno: { x1: 138, y1: 568, x2: 162, y2: 582 },
  nascMes: { x1: 167, y1: 569, x2: 182, y2: 583 },
  nascDia: { x1: 185, y1: 569, x2: 200, y2: 583 },
  nacionalidade: { x1: 277, y1: 568, x2: 368, y2: 582 },
  paisNascimento: { x1: 454, y1: 568, x2: 531, y2: 582 },
  docCc: { x1: 202, y1: 551, x2: 213, y2: 562 },
  docPassaporte: { x1: 259, y1: 551, x2: 271, y2: 562 },
  docOutro: { x1: 298, y1: 551, x2: 309, y2: 562 },
  docOutroDescricao: { x1: 333, y1: 549, x2: 531, y2: 564 },
  docNumero: { x1: 133, y1: 529, x2: 205, y2: 543 },
  validadeAno: { x1: 263, y1: 530, x2: 287, y2: 544 },
  validadeMes: { x1: 292, y1: 531, x2: 307, y2: 544 },
  validadeDia: { x1: 310, y1: 531, x2: 325, y2: 544 },
  nif: { x1: 412, y1: 529, x2: 531, y2: 543 },
  telemovel: { x1: 93, y1: 510, x2: 170, y2: 523 },
  email: { x1: 334, y1: 510, x2: 531, y2: 523 },
  distrito: { x1: 93, y1: 489, x2: 276, y2: 503 },
  concelho: { x1: 333, y1: 489, x2: 531, y2: 503 },
  morada: { x1: 93, y1: 469, x2: 276, y2: 483 },
  codigoPostal4: { x1: 333, y1: 469, x2: 357, y2: 483 },
  codigoPostal3: { x1: 358, y1: 469, x2: 376, y2: 483 },
  localidade: { x1: 426, y1: 469, x2: 531, y2: 483 },
  seguroFpb: { x1: 97, y1: 417, x2: 109, y2: 428 },
  seguroClube: { x1: 195, y1: 417, x2: 206, y2: 428 },
  apolice: { x1: 284, y1: 415, x2: 361, y2: 429 },
  companhia: { x1: 433, y1: 415, x2: 531, y2: 429 },
} satisfies Record<string, Caixa>;

const ESCALAO: Record<string, Caixa> = {
  BABY: { x1: 94, y1: 635, x2: 105, y2: 646 },
  MINI8: { x1: 139, y1: 635, x2: 150, y2: 646 },
  MINI10: { x1: 188, y1: 635, x2: 199, y2: 646 },
  MINI12: { x1: 237, y1: 635, x2: 249, y2: 646 },
  SUB14: { x1: 284, y1: 635, x2: 295, y2: 646 },
  SUB16: { x1: 330, y1: 635, x2: 341, y2: 646 },
  SUB18: { x1: 376, y1: 635, x2: 388, y2: 646 },
  SENIOR: { x1: 423, y1: 635, x2: 435, y2: 646 },
  MASTER: { x1: 473, y1: 635, x2: 485, y2: 646 },
  BCR: { x1: 512, y1: 635, x2: 523, y2: 646 },
};

/**
 * Uma data no sítio de "____/__/__", com cada parte centrada no seu traço.
 * A FPB escreve ano, mês e dia, por esta ordem.
 */
function data(page: PDFPage, font: PDFFont, d: Date, ano: Caixa, mes: Caixa, dia: Caixa) {
  const parte = (c: Caixa, v: string) => {
    const size = 9;
    const w = font.widthOfTextAtSize(v, size);
    page.drawText(v, { x: c.x1 + (c.x2 - c.x1 - w) / 2, y: c.y1 + 3.5, size, font });
  };
  parte(ano, String(d.getUTCFullYear()));
  parte(mes, String(d.getUTCMonth() + 1).padStart(2, "0"));
  parte(dia, String(d.getUTCDate()).padStart(2, "0"));
}

export function desenharModeloFpb(page: PDFPage, f: Folha, letra: PDFFont, negrito: PDFFont) {
  const texto = (c: Caixa, v: string | null | undefined, max = 9) => v && escrever(page, letra, c, v, max);
  const cruz = (c: Caixa) => marcar(page, negrito, c);

  // O tipo de boletim: a FPB só tem estes dois.
  if (f.tipo === "FIRST") cruz(C.primeira);
  if (f.tipo === "RENEWAL") cruz(C.revalidacao);
  // A licença FPB é a que o atleta já tem: só numa revalidação. Numa primeira
  // inscrição ainda não existe, e o campo fica em branco mesmo que a ficha
  // tenha um número (de outra federação ou escrito por engano).
  if (f.tipo === "RENEWAL") texto(C.licenca, f.licenca);

  if (f.estatuto === "FBP") cruz(C.fbp);
  if (f.estatuto === "COMUNITARIO") cruz(C.comunitario);
  if (f.estatuto === "NAO_COMUNITARIO") cruz(C.naoComunitario);

  texto(C.clube, f.clube.nome);
  texto(C.epocaInicio, String(f.epoca[0]));
  texto(C.epocaFim, String(f.epoca[1]));
  texto(C.associacao, f.associacao);
  if (f.genero) cruz(f.genero === "FEMALE" ? C.feminino : C.masculino);
  if (ESCALAO[f.categoria]) cruz(ESCALAO[f.categoria]);

  texto(C.nome, f.nome);
  data(page, letra, f.nascimento, C.nascAno, C.nascMes, C.nascDia);
  texto(C.nacionalidade, f.nacionalidade?.nome);
  texto(C.paisNascimento, f.paisNascimento?.nome);

  if (f.documento) {
    if (f.documento.sigla === "NIC") cruz(C.docCc);
    else if (f.documento.sigla === "PAS") cruz(C.docPassaporte);
    else {
      cruz(C.docOutro);
      texto(C.docOutroDescricao, f.documento.descricao);
    }
    texto(C.docNumero, f.documento.completo);
  }
  if (f.validadeDoc) data(page, letra, f.validadeDoc, C.validadeAno, C.validadeMes, C.validadeDia);
  texto(C.nif, f.nif);

  texto(C.telemovel, f.telefone);
  texto(C.email, f.email);
  texto(C.distrito, f.distrito);
  texto(C.concelho, f.concelho);
  texto(C.morada, f.morada);
  // "4700-123": as quatro de um lado do traço, as três do outro.
  const cp = /^(\d{4})-?(\d{3})$/.exec((f.codigoPostal ?? "").replace(/\s/g, ""));
  if (cp) {
    texto(C.codigoPostal4, cp[1]);
    texto(C.codigoPostal3, cp[2]);
  } else texto(C.codigoPostal4, f.codigoPostal, 7);
  texto(C.localidade, f.localidade);

  if (f.seguro?.tipo === "FPB") cruz(C.seguroFpb);
  if (f.seguro?.tipo === "CLUB") {
    cruz(C.seguroClube);
    texto(C.apolice, f.seguro.apolice);
    texto(C.companhia, f.seguro.companhia);
  }
}

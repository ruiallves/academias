import type { PDFFont, PDFPage } from "pdf-lib";
import { escrever, escreverEmCasas, escreverQueCaiba, maiusculas, marcar, partirNome, type Caixa } from "./desenho";
import type { Folha, Tipo } from "./regras";

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
 * Até ao clube onde se inscreve, como foi pedido. As assinaturas, a data de
 * subscrição e a declaração do encarregado ficam em branco: são de quem assina.
 *
 * As três autorizações dos dados pessoais saem com o SIM marcado (a pedido do
 * Rui, 10/10): a política de tratamento de dados, a publicação no Portal da FPF
 * e as comunicações da FPF. Quem não autorizar risca à mão ao assinar.
 */

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
  /* A declaração do representante legal, no fim da página. */
  representanteNome: { x1: 68, y1: 132, x2: 259, y2: 146 },
  representanteDoc: { x1: 480, y1: 132, x2: 517, y2: 145, casas: 3 },
  representanteFpfSim: { x1: 433, y1: 34, x2: 447, y2: 48 },
} satisfies Record<string, Caixa>;

const TIPO: Record<Tipo, Caixa> = {
  FIRST: { x1: 178, y1: 677, x2: 192, y2: 691 },
  TRANSFER_NATIONAL: { x1: 353, y1: 677, x2: 367, y2: 691 },
  RENEWAL: { x1: 178, y1: 652, x2: 192, y2: 666 },
  TRANSFER_INTERNATIONAL: { x1: 353, y1: 652, x2: 367, y2: 666 },
};

/**
 * O SIM das três autorizações, de cima para baixo: aceito a política de
 * tratamento de dados, publicação no Portal da FPF, comunicações da FPF. Cada
 * linha tem duas caixas no modelo ("Check Box 91", "93" e "95"): o SIM é a da
 * esquerda, o NÃO a da direita (x 133).
 */
const AUTORIZACOES_SIM: Caixa[] = [
  { x1: 77, y1: 385, x2: 91, y2: 399 },
  { x1: 77, y1: 367, x2: 91, y2: 381 },
  { x1: 77, y1: 349, x2: 91, y2: 363 },
];

const CATEGORIA: Record<string, Caixa> = {
  "01": { x1: 98, y1: 459, x2: 110, y2: 471 },
  "03": { x1: 160, y1: 459, x2: 172, y2: 471 },
  "05": { x1: 221, y1: 459, x2: 233, y2: 471 },
  "07": { x1: 283, y1: 459, x2: 295, y2: 471 },
  "09": { x1: 345, y1: 459, x2: 357, y2: 471 },
  "12": { x1: 407, y1: 459, x2: 419, y2: 471 },
  "15": { x1: 468, y1: 459, x2: 480, y2: 471 },
  "17": { x1: 530, y1: 459, x2: 542, y2: 471 },
};

export function desenharModelo2(page: PDFPage, f: Folha, letra: PDFFont, negrito: PDFFont) {
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

  /*
   * Os nomes dos países, e não os códigos ao lado: ficam em branco, por
   * agora, a pedido do Rui (09/10), até se confirmar que código a FPF quer
   * (o alfa-3 de `paises.ts` é uma suposição). Para os voltar a escrever:
   *   casas(C.paisNascimentoCodigo, f.paisNascimento.codigo);
   *   casas(C.nacionalidadeCodigo, f.nacionalidade.codigo);
   */
  if (f.paisNascimento) texto(C.paisNascimento, f.paisNascimento.nome);
  if (f.nacionalidade) texto(C.nacionalidade, f.nacionalidade.nome);
  texto(C.email, f.email);
  texto(C.telefone, f.telefone);
  texto(C.estatuto, f.estatuto);

  // A categoria vem vazia no futebol e no futsal (ver `folhaDe`): a caixa fica por marcar à mão.
  if (CATEGORIA[f.categoria]) cruz(CATEGORIA[f.categoria]);

  for (const sim of AUTORIZACOES_SIM) cruz(sim);

  /*
   * A declaração do representante legal, quando o jogador é menor (pedido do
   * Rui, 12/10): o nome do encarregado, "NIC" no documento, e o SIM das
   * comunicações da FPF. O número e a validade do documento ficam em branco,
   * para escrever à mão; a plataforma não tem o CC dos pais. O nome cabe
   * sempre, por comprido que seja (`escreverQueCaiba`).
   */
  if (f.representante) {
    escreverQueCaiba(page, letra, C.representanteNome, f.representante);
    casas(C.representanteDoc, "NIC");
    cruz(C.representanteFpfSim);
  }

  // Um código maior do que as quatro casas do modelo escreve-se seguido.
  if (f.clube.codigo && f.clube.codigo.length <= (C.clubeCodigo.casas ?? 0)) casas(C.clubeCodigo, f.clube.codigo);
  else texto(C.clubeCodigo, f.clube.codigo);
  texto(C.clubeNome, f.clube.nome);
}


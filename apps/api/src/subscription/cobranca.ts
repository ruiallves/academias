import { soODia, somaDias } from "./ciclo";

/**
 * As regras da cobrança da mensalidade da plataforma — puras, sem base nem
 * relógio, para se poderem provar com datas na mão (`npm run test:cobranca`).
 *
 * ## O ciclo, por palavras
 *
 * A mensalidade paga-se **no início** do período. No dia em que o período
 * começa, nasce o aviso com a referência Multibanco e sai o email. Ao fim de
 * uma semana sem pagamento, sai um lembrete; ao fim de duas, outro; ao fim de
 * três, o último. Quando o período acaba sem pagamento, o clube fica suspenso
 * até pagar, e é avisado disso uma vez.
 *
 * ## "A mensalidade de 5 de Outubro a 4 de Novembro"
 *
 * Nunca "a mensalidade de Outubro". O período começa no dia em que o clube
 * aderiu, não no dia 1, e um clube que aderiu a 20 teria dois meses do
 * calendário em cada mensalidade. Dizer as duas datas é a única forma de
 * ninguém ter de adivinhar o que está a pagar.
 */

/** Os dias, contados do início do período, em que sai cada lembrete. */
export const LEMBRETES_DIAS = [7, 14, 21] as const;

const UM_DIA = 86_400_000;

/** Quantos dias de calendário vão de `de` a `ate` (negativo se `ate` é antes). */
export const diasEntre = (de: Date, ate: Date): number =>
  Math.round((soODia(ate).getTime() - soODia(de).getTime()) / UM_DIA);

/**
 * Que lembrete sai hoje, se algum.
 *
 * Devolve o número do lembrete (1, 2 ou 3), ou `null` quando não há nada a
 * enviar: ainda não é dia, ou já saiu. Depois de uma paragem comprida do
 * servidor sai **um** lembrete, o mais recente, e não os que ficaram para trás:
 * três emails seguidos a dizer a mesma coisa é exactamente o "spam" a evitar.
 */
export function lembreteDevido(periodStart: Date, hoje: Date, enviados: number): number | null {
  const dias = diasEntre(periodStart, hoje);
  let n = 0;
  for (const d of LEMBRETES_DIAS) if (dias >= d) n += 1;
  return n > enviados ? n : null;
}

/**
 * Quantos lembretes já teriam saído se o aviso tivesse nascido no dia certo.
 *
 * Um aviso que nasce atrasado (o servidor esteve em baixo, ou o clube entrou
 * na cobrança a meio do mês) começa com este número em `remindersSent`: o
 * email de "mensalidade disponível" sai hoje, e o primeiro lembrete só daqui a
 * uma semana, em vez de os dois saírem na mesma hora.
 */
export function lembretesJaPassados(periodStart: Date, hoje: Date): number {
  const dias = diasEntre(periodStart, hoje);
  let n = 0;
  for (const d of LEMBRETES_DIAS) if (dias >= d) n += 1;
  return n;
}

/** Quantos dias, no mínimo, entre o email do aviso e a suspensão. */
export const AVISO_MINIMO_DIAS = 7;

/**
 * O período acabou sem pagamento: suspende-se no dia seguinte ao fim.
 *
 * Com uma guarda: ninguém é suspenso sem ter tido pelo menos uma semana desde
 * o email do aviso. Um aviso que nasceu atrasado, já com o período a acabar,
 * dá na mesma uma semana para pagar antes de fechar a porta. `avisadoEm` é o
 * `sentAt` do aviso; sem email enviado, não se suspende.
 */
export function deveSuspender(periodEnd: Date, hoje: Date, paidAt: Date | null, avisadoEm: Date | null): boolean {
  if (paidAt !== null || avisadoEm === null) return false;
  if (soODia(hoje) <= soODia(periodEnd)) return false;
  return diasEntre(avisadoEm, hoje) >= AVISO_MINIMO_DIAS;
}

/**
 * O identificador que vai para a euPago e volta no webhook.
 *
 * `ACADEMIAS-` à cabeça é o que distingue um pagamento **à plataforma** de um
 * pagamento a um clube (`CLUBE-…`, ver `billing/identificador.ts`): o webhook
 * é o mesmo para os dois. O slug e a data são para se ler no backoffice da
 * euPago de quem é e de que mês; o sufixo é o que deixa pedir outra referência
 * para o mesmo período (uma que expirou, por exemplo) sem chocar.
 */
export function identificadorDaMensalidade(slug: string, periodStart: Date, sufixo: string): string {
  const dia = soODia(periodStart).toISOString().slice(0, 10).replace(/-/g, "");
  return `ACADEMIAS-${slug}-${dia}-${sufixo}`;
}

export const eDaPlataforma = (identifier: string): boolean => identifier.startsWith("ACADEMIAS-");

const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

/**
 * "5 de outubro a 4 de novembro de 2026", ou "20 de dezembro de 2026 a 19 de
 * janeiro de 2027" quando o período muda de ano. É a frase da mensalidade em
 * todo o lado: emails, consola, painel.
 */
export function periodoPorExtenso(periodStart: Date, periodEnd: Date): string {
  const a = soODia(periodStart);
  const b = soODia(periodEnd);
  const inicio = `${a.getUTCDate()} de ${MESES[a.getUTCMonth()]}`;
  const fim = `${b.getUTCDate()} de ${MESES[b.getUTCMonth()]} de ${b.getUTCFullYear()}`;
  return a.getUTCFullYear() === b.getUTCFullYear() ? `${inicio} a ${fim}` : `${inicio} de ${a.getUTCFullYear()} a ${fim}`;
}

/**
 * O estado da mensalidade da plataforma de um clube, para a lista do painel.
 *
 * - `sem-plano`: não paga (avaliação, por decidir, cancelado);
 * - `em-dia`: a mensalidade do período a correr está paga, ou ainda não nasceu;
 * - `em-falta`: há uma por pagar, com os dias desde o início do período;
 * - `suspenso`: o clube está fechado por falta de pagamento.
 *
 * `ultimaPaga` é a última mensalidade recebida, com o período por extenso, e
 * responde à outra pergunta da lista: "quando foi a última vez que pagou?".
 */
export function mensalidadeNaLista(
  avisos: { periodStart: Date; periodEnd: Date; paidAt: Date | null; paidMethod: string | null; invoiceSentAt?: Date | null }[],
  subStatus: string | null,
  suspendedAt: Date | null,
  hoje: Date,
): {
  estado: "sem-plano" | "em-dia" | "em-falta" | "suspenso";
  atual: { periodStart: Date; periodEnd: Date; periodo: string; paidAt: Date | null } | null;
  emFaltaDias: number;
  ultimaPaga: { periodStart: Date; periodEnd: Date; periodo: string; paidAt: Date; metodo: string | null } | null;
  /** Mensalidades pagas sem fatura tratada (nem anexada, nem marcada como enviada). */
  faturasEmFalta: number;
} {
  const faturasEmFalta = avisos.filter((a) => a.paidAt !== null && !a.invoiceSentAt).length;
  const resumo = (a: { periodStart: Date; periodEnd: Date; paidAt: Date | null }) => ({
    periodStart: a.periodStart, periodEnd: a.periodEnd, periodo: periodoPorExtenso(a.periodStart, a.periodEnd), paidAt: a.paidAt,
  });
  const pagas = avisos.filter((a) => a.paidAt !== null);
  const ultima = pagas.length > 0 ? pagas.reduce((m, a) => (a.periodStart > m.periodStart ? a : m)) : null;
  const ultimaPaga = ultima ? { ...resumo(ultima), paidAt: ultima.paidAt!, metodo: ultima.paidMethod } : null;

  // A mais antiga por pagar manda: é ela que conta os dias e que suspende.
  const porPagar = avisos
    .filter((a) => a.paidAt === null && soODia(a.periodStart) <= soODia(hoje))
    .sort((a, b) => a.periodStart.getTime() - b.periodStart.getTime())[0] ?? null;

  if (suspendedAt) {
    return { estado: "suspenso", atual: porPagar ? resumo(porPagar) : null, emFaltaDias: porPagar ? diasEntre(porPagar.periodStart, hoje) : 0, ultimaPaga, faturasEmFalta };
  }
  if (subStatus !== "ACTIVE") return { estado: "sem-plano", atual: null, emFaltaDias: 0, ultimaPaga, faturasEmFalta };
  if (porPagar) return { estado: "em-falta", atual: resumo(porPagar), emFaltaDias: diasEntre(porPagar.periodStart, hoje), ultimaPaga, faturasEmFalta };

  const aCorrer = avisos.find((a) => soODia(a.periodStart) <= soODia(hoje) && soODia(a.periodEnd) >= soODia(hoje)) ?? null;
  return { estado: "em-dia", atual: aCorrer ? resumo(aCorrer) : null, emFaltaDias: 0, ultimaPaga, faturasEmFalta };
}

/** O último dia para pagar sem suspensão: o fim do período. */
export const limiteDePagamento = (periodEnd: Date): Date => soODia(periodEnd);

/** O dia em que o clube fica suspenso se não pagar: o seguinte ao fim do período. */
export const diaDaSuspensao = (periodEnd: Date): Date => somaDias(soODia(periodEnd), 1);

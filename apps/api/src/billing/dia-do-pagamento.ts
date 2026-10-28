import { instanteNoFuso, partesNoFuso } from "../common/fuso";

/**
 * O dia em que uma mensalidade foi paga, quando é a direção a marcá-la à mão.
 *
 * ## Porque é que deixou de ser sempre hoje
 *
 * Marcar como paga gravava o dia do clique. A mensalidade de julho que a
 * família pagou em julho, e que só foi registada em outubro, entrava no saldo
 * de outubro e aparecia nos movimentos de outubro. O Rui pediu (28/10/2026)
 * que a data se possa escolher, e que por omissão caia no mês da mensalidade.
 *
 * Vive aqui, sem base de dados, para se poder provar sozinho
 * (`npm run test:dia-do-pagamento`).
 */

/** "2026-10-28" de um instante, na hora do clube. */
export function diaNoClube(instante: Date): string {
  const p = partesNoFuso(instante);
  return `${p.ano}-${String(p.mes).padStart(2, "0")}-${String(p.dia).padStart(2, "0")}`;
}

/**
 * O instante a gravar para um dia escolhido (`AAAA-MM-DD`).
 *
 * Hoje (ou nada) grava agora, com a hora, para a lista de movimentos continuar
 * a ordenar bem os pagamentos do dia. Um dia passado grava o meio-dia desse dia
 * na hora do clube: longe da meia-noite, nenhum fuso o empurra para o dia ao
 * lado. Um dia no futuro recusa-se, porque ainda não aconteceu.
 */
export function instanteDoPagamento(dia: string | undefined | null, agora = new Date()): Date {
  if (!dia) return agora;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dia);
  if (!m) throw new Error("A data do pagamento não é válida");
  const [ano, mes, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const real = new Date(Date.UTC(ano, mes - 1, d));
  if (real.getUTCFullYear() !== ano || real.getUTCMonth() !== mes - 1 || real.getUTCDate() !== d) {
    throw new Error("A data do pagamento não é válida");
  }
  if (ano < 2000) throw new Error("A data do pagamento não é válida");
  const hoje = diaNoClube(agora);
  if (dia > hoje) throw new Error("A data do pagamento não pode ser depois de hoje");
  if (dia === hoje) return agora;
  return instanteNoFuso(ano, mes, d, 12, 0);
}

/**
 * O dia por omissão de uma mensalidade paga à mão: dentro do mês dela.
 *
 * - mês que já passou: o dia de vencimento, que é quando devia ter sido paga
 *   (se o vencimento cair fora do mês, o último dia do mês);
 * - mês corrente ou futuro: hoje. O dia de hoje já é desse mês, ou é um
 *   pagamento adiantado, e um pagamento não pode ter data no futuro.
 */
export function diaPorOmissao(period: string, dueDate: Date | null, agora = new Date()): string {
  const hoje = diaNoClube(agora);
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  if (!m || period >= hoje.slice(0, 7)) return hoje;
  // `@db.Date`: meia-noite UTC do dia, e é esse dia que conta.
  const venc = dueDate ? dueDate.toISOString().slice(0, 10) : null;
  if (venc && venc.slice(0, 7) === period) return venc;
  const ultimo = new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)).getUTCDate();
  return `${period}-${String(ultimo).padStart(2, "0")}`;
}

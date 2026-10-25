/**
 * As vendas do site do clube: a bilheteira paga e a loja.
 *
 * Um clube só cobra uma venda no site com duas coisas ligadas:
 *
 * - **os pagamentos** (`Academy.paymentsEnabled`), que já exigem o canal
 *   euPago do clube (o dinheiro vai para a conta dele);
 * - **a faturação** (`Academy.invoicingConfirmedAt`), marcada no painel da
 *   plataforma depois de confirmar com o clube que o programa certificado
 *   dele está pronto: quem fatura a venda é o clube.
 *
 * Sem as duas, a bilheteira só vende bilhetes a 0 € (que não se faturam) e a
 * loja fica em catálogo. Decisão do Rui a 25/10/2026.
 */

export type ClubeQueVende = { paymentsEnabled: boolean; invoicingConfirmedAt: Date | null };

/** O que ler do clube para saber se vende. */
export const SELECT_VENDAS = { paymentsEnabled: true, invoicingConfirmedAt: true } as const;

/** O clube pode cobrar uma venda no site? */
export function vendeOnline(a: ClubeQueVende | null | undefined): boolean {
  return !!a && a.paymentsEnabled && a.invoicingConfirmedAt !== null;
}

/** A faturação do clube está marcada? */
export function faturacaoLigada(a: { invoicingConfirmedAt: Date | null } | null | undefined): boolean {
  return !!a && a.invoicingConfirmedAt !== null;
}

/**
 * Os preços que se vendem: todos, num clube que cobra; só os de 0 €, num que
 * não cobra. Serve aos tipos de bilhete da API (`precoCents`).
 */
export function tiposQueSeVendem<T extends { precoCents: number }>(tipos: T[], cobra: boolean): T[] {
  return cobra ? tipos : tipos.filter((t) => t.precoCents === 0);
}

/** O porquê, dito à direção, quando abre uma venda paga sem poder cobrar. */
export function motivoParaNaoVender(a: ClubeQueVende | null | undefined): string | null {
  if (!a?.paymentsEnabled) return "Para vender no site, os pagamentos do clube têm de estar ligados (euPago).";
  if (a.invoicingConfirmedAt === null) return "Para vender no site, o clube precisa de ter a faturação configurada. Fala connosco para a ligar.";
  return null;
}

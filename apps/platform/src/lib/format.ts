/** Formatação. Um sítio só, para os números falarem todos a mesma língua. */

const EUR = new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const EUR_EXACT = new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" });

export const euros = (cents: number) => EUR.format(cents / 100);
export const eurosExact = (cents: number) => EUR_EXACT.format(cents / 100);

export function shortDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("pt-PT", { day: "numeric", month: "short", year: "numeric" });
}

/**
 * "há 3 dias", "hoje".
 *
 * Em dias e não em datas porque a pergunta é sempre "há quanto tempo" — uma data
 * obriga quem lê a fazer a subtracção de cabeça.
 */
export function since(iso: string | null): string {
  if (!iso) return "nunca";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "hoje";
  if (days === 1) return "ontem";
  if (days < 30) return `há ${days} dias`;
  const months = Math.floor(days / 30);
  return months === 1 ? "há 1 mês" : `há ${months} meses`;
}

export function monthLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-PT", { month: "short" }).replace(".", "");
}

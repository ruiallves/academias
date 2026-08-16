/** Formatação PT-PT. Um sítio só, para que os números leiam igual em toda a app. */

const EUR = new Intl.NumberFormat("pt-PT", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
});

const EUR_ROUND = new Intl.NumberFormat("pt-PT", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});

/** `compact` para métricas grandes: €4.280 em vez de €4.280,00 rouba menos atenção. */
export function money(cents: number, opts?: { compact?: boolean }): string {
  const value = cents / 100;
  return opts?.compact && Number.isInteger(value) ? EUR_ROUND.format(value) : EUR.format(value);
}

export function percent(value: number, digits = 0): string {
  return new Intl.NumberFormat("pt-PT", {
    style: "percent",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

export function number(value: number): string {
  return new Intl.NumberFormat("pt-PT").format(value);
}

const DAY_SHORT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const DAY_LETTER = ["D", "S", "T", "Q", "Q", "S", "S"];
const MONTH = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

export const dayShort = (d: Date) => DAY_SHORT[d.getDay()];
export const dayLetter = (d: Date) => DAY_LETTER[d.getDay()];
export const monthName = (d: Date) => MONTH[d.getMonth()];

/** `12 out` — a forma curta que cabe numa célula de tabela. */
export function shortDate(d: Date): string {
  return `${d.getDate()} ${MONTH[d.getMonth()].slice(0, 3)}`;
}

/** `12 de outubro` — para títulos, onde há espaço. */
export function longDate(d: Date): string {
  return `${d.getDate()} de ${MONTH[d.getMonth()]}`;
}

/** "2026-08" → "Agosto de 2026". Para onde um período precisa de se explicar sozinho. */
export function periodLabel(period: string): string {
  const [y, m] = period.split("-").map(Number);
  const name = MONTH[m - 1];
  return `${name[0].toUpperCase()}${name.slice(1)} de ${y}`;
}

export function time(d: Date): string {
  return new Intl.DateTimeFormat("pt-PT", { hour: "2-digit", minute: "2-digit" }).format(d);
}

/**
 * Distância em dias, em linguagem de gente. Datas de vencimento leem-se muito melhor
 * como "há 4 dias" do que como "08/10" — o utilizador não tem de calcular.
 */
export function relativeDays(d: Date, from = new Date()): string {
  const a = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const b = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const days = Math.round((a.getTime() - b.getTime()) / 86_400_000);

  if (days === 0) return "hoje";
  if (days === 1) return "amanhã";
  if (days === -1) return "ontem";
  if (days > 0) return `em ${days} dias`;
  return `há ${Math.abs(days)} dias`;
}

export function greeting(d = new Date()): string {
  const h = d.getHours();
  if (h < 13) return "Bom dia";
  if (h < 20) return "Boa tarde";
  return "Boa noite";
}

/** Iniciais para monograma. Primeiro + último nome — "João Pedro Silva" → "JS". */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** "João Pedro Silva Costa" → "João Costa". Tabelas não têm largura para tudo. */
export function shortName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return parts.length <= 2 ? name : `${parts[0]} ${parts[parts.length - 1]}`;
}

export function age(birthdate: Date, from = new Date()): number {
  let years = from.getFullYear() - birthdate.getFullYear();
  const m = from.getMonth() - birthdate.getMonth();
  if (m < 0 || (m === 0 && from.getDate() < birthdate.getDate())) years--;
  return years;
}

import type { ReactNode } from "react";

export const cx = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(" ");

const EUR = new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR", minimumFractionDigits: 2 });
export const money = (cents: number) => EUR.format(cents / 100);

const DAY = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
const DAY_SHORT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const MONTH = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

export const dayName = (d: Date) => DAY[d.getDay()];
export const dayShort = (d: Date) => DAY_SHORT[d.getDay()];
export const time = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
export const dateShort = (d: Date) => `${d.getDate()} ${MONTH[d.getMonth()]}`;

/**
 * O pai não quer calcular datas. "amanhã" e "há 3 dias" leem-se sem esforço;
 * "17/08" obriga a olhar para o calendário do telemóvel.
 */
export function whenLabel(d: Date, from: Date): string {
  const a = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const b = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const days = Math.round((a.getTime() - b.getTime()) / 86_400_000);
  if (days === 0) return "hoje";
  if (days === 1) return "amanhã";
  if (days === -1) return "ontem";
  if (days > 1 && days < 7) return dayName(d);
  if (days < 0) return `há ${Math.abs(days)} dias`;
  return dateShort(d);
}

export function greeting(d: Date): string {
  const h = d.getHours();
  if (h < 13) return "Bom dia";
  if (h < 20) return "Boa tarde";
  return "Boa noite";
}

export function initials(name: string): string {
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0] ?? "") + (p.at(-1)?.[0] ?? "")).toUpperCase();
}

/* -------------------------------------------------------------------------- */

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={cx("card", className)}>{children}</section>;
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-2.5 flex items-baseline justify-between gap-3 px-1">
      <h2 className="text-[15px] font-semibold text-ink">{children}</h2>
      {action}
    </div>
  );
}

type Tone = "ok" | "warn" | "risk" | "neutral" | "signal";

const TONE: Record<Tone, string> = {
  ok: "bg-ok-soft text-ok",
  warn: "bg-warn-soft text-warn",
  risk: "bg-risk-soft text-risk",
  neutral: "bg-sunken text-ink-2",
  signal: "bg-signal-soft text-signal-ink",
};

export function Tag({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={cx("inline-flex items-center rounded-full px-2 py-0.5 text-[12px] font-semibold", TONE[tone])}>
      {children}
    </span>
  );
}

export function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-sunken font-semibold text-ink-2"
      style={{ width: size, height: size, fontSize: size * 0.34 }}
    >
      {initials(name)}
    </span>
  );
}

export function Bar({ value, tone = "signal" }: { value: number; tone?: Tone }) {
  const fill = { ok: "bg-ok", warn: "bg-warn", risk: "bg-risk", neutral: "bg-ink-3", signal: "bg-signal" }[tone];
  return (
    <span className="flex h-2 w-full overflow-hidden rounded-full bg-sunken">
      <span className={cx("h-full rounded-full", fill)} style={{ width: `${Math.round(value * 100)}%` }} />
    </span>
  );
}

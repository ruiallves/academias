import type { ReactNode } from "react";

export const cx = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(" ");

/* -------------------------------------------------------------------------- */
/* Formatação                                                                  */
/* -------------------------------------------------------------------------- */

const EUR = new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR", minimumFractionDigits: 2 });
export const money = (cents: number) => EUR.format(cents / 100);

const DAY = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
const DAY_SHORT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const MONTH = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

export const dayName = (d: Date) => DAY[d.getDay()];
export const dayShort = (d: Date) => DAY_SHORT[d.getDay()];
export const monthShort = (d: Date) => MONTH[d.getMonth()];
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
/* Primitivos                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * O grande número, herói da sua linha. `€` e os cêntimos ficam mais discretos
 * do que os inteiros — é assim que o olho lê "quarenta euros" e não "quatro zero".
 */
export function Money({ cents, size = "lg", on }: { cents: number; size?: "md" | "lg" | "xl"; on?: boolean }) {
  const [whole, dec] = money(cents).replace("€", "").trim().split(",");
  const px = size === "xl" ? "text-[44px]" : size === "lg" ? "text-[34px]" : "text-[26px]";
  return (
    <span className={cx("num inline-flex items-baseline font-semibold leading-none", px, on ? "text-signal-on" : "text-ink")}>
      <span className={cx("mr-0.5 font-semibold", size === "xl" ? "text-[24px]" : "text-[18px]", on ? "text-signal-on/70" : "text-ink-3")}>€</span>
      {whole}
      <span className={cx(size === "xl" ? "text-[24px]" : "text-[18px]", on ? "text-signal-on/70" : "text-ink-3")}>,{dec}</span>
    </span>
  );
}

/**
 * Avatar com fotografia quando existe, monograma quando não. O anel opcional dá
 * um toque de identidade sem pintar o círculo inteiro.
 */
export function Avatar({
  name,
  photoUrl,
  size = 40,
  ring,
}: {
  name: string;
  photoUrl?: string;
  size?: number;
  ring?: boolean;
}) {
  const common = "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full";
  const style = { width: size, height: size } as const;
  const box = ring ? { ...style, boxShadow: "0 0 0 2px var(--color-canvas), 0 0 0 3.5px color-mix(in oklab, var(--color-signal) 55%, transparent)" } : style;

  if (photoUrl) {
    return <img src={photoUrl} alt="" aria-hidden className={cx(common, "object-cover")} style={box} />;
  }
  return (
    <span aria-hidden className={cx(common, "bg-sunken font-semibold text-ink-2")} style={{ ...box, fontSize: size * 0.36 }}>
      {initials(name)}
    </span>
  );
}

type Tone = "ok" | "warn" | "risk" | "neutral" | "signal";

const CHIP: Record<Tone, string> = {
  ok: "bg-ok-soft text-ok",
  warn: "bg-warn-soft text-warn",
  risk: "bg-risk-soft text-risk",
  neutral: "bg-sunken text-ink-2",
  signal: "bg-signal-soft text-signal-ink",
};

export function Chip({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cx("chip", CHIP[tone], className)}>{children}</span>;
}

/** Barra fina e arredondada. O preenchimento anima até ao valor. */
export function Bar({ value, tone = "signal" }: { value: number; tone?: Tone }) {
  const fill = { ok: "bg-ok", warn: "bg-warn", risk: "bg-risk", neutral: "bg-ink-3", signal: "bg-signal" }[tone];
  return (
    <span className="flex h-2.5 w-full overflow-hidden rounded-full bg-sunken">
      <span
        className={cx("h-full rounded-full transition-[width] duration-700 ease-[cubic-bezier(0.22,1,0.36,1)]", fill)}
        style={{ width: `${Math.max(0, Math.min(100, Math.round(value * 100)))}%` }}
      />
    </span>
  );
}

/** Título de secção — discreto, em maiúsculas de etiqueta, com uma acção opcional à direita. */
export function Label({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3 px-1">
      <h2 className="text-[13px] font-semibold tracking-[0.04em] text-ink-3 uppercase">{children}</h2>
      {action}
    </div>
  );
}

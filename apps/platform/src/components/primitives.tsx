import type { ReactNode } from "react";

export const cx = (...xs: (string | false | undefined | null)[]) => xs.filter(Boolean).join(" ");

export function Panel({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={cx("panel", className)}>{children}</section>;
}

export function PanelHead({ title, hint, children }: { title: string; hint?: string; children?: ReactNode }) {
  return (
    <header className="panel-head">
      <div className="flex min-w-0 items-baseline gap-2.5">
        <h2 className="text-panel text-ink">{title}</h2>
        {hint && <span className="truncate text-meta text-ink-3">{hint}</span>}
      </div>
      {children && <div className="flex shrink-0 items-center gap-1.5">{children}</div>}
    </header>
  );
}

type Tone = "neutral" | "ok" | "warn" | "risk" | "signal";

const TONE: Record<Tone, string> = {
  neutral: "bg-sunken text-ink-2",
  ok: "bg-[#e6f2e9] text-[#1f7a45]",
  warn: "bg-[#fdf1dd] text-[#8a5a12]",
  risk: "bg-[#fae9e7] text-[#a82a20]",
  signal: "bg-signal-soft text-signal-ink",
};

export function Pill({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={cx("inline-flex items-center justify-center rounded-full px-2 py-0.5 text-center text-[11px] leading-tight font-semibold", TONE[tone])}>
      {children}
    </span>
  );
}

/**
 * Um número grande com contexto.
 *
 * `note` não é opcional por acaso: um número sozinho não diz nada. "69 €" pode ser
 * bom ou catastrófico; "69 € · +2 este mês" já se lê.
 */
export function Metric({
  label,
  value,
  note,
  trend,
}: {
  label: string;
  value: string;
  note?: string;
  trend?: { value: number; good?: "up" | "down" };
}) {
  const good = trend ? (trend.good === "down" ? trend.value <= 0 : trend.value >= 0) : true;
  return (
    <div className="min-w-0 flex-1 border-r border-line px-5 py-4 last:border-r-0">
      <div className="text-meta text-ink-3">{label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-[26px] leading-none font-semibold text-ink tabular">{value}</span>
        {trend && trend.value !== 0 && (
          <span className={cx("text-meta font-medium tabular", good ? "text-[#1f7a45]" : "text-[#a82a20]")}>
            {trend.value > 0 ? "+" : ""}
            {trend.value}
          </span>
        )}
      </div>
      {note && <div className="mt-1 truncate text-meta text-ink-4">{note}</div>}
    </div>
  );
}

export function MetricRow({ children }: { children: ReactNode }) {
  return <div className="panel flex flex-wrap">{children}</div>;
}

export function Empty({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="px-5 py-14 text-center">
      <p className="text-body font-medium text-ink">{title}</p>
      {detail && <p className="mt-1 text-meta text-ink-3">{detail}</p>}
    </div>
  );
}

/** Barra de progresso fina — para o onboarding, onde a percentagem já está escrita. */
export function Progress({ percent }: { percent: number }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-sunken">
      <div
        className="h-full rounded-full transition-[width] duration-300"
        style={{ width: `${percent}%`, background: percent === 100 ? "#1f7a45" : "var(--color-signal)" }}
      />
    </div>
  );
}

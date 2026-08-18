import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, ChevronDown, TrendingDown, TrendingUp, type LucideIcon } from "@/lib/icons";
import { initials } from "@/lib/format";

export const cx = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(" ");

/* -------------------------------------------------------------------------- */
/* Painel                                                                      */
/* -------------------------------------------------------------------------- */

export function Panel({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={cx("panel", className)}>{children}</section>;
}

/**
 * Cabeçalho de painel. Título à esquerda, controlos à direita — a mesma métrica em
 * todos os painéis. É esta repetição que faz a página ler como uma coisa só.
 */
export function PanelHead({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children?: ReactNode;
}) {
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

/** Ligação discreta de rodapé de painel — "Ver todos →". */
export function PanelLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="group flex items-center justify-center gap-1.5 border-t border-line px-5 py-2.5 text-meta font-medium text-ink-2 transition-colors duration-[120ms] hover:bg-sunken hover:text-ink"
    >
      {children}
      <ArrowRight className="size-3.5 transition-transform duration-[120ms] group-hover:translate-x-0.5" strokeWidth={1.75} />
    </Link>
  );
}

/* -------------------------------------------------------------------------- */
/* Métrica                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Um número sem comparação não informa. `delta` é obrigatório em espírito: se não
 * houver um termo de comparação honesto, usa-se `note` para dar contexto de outra
 * forma — nunca se inventa uma percentagem para encher o cartão.
 */
export function Metric({
  label,
  value,
  unit,
  delta,
  note,
  icon: Icon,
  /** Um delta negativo nem sempre é mau (ex.: valor em dívida a descer). */
  goodWhenDown,
}: {
  label: string;
  value: string;
  unit?: string;
  delta?: number;
  note?: string;
  icon?: LucideIcon;
  goodWhenDown?: boolean;
}) {
  const up = (delta ?? 0) >= 0;
  const good = goodWhenDown ? !up : up;
  const Trend = up ? TrendingUp : TrendingDown;

  return (
    <div className="panel flex flex-col justify-between gap-4 p-4">
      <div className="flex items-center gap-1.5 text-meta text-ink-3">
        {Icon && <Icon className="size-3.5" strokeWidth={1.75} />}
        <span>{label}</span>
      </div>

      <div>
        <div className="flex items-baseline gap-1">
          <span className="text-metric text-ink tabular">{value}</span>
          {unit && <span className="text-meta font-medium text-ink-3">{unit}</span>}
        </div>

        <div className="mt-1.5 flex items-center gap-1.5">
          {delta !== undefined && (
            <span
              className={cx(
                "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular",
                good ? "bg-ok-soft text-ok" : "bg-risk-soft text-risk",
              )}
            >
              <Trend className="size-3" strokeWidth={2} />
              {Math.abs(delta).toLocaleString("pt-PT", { maximumFractionDigits: 1 })}%
            </span>
          )}
          {note && <span className="text-meta text-ink-3">{note}</span>}
        </div>
      </div>
    </div>
  );
}

export function MetricRow({ children }: { children: ReactNode }) {
  return <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{children}</div>;
}

/* -------------------------------------------------------------------------- */
/* Estado                                                                      */
/* -------------------------------------------------------------------------- */

export type Tone = "ok" | "warn" | "risk" | "neutral" | "signal";

const TONE: Record<Tone, string> = {
  ok: "bg-ok-soft text-ok",
  warn: "bg-warn-soft text-warn",
  risk: "bg-risk-soft text-risk",
  neutral: "bg-sunken text-ink-2",
  signal: "bg-signal-soft text-signal-ink",
};

/**
 * Etiqueta de estado ou categoria.
 *
 * `text-center` e `justify-center` não são decoração: numa coluna estreita —
 * "Departamento clínico", "Secretaria e operações" — o texto passa a duas linhas,
 * e sem eles a segunda linha encostava à esquerda dentro de uma forma arredondada.
 * Lia-se como um erro de layout, não como uma etiqueta.
 *
 * `leading-tight` fecha o espaço entre as duas linhas, senão a etiqueta cresce até
 * desalinhar a altura da linha da tabela.
 */
export function Pill({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={cx(
        "inline-flex items-center justify-center rounded-full px-2 py-0.5 text-center text-[11px] leading-tight font-semibold",
        TONE[tone],
      )}
    >
      {children}
    </span>
  );
}

/** Ponto de estado — mais leve que um pill quando a linha já tem texto suficiente. */
export function Dot({ tone = "neutral" }: { tone?: Tone }) {
  const color = { ok: "bg-ok", warn: "bg-warn", risk: "bg-risk", neutral: "bg-ink-4", signal: "bg-signal" }[tone];
  return <span className={cx("inline-block size-1.5 shrink-0 rounded-full", color)} />;
}

/* -------------------------------------------------------------------------- */
/* Monograma                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * As academias não têm fotografia de toda a gente, e um avatar por omissão cinzento
 * é pior que iniciais. `self` marca o próprio utilizador com a cor do tenant.
 */
export function Monogram({
  name,
  size = "md",
  self,
}: {
  name: string;
  size?: "sm" | "md" | "lg";
  self?: boolean;
}) {
  const dim = { sm: "size-6 text-[10px]", md: "size-7 text-[11px]", lg: "size-9 text-body" }[size];
  return (
    <span
      className={cx(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold select-none",
        dim,
        self ? "bg-signal-soft text-signal-ink" : "bg-sunken text-ink-2",
      )}
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Tabela                                                                      */
/* -------------------------------------------------------------------------- */

export type Column<T> = {
  key: string;
  header: string;
  /** Numéricos alinham à direita. Sempre. */
  align?: "left" | "right";
  width?: string;
  /** Colunas secundárias desaparecem antes das primárias em ecrãs estreitos. */
  hideBelow?: "sm" | "md" | "lg";
  render: (row: T) => ReactNode;
};

export function DataTable<T>({
  columns,
  rows,
  keyOf,
  to,
  empty,
}: {
  columns: Column<T>[];
  rows: T[];
  keyOf: (row: T) => string;
  to?: (row: T) => string;
  empty?: ReactNode;
}) {
  const navigate = useNavigate();
  const hide = { sm: "hidden sm:table-cell", md: "hidden md:table-cell", lg: "hidden lg:table-cell" };

  if (rows.length === 0) return <div className="px-5 py-14">{empty ?? <Empty title="Sem resultados" />}</div>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-body">
        <thead>
          <tr className="border-b border-line bg-sunken/60">
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                style={c.width ? { width: c.width } : undefined}
                className={cx(
                  "px-5 py-2 text-meta font-medium text-ink-3 whitespace-nowrap",
                  c.align === "right" ? "text-right" : "text-left",
                  c.hideBelow && hide[c.hideBelow],
                )}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const href = to?.(row);
            return (
              <tr
                key={keyOf(row)}
                className={cx(
                  "border-b border-line last:border-0 transition-colors duration-[120ms]",
                  href && "cursor-pointer hover:bg-sunken/50",
                )}
                onClick={href ? () => navigate(href) : undefined}
              >
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={cx(
                      "h-[52px] px-5 align-middle",
                      c.align === "right" ? "text-right" : "text-left",
                      c.hideBelow && hide[c.hideBelow],
                    )}
                  >
                    {c.render(row)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Estado vazio                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Um vazio é uma mensagem, não um buraco. Quando o vazio é boa notícia — nada por
 * cobrar, nada por registar — diz-se isso com `tone="ok"`.
 */
export function Empty({
  title,
  detail,
  icon: Icon,
  tone = "neutral",
  children,
}: {
  title: string;
  detail?: string;
  icon?: LucideIcon;
  tone?: "neutral" | "ok";
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 text-center">
      {Icon && (
        <span
          className={cx(
            "mb-2 inline-flex size-9 items-center justify-center rounded-full",
            tone === "ok" ? "bg-ok-soft text-ok" : "bg-sunken text-ink-3",
          )}
        >
          <Icon className="size-4.5" strokeWidth={1.75} />
        </span>
      )}
      <p className="text-body font-medium text-ink">{title}</p>
      {detail && <p className="max-w-xs text-meta text-ink-3">{detail}</p>}
      {children && <div className="mt-3">{children}</div>}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Barra de meia-largura                                                       */
/* -------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- */
/* Select                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * O `<select>` do sistema, com a nossa moldura.
 *
 * Continua a ser um `<select>` nativo — o menu que abre é o do sistema
 * operativo, que num telemóvel é uma roda e num portátil é uma lista, e
 * reimplementá-lo em React só traria uma acessibilidade pior de graça. O que
 * mudamos é a caixa: `appearance-none` tira a seta feia do browser (que não
 * respeita nem a nossa cor nem o nosso espaçamento) e pomos a nossa por cima,
 * com a mesma altura e o mesmo raio dos outros controlos.
 */
export function SelectField<T extends string>({
  value,
  onChange,
  options,
  size = "md",
  className,
  "aria-label": ariaLabel,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  size?: "sm" | "md";
  className?: string;
  "aria-label"?: string;
}) {
  const box =
    size === "sm"
      ? "h-8 pl-2.5 pr-7 text-meta"
      : "h-9 pl-2.5 pr-8 text-body";

  return (
    <span className={cx("relative inline-flex min-w-0", className)}>
      <select
        aria-label={ariaLabel}
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className={cx(
          "w-full min-w-0 cursor-pointer appearance-none truncate rounded-[var(--radius-control)]",
          "border border-line bg-surface font-medium text-ink-2",
          "transition-colors duration-[120ms] hover:border-line-strong hover:text-ink",
          "focus:border-line-strong focus:text-ink focus:outline-none",
          box,
        )}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown
        className={cx(
          "pointer-events-none absolute top-1/2 -translate-y-1/2 text-ink-4",
          size === "sm" ? "right-2 size-3.5" : "right-2.5 size-4",
        )}
        strokeWidth={1.75}
      />
    </span>
  );
}

/**
 * Marca de disponibilidade clínica.
 *
 * Aparece sempre que um atleta é nomeado — ficha, lista, plantel, convocatória —
 * e é sempre derivada do boletim (`lib/clinical.ts`), nunca de um campo guardado
 * à parte. Só mostra o **estado**, nunca o diagnóstico: para isso é preciso
 * `clinical:read`, e é uma decisão de privacidade, não de layout.
 */
export function AvailabilityTag({
  availability,
  detail,
  size = "md",
}: {
  availability: "available" | "limited" | "out";
  /** Ex.: "até 12 nov". Só quando quem vê tem permissão para saber. */
  detail?: string;
  size?: "sm" | "md";
}) {
  if (availability === "available") return null;

  const isOut = availability === "out";
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full font-semibold",
        size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-meta",
        isOut ? "bg-risk-soft text-risk" : "bg-warn-soft text-warn",
      )}
    >
      <span className={cx("size-1.5 shrink-0 rounded-full", isOut ? "bg-risk" : "bg-warn")} />
      {isOut ? "De baixa" : "Condicionado"}
      {detail && <span className="font-normal opacity-80">· {detail}</span>}
    </span>
  );
}

/** Barra proporcional para composições dentro de tabelas e listas. */
export function Bar({ value, tone = "signal" }: { value: number; tone?: Tone }) {
  const fill = { ok: "bg-ok", warn: "bg-warn", risk: "bg-risk", neutral: "bg-ink-3", signal: "bg-signal" }[tone];
  return (
    <span className="inline-flex h-1.5 w-full overflow-hidden rounded-full bg-sunken">
      <span className={cx("h-full rounded-full transition-[width] duration-300", fill)} style={{ width: `${Math.round(value * 100)}%` }} />
    </span>
  );
}

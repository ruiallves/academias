import type { ReactNode } from "react";
import { Search, type LucideIcon } from "@/lib/icons";
import { cx, SelectField } from "./primitives";

/**
 * Barra de filtros de tabela.
 *
 * Vive dentro do painel, colada ao cabeçalho da tabela, com uma hairline a separar —
 * como nas referências. Fora do painel flutuaria sem pertencer a nada.
 */
export function Toolbar({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">{children}</div>
  );
}

/** Segmentado. Para dimensões com poucos valores mutuamente exclusivos. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; count?: number; icon?: LucideIcon }[];
}) {
  return (
    <div className="inline-flex items-center gap-px rounded-[var(--radius-control)] bg-sunken p-0.5">
      {options.map((o) => {
        const active = o.value === value;
        const Icon = o.icon;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            aria-pressed={active}
            className={cx(
              "inline-flex h-7 items-center gap-1.5 rounded-[6px] px-2.5 text-meta font-medium transition-colors duration-[120ms]",
              active ? "bg-surface text-ink shadow-[0_1px_2px_rgb(26_25_23/0.06)]" : "text-ink-3 hover:text-ink-2",
            )}
          >
            {Icon && <Icon className="size-3.5" strokeWidth={1.75} />}
            {o.label}
            {o.count !== undefined && (
              <span className={cx("text-[11px] tabular", active ? "text-ink-3" : "text-ink-4")}>{o.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function SearchInput({
  value,
  onChange,
  placeholder = "Procurar…",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="relative min-w-[180px] flex-1 sm:max-w-[260px]">
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-4" strokeWidth={1.75} />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-8 w-full rounded-[var(--radius-control)] border border-line bg-surface pr-2.5 pl-8 text-meta text-ink placeholder:text-ink-4 focus:border-line-strong focus:outline-none"
      />
    </div>
  );
}

/**
 * Filtro por lista. Reencaminha para `SelectField` — o ícone de sliders que aqui
 * estava não dizia nada sobre o que a caixa faz, e a seta do browser não respeitava
 * nem a cor nem a altura dos controlos ao lado.
 */
export function Select<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  label: string;
}) {
  return <SelectField size="sm" aria-label={label} value={value} onChange={onChange} options={options} />;
}

/** Contagem de resultados. Pequena, à direita, para dar confiança nos filtros. */
export function ResultCount({ n, noun }: { n: number; noun: [string, string] }) {
  return (
    <span className="ml-auto text-meta text-ink-3 tabular">
      {n} {n === 1 ? noun[0] : noun[1]}
    </span>
  );
}

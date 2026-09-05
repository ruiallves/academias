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
    // Telemóvel: uma fila que rola de lado, em vez de três linhas de filtros.
    <div className="scroll-x-clean flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5 max-md:flex-nowrap max-md:overflow-x-auto max-md:px-3 max-md:[&>*]:shrink-0">{children}</div>
  );
}

/**
 * Segmentado. Para dimensões com poucos valores mutuamente exclusivos.
 *
 * ## Porque é que o escolhido não leva a cor do clube
 *
 * Escolher não é aprovar. Um segmento aceso a verde-clube lê-se como estado —
 * "isto está bem", "isto está pago" — quando só quer dizer "é este que estás a
 * ver". Pela mesma razão que a navegação usa `--nav-accent` e não a cor do
 * clube: a cor da instituição é identidade, não interface, e um clube amarelo
 * ou vermelho tornava estes botões ilegíveis ou alarmantes.
 *
 * O escolhido levanta-se do carril — fundo de superfície e uma sombra de um
 * pixel — em vez de mudar de cor. Funciona com qualquer emblema e não compete
 * com o verde de pago nem com o vermelho de vencido, que aqui ao lado querem
 * dizer coisas a sério.
 *
 * `size="md"` é o mesmo controlo com altura de dedo, para formulários e para a
 * ficha de jogo; `sm` é o da barra de filtros, colado ao cabeçalho da tabela.
 */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  size = "sm",
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; count?: number; icon?: LucideIcon; hint?: string }[];
  size?: "sm" | "md";
  /** Rótulo do grupo para quem navega por leitor de ecrã. */
  label?: string;
}) {
  const md = size === "md";
  return (
    <div
      role="group"
      aria-label={label}
      className={cx(
        "inline-flex items-center gap-px rounded-[var(--radius-control)] bg-sunken",
        // Seis separadores numa ficha não cabem em 360px: o carril rola de lado
        // dentro da sua largura, em vez de sair do ecrã. Sem barra (`scroll-x-clean`).
        "scroll-x-clean max-w-full max-md:overflow-x-auto max-md:[&>*]:shrink-0",
        md ? "p-1" : "p-0.5",
      )}
    >
      {options.map((o) => {
        const active = o.value === value;
        const Icon = o.icon;
        return (
          <button
            key={o.value}
            type="button"
            title={o.hint}
            onClick={() => onChange(o.value)}
            aria-pressed={active}
            className={cx(
              "inline-flex items-center gap-1.5 rounded-[6px] font-medium whitespace-nowrap transition-colors duration-[120ms]",
              // `md` cresce em altura, não em letra: é o alvo do dedo que tem de
              // ser maior. Com corpo de texto, três opções — "Titular / Entrou /
              // Não jogou" — não cabiam num telemóvel e a última saía do ecrã.
              md ? "h-9 min-w-9 justify-center px-3 text-meta" : "h-7 px-2.5 text-meta",
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

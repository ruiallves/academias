import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, ChevronDown, TrendingDown, TrendingUp, type LucideIcon } from "@/lib/icons";
import { initials } from "@/lib/format";
import { Spinner, useBusy } from "@/components/Busy";

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
  // Telemóvel: duas por linha — quatro métricas empilhadas eram um ecrã inteiro.
  return <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 max-sm:grid-cols-2 max-sm:gap-2">{children}</div>;
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
  photoUrl,
}: {
  name: string;
  size?: "sm" | "md" | "lg";
  self?: boolean;
  /**
   * A fotografia, quando existe.
   *
   * Fica **aqui** e não em cada lista: o monograma é o rosto de uma pessoa em toda a
   * consola — plantel, presenças, convocatórias, mensalidades — e uma fotografia que
   * só aparecesse na ficha era uma fotografia que ninguém via. Com a propriedade no
   * componente, cada sítio que tenha o dado passa-o, e os que não têm continuam a
   * mostrar as iniciais sem mudar uma linha.
   */
  photoUrl?: string | null;
}) {
  const dim = { sm: "size-6 text-[10px]", md: "size-7 text-[11px]", lg: "size-9 text-body" }[size];

  if (photoUrl) {
    return (
      <img
        src={photoUrl}
        alt=""
        aria-hidden
        className={cx("shrink-0 rounded-full bg-sunken object-cover", dim)}
      />
    );
  }

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

/**
 * O nome que abre a ficha, dentro de uma linha que faz outra coisa.
 *
 * ## Porque é que isto não vive na tabela
 *
 * Viveu, e estava errado. A tabela envolvia a **célula inteira** num link — e
 * uma célula é o monograma, o nome, o subtítulo e todo o espaço vazio até à
 * coluna seguinte. Clicar dois centímetros à direita do nome, ou na fotografia,
 * ou na idade por baixo, abria a ficha na mesma: metade da linha continuava a
 * navegar quando devia estar a escolher.
 *
 * O alvo certo é o nome, e quem sabe onde ele acaba é a célula que o desenha —
 * não a tabela, que só vê `ReactNode`. Por isso o link desceu para aqui e
 * põe-se à volta do texto, mais nada.
 *
 * E o texto, mesmo: quem o usa dá-lhe `inline-block max-w-full` (ou deixa-o ser
 * um item de flex), nunca `block`. Um link `block` estica-se até à largura do
 * pai, e um nome curto numa coluna larga volta a dar dois centímetros de vazio
 * que abrem a ficha — o mesmo erro, num sítio mais pequeno.
 *
 * ## O que ele garante
 *
 * `stopPropagation`, para o clique não subir à linha e escolher ao mesmo tempo
 * que navega. E é um `<Link>` a sério: ganha o menu do botão direito, o abrir
 * em separador novo e o foco por teclado — que a linha nunca teve. É a mesma
 * mecânica do `PersonLink`, que já fazia isto para o staff; este é o genérico,
 * para quando o destino não é `/staff/:id`.
 */
export function RowLink({
  to,
  className,
  children,
}: {
  to: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link to={to} onClick={(e) => e.stopPropagation()} className={cx("hover:underline", className)}>
      {children}
    </Link>
  );
}

export function DataTable<T>({
  columns,
  rows,
  keyOf,
  to,
  onRowClick,
  empty,
  selection,
}: {
  columns: Column<T>[];
  rows: T[];
  keyOf: (row: T) => string;
  /** A linha leva a uma página. */
  to?: (row: T) => string;
  /**
   * A linha abre alguma coisa aqui mesmo — uma ficha em janela, por exemplo.
   *
   * Alternativa a `to`, não acumulável com ela: uma linha que navega **e** abre
   * um diálogo faz as duas e nenhuma fica visível.
   */
  onRowClick?: (row: T) => void;
  empty?: ReactNode;
  /**
   * Escolher várias linhas para agir sobre elas de uma vez.
   *
   * Vive aqui e não em cada página porque a caixa de selecção é um comportamento
   * de tabela, não de sócios ou de atletas: escrito três vezes, seriam três
   * comportamentos ligeiramente diferentes daqui a um ano — um a marcar com o
   * clique na linha, outro a perder a escolha ao filtrar.
   *
   * Opcional: as tabelas que não o passam continuam exactamente como estavam.
   */
  selection?: {
    selected: Set<string>;
    onChange: (ids: Set<string>) => void;
    /** Linhas que não se podem escolher — sem caixa, e fora do "todos". */
    disabled?: (row: T) => boolean;
  };
}) {
  const navigate = useNavigate();
  const hide = { sm: "hidden sm:table-cell", md: "hidden md:table-cell", lg: "hidden lg:table-cell" };

  if (rows.length === 0) return <div className="px-5 py-14">{empty ?? <Empty title="Sem resultados" />}</div>;

  /*
   * "Todos" é todos os **visíveis**, não todos os que existem.
   *
   * Quem filtrou por "Sub-13" e marca a caixa do cabeçalho quer os do Sub-13. A
   * alternativa — marcar a base inteira — é a origem clássica do apagar em massa
   * que ninguém queria.
   */
  const elegiveis = rows.filter((r) => !selection?.disabled?.(r)).map(keyOf);
  const todosMarcados = elegiveis.length > 0 && elegiveis.every((id) => selection?.selected.has(id));
  const algunsMarcados = !todosMarcados && elegiveis.some((id) => selection?.selected.has(id));

  const alternarTodos = () => {
    if (!selection) return;
    const proximo = new Set(selection.selected);
    if (todosMarcados) for (const id of elegiveis) proximo.delete(id);
    else for (const id of elegiveis) proximo.add(id);
    selection.onChange(proximo);
  };

  const alternar = (id: string) => {
    if (!selection) return;
    const proximo = new Set(selection.selected);
    if (proximo.has(id)) proximo.delete(id);
    else proximo.add(id);
    selection.onChange(proximo);
  };

  /*
   * Numa tabela que se pode escolher, a linha **escolhe**. Sempre.
   *
   * ## O que estava antes, e porque é que não chegava
   *
   * A selecção era um modo: a linha navegava até alguém marcar a primeira caixa,
   * e só a partir daí é que clicar na linha escolhia. Resolvia metade do
   * problema — escolher a segunda pessoa deixava de exigir pontaria — e deixava
   * a pior metade de pé: a **primeira** continuava a ser um quadrado de catorze
   * pixéis, e falhá-lo por dois milímetros levava a página para outro sítio.
   *
   * Pior do que isso, a mesma linha fazia duas coisas diferentes conforme um
   * estado que não se vê. Um clique que ora escolhe ora navega não se aprende;
   * hesita-se antes de cada um.
   *
   * ## Agora
   *
   * A linha escolhe, e entra-se na ficha pelo **nome** — que é um link a sério,
   * com sublinhado no hover, como o `PersonLink` já fazia dentro das linhas
   * clicáveis deste produto. Cada gesto tem um sítio, e nenhum depende de estado
   * invisível.
   *
   * Nas tabelas **sem** selecção nada disto se aplica: não há o que escolher, e
   * a linha continua a abrir o que sempre abriu.
   */
  const escolheAoClicar = Boolean(selection);

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-body">
        <thead>
          <tr className="border-b border-line bg-sunken/60">
            {selection && (
              <th scope="col" className="w-9 px-3 py-2">
                <input
                  type="checkbox"
                  aria-label="Escolher todas as linhas visíveis"
                  checked={todosMarcados}
                  ref={(el) => {
                    // O estado "algumas": um traço em vez de visto. É o que
                    // distingue "escolhi três de dez" de "não escolhi nada".
                    if (el) el.indeterminate = algunsMarcados;
                  }}
                  onChange={alternarTodos}
                  className="size-3.5 accent-[var(--color-signal)]"
                />
              </th>
            )}
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
            /*
             * Uma linha que não se pode escolher não tem clique — como não tem
             * caixa, também não tem gesto. A ficha continua a abrir-se pelo
             * nome, que é um link à parte.
             *
             * E **não** fica esbatida. Ficava, enquanto a selecção era um modo:
             * o cinzento durava o tempo da escolha e dizia "esta não". Agora que
             * a selecção está sempre ligada, o mesmo cinzento passaria a ser
             * permanente — e em Staff a linha que não se escolhe é a **do
             * próprio**, que ficaria a 60% para sempre, como se a conta de quem
             * está a olhar tivesse algum problema. A caixa em falta chega para
             * dizer o que há a dizer.
             */
            const bloqueada = escolheAoClicar && Boolean(selection?.disabled?.(row));
            const clickable = !bloqueada && (escolheAoClicar || Boolean(href || onRowClick));

            const aoClicar = () => {
              if (bloqueada) return;
              if (escolheAoClicar) return alternar(keyOf(row));
              if (href) return navigate(href);
              if (onRowClick) return onRowClick(row);
            };

            return (
              <tr
                key={keyOf(row)}
                className={cx(
                  "border-b border-line last:border-0 transition-colors duration-[120ms]",
                  clickable && "cursor-pointer hover:bg-sunken/50",
                  selection?.selected.has(keyOf(row)) && "bg-signal-soft/40",
                )}
                onClick={clickable ? aoClicar : undefined}
              >
                {selection && (
                  <td className="w-9 px-3 align-middle">
                    {selection.disabled?.(row) ? (
                      <span className="block size-3.5" aria-hidden />
                    ) : (
                      <input
                        type="checkbox"
                        aria-label="Escolher esta linha"
                        checked={selection.selected.has(keyOf(row))}
                        onChange={() => alternar(keyOf(row))}
                        // A caixa não abre a ficha: quem a marca quer escolher,
                        // não navegar.
                        onClick={(e) => e.stopPropagation()}
                        className="size-3.5 accent-[var(--color-signal)]"
                      />
                    )}
                  </td>
                )}
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
/* Carregamento                                                                */
/* -------------------------------------------------------------------------- */

/**
 * A página está a ir buscar dados.
 *
 * ## O que isto resolve
 *
 * Sem um estado de carregamento, uma lista vazia e uma lista que ainda não chegou
 * são o mesmo ecrã — e durante esse segundo a página afirma "sem resultados",
 * "ainda não há sócios", "nenhum prospecto". É uma mentira curta mas é uma
 * mentira, e numa ferramenta de gestão um facto errado durante um segundo custa
 * mais do que um segundo de espera.
 *
 * ## Um círculo, não um ecrã em branco
 *
 * Ocupa a altura de um painel e não a da página. Um bloco vazio do tamanho do
 * ecrã com uma palavra ao meio parece uma página avariada; um círculo a rodar
 * dentro do painel que vai receber o conteúdo diz o que se passa sem gritar. É o
 * mesmo indicador do arranque da consola (`AcademyBoot`), para a espera ter
 * sempre a mesma cara.
 */
export function Loading({
  /** `page` desfoca a página toda; `panel` é um disco pequeno, no sítio. */
  size = "page",
}: {
  /**
   * Ignorado. Ficou na assinatura para não obrigar a tocar em vinte chamadas
   * que o passavam — e porque a resposta certa a "o que está a carregar?" passou
   * a ser o desfoque da página, não uma legenda por baixo de um disco.
   */
  label?: string;
  size?: "page" | "panel";
}) {
  /*
   * Um `<Loading />` de página já não desenha nada: **declara**.
   *
   * Declara à casca que esta página está à espera, e a casca desfoca tudo menos o
   * menu e põe um disco por cima. Ver `components/Busy.tsx` para o porquê de o
   * carregamento ter passado a ser um só, e não a maneira de cada página.
   *
   * O espaço fica reservado: sem ele, o painel colapsava a zero e voltava a
   * crescer quando os dados chegassem — o salto de layout que a régua do UX
   * manda evitar, e que aqui aconteceria em todas as páginas ao mesmo tempo.
   */
  useBusy(size === "page");

  if (size === "panel") return <Spinner />;

  return <div className="w-full py-20" aria-hidden />;
}

/* -------------------------------------------------------------------------- */
/* Estado vazio                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Um vazio é uma mensagem, não um buraco. Quando o vazio é boa notícia — nada por
 * cobrar, nada por registar — diz-se isso com `tone="ok"`.
 *
 * ## O espaçamento é dele, e não de quem o usa
 *
 * Era: o componente não tinha margem nenhuma e cada ecrã embrulhava-o à mão num
 * `<div>`. Vinte e nove sítios lembravam-se; **vinte e
 * oito esqueciam-se** — e nesses o vazio saía como duas linhas de texto
 * encolhidas contra o topo de um painel grande, que foi como a página de Jogos
 * apareceu.
 *
 * Espaçamento que metade dos sítios esquece não é decisão de quem chama: é
 * omissão do componente. Passou para cá, e os embrulhos ficaram sem razão de
 * existir (podem desaparecer quando alguém lhes passar ao lado).
 *
 * `compact` existe para o punhado de sítios onde este ar seria demais — uma
 * caixa pequena dentro de um diálogo, não uma página.
 */
export function Empty({
  title,
  detail,
  icon: Icon,
  tone = "neutral",
  compact = false,
  children,
}: {
  title: string;
  detail?: string;
  icon?: LucideIcon;
  tone?: "neutral" | "ok";
  compact?: boolean;
  children?: ReactNode;
}) {
  return (
    <div
      className={cx(
        "flex flex-col items-center justify-center px-5 text-center",
        compact ? "py-8" : "py-16",
      )}
    >
      {Icon && (
        <span
          className={cx(
            "mb-3 inline-flex size-11 items-center justify-center rounded-full",
            tone === "ok" ? "bg-ok-soft text-ok" : "bg-sunken text-ink-3",
          )}
        >
          <Icon className="size-5" strokeWidth={1.5} />
        </span>
      )}
      <p className="text-[15px] leading-tight font-semibold tracking-[-0.01em] text-ink">{title}</p>
      {/* `max-w-xs` cortava a linha cedo de mais e partia frases a meio de uma
          expressão. 26rem dá-lhe duas linhas inteiras na maioria dos casos. */}
      {detail && <p className="mt-1.5 max-w-[26rem] text-meta leading-relaxed text-ink-3">{detail}</p>}
      {children && <div className="mt-4">{children}</div>}
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

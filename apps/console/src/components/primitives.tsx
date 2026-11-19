import type { ReactNode } from "react";
import { useMobile } from "@/lib/viewport";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ariaSort, BarraDeFiltros, Coluna, textoDe, textoDoValor, useOrdenacao, type ValorOrdenavel } from "@academia/ui/ordenar";
import { ArrowRight, ChevronDown, TrendingDown, TrendingUp, type LucideIcon, ChevronRight } from "@/lib/icons";
import { initials } from "@/lib/format";
import { Spinner, useBusy } from "@/components/Busy";
import { MenuDeEscolha } from "@/components/Escolha";

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
  /**
   * A coluna que **é** a linha — o nome, o artigo, o título. No telemóvel é o
   * cabeçalho do cartão; as outras vêm por baixo, rotuladas. Sem marcação, é a
   * primeira, que é onde as tabelas desta consola já põem a identidade.
   */
  primary?: true;
  render: (row: T) => ReactNode;
  /**
   * O valor por onde se ordena, quando o que a célula mostra não chega.
   *
   * Sem isto, ordena-se pelo texto da célula (`textoDe`), e as datas e os
   * montantes escritos ("05/11/2026", "12,50 €") já se comparam pelo valor. Dá-se
   * quando a célula é só um ícone ou uma cor, ou quando o texto é um resumo do
   * valor (ex.: "há 3 dias" → a data).
   */
  sortValue?: (row: T) => ValorOrdenavel;
  /**
   * O texto desta linha na lista do filtro da coluna, quando a célula não tem
   * texto (uma pastilha que se desenha sozinha) e o `sortValue` é um número de
   * prioridade que não se lê ("Esgotado", e não "0"). Por omissão, o texto da
   * célula, ou o `sortValue` escrito.
   */
  filterValue?: (row: T) => string;
  /** `false` para uma coluna que não faz sentido ordenar (as ações). As colunas sem cabeçalho também não ordenam. */
  sortable?: false;
};

const ordenavel = <T,>(c: Column<T>) => c.sortable !== false && c.header.trim() !== "";

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
  sortKey,
}: {
  columns: Column<T>[];
  rows: T[];
  keyOf: (row: T) => string;
  /**
   * O nome com que a ordem escolhida fica lembrada durante a sessão. Por omissão,
   * a página e as colunas: chega para distinguir as tabelas da consola. Dá-se
   * quando a mesma página tem duas tabelas com as mesmas colunas.
   */
  sortKey?: string;
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
  const { pathname } = useLocation();
  const mobile = useMobile();
  const hide = { sm: "hidden sm:table-cell", md: "hidden md:table-cell", lg: "hidden lg:table-cell" };

  /*
   * Ordenar e filtrar por qualquer coluna, como no Excel: o cabeçalho abre um
   * menu com ascendente e descendente, uma pesquisa e a lista dos valores da
   * coluna para escolher os que ficam à vista. Ordena pelo `sortValue` (ou pelo
   * texto da célula); a lista do filtro mostra o texto da célula (ou o
   * `filterValue`). Ver `packages/ui/src/ordenar.tsx`.
   */
  const porChave = new Map(columns.map((c) => [c.key, c]));
  const t = useOrdenacao(
    rows,
    (coluna, row) => {
      const c = porChave.get(coluna);
      if (!c) return null;
      return c.sortValue ? c.sortValue(row) : textoDe(c.render(row));
    },
    sortKey ?? `${pathname}|${columns.map((c) => c.key).join(",")}`,
    (coluna, row) => {
      const c = porChave.get(coluna);
      if (!c) return "";
      if (c.filterValue) return c.filterValue(row);
      const visto = textoDe(c.render(row));
      return visto.trim() ? visto : textoDoValor(c.sortValue?.(row));
    },
  );
  const { linhas: ordenadas, ordem } = t;

  if (rows.length === 0) return <div className="px-5 py-14">{empty ?? <Empty title="Sem resultados" />}</div>;

  /*
   * Os filtros esconderam tudo: dizê-lo dentro da tabela, com a saída à mão.
   *
   * Dentro, e não no lugar dela: o gesto normal é "Selecionar tudo" para
   * desmarcar tudo e depois marcar dois ou três, e nesse meio a tabela fica
   * vazia. Se os cabeçalhos saíssem, o menu aberto fechava-se a meio.
   */
  const semLinhas =
    ordenadas.length === 0 ? (
      <div className="px-5 py-12">
        <Empty
          title="Nenhuma linha com estes filtros"
          detail={`${t.total} ${t.total === 1 ? "linha escondida" : "linhas escondidas"} pelos filtros das colunas.`}
        >
          <button type="button" onClick={t.limparFiltros} className="ctl-outline mt-3">
            Limpar filtros
          </button>
        </Empty>
      </div>
    ) : null;

  /*
   * "Todos" é todos os **visíveis**, não todos os que existem.
   *
   * Quem filtrou por "Sub-13" e marca a caixa do cabeçalho quer os do Sub-13. A
   * alternativa — marcar a base inteira — é a origem clássica do apagar em massa
   * que ninguém queria.
   */
  // Também com os filtros das colunas: o "todos" marca só as linhas que ficaram à vista.
  const elegiveis = ordenadas.filter((r) => !selection?.disabled?.(r)).map(keyOf);
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

  /*
   * Cada linha decide o seu gesto uma vez, para as duas formas de a desenhar.
   *
   * Uma linha que não se pode escolher não tem clique — como não tem caixa,
   * também não tem gesto. A ficha continua a abrir-se pelo nome, que é um link
   * à parte.
   *
   * E **não** fica esbatida. Ficava, enquanto a selecção era um modo: o cinzento
   * durava o tempo da escolha e dizia "esta não". Agora que a selecção está
   * sempre ligada, o mesmo cinzento passaria a ser permanente — e em Staff a
   * linha que não se escolhe é a **do próprio**, que ficaria a 60% para sempre,
   * como se a conta de quem está a olhar tivesse algum problema. A caixa em
   * falta chega para dizer o que há a dizer.
   */
  const gestoDe = (row: T) => {
    const href = to?.(row);
    const bloqueada = escolheAoClicar && Boolean(selection?.disabled?.(row));
    const clickable = !bloqueada && (escolheAoClicar || Boolean(href || onRowClick));
    const aoClicar = () => {
      if (bloqueada) return;
      if (escolheAoClicar) return alternar(keyOf(row));
      if (href) return navigate(href);
      if (onRowClick) return onRowClick(row);
    };
    return { href, clickable, aoClicar };
  };

  /*
   * No telemóvel a tabela é uma lista de cartões.
   *
   * ## Porquê não uma tabela mais pequena
   *
   * Uma tabela de seis colunas num ecrã de 360px só tem duas saídas, e as duas
   * são más: esconder colunas (e com elas a informação — o encarregado, a ficha
   * médica), ou deixá-la rolar de lado, com a pessoa a arrastar o polegar para
   * ver se o atleta tem a mensalidade paga. Nenhuma é "a consola no telemóvel";
   * é a consola a caber à força.
   *
   * O cartão tem a mesma informação toda: a coluna principal como cabeçalho, e
   * as outras por baixo, cada uma com o seu rótulo — o mesmo texto que era o
   * cabeçalho da coluna. As que a tabela esconde em ecrãs médios (`hideBelow`)
   * aparecem aqui, porque aqui há sítio para elas.
   *
   * ## O mesmo gesto
   *
   * Tocar no cartão faz o que clicar na linha fazia: escolhe, numa lista com
   * selecção; abre, nas outras. As caixas e o "todos" são as mesmas — só mudou
   * onde estão desenhadas.
   */
  if (mobile) {
    const principal = columns.find((c) => c.primary) ?? columns[0];
    const resto = columns.filter((c) => c !== principal);
    // No telemóvel não há cabeçalhos: os nomes das colunas ficam numa fila por cima dos cartões, e cada um abre o mesmo menu.
    const comMenu = columns.filter(ordenavel);

    return (
      <div>
        {rows.length > 1 && comMenu.length > 0 && (
          <div className="flex min-h-11 items-center gap-3 overflow-x-auto border-b border-line px-4 text-meta whitespace-nowrap text-ink-3">
            <span className="shrink-0">Ordenar e filtrar</span>
            {comMenu.map((c) => (
              <span key={c.key} className="shrink-0 rounded-full border border-line px-2.5 py-1 font-medium text-ink-2">
                <Coluna t={t} coluna={c.key}>
                  {c.header}
                </Coluna>
              </span>
            ))}
          </div>
        )}
        <BarraDeFiltros t={t} />
        {selection && elegiveis.length > 0 && (
          <label className="flex min-h-11 cursor-pointer items-center gap-3 border-b border-line bg-sunken/40 px-4 text-meta text-ink-2 select-none">
            <input
              type="checkbox"
              aria-label="Escolher todas as linhas visíveis"
              checked={todosMarcados}
              ref={(el) => {
                if (el) el.indeterminate = algunsMarcados;
              }}
              onChange={alternarTodos}
              className="size-4 accent-[var(--color-signal)]"
            />
            {todosMarcados ? "Desmarcar todos" : algunsMarcados ? `${selection.selected.size} escolhidos` : "Escolher todos os visíveis"}
          </label>
        )}
        {semLinhas}
        <ul>
          {ordenadas.map((row) => {
            const id = keyOf(row);
            const { href, clickable, aoClicar } = gestoDe(row);
            const marcada = Boolean(selection?.selected.has(id));
            return (
              <li
                key={id}
                onClick={clickable ? aoClicar : undefined}
                className={cx(
                  "border-b border-line last:border-0 transition-colors duration-[120ms]",
                  clickable && "cursor-pointer active:bg-sunken/60",
                  marcada && "bg-signal-soft/40",
                )}
              >
                <div className="flex items-start gap-3 px-4 py-3">
                  {selection &&
                    (selection.disabled?.(row) ? (
                      <span className="mt-1 block size-4" aria-hidden />
                    ) : (
                      <input
                        type="checkbox"
                        aria-label="Escolher esta linha"
                        checked={marcada}
                        onChange={() => alternar(id)}
                        onClick={(e) => e.stopPropagation()}
                        className="mt-1 size-4 shrink-0 accent-[var(--color-signal)]"
                      />
                    ))}

                  <div className="min-w-0 flex-1">
                    <div className="min-w-0">{principal.render(row)}</div>

                    {resto.length > 0 && (
                      <dl className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-2">
                        {resto.map((c) => (
                          <div key={c.key} className="min-w-0">
                            <dt className="text-[10.5px] font-semibold tracking-[0.04em] text-ink-4 uppercase">{c.header}</dt>
                            <dd className="mt-0.5 min-w-0 text-body text-ink-2">{c.render(row)}</dd>
                          </div>
                        ))}
                      </dl>
                    )}
                  </div>

                  {/* A seta diz "isto abre" — só nas listas que abrem, e nunca nas que escolhem. */}
                  {href && !escolheAoClicar && (
                    <ChevronRight className="mt-1 size-4 shrink-0 text-ink-4" strokeWidth={1.75} aria-hidden />
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  return (
    <div>
    <BarraDeFiltros t={t} />
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
                aria-sort={ordenavel(c) ? ariaSort(ordem, c.key) : undefined}
                style={c.width ? { width: c.width } : undefined}
                className={cx(
                  "px-5 py-2 text-meta font-medium text-ink-3 whitespace-nowrap",
                  c.align === "right" ? "text-right" : "text-left",
                  c.hideBelow && hide[c.hideBelow],
                )}
              >
                {ordenavel(c) ? (
                  <Coluna t={t} coluna={c.key} direita={c.align === "right"}>
                    {c.header}
                  </Coluna>
                ) : (
                  c.header
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {semLinhas && (
            <tr>
              <td colSpan={columns.length + (selection ? 1 : 0)}>{semLinhas}</td>
            </tr>
          )}
          {ordenadas.map((row) => {
            const { clickable, aoClicar } = gestoDe(row);

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
/**
 * A moldura de uma lista de onde se escolhe escrevendo — nomes de atletas,
 * pessoas, competições.
 *
 * ## O que ela faz de diferente de uma `<ul>`
 *
 * Segura o foco no campo de texto enquanto se toca numa opção. Um toque numa
 * lista assim tira o foco ao campo; no telemóvel isso fecha o teclado, e fechar
 * o teclado devolve meio ecrã de altura à página **entre o dedo pousar e o dedo
 * levantar**. A lista sobe, o dedo levanta noutro sítio, e o toque não escolhe
 * nada — ou escolhe a linha errada. Foi a avaria que um clube relatou: *"toco no
 * nome do atleta, ele não selecciona e a lista desaparece"*.
 *
 * `preventDefault` no `mousedown` é o que impede o campo de perder o foco. Vai
 * no `mousedown` e não no `pointerdown` de propósito: o `mousedown` só nasce de
 * um toque que o browser já decidiu ser um toque, e não de um arrasto — travar
 * o `pointerdown` travava também o deslizar para percorrer a lista.
 *
 * Quem escolhe continua a ser o `onClick` de cada opção: o teclado (Tab, Enter)
 * continua a funcionar como sempre.
 */
export function ListaDeEscolha({
  className,
  children,
  ...resto
}: { className?: string; children: ReactNode } & Omit<
  React.HTMLAttributes<HTMLUListElement>,
  "onMouseDown" | "className" | "children"
>) {
  return (
    <ul {...resto} className={className} onMouseDown={(e) => e.preventDefault()}>
      {children}
    </ul>
  );
}

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
 * Um menu de escolher, com a nossa moldura e com pesquisa.
 *
 * Era o `<select>` do sistema com uma caixa nossa por cima. Desde 15/11/2026 é
 * o `MenuDeEscolha` (`components/Escolha.tsx`): abre com um campo de procura
 * quando a lista tem mais de seis opções, e no telemóvel numa folha no fundo
 * do ecrã. A caixa fechada ficou igual: a mesma altura, o mesmo raio e a mesma
 * seta dos outros controlos.
 *
 * Um valor que não está nas opções não pode passar por outro. O `<select>` do
 * browser, quando o `value` não correspondia a nenhuma `<option>`, mostrava a
 * primeira e calava-se: um formulário mostrava "Campo 1" com o estado a `""` e
 * mandava vazio para o servidor. O menu mostra um traço (ou o valor) em vez de
 * fingir uma escolha que ninguém fez.
 */
export function SelectField<T extends string>({
  value,
  onChange,
  options,
  size = "md",
  className,
  "aria-label": ariaLabel,
  pesquisa,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; disabled?: boolean }[];
  size?: "sm" | "md";
  className?: string;
  "aria-label"?: string;
  /** Forçar (ou tirar) o campo de procura; por omissão, só com mais de seis opções. */
  pesquisa?: boolean;
}) {
  const box = size === "sm" ? "h-8 pl-2.5 pr-2 text-meta" : "h-9 pl-2.5 pr-2.5 text-body";

  return (
    <span className={cx("relative inline-flex min-w-0", className)}>
      <MenuDeEscolha
        value={value}
        opcoes={options}
        onEscolher={(v) => onChange(v as T)}
        aria-label={ariaLabel}
        pesquisa={pesquisa}
        className={cx(
          "w-full min-w-0 cursor-pointer rounded-[var(--radius-control)] text-left",
          "border border-line bg-surface font-medium text-ink-2",
          "transition-colors duration-[120ms] hover:border-line-strong hover:text-ink",
          "focus:border-line-strong focus:text-ink focus:outline-none aria-expanded:border-line-strong aria-expanded:text-ink",
          box,
        )}
        conteudo={(rotulo, aberto) => (
          <span className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 flex-1 truncate">{rotulo}</span>
            <ChevronDown
              className={cx("shrink-0 text-ink-4 transition-transform duration-[120ms]", size === "sm" ? "size-3.5" : "size-4", aberto && "rotate-180")}
              strokeWidth={1.75}
            />
          </span>
        )}
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

/**
 * V, E ou D — o desfecho de um jogo, numa letra.
 *
 * ## Porque é preenchido e não suave
 *
 * As pastilhas do produto são fundo suave com tinta da cor. Esta não pode ser:
 * vive dentro da pastilha do calendário, que já tem o fundo pintado com a cor
 * do escalão — um `bg-ok-soft` por cima de um verde-água do Sub-11 deixa de se
 * ver. Preenchida com texto branco lê-se em cima de qualquer fundo, e é a mesma
 * forma que a "Forma recente" da ficha da equipa já usava.
 *
 * O empate leva cinzento e não amarelo de propósito: um empate não é um aviso.
 *
 * `score` entra no `title` e, quando `withScore`, ao lado da letra — nas listas
 * há espaço para "V 3–1", na pastilha do mês não há.
 */
export function OutcomeTag({
  outcome,
  score,
  withScore = false,
  size = "md",
}: {
  outcome: "win" | "draw" | "loss";
  /** "3–1", já formatado por quem sabe de que lado é o "nós". */
  score?: string;
  withScore?: boolean;
  size?: "sm" | "md";
}) {
  const letra = { win: "V", draw: "E", loss: "D" }[outcome];
  const nome = { win: "Vitória", draw: "Empate", loss: "Derrota" }[outcome];
  const fundo = { win: "bg-ok", draw: "bg-ink-4", loss: "bg-risk" }[outcome];

  return (
    <span
      title={score ? `${nome} · ${score}` : nome}
      aria-label={score ? `${nome}, ${score}` : nome}
      className={cx(
        "inline-flex shrink-0 items-center justify-center gap-1 font-bold text-white tabular",
        fundo,
        size === "sm" ? "h-4 rounded-[4px] text-[9.5px]" : "h-5 rounded-full text-[11px]",
        withScore && score
          ? size === "sm"
            ? "px-1"
            : "px-2"
          : size === "sm"
            ? "w-4"
            : "w-5",
      )}
    >
      {letra}
      {withScore && score && <span className="font-semibold opacity-90">{score}</span>}
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

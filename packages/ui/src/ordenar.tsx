import { isValidElement, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Ordenar e filtrar uma tabela pelo que ela mostra, como no Excel.
 *
 * ## O pedido
 *
 * "Clicar no nome de uma coluna e aparecer em cima ASC e DESC, depois um input
 * para pesquisar e as opções em baixo para selecionar." Cada cabeçalho abre um
 * menu (`Coluna`): ordenar ascendente ou descendente, procurar, e a lista dos
 * valores dessa coluna com caixas para escolher quais ficam à vista.
 *
 * ## De onde vem o valor
 *
 * Do que a célula mostra. As colunas desenham `ReactNode`, por isso tira-se o
 * texto da árvore (`textoDe`): os textos e números, e os `children` e as props
 * de texto (`name`, `label`, `title`) dos elementos. Quando o texto não diz o
 * valor, a coluna dá o seu (`sortValue` na `DataTable`).
 *
 * Ordenar usa o valor; filtrar usa o texto que se vê ("Em dia", "05/11/2026"),
 * porque é esse que a pessoa reconhece na lista.
 *
 * ## Como se compara
 *
 * Pelo que o texto quer dizer, não pelas letras: "05/11/2026" é uma data,
 * "1 234,50 €" e "12 %" são números, "Sub-9" vem antes de "Sub-11". O que está
 * vazio ("", "—", "-") fica sempre no fim, nos dois sentidos.
 *
 * ## O que fica lembrado
 *
 * A ordem e os filtros, por tabela, durante a sessão (`sessionStorage`): abrir
 * uma ficha e voltar encontra a tabela igual. Um filtro guarda os valores
 * **escondidos**, não os escolhidos: uma linha nova com um valor que ainda não
 * existia aparece, em vez de ficar escondida sem ninguém saber porquê.
 */

export type Sentido = "asc" | "desc";
export type Ordem = { coluna: string; sentido: Sentido } | null;
export type ValorOrdenavel = string | number | boolean | Date | null | undefined;

/* -------------------------------------------------------------------------- */
/* Valores                                                                      */
/* -------------------------------------------------------------------------- */

const PROPS_DE_TEXTO = ["name", "label", "title", "nome", "value", "text", "alt"] as const;

/** O texto que um nó React mostra, quanto baste para ordenar e filtrar. */
export function textoDe(no: ReactNode, fundo = 0): string {
  if (no == null || typeof no === "boolean" || fundo > 12) return "";
  if (typeof no === "string") return no;
  if (typeof no === "number" || typeof no === "bigint") return String(no);
  if (Array.isArray(no)) return no.map((n) => textoDe(n, fundo + 1)).filter(Boolean).join(" ");
  if (isValidElement(no)) {
    const props = (no.props ?? {}) as Record<string, unknown>;
    const filhos = textoDe(props.children as ReactNode, fundo + 1);
    if (filhos.trim()) return filhos;
    for (const p of PROPS_DE_TEXTO) {
      const v = props[p];
      if (typeof v === "string" && v.trim()) return v;
      if (typeof v === "number") return String(v);
    }
  }
  return "";
}

const MESES: Record<string, number> = {
  jan: 0, fev: 1, mar: 2, abr: 3, mai: 4, jun: 5, jul: 6, ago: 7, set: 8, out: 9, nov: 10, dez: 11,
};

/** "05/11/2026", "5/11/26", "05/11", "15 nov 2026", "15 de novembro de 2026" → instante; senão null. */
function comoData(s: string): number | null {
  const t = s.trim().toLowerCase();
  let m = t.match(/^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?(?:[ ,]+(\d{1,2})[:h](\d{2}))?$/);
  if (m) {
    const ano = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : new Date().getFullYear();
    return new Date(ano, Number(m[2]) - 1, Number(m[1]), Number(m[4] ?? 0), Number(m[5] ?? 0)).getTime();
  }
  m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
  m = t.match(/^(?:[a-zç]+,?\s+)?(\d{1,2})\s+(?:de\s+)?([a-zç]{3})[a-zç.]*\s*(?:(?:de\s+)?(\d{4}))?(?:[ ,·]+(\d{1,2})[:h](\d{2}))?$/);
  if (m && m[2] in MESES) {
    return new Date(m[3] ? Number(m[3]) : new Date().getFullYear(), MESES[m[2]], Number(m[1]), Number(m[4] ?? 0), Number(m[5] ?? 0)).getTime();
  }
  // "novembro 2026", "nov. 2026": o mês de uma mensalidade.
  m = t.match(/^([a-zç]{3})[a-zç.]*\s+(?:de\s+)?(\d{4})$/);
  if (m && m[1] in MESES) return new Date(Number(m[2]), MESES[m[1]], 1).getTime();
  return null;
}

/** "1 234,50 €", "-12,5", "12 %", "+3", "45 min" → número; senão null. Um texto com letras a mais não é número ("Sub-11"). */
function comoNumero(s: string): number | null {
  const t = s.trim().replace(/−/g, "-").replace(/[  ]/g, " ");
  const m = t.match(/^([+-]?)\s*(?:€\s*)?(\d{1,3}(?:[ .]\d{3})+|\d+)(?:,(\d+))?\s*(€|%|min|h|kg|cm|m|pts?|anos?)?$/i);
  if (!m) return null;
  const inteiro = m[2].replace(/[ .]/g, "");
  return Number(`${m[1] === "-" ? "-" : ""}${inteiro}${m[3] ? "." + m[3] : ""}`);
}

const VAZIO = /^\s*(|—|–|-|n\/a|sem dados)\s*$/i;

type Chave = { vazio: boolean; tipo: 0 | 1 | 2; n: number; s: string };

/** O valor pronto a comparar: vazio, número (inclui datas e sim/não) ou texto. */
export function chaveDe(v: ValorOrdenavel): Chave {
  if (v == null) return { vazio: true, tipo: 2, n: 0, s: "" };
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? { vazio: true, tipo: 2, n: 0, s: "" } : { vazio: false, tipo: 0, n: v.getTime(), s: "" };
  if (typeof v === "number") return Number.isFinite(v) ? { vazio: false, tipo: 0, n: v, s: "" } : { vazio: true, tipo: 2, n: 0, s: "" };
  if (typeof v === "boolean") return { vazio: false, tipo: 0, n: v ? 1 : 0, s: "" };
  const s = v.replace(/\s+/g, " ").trim();
  if (VAZIO.test(s)) return { vazio: true, tipo: 2, n: 0, s: "" };
  const d = comoData(s);
  if (d != null) return { vazio: false, tipo: 1, n: d, s };
  const n = comoNumero(s);
  if (n != null) return { vazio: false, tipo: 0, n, s };
  return { vazio: false, tipo: 2, n: 0, s };
}

const colador = typeof Intl !== "undefined" ? new Intl.Collator("pt-PT", { numeric: true, sensitivity: "base" }) : null;

/** Compara duas chaves no sentido pedido; os vazios ficam sempre no fim. */
export function comparar(a: Chave, b: Chave, sentido: Sentido): number {
  if (a.vazio !== b.vazio) return a.vazio ? 1 : -1;
  if (a.vazio) return 0;
  const sinal = sentido === "asc" ? 1 : -1;
  if (a.tipo !== 2 && b.tipo !== 2 && a.tipo === b.tipo) return (a.n - b.n) * sinal;
  if (a.tipo !== b.tipo) return (a.tipo - b.tipo) * sinal;
  const r = colador ? colador.compare(a.s, b.s) : a.s.localeCompare(b.s);
  return r * sinal;
}

/** Ordena sem mexer no original; empates mantêm a ordem em que vieram. */
export function ordenarPor<T>(linhas: T[], valor: (linha: T) => ValorOrdenavel, sentido: Sentido): T[] {
  const chaves = linhas.map((l, i) => ({ l, i, k: chaveDe(valor(l)) }));
  chaves.sort((x, y) => comparar(x.k, y.k, sentido) || x.i - y.i);
  return chaves.map((x) => x.l);
}

/** O texto de um valor, para a lista do filtro, quando a coluna não dá o que mostra. */
export function textoDoValor(v: ValorOrdenavel): string {
  if (v == null) return "";
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? "" : v.toLocaleDateString("pt-PT");
  if (typeof v === "boolean") return v ? "Sim" : "Não";
  if (typeof v === "number") return v.toLocaleString("pt-PT");
  return v;
}

const limpo = (s: string) => s.replace(/\s+/g, " ").trim();
/** O texto de uma linha numa coluna, como aparece na lista do filtro ("" = vazio). */
const paraFiltro = (s: string) => (VAZIO.test(limpo(s)) ? "" : limpo(s));
const semAcentos = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/* -------------------------------------------------------------------------- */
/* O estado de uma tabela                                                       */
/* -------------------------------------------------------------------------- */

export type OpcaoDoFiltro = { texto: string; n: number };

export type Tabela<T> = {
  /** As linhas à vista: filtradas e ordenadas. */
  linhas: T[];
  /** Quantas havia antes dos filtros. */
  total: number;
  ordem: Ordem;
  /** Ascendente → descendente → ordem da página (o clique simples, sem menu). */
  alternar: (coluna: string) => void;
  escolher: (ordem: Ordem) => void;
  /** Os valores escondidos de uma coluna (texto como aparece na lista; "" é o vazio). */
  escondidos: (coluna: string) => Set<string>;
  esconder: (coluna: string, valores: Set<string>) => void;
  filtrosAtivos: number;
  limparFiltros: () => void;
  /** Todos os valores de uma coluna, com quantas linhas têm cada um (sem contar com os filtros das outras colunas). */
  opcoesDe: (coluna: string) => OpcaoDoFiltro[];
};

type Guardado = { ordem: Ordem; escondidos: Record<string, string[]> };
const PREFIXO = "academias:tabela:";

function ler(chave?: string): Guardado {
  if (!chave) return { ordem: null, escondidos: {} };
  try {
    const v = sessionStorage.getItem(PREFIXO + chave);
    const g = v ? (JSON.parse(v) as Partial<Guardado>) : {};
    return { ordem: g.ordem ?? null, escondidos: g.escondidos ?? {} };
  } catch {
    return { ordem: null, escondidos: {} };
  }
}

/**
 * Ordem e filtros de uma tabela, e as linhas já tratadas.
 *
 * `valorDe` dá o valor por onde se ordena; `textoDe` o que a célula mostra
 * (para a lista do filtro). Sem `textoDe`, usa-se o valor escrito
 * (`textoDoValor`). `chave` lembra a escolha durante a sessão.
 */
export function useOrdenacao<T>(
  linhas: T[],
  valorDe: (coluna: string, linha: T) => ValorOrdenavel,
  chave?: string,
  textoDeColuna?: (coluna: string, linha: T) => string,
): Tabela<T> {
  const [ordem, setOrdem] = useState<Ordem>(() => ler(chave).ordem);
  const [escondidosPorColuna, setEscondidos] = useState<Record<string, string[]>>(() => ler(chave).escondidos);
  // Outra chave (outra equipa, outra época): lê o que essa tinha, em vez de levar a ordem e os filtros da anterior.
  const [chaveVista, setChaveVista] = useState(chave);
  if (chave !== chaveVista) {
    const g = ler(chave);
    setChaveVista(chave);
    setOrdem(g.ordem);
    setEscondidos(g.escondidos);
  }

  useEffect(() => {
    if (!chave) return;
    try {
      const vazio = !ordem && Object.keys(escondidosPorColuna).length === 0;
      if (vazio) sessionStorage.removeItem(PREFIXO + chave);
      else sessionStorage.setItem(PREFIXO + chave, JSON.stringify({ ordem, escondidos: escondidosPorColuna } satisfies Guardado));
    } catch {
      /* Sem armazenamento: dura até sair da página. */
    }
  }, [chave, ordem, escondidosPorColuna]);

  // As funções das páginas mudam a cada desenho; guardam-se numa ref para os memos dependerem só das linhas e do estado.
  const fns = useRef({ valorDe, textoDeColuna });
  fns.current = { valorDe, textoDeColuna };
  const texto = useCallback((coluna: string, l: T) => {
    const f = fns.current;
    return paraFiltro(f.textoDeColuna ? f.textoDeColuna(coluna, l) : textoDoValor(f.valorDe(coluna, l)));
  }, []);

  const filtros = useMemo(
    () => Object.entries(escondidosPorColuna).filter(([, v]) => v.length > 0).map(([c, v]) => [c, new Set(v)] as const),
    [escondidosPorColuna],
  );
  const passa = useCallback(
    (l: T, excepto?: string) => filtros.every(([c, esc]) => c === excepto || !esc.has(texto(c, l))),
    [filtros, texto],
  );

  const visiveis = useMemo(() => {
    const filtradas = filtros.length ? linhas.filter((l) => passa(l)) : linhas;
    return ordem ? ordenarPor(filtradas, (l) => fns.current.valorDe(ordem.coluna, l), ordem.sentido) : filtradas;
  }, [linhas, filtros, passa, ordem]);

  /*
   * Todos os valores da coluna, sem contar com os filtros das outras (pedido do
   * Rui, 19/11/2026): filtrar uma coluna não pode fazer desaparecer opções das
   * outras listas. Quem escolheu só o tamanho 0 continua a ver os outros
   * tamanhos, desmarcados, para os poder voltar a marcar.
   */
  const opcoesDe = useCallback(
    (coluna: string): OpcaoDoFiltro[] => {
      const contagem = new Map<string, { n: number; v: ValorOrdenavel }>();
      for (const l of linhas) {
        const t = texto(coluna, l);
        const c = contagem.get(t);
        if (c) c.n++;
        else contagem.set(t, { n: 1, v: fns.current.valorDe(coluna, l) });
      }
      // Pela ordem do próprio valor (datas por data, números por número); o vazio no fim.
      return [...contagem.entries()]
        .map(([t, { n, v }]) => ({ texto: t, n, k: t === "" ? chaveDe(null) : chaveDe(v ?? t) }))
        .sort((a, b) => comparar(a.k, b.k, "asc") || (colador ? colador.compare(a.texto, b.texto) : 0))
        .map(({ texto: t, n }) => ({ texto: t, n }));
    },
    [linhas, texto],
  );

  const alternar = useCallback((coluna: string) => {
    setOrdem((o) => (!o || o.coluna !== coluna ? { coluna, sentido: "asc" } : o.sentido === "asc" ? { coluna, sentido: "desc" } : null));
  }, []);

  return {
    linhas: visiveis,
    total: linhas.length,
    ordem,
    alternar,
    escolher: setOrdem,
    escondidos: (coluna) => new Set(escondidosPorColuna[coluna] ?? []),
    esconder: (coluna, valores) =>
      setEscondidos((e) => {
        const { [coluna]: _, ...resto } = e;
        return valores.size ? { ...resto, [coluna]: [...valores] } : resto;
      }),
    filtrosAtivos: filtros.length,
    limparFiltros: () => setEscondidos({}),
    opcoesDe,
  };
}

/** O `aria-sort` de um cabeçalho. */
export const ariaSort = (ordem: Ordem, coluna: string): "ascending" | "descending" | "none" =>
  ordem?.coluna === coluna ? (ordem.sentido === "asc" ? "ascending" : "descending") : "none";

/* -------------------------------------------------------------------------- */
/* O cabeçalho e o menu                                                         */
/* -------------------------------------------------------------------------- */

function Seta({ desc }: { desc?: boolean }) {
  return (
    <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden style={{ flex: "none", transform: desc ? "rotate(180deg)" : undefined }}>
      <path d="M6 2.5 9.5 7h-7L6 2.5Z" fill="currentColor" />
    </svg>
  );
}

function Funil() {
  return (
    <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden style={{ flex: "none" }}>
      <path d="M1.5 2h9L7 6.2V10L5 9V6.2L1.5 2Z" fill="currentColor" />
    </svg>
  );
}

function Abrir() {
  return (
    <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden style={{ flex: "none" }} className="opacity-0 transition-opacity group-hover:opacity-60 group-focus-visible:opacity-60">
      <path d="M3 4.5 6 7.5l3-3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * O cabeçalho de uma coluna: o nome, a seta da ordem e o funil do filtro, e o
 * menu ao clicar. Vai dentro do `<th>`; o `<th>` leva o `aria-sort`.
 */
export function Coluna<T>({
  t,
  coluna,
  direita = false,
  children,
}: {
  t: Tabela<T>;
  coluna: string;
  /** Numa coluna alinhada à direita, a seta fica do lado de dentro e o menu abre para a esquerda. */
  direita?: boolean;
  children: ReactNode;
}) {
  const [aberto, setAberto] = useState(false);
  const botao = useRef<HTMLButtonElement>(null);
  const ativa = t.ordem?.coluna === coluna;
  const filtrada = t.escondidos(coluna).size > 0;
  const nome = textoDe(children) || coluna;

  return (
    <>
      <button
        ref={botao}
        type="button"
        onClick={() => setAberto((a) => !a)}
        aria-haspopup="dialog"
        aria-expanded={aberto}
        title={`Ordenar e filtrar por ${nome}`}
        className={`group inline-flex items-center gap-1 rounded-sm font-[inherit] hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 ${direita ? "flex-row-reverse" : ""} ${ativa || filtrada || aberto ? "text-ink" : ""}`}
      >
        {children}
        {ativa && <Seta desc={t.ordem?.sentido === "desc"} />}
        {filtrada && (
          <span style={{ color: "var(--color-signal, currentColor)" }}>
            <Funil />
          </span>
        )}
        {!ativa && !filtrada && <Abrir />}
      </button>
      {aberto && botao.current && <MenuDaColuna t={t} coluna={coluna} nome={nome} ancora={botao.current} direita={direita} fechar={() => setAberto(false)} />}
    </>
  );
}

function MenuDaColuna<T>({
  t,
  coluna,
  nome,
  ancora,
  direita,
  fechar,
}: {
  t: Tabela<T>;
  coluna: string;
  nome: string;
  ancora: HTMLElement;
  direita: boolean;
  fechar: () => void;
}) {
  const caixa = useRef<HTMLDivElement>(null);
  const [busca, setBusca] = useState("");
  const [pos, setPos] = useState<{ top: number; left: number; maxH: number } | null>(null);
  const escondidos = t.escondidos(coluna);
  /*
   * Os marcados primeiro, os desmarcados por baixo, à vista para se voltarem a
   * marcar. A ordem decide-se ao abrir o menu e não muda enquanto está aberto:
   * com cada clique a puxar a linha para cima, a lista saltava debaixo do rato.
   */
  const [marcadosAoAbrir] = useState(() => new Set(t.opcoesDe(coluna).filter((o) => !escondidos.has(o.texto)).map((o) => o.texto)));
  const opcoes = useMemo(() => {
    const todas = t.opcoesDe(coluna);
    return [...todas.filter((o) => marcadosAoAbrir.has(o.texto)), ...todas.filter((o) => !marcadosAoAbrir.has(o.texto))];
  }, [t, coluna, marcadosAoAbrir]);
  const q = semAcentos(busca.trim());
  const vistas = q ? opcoes.filter((o) => semAcentos(o.texto || "(vazio)").includes(q)) : opcoes;
  const LARGURA = 264;

  // Por baixo do cabeçalho, sem sair do ecrã; num cabeçalho encostado à direita, alinha pela direita.
  useLayoutEffect(() => {
    const r = ancora.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    const left = Math.max(8, Math.min(direita ? r.right - LARGURA : r.left - 8, vw - LARGURA - 8));
    const top = Math.min(r.bottom + 6, vh - 160);
    setPos({ top, left, maxH: Math.max(160, vh - top - 12) });
  }, [ancora, direita]);

  // Fecha ao clicar fora, com Escape e quando a página rola ou muda de tamanho (o menu ficava longe do cabeçalho).
  useEffect(() => {
    const fora = (e: MouseEvent | TouchEvent) => {
      const alvo = e.target as Node;
      if (!caixa.current?.contains(alvo) && !ancora.contains(alvo)) fechar();
    };
    const tecla = (e: KeyboardEvent) => e.key === "Escape" && (fechar(), ancora.focus());
    const rolou = (e: Event) => {
      if (caixa.current && e.target instanceof Node && caixa.current.contains(e.target)) return;
      fechar();
    };
    document.addEventListener("mousedown", fora);
    document.addEventListener("touchstart", fora);
    document.addEventListener("keydown", tecla);
    window.addEventListener("scroll", rolou, true);
    window.addEventListener("resize", fechar);
    return () => {
      document.removeEventListener("mousedown", fora);
      document.removeEventListener("touchstart", fora);
      document.removeEventListener("keydown", tecla);
      window.removeEventListener("scroll", rolou, true);
      window.removeEventListener("resize", fechar);
    };
  }, [ancora, fechar]);

  const ordenar = (sentido: Sentido) => {
    t.escolher(t.ordem?.coluna === coluna && t.ordem.sentido === sentido ? null : { coluna, sentido });
    fechar();
  };
  const alternarValor = (texto: string) => {
    const n = new Set(escondidos);
    if (n.has(texto)) n.delete(texto);
    else n.add(texto);
    t.esconder(coluna, n);
  };
  // "Todos" mexe só nos que a procura mostra: procurar "Sub" e desmarcar esconde os Sub-qualquer coisa, mais nada.
  const todasVistas = vistas.length > 0 && vistas.every((o) => !escondidos.has(o.texto));
  const algumasVistas = !todasVistas && vistas.some((o) => !escondidos.has(o.texto));
  const alternarTodas = () => {
    const n = new Set(escondidos);
    for (const o of vistas) {
      if (todasVistas) n.add(o.texto);
      else n.delete(o.texto);
    }
    t.esconder(coluna, n);
  };
  // Com uma procura escrita: mostrar só o que ela encontra (o "OK" do Excel depois de procurar).
  const soEstas = () => {
    const ver = new Set(vistas.map((o) => o.texto));
    t.esconder(coluna, new Set(opcoes.filter((o) => !ver.has(o.texto)).map((o) => o.texto)));
  };
  const ativo = (sentido: Sentido) => t.ordem?.coluna === coluna && t.ordem.sentido === sentido;

  if (!pos) return null;
  return createPortal(
    <div
      ref={caixa}
      role="dialog"
      aria-label={`Ordenar e filtrar por ${nome}`}
      data-versao-ignorar
      style={{ position: "fixed", top: pos.top, left: pos.left, width: LARGURA, maxHeight: pos.maxH, zIndex: 70 }}
      className="flex flex-col overflow-hidden rounded-[10px] border border-line bg-surface text-left text-[13px] font-normal text-ink normal-case shadow-[0_12px_32px_rgba(0,0,0,0.16)]"
    >
      <div className="grid grid-cols-2 gap-1 border-b border-line p-1.5">
        {(
          [
            ["asc", "Ascendente", false],
            ["desc", "Descendente", true],
          ] as const
        ).map(([s, rotulo, desc]) => (
          <button
            key={s}
            type="button"
            onClick={() => ordenar(s)}
            aria-pressed={ativo(s)}
            className={`flex items-center justify-center gap-1.5 rounded-[7px] px-2 py-1.5 font-medium ${ativo(s) ? "bg-ink text-surface" : "text-ink-2 hover:bg-sunken"}`}
          >
            <Seta desc={desc} />
            {rotulo}
          </button>
        ))}
      </div>

      <div className="border-b border-line p-1.5">
        <input
          type="search"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Pesquisar…"
          aria-label={`Pesquisar valores de ${nome}`}
          autoFocus
          // 16 px no telemóvel: abaixo disso o iPhone faz zoom à página ao tocar no campo.
          className="h-9 w-full rounded-[7px] border border-line bg-surface px-2.5 text-[16px] text-ink outline-none placeholder:text-ink-4 focus:border-ink-3 sm:h-8 sm:text-[13px]"
        />
      </div>

      {/* A lista segura o foco da pesquisa: no telemóvel, fechar o teclado a meio do toque fazia o toque cair noutra linha. */}
      <div className="min-h-0 flex-1 overflow-y-auto py-1" onMouseDown={(e) => e.preventDefault()}>
        {vistas.length === 0 ? (
          <p className="px-3 py-3 text-ink-3">Nenhum valor com “{busca}”.</p>
        ) : (
          <>
            <label className="flex cursor-pointer items-center gap-2 px-3 py-1.5 font-medium hover:bg-sunken">
              <input
                type="checkbox"
                checked={todasVistas}
                ref={(el) => {
                  if (el) el.indeterminate = algumasVistas;
                }}
                onChange={alternarTodas}
                className="size-3.5 shrink-0"
                style={{ accentColor: "var(--color-signal, currentColor)" }}
              />
              <span className="min-w-0 flex-1">{q ? "Todos os resultados" : "Selecionar tudo"}</span>
            </label>
            {vistas.map((o, i) => (
              <label
                key={o.texto}
                className={`flex cursor-pointer items-center gap-2 px-3 py-1.5 hover:bg-sunken ${
                  // A linha entre os que estavam marcados ao abrir e os outros.
                  i > 0 && marcadosAoAbrir.has(vistas[i - 1].texto) && !marcadosAoAbrir.has(o.texto) ? "border-t border-line" : ""
                }`}
              >
                <input
                  type="checkbox"
                  checked={!escondidos.has(o.texto)}
                  onChange={() => alternarValor(o.texto)}
                  className="size-3.5 shrink-0"
                  style={{ accentColor: "var(--color-signal, currentColor)" }}
                />
                <span className={`min-w-0 flex-1 truncate ${o.texto ? "" : "text-ink-3 italic"}`}>{o.texto || "(vazio)"}</span>
                <span className="shrink-0 text-[11.5px] tabular-nums text-ink-4">{o.n}</span>
              </label>
            ))}
          </>
        )}
      </div>

      {(q && vistas.length > 0) || escondidos.size > 0 ? (
        <div className="flex items-center justify-between gap-2 border-t border-line px-2 py-1.5">
          {q && vistas.length > 0 ? (
            <button type="button" onClick={soEstas} className="rounded-[7px] px-2 py-1 font-medium text-ink-2 hover:bg-sunken">
              Mostrar só estes ({vistas.length})
            </button>
          ) : (
            <span />
          )}
          {escondidos.size > 0 && (
            <button type="button" onClick={() => t.esconder(coluna, new Set())} className="rounded-[7px] px-2 py-1 font-medium text-ink-2 hover:bg-sunken">
              Limpar filtro
            </button>
          )}
        </div>
      ) : null}
    </div>,
    document.body,
  );
}

/**
 * A linha por cima da tabela quando há filtros: quantas se veem de quantas, e
 * o botão para tirar todos. Sem ela, uma tabela filtrada parecia ter perdido
 * linhas (e o filtro fica lembrado ao voltar à página).
 */
export function BarraDeFiltros<T>({ t, className = "" }: { t: Tabela<T>; className?: string }) {
  if (!t.filtrosAtivos) return null;
  return (
    <div className={`flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2 text-[13px] text-ink-3 ${className}`}>
      <span className="inline-flex items-center gap-1.5">
        <span style={{ color: "var(--color-signal, currentColor)" }}>
          <Funil />
        </span>
        A mostrar {t.linhas.length} de {t.total} · {t.filtrosAtivos} {t.filtrosAtivos === 1 ? "filtro" : "filtros"}
      </span>
      <button type="button" onClick={t.limparFiltros} className="font-medium text-ink-2 hover:text-ink hover:underline">
        Limpar filtros
      </button>
    </div>
  );
}

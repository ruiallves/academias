import { Children, Fragment, isValidElement, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Search } from "@/lib/icons";
import { useMobile } from "@/lib/viewport";
import { cx } from "./primitives";

/**
 * Os menus de escolher da consola, com pesquisa.
 *
 * ## Porque deixou de ser o `<select>` do sistema
 *
 * O menu do sistema não deixa escrever para procurar. Com doze tamanhos, trinta
 * artigos ou oitenta atletas, achar uma opção era rolar a lista à procura dela
 * (pedido do Rui a 15/11/2026, a partir dos filtros do Inventário: "todos esses
 * tipos de dropdowns deviam ter pesquisa"). Este menu abre com um campo de
 * procura em cima sempre que a lista tem mais de `LIMIAR` opções; nas curtas
 * (sim/não, três estados) o campo seria só mais uma caixa no caminho.
 *
 * ## O que guarda do menu do sistema
 *
 *   - o teclado: setas, Enter, Escape, Home/End, e escrever para procurar
 *     (com o menu fechado, uma letra abre-o já com essa letra na procura);
 *   - a semântica para leitores de ecrã (`combobox` + `listbox`);
 *   - no telemóvel, uma folha no fundo do ecrã, como a roda do sistema,
 *     sem abrir o teclado sozinha (a procura está lá para quem a quiser).
 *
 * ## Os cuidados
 *
 *   - Abre num portal, por cima de tudo: dentro de um diálogo com rolagem o
 *     menu não fica cortado.
 *   - A lista segura o foco no campo de procura (`preventDefault` no
 *     `mousedown`), pela mesma razão de `ListaDeEscolha`: no telemóvel, perder
 *     o foco fecha o teclado e a página salta debaixo do dedo.
 *   - Os cliques não sobem pela árvore do React: um menu numa linha clicável
 *     não abre a linha.
 *   - O Escape fecha o menu e não o diálogo onde ele está.
 *
 * Duas portas para o mesmo menu: `Escolha`, que aceita os mesmos filhos e o
 * mesmo `onChange` do `<select>` (foi assim que os menus antigos mudaram sem
 * se reescreverem), e `SelectField`, em `primitives.tsx`, com as opções numa
 * lista.
 */

/** A partir de quantas opções aparece o campo de procura. */
export const LIMIAR = 6;

export type OpcaoDeEscolha = { value: string; label: string; disabled?: boolean; grupo?: string };

const fold = (v: string) => v.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

/** Todas as palavras escritas têm de aparecer, por qualquer ordem e sem acentos. */
function bate(label: string, q: string): boolean {
  const alvo = fold(label);
  return fold(q)
    .split(/\s+/)
    .filter(Boolean)
    .every((p) => alvo.includes(p));
}

/* -------------------------------------------------------------------------- */
/* O menu                                                                       */
/* -------------------------------------------------------------------------- */

export function MenuDeEscolha({
  value,
  opcoes,
  onEscolher,
  className,
  conteudo,
  disabled,
  id,
  name,
  title,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  pesquisa,
  autoFocus,
}: {
  value: string;
  opcoes: OpcaoDeEscolha[];
  onEscolher: (v: string) => void;
  /** As classes do botão (a caixa fechada). */
  className?: string;
  /** O que o botão mostra; por omissão, o rótulo da opção escolhida e a seta. */
  conteudo?: (rotulo: string, aberto: boolean) => ReactNode;
  disabled?: boolean;
  id?: string;
  name?: string;
  title?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  /** Forçar (ou tirar) o campo de procura; por omissão, só com mais de `LIMIAR` opções. */
  pesquisa?: boolean;
  /** Como no `<select>`: a caixa fica com o foco ao aparecer. */
  autoFocus?: boolean;
}) {
  const [aberto, setAberto] = useState(false);
  const [q, setQ] = useState("");
  const [ativa, setAtiva] = useState(-1);
  const botao = useRef<HTMLButtonElement>(null);
  const caixa = useRef<HTMLDivElement>(null);
  const campo = useRef<HTMLInputElement>(null);
  const lista = useRef<HTMLUListElement>(null);
  const [pos, setPos] = useState<{ top?: number; bottom?: number; left: number; width: number; maxH: number } | null>(null);
  const pequeno = useMobile();
  const idBase = useId();
  const idLista = `${idBase}-lista`;

  const comPesquisa = pesquisa ?? opcoes.length > LIMIAR;
  const escolhida = opcoes.find((o) => o.value === value);
  // Um valor que não está nas opções não passa por outro: mostra-se um traço (era a regra do `<select>`, ver a nota em `SelectField`).
  const rotulo = escolhida ? escolhida.label : value === "" ? "—" : value;

  const filtradas = useMemo(() => (q.trim() ? opcoes.filter((o) => bate(o.label, q) || bate(o.grupo ?? "", q)) : opcoes), [opcoes, q]);
  const ativaValida = (i: number) => i >= 0 && i < filtradas.length && !filtradas[i].disabled;

  const posicionar = useCallback(() => {
    const r = botao.current?.getBoundingClientRect();
    if (!r) return;
    const vh = window.innerHeight;
    const vw = window.innerWidth;
    const width = Math.min(Math.max(r.width, 220), 380, vw - 16);
    const left = Math.min(Math.max(8, r.left), vw - width - 8);
    const baixo = vh - r.bottom - 12;
    const cima = r.top - 12;
    if (baixo < 260 && cima > baixo) setPos({ bottom: vh - r.top + 4, left, width, maxH: Math.min(360, cima) });
    else setPos({ top: r.bottom + 4, left, width, maxH: Math.min(360, baixo) });
  }, []);

  const abrir = (inicial = "") => {
    if (disabled) return;
    setQ(inicial);
    const i = opcoes.findIndex((o) => o.value === value);
    setAtiva(inicial ? -1 : i);
    posicionar();
    setAberto(true);
  };

  const fechar = (devolverFoco = true) => {
    setAberto(false);
    setQ("");
    if (devolverFoco) botao.current?.focus();
  };

  const escolher = (o: OpcaoDeEscolha) => {
    if (o.disabled) return;
    if (o.value !== value) onEscolher(o.value);
    fechar();
  };

  // Ao abrir: o foco vai para a procura (no computador) ou para a lista; a escolhida fica à vista.
  useLayoutEffect(() => {
    if (!aberto) return;
    if (comPesquisa && !pequeno) campo.current?.focus();
    else lista.current?.focus();
    const atual = lista.current?.querySelector('[aria-selected="true"]') as HTMLElement | null;
    atual?.scrollIntoView({ block: "nearest" });
  }, [aberto, comPesquisa, pequeno]);

  // A procura mudou: a primeira que serve fica ativa.
  useEffect(() => {
    if (!aberto || !q.trim()) return;
    setAtiva(filtradas.findIndex((o) => !o.disabled));
  }, [q, aberto, filtradas]);

  // A ativa fica à vista enquanto se anda com as setas.
  useEffect(() => {
    if (!aberto || ativa < 0) return;
    const el = document.getElementById(`${idBase}-op-${ativa}`);
    el?.scrollIntoView({ block: "nearest" });
  }, [ativa, aberto, idBase]);

  // Fora do menu fecha; rolar ou mudar o tamanho da janela reposiciona.
  useEffect(() => {
    if (!aberto) return;
    const fora = (ev: MouseEvent | TouchEvent) => {
      const t = ev.target as Node;
      if (caixa.current?.contains(t) || botao.current?.contains(t)) return;
      fechar(false);
    };
    const mexeu = (ev: Event) => {
      if (caixa.current?.contains(ev.target as Node)) return; // rolar a própria lista
      posicionar();
    };
    document.addEventListener("mousedown", fora);
    document.addEventListener("touchstart", fora);
    window.addEventListener("scroll", mexeu, true);
    window.addEventListener("resize", posicionar);
    return () => {
      document.removeEventListener("mousedown", fora);
      document.removeEventListener("touchstart", fora);
      window.removeEventListener("scroll", mexeu, true);
      window.removeEventListener("resize", posicionar);
    };
    // `fechar` muda a cada render e não precisa de reinstalar os ouvintes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto, posicionar]);

  const andar = (passo: 1 | -1, desde = ativa) => {
    if (filtradas.length === 0) return;
    let i = desde;
    for (let n = 0; n < filtradas.length; n++) {
      i = (i + passo + filtradas.length) % filtradas.length;
      if (!filtradas[i].disabled) break;
    }
    setAtiva(i);
  };

  const teclaNoMenu = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        andar(1);
        break;
      case "ArrowUp":
        e.preventDefault();
        andar(-1);
        break;
      case "Home":
        if (e.target === campo.current) return;
        e.preventDefault();
        andar(1, -1);
        break;
      case "End":
        if (e.target === campo.current) return;
        e.preventDefault();
        andar(-1, filtradas.length);
        break;
      case "Enter":
        e.preventDefault();
        if (ativaValida(ativa)) escolher(filtradas[ativa]);
        break;
      case "Escape":
        // Fecha o menu, não o diálogo onde ele vive (o diálogo ouve o Escape no documento).
        e.preventDefault();
        e.stopPropagation();
        fechar();
        break;
      case "Tab":
        fechar(false);
        break;
      default:
        // Sem campo de procura, uma letra salta para a primeira opção que começa por ela.
        if (!comPesquisa && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          const l = fold(e.key);
          const depois = filtradas.findIndex((o, i) => i > ativa && !o.disabled && fold(o.label).startsWith(l));
          const i = depois >= 0 ? depois : filtradas.findIndex((o) => !o.disabled && fold(o.label).startsWith(l));
          if (i >= 0) setAtiva(i);
        }
    }
  };

  const teclaNoBotao = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (aberto) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      abrir();
    } else if (comPesquisa && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // Escrever com o menu fechado abre-o já a procurar.
      e.preventDefault();
      abrir(e.key);
    }
  };

  /* As opções, com os grupos (os `<optgroup>`) como cabeçalhos. */
  const linhas: ReactNode[] = [];
  let grupoAtual: string | undefined;
  filtradas.forEach((o, i) => {
    if (o.grupo !== grupoAtual) {
      grupoAtual = o.grupo;
      if (o.grupo) {
        linhas.push(
          <li key={`g-${i}`} role="presentation" className="px-2.5 pt-2.5 pb-1 text-[11px] font-semibold tracking-wide text-ink-4 uppercase">
            {o.grupo}
          </li>,
        );
      }
    }
    const sel = o.value === value;
    linhas.push(
      <li
        key={`${o.value}-${i}`}
        id={`${idBase}-op-${i}`}
        role="option"
        aria-selected={sel}
        aria-disabled={o.disabled || undefined}
        onMouseEnter={() => !o.disabled && setAtiva(i)}
        onClick={() => escolher(o)}
        className={cx(
          // Letra de meta (12px) e linhas de 32px: com text-body as opções ficavam maiores do que a caixa
          // fechada (pedido do Rui a 15/11). No telemóvel a linha continua com 44px para o dedo.
          "flex min-h-8 cursor-pointer items-center gap-2 rounded-[6px] px-2.5 py-1 text-meta max-md:min-h-11 max-md:text-body",
          o.disabled ? "cursor-default text-ink-4" : i === ativa ? "bg-sunken text-ink" : "text-ink-2",
          sel && "font-medium text-ink",
        )}
      >
        <span className="min-w-0 flex-1 truncate">{o.label}</span>
        {sel && <Check className="size-3.5 shrink-0 text-ink" strokeWidth={2} />}
      </li>,
    );
  });

  const corpo = (
    <>
      {comPesquisa && (
        <div className="relative border-b border-line p-1.5">
          <Search className="pointer-events-none absolute top-1/2 left-4 size-3.5 -translate-y-1/2 text-ink-4" strokeWidth={1.75} />
          <input
            ref={campo}
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Procurar…"
            aria-label={`Procurar em ${ariaLabel ?? "opções"}`}
            aria-controls={idLista}
            aria-activedescendant={ativaValida(ativa) ? `${idBase}-op-${ativa}` : undefined}
            autoComplete="off"
            className="h-8 w-full rounded-[6px] bg-sunken/60 pr-2 pl-8 text-meta text-ink placeholder:text-ink-4 focus:outline-none max-md:h-11 max-md:text-body"
          />
        </div>
      )}
      <ul
        ref={lista}
        id={idLista}
        role="listbox"
        tabIndex={-1}
        aria-label={ariaLabel}
        aria-activedescendant={!comPesquisa && ativaValida(ativa) ? `${idBase}-op-${ativa}` : undefined}
        // Segura o foco no campo de procura: ver `ListaDeEscolha`.
        onMouseDown={(e) => e.preventDefault()}
        className="overflow-y-auto overscroll-contain p-1 focus:outline-none"
        style={pequeno ? undefined : { maxHeight: Math.max(160, (pos?.maxH ?? 320) - (comPesquisa ? 50 : 0)) }}
      >
        {linhas.length > 0 ? linhas : <li className="px-2.5 py-3 text-meta text-ink-3">Nada com «{q.trim()}».</li>}
      </ul>
    </>
  );

  return (
    <>
      <button
        ref={botao}
        type="button"
        id={id}
        title={title}
        disabled={disabled}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={aberto}
        aria-controls={aberto ? idLista : undefined}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        autoFocus={autoFocus}
        onClick={() => (aberto ? fechar() : abrir())}
        onKeyDown={teclaNoBotao}
        className={className}
      >
        {conteudo ? (
          conteudo(rotulo, aberto)
        ) : (
          <span className="flex min-w-0 items-center gap-2">
            <span className={cx("min-w-0 flex-1 truncate text-left", !escolhida && "text-ink-4")}>{rotulo}</span>
            {/* Na cor do texto, mais suave: cinzenta num campo normal, clara numa barra escura, verde num estado verde. */}
            <ChevronDown className={cx("size-3.5 shrink-0 opacity-60 transition-transform duration-[120ms]", aberto && "rotate-180")} strokeWidth={2} />
          </span>
        )}
      </button>
      {name && <input type="hidden" name={name} value={value} />}

      {aberto &&
        createPortal(
          pequeno ? (
            // Telemóvel: uma folha no fundo do ecrã, como a roda do sistema.
            <div
              className="fixed inset-0 z-[70] flex items-end bg-ink/20"
              onMouseDown={(e) => {
                e.stopPropagation();
                if (e.target === e.currentTarget) fechar(false);
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div
                ref={caixa}
                onKeyDown={teclaNoMenu}
                className="flex max-h-[70dvh] w-full flex-col overflow-hidden rounded-t-[20px] border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] shadow-[var(--shadow-pop)]"
              >
                {ariaLabel && <p className="border-b border-line px-4 py-3 text-panel text-ink">{ariaLabel}</p>}
                {corpo}
              </div>
            </div>
          ) : (
            <div
              ref={caixa}
              onKeyDown={teclaNoMenu}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              className="fixed z-[70] flex flex-col overflow-hidden rounded-[10px] border border-line bg-surface shadow-[var(--shadow-pop)]"
              style={pos ? { top: pos.top, bottom: pos.bottom, left: pos.left, width: pos.width, maxHeight: pos.maxH } : { visibility: "hidden" }}
            >
              {corpo}
            </div>
          ),
          document.body,
        )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Escolha: o mesmo menu, com a forma do <select>                               */
/* -------------------------------------------------------------------------- */

/** O texto de uns filhos do React ("Tamanho ", "M" → "Tamanho M"). */
function texto(n: ReactNode): string {
  if (n === null || n === undefined || typeof n === "boolean") return "";
  if (typeof n === "string" || typeof n === "number") return String(n);
  if (Array.isArray(n)) return n.map(texto).join("");
  if (isValidElement<{ children?: ReactNode }>(n)) return texto(n.props.children);
  return "";
}

/** As `<option>` e `<optgroup>` escritas como filhos, numa lista. */
function opcoesDosFilhos(filhos: ReactNode, grupo?: string): OpcaoDeEscolha[] {
  const out: OpcaoDeEscolha[] = [];
  Children.forEach(filhos, (f) => {
    if (!isValidElement<Record<string, unknown>>(f)) return;
    if (f.type === Fragment) {
      out.push(...opcoesDosFilhos(f.props.children as ReactNode, grupo));
    } else if (f.type === "optgroup") {
      out.push(...opcoesDosFilhos(f.props.children as ReactNode, String(f.props.label ?? "")));
    } else if (f.type === "option") {
      const label = texto(f.props.children as ReactNode);
      const v = f.props.value;
      out.push({ value: v === undefined || v === null ? label : String(v), label, disabled: Boolean(f.props.disabled), grupo });
    }
  });
  return out;
}

/** O que os menus antigos liam do evento do `<select>`: `e.target.value`. */
export type MudancaDeEscolha = { target: { value: string }; currentTarget: { value: string } };

/**
 * O menu com pesquisa, escrito como um `<select>`: os mesmos filhos
 * (`<option>`, `<optgroup>`), o mesmo `onChange` com `e.target.value`, as
 * mesmas classes na caixa. Foi assim que os 116 `<select>` da consola mudaram
 * sem se reescrever (15/11/2026).
 */
export function Escolha({
  value,
  onChange,
  children,
  className,
  disabled,
  id,
  name,
  title,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  pesquisa,
  autoFocus,
}: {
  value: string | number | undefined | null;
  onChange?: (e: MudancaDeEscolha) => void;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  id?: string;
  name?: string;
  title?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  pesquisa?: boolean;
  autoFocus?: boolean;
}) {
  const opcoes = useMemo(() => opcoesDosFilhos(children), [children]);
  const atual = value === undefined || value === null ? "" : String(value);
  return (
    <MenuDeEscolha
      value={atual}
      opcoes={opcoes}
      onEscolher={(v) => onChange?.({ target: { value: v }, currentTarget: { value: v } })}
      // A caixa leva as classes que o `<select>` levava; o resto (texto à esquerda, cursor) é do menu.
      className={cx("cursor-pointer text-left disabled:cursor-not-allowed disabled:opacity-60", className)}
      disabled={disabled}
      id={id}
      name={name}
      title={title}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      pesquisa={pesquisa}
      autoFocus={autoFocus}
    />
  );
}

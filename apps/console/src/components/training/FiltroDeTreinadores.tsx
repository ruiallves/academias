import { useEffect, useMemo, useRef, useState } from "react";
import { ListaDeEscolha, cx } from "@/components/primitives";
import { Check, ChevronDown, Search } from "@/lib/icons";

/** Um treinador que criou exercícios nesta biblioteca. */
export type TreinadorDaBiblioteca = {
  id: string;
  name: string;
  /** Os escalões que treina hoje. Vazio para quem não treina nenhuma equipa (direção, coordenação). */
  teams: string[];
  /** Quantos exercícios criou, nesta modalidade. */
  count: number;
};

/**
 * Escolher de que treinadores se querem ver os exercícios.
 *
 * Um botão que abre uma lista com a caixa de pesquisa no topo; cada linha tem o
 * nome, os escalões que treina e quantos exercícios criou, e escolhem-se
 * vários. Nada escolhido é "todos".
 *
 * A lista é uma `ListaDeEscolha` para o campo de pesquisa não perder o foco ao
 * tocar numa linha: no telemóvel isso fecha o teclado, a lista salta, e o toque
 * cai na linha errada. Ver `check:toque`.
 */
export function FiltroDeTreinadores({
  treinadores,
  escolhidos,
  onChange,
}: {
  treinadores: TreinadorDaBiblioteca[];
  escolhidos: Set<string>;
  onChange: (novo: Set<string>) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [q, setQ] = useState("");
  const raiz = useRef<HTMLDivElement>(null);

  /* Fecha ao tocar fora e com Escape. */
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: PointerEvent) => {
      if (raiz.current && !raiz.current.contains(e.target as Node)) setAberto(false);
    };
    const tecla = (e: KeyboardEvent) => e.key === "Escape" && setAberto(false);
    document.addEventListener("pointerdown", fora);
    document.addEventListener("keydown", tecla);
    return () => {
      document.removeEventListener("pointerdown", fora);
      document.removeEventListener("keydown", tecla);
    };
  }, [aberto]);

  const needle = q.trim().toLowerCase();
  const visiveis = useMemo(
    () =>
      needle
        ? treinadores.filter((t) => t.name.toLowerCase().includes(needle) || t.teams.some((e) => e.toLowerCase().includes(needle)))
        : treinadores,
    [treinadores, needle],
  );

  const alternar = (id: string) => {
    const novo = new Set(escolhidos);
    if (novo.has(id)) novo.delete(id);
    else novo.add(id);
    onChange(novo);
  };

  const rotulo =
    escolhidos.size === 0
      ? "Todas as pessoas"
      : escolhidos.size === 1
        ? (treinadores.find((t) => escolhidos.has(t.id))?.name ?? "1 pessoa")
        : `${escolhidos.size} pessoas`;

  return (
    <div ref={raiz} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={aberto}
        onClick={() => setAberto((v) => !v)}
        className={cx(
          "inline-flex h-8 max-w-[220px] items-center gap-1.5 rounded-[var(--radius-control)] border bg-surface px-2.5 text-meta transition-colors",
          escolhidos.size > 0 ? "border-ink-3 text-ink" : "border-line text-ink-2 hover:border-line-strong",
        )}
      >
        <span className="truncate">{rotulo}</span>
        <ChevronDown className="size-3.5 shrink-0 text-ink-4" strokeWidth={1.75} />
      </button>

      {aberto && (
        <div className="absolute top-full right-0 z-30 mt-1 w-[300px] max-w-[calc(100vw-32px)] overflow-hidden rounded-[var(--radius-control)] border border-line bg-surface shadow-lg">
          <div className="relative border-b border-line">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-4" strokeWidth={1.75} />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Procurar pessoa ou escalão…"
              aria-label="Procurar pessoa"
              className="h-9 w-full bg-transparent pr-2.5 pl-8 text-meta text-ink placeholder:text-ink-4 focus:outline-none"
            />
          </div>

          <ListaDeEscolha role="listbox" aria-multiselectable className="max-h-[300px] overflow-y-auto py-1">
            {visiveis.length === 0 && (
              <li className="px-3 py-3 text-center text-meta text-ink-3">
                {treinadores.length === 0 ? "Ainda ninguém criou exercícios." : "Ninguém com esse nome."}
              </li>
            )}
            {visiveis.map((t) => {
              const on = escolhidos.has(t.id);
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={on}
                    onClick={() => alternar(t.id)}
                    className={cx("flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-sunken", on && "bg-signal-soft/30")}
                  >
                    <span
                      aria-hidden
                      className={cx(
                        "flex size-4 shrink-0 items-center justify-center rounded-[4px] border",
                        on ? "border-signal-strong bg-signal-strong text-white" : "border-line-strong",
                      )}
                    >
                      {on && <Check className="size-3" strokeWidth={2.5} />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body text-ink">{t.name}</span>
                      <span className="block truncate text-[11px] text-ink-3">
                        {t.teams.length > 0 ? t.teams.join(" · ") : "Sem escalão"}
                      </span>
                    </span>
                    <span className="shrink-0 text-[11px] text-ink-4 tabular">{t.count}</span>
                  </button>
                </li>
              );
            })}
          </ListaDeEscolha>

          {escolhidos.size > 0 && (
            <div className="flex items-center justify-between border-t border-line px-3 py-1.5">
              <span className="text-[11px] text-ink-3">
                {escolhidos.size} {escolhidos.size === 1 ? "escolhido" : "escolhidos"}
              </span>
              <button type="button" onClick={() => onChange(new Set())} className="text-[11px] font-medium text-ink-2 hover:text-ink">
                Limpar
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

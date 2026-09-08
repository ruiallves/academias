import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown, Search, X } from "@/lib/icons";
import { cx } from "./primitives";

/**
 * Escolher vários de uma lista — com pesquisa, e o que já se escolheu à vista.
 *
 * ## O que isto substitui, e porquê
 *
 * Um `<select>` de um só (não dizia "dois balneários") e, depois, uma fila de
 * chips que se ligavam e desligavam. A fila resolvia o "vários" e trazia dois
 * problemas próprios: com doze balneários ocupava meio diálogo, e não havia
 * como procurar — quem tem um pavilhão com vinte lê os vinte.
 *
 * Aqui a pergunta parte-se em duas, que é como ela realmente é: **o que já
 * escolhi** (fichas em cima, cada uma com o seu ✕) e **o que falta escolher**
 * (uma lista que se filtra à medida que se escreve).
 *
 * ## As decisões que não são de estilo
 *
 * - **Nunca dentro de um `<label>`.** Um `<button>` é um elemento *labelable*:
 *   um grupo destes dentro de um rótulo faz o clique na linha activar o
 *   primeiro botão — foi assim que tocar na linha marcava o balneário 1 sem
 *   ninguém lhe tocar. Daí o `fieldset`/`legend`.
 * - **O escolhido sai da lista.** A lista responde a "o que falta", não a "o
 *   que existe": deixar lá o que já está escolhido convida a clicar duas vezes
 *   no mesmo e a pensar que não funcionou.
 * - **`Backspace` com a caixa vazia tira o último.** É o gesto de qualquer
 *   campo de destinatários, e poupa apontar ao ✕.
 * - **Escolher fecha a lista.** O caso normal é escolher um; deixá-la aberta
 *   tapava os campos por baixo e obrigava a um clique fora para ver o que se
 *   tinha feito.
 * - **Teclado a sério**: setas para andar, `Enter` para escolher, `Escape` para
 *   fechar. Uma lista que só responde ao rato é uma lista que exclui metade de
 *   quem trabalha depressa.
 */
export function TokenPicker({
  label,
  hint,
  options,
  selected,
  onChange,
  placeholder = "Procurar…",
  emptyLabel = "Nenhum escolhido",
  /** Opções que já não existem no catálogo mas continuam guardadas no registo. */
  staleLabel = "já não está no catálogo",
}: {
  label: string;
  hint?: ReactNode;
  /** O que se pode escolher, pelo nome com que fica guardado. */
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  emptyLabel?: string;
  staleLabel?: string;
}) {
  const [procura, setProcura] = useState("");
  const [aberto, setAberto] = useState(false);
  const [activo, setActivo] = useState(0);
  const caixa = useRef<HTMLFieldSetElement>(null);
  const listboxId = useId();

  /* Fechar ao clicar fora — não ao perder o foco, que fecharia a cada clique
     numa opção antes de ela chegar a ser escolhida. */
  useEffect(() => {
    if (!aberto) return;
    function fora(e: PointerEvent) {
      if (caixa.current && !caixa.current.contains(e.target as Node)) setAberto(false);
    }
    document.addEventListener("pointerdown", fora);
    return () => document.removeEventListener("pointerdown", fora);
  }, [aberto]);

  const disponiveis = useMemo(() => {
    const q = normalizar(procura);
    return options.filter((o) => !selected.includes(o) && (q === "" || normalizar(o).includes(q)));
  }, [options, selected, procura]);

  // O índice activo não pode apontar para lá do fim depois de filtrar.
  const indice = Math.min(activo, Math.max(0, disponiveis.length - 1));

  function juntar(valor: string) {
    onChange([...selected, valor]);
    setProcura("");
    setActivo(0);
    /*
     * Escolher fecha a lista.
     *
     * Ficou aberta durante uma versão, a pensar em quem escolhe dois seguidos —
     * mas o caso normal é escolher um, e uma lista que fica aberta por cima do
     * resto do formulário tapa os campos seguintes e obriga a um clique fora
     * para se ver o que se fez. Quem quer o segundo reabre num toque; quem quer
     * um só não faz nada. A ficha que aparece por cima do campo é a confirmação
     * de que ficou escolhido.
     */
    setAberto(false);
  }

  function tirar(valor: string) {
    onChange(selected.filter((s) => s !== valor));
  }

  function teclas(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && procura === "" && selected.length > 0) {
      tirar(selected[selected.length - 1]);
      return;
    }
    if (e.key === "Escape") {
      setAberto(false);
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setAberto(true);
      setActivo((i) => {
        const n = disponiveis.length;
        if (n === 0) return 0;
        return e.key === "ArrowDown" ? (i + 1) % n : (i - 1 + n) % n;
      });
      return;
    }
    if (e.key === "Enter") {
      // Sem `preventDefault` isto submetia o formulário do diálogo inteiro.
      e.preventDefault();
      if (aberto && disponiveis[indice]) juntar(disponiveis[indice]);
      else setAberto(true);
    }
  }

  return (
    <fieldset ref={caixa} className="relative">
      <legend className="mb-1.5 flex w-full items-baseline justify-between gap-1.5">
        <span className="text-meta font-medium text-ink">{label}</span>
        {hint && <span className="text-[11px] text-ink-4">{hint}</span>}
      </legend>

      {/*
        O que já está escolhido vive **por cima do campo**, não dentro dele.

        Dentro da moldura, as fichas e a linha de pesquisa liam-se como uma
        coisa só e a caixa crescia a cada escolha — o campo saltava, e o que já
        estava escolhido misturava-se com o que se está a escrever. Cá fora são
        duas coisas com dois papéis: em cima o que **já ficou**, em baixo o que
        se está a **procurar**. A caixa fica sempre da mesma altura.
      */}
      {selected.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1">
          {selected.map((s) => {
            const desaparecido = !options.includes(s);
            return (
              <span
                key={s}
                className={cx(
                  "inline-flex items-center gap-1 rounded-full py-1 pr-1 pl-2.5 text-meta font-medium",
                  desaparecido ? "bg-warn-soft text-warn" : "bg-ink text-surface",
                )}
                title={desaparecido ? staleLabel : undefined}
              >
                {s}
                <button
                  type="button"
                  onClick={() => tirar(s)}
                  aria-label={`Tirar ${s}`}
                  className={cx(
                    "flex size-4 items-center justify-center rounded-full transition-colors duration-[120ms]",
                    desaparecido ? "hover:bg-warn/20" : "hover:bg-white/20",
                  )}
                >
                  <X className="size-3" strokeWidth={2.5} />
                </button>
              </span>
            );
          })}
        </div>
      )}

      <div
        className={cx(
          "rounded-[var(--radius-control)] border bg-surface px-1.5 py-1.5 transition-colors duration-[120ms]",
          aberto ? "border-line-strong" : "border-line",
        )}
      >
        <div className="flex items-center gap-1.5 px-1">
          <Search className="size-3.5 shrink-0 text-ink-4" strokeWidth={1.75} />
          <input
            value={procura}
            onChange={(e) => {
              setProcura(e.target.value);
              setAberto(true);
            }}
            onFocus={() => setAberto(true)}
            onKeyDown={teclas}
            placeholder={selected.length > 0 ? "Juntar outro…" : placeholder}
            role="combobox"
            aria-expanded={aberto}
            aria-controls={listboxId}
            aria-autocomplete="list"
            className="h-7 min-w-0 flex-1 bg-transparent text-body text-ink placeholder:text-ink-4 focus:outline-none"
          />
          <button
            type="button"
            onClick={() => setAberto((a) => !a)}
            aria-label={aberto ? "Fechar lista" : "Abrir lista"}
            className="flex size-6 shrink-0 items-center justify-center rounded-[6px] text-ink-4 hover:bg-sunken hover:text-ink-2"
          >
            <ChevronDown className={cx("size-3.5 transition-transform duration-[120ms]", aberto && "rotate-180")} strokeWidth={2} />
          </button>
        </div>
      </div>

      {aberto && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-52 w-full overflow-y-auto rounded-[var(--radius-control)] border border-line bg-surface py-1 shadow-[0_8px_24px_-12px_rgb(26_25_23/0.35)]"
        >
          {disponiveis.length === 0 ? (
            <li className="px-3 py-2 text-meta text-ink-3">
              {procura ? "Nada com esse nome." : "Já escolheste todos."}
            </li>
          ) : (
            disponiveis.map((o, i) => (
              <li key={o}>
                <button
                  type="button"
                  role="option"
                  aria-selected={i === indice}
                  onPointerEnter={() => setActivo(i)}
                  onClick={() => juntar(o)}
                  className={cx(
                    "flex w-full items-center gap-2 px-3 py-1.5 text-left text-body transition-colors duration-[80ms]",
                    i === indice ? "bg-sunken text-ink" : "text-ink-2",
                  )}
                >
                  <Check className={cx("size-3.5 shrink-0", i === indice ? "text-ink-3" : "text-transparent")} strokeWidth={2.5} />
                  {o}
                </button>
              </li>
            ))
          )}
        </ul>
      )}

      {/* O vazio diz-se: um evento sem balneário é normal, e quem olha para a
          linha em branco tem de saber que não se esqueceu de nada. */}
      {selected.length === 0 && <p className="mt-1.5 text-meta text-ink-3">{emptyLabel}</p>}
    </fieldset>
  );
}

/** Sem acentos e sem maiúsculas — "balneario" encontra "Balneário". */
function normalizar(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

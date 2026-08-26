import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search, X } from "@/lib/icons";
import { cx } from "./primitives";

export type Pessoa = { id: string; name: string; sub?: string };

/**
 * Escolher uma pessoa de uma lista, escrevendo o nome.
 *
 * ## Porque é que não é um `<select>`
 *
 * Um clube com quarenta pessoas na equipa técnica dá uma caixa com quarenta
 * linhas por onde se desce à roda do rato. Quem a abre já sabe o nome que quer —
 * escrever três letras é mais rápido do que procurar, e é o único gesto que
 * funciona igual num telemóvel e num portátil.
 *
 * ## O que faz e o que não faz
 *
 * Filtra por nome **e** pelo subtítulo (o cargo), sem acentos e sem maiúsculas:
 * quem escreve "fisio" encontra o Fisioterapeuta, e quem escreve "joao" encontra
 * o João. Não cria pessoas — se o nome não está na lista, não está na academia, e
 * inventá-lo aqui era criar uma pessoa a meio de outro formulário.
 */
export function PersonPicker({
  pessoas,
  value,
  onChange,
  placeholder = "Escrever um nome…",
  emptyLabel = "Por atribuir",
  disabled,
}: {
  pessoas: Pessoa[];
  /** O id escolhido, ou `""` para nenhum. */
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  /** O que se lê quando não há ninguém escolhido. */
  emptyLabel?: string;
  disabled?: boolean;
}) {
  const [aberto, setAberto] = useState(false);
  const [q, setQ] = useState("");
  const caixa = useRef<HTMLDivElement>(null);

  const escolhida = pessoas.find((p) => p.id === value);

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => {
      if (caixa.current && !caixa.current.contains(e.target as Node)) setAberto(false);
    };
    const escape = (e: KeyboardEvent) => e.key === "Escape" && setAberto(false);
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", fora);
      document.removeEventListener("keydown", escape);
    };
  }, [aberto]);

  const filtradas = useMemo(() => {
    const termo = semAcentos(q);
    if (!termo) return pessoas;
    return pessoas.filter((p) => semAcentos(p.name).includes(termo) || semAcentos(p.sub ?? "").includes(termo));
  }, [pessoas, q]);

  function escolher(id: string) {
    onChange(id);
    setAberto(false);
    setQ("");
  }

  return (
    <div ref={caixa} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setAberto((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={aberto}
        className={cx(
          "flex h-9 w-full items-center gap-2 rounded-[var(--radius-control)] border border-line bg-surface px-2.5 text-left transition-colors",
          disabled ? "opacity-50" : "hover:border-line-strong",
        )}
      >
        <span className={cx("min-w-0 flex-1 truncate text-body", escolhida ? "text-ink" : "text-ink-4")}>
          {escolhida?.name ?? emptyLabel}
        </span>
        {escolhida && !disabled && (
          /*
            Limpar sem abrir a lista.
            Um `<span>` e não um `<button>`: um botão dentro de um botão não é
            HTML válido, e o clique é apanhado aqui antes de chegar ao de fora.
          */
          <span
            role="button"
            tabIndex={0}
            aria-label="Tirar"
            onClick={(e) => {
              e.stopPropagation();
              escolher("");
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                escolher("");
              }
            }}
            className="shrink-0 rounded p-0.5 text-ink-4 hover:text-risk"
          >
            <X className="size-3.5" strokeWidth={2} />
          </span>
        )}
        <ChevronDown className={cx("size-4 shrink-0 text-ink-3 transition-transform", aberto && "rotate-180")} strokeWidth={1.75} />
      </button>

      {aberto && (
        <div className="absolute top-[calc(100%+4px)] right-0 left-0 z-50 overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface shadow-[var(--shadow-pop)]">
          <div className="flex items-center gap-1.5 border-b border-line px-2.5">
            <Search className="size-3.5 shrink-0 text-ink-3" strokeWidth={1.75} />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={placeholder}
              className="h-9 min-w-0 flex-1 bg-transparent text-body text-ink outline-none placeholder:text-ink-4"
            />
          </div>

          <ul role="listbox" className="max-h-[min(50vh,240px)] overflow-y-auto">
            <li>
              <Opcao label={emptyLabel} escolhida={value === ""} onClick={() => escolher("")} suave />
            </li>
            {filtradas.map((p) => (
              <li key={p.id}>
                <Opcao label={p.name} sub={p.sub} escolhida={p.id === value} onClick={() => escolher(p.id)} />
              </li>
            ))}
            {filtradas.length === 0 && (
              <li className="px-3 py-4 text-center text-meta text-ink-3">
                Ninguém com esse nome.
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

function Opcao({
  label,
  sub,
  escolhida,
  suave,
  onClick,
}: {
  label: string;
  sub?: string;
  escolhida: boolean;
  suave?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={escolhida}
      onClick={onClick}
      className="flex min-h-10 w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-sunken"
    >
      <span className="min-w-0 flex-1">
        <span className={cx("block truncate text-body", suave ? "text-ink-3" : "text-ink")}>{label}</span>
        {sub && <span className="block truncate text-meta text-ink-4">{sub}</span>}
      </span>
      {escolhida && <Check className="size-3.5 shrink-0 text-signal" strokeWidth={2.5} />}
    </button>
  );
}

/** Sem acentos e em minúsculas — "joao" tem de encontrar "João". */
function semAcentos(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

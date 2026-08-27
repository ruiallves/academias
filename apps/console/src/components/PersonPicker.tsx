import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Search, X } from "@/lib/icons";
import { cx } from "./primitives";

export type Pessoa = { id: string; name: string; sub?: string };

/**
 * Altura a contar para decidir se a lista abre para baixo ou para cima.
 *
 * Não é medida — é uma estimativa generosa do caso cheio (campo de procura mais
 * a lista no seu máximo). Medir exigia desenhar primeiro para saber onde pôr, e
 * o salto via-se.
 */
const ALTURA = 288;

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
 *
 * ## Porque é que a lista vive fora da árvore
 *
 * Porque estava a ser cortada. A lista era `position: absolute` dentro do campo,
 * e o `Dialog` que a hospeda é `max-h-[85vh] overflow-y-auto` — qualquer coisa
 * posicionada lá dentro é recortada pela caixa que faz scroll. Ao criar uma
 * equipa, escolher o treinador principal dava meia lista.
 *
 * A saída é a mesma que o menu de estado das mensalidades já usa: um portal para
 * o `document.body`, `position: fixed`, e a posição medida a partir do botão. Sai
 * do recorte porque deixa de ter um antepassado que recorte, e continua colada ao
 * campo porque a posição vem do rectângulo dele.
 *
 * O preço é que a posição deixa de se actualizar sozinha: se a página ou o
 * diálogo rolarem por baixo, a lista fica onde estava. Por isso fecha-se ao rolar
 * — mas só quando o scroll vem de **fora** dela, senão descer a própria lista
 * fechava-a.
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
  const [pos, setPos] = useState<{ top?: number; bottom?: number; left: number; width: number } | null>(null);
  const gatilho = useRef<HTMLButtonElement>(null);
  const painel = useRef<HTMLDivElement>(null);

  const escolhida = pessoas.find((p) => p.id === value);

  function alternar() {
    if (aberto) {
      fechar();
      return;
    }
    const r = gatilho.current?.getBoundingClientRect();
    if (!r) return;
    const espacoAbaixo = window.innerHeight - r.bottom;
    // Cabe por baixo? Abre por baixo. Senão abre por cima — a não ser que por
    // cima haja ainda menos espaço, e aí é por baixo à mesma.
    setPos(
      espacoAbaixo >= ALTURA + 8 || r.top < ALTURA + 8
        ? { top: r.bottom + 4, left: r.left, width: r.width }
        : { bottom: window.innerHeight - r.top + 4, left: r.left, width: r.width },
    );
    setAberto(true);
  }

  function fechar() {
    setAberto(false);
    setQ("");
  }

  useEffect(() => {
    if (!aberto) return;

    const escape = (e: KeyboardEvent) => e.key === "Escape" && fechar();
    // Captura, para apanhar o scroll de qualquer contentor — incluindo o do
    // diálogo. O que não conta é o scroll da própria lista: sem esta condição,
    // descer entre vinte nomes fechava-a à primeira roda do rato.
    const aoRolar = (e: Event) => {
      if (painel.current?.contains(e.target as Node)) return;
      fechar();
    };

    document.addEventListener("keydown", escape);
    window.addEventListener("scroll", aoRolar, true);
    window.addEventListener("resize", fechar);
    return () => {
      document.removeEventListener("keydown", escape);
      window.removeEventListener("scroll", aoRolar, true);
      window.removeEventListener("resize", fechar);
    };
  }, [aberto]);

  const filtradas = useMemo(() => {
    const termo = semAcentos(q);
    if (!termo) return pessoas;
    return pessoas.filter((p) => semAcentos(p.name).includes(termo) || semAcentos(p.sub ?? "").includes(termo));
  }, [pessoas, q]);

  function escolher(id: string) {
    onChange(id);
    fechar();
  }

  return (
    <div className="relative">
      <button
        ref={gatilho}
        type="button"
        disabled={disabled}
        onClick={alternar}
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

      {aberto &&
        pos &&
        createPortal(
          <>
            {/*
              O fecho ao clicar fora.

              Um pano por cima de tudo em vez de um ouvinte de `mousedown` no
              documento: com a lista num portal, ela deixou de estar dentro do
              campo na árvore do DOM, e o teste de "clicou fora" passava a ter de
              conhecer dois sítios. O pano tem o problema de comer o primeiro
              clique noutro sítio qualquer — o mesmo compromisso que o menu de
              estado das mensalidades já faz, e o mesmo comportamento.

              Acima do `z-50` do diálogo, senão ficava por baixo dele.
            */}
            <div className="fixed inset-0 z-[60]" onMouseDown={fechar} aria-hidden />

            <div
              ref={painel}
              style={{ top: pos.top, bottom: pos.bottom, left: pos.left, width: pos.width }}
              className="fixed z-[70] overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface shadow-[var(--shadow-pop)]"
            >
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
          </>,
          document.body,
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
      {escolhida && <Check className="size-3.5 shrink-0 text-signal-ink" strokeWidth={2.5} />}
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

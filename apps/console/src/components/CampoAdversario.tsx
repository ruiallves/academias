import { useId, useMemo, useState } from "react";
import { matches as jogosDaBase } from "@/lib/store";
import { cx, ListaDeEscolha } from "./primitives";
import { dialogInputClass } from "./Dialog";

/**
 * O campo do adversário, com os adversários que o clube já defrontou como
 * sugestão.
 *
 * O mesmo adversário escrito de duas maneiras ("SC Vilarinho" e "Vilarinho SC")
 * são dois adversários para a página Adversários e para o histórico do jogo: os
 * relatórios de um não aparecem no outro. Sugerir o nome que já existe enquanto
 * se escreve é o que evita a segunda grafia.
 *
 * As sugestões vêm dos jogos que a consola já tem carregados, por isso aparecem
 * sem esperar pelo servidor. Comparam-se sem maiúsculas nem acentos, e os
 * adversários com jogos mais recentes vêm primeiro. Continua a poder escrever-se
 * um nome novo: a lista só sugere.
 */
export function CampoAdversario({
  value,
  onChange,
  id,
}: {
  value: string;
  onChange: (nome: string) => void;
  id?: string;
}) {
  const lista = useId();
  const [aberto, setAberto] = useState(false);
  const [marcado, setMarcado] = useState(0);

  /** Cada adversário uma vez, com quantos jogos e o mais recente primeiro. */
  const conhecidos = useMemo(() => {
    const porNome = new Map<string, { nome: string; jogos: number; ultimo: number }>();
    for (const m of jogosDaBase) {
      const nome = m.opponent?.trim();
      if (!nome) continue;
      const chave = normalizar(nome);
      const quando = new Date(m.startsAt).getTime();
      const atual = porNome.get(chave);
      if (atual) {
        atual.jogos += 1;
        atual.ultimo = Math.max(atual.ultimo, quando);
      } else {
        porNome.set(chave, { nome, jogos: 1, ultimo: quando });
      }
    }
    return [...porNome.values()].sort((a, b) => b.ultimo - a.ultimo);
  }, [jogosDaBase]);

  const escrito = normalizar(value);
  /*
   * O nome escrito por inteiro continua na lista, e à cabeça: escrever "Fafe"
   * e ver o Fafe desaparecer parecia que o adversário não existia.
   */
  const sugestoes = conhecidos
    .filter((c) => (escrito ? normalizar(c.nome).includes(escrito) : true))
    .sort((a, b) => Number(normalizar(b.nome) === escrito) - Number(normalizar(a.nome) === escrito))
    .slice(0, 6);

  const mostrar = aberto && sugestoes.length > 0;

  const escolher = (nome: string) => {
    onChange(nome);
    setAberto(false);
  };

  return (
    // A lista abre por cima do resto do formulário, sem o empurrar para baixo.
    <div className="relative">
      <input
        id={id}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setAberto(true);
          setMarcado(0);
        }}
        onFocus={() => setAberto(true)}
        onBlur={() => setAberto(false)}
        onKeyDown={(e) => {
          if (!mostrar) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setMarcado((i) => Math.min(sugestoes.length - 1, i + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setMarcado((i) => Math.max(0, i - 1));
          } else if (e.key === "Enter") {
            e.preventDefault();
            escolher(sugestoes[Math.min(marcado, sugestoes.length - 1)].nome);
          } else if (e.key === "Escape") {
            // O Escape fecha a lista, e não o diálogo inteiro.
            e.stopPropagation();
            setAberto(false);
          }
        }}
        placeholder="ex.: SC Vilarinho"
        className={dialogInputClass}
        autoComplete="off"
        aria-label="Adversário"
        role="combobox"
        aria-expanded={mostrar}
        aria-controls={lista}
        aria-autocomplete="list"
        required
      />

      {mostrar && (
        <ListaDeEscolha
          id={lista}
          role="listbox"
          aria-label="Adversários que o clube já defrontou"
          className="absolute top-full right-0 left-0 z-30 mt-1 max-h-[212px] overflow-y-auto rounded-[var(--radius-control)] border border-line bg-surface shadow-[var(--shadow-pop)]"
        >
          {sugestoes.map((s, i) => (
            <li key={s.nome} role="option" aria-selected={i === marcado}>
              <button
                type="button"
                tabIndex={-1}
                onClick={() => escolher(s.nome)}
                onMouseEnter={() => setMarcado(i)}
                className={cx(
                  "flex w-full items-center justify-between gap-3 border-b border-line px-2.5 py-2 text-left last:border-0",
                  i === marcado ? "bg-sunken/70" : "hover:bg-sunken/50",
                )}
              >
                <span className="min-w-0 truncate text-body text-ink">{s.nome}</span>
                <span className="shrink-0 text-meta text-ink-4">
                  {s.jogos} {s.jogos === 1 ? "jogo" : "jogos"}
                </span>
              </button>
            </li>
          ))}
        </ListaDeEscolha>
      )}
    </div>
  );
}

/** "Vitória SC" e "vitoria sc" são o mesmo adversário. */
function normalizar(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

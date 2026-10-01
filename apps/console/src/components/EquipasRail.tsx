import { useState, type ReactNode } from "react";
import { academy } from "@/lib/api";
import { LayoutGrid, Search } from "@/lib/icons";
import type { CategoricalColor } from "@academia/ui/tokens";
import type { Team } from "@/data/types";
import { cx } from "./primitives";

/**
 * As equipas, à esquerda.
 *
 * O mesmo desenho do submenu das Definições: sem fundo, um traço da cor do
 * clube a dizer "estás aqui". Cada equipa leva o ponto da cor que tem no
 * calendário. Com mais de uma modalidade, as equipas agrupam-se por ela; com
 * muitas equipas, aparece um campo para procurar.
 */
export function EquipasRail({
  equipas,
  teamId,
  todasLabel,
  cores,
  onEscolher,
}: {
  equipas: Team[];
  teamId: string;
  todasLabel: string;
  cores: Map<string, CategoricalColor>;
  onEscolher: (id: string) => void;
}) {
  const [procura, setProcura] = useState("");
  const termo = semAcentos(procura.trim());
  const visiveis = termo ? equipas.filter((t) => semAcentos(t.name).includes(termo)) : equipas;
  const modalidades = academy.sports.filter((sp) => visiveis.some((t) => t.sportId === sp.id));
  const grupos =
    modalidades.length > 1
      ? modalidades.map((sp) => ({ nome: sp.name, itens: visiveis.filter((t) => t.sportId === sp.id) }))
      : [{ nome: "Equipas", itens: visiveis }];

  return (
    <nav aria-label="Equipas" className="pl-3">
      <ItemDeEquipa on={teamId === ""} onClick={() => onEscolher("")}>
        <LayoutGrid className={cx("size-4 shrink-0", teamId === "" && "text-signal-ink")} strokeWidth={teamId === "" ? 2 : 1.75} />
        <span className="truncate">{todasLabel}</span>
      </ItemDeEquipa>

      {equipas.length > 8 && (
        <div className="relative mt-3">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-4" strokeWidth={1.75} />
          <input
            value={procura}
            onChange={(e) => setProcura(e.target.value)}
            placeholder="Procurar equipa…"
            aria-label="Procurar equipa"
            className="h-8 w-full rounded-[10px] border border-line bg-surface pr-2 pl-8 text-meta text-ink outline-none placeholder:text-ink-4 focus:border-ink-3"
          />
        </div>
      )}

      {/* Uma lista comprida rola aqui dentro, e a coluna fica presa ao cimo. */}
      <div className="mt-3 max-h-[calc(100dvh-260px)] overflow-y-auto pl-3 -ml-3">
        {grupos.map((g, i) => (
          <div key={g.nome} className={cx(i > 0 && "mt-4")}>
            <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-ink-4">{g.nome}</p>
            <ul className="space-y-px">
              {g.itens.map((t) => (
                <li key={t.id}>
                  <ItemDeEquipa on={t.id === teamId} onClick={() => onEscolher(t.id)}>
                    <span aria-hidden className="mx-1 size-2 shrink-0 rounded-full" style={{ background: cores.get(t.id)?.base ?? "var(--color-line-strong)" }} />
                    <span className="truncate">{t.name}</span>
                  </ItemDeEquipa>
                </li>
              ))}
            </ul>
          </div>
        ))}
        {visiveis.length === 0 && <p className="text-meta text-ink-4">Nenhuma equipa com esse nome.</p>}
      </div>
    </nav>
  );
}

function ItemDeEquipa({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-current={on ? "page" : undefined}
      onClick={onClick}
      className={cx(
        "relative flex h-9 w-full items-center gap-2 text-left text-body transition-colors duration-[120ms]",
        on ? "font-medium text-ink" : "text-ink-3 hover:text-ink",
      )}
    >
      {/* A marca de "estás aqui", como no submenu das Definições. */}
      <span
        aria-hidden
        className={cx(
          "absolute -left-3 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-signal-ink transition-opacity duration-[120ms]",
          on ? "opacity-100" : "opacity-0",
        )}
      />
      {children}
    </button>
  );
}

/** Minúsculas e sem acentos, para a procura de equipas. */
const semAcentos = (v: string) => v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

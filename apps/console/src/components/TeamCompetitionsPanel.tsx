import { useState } from "react";
import { CompetitionPicker } from "@/components/CompetitionPicker";
import { Panel, PanelHead, cx } from "@/components/primitives";
import { Check, Pencil, Trophy } from "@/lib/icons";
import { apiPut } from "@/lib/http";
import { reloadAcademy } from "@/lib/store";
import type { Team } from "@/data/types";

/**
 * As provas que esta equipa disputa, na ficha dela.
 *
 * ## Ler primeiro, editar depois
 *
 * Em repouso é uma lista de etiquetas — que é o que se vem cá ver noventa por
 * cento das vezes. O modo de edição abre a um clique e fecha ao gravar; um
 * seletor sempre aberto convidava a mexer sem querer numa página que se abre
 * para consultar o plantel.
 */
export function TeamCompetitionsPanel({ team, editable }: { team: Team; editable: boolean }) {
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<string[]>(() => team.competitions.map((c) => c.id));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await apiPut(`/api/teams/${team.id}/competicoes`, { competitionIds: selected });
      await reloadAcademy();
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível guardar as competições.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel>
      <PanelHead title="Competições" hint={editing ? undefined : `${team.competitions.length || "nenhuma"}`}>
        {editable &&
          (editing ? (
            <>
              <button
                type="button"
                className="ctl-ghost"
                onClick={() => {
                  // Sair sem gravar repõe o que estava — senão a próxima abertura
                  // começava com a escolha abandonada.
                  setSelected(team.competitions.map((c) => c.id));
                  setError(null);
                  setEditing(false);
                }}
                disabled={busy}
              >
                Cancelar
              </button>
              <button type="button" className="ctl-primary" onClick={() => void guardar()} disabled={busy}>
                {busy ? "A guardar…" : <><Check className="size-3.5" strokeWidth={2} /> Guardar</>}
              </button>
            </>
          ) : (
            <button type="button" className="ctl-ghost" onClick={() => setEditing(true)}>
              <Pencil className="size-3.5" strokeWidth={1.75} />
              Editar
            </button>
          ))}
      </PanelHead>

      <div className="p-5">
        {editing ? (
          <>
            <CompetitionPicker sportId={team.sportId} selected={selected} onChange={setSelected} />
            {error && <p className="mt-2 text-meta text-risk">{error}</p>}
          </>
        ) : team.competitions.length === 0 ? (
          <p className="text-meta text-ink-3">
            Sem competições.{" "}
            {editable
              ? "Junta as provas que a equipa disputa — passam a poder escolher-se ao marcar um jogo, e saem impressas na convocatória."
              : "Quem gere a equipa pode juntá-las."}
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {team.competitions.map((c) => (
              <span
                key={c.id}
                className={cx(
                  "inline-flex items-center gap-1.5 rounded-full bg-sunken px-2.5 py-1 text-meta font-medium text-ink-2",
                )}
              >
                <Trophy className="size-3 text-ink-4" strokeWidth={1.75} />
                {c.label}
              </span>
            ))}
          </div>
        )}
      </div>
    </Panel>
  );
}

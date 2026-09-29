import { useState } from "react";
import { apiPatch } from "@/lib/http";
import { listTeams, sportById, teamById } from "@/lib/api";
import { reloadAcademy } from "@/lib/store";
import { can } from "@/lib/permissions";
import { useSession } from "@/session";
import { Pencil } from "@/lib/icons";
import type { Athlete } from "@/data/types";
import { Panel, PanelHead, Pill } from "./primitives";
import { EquipasDoAtletaField, equipasParaApi, linhaNova, linhasDoAtleta, problemaDasEquipas, type LinhaDeEquipa } from "./EquipasDoAtletaField";

/**
 * As equipas do atleta na visão geral, editáveis ali mesmo.
 *
 * Mudar um atleta de equipa, ou pô-lo também no futsal, é a edição mais comum da
 * ficha, e obrigava a abrir o modo de edição inteiro para mexer numa linha. Aqui
 * o painel troca para o mesmo formulário da ficha (`EquipasDoAtletaField`) e o
 * `PATCH` leva só as equipas: o resto da ficha fica como está.
 */
export function EquipasDoAtletaPanel({ athlete }: { athlete: Athlete }) {
  const { session } = useSession();
  const teams = listTeams(session);
  const podeEditar = can(session, "athlete:write");

  const [linhas, setLinhas] = useState<LinhaDeEquipa[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const equipas = athlete.equipas.map((e) => {
    const team = teamById(e.teamId);
    return { ...e, team, sport: sportById(team?.sportId ?? "") };
  });
  const variasModalidades = new Set(equipas.map((e) => e.sport?.id)).size > 1;

  function abrir() {
    const dele = linhasDoAtleta(athlete, teams);
    setLinhas(dele.length > 0 ? dele : [{ ...linhaNova(teams), teamId: "" }]);
    setError(null);
  }

  const saiDe = linhas
    ? athlete.equipas
        .filter((e) => !linhas.some((l) => l.teamId === e.teamId))
        .map((e) => teamById(e.teamId)?.name)
        .filter(Boolean)
    : [];

  async function guardar() {
    if (!linhas || busy || problemaDasEquipas(linhas) !== null) return;
    setBusy(true);
    setError(null);
    try {
      // A lista inteira: a que sai da lista sai da equipa. Ver `aplicarEquipas` na API.
      await apiPatch(`/api/athletes/${athlete.id}`, { equipas: equipasParaApi(linhas) });
      await reloadAcademy();
      setLinhas(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível guardar as equipas.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel>
      <PanelHead title="Equipas" hint={linhas ? "o número e a posição são de cada equipa" : undefined}>
        {podeEditar && !linhas && (
          <button type="button" className="ctl-ghost h-7 px-2 text-meta" onClick={abrir}>
            <Pencil className="size-3.5" strokeWidth={1.75} />
            Editar
          </button>
        )}
      </PanelHead>

      {linhas ? (
        <div className="space-y-3 px-5 py-4">
          <EquipasDoAtletaField linhas={linhas} onChange={setLinhas} teams={teams} />

          {saiDe.length > 0 && (
            <p className="rounded-[var(--radius-control)] border border-line bg-sunken/50 px-3 py-2 text-meta leading-relaxed text-ink-2">
              Sai de <strong className="font-medium text-ink">{saiDe.join(", ")}</strong>. As presenças e os jogos já
              registados ficam como estão.
            </p>
          )}

          {error && <p className="text-meta text-risk">{error}</p>}

          <div className="flex justify-end gap-2">
            <button type="button" className="ctl-ghost" onClick={() => setLinhas(null)} disabled={busy}>
              Cancelar
            </button>
            <button
              type="button"
              className="ctl-primary"
              onClick={guardar}
              disabled={busy || problemaDasEquipas(linhas) !== null}
            >
              {busy ? "A guardar…" : "Guardar"}
            </button>
          </div>
        </div>
      ) : equipas.length === 0 ? (
        <p className="px-5 py-4 text-body text-ink-3">Sem equipa.</p>
      ) : (
        <ul className="px-5 py-1.5">
          {equipas.map((e, i) => (
            <li key={e.teamId} className="flex items-center gap-2.5 border-b border-line py-2.5 last:border-0">
              {variasModalidades && e.sport && <Pill tone="signal">{e.sport.name}</Pill>}
              <span className="min-w-0 flex-1 truncate text-body text-ink">
                {e.team?.name ?? "Equipa"}
                {i === 0 && equipas.length > 1 && <span className="text-ink-4"> · principal</span>}
                {e.position && <span className="text-ink-3"> · {e.position}</span>}
              </span>
              <span className="shrink-0 text-body font-medium text-ink tabular">
                {e.squadNumber !== undefined && e.squadNumber !== null ? `n.º ${e.squadNumber}` : "—"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

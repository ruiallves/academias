import { teamById } from "@/lib/api";
import { apiPut } from "@/lib/http";
import { seasonList } from "@/lib/store";
import type { Athlete } from "@/data/types";

/**
 * As licenças federativas do atleta: uma por modalidade e por época.
 *
 * A equipa da consola só sabe o rótulo da época ("2026/27"); a licença guarda o
 * id. `seasonList` faz a ponte.
 */

/** O id da época de uma equipa. */
export function epocaDaEquipa(teamId: string | null | undefined): string | null {
  const label = teamById(teamId ?? "")?.season;
  return (label && seasonList.find((s) => s.label === label)?.id) || null;
}

/** A licença do atleta na modalidade e na época desta equipa. */
export function licencaDaEquipa(a: Pick<Athlete, "licencas">, teamId: string | null | undefined): string | undefined {
  const team = teamById(teamId ?? "");
  const seasonId = epocaDaEquipa(teamId);
  if (!team || !seasonId) return undefined;
  return a.licencas.find((l) => l.sportId === team.sportId && l.seasonId === seasonId)?.number;
}

/** Escrever ou apagar (vazio) uma licença. */
export const gravarLicenca = (athleteId: string, sportId: string, seasonId: string, number: string) =>
  apiPut<{ ok: true; number: string | null }>(`/api/athletes/${athleteId}/licenca`, { sportId, seasonId, number });

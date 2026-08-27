import { athleteById, sportById, teamById, today } from "@/lib/api";
import { useEvents, type CalendarEvent, type MatchAppearance, type MatchInfo } from "@/lib/calendar";
import type { Session } from "@/lib/permissions";

/**
 * O que a ficha de um atleta precisa de saber sobre jogos.
 *
 * Vive à parte de `lib/calendar.ts` porque a pergunta é outra: o calendário
 * organiza-se por data e por equipa, isto organiza-se por pessoa. Fundir as duas
 * daria uma função com um argumento a decidir qual das duas coisas faz.
 */

export type AthleteMatch = {
  event: CalendarEvent;
  match: MatchInfo;
  appearance: MatchAppearance;
  /** O escalão por que jogou — pode não ser o actual, se subiu de equipa. */
  teamId: string;
  outcome: "win" | "draw" | "loss";
  tally: number;
};

/**
 * Os jogos em que o atleta **entrou** — não aqueles para que foi convocado.
 * Convocado e não utilizado não é um jogo no currículo de ninguém, e misturá-los
 * inflacionaria a média de minutos.
 */
export function useAthleteMatches(session: Session, athleteId: string): AthleteMatch[] {
  const from = new Date(today.getFullYear() - 1, 0, 1);
  const to = new Date(today.getFullYear() + 1, 11, 31);
  const events = useEvents(session, from, to);

  const out: AthleteMatch[] = [];

  for (const event of events) {
    if (event.kind !== "match" || !event.match?.result || !event.teamId) continue;

    const appearance = event.match.result.appearances?.find((a) => a.athleteId === athleteId);
    if (!appearance) continue;

    const { ourScore, theirScore } = event.match.result;
    out.push({
      event,
      match: event.match,
      appearance,
      teamId: event.teamId,
      outcome: ourScore > theirScore ? "win" : ourScore < theirScore ? "loss" : "draw",
      tally: event.match.result.scorers.find((s) => s.athleteId === athleteId)?.tally ?? 0,
    });
  }

  return out.sort((a, b) => b.event.start.getTime() - a.event.start.getTime());
}

export type AthleteSeason = {
  played: number;
  minutes: number;
  tally: number;
  starts: number;
  wins: number;
  draws: number;
  losses: number;
  /** Média das notas atribuídas. `null` enquanto não houver nenhuma. */
  rating: number | null;
  /** Quanto do tempo possível jogou — mais honesto que "minutos" sozinho. */
  minutesShare: number | null;
};

export function summariseSeason(athleteId: string, matches: AthleteMatch[]): AthleteSeason {
  const athlete = athleteById(athleteId);
  const sport = athlete ? sportById(teamById(athlete.teamId)?.sportId ?? "") : undefined;
  const fullTime = sport?.matchMinutes ?? 0;

  const rated = matches.filter((m) => m.appearance.rating !== undefined);
  const minutes = matches.reduce((n, m) => n + m.appearance.minutes, 0);

  return {
    played: matches.length,
    minutes,
    tally: matches.reduce((n, m) => n + m.tally, 0),
    /*
     * Titular é titular, agora que a ficha o diz.
     *
     * Era "jogou o tempo inteiro" — a aproximação possível enquanto a ficha não
     * chegava ao cliente, e que contava como titular quem entrou aos 0 e nunca
     * saiu, mas também deixava de fora um titular substituído aos 60. Com
     * `started` a vir da API, a pergunta passa a ter resposta exacta; onde ele
     * não vier (fichas antigas), mantém-se a aproximação em vez de contar zero.
     */
    starts: matches.filter((m) =>
      m.appearance.started !== undefined ? m.appearance.started : fullTime > 0 && m.appearance.minutes >= fullTime,
    ).length,
    wins: matches.filter((m) => m.outcome === "win").length,
    draws: matches.filter((m) => m.outcome === "draw").length,
    losses: matches.filter((m) => m.outcome === "loss").length,
    rating:
      rated.length === 0
        ? null
        : Math.round((rated.reduce((n, m) => n + (m.appearance.rating ?? 0), 0) / rated.length) * 10) / 10,
    minutesShare: fullTime && matches.length ? minutes / (fullTime * matches.length) : null,
  };
}

/** Rótulo do lado dominante nesta modalidade, ou nada se não se aplicar. */
export function dominantSideLabel(athleteId: string): string | undefined {
  const athlete = athleteById(athleteId);
  if (!athlete) return undefined;
  return sportById(teamById(athlete.teamId)?.sportId ?? "")?.dominantSideLabel;
}

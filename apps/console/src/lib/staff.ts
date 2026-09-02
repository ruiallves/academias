import { evaluations, sessions, staff, staffStints, teams, today, type StaffStint } from "@/lib/store";
import { customEvents, resultOutcome } from "@/lib/calendar";
import { getStaffEdits } from "@/lib/staff-edits";
import type { StaffDepartment, StaffMember } from "@/data/types";
import type { Role } from "@/lib/permissions";

/**
 * A ficha de staff — edições, histórico e o que a pessoa fez.
 *
 * Mesmo padrão de `lib/roster.ts`: o que vem da base de dados é de leitura, e o que
 * se edita na consola vive aqui por cima até haver endpoints de escrita.
 *
 * ## O que aqui é calculado e o que é inventado
 *
 * Nada é inventado. As estatísticas saem todas de registos que já existem — treinos
 * com presenças marcadas, jogos com resultado, avaliações publicadas. Onde não há
 * registo, o número não aparece: uma ficha que mostra "0 jogos" quando ninguém
 * registou nada está a afirmar uma coisa falsa sobre o trabalho de alguém, e as
 * pessoas notam.
 */

/** Uma pessoa, já com as edições aplicadas. */
export function staffMember(id: string): StaffMember | undefined {
  const base = staff.find((s) => s.id === id);
  if (!base) return undefined;
  return { ...base, ...getStaffEdits()[id] };
}

/** Toda a gente, com edições. */
export function allStaff(): StaffMember[] {
  const edits = getStaffEdits();
  return staff.map((s) => ({ ...s, ...edits[s.id] }));
}

export { updateStaff, useStaffEdits, type StaffEdit } from "@/lib/staff-edits";

/* -------------------------------------------------------------------------- */
/* Histórico                                                                   */
/* -------------------------------------------------------------------------- */

export type Stint = {
  season: string;
  teamName: string;
  sportId: string;
  title: string;
  /** A época a decorrer distingue-se das anteriores — é a que ainda muda. */
  current: boolean;
  /** Só a época actual tem equipa clicável; as anteriores já não existem. */
  teamId?: string;
};

export const CURRENT_SEASON = "2026/27";

/**
 * Por onde a pessoa passou, da época actual para trás.
 *
 * A época actual é derivada das equipas a que está atribuída agora; as anteriores
 * vêm do histórico. Juntar as duas aqui — e não na página — é o que evita que a
 * ficha e a lista contem histórias diferentes.
 */
export function teamHistory(id: string): Stint[] {
  const member = staffMember(id);
  if (!member) return [];

  const current: Stint[] = member.teamIds
    .map((teamId) => teams.find((t) => t.id === teamId))
    .filter((t): t is NonNullable<typeof t> => Boolean(t))
    .map((t) => ({
      season: CURRENT_SEASON,
      teamName: t.name,
      sportId: t.sportId,
      title: member.title,
      current: true,
      teamId: t.id,
    }));

  const past: Stint[] = staffStints
    .filter((s: StaffStint) => s.staffId === id)
    .map((s) => ({
      season: s.season,
      teamName: s.teamName,
      sportId: s.sportId,
      title: s.title,
      current: false,
    }));

  return [...current, ...past].sort((a, b) => b.season.localeCompare(a.season));
}

/** Quantas épocas distintas — o número que resume uma carreira no clube. */
export function seasonsCount(id: string): number {
  return new Set(teamHistory(id).map((s) => s.season)).size;
}

/* -------------------------------------------------------------------------- */
/* O que quem treina fez                                                       */
/* -------------------------------------------------------------------------- */

export type CoachActivity = {
  /** Treinos já dados, com e sem registo de presenças. */
  sessionsDone: number;
  sessionsRecorded: number;
  sessionsPending: number;
  /** Percentagem de treinos com presenças registadas, ou nulo se ainda não houve treinos. */
  recordRate: number | null;
  /** Assiduidade dos atletas das equipas dele, no período com registo. */
  attendanceRate: number | null;
  athletes: number;
  evaluationsPublished: number;
  evaluationsDraft: number;
};

export function coachActivity(id: string): CoachActivity {
  const member = staffMember(id);
  const teamIds = new Set(member?.teamIds ?? []);

  /*
   * Treinos que já aconteceram. `coachId` é quem o deu — pode não ser o titular
   * da equipa, e é por isso que se filtra por ele e não só pela equipa.
   *
   * "Já aconteceu" é a hora ter passado, não o `status` dizer `done`: nada na
   * API escreve esse estado (ver `unrecordedSessions`), e enquanto isto o pediu,
   * a ficha de qualquer treinador mostrava zero treinos dados e uma taxa de
   * registo vazia — por muito que ele treinasse.
   */
  const done = sessions.filter(
    (s) => s.coachId === id && s.status !== "cancelled" && new Date(s.start) <= today,
  );
  const recorded = done.filter((s) => s.attendance);

  let present = 0;
  let absent = 0;
  for (const s of recorded) {
    const team = teams.find((t) => t.id === s.teamId);
    const roster = team?.athleteIds.length ?? 0;
    // Guarda-se a excepção, não a norma: a lista de faltas é o que existe, e os
    // presentes são o resto do plantel. Ver `docs/03-estado.md`.
    const faults = s.attendance?.absences.filter((a) => a.kind !== "late").length ?? 0;
    present += Math.max(0, roster - faults);
    absent += faults;
  }

  const athletes = teams
    .filter((t) => teamIds.has(t.id))
    .reduce((n, t) => n + t.athleteIds.length, 0);

  const mine = evaluations.filter((e) => e.coachId === id);

  return {
    sessionsDone: done.length,
    sessionsRecorded: recorded.length,
    sessionsPending: done.length - recorded.length,
    recordRate: done.length ? Math.round((recorded.length / done.length) * 100) : null,
    attendanceRate: present + absent > 0 ? Math.round((present / (present + absent)) * 100) : null,
    athletes,
    evaluationsPublished: mine.filter((e) => e.status === "published").length,
    evaluationsDraft: mine.filter((e) => e.status === "draft").length,
  };
}

export type CoachMatch = {
  id: string;
  date: Date;
  teamId?: string;
  teamName: string;
  opponent: string;
  home: boolean;
  ourScore: number;
  theirScore: number;
  outcome: "win" | "draw" | "loss";
};

/**
 * Jogos das equipas desta pessoa, com resultado registado, do mais recente para trás.
 *
 * Filtra-se pela equipa e não por `coachId` do evento: um jogo é da equipa, e quem
 * está no banco nesse dia pode ser o adjunto. Contar só os jogos em que a pessoa
 * aparece nomeada dava um retrato falso de quem treina o escalão todo o ano.
 */
export function coachMatches(id: string, limit = 8): CoachMatch[] {
  const member = staffMember(id);
  const teamIds = new Set(member?.teamIds ?? []);
  if (teamIds.size === 0) return [];

  return customEvents()
    .filter((e) => e.kind === "match" && !e.cancelled && e.teamId && teamIds.has(e.teamId))
    .filter((e) => e.match?.result && e.start <= today)
    .map((e) => {
      const r = e.match!.result!;
      return {
        id: e.id,
        date: e.start,
        teamId: e.teamId,
        teamName: teams.find((t) => t.id === e.teamId)?.name ?? "—",
        opponent: e.match!.opponent,
        home: e.match!.home,
        ourScore: r.ourScore,
        theirScore: r.theirScore,
        outcome: resultOutcome(e.match!) ?? "draw",
      };
    })
    .sort((a, b) => b.date.getTime() - a.date.getTime())
    .slice(0, limit);
}

export type MatchRecord = { played: number; wins: number; draws: number; losses: number; scored: number; conceded: number };

/** O balanço de todos os jogos com resultado — não só dos que cabem na lista. */
export function matchRecord(id: string): MatchRecord | null {
  const all = coachMatches(id, Number.MAX_SAFE_INTEGER);
  if (all.length === 0) return null;

  return {
    played: all.length,
    wins: all.filter((m) => m.outcome === "win").length,
    draws: all.filter((m) => m.outcome === "draw").length,
    losses: all.filter((m) => m.outcome === "loss").length,
    scored: all.reduce((n, m) => n + m.ourScore, 0),
    conceded: all.reduce((n, m) => n + m.theirScore, 0),
  };
}

/* -------------------------------------------------------------------------- */
/* Utilitários                                                                 */
/* -------------------------------------------------------------------------- */

/** Anos completos de casa — "na academia desde" em número. */
export function yearsAtClub(since: string): number {
  const start = new Date(since);
  let years = today.getFullYear() - start.getFullYear();
  const beforeAnniversary =
    today.getMonth() < start.getMonth() ||
    (today.getMonth() === start.getMonth() && today.getDate() < start.getDate());
  if (beforeAnniversary) years--;
  return Math.max(0, years);
}

export const DEPARTMENTS: StaffDepartment[] = ["direction", "technical", "clinical", "operations"];

/** Os papéis atribuíveis na ficha, do mais amplo ao mais restrito. */
export const ASSIGNABLE_ROLES: Role[] = ["OWNER", "DIRECTOR", "COORDINATOR", "COACH", "MEDICAL", "STAFF"];

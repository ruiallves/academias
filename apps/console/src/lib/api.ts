/**
 * Fronteira de dados.
 *
 * Tudo o que a UI sabe sobre dados passa por aqui. Hoje lê de `src/data/demo.ts`;
 * amanhã faz `fetch` à API NestJS. Nenhum componente importa `demo.ts` directamente
 * — é essa disciplina que torna a troca um único ficheiro.
 */

import {
  academy,
  announcements,
  athletes,
  coaches,
  currentPeriod,
  evaluations,
  fees,
  guardians,
  sessions,
  staff,
  teams,
  today,
} from "@/data/demo";
import type { AbsenceKind, AttentionItem, Athlete, Fee, TrainingSession } from "@/data/types";
import type { Session } from "@/lib/permissions";
import { isAcademyWide } from "@/lib/permissions";
import { relativeDays } from "@/lib/format";
import { getRosterAdditions } from "@/lib/roster";
import { getAttendanceRecords } from "@/lib/attendance";
import { isUnavailable } from "@/lib/clinical";

export { academy, today, currentPeriod };

/**
 * Fusão dos dados de demonstração com o que foi criado a partir da UI ("Nova
 * equipa", "Novo atleta"). Um sítio só para isto — todas as funções abaixo lêem
 * daqui, nunca directamente de `teams`/`athletes`/`guardians`. Quando a API estiver
 * ligada, estas três funções passam a `fetch`; nada mais neste ficheiro muda.
 */
function allTeams() {
  return [...teams, ...getRosterAdditions().teams];
}
function allAthletes() {
  return [...athletes, ...getRosterAdditions().athletes];
}
function allGuardians() {
  return [...guardians, ...getRosterAdditions().guardians];
}

/* -------------------------------------------------------------------------- */
/* Âmbito                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * O treinador vê as suas equipas; o diretor vê a academia. Isto é aplicado aqui, na
 * fronteira, e não em cada ecrã — assim nenhum ecrã pode esquecer-se.
 * Na API real a mesma regra vive no serviço, com RLS por baixo.
 */
export function scopedTeamIds(session: Session): string[] {
  if (isAcademyWide(session)) return allTeams().map((t) => t.id);
  return session.scope?.teamIds ?? [];
}

export function listTeams(session: Session) {
  const ids = new Set(scopedTeamIds(session));
  return allTeams().filter((t) => ids.has(t.id));
}

export function listAthletes(session: Session): Athlete[] {
  const ids = new Set(scopedTeamIds(session));
  return allAthletes().filter((a) => ids.has(a.teamId));
}

/** Toda a gente que trabalha na academia — direção, técnica, clínico, operações. */
export function listStaff() {
  return staff.filter((m) => m.isActive);
}

/** Só quem está atribuído a equipas. É o subconjunto que interessa a um horário. */
export function listCoaches() {
  return coaches;
}

export function listGuardians() {
  return allGuardians();
}

export function listAnnouncements() {
  return [...announcements].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}

export function listEvaluations(session: Session) {
  const ids = new Set(listAthletes(session).map((a) => a.id));
  return evaluations.filter((e) => ids.has(e.athleteId));
}

export function listFees(session: Session, period = currentPeriod): Fee[] {
  const ids = new Set(listAthletes(session).map((a) => a.id));
  return fees.filter((f) => ids.has(f.athleteId) && f.period === period);
}

/** Todas as mensalidades de todos os períodos, dentro do âmbito do utilizador. */
export function listAllFees(session: Session): Fee[] {
  const ids = new Set(listAthletes(session).map((a) => a.id));
  return fees
    .filter((f) => ids.has(f.athleteId))
    .sort((a, b) => b.period.localeCompare(a.period));
}

/** Os períodos que existem em dados, do mais recente para o mais antigo. */
export function availablePeriods(): string[] {
  return [...new Set(fees.map((f) => f.period))].sort().reverse();
}

export function feeHistory(athleteId: string) {
  return fees.filter((f) => f.athleteId === athleteId).sort((a, b) => b.period.localeCompare(a.period));
}

export function listSessions(session: Session, from: Date, to: Date): TrainingSession[] {
  const ids = new Set(scopedTeamIds(session));
  const overrides = getAttendanceRecords();

  return sessions
    .filter((s) => ids.has(s.teamId))
    .filter((s) => {
      const d = new Date(s.start);
      return d >= from && d <= to;
    })
    // Um registo feito na consola sobrepõe-se ao dado de demonstração.
    .map((s) => (overrides[s.id] ? { ...s, attendance: overrides[s.id] } : s))
    .sort((a, b) => a.start.localeCompare(b.start));
}

/* -------------------------------------------------------------------------- */
/* Consultas por id                                                            */
/* -------------------------------------------------------------------------- */

export const teamById = (id: string) => allTeams().find((t) => t.id === id);
export const athleteById = (id: string) => allAthletes().find((a) => a.id === id);
// Procura em todo o staff, não só nos treinadores: um treino pode ser conduzido
// por um preparador físico, e a ficha de uma equipa lista quem lá trabalha.
export const staffById = (id: string) => staff.find((m) => m.id === id);
export const coachById = staffById;
export const guardianById = (id: string) => allGuardians().find((g) => g.id === id);
export const sportById = (id: string) => academy.sports.find((s) => s.id === id);

export function guardiansOf(athleteId: string) {
  return allGuardians().filter((g) => g.athleteIds.includes(athleteId));
}

/* -------------------------------------------------------------------------- */
/* Agregados                                                                   */
/* -------------------------------------------------------------------------- */

export type FeeSummary = {
  total: number;
  paid: number;
  pending: number;
  processing: number;
  overdue: number;
  billedCents: number;
  collectedCents: number;
  overdueCents: number;
};

export function feeSummary(session: Session, period = currentPeriod): FeeSummary {
  const rows = listFees(session, period);
  const sum = (pred: (f: Fee) => boolean) =>
    rows.filter(pred).reduce((acc, f) => acc + f.amountCents, 0);

  return {
    total: rows.length,
    paid: rows.filter((f) => f.status === "paid").length,
    pending: rows.filter((f) => f.status === "pending").length,
    processing: rows.filter((f) => f.status === "processing").length,
    overdue: rows.filter((f) => f.status === "overdue").length,
    billedCents: sum(() => true),
    collectedCents: sum((f) => f.status === "paid"),
    overdueCents: sum((f) => f.status === "overdue"),
  };
}

export type Arrears = {
  /** Mensalidades vencidas, de qualquer período — a dívida não expira ao virar o mês. */
  count: number;
  cents: number;
  /** Famílias distintas com pelo menos uma mensalidade vencida. */
  athletes: number;
  /** Famílias com duas ou mais — quem falta uma vez e quem falta sistematicamente
   *  são problemas diferentes, e só se distinguem olhando para todos os períodos. */
  chronic: number;
};

/**
 * Dívida real, hoje — não "dívida deste mês".
 *
 * `feeSummary` responde "como vai a cobrança deste período?"; esta responde
 * "quanto é que a academia tem por receber, de sempre?". São perguntas diferentes
 * e a segunda é a que importa para "Precisa de atenção": uma mensalidade de junho
 * por pagar não deixa de ser dinheiro em falta só porque chegou agosto.
 */
export function arrears(session: Session): Arrears {
  const overdue = listAllFees(session).filter((f) => f.status === "overdue");
  const byAthlete = new Map<string, number>();
  for (const f of overdue) byAthlete.set(f.athleteId, (byAthlete.get(f.athleteId) ?? 0) + 1);

  return {
    count: overdue.length,
    cents: overdue.reduce((n, f) => n + f.amountCents, 0),
    athletes: byAthlete.size,
    chronic: [...byAthlete.values()].filter((n) => n >= 2).length,
  };
}

/**
 * Taxa de presença dos treinos já registados nos últimos `days` dias.
 *
 * `teamId` estreita ao escalão. Não se pode simular isso passando um `scope`
 * falso: para um diretor o âmbito é ignorado por desenho (vê a academia toda), e
 * o filtro tem de ser um argumento explícito.
 */
export function attendanceRate(session: Session, days = 30, teamId?: string): number | null {
  const from = new Date(today.getTime() - days * 86_400_000);
  const recorded = listSessions(session, from, today)
    .filter((s) => (teamId ? s.teamId === teamId : true))
    .filter((s) => s.attendance);
  if (recorded.length === 0) return null;

  const totals = recorded.reduce(
    (acc, s) => {
      const roster = teamById(s.teamId)?.athleteIds.length ?? 0;
      // "Atrasado" conta como presente — apareceu. Só falta e falta justificada
      // pesam na assiduidade.
      const missed = s.attendance!.absences.filter((x) => x.kind !== "late").length;
      return { present: acc.present + Math.max(0, roster - missed), all: acc.all + roster };
    },
    { present: 0, all: 0 },
  );
  return totals.all === 0 ? null : totals.present / totals.all;
}

/* -------------------------------------------------------------------------- */
/* Ficha do atleta                                                             */
/* -------------------------------------------------------------------------- */

export type AthleteSessionRecord = {
  session: TrainingSession;
  /** `null` quando o treino ainda não foi registado — diferente de ter estado presente. */
  status: AbsenceKind | "present" | null;
};

/**
 * O histórico de treinos de um atleta.
 *
 * A distinção que interessa é entre "esteve presente" e "ninguém registou": a
 * primeira é um facto, a segunda é uma lacuna, e juntá-las inflacionava a
 * assiduidade de quem calhou ter um treinador distraído.
 */
export function athleteSessions(athleteId: string, limitDays = 180): AthleteSessionRecord[] {
  const athlete = athleteById(athleteId);
  if (!athlete) return [];

  const overrides = getAttendanceRecords();
  const from = new Date(today.getTime() - limitDays * 86_400_000);

  return sessions
    .filter((s) => s.teamId === athlete.teamId && s.status !== "cancelled")
    .filter((s) => {
      const d = new Date(s.start);
      return d >= from && d <= today;
    })
    .map((s) => {
      const attendance = overrides[s.id] ?? s.attendance;
      if (!attendance) return { session: s, status: null };
      const hit = attendance.absences.find((x) => x.athleteId === athleteId);
      return { session: s, status: hit ? hit.kind : ("present" as const) };
    })
    .sort((a, b) => b.session.start.localeCompare(a.session.start));
}

export type AthleteAttendanceSummary = {
  recorded: number;
  present: number;
  late: number;
  absent: number;
  justified: number;
  /** `null` quando não há nenhum treino registado — não é 0%, é "não se sabe". */
  rate: number | null;
};

export function athleteAttendanceSummary(athleteId: string, limitDays = 180): AthleteAttendanceSummary {
  const records = athleteSessions(athleteId, limitDays).filter((r) => r.status !== null);

  const count = (k: AthleteSessionRecord["status"]) => records.filter((r) => r.status === k).length;
  const present = count("present");
  const late = count("late");
  const absent = count("absent");
  const justified = count("justified");

  return {
    recorded: records.length,
    present,
    late,
    absent,
    justified,
    rate: records.length === 0 ? null : (present + late) / records.length,
  };
}

/** Sessões passadas que ninguém registou. É trabalho por fazer, não estatística. */
export function unrecordedSessions(session: Session): TrainingSession[] {
  const from = new Date(today.getTime() - 21 * 86_400_000);
  return listSessions(session, from, today).filter(
    (s) => s.status === "done" && !s.attendance,
  );
}

/** Semana de segunda a domingo que contém `anchor`. */
export function weekOf(anchor: Date = today): Date[] {
  const start = new Date(anchor);
  const shift = (start.getDay() + 6) % 7; // segunda = 0
  start.setDate(start.getDate() - shift);
  start.setHours(0, 0, 0, 0);
  return Array.from({ length: 7 }, (_, i) => new Date(start.getTime() + i * 86_400_000));
}

export function sessionsOnDay(session: Session, day: Date): TrainingSession[] {
  const from = new Date(day);
  from.setHours(0, 0, 0, 0);
  const to = new Date(day);
  to.setHours(23, 59, 59, 999);
  return listSessions(session, from, to);
}

export function nextSession(session: Session): TrainingSession | undefined {
  const horizon = new Date(today.getTime() + 14 * 86_400_000);
  return listSessions(session, today, horizon).find((s) => s.status === "scheduled");
}

/* -------------------------------------------------------------------------- */
/* Precisa de atenção                                                          */
/* -------------------------------------------------------------------------- */

/**
 * O coração do produto.
 *
 * Não é um resumo — é uma lista de trabalho, ordenada por gravidade. Cada linha
 * é um facto com um verbo e um destino. Se estiver vazia, isso é uma boa notícia
 * e a UI diz isso mesmo, em vez de mostrar um espaço morto.
 */
export function attentionItems(session: Session): AttentionItem[] {
  const items: AttentionItem[] = [];
  const wide = isAcademyWide(session);
  const canBill = session.role !== "COACH" && session.role !== "STAFF";

  if (canBill) {
    const a = arrears(session);
    if (a.count > 0) {
      const amount = (a.cents / 100).toLocaleString("pt-PT", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
      items.push({
        id: "fees-overdue",
        severity: "risk",
        title: `${a.count} mensalidades vencidas`,
        // A dívida cobre todos os períodos, não só o corrente — por isso o
        // detalhe distingue atraso pontual de atraso a repetir.
        detail:
          a.chronic > 0
            ? `${amount} por cobrar · ${a.chronic} ${a.chronic === 1 ? "família" : "famílias"} com mais de um mês em atraso`
            : `${amount} por cobrar, de ${a.athletes} ${a.athletes === 1 ? "família" : "famílias"}`,
        to: "/mensalidades?estado=overdue",
        action: "Cobrar",
      });
    }
  }

  const unassigned = listSessions(session, today, new Date(today.getTime() + 7 * 86_400_000)).filter(
    (s) => s.status === "scheduled" && !s.coachId,
  );
  if (unassigned.length > 0) {
    const first = new Date(unassigned[0].start);
    items.push({
      id: "sessions-unassigned",
      severity: "risk",
      title: `${unassigned.length} ${unassigned.length === 1 ? "treino sem treinador" : "treinos sem treinador"}`,
      detail: `O mais próximo é ${relativeDays(first, today)}, ${teamById(unassigned[0].teamId)?.name}`,
      to: "/calendario",
      action: "Atribuir",
    });
  }

  const unrecorded = unrecordedSessions(session);
  if (unrecorded.length > 0) {
    items.push({
      id: "attendance-missing",
      severity: "warn",
      title: `${unrecorded.length} treinos sem presenças registadas`,
      detail: "Sem registo, a assiduidade do atleta fica incompleta no relatório",
      to: session.role === "COACH" ? "/treinos" : "/presencas",
      action: "Registar",
    });
  }

  if (wide) {
    const expiring = listAthletes(session).filter((a) => {
      const d = new Date(a.medicalValidUntil);
      return d.getTime() < today.getTime() + 30 * 86_400_000;
    });
    if (expiring.length > 0) {
      const expired = expiring.filter((a) => new Date(a.medicalValidUntil) < today).length;
      items.push({
        id: "medical",
        severity: expired > 0 ? "warn" : "info",
        title: `${expiring.length} fichas médicas a expirar`,
        detail: expired > 0 ? `${expired} já expiraram — o atleta não pode competir` : "Todas dentro dos próximos 30 dias",
        to: "/atletas?filtro=medico",
        action: "Ver",
      });
    }

    const noApp = allGuardians().filter((g) => !g.appInstalled).length;
    if (noApp > 0) {
      items.push({
        id: "app-adoption",
        severity: "info",
        title: `${noApp} famílias ainda sem a app`,
        detail: "Continuam a depender do WhatsApp para avisos e pagamentos",
        to: "/familias?filtro=sem-app",
        action: "Convidar",
      });
    }
  }

  // O plantel disponível é informação de planeamento, não clínica — por isso
  // chega a quem tem clinical:status e nunca traz diagnóstico.
  const out = listAthletes(session).filter((a) => isUnavailable(a.id));
  if (out.length > 0) {
    items.push({
      id: "athletes-out",
      severity: "warn",
      title: `${out.length} ${out.length === 1 ? "atleta de baixa" : "atletas de baixa"}`,
      detail: "Indisponíveis para treinar e para convocatória",
      to: wide ? "/atletas?filtro=baixa" : "/atletas",
      action: "Ver",
    });
  }

  const drafts = listEvaluations(session).filter((e) => e.status === "draft").length;
  if (drafts > 0 && session.role === "COACH") {
    items.push({
      id: "evaluations-draft",
      severity: "info",
      title: `${drafts} avaliações por publicar`,
      detail: "Os pais só as vêem depois de publicadas",
      to: "/avaliacoes",
      action: "Rever",
    });
  }

  const order = { risk: 0, warn: 1, info: 2 } as const;
  return items.sort((a, b) => order[a.severity] - order[b.severity]);
}

/** Contadores dos badges da navegação. */
export function navCounts(session: Session) {
  const canBill = session.role !== "COACH" && session.role !== "STAFF";
  return {
    overdueFees: canBill ? arrears(session).count : 0,
    unreadThreads: 0,
    pendingEvaluations: listEvaluations(session).filter((e) => e.status === "draft").length,
    sessionsToRecord: unrecordedSessions(session).length,
    athletesOut: listAthletes(session).filter((a) => isUnavailable(a.id)).length,
  };
}

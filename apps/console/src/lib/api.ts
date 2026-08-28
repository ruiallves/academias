/**
 * Fronteira de dados.
 *
 * Tudo o que a UI sabe sobre dados passa por aqui. Lê de `lib/store.ts`, que traz a
 * academia da base de dados através da API. Nenhum componente vai buscar dados por
 * fora — foi essa disciplina que permitiu trocar a origem sem tocar nos ecrãs.
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
} from "@/lib/store";
import type { AbsenceKind, AttentionItem, Athlete, Fee, Team, TrainingSession } from "@/data/types";
import type { Session } from "@/lib/permissions";
import { can, isAcademyWide } from "@/lib/permissions";
import { getStaffEdits } from "@/lib/staff-edits";
import { matches } from "@/lib/store";
import { matchAttention, myMatchDuty, type MatchStatus } from "@/lib/matches";
import { relativeDays } from "@/lib/format";
import { getAttendanceRecords } from "@/lib/attendance";
import { isUnavailable } from "@/lib/clinical";
import { medicalNeedsAttention, medicalState } from "@/lib/medical";

export { academy, today, currentPeriod };

/**
 * Equipas, atletas e encarregados — já vindos da base de dados através de
 * `lib/store.ts` (bootstrap). "Nova equipa" e "Novo atleta" escrevem na API e
 * recarregam o store; deixou de haver uma cópia local a fundir. Estas três funções
 * continuam a ser o único ponto de leitura — todas as de baixo passam por aqui.
 */
function allTeams() {
  return teams;
}
function allAthletes() {
  return athletes;
}
function allGuardians() {
  return guardians;
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

/**
 * Toda a gente que trabalha na academia — direção, técnica, clínico, operações.
 *
 * Funde as edições feitas na ficha, como `listAthletes` funde o que se cria em
 * `lib/roster.ts`. Quem sai da academia é desactivado e não apagado: continua a
 * aparecer no histórico das equipas que treinou, e só desaparece das listas.
 */
export function listStaff() {
  const edits = getStaffEdits();
  return staff.map((m) => ({ ...m, ...edits[m.id] })).filter((m) => m.isActive);
}

/** Só quem está atribuído a equipas. É o subconjunto que interessa a um horário. */
export function listCoaches() {
  return coaches;
}

/**
 * Quem **pode** ficar responsável por uma equipa.
 *
 * ## O problema que isto resolve
 *
 * O ecrã de criar uma equipa oferecia `listCoaches()`, que é "quem já está
 * atribuído a alguma equipa" (`teamIds.length > 0`). Numa academia nova ninguém
 * está — logo a caixa só tinha "Por atribuir", e não havia maneira de atribuir a
 * primeira equipa a ninguém. Um ovo à espera da galinha.
 *
 * A pergunta certa não é "quem já treina" — é "quem trabalha cá e não é família".
 * Um director que também treina o Sub-19 é uma situação normal num clube pequeno,
 * e a lista antiga excluía-o até alguém o pôr numa equipa por outra via.
 *
 * As famílias e os atletas ficam de fora: pôr um encarregado como responsável de
 * uma equipa não é um erro de digitação, é o princípio de alguém a aparecer em
 * relatórios de staff sem nunca ter sido staff.
 */
export function listCoachCandidates() {
  return listStaff().filter((m) => m.role !== "GUARDIAN" && m.role !== "ATHLETE");
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
export const staffById = (id: string) => {
  const base = staff.find((m) => m.id === id);
  return base ? { ...base, ...getStaffEdits()[id] } : undefined;
};
export const coachById = staffById;

/**
 * Quem treina esta equipa — visível a quem não pode ver o staff.
 *
 * ## O bug que isto corrige
 *
 * As duas listas de treinadores da consola faziam `team.coachIds.map(coachById)`,
 * e `coachById` procura na lista de staff. Essa lista chega de `/api/staff`, que
 * exige `staff:read` — um treinador não tem. O pedido falhava, o `soft()` do
 * store engolia o 403 e devolvia `[]`, e a partir daí **nenhum** nome resolvia:
 * o treinador abria "Equipas" e via a sua própria equipa marcada como *sem
 * treinador*. Não havia erro nenhum no ecrã, porque não havia erro — havia uma
 * lista vazia a passar por uma resposta.
 *
 * Os nomes já vinham com a equipa, em `/api/teams`. Só se estavam a deitar fora.
 *
 * ## A fotografia é o que continua a depender do staff
 *
 * E está certo que dependa: a fotografia de alguém é ficha de pessoal. Sem ela, o
 * `Monogram` desenha as iniciais — quem não pode ver o staff vê o nome e as
 * iniciais, quem pode vê a cara.
 */
export function teamCoaches(team: Team) {
  return team.coaches.map((c) => {
    // A ficha, quando se lhe pode chegar: traz a fotografia e o nome já com as
    // edições locais aplicadas.
    const ficha = staffById(c.id);
    return {
      id: c.id,
      name: ficha?.name ?? c.name,
      title: c.title,
      photoUrl: ficha?.photoUrl ?? null,
      /*
       * A ficha completa, quando quem está a ver lhe pode chegar.
       *
       * Email, telefone e data de entrada são ficha de pessoal e continuam a
       * exigir `staff:read` — não é o nome de quem treina a equipa. Quem não a
       * tem recebe `null` aqui e o ecrã mostra o que sabe, em vez de rebentar ou
       * de fingir que a equipa não tem treinador.
       */
      ficha: ficha ?? null,
    };
  });
}
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
  /** O motivo, só numa falta justificada. */
  note?: string;
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
      return { session: s, status: hit ? hit.kind : ("present" as const), note: hit?.note };
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
    // Sem ficha, expirada ou a expirar — as três precisam da mesma atenção, e
    // a que faltava era a primeira: um atleta sem exame nenhum não aparecia
    // aqui, porque `new Date("")` não é menor do que data nenhuma.
    const expiring = listAthletes(session).filter((a) => medicalNeedsAttention(a));
    if (expiring.length > 0) {
      const expired = expiring.filter((a) => medicalState(a) === "expired").length;
      const sem = expiring.filter((a) => medicalState(a) === "missing").length;
      items.push({
        id: "medical",
        severity: expired > 0 || sem > 0 ? "warn" : "info",
        title: `${expiring.length} ${expiring.length === 1 ? "ficha médica" : "fichas médicas"} por tratar`,
        detail:
          [
            expired > 0 && `${expired} ${expired === 1 ? "expirada" : "expiradas"}`,
            sem > 0 && `${sem} sem exame`,
          ]
            .filter(Boolean)
            .join(" · ") || "Todas dentro dos próximos 30 dias",
        // `filtro=todos` explícito: a lista abre em "Activos", e este número
        // conta o clube inteiro. Sem isto, clicar num aviso de 5 fichas podia
        // dar uma lista de 4 — a que faltava é de quem já saiu.
        to: "/atletas?filtro=todos&sinal=medico",
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
      to: wide ? "/atletas?filtro=todos&sinal=baixa" : "/atletas",
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

  /*
   * Os jogos: convocatórias por enviar, e fichas por preencher.
   *
   * `attendance:read` é a mesma linha que já separa quem convoca de quem só vê o
   * calendário — o departamento clínico e o de scouting têm calendário mas não
   * têm nada a fazer a uma convocatória, e uma lista de trabalho com linhas que a
   * pessoa não pode despachar deixa de ser uma lista de trabalho.
   *
   * As frases vêm de `matchAttention`, partilhado com a página dos Jogos: duas
   * cópias divergiam à primeira correcção de texto.
   */
  const jogos = matches.map((m) => ({
    startsAt: m.startsAt,
    teamName: m.teamName,
    opponent: m.opponent,
    status: m.status as MatchStatus,
    ourScore: m.ourScore,
    submitted: m.submitted,
    myStaffRole: m.myStaffRole,
  }));

  /*
   * "Estás escalado para…" — para toda a gente, sem permissão nenhuma.
   *
   * É o que o departamento clínico tem para ver aqui. Não precisa de
   * `attendance:read` porque não é trabalho de convocatória: é a agenda da
   * própria pessoa, e ninguém tem de ter permissão para saber onde é preciso.
   * O servidor só marca `myStaffRole` nos jogos em que a pessoa está mesmo.
   */
  items.push(...myMatchDuty(jogos));

  /*
   * As convocatórias por enviar e as fichas por preencher, só a quem as pode
   * despachar.
   *
   * `attendance:read` é a mesma linha que já separa quem convoca de quem só vê o
   * calendário — o departamento clínico e o de scouting têm calendário mas não
   * têm nada a fazer a uma convocatória. Uma lista de trabalho com linhas que a
   * pessoa não pode despachar deixa de ser uma lista de trabalho: foi
   * exactamente o que se viu quando a médica abriu os Jogos e leu "Convocar".
   */
  if (can(session, "attendance:read")) {
    items.push(...matchAttention(jogos));
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
    // Jogos que se aproximam com a convocatória por submeter. Só conta os
    // próximos dez dias: um jogo daqui a dois meses não é uma pendência.
    callUpsToSubmit: matches.filter(
      (m) =>
        !m.submitted &&
        m.status === "SCHEDULED" &&
        new Date(m.startsAt) >= today &&
        new Date(m.startsAt).getTime() - today.getTime() <= 10 * 86_400_000,
    ).length,
    /*
     * Jogos jogados e ainda sem resultado.
     *
     * Ao contrário das convocatórias, isto não tem janela: um jogo de Outubro
     * por preencher em Janeiro continua a ser trabalho por fazer, e deixar de o
     * contar era fingir que se resolveu sozinho. Os cancelados ficam de fora —
     * não têm ficha para preencher.
     */
    matchesToFill: matches.filter(
      (m) => m.status !== "CANCELLED" && new Date(m.startsAt) < today && m.ourScore === null,
    ).length,
    athletesOut: listAthletes(session).filter((a) => isUnavailable(a.id)).length,
  };
}

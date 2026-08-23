import { useSyncExternalStore } from "react";
import { apiGet, soft } from "@/lib/http";
import { applyBrand } from "@/lib/brand";

/**
 * O estado da app da família, vindo da API.
 *
 * Substitui `data.ts` — os dados de demonstração. O padrão é o mesmo da consola:
 * um bootstrap ao arrancar, leituras em paralelo, e *live bindings* que os ecrãs
 * consomem sem saber de onde vêm.
 *
 * **O que não existe fica vazio, nunca inventado.** Avaliações e agendamentos
 * clínicos ainda não têm endpoint para a família; os ecrãs dizem-no em vez de
 * mostrarem números a fingir. Um pai que veja uma avaliação inventada deixa de
 * confiar em todos os outros números da app.
 */

/* -------------------------------------------------------------------------- */
/* O que a API devolve                                                         */
/* -------------------------------------------------------------------------- */

type ApiBootstrap = {
  academy: { id: string; slug: string; name: string; shortName: string; signalColor: string; city: string | null };
  sports: { id: string; name: string }[];
  season: { label: string } | null;
  me: { userId: string; name: string; email: string; role: string };
};

type ApiAthlete = {
  id: string;
  name: string;
  birthdate: string;
  photoUrl: string | null;
  status: string;
  teamId: string | null;
  position: string | null;
  squadNumber: number | null;
  availability: "available" | "limited" | "out";
  restriction: { id: string; title: string | null; since: string; expectedReturn: string | null } | null;
};

type ApiTeam = {
  id: string;
  name: string;
  ageGroup: string;
  sportId: string;
  schedule: unknown;
  coaches: { id: string; name: string; title: string }[];
  feeCents: number | null;
};

type ApiSession = {
  id: string;
  teamId: string;
  startsAt: string;
  endsAt: string;
  venue: string;
  dressingRoom: string | null;
  status: string;
  coachName: string | null;
  recorded: boolean;
  absences: { athleteId: string; status: string }[];
};

type ApiMatch = {
  id: string;
  teamId: string;
  teamName: string;
  startsAt: string;
  endsAt: string;
  venue: string;
  opponent: string;
  isHome: boolean;
  status: string;
  ourScore: number | null;
  theirScore: number | null;
  submitted: boolean;
  calledUp: { athleteId: string; status: string; isGuest: boolean }[];
};

type ApiCharge = {
  id: string;
  athleteId: string;
  athleteName: string;
  period: string;
  amountCents: number;
  dueDate: string;
  status: string;
  overdue: boolean;
};

type ApiAnnouncement = {
  id: string;
  title: string;
  body: string;
  audience: string;
  authorName: string;
  publishedAt: string | null;
};

export type ApiNotification = {
  id: string;
  type: string;
  title: string;
  body: string;
  payload: { route?: string; chargeId?: string; announcementId?: string; matchId?: string } | null;
  readAt: string | null;
  createdAt: string;
};

/* -------------------------------------------------------------------------- */
/* O que os ecrãs consomem                                                     */
/* -------------------------------------------------------------------------- */

export type Child = {
  id: string;
  name: string;
  firstName: string;
  team: string;
  teamId: string;
  sport: string;
  coach: string;
  /** O que este atleta paga por mês. `null` enquanto a academia não o configurar. */
  feeCents: number | null;
  photoUrl?: string;
  availability: "available" | "limited" | "out";
};

export type Training = {
  id: string;
  childId: string;
  start: Date;
  end: Date;
  venue: string;
  /**
   * O balneário.
   *
   * É a informação que um pai à porta de um pavilhão com quatro portas procura, e
   * até aqui só existia na cabeça do treinador. Ausente quando a academia não os
   * gere — e nesse caso a app não mostra linha nenhuma, em vez de mostrar um
   * campo vazio.
   */
  dressingRoom?: string;
  coach?: string;
  cancelled: boolean;
};

export type Match = {
  id: string;
  childId: string;
  start: Date;
  end: Date;
  venue: string;
  opponent: string;
  isHome: boolean;
  cancelled: boolean;
  /** O filho está nesta convocatória — e ela já foi enviada às famílias. */
  calledUp: boolean;
};

export type Payment = {
  id: string;
  childId: string;
  period: string;
  label: string;
  amountCents: number;
  dueDate: Date;
  status: "paid" | "pending" | "overdue" | "void";
};

export type Notice = {
  id: string;
  title: string;
  body: string;
  from: string;
  at: Date;
};

export type Attendance = { attended: number; total: number };

type State = {
  ready: boolean;
  error: string | null;
  academy: { name: string; shortName: string; mark: string; signalColor: string };
  guardian: { name: string; firstName: string };
  children: Child[];
  trainings: Training[];
  matches: Match[];
  payments: Payment[];
  notices: Notice[];
  notifications: ApiNotification[];
  /** Assiduidade por atleta, derivada dos treinos com registo. */
  attendance: Record<string, Attendance>;
};

const EMPTY: State = {
  ready: false,
  error: null,
  academy: { name: "", shortName: "", mark: "", signalColor: "#0f6b62" },
  guardian: { name: "", firstName: "" },
  children: [],
  trainings: [],
  matches: [],
  payments: [],
  notices: [],
  notifications: [],
  attendance: {},
};

let state: State = EMPTY;
const listeners = new Set<() => void>();

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const snapshot = () => state;

export function useStore(): State {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

let loading: Promise<void> | null = null;

/** Carrega tudo. Chamadas concorrentes partilham o mesmo pedido. */
export function load(): Promise<void> {
  if (loading) return loading;

  loading = (async () => {
    try {
      const boot = await apiGet<ApiBootstrap>("/api/bootstrap");
      // A identidade da academia assim que se sabe qual é — e guardada para o
      // próximo arranque (e para a barreira de instalação) abrirem já certos.
      applyBrand({
        color: boot.academy.signalColor,
        shortName: boot.academy.shortName,
        mark: initials(boot.academy.shortName),
      });

      const from = new Date(Date.now() - 120 * 86_400_000).toISOString();
      const to = new Date(Date.now() + 60 * 86_400_000).toISOString();

      const [athletes, teams, sessions, matches, charges, announcements, notifications] = await Promise.all([
        soft<ApiAthlete>("/api/athletes"),
        soft<ApiTeam>("/api/teams"),
        soft<ApiSession>(`/api/sessions?from=${from}&to=${to}`),
        soft<ApiMatch>("/api/matches"),
        soft<ApiCharge>("/api/charges"),
        soft<ApiAnnouncement>("/api/announcements"),
        soft<ApiNotification>("/api/notifications"),
      ]);

      // O preço é por atleta e pode ter ajuste individual — um pedido por filho,
      // que numa família são um ou dois.
      const fees = await Promise.all(
        athletes.map((a) =>
          apiGet<{ effectiveAmountCents: number | null }>(`/api/athletes/${a.id}/fee`)
            .then((f) => [a.id, f.effectiveAmountCents] as const)
            .catch(() => [a.id, null] as const),
        ),
      );

      apply(build(boot, athletes, teams, sessions, matches, charges, announcements, notifications, new Map(fees)));
    } catch (error) {
      apply({
        ...EMPTY,
        ready: true,
        error: error instanceof Error ? error.message : "Não foi possível carregar.",
      });
    }
  })();

  return loading;
}

/** Relê tudo — depois de pagar, de marcar notificações como lidas, etc. */
export function reload(): Promise<void> {
  loading = null;
  return load();
}

/* -------------------------------------------------------------------------- */
/* Tradução                                                                    */
/* -------------------------------------------------------------------------- */

function build(
  boot: ApiBootstrap,
  athletes: ApiAthlete[],
  teams: ApiTeam[],
  sessions: ApiSession[],
  matches: ApiMatch[],
  charges: ApiCharge[],
  announcements: ApiAnnouncement[],
  notifications: ApiNotification[],
  fees: Map<string, number | null>,
): State {
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const sportById = new Map(boot.sports.map((s) => [s.id, s.name]));

  const children: Child[] = athletes.map((a) => {
    const team = a.teamId ? teamById.get(a.teamId) : undefined;
    return {
      id: a.id,
      name: a.name,
      firstName: a.name.split(/\s+/)[0],
      team: team?.name ?? "Sem equipa",
      teamId: a.teamId ?? "",
      sport: team ? (sportById.get(team.sportId) ?? "") : "",
      coach: team?.coaches[0]?.name ?? "Sem treinador atribuído",
      feeCents: fees.get(a.id) ?? null,
      photoUrl: a.photoUrl ?? undefined,
      availability: a.availability,
    };
  });

  // Um treino é da equipa; a app mostra-o ao filho que está nessa equipa. Dois
  // irmãos na mesma equipa veriam o mesmo treino, cada um no seu separador.
  const byTeam = new Map<string, string[]>();
  for (const c of children) {
    byTeam.set(c.teamId, [...(byTeam.get(c.teamId) ?? []), c.id]);
  }

  const trainings: Training[] = sessions.flatMap((s) =>
    (byTeam.get(s.teamId) ?? []).map((childId) => ({
      id: `${s.id}-${childId}`,
      childId,
      start: new Date(s.startsAt),
      end: new Date(s.endsAt),
      venue: s.venue,
      dressingRoom: s.dressingRoom ?? undefined,
      coach: s.coachName ?? undefined,
      cancelled: s.status === "CANCELLED",
    })),
  );

  const asMatches: Match[] = matches.flatMap((m) =>
    (byTeam.get(m.teamId) ?? []).map((childId) => ({
      id: `${m.id}-${childId}`,
      childId,
      start: new Date(m.startsAt),
      end: new Date(m.endsAt),
      venue: m.venue,
      opponent: m.opponent,
      isHome: m.isHome,
      cancelled: m.status === "CANCELLED",
      // Só conta se a convocatória tiver sido **submetida** — uma lista em
      // rascunho não é uma convocatória, e prometê-la ao pai é prometer o que
      // ainda pode mudar.
      calledUp: m.submitted && m.calledUp.some((c) => c.athleteId === childId),
    })),
  );

  const payments: Payment[] = charges.map((c) => ({
    id: c.id,
    childId: c.athleteId,
    period: c.period,
    label: monthLabel(c.period),
    amountCents: c.amountCents,
    dueDate: new Date(c.dueDate),
    status:
      c.status === "SETTLED" ? "paid" : c.status === "VOID" ? "void" : c.overdue ? "overdue" : "pending",
  }));

  const notices: Notice[] = announcements
    .filter((a) => a.publishedAt)
    .map((a) => ({
      id: a.id,
      title: a.title,
      body: a.body,
      from: a.authorName,
      at: new Date(a.publishedAt as string),
    }));

  /*
   * Assiduidade a partir do que existe: guarda-se a excepção, não a norma.
   *
   * Um treino com registo (`recorded`) e sem o atleta na lista de faltas é uma
   * presença. Um treino **por registar** não conta para nenhum dos lados — não é
   * uma falta, é uma lacuna, e inflacionar a assiduidade com ele seria mentir na
   * direcção mais simpática.
   */
  const attendance: Record<string, Attendance> = {};
  for (const c of children) attendance[c.id] = { attended: 0, total: 0 };
  const now = Date.now();
  for (const s of sessions) {
    if (!s.recorded || s.status === "CANCELLED" || new Date(s.startsAt).getTime() > now) continue;
    for (const childId of byTeam.get(s.teamId) ?? []) {
      const hit = s.absences.find((a) => a.athleteId === childId);
      const missed = hit && hit.status !== "LATE";
      attendance[childId].total += 1;
      if (!missed) attendance[childId].attended += 1;
    }
  }

  return {
    ready: true,
    error: null,
    academy: {
      name: boot.academy.name,
      shortName: boot.academy.shortName,
      mark: initials(boot.academy.shortName),
      signalColor: boot.academy.signalColor,
    },
    guardian: { name: boot.me.name, firstName: boot.me.name.split(/\s+/)[0] },
    children,
    trainings,
    matches: asMatches,
    payments,
    notices,
    notifications,
    attendance,
  };
}

function apply(next: State) {
  state = next;
  listeners.forEach((l) => l());
}

const MONTHS = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

/** "2026-08" → "Agosto". O ano só aparece quando não é o corrente. */
function monthLabel(period: string): string {
  const [year, month] = period.split("-").map(Number);
  const name = MONTHS[month - 1] ?? period;
  return year === new Date().getFullYear() ? name : `${name} ${year}`;
}

function initials(name: string): string {
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0] ?? "") + (p[1]?.[0] ?? "")).toUpperCase() || (p[0]?.slice(0, 2).toUpperCase() ?? "");
}

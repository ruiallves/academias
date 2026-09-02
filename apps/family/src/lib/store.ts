import { useSyncExternalStore } from "react";
import { ApiError, apiGet, soft } from "@/lib/http";
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
  academy: { id: string; slug: string; name: string; shortName: string; signalColor: string; city: string | null; logoUrl: string | null };
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
  /** A idade máxima da equipa. Substituiu o escalão em texto. */
  maxAge: number;
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
  openPayment: OpenPayment | null;
};

/** A tentativa de pagamento viva de uma mensalidade, se houver. */
export type OpenPayment = {
  method: string;
  status: string;
  entity: string | null;
  reference: string | null;
  redirectUrl: string | null;
};

type ApiAnnouncement = {
  id: string;
  title: string;
  body: string;
  audience: string;
  authorName: string;
  publishedAt: string | null;
};

type ApiEvaluation = {
  id: string;
  athleteId: string;
  period: string;
  status: string;
  scores: Record<string, number>;
  note: string | null;
  strengths: string | null;
  focus: string | null;
  coachName: string;
  publishedAt: string | null;
};

type ApiReport = {
  id: string;
  athleteId: string;
  title: string;
  period: string | null;
  body: string;
  authorName: string;
  publishedAt: string | null;
  snapshot: { attendance?: { attended: number; total: number }; matches?: number } | null;
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
  /** A tentativa em curso — a referência Multibanco gerada, o formulario aberto. */
  openPayment: OpenPayment | null;
};

export type Notice = {
  id: string;
  title: string;
  body: string;
  from: string;
  at: Date;
};

export type Attendance = { attended: number; total: number };

/**
 * A avaliação do treinador, tal como o servidor a entrega.
 *
 * Só chegam aqui as **publicadas** — o filtro é do servidor, a partir do papel de
 * quem pergunta, e não de nada que esta app decida. Um rascunho meio escrito nunca
 * sai da consola.
 */
export type Evaluation = {
  id: string;
  childId: string;
  period: string;
  scores: Record<string, number>;
  note: string | null;
  strengths: string | null;
  focus: string | null;
  coachName: string;
  publishedAt: Date | null;
};

/** Um relatório partilhado. Os internos nunca saem da academia — ver `reports.service.ts`. */
export type Report = {
  id: string;
  childId: string;
  title: string;
  period: string | null;
  body: string;
  authorName: string;
  publishedAt: Date | null;
  snapshot: { attendance?: { attended: number; total: number }; matches?: number } | null;
};

type State = {
  ready: boolean;
  error: string | null;
  /**
   * A conta que entrou não pode usar esta app — e o motivo, dito pelo servidor.
   *
   * É diferente de `error`, e a diferença é a saída: um erro de carregamento
   * resolve-se a tentar outra vez, este só se resolve entrando com outra conta.
   * Tratá-los como a mesma coisa dava o ecrã que dava — "Não foi possível
   * carregar" com um botão que recarrega para o mesmo sítio, para sempre.
   */
  denied: string | null;
  academy: { name: string; shortName: string; mark: string; signalColor: string; logoUrl: string | null };
  /**
   * Quem entrou. O email vem junto porque há um ecrã que precisa dele: quando a
   * conta não tem educandos, a pergunta que fica no ar é "em que conta é que eu
   * estou?" — e ninguém a responde a partir do primeiro nome.
   */
  guardian: { name: string; firstName: string; email: string };
  /**
   * O papel de quem entrou nesta academia.
   *
   * Existe por uma razão só: esta app trata `children` como **os filhos de quem
   * está a ver**, e isso só é verdade para uma conta de família. Ver a porta em
   * `App.tsx`.
   */
  role: string;
  children: Child[];
  trainings: Training[];
  matches: Match[];
  payments: Payment[];
  notices: Notice[];
  notifications: ApiNotification[];
  evaluations: Evaluation[];
  reports: Report[];
  /** Assiduidade por atleta, derivada dos treinos com registo. */
  attendance: Record<string, Attendance>;
};

const EMPTY: State = {
  ready: false,
  error: null,
  denied: null,
  academy: { name: "", shortName: "", mark: "", signalColor: "#0f6b62", logoUrl: null },
  guardian: { name: "", firstName: "", email: "" },
  role: "",
  children: [],
  trainings: [],
  matches: [],
  payments: [],
  notices: [],
  notifications: [],
  evaluations: [],
  reports: [],
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
        logoUrl: boot.academy.logoUrl ?? null,
      });

      const from = new Date(Date.now() - 120 * 86_400_000).toISOString();
      const to = new Date(Date.now() + 60 * 86_400_000).toISOString();

      const [athletes, teams, sessions, matches, charges, announcements, notifications, evaluations, reports] =
        await Promise.all([
          soft<ApiAthlete>("/api/athletes"),
          soft<ApiTeam>("/api/teams"),
          soft<ApiSession>(`/api/sessions?from=${from}&to=${to}`),
          soft<ApiMatch>("/api/matches"),
          soft<ApiCharge>("/api/charges"),
          soft<ApiAnnouncement>("/api/announcements"),
          soft<ApiNotification>("/api/notifications"),
          // `soft`: uma academia sem avaliações publicadas devolve lista vazia, e a
          // app abre à mesma. Isto não é o coração da app — é o que se vai lá ver
          // uma vez por período.
          soft<ApiEvaluation>("/api/evaluations"),
          soft<ApiReport>("/api/reports"),
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

      apply(
        build(boot, athletes, teams, sessions, matches, charges, announcements, notifications, new Map(fees), evaluations, reports),
      );
    } catch (error) {
      /*
       * Um 403 no arranque não é uma avaria: é esta conta a não ter lugar nesta
       * app. Acontece a quem entrou com a conta de trabalho — e a quem tem as
       * duas, se a do clube ficar a última a ser usada neste telemóvel.
       *
       * Separá-lo aqui é o que permite ao ecrã oferecer a única saída que
       * resolve: sair e entrar com a conta certa.
       */
      if (error instanceof ApiError && error.status === 403) {
        apply({ ...EMPTY, ready: true, denied: error.message });
        return;
      }
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

/**
 * Esquece o que estava carregado e volta a carregar de raiz.
 *
 * ## O bug que isto fecha
 *
 * Quem chegava com a sessão expirada via a app tentar carregar, apanhar 401 e
 * guardar `error: "A sessão expirou"`. A seguir entrava com a password certa — e
 * continuava a ver o mesmo erro, porque o estado da tentativa falhada ficava lá:
 * `ready` já era `true` e `error` ainda estava preenchido, por isso a app pintava
 * o ecrã de avaria em vez do splash enquanto o novo arranque corria. Só um
 * recarregamento da página (o botão "Tentar outra vez") limpava aquilo.
 *
 * O `reload()` normal não serve aqui: esse é para quando já há dados no ecrã e se
 * quer actualizá-los sem piscar. Trocar de sessão é outra coisa — o que estava
 * carregado era de outra pessoa e não deve sobreviver um instante que seja.
 */
export function resetAndLoad(): Promise<void> {
  loading = null;
  apply(EMPTY);
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
  evaluations: ApiEvaluation[],
  reports: ApiReport[],
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
    openPayment: c.openPayment ?? null,
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

  /*
   * Avaliações e relatórios, do mais recente para o mais antigo.
   *
   * O servidor já filtrou o que é publicado (e, nos relatórios, o que é de
   * família): aqui só se ordena e se converte datas. Refiltrar seria fingir uma
   * segunda defesa que não defende nada — a app corre no telemóvel de quem lê.
   */
  const evaluationsOut: Evaluation[] = evaluations
    .map((e) => ({
      id: e.id,
      childId: e.athleteId,
      period: e.period,
      scores: e.scores ?? {},
      note: e.note,
      strengths: e.strengths,
      focus: e.focus,
      coachName: e.coachName,
      publishedAt: e.publishedAt ? new Date(e.publishedAt) : null,
    }))
    .sort((a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0));

  const reportsOut: Report[] = reports
    .map((r) => ({
      id: r.id,
      childId: r.athleteId,
      title: r.title,
      period: r.period,
      body: r.body,
      authorName: r.authorName,
      publishedAt: r.publishedAt ? new Date(r.publishedAt) : null,
      snapshot: r.snapshot,
    }))
    .sort((a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0));

  return {
    ready: true,
    error: null,
    denied: null,
    evaluations: evaluationsOut,
    reports: reportsOut,
    academy: {
      name: boot.academy.name,
      shortName: boot.academy.shortName,
      mark: initials(boot.academy.shortName),
      logoUrl: boot.academy.logoUrl ?? null,
      signalColor: boot.academy.signalColor,
    },
    guardian: { name: boot.me.name, firstName: boot.me.name.split(/\s+/)[0], email: boot.me.email },
    role: boot.me.role,
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

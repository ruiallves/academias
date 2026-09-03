import { useSyncExternalStore } from "react";
import { apiGet } from "@/lib/http";
import type {
  Academy,
  Announcement,
  Athlete,
  Evaluation,
  Fee,
  FeeStatus,
  Guardian,
  StaffMember,
  Team,
  TrainingSession,
} from "@/data/types";
import type { Role } from "@/lib/permissions";

/**
 * Os dados da academia, vindos da base de dados.
 *
 * Substitui `src/data/demo.ts`. Exporta os mesmos nomes e as mesmas formas de
 * propósito — foi o que permitiu trocar a origem sem reescrever dezanove ecrãs.
 *
 * ## Porquê carregar tudo de uma vez
 *
 * Uma academia inteira são umas centenas de linhas: nove atletas, duas equipas,
 * meia dúzia de pessoas, os treinos de um mês. Cabe todo numa mão-cheia de pedidos
 * feitos ao entrar, e a partir daí a consola navega sem esperas — que é o que se
 * quer de uma ferramenta que alguém tem aberta o dia todo.
 *
 * A alternativa — cada ecrã a pedir o que precisa — dava dezanove estados de
 * carregamento a coordenar, e a mesma equipa pedida em quatro sítios diferentes.
 * Quando uma academia crescer ao ponto de isto doer, os pedidos por ecrã entram
 * aqui, atrás das mesmas funções, e nenhum ecrã muda.
 *
 * ## O que ainda não vem da base
 *
 * Avaliações, comunicados e histórico de equipas ficam vazios: não há tabelas
 * semeadas nem endpoints para eles. Ficam **vazios e não inventados** — um ecrã
 * que diz "ainda não há avaliações" é honesto; um que mostra avaliações a fingir
 * ensina a não confiar no produto.
 */

/* -------------------------------------------------------------------------- */
/* O que a API devolve                                                         */
/* -------------------------------------------------------------------------- */

type ApiBootstrap = {
  academy: {
    id: string; slug: string; name: string; shortName: string; city: string | null; signalColor: string;
    logoUrl: string | null;
    status: string;
    trialEndsAt: string | null;
    createdAt: string;
    /** O calendário de cobrança do clube. Ver `setBillingSettings` na API. */
    billingDueDay: number;
    billingMonths: number[];
    /** O que o clube escreveu na página pública de adesão a sócio. */
    membershipHeadline: string | null;
    membershipIntro: string | null;
    membershipPoints: string[];
  };
  sports: { id: string; name: string; positions: string[]; skills: string[]; dominantSideLabel: string | null; matchMinutes: number | null }[];
  season: { id: string; label: string } | null;
  /** Todas as épocas da academia, da mais recente para trás. */
  seasons?: { id: string; label: string; isCurrent: boolean }[];
  me: {
    membershipId: string;
    userId: string;
    /** Se o painel de arranque é desta pessoa. Ver `setupOwner` no servidor. */
    setupOwner?: boolean;
    name: string;
    email: string;
    role: Role;
    /** O cargo principal, quando esta pessoa tem um configurado. */
    roleId: string | null;
    roleName: string | null;
    /** Os cargos secundários — só para se mostrarem; as permissões já vêm somadas. */
    extraRoles: { id: string; name: string }[];
    /**
     * As permissões do papel, resolvidas pelo servidor.
     *
     * Vêm de lá e não do mapa local de propósito: a academia pode ter editado o
     * papel há um minuto, e uma cópia em código passaria a mentir a partir daí.
     */
    permissions: string[];
    /** Menus que o papel mostra. Vazio = todos os que a permissão deixar. */
    navKeys: string[];
    title: string | null;
    department: string | null;
    grants: string[];
    revokes: string[];
    scope: { teamIds?: string[]; athleteIds?: string[] };
  };
};

type ApiTeam = {
  id: string; name: string; maxAge: number; sportId: string; season: string;
  schedule: unknown; athleteCount: number;
  coaches: { id: string; name: string; title: string }[];
  /** As provas que a equipa disputa — sem as arquivadas. Ver `teams()` na API. */
  competitions: { id: string; label: string }[];
  /** O preço por omissão da equipa, em cêntimos. `null` sem `billing:read` ou por configurar. */
  feeCents: number | null;
};

type ApiAthlete = {
  id: string; name: string; birthdate: string; photoUrl: string | null; status: string; joinedAt: string;
  /** `null` para quem não tem `family:read` — um treinador não recebe o NIF. */
  taxId: string | null;
  heightCm: number | null; weightKg: number | null; dominantSide: string | null; squadNumber: number | null;
  medicalValidUntil: string | null; teamId: string | null; position: string | null;
  guardians: {
    membershipId: string; name: string; email: string; phone: string | null; relation: string;
    isActive: boolean;
    /** Se esta família tem a app a funcionar num telemóvel. Ver `athletes()` na API. */
    appInstalled: boolean;
  }[];
  availability: "available" | "limited" | "out";
  // `title` (o diagnóstico) vem `null` para quem não tem `clinical:read` — o
  // servidor retém o dado sensível, mas mantém a disponibilidade. Ver a auditoria
  // de segurança, VULN-002.
  restriction: { id: string; title: string | null; since: string; expectedReturn: string | null } | null;
};

type ApiStaff = {
  id: string; name: string; email: string; phone: string | null; role: Role;
  /** Link assinado com prazo, ou nulo. A chave nunca sai do servidor. */
  photoUrl: string | null;
  title: string | null; department: string | null; isActive: boolean; grants: string[]; revokes: string[];
  /** O cargo principal atribuído a esta pessoa, quando tem um. */
  roleId: string | null; roleName: string | null;
  /** Os cargos que se lhe acrescentaram. Ver `MembershipRole` no servidor. */
  extraRoles: { id: string; name: string }[];
  since: string; teamIds: string[];
};

type ApiSession = {
  id: string; teamId: string; teamName: string; startsAt: string; endsAt: string; venue: string; dressingRoom: string | null; status: string;
  coachId: string | null; coachName: string | null; recorded: boolean;
  /** É de uma equipa minha? Ver `inTeamScope` no servidor. */
  mine: boolean;
  /** Vazio quando o treino não é meu — quem faltou é do escalão. */
  absences: { athleteId: string; status: string; note?: string | null }[];
};

/** Um evento pontual do calendário — o que "Novo evento" cria. Ver `GET /api/events`. */
export type ApiEvent = {
  id: string; teamId: string | null; teamName: string | null; mine: boolean;
  kind: "TRAINING" | "MATCH" | "TOURNAMENT" | "OTHER";
  title: string; startsAt: string; endsAt: string; venue: string; dressingRoom: string | null; cancelled: boolean;
  coachId: string | null; coachName: string | null;
};

export type ApiMatch = {
  id: string; teamId: string; teamName: string; maxCallUps: number;
  startsAt: string; endsAt: string; venue: string; opponent: string; isHome: boolean;
  status: string; ourScore: number | null; theirScore: number | null;
  /**
   * Quem o dirige — o do jogo, ou o da equipa quando o jogo não tem o seu.
   *
   * Derivado no servidor (ver `headCoaches`), como nos treinos. Faltava aqui, e
   * era metade do bug: mesmo que a API o mandasse, o calendário não o lia.
   */
  coachId: string | null; coachName: string | null;
  /** A prova em que se joga. `null` num amigável. */
  competition: { id: string; label: string } | null;
  submitted: boolean; submittedAt: string | null;
  /** É de uma equipa minha? Decide o que vem preenchido e o que se pode abrir. */
  mine: boolean;
  /** A função com que quem pergunta está escalado neste jogo. Ver `MatchesService.list`. */
  myStaffRole: string | null;
  calledUp: { athleteId: string; status: string; isGuest: boolean; guestFromTeam?: string }[];
  /**
   * A ficha do jogo, quando já está preenchida.
   *
   * Faltava aqui, e era o buraco por onde o registo de jogos da ficha do atleta
   * caía: lia as participações do calendário, o calendário lia-as da API, e a
   * API nunca as mandava. Ver `fromApiMatch`.
   */
  appearances: {
    athleteId: string; minutes: number; started: boolean; tally: number; assists: number;
    yellowCards: number; redCard: boolean;
    onMinute: number | null; offMinute: number | null;
    yellowAt: number[]; redAt: number | null;
    tallyAt: number[]; assistsAt: number[];
    rating: number | null;
  }[];
};

/** Um atleta de outro escalão, elegível para subir a este jogo. Ver `MatchesService.guestPool`. */
export type GuestCandidate = {
  id: string;
  name: string;
  squadNumber: number | null;
  position: string | null;
  teamId: string;
  teamName: string;
  blocked: boolean;
};

type ApiCharge = {
  id: string; athleteId: string; athleteName: string; teamId: string | null; period: string;
  /** `FEE` é a mensalidade do mês; `EXTRA` é o que o clube cobrou à parte. */
  kind: string; title: string | null;
  amountCents: number; dueDate: string; status: string; overdue: boolean;
};

/** Uma comunicação publicada, com a taxa de leitura. Ver `GET /api/announcements`. */
type ApiAnnouncement = {
  id: string; title: string; body: string; audience: string;
  authorId: string; authorName: string; publishedAt: string | null; reach: number; read: number;
};

/* -------------------------------------------------------------------------- */
/* O estado                                                                    */
/* -------------------------------------------------------------------------- */

export type Me = ApiBootstrap["me"];

type State = {
  ready: boolean;
  error: string | null;
  academy: Academy;
  season: string;
  /** Os rótulos das épocas que existem, da mais recente para trás. */
  seasons: string[];
  me: Me | null;
  teams: Team[];
  staff: StaffMember[];
  athletes: Athlete[];
  guardians: Guardian[];
  sessions: TrainingSession[];
  fees: Fee[];
  matches: ApiMatch[];
  events: ApiEvent[];
  announcements: Announcement[];
};

/**
 * A academia antes de carregar.
 *
 * Não é uma academia a fingir: é o mínimo para o React desenhar a casca sem
 * rebentar enquanto o pedido não volta. `ready: false` é o que mantém os ecrãs à
 * espera — nenhum deles chega a ver isto.
 */
const EMPTY: State = {
  ready: false,
  error: null,
  academy: {
    id: "", slug: "", name: "", shortName: "", signalColor: "#0f6b62", logoUrl: "", city: "",
    status: "ACTIVE", trialEndsAt: null, createdAt: "",
    billingDueDay: 8, billingMonths: [],
    membershipHeadline: "", membershipIntro: "", membershipPoints: [],
    sports: [],
  },
  season: "",
  seasons: [],
  me: null,
  teams: [],
  staff: [],
  athletes: [],
  guardians: [],
  sessions: [],
  fees: [],
  matches: [],
  events: [],
  announcements: [],
};

let state: State = EMPTY;
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const snapshot = () => state;

export function useStore(): State {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/* -------------------------------------------------------------------------- */
/* Carregamento                                                                */
/* -------------------------------------------------------------------------- */

let loading: Promise<void> | null = null;

/** Carrega a academia. Chamadas concorrentes partilham o mesmo pedido. */
export function loadAcademy(): Promise<void> {
  if (loading) return loading;

  loading = (async () => {
    try {
      const boot = await apiGet<ApiBootstrap>("/api/bootstrap");

      // Em paralelo: são independentes, e em série somavam quatro idas ao servidor.
      // As que a pessoa não pode ver falham com 403 e ficam vazias — um treinador
      // não vê mensalidades, e isso não pode impedir a consola de arrancar.
      const [teams, athletes, staff, sessions, fees, matches, events, announcements] = await Promise.all([
        soft<ApiTeam>("/api/teams"),
        soft<ApiAthlete>("/api/athletes"),
        soft<ApiStaff>("/api/staff"),
        soft<ApiSession>("/api/sessions"),
        soft<ApiCharge>("/api/charges"),
        soft<ApiMatch>("/api/matches"),
        soft<ApiEvent>("/api/events"),
        soft<ApiAnnouncement>("/api/announcements"),
      ]);

      apply(build(boot, teams, athletes, staff, sessions, fees, matches, events, announcements));
    } catch (error) {
      apply({ ...EMPTY, ready: true, error: error instanceof Error ? error.message : "Não foi possível carregar." });
    }
  })();

  return loading;
}

/** Volta a carregar do zero — depois de criar um atleta, importar um ficheiro, etc. */
export function reloadAcademy(): Promise<void> {
  loading = null;
  return loadAcademy();
}

/**
 * Um pedido que pode ser recusado sem ser um erro.
 *
 * Um 403 aqui não é uma avaria: é o âmbito a funcionar. O treinador que não vê
 * mensalidades recebe uma lista vazia, e a navegação já não lhe mostra o ecrã.
 */
async function soft<T>(path: string): Promise<T[]> {
  try {
    return (await apiGet<T[]>(path)) ?? [];
  } catch {
    return [];
  }
}

/* -------------------------------------------------------------------------- */
/* Tradução                                                                    */
/* -------------------------------------------------------------------------- */

function build(
  boot: ApiBootstrap,
  apiTeams: ApiTeam[],
  apiAthletes: ApiAthlete[],
  apiStaff: ApiStaff[],
  apiSessions: ApiSession[],
  apiFees: ApiCharge[],
  apiMatches: ApiMatch[],
  apiEvents: ApiEvent[],
  apiAnnouncements: ApiAnnouncement[],
): State {
  const teams: Team[] = apiTeams.map((t) => ({
    id: t.id,
    name: t.name,
    sportId: t.sportId,
    maxAge: t.maxAge,
    season: t.season,
    coachIds: t.coaches.map((c) => c.id),
    coaches: t.coaches,
    athleteIds: apiAthletes.filter((a) => a.teamId === t.id).map((a) => a.id),
    schedule: Array.isArray(t.schedule) ? (t.schedule as Team["schedule"]) : [],
    competitions: t.competitions ?? [],
    feeCents: t.feeCents,
  }));

  const athletes: Athlete[] = apiAthletes.map((a) => ({
    id: a.id,
    name: a.name,
    birthdate: a.birthdate,
    taxId: a.taxId ?? undefined,
    teamId: a.teamId ?? "",
    position: a.position ?? undefined,
    guardianIds: a.guardians.map((g) => g.membershipId),
    joinedAt: a.joinedAt,
    status: a.status === "PAUSED" ? "paused" : a.status === "LEFT" ? "left" : "active",
    // Sem `?? ""`: a ausência passa intacta. Ver `medicalValidUntil` em `types.ts`.
    medicalValidUntil: a.medicalValidUntil,
    photoUrl: a.photoUrl ?? undefined,
    heightCm: a.heightCm ?? undefined,
    weightKg: a.weightKg ?? undefined,
    dominantSide: (a.dominantSide?.toLowerCase() as Athlete["dominantSide"]) ?? undefined,
    squadNumber: a.squadNumber ?? undefined,
    /*
     * A baixa clínica, vinda do servidor.
     *
     * ## O bug que isto corrigiu
     *
     * O servidor mandava `availability` e `restriction` em cada atleta, e o
     * store deitava-os fora. Tudo o que decide disponibilidade no cliente —
     * `activeRestriction`, `isUnavailable`, o `blockedBy` das convocatórias —
     * lê `athlete.clinical`, que **nunca era preenchido**: a lista estava sempre
     * vazia, ninguém aparecia de baixa, e a interface deixava convocar um atleta
     * parado sem uma palavra. O erro só chegava ao guardar, vindo do servidor,
     * com um nome que o treinador não fazia ideia de porque estava ali.
     *
     * A regra continua a ser a do servidor — é ele a fronteira, e é ele que
     * recusa. Isto é o que faz a interface **saber o mesmo** e avisar antes,
     * em vez de deixar montar uma convocatória inteira para a recusar no fim.
     *
     * Uma entrada só, a que está a afectar hoje: é o que o `/api/athletes`
     * traz. O boletim completo é outra leitura, do departamento clínico.
     */
    clinical: a.restriction
      ? [
          {
            id: a.restriction.id,
            kind: "injury",
            // `DONE`: é uma baixa a decorrer, não um agendamento. A leitura de
            // `activeRestriction` ignora agendados e cancelados.
            status: "done",
            date: a.restriction.since.slice(0, 10),
            // Sem `clinical:read` o servidor retém o diagnóstico e manda `null`
            // — a disponibilidade chega na mesma, o motivo é que não.
            title: a.restriction.title ?? "Indisponível",
            impact: a.availability === "out" ? "out" : "limited",
            expectedReturn: a.restriction.expectedReturn ?? undefined,
            clearedOn: undefined,
          },
        ]
      : undefined,
  }));

  /*
   * Encarregados.
   *
   * A API devolve-os dentro de cada atleta — é assim que se lêem, a partir da
   * ficha. Aqui invertem-se para uma lista de pessoas com os educandos agregados,
   * que é como a página Famílias os mostra. A mesma mãe com dois filhos aparece
   * uma vez, com dois educandos, e não duas vezes.
   */
  const byGuardian = new Map<string, Guardian>();
  for (const a of apiAthletes) {
    for (const g of a.guardians) {
      const existing = byGuardian.get(g.membershipId);
      if (existing) {
        existing.athleteIds.push(a.id);
        // A app é da pessoa, não do filho: chega vir marcada num dos educandos.
        existing.appInstalled ||= g.appInstalled ?? false;
        continue;
      }
      byGuardian.set(g.membershipId, {
        id: g.membershipId,
        name: g.name,
        email: g.email,
        phone: g.phone ?? "",
        relation: (g.relation as Guardian["relation"]) ?? "Encarregado",
        isActive: g.isActive ?? true,
        athleteIds: [a.id],
        // Vem do servidor: há ou não um dispositivo registado para esta pessoa.
        // Era um `false` escrito à mão, e por isso a consola dizia "Por instalar"
        // a famílias que já tinham a app no telemóvel. Ver `athletes()` na API.
        appInstalled: g.appInstalled ?? false,
      });
    }
  }

  const staff: StaffMember[] = apiStaff.map((s) => ({
    id: s.id,
    name: s.name,
    email: s.email,
    phone: s.phone ?? "",
    photoUrl: s.photoUrl ?? undefined,
    role: s.role,
    title: s.title ?? "",
    department: departmentOf(s.department),
    teamIds: s.teamIds,
    since: s.since,
    isActive: s.isActive,
    grants: s.grants,
    revokes: s.revokes,
    roleId: s.roleId,
    roleName: s.roleName,
    extraRoles: s.extraRoles ?? [],
  }));

  const sessions: TrainingSession[] = apiSessions.map((s) => ({
    id: s.id,
    teamId: s.teamId,
    teamName: s.teamName,
    mine: s.mine,
    start: s.startsAt,
    end: s.endsAt,
    venue: s.venue,
    dressingRoom: s.dressingRoom ?? undefined,
    coachId: s.coachId ?? undefined,
    coachName: s.coachName ?? undefined,
    status: s.status === "DONE" ? "done" : s.status === "CANCELLED" ? "cancelled" : "scheduled",
    // `recorded` a falso é "ninguém verificou" e tem de continuar indistinguível de
    // uma lista de faltas vazia — que significa "estiveram todos".
    attendance: s.recorded
      ? {
          absences: s.absences.map((x) => ({
            athleteId: x.athleteId,
            kind: x.status === "JUSTIFIED" ? "justified" : x.status === "LATE" ? "late" : "absent",
            // O motivo da justificada — a ficha do atleta mostra-o ao lado da
            // falta, e sem ele o campo aparecia vazio depois de recarregar.
            ...(x.note ? { note: x.note } : {}),
          })),
          recordedAt: s.endsAt,
        }
      : undefined,
  }));

  const fees: Fee[] = apiFees.map((c) => ({
    id: c.id,
    athleteId: c.athleteId,
    period: c.period,
    extra: c.kind === "EXTRA",
    title: c.title ?? undefined,
    amountCents: c.amountCents,
    dueDate: c.dueDate,
    // "Vencida" não é estado guardado: é derivado da data, e o servidor já o disse.
    // "Anulada" (VOID) é decisão da direção; o resto em aberto é "Não pago".
    status: (
      c.status === "SETTLED" ? "paid" : c.status === "VOID" ? "void" : c.overdue ? "overdue" : "pending"
    ) as FeeStatus,
  }));

  return {
    ready: true,
    error: null,
    academy: {
      id: boot.academy.id,
      slug: boot.academy.slug,
      name: boot.academy.name,
      shortName: boot.academy.shortName,
      signalColor: boot.academy.signalColor,
      logoUrl: boot.academy.logoUrl ?? "",
      city: boot.academy.city ?? "",
      status: boot.academy.status,
      trialEndsAt: boot.academy.trialEndsAt,
      billingDueDay: boot.academy.billingDueDay ?? 8,
      billingMonths: boot.academy.billingMonths ?? [],
      createdAt: boot.academy.createdAt,
      membershipHeadline: boot.academy.membershipHeadline ?? "",
      membershipIntro: boot.academy.membershipIntro ?? "",
      membershipPoints: boot.academy.membershipPoints ?? [],
      sports: boot.sports.map((s) => ({
        id: s.id,
        name: s.name,
        positions: s.positions,
        skills: s.skills,
        dominantSideLabel: s.dominantSideLabel ?? undefined,
        matchMinutes: s.matchMinutes ?? undefined,
      })),
    },
    season: boot.season?.label ?? "",
    seasons: (boot.seasons ?? []).map((s) => s.label),
    me: boot.me,
    teams,
    staff,
    athletes,
    guardians: [...byGuardian.values()],
    sessions,
    fees,
    matches: apiMatches,
    events: apiEvents,
    announcements: apiAnnouncements.map((a) => ({
      id: a.id,
      title: a.title,
      body: a.body,
      audience: a.audience,
      publishedAt: a.publishedAt ?? "",
      authorId: a.authorId,
      authorName: a.authorName,
      reach: a.reach,
      read: a.read,
    })),
  };
}

function departmentOf(value: string | null): StaffMember["department"] {
  switch (value) {
    case "DIRECTION":
      return "direction";
    case "CLINICAL":
      return "clinical";
    case "SCOUTING":
      return "scouting";
    case "OPERATIONS":
      return "operations";
    default:
      return "technical";
  }
}

/* -------------------------------------------------------------------------- */
/* Os nomes que o resto da consola importa                                     */
/* -------------------------------------------------------------------------- */
/*
 * `let` e não `const`, e reatribuído em `apply()`.
 *
 * São **live bindings** de ES modules: quem importa `teams` vê sempre o valor
 * actual, sem ter de chamar nada. É o que permitiu trocar a origem dos dados de um
 * ficheiro estático para a base de dados sem tocar em dezanove ecrãs — continuam a
 * escrever `teams.filter(...)` como sempre escreveram.
 *
 * A única regra é não copiar estes valores na inicialização de outro módulo
 * (`const meus = teams`), porque isso captura o array vazio de antes do
 * carregamento. Usados dentro de funções — que é como toda a consola os usa — lêem
 * o valor actual a cada chamada.
 */

export let academy: Academy = EMPTY.academy;
export let teams: Team[] = [];
export let staff: StaffMember[] = [];
export let coaches: StaffMember[] = [];
export let athletes: Athlete[] = [];
export let guardians: Guardian[] = [];
export let sessions: TrainingSession[] = [];
export let fees: Fee[] = [];
export let matches: ApiMatch[] = [];
export let events: ApiEvent[] = [];
export let announcements: Announcement[] = [];
export let me: Me | null = null;
export let currentSeason = "";
/** As épocas que a academia tem, da mais recente para trás. Ver `NewTeamDialog`. */
export let seasons: string[] = [];

/** Competências avaliadas — configuração da modalidade, não uma lista fixa no código. */
export let SKILLS: string[] = [];

function apply(next: State) {
  state = next;
  academy = next.academy;
  teams = next.teams;
  staff = next.staff;
  coaches = next.staff.filter((s) => s.teamIds.length > 0);
  athletes = next.athletes;
  guardians = next.guardians;
  sessions = next.sessions;
  fees = next.fees;
  matches = next.matches;
  events = next.events;
  announcements = next.announcements;
  me = next.me;
  currentSeason = next.season;
  seasons = next.seasons;
  SKILLS = next.academy.sports[0]?.skills ?? [];
  emit();
}

/** Hoje. Vive aqui porque metade da consola o importava de `demo.ts`. */
export const today = new Date();

export const currentPeriod = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;

/**
 * Sem endpoint ainda — e por isso vazios, não inventados.
 *
 * Um ecrã que diz "ainda não há avaliações" é honesto. Um que mostra avaliações a
 * fingir ensina quem o usa a não confiar em nenhum número do produto. (Comunicações
 * já saíram desta lista — vêm de `GET /api/announcements`, acima.)
 */
export const evaluations: Evaluation[] = [];
export const staffStints: { staffId: string; season: string; teamName: string; sportId: string; title: string }[] = [];
export type StaffStint = (typeof staffStints)[number];

import { useSyncExternalStore } from "react";
import { categoryColor, type CategoricalColor } from "@academia/ui/tokens";
import { useStore, type ApiEvent, type ApiMatch } from "@/lib/store";
import { listSessions, listTeams, sportById, teamById } from "@/lib/api";
import type { Session } from "@/lib/permissions";

/**
 * O calendário fala de **eventos**, não de treinos.
 *
 * Um treino é o caso mais frequente, mas a academia também tem jogos, torneios,
 * reuniões de pais e o encerramento da piscina em agosto. Unificar aqui evita que
 * a vista de mês tenha de saber de dois modelos diferentes — e evita a tentação de
 * criar um `TrainingSession` com `venue: "reunião"`.
 */

export type EventKind = "training" | "match" | "tournament" | "other";

export const KIND_LABEL: Record<EventKind, string> = {
  training: "Treino",
  match: "Jogo",
  tournament: "Torneio",
  other: "Evento",
};

/** Estado de um atleta na convocatória. */
export type CallUpStatus = "called" | "confirmed" | "declined";

export type CallUp = { athleteId: string; status: CallUpStatus };

export type Scorer = { athleteId: string; tally: number };

/**
 * Proveniência de um jogo importado de uma fonte externa (ver `lib/zerozero.ts`).
 * Presente só quando o jogo não nasceu de "Novo evento" — é o que distingue, na UI,
 * um jogo que o diretor criou de um que a app foi buscar sozinha.
 */
export type MatchSource = { provider: "zerozero"; url: string; importedAt: Date };

/**
 * O que só um jogo tem. Vive à parte do evento genérico porque um treino ou uma
 * reunião de pais nunca vão precisar disto — juntar tudo num único tipo obrigaria
 * `title` a decidir o que é opcional consoante o `kind`, e essa é a receita para um
 * formulário que aceita disparates.
 */
/**
 * A participação de um atleta num jogo.
 *
 * `rating` é a **nota do jogo**, e está deliberadamente por calcular: o fundador
 * ainda vai decidir os factores que a compõem. Guardamos o campo e mostramo-lo,
 * mas não há aqui nenhuma fórmula inventada — quando os factores existirem,
 * escreve-se a função e este valor passa a derivado em vez de armazenado.
 */
export type MatchAppearance = {
  athleteId: string;
  minutes: number;
  /** 0–10, uma casa decimal. Ausente enquanto ninguém a atribuir. */
  rating?: number;
};

export type MatchInfo = {
  opponent: string;
  home: boolean;
  callUps: CallUp[];
  /** Ausente até o resultado ser registado — é essa ausência que decide se o painel
   *  mostra a convocatória ou a estatística. */
  result?: {
    ourScore: number;
    theirScore: number;
    scorers: Scorer[];
    /** Quem jogou e quanto tempo. Alimenta a ficha do atleta. */
    appearances?: MatchAppearance[];
  };
  source?: MatchSource;
};

export type CalendarEvent = {
  id: string;
  kind: EventKind;
  /** Nulo em eventos de academia — uma reunião de pais não tem escalão. */
  teamId?: string;
  title: string;
  start: Date;
  end: Date;
  venue: string;
  /** Onde a equipa se equipa. Ausente quando não há nenhum atribuído. */
  dressingRoom?: string;
  coachId?: string;
  /** O nome de quem o dá, tal como veio do servidor. Ver `TrainingSession.coachName`. */
  coachName?: string;
  cancelled?: boolean;
  /**
   * Estado que exige atenção. Vive separado da categoria de propósito: a cor do
   * escalão é o preenchimento, isto é o contorno. Ver `packages/ui/src/tokens.ts`.
   */
  alert?: "unassigned";
  /** Só em `kind === "match"`. */
  match?: MatchInfo;
};

/** "golo" em futebol, "ponto" nos restantes — para a estatística falar a língua da modalidade. */
export function tallyNoun(teamId: string | undefined): string {
  const sport = teamId ? sportById(teamById(teamId)?.sportId ?? "") : undefined;
  return sport?.name === "Futebol" ? "golo" : "ponto";
}

export function resultOutcome(m: MatchInfo): "win" | "draw" | "loss" | undefined {
  if (!m.result) return undefined;
  if (m.result.ourScore > m.result.theirScore) return "win";
  if (m.result.ourScore < m.result.theirScore) return "loss";
  return "draw";
}

/* -------------------------------------------------------------------------- */
/* Cor por escalão                                                             */
/* -------------------------------------------------------------------------- */

/**
 * A cor de um escalão é a sua posição na lista de equipas da academia — estável
 * enquanto a equipa existir, independente do nome. Eventos sem equipa ficam
 * neutros; a ausência de cor é o que os marca como "da academia toda".
 */
export function useTeamColors(session: Session): Map<string, CategoricalColor> {
  const teams = listTeams(session);
  return new Map(teams.map((t, i) => [t.id, categoryColor(i)]));
}

/* -------------------------------------------------------------------------- */
/* Eventos criados na aplicação                                                */
/* -------------------------------------------------------------------------- */

/**
 * Repositório local dos jogos ricos — os que têm resultado por registar.
 *
 * Os eventos genéricos (treino avulso, torneio, reunião) deixaram de viver aqui:
 * "Novo evento" grava-os na base (`POST /api/events`) e o calendário lê-os do
 * store. O que sobra é o registo de resultado inline, ainda local, à espera de um
 * endpoint próprio (`Match` já guarda as convocatórias submetidas, pelo ecrã de
 * Convocatórias).
 *
 * ## Nasce vazio, e é isso que interessa
 *
 * **Não** uma semente de jogos de demonstração.
 *
 * Havia aqui um `seedMatches()` que inventava doze jogos por equipa — com
 * adversários, resultados, marcadores e notas — gerados no browser a partir de
 * um número pseudo-aleatório fixo. Serviu enquanto não havia `Match` na base;
 * passou a ser uma mentira assim que passou a haver.
 *
 * Um clube acabado de criar abria as Convocatórias e via jogos contra o "SC
 * Vilarinho" que nunca marcou, com resultados que nunca aconteceram. É o mesmo
 * erro que `data/demo.ts` já tinha custado: um ecrã que mostra dados a fingir
 * ensina quem o usa a não confiar em nenhum número do produto — e este mostrava
 * *golos marcados por atletas com nome*.
 *
 * Os jogos vêm da API (`fromApiMatch`, no `useEvents`). Sem jogos na base, o
 * calendário fica vazio, que é a verdade.
 */
let custom: CalendarEvent[] = [];
const listeners = new Set<() => void>();

function emit() {
  custom = [...custom];
  listeners.forEach((l) => l());
}

/**
 * Traduz um evento da API para o modelo do calendário.
 *
 * Um evento genérico não é um jogo rico: não traz `match` (convocatória e
 * resultado vivem em `Match`, no ecrã de Convocatórias). O `kind` chega em
 * maiúsculas do enum da base e desce aqui para as etiquetas da consola.
 */
export function fromApiEvent(e: ApiEvent): CalendarEvent {
  return {
    id: e.id,
    kind: e.kind.toLowerCase() as EventKind,
    teamId: e.teamId ?? undefined,
    title: e.title,
    start: new Date(e.startsAt),
    end: new Date(e.endsAt),
    venue: e.venue,
    dressingRoom: e.dressingRoom ?? undefined,
    coachId: e.coachId ?? undefined,
    coachName: e.coachName ?? undefined,
    cancelled: e.cancelled,
  };
}

/**
 * Traduz um **jogo** da API para o modelo do calendário.
 *
 * Um jogo vive em `Match` e não em `CalendarEvent` — é a tabela que guarda o
 * adversário, a convocatória e o resultado, e é dela que o ecrã de Convocatórias
 * lê. Sem esta tradução, um jogo marcado no calendário aparecia nas convocatórias
 * mas não no próprio calendário, que é meia correcção e portanto nenhuma.
 */
export function fromApiMatch(m: ApiMatch): CalendarEvent {
  const played = m.ourScore !== null && m.theirScore !== null;

  return {
    id: m.id,
    kind: "match",
    teamId: m.teamId,
    title: `${m.isHome ? "vs" : "@"} ${m.opponent}`,
    start: new Date(m.startsAt),
    end: new Date(m.endsAt),
    venue: m.venue,
    cancelled: m.status === "CANCELLED",
    match: {
      opponent: m.opponent,
      home: m.isHome,
      callUps: m.calledUp.map((c) => ({
        athleteId: c.athleteId,
        status: c.status.toLowerCase() as CallUpStatus,
      })),
      // O resultado só existe depois de registado — é a ausência dele que decide
      // se o painel mostra a convocatória ou a estatística.
      ...(played
        ? { result: { ourScore: m.ourScore as number, theirScore: m.theirScore as number, scorers: [] } }
        : {}),
    },
  };
}

export function removeEvent(id: string) {
  custom = custom.filter((e) => e.id !== id);
  emit();
}

export function toggleCancelled(id: string) {
  custom = custom.map((e) => (e.id === id ? { ...e, cancelled: !e.cancelled } : e));
  emit();
}

/** Único caminho para mudar convocatória ou resultado — mantém as duas peças no mesmo sítio. */
export function updateMatch(id: string, updater: (m: MatchInfo) => MatchInfo) {
  custom = custom.map((e) => (e.id === id && e.match ? { ...e, match: updater(e.match) } : e));
  emit();
}

export function getEvent(id: string): CalendarEvent | undefined {
  return custom.find((e) => e.id === id);
}

/**
 * Cria ou substitui um evento pelo `id`.
 *
 * É o que torna uma importação idempotente: reimportar não duplica jogos, porque
 * o importador gera o mesmo `id` para o mesmo jogo de cada vez. Ver `lib/zerozero.ts`.
 */
export function upsertEvent(event: CalendarEvent) {
  const exists = custom.some((e) => e.id === event.id);
  custom = exists ? custom.map((e) => (e.id === event.id ? event : e)) : [...custom, event];
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const getSnapshot = () => custom;

/**
 * Os eventos pontuais — jogos, torneios, reuniões — sem os treinos derivados dos
 * horários das equipas.
 *
 * Existe para quem precisa de jogos fora do calendário: a ficha de staff conta o
 * balanço de um treinador a partir daqui. Devolve tudo e sem âmbito de propósito —
 * quem chama é que sabe por que equipas filtrar, e aplicar âmbito aqui esconderia
 * jogos de quem tem todo o direito de os ver.
 */
export function customEvents(): CalendarEvent[] {
  return custom;
}

/** O mesmo, a redesenhar quando um resultado for registado. */
export function useCustomEvents(): CalendarEvent[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/* -------------------------------------------------------------------------- */
/* Consulta                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Todos os eventos de um intervalo: os treinos gerados a partir dos horários das
 * equipas mais os que foram criados à mão, já ordenados.
 */
export function useEvents(session: Session, from: Date, to: Date): CalendarEvent[] {
  // `useStore` subscreve o estado: quando "Novo evento" grava e a academia é
  // recarregada, o calendário redesenha. `custom` continua a servir os jogos ricos
  // (convocatória e resultado), que não passaram para a API nesta camada.
  const store = useStore();
  const seededMatches = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const trainings: CalendarEvent[] = listSessions(session, from, to).map((s) => ({
    id: s.id,
    kind: "training",
    teamId: s.teamId,
    title: teamById(s.teamId)?.name ?? "Treino",
    start: new Date(s.start),
    end: new Date(s.end),
    venue: s.venue,
    dressingRoom: s.dressingRoom,
    coachId: s.coachId,
    coachName: s.coachName,
    cancelled: s.status === "cancelled",
    // Um treino agendado sem treinador é a única coisa no calendário que precisa
    // de saltar à vista por cima da cor do escalão.
    alert: s.status === "scheduled" && !s.coachId ? "unassigned" : undefined,
  }));

  // Eventos genéricos, agora vindos da base (`GET /api/events`). O servidor já
  // aplicou o âmbito; o filtro de âmbito abaixo é a segunda camada, como no resto.
  const apiEvents: CalendarEvent[] = store.events.map(fromApiEvent);

  // Jogos a sério, de `Match` (`GET /api/matches`) — os mesmos que o ecrã de
  // Convocatórias lê. É isto que faz um jogo marcado no calendário aparecer nos
  // dois sítios, em vez de só num.
  const apiMatches: CalendarEvent[] = store.matches.map(fromApiMatch);

  const scoped = new Set(listTeams(session).map((t) => t.id));
  const inScopeAndRange = (e: CalendarEvent) => {
    if (e.teamId && !scoped.has(e.teamId)) return false;
    return e.start >= from && e.start <= to;
  };
  const pontuais = [...apiEvents, ...apiMatches, ...seededMatches].filter(inScopeAndRange);

  return [...trainings, ...pontuais].sort((a, b) => a.start.getTime() - b.start.getTime());
}

/* -------------------------------------------------------------------------- */
/* Datas                                                                       */
/* -------------------------------------------------------------------------- */

export const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * A grelha de um mês, de segunda a domingo, incluindo os dias de encosto dos meses
 * vizinhos. Sempre 6 linhas: uma grelha que muda de altura conforme o mês faz o
 * conteúdo abaixo saltar de sítio a cada clique na seta.
 */
export function monthGrid(anchor: Date): Date[] {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const shift = (first.getDay() + 6) % 7; // segunda = 0
  const start = new Date(first.getFullYear(), first.getMonth(), 1 - shift);
  return Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
}

export function groupByDay(events: CalendarEvent[]): Map<string, CalendarEvent[]> {
  const map = new Map<string, CalendarEvent[]>();
  for (const e of events) {
    const key = dayKey(e.start);
    map.set(key, [...(map.get(key) ?? []), e]);
  }
  return map;
}

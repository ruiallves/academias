import { useSyncExternalStore } from "react";
import { categoryColor, type CategoricalColor } from "@academia/ui/tokens";
import { teams } from "@/data/demo";
import { listSessions, listTeams, sportById, teamById, today } from "@/lib/api";
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
  coachId?: string;
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
 * Repositório dos eventos que não são gerados a partir do horário semanal das
 * equipas — jogos, torneios, reuniões. Ao contrário dos treinos (recorrentes,
 * derivados de `Team.schedule`), um jogo é sempre pontual, e por isso vive aqui
 * desde que nasce, criado à mão ou já semeado como demonstração.
 *
 * Existe para que "Novo evento", a convocatória e o registo de resultado
 * funcionem a sério enquanto a API não está ligada. É a única peça de estado
 * mutável do frontend — quando o `POST /calendar/events` existir, este ficheiro
 * passa a um `useQuery` e o resto do calendário não muda.
 */
// Declarado antes de `seedMatches()` correr, e não junto dela lá em baixo: a
// semente executa-se na inicialização do módulo, e um `const` mais abaixo estaria
// na temporal dead zone. O TypeScript não apanha — só rebenta em execução.
const OPPONENTS = [
  "SC Vilarinho", "CD Fão", "GD Ronfe", "SC Bairro", "AD Oliveirense",
  "Vitória de Prado", "SC São Pedro", "CD Ferreiros", "GC Vermoim",
  "Basket Clube Amares", "AD Merelim", "SC Cerveira",
];

let custom: CalendarEvent[] = seedMatches();
const listeners = new Set<() => void>();

function emit() {
  custom = [...custom];
  listeners.forEach((l) => l());
}

export function addEvent(event: Omit<CalendarEvent, "id">) {
  custom.push({ ...event, id: `ev_${Date.now().toString(36)}` });
  emit();
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

/* -------------------------------------------------------------------------- */
/* Consulta                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Todos os eventos de um intervalo: os treinos gerados a partir dos horários das
 * equipas mais os que foram criados à mão, já ordenados.
 */
export function useEvents(session: Session, from: Date, to: Date): CalendarEvent[] {
  const created = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const trainings: CalendarEvent[] = listSessions(session, from, to).map((s) => ({
    id: s.id,
    kind: "training",
    teamId: s.teamId,
    title: teamById(s.teamId)?.name ?? "Treino",
    start: new Date(s.start),
    end: new Date(s.end),
    venue: s.venue,
    coachId: s.coachId,
    cancelled: s.status === "cancelled",
    // Um treino agendado sem treinador é a única coisa no calendário que precisa
    // de saltar à vista por cima da cor do escalão.
    alert: s.status === "scheduled" && !s.coachId ? "unassigned" : undefined,
  }));

  const scoped = new Set(listTeams(session).map((t) => t.id));
  const mine = created.filter((e) => {
    if (e.teamId && !scoped.has(e.teamId)) return false;
    return e.start >= from && e.start <= to;
  });

  return [...trainings, ...mine].sort((a, b) => a.start.getTime() - b.start.getTime());
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

/* -------------------------------------------------------------------------- */
/* Semente de demonstração                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Uma época de jogos, para as equipas cujo desporto os tem.
 *
 * A natação fica de fora de propósito: não tem plantel a jogar contra um
 * adversário, e a ficha de um nadador mostra correctamente "sem jogos" em vez de
 * dados inventados. É a mesma adaptação por ausência que já se vê nas posições.
 *
 * Cada jogo passado traz resultado, marcadores e **participações** (minutos e
 * nota) — é isso que dá conteúdo ao registo de jogos na ficha do atleta. Um jogo
 * futuro traz só convocatória, para se poder ver o fluxo de confirmação.
 */
function seedMatches(): CalendarEvent[] {
  const out: CalendarEvent[] = [];
  const rand = mulberry32(778899);

  for (const team of teams) {
    const sport = sportById(team.sportId);
    // Sem posições = desporto individual, sem jogos por equipa.
    if (!sport || sport.positions.length === 0) continue;

    const fullTime = sport.matchMinutes ?? 60;
    const squadSize = Math.min(team.athleteIds.length, sport.name === "Futebol" ? 16 : 10);

    // Sábados quinzenais: dez para trás, dois para a frente.
    for (let i = -10; i <= 2; i++) {
      if (i === 0) continue;
      const { start, end } = saturdayAt(i * 7, 10 + Math.floor(rand() * 4), fullTime + 30);
      const past = start < today;
      const opponent = OPPONENTS[Math.floor(rand() * OPPONENTS.length)];
      const home = rand() > 0.5;
      const squad = team.athleteIds.slice(0, squadSize);

      const match: MatchInfo = {
        opponent,
        home,
        callUps: squad.map((athleteId) => ({
          athleteId,
          status: past ? ("confirmed" as const) : rand() > 0.35 ? ("confirmed" as const) : ("called" as const),
        })),
      };

      if (past) {
        const ourScore = Math.floor(rand() * 5);
        const theirScore = Math.floor(rand() * 4);

        // Nem todos os convocados jogam, e nem todos jogam o tempo inteiro.
        const appearances: MatchAppearance[] = squad
          .filter(() => rand() > 0.2)
          .map((athleteId) => {
            const full = rand() > 0.45;
            return {
              athleteId,
              minutes: full ? fullTime : Math.max(5, Math.round((fullTime * (0.2 + rand() * 0.6)) / 5) * 5),
              // Nota provisória — a fórmula real está por decidir (ver MatchAppearance).
              rating: Math.round((4.5 + rand() * 4) * 10) / 10,
            };
          });

        const scorerPool = appearances.filter((a) => a.minutes > fullTime * 0.3);
        const scorers: Scorer[] = [];
        let remaining = ourScore;
        while (remaining > 0 && scorerPool.length > 0) {
          const who = scorerPool[Math.floor(rand() * scorerPool.length)];
          const existing = scorers.find((s) => s.athleteId === who.athleteId);
          if (existing) existing.tally++;
          else scorers.push({ athleteId: who.athleteId, tally: 1 });
          remaining--;
        }

        match.result = { ourScore, theirScore, scorers, appearances };
      }

      out.push({
        id: `ev_seed_${team.id}_${i}`,
        kind: "match",
        teamId: team.id,
        title: `Jogo · ${team.name}`,
        start,
        end,
        venue: home ? (sport.name === "Futebol" ? "Campo 1" : "Pavilhão") : `Campo do ${opponent}`,
        coachId: team.coachIds[0],
        match,
      });
    }
  }

  return out;
}

/** O sábado a `dayOffset` dias de hoje, à hora dada. */
function saturdayAt(dayOffset: number, hour: number, durationMin: number) {
  const base = new Date(today.getFullYear(), today.getMonth(), today.getDate() + dayOffset);
  base.setDate(base.getDate() + ((6 - base.getDay() + 7) % 7));
  base.setHours(hour, 0, 0, 0);
  return { start: base, end: new Date(base.getTime() + durationMin * 60_000) };
}

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

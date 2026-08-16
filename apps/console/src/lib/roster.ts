import { useSyncExternalStore } from "react";
import { today } from "@/data/demo";
import type { Athlete, Guardian, Team } from "@/data/types";

/**
 * Atletas, encarregados e equipas criados a partir da consola.
 *
 * `data/demo.ts` é estático — gera sempre a mesma academia, de propósito, para as
 * capturas de ecrã serem estáveis. "Novo atleta" e "Nova equipa" não podem escrever
 * ali. Este ficheiro guarda o que se cria a partir da UI, à parte, e `lib/api.ts`
 * funde as duas fontes em cada leitura — é o mesmo padrão de `lib/calendar.ts` e
 * `lib/catalogs.ts`, aqui aplicado a pessoas e equipas em vez de eventos.
 *
 * Quando a API estiver ligada, este ficheiro desaparece; os componentes continuam
 * a falar só com `lib/api.ts`.
 */

type State = { athletes: Athlete[]; guardians: Guardian[]; teams: Team[] };

let state: State = { athletes: [], guardians: [], teams: [] };
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const snapshot = () => state;

/** Para componentes que precisem de voltar a renderizar quando algo for criado. */
export function useRosterAdditions(): State {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** Leitura simples, sem subscrição — é o que `lib/api.ts` usa para fundir com os dados de demonstração. */
export function getRosterAdditions(): State {
  return state;
}

let seq = 1000;
const nextId = (prefix: string) => `${prefix}${seq++}`;

export function createTeam(input: {
  name: string;
  sportId: string;
  ageGroup: string;
  season: string;
  coachId?: string;
  schedule: Team["schedule"];
}): Team {
  const team: Team = {
    id: nextId("t"),
    name: input.name,
    sportId: input.sportId,
    ageGroup: input.ageGroup,
    season: input.season,
    coachIds: input.coachId ? [input.coachId] : [],
    athleteIds: [],
    schedule: input.schedule,
  };

  state = { ...state, teams: [...state.teams, team] };
  emit();
  return team;
}

export function createAthlete(input: {
  name: string;
  birthdate: string;
  teamId: string;
  position?: string;
  medicalValidUntil?: string;
  guardian: { name: string; relation: Guardian["relation"]; email: string; phone: string };
}): Athlete {
  const guardianId = nextId("g");
  const athleteId = nextId("a");

  const guardian: Guardian = {
    id: guardianId,
    name: input.guardian.name,
    email: input.guardian.email,
    phone: input.guardian.phone,
    relation: input.guardian.relation,
    athleteIds: [athleteId],
    // A ficha nasce sem a app instalada — é exactamente o convite que "Famílias"
    // existe para lembrar alguém de enviar.
    appInstalled: false,
  };

  const athlete: Athlete = {
    id: athleteId,
    name: input.name,
    birthdate: input.birthdate,
    teamId: input.teamId,
    position: input.position,
    guardianIds: [guardianId],
    joinedAt: isoToday(),
    status: "active",
    medicalValidUntil: input.medicalValidUntil ?? "",
  };

  state = { ...state, athletes: [...state.athletes, athlete], guardians: [...state.guardians, guardian] };
  emit();
  return athlete;
}

/**
 * Usa o "hoje" congelado da demonstração (`data/demo.ts`), não o relógio real —
 * senão um atleta criado agora ficava com `joinedAt` fora da linha do tempo em
 * que todos os outros dados vivem, e "entrou este mês" no resumo do diretor
 * deixava de contar quem acabou de ser inscrito.
 */
function isoToday(): string {
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
}

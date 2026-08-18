import { useSyncExternalStore } from "react";
import { athleteById, today } from "@/lib/api";
import type { ClinicalEntry, ClinicalImpact, ClinicalKind } from "@/data/types";

/**
 * Estado clínico de um atleta.
 *
 * A disponibilidade **não é um campo** que alguém tem de se lembrar de mudar — é
 * derivada do boletim. Enquanto existir uma entrada de baixa sem alta clínica, o
 * atleta está indisponível, e todo o produto lê isso do mesmo sítio: a ficha, a
 * lista de atletas, a convocatória, o registo de presenças.
 *
 * A alternativa — um `status: "injured"` guardado à parte — dessincroniza-se na
 * primeira vez que alguém der alta e se esquecer de o mudar, e a partir daí o
 * treinador convoca um lesionado.
 */

export type Availability = "available" | "limited" | "out";

export const AVAILABILITY_LABEL: Record<Availability, string> = {
  available: "Apto",
  limited: "Condicionado",
  out: "De baixa",
};

export const KIND_LABEL: Record<ClinicalKind, string> = {
  injury: "Lesão",
  exam: "Exame",
  physio: "Fisioterapia",
  nutrition: "Nutrição",
  psychology: "Psicologia",
  note: "Nota",
};

export const IMPACT_LABEL: Record<ClinicalImpact, string> = {
  none: "Sem impacto",
  limited: "Trabalho condicionado",
  out: "Baixa — não treina nem joga",
};

/* -------------------------------------------------------------------------- */
/* Registos criados na consola                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Mesmo padrão de `lib/roster.ts` e `lib/attendance.ts`: o que vem da base de dados é
 * estático, por isso o que o departamento clínico regista vive aqui e é fundido
 * na leitura. Quando a API existir, isto passa a `POST /athletes/:id/clinical`.
 */
let added: Record<string, ClinicalEntry[]> = {};
const listeners = new Set<() => void>();

function emit() {
  added = { ...added };
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const snapshot = () => added;

/** Subscrever faz o ecrã redesenhar-se quando o médico dá baixa ou alta. */
export function useClinicalRecords(): Record<string, ClinicalEntry[]> {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

let seq = 0;

export function addClinicalEntry(athleteId: string, entry: Omit<ClinicalEntry, "id">) {
  const withId: ClinicalEntry = { ...entry, id: `cl_${Date.now().toString(36)}_${seq++}` };
  added = { ...added, [athleteId]: [...(added[athleteId] ?? []), withId] };
  emit();
}

/**
 * Dar alta. Fecha a entrada em vez de criar outra — a alta é o fim daquela
 * ocorrência, não um acontecimento separado no historial.
 */
export function clearClinicalEntry(athleteId: string, entryId: string, on = isoToday()) {
  const athlete = athleteById(athleteId);
  const fromDemo = athlete?.clinical ?? [];
  const existing = added[athleteId] ?? [];

  // Se a entrada vem dos dados estáticos, guarda-se aqui uma cópia fechada; a
  // fusão em `clinicalOf` dá prioridade a esta.
  const inAdded = existing.find((e) => e.id === entryId);
  if (inAdded) {
    added = {
      ...added,
      [athleteId]: existing.map((e) => (e.id === entryId ? { ...e, clearedOn: on } : e)),
    };
  } else {
    const original = fromDemo.find((e) => e.id === entryId);
    if (!original) return;
    added = { ...added, [athleteId]: [...existing, { ...original, clearedOn: on }] };
  }
  emit();
}

/* -------------------------------------------------------------------------- */
/* Leitura                                                                     */
/* -------------------------------------------------------------------------- */

/** O boletim completo, com os registos da consola a sobreporem-se aos estáticos. */
export function clinicalOf(athleteId: string): ClinicalEntry[] {
  const base = athleteById(athleteId)?.clinical ?? [];
  const overrides = added[athleteId] ?? [];
  const byId = new Map(base.map((e) => [e.id, e]));
  for (const e of overrides) byId.set(e.id, e);
  return [...byId.values()].sort((a, b) => b.date.localeCompare(a.date));
}

/** Agendamentos futuros — o que o pai vê na app e o que enche a agenda clínica. */
export function upcomingAppointments(athleteId: string): ClinicalEntry[] {
  const iso = isoToday();
  return clinicalOf(athleteId)
    .filter((e) => e.status === "scheduled" && e.date >= iso)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** A entrada que está a afectar o atleta agora, se houver. */
export function activeRestriction(athleteId: string): ClinicalEntry | undefined {
  return clinicalOf(athleteId)
    // Um agendamento futuro não afecta a disponibilidade de hoje.
    .filter((e) => e.status !== "scheduled" && e.status !== "cancelled")
    .filter((e) => e.impact !== "none" && !e.clearedOn)
    // Se houver mais que uma, manda a mais grave.
    .sort((a, b) => (a.impact === "out" ? -1 : b.impact === "out" ? 1 : 0))[0];
}

export function availabilityOf(athleteId: string): Availability {
  const active = activeRestriction(athleteId);
  if (!active) return "available";
  return active.impact === "out" ? "out" : "limited";
}

/** Verdadeiro quando o atleta não pode ser convocado nem contar como falta. */
export function isUnavailable(athleteId: string): boolean {
  return availabilityOf(athleteId) === "out";
}

export function isoToday(): string {
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
}

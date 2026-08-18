import { useSyncExternalStore } from "react";
import type { AbsenceKind, SessionAttendance } from "@/data/types";

/**
 * Presenças registadas a partir da consola.
 *
 * Mesmo padrão de `lib/roster.ts` e `lib/calendar.ts`: o que vem da base de dados é
 * de leitura
 * e não pode ser escrito, por isso o que se regista na UI vive aqui e `lib/api.ts`
 * funde as duas fontes ao ler. Quando a API existir, isto passa a um `POST
 * /sessions/:id/attendance` e nada mais no produto muda.
 *
 * Guarda-se a **lista de faltas**, nunca a de presentes — ver `SessionAttendance`.
 */

let recorded: Record<string, SessionAttendance> = {};
const listeners = new Set<() => void>();

function emit() {
  recorded = { ...recorded };
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const snapshot = () => recorded;

export function useAttendanceRecords(): Record<string, SessionAttendance> {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

export function getAttendanceRecords(): Record<string, SessionAttendance> {
  return recorded;
}

export function recordAttendance(sessionId: string, absences: { athleteId: string; kind: AbsenceKind; note?: string }[]) {
  recorded = {
    ...recorded,
    [sessionId]: { absences, recordedAt: new Date().toISOString() },
  };
  emit();
}

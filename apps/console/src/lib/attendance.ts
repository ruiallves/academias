import { useSyncExternalStore } from "react";
import { apiPut } from "@/lib/http";
import { reloadAcademy } from "@/lib/store";
import type { AbsenceKind, SessionAttendance } from "@/data/types";

/**
 * Presenças registadas a partir da consola.
 *
 * ## O que estava avariado, e vale a pena não repetir
 *
 * Isto era um `Record` em memória e mais nada. O treinador registava as faltas,
 * carregava em Guardar, via a folha fechada — e ao recarregar a página estava
 * tudo outra vez por registar. Sem erro nenhum: **a escrita nunca saía do
 * browser**. O `GET /api/sessions` já devolvia as presenças da base desde
 * sempre; o que faltava era alguém lá pôr alguma coisa.
 *
 * Agora `recordAttendance` escreve mesmo (`PUT /api/sessions/:id/attendance`) e
 * o store recarrega — a verdade passa a ser a do servidor, como no resto do
 * produto.
 *
 * ## O que este ficheiro ainda faz
 *
 * Uma escrita **pendente**, para a interface reagir no instante do clique em vez
 * de esperar pela ida ao servidor e pelo recarregamento. É uma sobreposição
 * temporária: quando o store voltar com os dados da base, ela desaparece — e se
 * a gravação falhar, desaparece também, para nada ficar a fingir que foi
 * guardado.
 *
 * Guarda-se a **lista de faltas**, nunca a de presentes — ver `SessionAttendance`.
 */

let pending: Record<string, SessionAttendance> = {};
const listeners = new Set<() => void>();

function emit() {
  pending = { ...pending };
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const snapshot = () => pending;

export function useAttendanceRecords(): Record<string, SessionAttendance> {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

export function getAttendanceRecords(): Record<string, SessionAttendance> {
  return pending;
}

/**
 * Fecha a folha de um treino.
 *
 * A lista traz **só quem faltou**; uma lista vazia é a afirmação "estiveram
 * todos", que é diferente de ninguém ter verificado.
 *
 * Devolve uma promessa e **deixa o erro subir**: quem chama tem de o mostrar, em
 * vez de fechar o diálogo como se tivesse corrido bem. Foi precisamente uma
 * gravação silenciosa que criou o bug que isto veio resolver.
 */
export async function recordAttendance(
  sessionId: string,
  absences: { athleteId: string; kind: AbsenceKind; note?: string }[],
): Promise<void> {
  // A interface reage já — a ida ao servidor e o recarregamento vêm a seguir.
  pending = { ...pending, [sessionId]: { absences, recordedAt: new Date().toISOString() } };
  emit();

  try {
    await apiPut(`/api/sessions/${sessionId}/attendance`, { absences });
    await reloadAcademy();
  } catch (error) {
    // Nada de sobreposição a mentir por cima de uma gravação que não aconteceu.
    clearPending(sessionId);
    throw error;
  }

  /*
   * A sobreposição sai **depois** do recarregamento, nunca antes.
   *
   * Limpá-la primeiro deixava um piscar em que a folha aparecia por registar —
   * o store novo ainda não chegou, o local já não existe. Nesta ordem, a
   * substituição é invisível.
   */
  clearPending(sessionId);
}

function clearPending(sessionId: string) {
  const { [sessionId]: _, ...rest } = pending;
  pending = rest;
  emit();
}

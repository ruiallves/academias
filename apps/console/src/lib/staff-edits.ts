import { useSyncExternalStore } from "react";
import type { StaffMember } from "@/data/types";

/**
 * Edições às fichas de staff.
 *
 * Vive à parte de `lib/staff.ts` por uma razão de estrutura e não de gosto:
 * `lib/api.ts` precisa destas edições para a lista de staff as mostrar, e
 * `lib/staff.ts` importa o calendário, que por sua vez importa `lib/api.ts`. Pôr o
 * armazém no meio desse triângulo criava um ciclo de importações — daqueles que o
 * TypeScript aceita e que rebentam em execução, com um `undefined` inexplicável na
 * inicialização do módulo.
 *
 * Sem dependências nenhumas, este ficheiro pode ser importado por ambos. Mesmo
 * papel de `lib/roster.ts` para atletas e equipas, e desaparece com ele quando a
 * API entrar.
 */

export type StaffEdit = Partial<
  Pick<StaffMember, "name" | "email" | "phone" | "title" | "department" | "role" | "teamIds" | "isActive">
>;

let edits: Record<string, StaffEdit> = {};
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const snapshot = () => edits;

/** Para componentes que precisem de voltar a renderizar quando uma ficha mudar. */
export function useStaffEdits(): Record<string, StaffEdit> {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** Leitura simples, sem subscrição — é o que `lib/api.ts` usa para fundir. */
export function getStaffEdits(): Record<string, StaffEdit> {
  return edits;
}

export function updateStaff(id: string, patch: StaffEdit): void {
  edits = { ...edits, [id]: { ...edits[id], ...patch } };
  emit();
}

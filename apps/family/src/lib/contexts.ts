import { useSyncExternalStore } from "react";
import { apiGet } from "@/lib/http";
import { academySlug } from "@/lib/invite";

/**
 * Os contextos desta conta neste clube — e qual está vestido.
 *
 * ## "Contexto", e não "role"
 *
 * A mesma conta pode ser Família e Sócio no mesmo clube — e um dia Atleta ou
 * Staff. Um "role" global no utilizador não tem onde pôr isso; um contexto é
 * `(conta, clube, relação)` e cresce sem partir nada: acrescentar "ATHLETE" a
 * este union e a vista correspondente no `App.tsx` é a migração inteira.
 *
 * ## A escolha fica guardada por clube
 *
 * Quem entrou como Sócio ontem abre como Sócio hoje — a app não repete a
 * pergunta a cada arranque. A chave leva o slug porque a mesma instalação pode
 * um dia servir mais do que um clube, e a escolha de um não é a escolha do outro.
 */

export type ContextType = "FAMILY" | "MEMBER";

export type AppContext =
  | { type: "FAMILY" }
  | { type: "MEMBER"; memberId: string; number: number | null; status: string };

type State = {
  /** `null` = ainda não se perguntou ao servidor. */
  contexts: AppContext[] | null;
  /** O contexto vestido. `null` = por escolher (ou só há um, e resolve-se sozinho). */
  active: ContextType | null;
  error: string | null;
};

const escolhaKey = () => `academia.app.contexto:${academySlug()}`;

function lerEscolha(): ContextType | null {
  try {
    const v = localStorage.getItem(escolhaKey());
    return v === "FAMILY" || v === "MEMBER" ? v : null;
  } catch {
    return null;
  }
}

let state: State = { contexts: null, active: lerEscolha(), error: null };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const snapshot = () => state;

export function useContexts(): State {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/**
 * Pergunta ao servidor e resolve o que se resolve sozinho.
 *
 * Um contexto só → é esse, sem perguntar nada a ninguém. Dois → vale a escolha
 * guardada se ainda existir; senão fica por escolher e o `App` mostra o ecrã
 * "como queres continuar?".
 */
export async function loadContexts(): Promise<void> {
  try {
    const r = await apiGet<{ contexts: AppContext[] }>("/api/app/contexts");
    const tipos = r.contexts.map((c) => c.type);

    let active = state.active ?? lerEscolha();
    if (active && !tipos.includes(active)) active = null;
    if (!active && tipos.length === 1) active = tipos[0];

    state = { contexts: r.contexts, active, error: null };
  } catch (e) {
    state = { ...state, error: e instanceof Error ? e.message : "Não foi possível carregar." };
  }
  emit();
}

/** Vestir um contexto — do seletor pós-login ou do switcher. Sem logout, sem recarregar. */
export function chooseContext(type: ContextType): void {
  try {
    localStorage.setItem(escolhaKey(), type);
  } catch {
    /* sem armazenamento: a escolha vale esta sessão */
  }
  state = { ...state, active: type };
  emit();
}

/** No fim da sessão — a conta seguinte não herda a escolha desta. */
export function clearContextChoice(): void {
  try {
    localStorage.removeItem(escolhaKey());
  } catch {
    /* idem */
  }
  state = { contexts: null, active: null, error: null };
  emit();
}

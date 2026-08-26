import { useSyncExternalStore } from "react";
import { apiGet, apiPatch } from "@/lib/http";

/**
 * As notificações de quem está na consola.
 *
 * ## O botão não fazia nada
 *
 * O sino estava na barra lateral com um ponto vermelho permanente, e não tinha
 * `onClick` nenhum. O ponto vermelho era decoração — não vinha de haver mesmo
 * alguma coisa por ler. Um aviso que está sempre aceso deixa de ser um aviso.
 *
 * A API já existia (`GET /api/notifications`, `PATCH /api/notifications/read`);
 * só faltava a consola falar com ela. É a mesma lista que a app das famílias
 * mostra — uma notificação **é** de uma pessoa, e o `userId` vem do token.
 */

export type Notification = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  /** Para onde levar quem carrega. Nulo quando não há destino óbvio. */
  link: string | null;
  readAt: string | null;
  createdAt: string;
};

type State = { items: Notification[]; loaded: boolean };

let state: State = { items: [], loaded: false };
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const snapshot = () => state;

export function useNotifications(): State {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** Quantas estão por ler. É isto que acende o ponto no sino — e só isto. */
export function useUnreadCount(): number {
  return useNotifications().items.filter((n) => !n.readAt).length;
}

export async function loadNotifications(): Promise<void> {
  try {
    const items = await apiGet<Notification[]>("/api/notifications");
    state = { items, loaded: true };
  } catch {
    // Silencioso: uma lista de notificações que falha não pode partir a consola.
    state = { items: [], loaded: true };
  }
  emit();
}

/**
 * Marcar como lidas.
 *
 * Optimista, ao contrário dos papéis: marcar uma notificação não muda o que
 * ninguém pode fazer, e ver o ponto apagar-se no instante em que se abre o painel
 * é o que faz a coisa parecer viva. Se o servidor recusar, a leitura seguinte
 * repõe a verdade.
 */
export async function markRead(ids: string[]): Promise<void> {
  if (ids.length === 0) return;

  const agora = new Date().toISOString();
  state = {
    ...state,
    items: state.items.map((n) => (ids.includes(n.id) ? { ...n, readAt: n.readAt ?? agora } : n)),
  };
  emit();

  try {
    await apiPatch("/api/notifications/read", { ids });
  } catch {
    await loadNotifications();
  }
}

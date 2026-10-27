import { useEffect, useSyncExternalStore } from "react";
import { apiGetSilencioso, apiPatch } from "@/lib/http";
import { refrescarProximos } from "@/lib/store";

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

/** Os avisos das famílias que mudam um treino ou um jogo que já está no ecrã. */
const MUDAM_O_CALENDARIO = new Set(["ABSENCE_NOTICED", "CALLUP_DECLINED"]);

export async function loadNotifications(): Promise<void> {
  const conhecidas = new Set(state.items.map((n) => n.id));
  const primeira = !state.loaded;
  try {
    // Silencioso: o sino carrega-se sozinho à entrada, e uma lista de
    // notificações que falha não pode partir a consola nem gritar por isso.
    const items = await apiGetSilencioso<Notification[]>("/api/notifications");
    state = { items, loaded: true };
    /*
     * Chegou um aviso de falta desde a última leitura: os treinos em memória
     * estão desactualizados. Na primeira leitura não, que o arranque acabou de
     * os trazer.
     */
    if (!primeira && items.some((n) => !conhecidas.has(n.id) && MUDAM_O_CALENDARIO.has(n.kind))) {
      void refrescarProximos().catch(() => undefined);
    }
  } catch {
    // Silencioso: uma lista de notificações que falha não pode partir a consola.
    // Fica o que já havia: uma rede que falha a meio não apaga o sino.
    state = { items: state.items, loaded: true };
  }
  emit();
}

/** De quanto em quanto tempo se volta a perguntar, com o separador à vista. */
const INTERVALO = 120_000;

/**
 * O sino relê-se sozinho.
 *
 * Carregava uma vez, no arranque. Um treinador com a consola aberta desde a
 * manhã não via o aviso de falta que uma mãe deu à tarde, e é para ele que o
 * aviso existe. Dois minutos chegam: a notificação também vai por push a quem
 * o ligou, e isto é para quem está ao computador.
 *
 * Só com o separador à vista, como a presença (`lib/presence.ts`): uma consola
 * esquecida numa secretaria não tem de falar com o servidor. Ao voltar a ficar
 * visível relê logo.
 */
export function useVigiarNotificacoes(activo: boolean): void {
  useEffect(() => {
    if (!activo) return;
    const ler = () => {
      if (document.visibilityState === "visible") void loadNotifications();
    };
    const relogio = setInterval(ler, INTERVALO);
    document.addEventListener("visibilitychange", ler);
    return () => {
      clearInterval(relogio);
      document.removeEventListener("visibilitychange", ler);
    };
  }, [activo]);
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

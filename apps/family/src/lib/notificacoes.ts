import { useSyncExternalStore } from "react";
import { apiGet, apiPatch } from "@/lib/http";
import { contextosActuais } from "@/lib/contexts";
import type { ApiNotification } from "@/lib/store";

/**
 * As notificações — uma só verdade para todas as áreas.
 *
 * ## O que isto corrige
 *
 * O sino vivia na store da família: contava `store.notifications`, que só se
 * carregava nas áreas de família e de atleta. A área de sócio não tinha sino
 * nenhum, e um sócio sem vínculo de família nem sequer conseguia pedir as suas
 * notificações — o `/api/notifications` passa pelo guard, que exige uma
 * `Membership`, e ele não tem. Três áreas, três contagens diferentes (ou
 * nenhuma), para a mesma pessoa.
 *
 * Uma notificação é da **pessoa**, não da área: a quota paga, a convocatória do
 * filho e o aviso do clube são da mesma conta, e o ponto vermelho tem de ser o
 * mesmo em todas as vistas. Por isso vivem aqui, fora das stores de cada área,
 * e os dois headers e o ecrã lêem daqui.
 *
 * ## Por onde se pedem
 *
 * O servidor devolve-as por qualquer vínculo que a pessoa tenha — a lista é por
 * `userId`, não por papel — mas tem de ser um vínculo que ela **tenha**, e não
 * o da área vestida: na área de sócio o chapéu activo é "family", e um
 * atleta-e-sócio não tem esse. Escolhe-se então pelos contextos da conta:
 * família (aprovada) → `x-app: family`; senão atleta → `x-app: athlete`; senão
 * sócio-só → os endpoints de sócio, que autenticam pelo JWT sem exigir
 * membership (ver `ClubAppController`). Ver `RequestOpts` em `lib/http.ts`.
 *
 * Marcar como lida é optimista: o sino apaga-se já, em todas as áreas ao mesmo
 * tempo, e o servidor confirma a seguir — quem leu no telemóvel não volta a ver
 * o ponto no tablet.
 */

type Estado = {
  items: ApiNotification[];
  /** Por ler — é isto que o sino mostra. */
  unread: number;
  /** Já se perguntou ao servidor pelo menos uma vez. */
  ready: boolean;
};

let estado: Estado = { items: [], unread: 0, ready: false };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const snapshot = () => estado;

export function useNotificacoes(): Estado {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

function aplicar(items: ApiNotification[]): void {
  estado = { items, unread: items.filter((n) => !n.readAt).length, ready: true };
  emit();
}

/** Por onde pedir. `undefined` = ainda não se sabem os contextos; `null` = sem conta nesta app. */
type Via = { kind: "app"; app: "family" | "athlete" } | { kind: "socio" };

function via(): Via | null | undefined {
  const cs = contextosActuais();
  if (cs === null) return undefined;
  if (cs.some((c) => c.type === "FAMILY" && !c.pending)) return { kind: "app", app: "family" };
  if (cs.some((c) => c.type === "ATHLETE")) return { kind: "app", app: "athlete" };
  if (cs.some((c) => c.type === "MEMBER")) return { kind: "socio" };
  return null;
}

let emCurso: Promise<void> | null = null;

/**
 * Relê do servidor. Uma de cada vez; uma que falhe deixa o que está — a
 * próxima volta (ao voltar ao ecrã, ao chegar um push, de dez em dez minutos,
 * ver `lib/fresco`) corrige.
 */
export function carregarNotificacoes(): Promise<void> {
  if (emCurso) return emCurso;
  emCurso = (async () => {
    try {
      const v = via();
      if (v === undefined) return;
      if (v === null) {
        aplicar([]);
        return;
      }
      const rows =
        v.kind === "app"
          ? await apiGet<ApiNotification[]>("/api/notifications", { app: v.app })
          : await apiGet<ApiNotification[]>("/api/socio/notificacoes");
      aplicar(rows ?? []);
    } catch {
      /* Silêncio de propósito: fica o que havia. */
      if (!estado.ready) {
        estado = { ...estado, ready: true };
        emit();
      }
    } finally {
      emCurso = null;
    }
  })();
  return emCurso;
}

/** Marca como lidas — já no ecrã, e depois no servidor. Idempotente. */
export async function marcarLidas(ids: string[]): Promise<void> {
  const porLer = ids.filter((id) => estado.items.some((n) => n.id === id && !n.readAt));
  if (porLer.length === 0) return;

  const agora = new Date().toISOString();
  aplicar(estado.items.map((n) => (porLer.includes(n.id) ? { ...n, readAt: n.readAt ?? agora } : n)));

  const v = via();
  if (!v) return;
  try {
    if (v.kind === "app") await apiPatch("/api/notifications/read", { ids: porLer }, { app: v.app });
    else await apiPatch("/api/socio/notificacoes/read", { ids: porLer });
  } catch {
    /* Fica lida aqui; o servidor apanha-a na próxima leitura. */
  }
  void carregarNotificacoes();
}

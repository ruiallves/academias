import { useEffect, useSyncExternalStore } from "react";
import { apiGet } from "@/lib/http";
import { readSession } from "@/lib/session";
import { academy } from "@/lib/api";

/**
 * As outras áreas desta conta na app do clube — e o caminho para lá.
 *
 * ## O que isto é
 *
 * O par do `lib/handoff.ts` da app da família. Quem é treinador **e** pai
 * entrou na app do clube, escolheu "Staff" e foi entregue à consola; para
 * voltar à área de Família sem sair da conta, a consola tem de saber que essa
 * área existe e devolver-lhe a sessão. É o que vive aqui.
 *
 * Só se pergunta ao servidor quando alguém abre o menu do telemóvel — é o
 * único sítio que mostra isto. No computador não faz sentido: a app da família
 * é para instalar num telemóvel, e um diretor à secretária não a tem.
 *
 * ## A sessão vai com o par mais recente
 *
 * A consola renovou o refresh enquanto trabalhava; a cópia que ficou na app
 * envelheceu. Ao voltar, escreve-se o par actual na chave dela — senão a app
 * abria, tentava renovar com um refresh já rodado, e mandava a pessoa entrar
 * outra vez, sem perceber porquê.
 */

export type AppContextType = "FAMILY" | "MEMBER" | "STAFF";

type State = { contexts: AppContextType[] | null };

let state: State = { contexts: null };
let pedido: Promise<void> | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const snapshot = () => state;

async function carregar(): Promise<void> {
  try {
    const r = await apiGet<{ contexts: { type: AppContextType }[] }>("/api/app/contexts");
    state = { contexts: r.contexts.map((c) => c.type) };
  } catch {
    // Sem resposta não há secção — a consola continua inteira sem isto.
    state = { contexts: [] };
  }
  emit();
}

/** As áreas da app que esta conta tem além da consola. `null` enquanto não se sabe. */
export function useAppAreas(): Exclude<AppContextType, "STAFF">[] | null {
  const { contexts } = useSyncExternalStore(subscribe, snapshot, snapshot);
  useEffect(() => {
    if (state.contexts === null && !pedido) pedido = carregar().finally(() => (pedido = null));
  }, []);
  if (contexts === null) return null;
  return contexts.filter((c): c is Exclude<AppContextType, "STAFF"> => c !== "STAFF");
}

export const AREA_LABEL: Record<Exclude<AppContextType, "STAFF">, { label: string; hint: string }> = {
  FAMILY: { label: "Família", hint: "Os teus atletas: treinos, convocatórias e pagamentos" },
  MEMBER: { label: "Sócio", hint: "O teu cartão, as quotas e as novidades do clube" },
};

/** Onde a app do clube vive — sem barra final. */
export function appUrl(): string {
  const configured = import.meta.env.VITE_FAMILY_URL as string | undefined;
  if (configured) return configured.replace(/\/$/, "");
  if (import.meta.env.DEV) return "http://localhost:5174";
  return `${window.location.origin}/app`;
}

/** Devolve a sessão à app do clube, já vestida com a área pedida, e navega. */
export function irParaApp(area: Exclude<AppContextType, "STAFF">): void {
  const actual = readSession();
  if (!actual) return;

  const slug = actual.academySlug || academy.slug;
  const base = appUrl();

  if (base.startsWith(`${window.location.origin}/`)) {
    try {
      // A chave e o formato da app: ver `apps/family/src/lib/session.ts` e `lib/contexts.ts`.
      const anterior = JSON.parse(localStorage.getItem("academia.family.session") ?? "null") as { name?: string } | null;
      localStorage.setItem(
        "academia.family.session",
        JSON.stringify({ accessToken: actual.accessToken, refreshToken: actual.refreshToken, name: anterior?.name }),
      );
      localStorage.setItem(`academia.app.contexto:${slug}`, area);
      localStorage.setItem("academia.family.slug", slug);
    } catch {
      /* sem armazenamento: a app pede para entrar — não há mais nada a fazer */
    }
    window.location.assign(`${base}/`);
    return;
  }

  // Desenvolvimento: origens diferentes, a sessão vai no fragmento e a área na query.
  const sessao = { accessToken: actual.accessToken, refreshToken: actual.refreshToken };
  window.location.assign(`${base}/?area=${area}#s=${encodeURIComponent(btoa(JSON.stringify(sessao)))}`);
}

import { useSyncExternalStore } from "react";
import { apiGet } from "@/lib/http";
import { academySlug, saveSlug } from "@/lib/invite";

/**
 * Os contextos desta conta neste clube — e qual está vestido.
 *
 * ## "Contexto", e não "role"
 *
 * A mesma conta pode ser Família, Sócio e Staff no mesmo clube — e um dia
 * Atleta. Um "role" global no utilizador não tem onde pôr isso; um contexto é
 * `(conta, clube, relação)` e cresce sem partir nada: acrescentar "ATHLETE" a
 * este union e a vista correspondente no `App.tsx` é a migração inteira.
 *
 * ## Staff não é uma vista desta app
 *
 * É a consola — a mesma que vive no computador, servida na mesma origem
 * (`/consola`) e dentro do âmbito da app instalada. Escolher "Staff" entrega a
 * sessão à consola e sai daqui (ver `lib/handoff.ts`). Reescrever a consola em
 * miniatura seria ter duas consolas para manter, e a de telemóvel ficaria
 * sempre um passo atrás.
 *
 * ## A pergunta faz-se a cada arranque
 *
 * Quem tem mais do que um contexto escolhe **sempre** que abre a app. Uma
 * escolha guardada de ontem punha o pai que também é treinador a cair na
 * vista de família quando vinha ver a equipa — e a trocar às escuras, porque
 * o ecrã de escolha é o único sítio onde os contextos se vêem lado a lado.
 * Com um contexto só não há pergunta: entra-se.
 *
 * A escolha vive em memória e mais nada. A chave no `localStorage` é outra
 * coisa: uma **entrega** — a consola escreve lá a área ao devolver a sessão
 * ("volta à família"), e a app lê-a e apaga-a no arranque seguinte. Serve
 * uma vez; não sobrevive a um segundo arranque. Leva o slug porque a mesma
 * instalação pode um dia servir mais do que um clube.
 */

export type ContextType = "FAMILY" | "MEMBER" | "STAFF";

export type AppContext =
  | { type: "FAMILY" }
  | { type: "MEMBER"; memberId: string; number: number | null; status: string }
  /** O papel na consola (COACH, DIRECTOR…) — só para o nomear no ecrã de escolha. */
  | { type: "STAFF"; role: string };

type State = {
  /** `null` = ainda não se perguntou ao servidor. */
  contexts: AppContext[] | null;
  /** O contexto vestido. `null` = por escolher (ou só há um, e resolve-se sozinho). */
  active: ContextType | null;
  error: string | null;
};

const entregaKey = () => `academia.app.contexto:${academySlug()}`;

/**
 * A entrega da consola (ou do `?area=` em desenvolvimento) — lida **e apagada**
 * no mesmo gesto. É o que faz a pergunta voltar no arranque seguinte.
 */
function consumirEntrega(): ContextType | null {
  try {
    const v = localStorage.getItem(entregaKey());
    if (v !== null) localStorage.removeItem(entregaKey());
    return v === "FAMILY" || v === "MEMBER" || v === "STAFF" ? v : null;
  } catch {
    return null;
  }
}

let state: State = { contexts: null, active: null, error: null };
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
 * Um contexto só → é esse, sem perguntar nada a ninguém. Dois → vale a área
 * que a consola entregou, se a houver; senão fica por escolher e o `App`
 * mostra o ecrã "como queres continuar?". A escolha feita nesta sessão
 * (`state.active`) mantém-se entre recargas de dados — não entre arranques.
 */
export async function loadContexts(): Promise<void> {
  if (import.meta.env.DEV) await resolverClubeDaConta();
  try {
    const r = await apiGet<{ contexts: AppContext[] }>("/api/app/contexts");
    const tipos = r.contexts.map((c) => c.type);

    let active = state.active ?? consumirEntrega();
    if (active && !tipos.includes(active)) active = null;
    if (!active && tipos.length === 1) active = tipos[0];

    state = { contexts: r.contexts, active, error: null };
  } catch (e) {
    state = { ...state, error: e instanceof Error ? e.message : "Não foi possível carregar." };
  }
  emit();
}

/**
 * Em desenvolvimento, o clube vem da conta.
 *
 * Em produção a app vive em `{slug}.academias.pt` e o subdomínio diz de que
 * clube é. Em `localhost` ou atrás de um túnel não há subdomínio nenhum, e um
 * clube fixo no `.env` só acerta para as contas desse clube: entrar com uma
 * conta de outro clube dava "esta conta não é de encarregado" a quem o é —
 * só que noutro clube.
 *
 * Pergunta-se então à API onde é que esta conta tem vínculo. Se o clube em uso
 * não for um deles, passa a ser o primeiro — de família, se houver, porque esta
 * é a app da família. Só em desenvolvimento: em produção manda o subdomínio, e
 * trocá-lo às escondidas seria abrir outro clube.
 */
async function resolverClubeDaConta(): Promise<void> {
  try {
    const r = await apiGet<{ academies: { slug: string; role: string }[] }>("/auth/memberships");
    if (r.academies.length === 0 || r.academies.some((a) => a.slug === academySlug())) return;
    const daFamilia = r.academies.find((a) => a.role === "GUARDIAN" || a.role === "ATHLETE");
    saveSlug((daFamilia ?? r.academies[0]).slug);
  } catch {
    /* sem resposta fica o clube que já havia — o resto do arranque explica o que falhar */
  }
}

/**
 * Vestir um contexto — do seletor pós-login ou do switcher. Sem logout, sem
 * recarregar, e **sem guardar**: a escolha é desta abertura da app.
 */
export function chooseContext(type: ContextType): void {
  state = { ...state, active: type };
  emit();
}

/**
 * A área que a consola pediu ao devolver a sessão (`?area=FAMILY`).
 *
 * Em produção a consola escreve a entrega directamente na chave desta app —
 * mesma origem, mesmo `localStorage` — e o `loadContexts` consome-a. Em
 * desenvolvimento não pode, e manda-a na query, ao lado da sessão que vai no
 * fragmento (ver `adoptSessionFromUrl`). Corre antes do primeiro render, no
 * `main.tsx`, e limpa o que leu.
 */
export function captureAreaFromUrl(): void {
  const params = new URLSearchParams(window.location.search);
  const area = params.get("area");
  if (!area) return;
  if (area === "FAMILY" || area === "MEMBER" || area === "STAFF") chooseContext(area);
  params.delete("area");
  const resto = params.toString();
  window.history.replaceState(null, "", window.location.pathname + (resto ? `?${resto}` : "") + window.location.hash);
}

/** No fim da sessão — a conta seguinte não herda nada desta, nem uma entrega por consumir. */
export function clearContextChoice(): void {
  try {
    localStorage.removeItem(entregaKey());
  } catch {
    /* idem */
  }
  state = { contexts: null, active: null, error: null };
  emit();
}

import { useSyncExternalStore } from "react";
import { apiGet, apiPost } from "@/lib/http";

/**
 * A área de sócio — dados e chamadas.
 *
 * O mesmo desenho do `lib/store.ts` da família: um bootstrap que traz tudo
 * (`/api/socio/inicio`), um store módulo-nível, e recarga inteira em vez de
 * remendos — os dados são poucos e a verdade é do servidor.
 */

export type SocioFee = {
  id: string;
  period: string;
  label: string | null;
  amountCents: number;
  dueOn: string | null;
  status: "OPEN" | "SETTLED" | "VOID";
  settledAt: string | null;
  overdue: boolean;
};

export type SocioPoll = {
  id: string;
  question: string;
  details: string | null;
  publishedAt: string | null;
  myOptionId: string | null;
  options: { id: string; label: string; votes: number }[];
};

export type SocioInicio = {
  academy: {
    name: string;
    shortName: string;
    slug: string;
    logoUrl: string | null;
    signalColor: string;
    cardEnabled: boolean;
    cardQrEnabled: boolean;
    onlinePayments: boolean;
  };
  member: {
    id: string;
    name: string;
    number: number | null;
    status: "PENDING" | "ACTIVE" | "SUSPENDED" | "CANCELLED";
    tierName: string | null;
    email: string | null;
    phone: string | null;
    memberSince: string;
    cardQr: string | null;
  };
  fees: SocioFee[];
  nextMatch: {
    id: string;
    startsAt: string;
    venue: string;
    opponent: string;
    isHome: boolean;
    teamName: string;
    competition: string | null;
  } | null;
  news: { id: string; title: string; body: string; publishedAt: string }[];
  polls: SocioPoll[];
};

type State = { data: SocioInicio | null; error: string | null; loading: boolean };

let state: State = { data: null, error: null, loading: false };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const snapshot = () => state;

export function useSocio(): State {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

export async function loadSocio(): Promise<void> {
  state = { ...state, loading: true };
  emit();
  try {
    const data = await apiGet<SocioInicio>("/api/socio/inicio");
    state = { data, error: null, loading: false };
  } catch (e) {
    state = { ...state, error: e instanceof Error ? e.message : "Não foi possível carregar.", loading: false };
  }
  emit();
}

/** Sai daqui quando se troca de contexto — o próximo sócio não vê o anterior. */
export function resetSocio(): void {
  state = { data: null, error: null, loading: false };
  emit();
}

export type PagamentoIniciado = {
  id: string;
  method: string;
  status: string;
  entity: string | null;
  reference: string | null;
  expiresAt: string | null;
};

export const pagarQuota = (feeId: string, method: "MBWAY" | "MULTIBANCO", phone?: string) =>
  apiPost<PagamentoIniciado>(`/api/socio/quotas/${feeId}/pagar`, { method, ...(phone ? { phone } : {}) });

export const votar = (pollId: string, optionId: string) =>
  apiPost<{ ok: true }>(`/api/socio/sondagens/${pollId}/votar`, { optionId });

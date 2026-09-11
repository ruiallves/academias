import { useSyncExternalStore } from "react";
import { apiDelete, apiGet, apiPost } from "@/lib/http";

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

/**
 * Um mês que o sócio pode pagar já — do corrente até Julho, fim da época.
 *
 * `feeId` nulo é um mês que ninguém lançou ainda: a quota nasce quando ele
 * carregar em pagar, com o valor da categoria. `amountCents` nulo é o sócio
 * sem categoria com preço — não há valor que se possa prometer.
 */
export type SocioMes = {
  period: string;
  label: string;
  feeId: string | null;
  amountCents: number | null;
  status: "OPEN" | "SETTLED" | "VOID" | null;
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
    /** O valor mensal da categoria — nulo sem categoria ou sem preço. */
    tierFeeCents: number | null;
    email: string | null;
    phone: string | null;
    memberSince: string;
    /** Link assinado com prazo para a fotografia — a cara no cartão. Nulo sem fotografia. */
    photoUrl: string | null;
    cardQr: string | null;
  };
  fees: SocioFee[];
  upcoming: SocioMes[];
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

type State = {
  data: SocioInicio | null;
  error: string | null;
  loading: boolean;
};

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
    state = {
      ...state,
      error: e instanceof Error ? e.message : "Não foi possível carregar.",
      loading: false,
    };
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

export const pagarQuota = (
  feeId: string,
  method: "MBWAY" | "MULTIBANCO",
  phone?: string,
) =>
  apiPost<PagamentoIniciado>(`/api/socio/quotas/${feeId}/pagar`, {
    method,
    ...(phone ? { phone } : {}),
  });

/** Pagar um mês que ainda não tem quota — o servidor cria-a e inicia o pagamento. */
export const pagarMes = (
  period: string,
  method: "MBWAY" | "MULTIBANCO",
  phone?: string,
) =>
  apiPost<PagamentoIniciado>(`/api/socio/quotas/mes/${period}/pagar`, {
    method,
    ...(phone ? { phone } : {}),
  });

/**
 * Pagar tudo o que falta **até** um mês, numa referência só.
 *
 * Manda-se o limite e não a lista: as quotas pagam-se por ordem, e é o servidor
 * que resolve o conjunto para trás. Assim não há forma de pedir Março sem
 * Fevereiro — nem por engano, nem de propósito.
 */
export const pagarAte = (
  period: string,
  method: "MBWAY" | "MULTIBANCO",
  phone?: string,
) =>
  apiPost<PagamentoIniciado>(`/api/socio/quotas/ate/${period}/pagar`, {
    method,
    ...(phone ? { phone } : {}),
  });

/* -------------------------------------------------------------------------- */
/* A fotografia — a cara no cartão                                             */
/* -------------------------------------------------------------------------- */

/**
 * O sócio põe a sua fotografia, pela app.
 *
 * O mesmo caminho em três passos da consola (ver `lib/photos.ts` lá): pedir
 * autorização, carregar **directamente** para o armazenamento, confirmar. O
 * ficheiro não passa pela API, e a API só grava a chave depois de verificar
 * que o ficheiro chegou. Sem `memberId` no pedido: é sempre a ficha do próprio,
 * resolvida no servidor a partir da sessão.
 */
const TIPOS = ["image/jpeg", "image/png", "image/webp"];
/** 8 MB — o tecto do servidor (`MAX_BYTES` em `photos.service.ts`). */
const MAX_BYTES = 8 * 1024 * 1024;

export class FotoError extends Error {}

/** A mensagem do problema, ou `null` quando o ficheiro está em condições. */
export function checkFoto(file: File): string | null {
  if (!TIPOS.includes(file.type))
    return "A fotografia tem de ser JPEG, PNG ou WebP.";
  if (file.size > MAX_BYTES)
    return "A fotografia é grande de mais — o máximo são 8 MB.";
  return null;
}

export async function uploadFotoSocio(file: File): Promise<string | null> {
  const problema = checkFoto(file);
  if (problema) throw new FotoError(problema);

  const signed = await apiPost<{ url: string; token: string; key: string }>(
    "/api/socio/foto/upload",
    {
      contentType: file.type,
    },
  );
  const res = await fetch(signed.url, {
    method: "PUT",
    headers: {
      "Content-Type": file.type,
      ...(signed.token ? { Authorization: `Bearer ${signed.token}` } : {}),
    },
    body: file,
  });
  if (!res.ok) throw new FotoError("Não foi possível carregar a fotografia.");

  const { photoUrl } = await apiPost<{ photoUrl: string | null }>(
    "/api/socio/foto",
    { key: signed.key },
  );
  return photoUrl;
}

export const removerFotoSocio = () =>
  apiDelete<{ ok: true }>("/api/socio/foto");

export const votar = (pollId: string, optionId: string) =>
  apiPost<{ ok: true }>(`/api/socio/sondagens/${pollId}/votar`, { optionId });

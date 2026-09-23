import { useSyncExternalStore } from "react";
import { reduzirFotografia } from "@academia/ui/imagem";
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
  /**
   * O que esta quota cobre — só nas anuais.
   *
   * Uma anuidade pode ser partida em duas (o sócio que paga meio ano de uma
   * vez), e aí o rótulo sozinho não chega: o que distingue as duas linhas é o
   * intervalo. Nulo nas mensais, onde o período já diz tudo.
   */
  coversFrom?: string | null;
  coversTo?: string | null;
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

/**
 * Um jogo por disputar, de qualquer escalão do clube.
 *
 * `teamMaxAge` é o que decide a ordem em que os jogos aparecem — dos mais
 * velhos para os mais novos, pedido explícito — e a forma como se agrupam no
 * separador Clube. Ver `JogosDoClube`.
 */
export type SocioMatch = {
  id: string;
  startsAt: string;
  venue: string;
  opponent: string;
  isHome: boolean;
  teamName: string;
  teamMaxAge: number;
  competition: string | null;
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
    /** O valor da categoria no período de `tierBilling` — nulo sem categoria ou sem preço. */
    tierFeeCents: number | null;
    /**
     * Mensal ou anual. Numa categoria anual há **uma** quota por época, e a app
     * não oferece meses adiantados — não há meses para adiantar. Ausente num
     * servidor antigo: lê-se como mensal.
     */
    tierBilling?: "MONTHLY" | "ANNUAL";
    email: string | null;
    phone: string | null;
    memberSince: string;
    /** Link assinado com prazo para a fotografia — a cara no cartão. Nulo sem fotografia. */
    photoUrl: string | null;
    cardQr: string | null;
  };
  fees: SocioFee[];
  upcoming: SocioMes[];
  /** Todos os jogos por disputar, de todos os escalões — dos mais velhos para os mais novos. */
  matches: SocioMatch[];
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

/**
 * Carregar uma fotografia para o armazenamento, do lado do telemóvel.
 *
 * Partilhado pelo sócio e pelo atleta: são o mesmo caminho em três passos
 * (autorizar, carregar directo, confirmar), e a diferença é só o endpoint.
 *
 * ## As duas coisas que aqui se fazem pela factura
 *
 * **Reduzir antes de subir.** Uma fotografia de câmara são megabytes e aparece
 * num avatar de 34 pixels. Ver `reduzirFotografia`. Corre antes de pedir a
 * autorização porque é o tipo do ficheiro que sobe que decide a extensão da
 * chave.
 *
 * **Marcá-la como guardável.** Sem o cabeçalho, o Supabase grava `no-cache` nos
 * metadados do objecto. Hoje isso não muda o que chega ao browser (a descarga
 * por endereço assinado vem sem `cache-control` e com `Expires` igual ao prazo
 * do endereço), mas muda no dia em que uma destas imagens for servida por CDN.
 * Quem faz a cache funcionar hoje é o endereço ser estável — ver a cache de
 * assinaturas em `storage.service.ts`.
 */
export async function subirFotografia(
  rota: string,
  file: File,
): Promise<string | null> {
  const problema = checkFoto(file);
  if (problema) throw new FotoError(problema);

  const pronta = await reduzirFotografia(file);

  const signed = await apiPost<{ url: string; token: string; key: string }>(
    `${rota}/upload`,
    { contentType: pronta.type },
  );
  const res = await fetch(signed.url, {
    method: "PUT",
    headers: {
      "Content-Type": pronta.type,
      "cache-control": "max-age=31536000, immutable",
      ...(signed.token ? { Authorization: `Bearer ${signed.token}` } : {}),
    },
    body: pronta,
  });
  if (!res.ok) throw new FotoError("Não foi possível carregar a fotografia.");

  const { photoUrl } = await apiPost<{ photoUrl: string | null }>(rota, {
    key: signed.key,
  });
  return photoUrl;
}

export const uploadFotoSocio = (file: File) => subirFotografia("/api/socio/foto", file);

export const removerFotoSocio = () =>
  apiDelete<{ ok: true }>("/api/socio/foto");

export const votar = (pollId: string, optionId: string) =>
  apiPost<{ ok: true }>(`/api/socio/sondagens/${pollId}/votar`, { optionId });

import { apiGet, apiPost } from "@/lib/http";

/**
 * As condições comerciais do clube — a "Ordem de Adesão".
 *
 * O que a plataforma emitiu quando o plano foi contratado ou alterado: plano,
 * preço, periodicidade, data de início, período mínimo e renovação. Assina-se
 * aqui, com a conta de quem representa o clube.
 */
export type SubscriptionOrder = {
  id: string;
  planName: string;
  billingPeriod: "MONTHLY" | "ANNUAL";
  /** O preço de tabela por mês, em cêntimos. */
  listMonthlyCents: number;
  discountPct: number;
  /** O que se paga por período, já com desconto. */
  amountCents: number;
  startsOn: string;
  minimumMonths: number;
  renewalNote: string | null;
  notes: string | null;
  termsVersion: string | null;
  status: "PENDING" | "SIGNED" | "SUPERSEDED";
  sentToName: string | null;
  sentAt: string | null;
  signedAt: string | null;
  signerName: string | null;
  signerTitle: string | null;
};

export type SubscriptionOrders = {
  pendente: SubscriptionOrder | null;
  assinada: SubscriptionOrder | null;
  /**
   * Se **esta** conta pode assinar. Vem do servidor (`legal:club`), e não se
   * recalcula aqui — ver `paraAConsola` na API.
   */
  podeAssinar: boolean;
};

export const subscriptionOrders = () => apiGet<SubscriptionOrders>("/api/subscricao/ordem");

export const signSubscriptionOrder = () => apiPost<SubscriptionOrder>("/api/subscricao/ordem/assinar", {});

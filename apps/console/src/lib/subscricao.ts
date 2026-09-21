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

/**
 * Um aviso de pagamento da subscrição — o email que sai todos os meses.
 *
 * O ciclo corre no dia em que o clube aceitou as condições (aceitou a 20, recebe
 * a 20), e cada aviso cobre o período que acabou de correr. Ver `ciclo.ts` na
 * API, que é onde vive a conta dos meses curtos.
 */
export type SubscriptionNotice = {
  id: string;
  periodStart: string;
  periodEnd: string;
  issuedOn: string;
  dueOn: string;
  amountCents: number;
  planName: string;
  billingPeriod: "MONTHLY" | "ANNUAL";
  /** Para onde foi. Nulo quando o clube não tinha responsável com endereço. */
  toEmail: string | null;
  /** Quando saiu. Nulo = ficou por enviar, e o painel di-lo. */
  sentAt: string | null;
};

export type SubscriptionOrders = {
  pendente: SubscriptionOrder | null;
  assinada: SubscriptionOrder | null;
  /** Os doze avisos mais recentes, do mais novo para o mais velho. */
  avisos: SubscriptionNotice[];
  /**
   * Se **esta** conta pode assinar. Vem do servidor (`legal:club`), e não se
   * recalcula aqui — ver `paraAConsola` na API.
   */
  podeAssinar: boolean;
};

export const subscriptionOrders = () => apiGet<SubscriptionOrders>("/api/subscricao/ordem");

export const signSubscriptionOrder = () => apiPost<SubscriptionOrder>("/api/subscricao/ordem/assinar", {});

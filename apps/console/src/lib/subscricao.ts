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
  /** A instituição que se vinculou, escrita por quem assinou. Nula nas antigas. */
  institutionName: string | null;
  institutionTaxId: string | null;
  /**
   * Preenchido numa ordem reemitida só para se voltar a assinar com a
   * identificação: as condições são as mesmas, e o dia de cobrança também.
   */
  billingAnchorAt: string | null;
  /** Se há declaração em PDF para descarregar. As assinadas antes dela não têm. */
  temDeclaracao: boolean;
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
  /**
   * O que o formulário da assinatura traz já escrito: a instituição da última
   * assinatura, e o nome de quem está a assinar. Nulo quando não há nada por
   * assinar ou esta conta não pode assinar.
   */
  sugestao: { institutionName: string; institutionTaxId: string; signerName: string } | null;
};

/** O que quem assina escreve. Ver `AssinarCondicoesDialog`. */
export type DadosDaAssinatura = {
  institutionName: string;
  institutionTaxId: string;
  signerName: string;
  signerTaxId: string;
  /** `AAAA-MM-DD`. */
  signerBirthdate: string;
  accepted: boolean;
};

export const subscriptionOrders = () => apiGet<SubscriptionOrders>("/api/subscricao/ordem");

export const signSubscriptionOrder = (dados: DadosDaAssinatura) =>
  apiPost<SubscriptionOrder>("/api/subscricao/ordem/assinar", dados);

/**
 * Uma mensalidade da plataforma, como a secção "Mensalidade" a mostra.
 *
 * `periodo` já vem por extenso do servidor ("5 de outubro a 4 de novembro de
 * 2026"): é a frase de todo o lado, e nunca "a mensalidade de outubro".
 */
export type MensalidadeDaPlataforma = {
  id: string;
  periodStart: string;
  periodEnd: string;
  periodo: string;
  amountCents: number;
  planName: string;
  billingPeriod: "MONTHLY" | "ANNUAL";
  paidAt: string | null;
  /** "MB WAY", "Multibanco", "Transferência". Nulo por pagar. */
  metodo: string | null;
  /** O período acabou sem pagamento. */
  vencida: boolean;
  /** O nome do PDF da fatura, quando a plataforma a anexou. Nulo: ainda não. */
  fatura: string | null;
  /** A referência Multibanco viva, se já foi pedida. */
  multibanco: { entity: string | null; reference: string | null; expiresAt: string | null; amountCents: number } | null;
  /** O último pedido MB WAY dos últimos minutos, para se saber se está a confirmar. */
  mbway: { phone: string | null; status: "PENDING" | "PAID" | "FAILED" | "EXPIRED"; createdAt: string } | null;
};

export type EstadoDaMensalidade = {
  academy: { slug: string; name: string; shortName: string; signalColor: string; logoUrl: string | null };
  suspenso: boolean;
  /** `legal:club` ou `settings:write`. Quem não tem vê o estado e mais nada. */
  podePagar: boolean;
  /** Nulo quando o clube não paga (avaliação, ou sem plano activo). */
  plano: { name: string; amountCents: number; billingPeriod: "MONTHLY" | "ANNUAL" } | null;
  /** Por pagar, da mais antiga para a mais recente. */
  emFalta: MensalidadeDaPlataforma[];
  /** Pagas, da mais recente para trás. */
  historico: MensalidadeDaPlataforma[];
};

/** O 403 do clube fechado por falta de pagamento. O mesmo código em `suspensao.service.ts` na API. */
export const ACADEMY_SUSPENDED_CODE = "ACADEMY_SUSPENDED";

export const estadoDaMensalidade = () => apiGet<EstadoDaMensalidade>("/api/subscricao/mensalidade");

export const pedirMultibanco = (id: string) =>
  apiPost<{ entity: string | null; reference: string | null; expiresAt: string | null; amountCents: number }>(
    `/api/subscricao/mensalidade/${id}/multibanco`,
    {},
  );

/** A fatura de uma mensalidade paga, em base64 (o cliente autenticado não abre links). */
export const faturaDaMensalidade = (id: string) =>
  apiGet<{ ficheiro: string; base64: string }>(`/api/subscricao/mensalidade/${id}/fatura`);

export const pedirMbway =(id: string, phone: string) =>
  apiPost<{ ok: true; phone: string }>(`/api/subscricao/mensalidade/${id}/mbway`, { phone });

/** A declaração de aceitação em PDF. Vem em base64 — ver `declaracaoParaAConsola` na API. */
export const declaracaoDaOrdem = (id: string) =>
  apiGet<{ ficheiro: string; sha256: string; base64: string }>(`/api/subscricao/ordem/${id}/declaracao`);

/**
 * Um NIF português com o dígito de controlo certo.
 *
 * A mesma conta que o servidor faz (`nifValido`, em `api/src/subscription/
 * declaracao.ts`). Aqui é só para avisar antes de enviar; quem decide é lá.
 */
export function nifValido(nif: string): boolean {
  if (!/^\d{9}$/.test(nif)) return false;
  const d = nif.split("").map(Number);
  const soma = d.slice(0, 8).reduce((acc, x, i) => acc + x * (9 - i), 0);
  const resto = soma % 11;
  return d[8] === (resto < 2 ? 0 : 11 - resto);
}

/** Guarda no computador um ficheiro que veio em base64. */
export function guardarFicheiro(ficheiro: string, base64: string, tipo = "application/pdf") {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: tipo }));
  const a = document.createElement("a");
  a.href = url;
  a.download = ficheiro;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

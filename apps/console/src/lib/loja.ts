import { apiGet, apiPost } from "@/lib/http";

/**
 * As encomendas da loja do site, do lado da consola. O contrato está em
 * `docs/10-loja.md`.
 *
 * Nada disto vive na cópia em memória do site (`lib/website.ts`): as
 * encomendas chegam de fora a qualquer hora e leem-se de fresco de cada vez
 * que o ecrã abre e depois de cada ação. Ver é `website:read`; mexer é
 * `website:write` (o servidor recusa na mesma).
 */

export type EstadoDaEncomenda = "RESERVED" | "PAID" | "IN_PRODUCTION" | "READY" | "SHIPPED" | "DELIVERED" | "LATE_PAYMENT" | "CANCELLED";

/**
 * Os nomes dos estados (15/11/2026, pedido do Rui): Pendente, Paga, Em
 * preparação, Pronta para levantamento (ou Enviada), Entregue, Cancelada.
 * `IN_PRODUCTION` era "No produtor"; o valor na base de dados ficou o mesmo e
 * passou a querer dizer "Em preparação", seja no clube ou no fornecedor.
 */
export const ESTADO_DA_ENCOMENDA: Record<EstadoDaEncomenda, string> = {
  RESERVED: "Pendente",
  PAID: "Paga",
  IN_PRODUCTION: "Em preparação",
  READY: "Pronta para levantamento",
  SHIPPED: "Enviada",
  DELIVERED: "Entregue",
  LATE_PAYMENT: "Paga fora do prazo",
  CANCELLED: "Cancelada",
};

export type Encomenda = {
  id: string;
  numero: number;
  /** A referência única em toda a plataforma ("ENC-7K2F-9QXA"). Ausente num servidor antigo. */
  referencia?: string;
  /** As mudanças de estado feitas na consola, com quem as fez. Ausente num servidor antigo. */
  mudancas?: { de: EstadoDaEncomenda | null; para: EstadoDaEncomenda; quem: string | null; nota: string | null; em: string }[];
  estado: EstadoDaEncomenda;
  entrega: "PICKUP" | "SHIPPING";
  /** As linhas da morada, só no envio. */
  morada: string[];
  comprador: { nome: string; email: string; telefone: string | null };
  nota: string | null;
  linhas: { nome: string; tamanho: string; quantidade: number; unitPriceCents: number; imageUrl: string | null; productId: string | null }[];
  itemsCents: number;
  envioCents: number;
  /** O desconto do código promocional (0 sem código). Ausente num servidor antigo. */
  descontoCents?: number;
  codigo?: string | null;
  totalCents: number;
  pagoCents: number;
  rastreio: string | null;
  /** ISO. */
  criadaEm: string;
  pagaEm: string | null;
  /** Quando passou a "Em preparação". Ausente num servidor antigo. */
  producaoEm?: string | null;
  prontaEm: string | null;
  enviadaEm: string | null;
  entregueEm: string | null;
  anuladaEm: string | null;
  motivo: string | null;
  /** Há dinheiro a devolver. `feitoEm` nulo = por fazer. */
  reembolso: { valorCents: number; feitoEm: string | null; nota: string | null } | null;
};

export function listarEncomendas(): Promise<Encomenda[]> {
  return apiGet<Encomenda[]>("/api/loja/encomendas");
}

/** Os passos que o clube muda à mão, pela ordem. */
export type PassoDaEncomenda = "PAID" | "IN_PRODUCTION" | "READY" | "SHIPPED" | "DELIVERED";

/** Os passos possíveis de uma encomenda: o levantamento passa pela pronta, o envio pela enviada; a preparação é opcional. */
export function passosDaEncomenda(entrega: Encomenda["entrega"]): PassoDaEncomenda[] {
  return entrega === "SHIPPING" ? ["PAID", "IN_PRODUCTION", "SHIPPED", "DELIVERED"] : ["PAID", "IN_PRODUCTION", "READY", "DELIVERED"];
}

/**
 * Mudar para qualquer passo, para a frente ou para trás. O email a quem
 * comprou só sai para a frente, ao chegar a pronta ou enviada, e só com
 * `avisar`. Fica registado com o nome de quem mudou.
 */
export function mudarEstado(id: string, estado: PassoDaEncomenda, opcoes: { rastreio?: string; avisar?: boolean } = {}): Promise<{ ok: true }> {
  return apiPost(`/api/loja/encomendas/${id}/estado`, { estado, ...(opcoes.rastreio?.trim() ? { rastreio: opcoes.rastreio.trim() } : {}), ...(opcoes.avisar === false ? { avisar: false } : {}) });
}

/** Em preparação. Sem email; a página da encomenda diz "Em preparação". */
export function marcarEmProducao(id: string): Promise<{ ok: true }> {
  return apiPost(`/api/loja/encomendas/${id}/producao`, {});
}

/** Levantamento: pronta para levantar. Quem comprou recebe o aviso. */
export function marcarPronta(id: string): Promise<{ ok: true }> {
  return apiPost(`/api/loja/encomendas/${id}/pronta`, {});
}

/** Envio: seguiu pelo correio. Quem comprou recebe o aviso, com o código se houver. */
export function marcarEnviada(id: string, rastreio?: string): Promise<{ ok: true }> {
  return apiPost(`/api/loja/encomendas/${id}/enviada`, rastreio?.trim() ? { rastreio: rastreio.trim() } : {});
}

export function marcarEntregue(id: string): Promise<{ ok: true }> {
  return apiPost(`/api/loja/encomendas/${id}/entregue`, {});
}

export function anularEncomenda(id: string, motivo: string): Promise<{ ok: true }> {
  return apiPost(`/api/loja/encomendas/${id}/anular`, { motivo });
}

/** O clube devolveu o dinheiro por fora (na primeira versão é sempre à mão). */
export function marcarReembolsado(id: string, nota?: string): Promise<{ ok: true }> {
  return apiPost(`/api/loja/encomendas/${id}/reembolsado`, nota?.trim() ? { nota: nota.trim() } : {});
}

export function reenviarConfirmacao(id: string): Promise<{ ok: true }> {
  return apiPost(`/api/loja/encomendas/${id}/reenviar`, {});
}

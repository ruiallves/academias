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

export type EstadoDaEncomenda = "RESERVED" | "PAID" | "READY" | "SHIPPED" | "DELIVERED" | "LATE_PAYMENT" | "CANCELLED";

export const ESTADO_DA_ENCOMENDA: Record<EstadoDaEncomenda, string> = {
  RESERVED: "À espera de pagamento",
  PAID: "Paga, por preparar",
  READY: "Pronta para levantar",
  SHIPPED: "Enviada",
  DELIVERED: "Entregue",
  LATE_PAYMENT: "Paga fora do prazo",
  CANCELLED: "Anulada",
};

export type Encomenda = {
  id: string;
  numero: number;
  estado: EstadoDaEncomenda;
  entrega: "PICKUP" | "SHIPPING";
  /** As linhas da morada, só no envio. */
  morada: string[];
  comprador: { nome: string; email: string; telefone: string | null };
  nota: string | null;
  linhas: { nome: string; tamanho: string; quantidade: number; unitPriceCents: number; imageUrl: string | null; productId: string | null }[];
  itemsCents: number;
  envioCents: number;
  totalCents: number;
  pagoCents: number;
  rastreio: string | null;
  /** ISO. */
  criadaEm: string;
  pagaEm: string | null;
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

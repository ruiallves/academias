import { apiDelete, apiGet, apiPost } from "@/lib/http";
import type { Bancada, ParaQuem } from "@/lib/website";

/**
 * A bilheteira do lado da consola, para lá do que se configura no site: as
 * vendas de um jogo, anular e reembolsar, os acessos dos seguranças à porta, e
 * os lugares anuais dos sócios. O contrato está em `docs/09-bilheteira.md`.
 *
 * Nada disto vive na cópia em memória do site (`lib/website.ts`): são coisas
 * que mudam de fora (compras a chegar, seguranças a ler bilhetes) e leem-se de
 * fresco de cada vez que o ecrã abre.
 *
 * Ver é `website:read` (vendas) ou `member:read` (lugares anuais); mexer é
 * `website:write` ou `member:write`. Os acessos das portas só se veem com
 * `website:write`: a lista diz quem tem chave da porta.
 */

export const euro = (v: number) => new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(v);

/** "sáb., 25 out., 15:00", sempre na hora de Lisboa, que é a do jogo. */
export const quando = (iso: string) =>
  new Intl.DateTimeFormat("pt-PT", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Lisbon" }).format(new Date(iso));

/* -------------------------------------------------------------------------- */
/* As vendas de um jogo                                                         */
/* -------------------------------------------------------------------------- */

/** O estado de uma compra. As que caducaram sem pagamento (`EXPIRED`) não vêm. */
export type EstadoDaCompra = "RESERVED" | "PAID" | "LATE_PAYMENT" | "CANCELLED";

export const ESTADO_DA_COMPRA: Record<EstadoDaCompra, string> = {
  PAID: "Paga",
  RESERVED: "À espera de pagamento",
  LATE_PAYMENT: "Fora do prazo",
  CANCELLED: "Anulada",
};

export type CompraDoJogo = {
  id: string;
  estado: EstadoDaCompra;
  canal: "SITE" | "APP";
  /** `socio` é o número de sócio, quando comprou ao preço de sócio ou pela app. */
  comprador: { nome: string; email: string; telefone: string | null; socio: number | null };
  bilhetes: { tipo: string; estado: "VALID" | "USED" | "VOID" }[];
  totalCents: number;
  pagoCents: number;
  /** ISO. */
  criadaEm: string;
  pagaEm: string | null;
  /** Há dinheiro a devolver: anulada depois de paga, ou paga fora do prazo. `feitoEm` nulo = por fazer. */
  reembolso: { valorCents: number; feitoEm: string | null; nota: string | null } | null;
};

/** A venda como o site a vê: os tipos com nome de bancada e de categoria, e os lugares livres. */
export type VendaPublica = {
  jogo: { id: string; startsAt: string; opponent: string; teamName: string; status: string };
  estado: { socios: boolean; publico: boolean; fechada: boolean; abreSociosEm: string | null; abrePublicoEm: string | null; soSocios: boolean };
  nota: string | null;
  recinto: { id: string; nome: string; tipo: "campo" | "pavilhao"; bancadas: Bancada[] } | null;
  tipos: { id: string; nome: string; preco: number; bancadaId: string | null; bancada: string | null; para: ParaQuem; tierId: string | null; tierNome: string | null }[];
  /** Por bancada. Nulo = sem limite próprio. */
  livres: Record<string, number | null>;
  livresNoJogo: number | null;
};

export type VendasDoJogo = {
  venda: VendaPublica;
  /** Lugares anuais da época, por bancada. */
  anuais: Record<string, number>;
  /** Bilhetes vendidos ou guardados (nos 10 minutos), por bancada. */
  ocupados: Record<string, number>;
  porTipo: { typeId: string; nome: string; vendidos: number; receitaCents: number }[];
  /** O que entrou de facto, das compras pagas. */
  receitaCents: number;
  /** Entradas aceites, por id de porta ("todas" = o leitor de todas as portas). */
  entradas: Record<string, number>;
  pedidos: CompraDoJogo[];
};

export function vendasDoJogo(matchId: string): Promise<VendasDoJogo> {
  return apiGet<VendasDoJogo>(`/api/bilheteira/jogos/${matchId}/vendas`);
}

/** Fecha a venda, anula todas as compras e avisa quem comprou. As pagas ficam com o reembolso por fazer. */
export function cancelarVendasDoJogo(matchId: string, motivo: string): Promise<{ anuladas: number }> {
  return apiPost(`/api/bilheteira/jogos/${matchId}/cancelar`, { motivo });
}

export function anularCompra(id: string, motivo: string): Promise<{ ok: true }> {
  return apiPost(`/api/bilheteira/pedidos/${id}/anular`, { motivo });
}

/** O clube devolveu o dinheiro por fora (na primeira versão é sempre à mão). */
export function marcarReembolsado(id: string, nota?: string): Promise<{ ok: true }> {
  return apiPost(`/api/bilheteira/pedidos/${id}/reembolsado`, nota?.trim() ? { nota: nota.trim() } : {});
}

export function reenviarBilhetes(id: string): Promise<{ ok: true }> {
  return apiPost(`/api/bilheteira/pedidos/${id}/reenviar`, {});
}

/* -------------------------------------------------------------------------- */
/* O leitor à porta                                                             */
/* -------------------------------------------------------------------------- */

/** O id da "porta" que aceita todas as bancadas. É também o leitor de um recinto sem portas. */
export const TODAS_AS_PORTAS = "todas";

export type AcessoDaPorta = {
  id: string;
  gateId: string;
  /** O nome da porta. */
  porta: string;
  /** O nome que o clube deu ao acesso ("Segurança Porta A"), ou o da porta. */
  label: string;
  /** ISO. Seis horas depois do fim do jogo. */
  expiraEm: string;
  /** Falso depois de revogado ou de caducar. */
  ativo: boolean;
  /** Cinco PINs errados bloqueiam o link 15 minutos. */
  bloqueado: boolean;
  criadoPor: string | null;
};

export type PortasDoJogo = { portas: { id: string; nome: string }[]; acessos: AcessoDaPorta[] };

export function portasDoJogo(matchId: string): Promise<PortasDoJogo> {
  return apiGet<PortasDoJogo>(`/api/bilheteira/jogos/${matchId}/portas`);
}

/** O link e o PIN vêm só nesta resposta: na base fica o resumo. Quem os perder cria outro acesso. */
export type AcessoCriado = { id: string; link: string; pin: string; expiraEm: string };

export function criarAcesso(matchId: string, gateId: string, label?: string): Promise<AcessoCriado> {
  return apiPost<AcessoCriado>(`/api/bilheteira/jogos/${matchId}/portas`, { gateId, ...(label?.trim() ? { label: label.trim() } : {}) });
}

export function revogarAcesso(id: string): Promise<{ ok: true }> {
  return apiDelete(`/api/bilheteira/portas/${id}`);
}

/* -------------------------------------------------------------------------- */
/* Lugares anuais                                                               */
/* -------------------------------------------------------------------------- */

export type LugarAnual = {
  id: string;
  socio: { id: string; name: string; number: number | null };
  seasonId: string;
  epoca: string;
  venueId: string;
  bancadaId: string;
  /** O lugar numerado ("Fila C, 12"). Nulo = bancada sem lugar marcado. */
  lugar: string | null;
  notas: string | null;
};

export function listarLugaresAnuais(filtro: { seasonId?: string; memberId?: string } = {}): Promise<LugarAnual[]> {
  return apiGet<LugarAnual[]>("/api/bilheteira/lugares-anuais", { seasonId: filtro.seasonId, memberId: filtro.memberId });
}

export function criarLugarAnual(dto: { memberId: string; seasonId: string; venueId: string; bancadaId: string; seat?: string; notes?: string }): Promise<{ id: string }> {
  return apiPost<{ id: string }>("/api/bilheteira/lugares-anuais", {
    memberId: dto.memberId,
    seasonId: dto.seasonId,
    venueId: dto.venueId,
    bancadaId: dto.bancadaId,
    ...(dto.seat?.trim() ? { seat: dto.seat.trim() } : {}),
    ...(dto.notes?.trim() ? { notes: dto.notes.trim() } : {}),
  });
}

export function apagarLugarAnual(id: string): Promise<{ ok: true }> {
  return apiDelete(`/api/bilheteira/lugares-anuais/${id}`);
}

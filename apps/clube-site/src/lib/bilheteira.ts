/**
 * A bilheteira do lado do site: as formas que a API devolve à compra
 * (`docs/09-bilheteira.md`) e as frases das fases, para a lista, o cartaz e a
 * compra dizerem o mesmo.
 *
 * Sem nada do servidor: os componentes da compra e da página do bilhete
 * correm no browser e importam daqui.
 */

import type { Jogo, Recinto } from "@/dados/tipos";
import { dataLonga, euro, hora } from "./formatar";

/* -------------------------------------------------------------------------- */
/* O que a API devolve                                                          */
/* -------------------------------------------------------------------------- */

export type TipoDaVenda = {
  id: string;
  nome: string;
  /** Em euros. */
  preco: number;
  bancadaId: string | null;
  bancada: string | null;
  para: "publico" | "socios";
  tierId: string | null;
  tierNome: string | null;
};

/** `GET /api/clubes/:slug/bilhetes/:matchId`, sem cache: o momento de comprar. */
export type Venda = {
  jogo: { id: string; startsAt: string; opponent: string; teamName: string; status: string };
  estado: { socios: boolean; publico: boolean; fechada: boolean; abreSociosEm: string | null; abrePublicoEm: string | null; soSocios: boolean };
  nota: string | null;
  recinto: Recinto | null;
  tipos: TipoDaVenda[];
  /** Por bancada. Nulo = a bancada não tem limite próprio. */
  livres: Record<string, number | null>;
  livresNoJogo: number | null;
  reservaMinutos: number;
};

/** `POST /api/clubes/:slug/bilhetes/:matchId/socio`. */
export type Identificacao = { credencial: string; venda: Venda; jaTemBilheteDeSocio: boolean };

export type Metodo = "MBWAY" | "MULTIBANCO";

/** `POST /api/clubes/:slug/bilhetes/:matchId`. */
export type Compra = {
  token: string;
  estado: "a-pagar" | "pago";
  totalCents: number;
  reservadoAte: string;
  pagamento: { metodo: Metodo; entidade: string | null; referencia: string | null; valorCents: number } | null;
};

export type EstadoDoPedido = "a-pagar" | "pago" | "expirado" | "fora-do-prazo" | "anulado";

/** `GET /api/clubes/:slug/bilhetes/pedido/:token`. */
export type Pedido = {
  estado: EstadoDoPedido;
  comprador: string;
  reservadoAte: string;
  totalCents: number;
  pagamento: { metodo: Metodo; entidade: string | null; referencia: string | null; valorCents: number; estado: string } | null;
  reembolso: { valorCents: number; feito: boolean } | null;
  jogo: { startsAt: string; opponent: string; teamName: string; local: string } | null;
  bilhetes: { id: string; tipo: string; bancada: string | null; porta: string | null; usado: boolean; codigo: string }[];
};

/** O máximo de bilhetes numa compra (o mesmo da API). */
export const MAXIMO_POR_COMPRA = 10;

/** Abaixo disto, a bancada mostra quantos lugares restam. */
export const POUCOS_LUGARES = 20;

/* -------------------------------------------------------------------------- */
/* Frases                                                                       */
/* -------------------------------------------------------------------------- */

const diaEMes = new Intl.DateTimeFormat("pt-PT", { timeZone: "Europe/Lisbon", day: "numeric", month: "long" });

/** "24 de outubro, às 10:00": lê-se depois de "a partir de" e de "Abre ao público a". */
export function quando(iso: string): string {
  return `${diaEMes.format(new Date(iso))}, às ${hora(iso)}`;
}

/** "sábado, 24 de outubro, 16:00": a data de um jogo. */
export function dataDoJogo(iso: string): string {
  return `${dataLonga(iso)}, ${hora(iso)}`;
}

/** "120,00 €" a partir de cêntimos. */
export function euroDeCents(cents: number): string {
  return euro(cents / 100);
}

/**
 * As fases de um jogo para a lista e para o cartaz: "Só para sócios",
 * "Sócios a partir de …", "Público a partir de …". Vazio numa venda aberta a
 * todos.
 */
export function fasesDoJogo(t: NonNullable<Jogo["tickets"]>): string[] {
  const out: string[] = [];
  if (t.membersOnly) out.push("Só para sócios");
  if (t.membersOpen === false && t.membersFrom) out.push(`Sócios a partir de ${quando(t.membersFrom)}`);
  if (!t.membersOnly && t.publicOpen === false && t.publicFrom) out.push(`Público a partir de ${quando(t.publicFrom)}`);
  return out;
}

/**
 * O "desde" de um jogo: o preço mais baixo do público. Sem preços do público
 * (um jogo só com bilhetes de sócio), o mais baixo dos sócios, dito como tal.
 */
export function desdeDoJogo(t: NonNullable<Jogo["tickets"]>): string | null {
  const publico = t.types.filter((x) => !x.forMembers).map((x) => x.price);
  if (publico.length) return `Bilhetes desde ${euro(Math.min(...publico))}`;
  const socios = t.types.filter((x) => x.forMembers).map((x) => x.price);
  if (socios.length) return `Sócios desde ${euro(Math.min(...socios))}`;
  return null;
}

/* -------------------------------------------------------------------------- */
/* Demonstração                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * A venda de um jogo do clube inventado, montada a partir da lista de jogos,
 * para a compra se ver sem API. Os lugares que restam são inventados, um caso
 * de cada: poucos, muitos, sem limite e esgotado.
 *
 * `socio` dá a venda que a API devolve a um sócio identificado: os preços do
 * público e os dele (os de qualquer sócio e os da categoria `tierId`).
 */
export function vendaDeDemonstracao(
  jogo: Jogo,
  recinto: Recinto | null,
  categorias: Record<string, string>,
  socio?: { tierId: string | null },
): Venda {
  const t = jogo.tickets!;
  const nomeDaBancada = (id?: string) => recinto?.bancadas.find((b) => b.id === id)?.nome ?? null;
  const tipos: TipoDaVenda[] = t.types
    .filter((x) => !x.forMembers || !socio || !x.tierId || x.tierId === socio.tierId)
    .map((x) => ({
      id: x.id,
      nome: x.name,
      preco: x.price,
      bancadaId: x.bancadaId ?? null,
      bancada: nomeDaBancada(x.bancadaId),
      para: x.forMembers ? "socios" : "publico",
      tierId: x.tierId ?? null,
      tierNome: x.tierId ? (categorias[x.tierId] ?? null) : null,
    }));
  const exemplo = [8, 140, null, 0];
  const livres: Record<string, number | null> = {};
  recinto?.bancadas.forEach((b, i) => {
    livres[b.id] = exemplo[i % exemplo.length];
  });
  return {
    jogo: { id: jogo.id, startsAt: jogo.startsAt, opponent: jogo.opponent, teamName: jogo.teamName, status: jogo.status },
    estado: {
      socios: t.membersOpen ?? true,
      publico: t.publicOpen ?? !t.membersOnly,
      fechada: !t.open,
      abreSociosEm: t.membersOpen === false ? (t.membersFrom ?? null) : null,
      abrePublicoEm: t.publicOpen === false && !t.membersOnly ? (t.publicFrom ?? null) : null,
      soSocios: !!t.membersOnly,
    },
    nota: t.note ?? null,
    recinto,
    tipos,
    livres,
    livresNoJogo: null,
    reservaMinutos: 10,
  };
}

/**
 * Uma compra paga de exemplo, para a página do bilhete em demonstração quando
 * não há compra fingida guardada (outro separador, ou o endereço aberto à
 * mão): dois bilhetes do primeiro jogo com bilhetes.
 */
export function pedidoDeExemplo(jogo: Jogo | undefined, recinto: Recinto | null): Pedido {
  const tipos = (jogo?.tickets?.types ?? []).filter((t) => !t.forMembers).slice(0, 2);
  const nomeDaBancada = (id?: string) => recinto?.bancadas.find((b) => b.id === id)?.nome ?? null;
  const porta = (id?: string) => {
    const i = recinto?.bancadas.findIndex((b) => b.id === id) ?? -1;
    return i >= 0 ? `Porta ${i + 1}` : null;
  };
  return {
    estado: "pago",
    comprador: "Comprador de exemplo",
    reservadoAte: new Date().toISOString(),
    totalCents: Math.round(tipos.reduce((s, t) => s + t.price, 0) * 100),
    pagamento: null,
    reembolso: null,
    jogo: jogo ? { startsAt: jogo.startsAt, opponent: jogo.opponent, teamName: jogo.teamName, local: recinto?.nome ?? jogo.venue } : null,
    bilhetes: tipos.map((t, i) => ({
      id: `exemplo-${i}`,
      tipo: t.name,
      bancada: nomeDaBancada(t.bancadaId),
      porta: porta(t.bancadaId),
      usado: false,
      codigo: `T.exemplo-${i}.demonstracao`,
    })),
  };
}

/** Onde a demonstração guarda a compra fingida, para a página do bilhete a mostrar. */
export const CHAVE_DEMO = (token: string) => `bilhete-demo:${token}`;

/** O que a demonstração guarda: o pedido e o momento em que "foi pago". */
export type PedidoDeDemonstracao = { pedido: Pedido; pagoEm: number };

import { useSyncExternalStore } from "react";
import { apiGet, apiPost } from "@/lib/http";

/**
 * A bilheteira na área de sócio: tipos e chamadas.
 *
 * As regras vivem no servidor (`apps/api/src/bilheteira/regras.ts`) e estão
 * escritas em `docs/09-bilheteira.md`. A app desenha o que a venda diz e manda
 * o pedido; quem aceita ou recusa é a API, com a frase de recusa para mostrar.
 */

/** Uma bancada do recinto, como a venda a manda. */
export type Bancada = { id: string; nome: string; lotacao?: number | null };

export type TipoDeBilhete = {
  id: string;
  nome: string;
  /** Em euros, como na API. */
  preco: number;
  bancadaId: string | null;
  bancada: string | null;
  para: "publico" | "socios";
  tierId: string | null;
  tierNome: string | null;
};

export type EstadoDaVenda = {
  /** Os sócios podem comprar agora. */
  socios: boolean;
  /** O público geral (os acompanhantes) pode comprar agora. */
  publico: boolean;
  fechada: boolean;
  abreSociosEm: string | null;
  abrePublicoEm: string | null;
  soSocios: boolean;
};

/** `GET /api/socio/bilhetes/venda/:matchId`. Os tipos de sócio só vêm com a quota a cobrir o jogo. */
export type VendaDoSocio = {
  jogo: { id: string; startsAt: string; opponent: string; teamName: string; status: string };
  estado: EstadoDaVenda;
  nota: string | null;
  recinto: { id: string; nome: string; tipo: string; bancadas: Bancada[] } | null;
  tipos: TipoDeBilhete[];
  /** Por bancada; nulo = a bancada não tem limite próprio. */
  livres: Record<string, number | null>;
  livresNoJogo: number | null;
  reservaMinutos: number;
  quotaEmDia: boolean;
  jaTemBilheteDeSocio: boolean;
};

export type Metodo = "MBWAY" | "MULTIBANCO";

/** A resposta a `POST /api/socio/bilhetes/:matchId`. */
export type Compra = {
  token: string;
  /** "pago" só numa compra de 0 €. */
  estado: "a-pagar" | "pago";
  /** Com a taxa, quando o clube a passa a quem paga. */
  totalCents: number;
  reservadoAte: string;
  pagamento: { metodo: Metodo; entidade: string | null; referencia: string | null; valorCents: number } | null;
};

export type BilheteEmitido = {
  id: string;
  tipo: string;
  bancada: string | null;
  porta: string | null;
  usado: boolean;
  /** O que o QR leva: `T.<id>.<assinatura>`. */
  codigo: string;
};

/** Uma compra do sócio, como `GET /api/socio/bilhetes` a devolve. */
export type Pedido = {
  token: string;
  estado: "a-pagar" | "pago" | "expirado" | "fora-do-prazo" | "anulado";
  comprador: string;
  reservadoAte: string;
  totalCents: number;
  /** Só em "a-pagar". */
  pagamento: { metodo: string; entidade: string | null; referencia: string | null; valorCents: number; estado: string } | null;
  reembolso: { valorCents: number; feito: boolean } | null;
  jogo: { startsAt: string; opponent: string; teamName: string; local: string } | null;
  /** Só em "pago". */
  bilhetes: BilheteEmitido[];
};

export type LugarAnual = {
  id: string;
  epoca: string;
  recinto: string | null;
  bancada: string | null;
  porta: string | null;
  lugar: string | null;
  /** Em atraso, o leitor da porta recusa o código. */
  quotaEmDia: boolean;
  /** O que o QR leva: `S.<id>.<assinatura>`. */
  codigo: string;
};

/** O máximo de bilhetes numa compra (`MAXIMO_POR_COMPRA` no servidor). */
export const MAXIMO_POR_COMPRA = 10;

export const vendaDoJogo = (matchId: string) =>
  apiGet<VendaDoSocio>(`/api/socio/bilhetes/venda/${encodeURIComponent(matchId)}`);

export const comprarBilhetes = (
  matchId: string,
  linhas: { typeId: string; quantidade: number }[],
  metodo: Metodo,
  telefone?: string,
) =>
  apiPost<Compra>(`/api/socio/bilhetes/${encodeURIComponent(matchId)}`, {
    linhas,
    metodo,
    ...(telefone ? { telefone } : {}),
  });

/* -------------------------------------------------------------------------- */
/* Os bilhetes e o lugar anual do sócio                                         */
/* -------------------------------------------------------------------------- */

/*
 * Um store pequeno, como o de `lib/socio.ts`: o Início lê-o, a compra
 * actualiza-o quando pergunta pelo estado, e o bloco "Os teus bilhetes" aparece
 * sem esperar pela releitura seguinte.
 *
 * Uma falha aqui não estraga o Início: fica o que havia. Um clube sem
 * bilheteira devolve listas vazias e as secções não aparecem.
 */
type Estado = { pedidos: Pedido[]; lugares: LugarAnual[] };

let estado: Estado = { pedidos: [], lugares: [] };
const ouvintes = new Set<() => void>();
const avisar = () => ouvintes.forEach((l) => l());
const subscrever = (l: () => void) => {
  ouvintes.add(l);
  return () => ouvintes.delete(l);
};
const fotografia = () => estado;

export function useBilhetes(): Estado {
  return useSyncExternalStore(subscrever, fotografia, fotografia);
}

/** As compras do sócio para jogos que não passaram. Actualiza o store e devolve a lista. */
export async function carregarPedidos(): Promise<Pedido[]> {
  const pedidos = (await apiGet<Pedido[]>("/api/socio/bilhetes")) ?? [];
  estado = { ...estado, pedidos };
  avisar();
  return pedidos;
}

export async function carregarLugarAnual(): Promise<void> {
  const r = await apiGet<{ lugares: LugarAnual[] }>("/api/socio/bilhetes/lugar-anual");
  estado = { ...estado, lugares: r?.lugares ?? [] };
  avisar();
}

/** As duas leituras do Início, cada uma por si: uma que falhe não apaga a outra. */
export async function carregarBilhetes(): Promise<void> {
  await Promise.allSettled([carregarPedidos(), carregarLugarAnual()]);
}

/** Sai daqui quando se troca de contexto: o próximo sócio não vê os bilhetes do anterior. */
export function limparBilhetes(): void {
  estado = { pedidos: [], lugares: [] };
  avisar();
}

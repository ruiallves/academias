import type { Prisma } from "@prisma/client";
import type { ScopedClient } from "../prisma/prisma.service";
import { stockValido, tamanhosDoProduto } from "../site/site.tipos";
import type { ProdutoParaVenda } from "./regras";

/**
 * As perguntas à base que a compra, o webhook e a loja pública fazem todas:
 * o que há de cada produto e tamanho, já com o que outras encomendas têm
 * guardado descontado. Recebem o `db` de quem chama, para correrem dentro da
 * mesma transação que vai escrever (e, na compra e no webhook, com a loja do
 * clube bloqueada: ver `bloquearLoja`).
 */

/**
 * Bloqueia a loja deste clube até ao fim da transação.
 *
 * Duas encomendas ao mesmo tempo liam "há 1 camisola M" antes de a primeira
 * gravar e vendiam duas. Com a loja bloqueada, a segunda espera pela primeira
 * e conta o stock já com a dela. É também o que dá o número seguido das
 * encomendas. Um bloqueio consultivo por clube, e não as linhas dos produtos:
 * o número da encomenda precisa dele na mesma, e uma loja bloqueia-se a si
 * só durante a reserva (milissegundos); o pedido à euPago acontece depois.
 */
export async function bloquearLoja(db: ScopedClient, academyId: string): Promise<void> {
  await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${"loja:" + academyId}))`;
}

/**
 * O que está guardado por encomendas à espera de pagamento (dentro do prazo),
 * por produto e tamanho. `semEncomenda` deixa de fora uma encomenda (a que
 * está a ser confirmada).
 */
export async function reservadosPorLinha(db: ScopedClient, productIds: string[], agora: Date, semEncomenda?: string): Promise<Map<string, number>> {
  if (productIds.length === 0) return new Map();
  const rows = await db.$queryRaw<{ productId: string; size: string; n: number }[]>`
    SELECT i."productId" AS "productId", i.size AS size, SUM(i.quantity)::int AS n
      FROM "SiteOrderItem" i
      JOIN "SiteOrder" o ON o.id = i."orderId"
     WHERE i."productId" IN (${productIds})
       AND o.status = 'RESERVED'
       AND o."reservedUntil" > ${agora}
       AND o.id <> ${semEncomenda ?? ""}
     GROUP BY i."productId", i.size
  `;
  return new Map(rows.map((r) => [`${r.productId}\u0000${r.size}`, Number(r.n)]));
}

/** O que a loja pública e a compra precisam de cada produto. */
export const SELECT_PRODUTO_PARA_VENDA = {
  id: true,
  name: true,
  priceCents: true,
  imageUrl: true,
  visible: true,
  sizes: true,
  soldOut: true,
  stock: true,
  inventoryItem: {
    select: {
      archivedAt: true,
      variants: {
        where: { archivedAt: null },
        orderBy: [{ order: "asc" }, { label: "asc" }],
        select: { id: true, label: true, totalQuantity: true, assignedQuantity: true },
      },
    },
  },
} satisfies Prisma.SiteProductSelect;

export type ProdutoLido = {
  id: string;
  name: string;
  priceCents: number;
  imageUrl: string | null;
  visible: boolean;
  sizes: string;
  soldOut: boolean;
  stock: unknown;
  inventoryItem?: { archivedAt: Date | null; variants: { id: string; label: string; totalQuantity: number; assignedQuantity: number }[] } | null;
};

/**
 * Um produto como a venda o vê, com o stock de agora menos o que está
 * guardado. Com um artigo do Inventário por trás, os tamanhos são as
 * variantes (uma variante só = sem escolha de tamanho) e o stock é o
 * disponível de cada uma; sem artigo, vale o que o clube escreveu no produto.
 */
export function produtoParaVenda(p: ProdutoLido, reservados: Map<string, number>): ProdutoParaVenda {
  const menosReservados = (tamanho: string, n: number | null) => (n === null ? null : Math.max(0, n - (reservados.get(`${p.id}\u0000${tamanho}`) ?? 0)));
  const disponivel: Record<string, number | null> = {};
  const variantId: Record<string, string> = {};
  let tamanhos: string[];

  if (p.inventoryItem) {
    const arquivado = !!p.inventoryItem.archivedAt;
    const vs = p.inventoryItem.variants;
    if (vs.length > 1) {
      tamanhos = vs.map((v) => v.label);
      for (const v of vs) {
        disponivel[v.label] = menosReservados(v.label, arquivado ? 0 : Math.max(0, v.totalQuantity - v.assignedQuantity));
        variantId[v.label] = v.id;
      }
    } else {
      tamanhos = [];
      const v = vs[0];
      disponivel[""] = menosReservados("", !v || arquivado ? 0 : Math.max(0, v.totalQuantity - v.assignedQuantity));
      if (v) variantId[""] = v.id;
    }
    return { id: p.id, nome: p.name, precoCents: p.priceCents, imageUrl: p.imageUrl, visivel: p.visible && !arquivado, tamanhos, disponivel, variantId };
  }

  const stock = stockValido(p.stock);
  tamanhos = tamanhosDoProduto(p.sizes);
  const chaves = tamanhos.length ? tamanhos : [""];
  for (const t of chaves) {
    const contado = t in stock ? stock[t] : null;
    disponivel[t] = p.soldOut ? 0 : menosReservados(t, contado);
  }
  return { id: p.id, nome: p.name, precoCents: p.priceCents, imageUrl: p.imageUrl, visivel: p.visible, tamanhos, disponivel, variantId };
}

/** Os produtos destes ids como a venda os vê, já com o guardado descontado. */
export async function produtosParaVenda(db: ScopedClient, productIds: string[], agora: Date, semEncomenda?: string): Promise<ProdutoParaVenda[]> {
  const ids = [...new Set(productIds)].slice(0, 60);
  if (ids.length === 0) return [];
  const [produtos, reservados] = await Promise.all([
    db.siteProduct.findMany({ where: { id: { in: ids } }, select: SELECT_PRODUTO_PARA_VENDA }),
    reservadosPorLinha(db, ids, agora, semEncomenda),
  ]);
  return produtos.map((p) => produtoParaVenda(p, reservados));
}

/** Uma encomenda ainda tem stock para todas as linhas dela? (Para um pagamento que chega depois do prazo.) */
export async function aindaHaStock(db: ScopedClient, encomenda: { id: string; items: { productId: string | null; size: string; quantity: number }[] }, agora: Date): Promise<boolean> {
  const ids = encomenda.items.flatMap((i) => (i.productId ? [i.productId] : []));
  if (ids.length !== encomenda.items.length) return false;
  const produtos = new Map((await produtosParaVenda(db, ids, agora, encomenda.id)).map((p) => [p.id, p]));
  const precisa = new Map<string, number>();
  for (const i of encomenda.items) precisa.set(`${i.productId}\u0000${i.size}`, (precisa.get(`${i.productId}\u0000${i.size}`) ?? 0) + i.quantity);
  for (const [chave, n] of precisa) {
    const [productId, size] = chave.split("\u0000");
    const p = produtos.get(productId);
    if (!p || !p.visivel) return false;
    const livre = p.disponivel[size];
    if (livre === undefined) return false;
    if (livre !== null && livre < n) return false;
  }
  return true;
}

import type { Loja } from "../site/site.tipos";

/**
 * As regras da loja do site, sem base de dados.
 *
 * Como na bilheteira (`src/bilheteira/regras.ts`): o que decide o que se
 * vende, por quanto, quanto custa o envio e o que acontece quando o dinheiro
 * chega vive aqui como funções puras. Os serviços leem a base, chamam isto, e
 * escrevem o que isto disser; `npm run test:loja` prova as regras sem
 * servidor nem base.
 *
 * As decisões (24/10/2026, em `docs/10-loja.md`):
 *   - os artigos ficam guardados 10 minutos à espera do pagamento, como os
 *     lugares dos bilhetes; o stock só desce quando a encomenda é paga;
 *   - pago depois dos 10 minutos: se ainda houver stock, a encomenda segue
 *     (ao contrário dos bilhetes, uma camisola não é um lugar que outro
 *     levou); se não houver, fica sem artigos e com o reembolso por fazer;
 *   - no máximo 10 unidades por linha e 20 por encomenda;
 *   - a entrega é levantamento no clube ou envio pelo correio, com o preço
 *     que o clube escreveu e grátis a partir de um valor, se quiser;
 *   - os preços não dependem de quem compra: não há preço de sócio na loja.
 */

/** Quanto tempo os artigos ficam guardados à espera do pagamento. */
export const RESERVA_MINUTOS = 10;
/** Unidades do mesmo produto e tamanho numa encomenda. */
export const MAXIMO_POR_LINHA = 10;
/** Unidades numa encomenda, todas as linhas somadas. */
export const MAXIMO_POR_ENCOMENDA = 20;
/** Linhas (produto × tamanho) numa encomenda. */
export const MAXIMO_DE_LINHAS = 12;

/* -------------------------------------------------------------------------- */
/* O carrinho                                                                   */
/* -------------------------------------------------------------------------- */

export type LinhaDoCarrinho = { productId: string; tamanho: string; quantidade: number };

/**
 * Um produto como a venda o vê: o que está à venda, os tamanhos, e quanto há
 * de cada um. `disponivel` é por tamanho (`""` num produto sem tamanhos);
 * `null` = sem contagem. Já com os artigos guardados por outras encomendas
 * descontados (ver `contexto.ts`).
 */
export type ProdutoParaVenda = {
  id: string;
  nome: string;
  precoCents: number;
  imageUrl: string | null;
  visivel: boolean;
  /** Os tamanhos à venda; vazio num produto sem tamanhos. */
  tamanhos: string[];
  disponivel: Record<string, number | null>;
  /** A variante do Inventário de cada tamanho, quando o produto vem de lá. */
  variantId: Record<string, string>;
};

export type LinhaAceite = {
  productId: string;
  productName: string;
  size: string;
  quantity: number;
  unitPriceCents: number;
  imageUrl: string | null;
  variantId: string | null;
};

export type CarrinhoAceite = { ok: true; linhas: LinhaAceite[]; itemsCents: number };
export type CarrinhoRecusado = { ok: false; erro: string };

/** Junta linhas do mesmo produto e tamanho, e deita fora as a zero. */
export function juntarLinhas(linhas: LinhaDoCarrinho[]): LinhaDoCarrinho[] {
  const porChave = new Map<string, LinhaDoCarrinho>();
  for (const l of linhas) {
    if (!Number.isInteger(l.quantidade) || l.quantidade <= 0) continue;
    const tamanho = (l.tamanho ?? "").trim();
    const chave = `${l.productId}\u0000${tamanho}`;
    const x = porChave.get(chave);
    if (x) x.quantidade += l.quantidade;
    else porChave.set(chave, { productId: l.productId, tamanho, quantidade: l.quantidade });
  }
  return [...porChave.values()];
}

/**
 * O carrinho contra o que está à venda. Devolve as linhas com o nome e o
 * preço de agora (é isto que se grava), ou a primeira razão para recusar,
 * dita para quem compra.
 */
export function verificarCarrinho(input: { linhas: LinhaDoCarrinho[]; produtos: ProdutoParaVenda[] }): CarrinhoAceite | CarrinhoRecusado {
  const linhas = juntarLinhas(input.linhas);
  if (linhas.length === 0) return { ok: false, erro: "O carrinho está vazio." };
  if (linhas.length > MAXIMO_DE_LINHAS) return { ok: false, erro: `No máximo ${MAXIMO_DE_LINHAS} artigos diferentes por encomenda.` };
  const total = linhas.reduce((n, l) => n + l.quantidade, 0);
  if (total > MAXIMO_POR_ENCOMENDA) return { ok: false, erro: `No máximo ${MAXIMO_POR_ENCOMENDA} unidades por encomenda.` };

  const produtos = new Map(input.produtos.map((p) => [p.id, p]));
  const aceites: LinhaAceite[] = [];
  for (const l of linhas) {
    const p = produtos.get(l.productId);
    if (!p || !p.visivel) return { ok: false, erro: "Um dos artigos já não está à venda. Tira-o do carrinho." };
    if (l.quantidade > MAXIMO_POR_LINHA) return { ok: false, erro: `No máximo ${MAXIMO_POR_LINHA} unidades de «${p.nome}».` };
    if (p.tamanhos.length > 0) {
      if (!l.tamanho) return { ok: false, erro: `Escolhe o tamanho de «${p.nome}».` };
      if (!p.tamanhos.includes(l.tamanho)) return { ok: false, erro: `«${p.nome}» já não tem o tamanho ${l.tamanho}.` };
    } else if (l.tamanho) {
      return { ok: false, erro: `«${p.nome}» não tem tamanhos. Tira-o do carrinho e junta-o outra vez.` };
    }
    const livre = p.disponivel[l.tamanho];
    if (livre !== null && livre !== undefined && livre < l.quantidade) {
      const nome = l.tamanho ? `«${p.nome}» (${l.tamanho})` : `«${p.nome}»`;
      return {
        ok: false,
        erro: livre <= 0 ? `${nome} esgotou.` : livre === 1 ? `Só há 1 unidade de ${nome}.` : `Só há ${livre} unidades de ${nome}.`,
      };
    }
    aceites.push({
      productId: p.id,
      productName: p.nome,
      size: l.tamanho,
      quantity: l.quantidade,
      unitPriceCents: p.precoCents,
      imageUrl: p.imageUrl,
      variantId: p.variantId[l.tamanho] ?? null,
    });
  }
  return { ok: true, linhas: aceites, itemsCents: aceites.reduce((n, l) => n + l.quantity * l.unitPriceCents, 0) };
}

/* -------------------------------------------------------------------------- */
/* A entrega                                                                    */
/* -------------------------------------------------------------------------- */

export type Entrega = "PICKUP" | "SHIPPING";

export type Morada = { nome: string; linha1: string; linha2: string; codigoPostal: string; localidade: string };

/** O clube vende online? Precisa de pagamentos ligados e de uma forma de entregar. */
export function lojaVende(loja: Loja, pagamentosLigados: boolean): boolean {
  return pagamentosLigados && (loja.levantamento.ativo || loja.envio.ativo);
}

/** O que o envio custa para este carrinho. Zero no levantamento, e a partir do valor em que o clube o oferece. */
export function custoDeEnvio(loja: Loja, entrega: Entrega, itemsCents: number): number {
  if (entrega !== "SHIPPING") return 0;
  if (loja.envio.gratisAPartirDeCents !== null && itemsCents >= loja.envio.gratisAPartirDeCents) return 0;
  return loja.envio.precoCents;
}

/** A forma de entrega pedida é uma que o clube tem ligada? */
export function entregaPossivel(loja: Loja, entrega: Entrega): string | null {
  if (entrega === "PICKUP" && !loja.levantamento.ativo) return "Este clube não tem levantamento. Escolhe o envio.";
  if (entrega === "SHIPPING" && !loja.envio.ativo) return "Este clube não envia pelo correio. Escolhe o levantamento.";
  return null;
}

/** A morada de envio, limpa. Nula quando falta o essencial. */
export function moradaValida(v: unknown): Morada | null {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const t = (x: unknown, max: number) => (typeof x === "string" ? x.trim().slice(0, max) : "");
  const m: Morada = { nome: t(o.nome, 120), linha1: t(o.linha1, 160), linha2: t(o.linha2, 160), codigoPostal: t(o.codigoPostal, 20), localidade: t(o.localidade, 80) };
  if (!m.linha1 || !m.codigoPostal || !m.localidade) return null;
  return m;
}

/* -------------------------------------------------------------------------- */
/* O pagamento                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * O que fazer quando o dinheiro de uma encomenda chega.
 *
 * Dentro dos 10 minutos: confirma-se e o stock desce. Depois deles: se ainda
 * houver stock para tudo, confirma-se na mesma (a pessoa pagou, o clube tem
 * o artigo, não há razão para devolver); se não houver, a encomenda fica sem
 * artigos e com o reembolso por fazer. Uma encomenda já paga, anulada ou
 * fora do prazo não se trata duas vezes: um segundo pagamento devolve-se.
 */
export function destinoDoPagamento(input: { status: string; reservedUntil: Date; pagoEm: Date; aindaHaStock: boolean }): "confirmar" | "reembolso" | "ja-tratado" {
  if (input.status === "RESERVED") return "confirmar";
  if (input.status === "EXPIRED") return input.aindaHaStock ? "confirmar" : "reembolso";
  return "ja-tratado";
}

/** Os estados em que a encomenda ainda está viva para o clube (há algo para fazer ou entregar). */
export const ESTADOS_VIVOS = ["PAID", "READY", "SHIPPED"] as const;

/** Os estados que contam para o stock guardado: só a reserva dentro do prazo. */
export function estaGuardada(o: { status: string; reservedUntil: Date }, agora: Date): boolean {
  return o.status === "RESERVED" && o.reservedUntil > agora;
}

/** O número da próxima encomenda do clube. Seguido, a partir de 1. */
export function proximoNumero(maior: number | null): number {
  return (maior ?? 0) + 1;
}

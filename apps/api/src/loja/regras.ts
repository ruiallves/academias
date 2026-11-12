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
  /** A categoria da loja, para os códigos só de algumas categorias. */
  categoryId?: string | null;
  /** Tem preço riscado (promoção): os códigos que não juntam com promoções saltam-no. */
  emPromocao?: boolean;
};

export type LinhaAceite = {
  productId: string;
  productName: string;
  size: string;
  quantity: number;
  unitPriceCents: number;
  imageUrl: string | null;
  variantId: string | null;
  categoryId: string | null;
  emPromocao: boolean;
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
      categoryId: p.categoryId ?? null,
      emPromocao: p.emPromocao === true,
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

/* -------------------------------------------------------------------------- */
/* Endereços (slugs)                                                            */
/* -------------------------------------------------------------------------- */

/**
 * O endereço de um nome: minúsculas, sem acentos, só letras, algarismos e
 * hífenes ("Camisola Principal 2026/27" → "camisola-principal-2026-27").
 * Vazio quando não sobra nada. A migração de 11/11/2026 fez o mesmo em SQL.
 */
export function slugDoTexto(texto: string, max = 80): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
}

/** O primeiro endereço livre a partir de `base`: `base`, `base-2`, `base-3`… */
export function slugLivre(base: string, ocupados: Set<string>): string {
  const limpo = slugDoTexto(base) || "artigo";
  if (!ocupados.has(limpo)) return limpo;
  for (let i = 2; i < 1000; i++) {
    const s = `${limpo.slice(0, 75)}-${i}`;
    if (!ocupados.has(s)) return s;
  }
  return `${limpo.slice(0, 70)}-${Date.now().toString(36)}`;
}

/* -------------------------------------------------------------------------- */
/* Códigos promocionais                                                         */
/* -------------------------------------------------------------------------- */

/** O código como se guarda e compara: maiúsculas, sem espaços nem acentos. */
export function codigoNormalizado(v: string): string {
  return v
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, "")
    .slice(0, 30);
}

export type CodigoPromocional = {
  id: string;
  code: string;
  kind: "PERCENT" | "FIXED";
  /** PERCENT: 1 a 100. FIXED: cêntimos. */
  value: number;
  freeShipping: boolean;
  minOrderCents: number | null;
  startsAt: Date | null;
  endsAt: Date | null;
  maxUses: number | null;
  oncePerCustomer: boolean;
  categoryIds: string[];
  excludeOnSale: boolean;
  active: boolean;
};

export type DescontoAceite = {
  ok: true;
  codigoId: string;
  codigo: string;
  /** O desconto dos artigos, em cêntimos (pode ser 0 num código só de envio grátis). */
  descontoCents: number;
  /** A parte do desconto de cada linha, pela ordem das linhas. */
  porLinha: number[];
  envioGratis: boolean;
};
export type DescontoRecusado = { ok: false; erro: string };

const dataCurta = (d: Date) => new Intl.DateTimeFormat("pt-PT", { day: "numeric", month: "long", timeZone: "Europe/Lisbon" }).format(d);
const euros = (c: number) => new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(c / 100);

/**
 * Um código contra um carrinho já aceite.
 *
 * As regras (11/11/2026): ligado; dentro das datas; os artigos somam o
 * mínimo; ainda há usos (`usos` conta as encomendas pagas e as guardadas
 * dentro do prazo); uma vez por pessoa quando o clube o pediu (`usosDaPessoa`,
 * pela caixa de correio); e há pelo menos um artigo a que se aplica (as
 * categorias do código, sem os em promoção se o código não junta com elas).
 *
 * A percentagem conta-se sobre os artigos a que se aplica e arredonda ao
 * cêntimo; o valor fixo nunca passa desses artigos. O desconto reparte-se
 * pelas linhas (`repartirDesconto`), que é o que a fatura usa.
 */
export function avaliarCodigo(input: {
  codigo: CodigoPromocional | null;
  linhas: Pick<LinhaAceite, "quantity" | "unitPriceCents" | "categoryId" | "emPromocao">[];
  itemsCents: number;
  agora: Date;
  usos: number;
  usosDaPessoa: number;
}): DescontoAceite | DescontoRecusado {
  const c = input.codigo;
  if (!c || !c.active) return { ok: false, erro: "Este código não existe ou já não está ativo." };
  if (c.startsAt && input.agora < c.startsAt) return { ok: false, erro: `Este código só vale a partir de ${dataCurta(c.startsAt)}.` };
  if (c.endsAt && input.agora > c.endsAt) return { ok: false, erro: "Este código já expirou." };
  if (c.maxUses !== null && input.usos >= c.maxUses) return { ok: false, erro: "Este código já foi usado as vezes todas." };
  if (c.oncePerCustomer && input.usosDaPessoa > 0) return { ok: false, erro: "Já usaste este código numa encomenda." };
  if (c.minOrderCents !== null && input.itemsCents < c.minOrderCents) {
    return { ok: false, erro: `Este código vale em compras a partir de ${euros(c.minOrderCents)}.` };
  }

  const aplica = input.linhas.map((l) => (c.categoryIds.length === 0 || (l.categoryId !== null && c.categoryIds.includes(l.categoryId))) && !(c.excludeOnSale && l.emPromocao));
  const valores = input.linhas.map((l, i) => (aplica[i] ? l.quantity * l.unitPriceCents : 0));
  const base = valores.reduce((n, v) => n + v, 0);
  const temDesconto = c.value > 0;
  if (temDesconto && base === 0) {
    return {
      ok: false,
      erro: c.excludeOnSale && c.categoryIds.length === 0 ? "Este código não se junta a artigos em promoção." : "Este código não vale para os artigos do carrinho.",
    };
  }

  const pct = Math.max(0, Math.min(100, c.value));
  const desconto = !temDesconto ? 0 : c.kind === "PERCENT" ? Math.round((base * pct) / 100) : Math.min(c.value, base);
  return { ok: true, codigoId: c.id, codigo: c.code, descontoCents: desconto, porLinha: repartirDesconto(valores, desconto), envioGratis: c.freeShipping };
}

/**
 * Reparte um desconto pelas linhas, na proporção do que cada uma vale, sem
 * perder cêntimos: arredonda para baixo e dá os que sobram às linhas com a
 * maior parte decimal. Nenhuma linha leva mais do que vale.
 */
export function repartirDesconto(valores: number[], desconto: number): number[] {
  const total = valores.reduce((n, v) => n + v, 0);
  if (desconto <= 0 || total <= 0) return valores.map(() => 0);
  const d = Math.min(desconto, total);
  const exatos = valores.map((v) => (v * d) / total);
  const partes = exatos.map(Math.floor);
  let falta = d - partes.reduce((n, v) => n + v, 0);
  const ordem = exatos.map((x, i) => ({ i, resto: x - Math.floor(x) })).sort((a, b) => b.resto - a.resto || a.i - b.i);
  for (const { i } of ordem) {
    if (falta <= 0) break;
    if (partes[i] < valores[i]) {
      partes[i]++;
      falta--;
    }
  }
  return partes;
}

/**
 * Uma linha com desconto em linhas de fatura de preço inteiro. A fatura só
 * aceita preço × quantidade, e 3 × 9,90 € com 2,97 € de desconto não dá um
 * preço unitário certo: parte-se em duas linhas (o mesmo artigo, uma com mais
 * um cêntimo), para a soma bater ao cêntimo com o que se pagou.
 */
export function linhaComDescontoParaFatura(quantidade: number, unitarioCents: number, descontoCents: number): { quantidade: number; unitarioCents: number }[] {
  if (descontoCents <= 0 || quantidade <= 0) return [{ quantidade, unitarioCents }];
  const total = Math.max(0, quantidade * unitarioCents - descontoCents);
  const unit = Math.floor(total / quantidade);
  const resto = total - unit * quantidade;
  const linhas: { quantidade: number; unitarioCents: number }[] = [];
  if (resto > 0) linhas.push({ quantidade: resto, unitarioCents: unit + 1 });
  if (quantidade - resto > 0) linhas.push({ quantidade: quantidade - resto, unitarioCents: unit });
  return linhas;
}

/** O código descrito numa linha, para a consola: "10 % · mín. 30 € · até 31 de dezembro". */
export function resumoDoCodigo(c: Pick<CodigoPromocional, "kind" | "value" | "freeShipping" | "minOrderCents" | "endsAt">): string {
  const partes: string[] = [];
  if (c.value > 0) partes.push(c.kind === "PERCENT" ? `${c.value} %` : euros(c.value));
  if (c.freeShipping) partes.push("envio grátis");
  if (c.minOrderCents) partes.push(`mín. ${euros(c.minOrderCents)}`);
  if (c.endsAt) partes.push(`até ${dataCurta(c.endsAt)}`);
  return partes.join(" · ");
}

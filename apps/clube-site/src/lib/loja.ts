/**
 * A loja do lado do site: as formas que a API devolve (`docs/10-loja.md`), o
 * carrinho guardado no browser, e as frases partilhadas pela montra, pelo
 * produto, pelo carrinho e pela página da encomenda.
 *
 * Sem nada do servidor: os componentes correm no browser e importam daqui.
 */

import type { Produto } from "@/dados/tipos";

/* -------------------------------------------------------------------------- */
/* O que a API devolve                                                          */
/* -------------------------------------------------------------------------- */

export type Metodo = "MBWAY" | "MULTIBANCO";
export type Entrega = "PICKUP" | "SHIPPING";

export type Morada = { nome: string; linha1: string; linha2: string; codigoPostal: string; localidade: string };

/** `POST /api/clubes/:slug/loja/carrinho`: o carrinho contra o stock de agora. */
export type CarrinhoVerificado = {
  vende: boolean;
  entrega: {
    levantamento: { ativo: boolean; local: string; nota: string };
    envio: { ativo: boolean; preco: number; gratisAPartirDe: number | null; nota: string };
    aviso: string;
  };
  ok: boolean;
  erro: string | null;
  itemsCents: number | null;
  /** O custo do envio para este carrinho, em cêntimos. Nulo sem envio. */
  envio: number | null;
  linhas: {
    productId: string;
    tamanho: string;
    quantidade: number;
    nome: string | null;
    precoCents: number | null;
    imageUrl: string | null;
    /** O que há deste tamanho (nulo = sem contagem). Zero: tirar do carrinho ou baixar. */
    disponivel: number | null;
    aVenda: boolean;
  }[];
};

/** `POST /api/clubes/:slug/loja/encomendas`. */
export type RespostaDaEncomenda = {
  token: string;
  numero: number;
  estado: "a-pagar" | "paga";
  totalCents: number;
  reservadoAte: string;
  pagamento: { metodo: Metodo; entidade: string | null; referencia: string | null; valorCents: number } | null;
};

export type EstadoDaEncomenda = "a-pagar" | "paga" | "pronta" | "enviada" | "entregue" | "expirada" | "fora-do-prazo" | "anulada";

/** `GET /api/clubes/:slug/loja/encomendas/:token`. */
export type Encomenda = {
  numero: number;
  estado: EstadoDaEncomenda;
  comprador: string;
  email: string;
  reservadoAte: string;
  itemsCents: number;
  envioCents: number;
  totalCents: number;
  pagamento: { metodo: Metodo; entidade: string | null; referencia: string | null; valorCents: number; estado: string } | null;
  reembolso: { valorCents: number; feito: boolean } | null;
  entrega: { tipo: "PICKUP"; local: string; nota: string } | { tipo: "SHIPPING"; morada: string[]; nota: string; rastreio: string | null };
  nota: string | null;
  linhas: { nome: string; tamanho: string; quantidade: number; unitPriceCents: number; imageUrl: string | null }[];
  datas: { paga: string | null; pronta: string | null; enviada: string | null; entregue: string | null };
};

/** Os máximos da API. */
export const MAXIMO_POR_LINHA = 10;
export const MAXIMO_POR_ENCOMENDA = 20;
/** Abaixo disto, o produto diz quantos restam. */
export const POUCAS_UNIDADES = 5;

/* -------------------------------------------------------------------------- */
/* O carrinho, no browser                                                       */
/* -------------------------------------------------------------------------- */

/** Uma linha do carrinho: o produto fotografado quando se juntou, para a lista desenhar sem ir à API. */
export type LinhaDoCarrinho = {
  productId: string;
  tamanho: string;
  quantidade: number;
  nome: string;
  /** Em euros, o preço de quando se juntou. O que conta é o do servidor, no carrinho e na compra. */
  preco: number;
  image?: string;
};

export type Carrinho = { linhas: LinhaDoCarrinho[] };

const CHAVE = (slug: string) => `loja-carrinho:${slug}`;
/** O carrinho vazio. Também o que o servidor desenha (não conhece o carrinho). */
export const VAZIO: Carrinho = { linhas: [] };
const ouvintes = new Set<() => void>();
const cache = new Map<string, Carrinho>();

/** O carrinho guardado deste clube. Só no browser; o hook vive em `lib/carrinho.ts`. */
export function ler(slug: string): Carrinho {
  const emCache = cache.get(slug);
  if (emCache) return emCache;
  let c = VAZIO;
  try {
    const bruto = typeof window !== "undefined" ? window.localStorage.getItem(CHAVE(slug)) : null;
    if (bruto) {
      const o = JSON.parse(bruto) as Partial<Carrinho>;
      const linhas = Array.isArray(o.linhas) ? o.linhas.filter((l) => l && typeof l.productId === "string" && Number.isInteger(l.quantidade) && l.quantidade > 0) : [];
      c = { linhas: linhas.slice(0, 12) };
    }
  } catch {
    // Sem localStorage (janela privada antiga, dados bloqueados): o carrinho vive só nesta página.
  }
  cache.set(slug, c);
  return c;
}

function escrever(slug: string, c: Carrinho) {
  cache.set(slug, c);
  try {
    window.localStorage.setItem(CHAVE(slug), JSON.stringify(c));
  } catch {
    // Fica só em memória.
  }
  ouvintes.forEach((o) => o());
}

/** Avisa `o` quando o carrinho muda, nesta página ou noutro separador. */
export const subscrever = (o: () => void) => {
  ouvintes.add(o);
  const onStorage = (e: StorageEvent) => {
    if (e.key?.startsWith("loja-carrinho:")) {
      cache.delete(e.key.slice("loja-carrinho:".length));
      o();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    ouvintes.delete(o);
    window.removeEventListener("storage", onStorage);
  };
};

export function quantidadeNoCarrinho(c: Carrinho): number {
  return c.linhas.reduce((n, l) => n + l.quantidade, 0);
}

/** Junta `quantidade` de um produto num tamanho. Devolve o que ficou nessa linha, ou a razão para não dar. */
export function juntarAoCarrinho(slug: string, p: Produto, tamanho: string, quantidade: number): { ok: true; naLinha: number } | { ok: false; erro: string } {
  const c = ler(slug);
  const linhas = [...c.linhas];
  const i = linhas.findIndex((l) => l.productId === p.id && l.tamanho === tamanho);
  const atual = i >= 0 ? linhas[i].quantidade : 0;
  const total = quantidadeNoCarrinho(c) - atual;
  const nova = Math.min(atual + quantidade, MAXIMO_POR_LINHA);
  if (nova === atual) return { ok: false, erro: `Já tens ${MAXIMO_POR_LINHA} no carrinho, que é o máximo por artigo.` };
  if (total + nova > MAXIMO_POR_ENCOMENDA) return { ok: false, erro: `O carrinho leva no máximo ${MAXIMO_POR_ENCOMENDA} unidades.` };
  const disponivel = p.stock?.[tamanho];
  if (typeof disponivel === "number" && nova > disponivel) {
    return { ok: false, erro: disponivel <= 0 ? "Esgotou." : disponivel === 1 ? "Só há uma unidade." : `Só há ${disponivel} unidades.` };
  }
  if (i < 0 && linhas.length >= 12) return { ok: false, erro: "O carrinho leva no máximo 12 artigos diferentes." };
  const linha: LinhaDoCarrinho = { productId: p.id, tamanho, quantidade: nova, nome: p.name, preco: p.price, image: p.image };
  if (i >= 0) linhas[i] = linha;
  else linhas.push(linha);
  escrever(slug, { linhas });
  return { ok: true, naLinha: nova };
}

export function mudarQuantidade(slug: string, productId: string, tamanho: string, quantidade: number) {
  const c = ler(slug);
  const linhas = c.linhas.map((l) => (l.productId === productId && l.tamanho === tamanho ? { ...l, quantidade: Math.max(0, Math.min(MAXIMO_POR_LINHA, quantidade)) } : l)).filter((l) => l.quantidade > 0);
  escrever(slug, { linhas });
}

export function tirarDoCarrinho(slug: string, productId: string, tamanho: string) {
  mudarQuantidade(slug, productId, tamanho, 0);
}

export function esvaziarCarrinho(slug: string) {
  escrever(slug, { linhas: [] });
}

/* -------------------------------------------------------------------------- */
/* Frases                                                                       */
/* -------------------------------------------------------------------------- */

export function euroDeCents(cents: number): string {
  return new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(cents / 100);
}

/** "Só restam 3" / "Última unidade" / "Esgotado", ou nada quando há bastante ou não se conta. */
export function fraseDoStock(disponivel: number | null | undefined): string | null {
  if (disponivel === null || disponivel === undefined) return null;
  if (disponivel <= 0) return "Esgotado";
  if (disponivel === 1) return "Última unidade";
  if (disponivel < POUCAS_UNIDADES) return `Só restam ${disponivel}`;
  return null;
}

/** O produto está esgotado em todos os tamanhos? */
export function esgotado(p: Produto): boolean {
  if (p.soldOut) return true;
  if (!p.stock) return false;
  const valores = Object.values(p.stock);
  return valores.length > 0 && valores.every((n) => n !== null && n <= 0);
}

/**
 * Restam poucas unidades do produto todo? Só quando todos os tamanhos se
 * contam: com um tamanho sem contagem não se sabe, e não se diz.
 */
export function poucasUnidades(p: Produto): boolean {
  if (!p.stock || esgotado(p)) return false;
  const valores = Object.values(p.stock);
  if (valores.length === 0 || valores.some((n) => n === null)) return false;
  const total = valores.reduce<number>((s, n) => s + Math.max(0, n ?? 0), 0);
  return total > 0 && total < POUCAS_UNIDADES;
}

/** As fotografias de um produto, a principal primeiro e sem repetidas. */
export function fotosDoProduto(p: Produto): string[] {
  return [...new Set([p.image, ...(p.images ?? [])].filter((s): s is string => !!s))];
}

/* -------------------------------------------------------------------------- */
/* Demonstração                                                                 */
/* -------------------------------------------------------------------------- */

/** Onde a demonstração guarda a encomenda fingida, para a página da encomenda a mostrar. */
export const CHAVE_DEMO = (token: string) => `encomenda-demo:${token}`;

export type EncomendaDeDemonstracao = { encomenda: Encomenda; pagaEm: number };

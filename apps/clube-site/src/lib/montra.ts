/**
 * Os filtros da montra da loja (`/loja`), sem nada do browser: lidos do
 * endereço, aplicados à lista e contados por faceta. Vivem no endereço para
 * se poderem partilhar ("as camisolas em promoção, tamanho M") e para a
 * página funcionar sem JavaScript.
 */

import type { Produto } from "@/dados/tipos";
import { esgotado, percentagemDePromocao } from "@/lib/loja";

export type Filtros = {
  categoria: string;
  novidades: boolean;
  promocoes: boolean;
  tamanhos: string[];
  min: number | null;
  max: number | null;
  ordem: Ordem;
};

export const ORDENS = [
  { v: "", l: "Destaques" },
  { v: "recentes", l: "Mais recentes" },
  { v: "preco-asc", l: "Preço mais baixo" },
  { v: "preco-desc", l: "Preço mais alto" },
] as const;
export type Ordem = (typeof ORDENS)[number]["v"];

type Bruto = Record<string, string | string[] | undefined>;
const um = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const numero = (v: string): number | null => {
  const n = Number(v.replace(",", "."));
  return v.trim() !== "" && Number.isFinite(n) && n >= 0 ? n : null;
};

export function lerFiltros(q: Bruto): Filtros {
  const ordem = um(q.ordem);
  return {
    categoria: um(q.categoria).slice(0, 80),
    novidades: um(q.novidades) === "1",
    promocoes: um(q.promocoes) === "1",
    tamanhos: um(q.tamanho)
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 12),
    min: numero(um(q.min)),
    max: numero(um(q.max)),
    ordem: (ORDENS.some((o) => o.v === ordem) ? ordem : "") as Ordem,
  };
}

/** O endereço da montra com estes filtros. Os vazios não entram. */
export function enderecoDaMontra(f: Filtros): string {
  const q = new URLSearchParams();
  if (f.categoria) q.set("categoria", f.categoria);
  if (f.novidades) q.set("novidades", "1");
  if (f.promocoes) q.set("promocoes", "1");
  if (f.tamanhos.length) q.set("tamanho", f.tamanhos.join(","));
  if (f.min !== null) q.set("min", String(f.min));
  if (f.max !== null) q.set("max", String(f.max));
  if (f.ordem) q.set("ordem", f.ordem);
  return `/loja${q.size ? `?${q}` : ""}`;
}

/** A chave da categoria de um produto: o endereço dela, ou o nome num servidor antigo. */
export const categoriaDe = (p: Produto) => p.categorySlug ?? p.category;

export const emPromocao = (p: Produto) => percentagemDePromocao(p) !== null;

/** Os tamanhos à venda num produto: os que têm stock (ou não se contam). */
function tamanhosComStock(p: Produto): string[] {
  const opcoes = p.variants?.options ?? [];
  return opcoes.filter((t) => {
    const n = p.stock?.[t];
    return n === undefined || n === null || n > 0;
  });
}

type Faceta = "categoria" | "novidades" | "promocoes" | "tamanhos" | "preco";

/** Passa nos filtros todos, menos a faceta `sem` (para contar essa). */
function passa(p: Produto, f: Filtros, sem?: Faceta): boolean {
  if (sem !== "categoria" && f.categoria && categoriaDe(p) !== f.categoria) return false;
  if (sem !== "novidades" && f.novidades && !p.isNew) return false;
  if (sem !== "promocoes" && f.promocoes && !emPromocao(p)) return false;
  if (sem !== "tamanhos" && f.tamanhos.length) {
    const tem = tamanhosComStock(p);
    if (!f.tamanhos.some((t) => tem.includes(t))) return false;
  }
  if (sem !== "preco") {
    if (f.min !== null && p.price < f.min) return false;
    if (f.max !== null && p.price > f.max) return false;
  }
  return true;
}

/** Pela ordem pedida, e os esgotados sempre no fim: primeiro o que se pode comprar. */
function ordenar(lista: Produto[], ordem: Ordem): Produto[] {
  return lista
    .map((p, i) => ({ p, i, fora: esgotado(p) }))
    .sort((a, b) => {
      if (a.fora !== b.fora) return a.fora ? 1 : -1;
      if (ordem === "preco-asc") return a.p.price - b.p.price || a.i - b.i;
      if (ordem === "preco-desc") return b.p.price - a.p.price || a.i - b.i;
      if (ordem === "recentes") return (b.p.createdAt ?? "").localeCompare(a.p.createdAt ?? "") || Number(!!b.p.isNew) - Number(!!a.p.isNew) || a.i - b.i;
      return a.i - b.i;
    })
    .map((x) => x.p);
}

/** A ordem natural dos tamanhos: idades, depois XS a XXXL, depois o resto por ordem alfabética. */
const LETRAS = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "XXXL", "2XL", "3XL", "4XL"];
function pesoDoTamanho(t: string): [number, number, string] {
  const idade = /^(\d+)\s*anos?$/i.exec(t);
  if (idade) return [0, Number(idade[1]), t];
  const i = LETRAS.indexOf(t.toUpperCase());
  if (i >= 0) return [1, i, t];
  const n = Number(t.replace(",", "."));
  if (Number.isFinite(n)) return [2, n, t];
  return [3, 0, t];
}
export function ordenarTamanhos(ts: string[]): string[] {
  return [...ts].sort((a, b) => {
    const [ga, na, sa] = pesoDoTamanho(a);
    const [gb, nb, sb] = pesoDoTamanho(b);
    return ga - gb || na - nb || sa.localeCompare(sb, "pt");
  });
}

/** A montra: o que se mostra, e quantos há em cada opção de cada filtro (com os outros filtros aplicados). */
export function montra(todos: Produto[], categorias: { slug: string; name: string }[], f: Filtros) {
  const lista = ordenar(
    todos.filter((p) => passa(p, f)),
    f.ordem,
  );
  const semCategoria = todos.filter((p) => passa(p, f, "categoria"));
  const porCategoria = new Map<string, number>();
  for (const p of semCategoria) porCategoria.set(categoriaDe(p), (porCategoria.get(categoriaDe(p)) ?? 0) + 1);
  // As categorias do clube, pela ordem dele, que têm produtos; a escolhida fica mesmo sem nenhum.
  const opcoesCategoria = categorias
    .filter((c) => porCategoria.has(c.slug) || c.slug === f.categoria)
    .map((c) => ({ ...c, n: porCategoria.get(c.slug) ?? 0 }));

  const tamanhos = ordenarTamanhos([...new Set(todos.flatMap((p) => p.variants?.options ?? []))]);
  const precos = todos.map((p) => p.price);

  return {
    lista,
    categorias: opcoesCategoria,
    todasN: semCategoria.length,
    novidadesN: todos.filter((p) => p.isNew && passa(p, f, "novidades")).length,
    promocoesN: todos.filter((p) => emPromocao(p) && passa(p, f, "promocoes")).length,
    tamanhos,
    precoMaximo: precos.length ? Math.ceil(Math.max(...precos)) : 0,
    filtrosAtivos: (f.categoria ? 1 : 0) + (f.novidades ? 1 : 0) + (f.promocoes ? 1 : 0) + f.tamanhos.length + (f.min !== null || f.max !== null ? 1 : 0),
  };
}

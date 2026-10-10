/**
 * De onde vêm os dados: demonstração ou API.
 *
 * `SITE_FONTE=demo` lê os dados de `demo/`. `SITE_FONTE=api` pede-os aos
 * endpoints públicos da API (`/public/sites/:slug/...`), com cache de um
 * minuto por página e etiqueta por clube, para a consola poder invalidar o
 * site do clube ao publicar (`revalidateTag("clube:<slug>")`).
 *
 * As páginas só conhecem a interface `Fonte`. Trocar a origem não lhes toca.
 */

import type { Clube, Equipa, Evento, Fonte, Jogo, Noticia, Produto } from "./tipos";
import { DEMO, PRODUTOS } from "./demo/monteverde";

const porData = <T extends { startsAt: string }>(a: T, b: T) => a.startsAt.localeCompare(b.startsAt);

const demo: Fonte = {
  async clube(slug) {
    return slug === DEMO.clube.slug ? DEMO.clube : null;
  },
  async noticias(slug, opts) {
    if (slug !== DEMO.clube.slug) return [];
    let lista = [...DEMO.noticias].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
    if (opts?.category) lista = lista.filter((n) => n.category === opts.category);
    return opts?.limit ? lista.slice(0, opts.limit) : lista;
  },
  async noticia(slug, id) {
    if (slug !== DEMO.clube.slug) return null;
    return DEMO.noticias.find((n) => n.slug === id || n.id === id) ?? null;
  },
  async equipas(slug) {
    return slug === DEMO.clube.slug ? DEMO.equipas : [];
  },
  async equipa(slug, id) {
    if (slug !== DEMO.clube.slug) return null;
    return DEMO.equipas.find((e) => e.slug === id || e.id === id) ?? null;
  },
  async jogos(slug) {
    return slug === DEMO.clube.slug ? [...DEMO.jogos].sort(porData) : [];
  },
  async jogo(slug, id) {
    if (slug !== DEMO.clube.slug) return null;
    return DEMO.jogos.find((j) => j.id === id) ?? null;
  },
  async eventos(slug) {
    return slug === DEMO.clube.slug ? [...DEMO.eventos].sort(porData) : [];
  },
  async produtos(slug) {
    return slug === DEMO.clube.slug ? PRODUTOS : [];
  },
  async produto(slug, id) {
    if (slug !== DEMO.clube.slug) return null;
    return PRODUTOS.find((p) => p.slug === id || p.id === id) ?? null;
  },
};

async function pedir<T>(slug: string, caminho: string, fallback: T): Promise<T> {
  const r = await fetch(`${process.env.SITE_API_URL}/public/sites/${slug}${caminho}`, {
    next: { revalidate: 60, tags: [`clube:${slug}`] },
  });
  if (r.status === 404) return fallback;
  if (!r.ok) throw new Error(`API ${r.status} em ${caminho}`);
  return (await r.json()) as T;
}

const api: Fonte = {
  clube: (slug) => pedir<Clube | null>(slug, "", null),
  noticias: (slug, opts) => {
    const q = new URLSearchParams();
    if (opts?.limit) q.set("limit", String(opts.limit));
    if (opts?.category) q.set("category", opts.category);
    const qs = q.size ? `?${q}` : "";
    return pedir<Noticia[]>(slug, `/noticias${qs}`, []);
  },
  noticia: (slug, id) => pedir<Noticia | null>(slug, `/noticias/${id}`, null),
  equipas: (slug) => pedir<Equipa[]>(slug, "/equipas", []),
  equipa: (slug, id) => pedir<Equipa | null>(slug, `/equipas/${id}`, null),
  jogos: (slug) => pedir<Jogo[]>(slug, "/jogos", []),
  jogo: (slug, id) => pedir<Jogo | null>(slug, `/jogos/${id}`, null),
  eventos: (slug) => pedir<Evento[]>(slug, "/eventos", []),
  produtos: (slug) => pedir<Produto[]>(slug, "/produtos", []),
  produto: (slug, id) => pedir<Produto | null>(slug, `/produtos/${id}`, null),
};

export const fonte: Fonte = (process.env.SITE_FONTE ?? "demo") === "api" ? api : demo;

/* -------------------------------------------------------------------------- */
/* Perguntas que várias páginas fazem                                          */
/* -------------------------------------------------------------------------- */

/** O próximo jogo marcado e o último jogado, de qualquer equipa. */
export async function proximoEUltimo(slug: string): Promise<{ proximo: Jogo | null; ultimo: Jogo | null }> {
  const jogos = await fonte.jogos(slug);
  const agora = Date.now();
  const proximo = jogos.find((j) => j.status === "SCHEDULED" && new Date(j.startsAt).getTime() >= agora) ?? null;
  const ultimo = [...jogos].reverse().find((j) => j.status === "PLAYED") ?? null;
  return { proximo, ultimo };
}

/** Os jogos com bilheteira aberta, do mais próximo para o mais longe. */
export async function jogosComBilhetes(slug: string): Promise<Jogo[]> {
  const jogos = await fonte.jogos(slug);
  const agora = Date.now();
  return jogos.filter((j) => j.tickets?.open && j.status === "SCHEDULED" && new Date(j.startsAt).getTime() >= agora);
}

/**
 * De que clube é este `Host`, e com que layout.
 *
 * É a única pergunta que o `proxy.ts` faz, e tem de ser barata: corre em
 * todos os pedidos. Três respostas, por ordem:
 *
 *   1. `localhost` e `<slug>.localhost` — desenvolvimento. Sem subdomínio vale
 *      `SITE_DEMO_SLUG`.
 *   2. `<slug>.<SITE_PREVIEW_DOMAIN>` — a pré-visualização de um clube antes de
 *      o domínio dele apontar para aqui.
 *   3. O domínio do clube — `www.adfafe.pt`. Com a fonte `demo` vem da lista
 *      dos dados de demonstração; com `api`, da API, com cache em memória de
 *      cinco minutos, porque um domínio muda de clube uma vez na vida.
 *
 * Sem resposta não se adivinha: o site responde "não há clube neste
 * endereço". Falhar para o lado seguro é a mesma regra do `TENANT_DOMAIN` da
 * API.
 *
 * O layout vem com o clube (é uma escolha dele). O proxy pode sobrepô-lo com
 * o cookie de pré-visualização.
 */

import { DEMO, DOMINIOS_DEMO } from "./demo/monteverde";
import type { Layout } from "./tipos";

export type Resposta = { slug: string; layout: Layout };

const TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { r: Resposta | null; until: number }>();

function demoPorSlug(slug: string | null | undefined): Resposta | null {
  if (!slug) return null;
  return { slug, layout: slug === DEMO.clube.slug ? DEMO.clube.layout : "classico" };
}

export async function clubeDoHost(hostHeader: string): Promise<Resposta | null> {
  const host = hostHeader.split(":")[0].trim().toLowerCase();
  if (!host) return null;

  const demo = (process.env.SITE_FONTE ?? "demo") === "demo";

  let slug: string | null = null;
  if (host === "localhost" || host === "127.0.0.1") slug = process.env.SITE_DEMO_SLUG ?? null;
  else if (host.endsWith(".localhost")) slug = host.slice(0, -".localhost".length) || null;
  else {
    const preview = process.env.SITE_PREVIEW_DOMAIN?.toLowerCase();
    if (preview && host.endsWith(`.${preview}`)) slug = host.slice(0, -(preview.length + 1)) || null;
  }
  if (slug) return demo ? demoPorSlug(slug) : porSlugNaApi(slug);

  if (demo) return demoPorSlug(DOMINIOS_DEMO[host]);
  return pedir(host, `/public/sites/por-dominio/${encodeURIComponent(host)}`);
}

function porSlugNaApi(slug: string) {
  return pedir(`slug:${slug}`, `/public/sites/${encodeURIComponent(slug)}/resumo`);
}

async function pedir(chave: string, caminho: string): Promise<Resposta | null> {
  const hit = cache.get(chave);
  if (hit && hit.until > Date.now()) return hit.r;
  let r: Resposta | null = null;
  try {
    const res = await fetch(`${process.env.SITE_API_URL}${caminho}`, { cache: "no-store" });
    if (res.ok) {
      const j = (await res.json()) as { slug?: string; layout?: Layout };
      if (j.slug) r = { slug: j.slug, layout: j.layout ?? "classico" };
    }
  } catch {
    // A API em baixo não pode derrubar o site: o que estiver em cache vale.
    if (hit) return hit.r;
  }
  cache.set(chave, { r, until: Date.now() + TTL_MS });
  return r;
}

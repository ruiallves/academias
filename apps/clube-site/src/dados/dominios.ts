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

/**
 * `dominio` é o domínio próprio do clube, se tiver. Com ele, a
 * pré-visualização (`<slug>.website.academias.pt`) redireciona para lá: o
 * Google tem de ver um site só. Ver `proxy.ts`.
 */
export type Resposta = { slug: string; layout: Layout; dominio?: string | null };

/**
 * Cinco minutos para uma resposta, trinta segundos para um "não há": um clube
 * que acabou de publicar o site não fica cinco minutos a ver "endereço não
 * ligado".
 */
const TTL_MS = 5 * 60 * 1000;
const TTL_NEGATIVO_MS = 30 * 1000;
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
  // Os endereços do próprio Vercel (`…vercel.app`, de produção e de cada
  // deploy) mostram o clube de demonstração, se houver um definido: é por
  // eles que se vê um deploy antes de qualquer domínio estar ligado.
  if (host === "localhost" || host === "127.0.0.1" || host.endsWith(".vercel.app")) slug = process.env.SITE_DEMO_SLUG ?? null;
  else if (host.endsWith(".localhost")) slug = host.slice(0, -".localhost".length) || null;
  else {
    const preview = process.env.SITE_PREVIEW_DOMAIN?.toLowerCase();
    if (preview && host.endsWith(`.${preview}`)) slug = host.slice(0, -(preview.length + 1)) || null;
  }
  // Em demonstração há um clube só: qualquer pré-visualização
  // (`ad-fafe.website.academias.pt`) mostra-o, para se testar o endereço de
  // um clube a sério antes de os dados dele existirem.
  if (slug) return demo ? demoPorSlug(DEMO.clube.slug) : porSlugNaApi(slug);

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
      const j = (await res.json()) as { slug?: string; layout?: Layout; dominio?: string | null };
      if (j.slug) r = { slug: j.slug, layout: j.layout ?? "classico", dominio: j.dominio ?? null };
    }
  } catch {
    // A API em baixo não pode derrubar o site: o que estiver em cache vale.
    if (hit) return hit.r;
  }
  cache.set(chave, { r, until: Date.now() + (r ? TTL_MS : TTL_NEGATIVO_MS) });
  return r;
}

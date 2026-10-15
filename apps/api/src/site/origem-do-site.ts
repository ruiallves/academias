import type { PrismaService } from "../prisma/prisma.service";

/**
 * É o site de um clube a pedir? Para o CORS da inscrição de sócio.
 *
 * O "Ser sócio" do site do clube envia o pedido do browser para a API
 * (`POST /api/clubes/:slug/socios`), como a página `/ser-socio`. Não passa
 * pelo servidor do site de propósito: aí todos os visitantes de todos os
 * clubes chegavam à API com o mesmo IP e partilhavam o tecto de 5 por minuto.
 *
 * Aceita:
 *   - `https://<slug>.website.academias.pt`, as pré-visualizações;
 *   - o domínio próprio de um clube com site publicado (com ou sem `www`),
 *     perguntado à base pela mesma função que o site usa para o resolver;
 *   - em desenvolvimento, `localhost` e `<slug>.localhost`.
 *
 * As respostas ficam em memória: cinco minutos para um sim, um para um não.
 * O CORS só abre `/api/clubes/...` a estas origens, e sem credenciais
 * (ver `main.ts`).
 */
export function criarOrigemDoSite(prisma: PrismaService) {
  const cache = new Map<string, { ok: boolean; ate: number }>();

  return async function origemDoSite(origin: string): Promise<boolean> {
    let url: URL;
    try {
      url = new URL(origin);
    } catch {
      return false;
    }
    const host = url.hostname.toLowerCase();
    const local = host === "localhost" || host.endsWith(".localhost");
    if (local) return process.env.NODE_ENV !== "production";
    if (url.protocol !== "https:") return false;

    const preview = (process.env.SITE_PREVIEW_DOMAIN ?? "website.academias.pt").toLowerCase();
    if (host.endsWith(`.${preview}`)) {
      const slug = host.slice(0, -(preview.length + 1));
      return !!slug && !slug.includes(".");
    }

    const visto = cache.get(host);
    if (visto && visto.ate > Date.now()) return visto.ok;
    const rows = await prisma.$queryRaw<{ id: string | null }[]>`SELECT app.resolve_site_by_domain(${host}) AS id`.catch(() => []);
    const ok = !!rows[0]?.id;
    if (cache.size > 2000) cache.clear();
    cache.set(host, { ok, ate: Date.now() + (ok ? 300_000 : 60_000) });
    return ok;
  };
}

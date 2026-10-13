import { timingSafeEqual } from "node:crypto";
import { revalidateTag } from "next/cache";

/**
 * A API avisa aqui quando um clube muda alguma coisa no site (ver
 * `SiteRevalidarService` na API). A cache das páginas desse clube cai, e a
 * página seguinte já traz a mudança.
 *
 * Protegida por um segredo partilhado (`SITE_REVALIDATE_SECRET`, igual no
 * Vercel e no Railway). Sem segredo configurado, recusa sempre: uma rota que
 * deita caches abaixo não pode estar aberta.
 */
export async function POST(req: Request) {
  const segredo = process.env.SITE_REVALIDATE_SECRET ?? "";
  const veio = req.headers.get("x-revalidar-segredo") ?? "";
  if (!segredo || !iguais(segredo, veio)) return Response.json({ ok: false }, { status: 401 });

  const corpo = (await req.json().catch(() => ({}))) as { slug?: unknown };
  const slug = typeof corpo.slug === "string" && /^[a-z0-9-]{1,60}$/.test(corpo.slug) ? corpo.slug : null;
  if (!slug) return Response.json({ ok: false }, { status: 400 });

  // `expire: 0`: quem chama precisa da mudança já, não de conteúdo antigo enquanto revalida.
  revalidateTag(`clube:${slug}`, { expire: 0 });
  return Response.json({ ok: true });
}

function iguais(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

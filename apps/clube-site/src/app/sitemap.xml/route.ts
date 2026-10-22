import { headers } from "next/headers";
import { clubeDoHost } from "@/dados/dominios";
import { fonte } from "@/dados/fonte";

/**
 * O `sitemap.xml` de cada clube: as páginas fixas e as que têm lista
 * (notícias, equipas, produtos), todas com a base do `Host` do pedido. Sem
 * clube neste endereço não há sitemap. Vive fora de `[clube]` porque o proxy
 * deixa passar `/sitemap.xml` sem lhe pôr o slug.
 *
 * As páginas de uma compra (`/bilhete/<token>`) ficam de fora de propósito: o
 * token é o acesso aos bilhetes de alguém, e a página tem `noindex`.
 */
export async function GET() {
  const host = ((await headers()).get("host") ?? "").split(":")[0].trim().toLowerCase();
  const clube = host ? await clubeDoHost(host) : null;
  if (!clube) return new Response("Não há clube neste endereço.", { status: 404 });
  // Na pré-visualização de um clube com domínio próprio, o sitemap é o do domínio (como as páginas, no proxy).
  if (clube.dominio && host.replace(/^www\./, "") !== clube.dominio) {
    return Response.redirect(`https://${clube.dominio}/sitemap.xml`, 308);
  }

  const base = `https://${host}`;
  const [noticias, equipas, produtos] = await Promise.all([fonte.noticias(clube.slug), fonte.equipas(clube.slug), fonte.produtos(clube.slug)]);

  const entradas: { loc: string; lastmod?: string }[] = [
    { loc: "/" },
    { loc: "/noticias" },
    ...noticias.map((n) => ({ loc: `/noticias/${n.slug}`, lastmod: n.publishedAt })),
    { loc: "/equipas" },
    ...equipas.map((e) => ({ loc: `/equipas/${e.slug}` })),
    { loc: "/calendario" },
    { loc: "/clube" },
    { loc: "/contactos" },
    { loc: "/loja" },
    ...produtos.map((p) => ({ loc: `/loja/${p.slug}` })),
    { loc: "/bilheteira" },
    { loc: "/privacidade" },
  ];

  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    entradas
      .map((e) => `  <url><loc>${escapar(base + e.loc)}</loc>${e.lastmod ? `<lastmod>${escapar(diaIso(e.lastmod))}</lastmod>` : ""}</url>`)
      .join("\n") +
    `\n</urlset>\n`;

  return new Response(xml, {
    headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}

/** Só o dia (`2026-10-20`): a hora não interessa ao Google e uma data inválida não pode partir o XML. */
function diaIso(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toISOString().slice(0, 10);
}

function escapar(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

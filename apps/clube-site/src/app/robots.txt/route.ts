import { headers } from "next/headers";
import { clubeDoHost } from "@/dados/dominios";

/**
 * O `robots.txt` de cada clube, decidido pelo `Host` como tudo o resto.
 *
 * Só o endereço de um clube se deixa indexar. Os endereços do Vercel (de
 * produção e de cada deploy) são cópias, e um host sem clube não tem nada
 * para mostrar: nos dois casos fecha-se tudo. Vive fora de `[clube]` porque o
 * proxy deixa passar `/robots.txt` sem lhe pôr o slug.
 */
export async function GET() {
  const host = ((await headers()).get("host") ?? "").split(":")[0].trim().toLowerCase();
  const clube = host && !host.endsWith(".vercel.app") ? await clubeDoHost(host) : null;
  // A pré-visualização de um clube com domínio próprio também é uma cópia: o
  // proxy manda as páginas para o domínio, mas este ficheiro passa-lhe ao lado.
  const oficial = !!clube && (!clube.dominio || host.replace(/^www\./, "") === clube.dominio);
  const corpo = oficial ? `User-agent: *\nAllow: /\nSitemap: https://${host}/sitemap.xml\n` : "User-agent: *\nDisallow: /\n";
  return new Response(corpo, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}

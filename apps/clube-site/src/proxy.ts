import { NextResponse, type NextRequest } from "next/server";
import { clubeDoHost } from "@/dados/dominios";
import { layoutValido } from "@/dados/tipos";

/** O cookie que a pré-visualização usa para trocar de layout. */
export const COOKIE_LAYOUT = "site-layout";

/**
 * `www.adfafe.pt/noticias` → `/adfafe/classico/noticias`, por dentro.
 *
 * Não é um redirecionamento: o endereço na barra fica o do clube, e é o
 * caminho interno que ganha o slug e o layout. Todas as páginas vivem em
 * `app/[clube]/[layout]/`, e os links dentro do site são relativos à raiz
 * (`/noticias`), porque os dois segmentos são postos aqui a cada pedido,
 * incluindo os prefetch do router.
 *
 * O layout é o do clube; o cookie de pré-visualização sobrepõe-no, mas só em
 * demonstração (`SITE_FONTE=demo`). Pô-lo no caminho e não num cabeçalho é o
 * que deixa cada página continuar em cache: (clube, layout) é a chave.
 *
 * ## O único redirecionamento
 *
 * Um clube com domínio próprio deixa de ser servido na pré-visualização:
 * `ad-fafe.website.academias.pt/x` → `https://adfafe.pt/x`, permanente. Dois
 * endereços com o mesmo site partiam-lhe o lugar no Google.
 *
 * Um host sem clube vai para `/sem-clube`. Escrever `/adfafe/...` à mão no
 * site de outro clube também não dá nada: o prefixo é sempre acrescentado.
 */
export async function proxy(req: NextRequest) {
  const host = (req.headers.get("host") ?? "").split(":")[0].toLowerCase();
  const clube = await clubeDoHost(host);
  const url = req.nextUrl.clone();
  const path = req.nextUrl.pathname;

  if (!clube) {
    url.pathname = "/sem-clube";
    return NextResponse.rewrite(url);
  }

  // Só da pré-visualização: em desenvolvimento (`localhost`) nunca se é mandado para fora.
  const preview = process.env.SITE_PREVIEW_DOMAIN?.toLowerCase();
  const naPreVisualizacao = !!preview && host.endsWith(`.${preview}`);
  if (clube.dominio && naPreVisualizacao) {
    return NextResponse.redirect(`https://${clube.dominio}${path}${req.nextUrl.search}`, 308);
  }

  const demo = (process.env.SITE_FONTE ?? "demo") === "demo";
  const cookie = req.cookies.get(COOKIE_LAYOUT)?.value;
  const layout = demo && layoutValido(cookie) ? cookie : clube.layout;

  url.pathname = `/${clube.slug}/${layout}${path === "/" ? "" : path}`;
  return NextResponse.rewrite(url);
}

export const config = {
  // Tudo menos os ficheiros estáticos, as imagens optimizadas e as rotas
  // `/api` do próprio site (a revalidação), que não pertencem a clube nenhum.
  matcher: ["/((?!api/|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.[a-z0-9]+$).*)"],
};

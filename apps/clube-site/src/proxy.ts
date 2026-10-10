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
 * O layout é o do clube; o cookie de pré-visualização sobrepõe-no. Pô-lo no
 * caminho e não num cabeçalho é o que deixa cada página continuar em cache:
 * (clube, layout) é a chave, e nenhuma página precisa de ler cookies.
 *
 * Um host sem clube vai para `/sem-clube`. Escrever `/adfafe/...` à mão no
 * site de outro clube também não dá nada: o prefixo é sempre acrescentado.
 */
export async function proxy(req: NextRequest) {
  const clube = await clubeDoHost(req.headers.get("host") ?? "");
  const url = req.nextUrl.clone();
  const path = req.nextUrl.pathname;

  if (!clube) {
    url.pathname = "/sem-clube";
    return NextResponse.rewrite(url);
  }

  const cookie = req.cookies.get(COOKIE_LAYOUT)?.value;
  const layout = layoutValido(cookie) ? cookie : clube.layout;

  url.pathname = `/${clube.slug}/${layout}${path === "/" ? "" : path}`;
  return NextResponse.rewrite(url);
}

export const config = {
  // Tudo menos os ficheiros estáticos e as imagens optimizadas, que não
  // pertencem a clube nenhum.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.[a-z0-9]+$).*)"],
};

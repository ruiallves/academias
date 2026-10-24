import { NextResponse, type NextRequest } from "next/server";
import { clubeDoHost } from "@/dados/dominios";

/**
 * `www.adfafe.pt/noticias` → `/adfafe/noticias`, por dentro.
 *
 * Não é um redirecionamento: o endereço na barra fica o do clube, e é o
 * caminho interno que ganha o slug. Todas as páginas vivem em
 * `app/[clube]/`, e os links dentro do site são relativos à raiz
 * (`/noticias`), porque o slug é posto aqui a cada pedido, incluindo os
 * prefetch do router.
 *
 * O proxy só responde "de que clube é este endereço". O layout decide-se na
 * página (`layoutAtual`), a partir dos dados do clube: aqui ficava em memória
 * cinco minutos, por instância, e as páginas de um mesmo clube saíam com
 * layouts diferentes depois de ele trocar.
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

  url.pathname = `/${clube.slug}${path === "/" ? "" : path}`;
  const resposta = NextResponse.rewrite(url);
  // A página de uma compra de bilhetes: o token no endereço é o acesso aos
  // bilhetes. Fora do Google (também tem `noindex`) e sem o endereço no Referer.
  if (path.startsWith("/bilhete/") || path.startsWith("/encomenda/")) {
    resposta.headers.set("X-Robots-Tag", "noindex, nofollow");
    resposta.headers.set("Referrer-Policy", "no-referrer");
  }
  return resposta;
}

export const config = {
  // Tudo menos os ficheiros estáticos, as imagens optimizadas e as rotas
  // `/api` do próprio site (a revalidação), que não pertencem a clube nenhum.
  matcher: ["/((?!api/|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.[a-z0-9]+$).*)"],
};

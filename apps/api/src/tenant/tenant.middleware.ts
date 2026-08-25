import type { NextFunction, Request, Response } from "express";
import { tenantFromHost, type TenantRequest } from "./tenant";

/**
 * O `Host` do clube, traduzido para os caminhos que os controladores já servem.
 *
 * ## O que isto resolve
 *
 * Os links que a plataforma gera sempre foram `https://{slug}.academias.pt/convite/…`
 * e `/familia/…` — na raiz, sem `/l/`. O `PUBLIC_BASE_URL` tem o `{slug}` lá dentro
 * desde o início. Faltava só a peça que lê o `Host` e mapeia a raiz para o
 * `/l/:slug/…` que os controladores conhecem. Está escrito no
 * `landing.controller.ts`: *"uma linha de middleware a reescrever o `Host` num
 * parâmetro é o que falta para a versão real, e não muda nada aqui dentro"*.
 *
 * É literalmente isso. Nenhum controlador muda.
 *
 * ## Porquê uma lista de permissões e não de exclusões
 *
 * Só estes quatro caminhos são reescritos. Tudo o resto — `/api`, `/auth`,
 * `/billing`, `/webhooks`, `/consola`, `/app`, os estáticos — passa intacto.
 *
 * Ao contrário: se isto fosse uma lista de exclusões, cada rota nova que alguém
 * acrescentasse à API passava a ser silenciosamente reescrita para a landing até
 * alguém se lembrar de a excluir. Uma lista de permissões falha do lado certo — o
 * caminho novo simplesmente não é tocado.
 *
 * ## Em desenvolvimento
 *
 * `localhost` não é subdomínio de `TENANT_DOMAIN`, por isso nada é reescrito e
 * `/l/:slug/…` continua a ser o caminho de sempre. Este middleware é inerte fora
 * de produção — o que é bom: um caminho só, testado, e não dois comportamentos.
 *
 * ## Porque é que não é um `NestMiddleware`
 *
 * Porque era, e só funcionava para a raiz. O `forRoutes("*")` do Nest deixou de
 * ser um apanha-tudo no Express 5 (o `path-to-regexp` v8 já não aceita um `*`
 * solto), e o resultado era silencioso e traiçoeiro: `/` era reescrito, mas
 * `/ser-socio` e `/manifest.webmanifest` passavam ao lado e davam 404.
 *
 * Registado com `app.use()` no `main.ts` não há padrão nenhum a interpretar —
 * corre para todos os pedidos, antes do router. É o mesmo sítio onde o `helmet` e
 * o `json` já estavam.
 */

type Rewrite = { pattern: RegExp; to: (slug: string, m: RegExpMatchArray) => string };

const REWRITES: Rewrite[] = [
  // A porta do clube. É a resposta a "cdloureiro.academias.pt não levava a lado
  // nenhum": passa a levar à landing do clube, ou ao 404 que já estava escrito.
  { pattern: /^\/$/, to: (slug) => `/l/${slug}` },

  // A adesão a sócio. Aceita as duas grafias porque o link é para partilhar e
  // vai ser escrito à mão por gente que o viu num cartaz.
  { pattern: /^\/ser-?socio\/?$/, to: (slug) => `/l/${slug}/sersocio` },

  { pattern: /^\/convite\/([^/]+)\/?$/, to: (slug, m) => `/l/${slug}/convite/${m[1]}` },
  { pattern: /^\/familia\/([^/]+)\/?$/, to: (slug, m) => `/l/${slug}/familia/${m[1]}` },
];

export function tenantMiddleware(req: Request & TenantRequest, _res: Response, next: NextFunction): void {
  const slug = tenantFromHost(req.headers.host);

  // Guardado mesmo quando não há reescrita nenhuma: é daqui que o manifest da
  // PWA tira de que clube é, sem repetir a leitura do `Host`.
  req.tenantSlug = slug;

  if (!slug) return next();

  const [path, query] = splitQuery(req.url);

  for (const { pattern, to } of REWRITES) {
    const m = path.match(pattern);
    if (!m) continue;
    // `req.url` e não `res.redirect`: a barra do browser continua a mostrar o
    // endereço bonito do clube. Um redireccionamento a sério exporia o `/l/`
    // interno em cada link que alguém copiasse.
    req.url = to(slug, m) + (query ? `?${query}` : "");
    break;
  }

  next();
}

function splitQuery(url: string): [string, string] {
  const i = url.indexOf("?");
  return i === -1 ? [url, ""] : [url.slice(0, i), url.slice(i + 1)];
}

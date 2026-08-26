import "reflect-metadata";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { INestApplication } from "@nestjs/common";
import express, { json } from "express";
import type { Request, Response, NextFunction } from "express";
import helmet from "helmet";
import { AppModule } from "./app.module";
import { tenantFromHost } from "./tenant/tenant";
import { tenantMiddleware } from "./tenant/tenant.middleware";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });

  /*
   * Atrás de um proxy em produção (Cloudflare, o load balancer do Supabase), o IP
   * do cliente vem em `X-Forwarded-For`. Sem `trust proxy`, o `@Ip()` da auditoria
   * lê o IP do proxy — inútil — mas com ele ligado às cegas, um cliente pode
   * forjar o `X-Forwarded-For`. `1` confia só no primeiro salto (o nosso proxy),
   * que é o compromisso correcto.
   */
  app.getHttpAdapter().getInstance().set("trust proxy", 1);

  /*
   * Cabeçalhos de segurança.
   *
   * `contentSecurityPolicy: false` — a API serve HTML (landing, página de convite)
   * com `<script>` inline gerado no servidor, e uma CSP estrita sem `nonce`
   * partiria essas páginas. O XSS está fechado na origem (escape de contexto de
   * script + validação de email); a CSP com nonce fica anotada como endurecimento
   * futuro. Os restantes cabeçalhos — nosniff, frameguard, HSTS, referrer — entram
   * todos.
   */
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    }),
  );

  /*
   * De que clube é este pedido — antes de tudo o resto.
   *
   * Lê o `Host`, deixa o slug no pedido, e traduz os quatro caminhos públicos da
   * raiz (`/`, `/ser-socio`, `/convite/:token`, `/familia/:token`) para os
   * `/l/:slug/…` que os controladores já servem.
   *
   * Aqui e não em `AppModule.configure`: o `forRoutes("*")` do Nest deixou de
   * apanhar tudo no Express 5, e só a raiz era reescrita. Ver o cabeçalho de
   * `tenant/tenant.middleware.ts`.
   */
  app.use(tenantMiddleware);

  /**
   * O corpo em bruto é preservado para as rotas de webhook: a assinatura HMAC é
   * calculada sobre os bytes exactos que a euPago enviou, e um `JSON.parse` seguido
   * de `JSON.stringify` reordena chaves e invalida a verificação.
   */
  app.use(
    json({
      verify: (req, _res, buf) => {
        if (req.url?.startsWith("/webhooks/")) {
          (req as { rawBody?: string }).rawBody = buf.toString("utf8");
        }
      },
    }),
  );

  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );

  serveApps(app);

  /*
   * Quem pode falar com esta API a partir de um browser.
   *
   * ## O que mudou, e porquê
   *
   * Em produção a consola e a app da família passaram a ser servidas pela própria
   * API, na origem do clube (`fafe.academias.pt/consola`, `/app`). Os pedidos
   * delas são same-origin: não há preflight, não há CORS, e não há uma lista de
   * origens a manter à medida que os clubes entram.
   *
   * Sobram os dois que são mesmo de outra origem:
   *
   *   - o **painel da plataforma**, em `admin.academias.pt`;
   *   - o **site de marketing**, em `academias.pt`, cujo formulário de contacto
   *     escreve no CRM.
   *
   * ## Porque é que os subdomínios de clube continuam na lista
   *
   * Porque a mudança para a origem única não tem de ser instantânea. Enquanto
   * houver uma consola ainda servida do Vercel a apontar para `api.academias.pt`,
   * ela precisa de ser aceite — e um subdomínio de `TENANT_DOMAIN` é, por
   * definição, nosso. Quando os projectos antigos forem apagados isto deixa de
   * ser exercido, mas não faz mal nenhum ficar.
   *
   * Uma lista e não `origin: true`: com credenciais activas, aceitar qualquer
   * origem deixa um site alheio fazer pedidos com a sessão de quem lá entrar.
   *
   * `DEV_LAN_ORIGINS` é a excepção controlada: para testar a PWA da família num
   * telemóvel a sério, o browser desse telemóvel envia `Origin: http://<IP da
   * máquina>:5174` — nunca `localhost`, que para ele é o próprio telemóvel. Só
   * entra quando definido no `.env`, e nunca em produção.
   *
   * `SITE_ORIGIN` aceita uma lista separada por vírgulas, pelo mesmo motivo do
   * `DEV_LAN_ORIGINS`: o site responde tanto em `academias.pt` como em
   * `www.academias.pt`, e o `Origin` que o browser envia é sempre o exacto — um
   * visitante que caiu no `www.` nunca vai bater com uma variável que só tem o
   * domínio nu.
   */
  const allowed = new Set(
    [
      process.env.CONSOLE_ORIGIN ?? "http://localhost:5173",
      process.env.FAMILY_ORIGIN ?? "http://localhost:5174",
      process.env.PLATFORM_ORIGIN ?? "http://localhost:5180",
      ...(process.env.SITE_ORIGIN ?? "").split(","),
      ...(process.env.DEV_LAN_ORIGINS ?? "").split(","),
    ]
      .map((o) => o?.trim())
      .filter((o): o is string => Boolean(o)),
  );

  app.enableCors({
    origin(origin: string | undefined, cb: (err: Error | null, ok?: boolean) => void) {
      // Sem `Origin` é same-origin, ou não é um browser (curl, o webhook da
      // euPago, um healthcheck). O CORS não tem nada a dizer sobre esses.
      if (!origin) return cb(null, true);
      if (allowed.has(origin)) return cb(null, true);

      // Qualquer `{clube}.academias.pt` é nosso — a mesma regra do middleware.
      try {
        if (tenantFromHost(new URL(origin).host)) return cb(null, true);
      } catch {
        /* origem ilegível: não é aceite */
      }

      cb(null, false);
    },
    credentials: true,
  });

  await app.listen(process.env.PORT ?? 3000);
}

/* -------------------------------------------------------------------------- */
/* A consola e a app da família, servidas por aqui                             */
/* -------------------------------------------------------------------------- */

/**
 * Os dois SPAs, servidos pela API.
 *
 * ## Porquê aqui e não num CDN
 *
 * Porque a instalação de uma PWA é **same-origin**. O manifest, o service worker,
 * os ícones e a `start_url` têm de estar na mesma origem da página que oferece a
 * instalação — e essa página é a landing do clube, que só a API sabe gerar (o
 * nome, a cor e o emblema mudam de clube para clube). Servir a app de outro sítio
 * torna impossível o único fluxo que ela tem: o pai abre o link do clube, instala,
 * e entra.
 *
 * De lambuja, a consola e a app deixam de ser cross-origin: sem CORS, sem
 * preflight, e a entrega da sessão entre a landing e a consola volta a atravessar
 * pelo armazenamento do browser em vez de ir no fragmento do URL.
 *
 * ## O que é preciso ter feito antes
 *
 * `npm run build:web` na raiz, que compila as duas apps e copia os `dist/` para
 * `apps/api/public/`. Se não estiverem lá — em desenvolvimento, onde cada app tem
 * o seu `vite dev` — isto não monta nada e o resto da API funciona na mesma.
 */
function serveApps(app: INestApplication): void {
  // `__dirname` é `apps/api/dist` tanto em `nest start` como em `node dist/main.js`.
  const root = resolve(__dirname, "..", "public");

  mountSpa(app, "/consola", join(root, "consola"));
  mountSpa(app, "/app", join(root, "app"));

  /*
   * Os ícones na raiz da origem.
   *
   * A landing referencia `/icon-180.png`, e o manifest gerado aponta para os
   * outros dois. São os ficheiros da app da família, servidos também um nível
   * acima — duplicar três PNG é mais barato do que ter dois sítios a discordar
   * sobre onde eles vivem.
   *
   * O 180 é o do iPhone, e é o único que a landing usa directamente: o iOS não
   * lê o manifest para o ecrã inicial, só o `apple-touch-icon` da página (ver
   * `landing.template.ts`). Esta lista é escrita à mão, por isso um ícone novo
   * em `apps/family/public/` que não seja acrescentado aqui devolve 404 na raiz
   * — foi o que aconteceu quando o 180 apareceu.
   */
  const familyPublic = join(root, "app");
  if (existsSync(familyPublic)) {
    for (const icon of ["icon-180.png", "icon-192.png", "icon-512.png"]) {
      app.use(`/${icon}`, (_req: Request, res: Response, next: NextFunction) => {
        res.sendFile(join(familyPublic, icon), (err) => {
          if (err) next();
        });
      });
    }
  }
}

/** Um SPA num prefixo: ficheiros primeiro, `index.html` para tudo o resto. */
function mountSpa(app: INestApplication, prefix: string, dir: string): void {
  if (!existsSync(dir)) {
    console.warn(`[estáticos] ${prefix} não montado — ${dir} não existe (normal em desenvolvimento)`);
    return;
  }

  app.use(
    prefix,
    express.static(dir, {
      // O `index.html` é servido pelo fallback abaixo, sempre com as mesmas
      // regras de cache. Deixar o `express.static` servi-lo também criaria dois
      // caminhos para o mesmo ficheiro, com cabeçalhos diferentes.
      index: false,
      setHeaders(res, path) {
        /*
         * O service worker nunca é cacheado.
         *
         * Um `sw.js` preso na cache é a avaria mais desagradável de uma PWA: a
         * app fica congelada numa versão antiga no telemóvel de alguém e não há
         * como lá chegar. `Service-Worker-Allowed` dá-lhe âmbito `/` apesar de o
         * ficheiro viver em `/app/` — é o que lhe permite controlar a `start_url`
         * e a landing que oferece a instalação.
         */
        if (path.endsWith("sw.js")) {
          res.setHeader("Cache-Control", "no-cache");
          res.setHeader("Service-Worker-Allowed", "/");
          return;
        }
        /*
         * Os ficheiros com hash no nome nunca mudam de conteúdo — quando mudam,
         * mudam de nome. É seguro guardá-los para sempre.
         *
         * O `-` tem de estar dentro da classe: o Vite usa base64url nos hashes, e
         * um `index-CPXz9-_K.js` tem um hífen no meio do próprio hash. Sem ele o
         * padrão não pegava em nada e tudo saía com `max-age=0`.
         */
        if (/[.-][0-9a-zA-Z_-]{8,}\.(js|css|woff2?|png|svg|jpe?g|webp)$/.test(path)) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        }
      },
    }),
  );

  /*
   * O fallback do SPA.
   *
   * `/consola/equipas` não é um ficheiro; é uma rota do react-router. Sem isto,
   * escrever esse endereço na barra — ou fazer F5 lá dentro — dava 404, que é
   * exactamente o problema que o `vercel.json` resolve do lado do Vercel.
   *
   * Só GET e HEAD: um POST para um caminho que não existe deve continuar a ser
   * 404, e não devolver silenciosamente uma página HTML.
   */
  app.use(prefix, (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(join(dir, "index.html"), (err) => {
      if (err) next();
    });
  });
}

void bootstrap();

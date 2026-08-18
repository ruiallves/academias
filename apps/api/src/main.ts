import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { json } from "express";
import helmet from "helmet";
import { AppModule } from "./app.module";

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

  /*
   * As três origens do produto, e mais nenhuma.
   *
   * Uma lista e não `origin: true`: com credenciais activas, aceitar qualquer
   * origem deixa um site alheio fazer pedidos com a sessão de quem lá entrar. O
   * painel da plataforma vive em `admin.academias.pt` — um subdomínio à parte, e
   * por isso uma entrada à parte.
   *
   * `DEV_LAN_ORIGINS` é a excepção controlada: para testar a PWA da família num
   * telemóvel a sério, o browser desse telemóvel envia `Origin: http://<IP da
   * máquina>:5174` — nunca `localhost`, que para ele é o próprio telemóvel. Fica
   * de fora do array por omissão; só entra quando explicitamente definido no
   * `.env`, e nunca em produção (onde a variável não existe).
   */
  const devLanOrigins = (process.env.DEV_LAN_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);

  app.enableCors({
    origin: [
      process.env.CONSOLE_ORIGIN ?? "http://localhost:5173",
      process.env.FAMILY_ORIGIN ?? "http://localhost:5174",
      process.env.PLATFORM_ORIGIN ?? "http://localhost:5180",
      ...devLanOrigins,
    ],
    credentials: true,
  });

  await app.listen(process.env.PORT ?? 3000);
}

void bootstrap();

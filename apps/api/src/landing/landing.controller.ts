import { Controller, Get, Header, Param, Query, Req, Res } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Request, Response } from "express";
import { Public } from "../auth/auth.guard";
import { LandingService } from "./landing.service";
import { detectPlatform, renderLanding } from "./landing.template";
import { renderMembershipPage } from "./membership.template";
import { MembersService } from "../members/members.service";

/**
 * A porta de entrada da academia.
 *
 * Em produção isto resolve-se pelo subdomínio — `{slug}.dominio.pt/` — não por um
 * caminho. `/l/:slug` é o equivalente testável em desenvolvimento: uma linha de
 * middleware a reescrever o `Host` num parâmetro é o que falta para a versão real,
 * e não muda nada aqui dentro — o controlador já recebe o `slug` como parâmetro.
 */
@Public()
@Controller("l")
export class LandingController {
  constructor(
    private readonly landing: LandingService,
    private readonly config: ConfigService,
    private readonly members: MembersService,
  ) {}

  /**
   * "Faz-te sócio" — a inscrição pública.
   *
   * Vive debaixo da página do clube e não numa aplicação: o link é para partilhar
   * (`clube.pt/sersocio`), tem de ter preview em WhatsApp, e é um formulário —
   * nada aqui justifica carregar uma SPA.
   *
   * Declarado **antes** de `:slug` não seria preciso (os caminhos não colidem),
   * mas fica junto por ser a mesma página numa segunda porta.
   */
  @Get(":slug/sersocio")
  @Header("Content-Type", "text/html; charset=utf-8")
  async membership(
    @Param("slug") slug: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const academy = await this.landing.findBySlug(slug);

    if (!academy) {
      res.status(404);
      return notFoundPage(slug);
    }

    // As categorias vêm da base de dados: é o clube que as cria, e é isto que a
    // página oferece a quem chega. Um clube sem nenhuma continua a poder receber
    // inscrições — só não há nada para escolher.
    const tiers = await this.members.publicTiers(slug).catch(() => []);

    return renderMembershipPage({
      academy,
      tiers,
      pageUrl: `${req.protocol}://${req.get("host")}${req.originalUrl}`,
      // O formulário fala com a API a partir do browser. Em produção é a mesma
      // origem; em desenvolvimento a consola e a API estão em portas diferentes.
      apiOrigin: `${req.protocol}://${req.get("host")}`,
    });
  }

  @Get(":slug")
  @Header("Content-Type", "text/html; charset=utf-8")
  async show(
    @Param("slug") slug: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    /**
     * O convite da família, quando se chega por `/familia/:token`.
     *
     * Vem no endereço e segue para a app agarrado ao `familyUrl`. Não é validado
     * aqui: a landing é a mesma página com ou sem ele, e quem decide se o convite
     * vale é a API quando a app o apresentar. Validá-lo aqui só serviria para
     * transformar um link gasto num 404 em vez de numa página que explica.
     */
    @Query("convite") convite?: string,
  ) {
    const academy = await this.landing.findBySlug(slug);

    if (!academy) {
      res.status(404);
      return notFoundPage(slug);
    }

    const userAgent = req.headers["user-agent"] ?? "";
    const familyOrigin = this.config.get<string>("FAMILY_ORIGIN") ?? "http://localhost:5174";
    const consoleOrigin = this.config.get<string>("CONSOLE_ORIGIN") ?? "http://localhost:5173";

    return renderLanding({
      academy,
      platform: detectPlatform(userAgent),
      userAgent,
      pageUrl: `${req.protocol}://${req.get("host")}${req.originalUrl}`,
      // O slug segue para a PWA como pista de tenant em desenvolvimento — em
      // produção o subdomínio já a carrega sozinha, isto não substitui isso.
      familyUrl:
        `${familyOrigin}/?academia=${encodeURIComponent(slug)}` +
        (convite ? `&convite=${encodeURIComponent(convite)}` : ""),
      consoleUrl: consoleOrigin,
      // A anon key é pública por desenho — é a que o browser usa para autenticar.
      // A service-role nunca sai do servidor.
      supabaseUrl: this.config.getOrThrow<string>("SUPABASE_URL").replace(/\/$/, ""),
      supabaseAnonKey: this.config.getOrThrow<string>("SUPABASE_ANON_KEY"),
    });
  }
}

function notFoundPage(slug: string): string {
  return `<!doctype html>
<html lang="pt-PT">
<head>
<meta charset="UTF-8" />
<title>Academia não encontrada</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  body { font-family: ui-sans-serif, system-ui, sans-serif; background: #f6f5f2; color: #1a1917;
    min-height: 100dvh; display: flex; align-items: center; justify-content: center; margin: 0; padding: 24px; }
  div { text-align: center; max-width: 320px; }
  p { color: #8a867c; font-size: 14px; }
</style>
</head>
<body>
  <div>
    <h1>Academia não encontrada</h1>
    <p>Não há nenhuma academia com o endereço "${slug.replace(/[<>&"]/g, "")}".</p>
  </div>
</body>
</html>`;
}

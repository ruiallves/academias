import { Body, Controller, Get, Header, HttpCode, Param, Post, Req, Res } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Throttle } from "@nestjs/throttler";
import { IsEmail, IsIn, IsString, Length } from "class-validator";
import type { Request, Response } from "express";
import { Public } from "./auth.guard";
import { LandingService } from "../landing/landing.service";
import type { TenantRequest } from "../tenant/tenant";
import { PasswordResetService, type ResetOrigin } from "./password-reset.service";
import { renderPasswordReset, renderPasswordResetNotFound } from "./password-reset.template";

class RequestPasswordResetDto {
  @IsEmail({}, { message: "Endereço de email inválido" })
  email!: string;

  @IsString()
  @Length(1, 80)
  slug!: string;

  @IsIn(["console", "family", "invite"])
  from!: ResetOrigin;
}

/**
 * Repor a palavra-passe — o pedido e a página do link.
 *
 * Público pelas duas pontas: quem se esqueceu da palavra-passe não tem sessão, e
 * quem abre o link do email também não. O que autentica a troca é o token do
 * email, e esse é verificado pelo Supabase, não por nós.
 */
@Public()
@Controller()
export class PasswordResetController {
  constructor(
    private readonly reset: PasswordResetService,
    private readonly landing: LandingService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Pedir o link.
   *
   * 202 com o mesmo corpo, haja conta ou não — ver `PasswordResetService`. Cinco
   * por minuto por IP: chega a quem se enganou no endereço duas vezes e trava quem
   * usa isto para encher a caixa de correio de outra pessoa.
   */
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Post("api/palavra-passe/recuperar")
  @HttpCode(202)
  request(@Body() body: RequestPasswordResetDto) {
    this.reset.request(body.email, body.slug, body.from);
    return { ok: true };
  }

  /**
   * A página onde se escolhe a nova.
   *
   * `/l/:slug/repor-palavra-passe` em desenvolvimento, `{slug}.academias.pt/
   * repor-palavra-passe` em produção — o middleware do tenant traduz um no outro.
   */
  @Get("l/:slug/repor-palavra-passe")
  @Header("Content-Type", "text/html; charset=utf-8")
  @Header("Cache-Control", "no-store")
  async page(
    @Param("slug") slug: string,
    @Req() req: Request & TenantRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const academy = await this.landing.findBySlug(slug);
    if (!academy) {
      res.status(404);
      return renderPasswordResetNotFound();
    }

    // Onde vivem a consola e a app, vistas daqui — a mesma conta da landing.
    const tenant = req.tenantSlug ?? null;
    const familyBase = tenant ? "/app" : (this.config.get<string>("FAMILY_ORIGIN") ?? "http://localhost:5174");
    const consoleUrl = tenant ? "/consola" : (this.config.get<string>("CONSOLE_ORIGIN") ?? "http://localhost:5173");

    return renderPasswordReset({
      academy,
      consoleUrl,
      familyUrl: `${familyBase}/?academia=${encodeURIComponent(slug)}`,
      landingUrl: tenant ? "/" : `/l/${encodeURIComponent(slug)}`,
      supabaseUrl: this.config.getOrThrow<string>("SUPABASE_URL").replace(/\/$/, ""),
      supabaseAnonKey: this.config.getOrThrow<string>("SUPABASE_ANON_KEY"),
    });
  }
}

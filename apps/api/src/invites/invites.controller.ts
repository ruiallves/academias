import { Body, Controller, Delete, Get, Header, Param, Post, Req, Res } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Throttle } from "@nestjs/throttler";
import type { Request, Response } from "express";
import { Public, type AuthedRequest } from "../auth/auth.guard";
import { InvitesService } from "./invites.service";
import { AcceptInviteDto, CreateInviteDto } from "./invites.dto";
import { renderInvite, renderInviteError } from "./invite.template";
import type { TenantRequest } from "../tenant/tenant";

/**
 * Convites — do lado de quem convida.
 *
 * Controlador fino: quem pode fazer o quê é decidido no serviço, com `can()`, e
 * não aqui. Um controlador que decide permissões é um controlador que as decide de
 * forma diferente do próximo.
 */
@Controller("api/invites")
export class InvitesController {
  constructor(private readonly invites: InvitesService) {}

  /** Devolve o link uma única vez — não há forma de o voltar a ver. */
  @Post()
  async create(@Req() req: AuthedRequest, @Body() body: CreateInviteDto) {
    return this.invites.create(req.ctx, body);
  }

  @Get()
  async pending(@Req() req: AuthedRequest) {
    return this.invites.listPending(req.ctx);
  }

  @Delete(":id")
  async revoke(@Req() req: AuthedRequest, @Param("id") id: string) {
    await this.invites.revoke(req.ctx, id);
    return { ok: true };
  }
}

/**
 * Convites — do lado de quem resgata.
 *
 * Público por obrigação: quem chega aqui ainda não tem conta, logo não pode ter
 * token. Quem autentica o pedido é o próprio convite — 32 bytes aleatórios que só
 * existem no link enviado à pessoa. É a mesma lógica do webhook da euPago, que se
 * autentica pela assinatura e não por sessão.
 *
 * Falta aqui uma coisa para produção: **limite de tentativas por IP**. Sem ele, o
 * espaço de tokens é grande de mais para forçar, mas o endpoint de resgate é um
 * oráculo de passwords para contas que já existem — quem soubesse um convite podia
 * tentar passwords à vontade. Está anotado em `docs/03-estado.md`.
 */
@Public()
@Controller()
export class InvitePageController {
  constructor(
    private readonly invites: InvitesService,
    private readonly config: ConfigService,
  ) {}

  /**
   * A página de resgate.
   *
   * `/l/:slug/convite/:token` é o equivalente testável em desenvolvimento de
   * `{slug}.academias.pt/convite/:token` — o mesmo arranjo da landing. O slug do
   * URL não decide nada: a academia sai do token, e um slug errado no caminho não
   * muda o convite que se resolve.
   */
  @Get("l/:slug/convite/:token")
  @Header("Content-Type", "text/html; charset=utf-8")
  @Header("Cache-Control", "no-store")
  async page(
    @Param("token") token: string,
    @Req() req: Request & TenantRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    try {
      const preview = await this.invites.preview(token);

      /*
       * A consola, vista desta página.
       *
       * Quando o pedido chega por um domínio de clube, a consola é servida por
       * este mesmo servidor — o caminho `/consola` chega, e é mesma origem: sem
       * CORS, e o `sessionStorage` que o resgate escreve atravessa sozinho para
       * lá. `CONSOLE_ORIGIN` só é preciso em desenvolvimento, onde a consola tem
       * o seu próprio `vite dev` numa porta à parte.
       *
       * Faltou aqui na primeira versão: a landing (`landing.controller.ts`) já
       * tinha esta conta feita, mas a página de convite ficou com o valor antigo
       * — e sem ele, resgatar um convite em produção mandava sempre para
       * `localhost:5173`, o único sítio onde `CONSOLE_ORIGIN` nunca está definido.
       */
      const consoleUrl = req.tenantSlug ? "/consola" : (this.config.get<string>("CONSOLE_ORIGIN") ?? "http://localhost:5173");

      return renderInvite({
        preview,
        token,
        consoleUrl,
        supabaseUrl: this.config.getOrThrow<string>("SUPABASE_URL").replace(/\/$/, ""),
        supabaseAnonKey: this.config.getOrThrow<string>("SUPABASE_ANON_KEY"),
      });
    } catch {
      // Um convite gasto, expirado ou inventado dá exactamente a mesma página.
      res.status(404);
      return renderInviteError();
    }
  }

  /**
   * Resgatar o convite.
   *
   * Apertado a 5 tentativas por minuto e por IP. Quando o email já tem conta, o
   * resgate verifica a password contra o Supabase — sem este limite, era um
   * *oráculo de passwords* para forçar a conta de quem foi convidado. Cinco
   * tentativas cobrem o erro humano honesto; a milésima é ataque.
   */
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Post("api/convites/:token/aceitar")
  async accept(@Param("token") token: string, @Body() body: AcceptInviteDto) {
    return this.invites.accept(token, body.password, body.phone);
  }
}

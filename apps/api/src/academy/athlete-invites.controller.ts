import { Body, Controller, Delete, Get, Param, Post, Req, Res } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsOptional, IsString, Length } from "class-validator";
import type { Request, Response } from "express";
import { Public, type AuthedRequest } from "../auth/auth.guard";
import { AthleteInvitesService } from "./athlete-invites.service";

/** Os atletas escolhidos na lista — o envio em massa. */
class InviteAthletesDto {
  @IsArray()
  @ArrayMinSize(1, { message: "Escolhe pelo menos um atleta" })
  @ArrayMaxSize(200)
  @IsString({ each: true })
  ids!: string[];
}

/** O resgate: só a palavra-passe — o email e o nome são os da ficha. */
class RedeemAthleteInviteDto {
  @IsString() @Length(8, 200)
  password!: string;

  /** Aceita os documentos legais em vigor para as famílias (que cobrem os atletas). */
  @IsOptional() @IsBoolean()
  acceptLegal?: boolean;
}

/* -------------------------------------------------------------------------- */
/* Do lado do clube                                                             */
/* -------------------------------------------------------------------------- */

/**
 * O convite da app a um atleta — a ficha e a lista.
 *
 * Vive num controlador próprio e não no `AcademyController` pela mesma razão
 * dos sócios: é correio a sair em nome do clube, com um serviço e um
 * interruptor seus. As rotas ficam debaixo de `api/athletes` para quem lê a
 * API encontrar o convite ao lado da ficha.
 */
@Controller("api")
export class AthleteInvitesController {
  constructor(private readonly invites: AthleteInvitesService) {}

  /** (Re)enviar o convite — o botão da ficha. */
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post("athletes/:id/convite")
  enviar(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.invites.enviar(req.ctx, id);
  }

  /** (Re)enviar a vários — a acção em massa da lista de atletas. */
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Post("athletes/convites")
  enviarMuitos(@Req() req: AuthedRequest, @Body() body: InviteAthletesDto) {
    return this.invites.enviarMuitos(req.ctx, body.ids);
  }

  /** Desligar a conta da ficha — quando se ligou à pessoa errada. */
  @Delete("athletes/:id/conta")
  desligar(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.invites.desligarConta(req.ctx, id);
  }
}

/* -------------------------------------------------------------------------- */
/* Do lado do atleta — sem sessão                                               */
/* -------------------------------------------------------------------------- */

/**
 * O resgate do convite, antes de haver conta.
 *
 * `@Public()` não quer dizer "aberto": quer dizer que quem autentica é o token
 * do convite, resolvido pela escotilha `app.resolve_athlete_invite`. A mesma
 * forma dos convites de família e de sócio.
 */
@Public()
@Controller()
export class AthleteSignupController {
  constructor(private readonly invites: AthleteInvitesService) {}

  /**
   * O link que vai no email. Não serve nada: **redirecciona para a landing do
   * clube**, que é onde se instala a app, com o convite agarrado ao endereço.
   */
  @Get("l/:slug/atleta/:token")
  redirect(@Param("slug") slug: string, @Param("token") token: string, @Res() res: Response) {
    res.redirect(302, `/l/${encodeURIComponent(slug)}?atleta=${encodeURIComponent(token)}`);
  }

  /** De que clube — e de quem — é este convite. O primeiro pedido que a app faz. */
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @Get("api/convite-atleta/:token")
  preview(@Param("token") token: string) {
    return this.invites.convitePreview(token);
  }

  /** Criar a conta e ligá-la à ficha. Devolve a sessão — a app entra já dentro. */
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Post("api/convite-atleta/:token/registar")
  registar(@Param("token") token: string, @Body() body: RedeemAthleteInviteDto, @Req() req: Request) {
    const ua = req.headers["user-agent"];
    return this.invites.conviteRegistar(token, body.password, body.acceptLegal, {
      ip: req.ip,
      userAgent: typeof ua === "string" ? ua : undefined,
    });
  }
}

import { Body, Controller, Get, Headers, Param, Post, Res } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { IsIn, IsOptional, IsString, Length } from "class-validator";
import type { Response } from "express";
import { Public } from "../auth/auth.guard";
import { ClubAppService } from "./club-app.service";

class PagarQuotaDto {
  @IsIn(["MBWAY", "MULTIBANCO"])
  method!: string;

  @IsOptional()
  @IsString()
  @Length(9, 20)
  phone?: string;
}

class VotarDto {
  @IsString() @Length(1, 60)
  optionId!: string;
}

class RegistarSocioDto {
  @IsString() @Length(8, 200)
  password!: string;
}

/**
 * A app do clube — os endpoints que não passam pelo guard.
 *
 * `@Public()` aqui não quer dizer "aberto": quer dizer que a autenticação é
 * outra. O guard global exige uma `Membership`, e um sócio pode não ter nenhuma
 * — a decisão de quem entra é do serviço, que verifica o JWT e exige a ficha de
 * sócio reclamada. Ver o cabeçalho de `ClubAppService`.
 *
 * O slug vem no mesmo cabeçalho `x-academy-slug` que o resto da app já manda —
 * o cliente HTTP não muda de forma consoante o contexto.
 */
@Public()
@Controller()
export class ClubAppController {
  constructor(private readonly app: ClubAppService) {}

  /** Que contextos tem esta conta neste clube. A primeira pergunta pós-login. */
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @Get("api/app/contexts")
  contexts(@Headers("authorization") auth: string, @Headers("x-academy-slug") slug: string) {
    return this.app.contexts(auth, slug ?? "");
  }

  /** A Member View inteira, numa ida. */
  @Get("api/socio/inicio")
  inicio(@Headers("authorization") auth: string, @Headers("x-academy-slug") slug: string) {
    return this.app.inicio(auth, slug ?? "");
  }

  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post("api/socio/quotas/:id/pagar")
  pagar(
    @Headers("authorization") auth: string,
    @Headers("x-academy-slug") slug: string,
    @Param("id") id: string,
    @Body() body: PagarQuotaDto,
  ) {
    return this.app.pagarQuota(auth, slug ?? "", id, body.method, body.phone);
  }

  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @Post("api/socio/sondagens/:id/votar")
  votar(
    @Headers("authorization") auth: string,
    @Headers("x-academy-slug") slug: string,
    @Param("id") id: string,
    @Body() body: VotarDto,
  ) {
    return this.app.votar(auth, slug ?? "", id, body.optionId);
  }

  /* ------------------------------------------------------------------------ */
  /* O convite de sócio — sem sessão                                           */
  /* ------------------------------------------------------------------------ */

  /**
   * O link do email. Como o das famílias: redirecciona para a landing do clube
   * com o token agarrado, e é lá que se instala a app e se continua.
   */
  @Get("l/:slug/socio/:token")
  redirect(@Param("slug") slug: string, @Param("token") token: string, @Res() res: Response) {
    res.redirect(302, `/l/${encodeURIComponent(slug)}?socio=${encodeURIComponent(token)}`);
  }

  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @Get("api/convite-socio/:token")
  preview(@Param("token") token: string) {
    return this.app.convitePreview(token);
  }

  /** Escolher a password e reclamar a ficha. Devolve a sessão — entra já dentro. */
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Post("api/convite-socio/:token/registar")
  registar(@Param("token") token: string, @Body() body: RegistarSocioDto) {
    return this.app.conviteRegistar(token, body.password);
  }
}

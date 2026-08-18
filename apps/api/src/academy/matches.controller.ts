import { Body, Controller, Get, Param, Patch, Post, Query, Req } from "@nestjs/common";
import { ArrayMaxSize, IsArray, IsInt, IsString, Max, Min } from "class-validator";
import type { AuthedRequest } from "../auth/auth.guard";
import { MatchesService } from "./matches.service";

/**
 * Corpos validados. Classes e não interfaces — ver `invites.dto.ts` para o porquê.
 */
class SaveCallUpsDto {
  @IsArray()
  @ArrayMaxSize(60)
  @IsString({ each: true })
  athleteIds!: string[];
}

class SetMaxDto {
  @IsInt()
  @Min(1)
  @Max(60)
  max!: number;
}

/**
 * Jogos e convocatórias.
 *
 * Controlador fino: quem pode o quê decide-se no serviço, com `can()` e
 * `teamScopeFilter`. Um treinador só chega aos jogos das equipas dele porque o
 * âmbito é aplicado lá, e não porque a interface só lhe mostra esses.
 */
@Controller("api/matches")
export class MatchesController {
  constructor(private readonly matches: MatchesService) {}

  @Get()
  list(@Req() req: AuthedRequest, @Query("from") from?: string, @Query("to") to?: string) {
    return this.matches.list(req.ctx, from ? new Date(from) : undefined, to ? new Date(to) : undefined);
  }

  /** Atletas de escalões inferiores elegíveis para subir a este jogo. */
  @Get(":id/convidados-elegiveis")
  guestPool(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.matches.guestPool(req.ctx, id);
  }

  /** Guardar não avisa ninguém. Só submeter avisa. */
  @Post(":id/convocatoria")
  save(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: SaveCallUpsDto) {
    return this.matches.saveCallUps(req.ctx, id, body.athleteIds);
  }

  @Post(":id/convocatoria/submeter")
  submit(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.matches.submitCallUps(req.ctx, id);
  }

  @Post(":id/convocatoria/reabrir")
  reopen(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.matches.reopenCallUps(req.ctx, id);
  }

  @Patch("equipas/:teamId/max-convocados")
  setMax(@Req() req: AuthedRequest, @Param("teamId") teamId: string, @Body() body: SetMaxDto) {
    return this.matches.setMaxCallUps(req.ctx, teamId, body.max);
  }
}

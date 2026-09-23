import { Body, Controller, Delete, Get, Param, Post, Query, Req } from "@nestjs/common";
import { IsOptional, IsString, Length } from "class-validator";
import type { AuthedRequest } from "../auth/auth.guard";
import { GuardianLinksService } from "./guardian-links.service";

class LigarEncarregadoDto {
  /** A conta escolhida na lista — é o `userId`, porque o que se liga é a pessoa. */
  @IsString() @Length(1, 60)
  userId!: string;

  /** "Mãe", "Pai", "Avó" — texto livre, como em toda a parte da família. */
  @IsOptional() @IsString() @Length(0, 40)
  relation?: string;
}

/**
 * Os encarregados de um atleta, da ficha do atleta.
 *
 * Vive no módulo da família e não em `academy.controller` porque é o mesmo
 * assunto do registo pelo link: quem responde por esta criança. A prova é que é
 * outra — ali é o par NIF + data de nascimento que a família escreve, aqui é o
 * clube a apontar para uma conta que já conhece.
 */
@Controller("api/athletes/:athleteId/encarregados")
export class GuardianLinksController {
  constructor(private readonly links: GuardianLinksService) {}

  /** As contas do clube que podem passar a encarregadas deste atleta. */
  @Get("candidatos")
  candidatos(
    @Req() req: AuthedRequest,
    @Param("athleteId") athleteId: string,
    @Query("q") q?: string,
  ) {
    return this.links.candidatos(req.ctx, athleteId, q ?? "");
  }

  @Post()
  ligar(@Req() req: AuthedRequest, @Param("athleteId") athleteId: string, @Body() body: LigarEncarregadoDto) {
    return this.links.ligar(req.ctx, athleteId, body.userId, body.relation ?? "");
  }

  @Delete(":membershipId")
  desligar(
    @Req() req: AuthedRequest,
    @Param("athleteId") athleteId: string,
    @Param("membershipId") membershipId: string,
  ) {
    return this.links.desligar(req.ctx, athleteId, membershipId);
  }
}

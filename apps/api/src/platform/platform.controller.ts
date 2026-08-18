import { Body, Controller, Get, Ip, Post, Query, Req, UseGuards } from "@nestjs/common";
import { IsEmail, IsInt, IsOptional, IsString, Length, Matches, Max, Min } from "class-validator";
import { Public } from "../auth/auth.guard";
import { PlatformGuard, PlatformRoles, type PlatformRequest } from "./platform.guard";
import { PlatformService } from "./platform.service";

/**
 * O corpo de "criar academia", validado. Classe e não interface — ver
 * `invites.dto.ts`. O `slug` é restringido a `[a-z0-9-]` aqui e o serviço volta a
 * validar; a defesa em profundidade impede que um slug com `.` ou `/` chegue a ser
 * usado num subdomínio ou num caminho.
 */
class CreateAcademyDto {
  @IsString()
  @Length(3, 120)
  name!: string;

  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9-]{3,40}$/, { message: "Endereço inválido" })
  slug?: string;

  @IsString()
  @Length(2, 120)
  directorName!: string;

  @IsEmail()
  @Length(3, 254)
  directorEmail!: string;

  @IsOptional()
  @IsString()
  planId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  trialDays?: number;
}

/**
 * O painel da plataforma.
 *
 * `@Public()` desliga o guard **das academias** — que exigiria um slug de academia
 * que aqui não existe — e `@UseGuards(PlatformGuard)` põe o desta no lugar dele.
 * As rotas não ficam abertas: ficam com outra porta.
 *
 * É o único sítio do servidor onde isto se faz, e por isso está dito em voz alta:
 * ver `@Public()` num controlador é normalmente sinal de que algo está aberto, e
 * aqui não está.
 */
@Public()
@UseGuards(PlatformGuard)
@Controller("api/platform")
export class PlatformController {
  constructor(private readonly platform: PlatformService) {}

  /** Quem sou eu, do lado da plataforma. A app usa-o para arrancar. */
  @Get("me")
  me(@Req() req: PlatformRequest) {
    const { id, name, email, role, mfaEnrolledAt } = req.admin;
    return { id, name, email, role, mfaEnabled: mfaEnrolledAt !== null };
  }

  @Get("overview")
  overview() {
    return this.platform.overview();
  }

  @Get("academies")
  academies() {
    return this.platform.academies();
  }

  @Get("series")
  series(@Query("months") months?: string) {
    return this.platform.series(Math.min(Number(months) || 12, 36));
  }

  @Get("plans")
  plans() {
    return this.platform.plans();
  }

  @Get("audit")
  audit(@Query("limit") limit?: string) {
    return this.platform.auditLog(Number(limit) || 100);
  }

  /**
   * Criar academia e convidar o diretor.
   *
   * Fechado a `SUPPORT`: quem dá apoio lê e acompanha, não cria clientes nem mexe
   * em faturação. É a diferença entre poder ajudar e poder decidir.
   */
  @Post("academies")
  @PlatformRoles("OWNER", "ADMIN")
  createAcademy(@Req() req: PlatformRequest, @Ip() ip: string, @Body() body: CreateAcademyDto) {
    return this.platform.createAcademy(req.admin, body, ip);
  }
}

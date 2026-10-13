import { Body, Controller, Delete, Get, Ip, Param, Put, Req, UseGuards } from "@nestjs/common";
import { IsOptional, IsString, Length, Matches } from "class-validator";
import { Public } from "../auth/auth.guard";
import { PlatformGuard, PlatformRoles, type PlatformRequest } from "../platform/platform.guard";
import { SiteDominioService } from "./site-dominio.service";

class LigarDominioDto {
  @IsString() @Length(4, 200) dominio!: string;
  /** AAAA-MM-DD. Quando o registo do domínio se renova. */
  @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) renovaEm?: string | null;
}

/**
 * O domínio do site de um clube, no painel da plataforma. Ver `SiteDominioService`.
 * Mesmo guarda e mesmo prefixo do resto do painel (`platform.controller.ts`).
 */
@Public()
@UseGuards(PlatformGuard)
@Controller("api/platform")
export class SiteDominioController {
  constructor(private readonly dominio: SiteDominioService) {}

  @Get("academies/:id/site-dominio")
  ler(@Param("id") id: string) {
    return this.dominio.ler(id);
  }

  @Put("academies/:id/site-dominio")
  @PlatformRoles("OWNER", "ADMIN")
  ligar(@Req() req: PlatformRequest, @Ip() ip: string, @Param("id") id: string, @Body() body: LigarDominioDto) {
    return this.dominio.ligar(req.admin, id, body.dominio, body.renovaEm ?? null, ip);
  }

  @Delete("academies/:id/site-dominio")
  @PlatformRoles("OWNER", "ADMIN")
  desligar(@Req() req: PlatformRequest, @Ip() ip: string, @Param("id") id: string) {
    return this.dominio.desligar(req.admin, id, ip);
  }
}

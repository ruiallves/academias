import { IsOptional, IsString, Length } from "class-validator";
import { Body, Controller, Get, Param, Post, Req, UseGuards } from "@nestjs/common";
import { Public } from "../auth/auth.guard";
import { PlatformGuard, PlatformRoles, type PlatformRequest } from "./platform.guard";
import { EmblemasPropostosService } from "./emblemas.service";

class RejeitarDto {
  @IsOptional() @IsString() @Length(0, 300) nota?: string;
}

/**
 * Os emblemas carregados pelos clubes, para rever no painel. O mesmo par
 * `@Public()` + `@UseGuards(PlatformGuard)` dos outros controladores da
 * plataforma: quem entra é dos nossos, sem academia no contexto.
 */
@Public()
@UseGuards(PlatformGuard)
@PlatformRoles("OWNER", "ADMIN", "SUPPORT")
@Controller("api/platform/emblemas")
export class EmblemasPropostosController {
  constructor(private readonly emblemas: EmblemasPropostosService) {}

  @Get()
  listar() {
    return this.emblemas.listar();
  }

  @Post(":id/aprovar")
  aprovar(@Req() req: PlatformRequest, @Param("id") id: string) {
    return this.emblemas.aprovar(req.admin, id);
  }

  @Post(":id/rejeitar")
  rejeitar(@Req() req: PlatformRequest, @Param("id") id: string, @Body() dto: RejeitarDto) {
    return this.emblemas.rejeitar(req.admin, id, dto.nota);
  }
}

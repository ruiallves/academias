import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Req } from "@nestjs/common";
import type { AuthedRequest } from "../auth/auth.guard";
import { LogotipoDto, OrdemDosPatrocinadoresDto, PatrocinadorDaGestaoDto } from "./patrocinadores.dto";
import { PatrocinadoresService } from "./patrocinadores.service";

/** Gestão → Patrocinadores. As permissões vivem no serviço, como nos outros módulos. */
@Controller("api/patrocinadores")
export class PatrocinadoresController {
  constructor(private readonly patrocinadores: PatrocinadoresService) {}

  @Get()
  listar(@Req() req: AuthedRequest) {
    return this.patrocinadores.listar(req.ctx);
  }

  @Post()
  criar(@Req() req: AuthedRequest, @Body() dto: PatrocinadorDaGestaoDto) {
    return this.patrocinadores.criar(req.ctx, dto);
  }

  @Put("ordem")
  ordenar(@Req() req: AuthedRequest, @Body() dto: OrdemDosPatrocinadoresDto) {
    return this.patrocinadores.ordenar(req.ctx, dto.ids);
  }

  @Post("logotipo")
  assinarLogotipo(@Req() req: AuthedRequest, @Body() dto: LogotipoDto) {
    return this.patrocinadores.assinarLogotipo(req.ctx, dto.contentType);
  }

  @Patch(":id")
  editar(@Req() req: AuthedRequest, @Param("id") id: string, @Body() dto: PatrocinadorDaGestaoDto) {
    return this.patrocinadores.editar(req.ctx, id, dto);
  }

  @Delete(":id")
  apagar(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.patrocinadores.apagar(req.ctx, id);
  }
}

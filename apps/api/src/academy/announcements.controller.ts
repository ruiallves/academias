import { Body, Controller, Delete, Get, Param, Patch, Post, Req } from "@nestjs/common";
import type { AuthedRequest } from "../auth/auth.guard";
import { AnnouncementsService } from "./announcements.service";
import { CreateAnnouncementDto, UpdateAnnouncementDto } from "./announcements.dto";

/**
 * Comunicações.
 *
 * Controlador fino, como os outros: quem decide o público e o âmbito é o serviço,
 * com `can()` e `teamScopeFilter`. Ambas as rotas passam pelo `AuthGuard`.
 */
@Controller("api/announcements")
export class AnnouncementsController {
  constructor(private readonly announcements: AnnouncementsService) {}

  @Get()
  list(@Req() req: AuthedRequest) {
    return this.announcements.list(req.ctx);
  }

  /** Publicar. A permissão (`comms:write`) e o público permitido são verificados no serviço. */
  @Post()
  create(@Req() req: AuthedRequest, @Body() body: CreateAnnouncementDto) {
    return this.announcements.create(req.ctx, body);
  }

  /** Editar o texto de um aviso — alinha as notificações na app. */
  @Patch(":id")
  update(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: UpdateAnnouncementDto) {
    return this.announcements.update(req.ctx, id, body);
  }

  /** Eliminar um aviso e as notificações na app que dele nasceram. */
  @Delete(":id")
  remove(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.announcements.remove(req.ctx, id);
  }
}

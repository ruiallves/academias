import { Body, Controller, Get, Patch, Req } from "@nestjs/common";
import { ArrayMaxSize, IsArray, IsString } from "class-validator";
import type { AuthedRequest } from "../auth/auth.guard";
import { NotificationsService } from "./notifications.service";

class MarkReadDto {
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  ids!: string[];
}

/**
 * As notificações de quem está a ler.
 *
 * Sem âmbito nem permissão a verificar: uma notificação **é** de uma pessoa, e o
 * `userId` vem do token, nunca do pedido. Não há forma de pedir as de outro.
 *
 * O push é o empurrão; isto é o histórico. Um telemóvel que estava desligado, uma
 * permissão negada, uma notificação lida de passagem — a lista continua cá, e é
 * dela que a app vive quando abre.
 */
@Controller("api/notifications")
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@Req() req: AuthedRequest) {
    return this.notifications.listForUser(req.ctx.userId, req.ctx.academyId);
  }

  /** Marca como lidas. Idempotente: marcar duas vezes não muda a data da primeira. */
  @Patch("read")
  markRead(@Req() req: AuthedRequest, @Body() body: MarkReadDto) {
    return this.notifications.markRead(req.ctx.userId, req.ctx.academyId, body.ids);
  }
}

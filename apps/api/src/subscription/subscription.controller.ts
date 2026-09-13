import { Body, Controller, Get, Ip, Post, Req } from "@nestjs/common";
import type { AuthedRequest } from "../auth/auth.guard";
import { SubscriptionOrdersService } from "./subscription-orders.service";

/**
 * As condições comerciais, do lado do clube.
 *
 * Ler é para quem entra na consola; assinar é para quem representa o clube
 * (`legal:club`), e isso decide-se no serviço. Aqui não há token nenhum: quem
 * assina está autenticado, que é o que faz a assinatura valer alguma coisa.
 */
@Controller("api/subscricao")
export class SubscriptionController {
  constructor(private readonly ordens: SubscriptionOrdersService) {}

  @Get("ordem")
  ordem(@Req() req: AuthedRequest) {
    return this.ordens.paraAConsola(req.ctx);
  }

  @Post("ordem/assinar")
  assinar(@Req() req: AuthedRequest, @Ip() ip: string) {
    const ua = req.headers["user-agent"];
    return this.ordens.assinar(req.ctx, { ip, userAgent: typeof ua === "string" ? ua : undefined });
  }
}

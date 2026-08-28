import { Controller, HttpCode, Post, Req } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { AuthedRequest } from "../auth/auth.guard";
import { PresenceService } from "./presence.service";

/**
 * O sinal de vida do separador aberto.
 *
 * ## Porque é que é preciso um endpoint só para isto
 *
 * Porque o guard já marca presença a cada pedido, e isso sozinho contava mal.
 * Nem a consola nem a app da família fazem sondagens — abrem, carregam o
 * arranque, e depois ficam caladas. Quem passa dez minutos a ler o plantel ou a
 * preencher uma ficha de jogo não gera pedido nenhum nesse tempo, e caía da
 * janela de presença enquanto estava, literalmente, a olhar para o produto.
 *
 * Este pedido é o mais barato que há na API: não lê a base de dados, não escreve
 * nada, e responde 204 sem corpo. O trabalho todo é o `Map.set` do guard, que já
 * aconteceu antes de chegar aqui.
 *
 * ## O tecto
 *
 * O cliente bate de 45 em 45 segundos. Sessenta por minuto deixa uma margem
 * larga para reentrâncias — várias abas, um `visibilitychange` a disparar junto
 * com o intervalo — e continua a travar um cliente avariado em ciclo apertado.
 */
@Controller("api/presence")
export class PresenceController {
  constructor(private readonly presence: PresenceService) {}

  @Post()
  @HttpCode(204)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  ping(@Req() req: AuthedRequest): void {
    const { membershipId, academyId, role } = req.ctx;
    this.presence.marcar(membershipId, academyId, role);
  }
}

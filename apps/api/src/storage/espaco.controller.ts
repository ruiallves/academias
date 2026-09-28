import { Controller, ForbiddenException, Get, Req } from "@nestjs/common";
import type { AuthedRequest } from "../auth/auth.guard";
import { EspacoService } from "./espaco.service";

/**
 * O espaço de ficheiros do clube, para as Definições da consola.
 *
 * Aberto a quem trabalha no clube, e só a esses: são contagens e tamanhos, sem
 * nome de ninguém, e quem carrega fotografias precisa de saber que o limite
 * está perto antes de o carregamento ser recusado. As famílias e os atletas não
 * gerem os ficheiros do clube.
 */
@Controller("api/espaco")
export class EspacoController {
  constructor(private readonly espaco: EspacoService) {}

  @Get()
  doClube(@Req() req: AuthedRequest) {
    if (req.ctx.role === "GUARDIAN" || req.ctx.role === "ATHLETE") {
      throw new ForbiddenException("Sem acesso ao espaço do clube");
    }
    return this.espaco.doClube(req.ctx.academyId);
  }
}

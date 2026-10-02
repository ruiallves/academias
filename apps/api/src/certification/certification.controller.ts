import { Body, Controller, Delete, Get, Param, Put, Req } from "@nestjs/common";
import type { AuthedRequest } from "../auth/auth.guard";
import { AnswerDto, ProfileDto } from "./certification.dto";
import { CertificationService } from "./certification.service";

/**
 * Certificação FPF.
 *
 * Uma leitura que traz tudo — nível, tetos, pontos e os requisitos com o estado
 * de cada um — e três escritas pequenas. Como no resto do produto, quem
 * verifica permissões é o serviço.
 */
@Controller("api/certification")
export class CertificationController {
  constructor(private readonly certification: CertificationService) {}

  @Get()
  resumo(@Req() req: AuthedRequest) {
    return this.certification.resumo(req.ctx);
  }

  @Put("profile")
  guardarPerfil(@Req() req: AuthedRequest, @Body() dto: ProfileDto) {
    return this.certification.guardarPerfil(req.ctx, dto);
  }

  @Put("answers/:code")
  responder(@Req() req: AuthedRequest, @Param("code") code: string, @Body() dto: AnswerDto) {
    return this.certification.responder(req.ctx, code, dto);
  }

  /** Apagar a resposta devolve o requisito ao cálculo da plataforma. */
  @Delete("answers/:code")
  apagarResposta(@Req() req: AuthedRequest, @Param("code") code: string) {
    return this.certification.apagarResposta(req.ctx, code);
  }
}

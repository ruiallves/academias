import { Body, Controller, Get, Ip, Param, Post, Req } from "@nestjs/common";
import { IsBoolean, IsString, Length, Matches } from "class-validator";
import type { AuthedRequest } from "../auth/auth.guard";
import { SubscriptionOrdersService } from "./subscription-orders.service";

/**
 * O que quem assina escreve: a instituição e quem a representa.
 *
 * A forma confere-se aqui; o que decide se os dados valem — o dígito de
 * controlo dos NIF, a maioridade — está em `validarDeclaracao`, para os testes
 * a poderem exercitar sem levantar o Nest.
 */
class AssinarCondicoesDto {
  @IsString() @Length(3, 160)
  institutionName!: string;

  @IsString() @Length(9, 15)
  institutionTaxId!: string;

  @IsString() @Length(3, 160)
  signerName!: string;

  @IsString() @Length(9, 15)
  signerTaxId!: string;

  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: "Data de nascimento inválida" })
  signerBirthdate!: string;

  @IsBoolean()
  accepted!: boolean;
}

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
  assinar(@Req() req: AuthedRequest, @Ip() ip: string, @Body() body: AssinarCondicoesDto) {
    const ua = req.headers["user-agent"];
    return this.ordens.assinar(req.ctx, body, { ip, userAgent: typeof ua === "string" ? ua : undefined });
  }

  /** A declaração de aceitação em PDF — ver `declaracaoParaAConsola`. */
  @Get("ordem/:id/declaracao")
  declaracao(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.ordens.declaracaoParaAConsola(req.ctx, id);
  }
}

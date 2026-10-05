import { Body, Controller, Get, Ip, Param, Post, Req } from "@nestjs/common";
import { IsBoolean, IsString, Length, Matches } from "class-validator";
import { LegalExempt, SuspensionExempt, type AuthedRequest } from "../auth/auth.guard";
import { SubscriptionOrdersService } from "./subscription-orders.service";
import { SubscriptionPaymentsService } from "./subscription-payments.service";

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

/** O telemóvel do MB WAY. A forma confere-se no serviço, que tira espaços e indicativo. */
class MbwayDto {
  @IsString() @Length(9, 20)
  phone!: string;
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
  constructor(
    private readonly ordens: SubscriptionOrdersService,
    private readonly pagamentos: SubscriptionPaymentsService,
  ) {}

  /*
   * As condições passam num clube suspenso: sem as aceitar não se paga, e
   * pagar é a única saída da suspensão.
   */
  @Get("ordem")
  @SuspensionExempt()
  ordem(@Req() req: AuthedRequest) {
    return this.ordens.paraAConsola(req.ctx);
  }

  @Post("ordem/assinar")
  @SuspensionExempt()
  assinar(@Req() req: AuthedRequest, @Ip() ip: string, @Body() body: AssinarCondicoesDto) {
    const ua = req.headers["user-agent"];
    return this.ordens.assinar(req.ctx, body, { ip, userAgent: typeof ua === "string" ? ua : undefined });
  }

  /** A declaração de aceitação em PDF — ver `declaracaoParaAConsola`. */
  @Get("ordem/:id/declaracao")
  @SuspensionExempt()
  declaracao(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.ordens.declaracaoParaAConsola(req.ctx, id);
  }

  /*
   * A mensalidade da plataforma.
   *
   * Estas três passam num clube suspenso (`@SuspensionExempt()`) e com
   * documentos por aceitar (`@LegalExempt()`): são a única porta de saída da
   * suspensão, e fechá-la atrás de outro gate era uma porta que não abre.
   */

  @Get("mensalidade")
  @LegalExempt()
  @SuspensionExempt()
  mensalidade(@Req() req: AuthedRequest) {
    return this.pagamentos.estadoParaAConsola(req.ctx);
  }

  @Post("mensalidade/:id/multibanco")
  @LegalExempt()
  @SuspensionExempt()
  multibanco(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.pagamentos.multibanco(req.ctx, id);
  }

  @Get("mensalidade/:id/fatura")
  @LegalExempt()
  @SuspensionExempt()
  fatura(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.pagamentos.faturaParaAConsola(req.ctx, id);
  }

  @Post("mensalidade/:id/mbway")
  @LegalExempt()
  @SuspensionExempt()
  mbway(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: MbwayDto) {
    return this.pagamentos.mbway(req.ctx, id, body.phone);
  }
}

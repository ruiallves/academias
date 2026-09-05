import { Body, Controller, Delete, Get, Param, Post, Query, Req } from "@nestjs/common";
import { IsEnum, IsOptional, IsString, Length, Matches } from "class-validator";
import { PaymentMethod } from "@prisma/client";
import type { Request } from "express";
import { BillingService } from "./billing.service";
import { EupagoFeesService } from "./eupago-fees";
import type { RequestContext } from "../common/permissions";

class StartPaymentDto {
  @IsEnum(PaymentMethod)
  method!: PaymentMethod;

  /** Obrigatório em MB Way. Nunca se recebe o valor — esse vem da base de dados. */
  @IsOptional()
  @IsString()
  @Matches(/^\+?\d{9,15}$/, { message: "Número de telemóvel inválido" })
  payerPhone?: string;
}

class CreateMandateDto {
  /** Validado a sério no serviço (mod-97); aqui só a forma. */
  @IsString()
  @Matches(/^[A-Za-z]{2}[\s0-9A-Za-z]{12,40}$/, { message: "IBAN inválido" })
  iban!: string;

  @IsString()
  @Length(3, 120)
  name!: string;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9]{8,11}$/, { message: "BIC inválido" })
  bic?: string;
}

@Controller("billing")
export class BillingController {
  constructor(
    private readonly billing: BillingService,
    private readonly fees: EupagoFeesService,
  ) {}

  /**
   * As taxas da euPago, para os ecrãs de preços fazerem a conta.
   *
   * Público dentro da academia — quem define preços precisa disto, e quem
   * define preços é meia dúzia de papéis diferentes (direcção, secretaria,
   * quem gere sócios). Não há aqui nada de sensível: são preços de balcão,
   * publicados no site da euPago.
   *
   * A conta faz-se no cliente e não aqui, de propósito: o valor muda a cada
   * tecla no input, e uma ida ao servidor por tecla seria absurda. O que vem
   * daqui é a **tabela**; a fórmula é a mesma dos dois lados (ver `liquidoDe`).
   */
  @Get("fees")
  eupagoFees() {
    return this.fees.tabela();
  }

  @Get("charges")
  listCharges(@Req() req: Request, @Query("period") period: string) {
    return this.billing.listCharges(ctx(req), period ?? currentPeriod());
  }

  /**
   * Inicia o pagamento. Devolve o que a app precisa de mostrar — referência
   * Multibanco ou confirmação de que o pedido MB Way seguiu — e nada mais.
   *
   * Repara no que **não** existe: nenhum endpoint que marque um pagamento como
   * concluído. Esse caminho é só do webhook.
   */
  @Post("charges/:id/pay")
  startPayment(@Req() req: Request, @Param("id") id: string, @Body() dto: StartPaymentDto) {
    return this.billing.startPayment(ctx(req), id, dto.method, dto.payerPhone);
  }

  /* ------------------------------------------------------------------------ */
  /* Débito directo — o mandato do próprio                                     */
  /* ------------------------------------------------------------------------ */

  /** O mandato de quem pergunta — nunca o de outra pessoa. */
  @Get("mandate")
  getMandate(@Req() req: Request) {
    return this.billing.getMandate(ctx(req));
  }

  /**
   * Autorizar o débito directo. O IBAN segue para a euPago e **não fica** na
   * nossa base — guardam-se os últimos 4 dígitos e a referência do mandato.
   */
  @Post("mandate")
  createMandate(@Req() req: Request, @Body() dto: CreateMandateDto) {
    return this.billing.createMandate(ctx(req), dto);
  }

  @Delete("mandate")
  cancelMandate(@Req() req: Request) {
    return this.billing.cancelMandate(ctx(req));
  }
}

/** Preenchido pelo guard de autenticação a partir do JWT do Supabase + Membership. */
function ctx(req: Request): RequestContext {
  return (req as Request & { ctx: RequestContext }).ctx;
}

function currentPeriod(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

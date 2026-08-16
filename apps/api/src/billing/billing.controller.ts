import { Body, Controller, Get, Param, Post, Query, Req } from "@nestjs/common";
import { IsEnum, IsOptional, IsString, Matches } from "class-validator";
import { PaymentMethod } from "@prisma/client";
import type { Request } from "express";
import { BillingService } from "./billing.service";
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

@Controller("billing")
export class BillingController {
  constructor(private readonly billing: BillingService) {}

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
}

/** Preenchido pelo guard de autenticação a partir do JWT do Supabase + Membership. */
function ctx(req: Request): RequestContext {
  return (req as Request & { ctx: RequestContext }).ctx;
}

function currentPeriod(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

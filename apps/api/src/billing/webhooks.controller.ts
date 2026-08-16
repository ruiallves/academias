import { Body, Controller, Headers, HttpCode, Logger, Post, Req, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";
import { Public } from "../auth/auth.guard";
import { PrismaService } from "../prisma/prisma.service";
import { BillingService } from "./billing.service";
import { EupagoClient } from "./eupago.client";

/**
 * O webhook da euPago — a única fonte de verdade sobre pagamentos.
 *
 * A ordem dos passos não é arbitrária:
 *
 *  1. verificar a assinatura (senão qualquer pessoa liquida mensalidades);
 *  2. gravar o evento em bruto **antes** de o interpretar — se o passo 3 rebentar,
 *     o evento não se perde e pode ser reprocessado;
 *  3. processar, de forma idempotente;
 *  4. responder 200 depressa. A euPago reenvia o que demorar, e um reenvio que
 *     encontre o passo 3 já feito tem de ser inofensivo.
 *
 * Esta rota é pública de propósito (não tem sessão de utilizador); a autenticação
 * é a assinatura HMAC.
 */
@Public()
@Controller("webhooks/eupago")
export class EupagoWebhookController {
  private readonly log = new Logger(EupagoWebhookController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly billing: BillingService,
    private readonly eupago: EupagoClient,
  ) {}

  @Post()
  @HttpCode(200)
  async handle(
    @Req() req: Request,
    @Body() payload: Record<string, unknown>,
    @Headers("x-eupago-signature") signature?: string,
  ) {
    // Os bytes exactos que chegaram, preservados em main.ts. Reserializar o JSON
    // reordenaria chaves e invalidaria a assinatura.
    const raw = (req as Request & { rawBody?: string }).rawBody;
    if (!raw) throw new UnauthorizedException("Corpo em bruto indisponível");

    if (!this.eupago.verifySignature(raw, signature)) {
      this.log.warn("Webhook com assinatura inválida — ignorado");
      throw new UnauthorizedException();
    }

    const eventId = String(payload.transacao ?? payload.identificador ?? "");
    if (!eventId) return { ok: true, ignored: "sem identificador" };

    // Idempotência na porta de entrada: o índice único de (provider, eventId)
    // faz o segundo pedido cair aqui sem tocar em nada.
    const existing = await this.prisma.webhookEvent.findUnique({
      where: { provider_eventId: { provider: "eupago", eventId } },
    });
    if (existing?.processedAt) return { ok: true, duplicate: true };

    const event =
      existing ??
      (await this.prisma.webhookEvent.create({
        data: { provider: "eupago", eventId, signature, payload: payload as object },
      }));

    try {
      const providerRef = String(payload.referencia ?? payload.identificador ?? "");
      const status = String(payload.estado ?? "").toLowerCase();

      if (status === "paga" || status === "pago" || payload.sucesso === true) {
        const paidAt = payload.data ? new Date(String(payload.data)) : new Date();
        await this.billing.confirmPayment(providerRef, paidAt, payload);
      } else {
        await this.billing.failPayment(providerRef, "O pagamento foi recusado ou expirou.", payload);
      }

      await this.prisma.webhookEvent.update({
        where: { id: event.id },
        data: { processedAt: new Date(), error: null },
      });

      return { ok: true };
    } catch (error) {
      // Guardamos o erro e respondemos 200 na mesma: o evento está gravado e é
      // reprocessável por nós. Devolver 500 só faria a euPago repetir contra um
      // bug que a repetição não resolve.
      await this.prisma.webhookEvent.update({
        where: { id: event.id },
        data: { error: String(error) },
      });
      this.log.error(`Falha a processar o evento ${eventId}: ${error}`);
      return { ok: true, deferred: true };
    }
  }
}

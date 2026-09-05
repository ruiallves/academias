import { Body, Controller, Headers, HttpCode, Logger, Post, Req, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";
import { Public } from "../auth/auth.guard";
import { PrismaService } from "../prisma/prisma.service";
import { BillingService } from "./billing.service";
import { EupagoClient } from "./eupago.client";

/**
 * O webhook da euPago (Realtime Webhooks 2.0) — a única fonte de verdade sobre
 * pagamentos.
 *
 * ## O formato
 *
 * A euPago envia um POST JSON com um objecto `transactions` — `identifier` (o
 * nosso id de Payment, que lhe enviámos ao criar), `reference`, `trid`,
 * `amount.value` em euros, `status` em `PAID | REFUND | ERROR | CANCEL |
 * EXPIRED` — e o header `X-Signature` com o HMAC-SHA256 do corpo em base64.
 *
 * ## A ordem dos passos não é arbitrária
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
    @Headers("x-signature") signature?: string,
  ) {
    // Os bytes exactos que chegaram, preservados em main.ts. Reserializar o JSON
    // reordenaria chaves e invalidaria a assinatura.
    const raw = (req as Request & { rawBody?: string }).rawBody;
    if (!raw) throw new UnauthorizedException("Corpo em bruto indisponível");

    if (!this.eupago.verifySignature(raw, signature)) {
      /*
       * A rejeição deixa rasto.
       *
       * Não deixava: o 401 saía antes de qualquer escrita, e um dia inteiro de
       * webhooks da euPago assinados com a chave errada era **invisível** na
       * base — só um aviso num log que ninguém lê. Foi assim que dois
       * pagamentos MB Way ficaram "a confirmar" sem ninguém saber se a euPago
       * chegou sequer a bater à porta.
       *
       * Grava-se o mínimo que responde a "o que é que chegou?": se vinha
       * assinatura, o tamanho do corpo, o nome do canal se o corpo o trouxer.
       * Nunca o corpo inteiro: não foi verificado, e o que não foi verificado
       * não entra na base como se fosse da euPago. Continua a ser 401.
       */
      this.log.warn("Webhook com assinatura inválida — ignorado");
      const canal = (() => {
        try {
          return String((JSON.parse(raw) as { channel?: { name?: unknown } }).channel?.name ?? "");
        } catch {
          return "";
        }
      })();
      await this.prisma.webhookEvent
        .create({
          data: {
            provider: "eupago",
            eventId: `rejected-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            signature: signature ? "presente" : null,
            payload: { channel: canal, bodyLength: raw.length, hadSignature: Boolean(signature) },
            error: signature ? "assinatura inválida" : "sem assinatura",
          },
        })
        .catch(() => undefined);
      throw new UnauthorizedException();
    }

    const t = (payload.transactions ?? payload.transaction) as Record<string, unknown> | undefined;

    /*
     * Payload encriptado (opção `encrypt` do backoffice): vem só um campo
     * `data` com AES-256-CBC. Não o suportamos — a assinatura já garante a
     * autenticidade, e o canal é TLS. Fica gravado com o motivo, para o erro
     * de configuração se ver em vez de os pagamentos deixarem de confirmar em
     * silêncio.
     */
    if (!t && typeof payload.data === "string" && payload.data.length > 0) {
      this.log.error("Webhook encriptado — desactiva a encriptação do webhook no backoffice da euPago");
      await this.prisma.webhookEvent
        .create({
          data: {
            provider: "eupago",
            eventId: `encrypted-${Date.now()}`,
            signature,
            payload: payload as object,
            error: "payload encriptado — desactivar encrypt no backoffice",
          },
        })
        .catch(() => undefined);
      return { ok: true, ignored: "encriptado" };
    }

    if (!t) return { ok: true, ignored: "sem transacções" };

    const identifier = valor(t.identifier);
    const reference = valor(t.reference);
    const trid = valor(t.trid);
    const status = valor(t.status).toUpperCase();

    // O id do evento: o trid é único por transacção; sem ele, a combinação
    // referência+estado — o mesmo estado da mesma referência só conta uma vez.
    const eventId = trid || (reference || identifier ? `${reference || identifier}:${status}` : "");
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
      // Por ordem de confiança: o nosso identifier primeiro — é o id que nós
      // próprios enviámos —, depois a referência e o trid do provedor.
      const refs = [identifier, reference, trid].filter(Boolean);

      const amount = (t.amount ?? {}) as Record<string, unknown>;
      const paidCents = amount.value != null ? Math.round(Number(amount.value) * 100) : undefined;
      const when = t.date ? new Date(String(t.date)) : new Date();
      const quando = Number.isNaN(when.getTime()) ? new Date() : when;

      if (status === "PAID") {
        await this.billing.confirmPayment(refs, quando, payload, paidCents);
      } else if (status === "REFUND") {
        await this.billing.refundPayment(refs, payload);
      } else if (status === "EXPIRED") {
        await this.billing.failPayment(refs, "A referência expirou sem ser paga.", payload, "EXPIRED");
      } else if (status === "ERROR" || status === "CANCEL") {
        await this.billing.failPayment(refs, "O pagamento foi recusado ou cancelado.", payload, "FAILED");
      } else {
        this.log.warn(`Webhook com estado desconhecido "${status}" — gravado sem processamento`);
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
      //
      // Só a mensagem, não o stack: um stack completo na base de dados é ruído que
      // pode arrastar caminhos de ficheiros e estrutura interna. O stack fica no
      // log do servidor, que é o sítio certo para ele.
      const message = error instanceof Error ? error.message : String(error);
      await this.prisma.webhookEvent.update({
        where: { id: event.id },
        data: { error: message.slice(0, 500) },
      });
      this.log.error(`Falha a processar o evento ${eventId}: ${error}`);
      return { ok: true, deferred: true };
    }
  }
}

/** Números, strings, o que vier — como string aparada, vazia quando não há nada. */
function valor(v: unknown): string {
  return v == null ? "" : String(v).trim();
}

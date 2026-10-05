import { Body, Controller, Headers, HttpCode, Logger, Param, Post, Req, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";
import { Public } from "../auth/auth.guard";
import { PrismaService } from "../prisma/prisma.service";
import { BillingService } from "./billing.service";
import { EupagoClient } from "./eupago.client";
import { SubscriptionPaymentsService } from "../subscription/subscription-payments.service";
import { eDaPlataforma } from "../subscription/cobranca";

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
 *
 * ## Um webhook por clube
 *
 * Um clube com canal próprio na euPago configura lá o seu webhook, com uma chave
 * dele, a apontar para `/webhooks/eupago/<slug>`. Esse aviso verifica-se com a
 * chave **desse clube** (`Academy.eupagoWebhookSecret`), e só pode mexer em
 * pagamentos desse clube: um pagamento que pertença a outro é recusado mesmo com
 * a assinatura certa. É o que deixa dar a chave a cada clube sem lhe dar a forma
 * de confirmar pagamentos dos outros — que era o que acontecia com um segredo só.
 *
 * `/webhooks/eupago`, sem clube, continua a ser o webhook global, com o segredo
 * do servidor, para quem cobra pela conta da plataforma.
 */
@Public()
@Controller("webhooks/eupago")
export class EupagoWebhookController {
  private readonly log = new Logger(EupagoWebhookController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly billing: BillingService,
    private readonly eupago: EupagoClient,
    private readonly subscricao: SubscriptionPaymentsService,
  ) {}

  @Post()
  @HttpCode(200)
  async handle(
    @Req() req: Request,
    @Body() payload: Record<string, unknown>,
    @Headers("x-signature") signature?: string,
  ) {
    return this.processar(req, payload, signature);
  }

  /**
   * O webhook de um clube: `/webhooks/eupago/<slug>`.
   *
   * O slug diz de que clube é, e é com a chave desse clube que se verifica. Um
   * slug desconhecido, ou um clube sem chave configurada, responde como uma
   * assinatura errada — 401, com rasto —, e não como "este clube não existe":
   * a rota é pública, e não deve servir para descobrir quais clubes existem.
   */
  @Post(":academia")
  @HttpCode(200)
  async handleDoClube(
    @Req() req: Request,
    @Param("academia") slug: string,
    @Body() payload: Record<string, unknown>,
    @Headers("x-signature") signature?: string,
  ) {
    const rows = await this.prisma.$queryRaw<{ id: string | null }[]>`
      SELECT app.resolve_academy_by_slug(${slug}) AS id
    `;
    const academyId = rows[0]?.id ?? null;
    const chave = academyId
      ? await this.prisma.runAs(academyId, async (db) =>
          (await db.academy.findFirst({ where: { id: academyId }, select: { eupagoWebhookSecret: true } }))
            ?.eupagoWebhookSecret?.trim() || null,
        )
      : null;

    return this.processar(req, payload, signature, academyId && chave ? { academyId, chave, slug } : { semChave: slug });
  }

  private async processar(
    req: Request,
    payload: Record<string, unknown>,
    signature: string | undefined,
    /** O clube do endereço, e a chave dele. `semChave`: pediu-se um clube que não a tem. */
    doClube?: { academyId: string; chave: string; slug: string } | { semChave: string },
  ) {
    // Os bytes exactos que chegaram, preservados em main.ts. Reserializar o JSON
    // reordenaria chaves e invalidaria a assinatura.
    const raw = (req as Request & { rawBody?: string }).rawBody;
    if (!raw) throw new UnauthorizedException("Corpo em bruto indisponível");

    const clube = doClube && "academyId" in doClube ? doClube : null;
    const assinado = doClube && "semChave" in doClube ? false : this.eupago.verifySignature(raw, signature, clube?.chave);

    if (!assinado) {
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
            payload: {
              channel: canal,
              bodyLength: raw.length,
              hadSignature: Boolean(signature),
              /* De que webhook veio: o global, ou o de um clube (pelo endereço). */
              webhook: doClube ? ("slug" in doClube ? doClube.slug : doClube.semChave) : "global",
            },
            error: doClube && "semChave" in doClube
              ? "clube sem chave de webhook configurada (ou endereço desconhecido)"
              : signature
                ? "assinatura inválida"
                : "sem assinatura",
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

      /*
       * Um pagamento **à plataforma** (a mensalidade de um clube a nós) só
       * chega pelo webhook global: é a conta da plataforma que o recebe. Pelo
       * webhook de um clube é recusado, com rasto, e não se toca em nada.
       */
      if (!clube && (await this.subscricao.tratarWebhook(refs, status, quando, payload, paidCents))) {
        await this.prisma.webhookEvent.update({ where: { id: event.id }, data: { processedAt: new Date(), error: null } });
        return { ok: true, plataforma: true };
      }
      if (clube && refs.some(eDaPlataforma)) {
        this.log.error(`Webhook do clube ${clube.slug} com um pagamento à plataforma — ignorado`);
        await this.prisma.webhookEvent.update({
          where: { id: event.id },
          data: { error: `pagamento à plataforma (webhook de ${clube.slug})` },
        });
        return { ok: true, ignored: "plataforma" };
      }

      /*
       * O webhook de um clube só mexe nos pagamentos desse clube.
       *
       * A assinatura prova que o aviso veio de quem tem a chave do clube; não
       * prova que o pagamento é dele. Sem esta verificação, quem tivesse a
       * chave de um clube podia assinar um "pago" com o identificador de um
       * pagamento de outro. Fica gravado como erro, e não se toca em nada.
       */
      if (clube) {
        let dono: string | null = null;
        for (const ref of refs) {
          dono = await this.prisma.resolvePaymentAcademy("eupago", ref);
          if (dono) break;
        }
        if (dono && dono !== clube.academyId) {
          this.log.error(`Webhook do clube ${clube.slug} com um pagamento de outro clube — ignorado`);
          await this.prisma.webhookEvent.update({
            where: { id: event.id },
            data: { error: `pagamento de outro clube (webhook de ${clube.slug})` },
          });
          return { ok: true, ignored: "outro clube" };
        }
      }

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

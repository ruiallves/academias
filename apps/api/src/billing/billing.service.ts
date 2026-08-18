import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { PaymentMethod, PaymentStatus, ChargeStatus, NotificationType } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import { EupagoClient } from "./eupago.client";
import { athleteScopeFilter, can, type RequestContext } from "../common/permissions";

@Injectable()
export class BillingService {
  private readonly log = new Logger(BillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eupago: EupagoClient,
    private readonly notifications: NotificationsService,
  ) {}

  /* ------------------------------------------------------------------------ */
  /* Leitura                                                                   */
  /* ------------------------------------------------------------------------ */

  async listCharges(ctx: RequestContext, period: string) {
    if (!can(ctx, "billing:read")) throw new ForbiddenException();

    return this.prisma.runAs(ctx.academyId, (db) =>
      db.charge.findMany({
        where: { period, athleteId: athleteScopeFilter(ctx) },
        include: { athlete: { select: { id: true, name: true } }, payments: true },
        orderBy: [{ status: "asc" }, { dueDate: "asc" }],
      }),
    );
  }

  /* ------------------------------------------------------------------------ */
  /* Ajuste manual                                                             */
  /* ------------------------------------------------------------------------ */

  /**
   * Ajuste manual do estado de uma mensalidade, pela direção.
   *
   * Marca como **paga** (recebido em dinheiro ou por transferência à parte), volta a
   * **por pagar**, ou **anula** (bolsa, atleta que saiu a meio do mês).
   *
   * ## Isto contradiz "o pagamento só muda pelo webhook"?
   *
   * Não. Aquela regra protege o fluxo euPago: o navegador de um pai nunca pode
   * declarar-se pago, senão pagava 40 € com um clique. Isto é o oposto — uma ação de
   * **gestão**, atrás de `billing:write` (direção), não um pagamento online. E fica
   * registada: marcar como paga cria uma `Payment` de método `CASH` e provedor
   * `manual`, para o histórico dizer *como* se soube que foi pago, em vez de um
   * estado que muda sem rasto.
   */
  async setChargeStatus(ctx: RequestContext, chargeId: string, status: ChargeStatus) {
    if (!can(ctx, "billing:write")) throw new ForbiddenException("Sem permissão para alterar mensalidades");

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const charge = await db.charge.findFirst({
        where: { id: chargeId, athleteId: athleteScopeFilter(ctx) },
        select: { id: true, status: true, amountCents: true },
      });
      if (!charge) throw new NotFoundException("Mensalidade não encontrada");

      if (status === ChargeStatus.SETTLED) {
        // Regista *como* foi paga — só se ainda não estava, para cliques repetidos
        // não empilharem pagamentos manuais.
        if (charge.status !== ChargeStatus.SETTLED) {
          await db.payment.create({
            data: {
              chargeId: charge.id,
              amountCents: charge.amountCents,
              method: PaymentMethod.CASH,
              status: PaymentStatus.PAID,
              provider: "manual",
              paidAt: new Date(),
            },
          });
        }
        await db.charge.update({ where: { id: charge.id }, data: { status, settledAt: new Date() } });
      } else {
        // Voltar a "por pagar" ou anular: um pagamento manual anterior passa a
        // reembolsado, para o registo não continuar a dizer que foi pago.
        await db.payment.updateMany({
          where: { chargeId: charge.id, provider: "manual", status: PaymentStatus.PAID },
          data: { status: PaymentStatus.REFUNDED },
        });
        await db.charge.update({ where: { id: charge.id }, data: { status, settledAt: null } });
      }

      return { id: charge.id, status };
    });
  }

  /* ------------------------------------------------------------------------ */
  /* Pagamento                                                                 */
  /* ------------------------------------------------------------------------ */

  /**
   * Inicia o pagamento de uma mensalidade.
   *
   * O valor **nunca** vem do cliente. O pedido traz apenas o id da cobrança e o
   * método; o montante é lido da base de dados. Se viesse do corpo do pedido, um
   * pai conseguiria pagar quarenta euros com um cêntimo.
   */
  async startPayment(
    ctx: RequestContext,
    chargeId: string,
    method: PaymentMethod,
    payerPhone?: string,
  ) {
    if (!can(ctx, "billing:read")) throw new ForbiddenException();

    // Tudo dentro do mesmo contexto de tenant: a RLS só está activa dentro da
    // transação aberta por `runAs`.
    return this.prisma.runAs(ctx.academyId, async (db) => {
    // findFirst, não findUnique: é assim que o filtro de tenant se aplica.
    const charge = await db.charge.findFirst({
      where: { id: chargeId, athleteId: athleteScopeFilter(ctx) },
      include: { athlete: { select: { name: true } }, payments: true },
    });

    if (!charge) throw new NotFoundException("Mensalidade não encontrada");
    if (charge.status === ChargeStatus.SETTLED) throw new BadRequestException("Já está paga");

    // Se já existe uma tentativa em curso, devolve-se essa em vez de criar outra.
    // Duas referências abertas para a mesma mensalidade é como se cobra duas vezes.
    const inFlight = charge.payments.find(
      (p) => p.status === PaymentStatus.PENDING || p.status === PaymentStatus.PROCESSING,
    );
    if (inFlight) return inFlight;

    const payment = await db.payment.create({
      data: {
        chargeId: charge.id,
        amountCents: charge.amountCents,
        method,
        status: PaymentStatus.PENDING,
      },
    });

    const request = {
      reference: payment.id,
      amountCents: charge.amountCents,
      description: `Mensalidade ${charge.period} — ${charge.athlete.name}`,
      payerName: charge.athlete.name,
      payerEmail: "",
    };

    try {
      const result =
        method === PaymentMethod.MBWAY
          ? await this.eupago.createMbWayCharge({ ...request, payerPhone: requirePhone(payerPhone) })
          : await this.eupago.createMultibancoCharge(request);

      return await db.payment.update({
        where: { id: payment.id },
        data: {
          providerRef: result.providerRef,
          entity: result.entity,
          reference: result.reference,
          expiresAt: result.expiresAt,
          // MB Way espera confirmação no telemóvel — já está "a caminho".
          // Multibanco fica pendente até alguém pagar na caixa.
          status: method === PaymentMethod.MBWAY ? PaymentStatus.PROCESSING : PaymentStatus.PENDING,
        },
      });
    } catch (error) {
      await db.payment.update({
        where: { id: payment.id },
        data: { status: PaymentStatus.FAILED, rawPayload: { error: String(error) } },
      });
      throw error;
    }
    });
  }

  /* ------------------------------------------------------------------------ */
  /* Confirmação — só a partir do webhook                                      */
  /* ------------------------------------------------------------------------ */

  /**
   * Único caminho pelo qual uma mensalidade passa a paga.
   *
   * Chamado exclusivamente pelo controlador de webhooks, depois de a assinatura
   * ser verificada e de o evento ficar gravado em bruto. É idempotente: reprocessar
   * o mesmo evento não liquida a cobrança duas vezes nem envia duas notificações.
   */
  async confirmPayment(providerRef: string, paidAt: Date, rawPayload: unknown, paidCents?: number) {
    // O webhook chega sem tenant — é o pagamento que o identifica. Resolve-se
    // primeiro, por uma função que só sabe devolver um id, e só depois se abre o
    // contexto. Sem este passo a RLS bloquearia a leitura e os pagamentos
    // deixariam de confirmar, em silêncio.
    const academyId = await this.prisma.resolvePaymentAcademy("eupago", providerRef);
    if (!academyId) {
      this.log.warn(`Webhook para um pagamento desconhecido: ${providerRef}`);
      return { handled: false as const };
    }

    return this.prisma.runAs(academyId, async (db) => {
      const payment = await db.payment.findFirst({
        where: { provider: "eupago", providerRef },
        include: { charge: { include: { athlete: { include: { guardians: { include: { membership: true } } } } } } },
      });

      if (!payment) return { handled: false as const };

      if (payment.status === PaymentStatus.PAID) {
        // Já processado. A euPago reenvia eventos quando não recebe 200 depressa.
        return { handled: true as const, duplicate: true };
      }

      /*
       * O valor pago tem de bater com o esperado.
       *
       * O montante nunca vem do cliente — é lido da base ao criar o pagamento. Mas
       * um webhook (mesmo assinado) com um valor diferente do devido não deve
       * liquidar a mensalidade: seria pagar 40 € com um evento de 1 €. Uma
       * divergência marca o pagamento como falhado e deixa a cobrança em aberto,
       * para revisão humana.
       */
      if (paidCents !== undefined && paidCents !== payment.amountCents) {
        this.log.warn(
          `Valor divergente no webhook de ${providerRef}: pago ${paidCents}, esperado ${payment.amountCents}`,
        );
        await db.payment.update({
          where: { id: payment.id },
          data: { status: PaymentStatus.FAILED, rawPayload: rawPayload as object },
        });
        return { handled: true as const, amountMismatch: true };
      }

      const charge = payment.charge;

      // Já estamos dentro da transação de `runAs` — as duas escritas caem ou
      // passam juntas sem precisar de um `$transaction` aninhado.
      await db.payment.update({
        where: { id: payment.id },
        data: { status: PaymentStatus.PAID, paidAt, rawPayload: rawPayload as object },
      });
      await db.charge.update({
        where: { id: charge.id },
        data: { status: ChargeStatus.SETTLED, settledAt: paidAt },
      });

      // Só depois de a base de dados estar consistente é que se avisa a família.
      for (const link of charge.athlete.guardians.filter((g) => g.isPayer)) {
        await this.notifications.enqueue({
          academyId: charge.academyId,
          userId: link.membership.userId,
          type: NotificationType.PAYMENT_RECEIVED,
          title: "Pagamento confirmado",
          body: `Recebemos ${(payment.amountCents / 100).toFixed(2)} € da mensalidade de ${charge.period}.`,
          payload: { route: "/pagamentos", chargeId: charge.id },
        }, db);
      }

      return { handled: true as const, duplicate: false };
    });
  }

  async failPayment(providerRef: string, reason: string, rawPayload: unknown) {
    const academyId = await this.prisma.resolvePaymentAcademy("eupago", providerRef);
    if (!academyId) return { handled: false as const };

    return this.prisma.runAs(academyId, async (db) => {
      const payment = await db.payment.findFirst({
        where: { provider: "eupago", providerRef },
        include: { charge: { include: { athlete: { include: { guardians: { include: { membership: true } } } } } } },
      });
      if (!payment || payment.status === PaymentStatus.PAID) return { handled: false as const };

      await db.payment.update({
        where: { id: payment.id },
        data: { status: PaymentStatus.FAILED, rawPayload: rawPayload as object },
      });

      for (const link of payment.charge.athlete.guardians.filter((g) => g.isPayer)) {
        await this.notifications.enqueue({
          academyId: payment.charge.academyId,
          userId: link.membership.userId,
          type: NotificationType.PAYMENT_FAILED,
          title: "O pagamento não foi concluído",
          body: reason,
          payload: { route: "/pagamentos", chargeId: payment.chargeId },
        }, db);
      }

      return { handled: true as const };
    });
  }
}

function requirePhone(phone: string | undefined): string {
  if (!phone) throw new BadRequestException("MB Way precisa de um número de telemóvel");
  return phone;
}

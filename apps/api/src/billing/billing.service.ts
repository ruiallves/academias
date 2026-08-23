import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { PaymentMethod, PaymentStatus, ChargeStatus, NotificationType } from "@prisma/client";
import { PrismaService, type ScopedClient } from "../prisma/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import { EupagoClient } from "./eupago.client";
import { athleteScopeFilter, can, teamScopeFilter, type RequestContext } from "../common/permissions";

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
  /* Lembretes                                                                 */
  /* ------------------------------------------------------------------------ */

  /**
   * Um lembrete a cada encarregado pagador de cada mensalidade **vencida** —
   * `OPEN` e com o prazo já passado, o mesmo critério que a consola usa para
   * mostrar "vencido" (`arrears()`, em `lib/api.ts`). Só a direção o dispara
   * (`billing:write`); a lista nunca vem do cliente, para não se poder lembrar
   * alguém de uma mensalidade que afinal já está paga.
   *
   * No máximo um lembrete por mensalidade por dia, mesmo que o botão seja
   * carregado várias vezes seguidas — reenviar cinco vezes na mesma tarde ensina
   * a família a ignorar a app, não a pagar mais depressa. Sem tabela nova para
   * isto: a marca fica na própria `Notification` já enviada, e verifica-se se já
   * existe uma de hoje antes de mandar outra.
   */
  async sendOverdueReminders(ctx: RequestContext) {
    if (!can(ctx, "billing:write")) throw new ForbiddenException("Sem permissão para enviar lembretes");

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const today = new Date();
      const overdue = await db.charge.findMany({
        where: { status: ChargeStatus.OPEN, dueDate: { lt: today } },
        include: { athlete: { include: { guardians: { include: { membership: true } } } } },
        orderBy: { dueDate: "asc" },
      });

      const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      const remindedAthletes = new Set<string>();
      let sent = 0;

      for (const charge of overdue) {
        // Só quem paga — um encarregado que só acompanha não precisa de ser
        // avisado de uma dívida que não é dele resolver.
        const payers = charge.athlete.guardians.filter((g) => g.isPayer && g.membership.isActive);

        for (const link of payers) {
          const already = await db.notification.findFirst({
            where: {
              userId: link.membership.userId,
              type: NotificationType.PAYMENT_DUE,
              payload: { path: ["chargeId"], equals: charge.id },
              createdAt: { gte: startOfToday },
            },
            select: { id: true },
          });
          if (already) continue;

          await this.notifications.enqueue(
            {
              academyId: charge.academyId,
              userId: link.membership.userId,
              type: NotificationType.PAYMENT_DUE,
              title: "Mensalidade vencida",
              // Concreto de propósito — o mês, o nome, desde quando —, não um
              // "tens uma notificação" que obriga a abrir a app para saber o quê.
              body: `A mensalidade de ${periodLabelPt(charge.period)} de ${charge.athlete.name} está vencida desde ${dateLabelPt(charge.dueDate)}.`,
              payload: { route: "/pagamentos", chargeId: charge.id },
            },
            db,
          );

          sent++;
          remindedAthletes.add(charge.athleteId);
        }
      }

      return { sent, athletes: remindedAthletes.size, overdue: overdue.length };
    });
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
  /* Configuração da mensalidade                                              */
  /* ------------------------------------------------------------------------ */
  /*
   * "Configurar a mensalidade" não gera cobranças — isso continua a não existir
   * neste produto (os `Charge` de hoje são dados de demonstração). O que estes
   * métodos fazem é dizer **quanto** um atleta deve pagar, para o dia em que a
   * geração de cobranças existir. Reutilizam o que já estava no modelo e nunca
   * tinha endpoint nenhum: `SubscriptionPlan` (o preço — de uma equipa, ou de um
   * atleta em concreto) e `Enrollment` (quem está nesse preço).
   *
   * ## Como se resolve o valor de um atleta
   *
   * Um atleta com uma inscrição individual activa (`Enrollment` ligada a um plano
   * sem equipa) paga o que essa inscrição disser — **sobrepõe-se sempre** ao preço
   * da equipa. Sem inscrição individual, paga o plano da equipa em que está. Sem
   * nenhum dos dois, "por configurar" — nunca um valor inventado.
   *
   * Nunca se apaga nada: ajustar o preço da equipa actualiza o plano da equipa;
   * ajustar individualmente cria (ou actualiza) o plano pessoal e a inscrição;
   * voltar ao preço da equipa **termina** a inscrição individual (`endsOn`), não a
   * apaga — histórico, não amnésia.
   */

  /** O preço da equipa — por omissão, para todos os atletas sem ajuste individual. */
  async setTeamFee(ctx: RequestContext, teamId: string, amountCents: number) {
    if (!can(ctx, "billing:write")) throw new ForbiddenException("Sem permissão para configurar mensalidades");
    assertValidAmount(amountCents);

    const scope = teamScopeFilter(ctx);
    if (scope && !scope.in.includes(teamId)) throw new ForbiddenException("Esta equipa não é tua");

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const team = await db.team.findFirst({ where: { id: teamId }, select: { id: true, name: true } });
      if (!team) throw new NotFoundException("Equipa não encontrada");

      const existing = await db.subscriptionPlan.findFirst({
        where: { teamId, isActive: true },
        orderBy: { id: "desc" },
      });

      const plan = existing
        ? await db.subscriptionPlan.update({ where: { id: existing.id }, data: { amountCents } })
        : await db.subscriptionPlan.create({
            data: { academyId: ctx.academyId, teamId, name: team.name, amountCents },
          });

      return { teamId, amountCents: plan.amountCents };
    });
  }

  /** O que este atleta paga hoje — individual se houver, senão o da equipa, senão nada. */
  async getAthleteFee(ctx: RequestContext, athleteId: string) {
    if (!can(ctx, "billing:read")) throw new ForbiddenException("Sem acesso a mensalidades");

    // Um encarregado tem `billing:read`, mas só do seu próprio educando — sem
    // isto, mudar o id no pedido dava-lhe a mensalidade de qualquer atleta.
    const scope = athleteScopeFilter(ctx);
    if (scope && !scope.in.includes(athleteId)) throw new ForbiddenException("Este atleta não é teu");

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const athlete = await db.athlete.findFirst({
        where: { id: athleteId },
        select: { id: true, teams: { select: { teamId: true, team: { select: { name: true } } }, take: 1 } },
      });
      if (!athlete) throw new NotFoundException("Atleta não encontrado");

      const individual = await activeIndividualEnrollment(db, athleteId);
      const team = athlete.teams[0];
      const teamPlan = team
        ? await db.subscriptionPlan.findFirst({ where: { teamId: team.teamId, isActive: true }, orderBy: { id: "desc" } })
        : null;

      const individualAmount = individual ? individual.plan.amountCents - individual.discountCents : null;

      return {
        source: individual ? ("individual" as const) : teamPlan ? ("team" as const) : ("none" as const),
        effectiveAmountCents: individual ? individualAmount : (teamPlan?.amountCents ?? null),
        individualAmountCents: individualAmount,
        teamAmountCents: teamPlan?.amountCents ?? null,
        teamName: team?.team.name ?? null,
      };
    });
  }

  /** Ajuste individual — sobrepõe-se ao preço da equipa para este atleta em concreto. */
  async setAthleteFee(ctx: RequestContext, athleteId: string, amountCents: number) {
    if (!can(ctx, "billing:write")) throw new ForbiddenException("Sem permissão para configurar mensalidades");
    assertValidAmount(amountCents);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const athlete = await db.athlete.findFirst({ where: { id: athleteId }, select: { id: true, name: true } });
      if (!athlete) throw new NotFoundException("Atleta não encontrado");

      await applyIndividualFee(db, ctx.academyId, athlete, amountCents);
      return { athleteId, amountCents };
    });
  }

  /**
   * O mesmo ajuste, para vários atletas de uma vez — irmãos, um grupo com o
   * mesmo acordo, uma bolsa que abrange uma equipa inteira sem ser a equipa
   * toda. Uma pessoa que fica sem ajuste (id errado, já não está na academia)
   * não impede as restantes — o pedido diz quantos ficaram e quais faltaram.
   */
  async setAthleteFeeBulk(ctx: RequestContext, athleteIds: string[], amountCents: number) {
    if (!can(ctx, "billing:write")) throw new ForbiddenException("Sem permissão para configurar mensalidades");
    assertValidAmount(amountCents);
    if (athleteIds.length === 0) throw new BadRequestException("Escolhe pelo menos um atleta");

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const athletes = await db.athlete.findMany({
        where: { id: { in: athleteIds } },
        select: { id: true, name: true },
      });
      if (athletes.length === 0) throw new NotFoundException("Nenhum destes atletas foi encontrado");

      for (const athlete of athletes) {
        await applyIndividualFee(db, ctx.academyId, athlete, amountCents);
      }

      const foundIds = new Set(athletes.map((a) => a.id));
      return {
        amountCents,
        updated: athletes.map((a) => a.id),
        missing: athleteIds.filter((id) => !foundIds.has(id)),
      };
    });
  }

  /** Remove o ajuste individual — o atleta volta a pagar o preço da equipa. */
  async clearAthleteFee(ctx: RequestContext, athleteId: string) {
    if (!can(ctx, "billing:write")) throw new ForbiddenException("Sem permissão para configurar mensalidades");

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const athlete = await db.athlete.findFirst({ where: { id: athleteId }, select: { id: true } });
      if (!athlete) throw new NotFoundException("Atleta não encontrado");

      await endActiveEnrollments(db, athleteId);
      return { athleteId, cleared: true };
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

const MONTHS_PT = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

/** "2026-08" → "agosto de 2026". O texto de um lembrete lê-se, não se decodifica. */
function periodLabelPt(period: string): string {
  const [year, month] = period.split("-").map(Number);
  return `${MONTHS_PT[month - 1] ?? period} de ${year}`;
}

/** A data por extenso, como uma pessoa a diria — "8 de agosto", não "2026-08-08". */
function dateLabelPt(d: Date): string {
  return `${d.getDate()} de ${MONTHS_PT[d.getMonth()]}`;
}

/** Um euro no mínimo, mil no máximo — trava um "0" ou um zero a mais por engano. */
function assertValidAmount(amountCents: number): void {
  if (!Number.isInteger(amountCents) || amountCents < 100 || amountCents > 100_000) {
    throw new BadRequestException("Valor entre 1 € e 1000 €");
  }
}

/** A inscrição individual activa de um atleta — a que sobrepõe o preço da equipa. */
/**
 * "Activa" filtra-se em JavaScript, não no `WHERE`.
 *
 * `endsOn` é `@db.Date` — sem hora. Comparar `{ gte: new Date() }` contra essa
 * coluna deixa a decisão de arredondamento a meio-dia para o Postgres (que
 * larga a hora consoante o fuso de sessão) em vez de para nós, e uma inscrição
 * terminada há segundos continuava a aparecer activa. Buscar as poucas
 * inscrições de um atleta e comparar aqui, em `Date >= Date`, é directo e nunca
 * ambíguo — não há mais do que um punhado de linhas por atleta.
 */
function isActiveEnrollment(e: { endsOn: Date | null }, today: Date): boolean {
  return e.endsOn === null || e.endsOn >= today;
}

async function activeIndividualEnrollment(db: ScopedClient, athleteId: string) {
  const rows = await db.enrollment.findMany({
    where: { athleteId, plan: { teamId: null, isActive: true } },
    include: { plan: true },
    orderBy: { startsOn: "desc" },
  });
  const today = new Date();
  return rows.find((e) => isActiveEnrollment(e, today)) ?? null;
}

/** Fecha (não apaga) as inscrições activas de um atleta — histórico, não amnésia. */
async function endActiveEnrollments(db: ScopedClient, athleteId: string): Promise<void> {
  const rows = await db.enrollment.findMany({ where: { athleteId }, select: { id: true, endsOn: true } });
  const today = new Date();
  const activeIds = rows.filter((e) => isActiveEnrollment(e, today)).map((e) => e.id);
  if (activeIds.length === 0) return;
  await db.enrollment.updateMany({ where: { id: { in: activeIds } }, data: { endsOn: today } });
}

/**
 * Aplica o ajuste individual a um atleta — partilhado por `setAthleteFee` e
 * `setAthleteFeeBulk`, para as duas nunca poderem divergir na forma como criam
 * ou actualizam o plano pessoal.
 */
async function applyIndividualFee(
  db: ScopedClient,
  academyId: string,
  athlete: { id: string; name: string },
  amountCents: number,
): Promise<void> {
  const existing = await activeIndividualEnrollment(db, athlete.id);

  if (existing) {
    // Já tinha um ajuste individual — é só actualizar o preço, sem criar rasto
    // novo. O desconto (se algum dia se usar) mantém-se como estava.
    await db.subscriptionPlan.update({ where: { id: existing.planId }, data: { amountCents } });
  } else {
    // Um atleta pode ter uma inscrição activa apontada para outra coisa (a
    // equipa, no futuro, se isso vier a existir) — termina-a antes de criar a
    // individual, para nunca haver duas em simultâneo.
    await endActiveEnrollments(db, athlete.id);

    const plan = await db.subscriptionPlan.create({
      data: { academyId, teamId: null, name: `Individual — ${athlete.name}`, amountCents },
    });
    await db.enrollment.create({ data: { athleteId: athlete.id, planId: plan.id, startsOn: new Date() } });
  }
}

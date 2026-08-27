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
  /* Geração de cobranças                                                      */
  /* ------------------------------------------------------------------------ */

  /**
   * Garante que existe uma cobrança por atleta activo, num período.
   *
   * ## O buraco que isto tapa
   *
   * A página de Mensalidades lê `Charge`. O preço vivia em `SubscriptionPlan` e
   * `Enrollment` — e **nada no produto criava um `Charge`**. O resultado era o
   * que se via: inscrever um atleta e ele nunca aparecer nas mensalidades, sem
   * erro nenhum, porque não havia erro — havia uma peça que faltava.
   *
   * ## Idempotente por construção
   *
   * `Charge` tem `@@unique([athleteId, period])`, e este método só **cria o que
   * falta**: nunca actualiza nem apaga uma cobrança que já exista. É o que
   * permite chamá-lo à vontade — ao inscrever um atleta, ao abrir o mês, ou duas
   * vezes seguidas — sem risco de mexer numa mensalidade que alguém já marcou
   * como paga ou ajustou à mão.
   *
   * ## Quem entra
   *
   * Só atletas `ACTIVE`: quem está em pausa ou saiu não gera mensalidade, e é
   * essa a diferença entre pausar e apagar. E só quem tem preço resolvível — sem
   * plano de equipa nem ajuste individual, o atleta fica de fora e é contado em
   * `semPreco`, para quem chama poder dizer que faltam preços por configurar em
   * vez de inventar um valor.
   *
   * ## Os meses do clube, e a excepção de quem entra
   *
   * `Academy.billingMonths` diz em que meses o clube cobra — muitos não cobram
   * Agosto. Um período fora desses meses não gera cobrança para quem já cá
   * estava: não é uma dívida por pagar, é um mês em que não se cobra.
   *
   * **Quem se inscreve nesse mês é a excepção**, e é cobrado à mesma: entrou,
   * treinou, e a direcção quer a mensalidade emitida. Nasce por pagar, como
   * todas; anulá-la é uma decisão da direcção, e uma anulação registada vale
   * mais do que uma cobrança que nunca existiu.
   *
   * Quem precisa de saber **porquê** é que um atleta não tem mensalidade
   * pergunta a `missingCharges`.
   */
  async ensureCharges(ctx: RequestContext, period: string) {
    if (!can(ctx, "billing:write")) throw new ForbiddenException("Sem permissão para gerar mensalidades");
    if (!/^\d{4}-\d{2}$/.test(period)) throw new BadRequestException("Período inválido (esperado AAAA-MM)");

    return this.prisma.runAs(ctx.academyId, (db) => gerarCobrancas(db, ctx.academyId, period));
  }

  /**
   * Quem **não** tem mensalidade neste período, e porquê.
   *
   * ## A pergunta que não tinha resposta
   *
   * Mensalidades lê `Charge`. Um atleta sem cobrança não aparece — e o ecrã não
   * distinguia "este mês não se cobra" de "falta configurar o preço" de "ninguém
   * gerou o mês". Era sempre a mesma coisa: uma linha que não está lá.
   *
   * O relatório que isto produz é o que o ecrã mostra por baixo da tabela. Três
   * motivos, e cada um tem uma acção diferente do outro lado:
   *
   *   `fora-do-mes`  o clube não cobra este mês. Não é um problema — é uma
   *                  decisão, e o sítio para a mudar são as Definições.
   *   `sem-preco`    ninguém disse quanto é que este atleta paga. Configura-se.
   *   `por-gerar`    tem preço, o mês cobra-se, e a cobrança não existe. Chega
   *                  carregar em "Gerar".
   *
   * Só leitura: não cria nada. Quem cria é `ensureCharges`, e é uma decisão de
   * quem está a olhar para o ecrã.
   */
  async missingCharges(ctx: RequestContext, period: string) {
    if (!can(ctx, "billing:read")) throw new ForbiddenException("Sem acesso a mensalidades");
    if (!/^\d{4}-\d{2}$/.test(period)) throw new BadRequestException("Período inválido (esperado AAAA-MM)");

    const scope = teamScopeFilter(ctx);
    const athleteScope = athleteScopeFilter(ctx);
    const mes = Number(period.slice(5, 7));

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const atletas = await db.athlete.findMany({
        where: {
          status: "ACTIVE",
          ...(scope ? { teams: { some: { teamId: scope } } } : {}),
          ...(athleteScope ? { id: athleteScope } : {}),
        },
        orderBy: { name: "asc" },
        select: { id: true, name: true, joinedAt: true, teams: { select: { teamId: true }, take: 1 } },
      });
      if (atletas.length === 0) return { period, cobraEsteMes: true, atletas: [] };

      const ids = atletas.map((a) => a.id);
      const comCobranca = new Set(
        (await db.charge.findMany({ where: { period, athleteId: { in: ids } }, select: { athleteId: true } }))
          .map((c) => c.athleteId),
      );

      const academia = await db.academy.findFirst({
        where: { id: ctx.academyId },
        select: { billingMonths: true },
      });
      const cobraEsteMes = (academia?.billingMonths ?? MESES_POR_OMISSAO).includes(mes);

      // A mesma excepção de `gerarCobrancas`: quem entrou neste mês é cobrado
      // neste mês, calendário ou não. Se o relatório não a soubesse, dizia "o
      // clube não cobra agosto" a um atleta que tem mesmo mensalidade de agosto.
      const inicioDoPeriodo = new Date(Date.UTC(Number(period.slice(0, 4)), mes - 1, 1));
      const fimDoPeriodo = new Date(Date.UTC(Number(period.slice(0, 4)), mes, 1));
      const entrouNesteMes = (joinedAt: Date) => joinedAt >= inicioDoPeriodo && joinedAt < fimDoPeriodo;

      // Quem tem preço — individual ou da equipa. A mesma resolução de
      // `gerarCobrancas`, aqui só para saber se existe, não quanto é.
      const hoje = new Date();
      const comIndividual = new Set<string>();
      for (const e of await db.enrollment.findMany({
        where: { athleteId: { in: ids }, plan: { teamId: null, isActive: true } },
        select: { athleteId: true, endsOn: true },
      })) {
        if (e.endsOn === null || e.endsOn >= hoje) comIndividual.add(e.athleteId);
      }
      const equipasComPreco = new Set(
        (
          await db.subscriptionPlan.findMany({
            where: { teamId: { not: null }, isActive: true },
            select: { teamId: true },
          })
        ).map((p) => p.teamId as string),
      );

      const semCobranca = atletas.filter((a) => !comCobranca.has(a.id));

      return {
        period,
        cobraEsteMes,
        atletas: semCobranca.map((a) => {
          const teamId = a.teams[0]?.teamId ?? null;
          const temPreco = comIndividual.has(a.id) || (teamId !== null && equipasComPreco.has(teamId));
          const cobra = cobraEsteMes || entrouNesteMes(a.joinedAt);
          return {
            athleteId: a.id,
            name: a.name,
            teamId,
            reason: !cobra ? ("fora-do-mes" as const) : !temPreco ? ("sem-preco" as const) : ("por-gerar" as const),
          };
        }),
      };
    });
  }

  /* ------------------------------------------------------------------------ */
  /* Configuração da mensalidade                                              */
  /* ------------------------------------------------------------------------ */
  /*
   * "Configurar a mensalidade" diz **quanto** — quem gera as cobranças é
   * `ensureCharges`, mais abaixo neste ficheiro.
   *
   * Durante muito tempo a geração não existiu de todo, e esta nota dizia-o: os
   * `Charge` eram dados de demonstração. A consequência é que um atleta inscrito
   * hoje nunca aparecia em Mensalidades — a página lê `Charge`, e nada no
   * produto criava um. Ver `ensureCharges`.
   *
   * Estes métodos continuam a ser só sobre o preço, e reutilizam o que já estava
   * no modelo: `SubscriptionPlan` (o preço — de uma equipa, ou de um atleta em
   * concreto) e `Enrollment` (quem está nesse preço).
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

      /*
       * Definir o preço fecha o ciclo: gera já as mensalidades do mês corrente.
       *
       * Sem isto, o passo seguinte era sempre o mesmo relatório: "configurei o
       * preço da equipa e continua a não aparecer nas mensalidades". E é
       * verdade — o atleta foi inscrito antes de haver preço, ficou contado em
       * `semPreco`, e nada voltava a tentar.
       *
       * Só cria o que falta (ver `gerarCobrancas`), por isso baixar ou subir o
       * preço não reescreve mensalidades já emitidas — para essas há o ajuste
       * manual, que é uma decisão consciente e fica registada.
       */
      const atletas = await db.athlete.findMany({
        where: { status: "ACTIVE", teams: { some: { teamId } } },
        select: { id: true },
      });
      const cobrancas = await gerarCobrancas(
        db,
        ctx.academyId,
        periodoActual(),
        atletas.map((a) => a.id),
      );

      return { teamId, amountCents: plan.amountCents, cobrancas };
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

      // Mesma razão de `setTeamFee`: um atleta que não tinha preço nenhum passa
      // a ter, e a mensalidade do mês corrente nasce aqui em vez de ficar à
      // espera de alguém se lembrar de a gerar.
      const cobrancas = await gerarCobrancas(db, ctx.academyId, periodoActual(), [athlete.id]);

      return { athleteId, amountCents, cobrancas };
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

/**
 * O calendário de cobrança por omissão — onze meses, sem Agosto.
 *
 * Espelha o valor por omissão de `Academy.billingMonths` e serve só de rede para
 * uma academia lida antes da migração ter corrido. A resposta verdadeira está
 * sempre na academia.
 */
export const MESES_POR_OMISSAO = [1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12];

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

/* ---------------------------------------------------------------------------- */
/* A geração, em funções puras de serviço                                        */
/* ---------------------------------------------------------------------------- */

/**
 * O trabalho de base de dados da geração.
 *
 * Fora da classe porque é chamado de dois sítios — deste serviço, e da inscrição
 * de um atleta (`AthletesService`), que já está dentro da sua própria transação
 * de tenant e não pode abrir outra. Recebe o `db` de quem chama; nunca abre um.
 */
export async function gerarCobrancas(
  db: ScopedClient,
  academyId: string,
  period: string,
  /** Limita a geração a estes atletas. Sem isto, gera para a academia toda. */
  apenasAtletas?: string[],
): Promise<{ period: string; criadas: number; jaExistiam: number; semPreco: number; foraDoMes: number }> {
  const mes = Number(period.slice(5, 7));

  const atletas = await db.athlete.findMany({
    where: {
      status: "ACTIVE",
      ...(apenasAtletas ? { id: { in: apenasAtletas } } : {}),
    },
    select: { id: true, joinedAt: true, teams: { select: { teamId: true }, take: 1 } },
  });
  if (atletas.length === 0) {
    return { period, criadas: 0, jaExistiam: 0, semPreco: 0, foraDoMes: 0 };
  }

  const ids = atletas.map((a) => a.id);

  // Quem já tem cobrança neste período. Uma leitura só, em vez de uma por atleta.
  const existentes = new Set(
    (
      await db.charge.findMany({
        where: { period, athleteId: { in: ids } },
        select: { athleteId: true },
      })
    ).map((c) => c.athleteId),
  );

  /*
   * As inscrições individuais activas — o ajuste que se sobrepõe ao preço da
   * equipa. Mesma regra de `activeIndividualEnrollment`, mas em bloco: uma
   * leitura para todos, em vez de uma por atleta.
   */
  const hoje = new Date();
  const individuais = new Map<string, { amountCents: number; discountCents: number; enrollmentId: string }>();
  for (const e of await db.enrollment.findMany({
    where: { athleteId: { in: ids }, plan: { teamId: null, isActive: true } },
    include: { plan: true },
    orderBy: { startsOn: "desc" },
  })) {
    if (individuais.has(e.athleteId)) continue; // a mais recente ganha
    if (!(e.endsOn === null || e.endsOn >= hoje)) continue;
    individuais.set(e.athleteId, {
      amountCents: e.plan.amountCents,
      discountCents: e.discountCents,
      enrollmentId: e.id,
    });
  }

  // Os planos de equipa, um por equipa.
  const planosPorEquipa = new Map<string, { amountCents: number }>();
  for (const plan of await db.subscriptionPlan.findMany({
    where: { teamId: { not: null }, isActive: true },
    select: { teamId: true, amountCents: true },
    orderBy: { id: "desc" },
  })) {
    if (plan.teamId && !planosPorEquipa.has(plan.teamId)) {
      planosPorEquipa.set(plan.teamId, { amountCents: plan.amountCents });
    }
  }

  const academia = await db.academy.findFirst({
    where: { id: academyId },
    select: { billingDueDay: true, billingMonths: true },
  });
  const diaDoClube = academia?.billingDueDay ?? 8;
  const dueDate = diaDeVencimento(period, diaDoClube);

  /*
   * Quem entra depois do dia de vencimento não nasce em dívida.
   *
   * A mensalidade de Agosto vence a 8 de Agosto. Emiti-la a 27 para quem se
   * inscreveu a 26 punha-a **vencida no segundo em que nasce** — a vermelho no
   * ecrã, e a caminho de um lembrete automático à família nessa mesma noite. É
   * uma cobrança legítima com uma data impossível de cumprir.
   *
   * Fica para o vencimento seguinte: continua a ser a mensalidade de Agosto (o
   * `period` não muda, e é ele que diz a que mês pertence), com o prazo do mês a
   * seguir. É o que qualquer clube faz com quem chega a meio do mês.
   */
  const proximoVencimento = diaDeVencimento(periodoSeguinte(period), diaDoClube);

  /*
   * O calendário é do clube, não do plano.
   *
   * `SubscriptionPlan.months` fazia isto, e fazia-o em silêncio: nascia sem
   * Agosto por omissão, ninguém o via, ninguém o podia mudar — e um atleta
   * inscrito em Agosto não aparecia em Mensalidades sem nada que o explicasse.
   * Subiu para `Academy.billingMonths`, onde é uma pergunta que se faz uma vez e
   * se responde num ecrã. A coluna do plano fica para o dia em que um plano
   * precisar mesmo de calendário próprio; hoje não é lida.
   */
  const mesesDoClube = academia?.billingMonths ?? MESES_POR_OMISSAO;
  const cobraEsteMes = mesesDoClube.includes(mes);

  /*
   * Quem se inscreve num mês paga esse mês, esteja ele no calendário ou não.
   *
   * O calendário responde a "que meses é que este clube cobra a quem já cá
   * está". Não responde à inscrição: um miúdo que entra a 27 de Agosto treina
   * em Agosto, e a direcção quer a linha lá — mesmo num clube que não cobra
   * Agosto ao resto do plantel. Sem esta excepção, inscrevê-lo era uma
   * mensalidade que nunca chegava a existir e ninguém dava por ela.
   *
   * Nasce por pagar, como todas. Se o presidente decidir não a cobrar, anula-a
   * — e isso fica registado, que é o oposto de nunca ter sido emitida.
   */
  const inicioDoPeriodo = new Date(Date.UTC(Number(period.slice(0, 4)), mes - 1, 1));
  const fimDoPeriodo = new Date(Date.UTC(Number(period.slice(0, 4)), mes, 1));
  const entrouNesteMes = (joinedAt: Date) => joinedAt >= inicioDoPeriodo && joinedAt < fimDoPeriodo;

  const novas: { academyId: string; athleteId: string; enrollmentId?: string; period: string; amountCents: number; dueDate: Date }[] = [];
  let jaExistiam = 0;
  let semPreco = 0;
  let foraDoMes = 0;

  for (const a of atletas) {
    if (existentes.has(a.id)) {
      jaExistiam++;
      continue;
    }

    const individual = individuais.get(a.id);
    const daEquipa = a.teams[0] ? planosPorEquipa.get(a.teams[0].teamId) : undefined;
    const fonte = individual ?? daEquipa;

    if (!fonte) {
      semPreco++;
      continue;
    }
    if (!cobraEsteMes && !entrouNesteMes(a.joinedAt)) {
      foraDoMes++;
      continue;
    }

    // O desconto só existe na inscrição individual; o preço da equipa não o tem.
    const valor = individual ? Math.max(0, individual.amountCents - individual.discountCents) : fonte.amountCents;

    novas.push({
      academyId,
      athleteId: a.id,
      // Liga a cobrança à inscrição que a originou, quando houve uma — é o que
      // deixa perceber, meses depois, de que preço é que aquele valor veio.
      ...(individual ? { enrollmentId: individual.enrollmentId } : {}),
      period,
      amountCents: valor,
      // Quem chegou depois do prazo deste mês paga no prazo seguinte, sem
      // deixar de ser a mensalidade deste mês. Ver `proximoVencimento`.
      dueDate: a.joinedAt > dueDate ? proximoVencimento : dueDate,
    });
  }

  if (novas.length > 0) {
    /*
     * `skipDuplicates` é a rede por baixo da leitura de `existentes`.
     *
     * Entre ler quem já tem e escrever, outra pessoa pode ter gerado o mesmo
     * período — duas secretarias, dois separadores. O índice único trava-o na
     * base; isto faz com que o segundo a chegar não rebente, apenas não crie.
     */
    await db.charge.createMany({ data: novas, skipDuplicates: true });
  }

  return { period, criadas: novas.length, jaExistiam, semPreco, foraDoMes };
}

/** O período de hoje, no formato `AAAA-MM` que o `Charge` usa. */
export function periodoActual(hoje = new Date()): string {
  return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}`;
}

/** O período a seguir a este. Dezembro passa a Janeiro do ano seguinte. */
export function periodoSeguinte(period: string): string {
  const ano = Number(period.slice(0, 4));
  const mes = Number(period.slice(5, 7));
  return mes === 12 ? `${ano + 1}-01` : `${ano}-${String(mes + 1).padStart(2, "0")}`;
}

/**
 * O dia de vencimento dentro do período.
 *
 * `billingDueDay` pode ser 31 e o mês ter 30 dias — nesse caso vence no último
 * dia do mês, e não no dia 1 do mês seguinte, que é o que um `new Date(ano, mes,
 * 31)` faria em silêncio.
 */
function diaDeVencimento(period: string, dia: number): Date {
  const ano = Number(period.slice(0, 4));
  const mes = Number(period.slice(5, 7));
  const ultimoDia = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return new Date(Date.UTC(ano, mes - 1, Math.min(Math.max(1, dia), ultimoDia)));
}
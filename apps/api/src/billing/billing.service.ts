import { randomUUID } from "node:crypto";
import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PaymentMethod, PaymentStatus, ChargeStatus, NotificationType, type Payment } from "@prisma/client";
import { PrismaService, type ScopedClient } from "../prisma/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import { EupagoClient, type ChargeResult, type RedirectUrls } from "./eupago.client";
import { athleteScopeFilter, athleteTeamScopeWhere, can, teamScopeFilter, type RequestContext } from "../common/permissions";

/**
 * Quando é que um preço acabado de definir começa a ser cobrado.
 *vscode-webview://1ob97fh12humrgiq50j4v2uospofrr9cgtpigtgrt1vh8pfmvnct/index.html?id=74ac0831-4d4d-44c1-a659-f8ebe7095855&parentId=1&origin=5219657b-d472-4830-9805-0aa443d03f78&swVersion=6&extensionId=Anthropic.claude-code&platform=electron&vscode-resource-base-authority=vscode-resource.vscode-cdn.net&parentOrigin=vscode-file%3A%2F%2Fvscode-app&purpose=webviewView&session=28b7868d-b60b-4296-97c0-4e2d337e5eee#
 * "atual" emite já a mensalidade deste mês; "proximo" só regista o preço. Ver
 * `BillingService.geraAgora`, que explica porque é que isto passou a perguntar-se.
 */
export type AplicarEm = "atual" | "proximo";

@Injectable()
export class BillingService {
  private readonly log = new Logger(BillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eupago: EupagoClient,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService,
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
        /*
         * Todos os encarregados, e não "o pagador".
         *
         * Havia um encarregado marcado como pagador — o primeiro a registar-se —
         * e só ele recebia os avisos. Não resistia ao caso normal: pais
         * separados, em que qualquer um paga e nenhum é "o" pagador. Pior,
         * quem ficava de fora era decidido por quem chegou primeiro à app, e
         * não havia como trocar.
         *
         * Ver e pagar já podiam os dois — o âmbito da família nunca olhou para
         * essa marca. Era só o aviso que ia a um só, e isso deixava o outro sem
         * saber que havia uma dívida que ele podia resolver.
         */
        const avisar = charge.athlete.guardians.filter((g) => g.membership.isActive);

        for (const link of avisar) {
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
  /* Cobrança avulsa                                                           */
  /* ------------------------------------------------------------------------ */

  /**
   * Pedir a uma família que pague uma coisa que não é a mensalidade.
   *
   * O equipamento de treino, a inscrição no torneio, a viagem do autocarro. É o
   * que hoje se combina no grupo de WhatsApp e se cobra em envelope à beira do
   * campo — e é onde o clube perde dinheiro, porque ninguém sabe quem já pagou.
   *
   * ## Porque é que isto é uma `Charge` e não uma tabela nova
   *
   * Porque do lado do pai é a mesma coisa: aparece na mesma lista, com o mesmo
   * aspecto, e paga-se pelos mesmos meios. A euPago não distingue as duas, o
   * webhook que liquida uma liquida a outra, e o painel de Contas conta as duas
   * como receita. Uma tabela nova era o fluxo de pagamento inteiro duplicado
   * para mudar um rótulo. Ver `ChargeKind` no `schema.prisma`.
   *
   * ## O que se envia, e a quem
   *
   * Ao encarregado **pagador**, como os lembretes de mensalidade vencida: um
   * encarregado que só acompanha não tem de receber uma conta que não é dele
   * resolver. Sem nenhum marcado como pagador — acontece em fichas antigas — vai
   * para todos os que estejam activos, porque uma cobrança que ninguém recebe é
   * pior do que uma cobrança recebida a mais.
   *
   * A notificação leva o título, o valor e o prazo no corpo. "Tens uma
   * notificação" obriga a abrir a app para saber o quê; isto diz-se de uma vez,
   * e é o que aparece no ecrã bloqueado do telemóvel.
   */
  async createExtraCharge(
    ctx: RequestContext,
    input: { athleteId: string; title: string; amountCents: number; dueDate: string; categoryId?: string; notes?: string },
  ) {
    if (!can(ctx, "billing:write")) throw new ForbiddenException("Sem permissão para cobrar");

    const title = input.title.trim();
    if (title.length < 2) throw new BadRequestException("Falta dizer o que se está a cobrar");
    assertValidAmount(input.amountCents);

    const dueDate = new Date(`${input.dueDate}T00:00:00.000Z`);
    if (Number.isNaN(dueDate.getTime())) throw new BadRequestException("Data de vencimento inválida");

    return this.prisma.runAs(ctx.academyId, async (db) => {
      /*
       * O âmbito, e não só a academia.
       *
       * `athleteScopeFilter` é o que impede alguém com `billing:write` de âmbito
       * estreito de cobrar a um atleta que não é dele. Para a direcção devolve
       * `undefined` e a condição desaparece, como em todo o lado.
       */
      const athlete = await db.athlete.findFirst({
        where: { id: input.athleteId, ...(athleteScopeFilter(ctx) ? { id: athleteScopeFilter(ctx) } : {}) },
        select: {
          id: true,
          name: true,
          guardians: {
            select: { membership: { select: { userId: true, isActive: true } } },
          },
        },
      });
      if (!athlete) throw new NotFoundException("Atleta não encontrado");

      // A categoria tem de ser de receita: cobrar a uma família por "Autocarro"
      // (despesa) faria o painel de Contas somar a mesma coisa nos dois lados.
      if (input.categoryId) {
        const categoria = await db.catalogItem.findFirst({
          where: { id: input.categoryId, kind: "financeIncome" },
          select: { id: true },
        });
        if (!categoria) throw new BadRequestException("Categoria de receita desconhecida");
      }

      const charge = await db.charge.create({
        data: {
          academyId: ctx.academyId,
          athleteId: athlete.id,
          kind: "EXTRA",
          /*
           * O período é o mês do vencimento, e não o mês de hoje: é assim que a
           * cobrança aparece na lista do mês em que tem de ser paga, ao lado da
           * mensalidade que a acompanha.
           *
           * `slot` único é o que deixa haver duas no mesmo mês — ver a nota da
           * coluna no `schema.prisma`.
           */
          period: `${dueDate.getUTCFullYear()}-${String(dueDate.getUTCMonth() + 1).padStart(2, "0")}`,
          slot: randomUUID(),
          title,
          categoryId: input.categoryId || null,
          notes: input.notes?.trim() || null,
          amountCents: input.amountCents,
          dueDate,
        },
        select: { id: true, period: true, title: true, amountCents: true, dueDate: true },
      });

      /* Todos os encarregados activos — ver a nota em `sendOverdueReminders`. */
      const destinatarios = athlete.guardians.filter((g) => g.membership.isActive);

      for (const g of destinatarios) {
        await this.notifications.enqueue(
          {
            academyId: ctx.academyId,
            userId: g.membership.userId,
            type: NotificationType.PAYMENT_DUE,
            title,
            body: `${athlete.name} · ${(charge.amountCents / 100).toFixed(2)} € até ${dateLabelPt(charge.dueDate)}.${
              input.notes?.trim() ? ` ${input.notes.trim()}` : ""
            }`,
            payload: { route: "/pagamentos", chargeId: charge.id },
          },
          db,
        );
      }

      return { ...charge, avisados: destinatarios.length };
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

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const resultado = await gerarCobrancas(db, ctx.academyId, period);

      /*
       * O envio da mensalidade.
       *
       * Emitir o mês é o gesto deliberado da direcção — e a família tem de o
       * saber, senão a mensalidade fica à espera de que alguém se lembre de
       * abrir a app. Um aviso por cobrança nova, só aos encarregados pagadores,
       * e só às **novas**: gerar o mês duas vezes não incomoda ninguém duas
       * vezes, porque a segunda não cria nada.
       */
      if (resultado.atletasNovos.length > 0) {
        const cobrancas = await db.charge.findMany({
          where: { period, athleteId: { in: resultado.atletasNovos } },
          include: { athlete: { include: { guardians: { include: { membership: true } } } } },
        });
        for (const c of cobrancas) {
          for (const link of c.athlete.guardians.filter((g) => g.membership.isActive)) {
            await this.notifications.enqueue(
              {
                academyId: c.academyId,
                userId: link.membership.userId,
                type: NotificationType.PAYMENT_PENDING,
                title: "Nova mensalidade",
                body: `A mensalidade de ${periodLabelPt(period)} de ${c.athlete.name} já está disponível — ${(c.amountCents / 100).toFixed(2)} €, até ${dateLabelPt(c.dueDate)}.`,
                payload: { route: "/pagamentos", chargeId: c.id },
              },
              db,
            );
          }
        }
      }

      return resultado;
    });
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
    const athleteScope = athleteScopeFilter(ctx);
    const mes = Number(period.slice(5, 7));

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const atletas = await db.athlete.findMany({
        where: {
          status: "ACTIVE",
          // Um atleta sem equipa continua a dever mensalidade — e continua a
          // ter de aparecer a quem gere plantéis. Ver `athleteTeamScopeWhere`.
          ...(athleteTeamScopeWhere(ctx) ?? {}),
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

  /**
   * A partir de quando é que um preço novo passa a ser cobrado.
   *
   * Definir um preço fazia sempre nascer a mensalidade do mês corrente. Está
   * certo para quem chega a meio da época e quer cobrar já, e está errado para
   * quem configura o clube em Agosto para começar a cobrar em Setembro — esse
   * ficava com um mês de mensalidades que nunca quis emitir, e tinha de as anular
   * uma a uma.
   *
   * Por isso passou a ser uma pergunta. "proximo" não gera nada agora: o preço
   * fica registado, os atletas aparecem no painel de mensalidades em falta como
   * **por emitir**, e emitem-se quando for altura — pelo mesmo botão de sempre.
   * Nada fica escondido por se ter escolhido esperar.
   */
  private geraAgora(aplicarEm: AplicarEm | undefined): boolean {
    return aplicarEm !== "proximo";
  }

  /** O preço da equipa — por omissão, para todos os atletas sem ajuste individual. */
  async setTeamFee(ctx: RequestContext, teamId: string, amountCents: number, aplicarEm?: AplicarEm) {
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
       *
       * A menos que se peça o contrário: ver `geraAgora`.
       */
      if (!this.geraAgora(aplicarEm)) {
        return { teamId, amountCents: plan.amountCents, cobrancas: null };
      }

      const atletas = await db.athlete.findMany({
        where: { status: "ACTIVE", teams: { some: { teamId } } },
        select: { id: true },
      });
      const ids = atletas.map((a) => a.id);

      /*
       * Quem tem preço próprio fica de fora da reprecificação.
       *
       * O ajuste individual sobrepõe-se ao da equipa — é a regra do produto — e
       * baixar o preço da equipa não pode reescrever a bolsa de um miúdo.
       */
      const hoje = new Date();
      const comAjusteIndividual = new Set(
        (
          await db.enrollment.findMany({
            where: { athleteId: { in: ids }, plan: { teamId: null, isActive: true } },
            select: { athleteId: true, endsOn: true },
          })
        )
          .filter((e) => e.endsOn === null || e.endsOn >= hoje)
          .map((e) => e.athleteId),
      );
      const periodo = periodoActual();
      const cobrancas = await gerarCobrancas(db, ctx.academyId, periodo, ids);

      /*
       * E as que já existiam passam a valer o preço novo.
       *
       * `gerarCobrancas` só cria o que falta, por isso sozinha deixava a tabela
       * das mensalidades — e a app do pai — a mostrar o preço antigo para sempre.
       * Só se aplica a quem paga o preço da equipa: um atleta com ajuste
       * individual continua a pagar o dele, que é o que "individual sobrepõe-se"
       * quer dizer. Ver `reprecificarCobrancas`.
       */
      const semAjusteIndividual = ids.filter((id) => !comAjusteIndividual.has(id));
      const reprecadas = await reprecificarCobrancas(db, periodo, semAjusteIndividual, amountCents);

      return { teamId, amountCents: plan.amountCents, cobrancas, reprecadas };
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
  async setAthleteFee(ctx: RequestContext, athleteId: string, amountCents: number, aplicarEm?: AplicarEm) {
    if (!can(ctx, "billing:write")) throw new ForbiddenException("Sem permissão para configurar mensalidades");
    assertValidAmount(amountCents);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const athlete = await db.athlete.findFirst({ where: { id: athleteId }, select: { id: true, name: true } });
      if (!athlete) throw new NotFoundException("Atleta não encontrado");

      await applyIndividualFee(db, ctx.academyId, athlete, amountCents);

      // Mesma razão de `setTeamFee`: um atleta que não tinha preço nenhum passa
      // a ter, e a mensalidade do mês corrente nasce aqui em vez de ficar à
      // espera de alguém se lembrar de a gerar. E a mesma escolha — ver `geraAgora`.
      if (!this.geraAgora(aplicarEm)) return { athleteId, amountCents, cobrancas: null };

      const periodo = periodoActual();
      const cobrancas = await gerarCobrancas(db, ctx.academyId, periodo, [athlete.id]);

      /*
       * E as já emitidas passam a valer o preço novo — mesma razão de
       * `setTeamFee`. Aqui não há excepção a fazer: o ajuste individual **é** o
       * preço deste atleta, não há nada por baixo que se lhe sobreponha.
       */
      const reprecadas = await reprecificarCobrancas(db, periodo, [athlete.id], amountCents);

      return { athleteId, amountCents, cobrancas, reprecadas };
    });
  }

  /**
   * O mesmo ajuste, para vários atletas de uma vez — irmãos, um grupo com o
   * mesmo acordo, uma bolsa que abrange uma equipa inteira sem ser a equipa
   * toda. Uma pessoa que fica sem ajuste (id errado, já não está na academia)
   * não impede as restantes — o pedido diz quantos ficaram e quais faltaram.
   */
  async setAthleteFeeBulk(ctx: RequestContext, athleteIds: string[], amountCents: number, aplicarEm?: AplicarEm) {
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

      /*
       * Gera, como os outros dois.
       *
       * Aqui não gerava nada — e era um buraco a sério, não uma omissão inócua:
       * quem definisse preços por este caminho ficava com os atletas a dizer
       * "por emitir" no painel de mensalidades em falta, indefinidamente, sem
       * perceber porque é que o mesmo gesto feito pelo preço da equipa produzia
       * mensalidades e este não. Três formas de definir um preço têm de acabar
       * todas no mesmo sítio.
       */
      const foundIds = new Set(athletes.map((a) => a.id));
      const periodo = periodoActual();
      const cobrancas = this.geraAgora(aplicarEm)
        ? await gerarCobrancas(db, ctx.academyId, periodo, [...foundIds])
        : null;

      /*
       * E as já emitidas passam a valer o preço novo — mesma razão de
       * `setTeamFee`. Aqui não há excepção a fazer: o ajuste individual **é** o
       * preço deste atleta, não há nada por baixo que se lhe sobreponha.
       */
      const reprecadas = this.geraAgora(aplicarEm)
        ? await reprecificarCobrancas(db, periodo, [...foundIds], amountCents)
        : null;

      return {
        amountCents,
        updated: athletes.map((a) => a.id),
        missing: athleteIds.filter((id) => !foundIds.has(id)),
        cobrancas,
        reprecadas,
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
   * Inicia o pagamento de uma mensalidade — por qualquer um dos métodos.
   *
   * O valor **nunca** vem do cliente. O pedido traz apenas o id da cobrança e o
   * método; o montante é lido da base de dados. Se viesse do corpo do pedido, um
   * pai conseguiria pagar quarenta euros com um cêntimo. Os URLs de retorno dos
   * formulários alojados também são construídos aqui — um URL vindo do cliente
   * era um redireccionamento aberto à espera de servir phishing.
   *
   * ## Uma tentativa viva de cada vez
   *
   * Duas referências abertas para a mesma mensalidade é como se paga duas
   * vezes. Uma tentativa em curso do **mesmo** método devolve-se tal como está
   * (a app volta a mostrar a referência ou reabre o formulário). Trocar de
   * método marca a antiga como expirada — e se o pai ainda assim pagar a
   * referência velha e a nova, o webhook apanha o duplicado e deixa-o visível
   * para reembolso, em vez de o engolir (ver `confirmPayment`).
   */
  async startPayment(
    ctx: RequestContext,
    chargeId: string,
    method: PaymentMethod,
    payerPhone?: string,
  ) {
    if (!can(ctx, "billing:read")) throw new ForbiddenException();

    if (method === PaymentMethod.CASH || method === PaymentMethod.TRANSFER) {
      throw new BadRequestException("Esse método não é um pagamento online");
    }

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
      if (charge.status === ChargeStatus.VOID) throw new BadRequestException("Esta mensalidade foi anulada");

      const agora = Date.now();
      const vivos = charge.payments.filter(
        (p) => p.status === PaymentStatus.PENDING || p.status === PaymentStatus.PROCESSING,
      );

      for (const p of vivos) {
        // Um MB Way tem 5 minutos de vida e um formulário 30 — passado o prazo
        // a tentativa está morta, marque-a quem a encontrar primeiro.
        const morto =
          (p.expiresAt && p.expiresAt.getTime() < agora) ||
          (p.method === PaymentMethod.MBWAY && agora - p.createdAt.getTime() > 10 * 60_000);
        if (morto) {
          await db.payment.update({ where: { id: p.id }, data: { status: PaymentStatus.EXPIRED } });
          continue;
        }
        if (p.method === method) return p;
        // Trocar de método: a tentativa antiga morre já. A referência antiga
        // pode continuar pagável do lado do provedor até expirar — se o pai a
        // pagar na mesma, o webhook trata o duplicado às claras.
        await db.payment.update({ where: { id: p.id }, data: { status: PaymentStatus.EXPIRED } });
      }

      // A chave do canal do clube, quando existe — é o que faz o dinheiro
      // liquidar no IBAN do clube, e não em mais lado nenhum. O slug é para o
      // URL de retorno: cada clube tem o seu subdomínio na app da família.
      const academia = await db.academy.findFirst({
        where: { id: ctx.academyId },
        select: { eupagoApiKey: true, slug: true },
      });
      const apiKey = academia?.eupagoApiKey ?? undefined;

      // Quem paga — o email segue para a euPago para o recibo do formulário.
      const pagador = ctx.membershipId
        ? await db.membership.findFirst({
            where: { id: ctx.membershipId },
            select: { user: { select: { name: true, email: true } } },
          })
        : null;

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
        payerName: pagador?.user.name ?? charge.athlete.name,
        payerEmail: pagador?.user.email ?? "",
        apiKey,
      };
      const urls = this.urlsDeRetorno(academia?.slug ?? "");

      try {
        const result = await (async () => {
          switch (method) {
            case PaymentMethod.MBWAY:
              return this.eupago.createMbWayCharge({ ...request, payerPhone: requirePhone(payerPhone) });
            case PaymentMethod.MULTIBANCO:
              return this.eupago.createMultibancoCharge(request);
            case PaymentMethod.CARD:
              return this.eupago.createCardCharge(request, urls);
            case PaymentMethod.GOOGLE_PAY:
              return this.eupago.createGooglePayCharge(request, urls);
            case PaymentMethod.APPLE_PAY:
              return this.eupago.createApplePayCharge(request, urls);
            case PaymentMethod.PAYSAFECARD:
              return this.eupago.createPaysafecardCharge(request, urls);
            case PaymentMethod.DIRECT_DEBIT:
              return this.debitarPorMandato(db, ctx, payment, charge.amountCents, apiKey);
            default:
              throw new BadRequestException("Método de pagamento desconhecido");
          }
        })();

        /*
         * O estado inicial diz o que falta acontecer:
         * - MB Way e débito directo já estão "a caminho" (push aceite no
         *   telemóvel / débito submetido ao banco) — PROCESSING;
         * - Multibanco e formulários ficam PENDING até alguém pagar.
         */
        const aCaminho = method === PaymentMethod.MBWAY || method === PaymentMethod.DIRECT_DEBIT;

        return await db.payment.update({
          where: { id: payment.id },
          data: {
            providerRef: result.providerRef,
            entity: result.entity,
            reference: result.reference,
            redirectUrl: result.redirectUrl,
            expiresAt: result.expiresAt,
            status: aCaminho ? PaymentStatus.PROCESSING : PaymentStatus.PENDING,
          },
        });
      } catch (error) {
        await db.payment.update({
          where: { id: payment.id },
          data: {
            status: PaymentStatus.FAILED,
            rawPayload: { error: error instanceof Error ? error.message : String(error) },
          },
        });
        throw error;
      }
    });
  }

  /**
   * Pagar uma quota de sócio — MB Way ou Multibanco.
   *
   * ## Porque é que não é o `startPayment`
   *
   * Aquele parte de um `RequestContext` — o pagador é um encarregado com
   * membership, o âmbito filtra por `athleteScopeFilter`, o mandato de débito
   * é o dele. Nada disso existe para um sócio: quem chega aqui foi autenticado
   * pela ficha reclamada (ver `ClubAppService`) e o `memberId` **já vem
   * verificado** — este método confia nele de propósito, e é por isso que só a
   * área de sócio lhe chama.
   *
   * O ciclo de vida das tentativas é o mesmo do outro lado: uma viva de cada
   * vez, MB Way morre aos 10 minutos, trocar de método mata a anterior.
   */
  async startMemberFeePayment(
    academyId: string,
    memberId: string,
    feeId: string,
    method: PaymentMethod,
    payerPhone?: string,
  ) {
    if (method !== PaymentMethod.MBWAY && method !== PaymentMethod.MULTIBANCO) {
      throw new BadRequestException("Método de pagamento desconhecido");
    }

    return this.prisma.runAs(academyId, async (db) => {
      const fee = await db.memberFee.findFirst({
        where: { id: feeId, memberId },
        include: { member: { select: { name: true, email: true } }, payments: true },
      });

      if (!fee) throw new NotFoundException("Quota não encontrada");
      if (fee.status === ChargeStatus.SETTLED) throw new BadRequestException("Já está paga");
      if (fee.status === ChargeStatus.VOID) throw new BadRequestException("Esta quota foi anulada");

      const agora = Date.now();
      for (const p of fee.payments) {
        if (p.status !== PaymentStatus.PENDING && p.status !== PaymentStatus.PROCESSING) continue;
        const morto =
          (p.expiresAt && p.expiresAt.getTime() < agora) ||
          (p.method === PaymentMethod.MBWAY && agora - p.createdAt.getTime() > 10 * 60_000);
        if (!morto && p.method === method) return p;
        await db.payment.update({ where: { id: p.id }, data: { status: PaymentStatus.EXPIRED } });
      }

      const academia = await db.academy.findFirst({
        where: { id: academyId },
        select: { eupagoApiKey: true },
      });
      const apiKey = academia?.eupagoApiKey ?? undefined;

      const payment = await db.payment.create({
        data: {
          memberFeeId: fee.id,
          amountCents: fee.amountCents,
          method,
          status: PaymentStatus.PENDING,
        },
      });

      const request = {
        reference: payment.id,
        amountCents: fee.amountCents,
        description: `${fee.label ?? `Quota ${fee.period}`} — ${fee.member.name}`,
        payerName: fee.member.name,
        payerEmail: fee.member.email ?? "",
        apiKey,
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
            status: method === PaymentMethod.MBWAY ? PaymentStatus.PROCESSING : PaymentStatus.PENDING,
          },
        });
      } catch (error) {
        await db.payment.update({
          where: { id: payment.id },
          data: {
            status: PaymentStatus.FAILED,
            rawPayload: { error: error instanceof Error ? error.message : String(error) },
          },
        });
        throw error;
      }
    });
  }

  /**
   * Débito directo de uma mensalidade — contra o mandato do pagador.
   *
   * O mandato é do **membership que pede**, nunca de outro: um encarregado só
   * debita da conta que ele próprio autorizou.
   */
  private async debitarPorMandato(
    db: ScopedClient,
    ctx: RequestContext,
    payment: Payment,
    amountCents: number,
    apiKey?: string,
  ): Promise<ChargeResult> {
    if (!ctx.membershipId) throw new BadRequestException("Sessão sem pagador identificado");

    const mandato = await db.directDebitMandate.findFirst({
      where: { membershipId: ctx.membershipId, status: { not: "CANCELLED" } },
    });
    if (!mandato) {
      throw new BadRequestException("Ainda não autorizaste o débito directo — configura-o primeiro");
    }

    const r = await this.eupago.chargeDirectDebit({
      mandateRef: mandato.eupagoRef,
      paymentId: payment.id,
      amountCents,
      apiKey,
    });

    // O mandato fica ligado ao pagamento (em rawPayload, lido na confirmação)
    // para o primeiro débito confirmado o marcar como ACTIVO.
    await db.payment.update({
      where: { id: payment.id },
      data: { rawPayload: { mandateId: mandato.id, collectionDate: r.collectionDate ?? null } },
    });

    // O débito SEPA leva dias a liquidar; o webhook dirá quando chegou. O
    // identificador que volta é o nosso payment.id (o `obs` do pedido).
    return { providerRef: payment.id };
  }

  /**
   * Os URLs de retorno dos formulários alojados — sempre do servidor.
   *
   * Cada clube tem o seu subdomínio na app da família (`ad-fafe.academias.pt`),
   * por isso `FAMILY_APP_URL` aceita `{slug}`: com
   * `https://{slug}.academias.pt`, o pai do AD Fafe volta ao AD Fafe. Sem o
   * marcador, é um URL único — o suficiente em desenvolvimento.
   */
  private urlsDeRetorno(slug: string): RedirectUrls {
    const base = (this.config.get<string>("FAMILY_APP_URL") ?? "http://localhost:5174")
      .replace("{slug}", slug)
      .replace(/\/$/, "");
    return {
      successUrl: `${base}/pagamentos?retorno=ok`,
      failUrl: `${base}/pagamentos?retorno=falhou`,
      backUrl: `${base}/pagamentos?retorno=voltei`,
    };
  }

  /* ------------------------------------------------------------------------ */
  /* Débito directo — o mandato                                                */
  /* ------------------------------------------------------------------------ */

  /** O mandato do próprio — só os dados que a app precisa de mostrar. */
  async getMandate(ctx: RequestContext) {
    if (!can(ctx, "billing:read")) throw new ForbiddenException();
    if (!ctx.membershipId) return null;

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const m = await db.directDebitMandate.findFirst({
        where: { membershipId: ctx.membershipId!, status: { not: "CANCELLED" } },
        select: { id: true, debtorName: true, ibanTail: true, status: true, createdAt: true },
      });
      return m ?? null;
    });
  }

  /**
   * Autorizar o débito directo — uma vez, para todos os educandos.
   *
   * O IBAN valida-se aqui (mod-97) e **não se guarda**: segue para a euPago,
   * que é quem debita, e na base ficam só os últimos 4 dígitos para o pai
   * reconhecer a conta. A euPago envia o PDF do mandato para o email do
   * pagador — o débito só funciona depois de ela o dar por autorizado.
   */
  async createMandate(ctx: RequestContext, dto: { iban: string; name: string; bic?: string }) {
    if (!can(ctx, "billing:read")) throw new ForbiddenException();
    if (!ctx.membershipId) throw new BadRequestException("Sessão sem pagador identificado");

    const iban = dto.iban.replace(/\s/g, "").toUpperCase();
    if (!ibanValido(iban)) throw new BadRequestException("IBAN inválido — confere os dígitos");
    const nome = dto.name.trim();
    if (nome.length < 3) throw new BadRequestException("Escreve o nome do titular da conta");

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const pagador = await db.membership.findFirst({
        where: { id: ctx.membershipId! },
        select: { id: true, user: { select: { email: true } } },
      });
      if (!pagador?.user.email) throw new BadRequestException("A tua conta não tem email — o mandato segue por email");

      const existente = await db.directDebitMandate.findFirst({ where: { membershipId: ctx.membershipId! } });

      const auth = await this.eupago.createDebitAuthorization({
        reference: existente?.id ?? ctx.membershipId!,
        iban,
        name: nome,
        email: pagador.user.email,
        bic: dto.bic?.trim() || undefined,
        apiKey: (await db.academy.findFirst({ where: { id: ctx.academyId }, select: { eupagoApiKey: true } }))
          ?.eupagoApiKey ?? undefined,
      });

      const dados = {
        debtorName: nome,
        ibanTail: iban.slice(-4),
        eupagoRef: auth.providerRef,
        status: "PENDING" as const,
      };

      const m = existente
        ? await db.directDebitMandate.update({ where: { id: existente.id }, data: dados })
        : await db.directDebitMandate.create({
            data: { academyId: ctx.academyId, membershipId: ctx.membershipId!, ...dados },
          });

      return { id: m.id, debtorName: m.debtorName, ibanTail: m.ibanTail, status: m.status };
    });
  }

  /** Cancelar o mandato — deixa de ser possível debitar por ele a partir daqui. */
  async cancelMandate(ctx: RequestContext) {
    if (!can(ctx, "billing:read")) throw new ForbiddenException();
    if (!ctx.membershipId) throw new BadRequestException("Sessão sem pagador identificado");

    return this.prisma.runAs(ctx.academyId, async (db) => {
      await db.directDebitMandate.updateMany({
        where: { membershipId: ctx.membershipId! },
        data: { status: "CANCELLED" },
      });
      return { ok: true };
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
   *
   * `refs` são os candidatos a identificar o pagamento, por ordem de confiança:
   * o nosso `identifier` (o id do Payment, que nós próprios enviámos), depois a
   * referência e o trid do provedor.
   */
  async confirmPayment(refs: string[], paidAt: Date, rawPayload: unknown, paidCents?: number) {
    const found = await this.encontrarPagamento(refs);
    if (!found) {
      this.log.warn(`Webhook para um pagamento desconhecido: ${refs.join(", ")}`);
      return { handled: false as const };
    }

    return this.prisma.runAs(found.academyId, async (db) => {
      const payment = await db.payment.findFirst({
        where: { id: found.paymentId },
        include: {
          charge: { include: { athlete: { include: { guardians: { include: { membership: true } } } } } },
          memberFee: { include: { member: { select: { id: true, name: true, userId: true } } } },
        },
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
          `Valor divergente no webhook de ${payment.id}: pago ${paidCents}, esperado ${payment.amountCents}`,
        );
        await db.payment.update({
          where: { id: payment.id },
          data: { status: PaymentStatus.FAILED, rawPayload: rawPayload as object },
        });
        return { handled: true as const, amountMismatch: true };
      }

      /*
       * Uma quota de sócio liquida-se aqui e sai — o resto deste método é o
       * mundo das mensalidades (mandatos, encarregados, pagadores) e nada dele
       * se aplica a um sócio.
       */
      if (payment.memberFee) {
        const fee = payment.memberFee;
        const duplicada = fee.status === ChargeStatus.SETTLED;
        if (duplicada) {
          this.log.error(
            `PAGAMENTO DUPLICADO: a quota ${fee.id} (${fee.period}) já estava liquidada e chegou outro ` +
              `pagamento de ${(payment.amountCents / 100).toFixed(2)} € (payment ${payment.id}). Reembolsar na euPago.`,
          );
        }

        await db.payment.update({
          where: { id: payment.id },
          data: { status: PaymentStatus.PAID, paidAt, rawPayload: rawPayload as object },
        });
        if (!duplicada) {
          await db.memberFee.update({
            where: { id: fee.id },
            data: { status: ChargeStatus.SETTLED, settledAt: paidAt, method: payment.method },
          });
        }

        if (fee.member.userId) {
          await this.notifications.enqueue(
            {
              academyId: fee.academyId,
              userId: fee.member.userId,
              type: NotificationType.PAYMENT_RECEIVED,
              title: "Quota paga",
              body: `Recebemos ${(payment.amountCents / 100).toFixed(2)} € da quota ${fee.label ?? fee.period}.`,
              payload: { route: "/socio/quotas", memberFeeId: fee.id },
            },
            db,
          );
        }

        return { handled: true as const, duplicate: false };
      }

      const charge = payment.charge;
      if (!charge) return { handled: false as const };

      // O primeiro débito directo confirmado prova que o mandato está vivo. O
      // id vem do rawPayload guardado ao debitar — lido ANTES de o webhook o
      // substituir.
      const mandateId =
        payment.method === PaymentMethod.DIRECT_DEBIT &&
        payment.rawPayload &&
        typeof payment.rawPayload === "object"
          ? String((payment.rawPayload as Record<string, unknown>).mandateId ?? "")
          : "";

      /*
       * Dinheiro a dobrar não se esconde.
       *
       * Se a cobrança já está liquidada por outro pagamento (o pai pagou a
       * referência antiga E a nova), este pagamento fica PAID na mesma — o
       * dinheiro entrou de verdade — mas a cobrança não se toca e o caso fica
       * gritado no log, porque o passo seguinte é um reembolso humano.
       */
      const jaLiquidada = charge.status === ChargeStatus.SETTLED;
      if (jaLiquidada) {
        this.log.error(
          `PAGAMENTO DUPLICADO: a mensalidade ${charge.id} (${charge.period}) já estava liquidada e chegou ` +
            `outro pagamento de ${(payment.amountCents / 100).toFixed(2)} € (payment ${payment.id}). Reembolsar na euPago.`,
        );
      }

      // Já estamos dentro da transação de `runAs` — as duas escritas caem ou
      // passam juntas sem precisar de um `$transaction` aninhado.
      await db.payment.update({
        where: { id: payment.id },
        data: { status: PaymentStatus.PAID, paidAt, rawPayload: rawPayload as object },
      });
      if (!jaLiquidada) {
        await db.charge.update({
          where: { id: charge.id },
          data: { status: ChargeStatus.SETTLED, settledAt: paidAt },
        });
      }

      if (mandateId) {
        await db.directDebitMandate
          .update({ where: { id: mandateId }, data: { status: "ACTIVE" } })
          .catch(() => undefined);
      }

      /*
       * Só depois de a base estar consistente é que se avisa a família — e
       * avisa-se a família toda: se o pai pagou, a mãe quer saber que está pago
       * tanto como ele. É o aviso que mais vale a pena chegar aos dois.
       */
      for (const link of charge.athlete.guardians) {
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

  async failPayment(refs: string[], reason: string, rawPayload: unknown, markAs: "FAILED" | "EXPIRED" = "FAILED") {
    const found = await this.encontrarPagamento(refs);
    if (!found) return { handled: false as const };

    return this.prisma.runAs(found.academyId, async (db) => {
      const payment = await db.payment.findFirst({
        where: { id: found.paymentId },
        include: {
          charge: { include: { athlete: { include: { guardians: { include: { membership: true } } } } } },
          memberFee: { include: { member: { select: { userId: true } } } },
        },
      });
      if (!payment || payment.status === PaymentStatus.PAID) return { handled: false as const };

      await db.payment.update({
        where: { id: payment.id },
        data: {
          status: markAs === "EXPIRED" ? PaymentStatus.EXPIRED : PaymentStatus.FAILED,
          rawPayload: rawPayload as object,
        },
      });

      // Uma referência que expira em silêncio não precisa de acordar ninguém;
      // um pagamento recusado precisa — quem pagou pensa que pagou.
      if (markAs === "FAILED" && payment.charge) {
        for (const link of payment.charge.athlete.guardians) {
          await this.notifications.enqueue({
            academyId: payment.charge.academyId,
            userId: link.membership.userId,
            type: NotificationType.PAYMENT_FAILED,
            title: "O pagamento não foi concluído",
            body: reason,
            payload: { route: "/pagamentos", chargeId: payment.chargeId },
          }, db);
        }
      }
      if (markAs === "FAILED" && payment.memberFee?.member.userId) {
        await this.notifications.enqueue({
          academyId: payment.memberFee.academyId,
          userId: payment.memberFee.member.userId,
          type: NotificationType.PAYMENT_FAILED,
          title: "O pagamento não foi concluído",
          body: reason,
          payload: { route: "/socio/quotas", memberFeeId: payment.memberFeeId },
        }, db);
      }

      return { handled: true as const };
    });
  }

  /**
   * Um reembolso feito na euPago (backoffice do clube) volta pelo webhook. O
   * pagamento fica `REFUNDED` e a mensalidade reabre — o histórico conta a
   * história toda: pagou, foi devolvido, voltou a estar por pagar.
   */
  async refundPayment(refs: string[], rawPayload: unknown) {
    const found = await this.encontrarPagamento(refs);
    if (!found) return { handled: false as const };

    return this.prisma.runAs(found.academyId, async (db) => {
      const payment = await db.payment.findFirst({
        where: { id: found.paymentId },
        include: {
          charge: { select: { id: true, status: true } },
          memberFee: { select: { id: true, status: true } },
        },
      });
      if (!payment || payment.status !== PaymentStatus.PAID) return { handled: false as const };

      await db.payment.update({
        where: { id: payment.id },
        data: { status: PaymentStatus.REFUNDED, rawPayload: rawPayload as object },
      });
      if (payment.charge && payment.charge.status === ChargeStatus.SETTLED) {
        await db.charge.update({
          where: { id: payment.charge.id },
          data: { status: ChargeStatus.OPEN, settledAt: null },
        });
      }
      if (payment.memberFee && payment.memberFee.status === ChargeStatus.SETTLED) {
        await db.memberFee.update({
          where: { id: payment.memberFee.id },
          data: { status: ChargeStatus.OPEN, settledAt: null, method: null },
        });
      }

      return { handled: true as const };
    });
  }

  /**
   * De um punhado de candidatos do webhook para um pagamento nosso.
   *
   * O webhook chega sem tenant — é o pagamento que o identifica. A resolução
   * passa por uma função `SECURITY DEFINER` que só sabe devolver um id de
   * academia (nem valor, nem nomes, nem mais nada), e só depois se abre o
   * contexto. Sem este passo a RLS bloquearia a leitura e os pagamentos
   * deixariam de confirmar, em silêncio.
   */
  private async encontrarPagamento(refs: string[]): Promise<{ academyId: string; paymentId: string } | null> {
    for (const ref of refs) {
      if (!ref) continue;
      const academyId = await this.prisma.resolvePaymentAcademy("eupago", ref);
      if (!academyId) continue;

      const paymentId = await this.prisma.runAs(academyId, async (db) => {
        const p = await db.payment.findFirst({
          where: { provider: "eupago", OR: [{ providerRef: ref }, { id: ref }] },
          select: { id: true },
        });
        return p?.id ?? null;
      });
      if (paymentId) return { academyId, paymentId };
    }
    return null;
  }
}

function requirePhone(phone: string | undefined): string {
  if (!phone) throw new BadRequestException("MB Way precisa de um número de telemóvel");
  return phone;
}

/**
 * Validação de IBAN (ISO 13616, mod-97): os quatro primeiros caracteres vão
 * para o fim, letras viram números (A=10 … Z=35), e o resto da divisão por 97
 * tem de ser 1. Apanha o dígito trocado antes de o mandato seguir para o banco
 * — um IBAN errado no débito directo é uma devolução semanas depois.
 */
function ibanValido(iban: string): boolean {
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return false;
  const rodado = iban.slice(4) + iban.slice(0, 4);
  const digitos = rodado.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let resto = 0;
  for (let i = 0; i < digitos.length; i += 7) {
    resto = Number(String(resto) + digitos.slice(i, i + 7)) % 97;
  }
  return resto === 1;
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
/**
 * Aplicar um preço novo às mensalidades **já emitidas** deste período.
 *
 * ## O que estava a acontecer
 *
 * `gerarCobrancas` só cria o que falta — e está certo, é isso que a torna segura
 * de correr as vezes que forem precisas. Mas o diálogo pergunta "aplicar já em
 * Agosto?" e, para quem já tinha a mensalidade de Agosto emitida, a resposta era
 * não fazer nada. O preço da equipa mudava para 35 €, a ficha do atleta passava a
 * dizer 35 €, e a tabela das mensalidades continuava a dizer 40 € — tal como a
 * app do pai, que lê a mesma cobrança. Três ecrãs, dois números, nenhum aviso.
 *
 * Aplicar em Agosto tem de querer dizer *em Agosto*.
 *
 * ## O que não se toca, e porquê
 *
 * **Pagas** (`SETTLED`). O dinheiro entrou por aquele valor. Reescrevê-lo era
 * mudar o passado e deixar a conta do clube a não bater certo com o banco.
 *
 * **Anuladas** (`VOID`). Alguém decidiu não cobrar aquele mês àquele atleta.
 * Repor-lhe um valor ressuscitava uma cobrança que foi deliberadamente morta.
 *
 * **Com um pagamento a caminho.** É o caso menos óbvio e o mais importante: uma
 * referência Multibanco de 40 € já está no telemóvel do pai e no sistema da
 * euPago. Mudar a cobrança para 35 € por baixo dela deixa-o a pagar um valor que
 * a plataforma já não reconhece — e o pagamento chega e não fecha nada. A
 * cobrança fica como está, e é dito quantas ficaram de fora.
 *
 * O resto — `OPEN`, sem pagamento vivo — passa a valer o preço novo.
 */
export async function reprecificarCobrancas(
  db: ScopedClient,
  period: string,
  athleteIds: string[],
  amountCents: number,
): Promise<{ actualizadas: number; intocadas: number }> {
  if (athleteIds.length === 0) return { actualizadas: 0, intocadas: 0 };

  const candidatas = await db.charge.findMany({
    where: { period, athleteId: { in: athleteIds }, status: "OPEN" },
    select: {
      id: true,
      amountCents: true,
      payments: {
        where: { status: { in: ["PENDING", "PROCESSING", "PAID"] } },
        select: { id: true },
        take: 1,
      },
    },
  });

  const paraMudar = candidatas.filter((c) => c.payments.length === 0 && c.amountCents !== amountCents);
  const travadas = candidatas.filter((c) => c.payments.length > 0 && c.amountCents !== amountCents);

  if (paraMudar.length > 0) {
    await db.charge.updateMany({
      where: { id: { in: paraMudar.map((c) => c.id) } },
      data: { amountCents },
    });
  }

  return { actualizadas: paraMudar.length, intocadas: travadas.length };
}

export async function gerarCobrancas(
  db: ScopedClient,
  academyId: string,
  period: string,
  /** Limita a geração a estes atletas. Sem isto, gera para a academia toda. */
  apenasAtletas?: string[],
): Promise<{
  period: string;
  criadas: number;
  jaExistiam: number;
  semPreco: number;
  foraDoMes: number;
  /** Quem ganhou cobrança nova — é a quem o "envio da mensalidade" avisa. */
  atletasNovos: string[];
}> {
  const mes = Number(period.slice(5, 7));

  const atletas = await db.athlete.findMany({
    where: {
      status: "ACTIVE",
      ...(apenasAtletas ? { id: { in: apenasAtletas } } : {}),
    },
    select: { id: true, joinedAt: true, teams: { select: { teamId: true }, take: 1 } },
  });
  if (atletas.length === 0) {
    return { period, criadas: 0, jaExistiam: 0, semPreco: 0, foraDoMes: 0, atletasNovos: [] };
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

  return {
    period,
    criadas: novas.length,
    jaExistiam,
    semPreco,
    foraDoMes,
    atletasNovos: novas.map((n) => n.athleteId),
  };
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
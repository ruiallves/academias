import { inicioDaEpoca } from "../members/member-fees.service";
import { randomUUID } from "node:crypto";
import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PaymentMethod, PaymentStatus, ChargeStatus, NotificationType, type Payment, type Prisma } from "@prisma/client";
import { PrismaService, type ScopedClient } from "../prisma/prisma.service";
import { razaoParaNaoApagar } from "../members/member-fees.service";
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

/**
 * Os métodos que a app oferece **hoje**.
 *
 * ## Porquê uma lista branca, e não a ausência de botões
 *
 * Porque a app não é a fronteira. Esconder o cartão do ecrã tira-o a quem usa a
 * app e deixa-o a quem chamar o endpoint à mão — e o que está do outro lado é
 * dinheiro a sair da conta de um pai. Uma lista aqui é a diferença entre uma
 * escolha de produto e uma garantia.
 *
 * ## O que ficou de fora, e porquê
 *
 * `CARD`, `GOOGLE_PAY`, `APPLE_PAY` e `DIRECT_DEBIT` estão **implementados e a
 * funcionar** — o cliente da euPago sabe criá-los, as taxas estão na tabela e o
 * webhook liquida-os como aos outros. Não saíram por avaria: saíram porque o
 * produto decidiu, por agora, oferecer só os dois que qualquer pai português
 * usa sem pensar. `PAYSAFECARD` já estava fora pelo custo (12 % de comissão —
 * ver `METODOS` em `apps/family/src/screens/Payments.tsx`).
 *
 * **Voltar a ligar um é acrescentá-lo aqui e à lista da app.** Nada mais foi
 * removido, de propósito: o código que os cria continua inteiro.
 *
 * ## Não confundir com `EUPAGO_METHODS`
 *
 * Essa variável (ver `eupago-fees.ts`) decide que métodos aparecem na **tabela
 * de taxas** que o clube consulta ao fixar preços — quanto lhe fica de cada
 * um. Não decide o que a app aceita, e o comentário de lá já o diz por
 * palavras próprias. São duas perguntas: *quanto custa este método ao clube* e
 * *este método pode ser usado*. Esta lista responde à segunda.
 */
const METODOS_ATIVOS: ReadonlySet<PaymentMethod> = new Set<PaymentMethod>([
  PaymentMethod.MBWAY,
  PaymentMethod.MULTIBANCO,
]);

@Injectable()
export class BillingService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(BillingService.name);

  /* ------------------------------------------------------------------------ */
  /* O temporizador da reconciliação                                           */
  /* ------------------------------------------------------------------------ */

  private reconciliacao: NodeJS.Timeout | null = null;
  private emissao: NodeJS.Timeout | null = null;

  /**
   * O último período já garantido em cada academia, nesta vida do processo.
   *
   * É o que faz a varredura horária custar praticamente nada: emitido o mês
   * para um clube, salta-se esse clube até o mês virar. Não é uma cache de
   * dados — é uma marca de "já perguntei" —, e perdê-la num deploy só custa
   * uma passagem a mais, que não cria nada por a emissão ser idempotente.
   */
  private readonly emitido = new Map<string, string>();

  /**
   * A reconciliação corre sozinha, de dez em dez minutos.
   *
   * ## Porquê um temporizador, quando `presence.service` recusou um
   *
   * Lá havia uma escrita onde pendurar a varredura. Aqui não há: o que se
   * está à espera é de um evento **que não chega**, e não há escrita nossa que
   * o anuncie. Ou se pergunta de tempos a tempos, ou não se pergunta.
   *
   * `unref()` é o que deixa o processo morrer nos testes e nas fechaduras
   * graciosas sem esperar pela próxima volta; `onModuleDestroy` limpa-o na
   * mesma, por higiene. O primeiro passe é meio minuto depois do arranque — a
   * base já está ligada, e um deploy a seguir a um dia de webhooks perdidos
   * apanha-os sem ninguém carregar em nada.
   *
   * Desligado quando `RECONCILE_INTERVAL_MIN=0`, para um ambiente que não
   * queira que o servidor fale com a euPago por conta própria.
   */
  onModuleInit() {
    const minutos = Number(this.config.get<string>("RECONCILE_INTERVAL_MIN") ?? "10");
    if (!Number.isFinite(minutos) || minutos <= 0) {
      this.log.warn("Reconciliação automática desligada (RECONCILE_INTERVAL_MIN=0)");
      return;
    }
    const passe = () =>
      this.reconcilePayments().catch((e) => this.log.error(`Reconciliação falhou: ${e instanceof Error ? e.message : e}`));

    setTimeout(passe, 30_000).unref();
    this.reconciliacao = setInterval(passe, minutos * 60_000);
    this.reconciliacao.unref();

    this.arrancarEmissao();
  }

  /**
   * A emissão do mês, sozinha.
   *
   * ## Porquê de hora a hora, e não "à meia-noite do dia 1"
   *
   * Porque um relógio que dispara uma vez por mês é um relógio que falha uma
   * vez por mês: basta o processo estar a reiniciar naquele minuto — um deploy,
   * o Railway a mover o contentor — para o mês inteiro ficar por emitir, e só
   * se dar por isso quando um pai telefonar. Uma varredura frequente sobre uma
   * operação idempotente não tem esse problema: a primeira passagem depois da
   * meia-noite emite, as outras não fazem nada, e um servidor que esteve em
   * baixo apanha o atraso assim que voltar.
   *
   * O preço é uma ida à base por clube, uma vez por mês — o `emitido` trata do
   * resto. `unref()` deixa o processo morrer nos testes sem esperar pela volta
   * seguinte.
   *
   * `AUTO_BILLING_INTERVAL_MIN=0` desliga, para um ambiente que não queira o
   * servidor a emitir cobranças por conta própria.
   */
  private arrancarEmissao() {
    const minutos = Number(this.config.get<string>("AUTO_BILLING_INTERVAL_MIN") ?? "60");
    if (!Number.isFinite(minutos) || minutos <= 0) {
      this.log.warn("Emissão automática de mensalidades desligada (AUTO_BILLING_INTERVAL_MIN=0)");
      return;
    }
    const passe = () =>
      this.issueMonthlyCharges().catch((e) =>
        this.log.error(`Emissão automática falhou: ${e instanceof Error ? e.message : e}`),
      );

    // Um minuto depois de arrancar: a base já está ligada, e um deploy feito no
    // dia 1 emite sem esperar pela hora seguinte.
    setTimeout(passe, 60_000).unref();
    this.emissao = setInterval(passe, minutos * 60_000);
    this.emissao.unref();
  }

  onModuleDestroy() {
    if (this.reconciliacao) clearInterval(this.reconciliacao);
    if (this.emissao) clearInterval(this.emissao);
  }

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
  /* Emissão automática do mês                                                 */
  /* ------------------------------------------------------------------------ */

  /**
   * Garante as mensalidades do mês corrente em todos os clubes.
   *
   * ## O que faz, e o que deliberadamente não faz
   *
   * Chama a mesma `gerarCobrancas` do botão "Gerar mensalidades" — o mesmo
   * calendário do clube (`billingMonths`), o mesmo dia de vencimento, os mesmos
   * planos de equipa e ajustes individuais — e manda o mesmo aviso às famílias.
   * Não há uma segunda regra de emissão a viver em paralelo com a primeira: se
   * amanhã o cálculo mudar, muda num sítio e os dois caminhos seguem-no.
   *
   * O que não faz é decidir seja o que for sobre quem paga: um clube que não
   * cobra Agosto continua a não cobrar Agosto, e um atleta sem preço continua a
   * aparecer no painel de "em falta" à espera de que alguém lhe defina um.
   * Automatizar a emissão não é automatizar a configuração.
   *
   * ## Idempotente, e por isso segura de repetir
   *
   * `gerarCobrancas` só cria o que falta. Correr isto dez vezes no dia 1 dá o
   * mesmo resultado que correr uma; correr no dia 14 emite o que faltava desde
   * o dia 1 sem tocar no que já lá está. É essa propriedade que permite a
   * varredura frequente em vez de um disparo único e frágil.
   *
   * `apenasAcademia` serve o gatilho manual do painel da plataforma.
   */
  async issueMonthlyCharges(apenasAcademia?: string) {
    const period = periodoActual();
    const linhas = await this.prisma.$queryRaw<{ academy_id: string }[]>`
      SELECT * FROM app.academies_for_billing()
    `;
    const alvo = apenasAcademia ? linhas.filter((l) => l.academy_id === apenasAcademia) : linhas;

    const totais = { period, academias: alvo.length, visitadas: 0, criadas: 0, comErro: 0 };

    for (const { academy_id: academyId } of alvo) {
      // Já garantido este mês nesta vida do processo — ver `emitido`.
      if (!apenasAcademia && this.emitido.get(academyId) === period) continue;

      try {
        /*
         * Só cria. Retirar mensalidades de meses fechados fica para quando o
         * clube desliga o mês (ver `retirarForaDoCalendario`), e não para aqui:
         * a direcção pode lançar à mão uma mensalidade num mês fora do
         * calendário (`createManualFees`), e um passe de hora a hora que as
         * apagasse desfazia esse lançamento sem ninguém dar por isso.
         */
        const criadas = await this.prisma.runAs(academyId, async (db) => {
          const resultado = await gerarCobrancas(db, academyId, period);
          await this.avisarMensalidadesNovas(db, period, resultado.atletasNovos);
          return resultado.criadas;
        });

        this.emitido.set(academyId, period);
        totais.visitadas++;
        totais.criadas += criadas;
        if (criadas > 0) {
          this.log.log(`Emissão automática: ${criadas} mensalidades de ${period} no clube ${academyId}`);
        }
      } catch (error) {
        /*
         * Um clube que falha não trava os outros, e **não** fica marcado como
         * emitido: a passagem seguinte volta a tentar. É a diferença entre um
         * erro que se resolve sozinho daqui a uma hora e um mês inteiro perdido
         * por causa de uma transacção que bateu num impasse.
         */
        totais.comErro++;
        this.log.error(
          `Emissão automática falhou no clube ${academyId}: ${error instanceof Error ? error.message : error}`,
        );
      }
    }

    return totais;
  }

  /**
   * O aviso de mensalidade nova às famílias.
   *
   * Extraído de `ensureCharges` quando a emissão passou a ter dois caminhos — o
   * botão e o relógio. Duas cópias da mesma mensagem divergem: uma ganha o
   * valor no corpo, a outra fica sem, e a família recebe coisas diferentes
   * consoante quem carregou no quê.
   *
   * Só aos encarregados **activos**, e só pelas cobranças **novas**: emitir o
   * mês duas vezes não incomoda ninguém duas vezes, porque a segunda não cria
   * nada e esta lista chega vazia.
   */
  private async avisarMensalidadesNovas(db: ScopedClient, period: string, atletasNovos: string[]) {
    if (atletasNovos.length === 0) return;

    /*
     * Só o que ficou por pagar.
     *
     * Uma mensalidade de 0 € nasce paga (ver `nasceIsenta`), e avisar a família
     * de que tem uma mensalidade "disponível" de zero euros era mandá-la a um
     * ecrã de pagamento sem nada para pagar.
     */
    const cobrancas = await db.charge.findMany({
      where: { period, athleteId: { in: atletasNovos }, status: ChargeStatus.OPEN },
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

  /* ------------------------------------------------------------------------ */
  /* Reconciliação — a segunda fonte de verdade                                */
  /* ------------------------------------------------------------------------ */

  /**
   * Pergunta à euPago pelos pagamentos em voo e acerta o que ela souber.
   *
   * ## O que aconteceu, e porque é que isto existe
   *
   * Dois pais pagaram por MB Way; de manhã a app dizia-lhes que deviam. A
   * euPago tinha o dinheiro e nós não tínhamos o webhook — e nunca tivemos: em
   * toda a base não há um único pagamento confirmado pelo webhook, só os
   * marcados à mão. O servidor aceita um evento bem assinado (verificado em
   * produção); o que não chega é o evento da euPago. Isso resolve-se no
   * backoffice dela, não aqui. O que se resolve aqui é o **efeito**: um
   * pagamento feito não pode ficar "a confirmar" para sempre por falta de um
   * POST que se perdeu.
   *
   * ## A regra continua inteira
   *
   * O navegador nunca decide. Quem liquida é `confirmPayment` — o mesmo do
   * webhook, com a mesma verificação de valor. Isto só lhe dá uma segunda
   * fonte: a resposta da própria euPago a uma pergunta nossa.
   *
   * ## As decisões, por ordem, para cada pagamento em voo
   *
   * 1. Referência `dev-*` — simulada, nunca teve dinheiro atrás: expira.
   * 2. A cobrança já está liquidada ou anulada por outro caminho (a direcção
   *    marcou em dinheiro, por exemplo): a tentativa fica **substituída** e
   *    expira, para a app deixar de a mostrar "a confirmar". Se um dia o
   *    webhook dela chegar, `confirmPayment` grita o duplicado como sempre.
   * 3. Multibanco com entidade e referência: `multibanco/info`. Pago liquida;
   *    expirado/cancelado expira; o resto fica e regista-se o estado
   *    desconhecido.
   * 4. Tudo o resto (MB Way, cartão, formulários): a lista de pagos da API de
   *    gestão, quando há credenciais OAuth. Está lá — liquida.
   * 5. Sem resposta que o confirme: um MB Way com mais de dez minutos, ou
   *    qualquer tentativa com `expiresAt` passado, expira. **Expirar não é
   *    negar**: `confirmPayment` liquida um pagamento EXPIRED na mesma se o
   *    dinheiro aparecer depois — pelo webhook ou por um passe seguinte com
   *    credenciais. O que muda é só o que a app diz entretanto: "por pagar",
   *    que é honesto, em vez de "a confirmar", que era uma promessa.
   *
   * Corre fora de qualquer pedido, por isso enumera os pares (academia,
   * pagamento) por uma função SECURITY DEFINER estreita e faz o resto dentro
   * de `runAs`, com a RLS de sempre. Ver a migração `reconciliacao_pagamentos`.
   */
  async reconcilePayments(apenasAcademia?: string) {
    const pares = await this.prisma.$queryRaw<{ academy_id: string; payment_id: string }[]>`
      SELECT * FROM app.payments_in_flight()
    `;
    const alvo = apenasAcademia ? pares.filter((p) => p.academy_id === apenasAcademia) : pares;

    const totais = { vistos: alvo.length, liquidados: 0, expirados: 0, substituidos: 0, semResposta: 0 };
    if (alvo.length === 0) return totais;

    // A lista de pagos pede-se uma vez por passe, não uma vez por pagamento.
    // `null` quer dizer "não sei" — e não sei não é "nenhum está pago".
    const pagos = await this.eupago.listPaidTransactions();

    for (const par of alvo) {
      try {
        const resultado = await this.reconciliarUm(par.academy_id, par.payment_id, pagos);
        totais[resultado]++;
      } catch (error) {
        totais.semResposta++;
        this.log.warn(`Reconciliação de ${par.payment_id} falhou: ${error instanceof Error ? error.message : error}`);
      }
    }

    if (totais.liquidados || totais.expirados || totais.substituidos) {
      this.log.log(
        `Reconciliação: ${totais.vistos} em voo — ${totais.liquidados} liquidados, ` +
          `${totais.substituidos} substituídos, ${totais.expirados} expirados, ${totais.semResposta} sem resposta`,
      );
    }
    return totais;
  }

  /** A mesma varredura, só para a academia de quem pede. Exige `billing:write`. */
  async reconcileAcademy(ctx: RequestContext) {
    if (!can(ctx, "billing:write")) throw new ForbiddenException("Sem permissão para reconciliar pagamentos");
    return this.reconcilePayments(ctx.academyId);
  }

  private async reconciliarUm(
    academyId: string,
    paymentId: string,
    pagos: Map<string, { trid: string; paidAt: Date; amountCents: number }> | null,
  ): Promise<"liquidados" | "expirados" | "substituidos" | "semResposta"> {
    const payment = await this.prisma.runAs(academyId, (db) =>
      db.payment.findFirst({
        where: { id: paymentId },
        include: { charge: { select: { status: true } }, memberFee: { select: { status: true } } },
      }),
    );
    if (!payment || (payment.status !== PaymentStatus.PENDING && payment.status !== PaymentStatus.PROCESSING)) {
      return "semResposta";
    }

    const expirar = (motivo: string) =>
      this.prisma.runAs(academyId, async (db) => {
        await db.payment.update({
          where: { id: payment.id },
          data: { status: PaymentStatus.EXPIRED, rawPayload: { reconciliacao: motivo, em: new Date().toISOString() } },
        });
      });

    // 1. Simulado em desenvolvimento — nunca houve dinheiro atrás disto.
    if (payment.providerRef?.startsWith("dev-")) {
      await expirar("referência simulada (dev)");
      return "expirados";
    }

    // 2. A cobrança já foi resolvida por outro caminho: a tentativa ficou órfã.
    const cobranca = payment.charge?.status ?? payment.memberFee?.status;
    if (cobranca === ChargeStatus.SETTLED || cobranca === ChargeStatus.VOID) {
      await expirar(`substituída — a cobrança já está ${cobranca === ChargeStatus.SETTLED ? "liquidada" : "anulada"}`);
      return "substituidos";
    }

    const apiKey = await this.prisma.runAs(academyId, async (db) =>
      (await db.academy.findFirst({ where: { id: academyId }, select: { eupagoApiKey: true } }))?.eupagoApiKey ?? undefined,
    );

    // 3. Multibanco: a API antiga responde à pergunta com a chave do canal.
    if (payment.method === PaymentMethod.MULTIBANCO && payment.entity && payment.reference) {
      const info = await this.eupago.getMultibancoStatus(payment.entity, payment.reference, apiKey);
      if (info) {
        if (/pag/.test(info.estado)) {
          await this.confirmPayment([payment.id], new Date(), { reconciliacao: "multibanco/info", ...info.raw });
          return "liquidados";
        }
        if (/expir|cancel|anul|devolv/.test(info.estado)) {
          await this.failPayment([payment.id], "A referência expirou sem ser paga.", { reconciliacao: "multibanco/info", ...info.raw }, "EXPIRED");
          return "expirados";
        }
        if (!/pend/.test(info.estado)) {
          this.log.warn(`multibanco/info com estado desconhecido "${info.estado}" para ${payment.id} — fica em voo`);
        }
      }
    }

    // 4. A lista de pagos da API de gestão — a única resposta possível para MB Way.
    const pago = pagos?.get(payment.id);
    if (pago) {
      await this.confirmPayment(
        [payment.id],
        pago.paidAt,
        { reconciliacao: "management/transactions", trid: pago.trid },
        pago.amountCents || undefined,
      );
      return "liquidados";
    }

    // 5. Sem confirmação: o que já morreu pelo relógio expira. O resto fica.
    const agora = Date.now();
    const morto =
      (payment.expiresAt && payment.expiresAt.getTime() < agora) ||
      (payment.method === PaymentMethod.MBWAY && agora - payment.createdAt.getTime() > 10 * 60_000);
    if (morto) {
      await expirar(pagos === null ? "prazo passado; sem credenciais de gestão para confirmar" : "prazo passado; não consta dos pagos");
      return "expirados";
    }

    return "semResposta";
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

      /*
       * O mês do vencimento tem de ser um mês cobrado.
       *
       * Uma avulsa não é uma mensalidade, mas vive no mesmo mês e na mesma
       * lista. Aceitá-la num mês desligado punha dinheiro num mês que o clube
       * diz que não existe: ou o mês reaparecia nas Mensalidades por causa
       * dela, ou ficava escondido e ninguém o cobrava. O clube tem duas saídas,
       * e a mensagem di-las: datar para um mês cobrado, ou ligar o mês.
       */
      await assertMesesCobrados(db, ctx.academyId, [
        `${dueDate.getUTCFullYear()}-${String(dueDate.getUTCMonth() + 1).padStart(2, "0")}`,
      ]);

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
  /* Mensalidade lançada à mão                                                 */
  /* ------------------------------------------------------------------------ */

  /**
   * Lançar mensalidades a um atleta, mês a mês, com um valor escolhido.
   *
   * ## Porque é que isto existe ao lado da geração automática
   *
   * A geração (`gerarCobrancas`) responde a "emite o mês ao plantel todo" e
   * deriva o valor do plano — da equipa ou da inscrição individual. Cobre o dia
   * a dia de um clube, e não cobre o resto:
   *
   * - o atleta **sem preço configurado**, que a geração salta (`semPreco`) e
   *   que hoje só se resolvia indo criar um plano para uma pessoa só;
   * - o mês **fora do calendário de cobrança** do clube, que a geração ignora
   *   de propósito — e que às vezes se cobra a um atleta em concreto;
   * - o acerto de meses **em atraso** de quem entrou a meio da época, que
   *   obrigava a gerar mês a mês para a academia inteira para apanhar um.
   *
   * Em todos, o que faltava era o gesto directo: *este atleta, este valor,
   * estes meses*. É uma `Charge` igual às outras — aparece na mesma lista, na
   * app da família, e paga-se pelos mesmos meios.
   *
   * ## Porque é que é `FEE` e `slot` vazio
   *
   * Porque **é** uma mensalidade, e não um extra. O `slot` vazio põe-na debaixo
   * do mesmo `@@unique([athleteId, period, slot])` das geradas: um atleta não
   * tem duas mensalidades no mesmo mês, e a geração automática passa a
   * considerá-la existente em vez de criar uma segunda por cima. É essa a
   * diferença para a cobrança avulsa, que leva `slot` aleatório precisamente
   * para poder haver várias no mesmo mês.
   *
   * ## Os meses que já tinham mensalidade
   *
   * Saltam-se, e a resposta diz quais. Rebentar o pedido inteiro por causa de
   * um mês repetido obrigaria a adivinhar quais os que faltavam — e a intenção
   * de quem escolheu seis meses é ter os seis lançados, não perder os cinco que
   * ainda não existiam. Substituir por cima também não: reescrever uma
   * mensalidade que a família já pode ter pago não é o que "lançar" quer dizer.
   */
  async createManualFees(
    ctx: RequestContext,
    input: {
      /** Um atleta só. É a forma antiga, e continua a valer: equivale a `alvo: "atletas"` com um id. */
      athleteId?: string;
      /** A quem: atletas escolhidos, os atletas activos de equipas escolhidas, ou o clube todo. */
      alvo?: "atletas" | "equipas" | "todos";
      athleteIds?: string[];
      teamIds?: string[];
      /** Um valor para todos. Omitido, cada atleta paga o preço dele (individual ou da equipa). */
      amountCents?: number;
      /**
       * Em que estado nascem. `OPEN` (por omissão) é a cobrança normal, e a
       * família é avisada. `SETTLED` é para registar mensalidades que já foram
       * pagas por fora da plataforma: nascem pagas, com o mesmo registo de
       * pagamento manual de "Marcar como paga", e ninguém é avisado de nada.
       */
      estado?: "OPEN" | "SETTLED";
      /** Como foram pagas, quando nascem pagas. Omitido fica numerário. */
      metodo?: MetodoManual;
      periods: string[];
      notes?: string;
      /**
       * Por pagar, num mês em que alguém já pagou: `true` volta a pô-las por
       * pagar, `false` deixa-as pagas. Omitido, e havendo alguma, nada se grava
       * e a resposta traz `porConfirmar` para a consola perguntar.
       */
      sobrescreverPagas?: boolean;
    },
  ) {
    if (!can(ctx, "billing:write")) throw new ForbiddenException("Sem permissão para cobrar");
    if (input.amountCents !== undefined) assertValidAmount(input.amountCents, true);

    const periodos = [...new Set(input.periods)].sort();
    if (periodos.length === 0) throw new BadRequestException("Escolhe pelo menos um mês");
    if (periodos.length > 24) throw new BadRequestException("São demasiados meses de uma vez (máximo 24)");
    for (const p of periodos) {
      if (!/^\d{4}-\d{2}$/.test(p)) throw new BadRequestException(`Mês inválido: ${p}`);
      const mes = Number(p.slice(5, 7));
      if (mes < 1 || mes > 12) throw new BadRequestException(`Mês inválido: ${p}`);
    }

    const alvo = input.alvo ?? "atletas";
    const pagas = input.estado === "SETTLED";
    const agora = new Date();
    const idsDeAtletas = [...new Set(input.athleteIds ?? (input.athleteId ? [input.athleteId] : []))];
    const idsDeEquipas = [...new Set(input.teamIds ?? [])];
    if (alvo === "atletas" && idsDeAtletas.length === 0) throw new BadRequestException("Escolhe pelo menos um atleta");
    if (alvo === "equipas" && idsDeEquipas.length === 0) throw new BadRequestException("Escolhe pelo menos uma equipa");

    const resultado = await this.prisma.runAs(
      ctx.academyId,
      async (db) => {
        /*
         * Um mês desligado não se lança à mão.
         *
         * A emissão já o respeitava, e o ecrã das definições promete que um mês
         * desligado não existe. Faltava esta porta: lançar Agosto à mão num clube
         * que fechou Agosto punha de volta exactamente o que desligar o mês tira,
         * e o mês voltava a aparecer nas Mensalidades e na ficha do atleta.
         */
        await assertMesesCobrados(db, ctx.academyId, periodos);

        /*
         * Quem recebe.
         *
         * Atletas escolhidos um a um entram seja qual for o estado: se a
         * direcção o escolheu pelo nome, é a ele que quer cobrar. Por equipa e
         * "todos" só entram os activos, como na emissão do mês: um atleta em
         * pausa ou que saiu não é cobrado por arrasto.
         *
         * O âmbito junta-se com `AND`, e não por cima do `id`: espalhar o filtro
         * de âmbito no mesmo objecto substituía a condição do atleta escolhido.
         */
        const ambito = athleteScopeFilter(ctx);
        const onde: Prisma.AthleteWhereInput =
          alvo === "atletas"
            ? { id: { in: idsDeAtletas } }
            : alvo === "equipas"
              ? { status: "ACTIVE", teams: { some: { teamId: { in: idsDeEquipas } } } }
              : { status: "ACTIVE" };
        const atletas = await db.athlete.findMany({
          where: { AND: [onde, ...(ambito ? [{ id: ambito }] : [])] },
          orderBy: { name: "asc" },
          select: {
            id: true,
            name: true,
            teams: { select: { teamId: true }, take: 1 },
            guardians: { select: { membership: { select: { userId: true, isActive: true } } } },
          },
        });

        if (alvo === "atletas" && atletas.length < idsDeAtletas.length) {
          throw new NotFoundException(idsDeAtletas.length === 1 ? "Atleta não encontrado" : "Há atletas que não encontrei");
        }
        if (alvo === "equipas") {
          const equipas = await db.team.count({ where: { id: { in: idsDeEquipas } } });
          if (equipas < idsDeEquipas.length) throw new NotFoundException("Há equipas que não encontrei");
        }
        if (atletas.length * periodos.length > 5_000) {
          throw new BadRequestException("São demasiadas mensalidades de uma vez. Escolhe menos meses ou menos atletas.");
        }

        const ids = atletas.map((a) => a.id);
        const calendario = await lerCalendario(db, ctx.academyId);
        const precoDe = input.amountCents === undefined ? await lerPrecosDosAtletas(db, ids) : null;

        // Quem já tem mensalidade nestes meses. Uma leitura para todos.
        const existentes = new Map(
          (
            await db.charge.findMany({
              where: { athleteId: { in: ids }, period: { in: periodos }, slot: "" },
              select: {
                id: true,
                athleteId: true,
                period: true,
                status: true,
                amountCents: true,
                payments: { select: { status: true, provider: true } },
              },
            })
          ).map((c) => [`${c.athleteId}|${c.period}`, c]),
        );

        const aCriar: Prisma.ChargeCreateManyInput[] = [];
        const semPreco: { id: string; name: string }[] = [];
        const jaExistiam = new Set<string>();

        /*
         * Lançar como pagas um mês que já existe marca-o como pago.
         *
         * O caso que o pedia: a emissão automática já tinha lançado Setembro a
         * toda a gente, por pagar, e o clube quis registar que Setembro estava
         * pago. Saltar as existentes dava "Não foi lançada nenhuma mensalidade",
         * que é verdade e não serve a ninguém. Quem lança como pagas quer que o
         * mês fique pago, exista a linha ou não.
         *
         * Só as que estão por pagar e sem pagamento online a decorrer. Uma
         * referência Multibanco por pagar ou um MB WAY em curso ainda podem
         * trazer dinheiro: marcá-la paga à mão era arriscar cobrar duas vezes.
         * As que já estavam pagas ou anuladas ficam como estão. O valor é o da
         * mensalidade existente, e não o do lançamento: é o que a família deve.
         */
        const aMarcar: { id: string; athleteId: string; amountCents: number }[] = [];
        const jaPagas = new Set<string>();
        let emPagamento = 0;

        /*
         * Por pagar num mês em que alguém já pagou.
         *
         * Lançar Outubro por pagar ao clube todo, com três atletas que já
         * pagaram Outubro, saltava esses três em silêncio. O clube pode querer
         * isso (pagaram, está certo) ou não (o pagamento foi registado por
         * engano, ou o valor mudou). Não se decide por ele: a primeira ida
         * devolve a lista (`porConfirmar`) sem gravar nada, e a consola
         * pergunta. Pagas online (euPago) não entram na pergunta nem se
         * sobrescrevem: é dinheiro que entrou.
         */
        const porConfirmar: { athleteId: string; name: string; period: string; amountCents: number }[] = [];
        const aReabrir: { id: string; athleteId: string; period: string; amountCents: number }[] = [];
        const pagaOnline = (c: { payments: { status: PaymentStatus; provider: string }[] }) =>
          c.payments.some(
            (p) =>
              p.provider !== "manual" &&
              (p.status === PaymentStatus.PAID || p.status === PaymentStatus.PROCESSING || p.status === PaymentStatus.REFUNDED),
          );

        for (const a of atletas) {
          const valor = input.amountCents ?? precoDe?.(a)?.amountCents;
          let semPrecoContado = false;
          for (const period of periodos) {
            const existente = existentes.get(`${a.id}|${period}`);
            if (existente) {
              const emVoo = existente.payments.some(
                (p) => p.status === PaymentStatus.PENDING || p.status === PaymentStatus.PROCESSING,
              );
              if (!pagas) {
                if (existente.status !== ChargeStatus.SETTLED) jaExistiam.add(period);
                else if (pagaOnline(existente) || input.sobrescreverPagas === false) jaPagas.add(period);
                else if (input.sobrescreverPagas === true) {
                  aReabrir.push({ id: existente.id, athleteId: a.id, period, amountCents: valor ?? existente.amountCents });
                } else {
                  porConfirmar.push({ athleteId: a.id, name: a.name, period, amountCents: existente.amountCents });
                  jaPagas.add(period);
                }
              } else if (existente.status === ChargeStatus.SETTLED) jaPagas.add(period);
              else if (existente.status !== ChargeStatus.OPEN) jaExistiam.add(period);
              else if (emVoo) emPagamento++;
              else aMarcar.push({ id: existente.id, athleteId: a.id, amountCents: existente.amountCents });
              continue;
            }
            if (valor === undefined) {
              if (!semPrecoContado) semPreco.push({ id: a.id, name: a.name });
              semPrecoContado = true;
              continue;
            }
            aCriar.push({
              academyId: ctx.academyId,
              athleteId: a.id,
              kind: "FEE",
              period,
              slot: "",
              notes: input.notes?.trim() || null,
              amountCents: valor,
              ...(pagas || nasceIsenta(valor) ? { status: ChargeStatus.SETTLED, settledAt: agora } : {}),
              ...(input.amountCents === undefined && precoDe?.(a)?.enrollmentId
                ? { enrollmentId: precoDe(a)!.enrollmentId }
                : {}),
              /*
               * O dia de vencimento é o do clube, como nas geradas — a família
               * não tem de aprender um prazo diferente por a mensalidade ter
               * sido lançada à mão. Um mês em atraso nasce vencido, e é o que
               * se quer: é exactamente o que ele é.
               */
              dueDate: diaDeVencimento(period, calendario(period).dia),
            });
          }
        }

        /* Há pagas por decidir: não se grava nada, e a consola pergunta. */
        if (porConfirmar.length > 0) return { porConfirmar };

        /* Lançar à mão um mês que tinha sido apagado é voltar atrás: a marca sai. Ver `ChargeSkip`. */
        const quemRecebe = [...new Set(aCriar.map((c) => c.athleteId))];
        if (quemRecebe.length > 0) {
          await db.chargeSkip.deleteMany({ where: { athleteId: { in: quemRecebe }, period: { in: periodos } } });
        }

        const criadas = aCriar.length
          ? await db.charge.createManyAndReturn({
              data: aCriar,
              skipDuplicates: true,
              select: { id: true, athleteId: true, period: true, amountCents: true, dueDate: true },
            })
          : [];

        /*
         * Lançadas como pagas: o mesmo registo de "Marcar como paga".
         *
         * Um pagamento manual em dinheiro por mensalidade, para o histórico dizer
         * como se soube que foi paga, em vez de um estado sem rasto. É também o
         * que as Finanças e a app da família já sabem ler.
         */
        if (pagas && aMarcar.length > 0) {
          await db.charge.updateMany({
            where: { id: { in: aMarcar.map((c) => c.id) }, status: ChargeStatus.OPEN },
            data: { status: ChargeStatus.SETTLED, settledAt: agora },
          });
        }
        /*
         * Sobrescrever: voltam a estar por pagar, como "Marcar como por pagar".
         *
         * O pagamento manual fica `REFUNDED` (o histórico diz que houve um e
         * foi desfeito), e a mensalidade leva o valor e o prazo deste
         * lançamento. Agrupado por valor e mês, para não ser uma escrita por
         * linha num lançamento ao clube todo.
         */
        if (aReabrir.length > 0) {
          await db.payment.updateMany({
            where: { chargeId: { in: aReabrir.map((c) => c.id) }, provider: "manual", status: PaymentStatus.PAID },
            data: { status: PaymentStatus.REFUNDED },
          });
          const grupos = new Map<string, typeof aReabrir>();
          for (const c of aReabrir) {
            const chave = `${c.period}|${c.amountCents}`;
            grupos.set(chave, [...(grupos.get(chave) ?? []), c]);
          }
          for (const grupo of grupos.values()) {
            await db.charge.updateMany({
              where: { id: { in: grupo.map((c) => c.id) }, status: ChargeStatus.SETTLED },
              data: {
                status: ChargeStatus.OPEN,
                settledAt: null,
                amountCents: grupo[0].amountCents,
                dueDate: diaDeVencimento(grupo[0].period, calendario(grupo[0].period).dia),
                ...(input.notes?.trim() ? { notes: input.notes.trim() } : {}),
              },
            });
          }
        }

        /* O registo de pagamento é só do que tem valor: ver `nasceIsenta`. */
        const pagasAgora = (pagas ? [...criadas, ...aMarcar] : []).filter((c) => !nasceIsenta(c.amountCents));
        if (pagasAgora.length > 0) {
          await db.payment.createMany({
            data: pagasAgora.map((c) => ({
              chargeId: c.id,
              amountCents: c.amountCents,
              method: input.metodo ?? PaymentMethod.CASH,
              status: PaymentStatus.PAID,
              provider: "manual",
              paidAt: agora,
            })),
          });
        }

        /*
         * Os avisos preparam-se aqui e enviam-se fora da transacção.
         *
         * `enqueue` entrega o push na hora. Para um atleta eram meia dúzia de
         * chamadas, mas para o clube inteiro são centenas, e cada uma a segurar
         * a ligação à base enquanto espera pela rede. Com o `connection_limit`
         * a 5, isso parava o servidor para toda a gente.
         */
        const porAtleta = new Map(atletas.map((a) => [a.id, a]));
        // Uma mensalidade que nasce paga não pede nada a ninguém: não há aviso.
        const reabertas = aReabrir.map((c) => ({
          id: c.id,
          athleteId: c.athleteId,
          period: c.period,
          amountCents: c.amountCents,
          dueDate: diaDeVencimento(c.period, calendario(c.period).dia),
        }));
        const avisos = (pagas ? [] : [...criadas, ...reabertas]).filter((c) => !nasceIsenta(c.amountCents)).flatMap((c) => {
          const a = porAtleta.get(c.athleteId)!;
          return a.guardians
            .filter((g) => g.membership.isActive)
            .map((g) => ({
              academyId: ctx.academyId,
              userId: g.membership.userId,
              type: NotificationType.PAYMENT_PENDING,
              title: "Nova mensalidade",
              body: `A mensalidade de ${periodLabelPt(c.period)} de ${a.name} já está disponível — ${(c.amountCents / 100).toFixed(2)} €, até ${dateLabelPt(c.dueDate)}.`,
              payload: { route: "/pagamentos", chargeId: c.id },
            }));
        });

        return {
          criadas,
          reabertas: aReabrir.length,
          marcadas: aMarcar.length,
          jaExistiam: [...jaExistiam].sort(),
          jaPagas: [...jaPagas].sort(),
          emPagamento,
          semPreco,
          atletasComNovas: new Set([...criadas, ...aMarcar, ...aReabrir].map((c) => c.athleteId)).size,
          avisos,
        };
      },
      { timeoutMs: 60_000 },
    );

    if ("porConfirmar" in resultado) return { porConfirmar: resultado.porConfirmar };
    const { criadas, reabertas, marcadas, jaExistiam, jaPagas, emPagamento, semPreco, atletasComNovas, avisos } = resultado;

    /*
     * O aviso à família, uma vez por mensalidade nova.
     *
     * A mesma mensagem da emissão automática (ver `ensureCharges`): dizer o
     * mês, o valor e o prazo no corpo, para se ler no ecrã bloqueado sem
     * abrir a app. Só as **novas** — os meses que já existiam não voltam a
     * incomodar ninguém. Um aviso que falhe não desfaz as mensalidades.
     */
    for (const aviso of avisos) {
      await this.notifications.enqueue(aviso).catch((e) => {
        this.log.warn(`Aviso de mensalidade por enviar a ${aviso.userId}: ${e instanceof Error ? e.message : e}`);
      });
    }

    return {
      criadas: criadas.length,
      /** Estavam pagas e voltaram a estar por pagar, porque se escolheu sobrescrever. */
      reabertas,
      /** Já existiam por pagar e passaram a pagas. Só ao lançar como pagas. */
      marcadas,
      atletas: atletasComNovas,
      jaExistiam,
      /** Meses em que alguém já tinha a mensalidade paga: ficou como estava. */
      jaPagas,
      /** Por pagar com um pagamento online a decorrer: não se mexeu. */
      emPagamento,
      semPreco,
      avisados: new Set(avisos.map((a) => a.userId)).size,
    };
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
  async setChargeStatus(
    ctx: RequestContext,
    chargeId: string,
    status: ChargeStatus,
    /**
     * Como foi paga, quando se marca como paga: MB WAY, numerário ou cartão.
     * Omitido fica numerário, que era o que se gravava sempre antes de a
     * consola perguntar.
     */
    metodo: MetodoManual = PaymentMethod.CASH,
  ) {
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
        /* Uma isenta não recebe registo de pagamento — ver `nasceIsenta`. */
        if (charge.status !== ChargeStatus.SETTLED && !nasceIsenta(charge.amountCents)) {
          await db.payment.create({
            data: {
              chargeId: charge.id,
              amountCents: charge.amountCents,
              method: metodo,
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

  /**
   * Apagar uma mensalidade ou uma cobrança avulsa.
   *
   * Mudar o estado não chegava: uma anulada continua na lista e na app da
   * família, e às vezes foi lançada por engano. Travam as mesmas duas coisas
   * das quotas (ver `razaoParaNaoApagar`): paga online, ou com uma tentativa
   * online ainda viva.
   *
   * Numa mensalidade fica a marca `ChargeSkip`, para a emissão de hora a hora
   * (e o botão "Gerar mensalidades") não a recriar — o mês de um atleta activo
   * com preço é exactamente o que ela cria. Uma avulsa não se emite, e não
   * precisa de marca. Lançar a mensalidade à mão apaga a marca.
   */
  async deleteCharge(ctx: RequestContext, chargeId: string) {
    if (!can(ctx, "billing:write")) throw new ForbiddenException("Sem permissão para apagar mensalidades");

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const charge = await db.charge.findFirst({
        where: { id: chargeId, athleteId: athleteScopeFilter(ctx) },
        select: {
          id: true, athleteId: true, period: true, kind: true, slot: true,
          payments: { select: { status: true, provider: true, method: true, expiresAt: true, createdAt: true } },
        },
      });
      if (!charge) throw new NotFoundException("Mensalidade não encontrada");

      const razao = razaoParaNaoApagar(charge.payments);
      if (razao) throw new BadRequestException(razao);

      if (charge.kind === "FEE" && charge.slot === "") {
        await db.chargeSkip.upsert({
          where: { athleteId_period: { athleteId: charge.athleteId, period: charge.period } },
          create: { academyId: ctx.academyId, athleteId: charge.athleteId, period: charge.period },
          update: {},
        });
      }
      await db.charge.delete({ where: { id: charge.id } });

      return { ok: true as const, period: charge.period };
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
       * O envio da mensalidade — o mesmo que a emissão automática manda.
       *
       * Emitir o mês avisa a família, seja quem for a emitir: sem aviso, a
       * mensalidade fica à espera de que alguém se lembre de abrir a app. A
       * mensagem vive em `avisarMensalidadesNovas` para os dois caminhos não
       * poderem divergir.
       */
      await this.avisarMensalidadesNovas(db, period, resultado.atletasNovos);

      /*
       * O mês corrente fica marcado como garantido.
       *
       * Quem carregou no botão fez o trabalho da varredura — e sem esta linha
       * ela voltava a percorrer este clube na hora seguinte para não criar
       * nada. Ver `emitido`.
       */
      if (period === periodoActual()) this.emitido.set(ctx.academyId, period);

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

      const cobraEsteMes = (await lerCalendario(db, ctx.academyId))(period).meses.includes(mes);

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
          const cobra = cobraEsteMes;
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
    assertValidAmount(amountCents, true);

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
    assertValidAmount(amountCents, true);

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
    assertValidAmount(amountCents, true);
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

    if (!METODOS_ATIVOS.has(method)) {
      throw new BadRequestException("Esse método de pagamento não está disponível de momento");
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
    feeIds: string | string[],
    method: PaymentMethod,
    payerPhone?: string,
  ) {
    if (method !== PaymentMethod.MBWAY && method !== PaymentMethod.MULTIBANCO) {
      throw new BadRequestException("Método de pagamento desconhecido");
    }
    const pedidas = Array.isArray(feeIds) ? [...new Set(feeIds)] : [feeIds];
    if (pedidas.length === 0) throw new BadRequestException("Não há nada a pagar");

    return this.prisma.runAs(academyId, async (db) => {
      /*
       * Da mais antiga para a mais recente — e é essa ordem que vale para tudo
       * o que se segue: a âncora é a primeira, a descrição começa nela, e o
       * histórico fica a ler-se de cima para baixo.
       */
      const fees = await db.memberFee.findMany({
        where: { id: { in: pedidas }, memberId },
        orderBy: { period: "asc" },
        include: { member: { select: { name: true, email: true } }, payments: true },
      });

      if (fees.length !== pedidas.length) throw new NotFoundException("Quota não encontrada");
      for (const f of fees) {
        if (f.status === ChargeStatus.SETTLED) throw new BadRequestException(`A quota de ${f.period} já está paga`);
        if (f.status === ChargeStatus.VOID) throw new BadRequestException(`A quota de ${f.period} foi anulada`);
      }

      const fee = fees[0];
      const total = fees.reduce((n, f) => n + f.amountCents, 0);

      /*
       * Uma tentativa viva de cada vez — agora contada sobre o **grupo**.
       *
       * Reaproveitar a referência anterior só é seguro se ela cobrir exactamente
       * as mesmas quotas: quem pediu Janeiro e agora pede Janeiro+Fevereiro tem
       * de receber uma referência nova, com o valor novo. Pagar a velha deixaria
       * Fevereiro por liquidar e o sócio convencido de que estava em dia.
       */
      const agora = Date.now();
      const alvo = [...pedidas].sort().join("|");
      const vivos = await db.payment.findMany({
        where: {
          status: { in: [PaymentStatus.PENDING, PaymentStatus.PROCESSING] },
          memberFees: { some: { memberFeeId: { in: pedidas } } },
        },
        include: { memberFees: { select: { memberFeeId: true } } },
      });

      for (const p of vivos) {
        const cobre = p.memberFees.map((x) => x.memberFeeId).sort().join("|");
        const morto =
          (p.expiresAt && p.expiresAt.getTime() < agora) ||
          (p.method === PaymentMethod.MBWAY && agora - p.createdAt.getTime() > 10 * 60_000);
        if (!morto && p.method === method && cobre === alvo) return p;
        await db.payment.update({ where: { id: p.id }, data: { status: PaymentStatus.EXPIRED } });
      }

      const academia = await db.academy.findFirst({
        where: { id: academyId },
        select: { eupagoApiKey: true },
      });
      const apiKey = academia?.eupagoApiKey ?? undefined;

      const payment = await db.payment.create({
        data: {
          // A âncora é a mais antiga; o que se liquida está em `memberFees`.
          memberFeeId: fee.id,
          amountCents: total,
          method,
          status: PaymentStatus.PENDING,
          memberFees: { create: fees.map((f) => ({ memberFeeId: f.id })) },
        },
      });

      const descricao =
        fees.length === 1
          ? `${fee.label ?? `Quota ${fee.period}`} — ${fee.member.name}`
          : `Quotas ${fee.period} a ${fees[fees.length - 1].period} (${fees.length} meses) — ${fee.member.name}`;

      const request = {
        reference: payment.id,
        amountCents: total,
        description: descricao,
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
          // Tudo o que este pagamento liquida — ver `MemberFeePayment`. Vazio
          // nos pagamentos anteriores a ela; nesse caso vale a âncora.
          memberFees: { include: { memberFee: true }, orderBy: { memberFee: { period: "asc" } } },
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

        /*
         * Um pagamento pode cobrir vários meses — liquidam-se todos, ou o sócio
         * pagava três e ficava com dois em dívida. A âncora entra na conta
         * mesmo que a tabela de junção esteja vazia: os pagamentos criados
         * antes de ela existir só têm a âncora.
         */
        const cobertas = payment.memberFees.length
          ? payment.memberFees.map((x) => x.memberFee)
          : [fee];

        const jaLiquidadas = cobertas.filter((f) => f.status === ChargeStatus.SETTLED);
        if (jaLiquidadas.length) {
          this.log.error(
            `PAGAMENTO DUPLICADO: ${jaLiquidadas.length} quota(s) de ${fee.member.name ?? fee.memberId} ` +
              `(${jaLiquidadas.map((f) => f.period).join(", ")}) já estavam liquidadas e chegou outro pagamento de ` +
              `${(payment.amountCents / 100).toFixed(2)} € (payment ${payment.id}). Reembolsar na euPago.`,
          );
        }

        await db.payment.update({
          where: { id: payment.id },
          data: { status: PaymentStatus.PAID, paidAt, rawPayload: rawPayload as object },
        });

        const porLiquidar = cobertas.filter((f) => f.status !== ChargeStatus.SETTLED);
        if (porLiquidar.length) {
          await db.memberFee.updateMany({
            where: { id: { in: porLiquidar.map((f) => f.id) } },
            data: { status: ChargeStatus.SETTLED, settledAt: paidAt, method: payment.method },
          });
        }

        if (fee.member.userId) {
          const periodos = cobertas.map((f) => f.period).sort();
          await this.notifications.enqueue(
            {
              academyId: fee.academyId,
              userId: fee.member.userId,
              type: NotificationType.PAYMENT_RECEIVED,
              title: cobertas.length === 1 ? "Quota paga" : "Quotas pagas",
              body:
                cobertas.length === 1
                  ? `Recebemos ${(payment.amountCents / 100).toFixed(2)} € da quota ${fee.label ?? fee.period}.`
                  : `Recebemos ${(payment.amountCents / 100).toFixed(2)} € de ${cobertas.length} quotas, ` +
                    `de ${periodos[0]} a ${periodos[periodos.length - 1]}.`,
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

/**
 * Os métodos que se escolhem ao marcar uma mensalidade como paga à mão.
 *
 * Só os que acontecem fora da plataforma e que um clube recebe em mão ou ao
 * balcão. Multibanco, Google Pay e os outros chegam pela euPago, com o método
 * que ela confirma: escolhê-los à mão era registar um pagamento online que
 * nunca passou por lá.
 */
export const METODOS_MANUAIS = [PaymentMethod.MBWAY, PaymentMethod.CASH, PaymentMethod.CARD] as const;
export type MetodoManual = (typeof METODOS_MANUAIS)[number];

/** O calendário de cobrança que vale num período: os meses cobrados e o dia de vencimento. */
export type Calendario = { meses: number[]; dia: number };

/** As colunas da academia de que o calendário precisa. */
export const SELECT_CALENDARIO = {
  billingMonths: true,
  billingDueDay: true,
  billingNextFrom: true,
  billingNextMonths: true,
  billingNextDueDay: true,
} as const;

type AcademiaComCalendario = {
  billingMonths: number[];
  billingDueDay: number;
  billingNextFrom: string | null;
  billingNextMonths: number[];
  billingNextDueDay: number | null;
};

/**
 * O calendário que vale para `period`.
 *
 * O clube pode mudar o período de cobrança só a partir da próxima época: fica
 * agendado em `billingNext*`, e a partir de `billingNextFrom` é esse que manda.
 * Toda a gente que pergunta "o clube cobra neste mês?" ou "quando vence?"
 * pergunta aqui, com o período em causa, para uma mensalidade de Agosto de 2027
 * seguir o calendário da época 2027/28 mesmo antes de a época virar.
 */
export function calendarioPara(academia: AcademiaComCalendario | null, period: string): Calendario {
  if (!academia) return { meses: MESES_POR_OMISSAO, dia: 8 };
  const atual = { meses: academia.billingMonths, dia: academia.billingDueDay };
  if (!academia.billingNextFrom || period < academia.billingNextFrom) return atual;
  return {
    meses: academia.billingNextMonths.length ? academia.billingNextMonths : atual.meses,
    dia: academia.billingNextDueDay ?? atual.dia,
  };
}

/** Lê a academia uma vez e devolve o calendário de qualquer período. */
export async function lerCalendario(db: ScopedClient, academyId: string): Promise<(period: string) => Calendario> {
  const academia = await db.academy.findFirst({ where: { id: academyId }, select: SELECT_CALENDARIO });
  return (period) => calendarioPara(academia, period);
}

/** O primeiro período da próxima época: com a época a abrir em Agosto, `2027-08` durante 2026/27. */
export function inicioDaProximaEpoca(agora = new Date()): string {
  const inicio = inicioDaEpoca(agora);
  return `${Number(inicio.slice(0, 4)) + 1}${inicio.slice(4)}`;
}

/**
 * Quando a época vira, o calendário agendado passa a ser o calendário.
 *
 * `calendarioPara` já o aplica sem isto; isto arruma: copia o agendado para
 * `billingMonths`/`billingDueDay` e limpa o agendamento, para as Definições e
 * o diálogo mostrarem o que vale hoje. Corre no início de cada emissão.
 */
export async function promoverCalendario(db: ScopedClient, academyId: string, agora = new Date()): Promise<boolean> {
  const academia = await db.academy.findFirst({ where: { id: academyId }, select: SELECT_CALENDARIO });
  if (!academia?.billingNextFrom || periodoActual(agora) < academia.billingNextFrom) return false;
  await db.academy.update({
    where: { id: academyId },
    data: {
      ...(academia.billingNextMonths.length ? { billingMonths: academia.billingNextMonths } : {}),
      ...(academia.billingNextDueDay !== null ? { billingDueDay: academia.billingNextDueDay } : {}),
      billingNextFrom: null,
      billingNextMonths: [],
      billingNextDueDay: null,
    },
  });
  return true;
}

/**
 * Retira as mensalidades por pagar de meses que o clube acabou de desligar.
 *
 * ## Porque é que isto existe
 *
 * Um mês desligado deixa de ser pedido às famílias, e deixa de aparecer, na app
 * dos pais e na aba das mensalidades. Mas `gerarCobrancas` só cria, nunca
 * retira: desligar agosto com agosto já emitido deixava as mensalidades lá. Por
 * isso as linhas são **apagadas**, e não anuladas: uma anulada continua a
 * aparecer como "anulada", e o pedido foi que não apareça nada.
 *
 * Apagar sem `ChargeSkip`, de propósito: se o clube voltar a ligar o mês, a
 * emissão volta a criá-las, que é o que "ligar um mês emite as que faltam"
 * promete. Um `ChargeSkip` é para uma mensalidade que a direcção apagou a
 * olhar para o atleta; isto é o calendário, e o calendário pode mudar outra vez.
 *
 * ## Só os meses que se desligaram agora
 *
 * Recebe os meses, em vez de os deduzir do calendário. A direcção pode lançar à
 * mão uma mensalidade num mês fora do calendário (`createManualFees`), e isso
 * é uma decisão tomada a olhar para uma pessoa. Deduzir "todos os meses
 * fechados" apagava esses lançamentos da próxima vez que alguém mexesse em
 * qualquer mês. Quem desliga setembro retira setembro, e só setembro.
 *
 * ## O que fica de fora, e porquê
 *
 * - **As pagas, e as que estão a ser pagas.** Um pagamento `PAID` ou
 *   `PROCESSING` é dinheiro que existe ou está a caminho.
 * - **As que têm uma tentativa a meio.** Uma referência Multibanco `PENDING`
 *   ainda se pode pagar na caixa amanhã; se a mensalidade desaparecer, o
 *   webhook não tem onde pousar esse dinheiro. Essas ficam anuladas em vez de
 *   apagadas, e o pagamento, se vier, bate numa cobrança que existe. São raras.
 * - **As avulsas (`EXTRA`).** Não são mensalidades.
 * - **Épocas passadas.** Uma mensalidade de há dois anos num mês que o clube
 *   fechou este ano é história.
 *
 * Um mês que ainda está no calendário é ignorado mesmo que venha na lista: esta
 * função nunca apaga uma mensalidade de um mês em que o clube cobra.
 */
export async function retirarForaDoCalendario(
  db: ScopedClient,
  academyId: string,
  agora = new Date(),
): Promise<{ apagadas: number; anuladas: number; comDinheiro: number }> {
  /*
   * Cada linha pelo calendário do seu período: uma de Agosto de 2027 segue o
   * calendário agendado para 2027/28, se houver um.
   */
  const calendario = await lerCalendario(db, academyId);
  const fechado = (period: string) => !calendario(period).meses.includes(Number(period.slice(5, 7)));

  /*
   * Todos os estados, incluindo as pagas.
   *
   * Poupava as `SETTLED`, e era a razão de o mês continuar à vista depois de
   * desligado: seis mensalidades de Agosto marcadas como pagas ficavam na
   * ficha dos atletas e punham Agosto de volta no selector das Mensalidades.
   * Uma marcada como paga à mão é uma nota que o clube escreveu; se ele agora
   * diz que o mês não existe, a nota vai com o mês. O que não vai é dinheiro
   * que passou pela euPago — ver `comDinheiro` abaixo.
   */
  const candidatas = await db.charge.findMany({
    where: {
      kind: "FEE",
      period: { gte: inicioDaEpoca(agora) },
    },
    select: {
      id: true,
      period: true,
      status: true,
      /*
       * `PENDING` é uma tentativa que ainda se pode pagar na caixa amanhã: a
       * mensalidade fica anulada em vez de apagada, para o webhook ter onde
       * pousar o dinheiro. Os outros três estados são dinheiro que passou pelo
       * provedor, e aí a linha fica como está.
       */
      payments: { select: { status: true, provider: true } },
    },
  });
  const alvo = candidatas.filter((c) => fechado(c.period));

  /* Dinheiro que passou pela euPago: a linha fica, e diz-se quantas são. */
  const dinheiroReal = (c: (typeof alvo)[number]) =>
    c.payments.some(
      (p) =>
        p.provider !== "manual" &&
        (p.status === PaymentStatus.PAID || p.status === PaymentStatus.PROCESSING || p.status === PaymentStatus.REFUNDED),
    );
  const emVoo = (c: (typeof alvo)[number]) => c.payments.some((p) => p.status === PaymentStatus.PENDING);

  const comDinheiro = alvo.filter(dinheiroReal);
  const restantes = alvo.filter((c) => !dinheiroReal(c));
  const comTentativas = restantes.filter((c) => emVoo(c) && c.status === ChargeStatus.OPEN).map((c) => c.id);
  // Uma já anulada com tentativa viva fica como está: é ela que o webhook procura.
  const aApagar = restantes.filter((c) => !emVoo(c)).map((c) => c.id);

  const apagadas = aApagar.length ? (await db.charge.deleteMany({ where: { id: { in: aApagar } } })).count : 0;
  const anuladas = comTentativas.length
    ? (await db.charge.updateMany({ where: { id: { in: comTentativas } }, data: { status: ChargeStatus.VOID } })).count
    : 0;
  return { apagadas, anuladas, comDinheiro: comDinheiro.length };
}

/**
 * Os meses em que o clube cobra, e a recusa quando um período cai fora.
 *
 * Um só sítio a dizer a frase: ela aparece quando se lança uma mensalidade à
 * mão e quando se cria uma avulsa, e as duas têm de dizer o mesmo. O nome do
 * mês vai na mensagem — "Agosto está desligado" diz-se de uma vez, "período
 * fora do calendário" obriga a ir ver qual.
 */
export async function assertMesesCobrados(db: ScopedClient, academyId: string, periodos: string[]): Promise<void> {
  const calendario = await lerCalendario(db, academyId);
  const fora = [
    ...new Set(
      periodos.filter((p) => !calendario(p).meses.includes(Number(p.slice(5, 7)))).map((p) => Number(p.slice(5, 7))),
    ),
  ].sort((a, b) => a - b);
  if (fora.length === 0) return;

  const nomes = fora.map((m) => MONTHS_PT[m - 1]).map((n) => n[0].toUpperCase() + n.slice(1));
  throw new BadRequestException(
    fora.length === 1
      ? `${nomes[0]} está desligado nos meses cobrados: o clube não cobra nesse mês. Escolhe outro mês, ou liga-o no Período de cobrança.`
      : `${nomes.join(", ")} estão desligados nos meses cobrados. Escolhe outros meses, ou liga-os no Período de cobrança.`,
  );
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

/**
 * Um euro no mínimo, mil no máximo — trava um "0" ou um zero a mais por engano.
 *
 * Com `permitirZero`, o zero passa. É para os **preços** de mensalidade: um
 * atleta com bolsa, o filho de um treinador, um acordo com a escola. Não é para
 * uma cobrança avulsa, onde 0 € seria pedir dinheiro nenhum a uma família e a
 * linha não teria razão de existir. Ver `nasceIsenta`.
 */
function assertValidAmount(amountCents: number, permitirZero = false): void {
  if (permitirZero && amountCents === 0) return;
  if (!Number.isInteger(amountCents) || amountCents < 100 || amountCents > 100_000) {
    throw new BadRequestException(permitirZero ? "Valor 0 €, ou entre 1 € e 1000 €" : "Valor entre 1 € e 1000 €");
  }
}

/**
 * Uma mensalidade de 0 € nasce paga.
 *
 * Não há nada a pedir à família, e deixá-la "por pagar" punha um atleta isento
 * na lista das dívidas, num lembrete automático e num ecrã de pagamento que
 * não tem o que pagar. Fica `SETTLED`, sem registo de pagamento: não entrou
 * dinheiro, e inventar um pagamento de zero euros era escrever no livro uma
 * coisa que não aconteceu.
 */
export const nasceIsenta = (amountCents: number): boolean => amountCents === 0;

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
      /* Baixar o preço a 0 € liquida a mensalidade: já não há nada a pedir. */
      data: { amountCents, ...(nasceIsenta(amountCents) ? { status: ChargeStatus.SETTLED, settledAt: new Date() } : {}) },
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
  await promoverCalendario(db, academyId);

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
   * E quem a teve e a direcção apagou. Para a emissão, uma apagada é uma que
   * falta — e recriá-la na passagem seguinte era desfazer o que alguém acabou
   * de fazer. Ver `ChargeSkip`.
   */
  const dispensados = new Set(
    (await db.chargeSkip.findMany({ where: { period, athleteId: { in: ids } }, select: { athleteId: true } })).map(
      (d) => d.athleteId,
    ),
  );

  const precoDe = await lerPrecosDosAtletas(db, ids);

  const calendario = await lerCalendario(db, academyId);
  const diaDoClube = calendario(period).dia;
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
  const cobraEsteMes = calendario(period).meses.includes(mes);

  /*
   * O calendário manda para toda a gente, incluindo quem acabou de entrar.
   *
   * Havia aqui uma excepção: quem se inscrevia num mês fechado era cobrado
   * nesse mês, "calendário ou não". A intenção era o miúdo que entra a 27 de
   * agosto e treina em agosto. Na prática apanhou clubes inteiros: `joinedAt`
   * nasce como a data em que o atleta é criado na plataforma, e um clube que
   * carrega o plantel em agosto entra todo em agosto. Três clubes ficaram com
   * 62 mensalidades de um mês que não cobram, e o ecrã das definições a
   * prometer o contrário ("um mês desligado não gera mensalidades"). O ecrã
   * tinha razão; a excepção não.
   *
   * Um clube que queira cobrar a um recém-chegado um mês que fechou ao resto
   * do plantel tem a cobrança avulsa (`EXTRA`) para isso, e essa é uma decisão
   * que se toma a olhar para a pessoa, não uma regra escondida na emissão.
   */
  const novas: {
    academyId: string;
    athleteId: string;
    enrollmentId?: string;
    period: string;
    amountCents: number;
    dueDate: Date;
    status?: ChargeStatus;
    settledAt?: Date;
  }[] = [];
  let jaExistiam = 0;
  let semPreco = 0;
  let foraDoMes = 0;

  for (const a of atletas) {
    if (existentes.has(a.id)) {
      jaExistiam++;
      continue;
    }
    if (dispensados.has(a.id)) continue;

    const preco = precoDe(a);

    if (!preco) {
      semPreco++;
      continue;
    }
    if (!cobraEsteMes) {
      foraDoMes++;
      continue;
    }

    novas.push({
      academyId,
      athleteId: a.id,
      // Liga a cobrança à inscrição que a originou, quando houve uma — é o que
      // deixa perceber, meses depois, de que preço é que aquele valor veio.
      ...(preco.enrollmentId ? { enrollmentId: preco.enrollmentId } : {}),
      period,
      amountCents: preco.amountCents,
      // Um preço de 0 € nasce pago — ver `nasceIsenta`.
      ...(nasceIsenta(preco.amountCents) ? { status: ChargeStatus.SETTLED, settledAt: new Date() } : {}),
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

/**
 * O preço de cada atleta, lido em bloco.
 *
 * A inscrição individual activa mais recente manda, com o desconto dela; sem
 * inscrição, vale o plano da primeira equipa. Sem nenhum dos dois, o atleta não
 * tem preço e a função devolve `null`.
 *
 * Saiu de dentro de `gerarCobrancas` quando o lançamento à mão passou a poder
 * cobrar equipas inteiras "ao preço de cada um". A regra de quanto um atleta
 * paga não pode viver em dois sítios: no dia em que uma mudar, a emissão do mês
 * e o lançamento à mão passavam a cobrar valores diferentes ao mesmo atleta.
 */
export async function lerPrecosDosAtletas(
  db: ScopedClient,
  ids: string[],
): Promise<(a: { id: string; teams: { teamId: string }[] }) => { amountCents: number; enrollmentId?: string } | null> {
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
  const planosPorEquipa = new Map<string, number>();
  for (const plan of await db.subscriptionPlan.findMany({
    where: { teamId: { not: null }, isActive: true },
    select: { teamId: true, amountCents: true },
    orderBy: { id: "desc" },
  })) {
    if (plan.teamId && !planosPorEquipa.has(plan.teamId)) planosPorEquipa.set(plan.teamId, plan.amountCents);
  }

  return (a) => {
    const individual = individuais.get(a.id);
    // O desconto só existe na inscrição individual; o preço da equipa não o tem.
    if (individual) {
      return {
        amountCents: Math.max(0, individual.amountCents - individual.discountCents),
        enrollmentId: individual.enrollmentId,
      };
    }
    const daEquipa = a.teams[0] ? planosPorEquipa.get(a.teams[0].teamId) : undefined;
    return daEquipa === undefined ? null : { amountCents: daEquipa };
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
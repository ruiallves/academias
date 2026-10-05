import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { AcademyStatus, SubscriptionBillingPeriod } from "@prisma/client";
import { PrismaService, type ScopedClient } from "../prisma/prisma.service";
import { MailClient } from "../mail/mail.client";
import { subscriptionPaymentEmail, type MailBrand } from "../mail/mail.templates";
import { NotificationsService } from "../notifications/notifications.service";
import { SuspensaoService } from "../auth/suspensao.service";
import { responsavelDoClube, type ResponsavelDoClube } from "./responsavel";
import { avisosDevidos, chaveDoDia, diaDoClube, soODia, somaMeses, type AvisoDevido } from "./ciclo";
import { deveSuspender, lembreteDevido, lembretesJaPassados, periodoPorExtenso } from "./cobranca";

/**
 * A cobrança da mensalidade da plataforma, todos os meses, sozinha.
 *
 * ## O ciclo
 *
 * No dia em que o período começa (o aniversário do dia em que o clube aderiu,
 * ver `ciclo.ts`) nasce o aviso, e o responsável do clube recebe um email a
 * dizer que a mensalidade de X a Y está disponível para pagar na consola, por
 * MB WAY ou Multibanco. Uma semana sem pagamento, um lembrete; duas, outro;
 * três, o último. No dia a seguir ao fim do período sem pagamento, o clube
 * fica **suspenso**: a consola e a app fecham, com um email a dizê-lo, até o
 * pagamento chegar. Quando chega (`SubscriptionPaymentsService`), reabre
 * sozinho.
 *
 * As regras das datas são puras e estão em `cobranca.ts`, com teste.
 *
 * ## Quem entra
 *
 * Todos os clubes com a subscrição `ACTIVE`, isto é, que pagam. Quem está em
 * avaliação não entra, e quem está cancelado também não. A lista vem de
 * `app.subscription_billing()`: a `Subscription` é da plataforma e o papel da
 * aplicação não a lê.
 *
 * O dia de cobrança é o das condições (assinadas ou por assinar) quando as há,
 * senão `Subscription.billingAnchorOn`, o dia em que o plano ficou activo.
 *
 * ## Porquê uma varredura, e não um relógio ao minuto certo
 *
 * Porque um relógio que dispara uma vez por mês falha uma vez por mês: basta o
 * processo estar a reiniciar naquele minuto. A varredura corre de hora a hora
 * sobre operações idempotentes: a primeira passagem depois da meia-noite emite,
 * as outras não fazem nada, e um servidor que esteve em baixo apanha o atraso
 * quando voltar. Quem garante que não sai o segundo email do mesmo período é o
 * índice único `(academyId, periodStart)`, e não a memória do processo.
 *
 * Um aviso que nasce atrasado começa com os lembretes já passados contados
 * (`lembretesJaPassados`), para o email do aviso e o primeiro lembrete não
 * saírem na mesma hora; e ninguém é suspenso com menos de uma semana desde o
 * email (`deveSuspender`).
 *
 * ## O passado
 *
 * `janelaDias` limita o atraso que se recupera. Ligar isto num clube que paga
 * há um ano não lhe manda doze avisos de uma vez.
 */
@Injectable()
export class SubscriptionNoticesService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(SubscriptionNoticesService.name);
  private varredura: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailClient,
    private readonly config: ConfigService,
    private readonly notificacoes: NotificationsService,
    private readonly suspensao: SuspensaoService,
  ) {}

  onModuleInit() {
    this.arrancar();
  }

  onModuleDestroy() {
    if (this.varredura) clearInterval(this.varredura);
  }

  /** Até quantos dias para trás se recupera um aviso que não chegou a sair. */
  private get janelaDias(): number {
    const n = Number(this.config.get<string>("SUBSCRIPTION_NOTICE_CATCHUP_DAYS") ?? "35");
    return Number.isFinite(n) && n >= 0 ? n : 35;
  }

  private arrancar() {
    const minutos = Number(this.config.get<string>("AUTO_SUBSCRIPTION_NOTICES_INTERVAL_MIN") ?? "60");
    if (!Number.isFinite(minutos) || minutos <= 0) {
      this.log.warn("Cobrança da plataforma desligada (AUTO_SUBSCRIPTION_NOTICES_INTERVAL_MIN=0)");
      return;
    }
    const passe = () =>
      this.emitirAvisos().catch((e) =>
        this.log.error(`Cobrança da plataforma falhou: ${e instanceof Error ? e.message : e}`),
      );

    /*
     * Dois minutos depois de arrancar: as outras varreduras entram aos 60 e
     * aos 90 segundos, e arrancar com elas era disputar as cinco ligações do
     * pgbouncer no primeiro minuto de cada deploy.
     */
    setTimeout(passe, 120_000).unref();
    this.varredura = setInterval(passe, minutos * 60_000);
    this.varredura.unref();
  }

  /**
   * A passagem: avisos novos, lembretes e suspensões, em todos os clubes.
   *
   * `apenasAcademia` estreita a um clube: serve o apoio, e é o que torna isto
   * exercitável num teste sem escrever na plataforma inteira. Um clube que
   * falha não trava os outros.
   */
  async emitirAvisos(apenasAcademia?: string) {
    const hoje = diaDoClube(new Date());
    const linhas = await this.prisma.$queryRaw<LinhaDeCobranca[]>`SELECT * FROM app.subscription_billing()`;
    const alvo = apenasAcademia ? linhas.filter((l) => l.academy_id === apenasAcademia) : linhas;

    const totais = { academias: alvo.length, visitadas: 0, criados: 0, enviados: 0, lembretes: 0, suspensos: 0, semDestinatario: 0, comErro: 0 };

    for (const linha of alvo) {
      try {
        const feitos = await this.tratarClube(linha, hoje);
        totais.visitadas++;
        totais.criados += feitos.criados;
        totais.enviados += feitos.enviados;
        totais.lembretes += feitos.lembretes;
        totais.suspensos += feitos.suspensos;
        totais.semDestinatario += feitos.semDestinatario;
      } catch (error) {
        totais.comErro++;
        this.log.error(
          `Cobrança da plataforma falhou no clube ${linha.academy_id}: ${error instanceof Error ? error.message : error}`,
        );
      }
    }

    if (totais.criados + totais.lembretes + totais.suspensos > 0) {
      this.log.log(
        `Cobrança da plataforma: ${totais.criados} avisos, ${totais.lembretes} lembretes, ${totais.suspensos} suspensões`,
      );
    }
    return totais;
  }

  private async tratarClube(linha: LinhaDeCobranca, hoje: Date) {
    const feitos = { criados: 0, enviados: 0, lembretes: 0, suspensos: 0, semDestinatario: 0 };
    const academyId = linha.academy_id;

    const contexto = await this.prisma.runAs(academyId, async (db) => {
      const academy = await db.academy.findFirst({
        where: { id: academyId },
        select: { id: true, slug: true, name: true, shortName: true, signalColor: true, logoUrl: true },
      });
      if (!academy) return null;

      const condicoes = await condicoesDoClube(db, academyId);
      const porAssinar = await condicoesPorAssinar(db, academyId);

      /*
       * Só os avisos recentes entram na pergunta "já saiu?": a janela de
       * recuperação é de semanas, e o histórico todo de um clube com anos
       * era ler centenas de linhas a cada hora, para nada.
       */
      const existentes = await db.subscriptionNotice.findMany({
        where: { academyId, periodStart: { gte: somaMeses(hoje, -18) } },
        orderBy: { periodStart: "asc" },
        select: {
          id: true, periodStart: true, periodEnd: true, amountCents: true, billingPeriod: true, planName: true,
          sentAt: true, paidAt: true, remindersSent: true, suspensionSentAt: true,
        },
      });

      const responsavel = await responsavelDoClube(db, academyId);
      return { academy, condicoes, porAssinar, existentes, responsavel };
    });
    if (!contexto) return feitos;
    const { academy, condicoes, porAssinar, existentes, responsavel } = contexto;

    /*
     * O dia de cobrança: o das condições quando as há (assinadas ou por
     * assinar; é o que o painel já usa para contar os períodos), senão o dia
     * em que o plano ficou activo. Sem nenhum dos dois não há o que cobrar.
     */
    const ancora = condicoes ? ancoraDasCondicoes(condicoes) : linha.anchor_on ? soODia(linha.anchor_on) : null;
    if (!ancora) return feitos;

    const contrato = {
      orderId: condicoes?.id ?? null,
      /*
       * O plano e o valor são os de hoje, os da subscrição: um preço acordado
       * depois da última assinatura (condições novas por assinar) já vale para
       * a mensalidade seguinte. Das condições vem só o dia e a periodicidade.
       */
      planName: linha.plan_name,
      billingPeriod: (condicoes?.billingPeriod ?? "MONTHLY") as SubscriptionBillingPeriod,
      amountCents: linha.amount_cents,
      porAssinar,
    };
    const brand: MailBrand = {
      shortName: academy.shortName, name: academy.name, signalColor: academy.signalColor, logoUrl: academy.logoUrl,
    };

    /* ----------------------------------------------------------- os avisos */

    const devidos = avisosDevidos({
      assinatura: ancora,
      desde: condicoes?.startsOn ?? ancora,
      hoje,
      periodo: contrato.billingPeriod,
      jaEmitidos: new Set(existentes.map((e) => chaveDoDia(e.periodStart))),
      janelaDias: this.janelaDias,
      antecipado: true,
      // Um período já coberto por outro aviso (registado à mão com outra
      // âncora, antes de assinar) não sai outra vez.
    }).filter((d) => !existentes.some((e) => e.periodStart <= d.periodEnd && e.periodEnd >= d.periodStart));

    for (const devido of devidos) {
      const aviso = await this.criarAviso(academyId, contrato, devido, hoje, responsavel);
      // Nulo = outra passagem criou este mesmo aviso primeiro. Não é erro.
      if (!aviso) continue;
      feitos.criados++;

      if (!responsavel) {
        feitos.semDestinatario++;
        this.log.warn(`Aviso ${aviso.id}: ${academy.slug} não tem ninguém com legal:club e endereço. Ficou por enviar.`);
        continue;
      }

      const enviado = await this.enviar(academyId, responsavel, brand, {
        kind: "disponivel", ...contrato, periodStart: devido.periodStart, periodEnd: devido.periodEnd, slug: academy.slug,
      });
      await this.prisma.runAs(academyId, (db) =>
        db.subscriptionNotice.update({
          where: { id: aviso.id },
          data: enviado.sent ? { sentAt: new Date() } : { failureNote: enviado.reason?.slice(0, 300) ?? "Não saiu." },
        }),
      );
      if (enviado.sent) feitos.enviados++;
    }

    /* ---------------------------------------- os lembretes e a suspensão */

    const porPagar = existentes.filter((e) => e.paidAt === null && e.periodStart <= hoje);
    if (porPagar.length === 0 || !responsavel) return feitos;

    const vencidos = porPagar.filter((e) => deveSuspender(e.periodEnd, hoje, e.paidAt, e.sentAt));
    if (vencidos.length > 0) {
      const [primeiro, ...resto] = vencidos;
      const jaAvisado = vencidos.some((v) => v.suspensionSentAt !== null);
      await this.suspender(academyId, linha);

      if (!jaAvisado) {
        const enviado = await this.enviar(academyId, responsavel, brand, {
          kind: "suspenso", ...contrato, amountCents: primeiro.amountCents, planName: primeiro.planName,
          billingPeriod: primeiro.billingPeriod, periodStart: primeiro.periodStart, periodEnd: primeiro.periodEnd,
          slug: academy.slug,
          outras: resto.map((r) => ({ periodStart: r.periodStart, periodEnd: r.periodEnd, amountCents: r.amountCents })),
        });
        if (enviado.sent) {
          await this.prisma.runAs(academyId, (db) =>
            db.subscriptionNotice.update({ where: { id: primeiro.id }, data: { suspensionSentAt: new Date() } }),
          );
          feitos.suspensos++;
        }
      }
      // Suspenso é suspenso: os lembretes semanais já disseram tudo.
      return feitos;
    }

    for (const aviso of porPagar) {
      // Sem email do aviso não há lembrete: contava-se de um dia que o clube nunca viu.
      if (!aviso.sentAt) continue;
      const n = lembreteDevido(aviso.periodStart, hoje, aviso.remindersSent);
      if (n === null) continue;

      const enviado = await this.enviar(academyId, responsavel, brand, {
        kind: "lembrete", ...contrato, amountCents: aviso.amountCents, planName: aviso.planName,
        billingPeriod: aviso.billingPeriod, periodStart: aviso.periodStart, periodEnd: aviso.periodEnd,
        slug: academy.slug, lembrete: n,
      });
      // Conta-se o lembrete mesmo quando o email não saiu: tentar outra vez de
      // hora a hora contra um correio em baixo era a definição de spam.
      await this.prisma.runAs(academyId, (db) =>
        db.subscriptionNotice.update({
          where: { id: aviso.id },
          data: { remindersSent: n, lastReminderAt: new Date(), ...(enviado.sent ? {} : { failureNote: enviado.reason?.slice(0, 300) ?? "Lembrete não saiu." }) },
        }),
      );
      if (enviado.sent) feitos.lembretes++;
    }

    return feitos;
  }

  /**
   * A linha do aviso, antes do email.
   *
   * É ela que reserva o período: duas passagens ao mesmo tempo batem no índice
   * único e só uma segue para o envio. Devolve nulo quando a corrida foi
   * perdida, que não é erro nenhum.
   */
  private async criarAviso(
    academyId: string,
    contrato: { orderId: string | null; planName: string; billingPeriod: SubscriptionBillingPeriod; amountCents: number; porAssinar: boolean },
    devido: AvisoDevido,
    hoje: Date,
    responsavel: ResponsavelDoClube | null,
  ) {
    try {
      return await this.prisma.runAs(academyId, (db) =>
        db.subscriptionNotice.create({
          data: {
            academyId,
            orderId: contrato.orderId,
            periodStart: devido.periodStart,
            periodEnd: devido.periodEnd,
            issuedOn: devido.issuedOn,
            // Paga-se até ao fim do período: no dia seguinte, suspende.
            dueOn: devido.periodEnd,
            planName: contrato.planName,
            billingPeriod: contrato.billingPeriod,
            amountCents: contrato.amountCents,
            toEmail: responsavel?.email ?? null,
            toName: responsavel?.name ?? null,
            remindersSent: lembretesJaPassados(devido.periodStart, hoje),
          },
          select: { id: true },
        }),
      );
    } catch (error) {
      if (error instanceof Error && error.message.includes("Unique constraint")) return null;
      throw error;
    }
  }

  /**
   * O email e a notificação na consola, juntos: o responsável lê um ou outro.
   *
   * O email vai **fora** de qualquer transacção, a regra da casa: uma chamada
   * de rede lá dentro segura uma ligação do pool enquanto o correio responde.
   */
  private async enviar(
    academyId: string,
    responsavel: ResponsavelDoClube,
    brand: MailBrand,
    m: {
      kind: "disponivel" | "lembrete" | "suspenso";
      planName: string; billingPeriod: SubscriptionBillingPeriod; amountCents: number;
      periodStart: Date; periodEnd: Date; slug: string; lembrete?: number;
      /** Há condições de adesão por aceitar: o email di-lo, porque sem isso não se paga. */
      porAssinar: boolean;
      outras?: { periodStart: Date; periodEnd: Date; amountCents: number }[];
    },
  ) {
    const periodo = periodoPorExtenso(m.periodStart, m.periodEnd);
    const nome = m.billingPeriod === "ANNUAL" ? "anuidade" : "mensalidade";
    const enviado = await this.mail.send({
      to: responsavel.email,
      toName: responsavel.name,
      kind: `subscription-${m.kind}`,
      ...subscriptionPaymentEmail({
        brand,
        kind: m.kind,
        name: responsavel.name,
        title: responsavel.title,
        planName: m.planName,
        annual: m.billingPeriod === "ANNUAL",
        amountCents: m.amountCents,
        periodStart: m.periodStart,
        periodEnd: m.periodEnd,
        lembrete: m.lembrete,
        outras: m.outras,
        porAssinar: m.porAssinar,
        link: this.linkDaConsola(m.slug),
      }),
    });

    const titulo =
      m.kind === "disponivel" ? `A ${nome} da plataforma está disponível`
      : m.kind === "lembrete" ? `A ${nome} de ${periodo} está em falta`
      : "O acesso do clube ficou suspenso";
    const corpo =
      m.kind === "suspenso"
        ? `A ${nome} de ${periodo} não foi paga até ao fim do período. ${m.porAssinar ? "Aceita as condições de adesão e paga" : "Paga"} nas Definições para reabrir o acesso.`
        : m.porAssinar
          ? `A ${nome} de ${periodo} paga-se nas Definições, depois de aceitares as condições de adesão em Definições, Plano.`
          : `A ${nome} de ${periodo} paga-se nas Definições, por MB WAY ou Multibanco.`;
    await this.notificacoes
      .enqueue({
        academyId,
        userId: responsavel.userId,
        type: "PAYMENT_DUE",
        title: titulo,
        body: corpo,
        // `link` é o destino na consola; a app das famílias não tem esta página.
        payload: { kind: "subscricao", link: "/definicoes?secao=mensalidade", periodStart: chaveDoDia(m.periodStart) },
      })
      .catch((e) => this.log.warn(`Notificação da mensalidade não gravada: ${e instanceof Error ? e.message : e}`));

    return enviado;
  }

  /** Fechar o clube: `suspendedAt`, o estado, e a lista em memória do guard. */
  private async suspender(academyId: string, linha: LinhaDeCobranca) {
    if (linha.suspended_at) {
      this.suspensao.marcar(academyId);
      return;
    }
    await this.prisma.runAs(academyId, (db) =>
      db.academy.update({ where: { id: academyId }, data: { suspendedAt: new Date(), status: "PAST_DUE" } }),
    );
    this.suspensao.marcar(academyId);
    this.log.warn(`Clube ${academyId} suspenso por falta de pagamento da mensalidade da plataforma`);
  }

  /**
   * Reabrir o clube se já não deve nada vencido.
   *
   * Chamado depois de cada pagamento, da consola ou registado à mão no painel.
   * Uma mensalidade do período a correr ainda por pagar não segura a porta: o
   * que suspende é o período acabar sem pagamento, e esse já foi pago.
   */
  async levantarSeEmDia(academyId: string): Promise<boolean> {
    const hoje = diaDoClube(new Date());
    const levantou = await this.prisma.runAs(academyId, async (db) => {
      const academy = await db.academy.findFirst({
        where: { id: academyId },
        select: { suspendedAt: true, trialEndsAt: true },
      });
      if (!academy?.suspendedAt) return false;
      const vencidos = await db.subscriptionNotice.count({
        where: { academyId, paidAt: null, periodEnd: { lt: hoje } },
      });
      if (vencidos > 0) return false;
      await db.academy.update({
        where: { id: academyId },
        data: {
          suspendedAt: null,
          status: academy.trialEndsAt && academy.trialEndsAt > new Date() ? "TRIAL" : "ACTIVE",
        },
      });
      return true;
    });
    if (levantou) {
      this.suspensao.levantar(academyId);
      this.log.log(`Clube ${academyId} reaberto: mensalidade da plataforma paga`);
    }
    return levantou;
  }

  /**
   * A secção da mensalidade nas Definições da consola.
   *
   * O mesmo padrão dos convites (`PUBLIC_BASE_URL` com `{slug}`): em produção
   * cada clube tem o seu subdomínio, e em desenvolvimento cai no servidor local.
   */
  linkDaConsola(slug: string): string {
    const base = this.config.get<string>("PUBLIC_BASE_URL");
    if (base) return `${base.replace(/\/$/, "").replace("{slug}", slug)}/consola/definicoes?secao=mensalidade`;
    return "http://localhost:5173/definicoes?secao=mensalidade";
  }
}

/** Uma linha de `app.subscription_billing()`: um clube que paga. */
export type LinhaDeCobranca = {
  academy_id: string;
  academy_status: AcademyStatus;
  trial_ends_at: Date | null;
  suspended_at: Date | null;
  plan_name: string;
  amount_cents: number;
  anchor_on: Date | null;
};

const SELECT_CONDICOES = {
  id: true, planName: true, billingPeriod: true, amountCents: true,
  startsOn: true, signedAt: true, billingAnchorAt: true, status: true,
} as const;

/**
 * As condições que contam: a última assinada, senão a que está à espera de
 * assinatura. Muitos clubes pagam antes de assinar, e a cobrança não espera
 * pela assinatura. A mesma regra do registo manual no painel.
 */
/**
 * Há condições de adesão por aceitar: nunca assinou nenhumas, ou há umas mais
 * recentes à espera (um preço novo, um plano novo). Enquanto for verdade, a
 * mensalidade não se paga: paga-se o que se aceitou, e não antes.
 */
export async function condicoesPorAssinar(db: ScopedClient, academyId: string): Promise<boolean> {
  const [assinadas, pendentes] = await Promise.all([
    db.subscriptionOrder.count({ where: { academyId, status: "SIGNED", signedAt: { not: null } } }),
    db.subscriptionOrder.count({ where: { academyId, status: "PENDING" } }),
  ]);
  return assinadas === 0 || pendentes > 0;
}

export async function condicoesDoClube(db: ScopedClient, academyId: string) {
  return (
    (await db.subscriptionOrder.findFirst({
      where: { academyId, status: "SIGNED", signedAt: { not: null } },
      orderBy: { signedAt: "desc" },
      select: SELECT_CONDICOES,
    })) ??
    (await db.subscriptionOrder.findFirst({
      where: { academyId, status: "PENDING" },
      orderBy: { createdAt: "desc" },
      select: SELECT_CONDICOES,
    }))
  );
}

/**
 * O dia de onde se contam os períodos, pelo calendário do clube.
 *
 * Numa ordem reemitida só para voltar a assinar, o dia é o da assinatura
 * original (`billingAnchorAt`): reassinar por papelada não muda o dia em que
 * o clube paga.
 */
export function ancoraDasCondicoes(o: { billingAnchorAt: Date | null; signedAt: Date | null; startsOn: Date }): Date {
  if (o.billingAnchorAt) return diaDoClube(o.billingAnchorAt);
  if (o.signedAt) return diaDoClube(o.signedAt);
  return soODia(o.startsOn);
}

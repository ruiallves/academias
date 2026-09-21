import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../prisma/prisma.service";
import { MailClient } from "../mail/mail.client";
import { subscriptionNoticeEmail } from "../mail/mail.templates";
import { responsavelDoClube } from "./responsavel";
import { avisosDevidos, chaveDoDia, diaDoClube, somaDias, somaMeses, type AvisoDevido } from "./ciclo";

/**
 * O aviso de pagamento da subscrição, todos os meses, sozinho.
 *
 * ## O que isto garante
 *
 * Que a pessoa que representa o clube — a primeira que registámos, a mesma que
 * assinou as condições — recebe o aviso da mensalidade de uso da plataforma no
 * **dia em que aceitou o contrato**: aceitou a 20 de Setembro, recebe a 20 de
 * Outubro, a 20 de Novembro, e por aí fora. Num contrato anual é o mesmo dia do
 * ano seguinte.
 *
 * Cada aviso cobre o período que acabou de correr (20/09 a 19/10): o clube paga
 * o mês que usou, e por isso o primeiro aviso chega um mês depois de assinar.
 * Fevereiro e os meses de 30 dias encolhem o dia sem o perder — a conta está em
 * `ciclo.ts`, com os porquês.
 *
 * ## Porquê uma varredura, e não um relógio ao minuto certo
 *
 * Porque um relógio que dispara uma vez por mês falha uma vez por mês: basta o
 * processo estar a reiniciar naquele minuto — um deploy, o Railway a mover o
 * contentor — para o clube ficar sem aviso e ninguém dar por isso. A varredura
 * corre de hora a hora sobre uma operação idempotente: a primeira passagem
 * depois da meia-noite emite, as outras não fazem nada, e um servidor que esteve
 * em baixo apanha o atraso quando voltar. É o mesmo desenho da emissão de
 * quotas e de mensalidades (`member-fees.service`, `billing.service`).
 *
 * Quem garante que não sai o segundo email do mesmo mês não é a memória do
 * processo — é o índice único `(academyId, periodStart)` na base. A linha nasce
 * **antes** do envio, precisamente para a reservar.
 *
 * ## O que fica de fora
 *
 * - Clubes **sem ordem assinada**: sem contrato aceite não há o que cobrar.
 * - Clubes com a subscrição **cancelada**, e períodos anteriores à data de
 *   início contratada.
 * - O **passado**: `janelaDias` limita o atraso que se recupera. Ligar isto num
 *   clube que assinou há um ano não lhe manda doze avisos de uma vez — uma
 *   dívida inventada por um sistema que ontem não existia. O que ficou para
 *   trás cobra-se a falar com o cliente, não com uma varredura.
 */
@Injectable()
export class SubscriptionNoticesService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(SubscriptionNoticesService.name);
  private varredura: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailClient,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    this.arrancar();
  }

  onModuleDestroy() {
    if (this.varredura) clearInterval(this.varredura);
  }

  /** Quantos dias tem o clube para pagar, a contar do aviso. */
  private get diasParaPagar(): number {
    const n = Number(this.config.get<string>("SUBSCRIPTION_NOTICE_DUE_DAYS") ?? "8");
    return Number.isFinite(n) && n >= 0 ? n : 8;
  }

  /** Até quantos dias para trás se recupera um aviso que não chegou a sair. */
  private get janelaDias(): number {
    const n = Number(this.config.get<string>("SUBSCRIPTION_NOTICE_CATCHUP_DAYS") ?? "35");
    return Number.isFinite(n) && n >= 0 ? n : 35;
  }

  private arrancar() {
    const minutos = Number(this.config.get<string>("AUTO_SUBSCRIPTION_NOTICES_INTERVAL_MIN") ?? "60");
    if (!Number.isFinite(minutos) || minutos <= 0) {
      this.log.warn("Avisos de subscrição desligados (AUTO_SUBSCRIPTION_NOTICES_INTERVAL_MIN=0)");
      return;
    }
    const passe = () =>
      this.emitirAvisos().catch((e) =>
        this.log.error(`Avisos de subscrição falharam: ${e instanceof Error ? e.message : e}`),
      );

    /*
     * Dois minutos depois de arrancar: as outras duas varreduras entram aos 60 e
     * aos 90 segundos, e arrancar com elas era disputar as cinco ligações do
     * pgbouncer no primeiro minuto de cada deploy.
     */
    setTimeout(passe, 120_000).unref();
    this.varredura = setInterval(passe, minutos * 60_000);
    this.varredura.unref();
  }

  /**
   * Emitir os avisos devidos em todos os clubes.
   *
   * `apenasAcademia` estreita a um clube — serve o apoio, e é o que torna isto
   * exercitável num teste sem escrever avisos na plataforma inteira.
   *
   * Um clube que falha não trava os outros: a passagem seguinte volta a tentar,
   * e o que já foi emitido não se repete.
   */
  async emitirAvisos(apenasAcademia?: string) {
    const hoje = diaDoClube(new Date());
    /*
     * A lista vem da base, e não de um `findMany` aqui.
     *
     * `Subscription` é uma tabela da plataforma e o papel da aplicação não tem
     * acesso nenhum a ela — de propósito, desde a migração `20260816000600`.
     * Quem sabe responder a "esta subscrição está cancelada?" sem abrir a porta
     * é uma função `SECURITY DEFINER`, como já acontece na emissão de cobranças.
     */
    const linhas = await this.prisma.$queryRaw<{ academy_id: string }[]>`
      SELECT * FROM app.academies_for_subscription_notices()
    `;
    const alvo = apenasAcademia ? linhas.filter((l) => l.academy_id === apenasAcademia) : linhas;

    const totais = { academias: alvo.length, visitadas: 0, criados: 0, enviados: 0, semDestinatario: 0, comErro: 0 };

    for (const { academy_id: academyId } of alvo) {
      try {
        const feitos = await this.emitirDoClube(academyId, hoje);
        totais.visitadas++;
        totais.criados += feitos.criados;
        totais.enviados += feitos.enviados;
        totais.semDestinatario += feitos.semDestinatario;
      } catch (error) {
        totais.comErro++;
        this.log.error(
          `Avisos de subscrição falharam no clube ${academyId}: ${error instanceof Error ? error.message : error}`,
        );
      }
    }

    if (totais.criados > 0) {
      this.log.log(`Avisos de subscrição: ${totais.criados} emitidos, ${totais.enviados} enviados`);
    }
    return totais;
  }

  private async emitirDoClube(academyId: string, hoje: Date) {
    const feitos = { criados: 0, enviados: 0, semDestinatario: 0 };

    const contexto = await this.prisma.runAs(academyId, async (db) => {
      const ordem = await db.subscriptionOrder.findFirst({
        where: { academyId, status: "SIGNED", signedAt: { not: null } },
        orderBy: { signedAt: "desc" },
        select: {
          id: true,
          planName: true,
          billingPeriod: true,
          amountCents: true,
          startsOn: true,
          signedAt: true,
        },
      });
      if (!ordem?.signedAt) return null;

      const academy = await db.academy.findFirst({
        where: { id: academyId },
        select: { id: true, slug: true, name: true, shortName: true, signalColor: true, logoUrl: true },
      });
      if (!academy) return null;

      /*
       * Só os avisos recentes entram na pergunta "já saiu?".
       *
       * A janela de recuperação é de semanas; trazer o histórico todo de um
       * clube com quatro anos para comparar datas era ler centenas de linhas a
       * cada hora, e para nada.
       */
      const desde = somaMeses(hoje, -18);
      const existentes = await db.subscriptionNotice.findMany({
        where: { academyId, periodStart: { gte: desde } },
        select: { periodStart: true },
      });

      const responsavel = await responsavelDoClube(db, academyId);

      return { ordem, academy, responsavel, jaEmitidos: new Set(existentes.map((e) => chaveDoDia(e.periodStart))) };
    });

    if (!contexto) return feitos;
    const { ordem, academy, responsavel, jaEmitidos } = contexto;

    const devidos = avisosDevidos({
      // O dia em que o clube assinou, pelo calendário dele — ver `diaDoClube`.
      assinatura: diaDoClube(ordem.signedAt!),
      desde: ordem.startsOn,
      hoje,
      periodo: ordem.billingPeriod,
      jaEmitidos,
      janelaDias: this.janelaDias,
    });

    for (const devido of devidos) {
      const aviso = await this.criarAviso(academyId, ordem, devido, responsavel);
      // Nulo = outra passagem criou este mesmo aviso primeiro. Não é erro.
      if (!aviso) continue;
      feitos.criados++;

      if (!responsavel) {
        feitos.semDestinatario++;
        this.log.warn(
          `Aviso ${aviso.id}: ${academy.slug} não tem ninguém com legal:club e endereço — ficou por enviar.`,
        );
        continue;
      }

      /*
       * O email vai **fora** da transacção — a regra da casa. Uma chamada de
       * rede lá dentro segura uma ligação do pool enquanto o serviço de email
       * responde, e com `connection_limit=5` bastam cinco para travar tudo.
       */
      const enviado = await this.mail.send({
        to: responsavel.email,
        kind: "subscription-notice",
        ...subscriptionNoticeEmail({
          brand: {
            shortName: academy.shortName,
            name: academy.name,
            signalColor: academy.signalColor,
            logoUrl: academy.logoUrl,
          },
          name: responsavel.name,
          title: responsavel.title,
          clientName: academy.name,
          planName: ordem.planName,
          annual: ordem.billingPeriod === "ANNUAL",
          amountCents: ordem.amountCents,
          periodStart: devido.periodStart,
          periodEnd: devido.periodEnd,
          dueOn: somaDias(devido.issuedOn, this.diasParaPagar),
          link: this.linkDaConsola(academy.slug),
        }),
      });

      await this.prisma.runAs(academyId, (db) =>
        db.subscriptionNotice.update({
          where: { id: aviso.id },
          data: enviado.sent ? { sentAt: new Date() } : { failureNote: enviado.reason?.slice(0, 300) ?? "Não saiu." },
        }),
      );
      if (enviado.sent) feitos.enviados++;
    }

    return feitos;
  }

  /**
   * A linha do aviso, antes do email.
   *
   * É ela que reserva o período: duas passagens ao mesmo tempo — ou dois
   * servidores — batem no índice único e só uma segue para o envio. Devolve
   * nulo quando a corrida foi perdida, que não é erro nenhum.
   */
  private async criarAviso(
    academyId: string,
    ordem: { id: string; planName: string; billingPeriod: "MONTHLY" | "ANNUAL"; amountCents: number },
    devido: AvisoDevido,
    responsavel: { name: string; email: string } | null,
  ) {
    try {
      return await this.prisma.runAs(academyId, (db) =>
        db.subscriptionNotice.create({
          data: {
            academyId,
            orderId: ordem.id,
            periodStart: devido.periodStart,
            periodEnd: devido.periodEnd,
            issuedOn: devido.issuedOn,
            dueOn: somaDias(devido.issuedOn, this.diasParaPagar),
            planName: ordem.planName,
            billingPeriod: ordem.billingPeriod,
            amountCents: ordem.amountCents,
            toEmail: responsavel?.email ?? null,
            toName: responsavel?.name ?? null,
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
   * Onde o clube vai ver as condições.
   *
   * O mesmo padrão dos convites (`PUBLIC_BASE_URL` com `{slug}`): em produção
   * cada clube tem o seu subdomínio, e em desenvolvimento cai no servidor local.
   */
  private linkDaConsola(slug: string): string {
    const base = this.config.get<string>("PUBLIC_BASE_URL");
    if (base) return `${base.replace(/\/$/, "").replace("{slug}", slug)}/consola/definicoes`;
    return "http://localhost:5173/definicoes";
  }
}

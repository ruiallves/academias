import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  ChargeStatus,
  NotificationType,
  PaymentMethod,
  PaymentStatus,
  type MemberFeeBilling,
} from "@prisma/client";
import { PrismaService, type ScopedClient } from "../prisma/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import { can, type RequestContext } from "../common/permissions";

/**
 * Quotas — o lado da consola.
 *
 * ## Uma quota é um mês
 *
 * O período de uma quota é sempre `AAAA-MM`. Já foi mais flexível — a
 * categoria dizia se era mensal, trimestral, anual, uma vez — e a
 * flexibilidade custou o que se lê na migração `quotas_mensais`: uma ficha
 * que não sabia dizer "está em dia este mês", um ecrã de atrasos que mudava de
 * unidade conforme a categoria, e uma app que não conseguia oferecer "paga até
 * Julho". O clube fala em mensalidades; o produto fala a mesma língua.
 *
 * ## Como uma quota nasce — sozinha, no dia 1
 *
 * Da categoria: `MemberTier.feeCents` é o valor **por mês**. Todo o mês, para
 * cada sócio **activo** com categoria com preço, nasce a quota do mês corrente.
 * Ninguém carrega em nada: houve um botão "Gerar quotas" e o que ele fazia era
 * lembrar a direcção de uma coisa que o produto sabe fazer sozinho — e o mês em
 * que ninguém se lembrasse era um mês sem cobranças, sem erro nenhum a dizê-lo.
 *
 * É a mesma decisão (e o mesmo desenho) das mensalidades dos atletas: uma
 * varredura frequente sobre uma operação idempotente, e não um relógio que
 * dispara uma vez por mês. Ver `arrancarEmissao`.
 *
 * As outras duas portas continuam abertas, porque respondem a perguntas
 * diferentes: `lancar` (a direcção, na ficha do sócio, para acertar atrasos ou
 * um valor à medida) e `garantirDoSocio` (a app, quando o sócio quer pagar um
 * mês adiantado que ainda não nasceu).
 */
@Injectable()
export class MemberFeesService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(MemberFeesService.name);
  private emissao: NodeJS.Timeout | null = null;

  /**
   * O último mês já lançado em cada clube, nesta vida do processo.
   *
   * É o que faz a varredura horária custar praticamente nada: lançado o mês
   * num clube, salta-se esse clube até o mês virar. Não é uma cache de dados —
   * é uma marca de "já perguntei" —, e perdê-la num deploy custa uma passagem
   * a mais, que não cria nada por a emissão ser idempotente.
   */
  private readonly lancado = new Map<string, string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    this.arrancarEmissao();
  }

  onModuleDestroy() {
    if (this.emissao) clearInterval(this.emissao);
  }

  /**
   * A emissão das quotas do mês, sozinha.
   *
   * ## Porquê de hora a hora, e não "à meia-noite do dia 1"
   *
   * Porque um relógio que dispara uma vez por mês é um relógio que falha uma
   * vez por mês: basta o processo estar a reiniciar naquele minuto — um deploy,
   * o Railway a mover o contentor — para o mês inteiro ficar por lançar, e só
   * se dar por isso quando um sócio abrir a app e não tiver o que pagar. Uma
   * varredura frequente sobre uma operação idempotente não tem esse problema: a
   * primeira passagem depois da meia-noite lança, as outras não fazem nada, e um
   * servidor que esteve em baixo apanha o atraso assim que voltar.
   *
   * `AUTO_MEMBER_FEES_INTERVAL_MIN=0` desliga, para um ambiente que não queira
   * o servidor a lançar quotas por conta própria.
   */
  private arrancarEmissao() {
    const minutos = Number(this.config.get<string>("AUTO_MEMBER_FEES_INTERVAL_MIN") ?? "60");
    if (!Number.isFinite(minutos) || minutos <= 0) {
      this.log.warn("Emissão automática de quotas desligada (AUTO_MEMBER_FEES_INTERVAL_MIN=0)");
      return;
    }
    const passe = () =>
      this.emitirQuotasDoMes().catch((e) =>
        this.log.error(`Emissão automática de quotas falhou: ${e instanceof Error ? e.message : e}`),
      );

    /*
     * Noventa segundos depois de arrancar, e não os sessenta da emissão de
     * mensalidades: as duas varreduras percorrem os mesmos clubes, e arrancar
     * ao mesmo tempo era pô-las a disputar as cinco ligações do pgbouncer no
     * primeiro minuto de cada deploy.
     */
    setTimeout(passe, 90_000).unref();
    this.emissao = setInterval(passe, minutos * 60_000);
    this.emissao.unref();
  }

  /**
   * Lançar as quotas do mês corrente em todos os clubes.
   *
   * O que o relógio corre, e o que o painel da plataforma dispara à mão para
   * quem não quer esperar. `apenasAcademia` estreita a um clube — serve o
   * apoio, e é o que torna isto exercitável num teste sem lançar quotas na
   * plataforma inteira.
   *
   * Um clube que falha não trava os outros e **não** fica marcado como lançado:
   * a passagem seguinte volta a tentar.
   */
  async emitirQuotasDoMes(apenasAcademia?: string) {
    const period = periodoCorrente(new Date());
    const linhas = await this.prisma.$queryRaw<{ academy_id: string }[]>`
      SELECT * FROM app.academies_for_billing()
    `;
    const alvo = apenasAcademia ? linhas.filter((l) => l.academy_id === apenasAcademia) : linhas;

    const totais = { period, academias: alvo.length, visitadas: 0, criadas: 0, comErro: 0 };

    for (const { academy_id: academyId } of alvo) {
      if (!apenasAcademia && this.lancado.get(academyId) === period) continue;

      try {
        const criadas = await this.prisma.runAs(academyId, async (db) => {
          const r = await gerarQuotas(db, academyId, period);
          await this.avisarQuotasNovas(db, academyId, period, r.sociosNovos);
          return r.criadas;
        });

        this.lancado.set(academyId, period);
        totais.visitadas++;
        totais.criadas += criadas;
        if (criadas > 0) {
          this.log.log(`Emissão automática: ${criadas} quotas de ${period} no clube ${academyId}`);
        }
      } catch (error) {
        totais.comErro++;
        this.log.error(
          `Emissão automática de quotas falhou no clube ${academyId}: ${error instanceof Error ? error.message : error}`,
        );
      }
    }

    return totais;
  }

  /**
   * O aviso ao sócio de que a quota do mês já existe.
   *
   * Só aos sócios **com conta ligada** — os outros não têm para onde receber —
   * e só pelas quotas **novas**: uma passagem que não cria nada chega aqui com
   * a lista vazia e não incomoda ninguém. É o que permite a varredura horária.
   */
  private async avisarQuotasNovas(db: ScopedClient, academyId: string, period: string, sociosNovos: string[]) {
    if (sociosNovos.length === 0) return;

    const quotas = await db.memberFee.findMany({
      where: { period, memberId: { in: sociosNovos } },
      select: {
        id: true, amountCents: true,
        member: { select: { userId: true } },
      },
    });

    for (const q of quotas) {
      if (!q.member.userId) continue;
      await this.notifications.enqueue(
        {
          academyId,
          userId: q.member.userId,
          type: NotificationType.PAYMENT_PENDING,
          title: "Nova quota",
          body: `A ${rotulo(period).toLowerCase()} já está disponível — ${(q.amountCents / 100).toFixed(2)} €.`,
          payload: { route: "/socio/quotas", memberFeeId: q.id },
        },
        db,
      );
    }
  }

  private mustRead(ctx: RequestContext) {
    if (!can(ctx, "member:read")) throw new ForbiddenException("Sem acesso aos sócios");
  }
  private mustWrite(ctx: RequestContext) {
    if (!can(ctx, "member:write")) throw new ForbiddenException("Sem permissão para gerir sócios");
  }

  /** As quotas de um sócio, mais recentes primeiro. */
  async doSocio(ctx: RequestContext, memberId: string) {
    this.mustRead(ctx);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const member = await db.member.findFirst({ where: { id: memberId }, select: { id: true } });
      if (!member) throw new NotFoundException("Sócio não encontrado");

      return db.memberFee.findMany({
        where: { memberId },
        orderBy: [{ period: "desc" }],
        select: {
          id: true, period: true, label: true, amountCents: true, dueOn: true,
          status: true, settledAt: true, method: true, notes: true,
        },
      });
    });
  }

  /**
   * O que o ecrã de lançar precisa de saber: o valor por omissão e **que meses
   * já têm quota**.
   *
   * ## Porque é que não vem uma lista de meses
   *
   * Vinha — os doze mais recentes — e era um tecto disfarçado: em Setembro de
   * 2026 o sócio só podia receber atrasos até Outubro de 2025, e quem quisesse
   * acertar a época inteira de 2024 não tinha por onde. O intervalo é do
   * cliente, "de mês/ano até mês/ano"; daqui só sai o que ele não pode saber
   * sozinho.
   *
   * `taken` são **todos** os meses com quota, sem filtro de data: um sócio
   * tem dezenas de quotas, não milhares, e mandá-las todas evita a pergunta
   * "quais é que interessam?" — que é a pergunta que criou o tecto.
   */
  async periodosParaLancar(ctx: RequestContext, memberId: string) {
    this.mustRead(ctx);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const member = await db.member.findFirst({
        where: { id: memberId },
        select: { id: true, tier: { select: { feeCents: true, billing: true, archivedAt: true } } },
      });
      if (!member) throw new NotFoundException("Sócio não encontrado");

      const taken = (
        await db.memberFee.findMany({ where: { memberId }, select: { period: true } })
      ).map((f) => f.period);

      return {
        hasTier: member.tier != null,
        defaultAmountCents: member.tier?.feeCents ?? null,
        /*
         * Mensal ou anual — o ecrã de lançar muda de unidade com isto: numa
         * categoria anual não se escolhem meses, escolhem-se épocas. Ver
         * `MemberFeeDialog` na consola.
         */
        billing: member.tier && !member.tier.archivedAt ? member.tier.billing : ("MONTHLY" as const),
        taken,
      };
    });
  }

  /**
   * Lançar quotas a **um** sócio, à mão.
   *
   * ## O que isto resolve
   *
   * A emissão automática trabalha sobre o livro todo e tira o valor da
   * categoria. É o dia a dia, e deixa três buracos que só se tapavam com
   * ginástica:
   *
   * - o sócio **sem categoria com preço**, que a emissão salta em silêncio;
   * - o **mês fora do corrente** — o acerto de quem entrou a meio do ano e
   *   deve três meses, que a emissão do mês corrente nunca vai apanhar;
   * - o **valor diferente do da categoria** (uma quota reduzida acordada com
   *   aquele sócio), que não tinha onde ser escrito.
   *
   * Aqui a pergunta é directa: *este sócio, este valor, estes meses*.
   *
   * ## Vários meses de uma vez
   *
   * Porque o caso real nunca é um: é "faltam-lhe Setembro, Outubro e Novembro".
   * Um pedido por mês seriam três voltas iguais com o valor escrito três
   * vezes — e é assim que se engana um deles.
   *
   * ## Os que já existem saltam-se, não recusam
   *
   * O unique `(memberId, period)` é a rede; mas recusar tudo porque um dos seis
   * já lá estava era perder os cinco que faltavam. A intenção de quem escolheu
   * seis é ter os seis — devolve-se o que se criou e o que já cá estava.
   */
  async lancar(
    ctx: RequestContext,
    memberId: string,
    input: { periods: string[]; amountCents: number; notes?: string },
  ) {
    this.mustWrite(ctx);

    const periodos = [...new Set(input.periods.map((p) => p.trim()).filter(Boolean))];
    if (periodos.length === 0) throw new BadRequestException("Escolhe pelo menos um mês");
    const invalido = periodos.find((p) => !ehMes(p));
    if (invalido) throw new BadRequestException(`"${invalido}" não é um mês (AAAA-MM)`);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const member = await db.member.findFirst({
        where: { id: memberId },
        select: { id: true, tier: { select: { billing: true, archivedAt: true } } },
      });
      if (!member) throw new NotFoundException("Sócio não encontrado");

      /*
       * Numa categoria anual cada quota é de uma época, e o período dela é o mês
       * em que a época abre. Lançar "Março" a um sócio anual criava uma segunda
       * quota do mesmo ano, com rótulo de mês, ao lado da da época.
       */
      const billing =
        member.tier && !member.tier.archivedAt && member.tier.billing === "ANNUAL" ? "ANNUAL" : "MONTHLY";
      if (billing === "ANNUAL") {
        const foraDaEpoca = periodos.find((p) => p !== inicioDaEpocaDoMes(p));
        if (foraDaEpoca) {
          throw new BadRequestException(
            "A categoria deste sócio é anual: lançam-se épocas, não meses",
          );
        }
      }

      const jaExistiam = (
        await db.memberFee.findMany({
          where: { memberId, period: { in: periodos } },
          select: { period: true },
        })
      ).map((f) => f.period);
      const existentes = new Set(jaExistiam);

      let criadas = 0;
      for (const period of periodos) {
        if (existentes.has(period)) continue;
        await db.memberFee.create({
          data: {
            ...novaQuota(ctx.academyId, memberId, period, input.amountCents, billing),
            ...(input.notes?.trim() ? { notes: input.notes.trim() } : {}),
          },
        });
        criadas += 1;
      }

      return { created: criadas, alreadyExisted: jaExistiam };
    });
  }

  /**
   * Mudar o estado de uma quota à mão — o menu "Marcar como paga / Marcar por
   * pagar / Anular" da ficha, o mesmo das mensalidades dos atletas.
   *
   * ## Isto contradiz "o pagamento só muda pelo webhook"?
   *
   * Não — é a mesma resposta do `setChargeStatus`. Aquela regra protege o fluxo
   * euPago: o telemóvel de um sócio nunca pode declarar-se pago. Isto é uma
   * acção de **gestão**, atrás de `member:write`, e fica com rasto: marcar como
   * paga cria um `Payment` de método `CASH` e provedor `manual`, para o
   * histórico dizer *como* se soube que foi pago. Voltar atrás marca esse
   * pagamento manual como reembolsado, em vez de o apagar.
   *
   * Uma quota paga **online** não se volta a abrir por aqui: o dinheiro está
   * na euPago, e desfazer isso é um estorno, não um clique.
   */
  async mudarEstado(ctx: RequestContext, feeId: string, status: ChargeStatus) {
    this.mustWrite(ctx);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const fee = await db.memberFee.findFirst({
        where: { id: feeId },
        select: {
          id: true, status: true, amountCents: true,
          payments: { where: { status: PaymentStatus.PAID }, select: { provider: true } },
        },
      });
      if (!fee) throw new NotFoundException("Quota não encontrada");

      if (status === ChargeStatus.SETTLED) {
        if (fee.status !== ChargeStatus.SETTLED) {
          await db.payment.create({
            data: {
              memberFeeId: fee.id,
              amountCents: fee.amountCents,
              method: PaymentMethod.CASH,
              status: PaymentStatus.PAID,
              provider: "manual",
              paidAt: new Date(),
            },
          });
        }
        await db.memberFee.update({
          where: { id: fee.id },
          data: { status, settledAt: new Date(), method: fee.status === ChargeStatus.SETTLED ? undefined : PaymentMethod.CASH },
        });
      } else {
        if (fee.status === ChargeStatus.SETTLED && fee.payments.some((p) => p.provider !== "manual")) {
          throw new BadRequestException("Foi paga online — desfazer isso é um estorno, não um clique");
        }
        await db.payment.updateMany({
          where: { memberFeeId: fee.id, provider: "manual", status: PaymentStatus.PAID },
          data: { status: PaymentStatus.REFUNDED },
        });
        await db.memberFee.update({
          where: { id: fee.id },
          data: { status, settledAt: null, method: null },
        });
      }

      return { id: fee.id, status };
    });
  }

  /**
   * A quota de um mês, para a app do sócio pagar — criada se ainda não existir.
   *
   * ## Porquê criar a partir da app
   *
   * O sócio quer pagar Outubro em Setembro, e Outubro ainda não chegou — a
   * emissão automática só lança o mês corrente. Mandá-lo esperar era recusar
   * dinheiro. A quota nasce aqui com o valor da categoria, exactamente como a
   * emissão a criaria no dia 1; a única diferença é o mês.
   *
   * Só nasce o que a categoria diz que existe: sem categoria com preço não há
   * valor que se possa afirmar, e a app diz isso em vez de inventar um.
   *
   * Não é uma rota de consola — a autorização é "é a quota do próprio", e
   * quem a garante é o `ClubAppService`, que chama isto já dentro do sócio.
   */
  async garantirDoSocio(db: ScopedClient, academyId: string, memberId: string, period: string) {
    if (!ehMes(period)) throw new BadRequestException("Mês inválido");

    const existente = await db.memberFee.findFirst({ where: { memberId, period }, select: { id: true } });
    if (existente) return existente.id;

    const member = await db.member.findFirst({
      where: { id: memberId },
      select: { tier: { select: { feeCents: true, archivedAt: true, billing: true } } },
    });
    const tier = member?.tier && !member.tier.archivedAt ? member.tier : null;
    if (!tier?.feeCents) {
      throw new BadRequestException("A tua categoria ainda não tem valor de quota — fala com o clube");
    }
    const preco = tier.feeCents;

    /*
     * Numa categoria anual só existe **um** período: o mês em que a época abre.
     * Pedir "Outubro" numa quota anual não é meia época — é um mês que não
     * existe nesta categoria, e criá-lo dava ao sócio uma segunda quota do
     * mesmo ano.
     */
    if (tier.billing === "ANNUAL" && period !== inicioDaEpocaDoMes(period)) {
      throw new BadRequestException("A tua quota é anual: paga-se uma vez por época, não por meses");
    }

    const criada = await db.memberFee.create({
      data: novaQuota(academyId, memberId, period, preco, tier.billing),
      select: { id: true },
    });
    return criada.id;
  }
}

/* -------------------------------------------------------------------------- */

/**
 * As quotas de um mês, para um clube — só as que faltam.
 *
 * Vive fora da classe pela mesma razão que a `gerarCobrancas` das mensalidades:
 * é a **regra**, e quem a chama (o relógio, hoje; o apoio, se um dia for
 * preciso) não deve poder trazer uma segunda versão dela.
 *
 * ## Quem entra
 *
 * Sócios `ACTIVE` com categoria viva e com preço. Um sócio suspenso não gera
 * quota — é essa a diferença entre suspender e apagar. Um sócio sem preço fica
 * de fora em silêncio, porque não há valor que se possa afirmar sobre ele:
 * inventar um era pior do que não cobrar.
 *
 * ## Uma escrita, e não uma por sócio
 *
 * `createMany` e não trezentos `create`: a transacção do `runAs` fecha aos
 * cinco segundos, e trezentas idas à base num clube grande estouravam-na — que
 * é exactamente como a importação de atletas se partiu uma vez. O unique
 * `(memberId, period)` faz de correr isto duas vezes um gesto inofensivo.
 */
export async function gerarQuotas(
  db: ScopedClient,
  academyId: string,
  period: string,
): Promise<{ criadas: number; sociosNovos: string[]; socios: number }> {
  const socios = await db.member.findMany({
    where: { status: "ACTIVE", tier: { feeCents: { not: null }, archivedAt: null } },
    select: { id: true, tier: { select: { feeCents: true, billing: true } } },
  });
  if (socios.length === 0) return { criadas: 0, sociosNovos: [], socios: 0 };

  /*
   * Cada sócio tem o seu período: o mês corrente numa categoria mensal, o mês
   * em que a época abriu numa anual. Por isso a pergunta "quem já tem?" é feita
   * sobre os dois — sobre um só, um sócio de categoria anual recebia uma quota
   * nova todos os meses.
   */
  const daEpoca = inicioDaEpocaDoMes(period);
  const periodoDe = (billing: MemberFeeBilling) => (billing === "ANNUAL" ? daEpoca : period);

  const existentes = new Set(
    (
      await db.memberFee.findMany({
        where: { memberId: { in: socios.map((s) => s.id) }, period: { in: [period, daEpoca] } },
        select: { memberId: true, period: true },
      })
    ).map((f) => `${f.memberId}|${f.period}`),
  );

  const novas = socios
    .filter((s) => s.tier?.feeCents && !existentes.has(`${s.id}|${periodoDe(s.tier.billing)}`))
    .map((s) => novaQuota(academyId, s.id, periodoDe(s.tier!.billing), s.tier!.feeCents!, s.tier!.billing));

  if (novas.length > 0) await db.memberFee.createMany({ data: novas, skipDuplicates: true });

  return { criadas: novas.length, sociosNovos: novas.map((n) => n.memberId), socios: socios.length };
}

/** Os campos de uma quota nova — o único sítio que sabe escrevê-la. */
function novaQuota(
  academyId: string,
  memberId: string,
  period: string,
  amountCents: number,
  billing: MemberFeeBilling = "MONTHLY",
) {
  return {
    academyId,
    memberId,
    period,
    label: billing === "ANNUAL" ? `Quota anual ${rotuloDaEpoca(period)}` : rotulo(period),
    amountCents,
    dueOn: fimDoMes(period),
    updatedAt: new Date(),
  };
}

/**
 * A situação de quotas de um sócio — a resposta a "está em dia?".
 *
 * A ficha dizia a **categoria** e mais nada: "Sócio efectivo, 5 €/mês". Isso é
 * o preço, não o estado — e quem abre a ficha de um sócio ao balcão quer saber
 * se ele deve alguma coisa, não quanto custa a categoria dele.
 *
 * Três factos, e são precisos os três:
 *
 * - **o mês corrente**, com o seu estado. `missing` é diferente de `open`:
 *   uma quota que ninguém lançou não é uma dívida do sócio, é trabalho por
 *   fazer do clube, e a ficha não pode dizer "deve" a quem nunca recebeu a
 *   cobrança.
 * - **o que está por pagar** no total, e quanto disso já passou do prazo. Um
 *   sócio com Setembro por pagar em Setembro está a horas; em Dezembro, não.
 * - **a última paga**, que é o que dá contexto quando não há nada em aberto.
 */
export type SituacaoQuotas = {
  currentPeriod: string;
  /** Como se chama o período corrente: "Setembro 2026" ou "Época 2026/27". */
  currentLabel: string;
  /** Quem desenha isto tem de saber se fala em "mês" ou em "época". */
  currentKind: "month" | "season";
  currentStatus: "settled" | "open" | "void" | "missing";
  openCount: number;
  openCents: number;
  overdueCount: number;
  lastSettled: { period: string; label: string | null; settledAt: Date | null } | null;
};

export async function situacaoDeQuotas(
  db: ScopedClient,
  memberId: string,
  agora = new Date(),
): Promise<SituacaoQuotas> {
  const fees = await db.memberFee.findMany({
    where: { memberId },
    orderBy: [{ period: "desc" }],
    select: { period: true, label: true, amountCents: true, status: true, dueOn: true, settledAt: true },
  });

  const abertas = fees.filter((f) => f.status === "OPEN");
  const pagas = fees.filter((f) => f.status === "SETTLED");

  /*
   * Qual é "o período corrente" depende da categoria: o mês, ou a época.
   *
   * Sem isto, um sócio de categoria anual aparecia para sempre com "a quota
   * deste mês por lançar" — a quota dele é de Agosto, e ninguém lhe vai lançar
   * uma de Setembro.
   */
  const socio = await db.member.findFirst({
    where: { id: memberId },
    select: { tier: { select: { billing: true, archivedAt: true } } },
  });
  const billing: MemberFeeBilling =
    socio?.tier && !socio.tier.archivedAt && socio.tier.billing === "ANNUAL" ? "ANNUAL" : "MONTHLY";

  const currentPeriod = periodoDaQuota(billing, agora);
  const corrente = fees.find((f) => f.period === currentPeriod);

  return {
    currentPeriod,
    currentLabel:
      billing === "ANNUAL"
        ? `Época ${rotuloDaEpoca(currentPeriod)}`
        : `${MESES[Number(currentPeriod.split("-")[1]) - 1]} ${currentPeriod.split("-")[0]}`,
    currentKind: billing === "ANNUAL" ? "season" : "month",
    currentStatus: !corrente
      ? "missing"
      : corrente.status === "SETTLED"
        ? "settled"
        : corrente.status === "VOID"
          ? "void"
          : "open",
    openCount: abertas.length,
    openCents: abertas.reduce((n, f) => n + f.amountCents, 0),
    overdueCount: abertas.filter((f) => f.dueOn && f.dueOn < agora).length,
    lastSettled: pagas[0]
      ? { period: pagas[0].period, label: pagas[0].label, settledAt: pagas[0].settledAt }
      : null,
  };
}

/**
 * O mês em que abre a época a que `agora` pertence — `AAAA-08`.
 *
 * A época vai de Agosto a Julho, a mesma janela que `mesesAteFimDaEpoca` já
 * usava para oferecer "paga até Julho". Uma quota anual nasce neste mês: é o
 * princípio da época, e é onde ela se lê no histórico.
 */
export function inicioDaEpoca(agora: Date): string {
  const ano = agora.getMonth() + 1 >= 8 ? agora.getFullYear() : agora.getFullYear() - 1;
  return `${ano}-08`;
}

/** O mesmo, a partir de um mês qualquer: `2026-10` e `2027-03` dão `2026-08`. */
export function inicioDaEpocaDoMes(period: string): string {
  const [ano, mes] = period.split("-").map(Number);
  return `${mes >= 8 ? ano : ano - 1}-08`;
}

/** `2026-08` para `2026/27`. */
export function rotuloDaEpoca(period: string): string {
  const ano = Number(period.split("-")[0]);
  return `${ano}/${String((ano + 1) % 100).padStart(2, "0")}`;
}

/**
 * Em que período nasce a quota desta categoria, agora.
 *
 * Mensal: o mês corrente. Anual: o mês em que a época abriu. É a unica
 * diferenca entre as duas — o formato do periodo e o mesmo, e por isso nada no
 * resto do produto muda de unidade. Ver a migracao `quota_mensal_ou_anual`.
 */
export function periodoDaQuota(billing: MemberFeeBilling, agora = new Date()): string {
  return billing === "ANNUAL" ? inicioDaEpoca(agora) : periodoCorrente(agora);
}

/** `AAAA-MM` do mês em que `agora` cai. */
export function periodoCorrente(agora: Date): string {
  return `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, "0")}`;
}

export function ehMes(period: string): boolean {
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  return m != null && Number(m[2]) >= 1 && Number(m[2]) <= 12;
}

/** "Quota de Setembro 2026". Os rótulos antigos (`2026`, `2026-T3`) ficam como estão. */
export function rotulo(period: string): string {
  const [ano, mes] = period.split("-");
  return `Quota de ${MESES[Number(mes) - 1]} ${ano}`;
}

/**
 * O prazo é o fim do mês **escrito no rótulo** — e não o do mês corrente.
 *
 * Uma quota lançada à mão pode ser de Setembro em Dezembro, e o prazo dela é
 * o fim de Setembro — dizer 31 de Dezembro escondia precisamente o atraso que
 * se está a registar. Não é configurável nesta fase: quando um clube pedir
 * "até dia 8", é uma coluna na categoria, não uma constante.
 */
export function fimDoMes(period: string): Date {
  const [ano, mes] = period.split("-").map(Number);
  return new Date(Date.UTC(ano, mes, 0));
}

/**
 * Os meses do corrente até ao fim da época — o que a app oferece a pagar.
 *
 * A época desportiva fecha em **Julho**: de Agosto a Julho é uma, e o sócio
 * que quer "ficar em dia até ao fim da época" quer chegar a Julho. Em
 * Setembro de 2026 são onze meses (Set–Jul); em Julho de 2027 é um.
 */
export function mesesAteFimDaEpoca(agora = new Date()): string[] {
  const ano = agora.getFullYear();
  const mes = agora.getMonth() + 1;
  const anoFim = mes >= 8 ? ano + 1 : ano;
  const meses: string[] = [];
  for (let a = ano, m = mes; a < anoFim || (a === anoFim && m <= 7); m++) {
    if (m > 12) { m = 1; a++; }
    meses.push(`${a}-${String(m).padStart(2, "0")}`);
  }
  return meses;
}

export const MESES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { assertZeroOuCobravel } from "../billing/minimos";
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
import { formatarNoFuso } from "../common/fuso";
/*
 * A aritmética das coberturas vive à parte, sem Nest nem Prisma, para poder ser
 * exercitada sem servidor nenhum — é dinheiro, e é a parte fácil de enganar.
 * Ver `cobertura.ts` e `scripts/test-cobertura-anual.mjs`.
 */
import {
  distanciaEmMeses,
  fimDaCobertura,
  inicioDaCobertura,
  inicioDaEpoca,
  mesDe,
  mesFinalCoberto,
  mesMais,
  mesesCobertos,
  repartirValor,
  sobrepoem,
} from "./cobertura";

export * from "./cobertura";

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
      /*
       * Gerar salta-se quando o mês já foi lançado neste clube. **Avisar** não.
       *
       * A segunda metade de uma anuidade partida nasce hoje e só começa daqui a
       * meses; o aviso dela cai num dia qualquer, muito depois de o mês deste
       * clube ter sido lançado. Com o salto a cobrir as duas coisas, esse aviso
       * não saía nunca.
       */
      const gerar = Boolean(apenasAcademia) || this.lancado.get(academyId) !== period;

      try {
        const criadas = await this.prisma.runAs(academyId, async (db) => {
          let n = 0;
          if (gerar) {
            const r = await gerarQuotas(db, academyId, period);
            await this.avisarQuotasNovas(db, academyId, r.novas);
            n = r.criadas;
          }
          await this.avisarQuotasQueComecaram(db, academyId);
          return n;
        });

        if (gerar) this.lancado.set(academyId, period);
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
   * O aviso ao sócio de que a quota nova já existe.
   *
   * Só aos sócios **com conta ligada** — os outros não têm para onde receber —
   * e só pelas quotas **novas**: uma passagem que não cria nada chega aqui com
   * a lista vazia e não incomoda ninguém. É o que permite a varredura horária.
   *
   * Recebe as quotas criadas como pares `(sócio, período)`, e não o mês da
   * varredura: uma quota anual nasce no mês em que o período abre, que só
   * coincide com o mês da varredura nesse mês. Procurá-la pelo mês da varredura
   * encontrava-a em Agosto e em mais nenhum — quem entrava em Março pagava sem
   * nunca ter sido avisado. O texto usa o rótulo da própria quota pela mesma
   * razão: "a quota de Agosto 2026" não é o que uma quota anual é.
   */
  private async avisarQuotasNovas(db: ScopedClient, academyId: string, novas: { memberId: string; period: string }[]) {
    if (novas.length === 0) return;

    const quotas = await db.memberFee.findMany({
      where: {
        memberId: { in: [...new Set(novas.map((n) => n.memberId))] },
        period: { in: [...new Set(novas.map((n) => n.period))] },
      },
      select: {
        id: true, memberId: true, period: true, label: true, amountCents: true,
        member: { select: { userId: true } },
      },
    });
    const pedidas = new Set(novas.map((n) => `${n.memberId}|${n.period}`));

    for (const q of quotas) {
      if (!pedidas.has(`${q.memberId}|${q.period}`) || !q.member.userId) continue;
      await this.notifications.enqueue(
        {
          academyId,
          userId: q.member.userId,
          type: NotificationType.PAYMENT_PENDING,
          title: "Nova quota",
          body: `A ${(q.label ?? rotulo(q.period)).toLowerCase()} já está disponível — ${(q.amountCents / 100).toFixed(2)} €.`,
          payload: { route: "/socio/quotas", memberFeeId: q.id },
        },
        db,
      );
    }
  }

  /**
   * As quotas cujo período **chegou** e que ainda não foram anunciadas.
   *
   * A segunda metade de uma anuidade partida nasce no dia em que a primeira é
   * partida, e só começa meses depois. Avisar logo era cobrar o que ainda não
   * se deve — o clube foi explícito: o sócio só é avisado quando esse período
   * chegar. Fica com `noticedAt` nulo até lá, e é esta passagem que a apanha.
   *
   * Carimba também as dos sócios sem conta ligada: não há para onde as mandar,
   * e sem o carimbo voltavam a ser lidas em todas as passagens, para sempre.
   */
  private async avisarQuotasQueComecaram(db: ScopedClient, academyId: string, agora = new Date()) {
    const porAvisar = await db.memberFee.findMany({
      where: { noticedAt: null, status: ChargeStatus.OPEN, coversFrom: { not: null, lte: agora } },
      select: {
        id: true, label: true, period: true, amountCents: true,
        member: { select: { userId: true } },
      },
      take: 200,
    });
    if (porAvisar.length === 0) return;

    for (const q of porAvisar) {
      if (!q.member.userId) continue;
      await this.notifications.enqueue(
        {
          academyId,
          userId: q.member.userId,
          type: NotificationType.PAYMENT_PENDING,
          title: "Nova quota",
          body: `A ${(q.label ?? rotulo(q.period)).toLowerCase()} já está disponível — ${(q.amountCents / 100).toFixed(2)} €.`,
          payload: { route: "/socio/quotas", memberFeeId: q.id },
        },
        db,
      );
    }

    await db.memberFee.updateMany({
      where: { id: { in: porAvisar.map((q) => q.id) } },
      data: { noticedAt: agora },
    });
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

      const quotas = await db.memberFee.findMany({
        where: { memberId },
        orderBy: [{ period: "desc" }],
        select: {
          id: true, period: true, label: true, amountCents: true, dueOn: true,
          status: true, settledAt: true, method: true, notes: true,
          /* O que cada quota cobre — a ficha mostra o intervalo, e é por ele
             que se sabe qual se pode ainda dividir. */
          coversFrom: true, coversTo: true,
          // O pagamento que a liquidou, para dizer quem pagou e com que
          // identificador aparece na euPago. Pode cobrir vários meses.
          paidBy: {
            where: { payment: { status: "PAID" } },
            take: 1,
            select: { payment: { select: { identificador: true, payerName: true } } },
          },
        },
      });
      return quotas.map(({ paidBy, ...q }) => ({
        ...q,
        paidBy: q.status === "SETTLED" ? (paidBy[0]?.payment.payerName ?? null) : null,
        paymentId: q.status === "SETTLED" ? (paidBy[0]?.payment.identificador ?? null) : null,
      }));
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
        select: {
          id: true,
          annualStartDay: true,
          annualStartMonth: true,
          tier: { select: { feeCents: true, billing: true, archivedAt: true } },
        },
      });
      if (!member) throw new NotFoundException("Sócio não encontrado");

      const quotas = await db.memberFee.findMany({
        where: { memberId },
        select: { period: true, coversFrom: true, coversTo: true },
      });
      const taken = quotas.map((f) => f.period);

      return {
        hasTier: member.tier != null,
        defaultAmountCents: member.tier?.feeCents ?? null,
        /*
         * Mensal ou anual — o ecrã de lançar muda de unidade com isto: numa
         * categoria anual não se escolhem meses, escolhem-se épocas. Ver
         * `MemberFeeDialog` na consola.
         */
        billing: member.tier && !member.tier.archivedAt ? member.tier.billing : ("MONTHLY" as const),
        /*
         * Quando abre o ano **deste** sócio — o dele, ou o do clube quando não
         * tem. É o que dá o dia das fronteiras da cobertura, e o que o ecrã
         * mostra ao lado do mês de início.
         */
        ...(await (async () => {
          const { mes, dia } = aberturaDoSocio(member, await aberturaAnual(db, ctx.academyId));
          return { annualStartMonth: mes, annualStartDay: dia, ownAnnualStart: member.annualStartMonth != null };
        })()),
        /* O que já está coberto, para o ecrã não deixar lançar por cima. */
        covered: quotas
          .filter((f) => f.coversFrom && f.coversTo)
          .map((f) => ({ from: f.coversFrom!, to: f.coversTo! })),
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
    input: { periods: string[]; amountCents: number; notes?: string; until?: string },
  ) {
    this.mustWrite(ctx);

    const periodos = [...new Set(input.periods.map((p) => p.trim()).filter(Boolean))];
    if (periodos.length === 0) throw new BadRequestException("Escolhe pelo menos um mês");
    const invalido = periodos.find((p) => !ehMes(p));
    if (invalido) throw new BadRequestException(`"${invalido}" não é um mês (AAAA-MM)`);
    const ate = input.until?.trim() || undefined;
    if (ate && !ehMes(ate)) throw new BadRequestException(`"${ate}" não é um mês (AAAA-MM)`);
    assertZeroOuCobravel(input.amountCents, "O valor da quota");

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const member = await db.member.findFirst({
        where: { id: memberId },
        select: {
          id: true,
          annualStartDay: true,
          annualStartMonth: true,
          tier: { select: { billing: true, archivedAt: true } },
        },
      });
      if (!member) throw new NotFoundException("Sócio não encontrado");

      const billing =
        member.tier && !member.tier.archivedAt && member.tier.billing === "ANNUAL" ? "ANNUAL" : "MONTHLY";
      const { dia } = aberturaDoSocio(member, await aberturaAnual(db, ctx.academyId));

      /*
       * Numa anual o mês escolhido é o **início** da cobertura, e pode ser
       * qualquer um.
       *
       * Era obrigado a ser o mês de abertura do clube, e isso tirava o único
       * caso que a direcção tem para lançar uma anuidade à mão: registar um ano
       * passado, que abriu noutro mês. Agora escolhe-se o mês e o ano de
       * início, como nas mensalidades, e a cobertura é um ano a partir dali —
       * ou até ao mês indicado, quando se quer uma parte.
       */
      if (billing !== "ANNUAL" && ate) {
        throw new BadRequestException("Só uma quota anual se cobra até um mês: as mensais são de um mês só");
      }
      if (ate && periodos.length > 1) {
        throw new BadRequestException("Para cobrar até um mês escolhe um período de início só");
      }
      if (billing === "ANNUAL") {
        for (const p of periodos) {
          const fim = ate ?? mesMais(p, 11);
          if (distanciaEmMeses(p, fim) < 1) {
            throw new BadRequestException("O mês final não pode ser anterior ao de início");
          }
        }
        await assertSemSobreposicao(
          db,
          memberId,
          periodos.map((p) => ({
            de: inicioDaCobertura(p, dia),
            ate: fimDaCobertura(ate ?? mesMais(p, 11), dia),
          })),
        );
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
            ...novaQuota(ctx.academyId, memberId, period, input.amountCents, billing, new Date(), dia, ate),
            ...(input.notes?.trim() ? { notes: input.notes.trim() } : {}),
          },
        });
        criadas += 1;
      }

      /* Lançar à mão um mês que tinha sido apagado é voltar atrás: a marca sai. */
      await db.memberFeeSkip.deleteMany({ where: { memberId, period: { in: periodos } } });

      return { created: criadas, alreadyExisted: jaExistiam };
    });
  }

  /**
   * Cobrar esta anuidade só **até** um mês, e passar o resto para uma segunda.
   *
   * ## O que o clube pediu
   *
   * Um sócio que queira pagar meio ano de uma vez: edita-se a anuidade para ser
   * cobrada de agora até ao mês X, e nasce logo outra a cobrir o resto do ano.
   * A segunda pode ser partida outra vez — é a mesma operação.
   *
   * O mês escolhido **entra**: com o ano a abrir dia 22, cobrar até Dezembro vai
   * de 22 de Setembro a 21 de Janeiro, quatro meses.
   *
   * ## O preço
   *
   * Proporcional aos meses, sobre o valor **desta** quota e não sobre o preço
   * da categoria: uma anuidade com um valor acordado à mão parte-se por esse
   * valor. A segunda fica com o que sobra ao cêntimo, para as duas somarem
   * exactamente o que a anuidade valia — dividir por doze e multiplicar de
   * volta não devolve o mesmo número.
   *
   * ## O início não se mexe
   *
   * Só se edita o fim, e é isso que impede uma parte de recuar para antes da
   * que a precede, ou de pisar um mês já pago. Quem quiser outro início lança
   * uma quota nova, onde o mês inicial se escolhe.
   */
  async dividir(ctx: RequestContext, feeId: string, ate: string) {
    this.mustWrite(ctx);
    if (!ehMes(ate)) throw new BadRequestException("Mês inválido");

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const fee = await db.memberFee.findFirst({
        where: { id: feeId },
        select: {
          id: true, memberId: true, period: true, amountCents: true, status: true, notes: true,
          coversFrom: true, coversTo: true,
          member: {
            select: {
              annualStartDay: true,
              annualStartMonth: true,
              tier: { select: { billing: true, archivedAt: true } },
            },
          },
        },
      });
      if (!fee) throw new NotFoundException("Quota não encontrada");
      if (fee.status !== ChargeStatus.OPEN) {
        throw new BadRequestException("Só se divide uma quota em aberto — esta já foi paga ou anulada");
      }

      const billing: MemberFeeBilling =
        fee.member.tier && !fee.member.tier.archivedAt && fee.member.tier.billing === "ANNUAL"
          ? "ANNUAL"
          : "MONTHLY";
      /*
       * O dia das fronteiras é o da própria quota, e não o da ficha: mudar o
       * aniversário do sócio amanhã não pode deslocar uma cobertura que já foi
       * escrita (e talvez já paga em parte).
       */
      const dia =
        fee.coversFrom?.getUTCDate() ??
        aberturaDoSocio(fee.member, await aberturaAnual(db, ctx.academyId)).dia;

      const cobertura = coberturaDaQuota(fee, billing, dia);
      if (!cobertura) throw new BadRequestException("Esta quota é de um mês só — não há nada para dividir");

      const inicioMes = mesDe(cobertura.de);
      const finalActual = mesFinalCoberto(cobertura.ate);
      if (distanciaEmMeses(inicioMes, ate) < 1) {
        throw new BadRequestException("O mês final não pode ser anterior ao de início");
      }
      if (distanciaEmMeses(inicioMes, ate) >= distanciaEmMeses(inicioMes, finalActual)) {
        throw new BadRequestException("Esta quota já acaba aí — escolhe um mês mais cedo");
      }

      const novoFim = fimDaCobertura(ate, dia);
      const total = mesesCobertos(cobertura.de, cobertura.ate);
      const primeiros = mesesCobertos(cobertura.de, novoFim);

      const { primeira: valorPrimeira, segunda: valorSegunda } = repartirValor(
        fee.amountCents,
        total,
        primeiros,
      );
      assertZeroOuCobravel(valorPrimeira, "A parte que fica");
      assertZeroOuCobravel(valorSegunda, "A parte que sobra");

      const inicioSegunda = new Date(novoFim.getTime() + 86_400_000);
      const periodoSegunda = mesDe(inicioSegunda);

      /* O unique `(memberId, period)` é a rede; dizê-lo antes é o que explica. */
      const ocupado = await db.memberFee.findFirst({
        where: { memberId: fee.memberId, period: periodoSegunda },
        select: { label: true },
      });
      if (ocupado) {
        throw new BadRequestException(`Já existe uma quota que começa nesse mês ("${ocupado.label ?? periodoSegunda}")`);
      }

      const agora = new Date();

      await db.memberFee.update({
        where: { id: fee.id },
        data: {
          coversTo: novoFim,
          amountCents: valorPrimeira,
          label: rotuloDaCobertura(cobertura.de, novoFim),
          dueOn: prazoDaCobertura(cobertura.de, novoFim, agora),
        },
      });

      /* A parte de trás pode ter sido apagada antes: recriá-la é voltar atrás. */
      await db.memberFeeSkip.deleteMany({ where: { memberId: fee.memberId, period: periodoSegunda } });

      const segunda = await db.memberFee.create({
        data: {
          ...novaQuota(ctx.academyId, fee.memberId, periodoSegunda, valorSegunda, "ANNUAL", agora, dia, finalActual),
          ...(fee.notes?.trim() ? { notes: fee.notes.trim() } : {}),
        },
        select: { id: true, label: true, amountCents: true, coversFrom: true, coversTo: true, dueOn: true },
      });

      return {
        ok: true as const,
        primeira: { id: fee.id, amountCents: valorPrimeira, coversTo: novoFim, months: primeiros },
        segunda: { ...segunda, months: total - primeiros },
      };
    });
  }

  /**
   * Quando abre o ano de quotas deste sócio.
   *
   * ## Mudar a data refaz o ano. Sempre.
   *
   * Não há escolha nenhuma a fazer aqui, e houve: chegou a perguntar-se se se
   * queria manter o ano em curso, redatá-lo, ou tapar o intervalo com uma quota
   * curta. Três respostas para uma pergunta que o clube não quer que lhe façam —
   * e a pior delas deixava o sócio meses sem ser cobrado, em silêncio.
   *
   * A regra é uma: **as quotas daquele ano desaparecem e nasce uma nova, na
   * janela nova, com o valor que o ano já valia.** Se o ano estava partido em
   * duas ou três partes, saem todas e fica uma anuidade inteira. Não fica
   * intervalo por cobrir porque não fica nada de permeio.
   *
   * ## O que trava, e é o único travão
   *
   * Dinheiro que entrou pela euPago. Uma quota paga online, ou com uma
   * referência ainda viva, não se apaga — apagá-la levava o registo do
   * pagamento atrás, e o dinheiro ficava sem rasto no produto. É a mesma regra
   * (e a mesma função) do botão "Apagar quota": ver `razaoParaNaoApagar`. Uma
   * quota marcada como paga **à mão** não trava, porque aí é a direcção a
   * desfazer o que ela própria escreveu.
   *
   * Tudo numa transação: se o refazer não couber, nem a data fica gravada.
   */
  async definirAnoDeQuotas(ctx: RequestContext, memberId: string, input: { annualStart: string }) {
    this.mustWrite(ctx);

    const valor = input.annualStart.trim();
    if (valor !== "" && !/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(valor)) {
      throw new BadRequestException("Data de abertura inválida");
    }

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const member = await db.member.findFirst({
        where: { id: memberId },
        select: {
          id: true,
          annualStartDay: true,
          annualStartMonth: true,
          tier: { select: { feeCents: true, billing: true, archivedAt: true } },
        },
      });
      if (!member) throw new NotFoundException("Sócio não encontrado");

      const [mes, dia] = valor === "" ? [null, null] : valor.split("-").map(Number);
      await db.member.update({
        where: { id: memberId },
        data: { annualStartMonth: mes, annualStartDay: dia },
      });

      return refazerAnoDeQuotas(db, ctx.academyId, {
        id: memberId,
        annualStartMonth: mes,
        annualStartDay: dia,
        tier: member.tier,
      });
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
  /**
   * Apagar uma quota — a lançada por engano, a do mês que não se devia cobrar.
   *
   * Mudar o estado não chegava: uma quota anulada continua no livro e na app,
   * e às vezes o que se quer é que nunca tenha existido. Duas coisas travam
   * (ver `razaoParaNaoApagar`): ter sido paga online, e haver uma tentativa de
   * pagamento online ainda viva.
   *
   * Fica uma marca (`MemberFeeSkip`) para a emissão automática não a recriar na
   * passagem seguinte, nem a app a oferecer a pagar. Lançar essa quota à mão
   * apaga a marca.
   */
  async apagar(ctx: RequestContext, feeId: string) {
    this.mustWrite(ctx);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const fee = await db.memberFee.findFirst({
        where: { id: feeId },
        select: { id: true, memberId: true, period: true, label: true },
      });
      if (!fee) throw new NotFoundException("Quota não encontrada");

      /* Os pagamentos desta quota: os que a têm por âncora e os de grupo ("pagar até"). */
      const pagamentos = await db.payment.findMany({
        where: { OR: [{ memberFeeId: fee.id }, { memberFees: { some: { memberFeeId: fee.id } } }] },
        select: { status: true, provider: true, method: true, expiresAt: true, createdAt: true },
      });
      const razao = razaoParaNaoApagar(pagamentos);
      if (razao) throw new BadRequestException(razao);

      await db.memberFeeSkip.upsert({
        where: { memberId_period: { memberId: fee.memberId, period: fee.period } },
        create: { academyId: ctx.academyId, memberId: fee.memberId, period: fee.period },
        update: {},
      });
      await db.memberFee.delete({ where: { id: fee.id } });

      return { ok: true as const, period: fee.period, label: fee.label };
    });
  }

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

    /* O clube apagou esta quota: a app não a faz nascer outra vez. */
    const dispensada = await db.memberFeeSkip.findFirst({ where: { memberId, period }, select: { period: true } });
    if (dispensada) throw new BadRequestException("O clube dispensou esta quota — não há nada a pagar");

    const member = await db.member.findFirst({
      where: { id: memberId },
      select: {
        annualStartDay: true,
        annualStartMonth: true,
        tier: { select: { feeCents: true, archivedAt: true, billing: true } },
      },
    });
    const tier = member?.tier && !member.tier.archivedAt ? member.tier : null;
    if (!tier?.feeCents) {
      throw new BadRequestException("A tua categoria ainda não tem valor de quota — fala com o clube");
    }
    const preco = tier.feeCents;

    /*
     * Numa categoria anual só existe **um** período que a app pode fazer
     * nascer: o corrente. Pedir "Outubro" numa quota anual não é meio período —
     * é um mês que não existe nesta categoria, e criá-lo dava ao sócio uma
     * segunda quota do mesmo ano. E pedir o período **seguinte** antes de o
     * corrente acabar criava-o antes do tempo: a quota nova só aparece quando o
     * período vira, e é a emissão automática que a traz. Os períodos passados
     * já existem (a direcção lançou-os) e pagam-se pelo seu id.
     */
    const { mes: inicio, dia } = aberturaDoSocio(
      member ?? { annualStartDay: null, annualStartMonth: null },
      await aberturaAnual(db, academyId),
    );
    if (tier.billing === "ANNUAL") {
      const corrente = inicioDaEpoca(new Date(), inicio, dia);
      if (period !== corrente) {
        throw new BadRequestException(
          period === inicioDaEpocaDoMes(period, inicio)
            ? "A tua quota é anual: a do período seguinte só aparece quando o corrente acabar"
            : "A tua quota é anual: paga-se uma vez por período, não por meses",
        );
      }
      /*
       * E nada de nascer por cima de uma cobertura que já existe.
       *
       * O período estar livre deixou de querer dizer que o ano está por cobrir:
       * apagada a primeira parte de uma anuidade partida, a segunda continua a
       * cobrir o resto e o mês de abertura fica vago. Sem isto, o sócio abria a
       * app e criava um ano inteiro por cima do que já devia.
       */
      await assertSemSobreposicao(db, memberId, [
        { de: inicioDaCobertura(period, dia), ate: fimDaCobertura(mesMais(period, 11), dia) },
      ]);
    }

    const criada = await db.memberFee.create({
      data: novaQuota(academyId, memberId, period, preco, tier.billing, new Date(), dia),
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
  agora = new Date(),
  /**
   * Só estes sócios. É o que a aprovação usa: quem é aprovado hoje fica logo
   * com a quota dele, sem esperar pela passagem automática, e sem que essa
   * aprovação lance as quotas do clube inteiro.
   */
  apenas?: string[],
): Promise<{ criadas: number; novas: { memberId: string; period: string }[]; socios: number }> {
  const socios = await db.member.findMany({
    where: {
      status: "ACTIVE",
      tier: { feeCents: { not: null }, archivedAt: null },
      ...(apenas ? { id: { in: apenas } } : {}),
    },
    select: {
      id: true,
      annualStartDay: true,
      annualStartMonth: true,
      tier: { select: { feeCents: true, billing: true } },
    },
  });
  if (socios.length === 0) return { criadas: 0, novas: [], socios: 0 };

  /*
   * Cada sócio tem o **seu** período: o mês corrente numa categoria mensal, e
   * numa anual o ano dele — o que abriu no dia e mês da ficha, ou na abertura
   * do clube quando a ficha não os tem.
   *
   * Era um período só, do clube inteiro. Deixou de poder ser quando o ano
   * passou a começar no dia da adesão de cada um: dois sócios anuais do mesmo
   * clube podem estar em ciclos que abrem em meses diferentes, e a pergunta
   * "quem já tem?" tem de ser feita sobre o período de cada um.
   */
  const clube = await aberturaAnual(db, academyId);
  const ids = socios.map((s) => s.id);

  const plano = socios.map((s) => {
    const anual = s.tier?.billing === "ANNUAL";
    const abertura = aberturaDoSocio(s, clube);
    return {
      id: s.id,
      anual,
      abertura,
      preco: s.tier!.feeCents!,
      periodo: anual ? inicioDaEpoca(agora, abertura.mes, abertura.dia) : period,
    };
  });

  const periodosEmJogo = [...new Set(plano.map((p) => p.periodo))];

  const existentes = new Set(
    (
      await db.memberFee.findMany({
        where: { memberId: { in: ids }, period: { in: periodosEmJogo } },
        select: { memberId: true, period: true },
      })
    ).map((f) => `${f.memberId}|${f.period}`),
  );

  /* As que a direcção apagou não voltam. Ver `MemberFeeSkip`. */
  for (const d of await db.memberFeeSkip.findMany({
    where: { memberId: { in: ids }, period: { in: periodosEmJogo } },
    select: { memberId: true, period: true },
  })) {
    existentes.add(`${d.memberId}|${d.period}`);
  }

  /*
   * E, nas anuais, nada de pisar uma cobertura que já existe.
   *
   * O período sozinho deixou de chegar no dia em que uma anuidade se pôde
   * partir: apagada a primeira metade, a segunda continua a cobrir o resto do
   * ano e o mês de abertura fica livre — a varredura criava um ano inteiro por
   * cima dela, e o sócio passava a dever os mesmos meses duas vezes.
   */
  const anuais = plano.filter((p) => p.anual);
  const cobertas = new Map<string, { de: Date; ate: Date }[]>();
  if (anuais.length > 0) {
    for (const f of await db.memberFee.findMany({
      where: { memberId: { in: anuais.map((p) => p.id) }, coversFrom: { not: null }, coversTo: { not: null } },
      select: { memberId: true, coversFrom: true, coversTo: true },
    })) {
      cobertas.set(f.memberId, [...(cobertas.get(f.memberId) ?? []), { de: f.coversFrom!, ate: f.coversTo! }]);
    }
  }

  const novas = plano
    .filter((p) => {
      if (existentes.has(`${p.id}|${p.periodo}`)) return false;
      if (!p.anual) return true;
      const nova = {
        de: inicioDaCobertura(p.periodo, p.abertura.dia),
        ate: fimDaCobertura(mesMais(p.periodo, 11), p.abertura.dia),
      };
      return !(cobertas.get(p.id) ?? []).some((c) => sobrepoem(c, nova));
    })
    .map((p) =>
      novaQuota(academyId, p.id, p.periodo, p.preco, p.anual ? "ANNUAL" : "MONTHLY", agora, p.abertura.dia),
    );

  if (novas.length > 0) await db.memberFee.createMany({ data: novas, skipDuplicates: true });

  return {
    criadas: novas.length,
    novas: novas.map((n) => ({ memberId: n.memberId, period: n.period })),
    socios: socios.length,
  };
}

/** Os campos de uma quota nova — o único sítio que sabe escrevê-la. */
function novaQuota(
  academyId: string,
  memberId: string,
  period: string,
  amountCents: number,
  billing: MemberFeeBilling = "MONTHLY",
  agora = new Date(),
  diaDeAbertura = 1,
  /** O último mês **incluído**, nas anuais. Omisso = o ano inteiro. */
  ate?: string,
) {
  if (billing !== "ANNUAL") {
    return {
      academyId,
      memberId,
      period,
      label: rotulo(period),
      amountCents,
      dueOn: fimDoMes(period),
      coversFrom: null,
      coversTo: null,
      noticedAt: agora,
      updatedAt: new Date(),
    };
  }

  const de = inicioDaCobertura(period, diaDeAbertura);
  const fim = fimDaCobertura(ate ?? mesMais(period, 11), diaDeAbertura);
  return {
    academyId,
    memberId,
    period,
    label: rotuloDaCobertura(de, fim),
    amountCents,
    dueOn: prazoDaCobertura(de, fim, agora),
    coversFrom: de,
    coversTo: fim,
    /*
     * Já começou? Quem a criou avisa. Só começa mais tarde — é a segunda metade
     * de uma anuidade partida — e fica por avisar até o período dela chegar,
     * que foi o que o clube pediu: o sócio não é incomodado com o que ainda não
     * deve. Ver `avisarQuotasQueComecaram`.
     */
    noticedAt: de <= agora ? agora : null,
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
  /** `dismissed`: não há quota porque a direcção a apagou — não é trabalho por fazer. */
  currentStatus: "settled" | "open" | "void" | "missing" | "dismissed";
  openCount: number;
  openCents: number;
  overdueCount: number;
  lastSettled: { period: string; label: string | null; settledAt: Date | null } | null;
};

export async function situacaoDeQuotas(
  db: ScopedClient,
  academyId: string,
  memberId: string,
  agora = new Date(),
): Promise<SituacaoQuotas> {
  const fees = await db.memberFee.findMany({
    where: { memberId },
    orderBy: [{ period: "desc" }],
    select: {
      period: true, label: true, amountCents: true, status: true, dueOn: true, settledAt: true,
      coversFrom: true, coversTo: true,
    },
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
    select: {
      annualStartDay: true,
      annualStartMonth: true,
      tier: { select: { billing: true, archivedAt: true } },
    },
  });
  const billing: MemberFeeBilling =
    socio?.tier && !socio.tier.archivedAt && socio.tier.billing === "ANNUAL" ? "ANNUAL" : "MONTHLY";

  const clube = await aberturaAnual(db, academyId);
  const { mes, dia } = aberturaDoSocio(socio ?? { annualStartDay: null, annualStartMonth: null }, clube);
  const currentPeriod = periodoDaQuota(billing, agora, mes, dia);

  /*
   * Numa anual, a quota corrente é a que **cobre hoje** e não a que abre o
   * ciclo. Partida a anuidade, a primeira parte pode já estar paga e é a
   * segunda que conta — sem isto a ficha dizia "em dia" a quem tem a segunda
   * metade por pagar. O período continua a ser o do ciclo, para as quotas
   * antigas sem cobertura escrita caírem no comportamento de sempre.
   */
  const corrente =
    billing === "ANNUAL"
      ? (fees.find((f) => f.coversFrom && f.coversTo && f.coversFrom <= agora && agora <= f.coversTo) ??
        fees.find((f) => f.period === currentPeriod))
      : fees.find((f) => f.period === currentPeriod);

  return {
    currentPeriod,
    currentLabel:
      billing === "ANNUAL"
        ? (corrente?.label ?? nomeDaEpoca(currentPeriod))
        : `${MESES[Number(currentPeriod.split("-")[1]) - 1]} ${currentPeriod.split("-")[0]}`,
    currentKind: billing === "ANNUAL" ? "season" : "month",
    currentStatus: !corrente
      ? (await db.memberFeeSkip.findFirst({ where: { memberId, period: currentPeriod }, select: { period: true } }))
        ? "dismissed"
        : "missing"
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
 * Em que mês abre o período das quotas anuais deste clube.
 *
 * É do clube (`Academy.memberAnnualStartMonth`) e vale para todas as categorias
 * anuais — chegou a estar na categoria, e um clube não cobra duas categorias
 * anuais em janelas diferentes. Lê-se sempre da base, sem cache: é uma
 * definição que muda uma vez por vida, e uma leitura a mais por pedido custa
 * menos do que um valor velho a decidir em que mês nasce uma quota.
 */
export type Abertura = { mes: number; dia: number };

export async function aberturaAnual(db: ScopedClient, academyId: string): Promise<Abertura> {
  const a = await db.academy.findFirst({
    where: { id: academyId },
    select: { memberAnnualStartMonth: true, memberAnnualStartDay: true },
  });
  return { mes: a?.memberAnnualStartMonth ?? 8, dia: a?.memberAnnualStartDay ?? 1 };
}

/* -------------------------------------------------------------------------- */
/* O ano de cada sócio, e o que cada quota cobre                               */
/* -------------------------------------------------------------------------- */

/**
 * Em que dia e mês abre o ano **deste** sócio.
 *
 * A dele, quando a tem; a do clube quando não. Um sócio que adere a 22 de
 * Setembro fica com 22/09 e é cobrado nesse dia todos os anos — era a razão de
 * tudo isto: com a janela do clube, quem entrava a meio comprava um ano que já
 * ia a meio. Nulo continua a querer dizer "o do clube", e é o que deixou os
 * sócios que já existiam onde estavam.
 */
export function aberturaDoSocio(
  socio: { annualStartDay: number | null; annualStartMonth: number | null },
  clube: Abertura,
): Abertura {
  const mes = Math.min(Math.max(socio.annualStartMonth ?? clube.mes, 1), 12);
  const dia = Math.min(Math.max(socio.annualStartDay ?? clube.dia, 1), DIAS_DO_MES[mes - 1]);
  return { mes, dia };
}

/**
 * Refazer o ano de quotas de um sócio na janela que passou a valer.
 *
 * O corpo do "mudar a data refaz o ano", solto da rota: apaga as quotas
 * daquele ano — as partes de um ano partido incluídas — e cria **uma**
 * anuidade na janela nova, com o valor que o ano já valia. Ver
 * `MemberFeesService.definirAnoDeQuotas` para o porquê de não haver escolha.
 *
 * Recebe o `db` em vez de o abrir, porque tem dois chamadores e o segundo — a
 * importação de sócios — já vem dentro da sua própria transação. Abrir aqui
 * um `runAs` de dentro de outro pedia uma segunda ligação ao pool para escrever
 * linhas que a primeira ainda segura: o caminho directo para um impasse.
 *
 * **Não grava a data.** Quem chama é que decide o que fica em
 * `annualStartMonth`/`annualStartDay`; isto trata só das quotas, e recebe já os
 * valores novos.
 */
export async function refazerAnoDeQuotas(
  db: ScopedClient,
  academyId: string,
  socio: {
    id: string;
    annualStartMonth: number | null;
    annualStartDay: number | null;
    tier: { feeCents: number | null; billing: MemberFeeBilling; archivedAt: Date | null } | null;
  },
  agora = new Date(),
) {
  const nada = {
    ok: true as const,
    apagadas: [] as { label: string | null; de: Date | null; ate: Date | null }[],
    nova: null,
  };

  const tier = socio.tier && !socio.tier.archivedAt ? socio.tier : null;
  if (tier?.billing !== "ANNUAL") return nada;

  const abertura = aberturaDoSocio(socio, await aberturaAnual(db, academyId));

  const periodo = inicioDaEpoca(agora, abertura.mes, abertura.dia);
  const de = inicioDaCobertura(periodo, abertura.dia);
  const ate = fimDaCobertura(mesMais(periodo, 11), abertura.dia);

  /*
   * O ano a refazer: tudo o que a janela nova pisa, mais tudo o que ainda não
   * acabou.
   *
   * As duas condições são precisas. A sobreposição apanha as partes de um ano
   * partido que caem dentro da janela nova; a segunda apanha o que ficaria **a
   * seguir** a ela sem lhe tocar — uma segunda metade que já começava depois do
   * fim da janela nova continuaria lá, e era exactamente a sobra que isto
   * existe para não deixar.
   */
  const candidatas = await db.memberFee.findMany({
    where: { memberId: socio.id, coversFrom: { not: null }, coversTo: { not: null } },
    select: {
      id: true, label: true, period: true, amountCents: true, status: true,
      coversFrom: true, coversTo: true,
    },
  });
  const afetadas = candidatas.filter(
    (f) =>
      sobrepoem({ de: f.coversFrom!, ate: f.coversTo! }, { de, ate }) ||
      (f.status !== ChargeStatus.VOID && f.coversTo! >= agora),
  );

  if (afetadas.length === 0) return nada;

  /* O único travão: dinheiro que entrou pela euPago. Ver o cabeçalho. */
  const ids = afetadas.map((f) => f.id);
  const pagamentos = await db.payment.findMany({
    where: { OR: [{ memberFeeId: { in: ids } }, { memberFees: { some: { memberFeeId: { in: ids } } } }] },
    select: { status: true, provider: true, method: true, expiresAt: true, createdAt: true },
  });
  const razao = razaoParaNaoApagar(pagamentos);
  if (razao) throw new BadRequestException(`Não dá para refazer o ano: ${razao}`);

  /* O ano novo vale o que o ano velho valia — não é o momento de repreçar. */
  const total = afetadas.reduce((n, f) => n + f.amountCents, 0);
  assertZeroOuCobravel(total, "O valor do ano novo");

  await db.memberFee.deleteMany({ where: { id: { in: ids } } });
  /* Refazer é recomeçar: as marcas de dispensa dos meses envolvidos saem, senão
     o livro recusava o que se acabou de criar. */
  await db.memberFeeSkip.deleteMany({
    where: { memberId: socio.id, period: { in: [...new Set([...afetadas.map((f) => f.period), periodo])] } },
  });

  const nova = await db.memberFee.create({
    data: novaQuota(academyId, socio.id, periodo, total, "ANNUAL", agora, abertura.dia),
    select: { id: true, label: true, amountCents: true, coversFrom: true, coversTo: true },
  });

  return {
    ok: true as const,
    apagadas: afetadas.map((f) => ({ label: f.label, de: f.coversFrom, ate: f.coversTo })),
    nova,
  };
}

/**
 * A cobertura de uma quota, mesmo quando ela não a tem escrita.
 *
 * As anuais criadas antes desta funcionalidade ficaram com o intervalo
 * preenchido na migração, mas uma linha antiga que a migração não reconheceu
 * (rótulo mudado à mão) ainda pode vir sem ele. Nesse caso vale o que sempre
 * valeu: um ano a contar do período. Devolve `null` para as mensais, onde o
 * período já diz tudo.
 */
export function coberturaDaQuota(
  fee: { period: string; coversFrom: Date | null; coversTo: Date | null },
  billing: MemberFeeBilling,
  dia: number,
): { de: Date; ate: Date } | null {
  if (fee.coversFrom && fee.coversTo) return { de: fee.coversFrom, ate: fee.coversTo };
  if (billing !== "ANNUAL" || !ehMes(fee.period)) return null;
  return { de: inicioDaCobertura(fee.period, dia), ate: fimDaCobertura(mesMais(fee.period, 11), dia) };
}

/**
 * Como se chama uma quota pelo que ela cobre.
 *
 * Um ano inteiro continua a ser "Quota anual 2026/27" — é como o clube lhe
 * chama e não havia razão para mudar. Uma parte diz os meses que paga, porque é
 * isso que o sócio precisa de ler para saber até quando está em dia.
 */
export function rotuloDaCobertura(de: Date, ate: Date): string {
  const inicio = mesDe(de);
  const fim = mesFinalCoberto(ate);
  if (mesesCobertos(de, ate) >= 12) return `Quota anual ${rotuloDaEpoca(inicio)}`;

  const [anoI, mesI] = inicio.split("-").map(Number);
  const [anoF, mesF] = fim.split("-").map(Number);
  if (inicio === fim) return `Quota de ${MESES[mesI - 1]} ${anoI}`;
  return anoI === anoF
    ? `Quota de ${MESES[mesI - 1]} a ${MESES[mesF - 1]} ${anoF}`
    : `Quota de ${MESES[mesI - 1]} ${anoI} a ${MESES[mesF - 1]} ${anoF}`;
}

/**
 * O prazo de uma quota anual, pela cobertura dela. Os mesmos três casos de
 * `prazoDaQuota`, agora com o intervalo escrito em vez de deduzido: já acabou
 * (é um atraso, e o prazo é o fim), ainda não começou (paga-se no mês em que
 * abrir — é isto que faz a segunda metade de uma anuidade partida não nascer
 * em dívida), ou está a decorrer (até ao fim deste mês).
 */
export function prazoDaCobertura(de: Date, ate: Date, agora = new Date()): Date {
  if (ate < agora) return ate;
  if (de > agora) return fimDoMes(mesDe(de));
  return fimDoMes(periodoCorrente(agora));
}

/** `22/09/2026` — para dizer numa mensagem de erro qual é a quota que choca. */
function dataCurta(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

/**
 * Recusa uma cobertura que pise outra do mesmo sócio.
 *
 * Duas anuidades a cobrir o mesmo mês são o mesmo mês cobrado duas vezes. O
 * unique `(memberId, period)` só apanha as que começam no mesmo mês; desde que
 * uma anuidade se pode partir, duas podem chocar sem partilhar o início.
 */
export async function assertSemSobreposicao(
  db: ScopedClient,
  memberId: string,
  novas: { de: Date; ate: Date }[],
  ignorarFeeId?: string,
): Promise<void> {
  const existentes = await db.memberFee.findMany({
    where: {
      memberId,
      coversFrom: { not: null },
      coversTo: { not: null },
      ...(ignorarFeeId ? { id: { not: ignorarFeeId } } : {}),
    },
    select: { label: true, coversFrom: true, coversTo: true },
  });

  for (const nova of novas) {
    const choque = existentes.find((e) => sobrepoem({ de: e.coversFrom!, ate: e.coversTo! }, nova));
    if (choque) {
      throw new BadRequestException(
        `Este período sobrepõe-se a "${choque.label ?? "uma quota que já existe"}" ` +
          `(${dataCurta(choque.coversFrom!)} a ${dataCurta(choque.coversTo!)})`,
      );
    }
  }
}

/** Quantos dias tem cada mês, num ano comum — o tecto do dia de abertura. */
export const DIAS_DO_MES = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/**
 * O mês em que abre o período anual a que `agora` pertence — `AAAA-MM`, com o
 * mês e o dia que o clube fixou (`Academy.memberAnnualStartMonth/Day`). Antes
 * do dia, o mês de abertura ainda pertence ao período anterior: a 10 de
 * Setembro, num clube que abre a 15, o período é o que abriu há um ano.
 *
 * Era `AAAA-08` para toda a gente: a época desportiva, de Agosto a Julho, fixa
 * no código. Não é assim que os clubes cobram — uns fazem-no ao ano civil,
 * outros à época, outros a partir do mês que a assembleia decidiu — e por isso
 * o mês passou a ser deles. Uma quota anual nasce neste mês: é o princípio do
 * período, e é onde ele se lê no histórico. O período acaba um ano depois
 * menos um dia (ver `fimDaEpoca`).
 *
 * O `8` por omissão é o que era, para quem chamar isto sem categoria à mão.
 */
/* `inicioDaEpoca` mudou-se para `cobertura.ts` — é aritmética pura, e é lá que
   ela se consegue exercitar sem servidor. Continua a sair daqui pelo
   `export *` do topo, para quem já a importava. */

/** O mesmo, a partir de um mês qualquer: com início em Agosto, `2026-10` e `2027-03` dão `2026-08`. */
export function inicioDaEpocaDoMes(period: string, inicio = 8): string {
  const [ano, mes] = period.split("-").map(Number);
  return `${mes >= inicio ? ano : ano - 1}-${String(inicio).padStart(2, "0")}`;
}

/**
 * O último dia do período anual que abre em `period` — um ano depois, menos um
 * dia. Com abertura no dia 1: `2026-08` acaba a 31 de Julho de 2027, `2026-01`
 * a 31 de Dezembro de 2026, `2026-03` a 28 de Fevereiro de 2027 (e a 29 num
 * bissexto — o `Date` conta por nós). Com abertura a 15: `2026-09` acaba a 14
 * de Setembro de 2027.
 */
export function fimDaEpoca(period: string, dia = 1): Date {
  const [ano, mes] = period.split("-").map(Number);
  // O dia anterior ao de abertura, no ano seguinte. Com `dia` 1 cai no dia 0,
  // que o `Date` lê como o último dia do mês anterior.
  return new Date(Date.UTC(ano + 1, mes - 1, dia - 1));
}

/**
 * O nome curto do período: "2026/27" quando atravessa dois anos, "2026" quando
 * é o ano civil. Um período de Janeiro a Dezembro escrito "2026/27" estava
 * simplesmente errado — e o formato do rótulo conta-se pelo mês em que abre,
 * que é o que o período guarda.
 */
export function rotuloDaEpoca(period: string): string {
  const [ano, mes] = period.split("-").map(Number);
  if (mes === 1) return String(ano);
  return `${ano}/${String((ano + 1) % 100).padStart(2, "0")}`;
}

/** Como a ficha lhe chama: "Época 2026/27", ou "Ano 2026" no ano civil. */
export function nomeDaEpoca(period: string): string {
  return Number(period.split("-")[1]) === 1 ? `Ano ${rotuloDaEpoca(period)}` : `Época ${rotuloDaEpoca(period)}`;
}

/**
 * Em que período nasce a quota desta categoria, agora.
 *
 * Mensal: o mês corrente. Anual: o mês em que o período abriu, o da categoria.
 * É a única diferença entre as duas — o formato do período é o mesmo, e por
 * isso nada no resto do produto muda de unidade. Ver a migração
 * `quota_mensal_ou_anual`.
 */
export function periodoDaQuota(billing: MemberFeeBilling, agora = new Date(), inicio = 8, dia = 1): string {
  return billing === "ANNUAL" ? inicioDaEpoca(agora, inicio, dia) : periodoCorrente(agora);
}

/**
 * O prazo de uma quota.
 *
 * Mensal: o fim do mês escrito no rótulo (ver `fimDoMes`). Anual, três casos,
 * porque o período dura um ano e a quota pode nascer em qualquer ponto dele:
 *
 * - o período **já acabou** — é um atraso que se está a registar, e o prazo é
 *   o último dia do período, para contar como tal;
 * - o período **é o corrente** — até ao fim do mês em que a quota nasce. É o
 *   caso de quem entra em Março numa categoria de Agosto: tem Março para pagar,
 *   e não "está em atraso desde Agosto". Era esse o erro: o prazo era o fim do
 *   mês em que o período abria, e toda a gente que entrava depois ficava fora
 *   de prazo no dia em que a quota nascia;
 * - o período **ainda não começou** — paga-se no mês em que abrir.
 */
export function prazoDaQuota(period: string, billing: MemberFeeBilling, agora = new Date(), dia = 1): Date {
  if (billing !== "ANNUAL") return fimDoMes(period);

  const fim = fimDaEpoca(period, dia);
  if (fim < agora) return fim;

  const [ano, mes] = period.split("-").map(Number);
  const abre = new Date(Date.UTC(ano, mes - 1, dia));
  if (abre > agora) return fimDoMes(period);

  return fimDoMes(periodoCorrente(agora));
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

/**
 * Pode esta cobrança (quota ou mensalidade) ser apagada? Devolve a razão se não.
 *
 * Duas coisas travam, e só estas duas:
 *
 * - **foi paga online.** O dinheiro entrou pela euPago, e o pagamento é o
 *   registo disso; apagá-la levava o registo em cascata. Um pagamento marcado à
 *   mão (provedor `manual`) não trava — é a direcção a desfazer o que ela
 *   própria escreveu.
 * - **há uma tentativa online viva.** Uma referência Multibanco ainda dentro do
 *   prazo, um MB Way com menos de dez minutos. Se a família pagar depois de a
 *   cobrança ter sido apagada, o webhook não encontra o pagamento — regista um
 *   aviso e mais nada — e o dinheiro entra sem rasto no produto.
 */
export function razaoParaNaoApagar(
  pagamentos: { status: PaymentStatus; provider: string; method: PaymentMethod; expiresAt: Date | null; createdAt: Date }[],
  agora = new Date(),
): string | null {
  if (pagamentos.some((p) => p.status === PaymentStatus.PAID && p.provider !== "manual")) {
    return "Foi paga online: apagá-la apagava o registo do dinheiro que entrou";
  }
  const viva = pagamentos.find((p) => {
    if (p.provider === "manual") return false;
    if (p.status !== PaymentStatus.PENDING && p.status !== PaymentStatus.PROCESSING) return false;
    if (p.method === PaymentMethod.MBWAY) return agora.getTime() - p.createdAt.getTime() <= 10 * 60_000;
    return !p.expiresAt || p.expiresAt.getTime() > agora.getTime();
  });
  if (viva) {
    const ate = viva.expiresAt ? ` até ${formatarNoFuso(viva.expiresAt, { day: "2-digit", month: "2-digit", year: "numeric" })}` : "";
    return viva.method === PaymentMethod.MBWAY
      ? "Há um pedido MB Way em curso: espera uns minutos, que ele expira"
      : `Há uma referência Multibanco por pagar${ate}: se for paga depois de apagada, o dinheiro entra sem registo. Espera que expire, ou anula-a`;
  }
  return null;
}

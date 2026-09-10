import { createHash, randomBytes } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { PaymentMethod } from "@prisma/client";
import { PrismaService, type ScopedClient } from "../prisma/prisma.service";
import { AuthService } from "../auth/auth.service";
import { SupabaseJwtService } from "../auth/supabase-jwt.service";
import { SupabaseAccountsService } from "../auth/supabase-accounts.service";
import { BillingService } from "../billing/billing.service";
import { MemberFeesService, mesesAteFimDaEpoca, rotulo } from "../members/member-fees.service";
import { reclamarFichaPelaConta } from "../members/member-account-link";
import { LegalService } from "../legal/legal.service";

/**
 * A app do clube — contextos e a área de sócio.
 *
 * ## Porque é que isto não usa `RequestContext`
 *
 * Todo o resto da API entra pelo guard: token → membership → papel → permissões.
 * Um sócio não tem nada disso — a decisão de o `Member` **não** ser um `User`
 * está tomada e explicada no schema, e um sócio sem filhos no clube não tem
 * `Membership` nenhuma. Obrigá-lo a ter seria criar vínculos de família falsos
 * só para passar no guard.
 *
 * Por isso esta porta é outra: verifica-se o JWT directamente, resolve-se a
 * academia pelo slug (a mesma escotilha do guard), e o que autoriza cada leitura
 * é a ficha de sócio **reclamada** — `Member.userId = quem está a pedir`. Tudo
 * corre dentro de `runAs(academyId)`, por isso a RLS continua por baixo: mesmo
 * um erro aqui não atravessa clubes.
 *
 * ## "Contexto", e não "role"
 *
 * A mesma conta pode ser Família e Sócio no mesmo clube — e amanhã Atleta ou
 * Staff. O que este serviço devolve são os **contextos** disponíveis dessa conta
 * neste clube; a autorização a sério continua nos sítios dela (o guard para a
 * família, a ficha reclamada para o sócio). Acrescentar um contexto novo é
 * acrescentar uma entrada em `contexts()` e a vista correspondente na app — nada
 * do que está aqui precisa de mudar de forma.
 */

/** O que o QR do cartão carrega. Um prefixo e o token opaco — e mais nada. */
export const CARD_QR_PREFIX = "academias:socio:";

type Identidade = { authId: string; userId: string | null };

@Injectable()
export class ClubAppService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: SupabaseJwtService,
    private readonly auth: AuthService,
    private readonly accounts: SupabaseAccountsService,
    private readonly billing: BillingService,
    private readonly quotas: MemberFeesService,
    private readonly config: ConfigService,
    private readonly legal: LegalService,
  ) {}

  /* ------------------------------------------------------------------------ */
  /* Identidade e resolução                                                    */
  /* ------------------------------------------------------------------------ */

  /** Verifica o token e devolve quem é — sem exigir membership nenhuma. */
  private async identidade(authorization?: string): Promise<Identidade> {
    const token = (authorization ?? "").replace(/^Bearer\s+/i, "").trim();
    if (!token) throw new UnauthorizedException("Falta o token de sessão");

    const user = await this.jwt.verify(token);

    /*
     * O `User.id` pela escotilha, não pelo Prisma: a política de `User` é
     * "vejo-te se partilharmos academia", e um sócio sem vínculo de família não
     * partilha nada — o findFirst voltava vazio para a pessoa certa.
     */
    const rows = await this.prisma.$queryRaw<{ id: string | null }[]>`
      SELECT app.resolve_user_by_auth(${user.authId}) AS id
    `;
    return { authId: user.authId, userId: rows[0]?.id ?? null };
  }

  private async academiaDe(slug: string): Promise<string> {
    const academyId = await this.auth.academyIdBySlug(slug);
    if (!academyId) throw new NotFoundException(`Academia "${slug}" não encontrada`);
    return academyId;
  }

  /**
   * A ficha de sócio reclamada por esta conta neste clube — ou 404.
   *
   * É também a porta do gate legal para a área de sócio: estas rotas não passam
   * pelo guard global, e um sócio com documentos por aceitar tem de ficar de
   * fora aqui, como o pessoal e as famílias ficam lá. `contexts` não passa por
   * aqui de propósito — é a pergunta que a app faz para saber que gate mostrar.
   */
  private async socioDe(db: ScopedClient, userId: string | null, academyId: string) {
    if (!userId) throw new NotFoundException("Esta conta não é de sócio neste clube");
    const member = await db.member.findFirst({ where: { userId } });
    if (!member) throw new NotFoundException("Esta conta não é de sócio neste clube");
    await this.legal.assertClearMember(db, userId, academyId);
    return member;
  }

  /* ------------------------------------------------------------------------ */
  /* Contextos                                                                 */
  /* ------------------------------------------------------------------------ */

  /**
   * Que contextos tem esta conta neste clube.
   *
   * É a primeira pergunta que a app faz depois do login. Um contexto só → entra
   * directo; dois → a app pergunta "como queres continuar?". A resposta traz o
   * suficiente para desenhar essa escolha — e nada mais: cada vista vai buscar
   * os seus dados aos seus endpoints.
   */
  async contexts(authorization: string | undefined, slug: string) {
    const eu = await this.identidade(authorization);
    const academyId = await this.academiaDe(slug);

    const memberships = await this.auth.membershipsOf(eu.authId);
    const daAcademia = memberships.filter((m) => m.academy_id === academyId);
    const deFamilia = (role: string) => role === "GUARDIAN" || role === "ATHLETE";
    const familia = daAcademia.some((m) => deFamilia(m.role));
    /*
     * Staff é qualquer membership que não seja de família — presidente,
     * treinador, médico, observador. A app não desenha essa vista: entrega a
     * pessoa à consola, que já existe e já sabe tudo o que ela pode fazer. O
     * contexto só diz "há para onde ir", e leva o papel para a app o poder
     * nomear ("Equipa técnica") no ecrã de escolha.
     */
    const staff = daAcademia.find((m) => !deFamilia(m.role));

    return this.prisma.runAs(academyId, async (db) => {
      let member = eu.userId ? await db.member.findFirst({ where: { userId: eu.userId } }) : null;

      /*
       * Sem ficha ligada, mas com vínculo aqui (família ou staff)? Talvez a
       * direcção tenha inscrito esta pessoa como sócio com o email da conta.
       * Reclama-se a ficha agora — é este o momento em que "abro a app e a
       * área de sócio está lá" acontece. Ver `member-account-link.ts`.
       */
      if (!member && eu.userId && (familia || staff)) {
        if (await reclamarFichaPelaConta(db, eu.userId)) {
          member = await db.member.findFirst({ where: { userId: eu.userId } });
        }
      }

      const contexts: Record<string, unknown>[] = [];
      if (familia) contexts.push({ type: "FAMILY" });
      if (member) {
        contexts.push({
          type: "MEMBER",
          memberId: member.id,
          number: member.number,
          status: member.status,
        });
      }
      if (staff) contexts.push({ type: "STAFF", role: staff.role });

      return { contexts };
    });
  }

  /* ------------------------------------------------------------------------ */
  /* A área de sócio                                                           */
  /* ------------------------------------------------------------------------ */

  /**
   * Tudo o que a Member View precisa, numa ida só.
   *
   * O mesmo desenho do `/api/bootstrap` da família: a app abre com um pedido e
   * desenha tudo — num telemóvel com rede fraca, cinco pedidos são cinco
   * oportunidades de ficar meio ecrã em branco.
   */
  async inicio(authorization: string | undefined, slug: string) {
    const eu = await this.identidade(authorization);
    const academyId = await this.academiaDe(slug);

    return this.prisma.runAs(academyId, async (db) => {
      const socio = await this.socioDe(db, eu.userId, academyId);

      const academia = await db.academy.findFirst({
        where: { id: academyId },
        select: {
          name: true, shortName: true, slug: true, logoUrl: true, signalColor: true,
          memberCardEnabled: true, memberCardQrEnabled: true, eupagoApiKey: true,
        },
      });

      /*
       * O token do cartão nasce à primeira abertura, não na criação da ficha:
       * a maioria dos sócios nunca abre a app, e um token por gerar não é um
       * token que se possa perder.
       */
      let cardToken = socio.cardToken;
      if (!cardToken && academia?.memberCardEnabled && academia.memberCardQrEnabled) {
        cardToken = randomBytes(24).toString("base64url");
        await db.member.update({ where: { id: socio.id }, data: { cardToken } });
      }

      const agora = new Date();

      const [tier, fees, jogo, noticias, sondagens, votos] = await Promise.all([
        socio.tierId
          ? db.memberTier.findFirst({ where: { id: socio.tierId }, select: { name: true, feeCents: true, archivedAt: true } })
          : null,
        db.memberFee.findMany({
          where: { memberId: socio.id },
          orderBy: [{ period: "desc" }],
          select: {
            id: true, period: true, label: true, amountCents: true, dueOn: true,
            status: true, settledAt: true,
          },
        }),
        db.match.findFirst({
          where: { startsAt: { gte: agora }, status: "SCHEDULED" },
          orderBy: { startsAt: "asc" },
          select: {
            id: true, startsAt: true, venue: true, opponent: true, isHome: true,
            team: { select: { name: true } },
            competition: { select: { label: true } },
          },
        }),
        db.announcement.findMany({
          where: { publishedAt: { not: null } },
          orderBy: { publishedAt: "desc" },
          take: 20,
          select: { id: true, title: true, body: true, publishedAt: true, audience: true },
        }),
        db.poll.findMany({
          where: { status: "OPEN" },
          orderBy: { publishedAt: "desc" },
          select: {
            id: true, question: true, details: true, publishedAt: true,
            options: { orderBy: { order: "asc" }, select: { id: true, label: true, _count: { select: { votes: true } } } },
          },
        }),
        db.pollVote.findMany({ where: { memberId: socio.id }, select: { pollId: true, optionId: true } }),
      ]);

      /*
       * As notícias do sócio são as de audiência `all` e `members`. As de
       * `guardians` e `coaches` são doutros contextos — o filtro é aqui e não
       * no SQL porque a audiência é JSON e este é o único leitor com regra
       * própria.
       */
      const visiveis = noticias
        .filter((a) => {
          const kind = (a.audience as { kind?: string } | null)?.kind ?? "all";
          return kind === "all" || kind === "members";
        })
        .slice(0, 10)
        .map(({ audience: _audience, ...resto }) => resto);

      const meusVotos = new Map(votos.map((v) => [v.pollId, v.optionId]));

      /*
       * Os meses que o sócio pode pagar já: do corrente até Julho, fim da
       * época. Os que já têm quota trazem-na; os outros são só a promessa —
       * "Outubro, 5 €" — e a quota nasce quando ele carregar em pagar
       * (`garantirDoSocio`). Sem categoria com preço não se promete valor
       * nenhum: `amountCents` vem nulo e a app explica em vez de inventar.
       */
      const porPeriodo = new Map(fees.map((f) => [f.period, f]));
      const precoMes = tier && !tier.archivedAt ? tier.feeCents : null;
      const upcoming = mesesAteFimDaEpoca(agora).map((period) => {
        const fee = porPeriodo.get(period);
        return {
          period,
          label: fee?.label ?? rotulo(period),
          feeId: fee?.id ?? null,
          amountCents: fee?.amountCents ?? precoMes,
          status: fee?.status ?? null,
        };
      });

      return {
        academy: {
          name: academia?.name ?? "",
          shortName: academia?.shortName ?? "",
          slug: academia?.slug ?? slug,
          logoUrl: academia?.logoUrl ?? null,
          signalColor: academia?.signalColor ?? "#0f6b62",
          cardEnabled: academia?.memberCardEnabled ?? true,
          cardQrEnabled: academia?.memberCardQrEnabled ?? false,
          /*
           * Se há por onde pagar online. A chave em si nunca sai daqui — a app
           * só precisa de saber se mostra o botão.
           */
          onlinePayments: Boolean(
            (academia?.eupagoApiKey ?? "").trim() || (this.config.get<string>("EUPAGO_API_KEY") ?? "").trim(),
          ),
        },
        member: {
          id: socio.id,
          name: socio.name,
          number: socio.number,
          status: socio.status,
          tierName: tier?.name ?? null,
          tierFeeCents: precoMes,
          email: socio.email,
          phone: socio.phone ? `${socio.phoneCountry} ${socio.phone}` : null,
          memberSince: socio.approvedAt ?? socio.createdAt,
          /* O QR é `CARD_QR_PREFIX + token` — opaco, revogável, sem um único
             dado pessoal lá dentro. */
          cardQr: academia?.memberCardEnabled && academia.memberCardQrEnabled && cardToken
            ? CARD_QR_PREFIX + cardToken
            : null,
        },
        fees: fees.map((f) => ({
          ...f,
          overdue: f.status === "OPEN" && Boolean(f.dueOn && f.dueOn < agora),
        })),
        upcoming,
        nextMatch: jogo
          ? {
              id: jogo.id,
              startsAt: jogo.startsAt,
              venue: jogo.venue,
              opponent: jogo.opponent,
              isHome: jogo.isHome,
              teamName: jogo.team.name,
              competition: jogo.competition?.label ?? null,
            }
          : null,
        news: visiveis,
        polls: sondagens.map((p) => ({
          id: p.id,
          question: p.question,
          details: p.details,
          publishedAt: p.publishedAt,
          myOptionId: meusVotos.get(p.id) ?? null,
          options: p.options.map((o) => ({ id: o.id, label: o.label, votes: o._count.votes })),
        })),
      };
    });
  }

  /**
   * Votar numa sondagem. Um sócio, um voto — o serviço diz a frase, o índice
   * único `(pollId, memberId)` fica de rede para dois toques em rede fraca.
   */
  async votar(authorization: string | undefined, slug: string, pollId: string, optionId: string) {
    const eu = await this.identidade(authorization);
    const academyId = await this.academiaDe(slug);

    return this.prisma.runAs(academyId, async (db) => {
      const socio = await this.socioDe(db, eu.userId, academyId);
      if (socio.status !== "ACTIVE") {
        throw new BadRequestException("Só sócios activos podem votar");
      }

      const poll = await db.poll.findFirst({ where: { id: pollId }, select: { status: true } });
      if (!poll) throw new NotFoundException("Sondagem não encontrada");
      if (poll.status !== "OPEN") throw new BadRequestException("Esta sondagem já fechou");

      const option = await db.pollOption.findFirst({ where: { id: optionId, pollId }, select: { id: true } });
      if (!option) throw new BadRequestException("Essa opção não é desta sondagem");

      const jaVotou = await db.pollVote.findFirst({
        where: { pollId, memberId: socio.id },
        select: { id: true },
      });
      if (jaVotou) throw new ConflictException("Já votaste nesta sondagem");

      await db.pollVote.create({
        data: { academyId, pollId, optionId, memberId: socio.id },
      });

      return { ok: true as const };
    });
  }

  /**
   * As quotas por pagar até um mês, inclusive — da mais antiga para a mais
   * recente, sem saltos possíveis.
   *
   * É aqui que a regra vive: **as quotas pagam-se por ordem**. Nunca pode haver
   * Março pago com Fevereiro em aberto — um histórico com buracos não se lê, e a
   * conversa "então paguei ou não paguei?" fica sem resposta que sirva a
   * ninguém.
   *
   * Por isso a app não escolhe um conjunto: escolhe **até onde**. Quem carrega
   * em Março leva Janeiro e Fevereiro atrás, e vê-o antes de pagar. O servidor
   * resolve o conjunto para trás sozinho, e um cliente que tentasse enviar uma
   * lista com buracos não teria por onde.
   *
   * Devolve as quotas na ordem em que se pagam. As que faltam nascem aqui — é o
   * mesmo caminho do "pagar adiantado" de sempre.
   */
  private async quotasAte(
    db: ScopedClient,
    academyId: string,
    memberId: string,
    ate: string,
  ): Promise<{ id: string; period: string; amountCents: number }[]> {
    /*
     * O que já está lançado e por pagar, até ao mês escolhido — **de todos os
     * períodos**, incluindo os que a direcção lançou antes desta época. Uma
     * dívida antiga não se salta por ela não caber na janela que a app oferece.
     */
    const abertas = await db.memberFee.findMany({
      where: { memberId, status: "OPEN", period: { lte: ate } },
      orderBy: { period: "asc" },
      select: { id: true, period: true, amountCents: true },
    });

    /*
     * E os meses da época que ainda não têm quota nenhuma, até ao escolhido.
     * `garantirDoSocio` cria-os ao preço da categoria — e rebenta com uma
     * explicação se a categoria não tiver preço, que é o que se quer: melhor
     * não pagar nada do que pagar um valor inventado.
     */
    const jaTem = new Set(abertas.map((f) => f.period));
    const doPeriodo = await db.memberFee.findMany({
      where: { memberId, period: { lte: ate } },
      select: { period: true },
    });
    for (const f of doPeriodo) jaTem.add(f.period);

    const novas: { id: string; period: string; amountCents: number }[] = [];
    for (const period of mesesAteFimDaEpoca()) {
      if (period > ate) break;
      if (jaTem.has(period)) continue;
      const id = await this.quotas.garantirDoSocio(db, academyId, memberId, period);
      const criada = await db.memberFee.findFirst({
        where: { id },
        select: { id: true, period: true, amountCents: true },
      });
      if (criada) novas.push(criada);
    }

    return [...abertas, ...novas].sort((a, b) => a.period.localeCompare(b.period));
  }

  /**
   * Pagar uma quota — MB Way ou Multibanco.
   *
   * A quota tem de ser **do próprio**: é a única autorização que existe deste
   * lado, e chega — ninguém paga a quota de outro por engano, e pagar a de outro
   * de propósito não é um caso que o produto queira facilitar.
   *
   * E tem de ser **a mais antiga por pagar**. Pagar Março com Fevereiro em
   * aberto deixava o histórico com um buraco; quem quer pôr-se em dia usa o
   * `pagarAte`, que leva os meses anteriores atrás e diz o total antes de
   * cobrar.
   */
  async pagarQuota(
    authorization: string | undefined,
    slug: string,
    feeId: string,
    method: string,
    payerPhone?: string,
  ) {
    const eu = await this.identidade(authorization);
    const academyId = await this.academiaDe(slug);

    if (method !== "MBWAY" && method !== "MULTIBANCO") {
      throw new BadRequestException("Método de pagamento desconhecido");
    }

    const socio = await this.prisma.runAs(academyId, async (db) => {
      const socio = await this.socioDe(db, eu.userId, academyId);

      const esta = await db.memberFee.findFirst({
        where: { id: feeId, memberId: socio.id },
        select: { period: true },
      });
      if (!esta) throw new NotFoundException("Quota não encontrada");

      // Há alguma mais antiga por pagar? Então é essa que se paga primeiro.
      const anterior = await db.memberFee.findFirst({
        where: { memberId: socio.id, status: "OPEN", period: { lt: esta.period } },
        orderBy: { period: "asc" },
        select: { period: true },
      });
      if (anterior) {
        throw new BadRequestException(
          `As quotas pagam-se por ordem: falta ${anterior.period}. Paga a partir dessa — podes levar as seguintes na mesma referência.`,
        );
      }

      return socio;
    });

    return this.billing.startMemberFeePayment(
      academyId,
      socio.id,
      feeId,
      method as PaymentMethod,
      payerPhone,
    );
  }

  /**
   * Pagar tudo o que falta **até** um mês, numa referência só.
   *
   * O gesto que isto serve: o sócio abre a app, vê três meses em atraso, e quer
   * ficar em dia. Com uma quota por pagamento eram três pedidos MB Way — e quem
   * tem três por pagar não faz três pagamentos: adia. Aqui é um.
   *
   * Ver `quotasAte` para a regra da ordem, que é o que dá sentido a tudo isto.
   */
  async pagarAte(
    authorization: string | undefined,
    slug: string,
    ate: string,
    method: string,
    payerPhone?: string,
  ) {
    const eu = await this.identidade(authorization);
    const academyId = await this.academiaDe(slug);

    if (method !== "MBWAY" && method !== "MULTIBANCO") {
      throw new BadRequestException("Método de pagamento desconhecido");
    }
    if (!mesesAteFimDaEpoca().includes(ate)) {
      throw new BadRequestException("Só podes pagar do mês corrente até ao fim da época");
    }

    const { socioId, feeIds } = await this.prisma.runAs(academyId, async (db) => {
      const socio = await this.socioDe(db, eu.userId, academyId);
      if (socio.status !== "ACTIVE") throw new ForbiddenException("Só um sócio activo paga quotas");

      const quotas = await this.quotasAte(db, academyId, socio.id, ate);
      if (quotas.length === 0) throw new BadRequestException("Já não há nada por pagar até esse mês");

      return { socioId: socio.id, feeIds: quotas.map((q) => q.id) };
    });

    return this.billing.startMemberFeePayment(academyId, socioId, feeIds, method as PaymentMethod, payerPhone);
  }

  /**
   * Pagar um **mês** — a quota nasce se ainda ninguém a lançou.
   *
   * É o caminho de "pagar até Julho": o sócio escolhe Outubro em Setembro, a
   * direcção ainda não gerou Outubro, e o dinheiro não deve esperar por isso.
   * Só se oferece do mês corrente até ao fim da época — pagar Março de 2024
   * a partir da app era criar história à mão, e isso é trabalho da consola.
   */
  async pagarMes(
    authorization: string | undefined,
    slug: string,
    period: string,
    method: string,
    payerPhone?: string,
  ) {
    const eu = await this.identidade(authorization);
    const academyId = await this.academiaDe(slug);

    if (method !== "MBWAY" && method !== "MULTIBANCO") {
      throw new BadRequestException("Método de pagamento desconhecido");
    }
    if (!mesesAteFimDaEpoca().includes(period)) {
      throw new BadRequestException("Só podes pagar do mês corrente até ao fim da época");
    }

    const { socioId, feeId } = await this.prisma.runAs(academyId, async (db) => {
      const socio = await this.socioDe(db, eu.userId, academyId);
      if (socio.status !== "ACTIVE") throw new ForbiddenException("Só um sócio activo paga quotas");

      /*
       * A mesma regra de ordem do `pagarQuota`, e aqui era ainda mais fácil de
       * furar: este caminho **cria** a quota do mês pedido. Sem esta verificação,
       * pedir Março com Fevereiro em aberto criava Março, pagava-o, e deixava o
       * histórico com um buraco — exactamente o que não pode acontecer.
       */
      const anterior = await db.memberFee.findFirst({
        where: { memberId: socio.id, status: "OPEN", period: { lt: period } },
        orderBy: { period: "asc" },
        select: { period: true },
      });
      if (anterior) {
        throw new BadRequestException(
          `As quotas pagam-se por ordem: falta ${anterior.period}. Usa "pagar até ${period}" para levar os meses anteriores na mesma referência.`,
        );
      }

      const feeId = await this.quotas.garantirDoSocio(db, academyId, socio.id, period);
      return { socioId: socio.id, feeId };
    });

    return this.billing.startMemberFeePayment(academyId, socioId, feeId, method as PaymentMethod, payerPhone);
  }

  /* ------------------------------------------------------------------------ */
  /* O convite — de ficha de sócio a conta                                     */
  /* ------------------------------------------------------------------------ */

  /**
   * De que clube — e de quem — é este convite. É o primeiro pedido da app.
   *
   * Devolve o nome próprio e o clube: o suficiente para o ecrã dizer "Olá Rui,
   * o CD Loureiro convidou-te" sem revelar a ficha a quem sonde tokens à sorte
   * (o token tem 32 bytes — sondá-lo não é um plano, mas a resposta magra não
   * custa nada).
   */
  async convitePreview(token: string) {
    const alvo = await this.resolverConvite(token);

    return this.prisma.runAs(alvo.academyId, async (db) => {
      const [member, academy] = await Promise.all([
        db.member.findFirst({ where: { id: alvo.memberId }, select: { name: true, email: true, userId: true } }),
        db.academy.findFirst({
          where: { id: alvo.academyId },
          select: { slug: true, name: true, shortName: true, signalColor: true, logoUrl: true },
        }),
      ]);
      if (!member || !academy) throw new NotFoundException("Convite inválido ou expirado");

      return {
        academy,
        firstName: member.name.trim().split(/\s+/)[0] ?? "",
        /* O email fica meio tapado: quem tem o link já o recebeu lá, mas uma
           captura de ecrã não tem de o mostrar inteiro. */
        emailHint: mascarar(member.email ?? ""),
        alreadyLinked: Boolean(member.userId),
      };
    });
  }

  /**
   * Criar a conta (ou entrar na que já existe) e reclamar a ficha.
   *
   * O email é o **da ficha** — nunca o que o cliente mandar. É o clube que sabe
   * quem convidou; deixar o convidado escolher o email era deixar qualquer
   * portador do link ligar a ficha a uma conta qualquer.
   */
  async conviteRegistar(
    token: string,
    password: string,
    acceptLegal?: boolean,
    meta: { ip?: string; userAgent?: string } = {},
  ) {
    if (!password || password.length < 8) {
      throw new BadRequestException("A palavra-passe tem de ter pelo menos 8 caracteres");
    }

    const alvo = await this.resolverConvite(token);

    const dados = await this.prisma.runAs(alvo.academyId, async (db) => {
      const member = await db.member.findFirst({
        where: { id: alvo.memberId },
        select: { id: true, name: true, email: true, userId: true },
      });
      const academy = await db.academy.findFirst({ where: { id: alvo.academyId }, select: { slug: true, name: true } });
      if (!member || !academy) throw new NotFoundException("Convite inválido ou expirado");
      if (!member.email) throw new BadRequestException("Esta ficha não tem email — fala com o clube");
      return { member: { ...member, email: member.email }, academy };
    });

    // Os termos antes da conta — a conta no Supabase não entra em rollback nenhum.
    const docs = await this.legal.assertSignupConsent(["MEMBER"], { acceptLegal }, alvo.academyId);

    const email = dados.member.email.trim().toLowerCase();
    const account = await this.accounts.createOrSignIn(email, password, dados.member.name);

    await this.prisma.runAs(alvo.academyId, async (db) => {
      /* A mesma escotilha do registo das famílias — ver a nota lá. */
      const userId = `usr_${randomBytes(12).toString("hex")}`;
      const created = await db.$queryRaw<{ id: string }[]>`
        SELECT app.upsert_invited_user(
          ${userId}, ${account.authId}, ${email}, ${dados.member.name}, ${null}
        ) AS id
      `;

      await db.member.update({
        where: { id: dados.member.id },
        data: {
          userId: created[0].id,
          /* O convite morre ao ser usado — um link reencaminhado depois disto
             não reclama nada. */
          inviteTokenHash: null,
        },
      });

      // As aceitações da criação de conta — contexto SIGNUP, na mesma transação.
      await this.legal.acceptAtSignup(
        db, { userId: created[0].id, academyId: alvo.academyId, membershipId: null, audiences: ["MEMBER"] }, docs, meta,
      );
    });

    const session = account.accessToken ? account : await this.accounts.signIn(email, password);

    return {
      slug: dados.academy.slug,
      academyName: dados.academy.name,
      accessToken: session.accessToken,
      refreshToken: session.refreshToken ?? null,
    };
  }

  /** Do token para (sócio, academia) — pela escotilha, porque ainda não há sessão. */
  private async resolverConvite(token: string): Promise<{ memberId: string; academyId: string }> {
    if (!token || token.length < 16) throw new NotFoundException("Convite inválido ou expirado");
    const hash = createHash("sha256").update(token).digest("hex");
    const rows = await this.prisma.$queryRaw<{ member_id: string; academy_id: string }[]>`
      SELECT * FROM app.resolve_member_invite(${hash})
    `;
    if (!rows[0]) throw new NotFoundException("Convite inválido ou expirado");
    return { memberId: rows[0].member_id, academyId: rows[0].academy_id };
  }
}

/** `rui.alves@mail.pt` → `r••@mail.pt` — reconhecível para o dono, mudo para os outros. */
function mascarar(email: string): string {
  const [antes, dominio] = email.split("@");
  if (!antes || !dominio) return "";
  return `${antes[0]}••@${dominio}`;
}

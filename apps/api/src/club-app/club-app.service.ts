import { createHash, randomBytes } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
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
    private readonly config: ConfigService,
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

  /** A ficha de sócio reclamada por esta conta neste clube — ou 404. */
  private async socioDe(db: ScopedClient, userId: string | null) {
    if (!userId) throw new NotFoundException("Esta conta não é de sócio neste clube");
    const member = await db.member.findFirst({ where: { userId } });
    if (!member) throw new NotFoundException("Esta conta não é de sócio neste clube");
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
    const familia = daAcademia.some((m) => m.role === "GUARDIAN" || m.role === "ATHLETE");

    return this.prisma.runAs(academyId, async (db) => {
      const member = eu.userId ? await db.member.findFirst({ where: { userId: eu.userId } }) : null;

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
      const socio = await this.socioDe(db, eu.userId);

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
        socio.tierId ? db.memberTier.findFirst({ where: { id: socio.tierId }, select: { name: true } }) : null,
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

      return {
        academy: {
          name: academia?.name ?? "",
          shortName: academia?.shortName ?? "",
          slug: academia?.slug ?? slug,
          logoUrl: academia?.logoUrl ?? null,
          signalColor: academia?.signalColor ?? "#0f6b62",
          cardEnabled: academia?.memberCardEnabled ?? true,
          cardQrEnabled: academia?.memberCardQrEnabled ?? true,
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
      const socio = await this.socioDe(db, eu.userId);
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
   * Pagar uma quota — MB Way ou Multibanco.
   *
   * A quota tem de ser **do próprio**: é a única autorização que existe deste
   * lado, e chega — ninguém paga a quota de outro por engano, e pagar a de outro
   * de propósito não é um caso que o produto queira facilitar.
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

    const socio = await this.prisma.runAs(academyId, (db) => this.socioDe(db, eu.userId));

    return this.billing.startMemberFeePayment(
      academyId,
      socio.id,
      feeId,
      method as PaymentMethod,
      payerPhone,
    );
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
  async conviteRegistar(token: string, password: string) {
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

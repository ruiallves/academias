import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { NotificationType, type Prisma } from "@prisma/client";
import { PrismaService, type ScopedClient } from "../prisma/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import { can, teamScopeFilter, type RequestContext } from "../common/permissions";

type AudienceKind = "all" | "guardians" | "coaches" | "members";

/** O rótulo que a consola mostra — a direção lê "Pais", não `{ kind: "guardians" }`. */
const AUDIENCE_LABEL: Record<AudienceKind, string> = {
  all: "Geral",
  guardians: "Pais",
  coaches: "Treinadores",
  members: "Sócios",
};

/**
 * Comunicações às famílias e ao staff.
 *
 * ## Quem manda para quem
 *
 * A direção escolhe o público: **Geral** (toda a gente), **Pais** (encarregados) ou
 * **Treinadores**. O treinador só pode falar com os **pais das suas equipas** — e
 * isso não é uma opção que a interface esconde e o servidor confia: é o servidor que
 * recusa qualquer outra coisa, e que deriva as equipas do âmbito, não do que o
 * cliente disser.
 *
 * "Pais" aceita ainda um **recorte por escalão** (`teamIds`): o mesmo público,
 * estreitado às equipas escolhidas. É o que separa "a época começa dia 1" de "o
 * Sub-19 muda o treino de sábado" — ver `create`.
 *
 * ## Uma comunicação é um aviso a cada pessoa
 *
 * Publicar cria a `Announcement` (o registo do que se disse) e uma `Notification`
 * por destinatário (o que cada um recebe na app). A taxa de leitura é contada a
 * partir dessas notificações — `reach` é quantas saíram, `read` quantas foram
 * abertas. As notificações vão **depois** de a `Announcement` estar gravada: um
 * empurrão que falha não pode perder o registo do que foi comunicado.
 */
@Injectable()
export class AnnouncementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /** As comunicações publicadas, com a taxa de leitura. */
  async list(ctx: RequestContext) {
    if (!can(ctx, "comms:read")) throw new ForbiddenException("Sem acesso a comunicações");

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const rows = await db.announcement.findMany({
        where: { publishedAt: { not: null } },
        orderBy: { publishedAt: "desc" },
        take: 50,
        select: {
          id: true,
          title: true,
          body: true,
          audience: true,
          publishedAt: true,
          authorId: true,
          author: { select: { user: { select: { name: true } } } },
        },
      });

      /*
       * Uma família só vê o que lhe foi dirigido.
       *
       * O ecrã da direção mostra tudo o que a academia comunicou — é o registo
       * dela. Mas a app do pai lê o mesmo endpoint, e um aviso para a equipa
       * técnica ("reunião de treinadores na quinta") não é assunto dele. Filtra-se
       * pela audiência gravada, e não pela permissão: `comms:read` diz que pode
       * ler comunicações, não que pode ler todas.
       *
       * Um aviso de treinador para as suas equipas traz `teamIds`; nesse caso só
       * chega a quem tem um filho numa delas.
       */
      const isFamily = ctx.role === "GUARDIAN" || ctx.role === "ATHLETE";
      const myTeams = new Set(ctx.scope.teamIds ?? []);
      const visible = isFamily
        ? rows.filter((a) => {
            const aud = a.audience as { kind?: string; teamIds?: string[] } | null;
            if (aud?.kind === "coaches") return false;
            if (aud?.teamIds?.length) return aud.teamIds.some((t) => myTeams.has(t));
            return true;
          })
        : rows;

      // Os nomes dos escalões a que os avisos foram dirigidos, numa ida só — o
      // rótulo diz "Pais · Sub-19 Futebol" e não "Pais". Ver `audienceLabelOf`.
      const dirigidos = unique(
        visible.flatMap((a) => (a.audience as { teamIds?: string[] } | null)?.teamIds ?? []),
      );
      const teamNames = new Map(
        dirigidos.length === 0
          ? []
          : (await db.team.findMany({ where: { id: { in: dirigidos } }, select: { id: true, name: true } })).map(
              (t) => [t.id, t.name] as const,
            ),
      );

      // A taxa de leitura vem das notificações desta comunicação. Poucas por
      // academia, por isso duas contagens por linha é barato e legível.
      const out = [];
      for (const a of visible) {
        const where: Prisma.NotificationWhereInput = { payload: { path: ["announcementId"], equals: a.id } };
        const reach = await db.notification.count({ where });
        const read = await db.notification.count({ where: { ...where, readAt: { not: null } } });
        out.push({
          id: a.id,
          title: a.title,
          body: a.body,
          audience: audienceLabelOf(a.audience, teamNames),
          authorId: a.authorId,
          authorName: a.author.user.name,
          publishedAt: a.publishedAt,
          reach,
          read,
        });
      }
      return out;
    });
  }

  /**
   * Publica uma comunicação e notifica os destinatários.
   *
   * ## O escalão estreita o público, não o substitui
   *
   * "Pais" continua a ser o público. `teamIds` é o **recorte**: sem ele o aviso vai
   * a todos os pais de quem envia (a academia inteira para a direção, as equipas
   * do treinador para o treinador); com ele vai só aos pais desses escalões.
   *
   * É a diferença entre "a época começa a 1 de Setembro" e "o Sub-19 muda o treino
   * de sábado". Sem o recorte, a segunda mensagem chegava a trezentas famílias a
   * quem não dizia respeito — e é assim que se ensina uma família a ignorar os
   * avisos da academia.
   *
   * O recorte fica **gravado** na audiência, e não só usado para escolher a quem
   * enviar: é o que faz o registo dizer a quem foi, e é o que a app da família lê
   * para não mostrar a um pai do Sub-11 o aviso do Sub-19 (ver `list`).
   */
  async create(
    ctx: RequestContext,
    dto: { title: string; body: string; audience: AudienceKind; teamIds?: string[] },
  ) {
    if (!can(ctx, "comms:write")) throw new ForbiddenException("Sem permissão para comunicar");

    const scope = teamScopeFilter(ctx);
    // O treinador (com âmbito) só fala com os pais das suas equipas. Qualquer outro
    // público é recusado aqui, não escondido na UI.
    if (scope && dto.audience !== "guardians") {
      throw new ForbiddenException("Só podes comunicar com os pais das tuas equipas");
    }

    const escolhidos = unique(dto.teamIds ?? []);
    if (escolhidos.length > 0 && dto.audience !== "guardians") {
      throw new BadRequestException("Só se escolhe escalão quando o aviso é para os pais");
    }
    // Um treinador não estreita para fora do que já é o âmbito dele. A UI só lhe
    // mostra as equipas dele; isto é o que recusa um pedido feito por fora.
    if (scope && escolhidos.some((id) => !scope.in.includes(id))) {
      throw new ForbiddenException("Escalão fora do teu âmbito");
    }

    const title = dto.title.trim();
    const body = dto.body.trim();

    const { announcement, userIds, label } = await this.prisma.runAs(ctx.academyId, async (db) => {
      if (escolhidos.length > 0) {
        const existem = await db.team.count({ where: { id: { in: escolhidos } } });
        if (existem !== escolhidos.length) throw new BadRequestException("Escalão desconhecido");
      }

      /*
       * As equipas a que este aviso fica preso.
       *
       * O que foi escolhido, se foi escolhido alguma coisa; senão o âmbito de quem
       * envia — que é `undefined` para a direção, e aí não há recorte nenhum.
       */
      const teamIds = escolhidos.length > 0 ? escolhidos : scope?.in;
      const userIds = await this.recipientUserIds(db, dto.audience, teamIds);
      const audience = teamIds ? { kind: dto.audience, teamIds } : { kind: dto.audience };

      // Os nomes, para o rótulo devolvido dizer o mesmo que a lista dirá a seguir.
      const teamNames = new Map(
        (teamIds?.length ?? 0) === 0
          ? []
          : (await db.team.findMany({ where: { id: { in: teamIds } }, select: { id: true, name: true } })).map(
              (t) => [t.id, t.name] as const,
            ),
      );

      const announcement = await db.announcement.create({
        data: {
          academyId: ctx.academyId,
          authorId: ctx.membershipId,
          title,
          body,
          audience,
          publishedAt: new Date(),
        },
        select: { id: true, publishedAt: true },
      });
      return { announcement, userIds, label: audienceLabelOf(audience, teamNames) };
    });

    // Ninguém se notifica a si próprio. As notificações vão fora da transação: cada
    // `enqueue` abre a sua, curta — e uma que falhe não desfaz o que já foi dito.
    const recipients = userIds.filter((u) => u !== ctx.userId);
    for (const userId of recipients) {
      await this.notifications.enqueue({
        academyId: ctx.academyId,
        userId,
        type: NotificationType.ANNOUNCEMENT_PUBLISHED,
        title,
        body,
        payload: { announcementId: announcement.id, route: "/avisos" },
      });
    }

    return {
      id: announcement.id,
      title,
      body,
      audience: label,
      authorId: ctx.membershipId,
      authorName: undefined as string | undefined,
      publishedAt: announcement.publishedAt,
      reach: recipients.length,
      read: 0,
    };
  }

  /**
   * Edita o texto de um aviso — e alinha as notificações que já saíram.
   *
   * A notificação **na app** (a linha na base) muda com o aviso: um pai que abra a
   * app vê o texto corrigido, não o antigo. O empurrão que já chegou ao telemóvel
   * não se altera — esse já saiu, e não há como o recolher —, mas essa é a única
   * cópia que fica desactualizada, e é a menos consultada.
   */
  async update(ctx: RequestContext, id: string, dto: { title: string; body: string }) {
    if (!can(ctx, "comms:write")) throw new ForbiddenException("Sem permissão para editar avisos");

    const title = dto.title.trim();
    const body = dto.body.trim();

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const existing = await db.announcement.findFirst({ where: { id }, select: { id: true, authorId: true } });
      if (!existing) throw new NotFoundException("Aviso não encontrado");
      this.assertMayManage(ctx, existing.authorId);

      await db.announcement.update({ where: { id }, data: { title, body } });
      // As notificações na app deste aviso passam a mostrar o texto corrigido.
      await db.notification.updateMany({
        where: { payload: { path: ["announcementId"], equals: id } },
        data: { title, body },
      });
      return { id, title, body };
    });
  }

  /**
   * Elimina um aviso — e as notificações na app que dele nasceram.
   *
   * Apaga a comunicação e faz desaparecer a notificação na app de quem a recebeu. O
   * empurrão no telemóvel, esse, já saiu; nada o traz de volta.
   */
  async remove(ctx: RequestContext, id: string) {
    if (!can(ctx, "comms:write")) throw new ForbiddenException("Sem permissão para eliminar avisos");

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const existing = await db.announcement.findFirst({ where: { id }, select: { id: true, authorId: true } });
      if (!existing) throw new NotFoundException("Aviso não encontrado");
      this.assertMayManage(ctx, existing.authorId);

      await db.notification.deleteMany({ where: { payload: { path: ["announcementId"], equals: id } } });
      await db.announcement.delete({ where: { id } });
      return { id, deleted: true };
    });
  }

  /* ------------------------------------------------------------------------ */

  /**
   * Quem pode mexer num aviso: o próprio autor, ou a direção (sem âmbito de equipa).
   *
   * Um treinador corrige o que ele próprio enviou; não mexe no que outro escreveu. A
   * direção, que fala pela academia toda, pode gerir qualquer aviso.
   */
  private assertMayManage(ctx: RequestContext, authorId: string): void {
    const isAuthor = authorId === ctx.membershipId;
    const isAdmin = teamScopeFilter(ctx) === undefined;
    if (!isAuthor && !isAdmin) throw new ForbiddenException("Só o autor ou a direção podem gerir este aviso");
  }

  /**
   * Os utilizadores que recebem esta comunicação.
   *
   * `teamIds` é o recorte já resolvido por `create`: as equipas escolhidas, ou as
   * de quem envia, ou nada — e nada significa a academia toda.
   */
  private async recipientUserIds(
    db: ScopedClient,
    kind: AudienceKind,
    teamIds: string[] | undefined,
  ): Promise<string[]> {
    if (kind === "guardians") {
      if (teamIds) {
        // Os pais dos atletas destes escalões.
        const memberships = await db.teamMembership.findMany({
          where: { teamId: { in: teamIds } },
          select: { athleteId: true },
        });
        const athleteIds = memberships.map((m) => m.athleteId);
        if (athleteIds.length === 0) return [];
        const links = await db.guardianLink.findMany({
          where: { athleteId: { in: athleteIds }, membership: { isActive: true } },
          select: { membership: { select: { userId: true } } },
        });
        return unique(links.map((l) => l.membership.userId));
      }
      // Direção: todos os encarregados.
      const guardians = await db.membership.findMany({
        where: { role: "GUARDIAN", isActive: true },
        select: { userId: true },
      });
      return unique(guardians.map((m) => m.userId));
    }

    /*
     * Sócios: só os que reclamaram a ficha recebem push — os outros não têm
     * conta para onde o mandar. O aviso em si fica visível a todos os sócios
     * na app, quando entrarem.
     */
    if (kind === "members") {
      const socios = await db.member.findMany({
        where: { userId: { not: null }, status: "ACTIVE" },
        select: { userId: true },
      });
      return unique(socios.map((m) => m.userId).filter((u): u is string => Boolean(u)));
    }

    if (kind === "coaches") {
      const coaches = await db.membership.findMany({
        where: { role: { in: ["COACH", "COORDINATOR"] }, isActive: true },
        select: { userId: true },
      });
      return unique(coaches.map((m) => m.userId));
    }

    // "Geral" — toda a gente com ligação viva à academia.
    const all = await db.membership.findMany({ where: { isActive: true }, select: { userId: true } });
    return unique(all.map((m) => m.userId));
  }
}

function unique(ids: string[]): string[] {
  return [...new Set(ids)];
}

/**
 * Lê o rótulo a partir da audiência gravada, com recurso seguro.
 *
 * Com escalões, o rótulo di-lo: "Pais · Sub-19 Futebol". É o registo a responder
 * à pergunta que se faz três meses depois — *isto foi para quem?* — sem obrigar
 * ninguém a abrir a linha da base de dados.
 *
 * A partir de três escalões conta-se em vez de listar: um rótulo com seis nomes
 * não cabe em lado nenhum e deixa de se ler. Uma equipa entretanto apagada não
 * inventa nome — o rótulo encolhe para "Pais", que continua a ser verdade.
 */
function audienceLabelOf(audience: unknown, teamNames?: Map<string, string>): string {
  const aud = audience as { kind?: string; teamIds?: string[] } | null;
  const kind = aud?.kind;
  const base = kind === "all" || kind === "guardians" || kind === "coaches" ? AUDIENCE_LABEL[kind] : "Geral";
  if (base !== AUDIENCE_LABEL.guardians) return base;

  const nomes = (aud?.teamIds ?? []).map((id) => teamNames?.get(id)).filter((n): n is string => Boolean(n));
  if (nomes.length === 0) return base;
  if (nomes.length <= 2) return `${base} · ${nomes.join(", ")}`;
  return `${base} · ${nomes.length} escalões`;
}

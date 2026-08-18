import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { NotificationType, type Prisma } from "@prisma/client";
import { PrismaService, type ScopedClient } from "../prisma/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import { can, teamScopeFilter, type RequestContext } from "../common/permissions";

type AudienceKind = "all" | "guardians" | "coaches";

/** O rótulo que a consola mostra — a direção lê "Pais", não `{ kind: "guardians" }`. */
const AUDIENCE_LABEL: Record<AudienceKind, string> = {
  all: "Geral",
  guardians: "Pais",
  coaches: "Treinadores",
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

      // A taxa de leitura vem das notificações desta comunicação. Poucas por
      // academia, por isso duas contagens por linha é barato e legível.
      const out = [];
      for (const a of rows) {
        const where: Prisma.NotificationWhereInput = { payload: { path: ["announcementId"], equals: a.id } };
        const reach = await db.notification.count({ where });
        const read = await db.notification.count({ where: { ...where, readAt: { not: null } } });
        out.push({
          id: a.id,
          title: a.title,
          body: a.body,
          audience: audienceLabelOf(a.audience),
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

  /** Publica uma comunicação e notifica os destinatários. */
  async create(ctx: RequestContext, dto: { title: string; body: string; audience: AudienceKind }) {
    if (!can(ctx, "comms:write")) throw new ForbiddenException("Sem permissão para comunicar");

    const scope = teamScopeFilter(ctx);
    // O treinador (com âmbito) só fala com os pais das suas equipas. Qualquer outro
    // público é recusado aqui, não escondido na UI.
    if (scope && dto.audience !== "guardians") {
      throw new ForbiddenException("Só podes comunicar com os pais das tuas equipas");
    }

    const title = dto.title.trim();
    const body = dto.body.trim();

    const { announcement, userIds } = await this.prisma.runAs(ctx.academyId, async (db) => {
      const userIds = await this.recipientUserIds(db, ctx, dto.audience, scope);
      // A audiência gravada guarda as equipas quando é o treinador — para o registo
      // dizer exactamente a quem foi, não só "aos pais".
      const audience =
        scope && dto.audience === "guardians"
          ? { kind: dto.audience, teamIds: scope.in }
          : { kind: dto.audience };

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
      return { announcement, userIds };
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
      audience: AUDIENCE_LABEL[dto.audience],
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

  /** Os utilizadores que recebem esta comunicação, já no âmbito de quem a envia. */
  private async recipientUserIds(
    db: ScopedClient,
    ctx: RequestContext,
    kind: AudienceKind,
    scope: { in: string[] } | undefined,
  ): Promise<string[]> {
    if (kind === "guardians") {
      if (scope) {
        // Treinador: os pais dos atletas das suas equipas.
        const memberships = await db.teamMembership.findMany({
          where: { teamId: { in: scope.in } },
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

/** Lê o rótulo a partir da audiência gravada (`{ kind }`), com recurso seguro. */
function audienceLabelOf(audience: unknown): string {
  const kind = (audience as { kind?: string } | null)?.kind;
  if (kind === "all" || kind === "guardians" || kind === "coaches") return AUDIENCE_LABEL[kind];
  return "Geral";
}

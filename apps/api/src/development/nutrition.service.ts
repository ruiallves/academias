import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService, type ScopedClient } from "../prisma/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import { athleteScopeFilter, athleteTeamScopeWhere, can, type RequestContext } from "../common/permissions";
import { contaDoAtleta } from "../academy/athlete-accounts";
import { isFamily } from "./evaluations.service";

/**
 * Planos de nutrição.
 *
 * ## O desenho, em três frases
 *
 * Quem escreve é o departamento clínico (`clinical:write`) — a nutricionista é
 * `MEDICAL`. Quem lê na consola é quem lê o boletim (`clinical:read`), no
 * âmbito de sempre. Na app lê o atleta e a família, **só o que está publicado
 * e só o que lhes foi aberto**: cada plano diz para quem é, e a decisão é de
 * quem o escreve — o mesmo princípio dos relatórios.
 *
 * Um plano nasce em rascunho e não sai da consola até ser publicado; publicar
 * avisa quem o vai ler. Vários planos por atleta, do mais recente para trás: o
 * de Setembro não apaga o de Março, e a app mostra o último em cima.
 */

export type NutritionPlanInput = {
  athleteId: string;
  title: string;
  body: string;
  familyVisible?: boolean;
  athleteVisible?: boolean;
};

const SELECT = {
  id: true, athleteId: true, title: true, body: true,
  familyVisible: true, athleteVisible: true,
  publishedAt: true, createdAt: true, updatedAt: true,
  author: { select: { id: true, user: { select: { name: true } } } },
  athlete: { select: { name: true } },
} as const;

@Injectable()
export class NutritionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Os planos de um atleta — a consola, no separador clínico da ficha. */
  async listForAthlete(ctx: RequestContext, athleteId: string) {
    if (!can(ctx, "clinical:read")) throw new ForbiddenException("Sem acesso ao boletim clínico");

    return this.prisma.runAs(ctx.academyId, async (db) => {
      await this.athleteInScope(db, ctx, athleteId);
      const rows = await db.nutritionPlan.findMany({
        where: { athleteId, ...this.familyFilter(ctx) },
        orderBy: { createdAt: "desc" },
        select: SELECT,
      });
      return rows.map(saida);
    });
  }

  /**
   * Os planos de quem pergunta — a app.
   *
   * O âmbito faz o resto: um encarregado vê os dos filhos, um atleta os seus.
   * A permissão é a mesma da consola (`clinical:read`, que as famílias têm),
   * e por cima dela o filtro de publicado-e-aberto que vive em `familyFilter`.
   */
  async listMine(ctx: RequestContext) {
    if (!can(ctx, "clinical:read")) throw new ForbiddenException("Sem acesso ao boletim clínico");

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const rows = await db.nutritionPlan.findMany({
        where: { athlete: this.athleteWhere(ctx), ...this.familyFilter(ctx) },
        orderBy: { createdAt: "desc" },
        select: SELECT,
      });
      return rows.map(saida);
    });
  }

  async create(ctx: RequestContext, dto: NutritionPlanInput) {
    if (!can(ctx, "clinical:write")) throw new ForbiddenException("Sem permissão para escrever planos de nutrição");

    const title = dto.title.trim();
    const body = dto.body.trim();
    if (title.length < 2) throw new BadRequestException("Falta o título");
    if (body.length < 5) throw new BadRequestException("O plano está vazio");

    return this.prisma.runAs(ctx.academyId, async (db) => {
      await this.athleteInScope(db, ctx, dto.athleteId);
      const created = await db.nutritionPlan.create({
        data: {
          academyId: ctx.academyId,
          athleteId: dto.athleteId,
          authorId: ctx.membershipId,
          title,
          body,
          familyVisible: dto.familyVisible ?? true,
          athleteVisible: dto.athleteVisible ?? true,
        },
        select: SELECT,
      });
      return saida(created);
    });
  }

  async update(ctx: RequestContext, id: string, dto: Partial<Omit<NutritionPlanInput, "athleteId">>) {
    if (!can(ctx, "clinical:write")) throw new ForbiddenException("Sem permissão");

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const row = await this.planInScope(db, ctx, id);

      const title = dto.title?.trim();
      const body = dto.body?.trim();
      if (title !== undefined && title.length < 2) throw new BadRequestException("Falta o título");
      if (body !== undefined && body.length < 5) throw new BadRequestException("O plano está vazio");

      const updated = await db.nutritionPlan.update({
        where: { id: row.id },
        data: {
          ...(title !== undefined ? { title } : {}),
          ...(body !== undefined ? { body } : {}),
          ...(dto.familyVisible !== undefined ? { familyVisible: dto.familyVisible } : {}),
          ...(dto.athleteVisible !== undefined ? { athleteVisible: dto.athleteVisible } : {}),
        },
        select: SELECT,
      });

      /*
       * Abrir a quem ainda não via um plano já publicado avisa-o agora — o
       * mesmo que partilhar um relatório depois de publicado. Fechar não avisa
       * ninguém: não se manda um email a dizer "já não podes ler".
       */
      if (row.publishedAt) {
        if (dto.familyVisible === true && !row.familyVisible) await this.notifyFamily(db, ctx, updated);
        if (dto.athleteVisible === true && !row.athleteVisible) await this.notifyAthlete(db, ctx, updated);
      }

      return saida(updated);
    });
  }

  /** Publicar — e avisar quem o vai ler. */
  async publish(ctx: RequestContext, id: string) {
    if (!can(ctx, "clinical:write")) throw new ForbiddenException("Sem permissão");

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const row = await this.planInScope(db, ctx, id);
      if (row.publishedAt) throw new BadRequestException("Já está publicado");

      const updated = await db.nutritionPlan.update({
        where: { id },
        data: { publishedAt: new Date() },
        select: SELECT,
      });

      if (updated.familyVisible) await this.notifyFamily(db, ctx, updated);
      if (updated.athleteVisible) await this.notifyAthlete(db, ctx, updated);

      return saida(updated);
    });
  }

  async remove(ctx: RequestContext, id: string) {
    if (!can(ctx, "clinical:write")) throw new ForbiddenException("Sem permissão");

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const row = await this.planInScope(db, ctx, id);
      await db.nutritionPlan.delete({ where: { id: row.id } });
      return { ok: true as const };
    });
  }

  /* ------------------------------------------------------------------------ */

  /**
   * O que a família e o atleta podem ler: publicado, e aberto ao seu chapéu.
   * Quem trabalha no clube não passa por aqui — vê rascunhos e tudo.
   */
  private familyFilter(ctx: RequestContext) {
    if (ctx.role === "ATHLETE") return { publishedAt: { not: null }, athleteVisible: true };
    if (isFamily(ctx)) return { publishedAt: { not: null }, familyVisible: true };
    return {};
  }

  private athleteWhere(ctx: RequestContext) {
    const athleteScope = athleteScopeFilter(ctx);
    return {
      ...(athleteScope ? { id: athleteScope } : {}),
      ...(athleteTeamScopeWhere(ctx) ?? {}),
    };
  }

  private async athleteInScope(db: ScopedClient, ctx: RequestContext, athleteId: string) {
    const athlete = await db.athlete.findFirst({
      where: { id: athleteId, ...this.athleteWhere(ctx) },
      select: { id: true },
    });
    if (!athlete) throw new NotFoundException("Atleta não encontrado ou fora do teu âmbito");
    return athlete;
  }

  private async planInScope(db: ScopedClient, ctx: RequestContext, id: string) {
    const row = await db.nutritionPlan.findFirst({
      where: { id, athlete: this.athleteWhere(ctx) },
      select: { id: true, athleteId: true, publishedAt: true, familyVisible: true, athleteVisible: true },
    });
    if (!row) throw new NotFoundException("Plano não encontrado");
    return row;
  }

  private async notifyFamily(db: ScopedClient, ctx: RequestContext, plan: Linha) {
    const guardians = await db.guardianLink.findMany({
      where: { athleteId: plan.athleteId, membership: { isActive: true } },
      select: { membership: { select: { userId: true } } },
    });
    for (const g of guardians) {
      await this.notifications.enqueue(
        {
          academyId: ctx.academyId,
          userId: g.membership.userId,
          type: "NUTRITION_PLAN_SHARED",
          title: "Plano de nutrição",
          body: `${plan.title} — para ${plan.athlete.name.trim().split(/\s+/)[0]}.`,
          payload: { nutritionPlanId: plan.id, athleteId: plan.athleteId, route: "/atleta" },
        },
        db,
      );
    }
  }

  private async notifyAthlete(db: ScopedClient, ctx: RequestContext, plan: Linha) {
    const userId = await contaDoAtleta(db, plan.athleteId);
    if (!userId) return;
    await this.notifications.enqueue(
      {
        academyId: ctx.academyId,
        userId,
        type: "NUTRITION_PLAN_SHARED",
        title: "O teu plano de nutrição",
        body: `${plan.title} — já está na app.`,
        payload: { nutritionPlanId: plan.id, athleteId: plan.athleteId, route: "/atleta" },
      },
      db,
    );
  }
}

type Linha = {
  id: string;
  athleteId: string;
  title: string;
  body: string;
  familyVisible: boolean;
  athleteVisible: boolean;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  author: { id: string; user: { name: string } };
  athlete: { name: string };
};

function saida(r: Linha) {
  return {
    id: r.id,
    athleteId: r.athleteId,
    athleteName: r.athlete.name,
    title: r.title,
    body: r.body,
    familyVisible: r.familyVisible,
    athleteVisible: r.athleteVisible,
    status: r.publishedAt ? ("PUBLISHED" as const) : ("DRAFT" as const),
    authorId: r.author.id,
    authorName: r.author.user.name,
    publishedAt: r.publishedAt,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

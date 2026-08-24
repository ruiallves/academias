import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { ReportVisibility } from "@prisma/client";
import { PrismaService, type ScopedClient } from "../prisma/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import { athleteScopeFilter, can, teamScopeFilter, type RequestContext } from "../common/permissions";
import { firstName, isFamily } from "./evaluations.service";

/**
 * Relatórios de atleta.
 *
 * ## A decisão que este ficheiro guarda
 *
 * Que **nem tudo o que se escreve sobre um miúdo é para os pais lerem**. O parecer
 * para a direção, a nota de que talvez suba de escalão, a observação sobre o
 * comportamento no balneário — isso é trabalho interno, e um clube que não tenha
 * onde o escrever escreve-o num WhatsApp, que é o pior sítio possível.
 *
 * Daí `visibility`, e daí nascer em `INTERNAL`. Dos dois enganos possíveis, um é
 * barato e o outro não tem volta: um relatório interno que a família não chegou a
 * ver corrige-se com um clique; um parecer interno que apareceu no telemóvel do pai
 * já foi lido.
 *
 * ## Duas fronteiras que não se confundem
 *
 * `status` diz se está **escrito** (rascunho ≠ publicado); `visibility` diz **para
 * quem**. Um relatório interno também se publica — publicar é o momento em que
 * deixa de ser um rascunho e passa a fazer parte do registo do atleta, e a partir
 * daí o resto da academia lê-o. O que a família vê é a intersecção: publicado **e**
 * de família.
 *
 * ## Porque é que a fotografia dos números fica gravada
 *
 * Um relatório é um documento. Quem o abre em Junho tem de ler o que lá estava em
 * Janeiro — se a assiduidade fosse lida ao vivo, o texto do treinador ("tem
 * faltado") acabava ao lado de 96% e o documento passava a mentir sozinho, sem
 * ninguém lhe tocar.
 */

export type ReportInput = {
  athleteId: string;
  title: string;
  period?: string | null;
  body: string;
  visibility?: ReportVisibility;
};

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /* ------------------------------------------------------------------------ */
  /* Leitura                                                                   */
  /* ------------------------------------------------------------------------ */

  /**
   * Os relatórios que esta pessoa pode ver.
   *
   * Para a família, dois filtros ao mesmo tempo e nenhum deles opcional: **publicado
   * e de família**. Estão aqui, no servidor, e não numa condição da interface — a
   * app do pai podia ser velha, podia ter um bug, podia ser um pedido feito à mão.
   */
  async list(ctx: RequestContext, athleteId?: string) {
    if (!can(ctx, "report:read")) throw new ForbiddenException("Sem acesso a relatórios");

    const family = isFamily(ctx);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const rows = await db.athleteReport.findMany({
        where: {
          ...(athleteId ? { athleteId } : {}),
          ...(family ? { status: "PUBLISHED" as const, visibility: "FAMILY" as const } : {}),
          athlete: this.athleteWhere(ctx),
        },
        orderBy: [{ createdAt: "desc" }],
        select: {
          id: true, athleteId: true, title: true, period: true, body: true,
          visibility: true, status: true, snapshot: true,
          publishedAt: true, createdAt: true, updatedAt: true,
          author: { select: { id: true, user: { select: { name: true } } } },
          athlete: { select: { name: true, teams: { select: { teamId: true }, take: 1 } } },
        },
      });

      return rows.map((r) => ({
        id: r.id,
        athleteId: r.athleteId,
        athleteName: r.athlete.name,
        teamId: r.athlete.teams[0]?.teamId ?? null,
        title: r.title,
        period: r.period,
        body: r.body,
        visibility: r.visibility,
        status: r.status,
        snapshot: r.snapshot,
        authorId: r.author.id,
        authorName: r.author.user.name,
        publishedAt: r.publishedAt,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      }));
    });
  }

  /* ------------------------------------------------------------------------ */
  /* Escrita                                                                   */
  /* ------------------------------------------------------------------------ */

  async create(ctx: RequestContext, dto: ReportInput) {
    if (!can(ctx, "report:write")) throw new ForbiddenException("Sem permissão para escrever relatórios");

    const title = dto.title.trim();
    const body = dto.body.trim();
    if (title.length < 3) throw new BadRequestException("Falta o título");
    if (body.length < 10) throw new BadRequestException("O relatório está vazio");

    return this.prisma.runAs(ctx.academyId, async (db) => {
      await this.athleteInScope(db, ctx, dto.athleteId);

      const created = await db.athleteReport.create({
        data: {
          academyId: ctx.academyId,
          athleteId: dto.athleteId,
          authorId: ctx.membershipId,
          title,
          body,
          period: dto.period?.trim() || null,
          visibility: dto.visibility ?? "INTERNAL",
        },
        select: { id: true },
      });

      return created;
    });
  }

  /**
   * Alterar.
   *
   * Inclui trocar a visibilidade — e isso vale nos dois sentidos, com uma diferença
   * que importa: tornar interno um relatório que a família já leu **não desfaz a
   * leitura**. Tira-o da app dali para a frente, e é tudo o que pode prometer. Por
   * isso a consola diz isso mesmo em vez de deixar acreditar que apaga o passado.
   */
  async update(ctx: RequestContext, id: string, dto: Partial<ReportInput>) {
    if (!can(ctx, "report:write")) throw new ForbiddenException("Sem permissão");

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const row = await this.reportInScope(db, ctx, id);

      const title = dto.title?.trim();
      const body = dto.body?.trim();
      if (title !== undefined && title.length < 3) throw new BadRequestException("Falta o título");
      if (body !== undefined && body.length < 10) throw new BadRequestException("O relatório está vazio");

      await db.athleteReport.update({
        where: { id: row.id },
        data: {
          ...(title !== undefined ? { title } : {}),
          ...(body !== undefined ? { body } : {}),
          ...(dto.period !== undefined ? { period: dto.period?.trim() || null } : {}),
          ...(dto.visibility !== undefined ? { visibility: dto.visibility } : {}),
        },
      });

      /*
       * Passar a de família **depois** de publicado é uma partilha, e notifica.
       *
       * É o caminho normal de quem escreve primeiro e decide depois: fica pronto,
       * publica-se para o registo interno, e mais tarde a direção decide que vale a
       * pena a família ler. Sem isto, esse relatório aparecia na app sem ninguém
       * avisar — e um documento que ninguém sabe que chegou é um documento que
       * ninguém lê.
       */
      if (dto.visibility === "FAMILY" && row.visibility === "INTERNAL" && row.status === "PUBLISHED") {
        await this.notifyFamily(db, ctx, row.athleteId, id, row.title);
      }

      return { ok: true };
    });
  }

  /**
   * Publicar.
   *
   * Congela os números do dia e, se for de família, avisa. O `snapshot` é o que faz
   * do relatório um documento em vez de uma vista sobre dados que continuam a mexer.
   */
  async publish(ctx: RequestContext, id: string) {
    if (!can(ctx, "report:write")) throw new ForbiddenException("Sem permissão");

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const row = await this.reportInScope(db, ctx, id);
      if (row.status === "PUBLISHED") throw new BadRequestException("Já está publicado");

      const snapshot = await this.snapshotFor(db, row.athleteId, row.period);

      await db.athleteReport.update({
        where: { id },
        data: { status: "PUBLISHED", publishedAt: new Date(), snapshot },
      });

      if (row.visibility === "FAMILY") {
        await this.notifyFamily(db, ctx, row.athleteId, id, row.title);
      }

      return { ok: true, shared: row.visibility === "FAMILY" };
    });
  }

  /**
   * Apagar.
   *
   * Rascunhos, à vontade. Publicados só quem tem a academia inteira no âmbito —
   * um relatório publicado já faz parte do registo do atleta, e o treinador que o
   * escreveu não devia poder limpar o rasto sozinho. Erros graves existem (o
   * relatório certo no atleta errado), e para esses há a direção.
   */
  async remove(ctx: RequestContext, id: string) {
    if (!can(ctx, "report:write")) throw new ForbiddenException("Sem permissão");

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const row = await this.reportInScope(db, ctx, id);

      if (row.status === "PUBLISHED" && teamScopeFilter(ctx) !== undefined) {
        throw new ForbiddenException("Um relatório publicado só pode ser apagado pela direção");
      }

      await db.athleteReport.delete({ where: { id } });
      return { ok: true };
    });
  }

  /* ------------------------------------------------------------------------ */
  /* Peças internas                                                            */
  /* ------------------------------------------------------------------------ */

  private athleteWhere(ctx: RequestContext) {
    const athleteScope = athleteScopeFilter(ctx);
    const teamScope = teamScopeFilter(ctx);
    return {
      ...(athleteScope ? { id: athleteScope } : {}),
      ...(teamScope ? { teams: { some: { teamId: teamScope } } } : {}),
    };
  }

  private async athleteInScope(db: ScopedClient, ctx: RequestContext, athleteId: string) {
    const athlete = await db.athlete.findFirst({
      where: { id: athleteId, ...this.athleteWhere(ctx) },
      select: { id: true, name: true },
    });
    if (!athlete) throw new NotFoundException("Atleta não encontrado ou fora do teu âmbito");
    return athlete;
  }

  private async reportInScope(db: ScopedClient, ctx: RequestContext, id: string) {
    const row = await db.athleteReport.findFirst({
      where: { id, athlete: this.athleteWhere(ctx) },
      select: { id: true, athleteId: true, title: true, period: true, status: true, visibility: true },
    });
    if (!row) throw new NotFoundException("Relatório não encontrado");
    return row;
  }

  /**
   * Os números do atleta no momento da publicação.
   *
   * Assiduidade, jogos e a avaliação do período — o que um pai procura a seguir a
   * ler o texto, e o que um director quer ver ao lado dele. Tudo derivado do que já
   * está registado; nada aqui é escrito à mão em lado nenhum.
   */
  private async snapshotFor(db: ScopedClient, athleteId: string, period: string | null) {
    const [records, appearances, evaluation] = await Promise.all([
      db.attendanceRecord.groupBy({
        by: ["status"],
        where: { athleteId },
        _count: { _all: true },
      }),
      db.matchAppearance.count({ where: { athleteId } }),
      period
        ? db.evaluation.findFirst({
            where: { athleteId, period, status: "PUBLISHED" },
            select: { period: true, scores: true },
          })
        : Promise.resolve(null),
    ]);

    const total = records.reduce((n, r) => n + r._count._all, 0);
    const attended = records
      .filter((r) => r.status === "PRESENT" || r.status === "LATE")
      .reduce((n, r) => n + r._count._all, 0);

    return {
      attendance: { attended, total },
      matches: appearances,
      evaluation: evaluation ? { period: evaluation.period, scores: evaluation.scores } : null,
      takenAt: new Date().toISOString(),
    };
  }

  private async notifyFamily(
    db: ScopedClient,
    ctx: RequestContext,
    athleteId: string,
    reportId: string,
    title: string,
  ) {
    const athlete = await db.athlete.findFirst({ where: { id: athleteId }, select: { name: true } });
    const guardians = await db.guardianLink.findMany({
      where: { athleteId, membership: { isActive: true } },
      select: { membership: { select: { userId: true } } },
    });

    for (const g of guardians) {
      await this.notifications.enqueue(
        {
          academyId: ctx.academyId,
          userId: g.membership.userId,
          type: "REPORT_SHARED",
          title: "Novo relatório",
          body: `${title} — sobre ${firstName(athlete?.name ?? "o teu educando")}.`,
          payload: { reportId, athleteId, route: "/atleta" },
        },
        db,
      );
    }
  }
}

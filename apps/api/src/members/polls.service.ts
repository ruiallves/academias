import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService, type ScopedClient } from "../prisma/prisma.service";
import { can, type RequestContext } from "../common/permissions";

/**
 * Sondagens aos sócios — o lado da consola.
 *
 * O ciclo é deliberadamente pequeno: rascunho → aberta → fechada. Uma sondagem
 * aberta não se edita (mudar as opções debaixo de votos dados invalida-os todos
 * sem ninguém dar por isso) e uma fechada não reabre (fechar é anunciar o
 * resultado; reabrir depois disso é mudar as regras com o jogo jogado). O que
 * está errado numa aberta resolve-se fechando-a e criando outra — que é o que
 * uma direcção faria em papel.
 *
 * Quem vota é o **sócio**, não a conta: o voto liga-se ao `Member`, e é isso que
 * faz "um sócio, um voto" valer mesmo que uma pessoa tivesse duas contas.
 */
@Injectable()
export class PollsService {
  constructor(private readonly prisma: PrismaService) {}

  private mustRead(ctx: RequestContext) {
    if (!can(ctx, "member:read")) throw new ForbiddenException("Sem acesso aos sócios");
  }
  private mustWrite(ctx: RequestContext) {
    if (!can(ctx, "member:write")) throw new ForbiddenException("Sem permissão para gerir sócios");
  }

  /** Todas, com contagens — a consola vê resultados em qualquer estado. */
  async list(ctx: RequestContext) {
    this.mustRead(ctx);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const rows = await db.poll.findMany({
        orderBy: [{ createdAt: "desc" }],
        select: {
          id: true, question: true, details: true, status: true,
          publishedAt: true, closedAt: true, createdAt: true,
          options: {
            orderBy: { order: "asc" },
            select: { id: true, label: true, _count: { select: { votes: true } } },
          },
          _count: { select: { votes: true } },
        },
      });

      return rows.map((p) => ({
        id: p.id,
        question: p.question,
        details: p.details,
        status: p.status,
        publishedAt: p.publishedAt,
        closedAt: p.closedAt,
        createdAt: p.createdAt,
        totalVotes: p._count.votes,
        options: p.options.map((o) => ({ id: o.id, label: o.label, votes: o._count.votes })),
      }));
    });
  }

  async create(ctx: RequestContext, dto: { question: string; details?: string; options: string[] }) {
    this.mustWrite(ctx);

    const question = dto.question.trim();
    if (question.length < 5) throw new BadRequestException("Falta a pergunta");

    const options = dto.options.map((o) => o.trim()).filter(Boolean);
    if (options.length < 2) throw new BadRequestException("Uma sondagem precisa de pelo menos duas opções");
    if (options.length > 10) throw new BadRequestException("No máximo dez opções");

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const poll = await db.poll.create({
        data: {
          academyId: ctx.academyId,
          question,
          details: dto.details?.trim() || null,
          createdById: ctx.membershipId,
          updatedAt: new Date(),
          options: {
            create: options.map((label, i) => ({ academyId: ctx.academyId, label, order: i })),
          },
        },
        select: { id: true },
      });
      return { id: poll.id };
    });
  }

  /** Abrir aos sócios. A partir daqui a pergunta e as opções ficam trancadas. */
  async publish(ctx: RequestContext, id: string) {
    this.mustWrite(ctx);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const poll = await this.encontrar(db, id);
      if (poll.status !== "DRAFT") throw new BadRequestException("Só um rascunho se publica");

      await db.poll.update({
        where: { id },
        data: { status: "OPEN", publishedAt: new Date() },
      });
      return { ok: true as const };
    });
  }

  async close(ctx: RequestContext, id: string) {
    this.mustWrite(ctx);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const poll = await this.encontrar(db, id);
      if (poll.status !== "OPEN") throw new BadRequestException("Só uma sondagem aberta se fecha");

      await db.poll.update({ where: { id }, data: { status: "CLOSED", closedAt: new Date() } });
      return { ok: true as const };
    });
  }

  /**
   * Apagar. Só rascunhos: uma sondagem que recebeu votos é um registo de uma
   * consulta aos sócios — fecha-se, não se faz desaparecer.
   */
  async remove(ctx: RequestContext, id: string) {
    this.mustWrite(ctx);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const poll = await this.encontrar(db, id);
      if (poll.status !== "DRAFT") {
        throw new BadRequestException("Uma sondagem publicada não se apaga — fecha-se");
      }

      await db.poll.delete({ where: { id } });
      return { ok: true as const };
    });
  }

  private async encontrar(db: ScopedClient, id: string) {
    const poll = await db.poll.findFirst({ where: { id }, select: { id: true, status: true } });
    if (!poll) throw new NotFoundException("Sondagem não encontrada");
    return poll;
  }
}

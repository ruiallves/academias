import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService, type ScopedClient } from "../prisma/prisma.service";
import { athleteScopeFilter, can, teamScopeFilter, type RequestContext } from "../common/permissions";
import { limparNota } from "./notas-escolares";

const SELECT = {
  id: true, athleteId: true, schoolYear: true, period: true, subject: true,
  grade: true, scale: true, submittedByName: true, updatedAt: true,
} as const;

/**
 * As notas da escola de um atleta.
 *
 * ## Quem escreve e quem lê
 *
 * **Escreve o encarregado**, na app, e só as dos seus educandos. Mais ninguém:
 * nem o clube (a pauta é da família, e um clube a corrigir notas da escola de
 * um miúdo não é um caso que o produto queira ter), nem o próprio atleta (quem
 * responde pela escola de um menor é quem é responsável por ele).
 *
 * **Lê a família**, as dos seus, e **o staff que vê a ficha** (`athlete:read`),
 * as dos atletas das equipas dele. O treinador é quem mais quer saber disto —
 * é a conversa "se as notas descem, falamos" — mas só dos miúdos que treina.
 */
@Injectable()
export class SchoolGradesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(ctx: RequestContext, athleteId: string) {
    if (!can(ctx, "athlete:read")) throw new ForbiddenException("Sem acesso à ficha do atleta");

    return this.prisma.runAs(ctx.academyId, async (db) => {
      await this.atletaAoAlcance(db, ctx, athleteId);
      const notas = await db.schoolGrade.findMany({
        where: { athleteId },
        orderBy: [{ schoolYear: "desc" }, { period: "asc" }, { subject: "asc" }],
        select: SELECT,
      });
      return { editable: this.eDoEncarregado(ctx, athleteId), notas };
    });
  }

  /** Submeter uma nota — ou corrigir a que já lá estava para a mesma disciplina e período. */
  async save(ctx: RequestContext, athleteId: string, dto: Record<string, unknown>) {
    if (!this.eDoEncarregado(ctx, athleteId)) {
      throw new ForbiddenException("Só o encarregado de educação submete as notas da escola");
    }
    const nota = this.validar(() => limparNota(dto));

    return this.prisma.runAs(ctx.academyId, async (db) => {
      await this.atletaAoAlcance(db, ctx, athleteId);
      const submittedByName = await this.nomeDe(db, ctx);
      const chave = { athleteId, schoolYear: nota.schoolYear, period: nota.period, subjectKey: nota.subjectKey };
      return db.schoolGrade.upsert({
        where: { athleteId_schoolYear_period_subjectKey: chave },
        create: { academyId: ctx.academyId, ...chave, subject: nota.subject, grade: nota.grade, scale: nota.scale, submittedByName },
        // O nome fica como foi escrito agora: quem corrige "Matematica" para
        // "Matemática" quer ver a correcção.
        update: { subject: nota.subject, grade: nota.grade, scale: nota.scale, submittedByName },
        select: SELECT,
      });
    });
  }

  async remove(ctx: RequestContext, id: string) {
    return this.prisma.runAs(ctx.academyId, async (db) => {
      const nota = await db.schoolGrade.findFirst({ where: { id }, select: { id: true, athleteId: true } });
      // A mesma resposta para "não existe" e "não é tua": não se diz a quem
      // pergunta que existe uma nota de outro miúdo com aquele id.
      if (!nota || !this.eDoEncarregado(ctx, nota.athleteId)) throw new NotFoundException("Nota não encontrada");
      await db.schoolGrade.delete({ where: { id } });
      return { ok: true };
    });
  }

  /** Quem pergunta é encarregado **deste** atleta. */
  private eDoEncarregado(ctx: RequestContext, athleteId: string): boolean {
    return ctx.role === "GUARDIAN" && (ctx.scope.athleteIds ?? []).includes(athleteId);
  }

  /** A família chega aos seus; o staff, aos das equipas dele. */
  private async atletaAoAlcance(db: ScopedClient, ctx: RequestContext, athleteId: string) {
    const meus = athleteScopeFilter(ctx);
    const equipas = meus ? undefined : teamScopeFilter(ctx);
    const athlete = await db.athlete.findFirst({
      where: {
        id: athleteId,
        ...(meus ? { AND: [{ id: meus }] } : {}),
        ...(equipas ? { teams: { some: { teamId: equipas, leftAt: null } } } : {}),
      },
      select: { id: true },
    });
    if (!athlete) throw new NotFoundException("Atleta não encontrado ou fora do teu âmbito");
  }

  private async nomeDe(db: ScopedClient, ctx: RequestContext): Promise<string | null> {
    const m = await db.membership.findFirst({
      where: { id: ctx.membershipId },
      select: { user: { select: { name: true } } },
    });
    return m?.user.name?.trim() || null;
  }

  private validar<T>(f: () => T): T {
    try {
      return f();
    } catch (e) {
      throw new BadRequestException(e instanceof Error ? e.message : "Dados inválidos");
    }
  }
}

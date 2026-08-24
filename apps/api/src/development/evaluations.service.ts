import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService, type ScopedClient } from "../prisma/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import { athleteScopeFilter, can, teamScopeFilter, type RequestContext } from "../common/permissions";

/**
 * Avaliações.
 *
 * ## O que uma avaliação é neste produto
 *
 * O boletim de um período: as mesmas competências, a mesma escala de 1 a 5, uma por
 * atleta por período. A regularidade é o ponto — é o que deixa comparar Setembro com
 * Junho e mostrar a um pai que o filho evoluiu, em vez de o afirmar.
 *
 * As competências **não estão no código**. Vêm de `Sport.skills`, que é configuração
 * da academia: futebol avalia Técnica, Táctica, Físico, Atitude e Assiduidade;
 * natação avalia outra coisa. Um enum aqui obrigaria a uma migração por cada
 * modalidade nova, e a natação ficaria com colunas de futebol em branco.
 *
 * ## Rascunho e publicado não são estados decorativos
 *
 * Um rascunho é do treinador: pode estar meio escrito, pode estar errado, e **nenhum
 * pai o vê**. Publicar é o acto que o entrega à família — cria a notificação e passa
 * a ser visível na app. É a mesma fronteira das comunicações, e existe pela mesma
 * razão: o que se escreve sobre uma criança tem de ter um momento em que se decide
 * que está pronto.
 *
 * Corrigir uma avaliação já publicada é permitido (um erro de digitação não obriga a
 * ninguém a viver com ele) e **não volta a notificar** — o pai já foi avisado uma vez,
 * e um segundo aviso pela mesma avaliação lê-se como "há coisa nova" quando não há.
 */

/** A escala. Cinco pontos: três é o meio, e há espaço acima e abaixo sem falso precisão. */
const MIN_SCORE = 1;
const MAX_SCORE = 5;

export type EvaluationInput = {
  athleteId: string;
  period: string;
  scores: Record<string, number>;
  note?: string | null;
  strengths?: string | null;
  focus?: string | null;
};

@Injectable()
export class EvaluationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /* ------------------------------------------------------------------------ */
  /* Leitura                                                                   */
  /* ------------------------------------------------------------------------ */

  /**
   * As avaliações que esta pessoa pode ver.
   *
   * Três filtros, e são independentes de propósito:
   *
   *  1. **Permissão** — `evaluation:read`, ou nem se entra.
   *  2. **Âmbito** — o treinador vê as suas equipas, o pai vê os seus filhos. Vem
   *     de `athleteScopeFilter`/`teamScopeFilter`, e não de nada que o cliente diga.
   *  3. **Estado** — quem é da família vê apenas o que foi **publicado**. Um
   *     rascunho meio escrito nunca sai da consola, e essa regra vive aqui e não na
   *     interface: uma app antiga, um pedido à mão, um bug no cliente — nenhum deles
   *     consegue ler um rascunho.
   */
  async list(ctx: RequestContext, period?: string) {
    if (!can(ctx, "evaluation:read")) throw new ForbiddenException("Sem acesso a avaliações");

    const family = isFamily(ctx);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const rows = await db.evaluation.findMany({
        where: {
          ...(period ? { period } : {}),
          ...(family ? { status: "PUBLISHED" as const } : {}),
          athlete: this.athleteWhere(ctx),
        },
        orderBy: [{ period: "desc" }, { updatedAt: "desc" }],
        select: {
          id: true, athleteId: true, period: true, status: true, scores: true,
          note: true, strengths: true, focus: true,
          publishedAt: true, createdAt: true, updatedAt: true,
          coach: { select: { id: true, user: { select: { name: true } } } },
          athlete: { select: { name: true, teams: { select: { teamId: true }, take: 1 } } },
        },
      });

      return rows.map((r) => ({
        id: r.id,
        athleteId: r.athleteId,
        athleteName: r.athlete.name,
        teamId: r.athlete.teams[0]?.teamId ?? null,
        period: r.period,
        status: r.status,
        scores: r.scores as Record<string, number>,
        note: r.note,
        strengths: r.strengths,
        focus: r.focus,
        coachId: r.coach.id,
        coachName: r.coach.user.name,
        publishedAt: r.publishedAt,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      }));
    });
  }

  /* ------------------------------------------------------------------------ */
  /* Escrita                                                                   */
  /* ------------------------------------------------------------------------ */

  /**
   * Gravar (ou regravar) a avaliação de um atleta num período.
   *
   * `upsert` por `(athleteId, period)` — a chave única do modelo. Não há "criar" e
   * "editar" separados porque, do lado de quem avalia, não são operações
   * diferentes: abre-se a ficha do miúdo naquele período e escreve-se o que se sabe,
   * hoje e outra vez para a semana.
   *
   * O `coachId` passa a ser sempre o de quem gravou por último. É quem assina.
   */
  async save(ctx: RequestContext, dto: EvaluationInput) {
    if (!can(ctx, "evaluation:write")) throw new ForbiddenException("Sem permissão para avaliar");

    const period = dto.period.trim();
    if (!period) throw new BadRequestException("Falta o período");

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const athlete = await this.athleteInScope(db, ctx, dto.athleteId);
      const scores = await this.validateScores(db, athlete.teams[0]?.teamId ?? null, dto.scores);

      const existing = await db.evaluation.findFirst({
        where: { athleteId: dto.athleteId, period },
        select: { id: true, status: true },
      });

      const data = {
        scores,
        note: text(dto.note),
        strengths: text(dto.strengths),
        focus: text(dto.focus),
        coachId: ctx.membershipId,
      };

      const saved = existing
        ? await db.evaluation.update({ where: { id: existing.id }, data, select: { id: true } })
        : await db.evaluation.create({
            data: { academyId: ctx.academyId, athleteId: dto.athleteId, period, ...data },
            select: { id: true },
          });

      return { id: saved.id, status: existing?.status ?? "DRAFT" };
    });
  }

  /**
   * Publicar — entregar às famílias.
   *
   * Aceita várias de uma vez porque é assim que o trabalho acontece: um treinador
   * avalia o plantel todo numa tarde e entrega o plantel todo de uma vez. Publicar
   * uma a uma seria vinte confirmações e um convite a deixar metade por entregar.
   *
   * **Uma avaliação vazia não se publica.** Sem pontuações não há nada para o pai
   * ler, e o que ele receberia era um aviso a apontar para um ecrã em branco — pior
   * do que não ter recebido nada.
   */
  async publish(ctx: RequestContext, ids: string[]) {
    if (!can(ctx, "evaluation:write")) throw new ForbiddenException("Sem permissão");
    if (ids.length === 0) return { published: 0, skipped: [] as { id: string; reason: string }[] };

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const rows = await db.evaluation.findMany({
        where: { id: { in: ids }, athlete: this.athleteWhere(ctx) },
        select: {
          id: true, status: true, scores: true, period: true,
          athlete: { select: { id: true, name: true } },
        },
      });

      const skipped: { id: string; reason: string }[] = [];
      const published: typeof rows = [];

      for (const row of rows) {
        if (row.status === "PUBLISHED") {
          skipped.push({ id: row.id, reason: "Já estava publicada" });
          continue;
        }
        if (Object.keys((row.scores ?? {}) as object).length === 0) {
          skipped.push({ id: row.id, reason: "Sem pontuações" });
          continue;
        }
        published.push(row);
      }

      if (published.length > 0) {
        await db.evaluation.updateMany({
          where: { id: { in: published.map((r) => r.id) } },
          data: { status: "PUBLISHED", publishedAt: new Date() },
        });

        // As notificações vão **depois** de o estado estar gravado: um empurrão que
        // falha não pode perder a publicação, e o pai que abre a app à mesma vê-a lá.
        for (const row of published) {
          await this.notifyGuardians(db, ctx, row.athlete.id, {
            title: "Avaliação disponível",
            body: `A avaliação de ${firstName(row.athlete.name)} — ${row.period} — já está na app.`,
            // `route` é o que faz a notificação abrir no sítio certo em vez de
            // ficar a ser um texto que obriga a procurar. Ver `NotifRow` na PWA.
            payload: { evaluationId: row.id, athleteId: row.athlete.id, route: "/atleta" },
          });
        }
      }

      // Os ids que nem sequer voltaram da consulta estavam fora do âmbito. Não se
      // diz que existem: diz-se que não foram publicados, que é a verdade útil.
      for (const id of ids) {
        if (!rows.some((r) => r.id === id)) skipped.push({ id, reason: "Fora do teu âmbito" });
      }

      return { published: published.length, skipped };
    });
  }

  /** Apagar. Só rascunhos — o que já foi entregue a uma família não desaparece. */
  async remove(ctx: RequestContext, id: string) {
    if (!can(ctx, "evaluation:write")) throw new ForbiddenException("Sem permissão");

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const row = await db.evaluation.findFirst({
        where: { id, athlete: this.athleteWhere(ctx) },
        select: { id: true, status: true },
      });
      if (!row) throw new NotFoundException("Avaliação não encontrada");
      if (row.status === "PUBLISHED") {
        throw new BadRequestException("Uma avaliação publicada não se apaga — corrige-a.");
      }

      await db.evaluation.delete({ where: { id } });
      return { ok: true };
    });
  }

  /* ------------------------------------------------------------------------ */
  /* Peças partilhadas                                                         */
  /* ------------------------------------------------------------------------ */

  /** O filtro de atletas desta pessoa: os filhos, ou os das suas equipas. */
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
      select: { id: true, name: true, teams: { select: { teamId: true }, take: 1 } },
    });
    if (!athlete) throw new NotFoundException("Atleta não encontrado ou fora do teu âmbito");
    return athlete;
  }

  /**
   * As pontuações, validadas contra a modalidade.
   *
   * Duas regras, e as duas existem por causa do mesmo perigo — um cliente a mandar o
   * que lhe apetece:
   *
   *  - **Só competências desta modalidade.** Sem isto, `scores` era um saco de JSON
   *    onde qualquer chave entrava, e a grelha da consola passava a ter colunas que
   *    a academia nunca configurou.
   *  - **Inteiros de 1 a 5.** Um 7 numa escala de 5 desenha uma barra fora do sítio;
   *    um 3,7 finge uma precisão que ninguém tem ao avaliar um miúdo de onze anos.
   */
  private async validateScores(db: ScopedClient, teamId: string | null, scores: Record<string, number>) {
    const skills = teamId
      ? (
          await db.team.findFirst({
            where: { id: teamId },
            select: { sport: { select: { skills: true } } },
          })
        )?.sport.skills ?? []
      : [];

    const out: Record<string, number> = {};
    for (const [skill, value] of Object.entries(scores ?? {})) {
      if (skills.length > 0 && !skills.includes(skill)) {
        throw new BadRequestException(`"${skill}" não é uma competência desta modalidade`);
      }
      if (!Number.isInteger(value) || value < MIN_SCORE || value > MAX_SCORE) {
        throw new BadRequestException(`"${skill}" tem de ser um número de ${MIN_SCORE} a ${MAX_SCORE}`);
      }
      out[skill] = value;
    }
    return out;
  }

  /**
   * Avisar quem é encarregado deste atleta.
   *
   * Uma notificação por encarregado e não uma por atleta: numa família com o pai e a
   * mãe na app, os dois querem saber. `GuardianLink` é a lista, e é a mesma que o
   * resto do produto usa para saber a quem pertence uma criança.
   */
  private async notifyGuardians(
    db: ScopedClient,
    ctx: RequestContext,
    athleteId: string,
    message: { title: string; body: string; payload: Record<string, unknown> },
  ) {
    const guardians = await db.guardianLink.findMany({
      where: { athleteId, membership: { isActive: true } },
      select: { membership: { select: { userId: true } } },
    });

    for (const g of guardians) {
      await this.notifications.enqueue(
        {
          academyId: ctx.academyId,
          userId: g.membership.userId,
          type: "EVALUATION_PUBLISHED",
          title: message.title,
          body: message.body,
          payload: message.payload,
        },
        db,
      );
    }
  }
}

/* ---------------------------------------------------------------------------- */

/** Quem está do lado de fora da academia: vê o que foi publicado, e mais nada. */
export function isFamily(ctx: RequestContext): boolean {
  return ctx.role === "GUARDIAN" || ctx.role === "ATHLETE";
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

function text(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  return value.trim() || null;
}

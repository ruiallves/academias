import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { DominantSide, ObservationContext, ProspectStage, ScoutRecommendation } from "@prisma/client";
import { PrismaService, type ScopedClient } from "../prisma/prisma.service";
import { can, type RequestContext } from "../common/permissions";
import type { CreateObservationDto, ProspectInputDto, ProspectUpdateDto, SetStageDto } from "./scouting.dto";

/**
 * Scouting — prospectos, o funil, e as observações que o fazem andar.
 *
 * ## O âmbito é a academia, não as equipas
 *
 * Ao contrário de tudo o resto neste serviço-irmão, não há `teamScopeFilter` aqui:
 * um prospecto **não pertence a equipa nenhuma** — é precisamente isso que o faz
 * um prospecto. Prendê-lo a escalões para reaproveitar o âmbito existente seria
 * burocracia a fingir-se de segurança, como já se decidiu para o departamento
 * clínico. O que limita é `scouting:read` / `scouting:write`, e a RLS por baixo.
 *
 * ## Nada de futebol
 *
 * As posições vêm de `Sport.positions`. Os critérios de avaliação são linhas de
 * `ScoutCriterion` por modalidade, semeadas à primeira leitura com um quadro que a
 * academia pode reescrever. Nenhuma categoria está em código.
 */

/**
 * O quadro por omissão, para o desporto não ficar em branco no primeiro dia.
 *
 * É um **ponto de partida editável**, não uma verdade: o futebol de formação usa
 * estes quatro grupos há décadas, e uma academia de natação apaga-os e escreve os
 * dela. Semeia-se por modalidade à primeira leitura, e só quando a modalidade tem
 * posições — o que é a forma que o modelo já tem de dizer "isto é um desporto
 * colectivo".
 */
const DEFAULT_CRITERIA: { group: string; names: string[] }[] = [
  { group: "Técnico", names: ["Primeiro toque", "Passe", "Condução", "Drible", "Finalização"] },
  { group: "Tático", names: ["Posicionamento", "Tomada de decisão", "Leitura do jogo", "Pressão"] },
  { group: "Físico", names: ["Velocidade", "Aceleração", "Agilidade", "Coordenação"] },
  { group: "Psicossocial", names: ["Atitude", "Comunicação", "Resiliência", "Aprendizagem"] },
];

/** A ordem do funil. É esta lista que desenha o corredor na visão geral. */
export const STAGES: ProspectStage[] = [
  "DISCOVERED",
  "WATCHING",
  "OBSERVED",
  "TRIAL",
  "RECRUITED",
  "REJECTED",
];

/**
 * Uma recomendação sugere o estado seguinte, mas **não o aplica sozinha**.
 *
 * O scout diz o que acha; quem move o dossiê é uma pessoa, com um clique, e fica
 * registado quem foi. Uma automação silenciosa aqui daria dossiês a andar sozinhos
 * no funil, e a pergunta "quem decidiu dispensá-lo?" ficava sem resposta.
 */
export const SUGGESTED_STAGE: Record<ScoutRecommendation, ProspectStage> = {
  DROP: "REJECTED",
  KEEP_WATCHING: "WATCHING",
  OBSERVE_AGAIN: "OBSERVED",
  INVITE_TRAINING: "TRIAL",
  // Entrar numa shortlist deixou de ser um estado do funil — é uma lista de
  // trabalho, e um miúdo numa lista continua simplesmente observado.
  SHORTLIST: "OBSERVED",
  RECRUIT: "TRIAL",
};

/** Passados tantos dias sem uma observação, o dossiê está a arrefecer. */
const STALE_DAYS = 30;

@Injectable()
export class ScoutingService {
  constructor(private readonly prisma: PrismaService) {}

  /* ---------------------------------------------------------------------- */
  /* Visão geral                                                            */
  /* ---------------------------------------------------------------------- */

  /**
   * O estado do departamento numa leitura.
   *
   * Não são doze contadores: são as três perguntas que um responsável de scouting
   * faz ao abrir isto — como está o funil, quem espera decisão, e quem está a
   * arrefecer sem ninguém dar por isso.
   */
  async overview(ctx: RequestContext) {
    this.mustRead(ctx);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const stale = new Date(Date.now() - STALE_DAYS * 86_400_000);

      const [byStage, awaitingDecision, staleProspects, recent] = await Promise.all([
        db.prospect.groupBy({
          by: ["stage"],
          where: { archivedAt: null },
          _count: { _all: true },
        }),

        // Quem está em trial e ainda sem decisão. É a lista accionável, e vem
        // primeiro — a mesma gramática do "Precisa de atenção" da direção.
        db.prospect.findMany({
          where: { archivedAt: null, stage: { in: ["TRIAL"] } },
          orderBy: { updatedAt: "asc" },
          take: 8,
          select: {
            id: true, name: true, stage: true, position: true, lastObservedAt: true, updatedAt: true,
            owner: { select: { user: { select: { name: true } } } },
            _count: { select: { observations: true } },
          },
        }),

        // A acompanhar mas sem ninguém a ver há um mês. O silêncio é que é o
        // problema: ninguém decidiu nada, e o miúdo assina noutro sítio.
        db.prospect.findMany({
          where: {
            archivedAt: null,
            stage: { in: ["DISCOVERED", "WATCHING", "OBSERVED"] },
            OR: [{ lastObservedAt: null }, { lastObservedAt: { lt: stale } }],
          },
          orderBy: [{ lastObservedAt: { sort: "asc", nulls: "first" } }],
          take: 8,
          select: {
            id: true, name: true, stage: true, position: true, lastObservedAt: true, discoveredAt: true,
            owner: { select: { user: { select: { name: true } } } },
          },
        }),

        db.observation.findMany({
          orderBy: { createdAt: "desc" },
          take: 10,
          select: {
            id: true, observedAt: true, context: true, recommendation: true, createdAt: true,
            prospect: { select: { id: true, name: true } },
            scout: { select: { user: { select: { name: true } } } },
          },
        }),
      ]);

      const counts = Object.fromEntries(STAGES.map((s) => [s, 0])) as Record<ProspectStage, number>;
      for (const row of byStage) counts[row.stage] = row._count._all;

      return {
        stages: STAGES.map((stage) => ({ stage, count: counts[stage] })),
        total: Object.values(counts).reduce((n, c) => n + c, 0),
        awaitingDecision: awaitingDecision.map((p) => ({
          id: p.id,
          name: p.name,
          stage: p.stage,
          position: p.position,
          lastObservedAt: p.lastObservedAt,
          waitingSince: p.updatedAt,
          owner: p.owner?.user.name ?? null,
          observations: p._count.observations,
        })),
        goingCold: staleProspects.map((p) => ({
          id: p.id,
          name: p.name,
          stage: p.stage,
          position: p.position,
          lastObservedAt: p.lastObservedAt,
          since: p.lastObservedAt ?? p.discoveredAt,
          owner: p.owner?.user.name ?? null,
        })),
        activity: recent.map((o) => ({
          id: o.id,
          prospectId: o.prospect.id,
          prospectName: o.prospect.name,
          scout: o.scout?.user.name ?? null,
          observedAt: o.observedAt,
          context: o.context,
          recommendation: o.recommendation,
        })),
      };
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Prospectos                                                             */
  /* ---------------------------------------------------------------------- */

  async list(ctx: RequestContext, filters: { stage?: string; sportId?: string; q?: string }) {
    this.mustRead(ctx);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const rows = await db.prospect.findMany({
        where: {
          archivedAt: null,
          ...(filters.stage ? { stage: filters.stage as ProspectStage } : {}),
          ...(filters.sportId ? { sportId: filters.sportId } : {}),
          // `mode: insensitive` e não `toLowerCase()` dos dois lados: o segundo
          // impede o Postgres de usar qualquer índice, e nomes têm acentos.
          ...(filters.q ? { name: { contains: filters.q, mode: "insensitive" as const } } : {}),
        },
        orderBy: [{ stage: "asc" }, { lastObservedAt: { sort: "desc", nulls: "last" } }],
        select: {
          id: true, name: true, birthdate: true, stage: true, position: true,
          currentClub: true, currentTeam: true, lastObservedAt: true, sportId: true,
          owner: { select: { id: true, user: { select: { name: true } } } },
          _count: { select: { observations: true } },
        },
      });

      return rows.map((p) => ({
        id: p.id,
        name: p.name,
        birthdate: p.birthdate,
        stage: p.stage,
        position: p.position,
        currentClub: p.currentClub,
        currentTeam: p.currentTeam,
        sportId: p.sportId,
        lastObservedAt: p.lastObservedAt,
        ownerId: p.owner?.id ?? null,
        owner: p.owner?.user.name ?? null,
        observations: p._count.observations,
      }));
    });
  }

  /** A ficha completa: o dossiê, as observações e o histórico. */
  async detail(ctx: RequestContext, id: string) {
    this.mustRead(ctx);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const p = await db.prospect.findFirst({
        where: { id },
        select: {
          id: true, name: true, birthdate: true, stage: true, sportId: true,
          position: true, secondaryPositions: true, dominantSide: true,
          currentClub: true, currentTeam: true, discoveredVia: true, discoveredAt: true,
          lastObservedAt: true, notes: true, athleteId: true, archivedAt: true,
          owner: { select: { id: true, user: { select: { name: true } } } },
          // O encaixe vem com o dossiê: é uma leitura a mais na mesma ida,
          // contra um segundo pedido a dizer a mesma coisa.
          fit: { select: { dimensionId: true, value: true } },
          shortlists: { select: { id: true, shortlist: { select: { id: true, name: true } } } },
          observations: {
            orderBy: { observedAt: "desc" },
            select: {
              id: true, observedAt: true, context: true, opponent: true, competition: true,
              venue: true, minutesObserved: true, positionObserved: true,
              strengths: true, improvements: true, notes: true, recommendation: true,
              scout: { select: { user: { select: { name: true } } } },
              ratings: { select: { criterionId: true, score: true } },
            },
          },
          events: {
            orderBy: { at: "desc" },
            take: 40,
            select: {
              id: true, kind: true, from: true, to: true, note: true, at: true,
              actor: { select: { user: { select: { name: true } } } },
            },
          },
        },
      });

      // 404 e não 403: confirmar que existe seria confirmar que outra academia
      // segue este miúdo. Ver a auditoria de segurança.
      if (!p) throw new NotFoundException("Prospecto não encontrado");

      return {
        ...p,
        ownerId: p.owner?.id ?? null,
        owner: p.owner?.user.name ?? null,
        observations: p.observations.map((o) => ({
          ...o,
          scout: o.scout?.user.name ?? null,
        })),
        events: p.events.map((e) => ({ ...e, actor: e.actor?.user.name ?? null })),
      };
    });
  }

  async create(ctx: RequestContext, dto: ProspectInputDto) {
    this.mustWrite(ctx);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      await this.mustBeOurSport(db, dto.sportId);

      const prospect = await db.prospect.create({
        data: {
          academyId: ctx.academyId,
          sportId: dto.sportId,
          name: dto.name.trim(),
          birthdate: this.plausibleBirthdate(dto.birthdate),
          currentClub: dto.currentClub?.trim() || null,
          currentTeam: dto.currentTeam?.trim() || null,
          position: dto.position?.trim() || null,
          secondaryPositions: dto.secondaryPositions ?? [],
          dominantSide: (dto.dominantSide as DominantSide) ?? null,
          discoveredVia: dto.discoveredVia?.trim() || null,
          notes: dto.notes?.trim() || null,
          // Quem cria fica dono, até alguém dizer o contrário. Um dossiê sem dono
          // é um dossiê que ninguém volta a abrir.
          ownerId: dto.ownerId ?? ctx.membershipId,
          updatedAt: new Date(),
        },
        select: { id: true, name: true },
      });

      await db.prospectEvent.create({
        data: { prospectId: prospect.id, kind: "created", to: "DISCOVERED", actorId: ctx.membershipId },
      });

      return prospect;
    });
  }

  async update(ctx: RequestContext, id: string, dto: ProspectUpdateDto) {
    this.mustWrite(ctx);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const existing = await db.prospect.findFirst({ where: { id }, select: { id: true } });
      if (!existing) throw new NotFoundException("Prospecto não encontrado");

      if (dto.sportId) await this.mustBeOurSport(db, dto.sportId);

      await db.prospect.update({
        where: { id },
        data: {
          ...(dto.sportId !== undefined ? { sportId: dto.sportId } : {}),
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(dto.birthdate !== undefined ? { birthdate: this.plausibleBirthdate(dto.birthdate) } : {}),
          ...(dto.currentClub !== undefined ? { currentClub: dto.currentClub.trim() || null } : {}),
          ...(dto.currentTeam !== undefined ? { currentTeam: dto.currentTeam.trim() || null } : {}),
          ...(dto.position !== undefined ? { position: dto.position.trim() || null } : {}),
          ...(dto.secondaryPositions !== undefined ? { secondaryPositions: dto.secondaryPositions } : {}),
          ...(dto.dominantSide !== undefined ? { dominantSide: (dto.dominantSide as DominantSide) || null } : {}),
          ...(dto.discoveredVia !== undefined ? { discoveredVia: dto.discoveredVia.trim() || null } : {}),
          ...(dto.notes !== undefined ? { notes: dto.notes.trim() || null } : {}),
          ...(dto.ownerId !== undefined ? { ownerId: dto.ownerId || null } : {}),
          updatedAt: new Date(),
        },
      });

      return { ok: true };
    });
  }

  /**
   * Mover o dossiê no funil.
   *
   * Cada passagem fica registada em `ProspectEvent` com quem a fez. É a diferença
   * entre saber onde um prospecto está e saber **como lá chegou** — que é a
   * pergunta que se faz dois anos depois, quando ele marca contra nós.
   */
  async setStage(ctx: RequestContext, id: string, dto: SetStageDto) {
    this.mustWrite(ctx);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const p = await db.prospect.findFirst({ where: { id }, select: { id: true, stage: true } });
      if (!p) throw new NotFoundException("Prospecto não encontrado");
      if (p.stage === dto.stage) return { ok: true };

      await db.prospect.update({
        where: { id },
        data: { stage: dto.stage as ProspectStage, updatedAt: new Date() },
      });

      await db.prospectEvent.create({
        data: {
          prospectId: id,
          kind: "stage",
          from: p.stage,
          to: dto.stage,
          note: dto.note?.trim() || null,
          actorId: ctx.membershipId,
        },
      });

      return { ok: true };
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Observações                                                            */
  /* ---------------------------------------------------------------------- */

  /**
   * Registar uma ida ao campo.
   *
   * Três escritas numa transação: a observação, as notas por critério, e o
   * `lastObservedAt` do dossiê. Se a última falhasse por fora, o prospecto ficava
   * a parecer esquecido na lista de "a arrefecer" logo a seguir a alguém o ter
   * visto — e essa lista é metade do valor da visão geral.
   */
  async addObservation(ctx: RequestContext, prospectId: string, dto: CreateObservationDto) {
    this.mustWrite(ctx);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const p = await db.prospect.findFirst({
        where: { id: prospectId },
        select: { id: true, stage: true, sportId: true, lastObservedAt: true },
      });
      if (!p) throw new NotFoundException("Prospecto não encontrado");

      const observedAt = new Date(dto.observedAt);
      if (Number.isNaN(observedAt.getTime())) throw new BadRequestException("Data inválida");
      // Uma observação no futuro é sempre engano de digitação — ou uma promessa,
      // e promessas não são observações.
      if (observedAt.getTime() > Date.now() + 86_400_000) {
        throw new BadRequestException("Não se regista uma observação por acontecer");
      }

      const observation = await db.observation.create({
        data: {
          academyId: ctx.academyId,
          prospectId,
          scoutId: ctx.membershipId,
          observedAt,
          context: (dto.context as ObservationContext) ?? "MATCH",
          opponent: dto.opponent?.trim() || null,
          competition: dto.competition?.trim() || null,
          venue: dto.venue?.trim() || null,
          minutesObserved: dto.minutesObserved ?? null,
          positionObserved: dto.positionObserved?.trim() || null,
          strengths: clean(dto.strengths),
          improvements: clean(dto.improvements),
          notes: dto.notes?.trim() || null,
          recommendation: (dto.recommendation as ScoutRecommendation) ?? "KEEP_WATCHING",
          updatedAt: new Date(),
        },
        select: { id: true },
      });

      if (dto.ratings?.length) {
        // Só critérios desta academia e desta modalidade. Sem esta verificação,
        // um `criterionId` de outra modalidade entrava e a comparação por
        // dimensão passava a somar peras com maçãs.
        const valid = new Set(
          (
            await db.scoutCriterion.findMany({
              where: { sportId: p.sportId, archivedAt: null },
              select: { id: true },
            })
          ).map((c) => c.id),
        );

        const rows = dto.ratings
          .filter((r) => valid.has(r.criterionId))
          .filter((r) => r.score >= 1 && r.score <= 5)
          .map((r) => ({ observationId: observation.id, criterionId: r.criterionId, score: r.score }));

        if (rows.length) await db.observationRating.createMany({ data: rows, skipDuplicates: true });
      }

      // Só avança se for mais recente. Registar uma observação antiga não pode
      // fazer o dossiê parecer mais fresco do que está.
      const isLatest = !p.lastObservedAt || observedAt > p.lastObservedAt;

      await db.prospect.update({
        where: { id: prospectId },
        data: {
          ...(isLatest ? { lastObservedAt: observedAt } : {}),
          // "Descoberto" deixa de fazer sentido no momento em que alguém o viu.
          // É a única transição automática, e é factual — não é uma decisão.
          ...(p.stage === "DISCOVERED" ? { stage: "OBSERVED" as ProspectStage } : {}),
          updatedAt: new Date(),
        },
      });

      await db.prospectEvent.create({
        data: {
          prospectId,
          kind: "observation",
          to: dto.recommendation ?? "KEEP_WATCHING",
          actorId: ctx.membershipId,
        },
      });

      return { id: observation.id, suggestedStage: SUGGESTED_STAGE[(dto.recommendation as ScoutRecommendation) ?? "KEEP_WATCHING"] };
    });
  }

  /**
   * Todas as observações da academia, as mais recentes primeiro.
   *
   * É a vista do trabalho feito — "o que é que o departamento andou a fazer?" — e
   * a única onde as observações se leem sem passar por um dossiê. Filtrável por
   * scout, porque a segunda pergunta é sempre "e este, quantas fez?".
   */
  async observations(ctx: RequestContext, filters: { scoutId?: string; days?: number }) {
    this.mustRead(ctx);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const since = filters.days ? new Date(Date.now() - filters.days * 86_400_000) : undefined;

      const rows = await db.observation.findMany({
        where: {
          ...(filters.scoutId ? { scoutId: filters.scoutId } : {}),
          ...(since ? { observedAt: { gte: since } } : {}),
        },
        orderBy: { observedAt: "desc" },
        take: 200,
        select: {
          id: true, observedAt: true, context: true, opponent: true, competition: true,
          minutesObserved: true, recommendation: true, strengths: true, improvements: true, notes: true,
          prospect: { select: { id: true, name: true, position: true, stage: true } },
          scout: { select: { id: true, user: { select: { name: true } } } },
        },
      });

      return rows.map((o) => ({
        ...o,
        scoutId: o.scout?.id ?? null,
        scout: o.scout?.user.name ?? null,
      }));
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Critérios                                                              */
  /* ---------------------------------------------------------------------- */

  /**
   * O quadro de avaliação de uma modalidade.
   *
   * Semeia o quadro por omissão à primeira leitura, e só para desportos com
   * posições — que é a forma que o modelo já tem de dizer "isto é um desporto
   * colectivo". A natação abre vazia e a academia escreve o que quiser: é isso
   * que mantém isto multi-desporto.
   */
  async criteria(ctx: RequestContext, sportId: string) {
    this.mustRead(ctx);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const sport = await this.mustBeOurSport(db, sportId);

      const existing = await db.scoutCriterion.count({ where: { sportId } });
      if (existing === 0 && sport.positions.length > 0) {
        await db.scoutCriterion.createMany({
          data: DEFAULT_CRITERIA.flatMap((g, gi) =>
            g.names.map((name, i) => ({
              academyId: ctx.academyId,
              sportId,
              group: g.group,
              name,
              order: gi * 100 + i,
            })),
          ),
          skipDuplicates: true,
        });
      }

      return db.scoutCriterion.findMany({
        where: { sportId, archivedAt: null },
        orderBy: { order: "asc" },
        select: { id: true, group: true, name: true, order: true },
      });
    });
  }

  /* ---------------------------------------------------------------------- */

  private mustRead(ctx: RequestContext) {
    if (!can(ctx, "scouting:read")) throw new ForbiddenException("Sem acesso ao scouting");
  }

  private mustWrite(ctx: RequestContext) {
    if (!can(ctx, "scouting:write")) throw new ForbiddenException("Sem permissão para escrever no scouting");
  }

  /** A modalidade tem de ser desta academia. A RLS garante-o; isto dá-lhe voz. */
  private async mustBeOurSport(db: ScopedClient, sportId: string) {
    const sport = await db.sport.findFirst({ where: { id: sportId }, select: { id: true, positions: true } });
    if (!sport) throw new BadRequestException("Modalidade não encontrada");
    return sport;
  }

  private plausibleBirthdate(value: string): Date {
    const date = new Date(value);
    const year = date.getUTCFullYear();
    const now = new Date().getUTCFullYear();
    // A mesma janela dos atletas. Fora disto é quase sempre erro de digitação.
    if (Number.isNaN(date.getTime()) || year < now - 60 || year > now - 3) {
      throw new BadRequestException("Data de nascimento improvável");
    }
    return date;
  }
}

/** Sem vazios nem espaços à solta — uma lista de pontos fortes com "" lá dentro
 *  desenha uma linha em branco na ficha e ninguém percebe de onde veio. */
function clean(values: string[] | undefined): string[] {
  return (values ?? []).map((v) => v.trim()).filter(Boolean).slice(0, 12);
}

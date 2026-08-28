import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { DominantSide, RequestStatus, RequestUrgency } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { can, teamScopeFilter, type RequestContext } from "../common/permissions";
import type {
  AddCandidateDto,
  AddToShortlistDto,
  RecruitDto,
  ScoutingRequestInputDto,
  SetFitDto,
  ShortlistInputDto,
} from "./scouting.dto";

/**
 * O trabalho do departamento: listas, pedidos, encaixe, comparação e recrutamento.
 *
 * Separado de `ScoutingService` por tamanho, não por fronteira — as regras de
 * permissão e de tenant são as mesmas, e ambos correm dentro de `runAs`.
 */

/**
 * O quadro de encaixe por omissão.
 *
 * Ponto de partida editável, e semeado só quando a academia ainda não tem
 * nenhum — como os critérios de avaliação. "Posição necessária" e "idade" são as
 * duas que quase todo o clube usa; as outras duas são as que distinguem um clube
 * do seguinte, e é por isso que se editam.
 */
const DEFAULT_FIT_DIMENSIONS = ["Modelo de jogo", "Perfil técnico", "Posição necessária", "Idade"];

@Injectable()
export class ScoutingWorkflowService {
  constructor(private readonly prisma: PrismaService) {}

  /* ---------------------------------------------------------------------- */
  /* Shortlists                                                             */
  /* ---------------------------------------------------------------------- */

  async shortlists(ctx: RequestContext) {
    this.mustRead(ctx);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const rows = await db.shortlist.findMany({
        where: { archivedAt: null },
        orderBy: { createdAt: "desc" },
        select: {
          id: true, name: true, description: true, sportId: true, ageGroup: true, profile: true,
          createdBy: { select: { user: { select: { name: true } } } },
          _count: { select: { entries: true } },
        },
      });

      return rows.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        sportId: s.sportId,
        ageGroup: s.ageGroup,
        profile: s.profile,
        createdBy: s.createdBy?.user.name ?? null,
        count: s._count.entries,
      }));
    });
  }

  /**
   * Uma lista, com tudo o que se precisa para decidir sem sair dela.
   *
   * Cada linha traz idade, posição, última observação, recomendação mais recente,
   * fit e responsável. É deliberado: uma shortlist que obrigue a abrir nove fichas
   * para comparar nove miúdos não é uma shortlist, é um índice.
   */
  async shortlist(ctx: RequestContext, id: string) {
    this.mustRead(ctx);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const list = await db.shortlist.findFirst({
        where: { id },
        select: {
          id: true, name: true, description: true, sportId: true, ageGroup: true, profile: true,
          entries: {
            orderBy: [{ rank: "asc" }, { addedAt: "asc" }],
            select: {
              id: true, note: true, rank: true, addedAt: true,
              prospect: {
                select: {
                  id: true, name: true, birthdate: true, stage: true, position: true,
                  currentClub: true, lastObservedAt: true, sportId: true,
                  owner: { select: { user: { select: { name: true } } } },
                  observations: {
                    orderBy: { observedAt: "desc" },
                    take: 1,
                    select: { recommendation: true, observedAt: true },
                  },
                  fit: { select: { dimensionId: true, value: true } },
                },
              },
            },
          },
        },
      });
      if (!list) throw new NotFoundException("Shortlist não encontrada");

      return {
        id: list.id,
        name: list.name,
        description: list.description,
        sportId: list.sportId,
        ageGroup: list.ageGroup,
        profile: list.profile,
        entries: list.entries.map((e) => ({
          id: e.id,
          note: e.note,
          rank: e.rank,
          prospect: {
            id: e.prospect.id,
            name: e.prospect.name,
            birthdate: e.prospect.birthdate,
            stage: e.prospect.stage,
            position: e.prospect.position,
            currentClub: e.prospect.currentClub,
            sportId: e.prospect.sportId,
            lastObservedAt: e.prospect.lastObservedAt,
            owner: e.prospect.owner?.user.name ?? null,
            lastRecommendation: e.prospect.observations[0]?.recommendation ?? null,
            fit: e.prospect.fit,
          },
        })),
      };
    });
  }

  async createShortlist(ctx: RequestContext, dto: ShortlistInputDto) {
    this.mustWrite(ctx);

    return this.prisma.runAs(ctx.academyId, async (db) =>
      db.shortlist.create({
        data: {
          academyId: ctx.academyId,
          name: dto.name.trim(),
          description: dto.description?.trim() || null,
          sportId: dto.sportId || null,
          ageGroup: dto.ageGroup?.trim() || null,
          profile: dto.profile?.trim() || null,
          createdById: ctx.membershipId,
          updatedAt: new Date(),
        },
        select: { id: true, name: true },
      }),
    );
  }

  async addToShortlist(ctx: RequestContext, shortlistId: string, dto: AddToShortlistDto) {
    this.mustWrite(ctx);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      // As duas pontas têm de ser desta academia. A RLS garante-o; verificar aqui
      // transforma um silêncio (nada acontece) num erro que se lê.
      const [list, prospect] = await Promise.all([
        db.shortlist.findFirst({ where: { id: shortlistId }, select: { id: true, name: true } }),
        db.prospect.findFirst({ where: { id: dto.prospectId }, select: { id: true } }),
      ]);
      if (!list) throw new NotFoundException("Shortlist não encontrada");
      if (!prospect) throw new NotFoundException("Prospecto não encontrado");

      const existing = await db.shortlistEntry.findFirst({
        where: { shortlistId, prospectId: dto.prospectId },
        select: { id: true },
      });
      if (existing) throw new BadRequestException("Já está nesta lista");

      const last = await db.shortlistEntry.findFirst({
        where: { shortlistId },
        orderBy: { rank: "desc" },
        select: { rank: true },
      });

      await db.shortlistEntry.create({
        data: {
          shortlistId,
          prospectId: dto.prospectId,
          note: dto.note?.trim() || null,
          rank: (last?.rank ?? 0) + 1,
          addedById: ctx.membershipId,
        },
      });

      /*
       * Entrar numa lista **não** mexe no funil.
       *
       * Chegou a mexer, e estava errado: uma shortlist é uma lista de trabalho —
       * "quem são os candidatos a lateral esquerdo?" — e não um passo do processo.
       * Um miúdo pode estar em três listas e continuar simplesmente observado; o
       * que faz o funil andar é alguém o ir ver, ou o convidar para treinar.
       */
      await db.prospectEvent.create({
        data: {
          prospectId: dto.prospectId,
          kind: "shortlist",
          to: list.name,
          actorId: ctx.membershipId,
        },
      });

      return { ok: true };
    });
  }

  async removeFromShortlist(ctx: RequestContext, entryId: string) {
    this.mustWrite(ctx);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const entry = await db.shortlistEntry.findFirst({ where: { id: entryId }, select: { id: true } });
      if (!entry) throw new NotFoundException("Entrada não encontrada");
      await db.shortlistEntry.delete({ where: { id: entryId } });
      return { ok: true };
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Comparação                                                             */
  /* ---------------------------------------------------------------------- */

  /**
   * Comparar dois a quatro prospectos, dimensão a dimensão.
   *
   * **Sem número único.** Devolve a média por critério e o fit por dimensão, e
   * quem decide vê onde um ganha e o outro perde. Um "melhor: 87 vs 84" esconderia
   * exactamente a informação que faz a decisão — que um é excelente a passar e
   * fraco no duelo, e o outro o contrário.
   *
   * Um critério sem notas vem a `null`, nunca a zero. Ausência não é avaliação.
   */
  async compare(ctx: RequestContext, ids: string[]) {
    this.mustRead(ctx);

    const unique = [...new Set(ids)].slice(0, 4);
    if (unique.length < 2) throw new BadRequestException("Escolhe pelo menos dois prospectos");

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const prospects = await db.prospect.findMany({
        where: { id: { in: unique } },
        select: {
          id: true, name: true, birthdate: true, position: true, stage: true, sportId: true,
          currentClub: true, lastObservedAt: true,
          observations: { select: { ratings: { select: { criterionId: true, score: true } } } },
          fit: { select: { dimensionId: true, value: true } },
        },
      });
      if (prospects.length < 2) throw new NotFoundException("Prospectos não encontrados");

      // Comparar entre modalidades não faz sentido: os critérios são outros, e as
      // barras estariam a medir coisas diferentes na mesma escala.
      const sports = new Set(prospects.map((p) => p.sportId));
      if (sports.size > 1) throw new BadRequestException("Só se comparam prospectos da mesma modalidade");

      const sportId = prospects[0].sportId;
      const [criteria, dimensions] = await Promise.all([
        db.scoutCriterion.findMany({
          where: { sportId, archivedAt: null },
          orderBy: { order: "asc" },
          select: { id: true, group: true, name: true },
        }),
        db.fitDimension.findMany({
          where: { OR: [{ sportId }, { sportId: null }], archivedAt: null },
          orderBy: { order: "asc" },
          select: { id: true, name: true },
        }),
      ]);

      return {
        criteria,
        dimensions,
        prospects: prospects.map((p) => {
          const scores = new Map<string, number[]>();
          for (const o of p.observations) {
            for (const r of o.ratings) scores.set(r.criterionId, [...(scores.get(r.criterionId) ?? []), r.score]);
          }

          return {
            id: p.id,
            name: p.name,
            birthdate: p.birthdate,
            position: p.position,
            stage: p.stage,
            currentClub: p.currentClub,
            lastObservedAt: p.lastObservedAt,
            ratings: Object.fromEntries(
              criteria.map((c) => {
                const values = scores.get(c.id) ?? [];
                return [c.id, values.length ? values.reduce((a, b) => a + b, 0) / values.length : null];
              }),
            ),
            fit: Object.fromEntries(dimensions.map((d) => [d.id, p.fit.find((f) => f.dimensionId === d.id)?.value ?? null])),
          };
        }),
      };
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Fit                                                                    */
  /* ---------------------------------------------------------------------- */

  /** As dimensões da academia, semeadas à primeira leitura. */
  async fitDimensions(ctx: RequestContext, sportId?: string) {
    this.mustRead(ctx);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const existing = await db.fitDimension.count();
      if (existing === 0) {
        await db.fitDimension.createMany({
          data: DEFAULT_FIT_DIMENSIONS.map((name, order) => ({ academyId: ctx.academyId, name, order })),
          skipDuplicates: true,
        });
      }

      return db.fitDimension.findMany({
        where: { archivedAt: null, ...(sportId ? { OR: [{ sportId }, { sportId: null }] } : {}) },
        orderBy: { order: "asc" },
        select: { id: true, name: true, order: true, sportId: true },
      });
    });
  }

  /**
   * Registar o encaixe.
   *
   * Uma opinião de quem conhece o clube, não um cálculo. É por isso que se escreve
   * à mão e é por isso que o texto ao lado (`fitSummary`, guardado nas notas do
   * dossiê) importa tanto quanto as percentagens: "central confortável em
   * construção curta" explica o número, e o número sozinho não explica nada.
   */
  async setFit(ctx: RequestContext, prospectId: string, dto: SetFitDto) {
    this.mustWrite(ctx);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const prospect = await db.prospect.findFirst({ where: { id: prospectId }, select: { id: true } });
      if (!prospect) throw new NotFoundException("Prospecto não encontrado");

      const valid = new Set(
        (await db.fitDimension.findMany({ where: { archivedAt: null }, select: { id: true } })).map((d) => d.id),
      );

      for (const s of dto.scores) {
        if (!valid.has(s.dimensionId)) continue;
        const value = Math.max(0, Math.min(100, Math.round(s.value)));
        const existing = await db.prospectFit.findFirst({
          where: { prospectId, dimensionId: s.dimensionId },
          select: { id: true },
        });
        if (existing) await db.prospectFit.update({ where: { id: existing.id }, data: { value } });
        else await db.prospectFit.create({ data: { prospectId, dimensionId: s.dimensionId, value } });
      }

      return { ok: true };
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Pedidos                                                                */
  /* ---------------------------------------------------------------------- */

  /**
   * Os pedidos.
   *
   * ## Duas pessoas, duas vistas
   *
   * Quem tem `scouting:read` — o departamento, a direção — vê os pedidos todos: é
   * a fila de trabalho deles. Quem só tem `scouting:request` — o treinador — vê
   * **os pedidos que fez**, e mais nenhum.
   *
   * A segunda metade é o ponto da funcionalidade: o treinador abre um ticket a
   * dizer que lhe falta um lateral esquerdo e acompanha os nomes que o scouting lá
   * for pondo, sem nunca ganhar acesso aos dossiês de miúdos que não pediu. Dar-lhe
   * `scouting:read` para ele poder abrir um pedido abriria a área inteira — e é
   * exactamente essa a troca que esta permissão evita.
   */
  async requests(ctx: RequestContext, status?: string) {
    const full = can(ctx, "scouting:read");
    if (!full && !can(ctx, "scouting:request")) {
      throw new ForbiddenException("Sem acesso aos pedidos de scouting");
    }

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const rows = await db.scoutingRequest.findMany({
        where: {
          ...(status ? { status: status as RequestStatus } : {}),
          // O âmbito de quem só pede: os seus. Sem isto, `scouting:request` era
          // uma janela para o trabalho de toda a gente.
          ...(full ? {} : { requestedById: ctx.membershipId }),
        },
        orderBy: [{ status: "asc" }, { urgency: "desc" }, { dueDate: { sort: "asc", nulls: "last" } }],
        select: {
          id: true, title: true, sportId: true, ageGroup: true, position: true, profile: true,
          traits: true, urgency: true, status: true, dueDate: true, createdAt: true,
          requestedBy: { select: { user: { select: { name: true } } } },
          assignedTo: { select: { user: { select: { name: true } } } },
          candidates: {
            select: {
              id: true, note: true,
              prospect: { select: { id: true, name: true, stage: true, position: true } },
            },
          },
        },
      });

      return rows.map((r) => ({
        ...r,
        requestedBy: r.requestedBy?.user.name ?? null,
        assignedTo: r.assignedTo?.user.name ?? null,
      }));
    });
  }

  async createRequest(ctx: RequestContext, dto: ScoutingRequestInputDto) {
    // Criar um pedido é pedir trabalho, não fazê-lo.
    if (!can(ctx, "scouting:request") && !can(ctx, "scouting:read")) {
      throw new ForbiddenException("Sem permissão para pedir jogadores");
    }

    const scope = teamScopeFilter(ctx);
    const ageGroup = dto.ageGroup?.trim() || null;

    return this.prisma.runAs(ctx.academyId, async (db) => {
      /*
       * Quem tem âmbito pede para uma equipa **dele**, e tem de dizer qual.
       *
       * O escalão de um pedido é texto — é o que o scouting lê para saber para
       * quem procura. Vindo de um treinador, esse texto tem de ser uma das
       * equipas dele: sem escalão o pedido chega sem destino, e com o escalão de
       * outro chega com um destino que não lhe pertence.
       *
       * A direcção não é obrigada: é ela que pode mesmo procurar um jogador sem
       * ter ainda decidido para que escalão. É a mesma linha que separa "toda a
       * academia" no calendário — quem tem âmbito não a atravessa.
       */
      if (scope) {
        if (!ageGroup) throw new BadRequestException("Escolhe o escalão do pedido");

        const equipas = await db.team.findMany({ where: { id: scope }, select: { name: true } });
        if (!equipas.some((t) => t.name === ageGroup)) {
          throw new ForbiddenException("Só podes pedir jogadores para as tuas equipas");
        }
      }

      return db.scoutingRequest.create({
        data: {
          academyId: ctx.academyId,
          title: dto.title.trim(),
          sportId: dto.sportId || null,
          ageGroup,
          position: dto.position?.trim() || null,
          profile: dto.profile?.trim() || null,
          traits: (dto.traits ?? []).map((t) => t.trim()).filter(Boolean).slice(0, 12),
          urgency: (dto.urgency as RequestUrgency) ?? "NORMAL",
          dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
          requestedById: ctx.membershipId,
          assignedToId: dto.assignedToId || null,
          updatedAt: new Date(),
        },
        select: { id: true, title: true },
      });
    });
  }

  async updateRequest(ctx: RequestContext, id: string, dto: Partial<ScoutingRequestInputDto> & { status?: string }) {
    this.mustWrite(ctx);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const request = await db.scoutingRequest.findFirst({ where: { id }, select: { id: true } });
      if (!request) throw new NotFoundException("Pedido não encontrado");

      await db.scoutingRequest.update({
        where: { id },
        data: {
          ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
          ...(dto.profile !== undefined ? { profile: dto.profile.trim() || null } : {}),
          ...(dto.urgency !== undefined ? { urgency: dto.urgency as RequestUrgency } : {}),
          ...(dto.status !== undefined ? { status: dto.status as RequestStatus } : {}),
          ...(dto.assignedToId !== undefined ? { assignedToId: dto.assignedToId || null } : {}),
          ...(dto.dueDate !== undefined ? { dueDate: dto.dueDate ? new Date(dto.dueDate) : null } : {}),
          updatedAt: new Date(),
        },
      });

      return { ok: true };
    });
  }

  async addCandidate(ctx: RequestContext, requestId: string, dto: AddCandidateDto) {
    this.mustWrite(ctx);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const [request, prospect] = await Promise.all([
        db.scoutingRequest.findFirst({ where: { id: requestId }, select: { id: true, status: true } }),
        db.prospect.findFirst({ where: { id: dto.prospectId }, select: { id: true } }),
      ]);
      if (!request) throw new NotFoundException("Pedido não encontrado");
      if (!prospect) throw new NotFoundException("Prospecto não encontrado");

      const existing = await db.scoutingRequestCandidate.findFirst({
        where: { requestId, prospectId: dto.prospectId },
        select: { id: true },
      });
      if (existing) throw new BadRequestException("Já foi proposto para este pedido");

      await db.scoutingRequestCandidate.create({
        data: {
          requestId,
          prospectId: dto.prospectId,
          note: dto.note?.trim() || null,
          addedById: ctx.membershipId,
        },
      });

      // Um pedido com nomes propostos deixou de estar por começar.
      if (request.status === "OPEN") {
        await db.scoutingRequest.update({
          where: { id: requestId },
          data: { status: "IN_PROGRESS", updatedAt: new Date() },
        });
      }

      return { ok: true };
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Recrutamento                                                           */
  /* ---------------------------------------------------------------------- */

  /**
   * Converter um prospecto em atleta.
   *
   * ## O que **não** se faz aqui
   *
   * Não se pede outra vez o nome, a data de nascimento, a modalidade, a posição
   * nem o lado dominante. Já estão no dossiê, foram escritos por quem o
   * acompanhou, e obrigar a reescrevê-los seria a forma mais rápida de perder
   * dados na passagem — e de fazer a academia duvidar de para que serviu o
   * scouting.
   *
   * ## O que se pede
   *
   * A equipa e o NIF. A equipa porque um prospecto não tinha escalão nosso; o NIF
   * porque um atleta sem ele é um atleta que nenhuma família consegue reclamar na
   * app — é obrigatório em toda a inscrição, e um recrutamento é uma inscrição.
   *
   * ## O dossiê fica
   *
   * `Prospect.athleteId` liga os dois, o prospecto passa a `RECRUITED` e o
   * histórico de scouting continua acessível a partir da ficha do atleta. É
   * metade do valor de um recrutamento: daqui a dois anos, saber quem o viu
   * primeiro e o que escreveu.
   */
  async recruit(ctx: RequestContext, prospectId: string, dto: RecruitDto) {
    this.mustWrite(ctx);
    if (!can(ctx, "athlete:write")) {
      throw new ForbiddenException("Recrutar cria um atleta — precisas de permissão para inscrever atletas");
    }

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const p = await db.prospect.findFirst({
        where: { id: prospectId },
        select: {
          id: true, name: true, birthdate: true, position: true, dominantSide: true,
          athleteId: true, sportId: true,
        },
      });
      if (!p) throw new NotFoundException("Prospecto não encontrado");
      if (p.athleteId) throw new BadRequestException("Este prospecto já foi recrutado");

      const team = await db.team.findFirst({
        where: { id: dto.teamId },
        select: { id: true, name: true, sportId: true },
      });
      if (!team) throw new BadRequestException("Equipa não encontrada");
      // Um prospecto de futebol não entra numa equipa de natação — e a confusão
      // seria silenciosa: a ficha nasceria com uma posição que a modalidade não
      // conhece.
      if (team.sportId !== p.sportId) {
        throw new BadRequestException("A equipa é de outra modalidade");
      }

      const taxId = dto.taxId.replace(/[\s.]/g, "");
      if (!/^\d{9}$/.test(taxId)) throw new BadRequestException("O NIF tem nove dígitos");

      let athlete: { id: string; name: string };
      try {
        athlete = await db.athlete.create({
          data: {
            academyId: ctx.academyId,
            name: p.name,
            birthdate: p.birthdate,
            taxId,
            status: "ACTIVE",
            ...(p.dominantSide ? { dominantSide: p.dominantSide as DominantSide } : {}),
            ...(dto.squadNumber != null ? { squadNumber: dto.squadNumber } : {}),
            teams: { create: { teamId: dto.teamId, ...(p.position ? { position: p.position } : {}) } },
          },
          select: { id: true, name: true },
        });
      } catch (error) {
        if (isUniqueViolation(error, "taxId")) {
          throw new BadRequestException("Já existe um atleta com este NIF nesta academia");
        }
        throw error;
      }

      await db.prospect.update({
        where: { id: prospectId },
        data: { athleteId: athlete.id, stage: "RECRUITED", updatedAt: new Date() },
      });

      await db.prospectEvent.create({
        data: {
          prospectId,
          kind: "recruited",
          to: team.name,
          note: dto.note?.trim() || null,
          actorId: ctx.membershipId,
        },
      });

      return { athleteId: athlete.id, name: athlete.name };
    });
  }

  /** O dossiê de scouting de um atleta já recrutado — para a ficha dele. */
  async dossierForAthlete(ctx: RequestContext, athleteId: string) {
    this.mustRead(ctx);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const p = await db.prospect.findFirst({
        where: { athleteId },
        select: {
          id: true, name: true, discoveredAt: true, discoveredVia: true,
          owner: { select: { user: { select: { name: true } } } },
          _count: { select: { observations: true, videos: true } },
        },
      });
      if (!p) return null;

      return {
        prospectId: p.id,
        discoveredAt: p.discoveredAt,
        discoveredVia: p.discoveredVia,
        owner: p.owner?.user.name ?? null,
        observations: p._count.observations,
        videos: p._count.videos,
      };
    });
  }

  /* ---------------------------------------------------------------------- */

  private mustRead(ctx: RequestContext) {
    if (!can(ctx, "scouting:read")) throw new ForbiddenException("Sem acesso ao scouting");
  }

  private mustWrite(ctx: RequestContext) {
    if (!can(ctx, "scouting:write")) throw new ForbiddenException("Sem permissão para escrever no scouting");
  }
}

function isUniqueViolation(error: unknown, field: string): boolean {
  const e = error as { code?: string; meta?: { target?: string[] | string } };
  if (e?.code !== "P2002") return false;
  const target = e.meta?.target;
  return Array.isArray(target) ? target.includes(field) : String(target ?? "").includes(field);
}

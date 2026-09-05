import { randomBytes } from "node:crypto";
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, type LibraryVisibility } from "@prisma/client";
import { PrismaService, type ScopedClient } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";
import { can, inTeamScope, teamScopeFilter, type RequestContext } from "../common/permissions";

/**
 * Imagens de exercícios — montagens no campo, prancheta, quadro branco.
 *
 * Bucket próprio e privado, com o mesmo caminho de três passos das fotografias
 * (autorizar → o browser carrega direto → confirmar): ver `photos.service.ts`
 * para o porquê de cada passo. Aqui não há menores — mas a regra de nunca
 * guardar URLs mantém-se, porque é a mesma disciplina em todo o produto.
 */
export const EXERCISE_BUCKET = "exercicios";
const IMAGE_TTL = 6 * 60 * 60;
const IMAGE_MAX_BYTES = 8 * 1024 * 1024;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
/** Seis chega para "como se monta": mais do que isso é um álbum, não uma ficha. */
const IMAGE_MAX_COUNT = 6;

/**
 * Área técnica — planos de treino, biblioteca de exercícios, modelos de jogo e
 * bolas paradas.
 *
 * ## As três fronteiras, e onde vivem
 *
 * 1. **Permissão** — `training:read` abre a área, `training:write` cria e edita.
 * 2. **Visibilidade** — um exercício `PRIVATE` é do autor e mais ninguém o vê;
 *    `CLUB` é da academia. É decisão de quem cria, gravada na linha, e o filtro
 *    é aplicado **aqui** em todas as leituras — não na interface.
 * 3. **Âmbito** — o plano é da sessão e a sessão é de uma equipa: um treinador
 *    planeia as equipas dele (`teamScopeFilter`), como em tudo o resto. Ler é
 *    mais largo do que escrever, pela mesma razão do calendário: a metodologia
 *    do clube ganha em ver-se.
 *
 * ## Quem edita o que é de outro
 *
 * O autor edita o seu. Por cima dele, só quem vê a academia toda **e** tem
 * `training:write` — direção e coordenação. Um treinador não reescreve o
 * exercício de um colega: duplica-o e fica com a sua versão.
 */
@Injectable()
export class TrainingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /* ------------------------------------------------------------------------ */
  /* Exercícios                                                                */
  /* ------------------------------------------------------------------------ */

  /**
   * A biblioteca — de uma modalidade, quando se pede.
   *
   * `sportId` é o filtro que a Área técnica de cada modalidade usa: o Futebol
   * não vê os drills de lançamento nem o Basquetebol os rondos. Sem filtro vem
   * tudo, que é o que o planner precisa para importar num bloco (a equipa do
   * treino diz a modalidade, e o cliente estreita).
   */
  async listExercises(ctx: RequestContext, sportId?: string) {
    if (!can(ctx, "training:read")) throw new ForbiddenException("Sem acesso à área técnica");

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const rows = await db.exercise.findMany({
        where: { archivedAt: null, ...visibleTo(ctx), ...(sportId ? { sportId } : {}) },
        orderBy: { updatedAt: "desc" },
        select: {
          id: true, name: true, description: true, category: true, objectives: true, phase: true, type: true,
          intensity: true, players: true, durationMin: true, space: true, material: true,
          ageMin: true, ageMax: true, complexity: true, visibility: true, videoUrl: true,
          diagram: true, createdById: true, updatedAt: true, sportId: true,
          createdBy: { select: { user: { select: { name: true } } } },
          favorites: { where: { membershipId: ctx.membershipId }, select: { id: true } },
        },
      });

      /*
       * "Usado 17 vezes · última a 24/08" é derivado dos blocos das sessões, não
       * de um contador guardado: um contador esquece-se de descer quando um
       * treino se apaga, e o histórico real já está na base.
       */
      const usage = await db.sessionBlock.findMany({
        where: { exerciseId: { not: null } },
        select: { exerciseId: true, session: { select: { startsAt: true } } },
      });
      const uses = new Map<string, { count: number; last: Date }>();
      for (const u of usage) {
        if (!u.exerciseId) continue;
        const cur = uses.get(u.exerciseId);
        if (!cur) uses.set(u.exerciseId, { count: 1, last: u.session.startsAt });
        else {
          cur.count++;
          if (u.session.startsAt > cur.last) cur.last = u.session.startsAt;
        }
      }

      return rows.map((e) => ({
        id: e.id,
        name: e.name,
        description: e.description,
        category: e.category,
        objectives: e.objectives,
        phase: e.phase,
        type: e.type,
        intensity: e.intensity,
        players: e.players,
        durationMin: e.durationMin,
        space: e.space,
        material: e.material,
        ageMin: e.ageMin,
        ageMax: e.ageMax,
        complexity: e.complexity,
        visibility: e.visibility,
        videoUrl: e.videoUrl,
        sportId: e.sportId,
        // A lista traz só o primeiro frame — é o que os cartões desenham. O
        // desenho completo, com todos os frames, vem na ficha (`getExercise`).
        thumbnail: thumbnailOf(e.diagram),
        frames: frameCount(e.diagram),
        mine: e.createdById === ctx.membershipId,
        authorName: e.createdBy?.user.name ?? null,
        favorite: e.favorites.length > 0,
        usageCount: uses.get(e.id)?.count ?? 0,
        lastUsedAt: uses.get(e.id)?.last ?? null,
        updatedAt: e.updatedAt,
      }));
    });
  }

  async getExercise(ctx: RequestContext, id: string) {
    if (!can(ctx, "training:read")) throw new ForbiddenException("Sem acesso à área técnica");

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const e = await db.exercise.findFirst({
        where: { id, ...visibleTo(ctx) },
        include: {
          createdBy: { select: { user: { select: { name: true } } } },
          // Onde este exercício entra — os sistemas e as situações que o usam
          // para treinar. Só os que quem lê pode ver.
          gameModelLinks: { where: { gameModel: visibleTo(ctx) }, select: { gameModel: { select: { id: true, name: true } } } },
          setPieceLinks: { where: { setPiece: visibleTo(ctx) }, select: { setPiece: { select: { id: true, name: true } } } },
        },
      });
      if (!e) throw new NotFoundException("Exercício não encontrado");

      // Os links assinados geram-se agora, um por imagem — nunca se guardam.
      const images = await Promise.all(
        e.imageKeys.map(async (key) => ({
          key,
          url: await this.storage.signDownload(EXERCISE_BUCKET, key, IMAGE_TTL),
        })),
      );

      return {
        ...serializeExercise(e),
        images: images.filter((i) => i.url !== null),
        mine: e.createdById === ctx.membershipId,
        editable: this.mayEdit(ctx, e.createdById),
        deletable: this.mayDelete(ctx, e.createdById),
        usedIn: {
          gameModels: e.gameModelLinks.map((l) => l.gameModel),
          setPieces: e.setPieceLinks.map((l) => l.setPiece),
        },
      };
    });
  }

  /* ------------------------------------------------------------------------ */
  /* Imagens de exercício                                                      */
  /* ------------------------------------------------------------------------ */

  /** Passo 1: a autorização — um endereço assinado para uma chave nossa. */
  async imageUploadUrl(ctx: RequestContext, exerciseId: string, contentType: string) {
    if (!IMAGE_TYPES.includes(contentType)) {
      throw new BadRequestException("A imagem tem de ser JPEG, PNG ou WebP");
    }
    await this.assertExerciseEditable(ctx, exerciseId);
    await this.storage.ensureBucket({
      name: EXERCISE_BUCKET,
      fileSizeLimit: IMAGE_MAX_BYTES,
      allowedMimeTypes: IMAGE_TYPES,
    });

    const ext = contentType === "image/png" ? ".png" : contentType === "image/webp" ? ".webp" : ".jpg";
    const key = `exercicios/${exerciseId}/${randomBytes(8).toString("hex")}${ext}`;
    const signed = await this.storage.signUpload(EXERCISE_BUCKET, key);
    return { ...signed, key, maxBytes: IMAGE_MAX_BYTES };
  }

  /** Passo 3: confirmar que o ficheiro chegou e juntar a chave à ficha. */
  async addImage(ctx: RequestContext, exerciseId: string, key: string) {
    await this.assertExerciseEditable(ctx, exerciseId);

    // A chave tem de ser deste exercício — uma autorização não aponta a ficha
    // de outro para a mesma imagem. Mesma regra das fotografias.
    if (!key.startsWith(`exercicios/${exerciseId}/`)) throw new BadRequestException("Chave inválida");
    if (!(await this.storage.exists(EXERCISE_BUCKET, key))) {
      throw new BadRequestException("O ficheiro não chegou ao armazenamento");
    }

    await this.prisma.runAs(ctx.academyId, async (db) => {
      const e = await db.exercise.findFirst({ where: { id: exerciseId }, select: { imageKeys: true } });
      if (!e) throw new NotFoundException("Exercício não encontrado");
      if (e.imageKeys.length >= IMAGE_MAX_COUNT) {
        throw new BadRequestException(`Um exercício leva no máximo ${IMAGE_MAX_COUNT} imagens`);
      }
      if (!e.imageKeys.includes(key)) {
        await db.exercise.update({ where: { id: exerciseId }, data: { imageKeys: [...e.imageKeys, key] } });
      }
    });

    return { key, url: await this.storage.signDownload(EXERCISE_BUCKET, key, IMAGE_TTL) };
  }

  async removeImage(ctx: RequestContext, exerciseId: string, key: string) {
    await this.assertExerciseEditable(ctx, exerciseId);

    const had = await this.prisma.runAs(ctx.academyId, async (db) => {
      const e = await db.exercise.findFirst({ where: { id: exerciseId }, select: { imageKeys: true } });
      if (!e) throw new NotFoundException("Exercício não encontrado");
      if (!e.imageKeys.includes(key)) return false;
      await db.exercise.update({
        where: { id: exerciseId },
        data: { imageKeys: e.imageKeys.filter((k) => k !== key) },
      });
      return true;
    });

    // Rede fora da transação — a lição de `setAthletePhoto`.
    if (had) await this.storage.remove(EXERCISE_BUCKET, key);
    return { ok: true };
  }

  /** Editar imagens é editar o exercício: mesma porta, mesma autoria. */
  private async assertExerciseEditable(ctx: RequestContext, exerciseId: string) {
    if (!can(ctx, "training:write")) throw new ForbiddenException("Sem permissão para editar exercícios");
    const e = await this.prisma.runAs(ctx.academyId, (db) =>
      db.exercise.findFirst({ where: { id: exerciseId, ...visibleTo(ctx) }, select: { createdById: true } }),
    );
    if (!e) throw new NotFoundException("Exercício não encontrado");
    if (!this.mayEdit(ctx, e.createdById)) throw new ForbiddenException("Este exercício é de outro treinador");
  }

  async createExercise(ctx: RequestContext, dto: ExerciseInput) {
    if (!can(ctx, "training:write")) throw new ForbiddenException("Sem permissão para criar exercícios");
    checkDiagram(dto.diagram);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      await this.checkSport(db, dto.sportId);
      const e = await db.exercise.create({
        // O cast é só para o spread: `exerciseData` devolve as chaves certas mas
        // o TypeScript não vê `name` através de um Record.
        data: {
          academyId: ctx.academyId,
          createdById: ctx.membershipId,
          sportId: dto.sportId || null,
          ...exerciseData(dto),
        } as Prisma.ExerciseUncheckedCreateInput,
      });
      return { id: e.id };
    });
  }

  async updateExercise(ctx: RequestContext, id: string, dto: Partial<ExerciseInput>) {
    if (!can(ctx, "training:write")) throw new ForbiddenException("Sem permissão para editar exercícios");
    checkDiagram(dto.diagram);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const e = await db.exercise.findFirst({ where: { id }, select: { createdById: true, visibility: true } });
      if (!e) throw new NotFoundException("Exercício não encontrado");
      if (!this.mayEdit(ctx, e.createdById)) {
        throw new ForbiddenException("Este exercício é de outro treinador — duplica-o para o adaptar");
      }
      // Um exercício privado de outra pessoa nem devia ter chegado aqui.
      if (e.visibility === "PRIVATE" && e.createdById !== ctx.membershipId && !academyWide(ctx)) {
        throw new NotFoundException("Exercício não encontrado");
      }
      if (dto.sportId !== undefined) await this.checkSport(db, dto.sportId);

      await db.exercise.update({
        where: { id },
        data: {
          ...(exerciseData(dto, true) as Prisma.ExerciseUncheckedUpdateInput),
          ...(dto.sportId !== undefined ? { sportId: dto.sportId || null } : {}),
        },
      });
      return { ok: true };
    });
  }

  /**
   * Arquiva em vez de apagar quando o exercício já entrou em treinos: o
   * histórico das sessões aponta para ele, e um treino de Março que perde o
   * exercício é um relatório que deixa de se perceber. Sem utilizações, apaga-se
   * a sério — um rascunho não é histórico.
   */
  async deleteExercise(ctx: RequestContext, id: string) {
    if (!can(ctx, "training:write")) throw new ForbiddenException("Sem permissão");

    const result = await this.prisma.runAs(ctx.academyId, async (db) => {
      const e = await db.exercise.findFirst({ where: { id }, select: { createdById: true, imageKeys: true } });
      if (!e) throw new NotFoundException("Exercício não encontrado");
      if (!this.mayDelete(ctx, e.createdById)) {
        throw new ForbiddenException("Este exercício é do clube — só a direção o pode apagar");
      }

      const used = await db.sessionBlock.count({ where: { exerciseId: id } });
      if (used > 0) {
        await db.exercise.update({ where: { id }, data: { archivedAt: new Date() } });
        return { archived: true, imageKeys: [] as string[] };
      }
      await db.exercise.delete({ where: { id } });
      return { archived: false, imageKeys: e.imageKeys };
    });

    // Apagado a sério, as imagens deixam de ter dono — limpam-se, senão o
    // armazenamento enche-se de ficheiros que ninguém sabe que lá estão.
    for (const key of result.imageKeys) await this.storage.remove(EXERCISE_BUCKET, key);
    return { archived: result.archived };
  }

  /** A cópia nasce privada e do próprio: é a versão dele, não a do clube. */
  async duplicateExercise(ctx: RequestContext, id: string) {
    if (!can(ctx, "training:write")) throw new ForbiddenException("Sem permissão para criar exercícios");

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const e = await db.exercise.findFirst({ where: { id, ...visibleTo(ctx) } });
      if (!e) throw new NotFoundException("Exercício não encontrado");

      const copy = await db.exercise.create({
        data: {
          academyId: ctx.academyId,
          createdById: ctx.membershipId,
          sportId: e.sportId,
          visibility: "PRIVATE",
          name: `${e.name} (cópia)`,
          description: e.description, category: e.category, objectives: e.objectives,
          phase: e.phase, type: e.type, intensity: e.intensity, players: e.players,
          durationMin: e.durationMin, space: e.space, material: e.material,
          ageMin: e.ageMin, ageMax: e.ageMax, complexity: e.complexity,
          rules: e.rules, progressions: e.progressions, regressions: e.regressions,
          coachingPoints: e.coachingPoints, commonErrors: e.commonErrors,
          videoUrl: e.videoUrl,
          diagram: e.diagram === null ? Prisma.JsonNull : (e.diagram as Prisma.InputJsonValue),
        },
      });
      return { id: copy.id };
    });
  }

  async setFavorite(ctx: RequestContext, id: string, on: boolean) {
    if (!can(ctx, "training:read")) throw new ForbiddenException("Sem acesso à área técnica");

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const e = await db.exercise.findFirst({ where: { id, ...visibleTo(ctx) }, select: { id: true } });
      if (!e) throw new NotFoundException("Exercício não encontrado");

      if (on) {
        await db.exerciseFavorite.upsert({
          where: { exerciseId_membershipId: { exerciseId: id, membershipId: ctx.membershipId } },
          create: { exerciseId: id, membershipId: ctx.membershipId },
          update: {},
        });
      } else {
        await db.exerciseFavorite.deleteMany({ where: { exerciseId: id, membershipId: ctx.membershipId } });
      }
      return { ok: true };
    });
  }

  /* ------------------------------------------------------------------------ */
  /* Planos de treino                                                          */
  /* ------------------------------------------------------------------------ */

  /**
   * Os resumos de plano num intervalo — o que o planner e a semana desenham.
   *
   * Uma linha por sessão **planeada** (com blocos ou objetivo): as sessões em si
   * já vêm de `GET /api/sessions`, e repetir aqui o quê/quando/onde era a mesma
   * coisa dita duas vezes. Isto acrescenta só o que o plano sabe: minutos,
   * carga, distribuição por objetivo.
   */
  async listPlans(ctx: RequestContext, from: Date, to: Date) {
    if (!can(ctx, "training:read")) throw new ForbiddenException("Sem acesso à área técnica");

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const rows = await db.trainingSession.findMany({
        where: {
          startsAt: { gte: from, lte: to },
          OR: [{ objective: { not: null } }, { blocks: { some: {} } }],
        },
        select: {
          id: true, teamId: true, startsAt: true, intensity: true, objective: true, sessionType: true,
          blocks: { select: { durationMin: true, intensity: true, category: true } },
        },
      });

      return rows.map((s) => ({
        sessionId: s.id,
        teamId: s.teamId,
        objective: s.objective,
        sessionType: s.sessionType,
        intensity: s.intensity,
        blockCount: s.blocks.length,
        blocks: s.blocks.map((b) => ({ durationMin: b.durationMin, intensity: b.intensity, category: b.category })),
      }));
    });
  }

  async getPlan(ctx: RequestContext, sessionId: string) {
    if (!can(ctx, "training:read")) throw new ForbiddenException("Sem acesso à área técnica");

    return this.prisma.runAs(ctx.academyId, (db) => this.lerPlano(db, ctx, sessionId));
  }

  /**
   * O plano, lido numa transacção que já está aberta.
   *
   * Separado de `getPlan` por causa do `applyTemplate`, que quer devolver o
   * plano acabado de aplicar. Chamar `getPlan` de dentro de um `runAs` abria uma
   * **segunda** transacção — e portanto uma segunda ligação — com a primeira
   * ainda de pé: com `connection_limit=5`, cinco treinadores a aplicarem um
   * modelo ao mesmo tempo tomavam as cinco ligações e ficavam todos à espera de
   * uma sexta que não existe. É o P2028 que já nos mordeu noutro sítio.
   */
  private async lerPlano(db: ScopedClient, ctx: RequestContext, sessionId: string) {
    const s = await db.trainingSession.findFirst({
      where: { id: sessionId },
      select: {
        id: true, teamId: true, startsAt: true, endsAt: true, venue: true, status: true,
        objective: true, objectives: true, sessionType: true, intensity: true,
        expectedAthletes: true, material: true, planNotes: true, postNotes: true,
        team: { select: { name: true } },
        coach: { select: { user: { select: { name: true } } } },
        blocks: {
          orderBy: { order: "asc" },
          select: {
            id: true, order: true, name: true, durationMin: true, category: true, objective: true,
            intensity: true, players: true, space: true, material: true, notes: true,
            exerciseId: true,
            exercise: { select: { id: true, name: true, diagram: true, visibility: true, createdById: true } },
          },
        },
      },
    });
    if (!s) throw new NotFoundException("Treino não encontrado");

    return {
      sessionId: s.id,
      teamId: s.teamId,
      teamName: s.team.name,
      startsAt: s.startsAt,
      endsAt: s.endsAt,
      venue: s.venue,
      status: s.status,
      coachName: s.coach?.user.name ?? null,
      mine: inTeamScope(ctx, s.teamId),
      objective: s.objective,
      objectives: s.objectives,
      sessionType: s.sessionType,
      intensity: s.intensity,
      expectedAthletes: s.expectedAthletes,
      material: s.material,
      planNotes: s.planNotes,
      postNotes: s.postNotes,
      blocks: s.blocks.map((b) => ({
        id: b.id,
        order: b.order,
        name: b.name,
        durationMin: b.durationMin,
        category: b.category,
        objective: b.objective,
        intensity: b.intensity,
        players: b.players,
        space: b.space,
        material: b.material,
        notes: b.notes,
        exerciseId: b.exerciseId,
        // Um exercício privado de outra pessoa dentro de um plano partilhado:
        // o nome do bloco chega (é do plano), a miniatura não.
        exerciseName: b.exercise && exerciseVisible(ctx, b.exercise) ? b.exercise.name : null,
        exerciseThumb: b.exercise && exerciseVisible(ctx, b.exercise) ? thumbnailOf(b.exercise.diagram) : null,
      })),
    };
  }

  /**
   * Grava o plano — os campos da sessão e os blocos, de uma vez.
   *
   * Os blocos substituem-se por inteiro: o editor trabalha na lista completa
   * (reordenar, apagar, inserir a meio), e reconciliar diffs de ordem no
   * servidor era complexidade a troco de nada numa lista de meia dúzia.
   */
  async savePlan(ctx: RequestContext, sessionId: string, dto: PlanInput) {
    if (!can(ctx, "training:write")) throw new ForbiddenException("Sem permissão para planear treinos");

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const s = await db.trainingSession.findFirst({ where: { id: sessionId }, select: { teamId: true } });
      if (!s) throw new NotFoundException("Treino não encontrado");

      // O âmbito de escrita: um treinador planeia as equipas dele.
      const scope = teamScopeFilter(ctx);
      if (scope && !scope.in.includes(s.teamId)) {
        throw new ForbiddenException("Este treino é de uma equipa fora do teu âmbito");
      }

      // Os exercícios referidos têm de existir e de ser visíveis a quem planeia
      // — senão um id chutado punha um exercício privado alheio num plano.
      const exerciseIds = [...new Set((dto.blocks ?? []).map((b) => b.exerciseId).filter((x): x is string => !!x))];
      if (exerciseIds.length > 0) {
        const found = await db.exercise.count({ where: { id: { in: exerciseIds }, ...visibleTo(ctx) } });
        if (found !== exerciseIds.length) throw new BadRequestException("Exercício desconhecido no plano");
      }

      await db.trainingSession.update({
        where: { id: sessionId },
        data: {
          objective: dto.objective?.trim() || null,
          objectives: (dto.objectives ?? []).map((o) => o.trim()).filter(Boolean).slice(0, 12),
          sessionType: dto.sessionType?.trim() || null,
          intensity: clampOrNull(dto.intensity, 1, 10),
          expectedAthletes: clampOrNull(dto.expectedAthletes, 0, 99),
          material: dto.material?.trim() || null,
          planNotes: dto.planNotes?.trim() || null,
          ...(dto.postNotes !== undefined ? { postNotes: dto.postNotes?.trim() || null } : {}),
        },
      });

      if (dto.blocks) {
        await db.sessionBlock.deleteMany({ where: { sessionId } });
        if (dto.blocks.length > 0) {
          await db.sessionBlock.createMany({
            data: dto.blocks.slice(0, 30).map((b, i) => ({
              academyId: ctx.academyId,
              sessionId,
              order: i,
              name: b.name.trim().slice(0, 80) || `Bloco ${i + 1}`,
              durationMin: Math.max(1, Math.min(240, Math.round(b.durationMin))),
              category: b.category?.trim() || null,
              objective: b.objective?.trim() || null,
              intensity: clampOrNull(b.intensity, 1, 10),
              players: b.players?.trim() || null,
              space: b.space?.trim() || null,
              material: b.material?.trim() || null,
              notes: b.notes?.trim() || null,
              exerciseId: b.exerciseId || null,
            })),
          });
        }
      }

      return { ok: true };
    });
  }

  /* ------------------------------------------------------------------------ */
  /* Modelos de jogo                                                           */
  /* ------------------------------------------------------------------------ */

  async listGameModels(ctx: RequestContext, sportId?: string) {
    if (!can(ctx, "training:read")) throw new ForbiddenException("Sem acesso à área técnica");

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const rows = await db.gameModel.findMany({
        where: { ...visibleTo(ctx), ...(sportId ? { sportId } : {}) },
        orderBy: { updatedAt: "desc" },
        include: {
          team: { select: { name: true } },
          createdBy: { select: { user: { select: { name: true } } } },
          exercises: {
            where: { exercise: { archivedAt: null, ...visibleTo(ctx) } },
            select: { exercise: { select: { id: true, name: true } } },
          },
        },
      });
      return rows.map((m) => ({
        id: m.id,
        name: m.name,
        kind: m.kind,
        system: m.system,
        teamId: m.teamId,
        teamName: m.team?.name ?? null,
        sportId: m.sportId,
        visibility: m.visibility,
        lineup: m.lineup,
        principles: m.principles,
        notes: m.notes,
        exercises: m.exercises.map((l) => l.exercise),
        mine: m.createdById === ctx.membershipId,
        editable: this.mayEdit(ctx, m.createdById),
        deletable: this.mayDelete(ctx, m.createdById),
        authorName: m.createdBy?.user.name ?? null,
        updatedAt: m.updatedAt,
      }));
    });
  }

  async createGameModel(ctx: RequestContext, dto: GameModelInput) {
    if (!can(ctx, "training:write")) throw new ForbiddenException("Sem permissão para criar modelos de jogo");
    checkDiagram(dto.lineup);
    checkDiagram(dto.principles);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      await this.checkTeam(ctx, db, dto.teamId);
      await this.checkSport(db, dto.sportId);
      const exerciseIds = await this.checkExercises(ctx, db, dto.exerciseIds);
      const m = await db.gameModel.create({
        data: {
          academyId: ctx.academyId,
          createdById: ctx.membershipId,
          teamId: dto.teamId || null,
          sportId: dto.sportId || null,
          visibility: visibilityOf(dto.visibility),
          name: dto.name.trim().slice(0, 80),
          kind: dto.kind?.trim().slice(0, 40) || null,
          system: dto.system?.trim() || null,
          lineup: json(dto.lineup),
          principles: json(dto.principles),
          notes: dto.notes?.trim() || null,
          ...(exerciseIds ? { exercises: { create: exerciseIds.map((exerciseId) => ({ exerciseId })) } } : {}),
        },
      });
      return { id: m.id };
    });
  }

  async updateGameModel(ctx: RequestContext, id: string, dto: Partial<GameModelInput>) {
    if (!can(ctx, "training:write")) throw new ForbiddenException("Sem permissão para editar modelos de jogo");
    checkDiagram(dto.lineup);
    checkDiagram(dto.principles);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const m = await db.gameModel.findFirst({ where: { id }, select: { createdById: true } });
      if (!m) throw new NotFoundException("Modelo não encontrado");
      if (!this.mayEdit(ctx, m.createdById)) throw new ForbiddenException("Este modelo é de outra pessoa");
      if (dto.teamId !== undefined) await this.checkTeam(ctx, db, dto.teamId);
      if (dto.sportId !== undefined) await this.checkSport(db, dto.sportId);
      const exerciseIds = await this.checkExercises(ctx, db, dto.exerciseIds);

      await db.gameModel.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name.trim().slice(0, 80) } : {}),
          ...(dto.kind !== undefined ? { kind: dto.kind?.trim().slice(0, 40) || null } : {}),
          ...(dto.system !== undefined ? { system: dto.system?.trim() || null } : {}),
          ...(dto.teamId !== undefined ? { teamId: dto.teamId || null } : {}),
          ...(dto.sportId !== undefined ? { sportId: dto.sportId || null } : {}),
          ...(dto.visibility !== undefined ? { visibility: visibilityOf(dto.visibility) } : {}),
          ...(dto.lineup !== undefined ? { lineup: json(dto.lineup) } : {}),
          ...(dto.principles !== undefined ? { principles: json(dto.principles) } : {}),
          ...(dto.notes !== undefined ? { notes: dto.notes?.trim() || null } : {}),
          // A lista substitui-se inteira: é o que o ecrã envia, e um "junta
          // este" que não soubesse dos outros criava duplicados ou perdas.
          ...(exerciseIds
            ? { exercises: { deleteMany: {}, create: exerciseIds.map((exerciseId) => ({ exerciseId })) } }
            : {}),
        },
      });
      return { ok: true };
    });
  }

  async deleteGameModel(ctx: RequestContext, id: string) {
    if (!can(ctx, "training:write")) throw new ForbiddenException("Sem permissão");
    return this.prisma.runAs(ctx.academyId, async (db) => {
      const m = await db.gameModel.findFirst({ where: { id }, select: { createdById: true } });
      if (!m) throw new NotFoundException("Modelo não encontrado");
      if (!this.mayDelete(ctx, m.createdById)) throw new ForbiddenException("Este modelo é de outra pessoa");
      await db.gameModel.delete({ where: { id } });
      return { ok: true };
    });
  }

  /* ------------------------------------------------------------------------ */
  /* Bolas paradas                                                             */
  /* ------------------------------------------------------------------------ */

  async listSetPieces(ctx: RequestContext, sportId?: string) {
    if (!can(ctx, "training:read")) throw new ForbiddenException("Sem acesso à área técnica");

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const rows = await db.setPiece.findMany({
        where: { ...visibleTo(ctx), ...(sportId ? { sportId } : {}) },
        orderBy: { updatedAt: "desc" },
        include: {
          team: { select: { name: true } },
          createdBy: { select: { user: { select: { name: true } } } },
          gameModel: { select: { id: true, name: true, visibility: true, createdById: true } },
          exercises: {
            where: { exercise: { archivedAt: null, ...visibleTo(ctx) } },
            select: { exercise: { select: { id: true, name: true } } },
          },
        },
      });
      return rows.map((p) => {
        // Um sistema privado de outra pessoa não se nomeia — a ligação existe,
        // mas para quem lê é como se não estivesse lá.
        const gm = p.gameModel && exerciseVisible(ctx, p.gameModel) ? p.gameModel : null;
        return {
          id: p.id,
          kind: p.kind,
          name: p.name,
          description: p.description,
          teamId: p.teamId,
          teamName: p.team?.name ?? null,
          sportId: p.sportId,
          gameModelId: gm?.id ?? null,
          gameModelName: gm?.name ?? null,
          visibility: p.visibility,
          diagram: p.diagram,
          exercises: p.exercises.map((l) => l.exercise),
          mine: p.createdById === ctx.membershipId,
          editable: this.mayEdit(ctx, p.createdById),
          deletable: this.mayDelete(ctx, p.createdById),
          authorName: p.createdBy?.user.name ?? null,
          updatedAt: p.updatedAt,
        };
      });
    });
  }

  async createSetPiece(ctx: RequestContext, dto: SetPieceInput) {
    if (!can(ctx, "training:write")) throw new ForbiddenException("Sem permissão para criar bolas paradas");
    checkDiagram(dto.diagram);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      await this.checkTeam(ctx, db, dto.teamId);
      await this.checkSport(db, dto.sportId);
      await this.checkGameModel(ctx, db, dto.gameModelId);
      const exerciseIds = await this.checkExercises(ctx, db, dto.exerciseIds);
      const p = await db.setPiece.create({
        data: {
          academyId: ctx.academyId,
          createdById: ctx.membershipId,
          teamId: dto.teamId || null,
          sportId: dto.sportId || null,
          gameModelId: dto.gameModelId || null,
          visibility: visibilityOf(dto.visibility),
          kind: dto.kind.trim().slice(0, 40),
          name: dto.name.trim().slice(0, 80),
          description: dto.description?.trim() || null,
          diagram: json(dto.diagram),
          ...(exerciseIds ? { exercises: { create: exerciseIds.map((exerciseId) => ({ exerciseId })) } } : {}),
        },
      });
      return { id: p.id };
    });
  }

  async updateSetPiece(ctx: RequestContext, id: string, dto: Partial<SetPieceInput>) {
    if (!can(ctx, "training:write")) throw new ForbiddenException("Sem permissão para editar bolas paradas");
    checkDiagram(dto.diagram);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const p = await db.setPiece.findFirst({ where: { id }, select: { createdById: true } });
      if (!p) throw new NotFoundException("Esquema não encontrado");
      if (!this.mayEdit(ctx, p.createdById)) throw new ForbiddenException("Este esquema é de outra pessoa");
      if (dto.teamId !== undefined) await this.checkTeam(ctx, db, dto.teamId);
      if (dto.sportId !== undefined) await this.checkSport(db, dto.sportId);
      if (dto.gameModelId !== undefined) await this.checkGameModel(ctx, db, dto.gameModelId);
      const exerciseIds = await this.checkExercises(ctx, db, dto.exerciseIds);

      await db.setPiece.update({
        where: { id },
        data: {
          ...(dto.kind !== undefined ? { kind: dto.kind.trim().slice(0, 40) } : {}),
          ...(dto.name !== undefined ? { name: dto.name.trim().slice(0, 80) } : {}),
          ...(dto.description !== undefined ? { description: dto.description?.trim() || null } : {}),
          ...(dto.teamId !== undefined ? { teamId: dto.teamId || null } : {}),
          ...(dto.sportId !== undefined ? { sportId: dto.sportId || null } : {}),
          ...(dto.gameModelId !== undefined ? { gameModelId: dto.gameModelId || null } : {}),
          ...(dto.visibility !== undefined ? { visibility: visibilityOf(dto.visibility) } : {}),
          ...(dto.diagram !== undefined ? { diagram: json(dto.diagram) } : {}),
          ...(exerciseIds
            ? { exercises: { deleteMany: {}, create: exerciseIds.map((exerciseId) => ({ exerciseId })) } }
            : {}),
        },
      });
      return { ok: true };
    });
  }

  /* ------------------------------------------------------------------------ */
  /* A área técnica de uma modalidade, em números                              */
  /* ------------------------------------------------------------------------ */

  /**
   * Os três contadores da página de entrada — "24 exercícios · 8 sistemas · 12
   * situações". Contados com a mesma visibilidade das listas, senão a página
   * prometia um número e a lista mostrava outro.
   */
  async summary(ctx: RequestContext, sportId: string) {
    if (!can(ctx, "training:read")) throw new ForbiddenException("Sem acesso à área técnica");

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const [exercises, gameModels, setPieces] = await Promise.all([
        db.exercise.count({ where: { sportId, archivedAt: null, ...visibleTo(ctx) } }),
        db.gameModel.count({ where: { sportId, ...visibleTo(ctx) } }),
        db.setPiece.count({ where: { sportId, ...visibleTo(ctx) } }),
      ]);
      return { exercises, gameModels, setPieces };
    });
  }

  async deleteSetPiece(ctx: RequestContext, id: string) {
    if (!can(ctx, "training:write")) throw new ForbiddenException("Sem permissão");
    return this.prisma.runAs(ctx.academyId, async (db) => {
      const p = await db.setPiece.findFirst({ where: { id }, select: { createdById: true } });
      if (!p) throw new NotFoundException("Esquema não encontrado");
      if (!this.mayDelete(ctx, p.createdById)) throw new ForbiddenException("Este esquema é de outra pessoa");
      await db.setPiece.delete({ where: { id } });
      return { ok: true };
    });
  }

  /* ------------------------------------------------------------------------ */

  /**
   * O autor edita o seu; por cima, quem vê a academia toda com `training:write`.
   *
   * **Sem autor é do clube** — a biblioteca semeada e o que ficar de quem saiu.
   * Qualquer treinador o afina (corrigir uma distância, ajustar o desenho ao
   * escalão dele): não há autoria de ninguém a proteger. Apagar é outra coisa —
   * ver `mayDelete`.
   */
  private mayEdit(ctx: RequestContext, createdById: string | null): boolean {
    if (createdById === null) return true;
    if (createdById === ctx.membershipId) return true;
    return academyWide(ctx);
  }

  /**
   * Apagar é mais estreito do que editar: o próprio apaga o seu, e o que é do
   * clube (sem autor) só sai pela mão de quem responde pelo clube inteiro —
   * senão um treinador limpava a biblioteca comum num gesto.
   */
  private mayDelete(ctx: RequestContext, createdById: string | null): boolean {
    if (createdById !== null && createdById === ctx.membershipId) return true;
    return academyWide(ctx);
  }

  /** Uma equipa referida tem de existir e de estar no âmbito de quem escreve. */
  private async checkTeam(ctx: RequestContext, db: ScopedClient, teamId: string | null | undefined) {
    if (!teamId) return;
    const scope = teamScopeFilter(ctx);
    if (scope && !scope.in.includes(teamId)) throw new ForbiddenException("Equipa fora do teu âmbito");
    const team = await db.team.findFirst({ where: { id: teamId }, select: { id: true } });
    if (!team) throw new BadRequestException("Equipa desconhecida");
  }

  /** A modalidade tem de ser do clube — o RLS já garante; isto dá a mensagem. */
  private async checkSport(db: ScopedClient, sportId: string | null | undefined) {
    if (!sportId) return;
    const sport = await db.sport.findFirst({ where: { id: sportId }, select: { id: true } });
    if (!sport) throw new BadRequestException("Modalidade desconhecida");
  }

  /** O sistema de jogo de que uma situação parte: tem de existir e ser visível. */
  private async checkGameModel(ctx: RequestContext, db: ScopedClient, gameModelId: string | null | undefined) {
    if (!gameModelId) return;
    const gm = await db.gameModel.findFirst({ where: { id: gameModelId, ...visibleTo(ctx) }, select: { id: true } });
    if (!gm) throw new BadRequestException("Sistema de jogo desconhecido");
  }

  /**
   * Os exercícios a ligar: todos têm de existir, estar vivos e ser visíveis a
   * quem liga — ligar o exercício privado de um colega revelava-lhe o nome.
   * Devolve a lista limpa (sem repetidos) ou `undefined` quando não veio nada,
   * para o chamador distinguir "não mexer" de "esvaziar".
   */
  private async checkExercises(ctx: RequestContext, db: ScopedClient, ids: string[] | undefined): Promise<string[] | undefined> {
    if (ids === undefined) return undefined;
    const unique = [...new Set(ids.filter(Boolean))].slice(0, 40);
    if (unique.length === 0) return [];
    const found = await db.exercise.findMany({
      where: { id: { in: unique }, archivedAt: null, ...visibleTo(ctx) },
      select: { id: true },
    });
    if (found.length !== unique.length) throw new BadRequestException("Há exercícios que não existem ou não são visíveis");
    return unique;
  }

  /* ------------------------------------------------------------------------ */
  /* Modelos de treino                                                        */
  /* ------------------------------------------------------------------------ */

  /**
   * Os modelos que esta pessoa pode usar.
   *
   * A mesma regra de visibilidade da biblioteca (`visibleTo`): os do clube e os
   * meus. Ordenados pelo que se usa mais e não pelo que se criou primeiro — ao
   * fim de uma época, a lista tem trinta e a que interessa é a de terça-feira.
   */
  async listTemplates(ctx: RequestContext) {
    if (!can(ctx, "training:read")) throw new ForbiddenException("Sem acesso à área técnica");

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const rows = await db.sessionTemplate.findMany({
        where: visibleTo(ctx),
        orderBy: [{ useCount: "desc" }, { updatedAt: "desc" }],
        select: {
          id: true, name: true, visibility: true, createdById: true,
          objective: true, objectives: true, sessionType: true, intensity: true,
          expectedAthletes: true, material: true, planNotes: true,
          useCount: true, lastUsedAt: true, updatedAt: true,
          createdBy: { select: { user: { select: { name: true } } } },
          blocks: {
            orderBy: { order: "asc" },
            select: {
              order: true, name: true, durationMin: true, category: true, objective: true,
              intensity: true, players: true, notes: true, exerciseId: true,
              exercise: { select: { name: true } },
            },
          },
        },
      });

      return rows.map((t) => ({
        id: t.id,
        name: t.name,
        visibility: t.visibility,
        objective: t.objective,
        objectives: t.objectives,
        sessionType: t.sessionType,
        intensity: t.intensity,
        expectedAthletes: t.expectedAthletes,
        material: t.material,
        planNotes: t.planNotes,
        useCount: t.useCount,
        lastUsedAt: t.lastUsedAt,
        updatedAt: t.updatedAt,
        authorName: t.createdBy?.user.name ?? null,
        mine: t.createdById === ctx.membershipId,
        /* O que a lista mostra sem abrir: quantos blocos e quanto tempo. */
        blockCount: t.blocks.length,
        totalMin: t.blocks.reduce((n, b) => n + b.durationMin, 0),
        blocks: t.blocks.map((b) => ({
          name: b.name,
          durationMin: b.durationMin,
          category: b.category,
          objective: b.objective,
          intensity: b.intensity,
          players: b.players,
          notes: b.notes,
          exerciseId: b.exerciseId,
          exerciseName: b.exercise?.name ?? null,
        })),
      }));
    });
  }

  /**
   * Guardar o plano de uma sessão como modelo.
   *
   * ## O que se copia, e o que fica para trás
   *
   * Vai o **plano**: objectivo, tipo, intensidade, material, notas e os blocos
   * por ordem. Não vai a data, a equipa, o local nem as notas do pós-treino —
   * essas são daquele treino, daquele dia, e num modelo seriam mentira na
   * primeira vez que fosse aplicado.
   *
   * ## "Garante que não existe já"
   *
   * Duas verificações, porque são duas perguntas diferentes:
   *
   *  1. **O nome já está tomado.** Recusa-se e diz-se qual. O índice único da
   *     base fica como rede — duas gravações ao mesmo tempo passariam as duas
   *     por esta verificação e uma delas rebentaria com um erro do Postgres que
   *     ninguém percebe.
   *
   *  2. **O conteúdo já está guardado com outro nome.** É o caso que interessa
   *     a sério: um treinador que carrega em "guardar como modelo" duas semanas
   *     seguidas no mesmo treino fica com dois modelos iguais e nomes
   *     diferentes, e a lista deixa de servir para escolher. Diz-se-lhe qual é o
   *     que já existe, em vez de fazer o gémeo em silêncio.
   */
  async saveTemplate(
    ctx: RequestContext,
    sessionId: string,
    dto: { name: string; visibility?: LibraryVisibility },
  ) {
    if (!can(ctx, "training:write")) throw new ForbiddenException("Sem permissão para planear treinos");

    const name = dto.name.trim();
    if (name.length < 2) throw new BadRequestException("O modelo precisa de um nome");

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const s = await db.trainingSession.findFirst({
        where: { id: sessionId },
        select: {
          teamId: true,
          objective: true, objectives: true, sessionType: true, intensity: true,
          expectedAthletes: true, material: true, planNotes: true,
          blocks: {
            orderBy: { order: "asc" },
            select: {
              name: true, durationMin: true, category: true, objective: true,
              intensity: true, players: true, notes: true, exerciseId: true,
            },
          },
        },
      });
      if (!s) throw new NotFoundException("Treino não encontrado");

      const scope = teamScopeFilter(ctx);
      if (scope && !scope.in.includes(s.teamId)) {
        throw new ForbiddenException("Este treino é de uma equipa fora do teu âmbito");
      }

      /*
       * Um plano vazio não é um modelo.
       *
       * Guardar "sem blocos" dá uma linha na lista que, aplicada, apaga o plano
       * de quem a escolher. É mais fácil recusar do que explicar isso depois.
       */
      if (s.blocks.length === 0) {
        throw new BadRequestException("Este treino ainda não tem blocos — monta o plano antes de o guardar");
      }

      const repetido = await db.sessionTemplate.findFirst({
        where: { name },
        select: { id: true },
      });
      if (repetido) {
        throw new ConflictException(`Já existe um modelo chamado "${name}". Escolhe outro nome.`);
      }

      /* O mesmo plano com outro nome — ver a nota do método. */
      const existentes = await db.sessionTemplate.findMany({
        where: visibleTo(ctx),
        select: {
          id: true, name: true, objective: true, sessionType: true,
          blocks: {
            orderBy: { order: "asc" },
            select: { name: true, durationMin: true, category: true, exerciseId: true },
          },
        },
      });
      const assinatura = assinaturaDoPlano(s);
      const gemeo = existentes.find((t) => assinaturaDoPlano(t) === assinatura);
      if (gemeo) {
        throw new ConflictException(
          `Este plano já está guardado como "${gemeo.name}" — usa esse em vez de criar outro igual.`,
        );
      }

      const criado = await db.sessionTemplate.create({
        data: {
          academyId: ctx.academyId,
          createdById: ctx.membershipId,
          visibility: dto.visibility ?? "CLUB",
          name,
          objective: s.objective,
          objectives: s.objectives,
          sessionType: s.sessionType,
          intensity: s.intensity,
          expectedAthletes: s.expectedAthletes,
          material: s.material,
          planNotes: s.planNotes,
          updatedAt: new Date(),
          blocks: {
            create: s.blocks.map((b, i) => ({
              academyId: ctx.academyId,
              order: i,
              name: b.name,
              durationMin: b.durationMin,
              category: b.category,
              objective: b.objective,
              intensity: b.intensity,
              players: b.players,
              notes: b.notes,
              exerciseId: b.exerciseId,
            })),
          },
        },
        select: { id: true, name: true },
      });

      return { id: criado.id, name: criado.name };
    });
  }

  /**
   * Aplicar um modelo a uma sessão — passa a ser o plano dela.
   *
   * ## Substitui, e diz que substitui
   *
   * Os blocos da sessão são apagados e postos os do modelo. Fundir os dois seria
   * pior: um treino com o aquecimento a dobrar, e nenhuma forma de perceber de
   * onde veio o segundo. Quem aplica um modelo está a dizer "quero este treino";
   * o aviso está na interface, antes de carregar.
   *
   * ## O que a sessão mantém
   *
   * A data, a equipa, o local, o treinador e as notas do pós-treino. O modelo
   * não os tem — e mesmo que tivesse, sobrepô-los era um modelo a mudar o
   * calendário de um clube.
   */
  async applyTemplate(ctx: RequestContext, sessionId: string, templateId: string) {
    if (!can(ctx, "training:write")) throw new ForbiddenException("Sem permissão para planear treinos");

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const s = await db.trainingSession.findFirst({ where: { id: sessionId }, select: { teamId: true } });
      if (!s) throw new NotFoundException("Treino não encontrado");

      const scope = teamScopeFilter(ctx);
      if (scope && !scope.in.includes(s.teamId)) {
        throw new ForbiddenException("Este treino é de uma equipa fora do teu âmbito");
      }

      const t = await db.sessionTemplate.findFirst({
        where: { id: templateId, ...visibleTo(ctx) },
        select: {
          id: true,
          objective: true, objectives: true, sessionType: true, intensity: true,
          expectedAthletes: true, material: true, planNotes: true,
          blocks: {
            orderBy: { order: "asc" },
            select: {
              name: true, durationMin: true, category: true, objective: true,
              intensity: true, players: true, notes: true, exerciseId: true,
            },
          },
        },
      });
      if (!t) throw new NotFoundException("Modelo não encontrado");

      await db.trainingSession.update({
        where: { id: sessionId },
        data: {
          objective: t.objective,
          objectives: t.objectives,
          sessionType: t.sessionType,
          intensity: t.intensity,
          expectedAthletes: t.expectedAthletes,
          material: t.material,
          planNotes: t.planNotes,
        },
      });

      await db.sessionBlock.deleteMany({ where: { sessionId } });
      if (t.blocks.length > 0) {
        await db.sessionBlock.createMany({
          data: t.blocks.map((b, i) => ({
            academyId: ctx.academyId,
            sessionId,
            order: i,
            name: b.name,
            durationMin: b.durationMin,
            category: b.category,
            objective: b.objective,
            intensity: b.intensity,
            players: b.players,
            notes: b.notes,
            exerciseId: b.exerciseId,
          })),
        });
      }

      /*
       * A contagem de uso, que é o que ordena a lista.
       *
       * Dentro da mesma transacção de propósito: um modelo que conta uma
       * aplicação que não chegou a acontecer sobe na lista por nada.
       */
      await db.sessionTemplate.update({
        where: { id: templateId },
        data: { useCount: { increment: 1 }, lastUsedAt: new Date() },
      });

      return this.lerPlano(db, ctx, sessionId);
    });
  }

  /**
   * Apagar um modelo.
   *
   * Só o autor ou quem vê a academia toda — a mesma linha da biblioteca: o que é
   * do clube afina-se por qualquer treinador, mas só a direcção o tira de lá.
   */
  async deleteTemplate(ctx: RequestContext, id: string) {
    if (!can(ctx, "training:write")) throw new ForbiddenException("Sem permissão para planear treinos");

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const t = await db.sessionTemplate.findFirst({
        where: { id },
        select: { id: true, createdById: true },
      });
      if (!t) throw new NotFoundException("Modelo não encontrado");
      if (t.createdById !== ctx.membershipId && !academyWide(ctx)) {
        throw new ForbiddenException("Este modelo é de outro treinador");
      }

      await db.sessionTemplate.delete({ where: { id } });
      return { ok: true as const };
    });
  }
}

/* -------------------------------------------------------------------------- */

export type ExerciseInput = {
  name: string;
  description?: string | null;
  category?: string | null;
  objectives?: string[];
  phase?: string | null;
  type?: string | null;
  intensity?: number | null;
  players?: string | null;
  durationMin?: number | null;
  space?: string | null;
  material?: string | null;
  ageMin?: number | null;
  ageMax?: number | null;
  complexity?: number | null;
  rules?: string | null;
  progressions?: string | null;
  regressions?: string | null;
  coachingPoints?: string | null;
  commonErrors?: string | null;
  videoUrl?: string | null;
  visibility?: string;
  diagram?: unknown;
  /** A modalidade — ver `Exercise.sportId`. */
  sportId?: string | null;
};

export type PlanInput = {
  objective?: string | null;
  objectives?: string[];
  sessionType?: string | null;
  intensity?: number | null;
  expectedAthletes?: number | null;
  material?: string | null;
  planNotes?: string | null;
  postNotes?: string | null;
  blocks?: {
    name: string;
    durationMin: number;
    category?: string | null;
    objective?: string | null;
    intensity?: number | null;
    players?: string | null;
    space?: string | null;
    material?: string | null;
    notes?: string | null;
    exerciseId?: string | null;
  }[];
};

export type GameModelInput = {
  name: string;
  system?: string | null;
  teamId?: string | null;
  visibility?: string;
  lineup?: unknown;
  principles?: unknown;
  notes?: string | null;
  sportId?: string | null;
  /** Ataque / defesa / transição, onde a modalidade o pede. */
  kind?: string | null;
  /** Os exercícios com que se treina este sistema — substitui a lista inteira. */
  exerciseIds?: string[];
};

export type SetPieceInput = {
  kind: string;
  name: string;
  description?: string | null;
  teamId?: string | null;
  visibility?: string;
  diagram?: unknown;
  sportId?: string | null;
  /** O sistema de jogo de que esta situação parte. */
  gameModelId?: string | null;
  exerciseIds?: string[];
};

/** Vejo o que é do clube e o que é meu — a visibilidade, como filtro Prisma. */

/**
 * A identidade de um plano, para lhe reconhecer um gémeo.
 *
 * Só o que faz dele **aquele** treino: o objectivo, o tipo, e a sequência dos
 * blocos com a duração, a categoria e o exercício de cada um. As notas ficam de
 * fora de propósito — dois modelos iguais em que um deles tem "lembrar de levar
 * coletes" escrito num bloco continuam a ser o mesmo treino, e recusar o segundo
 * por causa disso seria o produto a ser esperto onde ninguém lhe pediu.
 */
function assinaturaDoPlano(p: {
  objective: string | null;
  sessionType: string | null;
  blocks: { name: string; durationMin: number; category: string | null; exerciseId: string | null }[];
}): string {
  const cabeca = [p.objective?.trim() ?? "", p.sessionType?.trim() ?? ""].join("|");
  const corpo = p.blocks
    .map((b) => [b.name.trim(), b.durationMin, b.category?.trim() ?? "", b.exerciseId ?? ""].join("~"))
    .join("//");
  return `${cabeca}::${corpo}`;
}

function visibleTo(ctx: RequestContext) {
  return { OR: [{ visibility: "CLUB" as LibraryVisibility }, { createdById: ctx.membershipId }] };
}

function exerciseVisible(
  ctx: RequestContext,
  e: { visibility: LibraryVisibility; createdById: string | null },
): boolean {
  return e.visibility === "CLUB" || e.createdById === ctx.membershipId;
}

/**
 * Vê a academia toda para efeitos de edição na área técnica.
 *
 * O mesmo conjunto de papéis do `teamScopeFilter` sem âmbito, cruzado com quem
 * pode escrever aqui — na prática, direção e coordenação: MEDICAL e SCOUT são
 * academy-wide mas não têm `training:write`, e o `can()` já os travou antes.
 */
function academyWide(ctx: RequestContext): boolean {
  return teamScopeFilter(ctx) === undefined;
}

/** JSON de entrada para o Prisma: ausência vira `JsonNull`, o resto passa. */
function json(value: unknown) {
  return value === null || value === undefined ? Prisma.JsonNull : (value as Prisma.InputJsonValue);
}

function visibilityOf(value: string | undefined): LibraryVisibility {
  return value === "PRIVATE" ? "PRIVATE" : "CLUB";
}

function clampOrNull(value: number | null | undefined, min: number, max: number): number | null {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  return Math.max(min, Math.min(max, Math.round(value)));
}

/**
 * O desenho é JSON opaco para o servidor — mas não ilimitado. Um diagrama de
 * treino são uns KB; 300 KB é alguém a usar a coluna como armazenamento.
 */
function checkDiagram(diagram: unknown): void {
  if (diagram === undefined || diagram === null) return;
  if (typeof diagram !== "object") throw new BadRequestException("Desenho inválido");
  if (JSON.stringify(diagram).length > 300_000) {
    throw new BadRequestException("O desenho é demasiado grande");
  }
}

/** O primeiro frame do desenho — o que um cartão de lista consegue mostrar. */
function thumbnailOf(diagram: unknown): unknown {
  const d = diagram as { field?: string; frames?: unknown[] } | null;
  if (!d || !Array.isArray(d.frames) || d.frames.length === 0) return null;
  return { field: d.field ?? "full", frames: [d.frames[0]] };
}

function frameCount(diagram: unknown): number {
  const d = diagram as { frames?: unknown[] } | null;
  return d && Array.isArray(d.frames) ? d.frames.length : 0;
}

function serializeExercise(e: {
  id: string; name: string; description: string | null; category: string | null; objectives: string[];
  phase: string | null; type: string | null; intensity: number | null; players: string | null;
  durationMin: number | null; space: string | null; material: string | null;
  ageMin: number | null; ageMax: number | null; complexity: number | null;
  rules: string | null; progressions: string | null; regressions: string | null;
  coachingPoints: string | null; commonErrors: string | null; videoUrl: string | null;
  visibility: LibraryVisibility; diagram: unknown; createdById: string | null; sportId: string | null;
  createdBy: { user: { name: string } } | null; updatedAt: Date;
}) {
  return {
    id: e.id,
    name: e.name,
    sportId: e.sportId,
    description: e.description,
    category: e.category,
    objectives: e.objectives,
    phase: e.phase,
    type: e.type,
    intensity: e.intensity,
    players: e.players,
    durationMin: e.durationMin,
    space: e.space,
    material: e.material,
    ageMin: e.ageMin,
    ageMax: e.ageMax,
    complexity: e.complexity,
    rules: e.rules,
    progressions: e.progressions,
    regressions: e.regressions,
    coachingPoints: e.coachingPoints,
    commonErrors: e.commonErrors,
    videoUrl: e.videoUrl,
    visibility: e.visibility,
    diagram: e.diagram,
    authorName: e.createdBy?.user.name ?? null,
    updatedAt: e.updatedAt,
  };
}

/** O `exerciseData` dos dois caminhos de escrita — criação e edição. */
function exerciseData(dto: Partial<ExerciseInput>, partial = false): Record<string, unknown> {
  const set = <T>(key: string, value: T | undefined, map: (v: T) => unknown) =>
    value === undefined && partial ? {} : { [key]: value === undefined ? null : map(value as T) };

  return {
    ...(dto.name !== undefined ? { name: dto.name.trim().slice(0, 100) } : {}),
    ...set("description", dto.description, (v) => v?.trim() || null),
    ...set("category", dto.category, (v) => v?.trim() || null),
    ...(dto.objectives !== undefined
      ? { objectives: dto.objectives.map((o) => o.trim()).filter(Boolean).slice(0, 12) }
      : {}),
    ...set("phase", dto.phase, (v) => v?.trim() || null),
    ...set("type", dto.type, (v) => v?.trim() || null),
    ...set("intensity", dto.intensity, (v) => clampOrNull(v, 1, 10)),
    ...set("players", dto.players, (v) => v?.trim() || null),
    ...set("durationMin", dto.durationMin, (v) => clampOrNull(v, 1, 240)),
    ...set("space", dto.space, (v) => v?.trim() || null),
    ...set("material", dto.material, (v) => v?.trim() || null),
    ...set("ageMin", dto.ageMin, (v) => clampOrNull(v, 4, 99)),
    ...set("ageMax", dto.ageMax, (v) => clampOrNull(v, 4, 99)),
    ...set("complexity", dto.complexity, (v) => clampOrNull(v, 1, 5)),
    ...set("rules", dto.rules, (v) => v?.trim() || null),
    ...set("progressions", dto.progressions, (v) => v?.trim() || null),
    ...set("regressions", dto.regressions, (v) => v?.trim() || null),
    ...set("coachingPoints", dto.coachingPoints, (v) => v?.trim() || null),
    ...set("commonErrors", dto.commonErrors, (v) => v?.trim() || null),
    ...set("videoUrl", dto.videoUrl, (v) => v?.trim() || null),
    ...(dto.visibility !== undefined ? { visibility: visibilityOf(dto.visibility) } : {}),
    ...(dto.diagram !== undefined ? { diagram: json(dto.diagram) } : {}),
  };
}

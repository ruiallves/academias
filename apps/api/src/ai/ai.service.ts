import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { can, teamScopeFilter, type RequestContext } from "../common/permissions";
import { AiVideoService, videoExtensionFor } from "./ai-video.service";
import { AiJobsService } from "./ai-jobs.service";
import type {
  CompleteVideoDto,
  CreateAnalysisDto,
  IdentifyTrackDto,
  StartVideoUploadDto,
  UpdateSquadDto,
} from "./ai.dto";

/**
 * Academias AI — a camada de produto.
 *
 * ## O princípio que manda em tudo
 *
 *   Computer Vision → dados estruturados → validação → estatística → interpretação.
 *
 * Este serviço nunca calcula nada de vídeo: cria análises, autoriza vídeos,
 * lê o que o worker escreveu e regista as correções humanas. O que não tem
 * confiança suficiente diz "precisa de revisão" — nunca inventa.
 *
 * ## Âmbito
 *
 * Como em tudo: um treinador cria e lê análises **das suas equipas**
 * (`teamScopeFilter`); a direção e a coordenação vêem o clube. O vídeo de um
 * jogo é imagem de menores — a fronteira não é decorativa.
 */
@Injectable()
export class AiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly video: AiVideoService,
    private readonly jobs: AiJobsService,
  ) {}

  /* ---------------------------------------------------------------------- */
  /* Dashboard                                                              */
  /* ---------------------------------------------------------------------- */

  async dashboard(ctx: RequestContext) {
    if (!can(ctx, "ai:read")) throw new ForbiddenException("Sem acesso à Academias AI");
    const teamScope = teamScopeFilter(ctx);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const whereAnalysis = teamScope ? { teamId: teamScope } : {};

      const [processing, completed, review, failed, recent, insights] = await Promise.all([
        db.aIAnalysis.count({ where: { ...whereAnalysis, status: { in: ["QUEUED", "PROCESSING", "UPLOADING"] } } }),
        db.aIAnalysis.count({ where: { ...whereAnalysis, status: "COMPLETED" } }),
        db.aIAnalysis.count({ where: { ...whereAnalysis, status: "REVIEW" } }),
        db.aIAnalysis.count({ where: { ...whereAnalysis, status: "FAILED" } }),
        db.aIAnalysis.findMany({
          where: whereAnalysis,
          orderBy: { createdAt: "desc" },
          take: 6,
          select: analysisListSelect,
        }),
        db.aIInsight.findMany({
          where: {
            dismissedAt: null,
            ...(teamScope ? { OR: [{ teamId: teamScope }, { teamId: null }] } : {}),
          },
          orderBy: { createdAt: "desc" },
          take: 8,
          select: insightSelect,
        }),
      ]);

      return {
        counts: { processing, completed, review, failed },
        recent: recent.map(toAnalysisRow),
        insights: insights.map(toInsightRow),
      };
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Análises                                                               */
  /* ---------------------------------------------------------------------- */

  async listAnalyses(ctx: RequestContext) {
    if (!can(ctx, "ai:read")) throw new ForbiddenException("Sem acesso à Academias AI");
    const teamScope = teamScopeFilter(ctx);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const rows = await db.aIAnalysis.findMany({
        where: teamScope ? { teamId: teamScope } : {},
        orderBy: { createdAt: "desc" },
        take: 100,
        select: analysisListSelect,
      });
      return rows.map(toAnalysisRow);
    });
  }

  /**
   * Criar uma análise: equipa + jogo (opcional) + o plantel confirmado.
   *
   * O plantel é a parte que faz a identificação possível sem biometria: dizer
   * "#10 = Rui Silva" **antes** de processar transforma um problema de mundo
   * aberto (quem é esta pessoa?) num de escolha fechada (qual destes 16?).
   */
  async createAnalysis(ctx: RequestContext, dto: CreateAnalysisDto) {
    if (!can(ctx, "ai:write")) throw new ForbiddenException("Sem permissão para criar análises");
    this.assertTeamInScope(ctx, dto.teamId);
    if (dto.squad.length === 0) throw new BadRequestException("A análise precisa do plantel confirmado");

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const team = await db.team.findFirst({
        where: { id: dto.teamId },
        select: { id: true, name: true },
      });
      if (!team) throw new NotFoundException("Equipa não encontrada");

      // O jogo, quando existe, preenche o que faltar — e tem de ser da equipa:
      // uma análise do Sub-13 apontada a um jogo de seniores é um erro de dedo.
      let match: { id: string; opponent: string; startsAt: Date; competition: { label: string } | null } | null = null;
      if (dto.matchId) {
        match = await db.match.findFirst({
          where: { id: dto.matchId, teamId: dto.teamId },
          select: { id: true, opponent: true, startsAt: true, competition: { select: { label: true } } },
        });
        if (!match) throw new BadRequestException("Esse jogo não é desta equipa");
      }

      // Todos os atletas do plantel têm de existir nesta academia. A RLS já
      // filtra; contar é o que transforma um id alheio em 400 e não em silêncio.
      const athleteIds = [...new Set(dto.squad.map((s) => s.athleteId))];
      const found = await db.athlete.count({ where: { id: { in: athleteIds } } });
      if (found !== athleteIds.length) throw new BadRequestException("Há atletas que não são desta academia");

      const opponent = dto.opponent?.trim() || match?.opponent || null;
      const analysis = await db.aIAnalysis.create({
        data: {
          academyId: ctx.academyId,
          teamId: dto.teamId,
          matchId: match?.id ?? null,
          title: dto.title?.trim() || (opponent ? `${team.name} vs ${opponent}` : `Análise — ${team.name}`),
          opponent,
          competition: dto.competition?.trim() || match?.competition?.label || null,
          playedOn: dto.playedOn ? new Date(dto.playedOn) : (match?.startsAt ?? null),
          createdById: ctx.membershipId,
          updatedAt: new Date(),
          squad: {
            create: dto.squad.map((s) => ({
              athleteId: s.athleteId,
              jerseyNumber: s.jerseyNumber ?? null,
            })),
          },
        },
        select: { id: true },
      });

      return { id: analysis.id };
    });
  }

  async getAnalysis(ctx: RequestContext, id: string) {
    if (!can(ctx, "ai:read")) throw new ForbiddenException("Sem acesso à Academias AI");
    const teamScope = teamScopeFilter(ctx);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const a = await db.aIAnalysis.findFirst({
        // `findFirst` com o âmbito: um id de outra equipa dá 404, não 403 —
        // 403 confirmaria que a análise existe algures.
        where: { id, ...(teamScope ? { teamId: teamScope } : {}) },
        select: {
          ...analysisListSelect,
          failReason: true,
          createdBy: { select: { user: { select: { name: true } } } },
          squad: {
            select: {
              athleteId: true,
              jerseyNumber: true,
              athlete: { select: { name: true } },
            },
          },
          videos: {
            orderBy: { createdAt: "asc" },
            select: {
              id: true, status: true, mimeType: true, sizeBytes: true,
              durationSec: true, width: true, height: true, fps: true,
              quality: true, createdAt: true,
            },
          },
          jobs: {
            orderBy: { createdAt: "asc" },
            select: {
              id: true, kind: true, status: true, progress: true, attempts: true,
              error: true, startedAt: true, finishedAt: true, modelVersions: true, createdAt: true,
            },
          },
          tracks: {
            orderBy: { firstMs: "asc" },
            select: {
              id: true, trackNumber: true, side: true, jerseyNumber: true,
              athleteId: true, athlete: { select: { name: true } },
              identityConfidence: true, trackConfidence: true,
              firstMs: true, lastMs: true, frameCount: true, summary: true, status: true,
            },
          },
          _count: { select: { events: true, corrections: true } },
        },
      });
      if (!a) throw new NotFoundException("Análise não encontrada");

      const { videos, jobs, tracks, squad, createdBy, _count, ...rest } = a;
      return {
        ...toAnalysisRow(rest as Parameters<typeof toAnalysisRow>[0]),
        failReason: a.failReason,
        createdBy: createdBy?.user.name ?? null,
        squad: squad.map((s) => ({
          athleteId: s.athleteId,
          name: s.athlete.name,
          jerseyNumber: s.jerseyNumber,
        })),
        videos: videos.map((v) => ({ ...v, sizeBytes: v.sizeBytes === null ? null : Number(v.sizeBytes) })),
        jobs,
        tracks: tracks.map((t) => ({ ...t, athleteName: t.athlete?.name ?? null, athlete: undefined })),
        eventCount: _count.events,
        correctionCount: _count.corrections,
      };
    });
  }

  async updateSquad(ctx: RequestContext, id: string, dto: UpdateSquadDto) {
    if (!can(ctx, "ai:write")) throw new ForbiddenException("Sem permissão");
    const teamScope = teamScopeFilter(ctx);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const a = await db.aIAnalysis.findFirst({
        where: { id, ...(teamScope ? { teamId: teamScope } : {}) },
        select: { id: true, status: true },
      });
      if (!a) throw new NotFoundException("Análise não encontrada");
      // Depois de processar, o plantel deixa de se substituir por grosso — as
      // identidades corrigem-se track a track, e cada correção fica registada.
      if (!["DRAFT", "UPLOADING", "QUEUED"].includes(a.status)) {
        throw new BadRequestException("O plantel só se edita antes do processamento");
      }

      const athleteIds = [...new Set(dto.squad.map((s) => s.athleteId))];
      const found = await db.athlete.count({ where: { id: { in: athleteIds } } });
      if (found !== athleteIds.length) throw new BadRequestException("Há atletas que não são desta academia");

      await db.aIAnalysisPlayer.deleteMany({ where: { analysisId: id } });
      for (const s of dto.squad) {
        await db.aIAnalysisPlayer.create({
          data: { analysisId: id, athleteId: s.athleteId, jerseyNumber: s.jerseyNumber ?? null },
        });
      }
      await db.aIAnalysis.update({ where: { id }, data: { updatedAt: new Date() } });
      return { ok: true };
    });
  }

  /**
   * Apagar a sério — RGPD a funcionar.
   *
   * Primeiro os ficheiros (vídeo, tracks, clips, embeddings — a pasta inteira
   * no Storage), depois as linhas, por cascata. Se o Storage falhar, a linha
   * fica: melhor uma análise que ainda aparece do que ficheiros de menores que
   * ninguém volta a encontrar para apagar.
   */
  async deleteAnalysis(ctx: RequestContext, id: string) {
    if (!can(ctx, "ai:write")) throw new ForbiddenException("Sem permissão");
    const teamScope = teamScopeFilter(ctx);

    // A verificação e o apagar da linha em transação; a varredura do Storage
    // **fora** dela — rede dentro de uma transação seca o pool (ver playbackUrl
    // do scouting, que pagou para aprender isto).
    const found = await this.prisma.runAs(ctx.academyId, (db) =>
      db.aIAnalysis.findFirst({
        where: { id, ...(teamScope ? { teamId: teamScope } : {}) },
        select: { id: true },
      }),
    );
    if (!found) throw new NotFoundException("Análise não encontrada");

    await this.video.deletePrefix(`${ctx.academyId}/${id}`);

    await this.prisma.runAs(ctx.academyId, (db) => db.aIAnalysis.delete({ where: { id } }));
    return { ok: true };
  }

  /* ---------------------------------------------------------------------- */
  /* Vídeo                                                                  */
  /* ---------------------------------------------------------------------- */

  /** Passo 1 de 2: autorizar e assinar. Os bytes vão do browser para o Storage. */
  async startVideoUpload(ctx: RequestContext, analysisId: string, dto: StartVideoUploadDto) {
    if (!can(ctx, "ai:write")) throw new ForbiddenException("Sem permissão para carregar vídeo");
    const teamScope = teamScopeFilter(ctx);

    const created = await this.prisma.runAs(ctx.academyId, async (db) => {
      const a = await db.aIAnalysis.findFirst({
        where: { id: analysisId, ...(teamScope ? { teamId: teamScope } : {}) },
        select: { id: true, status: true },
      });
      if (!a) throw new NotFoundException("Análise não encontrada");
      if (!["DRAFT", "UPLOADING"].includes(a.status)) {
        throw new BadRequestException("Esta análise já tem o vídeo processado ou em processamento");
      }

      const ext = videoExtensionFor(dto.mimeType);
      const video = await db.aIVideo.create({
        data: {
          academyId: ctx.academyId,
          analysisId,
          mimeType: dto.mimeType,
          sizeBytes: dto.sizeBytes != null ? BigInt(dto.sizeBytes) : null,
          storageKey: "",
          uploadedById: ctx.membershipId,
          updatedAt: new Date(),
        },
        select: { id: true },
      });

      const storageKey = `${ctx.academyId}/${analysisId}/${video.id}.${ext}`;
      await db.aIVideo.update({ where: { id: video.id }, data: { storageKey } });
      await db.aIAnalysis.update({ where: { id: analysisId }, data: { status: "UPLOADING", updatedAt: new Date() } });

      return { id: video.id, storageKey };
    });

    // A assinatura fora da transação, como sempre: rede não segura ligações do pool.
    const upload = await this.video.signUpload(created.storageKey);
    return { id: created.id, storageKey: created.storageKey, uploadUrl: upload.url, token: upload.token };
  }

  /**
   * Passo 2 de 2: confirmar que os bytes chegaram — e pôr a máquina a trabalhar.
   *
   * É aqui que nasce o primeiro job (`quality_check`) e a análise entra na
   * fila. Nunca se confia no cliente: o `HEAD` ao Storage é o que diz que o
   * ficheiro existe mesmo.
   */
  async completeVideo(ctx: RequestContext, videoId: string, dto: CompleteVideoDto) {
    if (!can(ctx, "ai:write")) throw new ForbiddenException("Sem permissão para carregar vídeo");

    const video = await this.prisma.runAs(ctx.academyId, (db) =>
      db.aIVideo.findFirst({
        where: { id: videoId },
        select: { id: true, analysisId: true, storageKey: true, status: true },
      }),
    );
    if (!video) throw new NotFoundException("Vídeo não encontrado");
    if (video.status === "READY") return { ok: true };

    // Fora da transação: é uma ida à rede.
    const chegou = await this.video.exists(video.storageKey);
    if (!chegou) throw new BadRequestException("O ficheiro ainda não chegou ao armazenamento");

    return this.prisma.runAs(ctx.academyId, async (db) => {
      await db.aIVideo.update({
        where: { id: videoId },
        data: {
          status: "READY",
          durationSec: dto.durationSec ?? null,
          updatedAt: new Date(),
        },
      });
      await db.aIAnalysis.update({
        where: { id: video.analysisId },
        data: { status: "QUEUED", progress: 0, updatedAt: new Date() },
      });
      await this.jobs.enqueue(db, ctx.academyId, video.analysisId, "quality_check", { videoId });
      return { ok: true };
    });
  }

  /** Um link para ver, válido durante minutos. O player pede outro quando expirar. */
  async videoUrl(ctx: RequestContext, videoId: string) {
    if (!can(ctx, "ai:read")) throw new ForbiddenException("Sem acesso à Academias AI");

    const video = await this.prisma.runAs(ctx.academyId, (db) =>
      db.aIVideo.findFirst({
        where: { id: videoId, status: "READY" },
        select: { storageKey: true },
      }),
    );
    if (!video) throw new NotFoundException("Vídeo não encontrado");

    return { url: await this.video.signDownload(video.storageKey, 600), expiresIn: 600 };
  }

  /* ---------------------------------------------------------------------- */
  /* Reprocessar                                                            */
  /* ---------------------------------------------------------------------- */

  /**
   * Voltar a pôr na fila — o gesto de quem viu o "Poor" da qualidade e decidiu
   * avançar na mesma, ou de quem quer repetir depois de uma falha.
   */
  async requeue(ctx: RequestContext, analysisId: string) {
    if (!can(ctx, "ai:write")) throw new ForbiddenException("Sem permissão");
    const teamScope = teamScopeFilter(ctx);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const a = await db.aIAnalysis.findFirst({
        where: { id: analysisId, ...(teamScope ? { teamId: teamScope } : {}) },
        select: {
          id: true, status: true,
          videos: { where: { status: "READY" }, select: { id: true }, take: 1 },
          jobs: { where: { status: { in: ["PENDING", "CLAIMED", "RUNNING"] } }, select: { id: true }, take: 1 },
        },
      });
      if (!a) throw new NotFoundException("Análise não encontrada");
      if (a.videos.length === 0) throw new BadRequestException("A análise ainda não tem vídeo");
      if (a.jobs.length > 0) throw new BadRequestException("Já há processamento em curso");

      const videoId = a.videos[0].id;
      // Falhou ou nunca passou da qualidade → recomeça pela qualidade; já tem
      // qualidade escrita → segue para a detecção.
      const quality = await db.aIVideo.findFirst({ where: { id: videoId }, select: { quality: true } });
      const kind = quality?.quality ? "detect_track" : "quality_check";

      await this.jobs.enqueue(db, ctx.academyId, analysisId, kind, { videoId });
      await db.aIAnalysis.update({
        where: { id: analysisId },
        data: { status: "QUEUED", failReason: null, updatedAt: new Date() },
      });
      return { ok: true };
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Correções — human-in-the-loop                                          */
  /* ---------------------------------------------------------------------- */

  /**
   * Corrigir a identidade de um track.
   *
   * A correção vale para o **track inteiro** — não para um frame: o track já é
   * a mesma pessoa do princípio ao fim, e é essa a razão de se corrigir aqui e
   * não frame a frame. Fica registada como `HumanCorrection` (o antes e o
   * depois), e alimenta o perfil de identidade do atleta — o active learning
   * começa por guardar bem, não por treinar já.
   */
  async identifyTrack(ctx: RequestContext, trackId: string, dto: IdentifyTrackDto) {
    if (!can(ctx, "ai:write")) throw new ForbiddenException("Sem permissão para corrigir");

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const track = await db.playerTrack.findFirst({
        where: { id: trackId },
        select: {
          id: true, analysisId: true, athleteId: true, jerseyNumber: true,
          identityConfidence: true,
          analysis: { select: { teamId: true } },
        },
      });
      if (!track) throw new NotFoundException("Track não encontrado");
      this.assertTeamInScope(ctx, track.analysis.teamId);

      const athleteId = dto.athleteId ?? null;
      if (athleteId) {
        const athlete = await db.athlete.findFirst({ where: { id: athleteId }, select: { id: true } });
        if (!athlete) throw new BadRequestException("Esse atleta não é desta academia");
      }

      await db.playerTrack.update({
        where: { id: trackId },
        data: {
          athleteId,
          // Confirmado por um humano: a confiança passa a ser a dele.
          identityConfidence: 1,
          status: "corrected",
          updatedAt: new Date(),
        },
      });

      await db.humanCorrection.create({
        data: {
          academyId: ctx.academyId,
          analysisId: track.analysisId,
          kind: "player_identity",
          targetType: "track",
          targetId: trackId,
          before: { athleteId: track.athleteId, confidence: track.identityConfidence },
          after: { athleteId },
          correctedById: ctx.membershipId,
        },
      });

      // O perfil de identidade aprende: o número visto neste jogo fica anotado.
      if (athleteId && track.jerseyNumber != null) {
        const profile = await db.playerIdentityProfile.findFirst({
          where: { athleteId },
          select: { id: true, jerseyNumbers: true },
        });
        if (profile) {
          if (!profile.jerseyNumbers.includes(track.jerseyNumber)) {
            await db.playerIdentityProfile.update({
              where: { id: profile.id },
              data: { jerseyNumbers: [...profile.jerseyNumbers, track.jerseyNumber], updatedAt: new Date() },
            });
          }
        } else {
          await db.playerIdentityProfile.create({
            data: {
              academyId: ctx.academyId,
              athleteId,
              jerseyNumbers: [track.jerseyNumber],
              updatedAt: new Date(),
            },
          });
        }
      }

      await this.jobs.recomputeReview(db, track.analysisId);
      return { ok: true };
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Insights                                                               */
  /* ---------------------------------------------------------------------- */

  async listInsights(ctx: RequestContext) {
    if (!can(ctx, "ai:read")) throw new ForbiddenException("Sem acesso à Academias AI");
    const teamScope = teamScopeFilter(ctx);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const rows = await db.aIInsight.findMany({
        where: {
          dismissedAt: null,
          ...(teamScope ? { OR: [{ teamId: teamScope }, { teamId: null }] } : {}),
        },
        orderBy: { createdAt: "desc" },
        take: 100,
        select: insightSelect,
      });
      return rows.map(toInsightRow);
    });
  }

  async dismissInsight(ctx: RequestContext, id: string) {
    if (!can(ctx, "ai:write")) throw new ForbiddenException("Sem permissão");

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const insight = await db.aIInsight.findFirst({ where: { id }, select: { id: true } });
      if (!insight) throw new NotFoundException("Insight não encontrado");
      await db.aIInsight.update({ where: { id }, data: { dismissedAt: new Date() } });
      return { ok: true };
    });
  }

  /* ---------------------------------------------------------------------- */

  /** O treinador só mexe nas equipas dele. `undefined` = sem limite. */
  private assertTeamInScope(ctx: RequestContext, teamId: string) {
    const scope = teamScopeFilter(ctx);
    if (scope && !scope.in.includes(teamId)) {
      throw new ForbiddenException("Essa equipa está fora do teu âmbito");
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Formas de leitura partilhadas                                              */
/* -------------------------------------------------------------------------- */

const analysisListSelect = {
  id: true,
  kind: true,
  title: true,
  opponent: true,
  competition: true,
  playedOn: true,
  status: true,
  progress: true,
  confidence: true,
  reviewCount: true,
  createdAt: true,
  completedAt: true,
  team: { select: { id: true, name: true } },
  matchId: true,
} as const;

type AnalysisRow = {
  id: string; kind: string; title: string; opponent: string | null; competition: string | null;
  playedOn: Date | null; status: string; progress: number; confidence: unknown;
  reviewCount: number; createdAt: Date; completedAt: Date | null;
  team: { id: string; name: string }; matchId: string | null;
};

function toAnalysisRow(a: AnalysisRow) {
  return {
    id: a.id,
    kind: a.kind,
    title: a.title,
    opponent: a.opponent,
    competition: a.competition,
    playedOn: a.playedOn,
    status: a.status,
    progress: a.progress,
    confidence: a.confidence ?? null,
    reviewCount: a.reviewCount,
    createdAt: a.createdAt,
    completedAt: a.completedAt,
    teamId: a.team.id,
    teamName: a.team.name,
    matchId: a.matchId,
  };
}

const insightSelect = {
  id: true,
  kind: true,
  text: true,
  confidence: true,
  data: true,
  createdAt: true,
  analysisId: true,
  athleteId: true,
  athlete: { select: { name: true } },
  teamId: true,
  team: { select: { name: true } },
} as const;

type InsightRow = {
  id: string; kind: string; text: string; confidence: number; data: unknown; createdAt: Date;
  analysisId: string | null; athleteId: string | null; athlete: { name: string } | null;
  teamId: string | null; team: { name: string } | null;
};

function toInsightRow(i: InsightRow) {
  return {
    id: i.id,
    kind: i.kind,
    text: i.text,
    confidence: i.confidence,
    data: i.data ?? null,
    createdAt: i.createdAt,
    analysisId: i.analysisId,
    athleteId: i.athleteId,
    athleteName: i.athlete?.name ?? null,
    teamId: i.teamId,
    teamName: i.team?.name ?? null,
  };
}

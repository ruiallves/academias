import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { PlatformPrisma } from "../platform/platform.prisma";
import { NotificationsService } from "../notifications/notifications.service";
import { AiVideoService } from "./ai-video.service";
import { AiJobsService } from "./ai-jobs.service";
import type {
  WorkerClaimDto,
  WorkerCompleteDto,
  WorkerFailDto,
  WorkerHeartbeatDto,
  WorkerModelDto,
  WorkerUploadUrlDto,
} from "./ai.dto";

/**
 * O lado da API que fala com os workers de computer vision.
 *
 * ## Porque é que isto atravessa tenants
 *
 * Um worker é infra-estrutura da plataforma: serve todas as academias, como o
 * processo da API serve todas. O **claim** — "dá-me o trabalho mais antigo,
 * seja de quem for" — não cabe num contexto de academia, e por isso usa a
 * ligação da plataforma (`PlatformPrisma`), com `FOR UPDATE SKIP LOCKED` para
 * dois workers nunca levarem o mesmo job.
 *
 * A partir daí volta tudo à regra: o claim devolve o `academyId` do job, e
 * **todas** as escritas seguintes correm em `runAs(academyId)` — com RLS, como
 * qualquer pedido. A ligação da plataforma só responde a "de que academia é o
 * job X", nunca escreve dados de domínio.
 *
 * ## De onde vem a confiança no worker
 *
 * Do token (`AI_WORKER_TOKEN`, ver `ai-worker.guard.ts`) e do id do job: um
 * worker só escreve no job que reclamou, e o que escreve é validado. Um worker
 * comprometido é um problema — mas é o mesmo problema de qualquer processo com
 * credenciais, e está confinado às tabelas da AI.
 */
@Injectable()
export class AiWorkerService {
  private readonly log = new Logger(AiWorkerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly platform: PlatformPrisma,
    private readonly video: AiVideoService,
    private readonly jobs: AiJobsService,
    private readonly notifications: NotificationsService,
  ) {}

  /* ---------------------------------------------------------------------- */
  /* Claim                                                                  */
  /* ---------------------------------------------------------------------- */

  async claim(dto: WorkerClaimDto) {
    if (dto.kinds.length === 0) return null;

    await this.requeueStale();

    // Um UPDATE com subconsulta bloqueada: dois workers em simultâneo levam
    // jobs diferentes ou um deles leva nada — nunca o mesmo.
    const rows = await this.platform.$queryRaw<
      { id: string; academyId: string; analysisId: string; kind: string; params: unknown; attempts: number }[]
    >(Prisma.sql`
      UPDATE "AIJob" SET
        status = 'CLAIMED',
        "claimedBy" = ${dto.worker},
        "claimedAt" = now(),
        "heartbeatAt" = now(),
        attempts = attempts + 1,
        "updatedAt" = now()
      WHERE id = (
        SELECT id FROM "AIJob"
        WHERE status = 'PENDING' AND kind = ANY(${dto.kinds})
        ORDER BY priority DESC, "createdAt" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      RETURNING id, "academyId", "analysisId", kind, params, attempts
    `);
    const job = rows[0];
    if (!job) return null;

    // O contexto do trabalho, já dentro da academia certa — com RLS.
    return this.prisma.runAs(job.academyId, async (db) => {
      const analysis = await db.aIAnalysis.findFirst({
        where: { id: job.analysisId },
        select: {
          id: true,
          kind: true,
          title: true,
          team: { select: { id: true, name: true, maxAge: true, sport: { select: { name: true } } } },
          squad: {
            select: {
              athleteId: true,
              jerseyNumber: true,
              athlete: { select: { name: true } },
            },
          },
          videos: {
            where: { status: "READY" },
            orderBy: { createdAt: "asc" },
            take: 1,
            select: { id: true, storageKey: true, mimeType: true, durationSec: true, quality: true },
          },
        },
      });

      if (!analysis || analysis.videos.length === 0) {
        // Sem vídeo não há trabalho — o job morre com explicação em vez de
        // andar de worker em worker.
        await db.aIJob.update({
          where: { id: job.id },
          data: { status: "FAILED", error: "A análise já não tem vídeo pronto", finishedAt: new Date(), updatedAt: new Date() },
        });
        return null;
      }

      await db.aIAnalysis.update({
        where: { id: analysis.id },
        data: { status: "PROCESSING", updatedAt: new Date() },
      });

      const video = analysis.videos[0];
      // Duas horas: chega para descarregar um jogo inteiro numa ligação caseira,
      // e caduca sozinho — o worker pede outro se precisar.
      const videoUrl = await this.video.signDownload(video.storageKey, 7200);

      return {
        id: job.id,
        kind: job.kind,
        attempt: job.attempts,
        params: job.params ?? {},
        analysis: {
          id: analysis.id,
          kind: analysis.kind,
          title: analysis.title,
          team: analysis.team.name,
          sport: analysis.team.sport.name,
          maxAge: analysis.team.maxAge,
          squad: analysis.squad.map((s) => ({
            athleteId: s.athleteId,
            name: s.athlete.name,
            jerseyNumber: s.jerseyNumber,
          })),
        },
        video: {
          id: video.id,
          url: videoUrl,
          mimeType: video.mimeType,
          durationSec: video.durationSec,
          quality: video.quality ?? null,
        },
      };
    });
  }

  /**
   * Um worker que morre a meio não pode prender um job para sempre. Sem
   * heartbeat há cinco minutos: volta à fila se ainda tiver tentativas, morre
   * com explicação se não tiver. Corre no claim — quem pergunta por trabalho
   * é quem limpa os mortos, e não é preciso um cron.
   */
  private async requeueStale() {
    await this.platform.$executeRaw`
      UPDATE "AIJob" SET
        status = 'PENDING', "claimedBy" = NULL, "claimedAt" = NULL,
        "heartbeatAt" = NULL, progress = 0, "updatedAt" = now()
      WHERE status IN ('CLAIMED', 'RUNNING')
        AND COALESCE("heartbeatAt", "claimedAt") < now() - interval '5 minutes'
        AND attempts < "maxAttempts"
    `;
    await this.platform.$executeRaw`
      UPDATE "AIJob" SET
        status = 'FAILED', error = 'O worker deixou de responder',
        "finishedAt" = now(), "updatedAt" = now()
      WHERE status IN ('CLAIMED', 'RUNNING')
        AND COALESCE("heartbeatAt", "claimedAt") < now() - interval '5 minutes'
        AND attempts >= "maxAttempts"
    `;
  }

  /* ---------------------------------------------------------------------- */
  /* Progresso e desfecho                                                   */
  /* ---------------------------------------------------------------------- */

  async heartbeat(jobId: string, dto: WorkerHeartbeatDto) {
    const job = await this.locate(jobId);

    await this.prisma.runAs(job.academyId, async (db) => {
      await db.aIJob.update({
        where: { id: jobId },
        data: {
          status: "RUNNING",
          startedAt: job.startedAt ?? new Date(),
          heartbeatAt: new Date(),
          ...(dto.progress != null ? { progress: dto.progress } : {}),
          updatedAt: new Date(),
        },
      });
      if (dto.progress != null) {
        await db.aIAnalysis.update({
          where: { id: job.analysisId },
          data: { progress: overallProgress(job.kind, dto.progress), updatedAt: new Date() },
        });
      }
    });
    return { ok: true };
  }

  /**
   * O worker terminou — e é aqui que o resultado estruturado entra no produto.
   *
   * Cada tipo de job tem o seu efeito: a qualidade escreve o relatório no vídeo
   * e decide se vale a pena continuar; a detecção cria os tracks e fecha a
   * análise. O que vier abaixo do limiar de confiança fica marcado para revisão
   * — nunca se inventa.
   */
  async complete(jobId: string, dto: WorkerCompleteDto) {
    const job = await this.locate(jobId);

    await this.prisma.runAs(job.academyId, async (db) => {
      await db.aIJob.update({
        where: { id: jobId },
        data: {
          status: "DONE",
          progress: 100,
          finishedAt: new Date(),
          result: dto.result as object,
          modelVersions: (dto.modelVersions ?? {}) as object,
          updatedAt: new Date(),
        },
      });

      if (job.kind === "quality_check") {
        await this.applyQuality(db, job, dto.result);
      } else if (job.kind === "detect_track") {
        await this.applyDetectTrack(db, job, dto.result);
      } else {
        this.log.warn(`Job ${jobId} de tipo desconhecido "${job.kind}" terminou — resultado guardado, sem efeitos.`);
      }
    });
    return { ok: true };
  }

  async fail(jobId: string, dto: WorkerFailDto) {
    const job = await this.locate(jobId);

    await this.prisma.runAs(job.academyId, async (db) => {
      const row = await db.aIJob.findFirst({
        where: { id: jobId },
        select: { attempts: true, maxAttempts: true },
      });
      if (!row) return;

      if (row.attempts < row.maxAttempts) {
        // Ainda há tentativas: volta à fila. Uma queda de rede a meio de 90
        // minutos de vídeo não pode exigir um humano.
        await db.aIJob.update({
          where: { id: jobId },
          data: {
            status: "PENDING", error: dto.error, progress: 0,
            claimedBy: null, claimedAt: null, heartbeatAt: null, updatedAt: new Date(),
          },
        });
        await db.aIAnalysis.update({
          where: { id: job.analysisId },
          data: { status: "QUEUED", updatedAt: new Date() },
        });
      } else {
        await db.aIJob.update({
          where: { id: jobId },
          data: { status: "FAILED", error: dto.error, finishedAt: new Date(), updatedAt: new Date() },
        });
        await db.aIAnalysis.update({
          where: { id: job.analysisId },
          data: { status: "FAILED", failReason: dto.error, updatedAt: new Date() },
        });
      }
    });
    return { ok: true };
  }

  /* ---------------------------------------------------------------------- */
  /* Artefactos e modelos                                                   */
  /* ---------------------------------------------------------------------- */

  /**
   * Um endereço assinado para o worker guardar um derivado — tracks, clip,
   * heatmap, embedding. O caminho é **preso ao job**: `derived/` da análise
   * dele, e mais lado nenhum. Uma autorização obtida para uma análise não serve
   * para escrever noutra.
   */
  async uploadUrl(jobId: string, dto: WorkerUploadUrlDto) {
    const job = await this.locate(jobId);

    const path = dto.path.replace(/^\/+/, "");
    if (path.includes("..") || !/^[\w./-]+$/.test(path)) {
      throw new BadRequestException("Caminho inválido");
    }

    const key = `${job.academyId}/${job.analysisId}/derived/${path}`;
    const upload = await this.video.signUpload(key);
    return { key, url: upload.url, token: upload.token };
  }

  /**
   * O worker anuncia os modelos com que vai trabalhar — nome, versão e
   * **licença**. A tabela é o registo de proveniência: quando um fine-tuning
   * mudar os números, é isto que diz que modelo produziu os de antes.
   */
  async registerModel(dto: WorkerModelDto) {
    await this.platform.aIModelVersion.upsert({
      where: { task_name_version: { task: dto.task, name: dto.name, version: dto.version } },
      create: {
        task: dto.task, name: dto.name, version: dto.version,
        license: dto.license, source: dto.source ?? null, notes: dto.notes ?? null,
      },
      update: { license: dto.license, source: dto.source ?? null, notes: dto.notes ?? null, active: true },
    });
    return { ok: true };
  }

  /* ---------------------------------------------------------------------- */
  /* Efeitos por tipo de job                                                */
  /* ---------------------------------------------------------------------- */

  private async applyQuality(db: TenantDb, job: LocatedJob, result: Record<string, unknown>) {
    const videoId = (job.params as { videoId?: string } | null)?.videoId;
    const meta = (result.video ?? {}) as { durationSec?: number; width?: number; height?: number; fps?: number };
    const verdict = typeof result.verdict === "string" ? result.verdict : "unknown";
    const feasibility = (result.feasibility ?? {}) as Record<string, number>;

    const video = await db.aIVideo.findFirst({
      where: videoId ? { id: videoId } : { analysisId: job.analysisId, status: "READY" },
      select: { id: true },
    });
    if (video) {
      await db.aIVideo.update({
        where: { id: video.id },
        data: {
          durationSec: meta.durationSec ?? null,
          width: meta.width ?? null,
          height: meta.height ?? null,
          fps: meta.fps ?? null,
          quality: result as object,
          updatedAt: new Date(),
        },
      });
    }

    const analysis = await db.aIAnalysis.findFirst({
      where: { id: job.analysisId },
      select: { confidence: true },
    });
    const confidence = { ...asObject(analysis?.confidence), quality: feasibility };

    if (verdict === "poor") {
      // Não se processa má matéria-prima em silêncio: a análise pára aqui, o
      // relatório diz porquê, e o botão "Processar mesmo assim" é do treinador.
      await db.aIAnalysis.update({
        where: { id: job.analysisId },
        data: { status: "REVIEW", progress: overallProgress("quality_check", 100), confidence: confidence as object, updatedAt: new Date() },
      });
      return;
    }

    await db.aIAnalysis.update({
      where: { id: job.analysisId },
      data: { status: "QUEUED", progress: overallProgress("quality_check", 100), confidence: confidence as object, updatedAt: new Date() },
    });
    await this.jobs.enqueue(db, job.academyId, job.analysisId, "detect_track", { videoId: video?.id });
  }

  private async applyDetectTrack(db: TenantDb, job: LocatedJob, result: Record<string, unknown>) {
    const tracks = Array.isArray(result.tracks) ? (result.tracks as RawTrack[]) : [];

    // O plantel confirmado é o universo fechado das identidades — um athleteId
    // proposto pelo worker que não esteja nele é descartado, não gravado.
    const squad = await db.aIAnalysisPlayer.findMany({
      where: { analysisId: job.analysisId },
      select: { athleteId: true },
    });
    const allowed = new Set(squad.map((s) => s.athleteId));

    // Idempotente: reprocessar substitui os tracks automáticos e **preserva os
    // corrigidos** — uma correção humana nunca se deita fora por um re-run.
    await db.playerTrack.deleteMany({ where: { analysisId: job.analysisId, status: "auto" } });

    for (const t of tracks) {
      if (!Number.isFinite(t.trackNumber) || !Number.isFinite(t.firstMs) || !Number.isFinite(t.lastMs)) continue;
      const athleteId = t.athleteId && allowed.has(t.athleteId) ? t.athleteId : null;
      await db.playerTrack.create({
        data: {
          academyId: job.academyId,
          analysisId: job.analysisId,
          trackNumber: Math.trunc(t.trackNumber),
          side: typeof t.side === "string" ? t.side : "unknown",
          jerseyNumber: Number.isFinite(t.jerseyNumber as number) ? Math.trunc(t.jerseyNumber as number) : null,
          athleteId,
          identityConfidence: clamp01(t.identityConfidence),
          trackConfidence: clamp01(t.trackConfidence),
          firstMs: Math.max(0, Math.trunc(t.firstMs)),
          lastMs: Math.max(0, Math.trunc(t.lastMs)),
          frameCount: Number.isFinite(t.frameCount as number) ? Math.trunc(t.frameCount as number) : 0,
          dataKey: typeof t.dataKey === "string" ? t.dataKey : null,
          ...(t.summary != null ? { summary: t.summary as object } : {}),
          updatedAt: new Date(),
        },
      });
    }

    const analysis = await db.aIAnalysis.findFirst({
      where: { id: job.analysisId },
      select: { title: true, confidence: true, createdBy: { select: { userId: true } } },
    });
    const confidence = { ...asObject(analysis?.confidence), ...asObject(result.confidence) };

    await db.aIAnalysis.update({
      where: { id: job.analysisId },
      data: {
        status: "COMPLETED",
        progress: 100,
        completedAt: new Date(),
        confidence: confidence as object,
        updatedAt: new Date(),
      },
    });
    // Decide REVIEW vs COMPLETED a partir do que ficou abaixo do limiar.
    await this.jobs.recomputeReview(db, job.analysisId);

    // O treinador fechou a consola há uma hora — é isto que lhe diz que pode voltar.
    if (analysis?.createdBy?.userId) {
      await this.notifications.enqueue(
        {
          academyId: job.academyId,
          userId: analysis.createdBy.userId,
          type: "AI_ANALYSIS_COMPLETED",
          title: "Análise concluída",
          body: `A análise "${analysis.title}" terminou.`,
          payload: { route: `/ai/analises/${job.analysisId}` },
        },
        db,
      );
    }
  }

  /* ---------------------------------------------------------------------- */

  /**
   * De que academia é este job — a única pergunta que a ligação da plataforma
   * responde fora do claim. Um id inventado dá 404 e acabou.
   */
  private async locate(jobId: string): Promise<LocatedJob> {
    const job = await this.platform.aIJob.findUnique({
      where: { id: jobId },
      select: { id: true, academyId: true, analysisId: true, kind: true, params: true, startedAt: true, status: true },
    });
    if (!job || ["DONE", "CANCELLED"].includes(job.status)) throw new NotFoundException("Job não encontrado");
    return job;
  }
}

type LocatedJob = {
  id: string;
  academyId: string;
  analysisId: string;
  kind: string;
  params: unknown;
  startedAt: Date | null;
  status: string;
};

/** O cliente dentro de `runAs` — o tipo exacto não interessa aqui. */
type TenantDb = Parameters<Parameters<PrismaService["runAs"]>[1]>[0];

type RawTrack = {
  trackNumber: number;
  side?: string;
  jerseyNumber?: number;
  athleteId?: string;
  identityConfidence?: number;
  trackConfidence?: number;
  firstMs: number;
  lastMs: number;
  frameCount?: number;
  dataKey?: string;
  summary?: unknown;
};

/**
 * O progresso da análise inteira, a partir do progresso de um job.
 *
 * A qualidade é os primeiros 15%; a detecção é o resto. Quando houver mais
 * etapas (campo, bola, eventos), as janelas apertam-se aqui e em mais lado
 * nenhum.
 */
function overallProgress(kind: string, jobProgress: number): number {
  const windows: Record<string, [number, number]> = {
    quality_check: [0, 15],
    detect_track: [15, 100],
  };
  const [from, to] = windows[kind] ?? [0, 100];
  return Math.min(100, Math.max(0, Math.round(from + ((to - from) * jobProgress) / 100)));
}

function clamp01(x: unknown): number | null {
  return typeof x === "number" && Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : null;
}

function asObject(x: unknown): Record<string, unknown> {
  return x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : {};
}

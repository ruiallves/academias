import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { PlatformPrisma } from "../platform/platform.prisma";
import { NotificationsService } from "../notifications/notifications.service";
import { AiVideoService } from "./ai-video.service";
import { AiJobsService, REVIEW_THRESHOLD } from "./ai-jobs.service";
import { AiPresenceService } from "./ai-presence.service";
import type {
  WorkerClaimDto,
  WorkerCompleteDto,
  WorkerFailDto,
  WorkerHeartbeatDto,
  WorkerModelDto,
  WorkerTracksDto,
  WorkerUploadUrlDto,
  WorkerDownloadUrlDto,
  WorkerVideoReceivedDto,
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
    private readonly presence: AiPresenceService,
    private readonly notifications: NotificationsService,
  ) {}

  /* ---------------------------------------------------------------------- */
  /* Claim                                                                  */
  /* ---------------------------------------------------------------------- */

  async claim(dto: WorkerClaimDto) {
    // Perguntar por trabalho é a prova de vida: é o que permite à consola dizer
    // "nenhum worker ligado" em vez de "à espera de um worker" para sempre.
    this.presence.marcar(dto.worker, dto.kinds);
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
        SELECT j.id FROM "AIJob" j
        WHERE j.status = 'PENDING' AND j.kind = ANY(${dto.kinds})
          /*
           * O vídeo vive no disco de um worker (ver AIVideo.holder). Um job
           * dessa análise só serve a esse worker: outro reclamá-lo era falhar
           * de certeza, gastar uma tentativa e devolver o job à fila — e com
           * dois workers a alternar, gastar as duas. Sem holder (caminho pelo
           * Storage) qualquer um serve, como sempre.
           */
          AND NOT EXISTS (
            SELECT 1 FROM "AIVideo" v
            WHERE v."analysisId" = j."analysisId"
              AND v.status = 'READY'
              AND v.holder IS NOT NULL
              AND v.holder <> ${dto.worker}
          )
        ORDER BY j.priority DESC, j."createdAt" ASC
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
            // A identificação não precisa do vídeo — trabalha sobre os recortes
            // no Storage — e corre quando ele já pode ter sido purgado. Para as
            // outras etapas, sem vídeo pronto não há trabalho.
            where: { status: job.kind === "identify" ? { in: ["READY", "PURGED"] } : "READY" },
            orderBy: { createdAt: "asc" },
            take: 1,
            select: { id: true, storageKey: true, mimeType: true, durationSec: true, quality: true, holder: true, status: true },
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

      /*
       * Reclamar um job põe a análise "a processar" — menos quando o job é a
       * purga. Apagar o ficheiro é arrumação depois do trabalho feito; marcá-la
       * como a processar fazia uma análise **concluída** voltar a "A processar"
       * à frente de quem estava a olhar, e ficar lá para sempre, porque a purga
       * não tem um fim que a devolva a COMPLETED.
       */
      // Nem a purga nem uma propagação (ver `isPropagate`): são arrumação e
      // re-agrupamento sobre uma análise já fechada, não trabalho novo.
      if (job.kind !== "purge_video" && !isPropagate(job)) {
        await db.aIAnalysis.update({
          where: { id: analysis.id },
          data: { status: "PROCESSING", updatedAt: new Date() },
        });
      }

      const video = analysis.videos[0];
      /*
       * De onde vem o vídeo.
       *
       * Com `holder`, está no disco do próprio worker que está a reclamar (o
       * claim já garantiu isso) — vai o id, e o worker sabe o caminho. Sem
       * `holder` é o caminho antigo: um link assinado de duas horas, que chega
       * para descarregar um jogo numa ligação caseira e caduca sozinho.
       */
      // Um vídeo purgado não tem link para dar — e a única etapa que o aceita
      // purgado (a identificação) também não o pede.
      const videoUrl =
        video.holder || video.status === "PURGED" ? null : await this.video.signDownload(video.storageKey, 7200);

      // O contexto da identificação: os tracks e o que um humano já confirmou.
      const identify = job.kind === "identify" ? await this.identifyContext(db, job.analysisId) : undefined;

      return {
        id: job.id,
        ...(identify ? { identify } : {}),
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
          source: video.holder ? "worker" : "storage",
          url: videoUrl,
          mimeType: video.mimeType,
          durationSec: video.durationSec,
          quality: video.quality ?? null,
        },
      };
    });
  }

  /* ---------------------------------------------------------------------- */
  /* O vídeo chegou ao worker                                                */
  /* ---------------------------------------------------------------------- */

  /**
   * O caminho directo: o browser enviou o vídeo em blocos para o worker, o
   * worker juntou-os, mediu-os, e diz-nos que os tem. É o que põe a análise na
   * fila — com `holder` marcado, para os jobs irem ter com quem tem o ficheiro.
   *
   * A confiança vem do token de worker (guard) e do id do vídeo: um worker só
   * fecha vídeos que estejam à espera de bytes. Um id inventado dá 404.
   */
  async videoReceived(videoId: string, dto: WorkerVideoReceivedDto) {
    const video = await this.platform.aIVideo.findUnique({
      where: { id: videoId },
      select: { id: true, academyId: true, analysisId: true, status: true },
    });
    if (!video) throw new NotFoundException("Vídeo não encontrado");
    // Idempotente: um `complete` repetido pelo browser não enfileira duas vezes.
    if (video.status === "READY") return { ok: true, already: true };
    if (video.status !== "UPLOADING") throw new BadRequestException("Este vídeo já não aceita carregamento");

    await this.prisma.runAs(video.academyId, async (db) => {
      await db.aIVideo.update({
        where: { id: videoId },
        data: {
          status: "READY",
          holder: dto.worker,
          sizeBytes: BigInt(dto.sizeBytes),
          durationSec: dto.durationSec ?? null,
          width: dto.width ?? null,
          height: dto.height ?? null,
          fps: dto.fps ?? null,
          updatedAt: new Date(),
        },
      });
      await db.aIAnalysis.update({
        where: { id: video.analysisId },
        data: { status: "QUEUED", progress: 0, updatedAt: new Date() },
      });
      await this.jobs.enqueue(db, video.academyId, video.analysisId, "quality_check", { videoId });
    });
    return { ok: true };
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
    /*
     * A presença marca-se **antes** de procurar o job, e de propósito.
     *
     * Um worker a processar não pede trabalho durante horas — o heartbeat é a
     * única prova de vida dele. E se o job entretanto desapareceu (a análise
     * foi apagada), o `locate` abaixo atira 404: marcar depois seria não marcar
     * nunca, e o ecrã diria "nenhuma máquina ligada" a quem tem uma máquina
     * viva, presa a trabalho que já não interessa. São coisas diferentes e o
     * produto tem de as saber distinguir.
     */
    if (dto.worker) this.presence.marcar(dto.worker);

    const job = await this.locate(jobId);
    if (job.claimedBy) this.presence.marcar(job.claimedBy);

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
      // Nem a purga nem uma propagação são progresso da análise — ver a nota
      // no claim. Uma análise a 100 não pode recuar aos 85 por uma confirmação.
      if (dto.progress != null && job.kind !== "purge_video" && !isPropagate(job)) {
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

    /*
     * Mais folga do que os cinco segundos por omissão.
     *
     * Isto grava, de uma vez, o resultado inteiro de uma hora e meia de
     * processamento: o JSON do job, os tracks em lotes, e o recálculo da
     * revisão. Cinco segundos chegam para o caso normal e não chegam para o
     * jogo grande — e falhar **aqui** é o pior sítio para falhar, porque o
     * trabalho está todo feito e perde-se inteiro. É o mesmo argumento das
     * operações em lote que já usam `timeoutMs`.
     */
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
      } else if (job.kind === "identify") {
        await this.applyIdentify(db, job, dto.result);
      } else if (job.kind === "purge_video") {
        await this.applyPurge(db, job);
      } else {
        this.log.warn(`Job ${jobId} de tipo desconhecido "${job.kind}" terminou — resultado guardado, sem efeitos.`);
      }
    }, { timeoutMs: 60_000 });
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
        // Falhou de vez: o ficheiro não fica à espera de ninguém. A purga
        // própria não se purga — senão era um job a gerar-se a si mesmo.
        if (job.kind !== "purge_video") await this.enqueuePurge(db, job.academyId, job.analysisId);
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
  /**
   * Um endereço assinado para o worker **ler** um derivado — o espelho de
   * `uploadUrl`, com a mesma prisão ao job: `derived/` desta análise e mais
   * lado nenhum. É como a identificação lê os recortes e os embeddings que a
   * detecção deixou, sem credenciais de Storage. `url: null` quando o ficheiro
   * não existe — o worker decide se isso é erro.
   */
  async downloadUrl(jobId: string, dto: WorkerDownloadUrlDto) {
    const job = await this.locate(jobId);

    const path = dto.path.replace(/^\/+/, "");
    if (path.includes("..") || !/^[\w./-]+$/.test(path)) {
      throw new BadRequestException("Caminho inválido");
    }

    const key = `${job.academyId}/${job.analysisId}/derived/${path}`;
    if (!(await this.video.exists(key))) return { key, url: null };
    return { key, url: await this.video.signDownload(key, 900) };
  }

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

    const allowed = await this.squadOf(db, job.analysisId);

    /*
     * Idempotente: reprocessar substitui os tracks automáticos e **preserva os
     * corrigidos** — uma correção humana nunca se deita fora por um re-run.
     *
     * Só quando os tracks vêm no corpo do `complete`. Quando vêm em lotes (o
     * caminho de hoje), foi o primeiro lote que limpou — limpar outra vez aqui
     * apagava tudo o que os lotes acabaram de escrever.
     */
    if (tracks.length > 0) {
      await db.playerTrack.deleteMany({ where: { analysisId: job.analysisId, status: "auto" } });
    }

    /*
     * Em lotes, e não um `create` por track.
     *
     * Era um `for` com um `await db.playerTrack.create()` lá dentro: uma ida ao
     * Postgres por track, em série, dentro de uma transação com tecto de cinco
     * segundos. Com os vinte e dois tracks de um jogo bem seguido passava; com
     * os milhares que o ByteTrack produz num jogo filmado de longe — cada
     * oclusão parte um track em dois — estourava o tecto e o job dava-se por
     * falhado depois de ter feito o trabalho todo.
     *
     * `createMany` faz um INSERT só por lote. O lote é de 500 e não "todos":
     * o Postgres tem tecto de 65 535 parâmetros por instrução, e com treze
     * colunas isso dava-se mal por volta dos cinco mil tracks — um limite que
     * ninguém vê chegar até ao dia em que chega.
     */
    await this.writeTracks(db, job, tracks, allowed);

    const analysis = await db.aIAnalysis.findFirst({
      where: { id: job.analysisId },
      select: { title: true, confidence: true, createdBy: { select: { userId: true } } },
    });
    const confidence = { ...asObject(analysis?.confidence), ...asObject(result.confidence) };

    await db.aIAnalysis.update({
      where: { id: job.analysisId },
      data: {
        // Ainda não acabou: a identificação vem a seguir. O que fica escrito
        // é o que a detecção mediu; o estado e a data de fim são da etapa final.
        progress: overallProgress("detect_track", 100),
        confidence: confidence as object,
        updatedAt: new Date(),
      },
    });

    /*
     * A etapa seguinte: dos tracks às pessoas.
     *
     * A detecção deixou os recortes no Storage; a identificação lê-os de lá e
     * nunca o vídeo — por isso a purga pode esperar por ela sem custo, e é
     * ela que fecha a análise e avisa quem a criou (ver `applyIdentify`).
     */
    await this.jobs.enqueue(db, job.academyId, job.analysisId, "identify", {
      videoId: (job.params as { videoId?: string } | null)?.videoId,
    });
  }

  /** O plantel confirmado — o universo fechado das identidades possíveis. */
  private async squadOf(db: TenantDb, analysisId: string): Promise<Set<string>> {
    const squad = await db.aIAnalysisPlayer.findMany({
      where: { analysisId },
      select: { athleteId: true },
    });
    return new Set(squad.map((s) => s.athleteId));
  }

  /**
   * Escreve tracks, em lotes de 500.
   *
   * O lote não é "todos" por causa do Postgres: há um tecto de 65 535
   * parâmetros por instrução, e com treze colunas isso dá-se mal por volta dos
   * cinco mil tracks — um limite que ninguém vê chegar até ao dia em que chega.
   */
  private async writeTracks(db: TenantDb, job: LocatedJob, tracks: RawTrack[], allowed: Set<string>): Promise<number> {
    const linhas = tracks
      .filter((t) => Number.isFinite(t.trackNumber) && Number.isFinite(t.firstMs) && Number.isFinite(t.lastMs))
      .map((t) => ({
        academyId: job.academyId,
        analysisId: job.analysisId,
        trackNumber: Math.trunc(t.trackNumber),
        side: typeof t.side === "string" ? t.side : "unknown",
        jerseyNumber: Number.isFinite(t.jerseyNumber as number) ? Math.trunc(t.jerseyNumber as number) : null,
        // O plantel confirmado é o universo fechado: um id de fora é descartado.
        athleteId: t.athleteId && allowed.has(t.athleteId) ? t.athleteId : null,
        identityConfidence: clamp01(t.identityConfidence),
        trackConfidence: clamp01(t.trackConfidence),
        firstMs: Math.max(0, Math.trunc(t.firstMs)),
        lastMs: Math.max(0, Math.trunc(t.lastMs)),
        frameCount: Number.isFinite(t.frameCount as number) ? Math.trunc(t.frameCount as number) : 0,
        dataKey: typeof t.dataKey === "string" ? t.dataKey : null,
        ...(t.summary != null ? { summary: t.summary as object } : {}),
        updatedAt: new Date(),
      }));

    for (let i = 0; i < linhas.length; i += 500) {
      await db.playerTrack.createMany({ data: linhas.slice(i, i + 500) });
    }
    return linhas.length;
  }

  /**
   * Um lote de tracks, guardado **antes** do `complete`.
   *
   * ## Porque é que eles deixaram de viajar no `complete`
   *
   * Porque o corpo desse pedido passou a depender do jogo. Um jogo filmado de
   * longe produz milhares de tracks — cada oclusão parte um em dois — e o JSON
   * do `complete` passou os 16 MB que a rota aceita: **413**, o job dado por
   * falhado, e duas horas de detecção deitadas fora *depois* de estarem feitas.
   * Aconteceu.
   *
   * Em lotes, o tamanho de cada pedido é uma constante nossa e não uma
   * propriedade do jogo. O `reset` do primeiro lote faz o que o `complete`
   * fazia: substitui os automáticos, preserva os corrigidos.
   */
  async saveTracks(jobId: string, dto: WorkerTracksDto) {
    const job = await this.locate(jobId);

    const gravados = await this.prisma.runAs(
      job.academyId,
      async (db) => {
        if (dto.reset) {
          await db.playerTrack.deleteMany({ where: { analysisId: job.analysisId, status: "auto" } });
        }
        const allowed = await this.squadOf(db, job.analysisId);
        return this.writeTracks(db, job, dto.tracks as unknown as RawTrack[], allowed);
      },
      // Um lote são até mil linhas mais o `deleteMany` do primeiro: os cinco
      // segundos por omissão chegam para o caso normal e não para o mau dia.
      { timeoutMs: 60_000 },
    );
    return { ok: true, saved: gravados };
  }

  /* ---------------------------------------------------------------------- */
  /* A purga do vídeo                                                       */
  /* ---------------------------------------------------------------------- */

  /**
   * Pede ao worker que apague o ficheiro — só quando há um worker a tê-lo.
   *
   * Um job e não uma chamada: o worker não tem porta para lhe ligarmos (é
   * ele que nos pergunta por trabalho), e a fila já sabe entregar a quem tem
   * o vídeo. Prioridade alta para o disco se libertar antes do jogo seguinte.
   * Pelo Storage (sem `holder`) não há nada a fazer aqui — esse caminho tem
   * outra vida.
   */
  private async enqueuePurge(db: TenantDb, academyId: string, analysisId: string) {
    const video = await db.aIVideo.findFirst({
      where: { analysisId, status: "READY", holder: { not: null } },
      select: { id: true },
    });
    if (!video) return;
    const pendente = await db.aIJob.findFirst({
      where: { analysisId, kind: "purge_video", status: { in: ["PENDING", "CLAIMED", "RUNNING"] } },
      select: { id: true },
    });
    if (pendente) return;
    await this.jobs.enqueue(db, academyId, analysisId, "purge_video", { videoId: video.id }, 10);
  }

  /** O worker apagou: a linha fica, com o tamanho e a duração, para a página dizer o que analisou. */
  /**
   * O que a etapa de identificação precisa além dos recortes: os tracks (a
   * janela temporal de cada um — dois ao mesmo tempo não são a mesma pessoa) e
   * o que um humano já confirmou. As confirmações são as **âncoras**: é por
   * elas que confirmar um jogador se propaga aos fragmentos parecidos.
   */
  private async identifyContext(db: TenantDb, analysisId: string) {
    const [tracks, confirmadas] = await Promise.all([
      db.playerTrack.findMany({
        where: { analysisId },
        select: {
          trackNumber: true, firstMs: true, lastMs: true,
          identity: { select: { status: true, athleteId: true } },
        },
      }),
      db.playerIdentity.findMany({
        where: { analysisId, status: "confirmed", athleteId: { not: null } },
        select: { id: true, athleteId: true, tracks: { select: { trackNumber: true } } },
      }),
    ]);
    return {
      tracks: tracks.map((t) => ({
        trackNumber: t.trackNumber,
        firstMs: t.firstMs,
        lastMs: t.lastMs,
        confirmedAthleteId: t.identity?.status === "confirmed" ? t.identity.athleteId : null,
      })),
      confirmed: confirmadas.map((i) => ({
        identityId: i.id,
        athleteId: i.athleteId,
        trackNumbers: i.tracks.map((t) => t.trackNumber),
      })),
      // Os embeddings ficam no Storage depois da primeira passagem: uma
      // propagação re-agrupa em segundos em vez de voltar a correr os modelos.
      reuseEmbeddings: true,
    };
  }

  /**
   * A identificação terminou — os tracks passam a ter pessoas.
   *
   * ## O que se preserva e o que se substitui
   *
   * As identidades que um humano decidiu (`confirmed`, `rejected`) ficam; o
   * resto é apagado e reconstruído a partir do que o worker agrupou. Uma
   * confirmação humana nunca se deita fora por um re-run — e quando o worker
   * diz que um grupo contém tracks de alguém confirmado (`anchorAthleteId`),
   * esse grupo **é** essa identidade: actualiza-se a linha em vez de se criar
   * outra, e o que ela ganhou de tracks novos ganhou-o com o nome já certo.
   *
   * ## O limiar decide o estado, não a existência
   *
   * Proposta acima de `REVIEW_THRESHOLD` → `accepted`, com o atleta escrito e
   * revisível. Abaixo → `proposed`, à espera de confirmação. Sem proposta →
   * `unknown`. Em nenhum caso se inventa: o que a máquina não sabe fica a
   * dizer que não sabe, com a imagem à frente de quem vai responder.
   *
   * O track herda o veredicto (atleta, confiança, lado): é o que a ficha do
   * atleta lê, e mantém verdadeiro o que já existia.
   */
  private async applyIdentify(db: TenantDb, job: LocatedJob, result: Record<string, unknown>) {
    const identities = Array.isArray(result.identities) ? (result.identities as RawIdentity[]) : [];
    const allowed = await this.squadOf(db, job.analysisId);
    const embeddingKey = typeof result.embeddingsKey === "string" ? result.embeddingsKey : null;

    const humanas = await db.playerIdentity.findMany({
      where: { analysisId: job.analysisId, status: { in: ["confirmed", "rejected"] } },
      select: { id: true, athleteId: true },
    });
    const humanaPorAtleta = new Map(humanas.filter((h) => h.athleteId).map((h) => [h.athleteId as string, h]));
    // `SetNull` no track: apagar a identidade solta-o, não o apaga.
    await db.playerIdentity.deleteMany({
      where: { analysisId: job.analysisId, status: { notIn: ["confirmed", "rejected"] } },
    });

    for (const raw of identities) {
      const trackNumbers = (Array.isArray(raw.trackNumbers) ? raw.trackNumbers : [])
        .filter((n) => Number.isFinite(n))
        .map((n) => Math.trunc(n));
      if (trackNumbers.length === 0 || !Number.isFinite(raw.firstMs) || !Number.isFinite(raw.lastMs)) continue;

      // O plantel confirmado é o universo fechado — uma proposta de fora não se grava.
      const proposed = raw.proposedAthleteId && allowed.has(raw.proposedAthleteId) ? raw.proposedAthleteId : null;
      const conf = proposed ? clamp01(raw.proposedConfidence) : null;
      const ancora = raw.anchorAthleteId ? humanaPorAtleta.get(raw.anchorAthleteId) : undefined;

      let status: string;
      let athleteId: string | null;
      if (ancora) {
        status = "confirmed";
        athleteId = ancora.athleteId;
      } else if (proposed && conf != null && conf >= REVIEW_THRESHOLD) {
        status = "accepted";
        athleteId = proposed;
      } else if (proposed) {
        status = "proposed";
        athleteId = null;
      } else {
        status = "unknown";
        athleteId = null;
      }

      const side = typeof raw.side === "string" ? raw.side : "unknown";
      const jerseyNumber = Number.isFinite(raw.jerseyNumber as number) ? Math.trunc(raw.jerseyNumber as number) : null;
      const data = {
        label: Number.isFinite(raw.label) ? Math.trunc(raw.label) : 0,
        athleteId,
        proposedAthleteId: proposed,
        proposedConfidence: conf,
        jerseyNumber,
        jerseyConfidence: clamp01(raw.jerseyConfidence),
        side,
        status,
        firstMs: Math.max(0, Math.trunc(raw.firstMs)),
        lastMs: Math.max(0, Math.trunc(raw.lastMs)),
        trackCount: trackNumbers.length,
        presenceMs: Number.isFinite(raw.presenceMs as number) ? Math.max(0, Math.trunc(raw.presenceMs as number)) : 0,
        embeddingKey,
        ...(raw.summary != null ? { summary: raw.summary as object } : {}),
        updatedAt: new Date(),
      };

      const identity = ancora
        ? await db.playerIdentity.update({ where: { id: ancora.id }, data, select: { id: true } })
        : await db.playerIdentity.create({
            data: { academyId: job.academyId, analysisId: job.analysisId, ...data },
            select: { id: true },
          });

      await db.playerTrack.updateMany({
        where: { analysisId: job.analysisId, trackNumber: { in: trackNumbers } },
        data: {
          identityId: identity.id,
          athleteId,
          identityConfidence: status === "confirmed" ? 1 : conf,
          jerseyNumber,
          side,
          updatedAt: new Date(),
        },
      });
    }

    const analysis = await db.aIAnalysis.findFirst({
      where: { id: job.analysisId },
      select: { title: true, confidence: true, createdBy: { select: { userId: true } } },
    });
    const confidence = { ...asObject(analysis?.confidence), ...asObject(result.confidence) };
    const propagacao = isPropagate(job);

    await db.aIAnalysis.update({
      where: { id: job.analysisId },
      data: {
        status: "COMPLETED",
        progress: 100,
        // Uma propagação não é um fim novo: a data de conclusão é a da primeira vez.
        ...(propagacao ? {} : { completedAt: new Date() }),
        confidence: confidence as object,
        updatedAt: new Date(),
      },
    });
    // Decide REVIEW vs COMPLETED a partir do que ficou por confirmar — agora por pessoa.
    await this.jobs.recomputeReview(db, job.analysisId);

    if (propagacao) return;

    /*
     * O ficheiro já deu o que tinha a dar: os recortes e os embeddings que a
     * revisão e as propagações vão ler estão no Storage. Fica só o que é dado.
     */
    await this.enqueuePurge(db, job.academyId, job.analysisId);

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

  private async applyPurge(db: TenantDb, job: LocatedJob) {
    const videoId = (job.params as { videoId?: string } | null)?.videoId;
    const video = await db.aIVideo.findFirst({
      where: videoId ? { id: videoId } : { analysisId: job.analysisId, status: "READY", holder: { not: null } },
      select: { id: true },
    });
    if (!video) return;
    await db.aIVideo.update({
      where: { id: video.id },
      data: { status: "PURGED", holder: null, purgedAt: new Date(), updatedAt: new Date() },
    });
  }

  /* ---------------------------------------------------------------------- */

  /**
   * De que academia é este job — a única pergunta que a ligação da plataforma
   * responde fora do claim. Um id inventado dá 404 e acabou.
   */
  private async locate(jobId: string): Promise<LocatedJob> {
    const job = await this.platform.aIJob.findUnique({
      where: { id: jobId },
      select: { id: true, academyId: true, analysisId: true, kind: true, params: true, startedAt: true, status: true, claimedBy: true },
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
  claimedBy: string | null;
};

/** O cliente dentro de `runAs` — o tipo exacto não interessa aqui. */
type TenantDb = Parameters<Parameters<PrismaService["runAs"]>[1]>[0];

/**
 * Uma propagação é uma passagem da identificação disparada por uma
 * confirmação humana, sobre uma análise já fechada. Não muda o estado da
 * análise nem o progresso — re-agrupa e devolve.
 */
function isPropagate(job: { kind: string; params: unknown }): boolean {
  return job.kind === "identify" && (job.params as { reason?: string } | null)?.reason === "propagate";
}

/** Uma identidade como o worker a devolve — tudo validado antes de entrar. */
type RawIdentity = {
  label: number;
  trackNumbers: number[];
  firstMs: number;
  lastMs: number;
  presenceMs?: number;
  jerseyNumber?: number | null;
  jerseyConfidence?: number | null;
  proposedAthleteId?: string | null;
  proposedConfidence?: number | null;
  anchorAthleteId?: string | null;
  side?: string;
  summary?: unknown;
};

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
    detect_track: [15, 85],
    identify: [85, 100],
    // Apagar o ficheiro não é progresso da análise — ela já estava a 100.
    purge_video: [100, 100],
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

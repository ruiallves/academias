import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import type { AuthedRequest } from "../auth/auth.guard";
import { Public } from "../auth/auth.guard";
import { AiService } from "./ai.service";
import { AiWorkerService } from "./ai-worker.service";
import { AiWorkerGuard } from "./ai-worker.guard";
import {
  CalibrationDto,
  ChooseKitDto,
  CompleteVideoDto,
  CreateAnalysisDto,
  IdentifyIdentityDto,
  IdentifyTrackDto,
  StartVideoUploadDto,
  UpdateSquadDto,
  WorkerClaimDto,
  WorkerCompleteDto,
  WorkerFailDto,
  WorkerHeartbeatDto,
  WorkerLiveSegmentDto,
  WorkerModelDto,
  WorkerTracksDto,
  WorkerUploadUrlDto,
  WorkerDownloadUrlDto,
  WorkerVideoReceivedDto,
} from "./ai.dto";

/**
 * Academias AI — controlador fino, como todos: as permissões e o âmbito
 * verificam-se no serviço, nunca aqui.
 */
@Controller("api/ai")
export class AiController {
  constructor(private readonly ai: AiService) {}

  @Get("dashboard")
  dashboard(@Req() req: AuthedRequest) {
    return this.ai.dashboard(req.ctx);
  }

  @Get("analyses")
  list(@Req() req: AuthedRequest) {
    return this.ai.listAnalyses(req.ctx);
  }

  @Post("analyses")
  create(@Req() req: AuthedRequest, @Body() dto: CreateAnalysisDto) {
    return this.ai.createAnalysis(req.ctx, dto);
  }

  @Get("analyses/:id")
  detail(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.ai.getAnalysis(req.ctx, id);
  }

  @Patch("analyses/:id/squad")
  squad(@Req() req: AuthedRequest, @Param("id") id: string, @Body() dto: UpdateSquadDto) {
    return this.ai.updateSquad(req.ctx, id, dto);
  }

  /** "A nossa equipa é a de cor X" — dito pelo treinador, no vídeo a correr. */
  @Patch("analyses/:id/kit")
  kit(@Req() req: AuthedRequest, @Param("id") id: string, @Body() dto: ChooseKitDto) {
    return this.ai.chooseKit(req.ctx, id, dto);
  }

  /** O campo, calibrado pelo treinador com 4 a 6 cliques num frame. */
  @Patch("analyses/:id/calibration")
  calibration(@Req() req: AuthedRequest, @Param("id") id: string, @Body() dto: CalibrationDto) {
    return this.ai.setCalibration(req.ctx, id, dto);
  }

  @Delete("analyses/:id")
  remove(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.ai.deleteAnalysis(req.ctx, id);
  }

  @Post("analyses/:id/videos")
  startUpload(@Req() req: AuthedRequest, @Param("id") id: string, @Body() dto: StartVideoUploadDto) {
    return this.ai.startVideoUpload(req.ctx, id, dto);
  }

  @Post("analyses/:id/process")
  requeue(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.ai.requeue(req.ctx, id);
  }

  @Post("videos/:id/complete")
  completeVideo(@Req() req: AuthedRequest, @Param("id") id: string, @Body() dto: CompleteVideoDto) {
    return this.ai.completeVideo(req.ctx, id, dto);
  }

  @Get("videos/:id/url")
  videoUrl(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.ai.videoUrl(req.ctx, id);
  }

  @Get("analyses/:id/crops")
  crops(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.ai.analysisCrops(req.ctx, id);
  }

  /** Os troços já processados do vídeo a correr — os que vêm depois de `after`. */
  @Get("analyses/:id/live")
  live(@Req() req: AuthedRequest, @Param("id") id: string, @Query("after") after?: string) {
    const n = Number.parseInt(after ?? "", 10);
    return this.ai.liveSegments(req.ctx, id, Number.isFinite(n) ? n : -1);
  }

  /** As posições finais por frame — um link curto para o ficheiro da análise. */
  @Get("analyses/:id/positions")
  positions(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.ai.analysisPositions(req.ctx, id);
  }

  @Post("tracks/:id/identify")
  identify(@Req() req: AuthedRequest, @Param("id") id: string, @Body() dto: IdentifyTrackDto) {
    return this.ai.identifyTrack(req.ctx, id, dto);
  }

  @Post("identities/:id/identify")
  identifyIdentity(@Req() req: AuthedRequest, @Param("id") id: string, @Body() dto: IdentifyIdentityDto) {
    return this.ai.identifyIdentity(req.ctx, id, dto);
  }

  @Get("insights")
  insights(@Req() req: AuthedRequest) {
    return this.ai.listInsights(req.ctx);
  }

  @Post("insights/:id/dismiss")
  dismiss(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.ai.dismissInsight(req.ctx, id);
  }
}

/**
 * As rotas dos workers de computer vision.
 *
 * `@Public()` porque um worker não tem sessão Supabase; a fronteira é o
 * `AiWorkerGuard` (token partilhado, recusado se não estiver configurado).
 * Sem throttling: um worker em processamento faz heartbeats a cada poucos
 * segundos, e o tecto por IP de 120/min é para pessoas, não para ele — o
 * token é a fronteira, e quem não o tem leva 401 antes de custar nada.
 */
@Public()
@SkipThrottle()
@UseGuards(AiWorkerGuard)
@Controller("api/ai/worker")
export class AiWorkerController {
  constructor(private readonly worker: AiWorkerService) {}

  @Post("claim")
  claim(@Body() dto: WorkerClaimDto) {
    return this.worker.claim(dto);
  }

  @Post("jobs/:id/heartbeat")
  heartbeat(@Param("id") id: string, @Body() dto: WorkerHeartbeatDto) {
    return this.worker.heartbeat(id, dto);
  }

  /** Os tracks, em lotes, antes do `complete`. Ver `WorkerTracksDto`. */
  @Post("jobs/:id/tracks")
  tracks(@Param("id") id: string, @Body() dto: WorkerTracksDto) {
    return this.worker.saveTracks(id, dto);
  }

  /** Um troço do vídeo a correr — ver `WorkerLiveSegmentDto`. */
  @Post("jobs/:id/live")
  live(@Param("id") id: string, @Body() dto: WorkerLiveSegmentDto) {
    return this.worker.saveLiveSegment(id, dto);
  }

  @Post("jobs/:id/complete")
  complete(@Param("id") id: string, @Body() dto: WorkerCompleteDto) {
    return this.worker.complete(id, dto);
  }

  @Post("jobs/:id/fail")
  fail(@Param("id") id: string, @Body() dto: WorkerFailDto) {
    return this.worker.fail(id, dto);
  }

  @Post("jobs/:id/upload-url")
  uploadUrl(@Param("id") id: string, @Body() dto: WorkerUploadUrlDto) {
    return this.worker.uploadUrl(id, dto);
  }

  @Post("jobs/:id/download-url")
  downloadUrl(@Param("id") id: string, @Body() dto: WorkerDownloadUrlDto) {
    return this.worker.downloadUrl(id, dto);
  }

  /** O vídeo chegou inteiro ao worker — o caminho directo, sem Storage. */
  @Post("videos/:id/received")
  videoReceived(@Param("id") id: string, @Body() dto: WorkerVideoReceivedDto) {
    return this.worker.videoReceived(id, dto);
  }

  @Post("models")
  registerModel(@Body() dto: WorkerModelDto) {
    return this.worker.registerModel(dto);
  }
}

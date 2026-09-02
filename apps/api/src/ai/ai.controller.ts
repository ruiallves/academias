import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import type { AuthedRequest } from "../auth/auth.guard";
import { Public } from "../auth/auth.guard";
import { AiService } from "./ai.service";
import { AiWorkerService } from "./ai-worker.service";
import { AiWorkerGuard } from "./ai-worker.guard";
import {
  CompleteVideoDto,
  CreateAnalysisDto,
  IdentifyTrackDto,
  StartVideoUploadDto,
  UpdateSquadDto,
  WorkerClaimDto,
  WorkerCompleteDto,
  WorkerFailDto,
  WorkerHeartbeatDto,
  WorkerModelDto,
  WorkerUploadUrlDto,
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

  @Post("tracks/:id/identify")
  identify(@Req() req: AuthedRequest, @Param("id") id: string, @Body() dto: IdentifyTrackDto) {
    return this.ai.identifyTrack(req.ctx, id, dto);
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

  @Post("models")
  registerModel(@Body() dto: WorkerModelDto) {
    return this.worker.registerModel(dto);
  }
}

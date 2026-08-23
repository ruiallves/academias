import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from "@nestjs/common";
import type { AuthedRequest } from "../auth/auth.guard";
import { ScoutingService } from "./scouting.service";
import { ScoutingVideoService } from "./scouting-video.service";
import { ScoutingWorkflowService } from "./scouting-workflow.service";
import {
  AddCandidateDto,
  AddMomentDto,
  AddToShortlistDto,
  CompleteUploadDto,
  CreateObservationDto,
  ProspectInputDto,
  ProspectUpdateDto,
  RecruitDto,
  ScoutingRequestInputDto,
  SetFitDto,
  SetStageDto,
  ShortlistInputDto,
  StartUploadDto,
  UpdateVideoDto,
} from "./scouting.dto";

/**
 * Controlador fino: nenhuma decisão de permissão acontece aqui.
 *
 * Tudo o que decide está em `ScoutingService` — incluindo o 404 em vez de 403 para
 * um prospecto de outra academia. Confirmar que existe seria confirmar que outro
 * clube segue aquele miúdo.
 */
@Controller("api/scouting")
export class ScoutingController {
  constructor(private readonly scouting: ScoutingService) {}

  @Get("overview")
  overview(@Req() req: AuthedRequest) {
    return this.scouting.overview(req.ctx);
  }

  @Get("prospects")
  list(
    @Req() req: AuthedRequest,
    @Query("stage") stage?: string,
    @Query("sportId") sportId?: string,
    @Query("q") q?: string,
  ) {
    return this.scouting.list(req.ctx, { stage, sportId, q });
  }

  @Post("prospects")
  create(@Req() req: AuthedRequest, @Body() dto: ProspectInputDto) {
    return this.scouting.create(req.ctx, dto);
  }

  @Get("prospects/:id")
  detail(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.scouting.detail(req.ctx, id);
  }

  @Patch("prospects/:id")
  update(@Req() req: AuthedRequest, @Param("id") id: string, @Body() dto: ProspectUpdateDto) {
    return this.scouting.update(req.ctx, id, dto);
  }

  @Post("prospects/:id/stage")
  setStage(@Req() req: AuthedRequest, @Param("id") id: string, @Body() dto: SetStageDto) {
    return this.scouting.setStage(req.ctx, id, dto);
  }

  @Post("prospects/:id/observations")
  addObservation(@Req() req: AuthedRequest, @Param("id") id: string, @Body() dto: CreateObservationDto) {
    return this.scouting.addObservation(req.ctx, id, dto);
  }

  /** Todas as observações da academia — a vista do trabalho feito. */
  @Get("observations")
  observations(@Req() req: AuthedRequest, @Query("scoutId") scoutId?: string, @Query("days") days?: string) {
    return this.scouting.observations(req.ctx, { scoutId, days: days ? Number(days) : undefined });
  }

  /** O quadro de avaliação da modalidade. Semeado à primeira leitura. */
  @Get("criteria")
  criteria(@Req() req: AuthedRequest, @Query("sportId") sportId: string) {
    return this.scouting.criteria(req.ctx, sportId);
  }
}

/**
 * Vídeo — controlador à parte.
 *
 * Não é organização: é a fronteira de permissão a ficar visível na estrutura dos
 * ficheiros. Tudo aqui exige `scouting:video:*`, que é separado de
 * `scouting:*` porque isto é imagem de menores que não pertencem à academia.
 */
@Controller("api/scouting")
export class ScoutingVideoController {
  constructor(private readonly videos: ScoutingVideoService) {}

  @Get("prospects/:id/videos")
  list(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.videos.list(req.ctx, id);
  }

  /** Devolve um URL de upload assinado. Os bytes nunca passam por este processo. */
  @Post("prospects/:id/videos")
  start(@Req() req: AuthedRequest, @Param("id") id: string, @Body() dto: StartUploadDto) {
    return this.videos.startUpload(req.ctx, id, dto);
  }

  @Post("videos/:id/complete")
  complete(@Req() req: AuthedRequest, @Param("id") id: string, @Body() dto: CompleteUploadDto) {
    return this.videos.completeUpload(req.ctx, id, dto.durationSec);
  }

  /** Um link de vida curta. Nunca há endereços permanentes. */
  @Get("videos/:id/playback")
  playback(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.videos.playbackUrl(req.ctx, id);
  }

  @Patch("videos/:id")
  update(@Req() req: AuthedRequest, @Param("id") id: string, @Body() dto: UpdateVideoDto) {
    return this.videos.update(req.ctx, id, dto);
  }

  @Delete("videos/:id")
  remove(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.videos.remove(req.ctx, id);
  }

  @Post("videos/:id/moments")
  addMoment(@Req() req: AuthedRequest, @Param("id") id: string, @Body() dto: AddMomentDto) {
    return this.videos.addMoment(req.ctx, id, dto);
  }

  @Delete("moments/:id")
  removeMoment(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.videos.removeMoment(req.ctx, id);
  }
}

/** Shortlists, pedidos, encaixe, comparação e recrutamento. */
@Controller("api/scouting")
export class ScoutingWorkflowController {
  constructor(private readonly workflow: ScoutingWorkflowService) {}

  @Get("shortlists")
  shortlists(@Req() req: AuthedRequest) {
    return this.workflow.shortlists(req.ctx);
  }

  @Post("shortlists")
  createShortlist(@Req() req: AuthedRequest, @Body() dto: ShortlistInputDto) {
    return this.workflow.createShortlist(req.ctx, dto);
  }

  @Get("shortlists/:id")
  shortlist(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.workflow.shortlist(req.ctx, id);
  }

  @Post("shortlists/:id/entries")
  addToShortlist(@Req() req: AuthedRequest, @Param("id") id: string, @Body() dto: AddToShortlistDto) {
    return this.workflow.addToShortlist(req.ctx, id, dto);
  }

  @Delete("shortlist-entries/:id")
  removeFromShortlist(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.workflow.removeFromShortlist(req.ctx, id);
  }

  /** Dois a quatro prospectos, dimensão a dimensão. Sem número único. */
  @Get("compare")
  compare(@Req() req: AuthedRequest, @Query("ids") ids: string) {
    return this.workflow.compare(req.ctx, (ids ?? "").split(",").filter(Boolean));
  }

  @Get("fit-dimensions")
  fitDimensions(@Req() req: AuthedRequest, @Query("sportId") sportId?: string) {
    return this.workflow.fitDimensions(req.ctx, sportId);
  }

  @Post("prospects/:id/fit")
  setFit(@Req() req: AuthedRequest, @Param("id") id: string, @Body() dto: SetFitDto) {
    return this.workflow.setFit(req.ctx, id, dto);
  }

  @Get("requests")
  requests(@Req() req: AuthedRequest, @Query("status") status?: string) {
    return this.workflow.requests(req.ctx, status);
  }

  @Post("requests")
  createRequest(@Req() req: AuthedRequest, @Body() dto: ScoutingRequestInputDto) {
    return this.workflow.createRequest(req.ctx, dto);
  }

  @Patch("requests/:id")
  updateRequest(@Req() req: AuthedRequest, @Param("id") id: string, @Body() dto: ScoutingRequestInputDto) {
    return this.workflow.updateRequest(req.ctx, id, dto);
  }

  @Post("requests/:id/candidates")
  addCandidate(@Req() req: AuthedRequest, @Param("id") id: string, @Body() dto: AddCandidateDto) {
    return this.workflow.addCandidate(req.ctx, id, dto);
  }

  /** Prospecto → Atleta. Nada se volta a escrever à mão. */
  @Post("prospects/:id/recruit")
  recruit(@Req() req: AuthedRequest, @Param("id") id: string, @Body() dto: RecruitDto) {
    return this.workflow.recruit(req.ctx, id, dto);
  }

  /** O dossiê de scouting de um atleta já recrutado — para a ficha dele. */
  @Get("athletes/:id/dossier")
  dossier(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.workflow.dossierForAthlete(req.ctx, id);
  }
}

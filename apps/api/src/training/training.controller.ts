import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Req } from "@nestjs/common";
import { Type } from "class-transformer";
import {
  Allow,
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateNested,
} from "class-validator";
import type { AuthedRequest } from "../auth/auth.guard";
import { TrainingService } from "./training.service";

/**
 * Corpos validados. Os limites daqui são a primeira rede — recusam o disparate
 * com uma mensagem legível; o serviço repete os que importam (`clamp`, âmbito,
 * visibilidade), porque nenhum caminho até à base pode ficar sem eles.
 */
class ExerciseDto {
  @IsString() @Length(1, 100) name!: string;
  @IsOptional() @IsString() @Length(0, 4000) description?: string;
  @IsOptional() @IsString() @Length(0, 60) category?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(12) @IsString({ each: true }) objectives?: string[];
  @IsOptional() @IsString() @Length(0, 60) phase?: string;
  @IsOptional() @IsString() @Length(0, 60) type?: string;
  @IsOptional() @IsInt() @Min(1) @Max(10) intensity?: number;
  @IsOptional() @IsString() @Length(0, 40) players?: string;
  @IsOptional() @IsInt() @Min(1) @Max(240) durationMin?: number;
  @IsOptional() @IsString() @Length(0, 40) space?: string;
  @IsOptional() @IsString() @Length(0, 400) material?: string;
  @IsOptional() @IsInt() @Min(4) @Max(99) ageMin?: number;
  @IsOptional() @IsInt() @Min(4) @Max(99) ageMax?: number;
  @IsOptional() @IsInt() @Min(1) @Max(5) complexity?: number;
  @IsOptional() @IsString() @Length(0, 4000) rules?: string;
  @IsOptional() @IsString() @Length(0, 4000) progressions?: string;
  @IsOptional() @IsString() @Length(0, 4000) regressions?: string;
  @IsOptional() @IsString() @Length(0, 4000) coachingPoints?: string;
  @IsOptional() @IsString() @Length(0, 4000) commonErrors?: string;
  @IsOptional() @IsString() @Length(0, 500) videoUrl?: string;
  @IsOptional() @IsIn(["PRIVATE", "CLUB"]) visibility?: string;
  @IsOptional() @IsObject() diagram?: Record<string, unknown>;
}

/** A edição aceita tudo opcional — até o nome, que só muda se vier. */
class ExercisePatchDto extends ExerciseDto {
  @IsOptional() @IsString() @Length(1, 100) declare name: string;
}

class FavoriteDto {
  @IsBoolean() on!: boolean;
}

class ImageUploadDto {
  @IsString() @Length(1, 100) contentType!: string;
}

class ImageKeyDto {
  @IsString() @Length(1, 300) key!: string;
}

class PlanBlockDto {
  @IsString() @Length(1, 80) name!: string;
  @IsInt() @Min(1) @Max(240) durationMin!: number;
  @IsOptional() @IsString() @Length(0, 60) category?: string;
  @IsOptional() @IsString() @Length(0, 120) objective?: string;
  @IsOptional() @IsInt() @Min(1) @Max(10) intensity?: number;
  @IsOptional() @IsString() @Length(0, 40) players?: string;
  @IsOptional() @IsString() @Length(0, 40) space?: string;
  @IsOptional() @IsString() @Length(0, 400) material?: string;
  @IsOptional() @IsString() @Length(0, 1000) notes?: string;
  @IsOptional() @IsString() exerciseId?: string;
}

class PlanDto {
  @IsOptional() @IsString() @Length(0, 120) objective?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(12) @IsString({ each: true }) objectives?: string[];
  @IsOptional() @IsString() @Length(0, 60) sessionType?: string;
  @IsOptional() @IsInt() @Min(1) @Max(10) intensity?: number;
  @IsOptional() @IsInt() @Min(0) @Max(99) expectedAthletes?: number;
  @IsOptional() @IsString() @Length(0, 1000) material?: string;
  @IsOptional() @IsString() @Length(0, 4000) planNotes?: string;
  @IsOptional() @IsString() @Length(0, 4000) postNotes?: string;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => PlanBlockDto)
  blocks?: PlanBlockDto[];
}

class GameModelDto {
  @IsString() @Length(1, 80) name!: string;
  @IsOptional() @IsString() @Length(0, 20) system?: string;
  @IsOptional() @IsString() teamId?: string;
  @IsOptional() @IsIn(["PRIVATE", "CLUB"]) visibility?: string;
  /*
   * `Allow` e não `IsArray`: o lineup mudou de forma quando o futsal chegou —
   * era um array de posições, passou a `{ pitch, slots }` — e o serviço aceita
   * as duas para sempre. O tecto de tamanho está no `checkDiagram` do serviço.
   */
  @IsOptional() @Allow() lineup?: unknown;
  @IsOptional() @IsObject() principles?: Record<string, unknown>;
  @IsOptional() @IsString() @Length(0, 4000) notes?: string;
}

class GameModelPatchDto extends GameModelDto {
  @IsOptional() @IsString() @Length(1, 80) declare name: string;
}

class SetPieceDto {
  @IsString() @Length(1, 40) kind!: string;
  @IsString() @Length(1, 80) name!: string;
  @IsOptional() @IsString() @Length(0, 4000) description?: string;
  @IsOptional() @IsString() teamId?: string;
  @IsOptional() @IsIn(["PRIVATE", "CLUB"]) visibility?: string;
  @IsOptional() @IsObject() diagram?: Record<string, unknown>;
}

class SetPiecePatchDto extends SetPieceDto {
  @IsOptional() @IsString() @Length(1, 40) declare kind: string;
  @IsOptional() @IsString() @Length(1, 80) declare name: string;
}

/**
 * Área técnica.
 *
 * Controlador fino, como os outros: quem pode o quê decide-se no serviço, com
 * `can()`, a visibilidade e o âmbito — nunca aqui.
 */
@Controller("api/training")
export class TrainingController {
  constructor(private readonly training: TrainingService) {}

  /* Exercícios ------------------------------------------------------------- */

  @Get("exercises")
  listExercises(@Req() req: AuthedRequest) {
    return this.training.listExercises(req.ctx);
  }

  @Post("exercises")
  createExercise(@Req() req: AuthedRequest, @Body() dto: ExerciseDto) {
    return this.training.createExercise(req.ctx, dto);
  }

  @Get("exercises/:id")
  getExercise(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.training.getExercise(req.ctx, id);
  }

  @Patch("exercises/:id")
  updateExercise(@Req() req: AuthedRequest, @Param("id") id: string, @Body() dto: ExercisePatchDto) {
    return this.training.updateExercise(req.ctx, id, dto);
  }

  @Delete("exercises/:id")
  deleteExercise(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.training.deleteExercise(req.ctx, id);
  }

  @Post("exercises/:id/duplicate")
  duplicateExercise(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.training.duplicateExercise(req.ctx, id);
  }

  @Put("exercises/:id/favorite")
  setFavorite(@Req() req: AuthedRequest, @Param("id") id: string, @Body() dto: FavoriteDto) {
    return this.training.setFavorite(req.ctx, id, dto.on);
  }

  /* Imagens — o caminho de três passos das fotografias (ver photos.service). */

  @Post("exercises/:id/images/upload")
  imageUploadUrl(@Req() req: AuthedRequest, @Param("id") id: string, @Body() dto: ImageUploadDto) {
    return this.training.imageUploadUrl(req.ctx, id, dto.contentType);
  }

  @Post("exercises/:id/images")
  addImage(@Req() req: AuthedRequest, @Param("id") id: string, @Body() dto: ImageKeyDto) {
    return this.training.addImage(req.ctx, id, dto.key);
  }

  /**
   * A chave vai no corpo e não no caminho: tem barras lá dentro
   * (`exercicios/{id}/{hash}.jpg`), e um DELETE com corpo é menos mau do que
   * uma chave escapada num URL.
   */
  @Post("exercises/:id/images/remove")
  removeImage(@Req() req: AuthedRequest, @Param("id") id: string, @Body() dto: ImageKeyDto) {
    return this.training.removeImage(req.ctx, id, dto.key);
  }

  /* Planos ------------------------------------------------------------------ */

  @Get("plans")
  listPlans(@Req() req: AuthedRequest, @Query("from") from?: string, @Query("to") to?: string) {
    // A mesma janela por omissão de `GET /api/sessions`: o passado recente e o
    // futuro próximo — que é o que o planner e a semana desenham.
    const start = from ? new Date(from) : new Date(Date.now() - 45 * 86_400_000);
    const end = to ? new Date(to) : new Date(Date.now() + 30 * 86_400_000);
    return this.training.listPlans(req.ctx, start, end);
  }

  @Get("sessions/:id/plan")
  getPlan(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.training.getPlan(req.ctx, id);
  }

  @Put("sessions/:id/plan")
  savePlan(@Req() req: AuthedRequest, @Param("id") id: string, @Body() dto: PlanDto) {
    return this.training.savePlan(req.ctx, id, dto);
  }

  /* Modelos de jogo --------------------------------------------------------- */

  @Get("game-models")
  listGameModels(@Req() req: AuthedRequest) {
    return this.training.listGameModels(req.ctx);
  }

  @Post("game-models")
  createGameModel(@Req() req: AuthedRequest, @Body() dto: GameModelDto) {
    return this.training.createGameModel(req.ctx, dto);
  }

  @Patch("game-models/:id")
  updateGameModel(@Req() req: AuthedRequest, @Param("id") id: string, @Body() dto: GameModelPatchDto) {
    return this.training.updateGameModel(req.ctx, id, dto);
  }

  @Delete("game-models/:id")
  deleteGameModel(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.training.deleteGameModel(req.ctx, id);
  }

  /* Bolas paradas ----------------------------------------------------------- */

  @Get("set-pieces")
  listSetPieces(@Req() req: AuthedRequest) {
    return this.training.listSetPieces(req.ctx);
  }

  @Post("set-pieces")
  createSetPiece(@Req() req: AuthedRequest, @Body() dto: SetPieceDto) {
    return this.training.createSetPiece(req.ctx, dto);
  }

  @Patch("set-pieces/:id")
  updateSetPiece(@Req() req: AuthedRequest, @Param("id") id: string, @Body() dto: SetPiecePatchDto) {
    return this.training.updateSetPiece(req.ctx, id, dto);
  }

  @Delete("set-pieces/:id")
  deleteSetPiece(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.training.deleteSetPiece(req.ctx, id);
  }
}

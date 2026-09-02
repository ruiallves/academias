import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateNested,
} from "class-validator";

/**
 * Corpos validados da Academias AI. Como em tudo: os limites daqui são a
 * primeira rede; o serviço repete os que importam (âmbito, estado, tenancy),
 * porque nenhum caminho até à base pode ficar sem eles.
 */

export class SquadEntryDto {
  @IsString() athleteId!: string;
  @IsOptional() @IsInt() @Min(0) @Max(999) jerseyNumber?: number;
}

export class CreateAnalysisDto {
  @IsString() teamId!: string;
  @IsOptional() @IsString() matchId?: string;
  @IsOptional() @IsString() @Length(1, 120) title?: string;
  @IsOptional() @IsString() @Length(0, 120) opponent?: string;
  @IsOptional() @IsString() @Length(0, 120) competition?: string;
  @IsOptional() @IsISO8601() playedOn?: string;
  /** O plantel confirmado — "#10 = Rui Silva". Sem ele a identificação começa cega. */
  @IsArray() @ArrayMaxSize(40) @ValidateNested({ each: true }) @Type(() => SquadEntryDto)
  squad!: SquadEntryDto[];
}

export class UpdateSquadDto {
  @IsArray() @ArrayMaxSize(40) @ValidateNested({ each: true }) @Type(() => SquadEntryDto)
  squad!: SquadEntryDto[];
}

export class StartVideoUploadDto {
  @IsString() @Length(1, 100) mimeType!: string;
  /** Em bytes. `number` chega — o JSON não traz BigInt e 2^53 dá para 8 PB. */
  @IsOptional() @IsInt() @Min(0) sizeBytes?: number;
}

export class CompleteVideoDto {
  @IsOptional() @IsInt() @Min(0) durationSec?: number;
}

export class IdentifyTrackDto {
  /** Nulo = "não é ninguém do plantel" (árbitro, adversário, engano). */
  @IsOptional() @IsString() athleteId?: string | null;
}

/* -------------------------------------------------------------------------- */
/* Worker                                                                      */
/* -------------------------------------------------------------------------- */

export class WorkerClaimDto {
  /** Identifica a máquina — "rui-desktop-rtx3060". Diagnóstico, não segurança. */
  @IsString() @Length(1, 80) worker!: string;
  /** As etapas que este worker sabe fazer. */
  @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) kinds!: string[];
}

export class WorkerHeartbeatDto {
  @IsOptional() @IsInt() @Min(0) @Max(100) progress?: number;
}

export class WorkerCompleteDto {
  @IsObject() result!: Record<string, unknown>;
  @IsOptional() @IsObject() modelVersions?: Record<string, string>;
}

export class WorkerFailDto {
  @IsString() @Length(1, 2000) error!: string;
}

export class WorkerUploadUrlDto {
  /** Caminho relativo dentro da pasta de derivados da análise. */
  @IsString() @Length(1, 200) path!: string;
  @IsOptional() @IsString() @Length(1, 100) contentType?: string;
}

export class WorkerModelDto {
  @IsIn(["detection", "tracking", "reid", "field", "ball", "quality"]) task!: string;
  @IsString() @Length(1, 120) name!: string;
  @IsString() @Length(1, 40) version!: string;
  @IsString() @Length(1, 60) license!: string;
  @IsOptional() @IsString() @Length(0, 300) source?: string;
  @IsOptional() @IsString() @Length(0, 1000) notes?: string;
}

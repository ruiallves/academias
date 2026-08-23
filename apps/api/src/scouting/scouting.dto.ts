import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
  ValidateNested,
} from "class-validator";

/**
 * Os corpos do scouting — classes decoradas, não interfaces.
 *
 * Sem uma classe, a `ValidationPipe` global não filtra nada e um campo a mais no
 * JSON chega ao Prisma inteiro (VULN-005). Aqui é ainda mais importante do que no
 * resto: um `academyId` clandestino num `create` de prospecto seria escrever
 * dados de menores na academia de outra pessoa.
 */

const STAGES = [
  "DISCOVERED", "WATCHING", "OBSERVED", "INTERESTING",
  "SHORTLISTED", "TRIAL", "DECISION", "RECRUITED", "REJECTED",
] as const;

const CONTEXTS = ["MATCH", "TRAINING", "TRIAL", "VIDEO", "OTHER"] as const;

const RECOMMENDATIONS = [
  "DROP", "KEEP_WATCHING", "OBSERVE_AGAIN", "INVITE_TRAINING", "SHORTLIST", "RECRUIT",
] as const;

export class ProspectInputDto {
  @IsString() @Length(2, 120) name!: string;

  /** ISO `YYYY-MM-DD`. O serviço rejeita datas fora de um intervalo plausível. */
  @IsISO8601() birthdate!: string;

  /** A modalidade decide posições e critérios. Nunca há futebol assumido. */
  @IsString() @Length(1, 40) sportId!: string;

  @IsOptional() @IsString() @Length(0, 120) currentClub?: string;
  @IsOptional() @IsString() @Length(0, 60) currentTeam?: string;
  @IsOptional() @IsString() @Length(0, 40) position?: string;

  @IsOptional() @IsArray() @ArrayMaxSize(4) @IsString({ each: true }) secondaryPositions?: string[];

  @IsOptional() @IsIn(["RIGHT", "LEFT", "BOTH", ""]) dominantSide?: string;

  @IsOptional() @IsString() @Length(0, 160) discoveredVia?: string;
  @IsOptional() @IsString() @Length(0, 4000) notes?: string;

  /** Quem responde pelo dossiê. Vazio = quem o criou. */
  @IsOptional() @IsString() @Length(0, 40) ownerId?: string;
}

/**
 * Editar um prospecto que já existe.
 *
 * ## Porque é que não é o DTO de criação
 *
 * Porque `ProspectInputDto` exige nome, data e modalidade — e um `PATCH` que os
 * exigisse obrigava a reenviar o dossiê inteiro para corrigir o clube actual. Era
 * exactamente isto que fazia a edição falhar em silêncio: o corpo parcial não
 * passava a validação, e a interface não tinha por onde dizer porquê.
 */
export class ProspectUpdateDto {
  @IsOptional() @IsString() @Length(2, 120) name?: string;
  @IsOptional() @IsISO8601() birthdate?: string;
  @IsOptional() @IsString() @Length(1, 40) sportId?: string;
  @IsOptional() @IsString() @Length(0, 120) currentClub?: string;
  @IsOptional() @IsString() @Length(0, 60) currentTeam?: string;
  @IsOptional() @IsString() @Length(0, 40) position?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(4) @IsString({ each: true }) secondaryPositions?: string[];
  @IsOptional() @IsIn(["RIGHT", "LEFT", "BOTH", ""]) dominantSide?: string;
  @IsOptional() @IsString() @Length(0, 160) discoveredVia?: string;
  @IsOptional() @IsString() @Length(0, 4000) notes?: string;
  @IsOptional() @IsString() @Length(0, 40) ownerId?: string;
}

export class SetStageDto {
  @IsIn(STAGES as unknown as string[]) stage!: string;
  /** Porquê. Fica no histórico — é o que responde a "quem o dispensou, e porquê?". */
  @IsOptional() @IsString() @Length(0, 500) note?: string;
}

class RatingDto {
  @IsString() @Length(1, 40) criterionId!: string;
  /** 1 a 5. Uma escala fina finge uma precisão que ninguém tem no campo. */
  @IsInt() @Min(1) @Max(5) score!: number;
}

export class CreateObservationDto {
  @IsISO8601() observedAt!: string;

  @IsOptional() @IsIn(CONTEXTS as unknown as string[]) context?: string;

  @IsOptional() @IsString() @Length(0, 120) opponent?: string;
  @IsOptional() @IsString() @Length(0, 120) competition?: string;
  @IsOptional() @IsString() @Length(0, 120) venue?: string;

  @IsOptional() @IsInt() @Min(1) @Max(300) minutesObserved?: number;
  @IsOptional() @IsString() @Length(0, 40) positionObserved?: string;

  @IsOptional() @IsArray() @ArrayMaxSize(12) @IsString({ each: true }) strengths?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(12) @IsString({ each: true }) improvements?: string[];

  @IsOptional() @IsString() @Length(0, 4000) notes?: string;

  @IsOptional() @IsIn(RECOMMENDATIONS as unknown as string[]) recommendation?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(60)
  @ValidateNested({ each: true })
  @Type(() => RatingDto)
  ratings?: RatingDto[];
}

/* -------------------------------------------------------------------------- */
/* Fase 2 — trabalho                                                          */
/* -------------------------------------------------------------------------- */

export class ShortlistInputDto {
  @IsString() @Length(2, 80) name!: string;
  @IsOptional() @IsString() @Length(0, 240) description?: string;
  @IsOptional() @IsString() @Length(0, 40) sportId?: string;
  @IsOptional() @IsString() @Length(0, 40) ageGroup?: string;
  @IsOptional() @IsString() @Length(0, 120) profile?: string;
}

export class AddToShortlistDto {
  @IsString() @Length(1, 40) prospectId!: string;
  @IsOptional() @IsString() @Length(0, 500) note?: string;
}

class FitScoreDto {
  @IsString() @Length(1, 40) dimensionId!: string;
  /** 0–100. Uma opinião registada, não um cálculo — ver `ProspectFit`. */
  @IsInt() @Min(0) @Max(100) value!: number;
}

export class SetFitDto {
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => FitScoreDto)
  scores!: FitScoreDto[];
}

export class ScoutingRequestInputDto {
  @IsString() @Length(3, 120) title!: string;
  @IsOptional() @IsString() @Length(0, 40) sportId?: string;
  @IsOptional() @IsString() @Length(0, 40) ageGroup?: string;
  @IsOptional() @IsString() @Length(0, 40) position?: string;
  @IsOptional() @IsString() @Length(0, 2000) profile?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(12) @IsString({ each: true }) traits?: string[];
  @IsOptional() @IsIn(["LOW", "NORMAL", "HIGH", "CRITICAL"]) urgency?: string;
  @IsOptional() @IsIn(["OPEN", "IN_PROGRESS", "FULFILLED", "CANCELLED"]) status?: string;
  @IsOptional() @IsISO8601() dueDate?: string;
  @IsOptional() @IsString() @Length(0, 40) assignedToId?: string;
}

export class AddCandidateDto {
  @IsString() @Length(1, 40) prospectId!: string;
  @IsOptional() @IsString() @Length(0, 500) note?: string;
}

/**
 * Recrutar.
 *
 * Só a equipa e o NIF: o nome, a data, a modalidade, a posição e o lado dominante
 * já estão no dossiê e são reutilizados. Voltar a pedi-los seria perder dados na
 * passagem e fazer duvidar de para que serviu o scouting.
 */
export class RecruitDto {
  @IsString() @Length(1, 40) teamId!: string;
  @Matches(/^\d{9}$/, { message: "O NIF tem nove dígitos" }) taxId!: string;
  @IsOptional() @IsInt() @Min(0) @Max(999) squadNumber?: number;
  @IsOptional() @IsString() @Length(0, 500) note?: string;
}

/* -------------------------------------------------------------------------- */
/* Fase 3 — vídeo                                                             */
/* -------------------------------------------------------------------------- */

export class StartUploadDto {
  @IsString() @Length(2, 160) title!: string;
  @IsOptional() @IsIn(["MATCH", "TRAINING", "TRIAL", "OTHER"]) kind?: string;
  @IsOptional() @IsISO8601() recordedOn?: string;
  @IsOptional() @IsString() @Length(0, 120) competition?: string;
  @IsOptional() @IsString() @Length(0, 120) opponent?: string;
  @IsOptional() @IsString() @Length(0, 2000) notes?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(12) @IsString({ each: true }) tags?: string[];
  /** A observação a que este vídeo pertence, quando pertence a alguma. */
  @IsOptional() @IsString() @Length(0, 40) observationId?: string;

  /** O servidor recusa formatos que não sabe servir — ver `extensionFor`. */
  @IsString() @Length(3, 60) mimeType!: string;
  @IsOptional() @IsInt() @Min(1) sizeBytes?: number;
}

export class CompleteUploadDto {
  @IsOptional() @IsInt() @Min(1) @Max(86_400) durationSec?: number;
}

export class UpdateVideoDto {
  @IsOptional() @IsString() @Length(2, 160) title?: string;
  @IsOptional() @IsIn(["MATCH", "TRAINING", "TRIAL", "OTHER"]) kind?: string;
  @IsOptional() @IsISO8601() recordedOn?: string;
  @IsOptional() @IsString() @Length(0, 120) competition?: string;
  @IsOptional() @IsString() @Length(0, 120) opponent?: string;
  @IsOptional() @IsString() @Length(0, 2000) notes?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(12) @IsString({ each: true }) tags?: string[];
  @IsOptional() @IsString() @Length(0, 40) observationId?: string;
}

export class AddMomentDto {
  @IsInt() @Min(0) @Max(86_400) atSec!: number;
  @IsOptional() @IsIn(["HIGHLIGHT", "CONCERN", "NOTE"]) kind?: string;
  @IsString() @Length(1, 160) label!: string;
}

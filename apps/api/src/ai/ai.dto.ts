import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
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

/** Confirmar quem é uma **identidade** — vale para todos os tracks dela. */
export class IdentifyIdentityDto {
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
  /**
   * Quem está a bater.
   *
   * Redundante com o job — que já sabe quem o reclamou — em todos os casos
   * menos um: o job que **deixou de existir**. Aí o `locate` deixa de o
   * encontrar e, sem este campo, uma máquina viva e a falar connosco ficava
   * indistinguível de uma máquina desligada. O ecrã dizia "nenhuma máquina
   * ligada" a quem tinha uma a trabalhar à frente dele.
   */
  @IsOptional() @IsString() @Length(1, 80) worker?: string;
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

export class WorkerDownloadUrlDto {
  /** Caminho relativo dentro da pasta de derivados da análise — o espelho do de cima. */
  @IsString() @Length(1, 200) path!: string;
}

/**
 * O worker recebeu o vídeo inteiro pelo caminho directo (ver `ai-ticket.ts`) e
 * já o mediu. É o que põe a análise na fila — o equivalente ao `complete` do
 * caminho pelo Storage, mas dito por quem tem mesmo o ficheiro.
 */
export class WorkerVideoReceivedDto {
  /** O `AI_WORKER_NAME` de quem tem o ficheiro — fica como `holder`. */
  @IsString() @Length(1, 80) worker!: string;
  @IsInt() @Min(0) sizeBytes!: number;
  @IsOptional() @IsInt() @Min(0) durationSec?: number;
  @IsOptional() @IsInt() @Min(0) width?: number;
  @IsOptional() @IsInt() @Min(0) height?: number;
  @IsOptional() @IsNumber() @Min(0) fps?: number;
}

/**
 * Um lote de tracks, a caminho da base.
 *
 * Os tracks deixaram de viajar dentro do `complete`. Um jogo filmado de longe
 * produz milhares — cada oclusão parte um track em dois — e o corpo do
 * `complete` passou dos **16 MB** que a rota aceita: `413`, o job dado por
 * falhado, e duas horas de detecção deitadas fora depois de estarem feitas.
 *
 * Em lotes o tamanho do pedido deixa de depender do jogo. `reset` no primeiro
 * limpa o que lá estava, para reprocessar continuar a substituir em vez de
 * duplicar.
 */
export class WorkerTracksDto {
  @IsOptional() @IsBoolean() reset?: boolean;
  @IsArray() @ArrayMaxSize(1000) @IsObject({ each: true })
  tracks!: Record<string, unknown>[];
}

export class WorkerModelDto {
  @IsIn(["detection", "tracking", "reid", "ocr", "field", "ball", "quality"]) task!: string;
  @IsString() @Length(1, 120) name!: string;
  @IsString() @Length(1, 40) version!: string;
  @IsString() @Length(1, 60) license!: string;
  @IsOptional() @IsString() @Length(0, 300) source?: string;
  @IsOptional() @IsString() @Length(0, 1000) notes?: string;
}

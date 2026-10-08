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
  Matches,
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

/**
 * Um troço do jogo já processado, a caminho do ecrã de quem está a ver.
 *
 * Dez segundos de vídeo a 5 FPS: cinquenta frames, cada um com as caixas que o
 * tracker tem abertas. Os tids são os **brutos** — a numeração final só existe
 * no fim. O resultado definitivo não passa por aqui: vai pelos lotes de tracks
 * e pelo `complete`, como sempre.
 */
export class WorkerLiveSegmentDto {
  @IsInt() @Min(0) index!: number;
  @IsInt() @Min(0) fromMs!: number;
  @IsInt() @Min(0) toMs!: number;
  /** `[largura, altura]` do vídeo — as caixas estão nessas coordenadas. */
  @IsArray() @ArrayMaxSize(2) @IsInt({ each: true }) video!: number[];
  /**
   * `[[tsMs, [[pessoa, x1, y1, x2, y2, conf, grupo], …], bola], …]` — validado
   * no serviço. `grupo`: 0 sem equipa, 1 A, 2 B, 3 outros. `bola`: `[x, y,
   * conf]` ou nula quando não foi vista.
   */
  @IsArray() @ArrayMaxSize(600) frames!: unknown[];
  @IsOptional() @IsObject() stats?: Record<string, unknown>;
  /** As cores das equipas, `{ A: [r, g, b], B: [r, g, b] }`. */
  @IsOptional() @IsObject() teams?: Record<string, unknown>;
}

export class CalibrationPointDto {
  /** O ponto do campo ("corner_tl", "penalty_spot_l", …) — ver `PITCH_LANDMARKS` na consola. */
  @IsString() @Length(1, 40) key!: string;
  /** Onde está na imagem, em píxeis do vídeo. */
  @IsArray() @ArrayMaxSize(2) @IsNumber({}, { each: true }) img!: number[];
  /** Onde está no campo, em metros (origem no canto superior esquerdo, X ao comprimento). */
  @IsArray() @ArrayMaxSize(2) @IsNumber({}, { each: true }) pitch!: number[];
}

export class PitchSizeDto {
  @IsNumber() @Min(20) @Max(130) length!: number;
  @IsNumber() @Min(15) @Max(90) width!: number;
}

/**
 * A calibração do campo — 4 a 6 pontos clicados pelo treinador num frame.
 *
 * A homografia `H` (imagem → campo, 3×3 por linhas) vem calculada pela consola
 * a partir dos pontos, e o servidor volta a verificá-la: quatro pontos e uma
 * matriz que não os reprojecta a menos de uns metros é um erro de clique, não
 * uma calibração.
 */
export class CalibrationDto {
  @ValidateNested() @Type(() => PitchSizeDto) pitch!: PitchSizeDto;
  /** O instante do vídeo em que os pontos foram clicados. */
  @IsInt() @Min(0) atMs!: number;
  /** `[largura, altura]` do vídeo em que se clicou. */
  @IsArray() @ArrayMaxSize(2) @IsInt({ each: true }) frame!: number[];
  @IsArray() @ArrayMaxSize(12) @ValidateNested({ each: true }) @Type(() => CalibrationPointDto)
  points!: CalibrationPointDto[];
  @IsArray() @ArrayMaxSize(9) @IsNumber({}, { each: true }) H!: number[];
}

/** O treinador diz qual é a cor do nosso equipamento neste jogo. */
export class ChooseKitDto {
  /** `#rrggbb` — a cor do grupo que ele clicou. */
  @IsString() @Matches(/^#[0-9a-fA-F]{6}$/) color!: string;
}

export class WorkerModelDto {
  @IsIn(["detection", "tracking", "reid", "ocr", "field", "ball", "quality"]) task!: string;
  @IsString() @Length(1, 120) name!: string;
  @IsString() @Length(1, 40) version!: string;
  @IsString() @Length(1, 60) license!: string;
  @IsOptional() @IsString() @Length(0, 300) source?: string;
  @IsOptional() @IsString() @Length(0, 1000) notes?: string;
}

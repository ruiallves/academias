import { ArrayMaxSize, IsArray, IsOptional, IsString, Length, MaxLength } from "class-validator";

export class PatrocinadorDaGestaoDto {
  @IsString() @Length(1, 120) nome!: string;
  /** O site do parceiro. Sem `https://` acrescenta-se; um endereço que não o seja fica vazio. */
  @IsOptional() @IsString() @MaxLength(500) url?: string;
  /** Um endereço do bucket do site deste clube (`POST /api/patrocinadores/logotipo`). Vazio = sem logótipo. */
  @IsOptional() @IsString() @MaxLength(500) logo?: string;
  /** A vantagem para os sócios. Vazio = só patrocinador. */
  @IsOptional() @IsString() @MaxLength(160) vantagem?: string;
}

export class OrdemDosPatrocinadoresDto {
  @IsArray() @ArrayMaxSize(500) @IsString({ each: true }) ids!: string[];
}

export class LogotipoDto {
  @IsString() @MaxLength(40) contentType!: string;
}

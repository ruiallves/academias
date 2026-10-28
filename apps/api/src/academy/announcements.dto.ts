import { Type } from "class-transformer";
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, Length, MaxLength, ValidateNested } from "class-validator";

/** Pedir para carregar um anexo: só o tipo, que decide a extensão da chave. */
export class AnnouncementUploadDto {
  @IsString()
  @MaxLength(120)
  contentType!: string;
}

/** Um anexo: a chave que o upload devolveu e o nome do ficheiro no computador de quem o carregou. */
export class AnnouncementFileDto {
  @IsString()
  @MaxLength(200)
  key!: string;

  @IsOptional()
  @IsString()
  @MaxLength(400)
  name?: string;
}

/**
 * O corpo de uma comunicação.
 *
 * `audience` é o **público**, não uma lista de equipas: é assim que a direção pensa
 * nisto — "isto é para os pais", "isto é para os treinadores", "isto é para todos".
 * O treinador só pode `guardians` (os pais das suas equipas), e é o serviço que o
 * garante — a forma valida-se aqui, a regra fica lá.
 */
export class CreateAnnouncementDto {
  @IsString()
  @Length(2, 120)
  title!: string;

  @IsString()
  @Length(1, 2000)
  body!: string;

  @IsIn(["all", "guardians", "athletes", "coaches", "members"])
  audience!: "all" | "guardians" | "coaches" | "members";

  /**
   * Os escalões, quando o aviso é para os pais.
   *
   * Ausente ou vazio é **todos** — os de quem envia: a academia inteira para a
   * direção, as equipas do treinador para o treinador. Preenchido, estreita a
   * um subconjunto: "isto é só para os pais do Sub-19".
   *
   * Só faz sentido com `audience: "guardians"`, e o serviço recusa-o nos outros
   * — um escalão não estreita um aviso à equipa técnica.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @IsString({ each: true })
  @Length(1, 40, { each: true })
  teamIds?: string[];

  /** Os anexos já carregados (PDF, fotografias, Word). O serviço confirma que chegaram. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => AnnouncementFileDto)
  files?: AnnouncementFileDto[];
}

/**
 * A edição de um aviso já publicado.
 *
 * Só o texto muda — **não o público**. Quem já recebeu, recebeu; mudar a audiência
 * de um aviso enviado significaria notificar uns e des-notificar outros, o que não
 * existe. Corrige-se a mensagem, não para quem foi.
 *
 * Os anexos mudam: `files` é a lista inteira (ausente = ficam como estavam).
 */
export class UpdateAnnouncementDto {
  @IsString()
  @Length(2, 120)
  title!: string;

  @IsString()
  @Length(1, 2000)
  body!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => AnnouncementFileDto)
  files?: AnnouncementFileDto[];
}

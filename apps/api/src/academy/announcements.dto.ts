import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, Length } from "class-validator";

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

  @IsIn(["all", "guardians", "coaches", "members"])
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
}

/**
 * A edição de um aviso já publicado.
 *
 * Só o texto muda — **não o público**. Quem já recebeu, recebeu; mudar a audiência
 * de um aviso enviado significaria notificar uns e des-notificar outros, o que não
 * existe. Corrige-se a mensagem, não para quem foi.
 */
export class UpdateAnnouncementDto {
  @IsString()
  @Length(2, 120)
  title!: string;

  @IsString()
  @Length(1, 2000)
  body!: string;
}

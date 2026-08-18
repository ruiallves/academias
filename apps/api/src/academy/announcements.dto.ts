import { IsIn, IsString, Length } from "class-validator";

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

  @IsIn(["all", "guardians", "coaches"])
  audience!: "all" | "guardians" | "coaches";
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

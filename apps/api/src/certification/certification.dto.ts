import { IsBoolean, IsInt, IsOptional, IsString, Length, Max, Min } from "class-validator";

/**
 * O perfil da candidatura. Vai sempre inteiro: são sete campos, e um corpo
 * parcial obrigava o serviço a adivinhar o que quer dizer um campo em falta.
 */
export class ProfileDto {
  @IsBoolean() hasSenior!: boolean;
  @IsBoolean() recruits!: boolean;
  @IsBoolean() hasDre!: boolean;
  @IsBoolean() nonNationals!: boolean;
  @IsBoolean() nationalLast5!: boolean;
  @IsBoolean() islands!: boolean;
  @IsBoolean() lowDensity!: boolean;
}

/**
 * A resposta a um requisito.
 *
 * `value` é `1` ou `0` nos requisitos de sim ou não, e o índice do patamar nos
 * requisitos por níveis (`-1` nenhum). O intervalo exacto depende do requisito
 * e é o serviço que o verifica contra o catálogo.
 */
export class AnswerDto {
  @IsInt() @Min(-1) @Max(12) value!: number;
  @IsOptional() @IsString() @Length(0, 1000) note?: string;
}

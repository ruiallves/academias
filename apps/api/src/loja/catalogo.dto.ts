import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsISO8601, IsNumber, IsOptional, IsString, Length, Max, MaxLength, Min } from "class-validator";

/** Uma categoria da loja. O endereço é opcional: sem ele, nasce do nome. */
export class CategoriaDto {
  @IsString() @Length(1, 40) nome!: string;
  @IsOptional() @IsString() @MaxLength(80) slug?: string;
  @IsOptional() @IsString() @MaxLength(500) descricao?: string;
  @IsOptional() @IsBoolean() visivel?: boolean;
}

/** A ordem das categorias: os ids, de cima para baixo. */
export class OrdemDto {
  @IsArray() @ArrayMaxSize(200) @IsString({ each: true }) ids!: string[];
}

/** Um código promocional, como a consola o escreve (euros e percentagens). */
export class CodigoDto {
  @IsString() @Length(3, 30) codigo!: string;
  @IsOptional() @IsString() @MaxLength(200) descricao?: string;
  @IsIn(["PERCENTAGEM", "FIXO"]) tipo!: "PERCENTAGEM" | "FIXO";
  /** PERCENTAGEM: 0 a 100. FIXO: euros. */
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(10_000) valor!: number;
  @IsOptional() @IsBoolean() envioGratis?: boolean;
  /** Euros. Nulo = sem mínimo. */
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100_000) minimo?: number | null;
  @IsOptional() @IsISO8601() inicio?: string | null;
  @IsOptional() @IsISO8601() fim?: string | null;
  @IsOptional() @IsInt() @Min(1) @Max(1_000_000) maxUsos?: number | null;
  @IsOptional() @IsBoolean() umaVezPorPessoa?: boolean;
  @IsOptional() @IsArray() @ArrayMaxSize(100) @IsString({ each: true }) categorias?: string[];
  @IsOptional() @IsBoolean() semPromocoes?: boolean;
  @IsOptional() @IsBoolean() ativo?: boolean;
}

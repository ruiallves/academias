import { IsBoolean, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, Length, Max, MaxLength, Min, IsArray } from "class-validator";
import { LAYOUTS } from "./site.tipos";

/**
 * O que a consola manda ao site. Os objetos em JSON (identidade, equipas,
 * recintos, tipos de bilhete) entram como objetos e são limpos no serviço
 * (`site.tipos.ts`): a forma deles é profunda demais para decoradores, e a
 * limpeza tem de acontecer de qualquer maneira também à leitura.
 */

export class AtualizarSiteDto {
  @IsOptional() @IsBoolean() publicado?: boolean;
  @IsOptional() @IsIn(LAYOUTS as unknown as string[]) layout?: string;
  @IsOptional() @IsObject() identidade?: Record<string, unknown>;
  @IsOptional() @IsObject() equipas?: Record<string, unknown>;
  @IsOptional() @IsArray() recintos?: unknown[];
}

export class NoticiaDto {
  @IsString() @Length(1, 200) titulo!: string;
  @IsOptional() @IsString() @MaxLength(600) resumo?: string;
  @IsOptional() @IsString() @MaxLength(20_000) corpo?: string;
  @IsOptional() @IsString() @MaxLength(40) categoria?: string;
  @IsOptional() @IsString() @MaxLength(500) imagem?: string;
  @IsOptional() @IsBoolean() destaque?: boolean;
  @IsOptional() @IsIn(["rascunho", "publicada"]) estado?: "rascunho" | "publicada";
}

export class ProdutoDto {
  @IsString() @Length(1, 120) nome!: string;
  @IsOptional() @IsString() @MaxLength(40) categoria?: string;
  /** Em euros. */
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(10_000) preco!: number;
  @IsOptional() @IsString() @MaxLength(500) imagem?: string;
  @IsOptional() @IsString() @MaxLength(2000) descricao?: string;
  @IsOptional() @IsString() @MaxLength(300) tamanhos?: string;
  @IsOptional() @IsBoolean() esgotado?: boolean;
  @IsOptional() @IsBoolean() visivel?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(10_000) ordem?: number;
}

export class PatrocinadorDto {
  @IsString() @Length(1, 120) nome!: string;
  @IsOptional() @IsString() @MaxLength(500) url?: string;
  @IsOptional() @IsString() @MaxLength(500) logo?: string;
  @IsOptional() @IsInt() @Min(0) @Max(10_000) ordem?: number;
}

export class BilheteiraDto {
  @IsBoolean() aberta!: boolean;
  @IsOptional() @IsString() @MaxLength(60) recintoId?: string | null;
  @IsOptional() @IsInt() @Min(1) @Max(200_000) lotacao?: number | null;
  @IsOptional() @IsString() @MaxLength(500) nota?: string;
  @IsArray() tipos!: unknown[];
}

/**
 * Sem SVG: o bucket é público, e um SVG aberto diretamente no browser corre o
 * que traz lá dentro. A consola converte as imagens para WebP antes de
 * carregar.
 */
export class ImagemDto {
  @IsIn(["image/png", "image/webp", "image/jpeg"])
  contentType!: "image/png" | "image/webp" | "image/jpeg";
}

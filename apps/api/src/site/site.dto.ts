import { IsBoolean, IsEmail, IsIn, IsInt, IsISO8601, IsNumber, IsObject, IsOptional, IsString, Length, Max, MaxLength, Min, IsArray } from "class-validator";
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
  /** A página de início: a ordem das secções e o banner. Ver `inicioValido`. */
  @IsOptional() @IsObject() inicio?: Record<string, unknown>;
}

/** O estado de uma mensagem do formulário de contactos. Só se mexe no que vier. */
export class MensagemDto {
  @IsOptional() @IsBoolean() lida?: boolean;
  @IsOptional() @IsBoolean() tratada?: boolean;
}

/**
 * Pôr um artigo do Inventário à venda no site, ou mudar-lhe o preço. Os
 * tamanhos e o esgotado não entram: saem do stock do artigo.
 */
export class ProdutoDoInventarioDto {
  /** Em euros. */
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(10_000) preco!: number;
  @IsOptional() @IsString() @MaxLength(40) categoria?: string;
  @IsOptional() @IsString() @MaxLength(2000) descricao?: string;
  @IsOptional() @IsBoolean() visivel?: boolean;
}

/**
 * Uma mensagem do formulário de contactos do site do clube. O resto do
 * crivo (ficha, repetições, tectos) está em `SitePublicoService.contacto`.
 */
export class ContactoDoSiteDto {
  @IsString() @Length(2, 120) nome!: string;
  @IsEmail() @Length(3, 254) email!: string;
  @IsOptional() @IsString() @MaxLength(40) telefone?: string;
  @IsString() @Length(2, 80) assunto!: string;
  @IsString() @Length(2, 4000) mensagem!: string;
  /** O campo-armadilha: ninguém o vê; um robô que preenche tudo preenche-o. */
  @IsOptional() @IsString() @MaxLength(200) notaExtra?: string;
  /** A ficha que o formulário pediu ao abrir. Ver `FichaDoSite`. */
  @IsOptional() @IsString() @MaxLength(200) ficha?: string;
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
  /** Os preços deste jogo. Vazio num jogo novo: copiam-se os preços por omissão do recinto. */
  @IsArray() tipos!: unknown[];
  /** Fases da venda (ISO). Nulo = desde que abre. */
  @IsOptional() @IsISO8601() sociosDesde?: string | null;
  @IsOptional() @IsISO8601() publicoDesde?: string | null;
  @IsOptional() @IsBoolean() soSocios?: boolean;
  /** Quando fecha. Nulo = à hora do jogo. */
  @IsOptional() @IsISO8601() fechaEm?: string | null;
}

/** Os preços por omissão da bilheteira: por recinto, os tipos (bancada × público ou categoria de sócio). */
export class PrecosBilheteiraDto {
  @IsObject() porRecinto!: Record<string, unknown[]>;
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

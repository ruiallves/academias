import { Type } from "class-transformer";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsEmail, IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, MaxLength, Min, ValidateNested } from "class-validator";

/**
 * O que chega à bilheteira de fora. A forma passa aqui; as regras (quem pode
 * comprar o quê, quantos, onde) estão em `regras.ts`.
 */

export class LinhaDto {
  @IsString() @Length(1, 60) typeId!: string;
  @IsInt() @Min(0) @Max(10) quantidade!: number;
}

/** Identificar um sócio no site: número e data de nascimento. */
export class IdentificarSocioDto {
  @IsInt() @Min(1) @Max(10_000_000) numero!: number;
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: "A data de nascimento é AAAA-MM-DD" }) nascimento!: string;
  /** Uma ficha por tentativa (`GET /bilhetes/ficha`), como na compra. */
  @IsOptional() @IsString() @MaxLength(200) ficha?: string;
}

/** Comprar no site. */
export class ReservarDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => LinhaDto) linhas!: LinhaDto[];
  @IsString() @Length(2, 120) nome!: string;
  @IsEmail() @Length(3, 254) email!: string;
  @IsOptional() @IsString() @MaxLength(30) telefone?: string;
  @IsIn(["MBWAY", "MULTIBANCO"]) metodo!: "MBWAY" | "MULTIBANCO";
  /** A credencial devolvida por `identificar`, para comprar ao preço de sócio. */
  @IsOptional() @IsString() @MaxLength(300) credencial?: string;
  /** O campo-armadilha. */
  @IsOptional() @IsString() @MaxLength(200) notaExtra?: string;
  /** A ficha que a página pediu ao abrir. Ver `FichaDoSite`. */
  @IsOptional() @IsString() @MaxLength(200) ficha?: string;
}

/** Comprar na app: o sócio vem da conta. */
export class ReservarNaAppDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => LinhaDto) linhas!: LinhaDto[];
  @IsIn(["MBWAY", "MULTIBANCO"]) metodo!: "MBWAY" | "MULTIBANCO";
  @IsOptional() @IsString() @MaxLength(30) telefone?: string;
}

export class AnularDto {
  @IsString() @Length(2, 300) motivo!: string;
}

export class ReembolsoDto {
  @IsOptional() @IsString() @MaxLength(300) nota?: string;
}

export class LugarAnualDto {
  @IsString() @Length(1, 40) memberId!: string;
  @IsString() @Length(1, 40) seasonId!: string;
  @IsString() @Length(1, 60) venueId!: string;
  @IsString() @Length(1, 60) bancadaId!: string;
  @IsOptional() @IsString() @MaxLength(40) seat?: string;
  @IsOptional() @IsString() @MaxLength(300) notes?: string;
}

/** Um acesso de segurança: uma porta do recinto, ou "todas". */
export class AcessoDaPortaDto {
  @IsString() @Length(1, 60) gateId!: string;
  @IsOptional() @IsString() @MaxLength(60) label?: string;
}

export class EntrarNaPortaDto {
  @IsString() @Length(20, 100) token!: string;
  @Matches(/^\d{6}$/, { message: "O PIN tem seis algarismos" }) pin!: string;
}

export class LerDto {
  @IsString() @Length(10, 300) sessao!: string;
  @IsString() @Length(1, 300) codigo!: string;
}

export class SessaoDto {
  @IsString() @Length(10, 300) sessao!: string;
}

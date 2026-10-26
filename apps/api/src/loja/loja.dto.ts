import { Type } from "class-transformer";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsEmail, IsIn, IsInt, IsObject, IsOptional, IsString, Length, Matches, Max, MaxLength, Min, ValidateNested } from "class-validator";

/**
 * O que chega à loja de fora. A forma passa aqui; as regras (o que há, por
 * quanto, como se entrega) estão em `regras.ts`.
 */

export class LinhaDoCarrinhoDto {
  @IsString() @Length(1, 60) productId!: string;
  @IsOptional() @IsString() @MaxLength(40) tamanho?: string;
  @IsInt() @Min(1) @Max(10) quantidade!: number;
}

/** Ver o carrinho contra o stock de agora, sem guardar nada. */
export class CarrinhoDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(12) @ValidateNested({ each: true }) @Type(() => LinhaDoCarrinhoDto) linhas!: LinhaDoCarrinhoDto[];
}

/** Encomendar no site. */
export class EncomendarDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(12) @ValidateNested({ each: true }) @Type(() => LinhaDoCarrinhoDto) linhas!: LinhaDoCarrinhoDto[];
  @IsString() @Length(2, 120) nome!: string;
  @IsEmail() @Length(3, 254) email!: string;
  @IsOptional() @IsString() @MaxLength(30) telefone?: string;
  /** O NIF para a fatura, se quem compra o quiser dar. Sem ele, a fatura sai como consumidor final. */
  @IsOptional() @IsString() @Matches(/^\d{9}$/, { message: "O NIF tem nove algarismos" }) nif?: string;
  @IsIn(["PICKUP", "SHIPPING"]) entrega!: "PICKUP" | "SHIPPING";
  /** A morada, só com `entrega: "SHIPPING"`. Ver `moradaValida`. */
  @IsOptional() @IsObject() morada?: Record<string, unknown>;
  /** O que quem compra quer dizer ao clube. */
  @IsOptional() @IsString() @MaxLength(500) nota?: string;
  @IsIn(["MBWAY", "MULTIBANCO"]) metodo!: "MBWAY" | "MULTIBANCO";
  /** O campo-armadilha. */
  @IsOptional() @IsString() @MaxLength(200) notaExtra?: string;
  /** A ficha que a página pediu ao abrir. Ver `FichaDoSite`. */
  @IsOptional() @IsString() @MaxLength(200) ficha?: string;
  /** O token do Cloudflare Turnstile. Ver `TurnstileService`. */
  @IsOptional() @IsString() @MaxLength(2048) turnstile?: string;
}

export class EnviadaDto {
  @IsOptional() @IsString() @MaxLength(80) rastreio?: string;
}

export class AnularEncomendaDto {
  @IsString() @Length(2, 300) motivo!: string;
}

export class ReembolsoEncomendaDto {
  @IsOptional() @IsString() @MaxLength(300) nota?: string;
}

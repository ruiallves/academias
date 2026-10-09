import { Body, Controller, Get, Param, Patch, Post, Query, Req } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from "class-validator";
import type { AuthedRequest } from "../auth/auth.guard";
import { InscricoesService } from "./inscricoes.service";

class ItemDto {
  @IsString() @MaxLength(40) athleteId!: string;
  @IsString() @MaxLength(40) sportId!: string;
  /** O tipo de boletim e a categoria, quando não são os propostos. Validados no serviço. */
  @IsOptional() @IsString() @MaxLength(30) kind?: string;
  @IsOptional() @IsString() @MaxLength(4) category?: string;
}

class GerarDto {
  @IsString() @MaxLength(40) seasonId!: string;

  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(400) @ValidateNested({ each: true }) @Type(() => ItemDto)
  items!: ItemDto[];

  /** Juntar cada folha aos documentos do atleta. */
  @IsOptional() @IsBoolean() attach?: boolean;
  /** `false` é só para ver: nada muda de estado. */
  @IsOptional() @IsBoolean() register?: boolean;
}

class AlvoDto {
  @IsString() @MaxLength(40) athleteId!: string;
  @IsString() @MaxLength(40) sportId!: string;
}

class EstadoDto {
  @IsString() @MaxLength(40) seasonId!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(400) @ValidateNested({ each: true }) @Type(() => AlvoDto)
  items!: AlvoDto[];
  /** `PENDING` retira a inscrição; os outros põem-na nesse passo. */
  @IsString() @MaxLength(20) status!: string;
  /** Ao validar uma inscrição, o n.º de licença que a federação deu. */
  @IsOptional() @IsString() @MaxLength(40) license?: string;
}

class UploadDto {
  @IsString() @MaxLength(120) contentType!: string;
}

class ConfirmarDto {
  @IsString() @MaxLength(200) key!: string;
  @IsOptional() @IsString() @MaxLength(400) name?: string;
}

/**
 * Inscrições na FPF (Modelo 2). Quem verifica permissões é o serviço.
 */
@Controller("api/inscricoes")
export class InscricoesController {
  constructor(private readonly inscricoes: InscricoesService) {}

  @Get()
  lista(@Req() req: AuthedRequest, @Query("seasonId") seasonId?: string) {
    return this.inscricoes.lista(req.ctx, seasonId || undefined);
  }

  /** Gerar é pesado (PDF de várias páginas): poucos por minuto chegam. */
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @Post("gerar")
  gerar(@Req() req: AuthedRequest, @Body() body: GerarDto) {
    return this.inscricoes.gerar(req.ctx, body);
  }

  @Patch("estado")
  mudarEstado(@Req() req: AuthedRequest, @Body() body: EstadoDto) {
    return this.inscricoes.mudarEstado(req.ctx, body);
  }

  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @Post(":id/assinada/upload")
  assinadaUploadUrl(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: UploadDto) {
    return this.inscricoes.assinadaUploadUrl(req.ctx, id, body.contentType);
  }

  @Post(":id/assinada")
  assinadaConfirmar(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: ConfirmarDto) {
    return this.inscricoes.assinadaConfirmar(req.ctx, id, body);
  }
}

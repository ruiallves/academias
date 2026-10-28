import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsOptional, IsString, MaxLength, ValidateNested } from "class-validator";
import { Type } from "class-transformer";
import type { Request } from "express";
import type { RequestContext } from "../common/permissions";
import { ConductService } from "./conduct.service";
import { DESCRICAO_MAX, MENSAGEM_MAX } from "./conduta";

type AuthedRequest = Request & { ctx: RequestContext };

/** Só a forma. O que é válido decide-se em `conduta.ts`. */
class CriarDenunciaDto {
  @IsString() @MaxLength(20) category!: string;
  @IsOptional() @IsBoolean() anonymous?: boolean;
  @IsOptional() @IsString() @MaxLength(40) athleteId?: string;
  @IsOptional() @IsString() @MaxLength(10) happenedOn?: string;
  @IsOptional() @IsString() @MaxLength(200) place?: string;
  @IsOptional() @IsString() @MaxLength(200) involved?: string;
  @IsString() @MaxLength(DESCRICAO_MAX) description!: string;
}

class MensagemDto {
  @IsString() @MaxLength(MENSAGEM_MAX) body!: string;
  /** Uma nota só para o clube. Ignorado quando vem da família. */
  @IsOptional() @IsBoolean() internal?: boolean;
}

class AtualizarDenunciaDto {
  @IsOptional() @IsIn(["NEW", "IN_REVIEW", "RESOLVED", "ARCHIVED"]) status?: string;
  @IsOptional() assigneeId?: string | null;
}

class FicheiroDto {
  @IsString() @MaxLength(200) key!: string;
  @IsOptional() @IsString() @MaxLength(200) name?: string;
}

class DocumentoDto {
  @IsOptional() @IsString() @MaxLength(120) title?: string;
  @IsOptional() @IsString() @MaxLength(400) description?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => FicheiroDto) files?: FicheiroDto[];
  @IsOptional() @IsArray() @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => FicheiroDto) addFiles?: FicheiroDto[];
}

class UploadDto {
  @IsString() @MaxLength(100) contentType!: string;
}

class RemoverFicheiroDto {
  @IsString() @MaxLength(200) key!: string;
}

/**
 * O canal de denúncia e os documentos de conduta. Quem pode o quê está em
 * `ConductService`; aqui só a forma.
 */
@Controller("api")
export class ConductController {
  constructor(private readonly conduct: ConductService) {}

  /* ---- A família ---------------------------------------------------------- */

  @Get("denuncias/opcoes")
  opcoes() {
    return this.conduct.opcoes();
  }

  /** Apertado: uma denúncia é um gesto raro, e dez por minuto já é um erro ou um abuso. */
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post("denuncias")
  criar(@Req() req: AuthedRequest, @Body() body: CriarDenunciaDto) {
    return this.conduct.criar(req.ctx, { ...body });
  }

  @Get("denuncias/minhas")
  minhas(@Req() req: AuthedRequest) {
    return this.conduct.minhas(req.ctx);
  }

  /* ---- O clube ------------------------------------------------------------ */

  @Get("denuncias")
  listar(@Req() req: AuthedRequest, @Query("estado") estado?: string) {
    return this.conduct.listar(req.ctx, estado);
  }

  @Get("denuncias/resumo")
  resumo(@Req() req: AuthedRequest) {
    return this.conduct.resumo(req.ctx);
  }

  @Get("denuncias/responsaveis")
  responsaveis(@Req() req: AuthedRequest) {
    return this.conduct.responsaveis(req.ctx);
  }

  /* ---- Os dois lados ------------------------------------------------------ */

  @Get("denuncias/:id")
  ver(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.conduct.ver(req.ctx, id);
  }

  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @Post("denuncias/:id/mensagens")
  escrever(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: MensagemDto) {
    return this.conduct.escrever(req.ctx, id, body);
  }

  @Patch("denuncias/:id")
  atualizar(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: AtualizarDenunciaDto) {
    return this.conduct.atualizar(req.ctx, id, body);
  }

  /* ---- Os documentos de conduta ------------------------------------------- */

  @Get("conduta/documentos")
  documentos(@Req() req: AuthedRequest) {
    return this.conduct.documentos(req.ctx);
  }

  @Post("conduta/documentos/upload")
  documentoUploadUrl(@Req() req: AuthedRequest, @Body() body: UploadDto) {
    return this.conduct.documentoUploadUrl(req.ctx, body.contentType);
  }

  @Post("conduta/documentos")
  documentoCriar(@Req() req: AuthedRequest, @Body() body: DocumentoDto) {
    return this.conduct.documentoCriar(req.ctx, body);
  }

  @Patch("conduta/documentos/:id")
  documentoAtualizar(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: DocumentoDto) {
    return this.conduct.documentoAtualizar(req.ctx, id, body);
  }

  @Post("conduta/documentos/:id/remover-ficheiro")
  documentoRemoverFicheiro(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: RemoverFicheiroDto) {
    return this.conduct.documentoRemoverFicheiro(req.ctx, id, body.key);
  }

  @Delete("conduta/documentos/:id")
  documentoApagar(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.conduct.documentoApagar(req.ctx, id);
  }

  /** A app avisa que a pessoa abriu um ficheiro do documento. */
  @Post("conduta/documentos/:id/aberto")
  documentoAberto(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.conduct.documentoAberto(req.ctx, id);
  }

  /** Quem abriu o documento: pais e atletas, com os escalões, para as Definições. */
  @Get("conduta/documentos/:id/leituras")
  documentoLeituras(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.conduct.documentoLeituras(req.ctx, id);
  }
}

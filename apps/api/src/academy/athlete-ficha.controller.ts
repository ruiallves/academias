import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Req } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { Type } from "class-transformer";
import { ArrayMaxSize, IsArray, IsOptional, IsString, MaxLength, ValidateNested } from "class-validator";
import type { Request } from "express";
import type { RequestContext } from "../common/permissions";
import { AthleteFichaService } from "./athlete-ficha.service";

type AuthedRequest = Request & { ctx: RequestContext };

/** Texto livre, aparado e validado em `ficha-do-atleta.ts`. Aqui só a forma. */
class MedicalInfoDto {
  @IsOptional() @IsString() @MaxLength(8) bloodType?: string | null;
  @IsOptional() @IsString() @MaxLength(4000) allergies?: string | null;
  @IsOptional() @IsString() @MaxLength(4000) medication?: string | null;
  @IsOptional() @IsString() @MaxLength(4000) notes?: string | null;
}

class DocumentUploadDto {
  @IsString() @MaxLength(120) contentType!: string;
}

class DocumentFileDto {
  @IsString() @MaxLength(200) key!: string;
  @IsOptional() @IsString() @MaxLength(400) name?: string;
}

class DocumentCreateDto {
  @IsString() @MaxLength(200) name!: string;

  @IsArray() @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => DocumentFileDto)
  files!: DocumentFileDto[];
}

class DocumentUpdateDto {
  @IsOptional() @IsString() @MaxLength(200) name?: string;

  @IsOptional() @IsArray() @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => DocumentFileDto)
  addFiles?: DocumentFileDto[];
}

class DocumentKeyDto {
  @IsString() @MaxLength(200) key!: string;
}

/**
 * A informação médica e os documentos de um atleta — a ficha, na consola.
 *
 * As regras de quem vê e de quem escreve estão todas no serviço. Aqui não há
 * decisão nenhuma: só a forma do pedido.
 */
@Controller("api")
export class AthleteFichaController {
  constructor(private readonly ficha: AthleteFichaService) {}

  @Get("athletes/:id/info-medica")
  medicalGet(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.ficha.medicalGet(req.ctx, id);
  }

  @Put("athletes/:id/info-medica")
  medicalSet(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: MedicalInfoDto) {
    return this.ficha.medicalSet(req.ctx, id, { ...body });
  }

  @Get("athletes/:id/documentos")
  documentsList(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.ficha.documentsList(req.ctx, id);
  }

  /* O caminho de três passos das fotografias: autorizar, carregar, confirmar. */
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @Post("athletes/:id/documentos/upload")
  documentUploadUrl(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: DocumentUploadDto) {
    return this.ficha.documentUploadUrl(req.ctx, id, body.contentType);
  }

  @Post("athletes/:id/documentos")
  documentCreate(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: DocumentCreateDto) {
    return this.ficha.documentCreate(req.ctx, id, body);
  }

  @Patch("documentos-de-atleta/:id")
  documentUpdate(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: DocumentUpdateDto) {
    return this.ficha.documentUpdate(req.ctx, id, body);
  }

  @Post("documentos-de-atleta/:id/remover-ficheiro")
  documentRemoveFile(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: DocumentKeyDto) {
    return this.ficha.documentRemoveFile(req.ctx, id, body.key);
  }

  @Delete("documentos-de-atleta/:id")
  documentRemove(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.ficha.documentRemove(req.ctx, id);
  }
}

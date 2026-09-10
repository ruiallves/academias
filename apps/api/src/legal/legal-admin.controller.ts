import { Body, Controller, Delete, Get, Ip, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { IsArray, IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from "class-validator";
import { Type } from "class-transformer";
import type { LegalAcceptanceKind, LegalAudience, LegalDocumentType, LegalScope } from "@prisma/client";
import { Public } from "../auth/auth.guard";
import { PlatformGuard, PlatformRoles, type PlatformRequest } from "../platform/platform.guard";
import { LegalAdminService } from "./legal-admin.service";
import { LEGAL_AUDIENCES, LEGAL_TYPE_LIST } from "./legal.catalog";

class CreateDocumentDto {
  @IsIn(LEGAL_TYPE_LIST)
  type!: LegalDocumentType;

  @IsString() @Length(1, 12)
  version!: string;

  @IsString() @Length(1, 160)
  title!: string;

  @IsOptional() @IsString() @Length(0, 400)
  summary?: string | null;

  @IsString()
  content!: string;

  @IsOptional() @IsIn(["CLUB", "USER"])
  scope?: LegalScope;

  @IsOptional() @IsArray() @IsIn(LEGAL_AUDIENCES, { each: true })
  audiences?: LegalAudience[];

  @IsOptional() @IsIn(["ACCEPT", "ACKNOWLEDGE", "NONE"])
  acceptanceKind?: LegalAcceptanceKind;

  @IsOptional() @IsString()
  effectiveAt?: string | null;

  @IsOptional() @IsString() @Length(0, 600)
  changeNote?: string | null;
}

class UpdateDocumentDto {
  @IsOptional() @IsString() @Length(1, 12)
  version?: string;

  @IsOptional() @IsString() @Length(1, 160)
  title?: string;

  @IsOptional() @IsString() @Length(0, 400)
  summary?: string | null;

  @IsOptional() @IsString()
  content?: string;

  @IsOptional() @IsIn(["CLUB", "USER"])
  scope?: LegalScope;

  @IsOptional() @IsArray() @IsIn(LEGAL_AUDIENCES, { each: true })
  audiences?: LegalAudience[];

  @IsOptional() @IsIn(["ACCEPT", "ACKNOWLEDGE", "NONE"])
  acceptanceKind?: LegalAcceptanceKind;

  @IsOptional() @IsString()
  effectiveAt?: string | null;

  @IsOptional() @IsString() @Length(0, 600)
  changeNote?: string | null;
}

class PublishDto {
  @IsOptional() @IsString()
  effectiveAt?: string | null;
}

class AcceptancesQuery {
  @IsOptional() @IsString()
  academyId?: string;

  @IsOptional() @IsString()
  type?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500)
  limit?: number;
}

/**
 * A gestão dos documentos legais — só a plataforma.
 *
 * `@Public()` desliga o guard das academias; o `PlatformGuard` toma o lugar, como
 * no resto de `api/platform`. Ler é de qualquer administrador; criar e editar é
 * de `OWNER` e `ADMIN`; **publicar e retirar é só de `OWNER`** — é o gesto que
 * põe um contrato novo à frente de todos os clubes.
 */
@Public()
@UseGuards(PlatformGuard)
@Controller("api/platform/legal")
export class LegalAdminController {
  constructor(private readonly admin: LegalAdminService) {}

  @Get("documents")
  overview() {
    return this.admin.overview();
  }

  @Get("stats")
  stats() {
    return this.admin.stats();
  }

  @Get("acceptances")
  acceptances(@Query() q: AcceptancesQuery) {
    return this.admin.acceptances(q);
  }

  @Get("documents/:id")
  get(@Param("id") id: string) {
    return this.admin.get(id);
  }

  @PlatformRoles("OWNER", "ADMIN")
  @Post("documents")
  create(@Req() req: PlatformRequest, @Ip() ip: string, @Body() body: CreateDocumentDto) {
    return this.admin.create(req.admin, body, ip);
  }

  @PlatformRoles("OWNER", "ADMIN")
  @Patch("documents/:id")
  update(@Req() req: PlatformRequest, @Ip() ip: string, @Param("id") id: string, @Body() body: UpdateDocumentDto) {
    return this.admin.update(req.admin, id, body, ip);
  }

  @PlatformRoles("OWNER")
  @Post("documents/:id/publish")
  publish(@Req() req: PlatformRequest, @Ip() ip: string, @Param("id") id: string, @Body() body: PublishDto) {
    return this.admin.publish(req.admin, id, body.effectiveAt, ip);
  }

  @PlatformRoles("OWNER")
  @Post("documents/:id/retire")
  retire(@Req() req: PlatformRequest, @Ip() ip: string, @Param("id") id: string) {
    return this.admin.retire(req.admin, id, ip);
  }

  @PlatformRoles("OWNER", "ADMIN")
  @Delete("documents/:id")
  remove(@Req() req: PlatformRequest, @Ip() ip: string, @Param("id") id: string) {
    return this.admin.remove(req.admin, id, ip);
  }
}

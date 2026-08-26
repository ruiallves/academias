import { Body, Controller, Delete, Get, Param, Patch, Post, Req } from "@nestjs/common";
import { IsBoolean, IsInt, IsOptional, IsString, Length, Max, Min } from "class-validator";
import type { AuthedRequest } from "../auth/auth.guard";
import { CatalogsService } from "./catalogs.service";

class CreateCatalogItemDto {
  @IsString() @Length(1, 40) kind!: string;
  @IsString() @Length(1, 80) label!: string;
  @IsOptional() @IsString() @Length(0, 160) note?: string;
  /** Nulo ou ausente é "todos os desportos" — ver o serviço. */
  @IsOptional() @IsString() @Length(1, 40) sportId?: string;
}

class UpdateCatalogItemDto {
  @IsOptional() @IsString() @Length(1, 80) label?: string;
  @IsOptional() @IsString() @Length(0, 160) note?: string;
  @IsOptional() @IsInt() @Min(0) @Max(9999) order?: number;
  @IsOptional() @IsBoolean() archived?: boolean;
}

/**
 * Os catálogos.
 *
 * Ler exige `academy:read` — um treinador precisa da lista de locais para marcar
 * um treino. Escrever exige `settings:write`, porque muda os menus de toda a
 * academia. As duas verificações estão no serviço.
 */
@Controller("api/catalogs")
export class CatalogsController {
  constructor(private readonly catalogs: CatalogsService) {}

  @Get()
  list(@Req() req: AuthedRequest) {
    return this.catalogs.list(req.ctx);
  }

  @Post()
  create(@Req() req: AuthedRequest, @Body() dto: CreateCatalogItemDto) {
    return this.catalogs.create(req.ctx, dto.kind, dto.label, dto.note, dto.sportId ?? null);
  }

  @Patch(":id")
  update(@Req() req: AuthedRequest, @Param("id") id: string, @Body() dto: UpdateCatalogItemDto) {
    if (dto.archived !== undefined) return this.catalogs.setArchived(req.ctx, id, dto.archived);
    return this.catalogs.update(req.ctx, id, dto);
  }

  /** Arquiva. Nunca apaga — ver o serviço. */
  @Delete(":id")
  archive(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.catalogs.setArchived(req.ctx, id, true);
  }
}

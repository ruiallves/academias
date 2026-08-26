import { Body, Controller, Delete, Get, Param, Patch, Post, Req } from "@nestjs/common";
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsOptional, IsString, MaxLength, MinLength } from "class-validator";
import type { Role } from "@prisma/client";
import type { AuthedRequest } from "../auth/auth.guard";
import { DepartmentsService } from "./departments.service";

/** Os âmbitos que um departamento pode ter. Espelha `SCOPES` no serviço. */
const SCOPES = ["DIRECTOR", "COORDINATOR", "COACH", "MEDICAL", "SCOUT", "STAFF"] as const;

/**
 * DTOs, e não `any`.
 *
 * VULN-005 foi exactamente isto: bodies sem DTO deixam a `ValidationPipe` sem nada
 * para filtrar, e um campo a mais no JSON chega ao Prisma. Num endpoint que
 * escreve permissões, um `isSystem: true` clandestino valia uma academia inteira.
 */
class CreateDepartmentDto {
  @IsString() @MinLength(2) @MaxLength(60) name!: string;
  @IsOptional() @IsString() @MaxLength(240) description?: string;
  @IsIn(SCOPES as unknown as string[]) baseRole!: Role;
  @IsArray() @ArrayMaxSize(60) @IsString({ each: true }) permissions!: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(40) @IsString({ each: true }) navKeys?: string[];
}

class UpdateDepartmentDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(60) name?: string;
  @IsOptional() @IsString() @MaxLength(240) description?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(60) @IsString({ each: true }) permissions?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(40) @IsString({ each: true }) navKeys?: string[];

  /**
   * Levar as permissões novas aos cargos que herdaram deste departamento.
   *
   * Opcional e por omissão falso: ver a nota sobre efeitos à distância em
   * `DepartmentsService`.
   */
  @IsOptional() @IsBoolean() applyToRoles?: boolean;
}

/**
 * Controlador fino: nenhuma decisão de permissão acontece aqui.
 *
 * É a regra da casa e é mais do que estilo — um controlador que decide permissões
 * é um controlador que as decide **só naquela rota**, e a rota seguinte esquece-se.
 * Tudo o que decide está em `DepartmentsService`.
 */
@Controller("api/departments")
export class DepartmentsController {
  constructor(private readonly departments: DepartmentsService) {}

  @Get()
  list(@Req() req: AuthedRequest) {
    return this.departments.list(req.ctx);
  }

  @Post()
  create(@Req() req: AuthedRequest, @Body() dto: CreateDepartmentDto) {
    return this.departments.create(req.ctx, dto);
  }

  @Patch(":id")
  update(@Req() req: AuthedRequest, @Param("id") id: string, @Body() dto: UpdateDepartmentDto) {
    return this.departments.update(req.ctx, id, dto);
  }

  @Delete(":id")
  remove(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.departments.remove(req.ctx, id);
  }
}

import { Body, Controller, Delete, Get, Param, Patch, Post, Req } from "@nestjs/common";
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, MaxLength, MinLength } from "class-validator";
import type { Role } from "@prisma/client";
import type { AuthedRequest } from "../auth/auth.guard";
import { RolesService } from "./roles.service";

const BASE_ROLES = ["OWNER", "DIRECTOR", "COORDINATOR", "COACH", "STAFF", "MEDICAL", "SCOUT"] as const;

/**
 * DTOs, e não `any`.
 *
 * VULN-005 foi exactamente isto: bodies sem DTO deixam a `ValidationPipe` sem nada
 * para filtrar, e um campo a mais no JSON chega ao Prisma. Num endpoint que
 * escreve permissões, um `isSystem: true` clandestino valia uma academia inteira.
 */
class CreateRoleDto {
  @IsString() @MinLength(2) @MaxLength(60) name!: string;
  @IsOptional() @IsString() @MaxLength(240) description?: string;

  /**
   * O departamento de onde o cargo herda âmbito e permissões.
   *
   * É o caminho normal. `baseRole` só é preciso num cargo sem departamento — ver
   * a nota em `RolesService.create` sobre porque é que a pergunta do "âmbito"
   * saiu deste ecrã.
   */
  @IsOptional() @IsString() departmentId?: string | null;
  @IsOptional() @IsIn(BASE_ROLES as unknown as string[]) baseRole?: Role;

  @IsArray() @ArrayMaxSize(60) @IsString({ each: true }) permissions!: string[];
}

class UpdateRoleDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(60) name?: string;
  @IsOptional() @IsString() @MaxLength(240) description?: string;
  @IsOptional() @IsString() departmentId?: string | null;
  @IsOptional() @IsArray() @ArrayMaxSize(60) @IsString({ each: true }) permissions?: string[];
}

class SetNavDto {
  @IsArray() @ArrayMaxSize(40) @IsString({ each: true }) navKeys!: string[];
}

class AssignRoleDto {
  /** `null` devolve a pessoa aos valores por omissão do papel-base. */
  @IsOptional() @IsString() roleId?: string | null;

  /**
   * Os cargos secundários. **Ausente não mexe** neles; lista vazia limpa-os.
   *
   * A diferença importa: quem só troca o cargo principal não tem de reenviar os
   * secundários para não os perder, e quem os quer tirar tem forma de o dizer.
   */
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) extraRoleIds?: string[];
}

/**
 * Controlador fino: nenhuma decisão de permissão acontece aqui.
 *
 * É a regra da casa e é mais do que estilo — um controlador que decide permissões
 * é um controlador que as decide **só naquela rota**, e a rota seguinte esquece-se.
 * Tudo o que decide está em `RolesService`.
 */
@Controller("api/roles")
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get()
  list(@Req() req: AuthedRequest) {
    return this.roles.list(req.ctx);
  }

  @Post()
  create(@Req() req: AuthedRequest, @Body() dto: CreateRoleDto) {
    return this.roles.create(req.ctx, dto);
  }

  @Patch(":id")
  update(@Req() req: AuthedRequest, @Param("id") id: string, @Body() dto: UpdateRoleDto) {
    return this.roles.update(req.ctx, id, dto);
  }

  @Patch(":id/nav")
  setNav(@Req() req: AuthedRequest, @Param("id") id: string, @Body() dto: SetNavDto) {
    return this.roles.setNav(req.ctx, id, dto.navKeys);
  }

  @Delete(":id")
  archive(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.roles.archive(req.ctx, id);
  }

  /**
   * Atribuir um papel a uma pessoa.
   *
   * Vive aqui e não em `/api/staff/:id` porque é uma decisão de acesso, não de
   * ficha — a mesma razão de `access:write` existir à parte de `staff:write`.
   */
  @Patch("assign/:membershipId")
  assign(@Req() req: AuthedRequest, @Param("membershipId") membershipId: string, @Body() dto: AssignRoleDto) {
    return this.roles.assign(req.ctx, membershipId, dto.roleId ?? null, dto.extraRoleIds);
  }
}

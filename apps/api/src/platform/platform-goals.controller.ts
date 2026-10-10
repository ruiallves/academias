import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from "@nestjs/common";
import { IsBoolean, IsISO8601, IsNumber, IsOptional, IsString, Length, ValidateIf } from "class-validator";
import { Public } from "../auth/auth.guard";
import { PlatformGuard, PlatformRoles, type PlatformRequest } from "./platform.guard";
import { PlatformGoalsService } from "./platform-goals.service";
import { PlatformService } from "./platform.service";

class GoalDto {
  @IsOptional() @IsString() @Length(1, 160) title?: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @Length(0, 600) description?: string | null;
  @IsOptional() @IsString() @Length(1, 40) area?: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @Length(0, 40) metric?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsNumber() target?: number | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsNumber() current?: number | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsISO8601() deadline?: string | null;
  @IsOptional() @IsBoolean() done?: boolean;
}

/**
 * Os objetivos da plataforma. Ler é para toda a equipa; mexer é de quem decide
 * o negócio (`OWNER`, `ADMIN`). Ver `PlatformGoalsService`.
 */
@Public()
@UseGuards(PlatformGuard)
@Controller("api/platform/objetivos")
export class PlatformGoalsController {
  constructor(
    private readonly goals: PlatformGoalsService,
    private readonly platform: PlatformService,
  ) {}

  @Get()
  list() {
    return this.goals.list();
  }

  @Post()
  @PlatformRoles("OWNER", "ADMIN")
  async create(@Req() req: PlatformRequest, @Body() dto: GoalDto) {
    const r = await this.goals.create(dto);
    await this.platform.audit(req.admin, "goal.create", "goal", r.id, { title: dto.title });
    return r;
  }

  @Patch(":id")
  @PlatformRoles("OWNER", "ADMIN")
  async update(@Req() req: PlatformRequest, @Param("id") id: string, @Body() dto: GoalDto) {
    const r = await this.goals.update(id, dto);
    await this.platform.audit(req.admin, "goal.update", "goal", id, { ...dto });
    return r;
  }

  @Delete(":id")
  @PlatformRoles("OWNER", "ADMIN")
  async archive(@Req() req: PlatformRequest, @Param("id") id: string) {
    const r = await this.goals.archive(id);
    await this.platform.audit(req.admin, "goal.archive", "goal", id);
    return r;
  }
}

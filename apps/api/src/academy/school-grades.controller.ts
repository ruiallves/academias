import { Body, Controller, Delete, Get, Param, Post, Req } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { IsInt, IsString, Max, MaxLength, Min } from "class-validator";
import type { Request } from "express";
import type { RequestContext } from "../common/permissions";
import { SchoolGradesService } from "./school-grades.service";

type AuthedRequest = Request & { ctx: RequestContext };

/** Só a forma. O que é válido decide-se em `notas-escolares.ts`. */
class SchoolGradeDto {
  @IsString() @MaxLength(7) schoolYear!: string;
  @IsString() @MaxLength(2) period!: string;
  @IsString() @MaxLength(120) subject!: string;
  @IsInt() @Min(0) @Max(20) grade!: number;
  @IsInt() @Min(5) @Max(20) scale!: number;
}

/**
 * As notas da escola: a família submete na app, o clube lê na ficha.
 * Quem pode o quê está em `SchoolGradesService`.
 */
@Controller("api")
export class SchoolGradesController {
  constructor(private readonly grades: SchoolGradesService) {}

  @Get("athletes/:id/notas-escolares")
  list(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.grades.list(req.ctx, id);
  }

  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @Post("athletes/:id/notas-escolares")
  save(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: SchoolGradeDto) {
    return this.grades.save(req.ctx, id, { ...body });
  }

  @Delete("notas-escolares/:id")
  remove(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.grades.remove(req.ctx, id);
  }
}

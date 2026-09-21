import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req } from "@nestjs/common";
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, Length, Matches } from "class-validator";
import type { AuthedRequest } from "../auth/auth.guard";
import { CyclesService } from "./cycles.service";

const DIA = /^\d{4}-\d{2}-\d{2}$/;

/** A edição: tudo opcional, e `null` apaga o campo. */
class CyclePatchDto {
  @IsOptional() @Matches(DIA) startsOn?: string;
  @IsOptional() @Matches(DIA) endsOn?: string;
  @IsOptional() @IsString() @Length(0, 60) name?: string | null;
  @IsOptional() @IsString() @Length(0, 40) phase?: string | null;
  @IsOptional() @IsArray() @ArrayMaxSize(8) @IsString({ each: true }) focus?: string[];
  @IsOptional() @IsString() @Length(0, 300) objective?: string | null;
  @IsOptional() @IsString() @Length(0, 2000) notes?: string | null;
  @IsOptional() @IsString() @Length(0, 7) color?: string | null;
}

class CycleDto extends CyclePatchDto {
  @IsString() @Length(1, 40) teamId!: string;
  @IsIn(["MESO", "MICRO"]) level!: "MESO" | "MICRO";
  @Matches(DIA) declare startsOn: string;
  @Matches(DIA) declare endsOn: string;
}

class GenerateDto {
  @IsString() @Length(1, 40) teamId!: string;
  @Matches(DIA) from!: string;
  @Matches(DIA) to!: string;
}

/**
 * A periodização de cada equipa. Controlador fino: o âmbito e as regras de
 * datas vivem no serviço. Ver `CyclesService`.
 */
@Controller("api/training/cycles")
export class CyclesController {
  constructor(private readonly cycles: CyclesService) {}

  @Get()
  list(@Req() req: AuthedRequest, @Query("teamId") teamId?: string, @Query("from") from?: string, @Query("to") to?: string) {
    return this.cycles.list(req.ctx, { teamId, from, to });
  }

  @Post()
  create(@Req() req: AuthedRequest, @Body() dto: CycleDto) {
    return this.cycles.create(req.ctx, dto);
  }

  /** As semanas (microciclos) de um intervalo, num gesto, só onde ainda não há. */
  @Post("gerar")
  generate(@Req() req: AuthedRequest, @Body() dto: GenerateDto) {
    return this.cycles.generate(req.ctx, dto);
  }

  @Put(":id")
  update(@Req() req: AuthedRequest, @Param("id") id: string, @Body() dto: CyclePatchDto) {
    return this.cycles.update(req.ctx, id, dto);
  }

  @Delete(":id")
  remove(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.cycles.remove(req.ctx, id);
  }
}

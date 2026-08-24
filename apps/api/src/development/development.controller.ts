import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from "@nestjs/common";
import { ArrayMaxSize, IsArray, IsIn, IsObject, IsOptional, IsString, Length } from "class-validator";
import type { AuthedRequest } from "../auth/auth.guard";
import { EvaluationsService } from "./evaluations.service";
import { ReportsService } from "./reports.service";

/* -------------------------------------------------------------------------- */
/* Corpos                                                                      */
/* -------------------------------------------------------------------------- */

class SaveEvaluationDto {
  @IsString() @Length(1, 40)
  athleteId!: string;

  /** "2026/27 · 1.º período". Texto e não um enum: a academia é que divide o ano. */
  @IsString() @Length(3, 60)
  period!: string;

  /**
   * `{ "Técnica": 4 }`.
   *
   * Validado só como objecto aqui; **as chaves e a escala são verificadas no
   * serviço**, contra `Sport.skills` da modalidade do atleta. É o único sítio que
   * sabe qual é a modalidade, e por isso é o único que pode dizer que "Táctica" não
   * existe na natação.
   */
  @IsObject()
  scores!: Record<string, number>;

  @IsOptional() @IsString() @Length(0, 2000)
  note?: string;

  @IsOptional() @IsString() @Length(0, 1000)
  strengths?: string;

  @IsOptional() @IsString() @Length(0, 1000)
  focus?: string;
}

class PublishDto {
  /** Até 200 de uma vez — mais do que qualquer plantel, menos do que um ataque. */
  @IsArray() @ArrayMaxSize(200)
  @IsString({ each: true })
  ids!: string[];
}

class ReportDto {
  @IsString() @Length(1, 40)
  athleteId!: string;

  @IsString() @Length(3, 160)
  title!: string;

  @IsOptional() @IsString() @Length(0, 60)
  period?: string;

  @IsString() @Length(10, 20000)
  body!: string;

  @IsOptional() @IsIn(["INTERNAL", "FAMILY"])
  visibility?: "INTERNAL" | "FAMILY";
}

class ReportPatchDto {
  @IsOptional() @IsString() @Length(3, 160)
  title?: string;

  @IsOptional() @IsString() @Length(0, 60)
  period?: string;

  @IsOptional() @IsString() @Length(10, 20000)
  body?: string;

  @IsOptional() @IsIn(["INTERNAL", "FAMILY"])
  visibility?: "INTERNAL" | "FAMILY";
}

/* -------------------------------------------------------------------------- */

/**
 * Avaliações e relatórios.
 *
 * ## Um controlador para os dois lados
 *
 * As mesmas rotas servem o treinador e a família. Não há `/api/family/evaluations`
 * a duplicar o que já existe — e isso é deliberado: duas superfícies para o mesmo
 * dado são dois sítios onde o filtro pode divergir, e o dia em que divergirem é o
 * dia em que um rascunho aparece no telemóvel de um pai.
 *
 * O que muda entre os dois é decidido no serviço, a partir do papel: a família vê
 * apenas o **publicado**, e nos relatórios apenas o que é **de família**.
 *
 * Controlador fino, como o resto: quem pode o quê decide-se com `can()` lá dentro.
 */
@Controller("api")
export class DevelopmentController {
  constructor(
    private readonly evaluations: EvaluationsService,
    private readonly reports: ReportsService,
  ) {}

  /* ---- Avaliações -------------------------------------------------------- */

  @Get("evaluations")
  listEvaluations(@Req() req: AuthedRequest, @Query("period") period?: string) {
    return this.evaluations.list(req.ctx, period?.trim() || undefined);
  }

  /** Gravar. É um `upsert` por (atleta, período) — ver o serviço. */
  @Post("evaluations")
  saveEvaluation(@Req() req: AuthedRequest, @Body() body: SaveEvaluationDto) {
    return this.evaluations.save(req.ctx, body);
  }

  /** Entregar às famílias. Aceita várias porque é assim que o trabalho acontece. */
  @Post("evaluations/publish")
  publishEvaluations(@Req() req: AuthedRequest, @Body() body: PublishDto) {
    return this.evaluations.publish(req.ctx, body.ids);
  }

  @Delete("evaluations/:id")
  removeEvaluation(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.evaluations.remove(req.ctx, id);
  }

  /* ---- Relatórios -------------------------------------------------------- */

  @Get("reports")
  listReports(@Req() req: AuthedRequest, @Query("athleteId") athleteId?: string) {
    return this.reports.list(req.ctx, athleteId?.trim() || undefined);
  }

  @Post("reports")
  createReport(@Req() req: AuthedRequest, @Body() body: ReportDto) {
    return this.reports.create(req.ctx, body);
  }

  @Patch("reports/:id")
  updateReport(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: ReportPatchDto) {
    return this.reports.update(req.ctx, id, body);
  }

  /** Publicar — congela os números e, se for de família, avisa os pais. */
  @Post("reports/:id/publish")
  publishReport(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.reports.publish(req.ctx, id);
  }

  @Delete("reports/:id")
  removeReport(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.reports.remove(req.ctx, id);
  }
}

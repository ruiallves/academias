import { Body, Controller, Delete, Param, Patch, Post, Req } from "@nestjs/common";
import { IsBoolean, IsIn, IsISO8601, IsOptional, IsString, Length, ValidateNested } from "class-validator";
import { Type } from "class-transformer";
import { RepeatDto } from "./events.dto";
import type { AuthedRequest } from "../auth/auth.guard";
import { ClinicalService } from "./clinical.service";

const KINDS = ["INJURY", "EXAM", "PHYSIO", "NUTRITION", "PSYCHOLOGY", "NOTE", "CONSULTATION"];
const STATUS = ["DONE", "SCHEDULED", "CANCELLED"];
const IMPACTS = ["NONE", "LIMITED", "OUT"];

class ClinicalDto {
  @IsOptional() @IsIn(KINDS) kind?: string;
  @IsOptional() @IsIn(STATUS) status?: string;
  @IsOptional() @IsIn(IMPACTS) impact?: string;

  @IsOptional() @IsISO8601() date?: string;
  @IsOptional() @IsISO8601() expectedReturn?: string;
  /** Só em exames: até quando fica válido. Escreve `Athlete.medicalValidUntil`. */
  @IsOptional() @IsISO8601() validUntil?: string;

  /** `14:30`. Só em agendamentos. */
  @IsOptional() @IsString() @Length(0, 5) time?: string;
  @IsOptional() @IsString() @Length(0, 120) location?: string;
  @IsOptional() @IsString() @Length(0, 160) title?: string;
  @IsOptional() @IsString() @Length(0, 4000) detail?: string;

  /** O tipo de consulta do clube. Decide o `kind`. */
  @IsOptional() @IsString() @Length(1, 40) typeId?: string;
  /** As notas de quem deu a consulta. Não saem para a família. */
  @IsOptional() @IsString() @Length(0, 8000) notes?: string;
  /** Pedir à família (ou ao atleta) que confirme, como numa convocatória. */
  @IsOptional() @IsBoolean() confirmationRequired?: boolean;
  @IsOptional() @IsIn(["GUARDIAN", "ATHLETE"]) respondBy?: string;

  /** Só em agendamentos: a mesma consulta repetida até uma data, como no calendário. */
  @IsOptional() @ValidateNested() @Type(() => RepeatDto) repeat?: RepeatDto;
}

class RespostaDto {
  @IsBoolean() going!: boolean;
  @IsOptional() @IsString() @Length(0, 300) reason?: string;
}

class AltaDto {
  @IsOptional() @IsISO8601() on?: string;
}

/**
 * O boletim clínico — escritas.
 *
 * As leituras vêm dentro do atleta (`AcademyService.athletes`), e por isso não há
 * aqui nenhum `GET`: a consola recarrega a academia depois de escrever, como faz
 * em todo o resto. Controlador fino — quem pode o quê decide-se no serviço.
 */
@Controller("api")
export class ClinicalController {
  constructor(private readonly clinical: ClinicalService) {}

  @Post("athletes/:id/clinical")
  create(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: ClinicalDto) {
    return this.clinical.criar(req.ctx, id, body);
  }

  @Patch("clinical/:id")
  update(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: ClinicalDto) {
    return this.clinical.actualizar(req.ctx, id, body);
  }

  /** Alta clínica — o que devolve o atleta à disponibilidade. */
  @Post("clinical/:id/alta")
  clear(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: AltaDto) {
    return this.clinical.darAlta(req.ctx, id, body?.on);
  }

  /** A família (ou o atleta) confirma ou recusa uma consulta que pediu confirmação. */
  @Post("clinical/:id/resposta")
  reply(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: RespostaDto) {
    return this.clinical.responder(req.ctx, id, { going: body.going, reason: body.reason ?? null });
  }

  @Post("clinical/:id/reabrir")
  reopen(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.clinical.reabrir(req.ctx, id);
  }

  /** Desmarcar um agendamento. Registos do que aconteceu não se apagam. */
  @Delete("clinical/:id")
  remove(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.clinical.apagar(req.ctx, id);
  }
}

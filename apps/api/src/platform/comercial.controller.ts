import { Body, Controller, Delete, Get, Ip, Param, Patch, Post, Put, Query, Req, UseGuards } from "@nestjs/common";
import { Type } from "class-transformer";
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from "class-validator";
import { ContactChannel, ContactLostReason, SalesMeetingMode, SalesMeetingStatus } from "@prisma/client";
import { Public } from "../auth/auth.guard";
import { PlatformGuard, PlatformRoles, type PlatformRequest } from "./platform.guard";
import { ComercialService } from "./comercial.service";
import { RESULTADOS, type Resultado } from "./comercial.regras";

class ReuniaoDto {
  @IsOptional() @IsISO8601()
  scheduledAt?: string;

  @IsOptional() @IsInt() @Min(15) @Max(240)
  durationMin?: number;

  @IsOptional() @IsIn(Object.values(SalesMeetingMode))
  mode?: SalesMeetingMode;

  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @Length(0, 300)
  location?: string | null;

  @IsOptional() @IsString() @Length(0, 120)
  personName?: string;

  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @Length(0, 80)
  personRole?: string | null;

  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @Length(0, 40)
  personPhone?: string | null;

  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @Length(0, 254)
  personEmail?: string | null;

  @IsOptional() @ValidateIf((_, v) => v !== null) @IsBoolean()
  decides?: boolean | null;

  @IsOptional() @ValidateIf((_, v) => v !== null) @IsInt() @Min(0) @Max(5000)
  athletes?: number | null;

  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @Length(0, 300)
  teams?: string | null;

  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @Length(0, 200)
  currentTool?: string | null;

  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @Length(0, 1000)
  pain?: string | null;

  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @Length(0, 40)
  suggestedPlan?: string | null;

  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @Length(0, 2000)
  notes?: string | null;

  @IsOptional() @IsIn(Object.values(SalesMeetingStatus))
  status?: SalesMeetingStatus;

  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @Length(0, 1000)
  outcomeNote?: string | null;

  @IsOptional() @IsBoolean()
  countsForCommission?: boolean;
}

class ChamadaDto {
  @IsIn(RESULTADOS as unknown as string[])
  resultado!: Resultado;

  /** Por omissão é uma chamada. Email e WhatsApp servem para registar o mesmo por escrito. */
  @IsOptional() @IsIn(["CHAMADA", "EMAIL", "WHATSAPP", "MENSAGEM"])
  canal?: ContactChannel;

  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @Length(0, 2000)
  nota?: string | null;

  @IsOptional() @ValidateIf((_, v) => v !== null) @IsISO8601()
  voltarEm?: string | null;

  @IsOptional() @ValidateIf((_, v) => v !== null) @IsIn(Object.values(ContactLostReason))
  motivo?: ContactLostReason | null;

  @IsOptional() @ValidateNested() @Type(() => ReuniaoDto)
  reuniao?: ReuniaoDto;
}

class TerminarTurnoDto {
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @Length(0, 300)
  note?: string | null;
}

class TurnoDto {
  @IsOptional() @IsISO8601()
  startedAt?: string;

  @IsOptional() @ValidateIf((_, v) => v !== null) @IsISO8601()
  endedAt?: string | null;

  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @Length(0, 300)
  note?: string | null;
}

class CondicoesDto {
  @IsInt() @Min(0) @Max(100_00)
  hourlyCents!: number;

  @IsInt() @Min(1) @Max(100)
  meetingsPerCommission!: number;

  @IsInt() @Min(0) @Max(10_000_00)
  commissionCents!: number;
}

const MES = /^\d{4}-(0[1-9]|1[0-2])$/;

class MesQuery {
  @IsOptional() @Matches(MES)
  mes?: string;

  @IsOptional() @IsString()
  pessoa?: string;
}

/**
 * A área comercial, do lado do painel.
 *
 * O comercial entra em tudo o que é trabalho dele (Hoje, chamadas, reuniões,
 * turno, o seu mês); o dono e os administradores entram também na gestão
 * (corrigir turnos, condições, aprovar meses). O `PlatformGuard` recusa o
 * comercial em qualquer rota que não o nomeie, por isso as de gestão ficam-lhe
 * fechadas só por não o terem na lista.
 */
@Public()
@UseGuards(PlatformGuard)
@PlatformRoles("OWNER", "ADMIN", "SUPPORT", "COMERCIAL")
@Controller("api/platform/comercial")
export class ComercialController {
  constructor(private readonly comercial: ComercialService) {}

  @Get("hoje")
  hoje(@Req() req: PlatformRequest) {
    return this.comercial.hoje(req.admin);
  }

  @Post("clubes/:id/chamada")
  chamada(@Req() req: PlatformRequest, @Param("id") id: string, @Body() body: ChamadaDto) {
    return this.comercial.registarChamada(req.admin, id, body);
  }

  @Get("reunioes")
  reunioes(@Req() req: PlatformRequest) {
    return this.comercial.reunioes(req.admin);
  }

  @Patch("reunioes/:id")
  editarReuniao(@Req() req: PlatformRequest, @Ip() ip: string, @Param("id") id: string, @Body() body: ReuniaoDto) {
    return this.comercial.editarReuniao(req.admin, id, body, ip);
  }

  @Post("turno/iniciar")
  @PlatformRoles("OWNER", "ADMIN", "COMERCIAL")
  iniciar(@Req() req: PlatformRequest) {
    return this.comercial.iniciarTurno(req.admin);
  }

  @Post("turno/terminar")
  @PlatformRoles("OWNER", "ADMIN", "COMERCIAL")
  terminar(@Req() req: PlatformRequest, @Body() body: TerminarTurnoDto) {
    return this.comercial.terminarTurno(req.admin, body.note);
  }

  @Get("mes")
  @PlatformRoles("OWNER", "ADMIN", "COMERCIAL")
  mes(@Req() req: PlatformRequest, @Query() q: MesQuery) {
    return this.comercial.mes(req.admin, q.pessoa, q.mes);
  }

  /* --- Gestão: dono e administradores ------------------------------------- */

  @Get("equipa")
  @PlatformRoles("OWNER", "ADMIN")
  equipa() {
    return this.comercial.equipa();
  }

  @Put("equipa/:adminId/condicoes")
  @PlatformRoles("OWNER", "ADMIN")
  condicoes(@Req() req: PlatformRequest, @Ip() ip: string, @Param("adminId") adminId: string, @Body() body: CondicoesDto) {
    return this.comercial.condicoes(req.admin, adminId, body, ip);
  }

  @Post("equipa/:adminId/turnos")
  @PlatformRoles("OWNER", "ADMIN")
  criarTurno(@Req() req: PlatformRequest, @Ip() ip: string, @Param("adminId") adminId: string, @Body() body: TurnoDto) {
    return this.comercial.criarTurno(req.admin, adminId, body, ip);
  }

  @Patch("turnos/:id")
  @PlatformRoles("OWNER", "ADMIN")
  editarTurno(@Req() req: PlatformRequest, @Ip() ip: string, @Param("id") id: string, @Body() body: TurnoDto) {
    return this.comercial.editarTurno(req.admin, id, body, ip);
  }

  @Delete("turnos/:id")
  @PlatformRoles("OWNER", "ADMIN")
  apagarTurno(@Req() req: PlatformRequest, @Ip() ip: string, @Param("id") id: string) {
    return this.comercial.apagarTurno(req.admin, id, ip);
  }

  @Post("equipa/:adminId/meses/:mes/aprovar")
  @PlatformRoles("OWNER", "ADMIN")
  aprovar(@Req() req: PlatformRequest, @Ip() ip: string, @Param("adminId") adminId: string, @Param("mes") mes: string) {
    return this.comercial.aprovar(req.admin, adminId, mes, ip);
  }

  @Delete("equipa/:adminId/meses/:mes/aprovar")
  @PlatformRoles("OWNER", "ADMIN")
  desaprovar(@Req() req: PlatformRequest, @Ip() ip: string, @Param("adminId") adminId: string, @Param("mes") mes: string) {
    return this.comercial.desaprovar(req.admin, adminId, mes, ip);
  }
}

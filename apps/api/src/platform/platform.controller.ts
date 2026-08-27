import { Body, Controller, Delete, Get, Ip, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { IsBoolean, IsEmail, IsEnum, IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, Min } from "class-validator";
import { StaffDepartment } from "@prisma/client";
import { Public } from "../auth/auth.guard";
import { PlatformGuard, PlatformRoles, type PlatformRequest } from "./platform.guard";
import { PlatformService } from "./platform.service";
import { ClubLogoService } from "../storage/club-logo.service";

/**
 * O corpo de "criar academia", validado. Classe e não interface — ver
 * `invites.dto.ts`. O `slug` é restringido a `[a-z0-9-]` aqui e o serviço volta a
 * validar; a defesa em profundidade impede que um slug com `.` ou `/` chegue a ser
 * usado num subdomínio ou num caminho.
 */
class CreateAcademyDto {
  @IsString()
  @Length(3, 120)
  name!: string;

  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9-]{3,40}$/, { message: "Endereço inválido" })
  slug?: string;

  @IsString()
  @Length(2, 120)
  directorName!: string;

  @IsEmail()
  @Length(3, 254)
  directorEmail!: string;

  /**
   * O nome do cargo de quem recebe o convite, escrito à mão.
   *
   * "Presidente" por omissão. Sem lista fechada: os nomes que os clubes usam não
   * são adivinháveis, e obrigá-los a escolher de seis obrigava-nos a acertar.
   */
  @IsOptional()
  @IsString()
  @Length(2, 60)
  roleName?: string;

  @IsOptional()
  @IsEnum(StaffDepartment)
  roleDepartment?: StaffDepartment;

  /**
   * A cor do clube, se já se souber ao abrir.
   *
   * Continua a ser do clube e continua editável nas Definições — isto é só
   * poupar-lhe o primeiro passo quando quem abre já tem o emblema à frente.
   * Omitir deixa o verde por omissão do `schema.prisma`.
   */
  @IsOptional()
  @Matches(/^#[0-9a-fA-F]{6}$/, { message: "Cor inválida — usa o formato #RRGGBB" })
  signalColor?: string;

  /** Adiar o convite para depois do emblema subir. Ver `sendOwnerInvite`. */
  @IsOptional()
  @IsBoolean()
  deferInvite?: boolean;

  @IsOptional()
  @IsString()
  planId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  trialDays?: number;
}

/** Gémeos dos de `club-logo.controller.ts` — a mesma forma, outra porta. */
class UploadLogoDto {
  @IsIn(["image/png", "image/webp", "image/jpeg"])
  contentType!: "image/png" | "image/webp" | "image/jpeg";
}

class ConfirmLogoDto {
  @IsString() @Length(8, 300) key!: string;
}

/** Fechar ou reabrir um clube. Ver `setAcademyActive`. */
class SetAcademyActiveDto {
  @IsBoolean() active!: boolean;
}

/**
 * Apagar um clube.
 *
 * O endereço vem no corpo e tem de bater certo com o do clube — é o que obriga
 * quem apaga a olhar para **qual** clube está a apagar. Ver `deleteAcademy`.
 */
class DeleteAcademyDto {
  @IsString() @Length(3, 40) slug!: string;
}

/**
 * O painel da plataforma.
 *
 * `@Public()` desliga o guard **das academias** — que exigiria um slug de academia
 * que aqui não existe — e `@UseGuards(PlatformGuard)` põe o desta no lugar dele.
 * As rotas não ficam abertas: ficam com outra porta.
 *
 * É o único sítio do servidor onde isto se faz, e por isso está dito em voz alta:
 * ver `@Public()` num controlador é normalmente sinal de que algo está aberto, e
 * aqui não está.
 */
@Public()
@UseGuards(PlatformGuard)
@Controller("api/platform")
export class PlatformController {
  constructor(
    private readonly platform: PlatformService,
    private readonly logo: ClubLogoService,
  ) {}

  /** Quem sou eu, do lado da plataforma. A app usa-o para arrancar. */
  @Get("me")
  me(@Req() req: PlatformRequest) {
    const { id, name, email, role, mfaEnrolledAt } = req.admin;
    return { id, name, email, role, mfaEnabled: mfaEnrolledAt !== null };
  }

  @Get("overview")
  overview() {
    return this.platform.overview();
  }

  @Get("academies")
  academies() {
    return this.platform.academies();
  }

  @Get("series")
  series(@Query("months") months?: string) {
    return this.platform.series(Math.min(Number(months) || 12, 36));
  }

  @Get("plans")
  plans() {
    return this.platform.plans();
  }

  /**
   * Desactivar ou reactivar um clube. Fechado a `SUPPORT` — quem dá apoio
   * acompanha, não fecha clientes.
   */
  @Patch("academies/:id/estado")
  @PlatformRoles("OWNER", "ADMIN")
  setAcademyActive(
    @Req() req: PlatformRequest,
    @Ip() ip: string,
    @Param("id") id: string,
    @Body() body: SetAcademyActiveDto,
  ) {
    return this.platform.setAcademyActive(req.admin, id, body.active, ip);
  }

  /**
   * Apagar um clube. Só `OWNER`, e só com o endereço escrito à mão.
   *
   * Leva tudo atrás — atletas, presenças, boletins clínicos, mensalidades. É a
   * operação mais destrutiva do produto, e é a única que exige o `OWNER`.
   */
  @Delete("academies/:id")
  @PlatformRoles("OWNER")
  deleteAcademy(
    @Req() req: PlatformRequest,
    @Ip() ip: string,
    @Param("id") id: string,
    @Body() body: DeleteAcademyDto,
  ) {
    return this.platform.deleteAcademy(req.admin, id, body.slug, ip);
  }

  @Get("audit")
  audit(@Query("limit") limit?: string) {
    return this.platform.auditLog(Number(limit) || 100);
  }

  /**
   * Criar academia e convidar o diretor.
   *
   * Fechado a `SUPPORT`: quem dá apoio lê e acompanha, não cria clientes nem mexe
   * em faturação. É a diferença entre poder ajudar e poder decidir.
   */
  @Post("academies")
  @PlatformRoles("OWNER", "ADMIN")
  createAcademy(@Req() req: PlatformRequest, @Ip() ip: string, @Body() body: CreateAcademyDto) {
    return this.platform.createAcademy(req.admin, body, ip);
  }

  /**
   * O símbolo de um clube acabado de abrir.
   *
   * Duas fases, iguais às da consola — pedir autorização, confirmar que chegou;
   * o ficheiro não passa pela API. A diferença é a porta: aqui não há sessão de
   * academia nenhuma (o presidente ainda nem resgatou o convite), e quem autoriza
   * é o `PlatformGuard` com os mesmos papéis que abrem o clube.
   *
   * O clube tem de existir antes — daí a ordem no diálogo: criar, depois o
   * símbolo. Se isto falhar, o clube fica aberto sem emblema e o presidente
   * carrega-o nas Definições, que é onde isto vive de verdade.
   */
  /**
   * Emitir e enviar o convite do primeiro responsável.
   *
   * Serve dois casos: o do diálogo, que adia o envio para o emblema já ir no
   * email, e o banal de o convite se ter perdido — expirou, foi para o spam,
   * ninguém o abriu. Emite sempre um token novo, e o anterior morre nesse
   * instante: ver `sendOwnerInvite`.
   */
  @Post("academies/:id/convite")
  @PlatformRoles("OWNER", "ADMIN")
  sendOwnerInvite(@Req() req: PlatformRequest, @Ip() ip: string, @Param("id") id: string) {
    return this.platform.sendOwnerInvite(req.admin, id, ip);
  }

  @Post("academies/:id/simbolo/upload")
  @PlatformRoles("OWNER", "ADMIN")
  async signLogoUpload(@Param("id") id: string, @Body() body: UploadLogoDto) {
    await this.platform.mustExist(id);
    return this.logo.signUploadFor(id, body.contentType);
  }

  @Post("academies/:id/simbolo")
  @PlatformRoles("OWNER", "ADMIN")
  async confirmLogo(@Req() req: PlatformRequest, @Ip() ip: string, @Param("id") id: string, @Body() body: ConfirmLogoDto) {
    await this.platform.mustExist(id);
    const out = await this.logo.confirmFor(id, body.key);
    await this.platform.audit(req.admin, "academy.logo", "academy", id, {}, ip);
    return out;
  }
}

import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, Length } from "class-validator";
import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { Public } from "../auth/auth.guard";
import { PlatformGuard, PlatformRoles, type PlatformRequest } from "./platform.guard";
import { ReleasesService } from "./releases.service";

const TIPOS = ["NOVIDADES", "MENSAGEM"];

class NovaVersaoDto {
  /** Novidades de uma versão, ou uma mensagem livre. Omitido, novidades. */
  @IsOptional() @IsIn(TIPOS) kind?: string;
  /** "1.4", "29/09/2026" — texto livre, é o Rui que decide como numera. Só nas novidades. */
  @IsOptional() @IsString() @Length(0, 40) version?: string;
  @IsString() @Length(3, 120) title!: string;
  /** Uma novidade por linha. Ver `linhasDeNovidades`. */
  @IsString() @Length(3, 20_000) notes!: string;
}

class EditarVersaoDto {
  @IsOptional() @IsString() @Length(1, 40) version?: string;
  @IsOptional() @IsString() @Length(3, 120) title?: string;
  @IsOptional() @IsString() @Length(3, 20_000) notes?: string;
}

/**
 * O texto por gravar, para se ver o email enquanto se escreve. Mais folgado que
 * o de gravar: uma pré-visualização de um assunto ainda vazio tem de funcionar.
 */
export class PreviewDto {
  @IsOptional() @IsIn(TIPOS) kind?: string;
  @IsString() @Length(0, 40) version!: string;
  @IsString() @Length(0, 120) title!: string;
  @IsString() @Length(0, 20_000) notes!: string;
  /** Ver como este clube o recebe. Ausente = um clube de exemplo. */
  @IsOptional() @IsString() @Length(1, 64) academyId?: string;
}

class EnviarDto {
  /** Os clubes escolhidos. O tecto é folgado; não há mil clubes. */
  @IsArray() @ArrayMaxSize(500) @IsString({ each: true })
  academyIds!: string[];
}

/**
 * As novidades da plataforma — escrever uma versão e mandá-la aos clubes.
 *
 * `@Public()` desliga o guard **das academias** e `@UseGuards(PlatformGuard)` põe
 * o da plataforma no lugar: quem entra aqui é dos nossos e não tem academia
 * nenhuma no contexto. O mesmo par que `TicketsController` usa.
 *
 * Tudo atrás de `OWNER`/`ADMIN`, incluindo **ler**. Não é informação sensível,
 * mas a lista de destinatários traz o nome e o email do presidente de cada
 * clube, e isso não é para o `SUPPORT` que veio responder a um ticket.
 */
@Public()
@UseGuards(PlatformGuard)
@PlatformRoles("OWNER", "ADMIN")
@Controller("api/platform/releases")
export class ReleasesController {
  constructor(private readonly releases: ReleasesService) {}

  @Get()
  list() {
    return this.releases.list();
  }

  /*
   * Antes do `:id`, e não por acaso: o Nest resolve as rotas por ordem de
   * declaração, e com `@Get(":id")` primeiro isto seria lido como a versão com o
   * id "destinatarios". Ver a mesma nota em `TicketsController`.
   */
  @Get("destinatarios")
  destinatarios(@Query("release") releaseId?: string) {
    return this.releases.destinatarios(releaseId);
  }

  /*
   * Também antes do `:id`. É um POST porque leva o texto inteiro no corpo — num
   * GET iria na query, e vinte mil caracteres num URL não passam em todo o lado.
   * Não escreve nada: ver `ReleasesService.preview`.
   */
  @Post("preview")
  preview(@Body() dto: PreviewDto) {
    return this.releases.preview(dto);
  }

  @Post()
  create(@Req() req: PlatformRequest, @Body() dto: NovaVersaoDto) {
    return this.releases.create(req.admin, dto, req.ip);
  }

  @Patch(":id")
  update(@Req() req: PlatformRequest, @Param("id") id: string, @Body() dto: EditarVersaoDto) {
    return this.releases.update(req.admin, id, dto, req.ip);
  }

  @Delete(":id")
  remove(@Req() req: PlatformRequest, @Param("id") id: string) {
    return this.releases.remove(req.admin, id, req.ip);
  }

  /** Manda o email a cada clube escolhido. Ver `ReleasesService.enviar`. */
  @Post(":id/enviar")
  enviar(@Req() req: PlatformRequest, @Param("id") id: string, @Body() dto: EnviarDto) {
    return this.releases.enviar(req.admin, id, dto.academyIds, req.ip);
  }
}

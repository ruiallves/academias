import { Body, Controller, Get, Param, Post, Query, Req } from "@nestjs/common";
import { IsIn, IsOptional, IsString, Length } from "class-validator";
import type { AuthedRequest } from "../auth/auth.guard";
import { DiretorioDeClubesService } from "./diretorio.service";

class PedirEmblemaDto {
  @IsIn(["image/png", "image/webp", "image/jpeg"]) contentType!: string;
  @IsString() @Length(2, 80) clubName!: string;
  @IsOptional() @IsString() @Length(1, 64) knownClubId?: string | null;
}

class ConfirmarEmblemaDto {
  @IsString() @Length(1, 300) key!: string;
}

/**
 * O diretório dos clubes federados de Portugal, para a consola e a app.
 *
 * `GET /api/clubes-conhecidos?q=braga&modalidade=football` devolve até vinte
 * clubes com o emblema. Qualquer pessoa com sessão num clube pode procurar:
 * não há aqui nada de ninguém, só os nomes e os emblemas públicos das
 * federações. Carregar um emblema para um adversário é de quem marca jogos
 * (`calendar:write`), em dois passos como as fotografias.
 */
@Controller("api/clubes-conhecidos")
export class DiretorioDeClubesController {
  constructor(private readonly diretorio: DiretorioDeClubesService) {}

  @Get()
  procurar(@Req() req: AuthedRequest, @Query("q") q = "", @Query("modalidade") modalidade?: string, @Query("limite") limite?: string) {
    return this.diretorio.procurar(req.ctx, String(q).slice(0, 80), modalidade || undefined, Number(limite) || 20);
  }

  /** O emblema que este clube carregou para um nome escrito à mão. */
  @Get("emblema-do-nome")
  emblemaDoNome(@Req() req: AuthedRequest, @Query("nome") nome = "") {
    return this.diretorio.emblemaDoNome(req.ctx, String(nome).slice(0, 80)).then((emblema) => ({ emblema }));
  }

  /** Um clube pelo id (depois dos endereços fixos, para "emblema-do-nome" e "emblemas" não serem lidos como ids). */
  @Get("clube/:id")
  porId(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.diretorio.porId(req.ctx, id);
  }

  @Post("emblemas")
  pedirEmblema(@Req() req: AuthedRequest, @Body() dto: PedirEmblemaDto) {
    return this.diretorio.pedirCarregamento(req.ctx, dto);
  }

  @Post("emblemas/:id/confirmar")
  confirmarEmblema(@Req() req: AuthedRequest, @Param("id") id: string, @Body() dto: ConfirmarEmblemaDto) {
    return this.diretorio.confirmarCarregamento(req.ctx, id, dto.key);
  }
}

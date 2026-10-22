import { Body, Controller, Delete, Get, Header, Headers, Ip, Param, Post, Query, Req } from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import { Public, type AuthedRequest } from "../auth/auth.guard";
import { BilheteiraService } from "./bilheteira.service";
import { PortaService } from "./porta.service";
import {
  AcessoDaPortaDto,
  AnularDto,
  EntrarNaPortaDto,
  IdentificarSocioDto,
  LerDto,
  LugarAnualDto,
  ReembolsoDto,
  ReservarDto,
  ReservarNaAppDto,
  SessaoDto,
} from "./bilheteira.dto";

/**
 * A bilheteira, do lado de fora: quem compra no site e o segurança à porta.
 *
 * Em `/api/clubes/:slug/...` porque é o browser de quem compra que pede (o
 * CORS da API abre estas rotas aos sites dos clubes, ver `origem-do-site.ts`),
 * e porque o leitor vive na mesma origem da API. Nada daqui tem sessão de
 * conta: a compra protege-se com a ficha, o campo-armadilha e os tectos; a
 * página dos bilhetes com o token da compra; o leitor com o link e o PIN.
 *
 * `no-store` em tudo: uma venda com um minuto de cache vendia lugares que já
 * não há, e a página de um bilhete não pode ficar numa CDN.
 *
 * ## Porque é que não há tectos por endereço
 *
 * Porque o endereço que a API vê é o do intermediário, partilhado por muita
 * gente (ver `academia-formulario-do-site`), e o tecto conta por rota e por
 * endereço: era um balde só para todos os clubes. Vinte pedidos de lixo por
 * segundo ao leitor paravam as portas de todos os estádios, e um dia de jogo
 * a sério esgotava o tecto da compra na app sem atacante nenhum. Por isso
 * `@SkipThrottle()`, e a proteção vive no serviço, presa a quem pede: a ficha
 * (presa ao clube, uma vez, 3 s a 30 min) e o campo-armadilha no site, as
 * compras à espera por email e telemóvel, o tecto de lugares guardados sem
 * pagar, a fila por jogo, o bloqueio por número de sócio, e no leitor o
 * bloqueio do PIN e o tecto por acesso (`PortaService`).
 */
@Public()
@Controller("api/clubes/:slug")
export class BilheteiraPublicaController {
  constructor(
    private readonly bilheteira: BilheteiraService,
    private readonly porta: PortaService,
  ) {}

  @SkipThrottle()
  @Get("bilhetes/ficha")
  @Header("Cache-Control", "no-store")
  ficha(@Param("slug") slug: string) {
    return this.bilheteira.fichaDaCompra(slug);
  }

  @SkipThrottle()
  @Get("bilhetes/pedido/:token")
  @Header("Cache-Control", "no-store")
  pedido(@Param("slug") slug: string, @Param("token") token: string) {
    return this.bilheteira.pedido(slug, token);
  }

  @SkipThrottle()
  @Get("bilhetes/:matchId")
  @Header("Cache-Control", "no-store")
  venda(@Param("slug") slug: string, @Param("matchId") matchId: string) {
    return this.bilheteira.venda(slug, matchId);
  }

  @SkipThrottle()
  @Post("bilhetes/:matchId/socio")
  @Header("Cache-Control", "no-store")
  identificar(@Param("slug") slug: string, @Param("matchId") matchId: string, @Body() dto: IdentificarSocioDto) {
    return this.bilheteira.identificarSocio(slug, matchId, dto);
  }

  @SkipThrottle()
  @Post("bilhetes/:matchId")
  @Header("Cache-Control", "no-store")
  reservar(@Param("slug") slug: string, @Param("matchId") matchId: string, @Body() dto: ReservarDto, @Ip() ip: string) {
    return this.bilheteira.reservarNoSite(slug, matchId, dto, ip);
  }

  /* O leitor dos seguranças. */

  @SkipThrottle()
  @Post("porta/entrar")
  @Header("Cache-Control", "no-store")
  entrar(@Param("slug") slug: string, @Body() dto: EntrarNaPortaDto) {
    return this.porta.entrar(slug, dto);
  }

  @SkipThrottle()
  @Post("porta/estado")
  @Header("Cache-Control", "no-store")
  estado(@Param("slug") slug: string, @Body() dto: SessaoDto) {
    return this.porta.estado(slug, dto.sessao);
  }

  @SkipThrottle()
  @Post("porta/ler")
  @Header("Cache-Control", "no-store")
  ler(@Param("slug") slug: string, @Body() dto: LerDto) {
    return this.porta.ler(slug, dto);
  }
}

/**
 * A bilheteira na app do sócio. Autentica-se pelo JWT, como o resto da área
 * de sócio (ver `ClubAppController`); o slug vem em `x-academy-slug`.
 */
@Public()
@Controller("api/socio/bilhetes")
export class BilheteiraAppController {
  constructor(private readonly bilheteira: BilheteiraService) {}

  @SkipThrottle()
  @Get()
  @Header("Cache-Control", "no-store")
  meus(@Headers("authorization") auth: string, @Headers("x-academy-slug") slug: string) {
    return this.bilheteira.meusBilhetes(auth, slug ?? "");
  }

  @SkipThrottle()
  @Get("lugar-anual")
  @Header("Cache-Control", "no-store")
  lugarAnual(@Headers("authorization") auth: string, @Headers("x-academy-slug") slug: string) {
    return this.bilheteira.meuLugarAnual(auth, slug ?? "");
  }

  @SkipThrottle()
  @Get("venda/:matchId")
  @Header("Cache-Control", "no-store")
  venda(@Headers("authorization") auth: string, @Headers("x-academy-slug") slug: string, @Param("matchId") matchId: string) {
    return this.bilheteira.vendaNaApp(auth, slug ?? "", matchId);
  }

  @SkipThrottle()
  @Post(":matchId")
  @Header("Cache-Control", "no-store")
  reservar(@Headers("authorization") auth: string, @Headers("x-academy-slug") slug: string, @Param("matchId") matchId: string, @Body() dto: ReservarNaAppDto) {
    return this.bilheteira.reservarNaApp(auth, slug ?? "", matchId, dto);
  }
}

/** A bilheteira na consola: vendas, anular, reembolsos, acessos das portas, lugares anuais. */
@Controller("api/bilheteira")
export class BilheteiraConsolaController {
  constructor(
    private readonly bilheteira: BilheteiraService,
    private readonly porta: PortaService,
  ) {}

  @Get("jogos/:matchId/vendas")
  vendas(@Req() req: AuthedRequest, @Param("matchId") matchId: string) {
    return this.bilheteira.vendas(req.ctx, matchId);
  }

  @Post("jogos/:matchId/cancelar")
  cancelar(@Req() req: AuthedRequest, @Param("matchId") matchId: string, @Body() dto: AnularDto) {
    return this.bilheteira.cancelarVendas(req.ctx, matchId, dto.motivo);
  }

  @Post("pedidos/:id/anular")
  anular(@Req() req: AuthedRequest, @Param("id") id: string, @Body() dto: AnularDto) {
    return this.bilheteira.anular(req.ctx, id, dto.motivo);
  }

  @Post("pedidos/:id/reembolsado")
  reembolsado(@Req() req: AuthedRequest, @Param("id") id: string, @Body() dto: ReembolsoDto) {
    return this.bilheteira.marcarReembolsado(req.ctx, id, dto.nota);
  }

  @Post("pedidos/:id/reenviar")
  reenviar(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.bilheteira.reenviar(req.ctx, id);
  }

  @Get("jogos/:matchId/portas")
  acessos(@Req() req: AuthedRequest, @Param("matchId") matchId: string) {
    return this.porta.acessos(req.ctx, matchId);
  }

  @Post("jogos/:matchId/portas")
  criarAcesso(@Req() req: AuthedRequest, @Param("matchId") matchId: string, @Body() dto: AcessoDaPortaDto) {
    return this.porta.criarAcesso(req.ctx, matchId, dto);
  }

  @Delete("portas/:id")
  revogar(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.porta.revogar(req.ctx, id);
  }

  @Get("lugares-anuais")
  lugares(@Req() req: AuthedRequest, @Query("seasonId") seasonId?: string, @Query("memberId") memberId?: string) {
    return this.bilheteira.lugaresAnuais(req.ctx, { seasonId: seasonId?.slice(0, 40), memberId: memberId?.slice(0, 40) });
  }

  @Post("lugares-anuais")
  criarLugar(@Req() req: AuthedRequest, @Body() dto: LugarAnualDto) {
    return this.bilheteira.criarLugarAnual(req.ctx, dto);
  }

  @Delete("lugares-anuais/:id")
  apagarLugar(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.bilheteira.apagarLugarAnual(req.ctx, id);
  }
}

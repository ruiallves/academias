import { Body, Controller, Delete, Get, Header, Ip, Param, Patch, Post, Put, Req } from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import { Public, type AuthedRequest } from "../auth/auth.guard";
import { LojaService } from "./loja.service";
import { CatalogoService } from "./catalogo.service";
import { CategoriaDto, CodigoDto, OrdemDto } from "./catalogo.dto";
import { AnularEncomendaDto, CarrinhoDto, EncomendarDto, EnviadaDto, ReembolsoEncomendaDto } from "./loja.dto";

/**
 * A loja, do lado de fora: quem compra no site.
 *
 * Em `/api/clubes/:slug/...` porque é o browser de quem compra que pede (o
 * CORS da API abre estas rotas aos sites dos clubes, ver `origem-do-site.ts`).
 * Nada daqui tem sessão: a encomenda protege-se com a ficha, o campo-armadilha,
 * o desafio da Cloudflare e os tectos do serviço; a página da encomenda com o
 * token dela. `no-store` em tudo, e sem tectos por endereço, pelas razões da
 * bilheteira (`BilheteiraPublicaController`).
 */
@Public()
@Controller("api/clubes/:slug/loja")
export class LojaPublicaController {
  constructor(private readonly loja: LojaService) {}

  @SkipThrottle()
  @Get("ficha")
  @Header("Cache-Control", "no-store")
  ficha(@Param("slug") slug: string) {
    return this.loja.fichaDaCompra(slug);
  }

  @SkipThrottle()
  @Post("carrinho")
  @Header("Cache-Control", "no-store")
  carrinho(@Param("slug") slug: string, @Body() dto: CarrinhoDto) {
    return this.loja.carrinho(slug, dto);
  }

  @SkipThrottle()
  @Post("encomendas")
  @Header("Cache-Control", "no-store")
  encomendar(@Param("slug") slug: string, @Body() dto: EncomendarDto, @Ip() ip: string) {
    return this.loja.encomendar(slug, dto, ip);
  }

  @SkipThrottle()
  @Get("encomendas/:token")
  @Header("Cache-Control", "no-store")
  encomenda(@Param("slug") slug: string, @Param("token") token: string) {
    return this.loja.encomenda(slug, token);
  }
}

/** A loja na consola: as encomendas e o que se lhes faz. Ver é `website:read`; mexer é `website:write`. */
@Controller("api/loja")
export class LojaConsolaController {
  constructor(private readonly loja: LojaService) {}

  @Get("encomendas")
  listar(@Req() req: AuthedRequest) {
    return this.loja.listar(req.ctx);
  }

  @Post("encomendas/:id/pronta")
  pronta(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.loja.pronta(req.ctx, id);
  }

  @Post("encomendas/:id/enviada")
  enviada(@Req() req: AuthedRequest, @Param("id") id: string, @Body() dto: EnviadaDto) {
    return this.loja.enviada(req.ctx, id, dto.rastreio);
  }

  @Post("encomendas/:id/entregue")
  entregue(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.loja.entregue(req.ctx, id);
  }

  @Post("encomendas/:id/anular")
  anular(@Req() req: AuthedRequest, @Param("id") id: string, @Body() dto: AnularEncomendaDto) {
    return this.loja.anular(req.ctx, id, dto.motivo);
  }

  @Post("encomendas/:id/reembolsado")
  reembolsado(@Req() req: AuthedRequest, @Param("id") id: string, @Body() dto: ReembolsoEncomendaDto) {
    return this.loja.marcarReembolsado(req.ctx, id, dto.nota);
  }

  @Post("encomendas/:id/reenviar")
  reenviar(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.loja.reenviar(req.ctx, id);
  }
}

/**
 * O catálogo da loja na consola: categorias e códigos promocionais. A lista
 * vem com `GET /api/site` (ver `SiteService.ler`); aqui só se escreve.
 */
@Controller("api/site")
export class CatalogoController {
  constructor(private readonly catalogo: CatalogoService) {}

  @Post("categorias")
  criarCategoria(@Req() req: AuthedRequest, @Body() dto: CategoriaDto) {
    return this.catalogo.criarCategoria(req.ctx, dto);
  }

  @Put("categorias-ordem")
  ordenarCategorias(@Req() req: AuthedRequest, @Body() dto: OrdemDto) {
    return this.catalogo.ordenarCategorias(req.ctx, dto);
  }

  @Patch("categorias/:id")
  editarCategoria(@Req() req: AuthedRequest, @Param("id") id: string, @Body() dto: CategoriaDto) {
    return this.catalogo.editarCategoria(req.ctx, id, dto);
  }

  @Delete("categorias/:id")
  apagarCategoria(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.catalogo.apagarCategoria(req.ctx, id);
  }

  @Post("codigos")
  criarCodigo(@Req() req: AuthedRequest, @Body() dto: CodigoDto) {
    return this.catalogo.criarCodigo(req.ctx, dto);
  }

  @Patch("codigos/:id")
  editarCodigo(@Req() req: AuthedRequest, @Param("id") id: string, @Body() dto: CodigoDto) {
    return this.catalogo.editarCodigo(req.ctx, id, dto);
  }

  @Delete("codigos/:id")
  apagarCodigo(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.catalogo.apagarCodigo(req.ctx, id);
  }
}

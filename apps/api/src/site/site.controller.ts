import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Req } from "@nestjs/common";
import type { AuthedRequest } from "../auth/auth.guard";
import { AtualizarSiteDto, BilheteiraDto, ImagemDto, MensagemDto, NoticiaDto, PatrocinadorDto, PrecosBilheteiraDto, ProdutoDto } from "./site.dto";
import { SiteService } from "./site.service";

/**
 * O menu Website da consola. As permissões vivem no serviço, como nos outros
 * módulos (ver `inventory.controller.ts`).
 */
@Controller("api/site")
export class SiteController {
  constructor(private readonly site: SiteService) {}

  @Get()
  ler(@Req() req: AuthedRequest) {
    return this.site.ler(req.ctx);
  }

  @Patch()
  atualizar(@Req() req: AuthedRequest, @Body() dto: AtualizarSiteDto) {
    return this.site.atualizar(req.ctx, dto);
  }

  @Post("noticias")
  criarNoticia(@Req() req: AuthedRequest, @Body() dto: NoticiaDto) {
    return this.site.criarNoticia(req.ctx, dto);
  }

  @Patch("noticias/:id")
  editarNoticia(@Req() req: AuthedRequest, @Param("id") id: string, @Body() dto: NoticiaDto) {
    return this.site.editarNoticia(req.ctx, id, dto);
  }

  @Delete("noticias/:id")
  apagarNoticia(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.site.apagarNoticia(req.ctx, id);
  }

  @Post("produtos")
  criarProduto(@Req() req: AuthedRequest, @Body() dto: ProdutoDto) {
    return this.site.criarProduto(req.ctx, dto);
  }

  @Patch("produtos/:id")
  editarProduto(@Req() req: AuthedRequest, @Param("id") id: string, @Body() dto: ProdutoDto) {
    return this.site.editarProduto(req.ctx, id, dto);
  }

  @Delete("produtos/:id")
  apagarProduto(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.site.apagarProduto(req.ctx, id);
  }

  @Post("patrocinadores")
  criarPatrocinador(@Req() req: AuthedRequest, @Body() dto: PatrocinadorDto) {
    return this.site.criarPatrocinador(req.ctx, dto);
  }

  @Patch("patrocinadores/:id")
  editarPatrocinador(@Req() req: AuthedRequest, @Param("id") id: string, @Body() dto: PatrocinadorDto) {
    return this.site.editarPatrocinador(req.ctx, id, dto);
  }

  @Delete("patrocinadores/:id")
  apagarPatrocinador(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.site.apagarPatrocinador(req.ctx, id);
  }

  @Put("bilheteira/:matchId")
  gravarBilheteira(@Req() req: AuthedRequest, @Param("matchId") matchId: string, @Body() dto: BilheteiraDto) {
    return this.site.gravarBilheteira(req.ctx, matchId, dto);
  }

  /** Os preços por omissão da bilheteira, por recinto. */
  @Put("bilheteira-precos")
  gravarPrecos(@Req() req: AuthedRequest, @Body() dto: PrecosBilheteiraDto) {
    return this.site.gravarPrecos(req.ctx, dto.porRecinto);
  }

  @Delete("bilheteira/:matchId")
  apagarBilheteira(@Req() req: AuthedRequest, @Param("matchId") matchId: string) {
    return this.site.apagarBilheteira(req.ctx, matchId);
  }

  @Post("imagens")
  assinarImagem(@Req() req: AuthedRequest, @Body() dto: ImagemDto) {
    return this.site.assinarImagem(req.ctx, dto.contentType);
  }

  /* As mensagens do formulário de contactos do site. */

  @Get("mensagens")
  mensagens(@Req() req: AuthedRequest) {
    return this.site.mensagens(req.ctx);
  }

  @Patch("mensagens/:id")
  mudarMensagem(@Req() req: AuthedRequest, @Param("id") id: string, @Body() dto: MensagemDto) {
    return this.site.mudarMensagem(req.ctx, id, dto);
  }

  @Delete("mensagens/:id")
  apagarMensagem(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.site.apagarMensagem(req.ctx, id);
  }
}

import { Controller, Get, Header, Param, Query, StreamableFile } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { Public } from "../auth/auth.guard";
import { SitePublicoService } from "./site-publico.service";

/**
 * O site público do clube, sem sessão. Ver `SitePublicoService`.
 *
 * ## O limite de pedidos
 *
 * Quem pede é o servidor do site (Vercel), e não o browser de cada adepto: os
 * sites de todos os clubes saem dos mesmos poucos endereços, e o limite global
 * (120 por minuto por endereço) chegava a meio de uma manhã de jogos. As
 * páginas ficam em cache no site, por isso o volume real é baixo; o tecto
 * fica alto, mas existe.
 *
 * `Cache-Control` curto para as CDNs pelo meio não guardarem uma notícia
 * apagada mais do que um minuto.
 */
@Public()
@Throttle({ default: { ttl: 60_000, limit: 2_000 } })
@Controller("public/sites")
export class SitePublicoController {
  constructor(private readonly site: SitePublicoService) {}

  @Get("por-dominio/:host")
  @Header("Cache-Control", "public, max-age=60")
  porDominio(@Param("host") host: string) {
    return this.site.porDominio(host.slice(0, 260));
  }

  @Get(":slug/resumo")
  @Header("Cache-Control", "public, max-age=60")
  resumo(@Param("slug") slug: string) {
    return this.site.resumo(slug);
  }

  @Get(":slug")
  @Header("Cache-Control", "public, max-age=60")
  clube(@Param("slug") slug: string) {
    return this.site.clubePorSlug(slug);
  }

  @Get(":slug/noticias")
  @Header("Cache-Control", "public, max-age=60")
  noticias(@Param("slug") slug: string, @Query("limit") limit?: string, @Query("category") category?: string) {
    const n = Number(limit);
    return this.site.noticias(slug, { limit: Number.isFinite(n) && n > 0 ? n : undefined, category: category?.slice(0, 40) || undefined });
  }

  @Get(":slug/noticias/:id")
  @Header("Cache-Control", "public, max-age=60")
  noticia(@Param("slug") slug: string, @Param("id") id: string) {
    return this.site.noticia(slug, id);
  }

  @Get(":slug/equipas")
  @Header("Cache-Control", "public, max-age=60")
  equipas(@Param("slug") slug: string) {
    return this.site.equipas(slug);
  }

  @Get(":slug/equipas/:id")
  @Header("Cache-Control", "public, max-age=60")
  equipa(@Param("slug") slug: string, @Param("id") id: string) {
    return this.site.equipa(slug, id);
  }

  /**
   * A fotografia de um atleta do plantel. Uma hora de cache: desligar as
   * fotografias da equipa demora no máximo isso a chegar a quem já a viu.
   */
  @Get(":slug/equipas/:id/atletas/:athleteId/foto")
  @Header("Cache-Control", "public, max-age=3600")
  @Header("X-Content-Type-Options", "nosniff")
  async fotoDoAtleta(@Param("slug") slug: string, @Param("id") id: string, @Param("athleteId") athleteId: string) {
    const { dados, tipo } = await this.site.fotoDoAtleta(slug.slice(0, 80), id.slice(0, 40), athleteId.slice(0, 40));
    return new StreamableFile(dados, { type: tipo });
  }

  @Get(":slug/jogos")
  @Header("Cache-Control", "public, max-age=60")
  jogos(@Param("slug") slug: string) {
    return this.site.jogos(slug);
  }

  @Get(":slug/jogos/:id")
  @Header("Cache-Control", "public, max-age=60")
  jogo(@Param("slug") slug: string, @Param("id") id: string) {
    return this.site.jogo(slug, id);
  }

  @Get(":slug/eventos")
  @Header("Cache-Control", "public, max-age=60")
  eventos(@Param("slug") slug: string) {
    return this.site.eventos(slug);
  }

  @Get(":slug/produtos")
  @Header("Cache-Control", "public, max-age=60")
  produtos(@Param("slug") slug: string) {
    return this.site.produtos(slug);
  }

  @Get(":slug/produtos/:id")
  @Header("Cache-Control", "public, max-age=60")
  produto(@Param("slug") slug: string, @Param("id") id: string) {
    return this.site.produto(slug, id);
  }

  /** O texto da adesão e as categorias de sócio, para o "Ser sócio" dentro do site. */
  @Get(":slug/socios")
  @Header("Cache-Control", "public, max-age=60")
  socios(@Param("slug") slug: string) {
    return this.site.socios(slug);
  }
}

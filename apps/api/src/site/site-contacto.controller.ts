import { Body, Controller, Get, Ip, Param, Post } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { Public } from "../auth/auth.guard";
import { ContactoDoSiteDto } from "./site.dto";
import { SitePublicoService } from "./site-publico.service";

/**
 * O formulário de contactos do site de um clube — a entrada da frente do clube.
 *
 * ## Porque é que vive em `/api/clubes/:slug` e não em `/public/sites`
 *
 * Porque quem pede é o **browser do visitante**, e não o servidor do site: os
 * endpoints de `/public/sites` são lidos pelo Vercel, de poucos endereços, e
 * têm um tecto largo por isso. Um envio vindo do browser tem de passar pelo
 * CORS, e o CORS da API já abre `/api/clubes/...` aos sites dos clubes (ver
 * `origem-do-site.ts`), para a adesão de sócio. Fica ao lado dela, com o mesmo
 * tecto por endereço: cinco por minuto chega a qualquer pessoa e trava um
 * script.
 *
 * O resto do crivo (ficha, campo-armadilha, repetições, tectos do clube) está
 * no serviço, ao pé da escrita.
 */
@Public()
@Controller("api/clubes/:slug")
export class SiteContactoController {
  constructor(private readonly site: SitePublicoService) {}

  /** A ficha que o formulário pede ao abrir. Sem ela, o envio é recusado. */
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @Get("contacto/ficha")
  ficha() {
    return this.site.fichaDeContacto();
  }

  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Post("contacto")
  enviar(@Param("slug") slug: string, @Body() dto: ContactoDoSiteDto, @Ip() ip: string) {
    return this.site.contacto(slug.slice(0, 80), dto, ip);
  }
}

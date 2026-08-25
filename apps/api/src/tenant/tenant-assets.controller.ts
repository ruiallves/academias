import { Controller, Get, Header, NotFoundException, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { Public } from "../auth/auth.guard";
import { LandingService } from "../landing/landing.service";
import type { TenantRequest } from "./tenant";

/**
 * O manifest da PWA, com a marca do clube.
 *
 * ## Porque é que isto tem de ser gerado, e não pode ser um ficheiro
 *
 * Porque é a diferença entre o pai instalar "Academia Fafe" e instalar o nome da
 * nossa empresa. O ícone, o nome e a cor do arranque saem daqui e vão parar ao
 * ecrã inicial do telemóvel dele — é o sítio onde o white-label mais conta, e um
 * ficheiro estático só sabe dizer uma coisa a todos os clubes.
 *
 * ## Porque é que vive na raiz da origem do clube
 *
 * Porque a instalação é oferecida pela landing, em `fafe.academias.pt/`. Um
 * manifest tem de ser da mesma origem da página que o oferece, e o `scope` tem de
 * cobrir essa página — daí `scope: "/"` com `start_url: "/app/"`: a app abre em
 * `/app/`, mas a página que a instala está na raiz e continua dentro do âmbito.
 *
 * ## Os ícones
 *
 * Ainda são os genéricos. Ícones por clube obrigam a redimensionar o logótipo
 * para 192 e 512 e a servi-lo em PNG — o `logoUrl` que temos é o que o clube
 * carregou, em tamanho e formato desconhecidos, e declarar `sizes` errados faz o
 * Android recusar a instalação em silêncio. Fica para quando houver um passo de
 * processamento de imagem; o nome e a cor, que é o que se lê primeiro, já são do
 * clube.
 */
@Public()
@Controller()
export class TenantAssetsController {
  constructor(private readonly landing: LandingService) {}

  /**
   * Dois caminhos, um conteúdo.
   *
   * A raiz é a que interessa: é a que a landing referencia, e é de lá que a
   * instalação acontece. `/app/manifest.webmanifest` existe porque o Vite prefixa
   * o `base` aos caminhos absolutos do `index.html` da app — o `<link>` que lá
   * está sai do build a apontar para dentro de `/app/`. Servir os dois é mais
   * barato do que ensinar o Vite a não o fazer.
   */
  @Get(["manifest.webmanifest", "app/manifest.webmanifest"])
  @Header("Content-Type", "application/manifest+json; charset=utf-8")
  // Curto de propósito: um clube que mude a sua cor na consola vê-a no manifest
  // dentro de minutos, não de dias. O ficheiro tem meia dúzia de linhas.
  @Header("Cache-Control", "public, max-age=300")
  async manifest(
    @Req() req: Request & TenantRequest,
    /**
     * O clube, em desenvolvimento.
     *
     * Em produção o `Host` já o diz e isto nunca é lido. Em `localhost` não há
     * subdomínio nenhum, e sem esta saída o manifest não existiria em
     * desenvolvimento — ver o proxy no `vite.config.ts` da app da família.
     */
    @Query("academia") academia?: string,
  ) {
    const slug = req.tenantSlug ?? academia?.trim().toLowerCase();
    if (!slug) throw new NotFoundException("Sem academia");

    const academy = await this.landing.findBySlug(slug);
    if (!academy) throw new NotFoundException("Academia não encontrada");

    return {
      // O `id` fixa a identidade da app instalada. Sem ele, o browser deriva-a da
      // `start_url` — e mudar a `start_url` um dia passaria a instalar uma app
      // *nova* ao lado da que o pai já tem.
      id: "/app/",
      name: academy.name,
      short_name: academy.shortName,
      description: "Treinos, pagamentos e o progresso do teu atleta.",
      start_url: "/app/",
      scope: "/",
      display: "standalone",
      orientation: "portrait",
      background_color: "#f6f5f2",
      theme_color: academy.signalColor,
      lang: "pt-PT",
      dir: "ltr",
      categories: ["sports", "education"],
      icons: [
        { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
        { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
        { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      ],
    };
  }
}

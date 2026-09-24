import { Controller, Get, Header, NotFoundException, Param, Query, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { Public } from "../auth/auth.guard";
import { LandingService } from "../landing/landing.service";
import type { TenantRequest } from "./tenant";
import { caminhoDoIcone, desenharIcone, isNomeDoIcone, versaoDoSimbolo, type NomeDoIcone } from "./club-icons";

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
 * Com símbolo, os ícones são **gerados a partir dele** (`club-icons.ts`):
 * quadrados, com a medida exacta que se declara, e com a versão do símbolo no
 * endereço. Sem símbolo, os nossos genéricos.
 *
 * Já foi de outras duas maneiras, e as duas falharam no telemóvel:
 *
 *  - O símbolo ao lado dos genéricos. Os genéricos declaravam medidas exactas e
 *    o símbolo `sizes: "any"`; o Chrome prefere a medida exacta, e instalava o
 *    nosso ícone mesmo em clubes com símbolo.
 *  - O símbolo sozinho, tal como foi carregado. O Chrome no Android só aceita
 *    um ícone quadrado de 144 px ou mais; um símbolo largo ou pequeno deixava o
 *    manifest sem ícone aceitável, e com o manifest inválido o Chrome deixa de
 *    actualizar a app instalada — ficava para sempre com o primeiro ícone.
 *
 * O maskable também é gerado, com o símbolo dentro da zona segura: o recorte do
 * fabricante (círculo, no pior caso) nunca lhe come as bordas.
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
      // Ver "Os ícones" no topo do ficheiro.
      icons: academy.logoUrl
        ? [
            { src: caminhoDoIcone(slug, academy.logoUrl, "192"), sizes: "192x192", type: "image/png" },
            { src: caminhoDoIcone(slug, academy.logoUrl, "512"), sizes: "512x512", type: "image/png" },
            {
              src: caminhoDoIcone(slug, academy.logoUrl, "maskable-512"),
              sizes: "512x512",
              type: "image/png",
              purpose: "maskable",
            },
          ]
        : [
            { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
            { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
            { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
          ],
    };
  }

  /**
   * Um ícone da app, desenhado a partir do símbolo do clube.
   *
   * O clube vem do caminho, não do `Host` — ver `club-icons.ts`. O símbolo é
   * público de qualquer forma (está no bucket `clube-publico`).
   *
   * A versão do caminho que bate com o símbolo actual guarda-se para sempre:
   * símbolo novo é caminho novo. Uma versão antiga (um manifest guardado há
   * minutos) recebe o símbolo actual, mas com cache curta — não pode ficar
   * presa ao endereço antigo como se fosse dele.
   */
  @Get("icone/:slug/:versao/:ficheiro")
  async icone(
    @Param("slug") slug: string,
    @Param("versao") versao: string,
    @Param("ficheiro") ficheiro: string,
    @Res() res: Response,
  ) {
    const nome = ficheiro.replace(/\.png$/, "");
    if (!isNomeDoIcone(nome)) throw new NotFoundException("Ícone desconhecido");

    const academy = await this.landing.findBySlug(slug.trim().toLowerCase());
    if (!academy) throw new NotFoundException("Academia não encontrada");

    if (!academy.logoUrl) return this.generico(res, nome);

    let png: Buffer;
    try {
      png = await desenharIcone(academy.logoUrl, nome);
    } catch (e) {
      // Um símbolo que não se consegue ler não pode deixar a app sem ícone.
      console.warn(`[icone] ${slug}: ${e instanceof Error ? e.message : e}`);
      return this.generico(res, nome);
    }

    const actual = versao === versaoDoSimbolo(academy.logoUrl);
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", actual ? "public, max-age=31536000, immutable" : "public, max-age=300");
    res.send(png);
  }

  /** O nosso ícone, sem cache: assim que houver símbolo, o endereço passa a dá-lo. */
  private generico(res: Response, nome: NomeDoIcone) {
    const ficheiro = nome === "apple-180" ? "/icon-180.png" : nome === "192" ? "/icon-192.png" : "/icon-512.png";
    res.setHeader("Cache-Control", "no-store");
    res.redirect(302, ficheiro);
  }
}

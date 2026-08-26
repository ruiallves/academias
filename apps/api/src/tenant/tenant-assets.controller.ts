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
 * O símbolo do clube entra **a acrescentar** aos genéricos, nunca a substituí-los.
 *
 * A razão é a instalação: o Android recusa-a em silêncio se nenhum ícone
 * declarado bater certo com o ficheiro real, e o `logoUrl` é o que o clube
 * carregou — em tamanho e formato que não controlamos. Declará-lo como `512x512`
 * quando é 300×180 partia a instalação para toda a gente daquele clube.
 *
 * `sizes: "any"` diz ao browser "usa isto onde couber, sem prometer medida", e os
 * dois PNG genéricos ficam como a garantia de que existe sempre um ícone com
 * medida declarada e verdadeira. O clube vê o seu emblema; a instalação nunca
 * depende dele.
 *
 * ## O `maskable`, e porque é que ele desaparece quando há emblema
 *
 * Um ícone marcado `purpose: "maskable"` não é uma alternativa entre iguais: no
 * Android é a **primeira escolha** do Chrome para o ecrã inicial, porque é o
 * único que ele sabe recortar na forma do fabricante. Declarar o nosso genérico
 * como maskable enquanto o emblema do clube ia sem `purpose` fazia com que o
 * telemóvel de todos os pais instalasse o nosso ícone — o clube carregava o
 * símbolo na consola e não via diferença nenhuma no telemóvel.
 *
 * Por isso, havendo emblema, o genérico deixa de se declarar maskable e o
 * emblema ganha. Continua a haver ícones de medida declarada (192 e 512), que é
 * o que a instalação exige; o Android põe o emblema sobre o fundo dele em vez de
 * o recortar, e é o que queremos — um emblema recortado por uma máscara circular
 * perde o que está nas bordas, que num emblema de clube costuma ser o nome.
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
      /*
        Havendo emblema, os genéricos não entram — nenhum.

        Entravam sempre, emblema ou não, e era esse o bug: o Android estava a
        instalar a app com o ícone genérico da "Academia" mesmo em clubes com
        emblema configurado. A causa não era o emblema estar ausente — era ele
        estar a **competir** e a perder.

        O emblema é declarado `sizes: "any"` porque não sabemos as dimensões
        reais do que o clube carregou (ver a nota sobre "512x512 quando é
        300×180" mais acima). Os genéricos, ao lado, declaram `192x192` e
        `512x512` — medidas exactas e verificáveis. Um selector de ícone que
        prefira "o maior candidato com medida exacta que bata certo" escolhe os
        nossos antes do emblema, porque "any" não é uma medida que se compare.

        Não há como declarar o emblema com uma medida exacta sem a saber — e
        inventá-la é o que já tinha partido a instalação antes. A única forma de
        garantir que o emblema ganha é tirar-lhe a concorrência: com emblema,
        ele é o **único** ícone da lista. O ficheiro existe — `confirm()` já
        verificou isso antes de gravar `logoUrl` — por isso não há risco de
        instalação sem ícone nenhum.
      */
      icons: academy.logoUrl
        ? [{ src: academy.logoUrl, sizes: "any", type: mimeOf(academy.logoUrl) }]
        : [
            { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
            { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
            // O maskable só serve enquanto o ícone é o nosso — ver a nota no
            // topo do ficheiro sobre porque é que o emblema nunca o leva.
            { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
          ],
    };
  }
}

/**
 * O tipo do emblema, pela extensão do ficheiro.
 *
 * Estava fixo em `image/png` e o carregamento aceita três formatos (ver
 * `club-logo.service.ts`): um clube que carregasse WebP ou JPEG declarava um
 * ficheiro que não era o que estava lá, e um `type` que não bate com o conteúdo
 * é motivo para o Chrome descartar o ícone em silêncio.
 *
 * O `logoUrl` é construído por nós a partir da chave que nós escolhemos, por
 * isso a extensão é de confiança. Na dúvida, PNG — é o que sempre se assumiu.
 */
function mimeOf(url: string): string {
  const ext = url.split("?")[0].split(".").pop()?.toLowerCase();
  if (ext === "webp") return "image/webp";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  return "image/png";
}

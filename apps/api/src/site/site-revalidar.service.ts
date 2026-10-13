import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

/**
 * Avisa o site do clube de que alguma coisa mudou.
 *
 * O site guarda as páginas em cache (um minuto, `revalidate: 60` em
 * `apps/clube-site/src/dados/fonte.ts`), etiquetadas por clube. Sem este
 * aviso uma notícia publicada aparecia até um minuto depois; com ele, a
 * página seguinte já a traz.
 *
 * Nunca trava quem grava: corre depois, sem esperar, e uma falha só fica no
 * registo. O pior que acontece é a cache cair sozinha um minuto depois.
 *
 * `SITE_REVALIDATE_URL` é a rota do site (`https://<projeto>.vercel.app/api/revalidar`)
 * e `SITE_REVALIDATE_SECRET` o segredo partilhado com ela. Sem os dois não faz
 * nada, o que é o caso em desenvolvimento.
 */
@Injectable()
export class SiteRevalidarService {
  private readonly log = new Logger(SiteRevalidarService.name);

  constructor(private readonly config: ConfigService) {}

  avisar(slug: string): void {
    const url = this.config.get<string>("SITE_REVALIDATE_URL");
    const segredo = this.config.get<string>("SITE_REVALIDATE_SECRET");
    if (!url || !segredo) return;
    void fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-revalidar-segredo": segredo },
      body: JSON.stringify({ slug }),
      signal: AbortSignal.timeout(5_000),
    })
      .then((r) => {
        if (!r.ok) this.log.warn(`O site respondeu ${r.status} ao aviso de ${slug}.`);
      })
      .catch((e) => this.log.warn(`O aviso ao site de ${slug} falhou: ${e}`));
  }
}

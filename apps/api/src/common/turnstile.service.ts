import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

/**
 * O Cloudflare Turnstile: o desafio anti-robô dos formulários públicos.
 *
 * Os formulários sem sessão (o contacto do academias.pt, a compra de bilhetes
 * e a identificação de sócio no site de um clube, o contacto do site de um
 * clube) protegiam-se só com a ficha assinada e o campo-armadilha. Isso trava
 * um script preguiçoso; um robô que pede fichas e espera três segundos passa.
 * O Turnstile pergunta ao browser se há uma pessoa do outro lado, quase sempre
 * sem ela dar por isso, e devolve um token que só a Cloudflare sabe validar.
 *
 * ## Como se verifica
 *
 * O formulário manda o token (`turnstile`); aqui pergunta-se à Cloudflare
 * (`siteverify`) com a chave secreta. O token vale uma vez e cinco minutos.
 *
 * ## Quando não há chaves
 *
 * Sem `TURNSTILE_SECRET_KEY` a verificação não acontece e fica um aviso no
 * arranque: é o caso do desenvolvimento, e de produção até as chaves estarem
 * postas. A ficha e o campo-armadilha continuam a valer.
 *
 * ## Quando a Cloudflare não responde
 *
 * Um token recusado é recusado. Mas se a Cloudflare estiver em baixo (falha de
 * rede, cinco segundos sem resposta), o pedido passa com um aviso no registo:
 * uma avaria lá fora não pode parar a venda de bilhetes de um jogo. As outras
 * proteções continuam lá.
 */

const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const RECUSA = "Não conseguimos confirmar que és uma pessoa. Recarrega a página e tenta outra vez.";

@Injectable()
export class TurnstileService {
  private readonly log = new Logger(TurnstileService.name);
  private readonly segredo: string;

  constructor(private readonly config: ConfigService) {
    this.segredo = this.config.get<string>("TURNSTILE_SECRET_KEY")?.trim() ?? "";
    if (!this.segredo) this.log.warn("Sem TURNSTILE_SECRET_KEY: os formulários públicos não pedem o desafio anti-robô");
  }

  ligado(): boolean {
    return !!this.segredo;
  }

  /**
   * Lança 400 se o token não passar. `onde` é só para o registo ("compra",
   * "contacto-site"), para se saber de onde vêm as recusas.
   */
  async exigir(token: string | undefined, onde: string, ip?: string): Promise<void> {
    if (!this.segredo) return;
    if (!token || token.length > 2048) {
      this.log.warn(`Turnstile: ${onde} sem token (${ip ?? "?"})`);
      throw new BadRequestException(RECUSA);
    }

    // Sem `remoteip`: o endereço que a API vê é o do intermediário, não o do visitante (ver `academia-formulario-do-site`).
    const corpo = new URLSearchParams({ secret: this.segredo, response: token });

    let resposta: { success?: boolean; "error-codes"?: string[] };
    try {
      const r = await fetch(SITEVERIFY, { method: "POST", body: corpo, signal: AbortSignal.timeout(5_000) });
      resposta = (await r.json()) as typeof resposta;
    } catch (e) {
      this.log.error(`Turnstile sem resposta em ${onde}, o pedido passa: ${e instanceof Error ? e.message : e}`);
      return;
    }

    if (!resposta.success) {
      const codigos = resposta["error-codes"] ?? [];
      // Uma chave mal posta é avaria nossa, não do visitante: diz-se no registo com todas as letras.
      if (codigos.some((c) => c.includes("secret"))) this.log.error(`Turnstile: a chave secreta foi recusada (${codigos.join(", ")})`);
      else this.log.warn(`Turnstile recusou ${onde} (${ip ?? "?"}): ${codigos.join(", ")}`);
      throw new BadRequestException(RECUSA);
    }
  }
}

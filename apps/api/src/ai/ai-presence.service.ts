import { Injectable } from "@nestjs/common";

/**
 * Que workers de visão computacional estão vivos, agora.
 *
 * ## Porque é que isto existe
 *
 * A consola dizia "Na fila — à espera de um worker" e, por baixo, "podes fechar
 * a consola, recebes uma notificação quando terminar". As duas frases juntas são
 * uma promessa; e sem worker nenhum ligado, é uma promessa que ninguém pode
 * cumprir — a análise fica ali para sempre e o produto não diz porquê. É o mesmo
 * princípio da área inteira: quando não há confiança, diz-se, não se finge.
 *
 * ## Porque é que é memória e não uma tabela
 *
 * A fila é uma tabela porque os jobs têm de sobreviver a tudo. A **presença**
 * não: é uma pergunta sobre o instante — "há alguém a trabalhar agora?" — e a
 * resposta certa dez segundos depois de um reinício é a mesma que se obtém
 * esperando dez segundos, porque cada worker pergunta por trabalho de cinco em
 * cinco segundos. Uma tabela para isto seria uma escrita por worker a cada
 * cinco segundos, para sempre, para guardar um facto que caduca em trinta.
 *
 * O preço, escrito: com **dois processos de API** cada um só vê os workers que
 * falaram com ele, e a contagem sai curta. Hoje é um processo. No dia em que
 * forem dois, isto sobe a tabela — e a mudança é este ficheiro, não os ecrãs.
 */
@Injectable()
export class AiPresenceService {
  /** Nome do worker → quando falou pela última vez, e o que sabe fazer. */
  private readonly visto = new Map<string, { at: number; kinds: string[] }>();

  /**
   * Trinta segundos.
   *
   * O worker pede trabalho a cada cinco (`AI_WORKER_POLL_SECONDS`), e enquanto
   * processa um job **não pede** — pede quando acaba. Trinta segundos é a
   * margem que não chama morto a um worker por causa de uma volta perdida; quem
   * está a processar continua a contar como ligado porque o heartbeat do job
   * também passa por aqui.
   */
  private static readonly JANELA_MS = 30_000;

  /** Um worker acabou de falar connosco. Chamado no claim e no heartbeat. */
  marcar(worker: string, kinds?: string[]): void {
    const antes = this.visto.get(worker);
    this.visto.set(worker, { at: Date.now(), kinds: kinds ?? antes?.kinds ?? [] });
  }

  /** Os que falaram há pouco. Os outros são esquecidos aqui mesmo. */
  online(): { name: string; kinds: string[] }[] {
    const limite = Date.now() - AiPresenceService.JANELA_MS;
    const vivos: { name: string; kinds: string[] }[] = [];
    for (const [name, dado] of this.visto) {
      if (dado.at >= limite) vivos.push({ name, kinds: dado.kinds });
      else this.visto.delete(name);
    }
    return vivos;
  }

  /**
   * O resumo que os ecrãs mostram.
   *
   * Nomes de máquina não saem daqui: são infra-estrutura nossa, não informação
   * do clube. O que interessa a quem espera é quantos há e o que sabem fazer.
   */
  resumo(): { online: number; kinds: string[] } {
    const vivos = this.online();
    return { online: vivos.length, kinds: [...new Set(vivos.flatMap((w) => w.kinds))] };
  }
}

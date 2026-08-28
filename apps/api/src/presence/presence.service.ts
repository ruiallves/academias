import { Injectable } from "@nestjs/common";
import type { Role } from "@prisma/client";

/**
 * Quem está a usar o produto **neste momento**, por clube.
 *
 * ## Porque é que isto não vive na base de dados
 *
 * `Membership.lastSeenAt` já existe e parece servir — mas responde a outra
 * pergunta. É escrito no arranque da app e no máximo de hora a hora, de
 * propósito: serve a pergunta *"esta família já cá entrou?"*, que não muda de
 * minuto a minuto. Alguém a trabalhar agora pode ter ali uma marca de há
 * cinquenta minutos, e alguém que fechou a app há meia hora tem uma de há dez.
 * Para "online agora" é ruído nos dois sentidos.
 *
 * Afinar aquela escrita para o minuto resolvia a precisão e criava um problema
 * pior: uma escrita por pessoa por minuto, em transacções que passam pelo
 * `runAs` — e o `connection_limit` deste produto é 5. Presença é a informação
 * mais efémera que há aqui; pagá-la com contenção no pool era trocar o que
 * importa pelo que é bonito de ter.
 *
 * Por isso vive num `Map` em memória. Custa uma escrita de mapa por pedido, não
 * toca no Postgres, e desaparece com o processo — que é exactamente o tempo de
 * vida da informação: ninguém está online num servidor que não está a correr.
 *
 * ## O que isto assume, e quando deixa de ser verdade
 *
 * **Um processo.** Com a API a correr em duas instâncias atrás de um balanceador,
 * cada uma vê só os seus pedidos e o número passa a ser um sub-total. No dia em
 * que isso acontecer, a substituição natural é um `SETEX` por membership no Redis
 * com o mesmo `JANELA` de expiração — a forma dos dados aqui foi escolhida para
 * que essa troca seja este ficheiro e mais nada.
 */

/**
 * Quanto tempo uma pessoa continua a contar como online depois do último sinal.
 *
 * O cliente bate à porta a cada 45 segundos enquanto o separador está à vista, e
 * a janela é mais do dobro disso: um sinal perdido — rede a oscilar, portátil a
 * acordar — não deve fazer alguém piscar para fora da lista e voltar.
 */
const JANELA = 120_000;

/** De quanto em quanto tempo se varre o que expirou. */
const LIMPEZA = 60_000;

type Marca = { academyId: string; role: Role; em: number };

@Injectable()
export class PresenceService {
  /**
   * Uma entrada por membership, não por utilizador.
   *
   * A mesma pessoa pode ser dirigente de um clube e pai noutro, e nesse caso está
   * online nos dois — são duas presenças diferentes, em duas academias
   * diferentes. Chavear por utilizador fazia-a aparecer só num, escolhido ao
   * calhas pelo último pedido.
   *
   * Dois separadores abertos do mesmo clube continuam a ser uma pessoa: a chave é
   * a mesma e a segunda marca só actualiza a hora.
   */
  private readonly marcas = new Map<string, Marca>();
  private ultimaLimpeza = Date.now();

  /** Chamado pelo guard a cada pedido autenticado, e pelo heartbeat. */
  marcar(membershipId: string, academyId: string, role: Role): void {
    this.marcas.set(membershipId, { academyId, role, em: Date.now() });
    this.talvezLimpar();
  }

  /**
   * Quem está online, por academia.
   *
   * Separa staff de família porque são leituras diferentes para quem vende o
   * produto: dez pais na app ao domingo é adopção, dez dirigentes na consola à
   * terça é uso. Um número só juntava as duas e não respondia a nenhuma.
   */
  porAcademia(): Map<string, { total: number; staff: number; family: number }> {
    const limite = Date.now() - JANELA;
    const out = new Map<string, { total: number; staff: number; family: number }>();

    for (const m of this.marcas.values()) {
      if (m.em < limite) continue;
      const linha = out.get(m.academyId) ?? { total: 0, staff: 0, family: 0 };
      linha.total++;
      if (m.role === "GUARDIAN" || m.role === "ATHLETE") linha.family++;
      else linha.staff++;
      out.set(m.academyId, linha);
    }

    return out;
  }

  /**
   * A varredura, pendurada nas escritas em vez de num temporizador.
   *
   * Um `setInterval` num serviço do Nest sobrevive aos testes e às fechaduras
   * graciosas do processo, e obriga a lembrar-se de o limpar no `onModuleDestroy`.
   * Como isto só cresce quando alguém escreve, varrer na escrita chega — e um
   * processo parado não tem nada para limpar.
   */
  private talvezLimpar(): void {
    const agora = Date.now();
    if (agora - this.ultimaLimpeza < LIMPEZA) return;
    this.ultimaLimpeza = agora;

    const limite = agora - JANELA;
    for (const [id, m] of this.marcas) {
      if (m.em < limite) this.marcas.delete(id);
    }
  }
}

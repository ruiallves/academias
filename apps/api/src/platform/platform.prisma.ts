import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Prisma, PrismaClient } from "@prisma/client";

/**
 * A ligação do painel da plataforma.
 *
 * ## Porque é que é uma ligação à parte
 *
 * A ligação normal do servidor entra como `academia_app`, e a migração
 * `20260816000600` retirou-lhe **todo** o acesso às tabelas da plataforma. Isso é
 * deliberado e é o que faz a separação valer alguma coisa: um pedido de academia
 * que tentasse ler `PlatformAdmin` — por engano ou por ataque — é recusado pelo
 * Postgres, não por um `if` que alguém se pode esquecer de escrever.
 *
 * Consequência: o painel não pode usar essa ligação. Usa esta.
 *
 * ## O que está por endurecer, e é preciso dizê-lo
 *
 * Esta ligação usa hoje as credenciais de administração da base
 * (`MIGRATE_DATABASE_URL`), que têm `BYPASSRLS`. Está injectada **só** no módulo
 * `platform` e não é exportada para lado nenhum — mas uma ligação com BYPASSRLS é
 * uma ligação com BYPASSRLS, e se algum dia for reutilizada fora daqui o
 * isolamento entre academias desaparece sem deixar rasto.
 *
 * O passo que falta antes de produção é um papel `platform_app` com privilégios
 * exactos: as cinco tabelas da plataforma, as funções de agregação, e escrita em
 * `Academy`/`StaffInvite` para a criação de clientes. Sem `BYPASSRLS`, porque o
 * painel não precisa dele — as leituras globais passam pelas funções
 * `SECURITY DEFINER`, que é precisamente o desenho para não precisar.
 *
 * Está registado em `docs/04-plataforma.md`.
 */
@Injectable()
export class PlatformPrisma extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({
      datasources: {
        db: { url: process.env.PLATFORM_DATABASE_URL ?? process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL },
      },
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  /* ------------------------------------------------------------------------ */

  /**
   * Corre uma leitura e sobrevive a um plano em cache que ficou velho.
   *
   * ## O que aconteceu em produção
   *
   * Uma migração acrescentou uma coluna ao `RETURNS TABLE` de
   * `app.platform_academies()`. As ligações que já estavam abertas continuaram a
   * ter o plano da forma antiga em cache, e o Postgres recusou-se a executá-lo
   * contra a função nova:
   *
   *     0A000 — cached plan must not change result type
   *
   * A partir daí a plataforma inteira ficou em erro: a visão geral e a lista de
   * academias passam ambas por aqui. E não passava sozinho — cada pedido apanhava
   * uma ligação do mesmo lote, com o mesmo plano velho.
   *
   * ## Porque é que repetir não chega
   *
   * Porque o Postgres **não** deita fora o plano ao falhar: a mesma declaração
   * preparada volta a dar o mesmo erro, indefinidamente. Confirmado com o cliente
   * `pg` e com o Prisma — a segunda tentativa falha exactamente como a primeira.
   * O que resolve é fechar a ligação: a seguinte prepara tudo de novo.
   *
   * ## O custo, dito por inteiro
   *
   * `$disconnect()` derruba **todas** as ligações deste cliente, incluindo as de
   * pedidos a decorrer ao lado. É agressivo, e é aceitável por duas razões: só
   * acontece nos segundos a seguir a um deploy que mude a forma de uma função, e
   * a alternativa é uma página de administração que fica partida até alguém
   * reiniciar o servidor à mão. Uma reconexão de mais é melhor do que um painel
   * de menos.
   *
   * A reconexão é partilhada: dez pedidos a falhar ao mesmo tempo fazem **uma**
   * reconexão, não dez.
   */
  private aReconectar: Promise<void> | null = null;

  async resiliente<T>(trabalho: () => Promise<T>): Promise<T> {
    try {
      return await trabalho();
    } catch (erro) {
      if (!planoVelho(erro)) throw erro;

      this.logger.warn("Plano em cache desactualizado (0A000) — a reconectar à base");
      this.aReconectar ??= (async () => {
        try {
          await this.$disconnect();
          await this.$connect();
        } finally {
          this.aReconectar = null;
        }
      })();
      await this.aReconectar;

      // Uma vez só. Se voltar a falhar, o problema não é o plano em cache e o
      // erro tem de subir em vez de entrar em ciclo.
      return trabalho();
    }
  }

  private readonly logger = new Logger(PlatformPrisma.name);
}

/**
 * O erro do plano velho, e só esse.
 *
 * `P2010` é "a consulta em bruto falhou" e cobre meio mundo — a distinção está no
 * `SQLSTATE` que vem em `meta`. Alargar isto a todos os `P2010` fazia com que uma
 * consulta com um erro de sintaxe reconectasse a base e voltasse a falhar.
 */
function planoVelho(erro: unknown): boolean {
  return (
    erro instanceof Prisma.PrismaClientKnownRequestError &&
    erro.code === "P2010" &&
    (erro.meta as { code?: string } | undefined)?.code === "0A000"
  );
}

import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

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
}

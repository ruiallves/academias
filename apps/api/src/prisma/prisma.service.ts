import { AsyncLocalStorage } from "node:async_hooks";
import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

/**
 * Cliente Prisma com isolamento de tenant.
 *
 * Duas camadas, e as duas são precisas:
 *
 *  1. **RLS no Postgres** — `SET LOCAL app.academy_id` dentro de uma transação faz
 *     as políticas da migração `20260816000100_rls` filtrarem tudo. É a camada que
 *     apanha um serviço que se esqueça do filtro. Verificada em
 *     `scripts/test-rls.mjs`, contra Postgres a sério, com testes que tentam
 *     activamente ler e escrever noutra academia.
 *  2. **Filtro na aplicação** — a extensão abaixo injecta `academyId` nas queries.
 *     Não substitui a RLS; preenche o `academyId` nos `create` (que o `WITH CHECK`
 *     recusaria em branco) e torna os erros óbvios em desenvolvimento.
 *
 * ## Porquê uma transação por pedido
 *
 * `SET LOCAL` morre no fim da transação. É isso que torna o contexto seguro com um
 * pool: a ligação devolvida ao pool não leva o tenant do pedido anterior. Um `SET`
 * normal ficaria colado à ligação, e o pedido seguinte — de outra academia —
 * herdava-o. Esse é o bug que este desenho existe para tornar impossível.
 *
 * ## Porquê AsyncLocalStorage
 *
 * A extensão precisa de saber o tenant, e `$extends` **não existe dentro** de uma
 * transação — a ordem tem de ser "estender, depois transacionar". Estender por
 * pedido criaria um cliente novo a cada chamada; em vez disso estende-se uma vez
 * no arranque e o tenant viaja no contexto assíncrono.
 *
 * ## O que falta para produção
 *
 * `DATABASE_URL` tem de ligar-se como `academia_app`, não como `postgres`. O
 * utilizador por omissão do Supabase é superutilizador e **ignora RLS** — as
 * políticas ficariam lá, sem nunca correr. Ver o cabeçalho da migração.
 */

type TenantContext = { academyId: string };

const tenant = new AsyncLocalStorage<TenantContext>();

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  /** Estendido uma vez, no arranque. O tenant vem do contexto assíncrono. */
  readonly scoped = this.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const ctx = tenant.getStore();
          // Sem contexto não se relaxa nada: a RLS bloqueia na mesma, e é ela a
          // garantia. Aqui só se evita injectar um `undefined` na query.
          if (!ctx || !TENANT_SCOPED.has(model)) return query(args);

          const a = args as Record<string, unknown>;

          if (READ_OPS.has(operation)) {
            a.where = { ...((a.where as object) ?? {}), academyId: ctx.academyId };
          }

          if (operation === "create") {
            a.data = { ...((a.data as object) ?? {}), academyId: ctx.academyId };
          }

          if (operation === "createMany") {
            const data = a.data as Record<string, unknown> | Record<string, unknown>[];
            a.data = Array.isArray(data)
              ? data.map((row) => ({ ...row, academyId: ctx.academyId }))
              : { ...data, academyId: ctx.academyId };
          }

          return query(a);
        },
      },
    },
  });

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  /**
   * Corre `work` no contexto de uma academia.
   *
   * Tudo o que toque em dados de domínio passa por aqui. O cliente que `work`
   * recebe já tem RLS activa e o filtro de aplicação injectado.
   */
  runAs<T>(academyId: string, work: (db: ScopedClient) => Promise<T>): Promise<T> {
    return tenant.run({ academyId }, () =>
      this.scoped.$transaction(async (tx) => {
        // `set_config(..., true)` = LOCAL. Parametrizado, nunca interpolado: um
        // academyId vindo de um JWT não pode virar SQL.
        await tx.$executeRaw`SELECT set_config('app.academy_id', ${academyId}, true)`;
        return work(tx as ScopedClient);
      }),
    );
  }

  /**
   * Descobre a que academia pertence uma referência de pagamento.
   *
   * O webhook da euPago chega sem tenant — é o pagamento que o identifica. Esta é
   * a única leitura do sistema fora de um contexto de academia, e passa por uma
   * função `SECURITY DEFINER` que só sabe devolver um id: nem o pagamento, nem o
   * valor, nem nada mais. Ver a migração de RLS.
   */
  async resolvePaymentAcademy(provider: string, providerRef: string): Promise<string | null> {
    const rows = await this.$queryRaw<{ academy: string | null }[]>`
      SELECT app.resolve_payment_academy(${provider}, ${providerRef}) AS academy
    `;
    return rows[0]?.academy ?? null;
  }
}

/** O cliente que os serviços recebem dentro de `runAs`. */
export type ScopedClient = Parameters<Parameters<PrismaService["scoped"]["$transaction"]>[0]>[0];

/**
 * Modelos com `academyId` próprio.
 *
 * Os que faltam são globais de propósito (`User`, `PushSubscription`,
 * `WebhookEvent`) ou herdam o tenant do pai — e nesses a RLS trata do filtro por
 * junção, que a aplicação não conseguiria injectar sem saber o caminho até ao pai.
 */
const TENANT_SCOPED = new Set<string>([
  "Sport",
  "Season",
  "Membership",
  "DirectDebitMandate",
  "StaffInvite",
  "Athlete",
  "Team",
  "TrainingSession",
  "Match",
  "CalendarEvent",
  "SubscriptionPlan",
  "Charge",
  "Announcement",
  "Notification",
  "Evaluation",
  "ClinicalEntry",
  // Scouting. `ProspectEvent` e `ObservationRating` ficam de fora — herdam o
  // tenant do pai, e a RLS trata-os por junção.
  "Prospect",
  "Observation",
  "ScoutCriterion",
  "Shortlist",
  "ScoutingRequest",
  "FitDimension",
  "ProspectVideo",
  "MemberTier",
  "Member",
  "CatalogItem",
  // Inventário. As quatro têm `academyId` próprio — incluindo a variante, que
  // podia tê-lo herdado do artigo: uma tabela protegida por junção é uma tabela
  // cuja política um dia se esquece de escrever.
  "InventoryItem",
  "InventoryVariant",
  "InventoryAssignment",
  "InventoryMovement",
  // Contas. Dinheiro é a última coisa que pode atravessar clubes.
  "FinancialTransaction",
  "FinanceSettings",
  "FinancialBudget",
]);

/**
 * `findUnique` está deliberadamente fora desta lista.
 *
 * O seu `where` só aceita campos únicos, e acrescentar-lhe `academyId` faz o Prisma
 * rejeitar a query. A regra do projecto é simples: **nos serviços usa-se sempre
 * `findFirst`**, nunca `findUnique`. A RLS apanha o resto.
 */
const READ_OPS = new Set<string>([
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "update",
  "updateMany",
  "delete",
  "deleteMany",
  "count",
  "aggregate",
]);

import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { Role } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import type { Permission, RequestContext, Scope } from "../common/permissions";

type MembershipRow = {
  membership_id: string;
  academy_id: string;
  academy_slug: string;
  academy_name: string;
  role: Role;
  user_id: string;
};

/**
 * Constrói o contexto de um pedido a partir de uma identidade do Supabase.
 *
 * A ordem importa e não é arbitrária:
 *
 *   1. do subdomínio sai o **slug**;
 *   2. do slug sai o **academyId** — por uma função estreita, porque a RLS ainda
 *      não pode estar activa (ver a migração `20260816000200_auth_resolvers`);
 *   3. do `authId` + academyId sai a **membership**, que decide papel e âmbito;
 *   4. só então se abre o contexto de tenant e tudo o resto passa pela RLS.
 *
 * Um utilizador sem membership nesta academia é 403, não 404: a academia existe,
 * ele é que não pertence. Fingir que não existe daria a mesma resposta a "não
 * pertences" e a "não existe", e isso torna o produto difícil de depurar sem
 * proteger nada — o slug já é público, está no URL.
 */
/**
 * De que lado do produto vem o pedido.
 *
 * Não é uma permissão — é uma **desambiguação**. Quem envia isto continua a
 * precisar de uma membership; o cabeçalho só diz qual das que já tem é que se
 * aplica agora. Ver `escolherMembership`.
 */
export type AppKind = "family" | "console";

/**
 * Qual das memberships desta pessoa nesta academia é que vale para este pedido.
 *
 * ## O bug que isto fecha
 *
 * Era `memberships.find(m => m.academy_id === academyId)` — **a primeira**. Numa
 * academia onde a mesma pessoa é treinador *e* pai (o caso mais banal que há num
 * clube de futebol), qual das duas ganhava dependia da ordem que a base
 * devolvesse. Se ganhasse a de treinador, a app da família abria com o âmbito de
 * treinador: `athleteScopeFilter` deixa de filtrar, `/api/athletes` devolve o
 * plantel inteiro, e a app — que trata essa lista como "os meus filhos" — mostra
 * o escalão todo como filhos daquele pai.
 *
 * ## A regra
 *
 * A app da família **exige** um vínculo de família. Não o encontrando, recusa em
 * vez de servir o outro: é a app que apresenta os dados como sendo dos filhos de
 * quem está a ver, e servir-lhe o chapéu errado é um problema de privacidade, não
 * de conveniência.
 *
 * A consola **prefere** o vínculo de staff, mas aceita o outro — quem lá chega vê
 * os ecrãs que as suas permissões deixarem, e não há nada a apresentar como
 * sendo de outra pessoa.
 */
function escolherMembership(memberships: MembershipRow[], app?: AppKind): MembershipRow {
  const familia = (role: Role) => role === "GUARDIAN" || role === "ATHLETE";

  if (app === "family") {
    const daFamilia = memberships.find((m) => familia(m.role));
    if (!daFamilia) {
      throw new ForbiddenException("Esta conta não é de encarregado nesta academia.");
    }
    return daFamilia;
  }

  if (app === "console") return memberships.find((m) => !familia(m.role)) ?? memberships[0];

  // Sem cabeçalho — uma app antiga ainda em cache. Fica o que já ficava.
  return memberships[0];
}

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  /** As academias onde esta pessoa trabalha ou tem filhos. */
  async membershipsOf(authId: string): Promise<MembershipRow[]> {
    return this.prisma.$queryRaw<MembershipRow[]>`
      SELECT * FROM app.resolve_memberships(${authId})
    `;
  }

  async academyIdBySlug(slug: string): Promise<string | null> {
    const rows = await this.prisma.$queryRaw<{ id: string | null }[]>`
      SELECT app.resolve_academy_by_slug(${slug}) AS id
    `;
    return rows[0]?.id ?? null;
  }

  /**
   * O contexto completo de um pedido.
   *
   * `scope` é derivado a cada pedido a partir de `TeamStaff` e `GuardianLink`, e
   * não lido de `Membership.scope`. É mais caro e é deliberado: uma cópia
   * guardada desactualiza-se quando um treinador muda de equipa, e a partir daí o
   * âmbito protege as equipas erradas — em silêncio.
   *
   * ## Porque é que isto corre aos pares, e não em fila
   *
   * São quatro idas à base de dados, e este método corre em **todos** os pedidos
   * autenticados da aplicação — é o preço de entrada antes de qualquer serviço
   * fazer seja o que for. Uma medição directa mostrou-o a custar cerca de 1,2s em
   * fila, contra ~300ms por ida ao pooler do Supabase; era o maior peso a
   * arrastar a lentidão notada em "Convidar de outro escalão" e em qualquer outro
   * ecrã, não uma coisa específica das convocatórias.
   *
   * `academyIdBySlug` e `membershipsOf` não dependem uma da outra — a primeira só
   * precisa do slug, a segunda só do `authId`. `scopeFor` e `exceptionsFor`, depois
   * de se saber a academia e a membership, também não dependem uma da outra. Correr
   * cada par com `Promise.all` sobrepõe a latência de rede em vez de a somar, e
   * corta o tempo de fila a meio sem mudar nada do que cada função devolve.
   *
   * ## Duas transacções, e não uma partilhada
   *
   * Parece desperdício: `scopeFor` e `exceptionsFor` são da mesma academia e
   * podiam correr as duas consultas dentro de um `runAs` só, poupando um BEGIN e
   * um COMMIT. Foi tentado e **é mais lento** — 336 ms contra 275 ms, medido
   * contra o pooler do Supabase.
   *
   * A razão é o protocolo: duas consultas na mesma ligação são servidas em fila,
   * por muito `Promise.all` que se lhes ponha à volta. Em transacções separadas
   * vão por ligações diferentes e sobrepõem-se de verdade — e as duas idas
   * sobrepostas custam menos do que duas consultas em fila numa só.
   *
   * O preço são duas das cinco ligações do pool ocupadas ao mesmo tempo. Se
   * alguma vez o pool for o aperto, é aqui que se troca latência por ligações —
   * com uma medição nova, não por parecer mais arrumado.
   */
  async contextFor(authId: string, slug: string, app?: AppKind): Promise<RequestContext> {
    const [academyId, memberships] = await Promise.all([this.academyIdBySlug(slug), this.membershipsOf(authId)]);
    if (!academyId) throw new NotFoundException(`Academia "${slug}" não encontrada`);

    const daAcademia = memberships.filter((m) => m.academy_id === academyId);
    if (daAcademia.length === 0) throw new ForbiddenException("Sem acesso a esta academia");

    const membership = escolherMembership(daAcademia, app);

    const [scope, exceptions] = await Promise.all([
      this.scopeFor(academyId, membership.membership_id, membership.role),
      this.exceptionsFor(academyId, membership.membership_id),
    ]);

    return {
      userId: membership.user_id,
      academyId,
      membershipId: membership.membership_id,
      role: membership.role,
      grants: exceptions.grants,
      revokes: exceptions.revokes,
      rolePermissions: exceptions.rolePermissions,
      roleId: exceptions.roleId,
      roleName: exceptions.roleName,
      navKeys: exceptions.navKeys,
      scope,
    };
  }

  /**
   * O papel desta pessoa e as excepções por cima dele.
   *
   * Lê-se a cada pedido, na mesma ida à base que já se fazia pelas excepções — um
   * papel editado às 10h vale às 10h01 para toda a gente que o veste, sem esperar
   * por nova sessão. Uma cópia guardada no token seria mais barata e teria o
   * problema clássico: acesso retirado que continua a valer até ao logout.
   *
   * Um papel arquivado não conta: cai-se nos valores por omissão do papel-base, e
   * não numa lista vazia. Ficar sem permissão nenhuma por alguém ter arquivado um
   * papel seria uma pessoa trancada fora do produto sem ninguém perceber porquê.
   */
  private async exceptionsFor(
    academyId: string,
    membershipId: string,
  ): Promise<{
    grants: Permission[];
    revokes: Permission[];
    rolePermissions: Permission[] | null;
    roleId: string | null;
    roleName: string | null;
    navKeys: string[];
  }> {
    return this.prisma.runAs(academyId, async (db) => {
      const m = await db.membership.findFirst({
        where: { id: membershipId },
        select: {
          grants: true,
          revokes: true,
          customRole: {
            select: { id: true, name: true, permissions: true, navKeys: true, archivedAt: true },
          },
        },
      });

      const role = m?.customRole && !m.customRole.archivedAt ? m.customRole : null;

      return {
        grants: (m?.grants ?? []) as Permission[],
        revokes: (m?.revokes ?? []) as Permission[],
        rolePermissions: role ? (role.permissions as Permission[]) : null,
        roleId: role?.id ?? null,
        roleName: role?.name ?? null,
        navKeys: role?.navKeys ?? [],
      };
    });
  }

  private async scopeFor(academyId: string, membershipId: string, role: Role): Promise<Scope> {
    return this.prisma.runAs(academyId, async (db) => {
      if (role === "COACH" || role === "STAFF") {
        const staffOf = await db.teamStaff.findMany({
          where: { membershipId },
          select: { teamId: true },
        });
        return { teamIds: staffOf.map((t) => t.teamId) };
      }

      if (role === "GUARDIAN" || role === "ATHLETE") {
        const links = await db.guardianLink.findMany({
          where: { membershipId },
          select: { athleteId: true },
        });
        const athleteIds = links.map((l) => l.athleteId);

        /*
         * Uma família tem **dois** âmbitos, e são coisas diferentes.
         *
         * `athleteIds` são os filhos: é por aqui que se filtra tudo o que é
         * pessoal — a ficha, as mensalidades, as avaliações. `teamIds` são as
         * equipas onde eles jogam, e servem para o que é **do grupo**: o horário
         * dos treinos, os jogos, o calendário. Sem os segundos, a agenda da app
         * do pai vinha vazia; sem os primeiros a filtrar por cima, o pai via a
         * lista completa dos colegas do filho.
         *
         * Quem lê dados pessoais cruza sempre os dois — ver `athletes()` e
         * `charges()`, que aplicam o filtro de atleta por cima do de equipa.
         */
        const memberships = athleteIds.length
          ? await db.teamMembership.findMany({
              where: { athleteId: { in: athleteIds } },
              select: { teamId: true },
            })
          : [];

        return { athleteIds, teamIds: [...new Set(memberships.map((m) => m.teamId))] };
      }

      // Direção e departamento clínico vêem a academia toda — sem âmbito.
      return {};
    });
  }
}

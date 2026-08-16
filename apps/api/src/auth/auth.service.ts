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
   */
  async contextFor(authId: string, slug: string): Promise<RequestContext> {
    const academyId = await this.academyIdBySlug(slug);
    if (!academyId) throw new NotFoundException(`Academia "${slug}" não encontrada`);

    const membership = (await this.membershipsOf(authId)).find((m) => m.academy_id === academyId);
    if (!membership) throw new ForbiddenException("Sem acesso a esta academia");

    const scope = await this.scopeFor(academyId, membership.membership_id, membership.role);

    return {
      userId: membership.user_id,
      academyId,
      membershipId: membership.membership_id,
      role: membership.role,
      grants: await this.grantsFor(academyId, membership.membership_id),
      scope,
    };
  }

  private async grantsFor(academyId: string, membershipId: string): Promise<Permission[]> {
    return this.prisma.runAs(academyId, async (db) => {
      const m = await db.membership.findFirst({
        where: { id: membershipId },
        select: { grants: true },
      });
      return (m?.grants ?? []) as Permission[];
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
        return { athleteIds: links.map((l) => l.athleteId) };
      }

      // Direção e departamento clínico vêem a academia toda — sem âmbito.
      return {};
    });
  }
}

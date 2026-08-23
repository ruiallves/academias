import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { Role } from "@prisma/client";
import { PrismaService, type ScopedClient } from "../prisma/prisma.service";
import { NAV_KEYS, isNavKey } from "../common/nav";
import { ROLE_PERMISSIONS, can, type Permission, type RequestContext } from "../common/permissions";

/**
 * Papéis da academia.
 *
 * O que este serviço existe para permitir: a presidência cria um papel, escolhe o
 * que ele pode e que menus mostra, e delega esse poder — sem um deploy pelo meio.
 *
 * ## As regras de escalada, todas num sítio
 *
 * Uma tabela de permissões editável pelo cliente é a superfície mais perigosa do
 * produto: quem lá escreve escreve o que os outros podem fazer. Cinco regras, e
 * nenhuma delas está na interface — todas estão aqui:
 *
 *  1. **Só se concede o que se tem.** As permissões pedidas são filtradas por
 *     `can(ctx, p)`. É a mesma regra que `AcademyService.filterDelegatable` já
 *     aplica às excepções por pessoa, e pela mesma razão.
 *  2. **Ninguém edita o papel que veste.** Gémea de "não podes alterar o teu
 *     próprio acesso": sem ela, quem tivesse `role:write` dava-se tudo em dois
 *     cliques, e a auditoria não teria sequer um terceiro a quem perguntar.
 *  3. **O papel do presidente é imutável.** É o fecho da porta por dentro: se
 *     alguém lhe pudesse tirar permissões, uma academia podia trancar-se fora do
 *     próprio produto sem ninguém com poder para a reabrir.
 *  4. **Não se cria acima de si.** O `rank` do papel-base nunca ultrapassa o de
 *     quem cria — o mesmo ranking que já trava os convites.
 *  5. **Menus não são segurança.** `navKeys` nunca entra numa decisão deste
 *     servidor. Só se valida que as chaves existem e que o papel tem a permissão
 *     que as tornaria visíveis, para a configuração não prometer um menu que
 *     nunca apareceria.
 */

/** Espelha o RANK dos convites. Duplicá-lo é pior do que importá-lo; ver abaixo. */
const RANK: Record<Role, number> = {
  OWNER: 100,
  DIRECTOR: 80,
  COORDINATOR: 60,
  MEDICAL: 40,
  SCOUT: 40,
  COACH: 40,
  STAFF: 20,
  GUARDIAN: 0,
  ATHLETE: 0,
};

/** Papéis-base que um papel de academia pode ter. Família nunca. */
const STAFF_BASES: Role[] = ["OWNER", "DIRECTOR", "COORDINATOR", "COACH", "STAFF", "MEDICAL", "SCOUT"];

/**
 * Os cinco obrigatórios, semeados por academia à primeira leitura.
 *
 * Semeados a partir de `ROLE_PERMISSIONS` e não de uma segunda lista: o mapa em
 * código deixa de ser a verdade e passa a ser o **ponto de partida**. Assim a
 * academia abre o ecrã já com o que sempre teve, e edita a partir daí em vez de
 * começar em branco.
 */
const SYSTEM_ROLES: { key: string; name: string; description: string; baseRole: Role; navKeys?: string[] }[] = [
  {
    key: "presidente",
    name: "Presidente",
    description: "Responde por tudo. É o único papel que não se pode editar nem apagar.",
    baseRole: "OWNER",
  },
  {
    key: "direcao",
    name: "Direção",
    description: "Gestão corrente da academia: atletas, equipas, mensalidades e comunicação.",
    baseRole: "DIRECTOR",
  },
  {
    key: "treinador",
    name: "Treinador",
    description: "As suas equipas: treinos, presenças, convocatórias e avaliações.",
    baseRole: "COACH",
  },
  {
    key: "dep-medico",
    name: "Dep. Médico",
    description: "Boletim clínico de toda a academia. Sem mensalidades nem avaliações desportivas.",
    baseRole: "MEDICAL",
    /*
     * O único papel semeado com menus escolhidos à mão.
     *
     * O departamento clínico tem `calendar:read` — precisa de saber quando é o
     * treino de quem está a recuperar — e isso, sozinho, faria aparecer-lhe
     * "Convocatórias", que não é trabalho dele. Antes isto resolvia-se por o
     * menu clínico ser um array separado; agora resolve-se com a funcionalidade
     * nova, que é o que ela existe para fazer.
     */
    navKeys: ["overview", "clinical", "consultations", "athletes", "teams", "calendar"],
  },
  {
    key: "dep-scouting",
    name: "Dep. Scouting",
    description: "Prospectos, observações e vídeo. Sem ficha clínica, mensalidades ou famílias.",
    baseRole: "SCOUT",
  },
];

export type RoleInput = {
  name: string;
  description?: string | null;
  baseRole: Role;
  permissions: string[];
};

@Injectable()
export class RolesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Os papéis desta academia, com quantas pessoas cada um tem.
   *
   * Semeia os obrigatórios se ainda não existirem. Semear à leitura e não numa
   * migração de dados é o que faz isto valer para as academias que já existem —
   * uma migração só apanharia as linhas do dia em que corresse, e as academias
   * criadas depois voltavam a nascer sem papéis.
   */
  async list(ctx: RequestContext) {
    if (!can(ctx, "staff:read")) throw new ForbiddenException("Sem acesso ao staff");

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const existing = await db.academyRole.count();
      if (existing === 0) {
        await db.academyRole.createMany({
          data: SYSTEM_ROLES.map((r) => ({
            academyId: ctx.academyId,
            key: r.key,
            name: r.name,
            description: r.description,
            baseRole: r.baseRole,
            permissions: ROLE_PERMISSIONS[r.baseRole],
            navKeys: r.navKeys ?? [],
            isSystem: true,
            rank: RANK[r.baseRole],
            updatedAt: new Date(),
          })),
          skipDuplicates: true,
        });
      }

      const roles = await db.academyRole.findMany({
        where: { archivedAt: null },
        orderBy: [{ rank: "desc" }, { name: "asc" }],
        select: {
          id: true, key: true, name: true, description: true, baseRole: true,
          permissions: true, navKeys: true, isSystem: true, rank: true,
          _count: { select: { memberships: true } },
        },
      });

      return roles.map((r) => ({
        id: r.id,
        key: r.key,
        name: r.name,
        description: r.description,
        baseRole: r.baseRole,
        permissions: r.permissions,
        navKeys: r.navKeys,
        isSystem: r.isSystem,
        rank: r.rank,
        people: r._count.memberships,
        /** O que **este** utilizador pode fazer a este papel. A UI não recalcula. */
        editable: this.mayEdit(ctx, { id: r.id, key: r.key, rank: r.rank }),
      }));
    });
  }

  async create(ctx: RequestContext, input: RoleInput) {
    if (!can(ctx, "role:write")) throw new ForbiddenException("Sem permissão para criar papéis");

    const name = input.name.trim();
    if (name.length < 2) throw new BadRequestException("Falta o nome do papel");
    if (!STAFF_BASES.includes(input.baseRole)) throw new BadRequestException("Papel-base inválido");
    if (RANK[input.baseRole] > RANK[ctx.role]) {
      throw new ForbiddenException("Não podes criar um papel com mais acesso do que tu");
    }

    const permissions = this.filterGrantable(ctx, input.permissions);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const key = await this.freeKey(db, slugify(name));
      const role = await db.academyRole.create({
        data: {
          academyId: ctx.academyId,
          key,
          name,
          description: input.description?.trim() || null,
          baseRole: input.baseRole,
          permissions,
          navKeys: [],
          isSystem: false,
          rank: RANK[input.baseRole],
          updatedAt: new Date(),
        },
        select: { id: true, key: true, name: true },
      });
      return role;
    });
  }

  async update(ctx: RequestContext, id: string, input: Partial<RoleInput>) {
    if (!can(ctx, "role:write")) throw new ForbiddenException("Sem permissão para editar papéis");

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const role = await this.mustFind(db, id);
      this.assertMayEdit(ctx, role);

      const data: Record<string, unknown> = { updatedAt: new Date() };

      if (input.name !== undefined) {
        const name = input.name.trim();
        if (name.length < 2) throw new BadRequestException("Falta o nome do papel");
        data.name = name;
      }
      if (input.description !== undefined) data.description = input.description?.trim() || null;
      if (input.permissions !== undefined) data.permissions = this.filterGrantable(ctx, input.permissions);

      /*
       * O papel-base não se muda depois de criado.
       *
       * Mudá-lo mudaria de onde vem o âmbito de toda a gente que o veste — um
       * "Treinador" que passasse a base DIRECTOR deixava de estar limitado às
       * equipas dele, em silêncio e sem ninguém tocar em pessoa nenhuma. Quem
       * precisa de outro âmbito cria outro papel e move lá as pessoas, que é uma
       * acção visível.
       */

      await db.academyRole.update({ where: { id }, data });
      return { ok: true };
    });
  }

  /**
   * Que menus este papel mostra.
   *
   * Permissão à parte (`role:menu`) e endpoint à parte de propósito: quem
   * reorganiza menus não passa a mexer em permissões pelo mesmo caminho.
   */
  async setNav(ctx: RequestContext, id: string, navKeys: string[]) {
    if (!can(ctx, "role:menu")) throw new ForbiddenException("Sem permissão para configurar menus");

    const unknown = navKeys.filter((k) => !isNavKey(k));
    if (unknown.length) throw new BadRequestException(`Menu desconhecido: ${unknown[0]}`);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const role = await this.mustFind(db, id);
      if (role.key === "presidente") throw new ForbiddenException("O papel do presidente não se configura");

      // Guardar "mostra Mensalidades" num papel sem `billing:read` seria guardar
      // uma promessa que a navegação nunca cumpre. Recusa-se aqui, e a UI já o
      // explica antes de deixar marcar.
      const held = new Set(role.permissions);
      const impossible = navKeys.filter((k) => !held.has(NAV_KEYS[k]));
      if (impossible.length) {
        throw new BadRequestException(`"${impossible[0]}" precisa de uma permissão que este papel não tem`);
      }

      await db.academyRole.update({ where: { id }, data: { navKeys, updatedAt: new Date() } });
      return { ok: true };
    });
  }

  /**
   * Arquivar.
   *
   * Nunca apagar: as memberships apontam para aqui, e um papel apagado deixava
   * pessoas com um acesso que ninguém consegue explicar depois. Arquivado não
   * conta em `contextFor` — quem o vestia cai nos valores do papel-base, que é a
   * degradação segura.
   */
  async archive(ctx: RequestContext, id: string) {
    if (!can(ctx, "role:write")) throw new ForbiddenException("Sem permissão para editar papéis");

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const role = await this.mustFind(db, id);
      if (role.isSystem) throw new ForbiddenException("Os papéis de origem não se apagam");
      this.assertMayEdit(ctx, role);

      const people = await db.membership.count({ where: { customRoleId: id } });
      if (people > 0) {
        throw new BadRequestException(`Ainda há ${people} ${people === 1 ? "pessoa" : "pessoas"} com este papel`);
      }

      await db.academyRole.update({ where: { id }, data: { archivedAt: new Date(), updatedAt: new Date() } });
      return { ok: true };
    });
  }

  /**
   * Dar um papel a uma pessoa.
   *
   * Escreve **as duas** colunas: `customRoleId` e `role`. O enum tem de seguir o
   * papel-base, senão uma pessoa com o papel "Dep. Scouting" continuava a derivar
   * o âmbito como treinador — e o âmbito é o que a impede de ver o que não é dela.
   */
  async assign(ctx: RequestContext, membershipId: string, roleId: string | null) {
    if (!can(ctx, "access:write")) throw new ForbiddenException("Sem permissão para gerir acessos");
    if (membershipId === ctx.membershipId) throw new BadRequestException("Não podes alterar o teu próprio papel");

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const target = await db.membership.findFirst({
        where: { id: membershipId, role: { notIn: ["GUARDIAN", "ATHLETE"] } },
        select: { id: true, role: true },
      });
      if (!target) throw new NotFoundException("Pessoa não encontrada");

      if (roleId === null) {
        await db.membership.update({ where: { id: membershipId }, data: { customRoleId: null } });
        return { ok: true };
      }

      const role = await this.mustFind(db, roleId);
      if (role.rank > RANK[ctx.role]) {
        throw new ForbiddenException("Não podes dar um papel com mais acesso do que o teu");
      }

      await db.membership.update({
        where: { id: membershipId },
        data: { customRoleId: roleId, role: role.baseRole },
      });
      return { ok: true };
    });
  }

  /* ------------------------------------------------------------------------ */

  private async mustFind(db: ScopedClient, id: string) {
    const role = await db.academyRole.findFirst({
      where: { id, archivedAt: null },
      select: { id: true, key: true, name: true, baseRole: true, permissions: true, isSystem: true, rank: true },
    });
    if (!role) throw new NotFoundException("Papel não encontrado");
    return role;
  }

  /** Regras 2, 3 e 4, num sítio só. */
  private mayEdit(ctx: RequestContext, role: { id: string; key: string; rank: number }): boolean {
    if (!can(ctx, "role:write")) return false;
    if (role.key === "presidente") return false;
    if (ctx.roleId === role.id) return false;
    return role.rank <= RANK[ctx.role];
  }

  private assertMayEdit(ctx: RequestContext, role: { id: string; key: string; rank: number }) {
    if (role.key === "presidente") throw new ForbiddenException("O papel do presidente não se edita");
    if (ctx.roleId === role.id) throw new ForbiddenException("Não podes editar o papel que tens");
    if (role.rank > RANK[ctx.role]) throw new ForbiddenException("Esse papel está acima do teu");
  }

  /** Regra 1: só o que é permissão a sério **e** que quem grava também tem. */
  private filterGrantable(ctx: RequestContext, permissions: string[]): Permission[] {
    const known = new Set<string>(Object.values(ROLE_PERMISSIONS).flat());
    return [...new Set(permissions)]
      .filter((p): p is Permission => known.has(p))
      .filter((p) => can(ctx, p));
  }

  private async freeKey(db: ScopedClient, base: string): Promise<string> {
    for (let i = 0; i < 50; i++) {
      const key = i === 0 ? base : `${base}-${i + 1}`;
      const taken = await db.academyRole.findFirst({ where: { key }, select: { id: true } });
      if (!taken) return key;
    }
    return `${base}-${Date.now()}`;
  }
}

function slugify(name: string): string {
  return (
    name
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "papel"
  );
}

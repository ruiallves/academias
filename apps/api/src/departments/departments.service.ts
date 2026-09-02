import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { Role } from "@prisma/client";
import { PrismaService, type ScopedClient } from "../prisma/prisma.service";
import { isNavKey } from "../common/nav";
import { ROLE_PERMISSIONS, can, type Permission, type RequestContext } from "../common/permissions";
import { semearCargosEmFalta } from "./first-role";

/**
 * Departamentos da academia.
 *
 * ## Porque é que isto existe
 *
 * Porque a pergunta "quem vê o quê" estava a ser feita no sítio errado. O ecrã de
 * criar um cargo perguntava **Âmbito** — se aquela pessoa via o clube todo ou só
 * as equipas dela — e ninguém percebia a pergunta. Com razão: não é uma pergunta
 * sobre o cargo. "A equipa técnica vê só as suas equipas" é uma decisão sobre o
 * *departamento*, tomada uma vez, e não uma pergunta a repetir a cada
 * fisioterapeuta que se contrata.
 *
 * Agora há dois ecrãs, e cada um faz uma pergunta que se entende:
 *
 *  - **Departamento**: o que é que esta área do clube vê e faz? (âmbito,
 *    permissões, menus)
 *  - **Cargo**: e esta pessoa, dentro dessa área, tem alguma coisa a mais ou a
 *    menos? (parte do departamento e ajusta-se)
 *
 * ## O cargo copia, não aponta
 *
 * Quando um cargo nasce dentro de um departamento, copia as permissões dele. Não
 * fica a apontar. Duas razões, e a segunda é a que decide:
 *
 *  1. Resolver a herança na leitura punha um `JOIN` no caminho mais quente do
 *     servidor — `can()` corre em cada pedido.
 *  2. Editar um departamento passaria a mudar, em silêncio, o que dezenas de
 *     pessoas podem fazer. Uma tabela de permissões não deve ter efeitos a essa
 *     distância. Quem edita um departamento vê quantos cargos herdaram dele e
 *     escolhe se os actualiza (`applyToRoles`) — é um gesto, não um efeito.
 *
 * ## As regras de escalada
 *
 * As mesmas de `RolesService`, e pela mesma razão: isto escreve o que os outros
 * podem fazer. Só se concede o que se tem, e não se cria um departamento com mais
 * âmbito do que quem o cria.
 */

/** Espelha o RANK dos papéis e dos convites. Ver a nota em `RolesService`. */
const RANK: Record<Role, number> = {
  OWNER: 100,
  DIRECTOR: 80,
  COORDINATOR: 60,
  COACH: 40,
  MEDICAL: 40,
  SCOUT: 40,
  STAFF: 20,
  GUARDIAN: 0,
  ATHLETE: 0,
};

/** Os âmbitos que um departamento pode ter. `GUARDIAN` é família, não staff. */
const SCOPES: Role[] = ["DIRECTOR", "COORDINATOR", "COACH", "MEDICAL", "SCOUT", "STAFF"];

/**
 * Os quatro de origem.
 *
 * Semeados à leitura, e não só na migração: uma migração apanha as academias do
 * dia em que corre, e as criadas depois nasciam vazias. É o mesmo padrão que
 * `RolesService.list` já usa para os papéis.
 *
 * `isSystem` aqui quer dizer só "veio de origem" — serve para os pôr por ordem e
 * para o ecrã não sugerir que o clube os inventou. Não os torna indestrutíveis: o
 * presidente pode apagá-los, como foi pedido.
 */
export const SEED_DEPARTMENTS: {
  key: string;
  name: string;
  description: string;
  baseRole: Role;
  /** O cargo com que o departamento nasce. Ver `semearCargosEmFalta`. */
  roleName: string;
}[] = [
  {
    key: "direcao",
    name: "Direção",
    description: "Responde pelo clube: sócios, mensalidades, staff e definições.",
    baseRole: "DIRECTOR",
    roleName: "Diretor",
  },
  {
    key: "tecnica",
    name: "Equipa Técnica",
    description: "Treina: as suas equipas, presenças, convocatórias e calendário.",
    baseRole: "COACH",
    roleName: "Treinador",
  },
  {
    key: "clinico",
    name: "Departamento Clínico",
    description: "Dá baixas e altas, e é quem vê o boletim clínico.",
    baseRole: "MEDICAL",
    roleName: "Médico",
  },
  {
    key: "scouting",
    name: "Departamento Scouting",
    description: "Observa, avalia e recruta.",
    baseRole: "SCOUT",
    roleName: "Observador",
  },
];

export interface DepartmentInput {
  name: string;
  description?: string | null;
  baseRole: Role;
  permissions: string[];
  navKeys?: string[];
  /** Ao editar: levar as permissões novas aos cargos que herdaram deste. */
  applyToRoles?: boolean;
}

@Injectable()
export class DepartmentsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(ctx: RequestContext) {
    if (!can(ctx, "staff:read")) throw new ForbiddenException("Sem acesso ao staff");

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const existing = await db.department.count();
      if (existing === 0) {
        await db.department.createMany({
          data: SEED_DEPARTMENTS.map((d, i) => ({
            academyId: ctx.academyId,
            key: d.key,
            name: d.name,
            description: d.description,
            baseRole: d.baseRole,
            permissions: ROLE_PERMISSIONS[d.baseRole],
            navKeys: [],
            isSystem: true,
            order: i,
            updatedAt: new Date(),
          })),
          skipDuplicates: true,
        });
      }

      await semearCargosEmFalta(db, ctx.academyId);

      const rows = await db.department.findMany({
        orderBy: [{ order: "asc" }, { name: "asc" }],
        select: {
          id: true,
          key: true,
          name: true,
          description: true,
          baseRole: true,
          permissions: true,
          navKeys: true,
          isSystem: true,
          order: true,
          roles: {
            where: { archivedAt: null },
            orderBy: { name: "asc" },
            select: { id: true, name: true, _count: { select: { memberships: true } } },
          },
        },
      });

      return rows.map((d) => ({
        id: d.id,
        key: d.key,
        name: d.name,
        description: d.description,
        baseRole: d.baseRole,
        permissions: d.permissions,
        navKeys: d.navKeys,
        isSystem: d.isSystem,
        order: d.order,
        /** Os cargos lá dentro, para o ecrã não ter de cruzar duas listas. */
        roles: d.roles.map((r) => ({ id: r.id, name: r.name, people: r._count.memberships })),
        people: d.roles.reduce((n, r) => n + r._count.memberships, 0),
        /** O que **este** utilizador pode fazer a este departamento. */
        editable: can(ctx, "role:write") && RANK[d.baseRole] <= RANK[ctx.role],
      }));
    });
  }

  async create(ctx: RequestContext, input: DepartmentInput) {
    if (!can(ctx, "role:write")) throw new ForbiddenException("Sem permissão para criar departamentos");
    if (!SCOPES.includes(input.baseRole)) throw new BadRequestException("Âmbito inválido");
    if (RANK[input.baseRole] > RANK[ctx.role]) {
      throw new ForbiddenException("Não podes criar um departamento com mais acesso do que tu");
    }

    const name = input.name.trim();
    if (name.length < 2) throw new BadRequestException("Falta o nome do departamento");

    const permissions = this.filterGrantable(ctx, input.permissions);
    const navKeys = (input.navKeys ?? []).filter(isNavKey);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const key = await this.freeKey(db, slugify(name));
      const last = await db.department.findFirst({ orderBy: { order: "desc" }, select: { order: true } });
      const criado = await db.department.create({
        data: {
          academyId: ctx.academyId,
          key,
          name,
          description: input.description?.trim() || null,
          baseRole: input.baseRole,
          permissions,
          navKeys,
          isSystem: false,
          order: (last?.order ?? -1) + 1,
          updatedAt: new Date(),
        },
        select: { id: true, key: true, name: true },
      });

      /*
       * E nasce com um cargo lá dentro.
       *
       * Sem isto, criar um departamento produzia uma coisa que não se pode usar
       * para nada. Ninguém pertence a um departamento: pertence a um **cargo**,
       * e é o cargo que carrega as permissões. Um departamento sem cargos não
       * aparece no convite (não há nada para convidar), não se atribui a
       * ninguém, e a direcção fica a olhar para uma linha que criou e que não
       * faz nada — que foi exactamente o que aconteceu.
       *
       * O nome é o do departamento porque é o que quem o criou acabou de
       * escrever, e renomear um cargo é um clique. Inventar-lhe um nome era
       * adivinhar pior.
       */
      const cargo = await this.criarPrimeiroCargo(db, ctx.academyId, {
        departmentId: criado.id,
        name,
        baseRole: input.baseRole,
        permissions,
        navKeys,
      });

      return { ...criado, roleId: cargo.id, roleName: cargo.name };
    });
  }

  async update(ctx: RequestContext, id: string, input: Partial<DepartmentInput>) {
    if (!can(ctx, "role:write")) throw new ForbiddenException("Sem permissão para editar departamentos");

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const dep = await db.department.findFirst({
        where: { id },
        select: { id: true, baseRole: true },
      });
      if (!dep) throw new NotFoundException("Departamento não encontrado");
      if (RANK[dep.baseRole] > RANK[ctx.role]) {
        throw new ForbiddenException("Esse departamento está acima do teu");
      }

      const data: Record<string, unknown> = { updatedAt: new Date() };

      if (input.name !== undefined) {
        const name = input.name.trim();
        if (name.length < 2) throw new BadRequestException("Falta o nome do departamento");
        data.name = name;
      }
      if (input.description !== undefined) data.description = input.description?.trim() || null;
      if (input.navKeys !== undefined) data.navKeys = input.navKeys.filter(isNavKey);

      /*
       * O âmbito não se muda depois de criado.
       *
       * Mesma regra que o papel-base de um cargo, e pela mesma razão: mudá-lo
       * mudava, sem ninguém tocar em pessoa nenhuma, o que toda a gente daquele
       * departamento consegue ver. Quem precisa de outro âmbito cria outro
       * departamento e move lá os cargos — uma acção visível.
       */

      let permissions: Permission[] | undefined;
      if (input.permissions !== undefined) {
        permissions = this.filterGrantable(ctx, input.permissions);
        data.permissions = permissions;
      }

      await db.department.update({ where: { id }, data });

      /*
       * Levar as permissões aos cargos, se for pedido.
       *
       * Nunca por omissão. Um departamento editado que mudasse calado o que
       * dezenas de pessoas podem fazer é precisamente o efeito à distância que se
       * quis evitar ao fazer o cargo copiar em vez de apontar.
       *
       * `isSystem: false` protege o cargo do presidente: ele não herda de
       * departamento nenhum, e ninguém lhe tira permissões por esta porta.
       */
      let updatedRoles = 0;
      if (permissions && input.applyToRoles) {
        const { count } = await db.academyRole.updateMany({
          where: { departmentId: id, archivedAt: null, isSystem: false },
          data: { permissions, updatedAt: new Date() },
        });
        updatedRoles = count;
      }

      return { ok: true, updatedRoles };
    });
  }

  /**
   * Apagar um departamento.
   *
   * Os cargos lá dentro **não** se apagam: ficam sem departamento
   * (`onDelete: SetNull`). Apagar "Departamento Clínico" não pode ser uma forma
   * acidental de tirar o acesso a quem lá trabalhava — o que se apaga é a
   * arrumação, não as pessoas nem o que elas podem fazer.
   */
  async remove(ctx: RequestContext, id: string) {
    if (!can(ctx, "role:write")) throw new ForbiddenException("Sem permissão para apagar departamentos");

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const dep = await db.department.findFirst({
        where: { id },
        select: { id: true, baseRole: true, _count: { select: { roles: true } } },
      });
      if (!dep) throw new NotFoundException("Departamento não encontrado");
      if (RANK[dep.baseRole] > RANK[ctx.role]) {
        throw new ForbiddenException("Esse departamento está acima do teu");
      }

      await db.department.delete({ where: { id } });
      return { ok: true, orphanedRoles: dep._count.roles };
    });
  }

  /**
   * O cargo com que um departamento nasce.
   *
   * Copia as permissões do departamento — não fica a apontar para elas. É a
   * regra da casa e está explicada no cabeçalho deste ficheiro: resolver herança
   * na leitura punha um `JOIN` no caminho de cada pedido, e editar um
   * departamento passaria a mudar em silêncio o que as pessoas podem fazer.
   */
  private async criarPrimeiroCargo(
    db: ScopedClient,
    academyId: string,
    d: {
      departmentId: string;
      name: string;
      baseRole: Role;
      permissions: Permission[];
      navKeys: string[];
    },
  ) {
    const key = await this.freeRoleKey(db, slugify(d.name));
    return db.academyRole.create({
      data: {
        academyId,
        key,
        name: d.name,
        description: null,
        baseRole: d.baseRole,
        departmentId: d.departmentId,
        permissions: d.permissions,
        navKeys: d.navKeys,
        /*
         * Nunca `isSystem`, nem no departamento de origem.
         *
         * `isSystem` num cargo quer dizer "não se mexe" — é o que protege o
         * presidente. Este é um ponto de partida para o clube renomear, ajustar
         * ou arquivar; trancá-lo era dar-lhe um departamento que não pode usar
         * à sua maneira, que é meio caminho para o problema de origem.
         */
        isSystem: false,
        rank: RANK[d.baseRole],
        updatedAt: new Date(),
      },
      select: { id: true, name: true },
    });
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
      const taken = await db.department.findFirst({ where: { key }, select: { id: true } });
      if (!taken) return key;
    }
    return `${base}-${Date.now()}`;
  }

  /** O mesmo, na tabela dos cargos — a chave também é única por academia lá. */
  private async freeRoleKey(db: ScopedClient, base: string): Promise<string> {
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
      .slice(0, 40) || "departamento"
  );
}

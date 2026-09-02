import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { Role } from "@prisma/client";
import { PrismaService, type ScopedClient } from "../prisma/prisma.service";
import { semearCargosEmFalta } from "../departments/first-role";
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
    description: "Responde por tudo. É o único cargo que não se pode editar nem apagar.",
    baseRole: "OWNER",
  },
];

/**
 * É este cargo o do presidente?
 *
 * O nome é escrito à mão por quem abre o clube, por isso chega em todas as
 * formas: "Presidente", "presidente", "PRESIDENTE", " Presidente ". Normalizar
 * aqui — sem acentos, sem espaços, em minúsculas — é o que faz as quatro serem a
 * mesma coisa, e o clube não abrir com dois cargos a dizer o mesmo.
 */
export function isPresidente(name: string): boolean {
  const limpo = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
  return limpo === "presidente" || limpo === "presidencia" || limpo === "president";
}

/**
 * Os cargos com que uma academia nasce.
 *
 * Chamado pela plataforma ao abrir um clube — ver `PlatformService.createAcademy`.
 * Vive aqui e não lá porque as regras de quem pode o quê são deste ficheiro, e
 * tê-las em dois sítios era garantir que divergiam.
 *
 * ## Sempre um presidente, e às vezes dois cargos
 *
 * O `presidente` nasce sempre, com tudo, e é imutável. É o fecho da porta por
 * dentro: se alguém lhe pudesse tirar permissões, uma academia podia trancar-se
 * fora do próprio produto sem ninguém com poder para a reabrir.
 *
 * Se quem vai receber o convite **não** for o presidente — é o coordenador
 * desportivo que está a montar o clube, e o presidente ainda não entrou —, nasce
 * também o cargo dele. Com todas as permissões, e a razão é prática: é a primeira
 * pessoa a entrar, tem de conseguir montar tudo, e não há mais ninguém a quem
 * pedir. O que **não** consegue é mexer no cargo do presidente, que continua
 * fechado a toda a gente.
 *
 * @returns as linhas a criar, e a `key` do cargo que o convite deve apontar.
 */
export function initialRoles(
  academyId: string,
  template: { key: string; name: string } | null,
): { rows: Record<string, unknown>[]; inviteRoleKey: string; baseRole: Role } {
  const now = new Date();

  const presidente = {
    academyId,
    key: "presidente",
    name: SYSTEM_ROLES[0].name,
    description: SYSTEM_ROLES[0].description,
    baseRole: "OWNER" as Role,
    /*
     * `departmentId` e não `department`.
     *
     * Era `department: null` — a coluna do enum antigo, que a migração
     * `20260826230000_departamentos` substituiu e nunca largou. Ficou aqui um
     * mês sem dar erro por duas razões: a coluna ainda existia na base, e estas
     * linhas entram por `createMany({ data: rows as never })` no
     * `platform.service`, que desliga a verificação de tipos.
     *
     * Assim que a coluna caísse, **criar uma academia nova** rebentava com um
     * "Unknown argument" — no meio da criação, com a academia já gravada e sem
     * cargos nem convite.
     */
    departmentId: null,
    permissions: ROLE_PERMISSIONS.OWNER,
    navKeys: [] as string[],
    isSystem: true,
    rank: RANK.OWNER,
    updatedAt: now,
  };

  // O convite é para o presidente: um cargo só, e é esse que a pessoa veste.
  if (!template || template.key === "presidente") {
    return { rows: [presidente], inviteRoleKey: "presidente", baseRole: "OWNER" };
  }

  const dele = {
    academyId,
    key: template.key,
    name: template.name,
    description: "Criado ao abrir o clube. Tem tudo por ser o primeiro cargo a entrar.",
    /*
     * Base OWNER e não a do modelo, de propósito.
     *
     * A base decide o **âmbito** — um COACH só vê as equipas dele, por muitas
     * permissões que lhe demos. Quem está a montar o clube sozinho não pode
     * estar limitado a equipas que ainda não existem.
     */
    baseRole: "OWNER" as Role,
    /*
     * Sem departamento, tal como o presidente.
     *
     * Este cargo nasce com tudo porque é o primeiro a entrar e não há mais
     * ninguém a quem pedir. Arrumá-lo num departamento seria dizer que herdou
     * dele, e herdou o contrário: tem mais do que qualquer departamento dá.
     */
    departmentId: null,
    permissions: ROLE_PERMISSIONS.OWNER,
    navKeys: [] as string[],
    isSystem: false,
    rank: RANK.OWNER,
    updatedAt: now,
  };

  return { rows: [presidente, dele], inviteRoleKey: template.key, baseRole: "OWNER" };
}

export type RoleInput = {
  name: string;
  description?: string | null;
  /**
   * O âmbito. Ignorado quando vem `departmentId`: nesse caso é o do
   * departamento, porque é lá que essa decisão se toma — ver `DepartmentsService`.
   * Só é preciso num cargo sem departamento.
   */
  baseRole?: Role;
  /** A que departamento pertence. Nulo é "nenhum" — o caso do presidente. */
  departmentId?: string | null;
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

      /*
       * E os cargos que faltam aos departamentos.
       *
       * Mora em `departments/first-role.ts` e corre nas **duas** leituras — aqui
       * e no `GET /api/departments`. O diálogo de convite lê os dois em paralelo:
       * se só uma delas reparasse, a outra podia responder de antes da reparação
       * e mostrar um departamento "sem cargos" que já os tinha. Ver a nota lá.
       */
      await semearCargosEmFalta(db, ctx.academyId);

      const roles = await db.academyRole.findMany({
        where: { archivedAt: null },
        orderBy: [{ rank: "desc" }, { name: "asc" }],
        select: {
          id: true, key: true, name: true, description: true, baseRole: true,
          departmentId: true, permissions: true, navKeys: true, isSystem: true, rank: true,
          department: { select: { id: true, name: true, baseRole: true } },
          _count: { select: { memberships: true } },
        },
      });

      return roles.map((r) => ({
        id: r.id,
        key: r.key,
        name: r.name,
        description: r.description,
        baseRole: r.baseRole,
        departmentId: r.departmentId,
        department: r.department?.name ?? null,
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

    const permissions = this.filterGrantable(ctx, input.permissions);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      /*
       * O âmbito vem do departamento, quando há um.
       *
       * Era uma pergunta no ecrã de criar cargos, com o nome "Âmbito", e ninguém
       * a entendia. Não admira: não é uma pergunta sobre o cargo. "A equipa
       * técnica vê só as equipas dela" decide-se ao criar o departamento, uma
       * vez, e todos os cargos lá dentro herdam-na. O que o cliente mandar em
       * `baseRole` é ignorado quando há departamento — a decisão tem um dono só.
       */
      let baseRole = input.baseRole;
      if (input.departmentId) {
        const dep = await db.department.findFirst({
          where: { id: input.departmentId },
          select: { baseRole: true },
        });
        if (!dep) throw new BadRequestException("Departamento não encontrado");
        baseRole = dep.baseRole;
      }
      if (!baseRole) throw new BadRequestException("Falta o departamento ou o âmbito");
      if (!STAFF_BASES.includes(baseRole)) throw new BadRequestException("Papel-base inválido");
      if (RANK[baseRole] > RANK[ctx.role]) {
        throw new ForbiddenException("Não podes criar um papel com mais acesso do que tu");
      }

      const key = await this.freeKey(db, slugify(name));
      return db.academyRole.create({
        data: {
          academyId: ctx.academyId,
          key,
          name,
          description: input.description?.trim() || null,
          baseRole,
          departmentId: input.departmentId ?? null,
          permissions,
          navKeys: [],
          isSystem: false,
          rank: RANK[baseRole],
          updatedAt: new Date(),
        },
        select: { id: true, key: true, name: true },
      });
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
      /*
       * Mudar de departamento muda a arrumação, não o âmbito.
       *
       * O `baseRole` fica onde está — mudá-lo em silêncio era a razão de ele ser
       * imutável (ver a nota mais abaixo). Quem quer outro âmbito cria outro
       * cargo no departamento certo e move lá as pessoas.
       */
      if (input.departmentId !== undefined) {
        if (input.departmentId) {
          const dep = await db.department.findFirst({
            where: { id: input.departmentId },
            select: { id: true },
          });
          if (!dep) throw new BadRequestException("Departamento não encontrado");
        }
        data.departmentId = input.departmentId;
      }
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
   * Dar cargos a uma pessoa — o principal, e os secundários que se acrescentam.
   *
   * ## Um principal, e os outros por cima
   *
   * O **principal** escreve duas colunas: `customRoleId` e `role`. O enum tem de
   * seguir o papel-base, senão uma pessoa com o cargo "Dep. Scouting" continuava
   * a derivar o âmbito como treinador — e o âmbito é o que a impede de ver o que
   * não é dela.
   *
   * Os **secundários** não mexem no enum. É a decisão que faz isto funcionar: um
   * presidente que também treina os Sub-13 continua a ver a academia toda,
   * porque é isso que "presidente" quer dizer. Se o segundo cargo trocasse o
   * `baseRole`, acrescentar "treinador" a um presidente prendia-o às equipas
   * dele — tirava-lhe acesso em vez de lho dar, que é o oposto do que se pediu.
   * O que os secundários fazem é somar permissões e menus, em `exceptionsFor`.
   *
   * ## As guardas
   *
   * A patente verifica-se em **todos**, um a um: quem convida não pode dar um
   * cargo de patente acima da sua, e isso não pode ter uma porta das traseiras
   * pelo campo dos secundários.
   *
   * O principal não pode repetir-se nos secundários — seria a mesma coisa dita
   * duas vezes, e a lista da ficha ficaria com o nome dele lá duas vezes.
   *
   * `extraRoleIds` a `undefined` **não mexe** nos secundários: quem só quer
   * trocar o principal não tem de reenviar os outros para não os perder. Uma
   * lista vazia limpa-os, que é como se tiram.
   */
  async assign(
    ctx: RequestContext,
    membershipId: string,
    roleId: string | null,
    extraRoleIds?: string[],
  ) {
    if (!can(ctx, "access:write")) throw new ForbiddenException("Sem permissão para gerir acessos");
    if (membershipId === ctx.membershipId) throw new BadRequestException("Não podes alterar os teus próprios cargos");

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const target = await db.membership.findFirst({
        where: { id: membershipId, role: { notIn: ["GUARDIAN", "ATHLETE"] } },
        select: { id: true, role: true, customRoleId: true },
      });
      if (!target) throw new NotFoundException("Pessoa não encontrada");

      /* ---------------------------------------------------------- principal */
      if (roleId === null) {
        await db.membership.update({ where: { id: membershipId }, data: { customRoleId: null } });
      } else {
        const role = await this.mustFind(db, roleId);
        if (role.rank > RANK[ctx.role]) {
          throw new ForbiddenException("Não podes dar um cargo com mais acesso do que o teu");
        }
        await db.membership.update({
          where: { id: membershipId },
          data: { customRoleId: roleId, role: role.baseRole },
        });
      }

      /* -------------------------------------------------------- secundários */
      if (extraRoleIds) {
        const principal = roleId;
        const pedidos = [...new Set(extraRoleIds)].filter((id) => id !== principal);

        for (const id of pedidos) {
          const extra = await this.mustFind(db, id);
          if (extra.rank > RANK[ctx.role]) {
            throw new ForbiddenException("Não podes dar um cargo com mais acesso do que o teu");
          }
        }

        /*
         * Apagar e reescrever, e não reconciliar linha a linha.
         *
         * São meia dúzia de linhas por pessoa, dentro da mesma transacção: a
         * reconciliação daria o mesmo resultado com três vezes mais código e um
         * estado intermédio a mais para estar errado. `createdAt` perde-se, e não
         * serve para nada — ninguém pergunta desde quando é que alguém é também
         * treinador; se um dia perguntar, é o `AuditLog` que responde.
         */
        await db.membershipRole.deleteMany({ where: { membershipId } });
        if (pedidos.length > 0) {
          await db.membershipRole.createMany({
            data: pedidos.map((id) => ({ membershipId, roleId: id })),
            skipDuplicates: true,
          });
        }
      }

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

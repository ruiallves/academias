import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, type CalendarEventKind } from "@prisma/client";
import { PrismaService, type ScopedClient } from "../prisma/prisma.service";
import { can, ROLE_PERMISSIONS, type Permission, type RequestContext } from "../common/permissions";
import { teamScopeFilter } from "../common/permissions";

/**
 * As colunas de um evento que a consola lê — partilhadas pela leitura, criação e
 * alteração, para as três devolverem exactamente a mesma forma.
 */
const EVENT_SELECT = {
  id: true,
  teamId: true,
  kind: true,
  title: true,
  startsAt: true,
  endsAt: true,
  venue: true,
  cancelled: true,
  coach: { select: { id: true, user: { select: { name: true } } } },
} satisfies Prisma.CalendarEventSelect;

type EventRow = Prisma.CalendarEventGetPayload<{ select: typeof EVENT_SELECT }>;

/** Achata a relação do treinador em `coachId`/`coachName`, como as sessões fazem. */
function serializeEvent(e: EventRow) {
  return {
    id: e.id,
    teamId: e.teamId,
    kind: e.kind,
    title: e.title,
    startsAt: e.startsAt,
    endsAt: e.endsAt,
    venue: e.venue,
    cancelled: e.cancelled,
    coachId: e.coach?.id ?? null,
    coachName: e.coach?.user.name ?? null,
  };
}

/**
 * As permissões que a direção pode conceder ou retirar a uma pessoa em concreto.
 *
 * **Não** inclui `access:write` nem `settings:write`: quem as pudesse delegar
 * criava co-administradores, e a delegação de acesso deixaria de ter dono. Quem
 * gere acessos gere-os; não fabrica outros gestores de acessos por esta porta. É a
 * mesma razão de `access:write` ser uma permissão à parte de `staff:write`.
 */
const DELEGATABLE: ReadonlySet<Permission> = new Set<Permission>([
  "athlete:read", "athlete:write",
  "family:read", "family:write",
  "team:read", "team:write",
  "calendar:read", "calendar:write",
  "attendance:read", "attendance:write",
  "billing:read", "billing:write",
  "comms:read", "comms:write",
  "evaluation:read", "evaluation:write",
  "report:read", "report:write",
  "staff:read", "staff:write",
  "clinical:status", "clinical:read", "clinical:write",
]);

/**
 * As leituras que a consola faz.
 *
 * Substitui `apps/console/src/data/demo.ts`. Três regras que valem para tudo o que
 * está aqui:
 *
 *  1. **O âmbito é aplicado na fronteira**, com `teamScopeFilter`, e não em cada
 *     ecrã. Um treinador que peça `/api/athletes` recebe os atletas das equipas
 *     dele — não recebe a academia toda e filtra no browser. A RLS por baixo é a
 *     segunda camada; esta é a primeira.
 *  2. **A permissão é verificada aqui**, no serviço, não no controlador. Quem sabe
 *     o URL chega ao endpoint na mesma, e a tabela de permissões do cliente só
 *     decide o que se mostra.
 *  3. **Nada de números inventados.** Onde não há registo devolve-se `null`, não
 *     zero. Um zero afirma um facto; um nulo diz "ninguém verificou", e a consola
 *     mostra as duas coisas de maneira diferente.
 */
@Injectable()
export class AcademyService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * O arranque da consola: quem sou, onde estou, e o que existe nesta academia.
   *
   * Uma chamada só, de propósito. A alternativa — academia, época, modalidades e
   * perfil em quatro pedidos — dá quatro estados de carregamento a coordenar antes
   * de o primeiro ecrã poder desenhar seja o que for.
   */
  async bootstrap(ctx: RequestContext) {
    return this.prisma.runAs(ctx.academyId, async (db) => {
      const academy = await db.academy.findFirst({
        where: { id: ctx.academyId },
        select: { id: true, slug: true, name: true, shortName: true, city: true, signalColor: true, logoUrl: true, billingDueDay: true },
      });

      const [sports, season, me] = await Promise.all([
        db.sport.findMany({
          orderBy: { name: "asc" },
          select: { id: true, name: true, positions: true, skills: true, dominantSideLabel: true, matchMinutes: true },
        }),
        db.season.findFirst({ where: { isCurrent: true }, select: { id: true, label: true, startsOn: true, endsOn: true } }),
        db.membership.findFirst({
          where: { id: ctx.membershipId },
          select: { id: true, role: true, title: true, department: true, grants: true, user: { select: { name: true, email: true } } },
        }),
      ]);

      return {
        academy,
        sports,
        season,
        me: {
          membershipId: ctx.membershipId,
          userId: ctx.userId,
          name: me?.user.name ?? "",
          email: me?.user.email ?? "",
          role: ctx.role,
          title: me?.title ?? null,
          department: me?.department ?? null,
          grants: ctx.grants,
          // As retiradas seguem também: sem elas, o cliente calcularia as
          // permissões do próprio utilizador sem descontar o que a direção lhe tirou.
          revokes: ctx.revokes,
          // O âmbito segue para o cliente para ele saber o que **não** tem — e
          // poder dizê-lo em vez de mostrar uma lista vazia sem explicação.
          scope: ctx.scope,
        },
      };
    });
  }

  /** Equipas do âmbito, com plantel e treinadores contados. */
  async teams(ctx: RequestContext) {
    if (!can(ctx, "team:read")) throw new ForbiddenException("Sem acesso a equipas");
    const scope = teamScopeFilter(ctx);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const teams = await db.team.findMany({
        where: scope ? { id: scope } : {},
        orderBy: { name: "asc" },
        select: {
          id: true, name: true, ageGroup: true, schedule: true, sportId: true,
          season: { select: { id: true, label: true } },
          staff: { select: { title: true, membership: { select: { id: true, user: { select: { name: true } } } } } },
          _count: { select: { athletes: true } },
        },
      });

      return teams.map((t) => ({
        id: t.id,
        name: t.name,
        ageGroup: t.ageGroup,
        sportId: t.sportId,
        season: t.season.label,
        schedule: t.schedule,
        athleteCount: t._count.athletes,
        coaches: t.staff.map((s) => ({ id: s.membership.id, name: s.membership.user.name, title: s.title })),
      }));
    });
  }

  /**
   * Cria uma equipa. Exige `team:write` — a direção e a coordenação, não o treinador.
   *
   * A **forma** já foi validada no DTO; aqui ficam as regras: a modalidade tem de
   * ser desta academia, a época resolve-se pelo rótulo (encontra-se ou cria-se), e
   * o treinador principal, se vier, tem de ser uma pessoa desta academia. Devolve a
   * equipa na mesma forma que `teams()` — para a consola a poder juntar à lista sem
   * um segundo pedido.
   */
  async createTeam(
    ctx: RequestContext,
    dto: {
      name: string;
      sportId: string;
      ageGroup: string;
      season: string;
      coachId?: string;
      schedule: { weekday: number; start: string; end: string; venue: string }[];
    },
  ) {
    if (!can(ctx, "team:write")) throw new ForbiddenException("Sem permissão para criar equipas");

    return this.prisma.runAs(ctx.academyId, async (db) => {
      // A modalidade tem de existir nesta academia. O `findFirst` já vem filtrado
      // por tenant pela extensão — um `sportId` de outra academia dá "não encontrado".
      const sport = await db.sport.findFirst({ where: { id: dto.sportId }, select: { id: true } });
      if (!sport) throw new BadRequestException("Modalidade desconhecida");

      // O treinador principal, quando indicado, tem de ser desta academia. Sem esta
      // verificação o FK rebentava com um 500 em vez de um 400 explicável.
      if (dto.coachId) {
        const coach = await db.membership.findFirst({ where: { id: dto.coachId }, select: { id: true } });
        if (!coach) throw new BadRequestException("Treinador desconhecido");
      }

      const season = await this.resolveSeason(db, ctx.academyId, dto.season);

      const team = await db.team.create({
        data: {
          academyId: ctx.academyId,
          sportId: dto.sportId,
          seasonId: season.id,
          name: dto.name.trim(),
          ageGroup: dto.ageGroup.trim(),
          schedule: dto.schedule,
          ...(dto.coachId
            ? { staff: { create: { membershipId: dto.coachId, title: "Treinador principal" } } }
            : {}),
        },
        select: {
          id: true, name: true, ageGroup: true, schedule: true, sportId: true,
          season: { select: { label: true } },
          staff: { select: { title: true, membership: { select: { id: true, user: { select: { name: true } } } } } },
          _count: { select: { athletes: true } },
        },
      });

      return {
        id: team.id,
        name: team.name,
        ageGroup: team.ageGroup,
        sportId: team.sportId,
        season: team.season.label,
        schedule: team.schedule,
        athleteCount: team._count.athletes,
        coaches: team.staff.map((s) => ({ id: s.membership.id, name: s.membership.user.name, title: s.title })),
      };
    });
  }

  /**
   * A época deste rótulo — a existente, ou uma nova.
   *
   * O rótulo (`"2026/27"`) é único por academia, por isso resolve-se por ele. Se não
   * existir, cria-se com datas inferidas do próprio rótulo (época desportiva de
   * agosto a julho): é melhor do que obrigar a direção a criar épocas à parte antes
   * de poder criar a primeira equipa do ano. `isCurrent` fica a cargo de quem gere
   * épocas — uma equipa nova não decide qual é a época em curso.
   */
  private async resolveSeason(db: ScopedClient, academyId: string, label: string) {
    const trimmed = label.trim();
    const existing = await db.season.findFirst({ where: { label: trimmed }, select: { id: true } });
    if (existing) return existing;

    const startYear = Number(trimmed.slice(0, 4));
    const base = Number.isFinite(startYear) && startYear > 2000 ? startYear : new Date().getUTCFullYear();
    return db.season.create({
      data: {
        academyId,
        label: trimmed,
        startsOn: new Date(Date.UTC(base, 7, 1)), // 1 de agosto
        endsOn: new Date(Date.UTC(base + 1, 6, 31)), // 31 de julho
      },
      select: { id: true },
    });
  }

  /**
   * Atletas do âmbito.
   *
   * A disponibilidade clínica vem derivada do boletim e não de um campo: enquanto
   * existir uma entrada com impacto e sem alta, o atleta está limitado ou parado.
   * Derivá-la aqui evita que cada ecrã a calcule à sua maneira — e que um deles se
   * esqueça, e convoque quem não pode jogar.
   */
  async athletes(ctx: RequestContext) {
    if (!can(ctx, "athlete:read")) throw new ForbiddenException("Sem acesso a atletas");
    const scope = teamScopeFilter(ctx);

    /*
     * O diagnóstico é dado de saúde — categoria especial no RGPD (Art. 9). A
     * *disponibilidade* (`available`/`limited`/`out`) chega a toda a gente que vê o
     * atleta: é `clinical:status`, o que basta para não convocar quem está parado.
     * O **título da lesão** ("Entorse do tornozelo direito") exige `clinical:read`.
     *
     * Sem esta separação, uma secretária (STAFF, sem `clinical:read`) atribuída a
     * uma equipa recebia o diagnóstico dos atletas dela. A permissão existia; este
     * endpoint é que não a aplicava.
     */
    const mayReadDiagnosis = can(ctx, "clinical:read");

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const athletes = await db.athlete.findMany({
        where: scope ? { teams: { some: { teamId: scope } } } : {},
        orderBy: { name: "asc" },
        select: {
          id: true, name: true, birthdate: true, photoUrl: true, status: true, joinedAt: true,
          heightCm: true, weightKg: true, dominantSide: true, squadNumber: true, medicalValidUntil: true,
          teams: { select: { teamId: true, position: true }, take: 1 },
          guardians: {
            select: {
              relation: true, isPayer: true,
              membership: { select: { id: true, user: { select: { name: true, email: true, phone: true } } } },
            },
          },
          clinical: {
            where: { clearedOn: null, impact: { not: "NONE" } },
            orderBy: { date: "desc" },
            select: { id: true, impact: true, title: true, expectedReturn: true, date: true },
          },
        },
      });

      return athletes.map((a) => {
        const active = a.clinical[0];
        return {
          id: a.id,
          name: a.name,
          birthdate: a.birthdate,
          photoUrl: a.photoUrl,
          status: a.status,
          joinedAt: a.joinedAt,
          heightCm: a.heightCm,
          weightKg: a.weightKg === null ? null : Number(a.weightKg),
          dominantSide: a.dominantSide,
          squadNumber: a.squadNumber,
          medicalValidUntil: a.medicalValidUntil,
          teamId: a.teams[0]?.teamId ?? null,
          position: a.teams[0]?.position ?? null,
          guardians: a.guardians.map((g) => ({
            membershipId: g.membership.id,
            name: g.membership.user.name,
            email: g.membership.user.email,
            phone: g.membership.user.phone,
            relation: g.relation,
            isPayer: g.isPayer,
          })),
          // "available" | "limited" | "out" — `clinical:status`, chega a todos.
          availability: !active ? "available" : active.impact === "OUT" ? "out" : "limited",
          // O título (diagnóstico) só a quem tem `clinical:read`. As datas de
          // regresso são planeamento e acompanham o estado; o título é que é o
          // dado sensível, e é esse que se retém.
          restriction: active
            ? {
                id: active.id,
                title: mayReadDiagnosis ? active.title : null,
                since: active.date,
                expectedReturn: active.expectedReturn,
              }
            : null,
        };
      });
    });
  }

  /**
   * O quadro de staff.
   *
   * Exige `staff:read` — e devolve a academia toda, não o âmbito de equipas. Um
   * treinador que possa ver staff deve conseguir encontrar o contacto do
   * fisioterapeuta, que não está atribuído a equipa nenhuma.
   */
  async staff(ctx: RequestContext) {
    if (!can(ctx, "staff:read")) throw new ForbiddenException("Sem acesso ao staff");

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const rows = await db.membership.findMany({
        where: { role: { notIn: ["GUARDIAN", "ATHLETE"] } },
        orderBy: [{ department: "asc" }, { createdAt: "asc" }],
        select: {
          id: true, role: true, title: true, department: true, isActive: true, grants: true, revokes: true, createdAt: true,
          user: { select: { name: true, email: true, phone: true } },
          coachOf: { select: { teamId: true, title: true } },
        },
      });

      return rows.map((m) => ({
        id: m.id,
        name: m.user.name,
        email: m.user.email,
        phone: m.user.phone,
        role: m.role,
        title: m.title,
        department: m.department,
        isActive: m.isActive,
        grants: m.grants,
        revokes: m.revokes,
        since: m.createdAt,
        teamIds: m.coachOf.map((t) => t.teamId),
      }));
    });
  }

  /**
   * Treinos num intervalo.
   *
   * `attendanceClosedAt` a nulo é o que distingue "ninguém verificou" de
   * "estiveram todos" — e é a origem da lista de pendências. Guarda-se a excepção
   * e não a norma, por isso as faltas vêm em lista e os presentes são o resto do
   * plantel.
   */
  async sessions(ctx: RequestContext, from: Date, to: Date) {
    if (!can(ctx, "calendar:read") && !can(ctx, "attendance:read")) {
      throw new ForbiddenException("Sem acesso a treinos");
    }
    const scope = teamScopeFilter(ctx);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const rows = await db.trainingSession.findMany({
        where: { startsAt: { gte: from, lte: to }, ...(scope ? { teamId: scope } : {}) },
        orderBy: { startsAt: "asc" },
        select: {
          id: true, teamId: true, startsAt: true, endsAt: true, venue: true, status: true,
          attendanceClosedAt: true,
          coach: { select: { id: true, user: { select: { name: true } } } },
          attendance: { select: { athleteId: true, status: true } },
        },
      });

      return rows.map((s) => ({
        id: s.id,
        teamId: s.teamId,
        startsAt: s.startsAt,
        endsAt: s.endsAt,
        venue: s.venue,
        status: s.status,
        coachId: s.coach?.id ?? null,
        coachName: s.coach?.user.name ?? null,
        recorded: s.attendanceClosedAt !== null,
        absences: s.attendance
          .filter((a) => a.status !== "PRESENT")
          .map((a) => ({ athleteId: a.athleteId, status: a.status })),
      }));
    });
  }

  /* ------------------------------------------------------------------------ */
  /* Eventos do calendário                                                    */
  /* ------------------------------------------------------------------------ */

  /**
   * Eventos pontuais num intervalo — o que "Novo evento" criou.
   *
   * Os eventos de toda a academia (`teamId` nulo) chegam a toda a gente, mesmo a um
   * treinador com âmbito: uma reunião de pais não é de escalão nenhum, e escondê-la
   * de quem não tem equipa era esconder informação da casa.
   */
  async events(ctx: RequestContext, from: Date, to: Date) {
    if (!can(ctx, "calendar:read")) throw new ForbiddenException("Sem acesso ao calendário");
    const scope = teamScopeFilter(ctx);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const rows = await db.calendarEvent.findMany({
        where: {
          startsAt: { gte: from, lte: to },
          ...(scope ? { OR: [{ teamId: scope }, { teamId: null }] } : {}),
        },
        orderBy: { startsAt: "asc" },
        select: EVENT_SELECT,
      });
      return rows.map(serializeEvent);
    });
  }

  /**
   * Cria um evento. Exige `calendar:write` e respeita o âmbito.
   *
   * Um treinador só cria para as suas equipas, e **não** cria eventos de toda a
   * academia — essa opção nem lhe aparece no diálogo, e o servidor recusa-a na
   * mesma, porque a UI não é a fronteira.
   */
  async createEvent(
    ctx: RequestContext,
    dto: { kind: string; teamId?: string; title: string; startsAt: string; endsAt: string; venue: string },
  ) {
    if (!can(ctx, "calendar:write")) throw new ForbiddenException("Sem permissão para criar eventos");
    const scope = teamScopeFilter(ctx);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      if (dto.teamId) {
        if (scope && !scope.in.includes(dto.teamId)) throw new ForbiddenException("Equipa fora do teu âmbito");
        const team = await db.team.findFirst({ where: { id: dto.teamId }, select: { id: true } });
        if (!team) throw new BadRequestException("Equipa desconhecida");
      } else if (scope) {
        throw new ForbiddenException("Só a direção cria eventos de toda a academia");
      }

      const startsAt = new Date(dto.startsAt);
      const endsAt = new Date(dto.endsAt);
      if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
        throw new BadRequestException("Datas inválidas");
      }
      if (endsAt <= startsAt) throw new BadRequestException("O fim tem de ser depois do início");

      const created = await db.calendarEvent.create({
        data: {
          academyId: ctx.academyId,
          kind: dto.kind as CalendarEventKind,
          title: dto.title.trim(),
          startsAt,
          endsAt,
          venue: dto.venue.trim(),
          ...(dto.teamId ? { teamId: dto.teamId } : {}),
        },
        select: EVENT_SELECT,
      });
      return serializeEvent(created);
    });
  }

  /**
   * Cancela ou reativa um evento. Exige `calendar:write` e respeita o âmbito.
   *
   * Cancela, não apaga: um treino desmarcado continua a aparecer riscado porque as
   * famílias precisam de ver que foi desmarcado, não de o ver desaparecer.
   */
  async setEventCancelled(ctx: RequestContext, id: string, cancelled: boolean) {
    if (!can(ctx, "calendar:write")) throw new ForbiddenException("Sem permissão para alterar eventos");
    const scope = teamScopeFilter(ctx);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const ev = await db.calendarEvent.findFirst({ where: { id }, select: { id: true, teamId: true } });
      if (!ev) throw new NotFoundException("Evento não encontrado");
      // Um treinador não mexe em eventos de toda a academia nem de equipas alheias.
      if (scope && (ev.teamId === null || !scope.in.includes(ev.teamId))) {
        throw new ForbiddenException("Evento fora do teu âmbito");
      }

      const updated = await db.calendarEvent.update({ where: { id }, data: { cancelled }, select: EVENT_SELECT });
      return serializeEvent(updated);
    });
  }

  /** Mensalidades. "Vencida" é derivado da data — não é um estado guardado. */
  async charges(ctx: RequestContext, period?: string) {
    if (!can(ctx, "billing:read")) throw new ForbiddenException("Sem acesso a mensalidades");
    const scope = teamScopeFilter(ctx);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const rows = await db.charge.findMany({
        where: {
          ...(period ? { period } : {}),
          ...(scope ? { athlete: { teams: { some: { teamId: scope } } } } : {}),
        },
        orderBy: [{ period: "desc" }, { dueDate: "asc" }],
        select: {
          id: true, athleteId: true, period: true, amountCents: true, dueDate: true, status: true,
          athlete: { select: { name: true, teams: { select: { teamId: true }, take: 1 } } },
        },
      });

      const today = new Date();
      return rows.map((c) => ({
        id: c.id,
        athleteId: c.athleteId,
        athleteName: c.athlete.name,
        teamId: c.athlete.teams[0]?.teamId ?? null,
        period: c.period,
        amountCents: c.amountCents,
        dueDate: c.dueDate,
        status: c.status,
        overdue: c.status === "OPEN" && c.dueDate < today,
      }));
    });
  }

  /* ------------------------------------------------------------------------ */
  /* Acesso por pessoa                                                         */
  /* ------------------------------------------------------------------------ */

  /**
   * Define as excepções de acesso de uma pessoa — o que a direção lhe concede ou
   * retira por cima do papel.
   *
   * ## As guardas, por ordem de importância
   *
   * 1. Exige `access:write` — não `staff:write`. Editar a ficha de alguém não é o
   *    mesmo que mudar o que essa pessoa vê.
   * 2. Só permissões **delegáveis** — nunca `access:write`/`settings:write`, para
   *    não se fabricarem co-administradores por esta porta.
   * 3. Só permissões que **quem concede também tem**. Um coordenador com
   *    `access:write` (hipotético) não pode conceder `billing` que ele próprio não
   *    vê — não se dá o que não se tem.
   * 4. Não se mexe no próprio acesso nem no de um encarregado/atleta — este painel
   *    é para staff.
   *
   * Guarda-se a **diferença** para o papel: se o papel já dá a permissão, não fica
   * em `grants`; se não a dá, não fica em `revokes`. Assim mudar o papel de alguém
   * amanhã não arrasta excepções que deixaram de fazer sentido.
   */
  async setAccess(ctx: RequestContext, membershipId: string, grants: string[], revokes: string[]) {
    if (!can(ctx, "access:write")) throw new ForbiddenException("Sem permissão para gerir acessos");
    if (membershipId === ctx.membershipId) throw new BadRequestException("Não podes alterar o teu próprio acesso");

    const cleanGrants = this.filterDelegatable(ctx, grants);
    const cleanRevokes = this.filterDelegatable(ctx, revokes);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const target = await db.membership.findFirst({
        where: { id: membershipId, role: { notIn: ["GUARDIAN", "ATHLETE"] } },
        select: { id: true, role: true },
      });
      if (!target) throw new NotFoundException("Pessoa não encontrada");

      // Guarda-se só a diferença para o papel: uma concessão que o papel já dá, ou
      // uma retirada de algo que o papel não tem, não deixam marca.
      const base = new Set(ROLE_PERMISSIONS[target.role]);
      const finalGrants = cleanGrants.filter((p) => !base.has(p));
      const finalRevokes = cleanRevokes.filter((p) => base.has(p));

      await db.membership.update({
        where: { id: membershipId },
        data: { grants: finalGrants, revokes: finalRevokes },
      });

      return { grants: finalGrants, revokes: finalRevokes };
    });
  }

  /** Mantém só o que é delegável **e** que quem concede também possui. */
  private filterDelegatable(ctx: RequestContext, permissions: string[]): Permission[] {
    return [...new Set(permissions)]
      .filter((p): p is Permission => DELEGATABLE.has(p as Permission))
      .filter((p) => can(ctx, p));
  }
}

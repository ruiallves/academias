import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma, type CalendarEventKind, type Role } from "@prisma/client";
import { PrismaService, type ScopedClient } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";
import { PHOTO_BUCKET, PHOTO_TTL } from "../storage/photos.service";
import { basePermissions, can, ROLE_PERMISSIONS, type Permission, type RequestContext } from "../common/permissions";
import { athleteScopeFilter, teamScopeFilter } from "../common/permissions";

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
  dressingRoom: true,
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
    dressingRoom: e.dressingRoom,
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
  "scouting:read", "scouting:write", "scouting:video:read", "scouting:video:write",
  "scouting:request",
  "member:read", "member:write",
  /*
   * Delegar a criação de papéis é o ponto da funcionalidade: a presidência pode
   * passá-la à direção, ou a uma pessoa em concreto, sem lhe dar mais nada. Não
   * abre escalada nova — `filterDelegatable` continua a exigir que quem concede já
   * tenha o que concede, e `RolesService` aplica a mesma regra outra vez a cada
   * papel que se grava.
   */
  "role:write", "role:menu",
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly config: ConfigService,
  ) {}

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
        select: {
          id: true, slug: true, name: true, shortName: true, city: true,
          signalColor: true, logoUrl: true, billingDueDay: true,
          // A página pública de adesão, escrita pelo clube.
          membershipHeadline: true, membershipIntro: true, membershipPoints: true,
        },
      });

      const [sports, season, me, fundador] = await Promise.all([
        db.sport.findMany({
          orderBy: { name: "asc" },
          select: { id: true, name: true, positions: true, skills: true, dominantSideLabel: true, matchMinutes: true },
        }),
        db.season.findFirst({ where: { isCurrent: true }, select: { id: true, label: true, startsOn: true, endsOn: true } }),
        db.membership.findFirst({
          where: { id: ctx.membershipId },
          select: {
            id: true, role: true, title: true, department: true, grants: true,
            customRole: { select: { key: true } },
            user: { select: { name: true, email: true } },
          },
        }),
        /*
         * Quem abriu o clube.
         *
         * A membership de staff mais antiga: é a que nasceu do convite que a
         * plataforma emitiu. Serve para o painel de arranque saber a quem
         * pertence — ver `setupOwner` abaixo.
         */
        db.membership.findFirst({
          where: { role: { notIn: ["GUARDIAN", "ATHLETE"] } },
          orderBy: { createdAt: "asc" },
          select: { id: true },
        }),
      ]);

      /*
       * A quem pertence o arranque do clube.
       *
       * Duas pessoas, e às vezes uma só: quem entrou primeiro — o coordenador que
       * está a montar tudo — e o presidente, que pode entrar depois e precisa de
       * ver o que já foi feito. Se foi o presidente a entrar primeiro, são a mesma
       * pessoa e só ele o vê.
       *
       * O **progresso** já era partilhado: cada passo é derivado dos dados, por
       * isso os dois vêem sempre o mesmo estado sem nada a sincronizar. O que
       * faltava era isto — a lista aparecia a toda a gente com `settings:write`,
       * incluindo a quem entrou seis meses depois para tratar de outra coisa.
       */
      const setupOwner =
        me?.customRole?.key === "presidente" || (fundador !== null && fundador.id === ctx.membershipId);

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
          /*
           * O papel da academia — e as permissões dele.
           *
           * `permissions` é a lista efectiva do papel, já resolvida pelo servidor:
           * ou a do papel configurado, ou a do papel-base. Sem isto, o cliente
           * teria de manter uma cópia do mapa que a academia acabou de editar, e
           * a navegação passava a mentir no dia seguinte a uma mudança.
           */
          roleId: ctx.roleId,
          roleName: ctx.roleName,
          permissions: basePermissions(ctx),
          /** Menus que o papel mostra. Vazio = todos os que a permissão deixar. */
          navKeys: ctx.navKeys,
          grants: ctx.grants,
          // As retiradas seguem também: sem elas, o cliente calcularia as
          // permissões do próprio utilizador sem descontar o que a direção lhe tirou.
          revokes: ctx.revokes,
          // O âmbito segue para o cliente para ele saber o que **não** tem — e
          // poder dizê-lo em vez de mostrar uma lista vazia sem explicação.
          scope: ctx.scope,
          /** Se o painel de arranque é desta pessoa. Ver `setupOwner` acima. */
          setupOwner,
        },
      };
    });
  }

  /**
   * O que o clube escreve na sua página de adesão a sócio.
   *
   * Exige `settings:write` — é a montra pública do clube, e uma frase mal escrita
   * ali é vista por toda a gente que abre o link. Nulo ou vazio repõe o que o
   * produto traz por omissão, em vez de deixar a página muda.
   */
  async setMembershipCopy(
    ctx: RequestContext,
    dto: { headline?: string; intro?: string; points?: string[] },
  ) {
    if (!can(ctx, "settings:write")) throw new ForbiddenException("Sem permissão para mudar as definições");

    return this.prisma.runAs(ctx.academyId, async (db) => {
      await db.academy.update({
        where: { id: ctx.academyId },
        data: {
          ...(dto.headline !== undefined ? { membershipHeadline: dto.headline.trim() || null } : {}),
          ...(dto.intro !== undefined ? { membershipIntro: dto.intro.trim() || null } : {}),
          ...(dto.points !== undefined
            ? { membershipPoints: dto.points.map((p) => p.trim()).filter(Boolean).slice(0, 6) }
            : {}),
        },
      });

      return { ok: true };
    });
  }

  /**
   * A identidade do clube: a cor e o símbolo.
   *
   * ## Porque é que isto tinha de existir
   *
   * As Definições já mostravam uma paleta de cores, mas escolher uma só escrevia
   * uma variável CSS no browser de quem escolheu — nada era gravado. Fechar o
   * separador desfazia a escolha, e nenhum pai chegava a ver cor nenhuma.
   *
   * ## Onde é que isto vai parar
   *
   * A cor e o símbolo atravessam o produto inteiro: o `manifest.webmanifest` que
   * o pai instala no telemóvel, a landing do clube, a página pública de adesão a
   * sócio, a consola e a app. É o white-label, e é por isso que vive na academia
   * e não numa preferência de utilizador.
   */
  async setIdentity(ctx: RequestContext, dto: { signalColor?: string; logoUrl?: string | null }) {
    if (!can(ctx, "settings:write")) throw new ForbiddenException("Sem permissão para mudar as definições");

    if (dto.signalColor !== undefined && !/^#[0-9a-fA-F]{6}$/.test(dto.signalColor)) {
      throw new BadRequestException("Cor inválida — usa o formato #RRGGBB");
    }

    /*
     * O logótipo só pode ser um endereço nosso.
     *
     * Sem esta verificação, quem tivesse `settings:write` apontava o símbolo do
     * clube para um servidor à escolha — e esse endereço é depois carregado no
     * telemóvel de todas as famílias, a partir do manifest da app. É um vector
     * de rasto (quem carrega vê o IP de cada família) e de troca silenciosa da
     * imagem depois de aprovada.
     */
    if (dto.logoUrl) {
      const supabase = (this.config.get<string>("SUPABASE_URL") ?? "").replace(/\/$/, "");
      const ok = supabase && dto.logoUrl.startsWith(`${supabase}/storage/v1/`);
      if (!ok) throw new BadRequestException("O símbolo tem de ser um ficheiro carregado aqui");
    }

    return this.prisma.runAs(ctx.academyId, async (db) => {
      await db.academy.update({
        where: { id: ctx.academyId },
        data: {
          ...(dto.signalColor !== undefined ? { signalColor: dto.signalColor.toLowerCase() } : {}),
          ...(dto.logoUrl !== undefined ? { logoUrl: dto.logoUrl || null } : {}),
        },
      });

      return { ok: true };
    });
  }

  /* ------------------------------------------------------------------------ */
  /* Desportos                                                                 */
  /* ------------------------------------------------------------------------ */

  /**
   * As modalidades do clube.
   *
   * Eram só de leitura — a consola listava-as e o botão "Editar" não fazia nada,
   * e não havia forma nenhuma de acrescentar uma. Um clube que abrisse com
   * futebol e quisesse juntar futsal não tinha por onde.
   *
   * O desporto é a raiz de mais coisas do que parece: as equipas são de um
   * desporto, os prospectos também, e — desde a migração
   * `20260826090000_cargos_e_desportos` — os escalões, balneários, locais e
   * tipos de evento podem ser de um desporto só. Daí `settings:write` e não
   * `team:write`.
   */
  async createSport(ctx: RequestContext, dto: { name?: string; positions?: string[]; skills?: string[]; dominantSideLabel?: string; matchMinutes?: number }) {
    if (!can(ctx, "settings:write")) throw new ForbiddenException("Sem permissão para mudar as definições");

    const name = (dto.name ?? "").trim();
    if (name.length < 2) throw new BadRequestException("Falta o nome da modalidade");

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const taken = await db.sport.findFirst({ where: { name }, select: { id: true } });
      if (taken) throw new BadRequestException(`"${name}" já existe`);

      return db.sport.create({
        data: {
          academyId: ctx.academyId,
          name,
          positions: clean(dto.positions),
          skills: clean(dto.skills),
          dominantSideLabel: dto.dominantSideLabel?.trim() || null,
          matchMinutes: dto.matchMinutes ?? null,
        },
        select: { id: true, name: true, positions: true, skills: true, dominantSideLabel: true, matchMinutes: true },
      });
    });
  }

  async updateSport(ctx: RequestContext, id: string, dto: { name?: string; positions?: string[]; skills?: string[]; dominantSideLabel?: string; matchMinutes?: number }) {
    if (!can(ctx, "settings:write")) throw new ForbiddenException("Sem permissão para mudar as definições");

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const sport = await db.sport.findFirst({ where: { id }, select: { id: true } });
      if (!sport) throw new NotFoundException("Modalidade não encontrada");

      const name = dto.name?.trim();
      if (name !== undefined && name.length < 2) throw new BadRequestException("Falta o nome da modalidade");

      if (name) {
        const taken = await db.sport.findFirst({ where: { name, id: { not: id } }, select: { id: true } });
        if (taken) throw new BadRequestException(`"${name}" já existe`);
      }

      return db.sport.update({
        where: { id },
        data: {
          ...(name ? { name } : {}),
          ...(dto.positions !== undefined ? { positions: clean(dto.positions) } : {}),
          ...(dto.skills !== undefined ? { skills: clean(dto.skills) } : {}),
          ...(dto.dominantSideLabel !== undefined ? { dominantSideLabel: dto.dominantSideLabel.trim() || null } : {}),
          ...(dto.matchMinutes !== undefined ? { matchMinutes: dto.matchMinutes } : {}),
        },
        select: { id: true, name: true, positions: true, skills: true, dominantSideLabel: true, matchMinutes: true },
      });
    });
  }

  /**
   * Apagar uma modalidade — só enquanto não tiver nada agarrado.
   *
   * Ao contrário dos catálogos, isto apaga mesmo. Mas recusa-se se houver
   * equipas ou prospectos: `onDelete: Cascade` levaria as equipas atrás, e com
   * elas os planteis, as presenças e o histórico — em silêncio, a partir de um
   * botão nas definições. Quem quer mesmo fechar uma modalidade move primeiro as
   * equipas, e isso é trabalho visível.
   */
  async removeSport(ctx: RequestContext, id: string) {
    if (!can(ctx, "settings:write")) throw new ForbiddenException("Sem permissão para mudar as definições");

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const sport = await db.sport.findFirst({
        where: { id },
        select: { id: true, name: true, _count: { select: { teams: true, prospects: true } } },
      });
      if (!sport) throw new NotFoundException("Modalidade não encontrada");

      if (sport._count.teams > 0) {
        throw new BadRequestException(`"${sport.name}" tem ${sport._count.teams} equipa(s). Move-as ou apaga-as primeiro.`);
      }
      if (sport._count.prospects > 0) {
        throw new BadRequestException(`"${sport.name}" tem prospectos de scouting. Trata deles primeiro.`);
      }

      await db.sport.delete({ where: { id } });
      return { ok: true };
    });
  }

  /* ------------------------------------------------------------------------ */

  /**
   * Desactivar ou reactivar uma conta — de staff ou de encarregado.
   *
   * ## Desactivar e não apagar
   *
   * `isActive: false` fecha a porta por completo: o `AuthService` não monta
   * contexto nenhum para uma membership inactiva, e a pessoa deixa de entrar.
   * Mas as presenças que registou, as avaliações que escreveu e as mensalidades
   * que lançou continuam a apontar para alguém com nome — apagar a linha
   * reescrevia o histórico do clube para tapar a saída de um treinador.
   *
   * ## Nunca a si próprio
   *
   * Pela mesma razão que o painel da plataforma o recusa: desactivar-se corta o
   * acesso a meio da sessão, e a única saída seria outra pessoa com poder para
   * reabrir. Um clube com um diretor só ficava trancado fora do próprio produto.
   */
  async setMembershipActive(ctx: RequestContext, membershipId: string, active: boolean) {
    if (!can(ctx, "staff:write")) throw new ForbiddenException("Sem permissão para desactivar contas");

    if (membershipId === ctx.membershipId) {
      throw new ForbiddenException("Não te podes desactivar a ti próprio");
    }

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const target = await db.membership.findFirst({
        where: { id: membershipId },
        select: { id: true, role: true, customRole: { select: { rank: true, key: true } } },
      });
      if (!target) throw new NotFoundException("Pessoa não encontrada");

      /*
       * Não se desactiva acima do próprio nível.
       *
       * A mesma regra dos convites e dos papéis: sem ela, quem tivesse
       * `staff:write` desligava o presidente e ficava dono do clube. O rank vem
       * do cargo quando existe, e do enum quando não — que é o que as
       * memberships antigas ainda usam.
       */
      const targetRank = target.customRole?.rank ?? ROLE_RANK[target.role];
      if (targetRank > ROLE_RANK[ctx.role]) {
        throw new ForbiddenException("Essa pessoa tem um cargo acima do teu");
      }

      await db.membership.update({ where: { id: membershipId }, data: { isActive: active } });
      return { ok: true, isActive: active };
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

      // O preço por omissão de cada equipa — só para quem tem `billing:read`. Um
      // treinador vê a equipa toda sem lhe sair o preço, como o diagnóstico
      // clínico só sai para quem tem `clinical:read`: a mesma leitura, mascarada.
      const feeByTeam = new Map<string, number>();
      if (can(ctx, "billing:read")) {
        const plans = await db.subscriptionPlan.findMany({
          where: { teamId: { in: teams.map((t) => t.id) }, isActive: true },
          select: { teamId: true, amountCents: true },
          orderBy: { id: "desc" },
        });
        // Uma equipa não devia ter mais de um plano activo, mas se tiver (dados
        // antigos, um erro manual) fica o mais recente — a ordenação acima garante
        // que o primeiro que se vê por equipa é sempre esse.
        for (const p of plans) if (p.teamId && !feeByTeam.has(p.teamId)) feeByTeam.set(p.teamId, p.amountCents);
      }

      return teams.map((t) => ({
        id: t.id,
        name: t.name,
        ageGroup: t.ageGroup,
        sportId: t.sportId,
        season: t.season.label,
        schedule: t.schedule,
        athleteCount: t._count.athletes,
        coaches: t.staff.map((s) => ({ id: s.membership.id, name: s.membership.user.name, title: s.title })),
        feeCents: can(ctx, "billing:read") ? (feeByTeam.get(t.id) ?? null) : null,
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
  /**
   * Importar equipas de um ficheiro.
   *
   * ## Porque é que isto engana os erros linha a linha
   *
   * Mesmo padrão da importação de atletas, e pela mesma razão: um ficheiro de
   * trinta equipas em que a linha 12 tem um escalão mal escrito não deve recusar
   * as outras vinte e nove. Cada linha é tentada, e o que falha volta com o
   * número da linha e o motivo — que é o que se cola numa mensagem ao colega que
   * mandou a folha.
   *
   * ## O que se resolve por nome, e porquê
   *
   * A modalidade chega escrita ("Futebol"), não como id: quem exporta um ficheiro
   * de equipas não tem os nossos ids, e obrigá-lo a procurá-los tornava a
   * importação mais lenta do que escrever à mão. O mesmo para a época. Um nome
   * desconhecido é um erro dessa linha, não um id inventado.
   */
  async importTeams(
    ctx: RequestContext,
    rows: { name: string; sport: string; ageGroup: string; season?: string }[],
  ) {
    if (!can(ctx, "team:write")) throw new ForbiddenException("Sem permissão para criar equipas");

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const sports = await db.sport.findMany({ select: { id: true, name: true } });
      const porNome = new Map(sports.map((sp) => [sp.name.trim().toLowerCase(), sp.id]));

      // Nomes já usados, para não recriar uma equipa que já lá está. Uma academia
      // não tem dois "Sub-15 A".
      const existentes = new Set(
        (await db.team.findMany({ select: { name: true } })).map((t) => t.name.trim().toLowerCase()),
      );

      /*
       * A época por omissão, quando o ficheiro não a traz.
       *
       * A actual, se houver; senão a que o calendário desportivo diz que é hoje —
       * Agosto abre época, por isso antes de Agosto ainda se está na anterior.
       * Sem isto, uma coluna vazia criava uma época chamada "" e todas as equipas
       * do ficheiro ficavam lá dentro.
       */
      const atual = await db.season.findFirst({ where: { isCurrent: true }, select: { label: true } });
      const hoje = new Date();
      const anoBase = hoje.getMonth() >= 7 ? hoje.getFullYear() : hoje.getFullYear() - 1;
      const epocaOmissao = atual?.label ?? `${anoBase}/${String((anoBase + 1) % 100).padStart(2, "0")}`;

      const created: { id: string; name: string }[] = [];
      const errors: { row: number; name: string; error: string }[] = [];

      for (const [i, row] of rows.entries()) {
        const line = i + 2; // +1 pela base-0, +1 pelo cabeçalho do ficheiro
        const name = (row.name ?? "").trim();

        if (name.length < 2) {
          errors.push({ row: line, name, error: "Falta o nome da equipa" });
          continue;
        }
        if (existentes.has(name.toLowerCase())) {
          errors.push({ row: line, name, error: "Já existe uma equipa com este nome" });
          continue;
        }

        const sportId = porNome.get((row.sport ?? "").trim().toLowerCase());
        if (!sportId) {
          errors.push({
            row: line,
            name,
            error: sports.length === 0
              ? "A academia ainda não tem modalidades — cria uma nas Definições"
              : `Modalidade "${row.sport}" não existe. Há: ${sports.map((sp) => sp.name).join(", ")}`,
          });
          continue;
        }

        const ageGroup = (row.ageGroup ?? "").trim();
        if (!ageGroup) {
          errors.push({ row: line, name, error: "Falta o escalão" });
          continue;
        }

        try {
          const season = await this.resolveSeason(db, ctx.academyId, (row.season ?? "").trim() || epocaOmissao);
          const team = await db.team.create({
            data: {
              academyId: ctx.academyId,
              name,
              sportId,
              ageGroup,
              seasonId: season.id,
              schedule: [],
            },
            select: { id: true, name: true },
          });
          created.push(team);
          existentes.add(name.toLowerCase());
        } catch (e) {
          errors.push({ row: line, name, error: e instanceof Error ? e.message : "Não foi possível criar" });
        }
      }

      return { created: created.length, errors, teams: created };
    });
  }

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
        // Sem preço à nascença — configura-se depois, em `PATCH /api/teams/:id/fee`.
        feeCents: null as number | null,
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
    const athleteScope = athleteScopeFilter(ctx);

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

    /*
     * O NIF do atleta só para quem **trata** de famílias, e não para quem as vê.
     *
     * Era `family:read`, e isso funcionava enquanto o treinador não tinha essa
     * permissão. Passou a ter — precisa da lista de encarregados das equipas dele —
     * e sem esta mudança o número de contribuinte de uma criança começava a viajar
     * para o telemóvel de toda a gente que treina, sem ninguém ter decidido isso.
     *
     * `family:write` é quem edita a ficha da família: direcção, e a secretaria a
     * quem o clube der o cargo. Esses precisam do NIF porque é com ele que emitem
     * recibos. Um treinador não precisa dele para escalar uma equipa.
     *
     * A app do pai também não o recebe: ele já o sabe, e mandá-lo para o telemóvel
     * é espalhá-lo por mais um sítio sem nada em troca.
     */
    const mayReadTaxId = can(ctx, "family:write");

    const rows = await this.prisma.runAs(ctx.academyId, async (db) => {
      const athletes = await db.athlete.findMany({
        /*
         * Os dois âmbitos cruzam-se aqui.
         *
         * O de equipa serve o treinador (os atletas das equipas dele); o de
         * atleta serve a família (só os próprios filhos). Um encarregado tem os
         * dois preenchidos — as equipas dos filhos e os filhos — e é o segundo
         * que impede a app do pai de listar os colegas do filho.
         */
        where: {
          ...(scope ? { teams: { some: { teamId: scope } } } : {}),
          ...(athleteScope ? { id: athleteScope } : {}),
        },
        orderBy: { name: "asc" },
        select: {
          id: true, name: true, birthdate: true, photoUrl: true, photoKey: true, status: true, joinedAt: true, taxId: true,
          heightCm: true, weightKg: true, dominantSide: true, squadNumber: true, medicalValidUntil: true,
          teams: { select: { teamId: true, position: true }, take: 1 },
          guardians: {
            select: {
              relation: true, isPayer: true,
              membership: { select: { id: true, isActive: true, user: { select: { name: true, email: true, phone: true } } } },
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
          taxId: mayReadTaxId ? a.taxId : null,
          photoKey: a.photoKey,
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
            isActive: g.membership.isActive,
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

    return this.withPhotos(rows);
  }

  /**
   * Troca as chaves de armazenamento por links assinados.
   *
   * ## Porque é que isto corre **fora** da transação
   *
   * Porque assinar é uma ida ao Supabase pela rede, e uma transação aberta segura
   * uma ligação do pool. O pool tem cinco (`connection_limit=5`): trinta atletas a
   * assinar dentro da transação seguravam essa ligação durante todo o tempo dos
   * pedidos HTTP, e bastavam cinco listas ao mesmo tempo para o sexto pedido morrer
   * em `P2028 — Unable to start a transaction in the given time`.
   *
   * Era exactamente isso que estava a acontecer, e o sintoma não era esta lista: era
   * tudo o resto a ficar pendurado, porque o `AuthGuard` também precisa de uma
   * transação para montar o contexto de cada pedido.
   *
   * A regra que fica: **dentro de `runAs` só há base de dados**. Rede é sempre
   * depois de a transação fechar.
   */
  private async withPhotos<T extends { photoKey: string | null; photoUrl?: string | null }>(
    rows: T[],
  ): Promise<(Omit<T, "photoKey"> & { photoUrl: string | null })[]> {
    const signed = await this.storage.signMany(
      PHOTO_BUCKET,
      rows.map((r) => r.photoKey).filter((k): k is string => Boolean(k)),
      PHOTO_TTL,
    );

    return rows.map(({ photoKey, ...rest }) => ({
      ...(rest as Omit<T, "photoKey">),
      // A chave ganha ao URL externo: é a que passou pela nossa validação.
      photoUrl: (photoKey ? signed.get(photoKey) : null) ?? (rest as { photoUrl?: string | null }).photoUrl ?? null,
    }));
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

    const rows = await this.prisma.runAs(ctx.academyId, async (db) => {
      const rows = await db.membership.findMany({
        where: { role: { notIn: ["GUARDIAN", "ATHLETE"] } },
        orderBy: [{ department: "asc" }, { createdAt: "asc" }],
        select: {
          id: true, role: true, title: true, department: true, isActive: true, grants: true, revokes: true, createdAt: true,
          customRoleId: true,
          customRole: { select: { name: true } },
          user: { select: { name: true, email: true, phone: true, photoKey: true } },
          coachOf: { select: { teamId: true, title: true } },
        },
      });

      return rows.map((m) => ({
        id: m.id,
        name: m.user.name,
        email: m.user.email,
        phone: m.user.phone,
        photoKey: m.user.photoKey,
        role: m.role,
        roleId: m.customRoleId,
        roleName: m.customRole?.name ?? null,
        title: m.title,
        department: m.department,
        isActive: m.isActive,
        grants: m.grants,
        revokes: m.revokes,
        since: m.createdAt,
        teamIds: m.coachOf.map((t) => t.teamId),
      }));
    });

    return this.withPhotos(rows);
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
          id: true, teamId: true, startsAt: true, endsAt: true, venue: true, dressingRoom: true, status: true,
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
        dressingRoom: s.dressingRoom,
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
  /**
   * Marcar um evento — uma vez, ou repetido.
   *
   * ## Porque é que a repetição cria ocorrências a sério
   *
   * Um treino às terças e quintas até ao fim da época podia ser uma linha com uma
   * regra, expandida à leitura. Não é: cada ocorrência é uma linha própria.
   *
   * A razão é o que acontece a seguir. Um treino abre folha de presenças, um jogo
   * tem convocatória — e essas pertencem a **um dia**, não a uma regra. Com uma
   * regra, marcar faltas obrigaria a materializar a ocorrência na primeira vez que
   * alguém lhe tocasse, e metade do calendário passava a existir em dois estados.
   *
   * De lambuja, resolve o caso normal: chove na quinta, o treinador desmarca
   * **aquele** treino, e os outros não sabem disso. Com uma regra, cancelar um dia
   * é uma excepção a guardar à parte — a parte mais confusa de qualquer calendário.
   *
   * O preço é não haver "editar todos os futuros". Para um clube que marca a época
   * de uma vez e depois ajusta pontualmente, é o negócio certo.
   */
  async createEvent(
    ctx: RequestContext,
    dto: {
      kind: string;
      teamId?: string;
      title: string;
      startsAt: string;
      endsAt: string;
      venue: string;
      dressingRoom?: string;
      opponent?: string;
      isHome?: boolean;
      repeat?: { freq: "DAILY" | "WEEKLY" | "MONTHLY"; until: string; weekdays?: number[] };
    },
  ) {
    if (!can(ctx, "calendar:write")) throw new ForbiddenException("Sem permissão para criar eventos");

    if (!dto.repeat) {
      const one = await this.createSingleEvent(ctx, dto);
      return { created: 1, skipped: 0, events: [one] };
    }

    const datas = occurrences(dto.startsAt, dto.endsAt, dto.repeat);

    /*
     * Os conflitos não param a série.
     *
     * Marcar terças e quintas até Junho vai bater num dia em que já há treino —
     * e recusar tudo por causa desse obrigava a descobrir qual, apagá-lo, e
     * começar de novo. Salta-se o dia ocupado, contam-se os saltos, e diz-se
     * quantos foram. O treinador vê "criei 22, saltei 2" e sabe exactamente o que
     * aconteceu.
     */
    const events: unknown[] = [];
    let skipped = 0;

    for (const [startsAt, endsAt] of datas) {
      try {
        events.push(await this.createSingleEvent(ctx, { ...dto, startsAt, endsAt }));
      } catch (e) {
        if (e instanceof BadRequestException) {
          skipped++;
          continue;
        }
        throw e;
      }
    }

    if (events.length === 0) {
      throw new BadRequestException("Nenhuma data ficou livre — já há eventos marcados em todas elas.");
    }

    return { created: events.length, skipped, events };
  }

  /** Um evento, numa data. É aqui que vive tudo o que decide em que tabela grava. */
  private async createSingleEvent(
    ctx: RequestContext,
    dto: {
      kind: string;
      teamId?: string;
      title: string;
      startsAt: string;
      endsAt: string;
      venue: string;
      dressingRoom?: string;
      opponent?: string;
      isHome?: boolean;
    },
  ) {
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

      /*
       * Um jogo não é um evento genérico — é um `Match`.
       *
       * Marcar um jogo no calendário e não o encontrar depois em Convocatórias era
       * o sintoma de os dois ecrãs lerem tabelas diferentes: o calendário escrevia
       * `CalendarEvent`, as convocatórias liam `Match`. Um jogo tem adversário,
       * convocatória e resultado, e essa é a tabela que os guarda — por isso é lá
       * que passa a ser gravado, e o calendário lê as duas fontes.
       */
      if (dto.kind === "MATCH") {
        if (!dto.teamId) throw new BadRequestException("Um jogo é sempre de uma equipa");
        if (!dto.opponent?.trim()) throw new BadRequestException("Um jogo precisa de adversário");

        // A mesma equipa não joga duas vezes à mesma hora — mas um jogo cancelado
        // não ocupa o horário (ver a migração `cancelled_match_frees_slot`). Sem
        // esta verificação o Prisma rebentava com um P2002 opaco.
        const clash = await db.match.findFirst({
          where: { teamId: dto.teamId, startsAt, status: { not: "CANCELLED" } },
          select: { id: true },
        });
        if (clash) throw new BadRequestException("Esta equipa já tem um jogo marcado a esta hora");

        const match = await db.match.create({
          data: {
            academyId: ctx.academyId,
            teamId: dto.teamId,
            startsAt,
            endsAt,
            venue: dto.venue.trim(),
            opponent: dto.opponent.trim(),
            isHome: dto.isHome ?? true,
          },
          select: {
            id: true, teamId: true, startsAt: true, endsAt: true, venue: true,
            opponent: true, isHome: true, status: true,
            coach: { select: { id: true, user: { select: { name: true } } } },
          },
        });

        // Devolvido na forma de evento: quem chamou pediu um evento do calendário
        // e não tem de saber que por baixo isto é outra tabela.
        return {
          id: match.id,
          teamId: match.teamId,
          kind: "MATCH" as const,
          title: `${match.isHome ? "vs" : "@"} ${match.opponent}`,
          startsAt: match.startsAt,
          endsAt: match.endsAt,
          venue: match.venue,
          dressingRoom: null,
          cancelled: match.status === "CANCELLED",
          coachId: match.coach?.id ?? null,
          coachName: match.coach?.user.name ?? null,
        };
      }

      /*
       * Um treino também não é um evento genérico — é uma `TrainingSession`.
       *
       * ## O que estava partido
       *
       * Marcar um treino no calendário escrevia `CalendarEvent`. Mas quem lê
       * treinos lê `TrainingSession`: as Presenças, para abrir a folha de faltas,
       * e **a app da família**, que nem sequer pede `/api/events`. O resultado era
       * um treino que o treinador via no calendário, que não abria folha de
       * presenças nenhuma, e que nenhum pai chegava a ver. Os treinos que as
       * famílias viam eram só os que vinham do horário da equipa.
       *
       * É exactamente o mesmo sintoma que os jogos já tinham tido, e a correcção é
       * a mesma: escrever na tabela rica. `CalendarEvent` fica para o que é mesmo
       * genérico — um estágio, uma reunião de pais, um torneio.
       *
       * ## Porque é que exige equipa
       *
       * Porque `TrainingSession.teamId` não é opcional, e com razão: um treino sem
       * plantel não tem quem faltar. "Toda a academia" continua a existir para os
       * outros tipos de evento, onde faz sentido.
       */
      if (dto.kind === "TRAINING") {
        if (!dto.teamId) throw new BadRequestException("Um treino é sempre de uma equipa");

        const clash = await db.trainingSession.findFirst({
          where: { teamId: dto.teamId, startsAt, status: { not: "CANCELLED" } },
          select: { id: true },
        });
        if (clash) throw new BadRequestException("Esta equipa já tem um treino marcado a esta hora");

        const session = await db.trainingSession.create({
          data: {
            academyId: ctx.academyId,
            teamId: dto.teamId,
            startsAt,
            endsAt,
            venue: dto.venue.trim(),
            dressingRoom: dto.dressingRoom?.trim() || null,
          },
          select: {
            id: true, teamId: true, startsAt: true, endsAt: true, venue: true,
            dressingRoom: true, status: true,
            coach: { select: { id: true, user: { select: { name: true } } } },
          },
        });

        // Devolvido na forma de evento: quem chamou pediu um evento do calendário
        // e não tem de saber que por baixo isto é outra tabela. Mesma cortesia
        // que os jogos.
        return {
          id: session.id,
          teamId: session.teamId,
          kind: "TRAINING" as const,
          title: dto.title.trim(),
          startsAt: session.startsAt,
          endsAt: session.endsAt,
          venue: session.venue,
          dressingRoom: session.dressingRoom,
          cancelled: session.status === "CANCELLED",
          coachId: session.coach?.id ?? null,
          coachName: session.coach?.user.name ?? null,
        };
      }

      const created = await db.calendarEvent.create({
        data: {
          academyId: ctx.academyId,
          kind: dto.kind as CalendarEventKind,
          title: dto.title.trim(),
          startsAt,
          endsAt,
          venue: dto.venue.trim(),
          dressingRoom: dto.dressingRoom?.trim() || null,
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

      /*
       * Um jogo vive em `Match`, e o calendário mostra os dois lado a lado — por
       * isso o mesmo botão de cancelar tem de saber alcançar ambos. Sem este
       * ramo, cancelar um jogo no calendário respondia "evento não encontrado":
       * o id existia, mas na outra tabela.
       *
       * Cancelar não apaga: `MatchStatus.CANCELLED` mantém o jogo (e a
       * convocatória que já tivesse) visível e reactivável, como no evento
       * genérico. Um jogo já disputado não se cancela — o resultado aconteceu.
       */
      if (!ev) {
        /*
         * Um treino vive em `TrainingSession` desde que deixou de ser gravado
         * como evento genérico. O mesmo botão de cancelar tem de o alcançar —
         * senão cancelar um treino no calendário responderia "evento não
         * encontrado", que foi exactamente o que aconteceu com os jogos.
         *
         * Cancelar não apaga: o treino continua visível e riscado, e as presenças
         * já registadas ficam. Um treino que aconteceu e foi registado não se
         * desmarca — apagá-lo reescreveria a assiduidade de quem lá esteve.
         */
        const training = await db.trainingSession.findFirst({
          where: { id },
          select: { id: true, teamId: true, status: true, attendanceClosedAt: true },
        });
        if (training) {
          if (scope && !scope.in.includes(training.teamId)) {
            throw new ForbiddenException("Evento fora do teu âmbito");
          }
          if (training.attendanceClosedAt) {
            throw new BadRequestException("Um treino com presenças registadas não se desmarca");
          }

          const updated = await db.trainingSession.update({
            where: { id },
            data: { status: cancelled ? "CANCELLED" : "SCHEDULED" },
            select: {
              id: true, teamId: true, startsAt: true, endsAt: true, venue: true,
              dressingRoom: true, status: true,
              coach: { select: { id: true, user: { select: { name: true } } } },
            },
          });

          return {
            id: updated.id,
            teamId: updated.teamId,
            kind: "TRAINING" as const,
            title: "Treino",
            startsAt: updated.startsAt,
            endsAt: updated.endsAt,
            venue: updated.venue,
            dressingRoom: updated.dressingRoom,
            cancelled: updated.status === "CANCELLED",
            coachId: updated.coach?.id ?? null,
            coachName: updated.coach?.user.name ?? null,
          };
        }

        const match = await db.match.findFirst({
          where: { id },
          select: { id: true, teamId: true, status: true, startsAt: true },
        });
        if (!match) throw new NotFoundException("Evento não encontrado");
        if (scope && !scope.in.includes(match.teamId)) {
          throw new ForbiddenException("Evento fora do teu âmbito");
        }
        if (match.status === "PLAYED") {
          throw new BadRequestException("Um jogo já disputado não se cancela");
        }

        // Reactivar devolve o jogo ao horário — que pode ter sido ocupado por
        // outro entretanto, precisamente por o cancelamento o ter libertado.
        // Sem isto, o índice único parcial rebentava com um P2002 opaco.
        if (!cancelled) {
          const taken = await db.match.findFirst({
            where: {
              teamId: match.teamId,
              startsAt: match.startsAt,
              status: { not: "CANCELLED" },
              id: { not: id },
            },
            select: { opponent: true },
          });
          if (taken) {
            throw new BadRequestException(
              `Não dá para reactivar: a equipa já tem um jogo com ${taken.opponent} a esta hora.`,
            );
          }
        }

        const updated = await db.match.update({
          where: { id },
          data: { status: cancelled ? "CANCELLED" : "SCHEDULED" },
          select: {
            id: true, teamId: true, startsAt: true, endsAt: true, venue: true,
            opponent: true, isHome: true, status: true,
            coach: { select: { id: true, user: { select: { name: true } } } },
          },
        });

        return {
          id: updated.id,
          teamId: updated.teamId,
          kind: "MATCH" as const,
          title: `${updated.isHome ? "vs" : "@"} ${updated.opponent}`,
          startsAt: updated.startsAt,
          endsAt: updated.endsAt,
          venue: updated.venue,
          dressingRoom: null,
          cancelled: updated.status === "CANCELLED",
          coachId: updated.coach?.id ?? null,
          coachName: updated.coach?.user.name ?? null,
        };
      }

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
    // Dinheiro é o mais pessoal que aqui há: um encarregado vê as mensalidades
    // dos filhos e de mais ninguém, mesmo tendo âmbito nas equipas deles.
    const athleteScope = athleteScopeFilter(ctx);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const rows = await db.charge.findMany({
        where: {
          ...(period ? { period } : {}),
          ...(scope ? { athlete: { teams: { some: { teamId: scope } } } } : {}),
          ...(athleteScope ? { athleteId: athleteScope } : {}),
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

/* ---------------------------------------------------------------------------- */

/**
 * A hierarquia, outra vez.
 *
 * Gémeo do `RANK` de `invites.service.ts` e de `roles.service.ts`. Duplicado de
 * propósito e não importado: são três módulos com fronteiras próprias, e uma
 * dependência entre eles só para partilhar nove números seria pior do que os
 * nove números. Se um dia divergirem, o teste `test:security` apanha-o.
 */
const ROLE_RANK: Record<Role, number> = {
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

/**
 * Quantas ocorrências uma série pode ter.
 *
 * Uma época inteira de treinos três vezes por semana dá umas 130. Duzentos é
 * folgado para isso e trava o pedido que pede diariamente durante cinco anos —
 * que seriam 1800 linhas escritas por engano num formulário.
 */
const MAX_OCCURRENCES = 200;

/**
 * As datas de uma série.
 *
 * Devolve pares `[início, fim]` em ISO, preservando a duração e a hora do
 * primeiro evento. A aritmética é feita em data local e não em UTC de propósito:
 * um treino às 19h continua às 19h depois da mudança da hora, que é o que um
 * clube espera — em UTC passaria a 18h ou 20h a meio da época.
 */
function occurrences(
  startsAt: string,
  endsAt: string,
  repeat: { freq: "DAILY" | "WEEKLY" | "MONTHLY"; until: string; weekdays?: number[] },
): [string, string][] {
  const inicio = new Date(startsAt);
  const fim = new Date(endsAt);
  const ate = new Date(repeat.until);

  if ([inicio, fim, ate].some((d) => Number.isNaN(d.getTime()))) {
    throw new BadRequestException("Datas inválidas");
  }
  if (fim <= inicio) throw new BadRequestException("O fim tem de ser depois do início");
  if (ate < inicio) throw new BadRequestException("A repetição tem de acabar depois do primeiro evento");

  // A duração viaja com a série: um treino de 90 minutos continua com 90 minutos
  // em todas as ocorrências, mesmo as que caem noutro mês.
  const duracao = fim.getTime() - inicio.getTime();

  // Até ao fim do dia escolhido: quem escreve "até 30 de Junho" quer o dia 30
  // incluído, não a meia-noite que o abre.
  const limite = new Date(ate);
  limite.setHours(23, 59, 59, 999);

  const dias = repeat.freq === "WEEKLY" && repeat.weekdays?.length ? new Set(repeat.weekdays) : null;

  const out: [string, string][] = [];
  const cursor = new Date(inicio);

  while (cursor <= limite && out.length < MAX_OCCURRENCES) {
    /*
     * O mensal verifica o dia, e não é redundante.
     *
     * Quando um mês não tem o dia pretendido — 31 de Fevereiro — o cursor é
     * empurrado para o dia 1 do mês seguinte para continuar a contar. Sem esta
     * verificação, esse dia 1 era emitido como se fosse uma ocorrência: uma série
     * a começar a 31 de Janeiro dava 31/01, **01/02**, 31/03, **01/04**.
     */
    const serve =
      repeat.freq === "WEEKLY" && dias
        ? dias.has(cursor.getDay())
        : repeat.freq === "MONTHLY"
          ? cursor.getDate() === inicio.getDate()
          : true;
    if (serve) {
      out.push([new Date(cursor).toISOString(), new Date(cursor.getTime() + duracao).toISOString()]);
    }

    if (repeat.freq === "MONTHLY") {
      /*
       * Mês a mês, e o dia 31 é o caso que estraga isto.
       *
       * `setMonth` sobre 31 de Janeiro dá 3 de Março — o JavaScript transborda em
       * silêncio. Guardar o dia pretendido e reconstruir a data de raiz mantém a
       * série no dia certo e salta os meses que não o têm, que é o que um humano
       * faria com um calendário à frente.
       */
      const diaPretendido = inicio.getDate();
      const proximo = new Date(cursor);
      proximo.setDate(1);
      proximo.setMonth(proximo.getMonth() + 1);
      const ultimoDia = new Date(proximo.getFullYear(), proximo.getMonth() + 1, 0).getDate();
      if (diaPretendido > ultimoDia) {
        // Fevereiro não tem 31: salta-se o mês em vez de o empurrar para Março.
        cursor.setTime(proximo.getTime());
        continue;
      }
      proximo.setDate(diaPretendido);
      proximo.setHours(inicio.getHours(), inicio.getMinutes(), 0, 0);
      cursor.setTime(proximo.getTime());
    } else {
      // Diário e semanal andam de um dia: o semanal filtra pelos dias escolhidos
      // acima, o que também cobre "de duas em duas semanas" quando vier a ser
      // preciso — passa a ser um filtro, não outro ramo.
      cursor.setDate(cursor.getDate() + 1);
    }
  }

  if (out.length === 0) throw new BadRequestException("A repetição não gerou nenhuma data");
  return out;
}

/** Lista de texto do cliente: sem vazios, sem repetidos, sem espaços à volta. */
function clean(values?: string[]): string[] {
  return [...new Set((values ?? []).map((v) => v.trim()).filter(Boolean))].slice(0, 40);
}

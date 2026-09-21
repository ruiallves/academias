import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { PrismaService, type ScopedClient } from "../prisma/prisma.service";
import { can, type RequestContext } from "../common/permissions";
import { currentSeason } from "../common/seasons";

/**
 * A viragem de época: fechar a que acaba e montar a que começa.
 *
 * ## Porque é que não há data fixa
 *
 * Cada clube arranca quando quer — um em Agosto, outro em Setembro, e um clube
 * de futsal noutro mês qualquer. Uma data no código fazia a época virar sozinha
 * no dia errado para quase toda a gente, e virar uma época mexe em tudo:
 * equipas, plantéis, treinadores e preços. Por isso é um **botão**, nas
 * Definições, e nada acontece sem alguém carregar nele.
 *
 * ## O que a viragem faz, e o que não faz
 *
 * Faz: cria a época nova, copia os escalões, move os atletas (subindo quem
 * passou a idade), leva os treinadores atrás e copia os preços das mensalidades.
 * Não faz: apagar seja o que for. A época que acaba fica inteira — jogos,
 * treinos, mensalidades, avaliações — e é isso que permite ler o percurso de
 * cada pessoa depois.
 *
 * ## A regra da idade
 *
 * A das federações: conta a idade a **31 de Dezembro do ano em que a época
 * começa**. Na época 2027/28 o Sub-15 leva quem tiver 15 anos ou menos a
 * 31/12/2027 — na prática, o ano de nascimento manda, e quem nasceu no mesmo
 * ano anda junto. É por isso que a conta é uma subtracção de anos e não uma
 * diferença de datas: um miúdo que faz anos em Novembro não fica atrás dos
 * colegas por causa de um dia.
 */
@Injectable()
export class SeasonsService {
  private readonly log = new Logger(SeasonsService.name);

  constructor(private readonly prisma: PrismaService) {}

  private mustWrite(ctx: RequestContext) {
    if (!can(ctx, "academy:write")) throw new ForbiddenException("Só a direção vira a época do clube");
  }

  /**
   * O que a época nova seria, se fosse agora.
   *
   * Tudo o que o assistente precisa numa leitura só: a época em curso, a
   * proposta de nome e datas para a seguinte, os escalões a copiar, e cada
   * atleta com a sugestão de onde fica. Nada disto grava nada.
   */
  async proposta(ctx: RequestContext) {
    if (!can(ctx, "academy:read")) throw new ForbiddenException();

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const actual = await currentSeason(db);
      if (!actual) throw new NotFoundException("Este clube ainda não tem época nenhuma");

      const anoNovo = actual.startsOn.getUTCFullYear() + 1;
      const equipas = await db.team.findMany({
        where: { seasonId: actual.id },
        orderBy: [{ maxAge: "asc" }, { name: "asc" }],
        select: {
          id: true, name: true, maxAge: true, sportId: true,
          sport: { select: { name: true } },
          staff: { where: { leftAt: null }, select: { membership: { select: { user: { select: { name: true } } } } } },
          _count: { select: { athletes: { where: { leftAt: null } } } },
        },
      });

      /* O preço de cada escalão, para o assistente o mostrar e deixar mudar. */
      const planos = await db.subscriptionPlan.findMany({
        where: { teamId: { in: equipas.map((t) => t.id) }, isActive: true },
        orderBy: { id: "desc" },
        select: { teamId: true, amountCents: true },
      });
      const precoDe = new Map<string, number>();
      for (const p of planos) if (p.teamId && !precoDe.has(p.teamId)) precoDe.set(p.teamId, p.amountCents);

      const atletas = await db.athlete.findMany({
        where: { status: { not: "LEFT" }, teams: { some: { leftAt: null } } },
        orderBy: { name: "asc" },
        select: {
          id: true, name: true, birthdate: true, status: true, photoKey: true,
          teams: { where: { leftAt: null }, select: { teamId: true, position: true }, take: 1 },
        },
      });

      const porEscalao = new Map(equipas.map((t) => [t.id, t]));
      return {
        actual,
        sugestao: {
          label: proximoRotulo(actual.label, anoNovo),
          startsOn: maisUmAno(actual.startsOn),
          endsOn: maisUmAno(actual.endsOn),
        },
        equipas: equipas.map((t) => ({
          id: t.id,
          name: t.name,
          maxAge: t.maxAge,
          sportId: t.sportId,
          sportName: t.sport.name,
          atletas: t._count.athletes,
          treinadores: t.staff.map((s) => s.membership.user.name),
          amountCents: precoDe.get(t.id) ?? null,
        })),
        atletas: atletas.map((a) => {
          const daEquipa = a.teams[0] ? porEscalao.get(a.teams[0].teamId) : undefined;
          const idade = anoNovo - a.birthdate.getUTCFullYear();
          const destino = sugerirEscalao(equipas, daEquipa, idade);
          return {
            id: a.id,
            name: a.name,
            status: a.status,
            idadeNaEpoca: idade,
            teamId: daEquipa?.id ?? null,
            teamName: daEquipa?.name ?? null,
            /** A equipa **da época actual** para onde a sugestão aponta. */
            sugestaoTeamId: destino?.id ?? null,
            sobe: Boolean(destino && daEquipa && destino.id !== daEquipa.id),
            semEscalao: destino === null,
          };
        }),
      };
    });
  }

  /**
   * O percurso de um atleta: por onde passou, e quando.
   *
   * Uma linha por passagem, da mais recente para a mais antiga, com a época a
   * que o escalão pertencia. A passagem aberta é o presente; as fechadas são o
   * que este produto nunca teve e que qualquer clube pergunta: "este miúdo veio
   * de onde?".
   */
  async percursoDoAtleta(ctx: RequestContext, athleteId: string) {
    if (!can(ctx, "athlete:read")) throw new ForbiddenException();

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const atleta = await db.athlete.findFirst({ where: { id: athleteId }, select: { id: true } });
      if (!atleta) throw new NotFoundException("Atleta não encontrado");

      const passagens = await db.teamMembership.findMany({
        where: { athleteId },
        orderBy: [{ joinedAt: "desc" }],
        select: {
          joinedAt: true, leftAt: true, position: true,
          team: { select: { id: true, name: true, maxAge: true, season: { select: { label: true } } } },
        },
      });

      return passagens.map((p) => ({
        teamId: p.team.id,
        teamName: p.team.name,
        maxAge: p.team.maxAge,
        season: p.team.season.label,
        position: p.position,
        joinedAt: p.joinedAt,
        leftAt: p.leftAt,
      }));
    });
  }

  /** O mesmo para um treinador: que equipas treinou, e quando. */
  async percursoDoStaff(ctx: RequestContext, membershipId: string) {
    if (!can(ctx, "team:read")) throw new ForbiddenException();

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const passagens = await db.teamStaff.findMany({
        where: { membershipId },
        orderBy: [{ joinedAt: "desc" }],
        select: {
          title: true, joinedAt: true, leftAt: true,
          team: { select: { id: true, name: true, season: { select: { label: true } } } },
        },
      });

      return passagens.map((p) => ({
        teamId: p.team.id,
        teamName: p.team.name,
        season: p.team.season.label,
        title: p.title,
        joinedAt: p.joinedAt,
        leftAt: p.leftAt,
      }));
    });
  }

  /**
   * Quem passou por uma equipa, e de onde a equipa veio.
   *
   * Uma equipa vive numa época — o Sub-13 de 2026/27 e o de 2027/28 são duas
   * linhas — e `previousTeamId` liga-as. Isto devolve as duas coisas: a
   * linhagem para trás, e todas as passagens por esta equipa (as abertas e as
   * fechadas, que são quem saiu a meio).
   */
  async percursoDaEquipa(ctx: RequestContext, teamId: string) {
    if (!can(ctx, "team:read")) throw new ForbiddenException();

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const equipa = await db.team.findFirst({
        where: { id: teamId },
        select: {
          id: true, name: true,
          season: { select: { label: true } },
          previousTeam: { select: { id: true, name: true, season: { select: { label: true } } } },
        },
      });
      if (!equipa) throw new NotFoundException("Equipa não encontrada");

      const [atletas, staff] = await Promise.all([
        db.teamMembership.findMany({
          where: { teamId },
          orderBy: [{ leftAt: "asc" }, { joinedAt: "asc" }],
          select: {
            joinedAt: true, leftAt: true, position: true,
            athlete: { select: { id: true, name: true, status: true } },
          },
        }),
        db.teamStaff.findMany({
          where: { teamId },
          orderBy: [{ leftAt: "asc" }, { joinedAt: "asc" }],
          select: {
            title: true, joinedAt: true, leftAt: true,
            membership: { select: { id: true, user: { select: { name: true } } } },
          },
        }),
      ]);

      return {
        team: { id: equipa.id, name: equipa.name, season: equipa.season.label },
        veioDe: equipa.previousTeam
          ? { id: equipa.previousTeam.id, name: equipa.previousTeam.name, season: equipa.previousTeam.season.label }
          : null,
        atletas: atletas.map((a) => ({
          id: a.athlete.id,
          name: a.athlete.name,
          status: a.athlete.status,
          position: a.position,
          joinedAt: a.joinedAt,
          leftAt: a.leftAt,
        })),
        treinadores: staff.map((s) => ({
          membershipId: s.membership.id,
          name: s.membership.user.name,
          title: s.title,
          joinedAt: s.joinedAt,
          leftAt: s.leftAt,
        })),
      };
    });
  }

  /**
   * Virar a época: uma escrita só, e ou corre tudo ou não corre nada.
   *
   * O que chega do cliente é a decisão de quem carregou no botão — que escalões
   * transitam, para onde vai cada atleta, que preços leva cada equipa. O que
   * não chega do cliente é o que se pode inventar aqui: os ids das equipas
   * novas, as datas de entrada e de saída de cada passagem, e a cópia dos
   * treinadores.
   */
  async virar(
    ctx: RequestContext,
    dto: {
      label: string;
      startsOn: string;
      endsOn: string;
      equipas: { fromTeamId: string; name?: string; amountCents?: number | null; manterStaff?: boolean }[];
      atletas: { athleteId: string; destino: string }[];
    },
  ) {
    this.mustWrite(ctx);

    const label = dto.label.trim();
    if (label.length < 4) throw new BadRequestException("Falta o nome da época");
    const inicio = new Date(`${dto.startsOn}T00:00:00.000Z`);
    const fim = new Date(`${dto.endsOn}T00:00:00.000Z`);
    if (Number.isNaN(inicio.getTime()) || Number.isNaN(fim.getTime())) throw new BadRequestException("Datas inválidas");
    if (fim <= inicio) throw new BadRequestException("A época tem de acabar depois de começar");
    if (dto.equipas.length === 0) throw new BadRequestException("Escolhe pelo menos um escalão para transitar");

    return this.prisma.runAs(
      ctx.academyId,
      async (db) => {
        const jaExiste = await db.season.findFirst({ where: { label }, select: { id: true } });
        if (jaExiste) throw new BadRequestException(`Já existe uma época chamada "${label}"`);

        const antigas = await db.team.findMany({
          where: { id: { in: dto.equipas.map((e) => e.fromTeamId) } },
          select: {
            id: true, name: true, maxAge: true, sportId: true, schedule: true,
            maxCallUps: true, matchMinutes: true, seasonId: true,
          },
        });
        if (antigas.length !== dto.equipas.length) throw new BadRequestException("Equipa desconhecida");

        /*
         * O instante da viragem, e não o início da época.
         *
         * Um clube que vira em Junho para uma época que começa em Agosto não
         * pode ficar com os miúdos em dois plantéis nesses dois meses: as
         * passagens datadas no futuro apareciam todas abertas ao mesmo tempo.
         * Quem carrega no botão está a dizer "a partir de agora é assim", e é
         * isso que fica escrito.
         */
        const agora = new Date();

        /* A época nova passa a ser a corrente, e só uma pode estar marcada. */
        await db.season.updateMany({ where: { isCurrent: true }, data: { isCurrent: false } });
        const season = await db.season.create({
          data: { academyId: ctx.academyId, label, startsOn: inicio, endsOn: fim, isCurrent: true },
          select: { id: true, label: true },
        });

        /* Os escalões, com a linhagem a dizer de onde vieram. */
        const novaDe = new Map<string, string>();
        for (const pedido of dto.equipas) {
          const antiga = antigas.find((t) => t.id === pedido.fromTeamId)!;
          const nova = await db.team.create({
            data: {
              academyId: ctx.academyId,
              seasonId: season.id,
              sportId: antiga.sportId,
              name: (pedido.name ?? antiga.name).trim() || antiga.name,
              maxAge: antiga.maxAge,
              schedule: antiga.schedule as object,
              maxCallUps: antiga.maxCallUps,
              matchMinutes: antiga.matchMinutes,
              previousTeamId: antiga.id,
            },
            select: { id: true, name: true },
          });
          novaDe.set(antiga.id, nova.id);

          /* O preço do escalão: o que veio no pedido, que o assistente mostrou. */
          if (pedido.amountCents != null) {
            await db.subscriptionPlan.create({
              data: { academyId: ctx.academyId, teamId: nova.id, name: nova.name, amountCents: pedido.amountCents },
            });
          }

          /*
           * Os treinadores: a passagem pela equipa velha fecha, e abre outra na
           * nova. É isso que faz a ficha do treinador ler-se por épocas.
           */
          if (pedido.manterStaff !== false) {
            const equipaTecnica = await db.teamStaff.findMany({
              where: { teamId: antiga.id, leftAt: null },
              select: { id: true, membershipId: true, title: true },
            });
            for (const linha of equipaTecnica) {
              await db.teamStaff.update({ where: { id: linha.id }, data: { leftAt: agora } });
              await db.teamStaff.create({
                data: { teamId: nova.id, membershipId: linha.membershipId, title: linha.title, joinedAt: agora },
              });
            }
          } else {
            await db.teamStaff.updateMany({ where: { teamId: antiga.id, leftAt: null }, data: { leftAt: agora } });
          }
        }

        /*
         * Os atletas. Três destinos: uma equipa nova, "sai do clube", ou fica
         * por renovar — e por renovar quer dizer **sem equipa nesta época**,
         * que é como aparece depois na lista de atletas por resolver.
         */
        const pedidos = new Map(dto.atletas.map((a) => [a.athleteId, a.destino]));
        const atletas = await db.athlete.findMany({
          where: { id: { in: [...pedidos.keys()] } },
          select: { id: true, teams: { where: { leftAt: null }, select: { id: true, teamId: true, position: true } } },
        });
        if (atletas.length !== pedidos.size) throw new BadRequestException("Atleta desconhecido");

        const contas = { transitaram: 0, sairam: 0, porRenovar: 0 };
        for (const atleta of atletas) {
          const destino = pedidos.get(atleta.id)!;
          const posicao = atleta.teams[0]?.position ?? null;

          for (const passagem of atleta.teams) {
            await db.teamMembership.update({ where: { id: passagem.id }, data: { leftAt: agora } });
          }

          if (destino === "SAI") {
            await db.athlete.update({ where: { id: atleta.id }, data: { status: "LEFT" } });
            contas.sairam++;
            continue;
          }
          if (destino === "POR_RENOVAR") {
            contas.porRenovar++;
            continue;
          }

          /*
           * O destino é o escalão **desta** época — o que o assistente mostrou —
           * e é aqui que se traduz para a equipa nova. Assim o cliente nunca
           * precisa de saber ids que ainda não existem.
           */
          const teamId = novaDe.get(destino);
          if (!teamId) throw new BadRequestException("Esse escalão não transita para a época nova");
          await db.teamMembership.create({
            data: { teamId, athleteId: atleta.id, joinedAt: agora, ...(posicao ? { position: posicao } : {}) },
          });
          contas.transitaram++;
        }

        this.log.log(`Época ${season.label} criada: ${novaDe.size} equipas, ${contas.transitaram} atletas`);
        return { seasonId: season.id, label: season.label, equipas: novaDe.size, ...contas };
      },
      { timeoutMs: 120_000 },
    );
  }
}

/* -------------------------------------------------------------------------- */

/** "2026/27" → "2027/28". Sem esse formato, o ano de início e o seguinte. */
function proximoRotulo(label: string, anoNovo: number): string {
  const m = /^(\d{4})\s*\/\s*(\d{2,4})$/.exec(label.trim());
  if (m) {
    const fim = (anoNovo + 1) % 100;
    return `${anoNovo}/${String(fim).padStart(2, "0")}`;
  }
  return `${anoNovo}/${String((anoNovo + 1) % 100).padStart(2, "0")}`;
}

/** A mesma data, um ano à frente. */
function maisUmAno(d: Date): string {
  const nova = new Date(d);
  nova.setUTCFullYear(nova.getUTCFullYear() + 1);
  return nova.toISOString().slice(0, 10);
}

/**
 * Onde é que este atleta fica no ano que vem.
 *
 * Fica no mesmo escalão enquanto a idade couber — um Sub-15 joga **até** aos
 * 15. Quando passa, sobe ao escalão mais baixo que ainda o aceite, dentro da
 * mesma modalidade. Sem nenhum que o aceite (um júnior num clube que acaba nos
 * sub-17), devolve `null` e o assistente pergunta.
 */
function sugerirEscalao(
  equipas: { id: string; maxAge: number; sportId: string }[],
  actual: { id: string; maxAge: number; sportId: string } | undefined,
  idade: number,
): { id: string } | null {
  if (actual && idade <= actual.maxAge) return actual;

  const candidatas = equipas
    .filter((t) => (actual ? t.sportId === actual.sportId : true))
    .filter((t) => idade <= t.maxAge)
    .sort((a, b) => a.maxAge - b.maxAge);

  return candidatas[0] ?? null;
}

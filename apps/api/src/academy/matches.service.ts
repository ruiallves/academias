import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService, type ScopedClient } from "../prisma/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import { can, teamScopeFilter, type RequestContext } from "../common/permissions";

/**
 * Jogos e convocatórias.
 *
 * ## Porque é que submeter é um acto separado
 *
 * Montar uma convocatória é um processo com hesitação: tira-se um, põe-se outro,
 * espera-se pela resposta do departamento clínico. Guardar é livre e não avisa
 * ninguém; **submeter** fecha a lista e é o único momento em que as famílias são
 * notificadas.
 *
 * Sem esta separação, cada clique mandava um aviso ao pai — e um pai que recebe
 * cinco avisos contraditórios numa tarde desliga as notificações para sempre, o
 * que estraga também todos os outros avisos que o produto lhe manda.
 *
 * ## Quem não pode ser convocado
 *
 * Quem está de baixa clínica. Não é uma sugestão da interface: é recusado aqui.
 * A disponibilidade é derivada do boletim, e o treinador que tenta convocar um
 * atleta parado recebe um erro com o nome dele — não um silêncio.
 */
@Injectable()
export class MatchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Jogos do âmbito, com a convocatória e o plantel elegível de cada equipa. */
  async list(ctx: RequestContext, from?: Date, to?: Date) {
    if (!can(ctx, "calendar:read")) throw new ForbiddenException("Sem acesso ao calendário");
    const scope = teamScopeFilter(ctx);

    const start = from ?? new Date(Date.now() - 30 * 86_400_000);
    const end = to ?? new Date(Date.now() + 90 * 86_400_000);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const matches = await db.match.findMany({
        where: { startsAt: { gte: start, lte: end }, ...(scope ? { teamId: scope } : {}) },
        orderBy: { startsAt: "asc" },
        select: {
          id: true, teamId: true, startsAt: true, endsAt: true, venue: true,
          opponent: true, isHome: true, status: true, ourScore: true, theirScore: true,
          callUpsClosedAt: true,
          team: { select: { name: true, maxCallUps: true } },
          callUps: {
            select: {
              athleteId: true, status: true, isGuest: true,
              athlete: { select: { name: true, teams: { select: { team: { select: { name: true } } }, take: 1 } } },
            },
          },
        },
      });

      return matches.map((m) => ({
        id: m.id,
        teamId: m.teamId,
        teamName: m.team.name,
        maxCallUps: m.team.maxCallUps,
        startsAt: m.startsAt,
        endsAt: m.endsAt,
        venue: m.venue,
        opponent: m.opponent,
        isHome: m.isHome,
        status: m.status,
        ourScore: m.ourScore,
        theirScore: m.theirScore,
        submitted: m.callUpsClosedAt !== null,
        submittedAt: m.callUpsClosedAt,
        calledUp: m.callUps.map((c) => ({
          athleteId: c.athleteId,
          status: c.status,
          // Só presente quando é convidado — é o que a ficha do atleta e a lista
          // de convocados usam para dizer "emprestado pelo Sub-11" em vez de
          // deixar parecer que ele sempre jogou aqui.
          isGuest: c.isGuest,
          guestFromTeam: c.isGuest ? c.athlete.teams[0]?.team.name : undefined,
        })),
      }));
    });
  }

  /**
   * Quem se pode emprestar de outro escalão.
   *
   * ## A regra do desporto, não só do produto
   *
   * Joga-se para cima, nunca para baixo: um Sub-13 pode alinhar um miúdo de 11
   * anos, o contrário é irregular em qualquer federação. Por isso um atleta só é
   * elegível como convidado se a **equipa dele** tiver um número de escalão igual
   * ou inferior ao da equipa do jogo — nunca superior.
   *
   * O número vem do texto do escalão (`"Sub-13"` → 13). Quando não é possível
   * extrair um número — natação com `"10–14 anos"`, ou uma academia que chama os
   * escalões de outra forma — a resposta é **nenhum convidado**, e não "todos
   * são elegíveis". Adivinhar a direção errada punha um atleta a jogar contra a
   * própria idade; a ausência de sugestões só obriga a convocar à mão, que é o
   * que já se fazia antes desta funcionalidade existir.
   *
   * ## O que se expõe de uma equipa que não é a tua
   *
   * Nome, número, posição e se está disponível — nada mais. Nunca o diagnóstico:
   * um treinador não tem `clinical:read` sobre uma equipa que não é sua, e este
   * atalho existe para logística de convocatória, não para abrir o boletim de
   * outro escalão. É a mesma disciplina das funções `SECURITY DEFINER` da
   * plataforma, aplicada aqui ao nível do serviço: atravessa o âmbito de forma
   * estreita e deliberada, e só para isto.
   */
  async guestPool(ctx: RequestContext, matchId: string) {
    this.assertCanManageCallUps(ctx);

    // Uma única transação, e não a leitura do jogo à parte da leitura dos
    // convidados: eram duas idas ao pooler do Supabase em série — mais de 2s no
    // total — para o que devia ser uma consulta só.
    return this.prisma.runAs(ctx.academyId, async (db) => {
      const match = await this.loadMatch(db, ctx, matchId);
      const matchRank = ageGroupRank(match.ageGroup);
      if (matchRank === null) return [];

      const guestTeams = await db.team.findMany({
        where: { sportId: match.sportId, id: { not: match.teamId } },
        select: { id: true, name: true, ageGroup: true },
      });
      const eligibleTeamIds = guestTeams
        .filter((t) => {
          const rank = ageGroupRank(t.ageGroup);
          return rank !== null && rank <= matchRank!;
        })
        .map((t) => t.id);
      if (eligibleTeamIds.length === 0) return [];

      const teamName = new Map(guestTeams.map((t) => [t.id, t.name]));

      const athletes = await db.athlete.findMany({
        where: { status: { not: "LEFT" }, teams: { some: { teamId: { in: eligibleTeamIds } } } },
        select: {
          id: true, name: true, status: true, squadNumber: true,
          teams: { where: { teamId: { in: eligibleTeamIds } }, select: { teamId: true, position: true }, take: 1 },
          clinical: { where: { clearedOn: null, impact: { not: "NONE" } }, select: { impact: true } },
        },
      });

      return athletes.map((a) => ({
        id: a.id,
        name: a.name,
        squadNumber: a.squadNumber,
        position: a.teams[0]?.position ?? null,
        teamId: a.teams[0]?.teamId ?? "",
        teamName: teamName.get(a.teams[0]?.teamId ?? "") ?? "",
        // Genérico de propósito — ver o porquê no comentário do método.
        blocked: a.status === "PAUSED" || a.clinical.some((c) => c.impact === "OUT"),
      }));
    });
  }

  /**
   * Guarda a convocatória sem avisar ninguém.
   *
   * Substitui a lista inteira em vez de aplicar diferenças: uma convocatória é uma
   * decisão sobre o conjunto, e reconciliar entradas e saídas dava dois caminhos
   * para o mesmo estado — um deles com bugs.
   */
  async saveCallUps(ctx: RequestContext, matchId: string, athleteIds: string[]) {
    this.assertCanManageCallUps(ctx);
    const ids = [...new Set(athleteIds)];

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const match = await this.loadMatch(db, ctx, matchId);

      if (ids.length > match.maxCallUps) {
        throw new BadRequestException(`Esta equipa convoca no máximo ${match.maxCallUps} atletas`);
      }

      // Do plantel da própria equipa, ou de um escalão inferior elegível para
      // subir — nunca de um superior. A elegibilidade recalcula-se aqui, no
      // servidor, e não se confia na que o cliente mandou: um id de fora do
      // plantel e de fora do conjunto elegível é sempre recusado.
      const matchRank = ageGroupRank(match.ageGroup);
      const guestTeamIds =
        matchRank === null
          ? []
          : (
              await db.team.findMany({
                where: { sportId: match.sportId, id: { not: match.teamId } },
                select: { id: true, ageGroup: true },
              })
            )
              .filter((t) => {
                const rank = ageGroupRank(t.ageGroup);
                return rank !== null && rank <= matchRank;
              })
              .map((t) => t.id);

      const roster = await db.athlete.findMany({
        where: {
          id: { in: ids },
          teams: { some: { teamId: { in: [match.teamId, ...guestTeamIds] } } },
        },
        select: {
          id: true, name: true, status: true,
          teams: { select: { teamId: true }, take: 1 },
          clinical: { where: { clearedOn: null, impact: { not: "NONE" } }, select: { impact: true } },
        },
      });
      if (roster.length !== ids.length) {
        throw new BadRequestException("Atleta fora do plantel desta equipa e não elegível como convidado de outro escalão");
      }

      const parado = roster.find((a) => a.clinical.some((c) => c.impact === "OUT"));
      if (parado) throw new BadRequestException(`${parado.name} está de baixa clínica e não pode ser convocado`);

      const emPausa = roster.find((a) => a.status === "PAUSED");
      if (emPausa) throw new BadRequestException(`${emPausa.name} está em pausa`);

      await db.matchCallUp.deleteMany({ where: { matchId } });
      if (ids.length) {
        // Um convidado fica marcado como tal — é o que distingue, na convocatória,
        // quem é do plantel de quem subiu de escalão para este jogo.
        await db.matchCallUp.createMany({
          data: ids.map((athleteId) => ({
            matchId,
            athleteId,
            isGuest: !roster.find((a) => a.id === athleteId)?.teams.some((t) => t.teamId === match.teamId),
          })),
        });
      }

      return { matchId, calledUp: ids.length, max: match.maxCallUps };
    });
  }

  /**
   * Submete: fecha a lista e avisa as famílias.
   *
   * O aviso vai a cada encarregado do atleta convocado — não a toda a academia. É
   * a diferença entre uma notificação que se lê e uma que se ignora.
   */
  async submitCallUps(ctx: RequestContext, matchId: string) {
    this.assertCanManageCallUps(ctx);

    const { match, avisados, convocados } = await this.prisma.runAs(ctx.academyId, async (db) => {
      const match = await this.loadMatch(db, ctx, matchId);
      const callUps = await db.matchCallUp.findMany({
        where: { matchId },
        select: {
          athleteId: true,
          athlete: {
            select: {
              name: true,
              guardians: { select: { membership: { select: { userId: true, isActive: true } } } },
            },
          },
        },
      });

      if (callUps.length === 0) throw new BadRequestException("Não há ninguém convocado");

      await db.match.update({ where: { id: matchId }, data: { callUpsClosedAt: new Date() } });

      // Um pai com dois filhos convocados recebe dois avisos — um por atleta, e é
      // o que ele quer: são duas convocatórias diferentes, com dois nomes.
      const destinatarios: { userId: string; athleteName: string }[] = [];
      for (const c of callUps) {
        for (const g of c.athlete.guardians) {
          if (g.membership.isActive) destinatarios.push({ userId: g.membership.userId, athleteName: c.athlete.name });
        }
      }
      return { match, avisados: destinatarios, convocados: callUps.length };
    });

    /*
     * As notificações vão **depois** da transação da submissão fechar.
     *
     * Enviar lá dentro prendia-a à latência de um serviço externo, e uma falha de
     * push desfazia a submissão — que já aconteceu e é um facto. Aqui, se um aviso
     * falhar, a convocatória continua submetida e o pai vê-a na app na mesma: a
     * notificação é o alerta, não a fonte da verdade.
     *
     * O `enqueue` abre a sua própria transação de tenant, curta — é o que a RLS
     * da tabela `Notification` exige.
     */
    const quando = match.startsAt.toLocaleString("pt-PT", {
      weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit",
    });

    for (const alvo of avisados) {
      await this.notifications.enqueue({
        academyId: ctx.academyId,
        userId: alvo.userId,
        type: "MATCH_CALLED_UP",
        title: `${alvo.athleteName} está convocado`,
        // Concreto de propósito: uma notificação que obriga a abrir a app para
        // saber do que se trata gasta a paciência de quem a recebe.
        body: `${match.isHome ? "Em casa" : "Fora"} com ${match.opponent} · ${quando} · ${match.venue}`,
        payload: { matchId, url: "/agenda" },
      });
    }

    return { submitted: true, convocados, familiasAvisadas: avisados.length };
  }

  /** Reabre uma convocatória submetida — e diz-se que foi reaberta, não se finge. */
  async reopenCallUps(ctx: RequestContext, matchId: string) {
    this.assertCanManageCallUps(ctx);
    await this.prisma.runAs(ctx.academyId, async (db) => {
      await this.loadMatch(db, ctx, matchId, { allowSubmitted: true });
      await db.match.update({ where: { id: matchId }, data: { callUpsClosedAt: null } });
    });
    return { submitted: false };
  }

  /**
   * O tecto de convocados da equipa.
   *
   * Gated por `calendar:write` e não por `team:write`: quem monta a convocatória é
   * quem melhor sabe quantos lugares precisa — e esse é o treinador, que tem
   * `calendar:write` mas não `team:write`. O âmbito (`scope.in`) continua a
   * impedi-lo de mexer em equipas que não são dele, por isso não há aqui poder a
   * mais: um treinador ajusta o tecto das suas equipas, não o de outras.
   */
  async setMaxCallUps(ctx: RequestContext, teamId: string, max: number) {
    if (!can(ctx, "calendar:write")) throw new ForbiddenException("Sem permissão para configurar a convocatória");
    if (!Number.isInteger(max) || max < 1 || max > 60) throw new BadRequestException("Valor entre 1 e 60");

    const scope = teamScopeFilter(ctx);
    if (scope && !scope.in.includes(teamId)) throw new ForbiddenException("Esta equipa não é tua");

    return this.prisma.runAs(ctx.academyId, async (db) => {
      await db.team.update({ where: { id: teamId }, data: { maxCallUps: max } });
      return { teamId, maxCallUps: max };
    });
  }

  /** A permissão não depende da base de dados — verifica-se antes de abrir ligação nenhuma. */
  private assertCanManageCallUps(ctx: RequestContext): void {
    if (!can(ctx, "calendar:write") && !can(ctx, "attendance:write")) {
      throw new ForbiddenException("Sem permissão para montar convocatórias");
    }
  }

  /**
   * O jogo, se esta pessoa lhe pode mexer — lido com um cliente que já está
   * dentro de uma transação.
   *
   * Recebe `db` em vez de abrir a sua própria transação de propósito: cada
   * `runAs` é uma ida completa ao pooler do Supabase, e todos os métodos públicos
   * desta classe precisavam do jogo **e** de mais alguma coisa a seguir. Abrir
   * duas transações onde uma chega — uma para ler o jogo, outra para o resto —
   * estava a custar mais de 2 segundos ao "Convidar de outro escalão", que devia
   * ser uma consulta imediata.
   *
   * Um jogo já jogado não muda de convocatória: reescrever quem foi convocado
   * depois do apito seria reescrever o que aconteceu.
   */
  private async loadMatch(
    db: ScopedClient,
    ctx: RequestContext,
    matchId: string,
    opts?: { allowSubmitted: boolean },
  ) {
    const scope = teamScopeFilter(ctx);

    const match = await db.match.findFirst({
      where: { id: matchId, ...(scope ? { teamId: scope } : {}) },
      select: {
        id: true, teamId: true, startsAt: true, opponent: true, isHome: true, venue: true,
        status: true, callUpsClosedAt: true,
        team: { select: { maxCallUps: true, ageGroup: true, sportId: true } },
      },
    });

    if (!match) throw new NotFoundException("Jogo não encontrado ou fora do teu âmbito");
    if (match.status === "PLAYED") throw new BadRequestException("O jogo já foi disputado");
    if (match.callUpsClosedAt && !opts?.allowSubmitted) {
      throw new BadRequestException("A convocatória já foi submetida. Reabre-a para alterar.");
    }

    return { ...match, maxCallUps: match.team.maxCallUps, ageGroup: match.team.ageGroup, sportId: match.team.sportId };
  }
}

/**
 * Extrai o número de um escalão do tipo "Sub-13", "sub13", "Sub 9".
 *
 * `null` quando o texto não segue este padrão — natação com "10–14 anos", ou uma
 * academia que nomeia os escalões de outra forma. É a resposta segura: sem número
 * não há como saber a direção "sobe/desce", e a funcionalidade fica em silêncio em
 * vez de arriscar a direcção errada.
 */
function ageGroupRank(label: string): number | null {
  const match = /sub[\s-]?(\d+)/i.exec(label);
  return match ? Number(match[1]) : null;
}

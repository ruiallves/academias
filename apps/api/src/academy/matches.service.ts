import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService, type ScopedClient } from "../prisma/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import { calendarScopeFilter, can, inTeamScope, teamScopeFilter, type RequestContext } from "../common/permissions";

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
    const scope = calendarScopeFilter(ctx);

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
          // A prova, para a convocatória a poder imprimir sem ninguém a escrever.
          competition: { select: { id: true, label: true } },
          team: { select: { name: true, maxCallUps: true } },
          callUps: {
            select: {
              athleteId: true, status: true, isGuest: true,
              athlete: { select: { name: true, teams: { select: { team: { select: { name: true } } }, take: 1 } } },
            },
          },
          /*
           * A minha linha na ficha técnica, e só a minha.
           *
           * Filtrado pelo `membershipId` de quem pergunta em vez de trazer a
           * equipa de trabalho toda: quem lê a lista de jogos quer saber onde
           * **é preciso**, e a lista completa de cada jogo é da página do jogo.
           * Trazê-la aqui eram trinta objectos a mais por leitura para mostrar um
           * rótulo.
           */
          staff: {
            where: { membershipId: ctx.membershipId },
            select: { role: true },
            take: 1,
          },
          /*
           * A ficha, e não só o resultado.
           *
           * Faltava, e o buraco só apareceu quando a semente de jogos falsos do
           * cliente foi apagada: o registo de jogos na ficha do atleta lê as
           * participações destes eventos, nunca as recebia da API, e vivia
           * inteiramente de dados inventados no browser. Gravar uma ficha não
           * mudava nada em lado nenhum.
           *
           * São meia dúzia de linhas por jogo — menos do que os convocados, que
           * já vinham — e é o que faz o trabalho de preencher a ficha chegar a
           * algum sítio.
           */
          appearances: {
            select: {
              athleteId: true, minutes: true, started: true, tally: true, assists: true,
              yellowCards: true, redCard: true, onMinute: true, offMinute: true,
              yellowAt: true, redAt: true, tallyAt: true, assistsAt: true, rating: true,
            },
          },
        },
      });

      return matches.map((m) => {
        /*
         * O jogo aparece a todo o clube; a convocatória e a ficha, não.
         *
         * Quem joga contra quem, quando, onde e como acabou é a vida do clube —
         * um treinador tem de poder ver que o Sub-15 joga fora no sábado. Mas
         * **quem foi convocado** e **quem jogou quantos minutos** são o trabalho
         * daquele escalão, com nomes de atletas lá dentro, e ficam de fora
         * quando o jogo não é meu. Ver `calendarScopeFilter` e `inTeamScope`.
         */
        const meu = inTeamScope(ctx, m.teamId);

        return {
          id: m.id,
          teamId: m.teamId,
          teamName: m.team.name,
          maxCallUps: m.team.maxCallUps,
          startsAt: m.startsAt,
          endsAt: m.endsAt,
          venue: m.venue,
          opponent: m.opponent,
          isHome: m.isHome,
          competition: m.competition ? { id: m.competition.id, label: m.competition.label } : null,
          status: m.status,
          ourScore: m.ourScore,
          theirScore: m.theirScore,
          submitted: m.callUpsClosedAt !== null,
          submittedAt: m.callUpsClosedAt,
          /** É de uma equipa minha? Decide o que vem preenchido, e o que a consola deixa abrir. */
          mine: meu,
          /** A função com que **eu** estou escalado neste jogo. `null` se não estou. */
          myStaffRole: m.staff[0]?.role ?? null,
          /** Quem jogou e o que fez. Vazio enquanto a ficha estiver por preencher — ou se o jogo não é meu. */
          appearances: meu
            ? m.appearances.map((a) => ({
                ...a,
                // `Decimal` do Prisma não atravessa JSON como número.
                rating: a.rating === null ? null : Number(a.rating),
              }))
            : [],
          calledUp: meu
            ? m.callUps.map((c) => ({
                athleteId: c.athleteId,
                status: c.status,
                // Só presente quando é convidado — é o que a ficha do atleta e a lista
                // de convocados usam para dizer "emprestado pelo Sub-11" em vez de
                // deixar parecer que ele sempre jogou aqui.
                isGuest: c.isGuest,
                guestFromTeam: c.isGuest ? c.athlete.teams[0]?.team.name : undefined,
              }))
            : [],
        };
      });
    });
  }

  /**
   * Um jogo, inteiro — a página do jogo.
   *
   * ## O que esta página responde, e porque é que é uma página
   *
   * O calendário abria um painel lateral com o essencial, e para um treino chega.
   * Para um jogo não: antes dele há a convocatória por montar, depois dele há a
   * ficha por preencher, e ao lado há a equipa de trabalho por atribuir. Isso não
   * cabe numa gaveta ao lado do calendário — e obrigava a sair para três sítios
   * diferentes para tratar de um jogo só.
   *
   * ## Uma leitura, e não três
   *
   * Convocados, ficha e staff vêm de uma vez. São três tabelas penduradas no
   * mesmo jogo, e três pedidos separados dariam três estados de carregamento
   * numa página que se lê como um documento.
   *
   * ## O que aqui **não** se decide
   *
   * O âmbito. `teamScopeFilter` trata disso, como em todo o lado: um treinador
   * que peça o id de um jogo de outro escalão leva 404, e não uma página vazia.
   */
  async get(ctx: RequestContext, matchId: string) {
    if (!can(ctx, "calendar:read")) throw new ForbiddenException("Sem acesso ao calendário");

    /*
     * As famílias não entram aqui, e `calendar:read` não chega para as travar.
     *
     * Um encarregado **tem** `calendar:read` — precisa dele para ver quando é o
     * jogo do filho — e o âmbito dele inclui a equipa do filho. Sem esta linha, um
     * pai que trocasse um id no endereço lia a ficha inteira: os minutos, os
     * cartões e os golos de todos os miúdos da equipa, mais quem da equipa técnica
     * lá esteve.
     *
     * A app da família tem os endpoints dela, com o âmbito no atleta e não na
     * equipa. Esta página é de quem trabalha no clube.
     */
    if (ctx.role === "GUARDIAN" || ctx.role === "ATHLETE") {
      throw new ForbiddenException("Sem acesso à ficha de jogo");
    }

    const scope = teamScopeFilter(ctx);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const m = await db.match.findFirst({
        where: { id: matchId, ...(scope ? { teamId: scope } : {}) },
        select: {
          id: true, teamId: true, startsAt: true, endsAt: true, venue: true,
          opponent: true, isHome: true, status: true, ourScore: true, theirScore: true,
          callUpsClosedAt: true, statsEnteredAt: true,
          competition: { select: { id: true, label: true } },
          sourceProvider: true, sourceUrl: true, importedAt: true,
          team: { select: { name: true, maxAge: true, sportId: true, maxCallUps: true } },
          coach: { select: { id: true, user: { select: { name: true } } } },
          callUps: {
            orderBy: { athlete: { name: "asc" } },
            select: {
              athleteId: true, status: true, isGuest: true,
              athlete: {
                select: {
                  name: true,
                  /*
                   * A posição vive no plantel e não no atleta.
                   *
                   * O mesmo miúdo pode ser lateral no Sub-13 e médio no Sub-15 —
                   * a posição é da relação com a equipa (`TeamMembership`), e é
                   * por isso que se procura a linha da equipa deste jogo. Um
                   * atleta emprestado de outro escalão não tem linha aqui e fica
                   * sem posição, que é a resposta honesta.
                   */
                  teams: { select: { position: true, team: { select: { name: true } } } },
                },
              },
            },
          },
          appearances: {
            select: {
              athleteId: true, minutes: true, started: true, tally: true,
              assists: true, yellowCards: true, redCard: true,
              onMinute: true, offMinute: true, yellowAt: true, redAt: true,
              tallyAt: true, assistsAt: true,
            },
          },
          staff: {
            orderBy: { createdAt: "asc" },
            select: {
              id: true, membershipId: true, role: true,
              membership: { select: { user: { select: { name: true } } } },
            },
          },
        },
      });

      if (!m) throw new NotFoundException("Jogo não encontrado ou fora do teu âmbito");

      const ficha = new Map(m.appearances.map((a) => [a.athleteId, a]));

      return {
        id: m.id,
        teamId: m.teamId,
        teamName: m.team.name,
        maxAge: m.team.maxAge,
        sportId: m.team.sportId,
        maxCallUps: m.team.maxCallUps,
        startsAt: m.startsAt,
        endsAt: m.endsAt,
        venue: m.venue,
        opponent: m.opponent,
        isHome: m.isHome,
        competition: m.competition ? { id: m.competition.id, label: m.competition.label } : null,
        status: m.status,
        ourScore: m.ourScore,
        theirScore: m.theirScore,
        coachName: m.coach?.user.name ?? null,
        submitted: m.callUpsClosedAt !== null,
        submittedAt: m.callUpsClosedAt,
        statsEnteredAt: m.statsEnteredAt,
        /*
         * De onde veio o jogo. Vazio quando foi marcado à mão.
         *
         * Vai para o ecrã porque quem lá chegar tem de perceber, sem perguntar a
         * ninguém, se aquele resultado foi escrito por um colega ou veio de fora.
         * Ver `statsEnteredAt` no schema.
         */
        source: m.sourceProvider ? { provider: m.sourceProvider, url: m.sourceUrl, at: m.importedAt } : null,
        /** Os convocados, já com a linha da ficha de cada um quando existe. */
        squad: m.callUps.map((c) => {
          const a = ficha.get(c.athleteId);
          return {
            athleteId: c.athleteId,
            name: c.athlete.name,
            position: c.athlete.teams.find((t) => t.team.name === m.team.name)?.position ?? null,
            callUpStatus: c.status,
            isGuest: c.isGuest,
            guestFromTeam: c.isGuest ? c.athlete.teams[0]?.team.name : undefined,
            played: Boolean(a),
            minutes: a?.minutes ?? 0,
            started: a?.started ?? false,
            tally: a?.tally ?? 0,
            assists: a?.assists ?? 0,
            yellowCards: a?.yellowCards ?? 0,
            redCard: a?.redCard ?? false,
            onMinute: a?.onMinute ?? null,
            offMinute: a?.offMinute ?? null,
            yellowAt: a?.yellowAt ?? [],
            redAt: a?.redAt ?? null,
            tallyAt: a?.tallyAt ?? [],
            assistsAt: a?.assistsAt ?? [],
          };
        }),
        staff: m.staff.map((x) => ({
          id: x.id,
          membershipId: x.membershipId,
          name: x.membership.user.name,
          role: x.role,
        })),
      };
    });
  }

  /**
   * O resultado.
   *
   * Gravar um resultado passa o jogo a `PLAYED`, e limpá-lo devolve-o a
   * `SCHEDULED`. É a mesma ausência que já decidia o que a interface mostra —
   * convocatória antes, estatística depois — e ter dois interruptores para a
   * mesma coisa era garantir que um dia diriam coisas diferentes.
   */
  async saveResult(
    ctx: RequestContext,
    matchId: string,
    input: { ourScore: number | null; theirScore: number | null },
  ) {
    this.assertCanRecord(ctx);

    const { ourScore, theirScore } = input;
    const limpar = ourScore === null || theirScore === null;
    if (!limpar && (ourScore < 0 || theirScore < 0 || ourScore > 99 || theirScore > 99)) {
      throw new BadRequestException("Resultado fora do razoável");
    }

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const alvo = await this.mustReach(db, ctx, matchId);

      /*
       * Um resultado antes do apito não é um resultado — é um palpite.
       *
       * Sem esta regra, um dedo trocado na lista gravava "3–1" num jogo de
       * sábado à quarta-feira, o jogo passava a PLAYED, e a convocatória
       * desaparecia do ecrã de quem ainda a ia montar. Limpar continua a poder
       * ser feito a qualquer hora: desfazer um engano não tem horário.
       */
      if (!limpar && alvo.startsAt.getTime() > Date.now()) {
        throw new BadRequestException("O jogo ainda não começou — o resultado regista-se depois do apito");
      }

      /*
       * O mesmo tecto, visto do outro lado.
       *
       * `saveAppearances` impede uma ficha maior que o marcador; sem isto,
       * bastava corrigir o marcador **depois** para lá chegar na mesma — gravar
       * quatro golos num 4-2 e emendar o resultado para 3-2. Diz-se o que está
       * gravado para a pessoa saber o que tem de acertar, em vez de a deixar a
       * adivinhar porque é que o resultado não entra.
       */
      if (!limpar) {
        const soma = await db.matchAppearance.aggregate({
          where: { matchId },
          _sum: { tally: true, assists: true },
        });
        const golos = soma._sum.tally ?? 0;
        const assistencias = soma._sum.assists ?? 0;
        if (golos > ourScore || assistencias > ourScore) {
          throw new BadRequestException(
            `A ficha já atribui ${golos} ${golos === 1 ? "golo" : "golos"} e ${assistencias} ${assistencias === 1 ? "assistência" : "assistências"} — corrige-a antes de gravar ${ourScore}-${theirScore}.`,
          );
        }
      }

      await db.match.update({
        where: { id: matchId },
        data: {
          ourScore: limpar ? null : ourScore,
          theirScore: limpar ? null : theirScore,
          status: limpar ? "SCHEDULED" : "PLAYED",
          statsEnteredAt: limpar ? undefined : new Date(),
        },
      });
      return { ok: true as const };
    });
  }

  /**
   * A ficha: quem jogou, quanto tempo, quem marcou, quem viu cartão.
   *
   * ## Só quem jogou tem linha
   *
   * Quem foi convocado e ficou no banco não tem `MatchAppearance` nenhuma. A
   * ausência é a resposta — uma linha com zero minutos diria "jogou zero
   * minutos", que é a mesma coisa no papel e outra coisa na cabeça de quem
   * depois soma jogos por atleta.
   *
   * ## Substituição inteira, e não campo a campo
   *
   * O ecrã manda a ficha toda de cada vez. Um jogo tem vinte linhas, não duas
   * mil, e a alternativa — um pedido por cada carregar num +1 — dava vinte
   * pedidos por minuto de um treinador a acertar minutos no telemóvel, e uma
   * ficha meio gravada quando a rede falhasse a meio.
   */
  async saveAppearances(
    ctx: RequestContext,
    matchId: string,
    rows: {
      athleteId: string;
      /** Ignorado: os minutos calculam-se aqui. Ver `minutosEmCampo`. */
      minutes?: number;
      started?: boolean;
      tally?: number;
      assists?: number;
      yellowCards?: number;
      redCard?: boolean;
      onMinute?: number;
      offMinute?: number;
      yellowAt?: number[];
      redAt?: number;
      tallyAt?: number[];
      assistsAt?: number[];
    }[],
  ) {
    this.assertCanRecord(ctx);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const match = await this.mustReach(db, ctx, matchId);

      /*
       * Só se escreve sobre quem foi convocado.
       *
       * Sem isto, um id de atleta no corpo do pedido punha um miúdo de outro
       * escalão — ou de outra academia — na ficha de um jogo em que nunca esteve.
       * A convocatória é a lista fechada de quem podia lá estar, e é ela que
       * manda.
       */
      const convocados = new Set(
        (await db.matchCallUp.findMany({ where: { matchId }, select: { athleteId: true } })).map(
          (c) => c.athleteId,
        ),
      );

      const duracao = match.team.sport.matchMinutes ?? 0;

      const limpas = rows
        .filter((r) => convocados.has(r.athleteId))
        .map((r) => ({
          athleteId: r.athleteId,
          minutes: minutosEmCampo(r, duracao),
          started: r.started ?? false,
          tally: clamp(r.tally ?? 0, 0, 99),
          assists: clamp(r.assists ?? 0, 0, 99),
          // Dois amarelos são o máximo que existe: o segundo é a expulsão.
          yellowCards: clamp(r.yellowCards ?? 0, 0, 2),
          redCard: Boolean(r.redCard),

          /*
           * O detalhe dos minutos, quando existe.
           *
           * `?? null` e não `clamp(… , 0)`: zero é um minuto legítimo (entrou ao
           * intervalo conta-se como 45, mas um titular entra aos 0) e "não
           * registado" tem de continuar a distinguir-se de "ao minuto zero".
           * Passar por `clamp` transformava todos os ausentes em zeros e a
           * ficha passava a afirmar substituições que ninguém registou.
           */
          onMinute: r.onMinute == null ? null : clamp(r.onMinute, 0, 130),
          offMinute: r.offMinute == null ? null : clamp(r.offMinute, 0, 130),
          // Só tantos minutos quantos os amarelos declarados: uma lista com dois
          // minutos e `yellowCards: 1` são duas afirmações que se contradizem.
          yellowAt: emCampo(r, (r.yellowAt ?? []).slice(0, clamp(r.yellowCards ?? 0, 0, 2))),
          redAt: r.redAt == null ? null : clamp(r.redAt, 0, 130),
          tallyAt: emCampo(r, (r.tallyAt ?? []).slice(0, clamp(r.tally ?? 0, 0, 99))),
          assistsAt: emCampo(r, (r.assistsAt ?? []).slice(0, clamp(r.assists ?? 0, 0, 99))),
        }));

      /*
       * Um minuto fora do tempo em que o atleta esteve em campo é uma
       * contradição, não um dado.
       *
       * Recusa-se em vez de se cortar em silêncio: cortar transformava um erro
       * de escrita — 60 onde se queria 6 — numa ficha que fica gravada errada e
       * ninguém repara. Ver `janelaEmCampo`.
       */
      for (const r of limpas) {
        const erro = foraDeCampo(r);
        if (erro) throw new BadRequestException(erro);
      }

      /*
       * A ficha não pode marcar mais golos do que o marcador.
       *
       * O resultado é a verdade pública do jogo — está na acta, no site da
       * associação, na cabeça de toda a gente que lá esteve. Uma ficha que
       * distribua quatro golos num 3-2 não é uma opinião diferente: é um erro
       * de escrita que depois vive para sempre no perfil de um atleta e nos
       * totais da época.
       *
       * O mesmo teto vale para as assistências, porque cada golo tem no máximo
       * uma — e há golos sem nenhuma. É um limite generoso de propósito: aperta
       * o impossível sem discutir com o treinador sobre quem assistiu o quê.
       *
       * Enquanto o resultado não estiver registado não há com que confrontar, e
       * aí só valem os limites por linha lá em cima. Marcar a ficha primeiro e o
       * resultado depois é uma ordem legítima de trabalho.
       */
      if (match.ourScore !== null) {
        const golos = limpas.reduce((n, r) => n + r.tally, 0);
        if (golos > match.ourScore) {
          throw new BadRequestException(
            `A ficha atribui ${golos} golos, mas o jogo ficou ${match.ourScore}-${match.theirScore}.`,
          );
        }
        const assistencias = limpas.reduce((n, r) => n + r.assists, 0);
        if (assistencias > match.ourScore) {
          throw new BadRequestException(
            `A ficha atribui ${assistencias} assistências para ${match.ourScore} ${match.ourScore === 1 ? "golo" : "golos"} marcados.`,
          );
        }
      }

      await db.matchAppearance.deleteMany({ where: { matchId } });
      if (limpas.length > 0) {
        await db.matchAppearance.createMany({
          data: limpas.map((r) => ({ matchId, ...r })),
        });
      }

      await db.match.update({ where: { id: matchId }, data: { statsEnteredAt: new Date() } });

      return { ok: true as const, saved: limpas.length, ignored: rows.length - limpas.length, teamId: match.teamId };
    });
  }

  /**
   * A equipa de trabalho do jogo: massagista, delegado, adjunto.
   *
   * Só gente da academia, e só quem não é família. Um encarregado de educação na
   * ficha técnica não é um erro de digitação — é o começo de alguém a aparecer em
   * relatórios de staff sem nunca ter sido staff.
   */
  async saveStaff(ctx: RequestContext, matchId: string, rows: { membershipId: string; role: string }[]) {
    this.assertCanRecord(ctx);

    const { jogo, avisar, ...resultado } = await this.gravarStaff(ctx, matchId, rows);

    /*
     * As notificações saem **fora** do `runAs`.
     *
     * É a regra da casa e custou uma avaria a aprender: dentro de `runAs` só
     * trabalho de base de dados. Um canal de entrega pode fazer um pedido HTTP
     * (push), e uma chamada de rede dentro de uma transação segura uma ligação do
     * pool à espera dela — com `connection_limit=5`, cinco escalações ao mesmo
     * tempo bloqueavam o servidor. O `enqueue` abre a sua própria transação de
     * tenant, curta. Mesmo padrão de `submitCallUps`.
     */
    for (const alvo of avisar) {
      await this.notifications.enqueue({
        academyId: ctx.academyId,
        userId: alvo.userId,
        type: "MATCH_STAFF_ASSIGNED",
        title: `Escalado: ${jogo?.team.name ?? "jogo"} — ${jogo?.opponent ?? ""}`.trim(),
        body: jogo
          ? `${alvo.funcao} · ${jogo.startsAt.toLocaleDateString("pt-PT", { weekday: "long", day: "numeric", month: "long" })} às ${jogo.startsAt.toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" })} · ${jogo.venue} (${jogo.isHome ? "casa" : "fora"})`
          : alvo.funcao,
        payload: { matchId, link: `/jogos/${matchId}` },
      });
    }

    return resultado;
  }

  /** O trabalho de base de dados da escalação. Ver `saveStaff` para o porquê. */
  private async gravarStaff(
    ctx: RequestContext,
    matchId: string,
    rows: { membershipId: string; role: string }[],
  ) {
    return this.prisma.runAs(ctx.academyId, async (db) => {
      await this.mustReach(db, ctx, matchId);

      const validos = new Set(
        (
          await db.membership.findMany({
            where: { role: { notIn: ["GUARDIAN", "ATHLETE"] }, isActive: true },
            select: { id: true },
          })
        ).map((m) => m.id),
      );

      const limpas = rows
        .filter((r) => validos.has(r.membershipId) && r.role.trim().length > 0)
        .map((r) => ({ membershipId: r.membershipId, role: r.role.trim().slice(0, 60) }));

      /*
       * Quem é **novo** nesta ficha, e não quem lá está.
       *
       * A gravação substitui a lista toda, por isso sem esta comparação uma
       * mudança de função do delegado voltava a avisar o massagista, que não
       * mudou de nada. Um aviso repetido é a maneira mais rápida de ensinar
       * alguém a ignorar os avisos.
       */
      const antes = new Set(
        (await db.matchStaff.findMany({ where: { matchId }, select: { membershipId: true } })).map(
          (x) => x.membershipId,
        ),
      );
      const novos = limpas.filter((r) => !antes.has(r.membershipId));

      await db.matchStaff.deleteMany({ where: { matchId } });
      if (limpas.length > 0) {
        await db.matchStaff.createMany({ data: limpas.map((r) => ({ matchId, ...r })) });
      }

      const jogo = await db.match.findFirst({
        where: { id: matchId },
        select: { startsAt: true, opponent: true, isHome: true, venue: true, team: { select: { name: true } } },
      });

      const avisar = novos.length
        ? await db.membership.findMany({
            where: { id: { in: novos.map((n) => n.membershipId) } },
            select: { id: true, userId: true },
          })
        : [];

      return {
        ok: true as const,
        saved: limpas.length,
        ignored: rows.length - limpas.length,
        jogo,
        avisar: avisar
          // Quem escala não se avisa a si próprio: acabou de o fazer, está a
          // olhar para o ecrã onde o fez.
          .filter((m) => m.id !== ctx.membershipId)
          .map((m) => ({
            userId: m.userId,
            funcao: novos.find((n) => n.membershipId === m.id)!.role,
          })),
      };
    });
  }

  /**
   * Quem pode estar na ficha técnica deste jogo.
   *
   * Todo o staff activo da academia, e não só o da equipa: um massagista serve
   * os escalões todos, e restringi-lo à equipa obrigava a inventar equipas para
   * as pessoas que trabalham em todas.
   */
  async staffPool(ctx: RequestContext) {
    /*
     * `attendance:write`, e não `staff:read`.
     *
     * Era `staff:read`, e isso trancava um treinador fora de uma funcionalidade
     * que é dele: quem preenche a ficha do jogo é quem tem de dizer que houve
     * massagista, e um treinador não tem acesso à lista de pessoal do clube.
     *
     * O que se expõe são nomes e cargos de colegas — o mesmo que qualquer um
     * deles lê no balneário. A lista de staff a sério, com contactos e contratos,
     * continua atrás de `staff:read`.
     */
    this.assertCanRecord(ctx);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const rows = await db.membership.findMany({
        where: { role: { notIn: ["GUARDIAN", "ATHLETE"] }, isActive: true },
        orderBy: { user: { name: "asc" } },
        select: {
          id: true,
          title: true,
          user: { select: { name: true } },
          customRole: { select: { name: true } },
        },
      });

      return rows.map((m) => ({
        membershipId: m.id,
        name: m.user.name,
        /** O cargo, para quem escolhe não ter de adivinhar quem é o massagista. */
        role: m.customRole?.name ?? m.title ?? null,
      }));
    });
  }

  /**
   * Registar, depois do jogo, quem tinha sido convocado.
   *
   * ## Porque é que isto existe à parte de `saveCallUps`
   *
   * A convocatória normal é um convite: fecha-se, avisa as famílias, e por isso
   * está trancada para jogos já disputados — reescrever quem foi convocado depois
   * do apito seria reescrever o que aconteceu **por cima** de um registo que as
   * famílias viram.
   *
   * Mas há o caso inverso: o jogo passou e nunca houve convocatória no sistema —
   * o clube ainda geria isso em papel, ou esqueceu-se. Sem plantel não há ficha,
   * porque a ficha só aceita convocados. Isto é a porta para esse caso: escreve o
   * plantel de um jogo **já começado**, sem avisar ninguém (não é um convite, é
   * história), e fecha-o logo.
   *
   * Só vive na página do jogo. O ecrã de convocatórias continua a recusar jogos
   * passados — lá monta-se o futuro; aqui regista-se o passado.
   *
   * ## O que não se verifica, de propósito
   *
   * Baixas clínicas e pausas. São verdades de **hoje**, e o jogo foi no sábado:
   * um miúdo que se lesionou ontem jogou na mesma no fim-de-semana, e recusar o
   * registo por causa do estado presente era misturar dois tempos. A
   * elegibilidade de escalão mantém-se — essa não muda com o calendário.
   */
  async saveRetroSquad(ctx: RequestContext, matchId: string, athleteIds: string[]) {
    this.assertCanRecord(ctx);

    const ids = [...new Set(athleteIds)];
    return this.prisma.runAs(ctx.academyId, async (db) => {
      const scope = teamScopeFilter(ctx);
      const match = await db.match.findFirst({
        where: { id: matchId, ...(scope ? { teamId: scope } : {}) },
        select: { id: true, teamId: true, startsAt: true, callUpsClosedAt: true, team: { select: { maxAge: true, sportId: true } } },
      });
      if (!match) throw new NotFoundException("Jogo não encontrado ou fora do teu âmbito");
      if (match.startsAt.getTime() > Date.now()) {
        throw new BadRequestException("O jogo ainda não aconteceu — a convocatória monta-se em Convocatórias");
      }
      if (ids.length === 0) throw new BadRequestException("O plantel está vazio");
      if (ids.length > 60) throw new BadRequestException("Plantel fora do razoável");

      // Mesma elegibilidade da convocatória normal: plantel da equipa, mais
      // convidados de outras equipas com idade para esta. Ver `saveCallUps`.
      const otherTeamIds = (
        await db.team.findMany({
          where: { sportId: match.team.sportId, id: { not: match.teamId } },
          select: { id: true },
        })
      ).map((t) => t.id);

      const floor = birthdateFloor(match.team.maxAge, match.startsAt);

      const roster = await db.athlete.findMany({
        where: {
          id: { in: ids },
          OR: [
            { teams: { some: { teamId: match.teamId } } },
            { teams: { some: { teamId: { in: otherTeamIds } } }, birthdate: { gte: floor } },
          ],
        },
        select: { id: true, teams: { select: { teamId: true } } },
      });
      if (roster.length !== ids.length) {
        throw new BadRequestException("Atleta fora do plantel desta equipa e não elegível como convidado");
      }

      /*
       * Substitui, não acrescenta — e apaga a ficha do que sair.
       *
       * Se alguém tirar um atleta do plantel retroactivo, a linha da ficha dele
       * ficava órfã: minutos de um jogo em que oficialmente não esteve. O
       * `deleteMany` da ficha limita-se a quem saiu.
       */
      const actuais = (await db.matchCallUp.findMany({ where: { matchId }, select: { athleteId: true } })).map(
        (c) => c.athleteId,
      );
      const saem = actuais.filter((a) => !ids.includes(a));
      if (saem.length) {
        await db.matchAppearance.deleteMany({ where: { matchId, athleteId: { in: saem } } });
      }

      await db.matchCallUp.deleteMany({ where: { matchId } });
      await db.matchCallUp.createMany({
        data: ids.map((athleteId) => ({
          matchId,
          athleteId,
          isGuest: !roster.find((a) => a.id === athleteId)?.teams.some((t) => t.teamId === match.teamId),
        })),
      });

      // Fechado à nascença: isto é um registo, não um convite por responder.
      if (!match.callUpsClosedAt) {
        await db.match.update({ where: { id: matchId }, data: { callUpsClosedAt: new Date() } });
      }

      return { ok: true as const, calledUp: ids.length };
    });
  }

  /**
   * Quem pode entrar no plantel retroactivo. Só para jogos já começados — o
   * `guestPool` normal serve o futuro.
   *
   * **Devolve só o plantel da própria equipa.** O comentário aqui dizia "mais os
   * convidados elegíveis" e a consulta nunca os trouxe: lia o escalão da equipa
   * e não fazia nada com ele. `saveRetroSquad` aceita convidados, por isso os
   * dois lados discordam — quem regista um jogo passado não vê no selector o
   * miúdo que subiu naquele sábado, embora o servidor o aceitasse.
   *
   * Fica como está de propósito: alinhar os dois é uma decisão de produto sobre
   * um ecrã de registo retroactivo, não um efeito secundário de tirar o escalão
   * da equipa. O que se corrigiu foi o comentário, que prometia o que não havia.
   */
  async retroPool(ctx: RequestContext, matchId: string) {
    this.assertCanRecord(ctx);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const scope = teamScopeFilter(ctx);
      const match = await db.match.findFirst({
        where: { id: matchId, ...(scope ? { teamId: scope } : {}) },
        select: { id: true, teamId: true, startsAt: true },
      });
      if (!match) throw new NotFoundException("Jogo não encontrado ou fora do teu âmbito");
      if (match.startsAt.getTime() > Date.now()) {
        throw new BadRequestException("O jogo ainda não aconteceu");
      }

      const rows = await db.athlete.findMany({
        /*
         * Sem os que já saíram do clube (LEFT) — mas COM os pausados: o jogo é
         * passado, e quem está em pausa hoje pode ter jogado nessa altura.
         */
        where: { teams: { some: { teamId: match.teamId } }, status: { not: "LEFT" } },
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          teams: { where: { teamId: match.teamId }, select: { position: true }, take: 1 },
        },
      });

      return rows.map((a) => ({
        athleteId: a.id,
        name: a.name,
        position: a.teams[0]?.position ?? null,
      }));
    });
  }

  /**
   * Registar o que aconteceu é da mesma família que registar quem esteve.
   *
   * `attendance:write`, e não `calendar:write`: marcar um jogo no calendário e
   * dizer quem marcou os golos são trabalhos diferentes, e há quem faça um sem o
   * outro. É a mesma linha que já separa convocar de ver o calendário.
   */
  private assertCanRecord(ctx: RequestContext) {
    if (!can(ctx, "attendance:write")) throw new ForbiddenException("Sem permissão para registar o jogo");
  }

  /** O jogo existe e está no âmbito de quem pergunta. Nada mais. */
  private async mustReach(db: ScopedClient, ctx: RequestContext, matchId: string) {
    const scope = teamScopeFilter(ctx);
    const match = await db.match.findFirst({
      where: { id: matchId, ...(scope ? { teamId: scope } : {}) },
      select: {
        id: true,
        teamId: true,
        startsAt: true,
        ourScore: true,
        theirScore: true,
        // A duração da modalidade: é o que fecha a conta dos minutos de quem
        // jogou até ao fim. Ver `minutosEmCampo`.
        team: { select: { sport: { select: { matchMinutes: true } } } },
      },
    });
    if (!match) throw new NotFoundException("Jogo não encontrado ou fora do teu âmbito");
    return match;
  }

  /**
   * Quem se pode emprestar de outra equipa.
   *
   * ## A regra do desporto, não só do produto
   *
   * Joga-se para cima, nunca para baixo: um Sub-13 pode alinhar um miúdo de 11
   * anos, o contrário é irregular em qualquer federação.
   *
   * ## O que mudou, e porque é que estava errado
   *
   * A regra comparava **equipas**: extraía um número do texto do escalão
   * (`"Sub-13"` → 13) e aceitava atletas de equipas com número igual ou inferior.
   * Duas coisas falhavam nisso.
   *
   * A primeira é que a pergunta era sobre a equipa e devia ser sobre a pessoa.
   * Um miúdo de 12 anos inscrito nos Sub-11 — coisa que acontece — passava a
   * elegível para os Sub-13 por causa da equipa onde está, não da idade que tem.
   * Era exactamente o atleta que a regra existe para travar.
   *
   * A segunda é que dependia de texto. Uma academia que escrevesse "Iniciados A"
   * ficava sem número, e a resposta segura era **nenhum convidado** — a
   * funcionalidade desaparecia em silêncio para esse clube.
   *
   * Agora a equipa tem `maxAge`, um inteiro, e a elegibilidade é a comparação
   * directa: **a idade do atleta cabe no tecto desta equipa?**. Não há texto a
   * interpretar, não há clube sem resposta, e um atleta com idade a mais fica de
   * fora mesmo que a equipa dele seja de escalão inferior.
   *
   * ## O que se expõe de uma equipa que não é a tua
   *
   * Nome, número, posição e se está disponível — nada mais. Nunca o diagnóstico:
   * um treinador não tem `clinical:read` sobre uma equipa que não é sua, e este
   * atalho existe para logística de convocatória, não para abrir o boletim de
   * outra equipa. É a mesma disciplina das funções `SECURITY DEFINER` da
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

      const otherTeams = await db.team.findMany({
        where: { sportId: match.sportId, id: { not: match.teamId } },
        select: { id: true, name: true },
      });
      if (otherTeams.length === 0) return [];

      const teamName = new Map(otherTeams.map((t) => [t.id, t.name]));
      const otherIds = otherTeams.map((t) => t.id);

      const athletes = await db.athlete.findMany({
        where: {
          status: { not: "LEFT" },
          teams: { some: { teamId: { in: otherIds } } },
          // O filtro de idade é feito na base: quem nasceu antes desta data já
          // é velho de mais para esta equipa. Ver `birthdateFloor`.
          birthdate: { gte: birthdateFloor(match.maxAge, match.startsAt) },
        },
        select: {
          id: true, name: true, status: true, squadNumber: true, birthdate: true,
          teams: { where: { teamId: { in: otherIds } }, select: { teamId: true, position: true }, take: 1 },
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

      /*
       * Do plantel da própria equipa, ou de outra equipa da modalidade desde que
       * o atleta tenha idade para esta — nunca acima do tecto.
       *
       * A elegibilidade recalcula-se aqui, no servidor, e não se confia na que o
       * cliente mandou: um id de fora do plantel e de fora do conjunto elegível é
       * sempre recusado.
       *
       * Repare-se que o filtro de idade **não** se aplica ao plantel da própria
       * equipa. Um atleta com idade a mais inscrito na equipa é um problema da
       * inscrição, e recusá-lo aqui impedia o treinador de convocar alguém que
       * treina com ele todas as semanas, sem nada no ecrã que explicasse porquê.
       */
      const otherTeamIds = (
        await db.team.findMany({
          where: { sportId: match.sportId, id: { not: match.teamId } },
          select: { id: true },
        })
      ).map((t) => t.id);

      const floor = birthdateFloor(match.maxAge, match.startsAt);

      const roster = await db.athlete.findMany({
        where: {
          id: { in: ids },
          OR: [
            { teams: { some: { teamId: match.teamId } } },
            {
              teams: { some: { teamId: { in: otherTeamIds } } },
              birthdate: { gte: floor },
            },
          ],
        },
        select: {
          id: true, name: true, status: true,
          teams: { select: { teamId: true }, take: 1 },
          clinical: { where: { clearedOn: null, impact: { not: "NONE" } }, select: { impact: true } },
        },
      });
      if (roster.length !== ids.length) {
        throw new BadRequestException(
          "Atleta fora do plantel desta equipa e sem idade para ser convocado como convidado",
        );
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
        team: { select: { maxCallUps: true, maxAge: true, sportId: true } },
      },
    });

    if (!match) throw new NotFoundException("Jogo não encontrado ou fora do teu âmbito");
    if (match.status === "PLAYED") throw new BadRequestException("O jogo já foi disputado");
    if (match.callUpsClosedAt && !opts?.allowSubmitted) {
      throw new BadRequestException("A convocatória já foi submetida. Reabre-a para alterar.");
    }

    return { ...match, maxCallUps: match.team.maxCallUps, maxAge: match.team.maxAge, sportId: match.team.sportId };
  }
}

/** Segura um número dentro do razoável. Um 999 na ficha é um dedo escorregado. */
function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(Number(n) || 0)));
}

/** Minutos de uma lista, presos ao intervalo de um jogo e por ordem. */
function emCampo(_r: unknown, minutos: number[]): number[] {
  return minutos.map((m) => clamp(m, 0, 130)).sort((a, b) => a - b);
}

/**
 * Os minutos jogados, calculados aqui e não aceites do cliente.
 *
 * O corpo do pedido traz um `minutes`, e durante muito tempo era esse que ficava
 * gravado. Isso punha a verdade dos totais da época na mão de quem faz o pedido:
 * bastava um ecrã desactualizado — ou um pedido à mão — para um atleta ficar com
 * noventa minutos num jogo em que entrou ao 80. Os factos são a titularidade, a
 * entrada e a saída; o tempo é uma consequência deles, e uma consequência
 * calcula-se sempre do mesmo lado.
 *
 * Um titular sem minuto de saída jogou o jogo todo. Um suplente sem minuto de
 * entrada não tem minutos que se saibam — devolve-se zero em vez de um palpite,
 * e é o ecrã que impede que se chegue aqui com essa linha por preencher.
 *
 * `duracao` a zero é uma modalidade sem duração declarada nas Definições; aí o
 * que se souber por diferença é tudo o que há.
 */
function minutosEmCampo(
  r: { started?: boolean; onMinute?: number; offMinute?: number },
  duracao: number,
): number {
  const entrada = r.started ? 0 : r.onMinute;
  if (entrada == null) return 0;
  const saida = r.offMinute ?? duracao;
  return clamp(saida - entrada, 0, 300);
}

type ComMinutos = {
  started: boolean;
  onMinute: number | null;
  offMinute: number | null;
  yellowAt: number[];
  redAt: number | null;
  tallyAt: number[];
  assistsAt: number[];
};

/**
 * A janela em que o atleta esteve em campo.
 *
 * Um titular entra aos 0; um suplente, ao minuto que ficou registado. A saída é
 * `offMinute` ou o fim — e como o fim depende da modalidade e do prolongamento,
 * usa-se o tecto de 130 em vez de o adivinhar. O que interessa a esta
 * verificação é o **limite que foi declarado**, não o comprimento do jogo.
 */
function janelaEmCampo(r: ComMinutos): { de: number; ate: number } {
  return {
    de: r.started ? 0 : (r.onMinute ?? 0),
    ate: r.offMinute ?? 130,
  };
}

/**
 * O que, nesta linha, aconteceu fora do tempo em que o atleta esteve em campo.
 *
 * Devolve a frase a mostrar, ou `null` se está tudo coerente. Um golo aos 60 de
 * quem saiu aos 50 não é um dado com que se possa fazer alguma coisa: é um erro
 * de escrita, e o sítio para o apanhar é aqui — a interface avisa, mas a
 * interface nunca é a fronteira.
 */
function foraDeCampo(r: ComMinutos): string | null {
  const { de, ate } = janelaEmCampo(r);

  if (r.onMinute != null && r.offMinute != null && r.offMinute < r.onMinute) {
    return `Saiu ao minuto ${r.offMinute}, antes de ter entrado (${r.onMinute}).`;
  }

  const grupos: [string, number[]][] = [
    ["golo", r.tallyAt],
    ["assistência", r.assistsAt],
    ["amarelo", r.yellowAt],
    ["vermelho", r.redAt == null ? [] : [r.redAt]],
  ];

  for (const [nome, minutos] of grupos) {
    /*
     * O vermelho é o único que pode acontecer **ao** minuto da saída — é
     * frequentemente a razão dela. Um golo ao minuto exacto em que saiu também
     * conta: estava em campo até esse apito.
     */
    const fora = minutos.find((m) => m < de || m > ate);
    if (fora !== undefined) {
      const limite = fora < de ? `entrou ao ${de}` : `saiu ao ${ate}`;
      return `Há um ${nome} ao minuto ${fora}, mas o atleta ${limite}.`;
    }
  }

  return null;
}

/**
 * A data de nascimento mais antiga que ainda cabe numa equipa de `maxAge`.
 *
 * ## Porque é que a idade é a do ano, e não a de hoje
 *
 * Porque é assim que o desporto a conta. Um escalão vai por **ano de
 * nascimento**: quem faz 11 anos durante a época joga nos Sub-11 do princípio ao
 * fim, tenha feito anos em Janeiro ou em Dezembro. Contar a idade exacta à data
 * do jogo tornava um miúdo inelegível a meio da época, no dia do aniversário —
 * um resultado que nenhum treinador reconheceria como certo e que ninguém
 * conseguiria explicar a um pai.
 *
 * Por isso: `idade = ano da época − ano de nascimento`, e a época de um jogo é a
 * que começou em Agosto (a mesma convenção de `resolveSeason` e de
 * `lib/seasons.ts`, na consola).
 *
 * Devolver uma **data** em vez de um número é o que deixa o filtro correr na
 * base de dados. Comparar idades obrigaria a trazer todos os atletas da academia
 * para memória só para os deitar fora a seguir.
 */
export function birthdateFloor(maxAge: number, matchDate: Date): Date {
  const seasonYear = matchDate.getUTCFullYear() - (matchDate.getUTCMonth() < 7 ? 1 : 0);
  return new Date(Date.UTC(seasonYear - maxAge, 0, 1));
}

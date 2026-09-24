import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import type { ClinicalImpact, ClinicalKind, ClinicalStatus, Prisma } from "@prisma/client";
import { PrismaService, type ScopedClient } from "../prisma/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import { assertPodeResponderPor, athleteScopeFilter, can, type RequestContext } from "../common/permissions";

/**
 * O boletim clínico — escritas.
 *
 * ## Porque é que isto não existia
 *
 * As leituras sempre existiram: o boletim vem dentro de cada atleta em
 * `AcademyService.athletes()`. As **escritas** não. O que a consola registava —
 * uma baixa, uma consulta agendada, uma alta — vivia num objecto em memória no
 * browser, com um comentário a dizer "quando a API existir, isto passa a
 * `POST /athletes/:id/clinical`".
 *
 * Não passou, e o efeito era o pior possível para um departamento clínico: a
 * médica registava a baixa, via-a no ecrã, e ao recarregar a página ela tinha
 * desaparecido. O atleta continuava apto para o treinador convocar. Trabalho
 * clínico perdido em silêncio é o defeito mais caro que este produto podia ter.
 *
 * ## O âmbito
 *
 * `clinical:write`, e o atleta tem de estar no âmbito de quem escreve. Não é a
 * mesma permissão de editar a ficha (`athlete:write`): a médica tem a primeira e
 * não tem a segunda, e é exactamente essa a fronteira que o produto quer — quem
 * trata do atleta não tem de poder mexer-lhe no nome nem no NIF.
 *
 * ## O exame e a validade
 *
 * Registar um exame com data de validade actualiza também `Athlete.medicalValidUntil`
 * — o campo administrativo que decide se o atleta pode competir. São a mesma
 * decisão dita uma vez: sem isto, a médica tinha de registar o exame **e** ir ao
 * formulário administrativo pôr a data, um formulário que lhe exige o NIF do
 * atleta e que nem é dela. Ver `criar`.
 */
@Injectable()
export class ClinicalService {
  private readonly log = new Logger(ClinicalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Quem tem de saber que há consulta marcada: a família e o próprio atleta.
   *
   * Uma consulta agendada era um gesto interno — a médica marcava, a base
   * gravava, e do outro lado ninguém sabia de nada até alguém telefonar. Vai à
   * conta de cada encarregado activo e, quando o atleta tem conta própria, a ele
   * também: o miúdo de dezassete anos é quem lá tem de estar.
   */
  private async quemAvisar(
    db: ScopedClient,
    athleteId: string,
  ): Promise<{ nome: string; userIds: string[]; atleta: string | null; encarregados: string[] }> {
    const atleta = await db.athlete.findFirst({
      where: { id: athleteId },
      select: {
        name: true,
        account: { select: { userId: true, isActive: true } },
        guardians: { select: { membership: { select: { userId: true, isActive: true } } } },
      },
    });
    const proprio = atleta?.account?.isActive ? atleta.account.userId : null;
    const encarregados = [
      ...new Set((atleta?.guardians ?? []).filter((g) => g.membership.isActive).map((g) => g.membership.userId)),
    ];
    const userIds = [...new Set([...(proprio ? [proprio] : []), ...encarregados])];
    return { nome: atleta?.name ?? "", userIds, atleta: proprio, encarregados };
  }

  /**
   * O aviso, escrito como quem o lê no telemóvel.
   *
   * Corre **fora** da transacção de quem chama, e um aviso que falhe não desfaz
   * a marcação: a consulta é o facto, o aviso é a cortesia. Ver a mesma regra na
   * partilha do plano de treino.
   */
  private async avisarDaConsulta(
    academyId: string,
    entryId: string,
    consulta: {
      nome: string;
      userIds: string[];
      atleta: string | null;
      encarregados: string[];
      titulo: string;
      date: Date;
      time: string | null;
      location: string | null;
      /** Quem tem de confirmar, quando se pediu confirmação. */
      pedirA?: "GUARDIAN" | "ATHLETE" | null;
    },
    remarcada: boolean,
    /** Uma série marcada de uma vez: um aviso só, com o intervalo, e não um por sessão. */
    serie?: { total: number; ultima: Date },
  ) {
    // A coluna é `@db.Date` (meia-noite UTC): lê-se em UTC para o dia não escorregar.
    const dataPt = (d: Date) => d.toLocaleDateString("pt-PT", { day: "numeric", month: "long", timeZone: "UTC" });
    const quando = dataPt(consulta.date);
    const horas = consulta.time ? ` às ${consulta.time}` : "";
    const onde = consulta.location ? `, em ${consulta.location}` : "";
    const corpo = serie
      ? `${consulta.titulo} de ${consulta.nome}: ${serie.total} sessões, de ${quando} a ${dataPt(serie.ultima)}${horas}${onde}.`
      : `${consulta.titulo} de ${consulta.nome}${remarcada ? " passou para" : ":"} ${quando}${horas}${onde}.`;
    /*
     * Os dois sabem; só quem responde recebe o pedido. É a regra da
     * convocatória: o atleta sabe da consulta, mas quem confirma é o pai (ou o
     * contrário, quando o clube o escolheu).
     */
    const responde = new Set(
      consulta.pedirA === "ATHLETE" ? (consulta.atleta ? [consulta.atleta] : []) : consulta.pedirA === "GUARDIAN" ? consulta.encarregados : [],
    );
    for (const userId of consulta.userIds) {
      const pedido = responde.has(userId) ? (serie ? " Confirma a presença em cada uma na app." : " Confirma a presença na app.") : "";
      await this.notifications
        .enqueue({
          academyId,
          userId,
          type: "CLINICAL_APPOINTMENT",
          title: remarcada ? "Consulta com data nova" : serie ? "Consultas marcadas" : "Consulta marcada",
          body: corpo + pedido,
          payload: { route: `/consulta/${entryId}`, clinicalEntryId: entryId },
        })
        .catch((e) => this.log.warn(`Aviso de consulta ${entryId} por enviar a ${userId}: ${e}`));
    }
  }

  /* ------------------------------------------------------------------------ */

  private mustWrite(ctx: RequestContext) {
    if (!can(ctx, "clinical:write")) throw new ForbiddenException("Sem permissão para escrever no boletim clínico");
  }

  /**
   * O atleta está ao alcance de quem escreve?
   *
   * A mesma regra da edição da ficha, e pela mesma razão: a RLS garante a
   * academia, isto garante o escalão. O departamento clínico vê a academia toda
   * (`teamScopeFilter` devolve `undefined` para `MEDICAL`), por isso na prática
   * isto só trava um treinador a escrever no boletim de uma equipa que não é dele.
   */
  private async atletaNoAmbito(db: ScopedClient, ctx: RequestContext, athleteId: string) {
    const athlete = await db.athlete.findFirst({
      where: { id: athleteId },
      select: { id: true, teams: { where: { leftAt: null }, select: { teamId: true } } },
    });
    if (!athlete) throw new NotFoundException("Atleta não encontrado");

    const scope = ctx.scope?.teamIds;
    /* Sem âmbito de equipas = vê tudo (direcção, clínico). */
    if (!scope) return athlete;
    if (can(ctx, "athlete:read") && ctx.role === "MEDICAL") return athlete;

    const dentro = athlete.teams.some((t) => scope.includes(t.teamId));
    if (!dentro) throw new ForbiddenException("Esse atleta está fora do teu âmbito");
    return athlete;
  }

  private async entradaNoAmbito(db: ScopedClient, ctx: RequestContext, id: string) {
    const entry = await db.clinicalEntry.findFirst({
      where: { id },
      select: { id: true, athleteId: true, kind: true, status: true },
    });
    if (!entry) throw new NotFoundException("Registo clínico não encontrado");
    await this.atletaNoAmbito(db, ctx, entry.athleteId);
    return entry;
  }

  /* ------------------------------------------------------------------------ */

  /**
   * Registar no boletim — ou agendar.
   *
   * É a mesma entidade em dois momentos (ver `ClinicalStatus`): o agendamento de
   * hoje é o registo de amanhã. O que os distingue é o `status`, e um agendamento
   * futuro nunca afasta ninguém — o impacto força-se a `NONE`, porque uma consulta
   * marcada para a semana que vem não pode pôr o atleta de baixa hoje.
   */
  async criar(ctx: RequestContext, athleteId: string, dto: ClinicalInput) {
    this.mustWrite(ctx);

    const { entry, agendado, destinatarios, serie } = await this.prisma.runAs(ctx.academyId, async (db) => {
      await this.atletaNoAmbito(db, ctx, athleteId);

      /* Sem data é hoje — registar o que acabou de acontecer é o caso comum. */
      const date = dto.date ? dia(dto.date, "A data do registo é inválida") : dia(new Date().toISOString(), "");
      const agendado = dto.status === "SCHEDULED";
      const impact: ClinicalImpact = agendado ? "NONE" : ((dto.impact ?? "NONE") as ClinicalImpact);

      /* O tipo de consulta do clube decide o `kind`, e dá o título por omissão. */
      const tipo = dto.typeId ? await tipoDeConsulta(db, dto.typeId) : null;
      const kind: ClinicalKind = tipo ? tipo.kind : ((dto.kind ?? "NOTE") as ClinicalKind);

      /* Uma lesão acontece; não se marca. */
      if (agendado && kind === "INJURY") {
        throw new BadRequestException("Uma lesão não se agenda. Regista-a no boletim quando acontecer.");
      }
      const pedeConfirmacao = agendado && !!dto.confirmationRequired;
      const respondBy = dto.respondBy === "ATHLETE" ? "ATHLETE" : "GUARDIAN";

      const expectedReturn = dto.expectedReturn ? dia(dto.expectedReturn, "A data de retoma é inválida") : null;
      if (expectedReturn && expectedReturn < date) {
        throw new BadRequestException("A retoma não pode ser anterior ao registo");
      }

      /*
       * Repetir, como no calendário.
       *
       * Só num agendamento: o que já aconteceu regista-se uma vez. Cada sessão
       * fica um registo a sério, como cada treino de uma série é um evento: dar
       * a de quinta como feita ou desmarcá-la não mexe nas outras.
       */
      if (dto.repeat && !agendado) {
        throw new BadRequestException("Só um agendamento se repete");
      }
      const datas = dto.repeat ? datasDaSerie(date, dto.repeat) : [date];

      const entry = await db.clinicalEntry.create({
        data: {
          academyId: ctx.academyId,
          athleteId,
          authorId: ctx.membershipId,
          kind,
          typeId: tipo?.id ?? null,
          status: (dto.status ?? "DONE") as ClinicalStatus,
          // A primeira da série, que pode não ser o dia de início: "às quintas" a partir de uma terça.
          date: datas[0],
          time: agendado ? dto.time?.trim() || null : null,
          location: agendado ? dto.location?.trim() || null : null,
          title: dto.title?.trim() || tipo?.label || TITULO[kind],
          detail: dto.detail?.trim() || null,
          notes: dto.notes?.trim() || null,
          confirmationRequired: pedeConfirmacao,
          respondBy,
          impact,
          expectedReturn,
          outDays:
            expectedReturn && impact !== "NONE"
              ? Math.max(0, Math.round((expectedReturn.getTime() - date.getTime()) / 86_400_000))
              : null,
        },
        select: {
          id: true, title: true, date: true, time: true, location: true, kind: true, typeId: true,
          status: true, detail: true, confirmationRequired: true, respondBy: true,
        },
      });

      if (datas.length > 1) {
        await db.clinicalEntry.createMany({
          data: datas.slice(1).map((d) => ({
            academyId: ctx.academyId,
            athleteId,
            authorId: ctx.membershipId,
            kind: entry.kind,
            typeId: entry.typeId,
            status: entry.status,
            confirmationRequired: entry.confirmationRequired,
            respondBy: entry.respondBy,
            date: d,
            time: entry.time,
            location: entry.location,
            title: entry.title,
            detail: entry.detail,
            impact: "NONE" as ClinicalImpact,
          })),
        });
      }
      const serie = datas.length > 1 ? { total: datas.length, ultima: datas[datas.length - 1] } : undefined;

      /*
       * O exame actualiza a validade administrativa.
       *
       * `medicalValidUntil` é o que decide se um atleta pode competir, e vivia só
       * no formulário administrativo da ficha — que exige o NIF e pede
       * `athlete:write`, nenhuma das duas coisas do departamento clínico. A
       * médica registava o exame e a ficha continuava a dizer "sem exame".
       *
       * Escreve-se aqui, no mesmo gesto e com a permissão de quem faz o exame.
       * Só para exames **realizados**: um exame agendado ainda não valida nada.
       */
      if (kind === "EXAM" && dto.validUntil && dto.status !== "SCHEDULED") {
        await db.athlete.update({
          where: { id: athleteId },
          data: { medicalValidUntil: dia(dto.validUntil, "A validade do exame é inválida") },
        });
      }

      /* Quem avisar, ainda dentro da transacção: o envio é que fica para fora. */
      const destinatarios = agendado
        ? await this.quemAvisar(db, athleteId)
        : { nome: "", userIds: [], atleta: null, encarregados: [] };
      return { entry, agendado, destinatarios, serie };
    });

    if (agendado && destinatarios.userIds.length > 0) {
      await this.avisarDaConsulta(
        ctx.academyId,
        entry.id,
        {
          ...destinatarios,
          titulo: entry.title,
          date: entry.date,
          time: entry.time,
          location: entry.location,
          pedirA: entry.confirmationRequired ? entry.respondBy : null,
        },
        false,
        serie,
      );
    }

    return { id: entry.id, created: serie?.total ?? 1, avisados: agendado ? destinatarios.userIds.length : 0 };
  }

  /** Corrigir um registo. O que não vier fica como está. */
  async actualizar(ctx: RequestContext, id: string, dto: ClinicalInput) {
    this.mustWrite(ctx);

    const { depois, mudouAMarcacao, destinatarios } = await this.prisma.runAs(ctx.academyId, async (db) => {
      const entry = await this.entradaNoAmbito(db, ctx, id);

      const data: Prisma.ClinicalEntryUpdateInput = {};
      if (dto.typeId !== undefined) {
        const tipo = await tipoDeConsulta(db, dto.typeId);
        data.type = { connect: { id: tipo.id } };
        data.kind = tipo.kind;
      }
      if (dto.title !== undefined) data.title = dto.title.trim() || TITULO[entry.kind];
      if (dto.detail !== undefined) data.detail = dto.detail.trim() || null;
      if (dto.notes !== undefined) data.notes = dto.notes.trim() || null;
      if (dto.confirmationRequired !== undefined) data.confirmationRequired = dto.confirmationRequired;
      if (dto.respondBy !== undefined) data.respondBy = dto.respondBy === "ATHLETE" ? "ATHLETE" : "GUARDIAN";
      /*
       * Mudou o dia ou a hora: a resposta que havia era para outra marcação.
       * Fica por responder outra vez, como uma convocatória reenviada.
       */
      if (dto.date !== undefined || dto.time !== undefined) {
        data.reply = null;
        data.declineReason = null;
        data.respondedAt = null;
        data.respondedBy = { disconnect: true };
      }
      if (dto.date !== undefined) data.date = dia(dto.date, "A data do registo é inválida");
      if (dto.time !== undefined) data.time = dto.time.trim() || null;
      if (dto.location !== undefined) data.location = dto.location.trim() || null;
      if (dto.impact !== undefined) data.impact = dto.impact as ClinicalImpact;
      if (dto.status !== undefined) data.status = dto.status as ClinicalStatus;
      if (dto.expectedReturn !== undefined) {
        data.expectedReturn = dto.expectedReturn ? dia(dto.expectedReturn, "A data de retoma é inválida") : null;
      }

      const depois = await db.clinicalEntry.update({
        where: { id },
        data,
        select: {
          id: true, status: true, title: true, date: true, time: true, location: true, kind: true,
          confirmationRequired: true, respondBy: true,
        },
      });

      if ((dto.kind === "EXAM" || depois.kind === "EXAM") && dto.validUntil) {
        await db.athlete.update({
          where: { id: entry.athleteId },
          data: { medicalValidUntil: dia(dto.validUntil, "A validade do exame é inválida") },
        });
      }

      /*
       * Remarcar avisa outra vez.
       *
       * Só quando continua agendada e mudou o **quando** ou o **onde** — corrigir
       * uma gralha no título não é motivo para o telemóvel de ninguém apitar.
       */
      const mudouAMarcacao =
        depois.status === "SCHEDULED" &&
        (data.date !== undefined || data.time !== undefined || data.location !== undefined);
      const destinatarios = mudouAMarcacao
        ? await this.quemAvisar(db, entry.athleteId)
        : { nome: "", userIds: [], atleta: null, encarregados: [] };

      return { depois, mudouAMarcacao, destinatarios };
    });

    if (mudouAMarcacao && destinatarios.userIds.length > 0) {
      await this.avisarDaConsulta(
        ctx.academyId,
        depois.id,
        {
          ...destinatarios,
          titulo: depois.title,
          date: depois.date,
          time: depois.time,
          location: depois.location,
          pedirA: depois.confirmationRequired ? depois.respondBy : null,
        },
        true,
      );
    }

    return { ok: true as const, avisados: mudouAMarcacao ? destinatarios.userIds.length : 0 };
  }

  /**
   * A família (ou o atleta) responde a uma consulta que pediu confirmação.
   *
   * O espelho de `MatchesService.responderConvocatoria`: o atleta tem de ser de
   * quem responde (`athleteScopeFilter`), e quem responde é quem a consulta diz
   * (`assertPodeResponderPor`). A recusa leva motivo, para o departamento
   * clínico saber se remarca ou se telefona.
   */
  async responder(ctx: RequestContext, id: string, resposta: { going: boolean; reason?: string | null }) {
    const motivo = (resposta.reason ?? "").trim();
    if (!resposta.going && !motivo) {
      throw new BadRequestException("Diz porque é que não pode ir, para a consulta poder ser remarcada");
    }
    if (motivo.length > 300) throw new BadRequestException("O motivo é demasiado longo");

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const entry = await db.clinicalEntry.findFirst({
        where: { id },
        select: { id: true, athleteId: true, status: true, date: true, confirmationRequired: true, respondBy: true },
      });
      const meus = athleteScopeFilter(ctx);
      /* Um atleta que não é deste utilizador responde como uma consulta que não existe. */
      if (!entry || (meus && !meus.in.includes(entry.athleteId))) {
        throw new NotFoundException("Consulta não encontrada");
      }
      assertPodeResponderPor(ctx, entry.respondBy);
      if (entry.status !== "SCHEDULED") throw new BadRequestException("Esta consulta já não está marcada");
      if (!entry.confirmationRequired) throw new BadRequestException("Esta consulta não pede confirmação");
      if (entry.date.getTime() < dia(new Date().toISOString(), "").getTime()) {
        throw new BadRequestException("Esta consulta já passou");
      }

      const depois = await db.clinicalEntry.update({
        where: { id },
        data: {
          reply: resposta.going ? "CONFIRMED" : "DECLINED",
          // Voltar atrás limpa o motivo, ou ficava a explicar uma ausência que deixou de existir.
          declineReason: resposta.going ? null : motivo,
          respondedAt: new Date(),
          respondedById: ctx.membershipId,
        },
        select: { id: true, reply: true, declineReason: true, respondedAt: true },
      });
      return depois;
    });
  }

  /**
   * Dar alta.
   *
   * Fecha a ocorrência em vez de criar outra — a alta é o fim daquela lesão, não
   * um acontecimento separado no historial. É o que devolve o atleta à
   * disponibilidade, porque a disponibilidade é derivada do boletim e não um
   * campo que alguém tem de se lembrar de mudar.
   */
  async darAlta(ctx: RequestContext, id: string, on?: string) {
    this.mustWrite(ctx);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      await this.entradaNoAmbito(db, ctx, id);
      await db.clinicalEntry.update({
        where: { id },
        data: { clearedOn: on ? dia(on, "A data da alta é inválida") : new Date() },
      });
      return { ok: true as const };
    });
  }

  /** Reabrir uma alta dada por engano. */
  async reabrir(ctx: RequestContext, id: string) {
    this.mustWrite(ctx);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      await this.entradaNoAmbito(db, ctx, id);
      await db.clinicalEntry.update({ where: { id }, data: { clearedOn: null } });
      return { ok: true as const };
    });
  }

  /**
   * Apagar.
   *
   * Só o que ainda não aconteceu — um agendamento que se desmarca. Um registo do
   * que se passou é histórico clínico e não se faz desaparecer: corrige-se, ou
   * dá-se alta. Apagar uma lesão apagava a razão pela qual um atleta esteve fora
   * três semanas, e essa razão pertence à ficha dele.
   */
  async apagar(ctx: RequestContext, id: string) {
    this.mustWrite(ctx);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const entry = await this.entradaNoAmbito(db, ctx, id);
      if (entry.status !== "SCHEDULED") {
        throw new BadRequestException(
          "Um registo do que aconteceu não se apaga — corrige-o, ou dá alta. Só agendamentos se desmarcam.",
        );
      }
      await db.clinicalEntry.delete({ where: { id } });
      return { ok: true as const };
    });
  }
}

/* -------------------------------------------------------------------------- */

export type ClinicalInput = {
  kind?: string;
  status?: string;
  date?: string;
  time?: string;
  location?: string;
  title?: string;
  detail?: string;
  impact?: string;
  expectedReturn?: string | null;
  /** Só para exames: até quando é que o atleta fica com o exame válido. */
  validUntil?: string;
  /** O tipo de consulta do clube (catálogo `consultationTypes`). Decide o `kind`. */
  typeId?: string;
  /** As notas de quem deu a consulta. Não saem para a família. */
  notes?: string;
  confirmationRequired?: boolean;
  respondBy?: string;
  /** Só em agendamentos: a mesma consulta até uma data. A forma é a do calendário (`RepeatDto`). */
  repeat?: { freq: "DAILY" | "WEEKLY" | "MONTHLY"; until: string; weekdays?: number[] };
};

/** O título por omissão de cada tipo — um registo sem título não é ilegível. */
const TITULO: Record<ClinicalKind, string> = {
  INJURY: "Lesão",
  EXAM: "Exame médico",
  PHYSIO: "Fisioterapia",
  NUTRITION: "Nutrição",
  PSYCHOLOGY: "Psicologia",
  NOTE: "Nota",
  CONSULTATION: "Consulta",
};

/**
 * Uma data de calendário, à meia-noite UTC.
 *
 * As colunas são `@db.Date` e o que chega é `2026-03-14`. Sem o `T00:00:00Z`, o
 * `new Date` interpreta no fuso local e uma consulta marcada para dia 14 fica
 * gravada a 13 em qualquer fuso a oeste de Greenwich — que é o nosso metade do
 * ano.
 */
function dia(valor: string, erro: string): Date {
  const d = new Date(`${valor.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new BadRequestException(erro);
  return d;
}

/**
 * Quantas sessões uma série pode ter. Três por semana durante uma época dá umas
 * 130; o tecto é o mesmo do calendário e trava o "todos os dias durante cinco
 * anos" escrito por engano.
 */
const MAX_SESSOES = 200;

/**
 * As datas de uma série de consultas.
 *
 * O mesmo gerador do calendário (`occurrences` em `academy.service.ts`), mas só
 * com dias: a coluna é `@db.Date` e a hora vive à parte, em texto, por isso não
 * há mudança de hora nem fuso que a faça escorregar. Anda-se de dia em dia em
 * UTC, que é como as datas estão guardadas.
 *
 * No mensal, um mês sem o dia pretendido (31 de Fevereiro) salta-se, como no
 * calendário; `weekdays` vazio repete no dia da semana da primeira sessão.
 */
export function datasDaSerie(
  primeira: Date,
  repeat: { freq: "DAILY" | "WEEKLY" | "MONTHLY"; until: string; weekdays?: number[] },
): Date[] {
  const ate = dia(repeat.until, "A data de fim da repetição é inválida");
  if (ate < primeira) throw new BadRequestException("A repetição tem de acabar depois da primeira consulta");

  const out: Date[] = [];
  if (repeat.freq === "MONTHLY") {
    const alvo = primeira.getUTCDate();
    for (let m = 0; out.length < MAX_SESSOES; m++) {
      const d = new Date(Date.UTC(primeira.getUTCFullYear(), primeira.getUTCMonth() + m, alvo));
      // Transbordou para o mês seguinte: este mês não tem o dia, salta-se.
      if (d.getUTCDate() !== alvo) continue;
      if (d > ate) break;
      out.push(d);
    }
    return out;
  }

  const dias = repeat.freq === "WEEKLY" ? new Set(repeat.weekdays?.length ? repeat.weekdays : [primeira.getUTCDay()]) : null;
  for (let d = new Date(primeira); d <= ate && out.length < MAX_SESSOES; d = new Date(d.getTime() + 86_400_000)) {
    if (!dias || dias.has(d.getUTCDay())) out.push(d);
  }
  if (out.length === 0) throw new BadRequestException("Nenhum dos dias escolhidos cai entre as duas datas");
  return out;
}

/**
 * O `kind` de um tipo de consulta do clube, pelo nome.
 *
 * O catálogo é do clube e os nomes são dele, mas o domínio precisa de saber que
 * um exame é um exame (é o que actualiza a validade médica). O resto é
 * `CONSULTATION`. A mesma ideia de `kindOfEventType` na consola.
 */
export function kindDoTipo(label: string): ClinicalKind {
  const n = label.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (n.includes("exame")) return "EXAM";
  if (n.includes("fisio")) return "PHYSIO";
  if (n.includes("nutri")) return "NUTRITION";
  if (n.includes("psico")) return "PSYCHOLOGY";
  return "CONSULTATION";
}

async function tipoDeConsulta(db: ScopedClient, id: string) {
  const tipo = await db.catalogItem.findFirst({
    where: { id, kind: "consultationTypes", archivedAt: null },
    select: { id: true, label: true },
  });
  if (!tipo) throw new BadRequestException("Esse tipo de consulta não existe no clube");
  return { ...tipo, kind: kindDoTipo(tipo.label) };
}

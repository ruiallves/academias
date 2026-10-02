import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { inferSportCode } from "../academy/academy.service";
import { nomeDeQuemMexe } from "../common/historico";
import { can, type RequestContext } from "../common/permissions";
import { currentSeason } from "../common/seasons";
import { PrismaService, type ScopedClient } from "../prisma/prisma.service";
import { FPF_F11M_2026 } from "./catalogo-fpf-f11m-2026";
import type { AnswerDto, ProfileDto } from "./certification.dto";
import {
  ESCALOES,
  PERFIL_VAZIO,
  acessoDe,
  aplicaSe,
  avaliar,
  caminhoPara,
  escalaoDe,
  faltaNoAcesso,
  minimoDaEquipa,
  nivelDe,
  pontosDoNivel,
  pontosGanhos,
  pontosMaximos,
  tetos,
  valorDe,
  type Escalao,
  type Patamar,
  type Perfil,
  type Plantel,
  type Requisito,
  type Valores,
} from "./motor";
import { REGRAS, semAtletas, type Calculo, type Factos, type FactosDaEquipa } from "./regras";

/**
 * O manual por que se avalia. Um só por agora: futebol masculino. Futsal e
 * feminino têm manuais próprios e entram aqui quando forem transcritos.
 */
const CATALOGO = FPF_F11M_2026;

/** Os papéis que contam como treinador numa equipa. Um delegado ou um fisioterapeuta não treina. */
const TREINA = ["OWNER", "DIRECTOR", "COORDINATOR", "COACH"] as const;

type Epoca = { id: string; label: string; startsOn: Date; endsOn: Date };

/**
 * Certificação FPF.
 *
 * ## O que este serviço faz
 *
 * Junta três coisas e entrega-as ao motor (`motor.ts`), que é quem decide:
 *
 * 1. o **manual**, que vive em código;
 * 2. os **factos** do clube, lidos da base (`factos`) e passados pelas regras
 *    (`regras.ts`), que respondem ao que os dados conseguem provar;
 * 3. as **respostas** que alguém deu à mão, que ganham ao cálculo.
 *
 * ## Nada do resultado se guarda
 *
 * O nível, os pontos e o estado de cada requisito são calculados a cada
 * leitura. Só as respostas e o perfil têm linha na base. No dia em que um
 * treinador planeia a semana ou um encarregado submete as notas, o nível muda
 * sem ninguém ter de carregar em nada.
 *
 * ## É uma estimativa
 *
 * Quem certifica é a FPF, com um avaliador e uma visita técnica. O que sai
 * daqui é o que o clube consegue saber antes disso — e o ecrã di-lo.
 */
@Injectable()
export class CertificationService {
  constructor(private readonly prisma: PrismaService) {}

  private mustRead(ctx: RequestContext) {
    if (!can(ctx, "certification:read")) throw new ForbiddenException("Sem acesso à certificação");
  }

  private mustWrite(ctx: RequestContext) {
    if (!can(ctx, "certification:write")) throw new ForbiddenException("Sem permissão para alterar a certificação");
  }

  /* ---------------------------------------------------------------------- */
  /* Leitura                                                                 */
  /* ---------------------------------------------------------------------- */

  async resumo(ctx: RequestContext) {
    this.mustRead(ctx);
    /*
     * A leitura são cerca de vinte consultas pequenas. Em produção cabem com
     * folga nos cinco segundos de uma transação; contra a base a partir de um
     * portátil, não cabem. O tecto sobe para a página não rebentar em
     * desenvolvimento com um 500 que em produção nunca apareceria.
     */
    return this.prisma.runAs(ctx.academyId, (db) => this.montar(db, ctx), { timeoutMs: 20_000 });
  }

  private async montar(db: ScopedClient, ctx: RequestContext) {
    const modalidade = await this.futebol(db);
    const epoca = await currentSeason(db);
    if (!modalidade || !epoca) {
      // Um clube sem futebol, ou sem época nenhuma, não tem candidatura. A
      // consola nem lhe mostra o menu; isto é para quem chega pelo endereço.
      return { available: false as const, reason: modalidade ? "Ainda não há uma época criada." : "A certificação da FPF é para clubes com futebol." };
    }

    const processo = await db.certificationProcess.findUnique({
      where: { academyId_seasonId_catalogKey: { academyId: ctx.academyId, seasonId: epoca.id, catalogKey: CATALOGO.key } },
      select: { profile: true, answers: { select: { code: true, value: true, note: true, answeredByName: true, updatedAt: true } } },
    });

    const equipas = await this.equipas(db, modalidade.id, epoca.id);
    const perfil = processo ? lerPerfil(processo.profile) : perfilProposto(equipas);
    const factos = await this.factos(db, modalidade.id, epoca, equipas);
    const plantel = plantelDe(factos);

    const respostas = new Map((processo?.answers ?? []).map((a) => [a.code, a]));
    const calculos = new Map<string, Calculo>();
    const valores: Valores = {};
    for (const r of CATALOGO.requirements) {
      const calculo = REGRAS[r.code]?.(factos);
      if (calculo) calculos.set(r.code, calculo);
      // A resposta de uma pessoa ganha ao cálculo: o clube pode ter o dossier
      // noutro sítio, e é ele que responde perante a FPF.
      valores[r.code] = respostas.get(r.code)?.value ?? calculo?.value;
    }

    const acesso = acessoDe(plantel, perfil);
    const avaliacao = avaliar(CATALOGO, valores, perfil, acesso);
    const alvo = avaliacao.level < 5 ? avaliacao.level + 1 : null;
    const caminho = alvo === null ? null : caminhoPara(alvo, avaliacao);
    const bloqueiam = new Set(caminho?.mandatory.map((m) => m.requirement.code));

    const ganho = (r: Requisito) => pontosMaximos(r, perfil) - pontosGanhos(r, valorDe(r, valores), perfil);
    const atalhos = CATALOGO.requirements
      .filter((r) => aplicaSe(r, perfil) && !r.assessor && !bloqueiam.has(r.code) && ganho(r) > 0)
      .sort((a, b) => ganho(b) - ganho(a))
      .slice(0, 8)
      .map((r) => ({ code: r.code, gain: ganho(r) }));

    const porPatamar = (p: "C" | "E" | "T" | "Q") => ({
      total: CATALOGO.requirements.reduce(
        (n, r) => n + (aplicaSe(r, perfil) ? Number(r.mandatory === p) + (r.tiers?.filter((t) => t.mandatory === p).length ?? 0) : 0),
        0,
      ),
      missing: avaliacao.missing[p].length,
    });

    return {
      available: true as const,
      catalog: { key: CATALOGO.key, title: CATALOGO.title, manual: CATALOGO.manual, season: epoca.label },
      canWrite: can(ctx, "certification:write"),
      profile: perfil,
      /** Falso enquanto ninguém confirmou o perfil: o que se mostra é a proposta. */
      profileSet: Boolean(processo),
      teams: equipas.map((t) => ({ id: t.id, name: t.name, maxAge: t.maxAge, athletes: t.athletes, gender: t.gender })),

      level: nivelDe(avaliacao.level),
      ceilings: tetos(avaliacao),
      points: { got: avaliacao.points, max: avaliacao.max, assessor: avaliacao.assessor, notApplicable: 100 - avaliacao.max },
      mandatory: { C: porPatamar("C"), E: porPatamar("E"), T: porPatamar("T"), Q: porPatamar("Q") },

      access: {
        squads: ESCALOES.map((e) => ({ age: e, athletes: plantel.squads[e] ?? 0, need: minimoDaEquipa(e), ok: (plantel.squads[e] ?? 0) >= minimoDaEquipa(e) })),
        senior: { ok: perfil.hasSenior, athletes: plantel.senior },
        women: { teams: plantel.womenTeams, players: plantel.womenPlayers, ok: plantel.womenTeams >= 1 || plantel.womenPlayers >= 20 },
        national: perfil.islands || perfil.nationalLast5,
        missing: faltaNoAcesso(plantel, perfil),
      },

      next: caminho && {
        target: nivelDe(caminho.target),
        accessOk: caminho.accessOk,
        mandatory: caminho.mandatory.map((m) => m.requirement.code),
        points: caminho.points,
        needPoints: caminho.needPoints,
      },
      quickWins: atalhos,

      criteria: CATALOGO.criteria.map((c) => ({
        ...c,
        got: avaliacao.byCriterion[c.criterion]?.got ?? 0,
        reach: avaliacao.byCriterion[c.criterion]?.max ?? 0,
        total: avaliacao.byCriterion[c.criterion]?.total ?? 0,
        missing: avaliacao.byCriterion[c.criterion]?.missing ?? 0,
        blocking: caminho?.mandatory.filter((m) => m.requirement.criterion === c.criterion).length ?? 0,
      })),
      groups: CATALOGO.groups,

      requirements: CATALOGO.requirements.map((r) => {
        const aplica = aplicaSe(r, perfil);
        const valor = valorDe(r, valores);
        const resposta = respostas.get(r.code);
        const calculo = calculos.get(r.code);
        return {
          code: r.code,
          criterion: r.criterion,
          group: r.group,
          text: r.text,
          mode: r.mode,
          source: r.source,
          evidence: r.evidence ?? null,
          note: r.note ?? null,
          condition: r.condition ?? null,
          mandatory: r.mandatory ?? r.tiers?.find((t) => t.mandatory)?.mandatory ?? null,
          tiers: r.tiers?.map((t, i) => ({ label: t.label, points: pontosDoNivel(r, i, perfil), mandatory: t.mandatory ?? null })) ?? null,
          points: aplica ? pontosMaximos(r, perfil) : (r.points ?? Math.max(...(r.tiers ?? []).map((t) => t.points))),
          earned: aplica ? pontosGanhos(r, valor, perfil) : 0,
          value: valor,
          status: estadoDe(r, valor, aplica),
          /** De onde vem o valor: da resposta de alguém, do cálculo, ou de lado nenhum. */
          origin: !aplica || r.assessor ? ("none" as const) : resposta ? ("answer" as const) : calculo ? ("auto" as const) : ("none" as const),
          blocking: bloqueiam.has(r.code),
          /** Os patamares em que é obrigatório, e se cada um já está cumprido. */
          levels: aplica ? patamaresDe(r, valor) : [],
          auto: calculo ?? null,
          answer: resposta ? { value: resposta.value, note: resposta.note, by: resposta.answeredByName, at: resposta.updatedAt } : null,
        };
      }),
    };
  }

  /** A modalidade de futebol do clube. Só pode haver uma (ver `checkDisciplinaLivre`). */
  private async futebol(db: ScopedClient) {
    const modalidades = await db.sport.findMany({ select: { id: true, name: true, code: true } });
    return modalidades.find((s) => (s.code ?? inferSportCode(s.name)) === "football") ?? null;
  }

  /** As equipas de futebol da época, com os atletas activos de cada uma. */
  private async equipas(db: ScopedClient, sportId: string, seasonId: string) {
    const linhas = await db.team.findMany({
      where: { sportId, seasonId },
      orderBy: [{ maxAge: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        maxAge: true,
        gender: true,
        // `leftAt: null` — sem isto volta quem já saiu (ver a nota das passagens).
        athletes: {
          where: { leftAt: null, athlete: { status: "ACTIVE" } },
          select: { athleteId: true, athlete: { select: { medicalValidUntil: true, sex: true } } },
        },
      },
    });
    return linhas.map((t) => ({ id: t.id, name: t.name, maxAge: t.maxAge, gender: t.gender, athletes: t.athletes.length, membros: t.athletes }));
  }

  /**
   * Os factos do clube: contagens, e mais nada.
   *
   * Tudo o que aqui se lê é da **formação masculina** — Sub-7 a Sub-19, fora as
   * equipas femininas — porque é a ela que este manual se aplica. Uma equipa
   * mista, ou sem género indicado, conta: é no futebol masculino que as
   * raparigas dos escalões mais novos estão inscritas. O futebol feminino entra
   * só no acesso às 5 estrelas, contado à parte.
   */
  private async factos(
    db: ScopedClient,
    sportId: string,
    epoca: Epoca,
    equipas: Awaited<ReturnType<CertificationService["equipas"]>>,
  ): Promise<Factos> {
    const agora = new Date();
    const femininas = new Set(equipas.filter((t) => t.gender === "FEMALE").map((t) => t.id));
    const formacao = equipas.filter((t) => !femininas.has(t.id) && typeof escalaoDe(t.maxAge) === "number");

    // As praticantes femininas da formação, em equipas femininas ou não: a
    // rapariga que joga nos Sub-11 mistos conta tanto como a dos Sub-15 femininos.
    const praticantes = new Set<string>();
    for (const t of equipas) {
      if (typeof escalaoDe(t.maxAge) !== "number") continue;
      for (const m of t.membros) if (femininas.has(t.id) || m.athlete.sex === "FEMALE") praticantes.add(m.athleteId);
    }
    const ids = formacao.map((t) => t.id);

    // Atletas distintos: um miúdo que treina em duas equipas conta uma vez, no
    // escalão mais baixo em que está.
    const escalaoDoAtleta = new Map<string, Escalao>();
    const comExame = new Set<string>();
    for (const t of formacao) {
      const e = escalaoDe(t.maxAge) as Escalao;
      for (const m of t.membros) {
        if (!escalaoDoAtleta.has(m.athleteId) || e < escalaoDoAtleta.get(m.athleteId)!) escalaoDoAtleta.set(m.athleteId, e);
        if (m.athlete.medicalValidUntil && m.athlete.medicalValidUntil >= inicioDoDia(agora)) comExame.add(m.athleteId);
      }
    }
    const atletas = [...escalaoDoAtleta.keys()];
    const athletesByAge = semAtletas();
    for (const e of escalaoDoAtleta.values()) athletesByAge[e]++;

    const daEpoca = { gte: epoca.startsOn, lt: agora };
    const treino: Prisma.TrainingSessionWhereInput = { teamId: { in: ids }, startsAt: daEpoca, status: { not: "CANCELLED" } };
    const comPlano: Prisma.TrainingSessionWhereInput = { ...treino, blocks: { some: {} } };
    const ha30dias = new Date(agora.getTime() - 30 * 24 * 60 * 60 * 1000);
    const recente = { gte: ha30dias > epoca.startsOn ? ha30dias : epoca.startsOn, lt: agora };
    const jogo: Prisma.MatchWhereInput = { teamId: { in: ids }, startsAt: daEpoca, status: { not: "CANCELLED" } };

    const treinosPorEquipa = await db.trainingSession.groupBy({ by: ["teamId"], where: treino, _count: { _all: true } });
    const planosPorEquipa = await db.trainingSession.groupBy({ by: ["teamId"], where: comPlano, _count: { _all: true } });
    const ciclos = await db.trainingCycle.findMany({
      where: { teamId: { in: ids }, startsOn: { lte: epoca.endsOn }, endsOn: { gte: epoca.startsOn } },
      select: { teamId: true, level: true, objective: true },
    });
    const treinadores = await db.teamStaff.findMany({
      where: { teamId: { in: ids }, leftAt: null, membership: { isActive: true, role: { in: [...TREINA] } } },
      distinct: ["membershipId"],
      select: { membershipId: true },
    });

    const conta = (linhas: { teamId: string; _count: { _all: number } }[], id: string) => linhas.find((l) => l.teamId === id)?._count._all ?? 0;
    const teams: FactosDaEquipa[] = equipas.map((t) => ({
      id: t.id,
      name: t.name,
      maxAge: t.maxAge,
      women: femininas.has(t.id),
      athletes: t.athletes,
      sessions: conta(treinosPorEquipa, t.id),
      sessionsWithBlocks: conta(planosPorEquipa, t.id),
      mesos: ciclos.filter((c) => c.teamId === t.id && c.level === "MESO").length,
      micros: ciclos.filter((c) => c.teamId === t.id && c.level === "MICRO").length,
      microsWithObjective: ciclos.filter((c) => c.teamId === t.id && c.level === "MICRO" && c.objective?.trim()).length,
    }));

    // O material pode estar escrito no treino, num bloco, ou vir do exercício
    // que o bloco usa — qualquer um dos três descreve o que foi para o campo.
    const comMaterial = await db.trainingSession.count({
      where: {
        ...comPlano,
        OR: [{ material: { not: null } }, { blocks: { some: { OR: [{ material: { not: null } }, { exerciseId: { not: null } }] } } }],
      },
    });

    const anoAnterior = anoLectivoAnterior(epoca.label);
    const comNutricao = await db.nutritionPlan.findMany({
      where: { athleteId: { in: atletas }, publishedAt: { not: null } },
      distinct: ["athleteId"],
      select: { athleteId: true },
    });

    return {
      teams,
      athletesByAge,
      formationAthletes: atletas.length,
      coaches: treinadores.length,
      womenPlayers: praticantes.size,

      recentSessions: await db.trainingSession.count({ where: { ...treino, startsAt: recente } }),
      recentSessionsPlanned: await db.trainingSession.count({ where: { ...comPlano, startsAt: recente } }),
      plannedSessions: planosPorEquipa.reduce((n, l) => n + l._count._all, 0),
      plannedSessionsWithMaterial: comMaterial,

      matchesPlayed: await db.match.count({ where: jogo }),
      matchesWithCallUp: await db.match.count({ where: { ...jogo, callUpsClosedAt: { not: null } } }),
      matchesWithReport: await db.match.count({ where: { ...jogo, report: { isNot: null } } }),

      athletesEvaluated: (
        await db.evaluation.findMany({
          where: { athleteId: { in: atletas }, status: "PUBLISHED", updatedAt: { gte: epoca.startsOn } },
          distinct: ["athleteId"],
          select: { athleteId: true },
        })
      ).length,
      clinicalEntries: await db.clinicalEntry.count({ where: { athleteId: { in: atletas }, status: "DONE", date: { gte: epoca.startsOn } } }),
      athletesWithValidExam: comExame.size,
      nutritionAgeGroups: new Set(comNutricao.map((p) => escalaoDoAtleta.get(p.athleteId))).size,
      athletesWithGrades: (
        await db.schoolGrade.findMany({
          where: { athleteId: { in: atletas }, schoolYear: { in: anoAnterior ? [epoca.label, anoAnterior] : [epoca.label] } },
          distinct: ["athleteId"],
          select: { athleteId: true },
        })
      ).length,

      prospects: await db.prospect.count({ where: { sportId, archivedAt: null } }),
      observations: await db.observation.count({ where: { prospect: { sportId }, observedAt: { gte: epoca.startsOn } } }),
    };
  }

  /* ---------------------------------------------------------------------- */
  /* Escrita                                                                 */
  /* ---------------------------------------------------------------------- */

  async guardarPerfil(ctx: RequestContext, dto: ProfileDto) {
    this.mustWrite(ctx);
    return this.prisma.runAs(
      ctx.academyId,
      async (db) => {
        const { epoca } = await this.candidatura(db);
        const perfil = lerPerfil(dto);

        const chave = { academyId_seasonId_catalogKey: { academyId: ctx.academyId, seasonId: epoca.id, catalogKey: CATALOGO.key } };
        await db.certificationProcess.upsert({
          where: chave,
          create: { academyId: ctx.academyId, seasonId: epoca.id, catalogKey: CATALOGO.key, profile: perfil },
          update: { profile: perfil },
        });
        return this.montar(db, ctx);
      },
      { timeoutMs: 20_000 },
    );
  }

  async responder(ctx: RequestContext, code: string, dto: AnswerDto) {
    this.mustWrite(ctx);
    const requisito = requisitoRespondivel(code);
    const maximo = requisito.tiers ? requisito.tiers.length - 1 : 1;
    const minimo = requisito.tiers ? -1 : 0;
    if (dto.value < minimo || dto.value > maximo) throw new BadRequestException("Resposta fora do que este requisito aceita");

    return this.prisma.runAs(
      ctx.academyId,
      async (db) => {
        const processo = await this.processo(db, ctx);
        const quem = await nomeDeQuemMexe(db, ctx);
        const dados = { value: dto.value, note: dto.note?.trim() || null, answeredById: ctx.membershipId, answeredByName: quem };
        await db.certificationAnswer.upsert({
          where: { processId_code: { processId: processo.id, code } },
          create: { academyId: ctx.academyId, processId: processo.id, code, ...dados },
          update: dados,
        });
        return this.montar(db, ctx);
      },
      { timeoutMs: 20_000 },
    );
  }

  async apagarResposta(ctx: RequestContext, code: string) {
    this.mustWrite(ctx);
    requisitoRespondivel(code);
    return this.prisma.runAs(
      ctx.academyId,
      async (db) => {
        const processo = await this.processo(db, ctx);
        await db.certificationAnswer.deleteMany({ where: { processId: processo.id, code } });
        return this.montar(db, ctx);
      },
      { timeoutMs: 20_000 },
    );
  }

  private async candidatura(db: ScopedClient) {
    const modalidade = await this.futebol(db);
    if (!modalidade) throw new NotFoundException("A certificação da FPF é para clubes com futebol");
    const epoca = await currentSeason(db);
    if (!epoca) throw new NotFoundException("Ainda não há uma época criada");
    return { modalidade, epoca };
  }

  /**
   * A candidatura desta época, criada à primeira escrita.
   *
   * Nasce com o perfil **proposto** e não vazio: quem responde a um requisito
   * antes de abrir o perfil não pode ficar, por isso, com um clube sem equipa
   * sénior quando a tem.
   */
  private async processo(db: ScopedClient, ctx: RequestContext) {
    const { modalidade, epoca } = await this.candidatura(db);
    const chave = { academyId_seasonId_catalogKey: { academyId: ctx.academyId, seasonId: epoca.id, catalogKey: CATALOGO.key } };
    const existente = await db.certificationProcess.findUnique({ where: chave, select: { id: true } });
    if (existente) return existente;

    const equipas = await this.equipas(db, modalidade.id, epoca.id);
    return db.certificationProcess.create({
      data: { academyId: ctx.academyId, seasonId: epoca.id, catalogKey: CATALOGO.key, profile: perfilProposto(equipas) },
      select: { id: true },
    });
  }
}

/* -------------------------------------------------------------------------- */
/* Puras                                                                       */
/* -------------------------------------------------------------------------- */

const REQUISITOS = new Map(CATALOGO.requirements.map((r) => [r.code, r]));

/** O requisito, se existir e se for o clube a responder-lhe. */
function requisitoRespondivel(code: string): Requisito {
  const r = REQUISITOS.get(code);
  if (!r) throw new NotFoundException("Requisito desconhecido");
  if (r.assessor) throw new BadRequestException("Estes pontos são atribuídos pelo avaliador da FPF");
  return r;
}

/**
 * Os patamares em que um requisito é obrigatório.
 *
 * Numa questão por níveis podem ser vários — a coordenação clínica pede um
 * técnico de SBV para o CBFF, um médico para as 3 estrelas e um pós-graduado
 * para as 4 — e cada um cumpre-se à parte. É o que deixa o ecrã responder a
 * "o que falta para as 3 estrelas" sem refazer as contas do motor.
 */
function patamaresDe(r: Requisito, valor: number): { tier: Patamar; met: boolean }[] {
  if (r.tiers) return r.tiers.flatMap((t, i) => (t.mandatory ? [{ tier: t.mandatory, met: valor >= i }] : []));
  return r.mandatory ? [{ tier: r.mandatory, met: valor > 0 }] : [];
}

export type Estado = "met" | "partial" | "missing" | "assessor" | "na";

function estadoDe(r: Requisito, valor: number, aplica: boolean): Estado {
  if (!aplica) return "na";
  if (r.assessor) return "assessor";
  if (r.tiers) return valor < 0 ? "missing" : valor < r.tiers.length - 1 ? "partial" : "met";
  return valor > 0 ? "met" : "missing";
}

/**
 * O perfil guardado, lido com desconfiança.
 *
 * É JSON: pode ter sido escrito por uma versão anterior, com menos campos ou
 * com campos que já não existem (as equipas femininas eram marcadas aqui). O
 * que falta cai no valor de `PERFIL_VAZIO`, um tipo errado também, e o que
 * sobra ignora-se.
 */
function lerPerfil(json: unknown): Perfil {
  const o = (json && typeof json === "object" ? json : {}) as Record<string, unknown>;
  const sim = (k: keyof Perfil) => (typeof o[k] === "boolean" ? (o[k] as boolean) : (PERFIL_VAZIO[k] as boolean));
  return {
    hasSenior: sim("hasSenior"),
    recruits: sim("recruits"),
    hasDre: sim("hasDre"),
    nonNationals: sim("nonNationals"),
    nationalLast5: sim("nationalLast5"),
    islands: sim("islands"),
    lowDensity: sim("lowDensity"),
  };
}

/**
 * O perfil que se propõe a um clube que ainda não o confirmou.
 *
 * A única coisa que a plataforma sabe é se há uma equipa sénior com gente
 * suficiente. O resto começa em "não", que é a resposta que liga menos
 * questões — e a página pede para o perfil ser confirmado.
 */
function perfilProposto(equipas: { maxAge: number; athletes: number }[]): Perfil {
  const senior = equipas.some((t) => escalaoDe(t.maxAge) === "senior" && t.athletes >= minimoDaEquipa("senior"));
  return { ...PERFIL_VAZIO, hasSenior: senior };
}

/** O plantel que o acesso conta: o maior de cada escalão, masculino, e o futebol feminino à parte. */
function plantelDe(f: Factos): Plantel {
  const squads: Plantel["squads"] = {};
  let senior = 0;
  let womenTeams = 0;
  for (const t of f.teams) {
    const e = escalaoDe(t.maxAge);
    if (e === null) continue;
    if (t.women) {
      if (t.athletes >= minimoDaEquipa(e)) womenTeams++;
    } else if (e === "senior") senior = Math.max(senior, t.athletes);
    else squads[e] = Math.max(squads[e] ?? 0, t.athletes);
  }
  return { squads, senior, womenTeams, womenPlayers: f.womenPlayers };
}

/** `2026/27` → `2025/26`. As notas do 3.º período do ano anterior também contam. */
function anoLectivoAnterior(label: string): string | null {
  const m = /^(\d{4})\/(\d{2})$/.exec(label);
  if (!m) return null;
  const ano = Number(m[1]) - 1;
  return `${ano}/${String((ano + 1) % 100).padStart(2, "0")}`;
}

/** Meia-noite UTC de hoje: as validades são datas sem hora (`@db.Date`). */
function inicioDoDia(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

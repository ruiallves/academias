import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, type AdjuntoProposal } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { can, type RequestContext } from "../common/permissions";
import { horaNoFuso, partesNoFuso } from "../common/fuso";
import { AcademyService } from "../academy/academy.service";
import { ClinicalService } from "../academy/clinical.service";
import { MatchesService } from "../academy/matches.service";
import { AthletesService } from "../academy/athletes.service";
import { AnnouncementsService } from "../academy/announcements.service";
import { NotificationsService } from "../notifications/notifications.service";
import { TrainingService, type ExerciseInput, type PlanInput } from "../training/training.service";
import { SiteService } from "../site/site.service";
import { PatrocinadoresService } from "../patrocinadores/patrocinadores.service";
import { ACOES, podeFazer } from "./acoes";
import type { BlocoLido } from "./planos";

/** Uma operação do site, como `proporSite` a guarda na proposta e `executarSite` a corre. */
type OperacaoDoSite =
  | { op: "inicio"; inicio: unknown; antes?: unknown }
  | { op: "config"; data: { layout?: string; publicado?: boolean }; antes?: { layout?: string; publicado?: boolean } }
  | { op: "produto_criar"; dto: unknown }
  | { op: "produto_editar"; id: string; dto: unknown; antes?: unknown }
  | { op: "produto_apagar"; id: string; antes?: unknown }
  | { op: "patrocinador_criar"; dto: unknown }
  | { op: "patrocinador_apagar"; id: string; antes?: unknown }
  | { op: "bilheteira"; matchId: string; dto: unknown | null; antes?: unknown | null };

/**
 * As propostas do Adjunto: o único sítio onde a IA chega a escrever, e nunca
 * sozinha.
 *
 * ## A regra
 *
 * Uma proposta nasce numa ferramenta (ver `ferramentas.ts`) com o que ficaria
 * gravado, e fica `PENDING`. Quem a confirma é uma pessoa, num botão, e o que
 * se grava passa pelos serviços de sempre (`recordAttendance`,
 * `ClinicalService.criar`, `saveCallUps`) com a sessão dessa pessoa. As
 * permissões, o âmbito e as validações são as da consola; a IA não ganha
 * nenhuma porta própria.
 *
 * ## Desfazer
 *
 * Ao confirmar, guarda-se o estado de antes em `undo`: a folha de presenças
 * que lá estava, a convocatória que lá estava, o id do registo clínico criado.
 * "Desfazer" volta a chamar os mesmos serviços com esse estado. Vale dez
 * minutos: depois disso, muda-se na página como sempre.
 */

const JANELA_DE_DESFAZER_MS = 10 * 60_000;

export type PropostaParaAConsola = {
  id: string;
  kind: AdjuntoProposal["kind"];
  status: AdjuntoProposal["status"];
  title: string;
  summary: string;
  view: Record<string, unknown>;
  result: unknown;
  createdAt: string;
  confirmedAt: string | null;
  podeDesfazer: boolean;
  editavel: boolean;
};

@Injectable()
export class PropostasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly academy: AcademyService,
    private readonly clinical: ClinicalService,
    private readonly matches: MatchesService,
    private readonly athletes: AthletesService,
    private readonly announcements: AnnouncementsService,
    private readonly notifications: NotificationsService,
    private readonly training: TrainingService,
    private readonly site: SiteService,
    private readonly patrocinadores: PatrocinadoresService,
  ) {}

  paraAConsola(p: AdjuntoProposal): PropostaParaAConsola {
    const payload = (p.payload ?? {}) as Record<string, unknown>;
    return {
      id: p.id,
      kind: p.kind,
      status: p.status,
      title: p.title,
      summary: p.summary,
      // Uma ligação que só existe depois de gravar (a ficha do exercício criado) vem no resultado e ganha à da proposta.
      view: { ...((payload.view as Record<string, unknown>) ?? {}), ...((p.result as { abrir?: unknown } | null)?.abrir ? { abrir: (p.result as { abrir: unknown }).abrir } : {}) },
      result: p.result,
      createdAt: p.createdAt.toISOString(),
      confirmedAt: p.confirmedAt?.toISOString() ?? null,
      podeDesfazer: p.status === "CONFIRMED" && p.undo !== null && p.confirmedAt !== null && Date.now() - p.confirmedAt.getTime() < JANELA_DE_DESFAZER_MS,
      // Nasceu de um formulário (ou é uma marcação, que se reconstrói) e ainda não foi confirmada: o cartão tem "Editar".
      editavel: p.status === "PENDING" && (Boolean(payload.edicao) || (p.kind === "EVENT" && (payload.dados as { acao?: string } | undefined)?.acao === "criar")),
    };
  }

  /**
   * Os valores do formulário de onde a proposta nasceu. Nulo se não veio de um.
   *
   * As marcações feitas antes de o cartão guardar os valores (11/11/2026)
   * reconstroem-se a partir do que se ia gravar: a equipa pelo id, o dia e as
   * horas no relógio do clube, a prova e o tipo pelo catálogo.
   */
  async edicaoDe(ctx: RequestContext, p: AdjuntoProposal): Promise<{ acao: string; valores: Record<string, string> } | null> {
    const payload = (p.payload ?? {}) as Record<string, unknown>;
    const guardada = payload.edicao as { acao: string; valores: Record<string, string> } | undefined;
    if (guardada) return guardada;
    const dados = payload.dados as { acao?: string; dto?: Record<string, unknown> } | undefined;
    if (p.kind !== "EVENT" || dados?.acao !== "criar" || !dados.dto) return null;
    const dto = dados.dto;
    const kind = String(dto.kind);
    const acao = kind === "MATCH" ? "marcar_jogo" : kind === "TRAINING" ? "marcar_treino" : "marcar_evento";
    const nomes = await this.prisma.runAs(ctx.academyId, async (db) => {
      const ids = [dto.competitionId, dto.typeId].filter((x): x is string => typeof x === "string");
      const [equipa, catalogo, treinador] = await Promise.all([
        typeof dto.teamId === "string" ? db.team.findFirst({ where: { id: dto.teamId }, select: { name: true } }) : null,
        ids.length ? db.catalogItem.findMany({ where: { id: { in: ids } }, select: { id: true, label: true } }) : [],
        typeof dto.coachId === "string" ? db.membership.findFirst({ where: { id: dto.coachId }, select: { user: { select: { name: true } } } }) : null,
      ]);
      return { equipa: equipa?.name ?? "", catalogo: new Map(catalogo.map((c) => [c.id, c.label])), treinador: treinador?.user.name ?? "" };
    });
    const inicio = new Date(String(dto.startsAt));
    const fim = new Date(String(dto.endsAt));
    const dia = (d: Date) => {
      const x = partesNoFuso(d);
      return `${x.ano}-${String(x.mes).padStart(2, "0")}-${String(x.dia).padStart(2, "0")}`;
    };
    const valores: Record<string, string> = {
      equipa: nomes.equipa,
      dia: dia(inicio),
      inicio: horaNoFuso(inicio),
      fim: horaNoFuso(fim),
      local: String(dto.venue ?? ""),
      balnearios: Array.isArray(dto.dressingRooms) ? (dto.dressingRooms as string[]).join(", ") : "",
    };
    if (kind === "MATCH") {
      valores.adversario = String(dto.opponent ?? "");
      valores.casa = dto.isHome === false ? "não" : "sim";
      valores.prova = typeof dto.competitionId === "string" ? (nomes.catalogo.get(dto.competitionId) ?? "") : "";
    } else if (kind === "TRAINING") {
      valores.treinador = nomes.treinador;
      valores.quem_avisa = dto.respondBy === "ATHLETE" ? "ATHLETE" : "GUARDIAN";
      valores.repetir_ate = (dto.repeat as { until?: string } | undefined)?.until ?? "";
    } else {
      valores.titulo = String(dto.title ?? "");
      valores.tipo = typeof dto.typeId === "string" ? (nomes.catalogo.get(dto.typeId) ?? "") : "";
      valores.publico = dto.isPublic === true ? "sim" : "";
    }
    return { acao, valores };
  }

  /** Para o "Editar" do cartão: a proposta desta pessoa, ainda pendente. */
  async pendenteDaPessoa(ctx: RequestContext, id: string): Promise<AdjuntoProposal> {
    const p = await this.carregar(ctx, id);
    if (p.status !== "PENDING") throw new BadRequestException("Esta proposta já não está pendente");
    return p;
  }

  /** Trocar o conteúdo de uma proposta pendente pelo de uma proposta nova (o "Editar" do cartão). */
  async substituir(ctx: RequestContext, id: string, nova: { title: string; summary: string; payload: Prisma.InputJsonValue }): Promise<PropostaParaAConsola> {
    const actualizada = await this.prisma.runAs(ctx.academyId, (db) => db.adjuntoProposal.update({ where: { id }, data: { title: nova.title, summary: nova.summary, payload: nova.payload } }));
    return this.paraAConsola(actualizada);
  }

  private async carregar(ctx: RequestContext, id: string): Promise<AdjuntoProposal> {
    const p = await this.prisma.runAs(ctx.academyId, (db) => db.adjuntoProposal.findFirst({ where: { id } }));
    if (!p) throw new NotFoundException("Proposta não encontrada");
    // A proposta é de quem falou. Outra pessoa do clube não a confirma por ele.
    if (p.membershipId !== ctx.membershipId) throw new ForbiddenException("Esta proposta é de outra pessoa");
    return p;
  }

  async recusar(ctx: RequestContext, id: string): Promise<PropostaParaAConsola> {
    const p = await this.carregar(ctx, id);
    if (p.status !== "PENDING") throw new BadRequestException("Esta proposta já não está pendente");
    const [actualizada] = await this.prisma.runAs(ctx.academyId, (db) =>
      Promise.all([
        db.adjuntoProposal.update({ where: { id }, data: { status: "REJECTED" } }),
        // Uma recusa é um sinal: o pedido seguinte desta conversa sobe de nível.
        db.adjuntoConversation.update({ where: { id: p.conversationId }, data: { escalated: true } }),
      ]),
    );
    return this.paraAConsola(actualizada);
  }

  async confirmar(ctx: RequestContext, id: string): Promise<PropostaParaAConsola> {
    const p = await this.carregar(ctx, id);
    if (p.status !== "PENDING") throw new BadRequestException("Esta proposta já não está pendente");
    const payload = (p.payload ?? {}) as Record<string, unknown>;
    const dados = (payload.dados ?? {}) as Record<string, unknown>;

    /*
     * As permissões voltam a verificar-se agora, com a sessão de quem carrega
     * no botão: a proposta pode ter ficado pendente e o cargo ter mudado. Os
     * serviços chamados a seguir verificam outra vez, e correm no clube da
     * sessão (`runAs`), por isso um id de outro clube é "não encontrado".
     */
    const edicao = payload.edicao as { acao?: string } | undefined;
    const acao = edicao?.acao ? ACOES[edicao.acao] : undefined;
    if (acao && !podeFazer(acao, (perm) => can(ctx, perm))) throw new ForbiddenException(`Sem permissão para ${acao.rotulo.toLowerCase()}`);

    let undo: Prisma.InputJsonValue | null = null;
    let result: Prisma.InputJsonValue = {};

    if (p.kind === "ATTENDANCE") {
      const sessionId = String(dados.sessionId);
      const absences = (dados.absences as { athleteId: string; kind: string; note?: string }[]) ?? [];
      undo = await this.folhaActual(ctx, sessionId);
      const r = await this.academy.recordAttendance(ctx, sessionId, absences);
      result = { presentes: (r as { present?: number }).present ?? null, faltas: absences.length } as Prisma.InputJsonValue;
    } else if (p.kind === "CLINICAL") {
      const athleteId = String(dados.athleteId);
      if (dados.modo === "registar" && can(ctx, "clinical:write")) {
        const r = await this.clinical.criar(ctx, athleteId, {
          kind: "INJURY",
          status: "DONE",
          date: String(dados.data),
          title: "Lesão",
          detail: String(dados.descricao ?? ""),
          impact: String(dados.impact ?? "NONE"),
          expectedReturn: (dados.retomaPrevista as string | null) ?? null,
        });
        const entryId = (r as { entry?: { id: string } }).entry?.id ?? (r as { id?: string }).id ?? null;
        undo = entryId ? { entryId } : null;
        result = { registo: entryId, modo: "registar" };
      } else {
        const avisados = await this.avisarOClinico(ctx, athleteId, String(dados.descricao ?? ""), String(dados.impact ?? "NONE"));
        result = { modo: "avisar", avisados };
      }
    } else if (p.kind === "CALLUPS") {
      const matchId = String(dados.matchId);
      const athleteIds = (dados.athleteIds as string[]) ?? [];
      undo = await this.convocatoriaActual(ctx, matchId);
      await this.matches.saveCallUps(ctx, matchId, athleteIds);
      result = { convocados: athleteIds.length };
    } else if (p.kind === "EVENT") {
      const acao = String(dados.acao);
      if (acao === "criar") {
        const r = await this.academy.createEvent(ctx, dados.dto as Parameters<AcademyService["createEvent"]>[1]);
        const ids = (r.events as { id: string }[]).map((e) => e.id);
        undo = { ids };
        result = { criados: r.created, saltados: r.skipped, ids };
      } else {
        const id = String(dados.id);
        const cancelar = acao === "desmarcar";
        await this.academy.setEventCancelled(ctx, id, cancelar);
        undo = { id, cancelled: !cancelar };
        result = { id, cancelled: cancelar };
      }
    } else if (p.kind === "ATHLETE") {
      const a = await this.athletes.create(ctx, dados.dto as Parameters<AthletesService["create"]>[1]);
      const id = (a as { id?: string }).id ?? null;
      undo = id ? { athleteId: id } : null;
      result = { athleteId: id };
    } else if (p.kind === "ANNOUNCEMENT") {
      const a = await this.announcements.create(ctx, dados.dto as Parameters<AnnouncementsService["create"]>[1]);
      const id = (a as { id?: string }).id ?? null;
      undo = id ? { announcementId: id } : null;
      result = { announcementId: id };
    } else if (p.kind === "TRAINING_PLAN") {
      const r = await this.gravarPlano(ctx, dados);
      undo = r.undo;
      result = r.result;
    } else if (p.kind === "SITE_NEWS") {
      const n = await this.site.criarNoticia(ctx, dados.dto as Parameters<SiteService["criarNoticia"]>[1]);
      undo = { newsId: n.id };
      result = { newsId: n.id, publicada: n.estado === "publicada" };
    } else if (p.kind === "SITE") {
      const r = await this.executarSite(ctx, dados as OperacaoDoSite);
      undo = r.desfazer as unknown as Prisma.InputJsonValue;
      result = r.result;
    } else if (p.kind === "EXERCISE") {
      // Só a biblioteca: um exercício do clube, da modalidade da equipa, com o desenho. Nenhum treino muda.
      const { diagram, ...resto } = (dados.exercicio ?? {}) as ExerciseInput & { diagram?: unknown };
      const sportId = typeof dados.sportId === "string" ? dados.sportId : null;
      const e = await this.training.createExercise(ctx, { ...(resto as ExerciseInput), sportId, visibility: "CLUB", ...(diagram ? { diagram } : {}) });
      undo = { exerciseId: e.id };
      result = { exerciseId: e.id, abrir: { rotulo: "Abrir o exercício na Área técnica", to: `/exercicios/${e.id}` } };
    }

    const actualizada = await this.prisma.runAs(ctx.academyId, (db) =>
      db.adjuntoProposal.update({
        where: { id },
        data: { status: "CONFIRMED", confirmedAt: new Date(), undo: undo ?? Prisma.JsonNull, result },
      }),
    );
    return this.paraAConsola(actualizada);
  }

  /**
   * Uma operação do site, pela tabela: a mesma função confirma e desfaz, porque
   * o desfazer de cada operação é outra operação da tabela (criar ↔ apagar,
   * mudar ↔ mudar para o que estava, página de início ↔ a de antes). Tudo
   * passa pelos serviços do Website e dos Patrocinadores, com a sessão de quem
   * confirma: as permissões e o plano do site verificam-se lá.
   */
  private async executarSite(ctx: RequestContext, op: OperacaoDoSite): Promise<{ desfazer: OperacaoDoSite | null; result: Prisma.InputJsonValue }> {
    switch (op.op) {
      case "inicio": {
        await this.site.atualizar(ctx, { inicio: op.inicio as Record<string, unknown> });
        return { desfazer: op.antes ? { op: "inicio", inicio: op.antes } : null, result: { seccoes: (op.inicio as { seccoes?: unknown[] }).seccoes?.length ?? 0 } };
      }
      case "config": {
        await this.site.atualizar(ctx, op.data);
        return { desfazer: op.antes ? { op: "config", data: op.antes } : null, result: op.data as Prisma.InputJsonValue };
      }
      case "produto_criar": {
        const p = await this.site.criarProduto(ctx, op.dto as Parameters<SiteService["criarProduto"]>[1]);
        return { desfazer: { op: "produto_apagar", id: p.id }, result: { produtoId: p.id } };
      }
      case "produto_editar": {
        await this.site.editarProduto(ctx, op.id, op.dto as Parameters<SiteService["editarProduto"]>[2]);
        return { desfazer: op.antes ? { op: "produto_editar", id: op.id, dto: op.antes } : null, result: { produtoId: op.id } };
      }
      case "produto_apagar": {
        await this.site.apagarProduto(ctx, op.id);
        // Volta como produto novo (outro id): o que se pode repor de um apagado.
        return { desfazer: op.antes ? { op: "produto_criar", dto: op.antes } : null, result: { apagado: op.id } };
      }
      case "patrocinador_criar": {
        const p = await this.patrocinadores.criar(ctx, op.dto as Parameters<PatrocinadoresService["criar"]>[1]);
        const id = (p as { id: string }).id;
        return { desfazer: { op: "patrocinador_apagar", id }, result: { patrocinadorId: id } };
      }
      case "patrocinador_apagar": {
        await this.patrocinadores.apagar(ctx, op.id);
        return { desfazer: op.antes ? { op: "patrocinador_criar", dto: op.antes } : null, result: { apagado: op.id } };
      }
      case "bilheteira": {
        if (op.dto) await this.site.gravarBilheteira(ctx, op.matchId, op.dto as Parameters<SiteService["gravarBilheteira"]>[2]);
        else await this.site.apagarBilheteira(ctx, op.matchId);
        // Sem bilheteira antes, desfazer é tirá-la (só sem compras; com compras o serviço recusa).
        return { desfazer: { op: "bilheteira", matchId: op.matchId, dto: op.antes ?? null }, result: { matchId: op.matchId, aberta: (op.dto as { aberta?: boolean } | null)?.aberta ?? false } };
      }
    }
    throw new BadRequestException("Operação do site desconhecida");
  }

  /**
   * O plano de treino entra na Área técnica como se o treinador o tivesse
   * escrito: primeiro os exercícios novos (na biblioteca do clube, com o
   * desenho), depois a sessão e os blocos, com cada bloco a apontar para o seu
   * exercício. O plano que lá estava fica guardado para o "Desfazer".
   */
  private async gravarPlano(ctx: RequestContext, dados: Record<string, unknown>): Promise<{ undo: Prisma.InputJsonValue; result: Prisma.InputJsonValue }> {
    const sessionId = String(dados.sessionId);
    const sportId = typeof dados.sportId === "string" ? dados.sportId : null;
    const sessao = (dados.sessao ?? {}) as Omit<PlanInput, "blocks">;
    const blocos = (dados.blocos ?? []) as BlocoLido[];

    const antes = await this.training.getPlan(ctx, sessionId);
    const planoAntes: PlanInput = {
      objective: antes.objective,
      objectives: antes.objectives,
      sessionType: antes.sessionType,
      intensity: antes.intensity,
      expectedAthletes: antes.expectedAthletes,
      material: antes.material,
      planNotes: antes.planNotes,
      blocks: antes.blocks.map((b) => ({ name: b.name, durationMin: b.durationMin, category: b.category, objective: b.objective, intensity: b.intensity, players: b.players, space: b.space, material: b.material, notes: b.notes, exerciseId: b.exerciseId })),
    };

    const criados: string[] = [];
    const blocks: NonNullable<PlanInput["blocks"]> = [];
    for (const b of blocos) {
      let exerciseId = b.exerciseId ?? null;
      if (!exerciseId && b.novo) {
        const { diagram, ...resto } = b.novo;
        const e = await this.training.createExercise(ctx, { ...(resto as ExerciseInput), sportId, visibility: "CLUB", ...(diagram ? { diagram } : {}) });
        criados.push(e.id);
        exerciseId = e.id;
      }
      blocks.push({ name: b.nome, durationMin: b.durationMin, category: b.category, objective: b.objective, intensity: b.intensity, players: b.players, space: b.space, material: b.material, notes: b.notes, exerciseId });
    }
    await this.training.savePlan(ctx, sessionId, { ...sessao, expectedAthletes: antes.expectedAthletes, blocks });
    return { undo: { sessionId, antes: planoAntes as unknown as Prisma.InputJsonValue, criados }, result: { sessionId, blocos: blocks.length, exerciciosCriados: criados.length } };
  }

  async desfazer(ctx: RequestContext, id: string): Promise<PropostaParaAConsola> {
    const p = await this.carregar(ctx, id);
    if (p.status !== "CONFIRMED" || !p.confirmedAt) throw new BadRequestException("Só se desfaz o que foi confirmado");
    if (Date.now() - p.confirmedAt.getTime() > JANELA_DE_DESFAZER_MS) throw new BadRequestException("Já passaram mais de dez minutos; muda-se na página");
    const undo = (p.undo ?? null) as Record<string, unknown> | null;
    if (!undo) throw new BadRequestException("Esta proposta não se desfaz daqui");
    const payload = (p.payload ?? {}) as Record<string, unknown>;
    const dados = (payload.dados ?? {}) as Record<string, unknown>;

    if (p.kind === "ATTENDANCE") {
      await this.academy.recordAttendance(ctx, String(dados.sessionId), (undo.absences as { athleteId: string; kind: string; note?: string }[]) ?? []);
    } else if (p.kind === "CLINICAL") {
      if (undo.entryId) await this.clinical.apagar(ctx, String(undo.entryId));
    } else if (p.kind === "CALLUPS") {
      await this.matches.saveCallUps(ctx, String(dados.matchId), (undo.athleteIds as string[]) ?? []);
    } else if (p.kind === "EVENT") {
      if (Array.isArray(undo.ids)) {
        // O que acabou de ser marcado apaga-se: ainda não tem presenças, resultado nem convocatória.
        await this.academy.cancelarVarios(ctx, undo.ids as string[], "apagar", false, false);
      } else if (undo.id) {
        await this.academy.setEventCancelled(ctx, String(undo.id), undo.cancelled === true);
      }
    } else if (p.kind === "ATHLETE") {
      // Acabou de ser inscrito: só tem a mensalidade do mês, que sai com ele.
      if (undo.athleteId) await this.athletes.remove(ctx, String(undo.athleteId), true);
    } else if (p.kind === "ANNOUNCEMENT") {
      // O aviso some da app; as notificações que já saíram não voltam atrás.
      if (undo.announcementId) await this.announcements.remove(ctx, String(undo.announcementId));
    } else if (p.kind === "SITE_NEWS") {
      if (undo.newsId) await this.site.apagarNoticia(ctx, String(undo.newsId));
    } else if (p.kind === "EXERCISE") {
      // Acabou de nascer e não está em treino nenhum: sai de vez.
      if (undo.exerciseId) await this.training.deleteExercise(ctx, String(undo.exerciseId));
    } else if (p.kind === "SITE") {
      await this.executarSite(ctx, undo as unknown as OperacaoDoSite);
    } else if (p.kind === "TRAINING_PLAN") {
      // O plano de antes volta; os exercícios que o Adjunto criou saem (já sem uso, apagam-se de vez).
      await this.training.savePlan(ctx, String(undo.sessionId), (undo.antes ?? {}) as PlanInput);
      for (const exerciseId of (undo.criados as string[]) ?? []) await this.training.deleteExercise(ctx, exerciseId);
    }

    const actualizada = await this.prisma.runAs(ctx.academyId, (db) =>
      db.adjuntoProposal.update({ where: { id }, data: { status: "UNDONE", undoneAt: new Date() } }),
    );
    return this.paraAConsola(actualizada);
  }

  /* ---- O estado de antes ---------------------------------------------------- */

  private async folhaActual(ctx: RequestContext, sessionId: string): Promise<Prisma.InputJsonValue> {
    return this.prisma.runAs(ctx.academyId, async (db) => {
      const s = await db.trainingSession.findFirst({
        where: { id: sessionId },
        select: { attendanceClosedAt: true, attendance: { select: { athleteId: true, status: true, note: true } } },
      });
      return {
        fechada: s?.attendanceClosedAt !== null,
        absences: (s?.attendance ?? []).map((a) => ({
          athleteId: a.athleteId,
          kind: a.status === "JUSTIFIED" ? "justified" : a.status === "LATE" ? "late" : "absent",
          ...(a.note ? { note: a.note } : {}),
        })),
      };
    });
  }

  private async convocatoriaActual(ctx: RequestContext, matchId: string): Promise<Prisma.InputJsonValue> {
    return this.prisma.runAs(ctx.academyId, async (db) => {
      const c = await db.matchCallUp.findMany({ where: { matchId }, select: { athleteId: true } });
      return { athleteIds: c.map((x) => x.athleteId) };
    });
  }

  /**
   * O treinador não escreve no boletim: avisa quem escreve.
   *
   * O departamento clínico (papel `MEDICAL`), ou a direção quando o clube não
   * tem clínico. Uma notificação por pessoa, com o nome do atleta e o que o
   * treinador disse; o registo é deles.
   */
  private async avisarOClinico(ctx: RequestContext, athleteId: string, descricao: string, impact: string): Promise<number> {
    const { atleta, userIds, quem } = await this.prisma.runAs(ctx.academyId, async (db) => {
      const atleta = await db.athlete.findFirst({ where: { id: athleteId }, select: { name: true } });
      const quem = await db.membership.findFirst({ where: { id: ctx.membershipId }, select: { user: { select: { name: true } } } });
      const clinico = await db.membership.findMany({ where: { role: "MEDICAL", isActive: true }, select: { userId: true } });
      const alvo = clinico.length > 0 ? clinico : await db.membership.findMany({ where: { role: { in: ["OWNER", "DIRECTOR"] }, isActive: true }, select: { userId: true } });
      return { atleta, userIds: [...new Set(alvo.map((m) => m.userId))], quem };
    });
    if (!atleta) throw new NotFoundException("Atleta não encontrado");
    const situacao = impact === "OUT" ? "fica de fora" : impact === "LIMITED" ? "trabalho condicionado" : "em observação";
    for (const userId of userIds) {
      await this.notifications.enqueue({
        academyId: ctx.academyId,
        userId,
        type: "CLINICAL_APPOINTMENT",
        title: `${atleta.name}: queixa no treino`,
        body: `${quem?.user.name ?? "O treinador"} registou pelo Assistente IA: ${descricao}. ${situacao[0].toUpperCase()}${situacao.slice(1)}.`,
        payload: { athleteId, origem: "adjunto", impact },
      });
    }
    return userIds.length;
  }
}

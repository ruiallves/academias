import { randomBytes } from "node:crypto";
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { NotificationType, Prisma, type ConductReportStatus, type Role } from "@prisma/client";
import { PrismaService, type ScopedClient } from "../prisma/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import { EspacoService } from "../storage/espaco.service";
import { StorageService } from "../storage/storage.service";
import {
  athleteScopeFilter,
  can,
  ROLE_PERMISSIONS,
  type Permission,
  type RequestContext,
} from "../common/permissions";
import {
  DOC_MAX_BYTES,
  DOC_MAX_FICHEIROS,
  DOC_TIPOS,
  DOCUMENT_BUCKET,
  ficheirosDe,
  nomeDoFicheiro,
  tipoDaChave,
  type FicheiroDoDocumento,
} from "../academy/ficha-do-atleta";
import {
  CATEGORIAS,
  chaveDeConduta,
  ESTADOS,
  limparDenuncia,
  limparDescricaoDoDocumento,
  limparMensagem,
  limparTituloDoDocumento,
  pastaDeConduta,
} from "./conduta";

/** Dez minutos, como os documentos dos atletas: chega para abrir, não fica a circular. */
const DOC_TTL = 600;

const daFamilia = (ctx: RequestContext) => ctx.role === "GUARDIAN" || ctx.role === "ATHLETE";

const PAPEL: Partial<Record<Role, string>> = { GUARDIAN: "Encarregado de educação", ATHLETE: "Atleta" };

const SELECT_CASO = {
  id: true, number: true, category: true, status: true, anonymous: true,
  reporterId: true, reporterRole: true, athleteId: true,
  happenedOn: true, place: true, involved: true, description: true,
  assigneeId: true, resolvedAt: true, lastMessageAt: true, reporterSeenAt: true, staffSeenAt: true,
  createdAt: true, updatedAt: true,
  reporter: { select: { user: { select: { name: true, email: true, phone: true } } } },
  athlete: { select: { id: true, name: true, teams: { where: { leftAt: null }, select: { team: { select: { name: true } } }, take: 1 } } },
  assignee: { select: { id: true, user: { select: { name: true } } } },
} as const;

type Caso = Prisma.ConductReportGetPayload<{ select: typeof SELECT_CASO }>;

/**
 * O canal de denúncia e os documentos de conduta.
 *
 * ## Dois lados
 *
 * **A família** (encarregado ou atleta, pela app) envia uma denúncia, segue os
 * seus casos e troca mensagens com o clube. Só vê o que enviou.
 *
 * **O clube** (quem tem `conduct:read`) vê todos os casos, responde, atribui,
 * escreve notas internas e fecha. Por omissão é a presidência e a direção, e
 * mais ninguém: um caso pode ser sobre um treinador, e é por isso que não há
 * âmbito de equipa aqui.
 *
 * ## O anonimato
 *
 * `reporterId` fica sempre gravado: é a única forma de a pessoa seguir o caso e
 * de o clube lhe responder. Com `anonymous`, o que sai para a consola **nunca**
 * traz o nome, o email nem o telefone (`paraOClube`), e as mensagens dela saem
 * sem autor. É anonimato perante o clube, e a app di-lo nesses termos.
 *
 * ## A rede fica fora das transacções
 *
 * Os avisos saem depois do commit (`enqueue` sem `db`), e os links dos
 * ficheiros assinam-se fora do `runAs`. É a regra da casa.
 */
@Injectable()
export class ConductService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly storage: StorageService,
    private readonly espaco: EspacoService,
  ) {}

  /* ------------------------------------------------------------------------ */
  /* A família                                                                 */
  /* ------------------------------------------------------------------------ */

  /** As categorias e os limites, para a app desenhar o formulário com a verdade do servidor. */
  opcoes() {
    return { categorias: Object.entries(CATEGORIAS).map(([key, label]) => ({ key, label })) };
  }

  async criar(ctx: RequestContext, dto: Record<string, unknown>) {
    if (!daFamilia(ctx)) throw new ForbiddenException("O canal de denúncia é da app do clube");
    const dados = this.validar(() => limparDenuncia(dto));

    const caso = await this.prisma.runAs(ctx.academyId, async (db) => {
      if (dados.athleteId) {
        const meus = athleteScopeFilter(ctx);
        const atleta = await db.athlete.findFirst({
          where: { id: dados.athleteId, ...(meus ? { AND: [{ id: meus }] } : {}) },
          select: { id: true },
        });
        if (!atleta) throw new BadRequestException("Esse educando não é teu");
      }
      /*
       * O número é por clube, para se poder falar do "caso 12". O índice único
       * apanha duas denúncias ao mesmo tempo; é raro ao ponto de não valer um
       * ciclo de tentativas.
       */
      const ultimo = await db.conductReport.aggregate({ _max: { number: true } });
      return db.conductReport.create({
        data: {
          academyId: ctx.academyId,
          number: (ultimo._max.number ?? 0) + 1,
          category: dados.category,
          anonymous: dados.anonymous,
          reporterId: ctx.membershipId,
          reporterRole: ctx.role,
          athleteId: dados.athleteId,
          happenedOn: dados.happenedOn,
          place: dados.place,
          involved: dados.involved,
          description: dados.description,
          reporterSeenAt: new Date(),
        },
        select: SELECT_CASO,
      });
    });

    await this.avisarOClube(ctx.academyId, caso, "Nova denúncia", `Caso ${caso.number} · ${CATEGORIAS[caso.category]}`);
    return this.paraAFamilia(caso, []);
  }

  async minhas(ctx: RequestContext) {
    if (!daFamilia(ctx)) throw new ForbiddenException("O canal de denúncia é da app do clube");
    const casos = await this.prisma.runAs(ctx.academyId, (db) =>
      db.conductReport.findMany({
        where: { reporterId: ctx.membershipId },
        orderBy: { createdAt: "desc" },
        select: SELECT_CASO,
      }),
    );
    return casos.map((c) => this.resumoParaAFamilia(c));
  }

  /* ------------------------------------------------------------------------ */
  /* Os dois lados: ver um caso, escrever nele                                 */
  /* ------------------------------------------------------------------------ */

  async ver(ctx: RequestContext, id: string) {
    const { caso, mensagens } = await this.prisma.runAs(ctx.academyId, async (db) => {
      const caso = await this.casoAoAlcance(db, ctx, id);
      const mensagens = await db.conductReportMessage.findMany({
        where: { reportId: id, ...(daFamilia(ctx) ? { internal: false } : {}) },
        orderBy: { createdAt: "asc" },
        select: { id: true, authorId: true, authorName: true, fromStaff: true, internal: true, body: true, createdAt: true },
      });
      // Abrir o caso é lê-lo: é o que apaga o "por ler" deste lado.
      await db.conductReport.update({
        where: { id },
        data: daFamilia(ctx) ? { reporterSeenAt: new Date() } : { staffSeenAt: new Date() },
      });
      return { caso, mensagens };
    });
    return daFamilia(ctx) ? this.paraAFamilia(caso, mensagens) : this.paraOClube(caso, mensagens);
  }

  async escrever(ctx: RequestContext, id: string, dto: { body?: unknown; internal?: unknown }) {
    const body = this.validar(() => limparMensagem(dto.body));
    const familia = daFamilia(ctx);
    const internal = !familia && dto.internal === true;
    if (!familia && !can(ctx, "conduct:write")) throw new ForbiddenException("Sem permissão para responder a denúncias");

    const { caso, mensagem } = await this.prisma.runAs(ctx.academyId, async (db) => {
      const caso = await this.casoAoAlcance(db, ctx, id);
      if (familia && (caso.status === "RESOLVED" || caso.status === "ARCHIVED")) {
        throw new BadRequestException("Este caso está fechado. Se houver algo novo, envia uma nova denúncia.");
      }
      const authorName = await this.nomeDe(db, ctx);
      const mensagem = await db.conductReportMessage.create({
        data: { reportId: id, authorId: ctx.membershipId, authorName, fromStaff: !familia, internal, body },
        select: { id: true, authorId: true, authorName: true, fromStaff: true, internal: true, body: true, createdAt: true },
      });
      const agora = new Date();
      await db.conductReport.update({
        where: { id },
        data: {
          ...(internal ? {} : { lastMessageAt: agora }),
          ...(familia ? { reporterSeenAt: agora } : { staffSeenAt: agora }),
          // Uma resposta do clube a um caso novo é pegar nele.
          ...(!familia && !internal && caso.status === "NEW" ? { status: "IN_REVIEW" as const } : {}),
        },
      });
      return { caso, mensagem };
    });

    if (familia) {
      await this.avisarOClube(ctx.academyId, caso, `Mensagem no caso ${caso.number}`, this.excerto(body));
    } else if (!internal) {
      await this.avisarAFamilia(ctx.academyId, caso, "O clube respondeu à tua denúncia", this.excerto(body));
    }
    return this.mensagemPara(mensagem, familia, caso.anonymous);
  }

  /* ------------------------------------------------------------------------ */
  /* O clube                                                                   */
  /* ------------------------------------------------------------------------ */

  async listar(ctx: RequestContext, estado?: string) {
    this.assertLe(ctx);
    const status = estado && estado in ESTADOS ? (estado as ConductReportStatus) : undefined;
    const casos = await this.prisma.runAs(ctx.academyId, (db) =>
      db.conductReport.findMany({
        where: status ? { status } : {},
        orderBy: [{ createdAt: "desc" }],
        select: SELECT_CASO,
      }),
    );
    return casos.map((c) => this.resumoParaOClube(c));
  }

  /** Os contadores do menu e do resumo: o que está por tratar e por ler. */
  async resumo(ctx: RequestContext) {
    this.assertLe(ctx);
    return this.prisma.runAs(ctx.academyId, async (db) => {
      const [novas, emAnalise, porLer] = await Promise.all([
        db.conductReport.count({ where: { status: "NEW" } }),
        db.conductReport.count({ where: { status: "IN_REVIEW" } }),
        db.conductReport.count({
          where: {
            status: { in: ["NEW", "IN_REVIEW"] },
            OR: [{ staffSeenAt: null }, { lastMessageAt: { not: null }, staffSeenAt: { lt: db.conductReport.fields.lastMessageAt } }],
          },
        }),
      ]);
      return { novas, emAnalise, porLer };
    });
  }

  async atualizar(ctx: RequestContext, id: string, dto: { status?: unknown; assigneeId?: unknown }) {
    if (!can(ctx, "conduct:write")) throw new ForbiddenException("Sem permissão para tratar denúncias");
    const status = dto.status === undefined ? undefined : dto.status;
    if (status !== undefined && (typeof status !== "string" || !(status in ESTADOS))) throw new BadRequestException("Estado desconhecido");
    const assigneeId = dto.assigneeId === undefined ? undefined : dto.assigneeId === null || dto.assigneeId === "" ? null : dto.assigneeId;
    if (assigneeId !== undefined && assigneeId !== null && typeof assigneeId !== "string") throw new BadRequestException("Responsável inválido");

    const { caso, mudouEstado } = await this.prisma.runAs(ctx.academyId, async (db) => {
      const antes = await this.casoAoAlcance(db, ctx, id);
      if (assigneeId) {
        const m = await db.membership.findFirst({ where: { id: assigneeId, isActive: true, role: { notIn: ["GUARDIAN", "ATHLETE"] } }, select: { id: true } });
        if (!m) throw new BadRequestException("Responsável desconhecido");
      }
      const novoEstado = status as ConductReportStatus | undefined;
      const fechado = novoEstado === "RESOLVED" || novoEstado === "ARCHIVED";
      const caso = await db.conductReport.update({
        where: { id },
        data: {
          ...(novoEstado ? { status: novoEstado, resolvedAt: fechado ? new Date() : null } : {}),
          ...(assigneeId !== undefined ? { assigneeId } : {}),
          staffSeenAt: new Date(),
        },
        select: SELECT_CASO,
      });
      return { caso, mudouEstado: Boolean(novoEstado) && novoEstado !== antes.status };
    });

    if (mudouEstado) {
      const frase: Record<ConductReportStatus, string> = {
        NEW: "A tua denúncia voltou a estar por tratar.",
        IN_REVIEW: "O clube está a analisar a tua denúncia.",
        RESOLVED: "O clube deu a tua denúncia como resolvida.",
        ARCHIVED: "O clube arquivou a tua denúncia.",
      };
      await this.avisarAFamilia(ctx.academyId, caso, `Caso ${caso.number}: ${ESTADOS[caso.status].toLowerCase()}`, frase[caso.status]);
    }
    return this.resumoParaOClube(caso);
  }

  /** Quem pode ficar responsável por um caso: o staff que vê as denúncias. */
  async responsaveis(ctx: RequestContext) {
    this.assertLe(ctx);
    const quem = await this.prisma.runAs(ctx.academyId, (db) => this.quemVeDenuncias(db));
    return quem.map((m) => ({ id: m.id, name: m.name, title: m.title }));
  }

  /* ------------------------------------------------------------------------ */
  /* Os documentos de conduta                                                  */
  /* ------------------------------------------------------------------------ */

  /** Qualquer pessoa do clube lê: é para isso que existem. */
  async documentos(ctx: RequestContext) {
    // Quem gere os documentos vê também quantos pais abriram cada um.
    const gere = !daFamilia(ctx) && can(ctx, "settings:write");
    const { docs, leituras } = await this.prisma.runAs(ctx.academyId, async (db) => {
      const docs = await db.conductDocument.findMany({
        orderBy: [{ order: "asc" }, { createdAt: "asc" }],
        select: { id: true, title: true, description: true, files: true, createdAt: true, updatedAt: true, createdByName: true },
      });
      return { docs, leituras: gere ? await this.leiturasDosPais(db, docs.map((d) => d.id)) : null };
    });
    return Promise.all(
      docs.map(async (d) => ({ ...(await this.saidaDoDocumento(d)), ...(leituras ? { reads: leituras.get(d.id) } : {}) })),
    );
  }

  async documentoUploadUrl(ctx: RequestContext, contentType: string) {
    this.assertEscreveDocumentos(ctx);
    const ext = DOC_TIPOS[contentType];
    if (!ext) throw new BadRequestException("O ficheiro tem de ser uma imagem (JPEG, PNG, WebP), um PDF ou um Word");
    await this.espaco.garantirEspaco(ctx.academyId);
    await this.storage.ensureBucket({ name: DOCUMENT_BUCKET, fileSizeLimit: DOC_MAX_BYTES, allowedMimeTypes: Object.keys(DOC_TIPOS) });
    const key = `${pastaDeConduta(ctx.academyId)}/${randomBytes(8).toString("hex")}${ext}`;
    const signed = await this.storage.signUpload(DOCUMENT_BUCKET, key);
    return { ...signed, key, maxBytes: DOC_MAX_BYTES };
  }

  async documentoCriar(ctx: RequestContext, dto: { title?: unknown; description?: unknown; files?: { key?: unknown; name?: unknown }[] }) {
    this.assertEscreveDocumentos(ctx);
    const title = this.validar(() => limparTituloDoDocumento(dto.title));
    const description = this.validar(() => limparDescricaoDoDocumento(dto.description));
    const files = await this.confirmar(ctx, dto.files ?? []);
    if (files.length === 0) throw new BadRequestException("Junta pelo menos um ficheiro ao documento");

    const doc = await this.prisma.runAs(ctx.academyId, async (db) => {
      const ultimo = await db.conductDocument.aggregate({ _max: { order: true } });
      return db.conductDocument.create({
        data: { academyId: ctx.academyId, title, description, files, order: (ultimo._max.order ?? 0) + 1, createdByName: await this.nomeDe(db, ctx) },
        select: { id: true, title: true, description: true, files: true, createdAt: true, updatedAt: true, createdByName: true },
      });
    });
    return this.saidaDoDocumento(doc);
  }

  async documentoAtualizar(
    ctx: RequestContext,
    id: string,
    dto: { title?: unknown; description?: unknown; addFiles?: { key?: unknown; name?: unknown }[] },
  ) {
    this.assertEscreveDocumentos(ctx);
    const title = dto.title === undefined ? undefined : this.validar(() => limparTituloDoDocumento(dto.title));
    const description = dto.description === undefined ? undefined : this.validar(() => limparDescricaoDoDocumento(dto.description));
    const novos = await this.confirmar(ctx, dto.addFiles ?? []);

    const doc = await this.prisma.runAs(ctx.academyId, async (db) => {
      const atual = await this.documento(db, id);
      const juntos = [...atual.files];
      for (const f of novos) if (!juntos.some((x) => x.key === f.key)) juntos.push(f);
      if (juntos.length > DOC_MAX_FICHEIROS) throw new BadRequestException(`Um documento leva no máximo ${DOC_MAX_FICHEIROS} ficheiros`);
      return db.conductDocument.update({
        where: { id },
        data: { ...(title !== undefined ? { title } : {}), ...(description !== undefined ? { description } : {}), files: juntos },
        select: { id: true, title: true, description: true, files: true, createdAt: true, updatedAt: true, createdByName: true },
      });
    });
    return this.saidaDoDocumento(doc);
  }

  async documentoRemoverFicheiro(ctx: RequestContext, id: string, key: string) {
    this.assertEscreveDocumentos(ctx);
    const tinha = await this.prisma.runAs(ctx.academyId, async (db) => {
      const doc = await this.documento(db, id);
      if (!doc.files.some((f) => f.key === key)) return false;
      if (doc.files.length === 1) throw new BadRequestException("Um documento precisa de pelo menos um ficheiro. Para o tirar, apaga o documento.");
      await db.conductDocument.update({ where: { id }, data: { files: doc.files.filter((f) => f.key !== key) } });
      return true;
    });
    if (tinha) await this.storage.remove(DOCUMENT_BUCKET, key);
    return { ok: true as const };
  }

  /* ------------------------------------------------------------------------ */
  /* Quem abriu os documentos                                                  */
  /* ------------------------------------------------------------------------ */

  /**
   * A pessoa abriu um ficheiro do documento na app. Grava a primeira vez, a
   * última e quantas vezes. Qualquer pessoa do clube que o pode ler o pode abrir.
   */
  async documentoAberto(ctx: RequestContext, id: string) {
    await this.prisma.runAs(ctx.academyId, async (db) => {
      await this.documento(db, id);
      await db.conductDocumentView.upsert({
        where: { documentId_userId: { documentId: id, userId: ctx.userId } },
        create: { academyId: ctx.academyId, documentId: id, userId: ctx.userId },
        update: { lastViewedAt: new Date(), count: { increment: 1 } },
      });
    });
    return { ok: true as const };
  }

  /**
   * Quem abriu um documento, entre os pais e os atletas com conta na app.
   *
   * "Pais" é quem tem pelo menos um educando ligado (um treinador que também é
   * pai conta), "atletas" é quem tem a conta de um atleta. Cada pessoa vem com
   * os atletas dela e os escalões atuais, para a consola filtrar por nome e por
   * escalão sem mais pedidos. A mesma permissão de quem muda os documentos.
   */
  async documentoLeituras(ctx: RequestContext, id: string) {
    this.assertEscreveDocumentos(ctx);
    return this.prisma.runAs(ctx.academyId, async (db) => {
      const doc = await db.conductDocument.findFirst({ where: { id }, select: { id: true, title: true, updatedAt: true } });
      if (!doc) throw new NotFoundException("Documento não encontrado");

      const SELECT_ATLETA = {
        id: true,
        name: true,
        teams: { where: { leftAt: null }, select: { team: { select: { id: true, name: true } } } },
      } as const;
      const [membros, vistas] = await Promise.all([
        db.membership.findMany({
          where: { isActive: true, OR: [{ guardianOf: { some: {} } }, { athleteAccount: { isNot: null } }] },
          select: {
            userId: true,
            user: { select: { name: true, email: true } },
            guardianOf: { select: { athlete: { select: SELECT_ATLETA } } },
            athleteAccount: { select: SELECT_ATLETA },
          },
        }),
        db.conductDocumentView.findMany({
          where: { documentId: id },
          select: { userId: true, firstViewedAt: true, lastViewedAt: true, count: true },
        }),
      ]);

      const vistaDe = new Map(vistas.map((v) => [v.userId, v]));
      const equipas = new Map<string, string>();
      type Atleta = { id: string; name: string; teams: { team: { id: string; name: string } }[] };
      const resumo = (a: Atleta) => {
        for (const t of a.teams) equipas.set(t.team.id, t.team.name);
        return { id: a.id, name: a.name, teams: a.teams.map((t) => t.team) };
      };

      // Uma pessoa pode ser encarregado e atleta (ou ter duas ligações): uma linha por papel, juntando as ligações.
      const linhas = new Map<string, { userId: string; kind: "GUARDIAN" | "ATHLETE"; name: string; email: string | null; athletes: ReturnType<typeof resumo>[] }>();
      for (const m of membros) {
        const nome = m.user.name?.trim() || m.user.email || "Sem nome";
        if (m.guardianOf.length > 0) {
          const k = `G:${m.userId}`;
          const l = linhas.get(k) ?? { userId: m.userId, kind: "GUARDIAN" as const, name: nome, email: m.user.email, athletes: [] };
          for (const g of m.guardianOf) if (!l.athletes.some((a) => a.id === g.athlete.id)) l.athletes.push(resumo(g.athlete));
          linhas.set(k, l);
        }
        if (m.athleteAccount) {
          const k = `A:${m.userId}`;
          if (!linhas.has(k)) linhas.set(k, { userId: m.userId, kind: "ATHLETE", name: nome, email: m.user.email, athletes: [resumo(m.athleteAccount)] });
        }
      }

      const people = [...linhas.values()]
        .map((l) => {
          const v = vistaDe.get(l.userId);
          return { ...l, firstViewedAt: v?.firstViewedAt ?? null, lastViewedAt: v?.lastViewedAt ?? null, count: v?.count ?? 0 };
        })
        .sort((a, b) => a.name.localeCompare(b.name, "pt"));

      return {
        document: doc,
        teams: [...equipas].map(([tid, name]) => ({ id: tid, name })).sort((a, b) => a.name.localeCompare(b.name, "pt", { numeric: true })),
        people,
      };
    });
  }

  /**
   * Quantos pais abriram cada documento, para a lista das Definições: "38 de 120".
   * Só para quem gere os documentos; a família não recebe isto.
   */
  private async leiturasDosPais(db: ScopedClient, ids: string[]): Promise<Map<string, { opened: number; total: number }>> {
    const pais = await db.membership.findMany({ where: { isActive: true, guardianOf: { some: {} } }, select: { userId: true } });
    const userIds = [...new Set(pais.map((p) => p.userId))];
    const contas = ids.length === 0 || userIds.length === 0
      ? []
      : await db.conductDocumentView.groupBy({ by: ["documentId"], where: { documentId: { in: ids }, userId: { in: userIds } }, _count: { _all: true } });
    const out = new Map(ids.map((id) => [id, { opened: 0, total: userIds.length }]));
    for (const c of contas) out.set(c.documentId, { opened: c._count._all, total: userIds.length });
    return out;
  }

  async documentoApagar(ctx: RequestContext, id: string) {
    this.assertEscreveDocumentos(ctx);
    const files = await this.prisma.runAs(ctx.academyId, async (db) => {
      const doc = await this.documento(db, id);
      await db.conductDocument.delete({ where: { id } });
      return doc.files;
    });
    for (const f of files) await this.storage.remove(DOCUMENT_BUCKET, f.key);
    return { ok: true as const };
  }

  /* ------------------------------------------------------------------------ */
  /* Por dentro                                                                */
  /* ------------------------------------------------------------------------ */

  private assertLe(ctx: RequestContext) {
    if (daFamilia(ctx) || !can(ctx, "conduct:read")) throw new ForbiddenException("Sem acesso às denúncias");
  }

  private assertEscreveDocumentos(ctx: RequestContext) {
    if (daFamilia(ctx) || !can(ctx, "settings:write")) throw new ForbiddenException("Sem permissão para mudar os documentos de conduta");
  }

  /** O caso, se quem pede o pode ver: a família só os seus, o clube todos. */
  private async casoAoAlcance(db: ScopedClient, ctx: RequestContext, id: string): Promise<Caso> {
    if (!daFamilia(ctx)) this.assertLe(ctx);
    const caso = await db.conductReport.findFirst({
      where: { id, ...(daFamilia(ctx) ? { reporterId: ctx.membershipId } : {}) },
      select: SELECT_CASO,
    });
    if (!caso) throw new NotFoundException("Denúncia não encontrada");
    return caso;
  }

  private async documento(db: ScopedClient, id: string) {
    const doc = await db.conductDocument.findFirst({ where: { id }, select: { id: true, files: true } });
    if (!doc) throw new NotFoundException("Documento não encontrado");
    return { ...doc, files: ficheirosDe(doc.files) };
  }

  /**
   * Quem vê as denúncias: o staff activo cuja permissão resolvida tem
   * `conduct:read`. A mesma conta de `exceptionsFor` (auth.service): o cargo
   * principal substitui o papel-base, os secundários somam, as retiradas ganham.
   */
  private async quemVeDenuncias(db: ScopedClient) {
    const staff = await db.membership.findMany({
      where: { isActive: true, role: { notIn: ["GUARDIAN", "ATHLETE"] } },
      select: {
        id: true, userId: true, role: true, title: true, grants: true, revokes: true,
        user: { select: { name: true } },
        customRole: { select: { permissions: true, archivedAt: true } },
        extraRoles: { select: { role: { select: { permissions: true, archivedAt: true } } } },
      },
    });
    return staff
      .filter((m) => {
        const principal = m.customRole && !m.customRole.archivedAt ? m.customRole : null;
        const secundarios = m.extraRoles.map((r) => r.role).filter((r) => !r.archivedAt);
        const vivos = principal ? [principal, ...secundarios] : secundarios;
        const chao = !principal && secundarios.length > 0 ? ROLE_PERMISSIONS[m.role] : [];
        const base = vivos.length > 0 ? [...chao, ...vivos.flatMap((r) => r.permissions)] : ROLE_PERMISSIONS[m.role];
        const perms = new Set<string>([...base, ...m.grants]);
        return !m.revokes.includes("conduct:read" satisfies Permission) && perms.has("conduct:read");
      })
      .map((m) => ({ id: m.id, userId: m.userId, name: m.user.name, title: m.title }));
  }

  private async avisarOClube(academyId: string, caso: Caso, title: string, body: string) {
    const quem = await this.prisma.runAs(academyId, (db) => this.quemVeDenuncias(db));
    for (const m of quem) {
      await this.notifications
        .enqueue({ academyId, userId: m.userId, type: NotificationType.CONDUCT_REPORT_CREATED, title, body, payload: { route: `/denuncias/${caso.id}`, reportId: caso.id } })
        .catch(() => undefined);
    }
  }

  private async avisarAFamilia(academyId: string, caso: Caso, title: string, body: string) {
    if (!caso.reporterId) return;
    const m = await this.prisma.runAs(academyId, (db) => db.membership.findFirst({ where: { id: caso.reporterId! }, select: { userId: true } }));
    if (!m) return;
    await this.notifications
      .enqueue({ academyId, userId: m.userId, type: NotificationType.CONDUCT_REPORT_REPLIED, title, body, payload: { route: `/denuncia/${caso.id}`, reportId: caso.id } })
      .catch(() => undefined);
  }

  private excerto(body: string): string {
    const linha = body.replace(/\s+/g, " ").trim();
    return linha.length > 120 ? `${linha.slice(0, 117)}…` : linha;
  }

  private async nomeDe(db: ScopedClient, ctx: RequestContext): Promise<string | null> {
    const m = await db.membership.findFirst({ where: { id: ctx.membershipId }, select: { user: { select: { name: true } } } });
    return m?.user.name?.trim() || null;
  }

  private base(c: Caso) {
    return {
      id: c.id,
      number: c.number,
      category: c.category,
      categoryLabel: CATEGORIAS[c.category],
      status: c.status,
      statusLabel: ESTADOS[c.status],
      anonymous: c.anonymous,
      athlete: c.athlete ? { id: c.athlete.id, name: c.athlete.name, team: c.athlete.teams[0]?.team.name ?? null } : null,
      happenedOn: c.happenedOn ? c.happenedOn.toISOString().slice(0, 10) : null,
      place: c.place,
      involved: c.involved,
      description: c.description,
      createdAt: c.createdAt,
      resolvedAt: c.resolvedAt,
      lastMessageAt: c.lastMessageAt,
    };
  }

  private resumoParaAFamilia(c: Caso) {
    return {
      ...this.base(c),
      // Há resposta do clube que a família ainda não abriu.
      unread: Boolean(c.lastMessageAt && (!c.reporterSeenAt || c.reporterSeenAt < c.lastMessageAt)),
    };
  }

  private paraAFamilia(c: Caso, mensagens: Mensagem[]) {
    return { ...this.resumoParaAFamilia(c), messages: mensagens.map((m) => this.mensagemPara(m, true, c.anonymous)) };
  }

  private resumoParaOClube(c: Caso) {
    return {
      ...this.base(c),
      /*
       * Quem enviou, só quando não pediu anonimato. É aqui, e só aqui, que a
       * identidade sai para o clube: tudo o resto desta classe passa por isto.
       */
      reporter: c.anonymous
        ? null
        : { name: c.reporter?.user.name ?? "Conta removida", email: c.reporter?.user.email ?? null, phone: c.reporter?.user.phone ?? null, role: PAPEL[c.reporterRole ?? "GUARDIAN"] ?? null },
      assignee: c.assignee ? { id: c.assignee.id, name: c.assignee.user.name } : null,
      unread: !c.staffSeenAt || Boolean(c.lastMessageAt && c.staffSeenAt < c.lastMessageAt),
    };
  }

  private paraOClube(c: Caso, mensagens: Mensagem[]) {
    return { ...this.resumoParaOClube(c), messages: mensagens.map((m) => this.mensagemPara(m, false, c.anonymous)) };
  }

  /** Uma mensagem, sem o nome da família quando o caso é anónimo. */
  private mensagemPara(m: Mensagem, paraAFamilia: boolean, anonimo: boolean) {
    const nomeDaFamilia = anonimo && !paraAFamilia ? null : m.authorName;
    return {
      id: m.id,
      fromStaff: m.fromStaff,
      internal: m.internal,
      authorName: m.fromStaff ? m.authorName : nomeDaFamilia,
      body: m.body,
      createdAt: m.createdAt,
    };
  }

  private async confirmar(ctx: RequestContext, pedidos: { key?: unknown; name?: unknown }[]): Promise<FicheiroDoDocumento[]> {
    if (!Array.isArray(pedidos)) throw new BadRequestException("Ficheiros inválidos");
    if (pedidos.length > DOC_MAX_FICHEIROS) throw new BadRequestException(`Um documento leva no máximo ${DOC_MAX_FICHEIROS} ficheiros`);
    const out: FicheiroDoDocumento[] = [];
    for (const p of pedidos) {
      if (!chaveDeConduta(p?.key, ctx.academyId)) throw new BadRequestException("Chave inválida");
      if (out.some((f) => f.key === p.key)) continue;
      if (!(await this.storage.exists(DOCUMENT_BUCKET, p.key))) throw new BadRequestException("O ficheiro não chegou ao armazenamento");
      out.push({ key: p.key, name: nomeDoFicheiro(p.name, p.key), type: tipoDaChave(p.key) });
    }
    return out;
  }

  private async saidaDoDocumento(d: { id: string; title: string; description: string | null; files: unknown; createdAt: Date; updatedAt: Date; createdByName: string | null }) {
    const files = await Promise.all(
      ficheirosDe(d.files).map(async (f) => ({ ...f, url: await this.storage.signDownload(DOCUMENT_BUCKET, f.key, DOC_TTL) })),
    );
    return { id: d.id, title: d.title, description: d.description, createdAt: d.createdAt, updatedAt: d.updatedAt, createdByName: d.createdByName, files };
  }

  private validar<T>(f: () => T): T {
    try {
      return f();
    } catch (e) {
      throw new BadRequestException(e instanceof Error ? e.message : "Dados inválidos");
    }
  }
}

type Mensagem = { id: string; authorId: string | null; authorName: string | null; fromStaff: boolean; internal: boolean; body: string; createdAt: Date };

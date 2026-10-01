import { randomBytes } from "node:crypto";
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService, type ScopedClient } from "../prisma/prisma.service";
import { EspacoService } from "../storage/espaco.service";
import { StorageService } from "../storage/storage.service";
import {
  athleteScopeFilter,
  can,
  teamScopeFilter,
  type RequestContext,
} from "../common/permissions";
import {
  chaveDoAtleta,
  DOC_MAX_BYTES,
  DOC_MAX_FICHEIROS,
  DOC_TIPOS,
  DOCUMENT_BUCKET,
  ficheirosDe,
  limparInfoMedica,
  nomeDoDocumento,
  nomeDoFicheiro,
  pastaDoAtleta,
  tipoDaChave,
  type FicheiroDoDocumento,
} from "./ficha-do-atleta";

/** Dez minutos: chega para abrir o que se foi buscar, e não fica a circular. */
const DOC_TTL = 600;

const daFamilia = (ctx: RequestContext) => ctx.role === "GUARDIAN" || ctx.role === "ATHLETE";

/**
 * A informação médica e os documentos de um atleta.
 *
 * ## Quem vê o quê
 *
 * **Informação médica** (grupo sanguíneo, alergias, medicação, observações) —
 * lê quem tem `clinical:read` e o atleta no âmbito: o departamento clínico, os
 * treinadores das equipas dele, a família do próprio. Escreve quem tem
 * `clinical:write`, e nunca a família: o que o clube sabe sobre a saúde de um
 * atleta é o clube que regista.
 *
 * **Documentos** (cartão de cidadão, exames, declarações) — só o staff que
 * edita a ficha (`athlete:write`), e só de atletas das equipas ao seu alcance.
 * A família não os vê nem os carrega por aqui. São cópias de documentos de
 * identificação de menores: a porta é a mais estreita que deixa o trabalho
 * fazer-se.
 *
 * ## A rede fica fora das transacções
 *
 * Assinar um link, confirmar que um ficheiro chegou e apagá-lo são pedidos ao
 * armazenamento. Nenhum corre dentro de um `runAs`: uma transacção à espera da
 * rede segura uma ligação do pool, e um apagar que falha não pode desfazer o
 * que a base já decidiu.
 */
@Injectable()
export class AthleteFichaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly espaco: EspacoService,
  ) {}

  /* ------------------------------------------------------------------------ */
  /* Informação médica                                                         */
  /* ------------------------------------------------------------------------ */

  async medicalGet(ctx: RequestContext, athleteId: string) {
    if (!can(ctx, "clinical:read")) throw new ForbiddenException("Sem acesso à informação clínica");

    return this.prisma.runAs(ctx.academyId, async (db) => {
      await this.atletaClinico(db, ctx, athleteId);
      const row = await db.athleteMedicalInfo.findFirst({ where: { athleteId } });
      return {
        bloodType: row?.bloodType ?? null,
        allergies: row?.allergies ?? null,
        medication: row?.medication ?? null,
        notes: row?.notes ?? null,
        updatedAt: row?.updatedAt ?? null,
        updatedByName: row?.updatedByName ?? null,
        editable: this.podeEscreverClinico(ctx),
      };
    });
  }

  async medicalSet(ctx: RequestContext, athleteId: string, dto: Record<string, unknown>) {
    if (!this.podeEscreverClinico(ctx)) throw new ForbiddenException("Sem permissão para escrever a informação clínica");

    const dados = this.validar(() => limparInfoMedica(dto));

    return this.prisma.runAs(ctx.academyId, async (db) => {
      await this.atletaClinico(db, ctx, athleteId);
      const updatedByName = await this.nomeDe(db, ctx);
      const row = await db.athleteMedicalInfo.upsert({
        where: { athleteId },
        create: { athleteId, academyId: ctx.academyId, ...dados, updatedByName },
        update: { ...dados, updatedByName },
      });
      return {
        bloodType: row.bloodType, allergies: row.allergies, medication: row.medication, notes: row.notes,
        updatedAt: row.updatedAt, updatedByName: row.updatedByName, editable: true,
      };
    });
  }

  private podeEscreverClinico(ctx: RequestContext): boolean {
    return can(ctx, "clinical:write") && !daFamilia(ctx);
  }

  /**
   * O atleta, pelo alcance de quem lê dados de saúde.
   *
   * A família chega aos seus (`athleteScopeFilter`). O staff chega aos das
   * equipas dele (`teamScopeFilter`) — e não ao clube inteiro, que é o que a
   * lista de atletas dá a um treinador com `athlete:write`: saber que um
   * miúdo de outro escalão existe é uma coisa, ler-lhe as alergias é outra. O
   * departamento clínico e a direcção não têm equipas: chegam a todos.
   */
  private async atletaClinico(db: ScopedClient, ctx: RequestContext, athleteId: string) {
    const meus = athleteScopeFilter(ctx);
    const equipas = meus ? undefined : teamScopeFilter(ctx);
    const athlete = await db.athlete.findFirst({
      where: {
        id: athleteId,
        ...(meus ? { AND: [{ id: meus }] } : {}),
        ...(equipas ? { teams: { some: { teamId: equipas, leftAt: null } } } : {}),
      },
      select: { id: true },
    });
    if (!athlete) throw new NotFoundException("Atleta não encontrado ou fora do teu âmbito");
  }

  /* ------------------------------------------------------------------------ */
  /* Documentos                                                                */
  /* ------------------------------------------------------------------------ */

  async documentsList(ctx: RequestContext, athleteId: string) {
    this.assertDocumentos(ctx);

    const docs = await this.prisma.runAs(ctx.academyId, async (db) => {
      await this.atletaDosDocumentos(db, ctx, athleteId);
      return db.athleteDocument.findMany({
        where: { athleteId },
        orderBy: { createdAt: "desc" },
        select: { id: true, name: true, files: true, createdAt: true, createdByName: true },
      });
    });

    // Os links assinam-se agora, fora da transacção, e nunca se guardam.
    return Promise.all(docs.map((d) => this.saida(d)));
  }

  /** Passo 1: a autorização — um endereço assinado para uma chave nossa. */
  async documentUploadUrl(ctx: RequestContext, athleteId: string, contentType: string) {
    this.assertDocumentos(ctx);
    const ext = DOC_TIPOS[contentType];
    if (!ext) throw new BadRequestException("O ficheiro tem de ser uma imagem (JPEG, PNG, WebP), um PDF ou um Word");

    await this.prisma.runAs(ctx.academyId, (db) => this.atletaDosDocumentos(db, ctx, athleteId));
    // O clube no limite de espaço não carrega mais. Ver `EspacoService`.
    await this.espaco.garantirEspaco(ctx.academyId);
    await this.storage.ensureBucket({
      name: DOCUMENT_BUCKET,
      fileSizeLimit: DOC_MAX_BYTES,
      allowedMimeTypes: Object.keys(DOC_TIPOS),
    });

    const key = `${pastaDoAtleta(ctx.academyId, athleteId)}/${randomBytes(8).toString("hex")}${ext}`;
    const signed = await this.storage.signUpload(DOCUMENT_BUCKET, key);
    return { ...signed, key, maxBytes: DOC_MAX_BYTES };
  }

  /** Passo 3: o documento nasce com os ficheiros que já chegaram. */
  async documentCreate(
    ctx: RequestContext,
    athleteId: string,
    dto: { name?: unknown; files?: { key?: unknown; name?: unknown }[] },
  ) {
    this.assertDocumentos(ctx);
    const name = this.validar(() => nomeDoDocumento(dto.name));
    await this.prisma.runAs(ctx.academyId, (db) => this.atletaDosDocumentos(db, ctx, athleteId));
    const files = await this.confirmar(ctx, athleteId, dto.files ?? []);
    if (files.length === 0) throw new BadRequestException("Junta pelo menos um ficheiro ao documento");

    const doc = await this.prisma.runAs(ctx.academyId, async (db) =>
      db.athleteDocument.create({
        data: { academyId: ctx.academyId, athleteId, name, files, createdByName: await this.nomeDe(db, ctx) },
        select: { id: true, name: true, files: true, createdAt: true, createdByName: true },
      }),
    );
    return this.saida(doc);
  }

  /** Mudar o nome, e juntar ficheiros a um documento que já existe. */
  async documentUpdate(
    ctx: RequestContext,
    id: string,
    dto: { name?: unknown; addFiles?: { key?: unknown; name?: unknown }[] },
  ) {
    this.assertDocumentos(ctx);
    const name = dto.name === undefined ? undefined : this.validar(() => nomeDoDocumento(dto.name));

    const antes = await this.prisma.runAs(ctx.academyId, (db) => this.documento(db, ctx, id));
    const novos = await this.confirmar(ctx, antes.athleteId, dto.addFiles ?? []);

    const doc = await this.prisma.runAs(ctx.academyId, async (db) => {
      // Lido outra vez dentro da transacção que escreve: entre confirmar os
      // ficheiros e gravar, outra pessoa pode ter mexido na lista.
      const actual = await this.documento(db, ctx, id);
      const juntos = [...actual.files];
      for (const f of novos) if (!juntos.some((x) => x.key === f.key)) juntos.push(f);
      if (juntos.length > DOC_MAX_FICHEIROS) {
        throw new BadRequestException(`Um documento leva no máximo ${DOC_MAX_FICHEIROS} ficheiros`);
      }
      return db.athleteDocument.update({
        where: { id },
        data: { ...(name !== undefined ? { name } : {}), files: juntos },
        select: { id: true, name: true, files: true, createdAt: true, createdByName: true },
      });
    });
    return this.saida(doc);
  }

  async documentRemoveFile(ctx: RequestContext, id: string, key: string) {
    this.assertDocumentos(ctx);

    const tinha = await this.prisma.runAs(ctx.academyId, async (db) => {
      const doc = await this.documento(db, ctx, id);
      if (!doc.files.some((f) => f.key === key)) return false;
      if (doc.files.length === 1) {
        throw new BadRequestException("É o único ficheiro do documento — apaga o documento em vez disso");
      }
      await db.athleteDocument.update({ where: { id }, data: { files: doc.files.filter((f) => f.key !== key) } });
      return true;
    });

    if (tinha) await this.storage.remove(DOCUMENT_BUCKET, key);
    return { ok: true };
  }

  async documentRemove(ctx: RequestContext, id: string) {
    this.assertDocumentos(ctx);

    const files = await this.prisma.runAs(ctx.academyId, async (db) => {
      const doc = await this.documento(db, ctx, id);
      await db.athleteDocument.delete({ where: { id } });
      return doc.files;
    });

    // Depois de a linha sair: se o apagar falhar a meio, não fica um documento
    // a apontar para ficheiros que já não existem.
    for (const f of files) await this.storage.remove(DOCUMENT_BUCKET, f.key);
    return { ok: true };
  }

  /* ---- regras ---- */

  private assertDocumentos(ctx: RequestContext): void {
    if (!can(ctx, "athlete:write") || daFamilia(ctx)) {
      throw new ForbiddenException("Sem acesso aos documentos do atleta");
    }
  }

  /**
   * O atleta, pelo alcance de quem edita fichas: as equipas dele.
   *
   * Mais apertado do que a leitura da lista de atletas, de propósito. Um
   * treinador com `athlete:write` vê os nomes do clube inteiro (para não criar
   * duplicados), mas os documentos são só os dos atletas das equipas dele.
   */
  private async atletaDosDocumentos(db: ScopedClient, ctx: RequestContext, athleteId: string) {
    const equipas = teamScopeFilter(ctx);
    const athlete = await db.athlete.findFirst({
      where: { id: athleteId, ...(equipas ? { teams: { some: { teamId: equipas, leftAt: null } } } : {}) },
      select: { id: true },
    });
    if (!athlete) throw new NotFoundException("Atleta não encontrado ou fora do teu âmbito");
  }

  private async documento(db: ScopedClient, ctx: RequestContext, id: string) {
    const doc = await db.athleteDocument.findFirst({
      where: { id },
      select: { id: true, athleteId: true, files: true },
    });
    if (!doc) throw new NotFoundException("Documento não encontrado");
    await this.atletaDosDocumentos(db, ctx, doc.athleteId);
    return { id: doc.id, athleteId: doc.athleteId, files: ficheirosDe(doc.files) };
  }

  /**
   * Os ficheiros que o pedido diz ter carregado: só entram os que são deste
   * atleta e que chegaram mesmo ao armazenamento.
   */
  private async confirmar(
    ctx: RequestContext,
    athleteId: string,
    pedidos: { key?: unknown; name?: unknown }[],
  ): Promise<FicheiroDoDocumento[]> {
    if (!Array.isArray(pedidos)) throw new BadRequestException("Ficheiros inválidos");
    if (pedidos.length > DOC_MAX_FICHEIROS) {
      throw new BadRequestException(`Um documento leva no máximo ${DOC_MAX_FICHEIROS} ficheiros`);
    }
    const out: FicheiroDoDocumento[] = [];
    for (const p of pedidos) {
      if (!chaveDoAtleta(p?.key, ctx.academyId, athleteId)) throw new BadRequestException("Chave inválida");
      if (out.some((f) => f.key === p.key)) continue;
      if (!(await this.storage.exists(DOCUMENT_BUCKET, p.key))) {
        throw new BadRequestException("O ficheiro não chegou ao armazenamento");
      }
      out.push({ key: p.key, name: nomeDoFicheiro(p.name, p.key), type: tipoDaChave(p.key) });
    }
    return out;
  }

  private async saida(d: { id: string; name: string; files: unknown; createdAt: Date; createdByName: string | null }) {
    const files = await Promise.all(
      ficheirosDe(d.files).map(async (f) => ({
        ...f,
        url: await this.storage.signDownload(DOCUMENT_BUCKET, f.key, DOC_TTL),
      })),
    );
    return { id: d.id, name: d.name, createdAt: d.createdAt, createdByName: d.createdByName, files };
  }

  private async nomeDe(db: ScopedClient, ctx: RequestContext): Promise<string | null> {
    const m = await db.membership.findFirst({
      where: { id: ctx.membershipId },
      select: { user: { select: { name: true } } },
    });
    return m?.user.name?.trim() || null;
  }

  /** As regras são funções puras que lançam `Error`; aqui viram 400. */
  private validar<T>(f: () => T): T {
    try {
      return f();
    } catch (e) {
      throw new BadRequestException(e instanceof Error ? e.message : "Dados inválidos");
    }
  }
}

import { createHash } from "node:crypto";
import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { LegalAcceptanceKind, LegalAudience, LegalDocumentType, LegalScope } from "@prisma/client";
import { PlatformPrisma } from "../platform/platform.prisma";
import { PlatformService } from "../platform/platform.service";
import type { PlatformAdminContext } from "../platform/platform.guard";
import { LegalService } from "./legal.service";
import { LEGAL_AUDIENCES, LEGAL_TYPES, LEGAL_TYPE_LIST, VERSION_RE } from "./legal.catalog";

/**
 * A gestão dos documentos legais, do lado da plataforma.
 *
 * Escreve pela ligação da plataforma — o papel das academias não tem escrita
 * nesta tabela, e é assim que se garante que nenhum endpoint de academia, por
 * engano, publica um documento. Cada publicação e retirada fica no `AuditLog`.
 *
 * ## O ciclo de vida de uma versão
 *
 *   DRAFT ──publish──▶ PUBLISHED ──retire──▶ RETIRED
 *
 * Um rascunho edita-se à vontade. Uma versão publicada **não se edita**: quem a
 * aceitou aceitou aquele texto, e o `contentHash` das aceitações tem de continuar
 * a bater. Corrigir é publicar outra versão. Retirar não apaga — as aceitações
 * continuam a apontar para a linha.
 *
 * Não é um CMS. É o mínimo para publicar uma versão nova sem deploy e para
 * responder a "quem já aceitou a v2.0?".
 */

export type DocumentInput = {
  type: LegalDocumentType;
  version: string;
  title: string;
  summary?: string | null;
  content: string;
  scope?: LegalScope;
  audiences?: LegalAudience[];
  acceptanceKind?: LegalAcceptanceKind;
  effectiveAt?: string | null;
  changeNote?: string | null;
};

@Injectable()
export class LegalAdminService {
  constructor(
    private readonly prisma: PlatformPrisma,
    private readonly platform: PlatformService,
    private readonly legal: LegalService,
  ) {}

  /** Tudo, agrupado por tipo, com a versão em vigor de cada um assinalada. */
  async overview() {
    const [rows, current] = await Promise.all([
      this.prisma.legalDocument.findMany({
        orderBy: [{ type: "asc" }, { effectiveAt: "desc" }, { createdAt: "desc" }],
        select: {
          id: true, type: true, version: true, title: true, summary: true, status: true, scope: true,
          audiences: true, acceptanceKind: true, effectiveAt: true, publishedAt: true, retiredAt: true,
          changeNote: true, createdAt: true, updatedAt: true,
          _count: { select: { acceptances: true } },
        },
      }),
      this.legal.current(),
    ]);
    const currentIds = new Set(current.map((d) => d.id));

    return LEGAL_TYPE_LIST.map((type) => {
      const info = LEGAL_TYPES[type];
      const versions = rows
        .filter((r) => r.type === type)
        .map((r) => ({ ...r, acceptances: r._count.acceptances, _count: undefined, isCurrent: currentIds.has(r.id) }));
      return {
        type,
        slug: info.slug,
        label: info.label,
        hint: info.hint,
        defaults: info.defaults,
        currentId: versions.find((v) => v.isCurrent)?.id ?? null,
        versions,
      };
    });
  }

  async get(id: string) {
    const doc = await this.prisma.legalDocument.findFirst({ where: { id } });
    if (!doc) throw new NotFoundException("Versão não encontrada");
    return doc;
  }

  async create(admin: PlatformAdminContext, input: DocumentInput, ip?: string) {
    const info = LEGAL_TYPES[input.type];
    if (!info) throw new BadRequestException("Tipo de documento desconhecido");
    validar(input);

    const existente = await this.prisma.legalDocument.findFirst({ where: { type: input.type, version: input.version } });
    if (existente) throw new ConflictException(`Já existe a versão ${input.version} de ${info.label}.`);

    const doc = await this.prisma.legalDocument.create({
      data: {
        type: input.type,
        version: input.version.trim(),
        title: input.title.trim(),
        summary: input.summary?.trim() || null,
        content: input.content,
        contentHash: hash(input.content),
        status: "DRAFT",
        scope: input.scope ?? info.defaults.scope,
        audiences: input.audiences ?? info.defaults.audiences,
        acceptanceKind: input.acceptanceKind ?? info.defaults.acceptanceKind,
        effectiveAt: input.effectiveAt ? new Date(input.effectiveAt) : new Date(),
        changeNote: input.changeNote?.trim() || null,
        createdById: admin.id,
      },
    });
    await this.platform.audit(admin, "legal.create", "LegalDocument", doc.id, { type: doc.type, version: doc.version }, ip);
    return doc;
  }

  /** Só rascunhos. Uma versão publicada é imutável — ver o cabeçalho. */
  async update(admin: PlatformAdminContext, id: string, input: Partial<DocumentInput>, ip?: string) {
    const doc = await this.get(id);
    if (doc.status !== "DRAFT") {
      throw new ConflictException("Uma versão publicada não se edita. Cria uma versão nova.");
    }
    /*
     * Só o que veio mesmo no corpo: a `ValidationPipe` devolve uma instância do
     * DTO com as propriedades opcionais **definidas a `undefined`**, e um spread
     * cego apagava a versão e o título do rascunho antes de os validar.
     */
    const dados = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) as Partial<DocumentInput>;
    validar({ ...doc, ...dados, effectiveAt: dados.effectiveAt ?? null } as DocumentInput);

    if (dados.version && dados.version !== doc.version) {
      const outra = await this.prisma.legalDocument.findFirst({ where: { type: doc.type, version: dados.version } });
      if (outra) throw new ConflictException(`Já existe a versão ${dados.version}.`);
    }

    const updated = await this.prisma.legalDocument.update({
      where: { id },
      data: {
        version: dados.version?.trim(),
        title: dados.title?.trim(),
        summary: dados.summary === undefined ? undefined : dados.summary?.trim() || null,
        content: dados.content,
        contentHash: dados.content !== undefined ? hash(dados.content) : undefined,
        scope: dados.scope,
        audiences: dados.audiences,
        acceptanceKind: dados.acceptanceKind,
        effectiveAt: dados.effectiveAt ? new Date(dados.effectiveAt) : undefined,
        changeNote: dados.changeNote === undefined ? undefined : dados.changeNote?.trim() || null,
      },
    });
    await this.platform.audit(admin, "legal.update", "LegalDocument", id, { version: updated.version }, ip);
    return updated;
  }

  /**
   * Publica. A partir de `effectiveAt` passa a ser a versão em vigor do tipo, e
   * quem ainda não a aceitou passa a ver o gate na próxima entrada. Uma data
   * futura publica hoje e entra em vigor nesse dia — até lá vale a anterior.
   */
  async publish(admin: PlatformAdminContext, id: string, effectiveAt?: string | null, ip?: string) {
    const doc = await this.get(id);
    if (doc.status === "PUBLISHED") throw new ConflictException("Esta versão já está publicada.");
    if (doc.status === "RETIRED") throw new ConflictException("Uma versão retirada não volta a publicar-se. Cria outra.");
    if (!doc.content.trim()) throw new BadRequestException("Uma versão sem texto não se publica.");

    const quando = effectiveAt ? new Date(effectiveAt) : doc.effectiveAt;
    if (Number.isNaN(quando.getTime())) throw new BadRequestException("Data de entrada em vigor inválida.");

    const updated = await this.prisma.legalDocument.update({
      where: { id },
      data: { status: "PUBLISHED", publishedAt: new Date(), publishedById: admin.id, effectiveAt: quando },
    });
    this.legal.invalidate();
    await this.platform.audit(
      admin, "legal.publish", "LegalDocument", id,
      { type: doc.type, version: doc.version, effectiveAt: quando.toISOString() }, ip,
    );
    return updated;
  }

  /** Retira sem apagar. Se era a versão em vigor, a anterior publicada volta a valer. */
  async retire(admin: PlatformAdminContext, id: string, ip?: string) {
    const doc = await this.get(id);
    if (doc.status !== "PUBLISHED") throw new ConflictException("Só se retira o que está publicado.");
    const updated = await this.prisma.legalDocument.update({
      where: { id },
      data: { status: "RETIRED", retiredAt: new Date() },
    });
    this.legal.invalidate();
    await this.platform.audit(admin, "legal.retire", "LegalDocument", id, { type: doc.type, version: doc.version }, ip);
    return updated;
  }

  /** Um rascunho pode ir para o lixo. Mais nada pode. */
  async remove(admin: PlatformAdminContext, id: string, ip?: string) {
    const doc = await this.get(id);
    if (doc.status !== "DRAFT") throw new ConflictException("Só se apaga um rascunho.");
    await this.prisma.legalDocument.delete({ where: { id } });
    await this.platform.audit(admin, "legal.delete", "LegalDocument", id, { type: doc.type, version: doc.version }, ip);
    return { ok: true };
  }

  /**
   * Quem já aceitou o quê.
   *
   * Por versão em vigor: quantas pessoas (âmbito USER) ou quantos clubes
   * (âmbito CLUB) aceitaram. Para os documentos de clube, a lista dos clubes que
   * **ainda não** aceitaram — é o estado "por aceitar" de que fala a migração,
   * derivado e não guardado: um clube existente não é tocado até o responsável
   * fazer a aceitação, e esta lista é como se sabe quem falta.
   */
  async stats() {
    const [current, academies] = await Promise.all([
      this.legal.current(),
      this.prisma.academy.findMany({
        where: { status: { not: "CANCELLED" } },
        select: { id: true, name: true, slug: true, status: true },
        orderBy: { name: "asc" },
      }),
    ]);

    const porDoc = await Promise.all(
      current.map(async (doc) => {
        if (doc.scope === "CLUB") {
          const aceites = await this.prisma.legalAcceptance.findMany({
            where: { documentId: doc.id, onBehalfOfClub: true },
            select: { academyId: true, acceptedAt: true, user: { select: { name: true } } },
            orderBy: { acceptedAt: "asc" },
          });
          const porClube = new Map<string, { acceptedAt: Date; by: string }>();
          for (const a of aceites) if (a.academyId && !porClube.has(a.academyId)) porClube.set(a.academyId, { acceptedAt: a.acceptedAt, by: a.user.name });
          return {
            id: doc.id,
            type: doc.type,
            title: doc.title,
            version: doc.version,
            scope: doc.scope,
            acceptanceKind: doc.acceptanceKind,
            accepted: porClube.size,
            total: academies.length,
            pendingAcademies: academies
              .filter((a) => !porClube.has(a.id))
              .map((a) => ({ id: a.id, name: a.name, slug: a.slug, status: a.status })),
            acceptedAcademies: academies
              .filter((a) => porClube.has(a.id))
              .map((a) => ({ id: a.id, name: a.name, slug: a.slug, ...porClube.get(a.id)! })),
          };
        }
        const grouped = await this.prisma.legalAcceptance.groupBy({
          by: ["userId"],
          where: { documentId: doc.id },
        });
        return {
          id: doc.id,
          type: doc.type,
          title: doc.title,
          version: doc.version,
          scope: doc.scope,
          acceptanceKind: doc.acceptanceKind,
          accepted: grouped.length,
          total: null,
          pendingAcademies: [],
          acceptedAcademies: [],
        };
      }),
    );

    return { academies: academies.length, documents: porDoc };
  }

  /** As aceitações mais recentes, para o registo. Filtráveis por clube. */
  async acceptances(filter: { academyId?: string; type?: string; limit?: number }) {
    const rows = await this.prisma.legalAcceptance.findMany({
      where: {
        academyId: filter.academyId || undefined,
        documentType: filter.type && filter.type in LEGAL_TYPES ? (filter.type as LegalDocumentType) : undefined,
      },
      orderBy: { acceptedAt: "desc" },
      take: Math.min(filter.limit ?? 100, 500),
      select: {
        id: true, documentType: true, documentVersion: true, scope: true, onBehalfOfClub: true, context: true,
        acceptedAt: true, ip: true, userAgent: true,
        user: { select: { name: true, email: true } },
        academy: { select: { name: true, slug: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      type: r.documentType,
      label: LEGAL_TYPES[r.documentType].label,
      version: r.documentVersion,
      scope: r.scope,
      onBehalfOfClub: r.onBehalfOfClub,
      context: r.context,
      acceptedAt: r.acceptedAt,
      ip: r.ip,
      userAgent: r.userAgent,
      user: r.user,
      academy: r.academy,
    }));
  }
}

/* -------------------------------------------------------------------------- */

function hash(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function validar(input: DocumentInput): void {
  if (!VERSION_RE.test((input.version ?? "").trim())) throw new BadRequestException('Versão inválida — usa "1.0", "1.1", "2.0".');
  if (!input.title?.trim()) throw new BadRequestException("Falta o título.");
  if (typeof input.content !== "string") throw new BadRequestException("Falta o texto.");
  if (input.content.length > 400_000) throw new BadRequestException("Texto demasiado longo.");
  if (input.audiences && input.audiences.some((a) => !LEGAL_AUDIENCES.includes(a))) {
    throw new BadRequestException("Audiência desconhecida.");
  }
  if (input.scope && input.scope !== "CLUB" && input.scope !== "USER") throw new BadRequestException("Âmbito inválido.");
  if (input.acceptanceKind && !["ACCEPT", "ACKNOWLEDGE", "NONE"].includes(input.acceptanceKind)) {
    throw new BadRequestException("Tipo de aceitação inválido.");
  }
  if (input.effectiveAt && Number.isNaN(new Date(input.effectiveAt).getTime())) {
    throw new BadRequestException("Data de entrada em vigor inválida.");
  }
}

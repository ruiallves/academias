import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { can, type RequestContext } from "../common/permissions";

/**
 * Os catálogos da academia.
 *
 * ## Quem lê e quem escreve
 *
 * **Lê toda a gente** com `academy:read` — um treinador precisa da lista de locais
 * e balneários para marcar um treino, e obrigá-lo a ter `settings:write` para isso
 * seria dar-lhe as definições inteiras. **Escreve** só quem tem `settings:write`:
 * mudar o catálogo muda os menus de toda a academia.
 *
 * ## Semeados à primeira leitura
 *
 * Uma academia nova abriria com todos os menus vazios e com "Ainda não há locais"
 * em cada diálogo. Os valores por omissão dão-lhe um sítio por onde começar, e são
 * editáveis desde o primeiro segundo — como os papéis e os critérios de scouting.
 */

const KINDS = ["venues", "dressingRooms", "ageGroups", "staffTitles", "eventTypes"] as const;
export type CatalogKind = (typeof KINDS)[number];

export function isCatalogKind(value: string): value is CatalogKind {
  return (KINDS as readonly string[]).includes(value);
}

/**
 * O ponto de partida.
 *
 * Os tipos de evento são `isSystem`: o domínio distingue-os. Um treino abre folha
 * de presenças, um jogo tem adversário e resultado. Uma academia acrescenta os que
 * quiser, mas não pode apagar aqueles de que o produto depende.
 */
const SEED: Record<CatalogKind, { label: string; note?: string; isSystem?: boolean }[]> = {
  venues: [
    { label: "Campo 1", note: "Relvado sintético" },
    { label: "Campo 2", note: "Relvado sintético" },
    { label: "Pavilhão", note: "Piso interior" },
    { label: "Sede", note: "Reuniões e formação" },
  ],
  dressingRooms: [
    { label: "Balneário 1", note: "Campo 1 · lado nascente" },
    { label: "Balneário 2", note: "Campo 1 · lado poente" },
    { label: "Balneário 3", note: "Pavilhão · piso 0" },
    { label: "Balneário visitantes", note: "Pavilhão · junto à entrada" },
  ],
  ageGroups: [
    { label: "Sub-9", note: "2017–2018" },
    { label: "Sub-11", note: "2015–2016" },
    { label: "Sub-13", note: "2013–2014" },
    { label: "Sub-15", note: "2011–2012" },
  ],
  staffTitles: [{ label: "Treinador principal" }, { label: "Treinador adjunto" }, { label: "Coordenador" }],
  eventTypes: [
    { label: "Treino", isSystem: true },
    { label: "Jogo", isSystem: true },
    { label: "Torneio", isSystem: true },
    { label: "Evento", isSystem: true },
  ],
};

@Injectable()
export class CatalogsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Tudo de uma vez: são poucas linhas e a consola precisa de todos ao arrancar. */
  async list(ctx: RequestContext) {
    if (!can(ctx, "academy:read")) throw new ForbiddenException("Sem acesso à academia");

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const count = await db.catalogItem.count();
      if (count === 0) {
        await db.catalogItem.createMany({
          data: KINDS.flatMap((kind) =>
            SEED[kind].map((item, i) => ({
              academyId: ctx.academyId,
              kind,
              label: item.label,
              note: item.note ?? null,
              isSystem: item.isSystem ?? false,
              order: i,
              updatedAt: new Date(),
            })),
          ),
          skipDuplicates: true,
        });
      }

      return db.catalogItem.findMany({
        orderBy: [{ kind: "asc" }, { order: "asc" }, { label: "asc" }],
        select: { id: true, kind: true, label: true, note: true, order: true, isSystem: true, archivedAt: true },
      });
    });
  }

  async create(ctx: RequestContext, kind: string, label: string, note?: string) {
    this.mustWrite(ctx);
    if (!isCatalogKind(kind)) throw new BadRequestException("Catálogo desconhecido");

    const clean = label.trim();
    if (clean.length < 1) throw new BadRequestException("Falta o nome");

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const last = await db.catalogItem.findFirst({
        where: { kind },
        orderBy: { order: "desc" },
        select: { order: true },
      });

      try {
        return await db.catalogItem.create({
          data: {
            academyId: ctx.academyId,
            kind,
            label: clean,
            note: note?.trim() || null,
            order: (last?.order ?? 0) + 1,
            updatedAt: new Date(),
          },
          select: { id: true, kind: true, label: true, note: true, order: true, isSystem: true, archivedAt: true },
        });
      } catch (error) {
        // Duplicados são o problema que este catálogo existe para resolver.
        if ((error as { code?: string }).code === "P2002") {
          throw new BadRequestException(`"${clean}" já existe neste catálogo`);
        }
        throw error;
      }
    });
  }

  async update(ctx: RequestContext, id: string, dto: { label?: string; note?: string; order?: number }) {
    this.mustWrite(ctx);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const item = await db.catalogItem.findFirst({ where: { id }, select: { id: true, isSystem: true } });
      if (!item) throw new NotFoundException("Item não encontrado");
      // Renomear "Jogo" para "Partida" partiria o que o domínio distingue.
      if (item.isSystem && dto.label !== undefined) {
        throw new BadRequestException("Este item é do sistema e não se renomeia");
      }

      await db.catalogItem.update({
        where: { id },
        data: {
          ...(dto.label !== undefined ? { label: dto.label.trim() } : {}),
          ...(dto.note !== undefined ? { note: dto.note.trim() || null } : {}),
          ...(dto.order !== undefined ? { order: dto.order } : {}),
          updatedAt: new Date(),
        },
      });

      return { ok: true };
    });
  }

  /**
   * Arquivar ou repor.
   *
   * Nunca apagar. "Campo 2" apagado reescreveria o local de todos os treinos que lá
   * aconteceram — os treinos guardam o nome do local, não uma referência, e é
   * deliberado: um treino de 2019 aconteceu onde aconteceu, mesmo que a academia
   * tenha entretanto vendido o campo.
   */
  async setArchived(ctx: RequestContext, id: string, archived: boolean) {
    this.mustWrite(ctx);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const item = await db.catalogItem.findFirst({ where: { id }, select: { id: true, isSystem: true } });
      if (!item) throw new NotFoundException("Item não encontrado");
      if (item.isSystem) throw new BadRequestException("Este item é do sistema e não se arquiva");

      await db.catalogItem.update({
        where: { id },
        data: { archivedAt: archived ? new Date() : null, updatedAt: new Date() },
      });

      return { ok: true };
    });
  }

  private mustWrite(ctx: RequestContext) {
    if (!can(ctx, "settings:write")) throw new ForbiddenException("Sem permissão para mudar as definições");
  }
}

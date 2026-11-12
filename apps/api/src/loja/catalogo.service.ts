import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService, type ScopedClient } from "../prisma/prisma.service";
import { can, type RequestContext } from "../common/permissions";
import { SEM_PLANO, siteIncluido } from "../site/plano";
import { SiteRevalidarService } from "../site/site-revalidar.service";
import { codigoNormalizado, resumoDoCodigo, slugDoTexto, slugLivre } from "./regras";
import type { CategoriaDto, CodigoDto, OrdemDto } from "./catalogo.dto";

/**
 * O catálogo da loja na consola: as categorias (nome, endereço, ordem,
 * visível) e os códigos promocionais. Os produtos continuam em `SiteService`.
 *
 * Ver é `website:read`, mexer é `website:write`, e só com o site no plano,
 * como o resto do menu Website. Cada escrita avisa o site (revalidar).
 */
@Injectable()
export class CatalogoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly revalidar: SiteRevalidarService,
  ) {}

  private async plano(ctx: RequestContext) {
    const ok = await this.prisma.runAs(ctx.academyId, (db) => siteIncluido(db, ctx.academyId));
    if (!ok) throw new ForbiddenException({ code: "SITE_NOT_IN_PLAN", message: SEM_PLANO });
  }

  private async escrever(ctx: RequestContext) {
    if (!can(ctx, "website:write")) throw new ForbiddenException("Sem permissão para mexer na loja");
    await this.plano(ctx);
  }

  private avisar(ctx: RequestContext) {
    void this.prisma
      .runAs(ctx.academyId, (db) => db.academy.findFirst({ where: { id: ctx.academyId }, select: { slug: true } }))
      .then((a) => a && this.revalidar.avisar(a.slug))
      .catch(() => undefined);
  }

  /* ------------------------------------------------------------------------ */
  /* Leitura (para `GET /api/site`)                                            */
  /* ------------------------------------------------------------------------ */

  /** As categorias e os códigos, para a consola. Chamado de dentro do `runAs` de `SiteService.ler`. */
  async paraConsola(db: ScopedClient) {
    const agora = new Date();
    const [categorias, contagens, codigos, usos] = await Promise.all([
      db.siteProductCategory.findMany({ orderBy: [{ position: "asc" }, { createdAt: "asc" }] }),
      db.siteProduct.groupBy({ by: ["categoryId"], _count: { _all: true } }),
      db.siteDiscountCode.findMany({ orderBy: [{ active: "desc" }, { createdAt: "desc" }] }),
      db.siteOrder.groupBy({
        by: ["discountCodeId"],
        where: { discountCodeId: { not: null }, OR: [{ status: { in: ["PAID", "READY", "SHIPPED", "DELIVERED"] } }, { status: "RESERVED", reservedUntil: { gt: agora } }] },
        _count: { _all: true },
        _sum: { discountCents: true },
      }),
    ]);
    const nProdutos = new Map(contagens.map((c) => [c.categoryId, c._count._all]));
    const porCodigo = new Map(usos.map((u) => [u.discountCodeId, u]));
    return {
      categorias: categorias.map((c) => categoriaParaConsola(c, nProdutos.get(c.id) ?? 0)),
      codigos: codigos.map((c) => codigoParaConsola(c, porCodigo.get(c.id)?._count._all ?? 0, porCodigo.get(c.id)?._sum.discountCents ?? 0, agora)),
    };
  }

  /* ------------------------------------------------------------------------ */
  /* Categorias                                                                 */
  /* ------------------------------------------------------------------------ */

  async criarCategoria(ctx: RequestContext, dto: CategoriaDto) {
    await this.escrever(ctx);
    const c = await this.prisma.runAs(ctx.academyId, async (db) => {
      const nome = dto.nome.trim();
      if (await db.siteProductCategory.findFirst({ where: { name: { equals: nome, mode: "insensitive" } }, select: { id: true } })) {
        throw new ConflictException("Já há uma categoria com este nome");
      }
      const slug = await this.slugDaCategoria(db, dto.slug?.trim() || nome, null);
      const position = await db.siteProductCategory.count();
      return db.siteProductCategory.create({
        data: { academyId: ctx.academyId, name: nome, slug, description: (dto.descricao ?? "").trim(), visible: dto.visivel !== false, position },
      });
    });
    this.avisar(ctx);
    return categoriaParaConsola(c, 0);
  }

  async editarCategoria(ctx: RequestContext, id: string, dto: CategoriaDto) {
    await this.escrever(ctx);
    const r = await this.prisma.runAs(ctx.academyId, async (db) => {
      const antes = await db.siteProductCategory.findFirst({ where: { id } });
      if (!antes) throw new NotFoundException("Categoria não encontrada");
      const nome = dto.nome.trim();
      if (await db.siteProductCategory.findFirst({ where: { id: { not: id }, name: { equals: nome, mode: "insensitive" } }, select: { id: true } })) {
        throw new ConflictException("Já há uma categoria com este nome");
      }
      const slug = dto.slug !== undefined && dto.slug.trim() !== antes.slug ? await this.slugDaCategoria(db, dto.slug.trim() || nome, id) : antes.slug;
      const c = await db.siteProductCategory.update({
        where: { id },
        data: { name: nome, slug, description: (dto.descricao ?? antes.description).trim(), visible: dto.visivel ?? antes.visible },
      });
      // O texto da categoria nos produtos acompanha o nome (emails e consolas antigas leem-no).
      if (nome !== antes.name) await db.siteProduct.updateMany({ where: { categoryId: id }, data: { category: nome } });
      const n = await db.siteProduct.count({ where: { categoryId: id } });
      return categoriaParaConsola(c, n);
    });
    this.avisar(ctx);
    return r;
  }

  /** Apaga a categoria. Os produtos dela ficam sem categoria (continuam à venda). */
  async apagarCategoria(ctx: RequestContext, id: string) {
    await this.escrever(ctx);
    await this.prisma.runAs(ctx.academyId, async (db) => {
      await db.siteProduct.updateMany({ where: { categoryId: id }, data: { categoryId: null, category: "" } });
      await db.siteProductCategory.deleteMany({ where: { id } });
    });
    this.avisar(ctx);
    return { ok: true as const };
  }

  /** A ordem nova das categorias: a lista completa dos ids, de cima para baixo. */
  async ordenarCategorias(ctx: RequestContext, dto: OrdemDto) {
    await this.escrever(ctx);
    await this.prisma.runAs(ctx.academyId, async (db) => {
      const existentes = new Set((await db.siteProductCategory.findMany({ select: { id: true } })).map((c) => c.id));
      const ids = dto.ids.filter((id) => existentes.has(id));
      for (const [i, id] of ids.entries()) await db.siteProductCategory.update({ where: { id }, data: { position: i } });
    });
    this.avisar(ctx);
    return { ok: true as const };
  }

  private async slugDaCategoria(db: ScopedClient, pedido: string, semId: string | null): Promise<string> {
    const base = slugDoTexto(pedido);
    if (!base) throw new BadRequestException("O endereço precisa de pelo menos uma letra ou algarismo");
    const ocupados = new Set((await db.siteProductCategory.findMany({ where: semId ? { id: { not: semId } } : {}, select: { slug: true } })).map((c) => c.slug));
    return slugLivre(base, ocupados);
  }

  /**
   * A categoria de um produto a partir do que a consola mandou: o id, ou um
   * nome (o painel do Inventário e consolas antigas mandam o texto). Um nome
   * que ainda não existe cria a categoria. Devolve o id e o nome, ou nulos.
   */
  async categoriaDoProduto(db: ScopedClient, academyId: string, entrada: { categoriaId?: string | null; categoria?: string }): Promise<{ id: string | null; nome: string }> {
    if (entrada.categoriaId === null || entrada.categoriaId === "") return { id: null, nome: "" };
    if (entrada.categoriaId) {
      const c = await db.siteProductCategory.findFirst({ where: { id: entrada.categoriaId }, select: { id: true, name: true } });
      if (!c) throw new BadRequestException("Essa categoria já não existe");
      return { id: c.id, nome: c.name };
    }
    const nome = (entrada.categoria ?? "").trim();
    if (!nome) return { id: null, nome: "" };
    const existe = await db.siteProductCategory.findFirst({ where: { name: { equals: nome, mode: "insensitive" } }, select: { id: true, name: true } });
    if (existe) return { id: existe.id, nome: existe.name };
    const slug = await this.slugDaCategoria(db, nome, null);
    const position = await db.siteProductCategory.count();
    const nova = await db.siteProductCategory.create({ data: { academyId, name: nome, slug, position } });
    return { id: nova.id, nome: nova.name };
  }

  /* ------------------------------------------------------------------------ */
  /* Códigos promocionais                                                       */
  /* ------------------------------------------------------------------------ */

  async criarCodigo(ctx: RequestContext, dto: CodigoDto) {
    await this.escrever(ctx);
    const c = await this.prisma.runAs(ctx.academyId, async (db) => {
      const data = await this.dadosDoCodigo(db, dto);
      try {
        return await db.siteDiscountCode.create({ data: { academyId: ctx.academyId, ...data } });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new ConflictException(`Já há um código ${data.code}`);
        throw e;
      }
    });
    return codigoParaConsola(c, 0, 0, new Date());
  }

  async editarCodigo(ctx: RequestContext, id: string, dto: CodigoDto) {
    await this.escrever(ctx);
    return this.prisma.runAs(ctx.academyId, async (db) => {
      const antes = await db.siteDiscountCode.findFirst({ where: { id } });
      if (!antes) throw new NotFoundException("Código não encontrado");
      const data = await this.dadosDoCodigo(db, dto);
      let c;
      try {
        c = await db.siteDiscountCode.update({ where: { id }, data });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new ConflictException(`Já há um código ${data.code}`);
        throw e;
      }
      const agora = new Date();
      const u = await db.siteOrder.aggregate({
        where: { discountCodeId: id, OR: [{ status: { in: ["PAID", "READY", "SHIPPED", "DELIVERED"] } }, { status: "RESERVED", reservedUntil: { gt: agora } }] },
        _count: { _all: true },
        _sum: { discountCents: true },
      });
      return codigoParaConsola(c, u._count._all, u._sum.discountCents ?? 0, agora);
    });
  }

  /** Apaga o código. As encomendas que o usaram ficam com o texto e o valor do desconto. */
  async apagarCodigo(ctx: RequestContext, id: string) {
    await this.escrever(ctx);
    await this.prisma.runAs(ctx.academyId, (db) => db.siteDiscountCode.deleteMany({ where: { id } }));
    return { ok: true as const };
  }

  private async dadosDoCodigo(db: ScopedClient, dto: CodigoDto) {
    const code = codigoNormalizado(dto.codigo);
    if (code.length < 3) throw new BadRequestException("O código tem de ter pelo menos 3 letras ou algarismos");
    const kind = dto.tipo === "FIXO" ? ("FIXED" as const) : ("PERCENT" as const);
    const value = kind === "PERCENT" ? Math.round(dto.valor) : Math.round(dto.valor * 100);
    if (kind === "PERCENT" && (value < 0 || value > 100)) throw new BadRequestException("A percentagem vai de 0 a 100");
    if (value === 0 && !dto.envioGratis) throw new BadRequestException("Um código sem desconto tem de dar, pelo menos, o envio grátis");
    const startsAt = dto.inicio ? new Date(dto.inicio) : null;
    const endsAt = dto.fim ? new Date(dto.fim) : null;
    if (startsAt && endsAt && endsAt <= startsAt) throw new BadRequestException("O fim tem de ser depois do início");
    const pedidas = [...new Set(dto.categorias ?? [])];
    const categorias = pedidas.length ? (await db.siteProductCategory.findMany({ where: { id: { in: pedidas } }, select: { id: true } })).map((c) => c.id) : [];
    return {
      code,
      description: (dto.descricao ?? "").trim(),
      kind,
      value,
      freeShipping: dto.envioGratis === true,
      minOrderCents: dto.minimo ? Math.round(dto.minimo * 100) : null,
      startsAt,
      endsAt,
      maxUses: dto.maxUsos ?? null,
      oncePerCustomer: dto.umaVezPorPessoa === true,
      categoryIds: categorias,
      excludeOnSale: dto.semPromocoes === true,
      active: dto.ativo !== false,
    };
  }
}

/* -------------------------------------------------------------------------- */
/* Para a consola                                                               */
/* -------------------------------------------------------------------------- */

function categoriaParaConsola(c: { id: string; name: string; slug: string; description: string; visible: boolean; position: number }, produtos: number) {
  return { id: c.id, nome: c.name, slug: c.slug, descricao: c.description, visivel: c.visible, ordem: c.position, produtos };
}

function codigoParaConsola(
  c: {
    id: string;
    code: string;
    description: string;
    kind: "PERCENT" | "FIXED";
    value: number;
    freeShipping: boolean;
    minOrderCents: number | null;
    startsAt: Date | null;
    endsAt: Date | null;
    maxUses: number | null;
    oncePerCustomer: boolean;
    categoryIds: string[];
    excludeOnSale: boolean;
    active: boolean;
  },
  usos: number,
  descontadoCents: number,
  agora: Date,
) {
  const estado = !c.active
    ? "desligado"
    : c.endsAt && c.endsAt < agora
      ? "expirado"
      : c.startsAt && c.startsAt > agora
        ? "agendado"
        : c.maxUses !== null && usos >= c.maxUses
          ? "esgotado"
          : "ativo";
  return {
    id: c.id,
    codigo: c.code,
    descricao: c.description,
    tipo: c.kind === "FIXED" ? ("FIXO" as const) : ("PERCENTAGEM" as const),
    /** Percentagem (0 a 100) ou euros. */
    valor: c.kind === "FIXED" ? c.value / 100 : c.value,
    envioGratis: c.freeShipping,
    minimo: c.minOrderCents !== null ? c.minOrderCents / 100 : null,
    inicio: c.startsAt?.toISOString() ?? null,
    fim: c.endsAt?.toISOString() ?? null,
    maxUsos: c.maxUses,
    umaVezPorPessoa: c.oncePerCustomer,
    categorias: c.categoryIds,
    semPromocoes: c.excludeOnSale,
    ativo: c.active,
    /** Encomendas pagas (ou guardadas agora) com este código, e quanto já descontou. */
    usos,
    descontadoEuros: descontadoCents / 100,
    estado,
    resumo: resumoDoCodigo(c),
  };
}

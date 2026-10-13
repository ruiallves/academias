import { randomBytes } from "node:crypto";
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";
import { EspacoService } from "../storage/espaco.service";
import { can, type RequestContext } from "../common/permissions";
import type { AtualizarSiteDto, BilheteiraDto, NoticiaDto, PatrocinadorDto, ProdutoDto } from "./site.dto";
import {
  equipasValidas,
  identidadeValida,
  recintosValidos,
  tiposParaConsola,
  tiposValidos,
  urlSegura,
  type Layout,
} from "./site.tipos";
import { SiteRevalidarService } from "./site-revalidar.service";
import { SEM_PLANO, siteIncluido } from "./plano";

/**
 * O site do clube, do lado da consola (menu Website).
 *
 * Quem mexe é quem mexe nas Definições (`settings:write`): é a cara pública do
 * clube, como o símbolo e a cor. Ler também pede a mesma permissão, porque o
 * menu só existe para quem o edita. E só em clubes com o site no plano
 * (Connect Pro, ver `plano.ts`): sem ele, tudo responde 403 `SITE_NOT_IN_PLAN`.
 *
 * Cada escrita avisa o site no fim (`SiteRevalidarService`), para a mudança
 * aparecer na página seguinte e não um minuto depois.
 */

/** O bucket das imagens do site: público, porque o site é público. Ver `storage.service.ts`. */
export const SITE_BUCKET = "site-publico";
const SITE_MAX_BYTES = 5 * 1024 * 1024;
const SITE_TYPES = ["image/png", "image/webp", "image/jpeg"];

@Injectable()
export class SiteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly espaco: EspacoService,
    private readonly config: ConfigService,
    private readonly revalidar: SiteRevalidarService,
  ) {}

  /* ------------------------------------------------------------------------ */
  /* Ler                                                                        */
  /* ------------------------------------------------------------------------ */

  /** Tudo o que o menu Website mostra, de uma vez. */
  async ler(ctx: RequestContext) {
    await this.mustWrite(ctx);
    return this.prisma.runAs(ctx.academyId, async (db) => {
      const [academy, config, noticias, produtos, patrocinadores, bilhetes] = await Promise.all([
        db.academy.findFirst({ where: { id: ctx.academyId }, select: { slug: true, siteDomain: true } }),
        db.siteConfig.findUnique({ where: { academyId: ctx.academyId } }),
        db.siteNews.findMany({ orderBy: [{ publishedAt: { sort: "desc", nulls: "first" } }, { createdAt: "desc" }] }),
        db.siteProduct.findMany({ orderBy: [{ position: "asc" }, { createdAt: "asc" }] }),
        db.siteSponsor.findMany({ orderBy: [{ position: "asc" }, { createdAt: "asc" }] }),
        db.siteMatchTickets.findMany(),
      ]);
      return {
        slug: academy?.slug ?? "",
        dominio: academy?.siteDomain ?? "",
        publicado: config?.published ?? false,
        layout: (config?.layout as Layout) ?? "classico",
        identidade: identidadeValida(config?.identity),
        equipas: equipasValidas(config?.teams),
        recintos: recintosValidos(config?.venues),
        noticias: noticias.map(noticiaParaConsola),
        produtos: produtos.map(produtoParaConsola),
        patrocinadores: patrocinadores.map((p) => ({ id: p.id, nome: p.name, url: p.url ?? "", logo: p.logoUrl ?? "" })),
        bilheteira: Object.fromEntries(bilhetes.map((b) => [b.matchId, bilheteiraParaConsola(b)])),
      };
    });
  }

  /* ------------------------------------------------------------------------ */
  /* A configuração                                                             */
  /* ------------------------------------------------------------------------ */

  async atualizar(ctx: RequestContext, dto: AtualizarSiteDto) {
    await this.mustWrite(ctx);
    const data: Prisma.SiteConfigUncheckedUpdateInput = {};
    if (dto.publicado !== undefined) data.published = dto.publicado;
    if (dto.layout !== undefined) data.layout = dto.layout;
    if (dto.identidade !== undefined) data.identity = identidadeValida(dto.identidade);
    if (dto.equipas !== undefined) data.teams = equipasValidas(dto.equipas);
    if (dto.recintos !== undefined) data.venues = recintosValidos(dto.recintos);

    const config = await this.prisma.runAs(ctx.academyId, (db) =>
      db.siteConfig.upsert({
        where: { academyId: ctx.academyId },
        create: { ...(data as Omit<Prisma.SiteConfigUncheckedCreateInput, "academyId">), academyId: ctx.academyId },
        update: data,
      }),
    );
    this.avisar(ctx);
    return {
      publicado: config.published,
      layout: config.layout as Layout,
      identidade: identidadeValida(config.identity),
      equipas: equipasValidas(config.teams),
      recintos: recintosValidos(config.venues),
    };
  }

  /* ------------------------------------------------------------------------ */
  /* Notícias                                                                   */
  /* ------------------------------------------------------------------------ */

  async criarNoticia(ctx: RequestContext, dto: NoticiaDto) {
    await this.mustWrite(ctx);
    const n = await this.prisma.runAs(ctx.academyId, (db) =>
      db.siteNews.create({ data: { academyId: ctx.academyId, ...this.dadosDaNoticia(ctx, dto, null) } }),
    );
    this.avisar(ctx);
    return noticiaParaConsola(n);
  }

  async editarNoticia(ctx: RequestContext, id: string, dto: NoticiaDto) {
    await this.mustWrite(ctx);
    const n = await this.prisma.runAs(ctx.academyId, async (db) => {
      const antes = await db.siteNews.findFirst({ where: { id } });
      if (!antes) throw new NotFoundException("Notícia não encontrada");
      return db.siteNews.update({ where: { id }, data: this.dadosDaNoticia(ctx, dto, antes.publishedAt) });
    });
    this.avisar(ctx);
    return noticiaParaConsola(n);
  }

  async apagarNoticia(ctx: RequestContext, id: string) {
    await this.mustWrite(ctx);
    await this.prisma.runAs(ctx.academyId, (db) => db.siteNews.deleteMany({ where: { id } }));
    this.avisar(ctx);
    return { ok: true as const };
  }

  /**
   * A data de publicação fica a da primeira vez: editar uma notícia publicada
   * não a manda para o topo da lista. Voltar a rascunho tira-a do site.
   */
  private dadosDaNoticia(ctx: RequestContext, dto: NoticiaDto, publicadaEm: Date | null) {
    const publicar = dto.estado === "publicada";
    return {
      title: dto.titulo.trim(),
      summary: (dto.resumo ?? "").trim(),
      body: (dto.corpo ?? "").trim(),
      category: (dto.categoria ?? "Clube").trim() || "Clube",
      imageUrl: this.imagemDoClube(ctx, dto.imagem),
      featured: dto.destaque === true,
      publishedAt: publicar ? (publicadaEm ?? new Date()) : null,
    };
  }

  /* ------------------------------------------------------------------------ */
  /* Produtos                                                                   */
  /* ------------------------------------------------------------------------ */

  async criarProduto(ctx: RequestContext, dto: ProdutoDto) {
    await this.mustWrite(ctx);
    const p = await this.prisma.runAs(ctx.academyId, async (db) => {
      const position = dto.ordem ?? (await db.siteProduct.count());
      return db.siteProduct.create({ data: { academyId: ctx.academyId, ...this.dadosDoProduto(ctx, dto), position } });
    });
    this.avisar(ctx);
    return produtoParaConsola(p);
  }

  async editarProduto(ctx: RequestContext, id: string, dto: ProdutoDto) {
    await this.mustWrite(ctx);
    const p = await this.prisma.runAs(ctx.academyId, async (db) => {
      if (!(await db.siteProduct.findFirst({ where: { id }, select: { id: true } }))) throw new NotFoundException("Produto não encontrado");
      return db.siteProduct.update({
        where: { id },
        data: { ...this.dadosDoProduto(ctx, dto), ...(dto.ordem !== undefined ? { position: dto.ordem } : {}) },
      });
    });
    this.avisar(ctx);
    return produtoParaConsola(p);
  }

  async apagarProduto(ctx: RequestContext, id: string) {
    await this.mustWrite(ctx);
    await this.prisma.runAs(ctx.academyId, (db) => db.siteProduct.deleteMany({ where: { id } }));
    this.avisar(ctx);
    return { ok: true as const };
  }

  private dadosDoProduto(ctx: RequestContext, dto: ProdutoDto) {
    return {
      name: dto.nome.trim(),
      category: (dto.categoria ?? "Equipamento").trim() || "Equipamento",
      priceCents: Math.round(dto.preco * 100),
      imageUrl: this.imagemDoClube(ctx, dto.imagem),
      description: (dto.descricao ?? "").trim(),
      sizes: (dto.tamanhos ?? "").trim(),
      soldOut: dto.esgotado === true,
      visible: dto.visivel !== false,
    };
  }

  /* ------------------------------------------------------------------------ */
  /* Patrocinadores                                                             */
  /* ------------------------------------------------------------------------ */

  async criarPatrocinador(ctx: RequestContext, dto: PatrocinadorDto) {
    await this.mustWrite(ctx);
    const p = await this.prisma.runAs(ctx.academyId, async (db) => {
      const position = dto.ordem ?? (await db.siteSponsor.count());
      return db.siteSponsor.create({ data: { academyId: ctx.academyId, ...this.dadosDoPatrocinador(ctx, dto), position } });
    });
    this.avisar(ctx);
    return { id: p.id, nome: p.name, url: p.url ?? "", logo: p.logoUrl ?? "" };
  }

  async editarPatrocinador(ctx: RequestContext, id: string, dto: PatrocinadorDto) {
    await this.mustWrite(ctx);
    const p = await this.prisma.runAs(ctx.academyId, async (db) => {
      if (!(await db.siteSponsor.findFirst({ where: { id }, select: { id: true } }))) throw new NotFoundException("Patrocinador não encontrado");
      return db.siteSponsor.update({
        where: { id },
        data: { ...this.dadosDoPatrocinador(ctx, dto), ...(dto.ordem !== undefined ? { position: dto.ordem } : {}) },
      });
    });
    this.avisar(ctx);
    return { id: p.id, nome: p.name, url: p.url ?? "", logo: p.logoUrl ?? "" };
  }

  async apagarPatrocinador(ctx: RequestContext, id: string) {
    await this.mustWrite(ctx);
    await this.prisma.runAs(ctx.academyId, (db) => db.siteSponsor.deleteMany({ where: { id } }));
    this.avisar(ctx);
    return { ok: true as const };
  }

  private dadosDoPatrocinador(ctx: RequestContext, dto: PatrocinadorDto) {
    return { name: dto.nome.trim(), url: urlSegura(dto.url) || null, logoUrl: this.imagemDoClube(ctx, dto.logo) };
  }

  /* ------------------------------------------------------------------------ */
  /* Bilheteira                                                                 */
  /* ------------------------------------------------------------------------ */

  /** Só jogos em casa: fora, quem vende é o outro clube. */
  async gravarBilheteira(ctx: RequestContext, matchId: string, dto: BilheteiraDto) {
    await this.mustWrite(ctx);
    const tipos = tiposValidos(dto.tipos);
    if (tipos.length === 0) throw new BadRequestException("Indica pelo menos um tipo de bilhete com nome e preço");
    const b = await this.prisma.runAs(ctx.academyId, async (db) => {
      const jogo = await db.match.findFirst({ where: { id: matchId }, select: { isHome: true } });
      if (!jogo) throw new NotFoundException("Jogo não encontrado");
      if (!jogo.isHome) throw new BadRequestException("Só os jogos em casa têm bilheteira");
      const data = {
        open: dto.aberta,
        venueId: dto.recintoId || null,
        capacity: dto.lotacao ?? null,
        note: (dto.nota ?? "").trim(),
        types: tipos,
      };
      return db.siteMatchTickets.upsert({
        where: { matchId },
        create: { matchId, academyId: ctx.academyId, ...data },
        update: data,
      });
    });
    this.avisar(ctx);
    return bilheteiraParaConsola(b);
  }

  async apagarBilheteira(ctx: RequestContext, matchId: string) {
    await this.mustWrite(ctx);
    await this.prisma.runAs(ctx.academyId, (db) => db.siteMatchTickets.deleteMany({ where: { matchId } }));
    this.avisar(ctx);
    return { ok: true as const };
  }

  /* ------------------------------------------------------------------------ */
  /* Imagens                                                                    */
  /* ------------------------------------------------------------------------ */

  /**
   * Autorização para carregar uma imagem do site (notícia, produto,
   * patrocinador). Devolve também o endereço público em que vai ficar, que é
   * o que a consola grava no item. O ficheiro vai do browser para o Supabase
   * sem passar pela API, como o símbolo do clube.
   */
  async assinarImagem(ctx: RequestContext, contentType: string) {
    await this.mustWrite(ctx);
    if (!SITE_TYPES.includes(contentType)) throw new BadRequestException("A imagem tem de ser PNG, WebP ou JPEG");
    await this.espaco.garantirEspaco(ctx.academyId);
    await this.storage.ensureBucket({ name: SITE_BUCKET, fileSizeLimit: SITE_MAX_BYTES, allowedMimeTypes: SITE_TYPES, public: true });
    const ext = contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : "jpg";
    const key = `${ctx.academyId}/site-${randomBytes(8).toString("hex")}.${ext}`;
    const { url, token } = await this.storage.signUpload(SITE_BUCKET, key);
    return { url, token, key, publicUrl: `${this.baseDasImagens()}/${key}` };
  }

  private baseDasImagens(): string {
    const base = this.config.getOrThrow<string>("SUPABASE_URL").replace(/\/$/, "");
    return `${base}/storage/v1/object/public/${SITE_BUCKET}`;
  }

  /**
   * Uma imagem só entra se for deste clube, no bucket do site.
   *
   * Sem isto, um item podia apontar para a imagem de outro clube, ou para
   * qualquer endereço da Internet, e o site do clube mostrava o que lá
   * estivesse. Vazio = sem imagem.
   */
  private imagemDoClube(ctx: RequestContext, url: string | undefined): string | null {
    const s = (url ?? "").trim();
    if (!s) return null;
    const prefixo = `${this.baseDasImagens()}/${ctx.academyId}/`;
    if (!s.startsWith(prefixo) || /[\s?#]/.test(s.slice(prefixo.length))) {
      throw new BadRequestException("A imagem tem de ser carregada pelo menu Website");
    }
    return s;
  }

  /* ------------------------------------------------------------------------ */

  /** A permissão de quem pede, e o plano do clube (o site é do Connect Pro). */
  private async mustWrite(ctx: RequestContext) {
    if (!can(ctx, "settings:write")) throw new ForbiddenException("Sem permissão para mexer no site do clube");
    const ok = await this.prisma.runAs(ctx.academyId, (db) => siteIncluido(db, ctx.academyId));
    if (!ok) throw new ForbiddenException({ code: "SITE_NOT_IN_PLAN", message: SEM_PLANO });
  }

  /** Depois de gravar, sem esperar: o aviso nunca atrasa nem falha uma escrita. */
  private avisar(ctx: RequestContext) {
    void this.prisma
      .runAs(ctx.academyId, (db) => db.academy.findFirst({ where: { id: ctx.academyId }, select: { slug: true } }))
      .then((a) => a && this.revalidar.avisar(a.slug))
      .catch(() => undefined);
  }
}

/* -------------------------------------------------------------------------- */
/* Para a consola                                                               */
/* -------------------------------------------------------------------------- */

function noticiaParaConsola(n: {
  id: string;
  title: string;
  summary: string;
  body: string;
  category: string;
  imageUrl: string | null;
  featured: boolean;
  publishedAt: Date | null;
}) {
  return {
    id: n.id,
    titulo: n.title,
    resumo: n.summary,
    corpo: n.body,
    categoria: n.category,
    imagem: n.imageUrl ?? "",
    destaque: n.featured,
    estado: n.publishedAt ? ("publicada" as const) : ("rascunho" as const),
    publicadaEm: n.publishedAt?.toISOString() ?? null,
  };
}

function produtoParaConsola(p: {
  id: string;
  name: string;
  category: string;
  priceCents: number;
  imageUrl: string | null;
  description: string;
  sizes: string;
  soldOut: boolean;
  visible: boolean;
}) {
  return {
    id: p.id,
    nome: p.name,
    categoria: p.category,
    preco: p.priceCents / 100,
    imagem: p.imageUrl ?? "",
    descricao: p.description,
    tamanhos: p.sizes,
    esgotado: p.soldOut,
    visivel: p.visible,
  };
}

function bilheteiraParaConsola(b: { open: boolean; venueId: string | null; capacity: number | null; note: string; types: unknown }) {
  return { aberta: b.open, recintoId: b.venueId, lotacao: b.capacity, nota: b.note, tipos: tiposParaConsola(b.types) };
}

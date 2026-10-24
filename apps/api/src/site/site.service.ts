import { createHash, randomBytes } from "node:crypto";
import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Prisma } from "@prisma/client";
import { PrismaService, type ScopedClient } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";
import { EspacoService } from "../storage/espaco.service";
import { INVENTORY_BUCKET } from "../inventory/inventory.bucket";
import { can, type RequestContext } from "../common/permissions";
import type { AtualizarSiteDto, BilheteiraDto, MensagemDto, NoticiaDto, PatrocinadorDto, ProdutoDoInventarioDto, ProdutoDto } from "./site.dto";
import {
  equipasValidas,
  identidadeValida,
  inicioValido,
  layoutValido,
  lojaParaConsola,
  lojaValida,
  recintosValidos,
  stockValido,
  tamanhosDoProduto,
  tiposParaConsola,
  tiposValidos,
  urlSegura,
  type TipoGuardado,
} from "./site.tipos";
import { SiteRevalidarService } from "./site-revalidar.service";
import { SEM_PLANO, siteIncluido } from "./plano";

/**
 * O site do clube, do lado da consola (menu Website).
 *
 * Quem lê tem `website:read`; quem publica tem `website:write`. Era
 * `settings:write`, e obrigava a dar as Definições inteiras a quem só escreve
 * notícias — ver a nota da permissão em `common/permissions.ts`. E só em
 * clubes com o site no plano (Connect Pro, ver `plano.ts`): sem ele, tudo
 * responde 403 `SITE_NOT_IN_PLAN`.
 *
 * Cada escrita avisa o site no fim (`SiteRevalidarService`), para a mudança
 * aparecer na página seguinte e não um minuto depois.
 */

/** O bucket das imagens do site: público, porque o site é público. Ver `storage.service.ts`. */
export const SITE_BUCKET = "site-publico";
const SITE_MAX_BYTES = 5 * 1024 * 1024;
const SITE_TYPES = ["image/png", "image/webp", "image/jpeg"];

/** Quantas mensagens do site a consola lista. As mais antigas apagam-se ou ficam tratadas. */
const MENSAGENS_MAX = 300;

@Injectable()
export class SiteService {
  private readonly log = new Logger(SiteService.name);

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
    await this.mustRead(ctx);
    return this.prisma.runAs(ctx.academyId, async (db) => {
      const [academy, config, noticias, produtos, patrocinadores, bilhetes, porLer, porTratar] = await Promise.all([
        db.academy.findFirst({ where: { id: ctx.academyId }, select: { slug: true, siteDomain: true, paymentsEnabled: true } }),
        db.siteConfig.findUnique({ where: { academyId: ctx.academyId } }),
        db.siteNews.findMany({ orderBy: [{ publishedAt: { sort: "desc", nulls: "first" } }, { createdAt: "desc" }] }),
        db.siteProduct.findMany({ orderBy: [{ position: "asc" }, { createdAt: "asc" }] }),
        db.siteSponsor.findMany({ orderBy: [{ position: "asc" }, { createdAt: "asc" }] }),
        db.siteMatchTickets.findMany(),
        db.siteMessage.count({ where: { readAt: null } }),
        db.siteOrder.count({ where: { status: "PAID" } }),
      ]);
      return {
        slug: academy?.slug ?? "",
        dominio: academy?.siteDomain ?? "",
        publicado: config?.published ?? false,
        layout: layoutValido(config?.layout),
        identidade: identidadeValida(config?.identity),
        equipas: equipasValidas(config?.teams),
        recintos: recintosValidos(config?.venues),
        inicio: inicioValido(config?.home),
        noticias: noticias.map(noticiaParaConsola),
        produtos: produtos.map(produtoParaConsola),
        patrocinadores: patrocinadores.map((p) => ({ id: p.id, nome: p.name, url: p.url ?? "", logo: p.logoUrl ?? "" })),
        bilheteira: Object.fromEntries(bilhetes.map((b) => [b.matchId, bilheteiraParaConsola(b)])),
        /** Quantas mensagens do formulário de contactos ninguém abriu ainda. */
        mensagensPorLer: porLer,
        /** A loja: como se entrega e o aviso. Ver `lojaValida`. */
        loja: lojaParaConsola(config?.shop),
        /** Encomendas pagas à espera de preparar. A pastilha do submenu. */
        encomendasPorTratar: porTratar,
        /** Os pagamentos do clube estão ligados? Sem eles a loja fica em catálogo. */
        pagamentosLigados: academy?.paymentsEnabled ?? false,
        /** Os preços por omissão da bilheteira, por recinto. */
        precosBilheteira: precosParaConsola(config?.ticketDefaults),
        /** As categorias de sócio, para os preços de sócio. */
        categoriasDeSocio: (
          await db.memberTier.findMany({ where: { archivedAt: null }, orderBy: [{ order: "asc" }, { name: "asc" }], select: { id: true, name: true } })
        ).map((t) => ({ id: t.id, nome: t.name })),
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
    // As fotografias (do clube, das instalações e de cada equipa) só entram se forem do próprio clube, como as das notícias.
    if (dto.identidade !== undefined) {
      const identidade = identidadeValida(dto.identidade);
      identidade.foto = this.imagemDoClube(ctx, identidade.foto) ?? "";
      for (const i of identidade.instalacoes) i.imagem = this.imagemDoClube(ctx, i.imagem) ?? "";
      data.identity = identidade;
    }
    if (dto.equipas !== undefined) {
      const equipas = equipasValidas(dto.equipas);
      for (const e of Object.values(equipas)) e.foto = this.imagemDoClube(ctx, e.foto) ?? "";
      data.teams = equipas;
    }
    if (dto.recintos !== undefined) data.venues = recintosValidos(dto.recintos);
    if (dto.inicio !== undefined) {
      const inicio = inicioValido(dto.inicio);
      for (const s of inicio.seccoes) if (s.banner) s.banner.imagem = this.imagemDoClube(ctx, s.banner.imagem) ?? "";
      inicio.banner.imagem = this.imagemDoClube(ctx, inicio.banner.imagem) ?? "";
      data.home = inicio;
    }
    if (dto.loja !== undefined) data.shop = lojaValida(dto.loja);

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
      layout: layoutValido(config.layout),
      identidade: identidadeValida(config.identity),
      equipas: equipasValidas(config.teams),
      recintos: recintosValidos(config.venues),
      inicio: inicioValido(config.home),
      loja: lojaParaConsola(config.shop),
    };
  }

  /* ------------------------------------------------------------------------ */
  /* Mensagens do formulário de contactos                                       */
  /* ------------------------------------------------------------------------ */

  /** As mensagens que chegaram pelo site, das mais recentes para as mais antigas. */
  async mensagens(ctx: RequestContext) {
    await this.mustRead(ctx);
    return this.prisma.runAs(ctx.academyId, async (db) => {
      const lista = await db.siteMessage.findMany({ orderBy: { createdAt: "desc" }, take: MENSAGENS_MAX });
      return lista.map(mensagemParaConsola);
    });
  }

  /**
   * Abrir, dar por tratada, ou voltar atrás. Abrir pede só leitura: ler uma
   * mensagem é ler. Tratar é escrita, e fica com o nome de quem o fez.
   */
  async mudarMensagem(ctx: RequestContext, id: string, dto: MensagemDto) {
    if (dto.tratada !== undefined) await this.mustWrite(ctx);
    else await this.mustRead(ctx);
    const m = await this.prisma.runAs(ctx.academyId, async (db) => {
      const antes = await db.siteMessage.findFirst({ where: { id } });
      if (!antes) throw new NotFoundException("Mensagem não encontrada");
      const quem = dto.tratada ? await db.user.findFirst({ where: { id: ctx.userId }, select: { name: true } }) : null;
      return db.siteMessage.update({
        where: { id },
        data: {
          ...(dto.lida !== undefined ? { readAt: dto.lida ? (antes.readAt ?? new Date()) : null } : {}),
          ...(dto.tratada !== undefined
            ? dto.tratada
              ? { handledAt: antes.handledAt ?? new Date(), handledByName: antes.handledByName ?? quem?.name ?? null, readAt: antes.readAt ?? new Date() }
              : { handledAt: null, handledByName: null }
            : {}),
        },
      });
    });
    return mensagemParaConsola(m);
  }

  async apagarMensagem(ctx: RequestContext, id: string) {
    await this.mustWrite(ctx);
    await this.prisma.runAs(ctx.academyId, (db) => db.siteMessage.deleteMany({ where: { id } }));
    return { ok: true as const };
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
      const antes = await db.siteProduct.findFirst({ where: { id }, select: { id: true, inventoryItemId: true } });
      if (!antes) throw new NotFoundException("Produto não encontrado");
      const dados = this.dadosDoProduto(ctx, dto);
      // Num produto ligado ao inventário, os tamanhos, o esgotado e o stock são do artigo: não se escrevem.
      if (antes.inventoryItemId) {
        delete (dados as Partial<typeof dados>).sizes;
        delete (dados as Partial<typeof dados>).soldOut;
        delete (dados as Partial<typeof dados>).stock;
      }
      return db.siteProduct.update({
        where: { id },
        data: { ...dados, ...(dto.ordem !== undefined ? { position: dto.ordem } : {}) },
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
    const sizes = tamanhosDoProduto(dto.tamanhos ?? "").join(", ");
    // O stock só guarda tamanhos que existem (ou "" num produto sem tamanhos): um tamanho apagado leva a contagem dele.
    const tamanhos = tamanhosDoProduto(sizes);
    const stockLido = stockValido(dto.stock);
    const stock: Record<string, number> = {};
    for (const t of tamanhos.length ? tamanhos : [""]) if (t in stockLido) stock[t] = stockLido[t];
    return {
      name: dto.nome.trim(),
      category: (dto.categoria ?? "Equipamento").trim() || "Equipamento",
      priceCents: Math.round(dto.preco * 100),
      imageUrl: this.imagemDoClube(ctx, dto.imagem),
      images: (dto.imagens ?? []).map((i) => this.imagemDoClube(ctx, i)).filter((i): i is string => !!i),
      description: (dto.descricao ?? "").trim(),
      sizes,
      soldOut: dto.esgotado === true,
      visible: dto.visivel !== false,
      ...(dto.stock !== undefined ? { stock } : {}),
    };
  }

  /* ------------------------------------------------------------------------ */
  /* Artigos do Inventário à venda no site                                      */
  /* ------------------------------------------------------------------------ */

  /**
   * O que a ficha de um artigo do Inventário mostra sobre a loja do site.
   *
   * `null` quando o clube não tem o site no plano: a ficha nem mostra o painel.
   * Com o site, diz se está à venda e com que preço. Chamado de dentro do
   * `runAs` do inventário, por isso recebe o `db`.
   */
  async produtoDoArtigo(db: ScopedClient, academyId: string, itemId: string) {
    if (!(await siteIncluido(db, academyId))) return null;
    const p = await db.siteProduct.findUnique({ where: { inventoryItemId: itemId } });
    return {
      aVenda: !!p,
      produto: p ? produtoParaConsola(p) : null,
    };
  }

  /**
   * Pôr um artigo do armazém à venda no site, ou mudar-lhe o preço.
   *
   * ## Quem pode
   *
   * `website:write` e `inventory:read`: publicar um artigo é uma decisão do
   * site, não do armazém — o roupeiro que dá entrada em stock não põe coisas à
   * venda, e quem trata do site precisa de ver o artigo. E só com o site no
   * plano (Connect Pro): nos outros planos a consola nem mostra o painel, e
   * aqui responde 403 `SITE_NOT_IN_PLAN` a quem escrever o pedido à mão.
   *
   * ## O que fica no produto
   *
   * O nome vem do artigo; o preço, a categoria e a descrição são do produto
   * (a descrição começa pela do artigo). Os tamanhos e o esgotado **não se
   * gravam**: saem do stock disponível das variantes, na leitura pública
   * (`SitePublicoService`). A primeira fotografia do artigo é copiada do
   * bucket privado do inventário para o público do site.
   */
  async ligarAoInventario(ctx: RequestContext, itemId: string, dto: ProdutoDoInventarioDto) {
    await this.mustWrite(ctx);
    if (!can(ctx, "inventory:read")) throw new ForbiddenException("Sem acesso ao inventário");

    const p = await this.prisma.runAs(ctx.academyId, async (db) => {
      const item = await db.inventoryItem.findFirst({
        where: { id: itemId },
        select: { id: true, name: true, description: true, imageKeys: true, archivedAt: true },
      });
      if (!item) throw new NotFoundException("Artigo não encontrado");
      if (item.archivedAt) throw new BadRequestException("Um artigo arquivado não se põe à venda");

      const existente = await db.siteProduct.findUnique({ where: { inventoryItemId: itemId } });
      const imagem = await this.fotoDoArtigoNoSite(ctx.academyId, itemId, item.imageKeys[0], existente?.imageUrl ?? null);
      const dados = {
        name: item.name,
        category: (dto.categoria ?? existente?.category ?? "Equipamento").trim() || "Equipamento",
        priceCents: Math.round(dto.preco * 100),
        description: (dto.descricao ?? existente?.description ?? item.description ?? "").trim(),
        visible: dto.visivel ?? existente?.visible ?? true,
        imageUrl: imagem,
        sizes: "",
        soldOut: false,
      };
      if (existente) return db.siteProduct.update({ where: { id: existente.id }, data: dados });
      const position = await db.siteProduct.count();
      return db.siteProduct.create({ data: { academyId: ctx.academyId, inventoryItemId: itemId, position, ...dados } });
    });
    this.avisar(ctx);
    return produtoParaConsola(p);
  }

  /** Tirar o artigo da loja do site. O artigo e o stock ficam como estão. */
  async desligarDoInventario(ctx: RequestContext, itemId: string) {
    await this.mustWrite(ctx);
    await this.prisma.runAs(ctx.academyId, (db) => db.siteProduct.deleteMany({ where: { inventoryItemId: itemId } }));
    this.avisar(ctx);
    return { ok: true as const };
  }

  /**
   * O artigo mudou de fotografias, ou de nome: o produto do site acompanha.
   *
   * Chamado pelo inventário depois de gravar, sem esperar e sem lançar: o
   * site nunca pode fazer falhar uma operação do armazém. Só mexe na imagem
   * se a que lá está for a cópia que nós fizemos (o clube pode ter escolhido
   * outra no menu Website, e essa fica).
   */
  sincronizarArtigo(academyId: string, itemId: string): void {
    void this.prisma
      .runAs(academyId, async (db) => {
        const p = await db.siteProduct.findUnique({ where: { inventoryItemId: itemId }, select: { id: true, imageUrl: true, name: true } });
        if (!p) return;
        const item = await db.inventoryItem.findFirst({ where: { id: itemId }, select: { name: true, imageKeys: true } });
        if (!item) return;
        const nossa = !p.imageUrl || p.imageUrl.includes(`/${academyId}/inv-${itemId}-`);
        const imageUrl = nossa ? await this.fotoDoArtigoNoSite(academyId, itemId, item.imageKeys[0], p.imageUrl) : p.imageUrl;
        if (imageUrl !== p.imageUrl || item.name !== p.name) {
          await db.siteProduct.update({ where: { id: p.id }, data: { imageUrl, name: item.name } });
          const a = await db.academy.findFirst({ where: { id: academyId }, select: { slug: true } });
          if (a) this.revalidar.avisar(a.slug);
        }
      })
      .catch((e: unknown) => this.log.warn(`Não foi possível sincronizar o artigo ${itemId} com o site: ${e instanceof Error ? e.message : e}`));
  }

  /**
   * A primeira fotografia do artigo, copiada para o bucket público do site.
   *
   * A chave leva o id do artigo e um resumo da chave de origem: a mesma foto
   * dá sempre o mesmo endereço (não se copia duas vezes), e uma foto nova dá
   * outro. Sem fotografia, sem imagem — a cópia antiga que fosse nossa sai.
   */
  private async fotoDoArtigoNoSite(academyId: string, itemId: string, chaveOrigem: string | undefined, atual: string | null): Promise<string | null> {
    const prefixo = `${this.baseDasImagens()}/${academyId}/inv-${itemId}-`;
    const eraNossa = !!atual && atual.startsWith(prefixo);
    if (!chaveOrigem) {
      if (eraNossa) await this.storage.remove(SITE_BUCKET, atual.slice(this.baseDasImagens().length + 1)).catch(() => undefined);
      return eraNossa ? null : atual;
    }
    const ext = chaveOrigem.toLowerCase().endsWith(".png") ? "png" : chaveOrigem.toLowerCase().endsWith(".webp") ? "webp" : "jpg";
    const key = `${academyId}/inv-${itemId}-${createHash("sha1").update(chaveOrigem).digest("hex").slice(0, 12)}.${ext}`;
    const url = `${this.baseDasImagens()}/${key}`;
    if (atual === url) return atual;

    const dados = await this.storage.download(INVENTORY_BUCKET, chaveOrigem);
    if (!dados) return eraNossa ? null : atual;
    await this.storage.ensureBucket({ name: SITE_BUCKET, fileSizeLimit: SITE_MAX_BYTES, allowedMimeTypes: SITE_TYPES, public: true });
    await this.storage.upload(SITE_BUCKET, key, dados, ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg");
    if (eraNossa) await this.storage.remove(SITE_BUCKET, atual.slice(this.baseDasImagens().length + 1)).catch(() => undefined);
    return url;
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

  /**
   * A bilheteira de um jogo, em casa ou fora. Fora, o clube vende os bilhetes
   * que tem para os seus adeptos, num recinto que desenha no Estádio.
   *
   * Um jogo sem preços nasce com os preços por omissão do recinto
   * (`SiteConfig.ticketDefaults`); depois mudam-se só para ele. Os preços de
   * sócio têm de apontar para categorias de sócio deste clube, e a venda só
   * abre com os pagamentos ligados (sem eles não há como pagar), salvo num
   * jogo em que tudo custa 0 €.
   */
  async gravarBilheteira(ctx: RequestContext, matchId: string, dto: BilheteiraDto) {
    await this.mustWrite(ctx);
    const b = await this.prisma.runAs(ctx.academyId, async (db) => {
      const jogo = await db.match.findFirst({ where: { id: matchId }, select: { id: true } });
      if (!jogo) throw new NotFoundException("Jogo não encontrado");

      const venueId = dto.recintoId || null;
      let tipos = tiposValidos(dto.tipos);
      if (tipos.length === 0 && venueId) {
        const config = await db.siteConfig.findUnique({ where: { academyId: ctx.academyId }, select: { ticketDefaults: true } });
        tipos = precosPorRecinto(config?.ticketDefaults)[venueId] ?? [];
      }
      if (tipos.length === 0) throw new BadRequestException("Indica pelo menos um tipo de bilhete com nome e preço");
      tipos = await this.tiposDoClube(db, tipos);
      // Cada preço numa bancada do recinto do jogo: uma bancada de fora não tinha lotação nem porta.
      const recinto = venueId ? recintosValidos((await db.siteConfig.findUnique({ where: { academyId: ctx.academyId }, select: { venues: true } }))?.venues).find((r) => r.id === venueId) : null;
      if (!recinto) throw new BadRequestException("Escolhe o recinto do jogo. Os recintos desenham-se no Estádio.");
      tipos = tipos.filter((t) => t.bancadaId && recinto.bancadas.some((b) => b.id === t.bancadaId));
      if (tipos.length === 0) throw new BadRequestException("Os preços têm de ser de bancadas deste recinto");

      if (dto.aberta && tipos.some((t) => t.precoCents > 0)) {
        const a = await db.academy.findFirst({ where: { id: ctx.academyId }, select: { paymentsEnabled: true } });
        if (!a?.paymentsEnabled) throw new BadRequestException("Para vender bilhetes, os pagamentos do clube têm de estar ligados (euPago).");
      }

      const data = {
        open: dto.aberta,
        venueId,
        capacity: dto.lotacao ?? null,
        note: (dto.nota ?? "").trim(),
        types: tipos,
        membersFrom: dto.sociosDesde ? new Date(dto.sociosDesde) : null,
        publicFrom: dto.publicoDesde ? new Date(dto.publicoDesde) : null,
        membersOnly: dto.soSocios === true,
        closesAt: dto.fechaEm ? new Date(dto.fechaEm) : null,
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

  /** Os preços de sócio só para categorias deste clube; os de uma categoria que já não existe caem. */
  private async tiposDoClube(db: ScopedClient, tipos: TipoGuardado[]): Promise<TipoGuardado[]> {
    const pedidas = [...new Set(tipos.flatMap((t) => (t.tierId ? [t.tierId] : [])))];
    if (pedidas.length === 0) return tipos;
    const existem = new Set((await db.memberTier.findMany({ where: { id: { in: pedidas } }, select: { id: true } })).map((t) => t.id));
    return tipos.filter((t) => !t.tierId || existem.has(t.tierId));
  }

  /** Os preços por omissão, por recinto: o "Preços" à direita da Bilheteira. */
  async gravarPrecos(ctx: RequestContext, porRecinto: Record<string, unknown[]>) {
    await this.mustWrite(ctx);
    const limpos = precosPorRecinto(porRecinto);
    const gravado = await this.prisma.runAs(ctx.academyId, async (db) => {
      const recintos = recintosValidos((await db.siteConfig.findUnique({ where: { academyId: ctx.academyId }, select: { venues: true } }))?.venues);
      for (const id of Object.keys(limpos)) {
        // Só recintos que existem, e em cada um só as bancadas dele.
        const r = recintos.find((x) => x.id === id);
        if (!r) {
          delete limpos[id];
          continue;
        }
        limpos[id] = (await this.tiposDoClube(db, limpos[id])).filter((t) => t.bancadaId && r.bancadas.some((b) => b.id === t.bancadaId));
      }
      return db.siteConfig.upsert({
        where: { academyId: ctx.academyId },
        create: { academyId: ctx.academyId, ticketDefaults: limpos },
        update: { ticketDefaults: limpos },
        select: { ticketDefaults: true },
      });
    });
    return precosParaConsola(gravado.ticketDefaults);
  }

  /**
   * Tirar a bilheteira de um jogo. Só sem compras: com compras, a venda
   * fecha-se ou cancela-se (que anula os bilhetes e regista os reembolsos), e
   * a base recusaria apagar na mesma (ver `20261021180000_bilheteira_proteger`).
   */
  async apagarBilheteira(ctx: RequestContext, matchId: string) {
    await this.mustWrite(ctx);
    await this.prisma.runAs(ctx.academyId, async (db) => {
      const compras = await db.ticketOrder.count({ where: { matchId } });
      if (compras > 0) throw new BadRequestException("Este jogo já tem compras de bilhetes. Fecha a venda, ou cancela-a nas Vendas, em vez de a apagar.");
      await db.siteMatchTickets.deleteMany({ where: { matchId } });
    });
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

  /** A permissão de quem lê, e o plano do clube (o site é do Connect Pro). */
  private async mustRead(ctx: RequestContext) {
    if (!can(ctx, "website:read")) throw new ForbiddenException("Sem acesso ao site do clube");
    await this.mustPlano(ctx);
  }

  /** A permissão de quem publica, e o plano. */
  private async mustWrite(ctx: RequestContext) {
    if (!can(ctx, "website:write")) throw new ForbiddenException("Sem permissão para mexer no site do clube");
    await this.mustPlano(ctx);
  }

  private async mustPlano(ctx: RequestContext) {
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
  images: string[];
  description: string;
  sizes: string;
  soldOut: boolean;
  visible: boolean;
  stock: unknown;
  inventoryItemId: string | null;
}) {
  return {
    id: p.id,
    nome: p.name,
    categoria: p.category,
    preco: p.priceCents / 100,
    imagem: p.imageUrl ?? "",
    /** A galeria, a seguir à capa. */
    imagens: p.images,
    descricao: p.description,
    tamanhos: p.sizes,
    esgotado: p.soldOut,
    visivel: p.visible,
    /** O stock por tamanho de um produto sem artigo. Um tamanho ausente vende-se sem contagem. */
    stock: stockValido(p.stock),
    /** O artigo do Inventário que este produto vende. Com ele, tamanhos e esgotado vêm do stock. */
    artigoId: p.inventoryItemId,
  };
}

function mensagemParaConsola(m: {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  subject: string;
  message: string;
  readAt: Date | null;
  handledAt: Date | null;
  handledByName: string | null;
  createdAt: Date;
}) {
  return {
    id: m.id,
    nome: m.name,
    email: m.email,
    telefone: m.phone ?? "",
    assunto: m.subject,
    mensagem: m.message,
    lida: m.readAt !== null,
    tratada: m.handledAt !== null,
    tratadaPor: m.handledByName,
    tratadaEm: m.handledAt?.toISOString() ?? null,
    recebidaEm: m.createdAt.toISOString(),
  };
}

function bilheteiraParaConsola(b: {
  open: boolean;
  venueId: string | null;
  capacity: number | null;
  note: string;
  types: unknown;
  membersFrom: Date | null;
  publicFrom: Date | null;
  membersOnly: boolean;
  closesAt: Date | null;
}) {
  return {
    aberta: b.open,
    recintoId: b.venueId,
    lotacao: b.capacity,
    nota: b.note,
    tipos: tiposParaConsola(b.types),
    sociosDesde: b.membersFrom?.toISOString() ?? null,
    publicoDesde: b.publicFrom?.toISOString() ?? null,
    soSocios: b.membersOnly,
    fechaEm: b.closesAt?.toISOString() ?? null,
  };
}

/** `SiteConfig.ticketDefaults`, limpo: por recinto, os tipos de bilhete. */
function precosPorRecinto(v: unknown): Record<string, TipoGuardado[]> {
  const o = (v && typeof v === "object" && !Array.isArray(v) ? v : {}) as Record<string, unknown>;
  const out: Record<string, TipoGuardado[]> = {};
  for (const [id, tipos] of Object.entries(o).slice(0, 10)) {
    if (!id || id.length > 60) continue;
    out[id] = tiposValidos(tipos);
  }
  return out;
}

function precosParaConsola(v: unknown): Record<string, ReturnType<typeof tiposParaConsola>> {
  return Object.fromEntries(Object.entries(precosPorRecinto(v)).map(([id, tipos]) => [id, tiposParaConsola(tipos)]));
}

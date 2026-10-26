import { randomBytes } from "node:crypto";
import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma, PaymentMethod } from "@prisma/client";
import { PrismaService, type ScopedClient } from "../prisma/prisma.service";
import { AuthService } from "../auth/auth.service";
import { BillingService } from "../billing/billing.service";
import { can, type RequestContext } from "../common/permissions";
import { FichaDoSite, caixaDoEmail, numeroDoTelefone } from "../platform/ficha-do-site";
import { TurnstileService } from "../common/turnstile.service";
import { siteIncluido, SEM_PLANO } from "../site/plano";
import { SELECT_VENDAS, vendeOnline } from "../common/vendas-online";
import { lojaParaConsola, lojaValida, type Loja } from "../site/site.tipos";
import { bloquearLoja, produtosParaVenda } from "./contexto";
import { LojaEmissao } from "./emissao.service";
import {
  RESERVA_MINUTOS,
  custoDeEnvio,
  entregaPossivel,
  juntarLinhas,
  lojaVende,
  moradaValida,
  proximoNumero,
  verificarCarrinho,
  type Entrega,
  type LinhaDoCarrinho,
} from "./regras";
import type { CarrinhoDto, EncomendarDto } from "./loja.dto";

/**
 * A loja do site: ver o carrinho, encomendar, a página da encomenda, e o que
 * a consola faz às encomendas.
 *
 * ## Por onde se compra
 *
 * Só no site (`/api/clubes/:slug/loja/...`, do browser de quem compra), sem
 * conta. Tudo acaba em `criarEncomenda`, que é o único sítio onde se guardam
 * artigos, e o pagamento entra pelo webhook da euPago do clube
 * (`LojaEmissao`).
 *
 * ## O que protege a venda
 *
 *   - o stock contado e escrito com a loja do clube bloqueada (`bloquearLoja`);
 *   - a ficha assinada (presa ao clube, 30 minutos, uma vez), o campo-armadilha
 *     e o desafio da Cloudflare, como na bilheteira;
 *   - no máximo duas encomendas à espera de pagamento por email (e por
 *     telemóvel), 4 pedidos MB WAY por hora por telemóvel, e um tecto de
 *     encomendas guardadas sem pagar por clube: uma encomenda guarda artigos
 *     10 minutos sem pagar nada, e um robô não pode esvaziar a loja.
 *
 * Sem tectos por endereço: ver a nota em `BilheteiraPublicaController`.
 */

const FICHA_MINUTOS = 30;
const ESPERA_POR_EMAIL = 2;
const MBWAY_POR_TELEMOVEL_HORA = 4;
/** Encomendas à espera de pagamento ao mesmo tempo, no clube inteiro. */
const GUARDADAS_POR_CLUBE = 150;
const FILA_POR_CLUBE = 60;
/** Quantas encomendas a consola lista. As mais antigas ficam entregues ou anuladas. */
const LISTA_MAX = 500;

@Injectable()
export class LojaService {
  private readonly log = new Logger(LojaService.name);
  private readonly ficha: FichaDoSite;
  /** Uma fila por clube, na memória da API. Ver `BilheteiraService.naFila`. */
  private readonly filas = new Map<string, { cauda: Promise<unknown>; aEspera: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly billing: BillingService,
    private readonly emissao: LojaEmissao,
    private readonly config: ConfigService,
    private readonly turnstile: TurnstileService,
  ) {
    const segredo = this.config.get<string>("SITE_FORM_SECRET") || this.config.get<string>("SUPABASE_JWT_SECRET") || "";
    // Um fim próprio: uma ficha da bilheteira ou dos contactos não serve para encomendar.
    this.ficha = new FichaDoSite(segredo || randomBytes(32).toString("hex"), "loja", FICHA_MINUTOS * 60_000);
  }

  private async naFila<T>(academyId: string, fn: () => Promise<T>): Promise<T> {
    const f = this.filas.get(academyId) ?? { cauda: Promise.resolve(), aEspera: 0 };
    if (f.aEspera >= FILA_POR_CLUBE) throw new BadRequestException("Há muita gente a encomendar neste momento. Tenta outra vez daqui a um minuto.");
    f.aEspera++;
    this.filas.set(academyId, f);
    const vez = f.cauda.then(fn, fn);
    f.cauda = vez.catch(() => undefined);
    try {
      return await vez;
    } finally {
      f.aEspera--;
      if (f.aEspera === 0) this.filas.delete(academyId);
    }
  }

  /* ------------------------------------------------------------------------ */
  /* O clube                                                                    */
  /* ------------------------------------------------------------------------ */

  /** O clube pelo endereço, se tiver o site no plano. A venda não depende de o site estar publicado. */
  private async clube(slug: string): Promise<string> {
    const academyId = await this.auth.academyIdBySlug(slug.slice(0, 80));
    if (!academyId) throw new NotFoundException();
    const ok = await this.prisma.runAs(academyId, (db) => siteIncluido(db, academyId));
    if (!ok) throw new NotFoundException();
    return academyId;
  }

  /** A loja do clube e se vende online (pagamentos e faturação ligados, e uma forma de entrega). */
  private async lojaDoClube(db: ScopedClient, academyId: string): Promise<{ loja: Loja; vende: boolean }> {
    const [config, academy] = await Promise.all([
      db.siteConfig.findUnique({ where: { academyId }, select: { shop: true } }),
      db.academy.findFirst({ where: { id: academyId }, select: SELECT_VENDAS }),
    ]);
    const loja = lojaValida(config?.shop);
    return { loja, vende: lojaVende(loja, vendeOnline(academy)) };
  }

  async fichaDaCompra(slug: string) {
    const academyId = await this.clube(slug);
    return { ficha: this.ficha.emitir(Date.now(), academyId) };
  }

  /* ------------------------------------------------------------------------ */
  /* O carrinho                                                                 */
  /* ------------------------------------------------------------------------ */

  private linhasDe(dto: { linhas: { productId: string; tamanho?: string; quantidade: number }[] }): LinhaDoCarrinho[] {
    return juntarLinhas(dto.linhas.map((l) => ({ productId: l.productId, tamanho: l.tamanho ?? "", quantidade: l.quantidade })));
  }

  /**
   * `POST /api/clubes/:slug/loja/carrinho`: o carrinho contra o stock de
   * agora, sem guardar nada. O site chama-o ao abrir o carrinho e antes de
   * pagar: os preços e o que há de cada artigo são os do servidor, e a
   * entrega é a que o clube tem ligada.
   */
  async carrinho(slug: string, dto: CarrinhoDto) {
    const academyId = await this.clube(slug);
    return this.prisma.runAs(academyId, async (db) => {
      const linhas = this.linhasDe(dto);
      const [{ loja, vende }, produtos] = await Promise.all([this.lojaDoClube(db, academyId), produtosParaVenda(db, linhas.map((l) => l.productId), new Date())]);
      const porId = new Map(produtos.map((p) => [p.id, p]));
      const r = verificarCarrinho({ linhas, produtos });
      return {
        vende,
        entrega: lojaParaConsola(loja),
        ok: r.ok,
        erro: r.ok ? null : r.erro,
        itemsCents: r.ok ? r.itemsCents : null,
        envio: r.ok && loja.envio.ativo ? custoDeEnvio(loja, "SHIPPING", r.itemsCents) : null,
        linhas: linhas.map((l) => {
          const p = porId.get(l.productId);
          const tamanhoValido = !p || p.tamanhos.length === 0 ? l.tamanho === "" : p.tamanhos.includes(l.tamanho);
          return {
            productId: l.productId,
            tamanho: l.tamanho,
            quantidade: l.quantidade,
            nome: p?.nome ?? null,
            precoCents: p?.precoCents ?? null,
            imageUrl: p?.imageUrl ?? null,
            /** O que há deste tamanho (nulo = sem contagem). Zero ou um produto que saiu: tirar do carrinho. */
            disponivel: p && p.visivel && tamanhoValido ? p.disponivel[l.tamanho] ?? 0 : 0,
            aVenda: !!p && p.visivel && tamanhoValido,
          };
        }),
      };
    });
  }

  /* ------------------------------------------------------------------------ */
  /* Encomendar                                                                 */
  /* ------------------------------------------------------------------------ */

  /** `POST /api/clubes/:slug/loja/encomendas`: encomendar no site. */
  async encomendar(slug: string, dto: EncomendarDto, ip?: string) {
    if (dto.notaExtra?.trim()) {
      this.log.warn(`Encomenda deitada fora (campo-armadilha) de ${ip ?? "?"}`);
      throw new BadRequestException("Não foi possível guardar a encomenda. Recarrega a página e tenta outra vez.");
    }
    if (dto.metodo === "MBWAY" && !dto.telefone?.trim()) throw new BadRequestException("Para pagar por MB WAY, escreve o número de telemóvel.");
    const academyId = await this.clube(slug);
    const recusa = this.ficha.verificar(dto.ficha, Date.now(), academyId);
    if (recusa) throw new BadRequestException(recusa);
    await this.turnstile.exigir(dto.turnstile, `loja-${slug}`, ip);

    const morada = dto.entrega === "SHIPPING" ? moradaValida(dto.morada) : null;
    if (dto.entrega === "SHIPPING" && !morada) throw new BadRequestException("Para o envio, escreve a morada completa: rua, código postal e localidade.");

    const encomenda = await this.criarEncomenda(academyId, {
      linhas: this.linhasDe(dto),
      nome: dto.nome.trim(),
      email: dto.email.trim().toLowerCase(),
      telefone: dto.telefone?.trim() || null,
      nif: dto.nif?.trim() || null,
      entrega: dto.entrega,
      morada,
      nota: dto.nota?.trim() || null,
      metodo: dto.metodo,
    });

    if (encomenda.totalCents === 0) {
      // Uma encomenda a 0 € (uma oferta): não há nada a pagar, confirma-se já.
      await this.prisma.runAs(academyId, async (db) => {
        const depois = await this.emissao.pagamentoConfirmado(db, academyId, encomenda.id, new Date(), 0);
        if (depois) void depois().catch((e: unknown) => this.log.error(`Email da encomenda a 0 € falhou: ${e}`));
      });
      return { token: encomenda.accessToken, numero: encomenda.number, estado: "paga" as const, totalCents: 0, reservadoAte: encomenda.reservedUntil.toISOString(), pagamento: null };
    }

    try {
      const pagamento = await this.billing.startShopPayment(academyId, encomenda.id, dto.metodo as PaymentMethod, dto.telefone?.trim() || undefined);
      return {
        token: encomenda.accessToken,
        numero: encomenda.number,
        estado: "a-pagar" as const,
        totalCents: pagamento.amountCents,
        reservadoAte: encomenda.reservedUntil.toISOString(),
        pagamento: { metodo: pagamento.method, entidade: pagamento.entity, referencia: pagamento.reference, valorCents: pagamento.amountCents },
      };
    } catch (e) {
      // Sem pagamento, a encomenda não pode ficar a segurar stock.
      await this.prisma.runAs(academyId, (db) => db.siteOrder.updateMany({ where: { id: encomenda.id, status: "RESERVED" }, data: { status: "EXPIRED" } })).catch(() => undefined);
      throw e;
    }
  }

  /**
   * Guarda os artigos. O único sítio que escreve uma encomenda, com a loja do
   * clube bloqueada do princípio ao fim (ver `bloquearLoja`).
   */
  private async criarEncomenda(
    academyId: string,
    p: { linhas: LinhaDoCarrinho[]; nome: string; email: string; telefone: string | null; nif: string | null; entrega: Entrega; morada: ReturnType<typeof moradaValida>; nota: string | null; metodo: "MBWAY" | "MULTIBANCO" },
  ) {
    return this.naFila(academyId, () =>
      this.prisma.runAs(academyId, async (db) => {
        const agora = new Date();
        await bloquearLoja(db, academyId);
        await this.expirarEncomendas(db, agora);

        const { loja, vende } = await this.lojaDoClube(db, academyId);
        if (!vende) throw new BadRequestException("A loja deste clube ainda não vende online. Encomenda pelos contactos do clube.");
        const semEntrega = entregaPossivel(loja, p.entrega);
        if (semEntrega) throw new BadRequestException(semEntrega);

        /*
         * Por pessoa: o email como caixa de correio (sem `+etiquetas`) e o
         * telemóvel pelos últimos nove algarismos. Contam as encomendas à espera.
         */
        const vivas = { status: "RESERVED" as const, reservedUntil: { gt: agora } };
        const caixa = caixaDoEmail(p.email);
        const telemovel = numeroDoTelefone(p.telefone);
        const guardadas = await db.siteOrder.findMany({ where: vivas, select: { buyerEmail: true, buyerPhone: true } });
        const doEmail = guardadas.filter((o) => caixaDoEmail(o.buyerEmail) === caixa).length;
        const doTelemovel = telemovel ? guardadas.filter((o) => o.buyerPhone === telemovel).length : 0;
        if (doEmail >= ESPERA_POR_EMAIL || doTelemovel >= ESPERA_POR_EMAIL) {
          throw new BadRequestException("Já tens encomendas à espera de pagamento. Paga-as, ou espera que expirem (10 minutos).");
        }
        if (guardadas.length >= GUARDADAS_POR_CLUBE) {
          throw new BadRequestException("Há muitas encomendas à espera de pagamento neste momento. Tenta outra vez daqui a alguns minutos.");
        }
        if (p.metodo === "MBWAY" && telemovel) {
          const naHora = await db.siteOrder.count({ where: { buyerPhone: telemovel, createdAt: { gt: new Date(agora.getTime() - 60 * 60_000) } } });
          if (naHora >= MBWAY_POR_TELEMOVEL_HORA) throw new BadRequestException("Já houve vários pedidos MB WAY para este número na última hora. Paga por Multibanco ou tenta mais tarde.");
        }

        const produtos = await produtosParaVenda(db, p.linhas.map((l) => l.productId), agora);
        const r = verificarCarrinho({ linhas: p.linhas, produtos });
        if (!r.ok) throw new BadRequestException(r.erro);

        const shippingCents = custoDeEnvio(loja, p.entrega, r.itemsCents);
        const totalCents = r.itemsCents + shippingCents;
        const maior = await db.siteOrder.aggregate({ _max: { number: true } });
        const gratis = totalCents === 0;

        const encomenda = await db.siteOrder.create({
          data: {
            academyId,
            number: proximoNumero(maior._max.number),
            status: "RESERVED",
            delivery: p.entrega,
            buyerName: p.nome,
            buyerEmail: p.email,
            // Normalizado: é por aqui que se contam as encomendas do mesmo telemóvel.
            buyerPhone: telemovel,
            // Só para a fatura: nulo sai como consumidor final (ver `FaturacaoService`).
            buyerTaxId: p.nif,
            address: p.morada ?? undefined,
            note: p.nota,
            itemsCents: r.itemsCents,
            shippingCents,
            totalCents,
            reservedUntil: new Date(agora.getTime() + (gratis ? 60 * 60_000 : RESERVA_MINUTOS * 60_000)),
            accessToken: this.emissao.novoAcesso(),
            items: {
              create: r.linhas.map((l) => ({
                academyId,
                productId: l.productId,
                variantId: l.variantId,
                productName: l.productName,
                size: l.size,
                quantity: l.quantity,
                unitPriceCents: l.unitPriceCents,
                imageUrl: l.imageUrl,
              })),
            },
          },
        });
        return encomenda;
      }),
    );
  }

  /** As encomendas guardadas cujo prazo passou: deixam de contar para o stock. */
  private async expirarEncomendas(db: ScopedClient, agora: Date) {
    await db.siteOrder.updateMany({ where: { status: "RESERVED", reservedUntil: { lte: agora } }, data: { status: "EXPIRED" } });
  }

  /* ------------------------------------------------------------------------ */
  /* A página da encomenda                                                      */
  /* ------------------------------------------------------------------------ */

  /**
   * `GET /api/clubes/:slug/loja/encomendas/:token`: o estado de uma encomenda.
   * O token é o que dá acesso (24 bytes aleatórios, no email e na página
   * depois de encomendar): quem o tem é quem encomendou.
   */
  async encomenda(slug: string, token: string) {
    const academyId = await this.auth.academyIdBySlug(slug.slice(0, 80));
    if (!academyId || !/^[A-Za-z0-9_-]{20,64}$/.test(token)) throw new NotFoundException();
    return this.prisma.runAs(academyId, async (db) => {
      const e = await db.siteOrder.findFirst({ where: { accessToken: token }, include: { items: { orderBy: { createdAt: "asc" } }, payments: { orderBy: { createdAt: "desc" }, take: 1 } } });
      if (!e) throw new NotFoundException();
      const { loja } = await this.lojaDoClube(db, academyId);
      return this.formaDaEncomenda(e, loja);
    });
  }

  private estadoPublico(e: { status: string; reservedUntil: Date }, agora: Date) {
    switch (e.status) {
      case "PAID":
        return "paga" as const;
      case "READY":
        return "pronta" as const;
      case "SHIPPED":
        return "enviada" as const;
      case "DELIVERED":
        return "entregue" as const;
      case "LATE_PAYMENT":
        return "fora-do-prazo" as const;
      case "CANCELLED":
        return "anulada" as const;
      default:
        return e.status === "EXPIRED" || e.reservedUntil <= agora ? ("expirada" as const) : ("a-pagar" as const);
    }
  }

  private formaDaEncomenda(e: Prisma.SiteOrderGetPayload<{ include: { items: true; payments: true } }>, loja: Loja) {
    const agora = new Date();
    const estado = this.estadoPublico(e, agora);
    const pag = e.payments[0];
    const morada = moradaValida(e.address);
    return {
      numero: e.number,
      estado,
      comprador: e.buyerName,
      email: e.buyerEmail,
      reservadoAte: e.reservedUntil.toISOString(),
      itemsCents: e.itemsCents,
      envioCents: e.shippingCents,
      totalCents: pag?.amountCents ?? e.totalCents,
      pagamento: estado === "a-pagar" && pag ? { metodo: pag.method, entidade: pag.entity, referencia: pag.reference, valorCents: pag.amountCents, estado: pag.status } : null,
      reembolso: e.refundDueCents ? { valorCents: e.refundDueCents, feito: !!e.refundedAt } : null,
      entrega:
        e.delivery === "SHIPPING"
          ? { tipo: "SHIPPING" as const, morada: LojaEmissao.moradaEmLinhas(morada), nota: loja.envio.nota, rastreio: e.trackingCode }
          : { tipo: "PICKUP" as const, local: loja.levantamento.local, nota: loja.levantamento.nota },
      nota: e.note,
      linhas: e.items.map((i) => ({ nome: i.productName, tamanho: i.size, quantidade: i.quantity, unitPriceCents: i.unitPriceCents, imageUrl: i.imageUrl })),
      datas: { paga: e.paidAt?.toISOString() ?? null, pronta: e.readyAt?.toISOString() ?? null, enviada: e.shippedAt?.toISOString() ?? null, entregue: e.deliveredAt?.toISOString() ?? null },
    };
  }

  /* ------------------------------------------------------------------------ */
  /* A consola                                                                  */
  /* ------------------------------------------------------------------------ */

  private async noPlano(academyId: string) {
    const ok = await this.prisma.runAs(academyId, (db) => siteIncluido(db, academyId));
    if (!ok) throw new ForbiddenException({ code: "SITE_NOT_IN_PLAN", message: SEM_PLANO });
  }

  private async lerSite(ctx: RequestContext) {
    if (!can(ctx, "website:read")) throw new ForbiddenException("Sem acesso ao site do clube");
    await this.noPlano(ctx.academyId);
  }

  private async escreverSite(ctx: RequestContext) {
    if (!can(ctx, "website:write")) throw new ForbiddenException("Sem permissão para mexer na loja");
    await this.noPlano(ctx.academyId);
  }

  /** As encomendas do clube, das mais recentes para as mais antigas. As que caducaram sem pagamento não vêm. */
  async listar(ctx: RequestContext) {
    await this.lerSite(ctx);
    return this.prisma.runAs(ctx.academyId, async (db) => {
      const lista = await db.siteOrder.findMany({
        where: { status: { not: "EXPIRED" } },
        include: { items: { orderBy: { createdAt: "asc" } }, payments: { where: { status: "PAID" }, select: { amountCents: true, method: true } } },
        orderBy: { createdAt: "desc" },
        take: LISTA_MAX,
      });
      const agora = new Date();
      return lista
        .filter((e) => !(e.status === "RESERVED" && e.reservedUntil <= agora))
        .map((e) => ({
          id: e.id,
          numero: e.number,
          estado: e.status,
          entrega: e.delivery,
          morada: LojaEmissao.moradaEmLinhas(moradaValida(e.address)),
          comprador: { nome: e.buyerName, email: e.buyerEmail, telefone: e.buyerPhone },
          nota: e.note,
          linhas: e.items.map((i) => ({ nome: i.productName, tamanho: i.size, quantidade: i.quantity, unitPriceCents: i.unitPriceCents, imageUrl: i.imageUrl, productId: i.productId })),
          itemsCents: e.itemsCents,
          envioCents: e.shippingCents,
          totalCents: e.totalCents,
          pagoCents: e.payments.reduce((n, x) => n + x.amountCents, 0),
          rastreio: e.trackingCode,
          criadaEm: e.createdAt.toISOString(),
          pagaEm: e.paidAt?.toISOString() ?? null,
          prontaEm: e.readyAt?.toISOString() ?? null,
          enviadaEm: e.shippedAt?.toISOString() ?? null,
          entregueEm: e.deliveredAt?.toISOString() ?? null,
          anuladaEm: e.cancelledAt?.toISOString() ?? null,
          motivo: e.cancelReason,
          reembolso: e.refundDueCents ? { valorCents: e.refundDueCents, feitoEm: e.refundedAt?.toISOString() ?? null, nota: e.refundNote } : null,
        }));
    });
  }

  private async encomendaDoClube(db: ScopedClient, id: string) {
    const e = await db.siteOrder.findFirst({ where: { id }, include: { items: true, payments: { where: { status: "PAID" } } } });
    if (!e) throw new NotFoundException("Encomenda não encontrada");
    return e;
  }

  /** Levantamento: pronta para levantar. Avisa quem comprou. */
  async pronta(ctx: RequestContext, id: string) {
    await this.escreverSite(ctx);
    await this.prisma.runAs(ctx.academyId, async (db) => {
      const e = await this.encomendaDoClube(db, id);
      if (e.delivery !== "PICKUP") throw new BadRequestException("Esta encomenda é para enviar, não para levantar");
      if (e.status !== "PAID") throw new BadRequestException("Só uma encomenda paga passa a pronta");
      await db.siteOrder.update({ where: { id }, data: { status: "READY", readyAt: new Date() } });
    });
    await this.emissao.enviarPronta(ctx.academyId, id).catch((e: unknown) => this.log.warn(`Email «pronta» falhou: ${e}`));
    return { ok: true as const };
  }

  /** Envio: seguiu pelo correio, com o código de seguimento se houver. Avisa quem comprou. */
  async enviada(ctx: RequestContext, id: string, rastreio?: string) {
    await this.escreverSite(ctx);
    await this.prisma.runAs(ctx.academyId, async (db) => {
      const e = await this.encomendaDoClube(db, id);
      if (e.delivery !== "SHIPPING") throw new BadRequestException("Esta encomenda é para levantar, não para enviar");
      if (e.status !== "PAID") throw new BadRequestException("Só uma encomenda paga passa a enviada");
      await db.siteOrder.update({ where: { id }, data: { status: "SHIPPED", shippedAt: new Date(), trackingCode: rastreio?.trim() || null } });
    });
    await this.emissao.enviarEnviada(ctx.academyId, id).catch((e: unknown) => this.log.warn(`Email «enviada» falhou: ${e}`));
    return { ok: true as const };
  }

  /** Levantada ou recebida: acabou. */
  async entregue(ctx: RequestContext, id: string) {
    await this.escreverSite(ctx);
    await this.prisma.runAs(ctx.academyId, async (db) => {
      const e = await this.encomendaDoClube(db, id);
      if (e.status !== "PAID" && e.status !== "READY" && e.status !== "SHIPPED") throw new BadRequestException("Só uma encomenda paga se dá por entregue");
      await db.siteOrder.update({ where: { id }, data: { status: "DELIVERED", deliveredAt: new Date() } });
    });
    return { ok: true as const };
  }

  /**
   * Anular: os artigos voltam ao stock (se já tinha descido) e, se estava
   * paga, fica o reembolso por fazer e quem comprou recebe o motivo.
   */
  async anular(ctx: RequestContext, id: string, motivo: string) {
    await this.escreverSite(ctx);
    const avisar = await this.prisma.runAs(ctx.academyId, async (db) => {
      await bloquearLoja(db, ctx.academyId);
      const e = await this.encomendaDoClube(db, id);
      if (e.status === "CANCELLED" || e.status === "EXPIRED" || e.status === "DELIVERED") {
        throw new BadRequestException(e.status === "DELIVERED" ? "Uma encomenda entregue não se anula" : "Esta encomenda já não está ativa");
      }
      const paga = e.status === "PAID" || e.status === "READY" || e.status === "SHIPPED";
      const pago = e.payments.reduce((n, x) => n + x.amountCents, 0);
      if (paga) await this.emissao.reporStock(db, ctx.academyId, e);
      await db.siteOrder.update({
        where: { id },
        data: {
          status: "CANCELLED",
          cancelledAt: new Date(),
          cancelReason: motivo.trim(),
          refundDueCents: paga || e.status === "LATE_PAYMENT" ? Math.max(pago, e.refundDueCents ?? 0) || null : e.refundDueCents,
        },
      });
      return paga;
    });
    if (avisar) await this.emissao.enviarAnulada(ctx.academyId, id, motivo.trim()).catch(() => undefined);
    return { ok: true as const };
  }

  /** O clube devolveu o dinheiro por fora: fica marcado, com uma nota. */
  async marcarReembolsado(ctx: RequestContext, id: string, nota?: string) {
    await this.escreverSite(ctx);
    return this.prisma.runAs(ctx.academyId, async (db) => {
      const e = await db.siteOrder.findFirst({ where: { id } });
      if (!e) throw new NotFoundException("Encomenda não encontrada");
      if (!e.refundDueCents) throw new BadRequestException("Esta encomenda não tem reembolso por fazer");
      if (e.refundedAt) throw new BadRequestException("Este reembolso já está marcado como feito");
      const quem = await db.user.findFirst({ where: { id: ctx.userId }, select: { name: true } });
      await db.siteOrder.update({
        where: { id },
        data: { refundedAt: new Date(), refundNote: [nota?.trim(), quem?.name ? `Marcado por ${quem.name}.` : null].filter(Boolean).join(" ") || null },
      });
      return { ok: true as const };
    });
  }

  async reenviar(ctx: RequestContext, id: string) {
    await this.escreverSite(ctx);
    const paga = await this.prisma.runAs(ctx.academyId, (db) => db.siteOrder.findFirst({ where: { id, status: { in: ["PAID", "READY", "SHIPPED", "DELIVERED"] } }, select: { id: true } }));
    if (!paga) throw new BadRequestException("Só se reenvia a confirmação de encomendas pagas");
    await this.emissao.enviarConfirmacao(ctx.academyId, id);
    return { ok: true as const };
  }
}

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma, PaymentMethod } from "@prisma/client";
import { PrismaService, type ScopedClient } from "../prisma/prisma.service";
import { AuthService } from "../auth/auth.service";
import { BillingService } from "../billing/billing.service";
import { ClubAppService } from "../club-app/club-app.service";
import { can, type RequestContext } from "../common/permissions";
import { FichaDoSite, caixaDoEmail, numeroDoTelefone } from "../platform/ficha-do-site";
import { siteIncluido, SEM_PLANO } from "../site/plano";
import { recintosValidos } from "../site/site.tipos";
import { bloquearJogo, contextoDoJogo, quotaDoSocioCobre, type ContextoDoJogo } from "./contexto";
import { BilheteiraEmissao } from "./emissao.service";
import { RESERVA_MINUTOS, mesmaData, tiposPara, verificarPedido, type Comprador, type LinhaDoPedido } from "./regras";
import type { IdentificarSocioDto, LugarAnualDto, ReservarDto, ReservarNaAppDto } from "./bilheteira.dto";

/**
 * A bilheteira: vender, mostrar os bilhetes, e o que a consola faz às vendas.
 *
 * ## Por onde se compra
 *
 *   - **Site** (`/api/clubes/:slug/bilhetes/...`, do browser de quem compra):
 *     o público, ou um sócio identificado por número e data de nascimento.
 *   - **App** (`/api/socio/bilhetes/...`, com a conta): o sócio, já identificado.
 *
 * As duas acabam em `criarCompra`, que é o único sítio onde se guardam
 * lugares, e o pagamento entra pelo webhook da euPago do clube
 * (`BilheteiraEmissao`).
 *
 * ## O que protege a venda
 *
 *   - lotação contada e escrita com o jogo bloqueado (`bloquearJogo`);
 *   - preço de sócio só com a quota a cobrir o dia do jogo, verificado outra
 *     vez no momento de guardar (a credencial do site não basta);
 *   - a identificação do sócio limitada por número e por clube, com a mesma
 *     resposta quer o número exista quer não;
 *   - no site, a ficha assinada e o campo-armadilha do formulário de
 *     contactos, e no máximo duas compras à espera por email e jogo (uma
 *     compra guarda lugares 10 minutos, e um robô não pode guardar o estádio).
 */

const CREDENCIAL_MINUTOS = 30;
/** Tentativas falhadas de identificação: por número de sócio, e por clube. */
const FALHAS_POR_NUMERO = 5;
/** Quanto tempo vale a ficha da compra (o formulário do site): o bastante para escolher e pagar. */
const FICHA_MINUTOS = 30;
/** Pedidos MB WAY para o mesmo telemóvel, por hora, em todos os jogos do clube. */
const MBWAY_POR_TELEMOVEL_HORA = 4;
const JANELA_MS = 15 * 60_000;
/** Compras à espera de pagamento, por email (e por telemóvel) e jogo. */
const ESPERA_POR_EMAIL = 2;
/**
 * Quanto de um jogo pode estar guardado sem pagar ao mesmo tempo: 20 % da
 * lotação, com um mínimo de 40 lugares (e 200 quando o jogo não tem lotação
 * escrita). Uma compra guarda lugares 10 minutos sem pagar nada; sem tecto,
 * um robô com emails inventados segurava o estádio inteiro.
 */
const GUARDADOS_FRACAO = 0.2;
const GUARDADOS_MINIMO = 40;
const GUARDADOS_SEM_LOTACAO = 200;
/** Compras do mesmo jogo à espera de vez, na memória. Acima disto, recusa-se logo. */
const FILA_POR_JOGO = 60;

@Injectable()
export class BilheteiraService {
  private readonly log = new Logger(BilheteiraService.name);
  private readonly ficha: FichaDoSite;
  /** As falhas de identificação, na memória da API (uma instância só, como a fila dos formulários). */
  private readonly falhas = new Map<string, number[]>();
  /**
   * Uma fila por jogo, na memória da API.
   *
   * As compras do mesmo jogo esperam aqui, uma de cada vez, **antes** de abrir
   * a transação. Esperar pelo bloqueio na base segurava uma ligação por
   * compra à espera, e num dia de jogo isso esgotava as ligações da API
   * inteira (já aconteceu com o formulário do site, ver
   * `academia-formulario-do-site`). O bloqueio na base continua lá, como rede
   * de segurança, mas quase nunca tem por quem esperar.
   */
  private readonly filas = new Map<string, { cauda: Promise<unknown>; aEspera: number }>();

  private async naFila<T>(matchId: string, fn: () => Promise<T>): Promise<T> {
    const f = this.filas.get(matchId) ?? { cauda: Promise.resolve(), aEspera: 0 };
    if (f.aEspera >= FILA_POR_JOGO) throw new BadRequestException("Há muita gente a comprar bilhetes para este jogo. Tenta outra vez daqui a um minuto.");
    f.aEspera++;
    this.filas.set(matchId, f);
    const vez = f.cauda.then(fn, fn);
    f.cauda = vez.catch(() => undefined);
    try {
      return await vez;
    } finally {
      f.aEspera--;
      if (f.aEspera === 0) this.filas.delete(matchId);
    }
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly billing: BillingService,
    private readonly emissao: BilheteiraEmissao,
    private readonly app: ClubAppService,
    private readonly config: ConfigService,
  ) {
    const segredo = this.config.get<string>("SITE_FORM_SECRET") || this.config.get<string>("SUPABASE_JWT_SECRET") || "";
    // Um fim próprio: uma ficha do formulário de contactos não serve para comprar bilhetes.
    this.ficha = new FichaDoSite(segredo || randomBytes(32).toString("hex"), "bilheteira", FICHA_MINUTOS * 60_000);
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

  /**
   * A ficha que a página de compra pede ao abrir. Presa ao clube e com 30
   * minutos: juntar fichas de antemão para as gastar todas de uma vez num
   * jogo (e segurar lugares) deixa de render.
   */
  async fichaDaCompra(slug: string) {
    const academyId = await this.clube(slug);
    return { ficha: this.ficha.emitir(Date.now(), academyId) };
  }

  /* ------------------------------------------------------------------------ */
  /* A venda de um jogo, para quem vai comprar                                  */
  /* ------------------------------------------------------------------------ */

  private async tiersDoClube(db: ScopedClient): Promise<Map<string, string>> {
    const tiers = await db.memberTier.findMany({ select: { id: true, name: true } });
    return new Map(tiers.map((t) => [t.id, t.name]));
  }

  /** A forma pública da venda: o que o site e a app desenham. Sem dados de ninguém. */
  private formaDaVenda(ctx: ContextoDoJogo, nomes: Map<string, string>, tiposVisiveis = ctx.tipos) {
    const nomeDaBancada = (id: string | null) => ctx.recinto?.bancadas.find((b) => b.id === id)?.nome ?? null;
    return {
      jogo: { id: ctx.jogo.id, startsAt: ctx.jogo.startsAt.toISOString(), opponent: ctx.jogo.opponent, teamName: ctx.jogo.teamName, status: ctx.jogo.status },
      estado: {
        socios: ctx.estado.socios,
        publico: ctx.estado.publico,
        fechada: ctx.estado.fechada,
        abreSociosEm: ctx.estado.abreSociosEm?.toISOString() ?? null,
        abrePublicoEm: ctx.estado.abrePublicoEm?.toISOString() ?? null,
        soSocios: ctx.venda.membersOnly,
      },
      nota: ctx.venda.note || null,
      recinto: ctx.recinto ? { id: ctx.recinto.id, nome: ctx.recinto.nome, tipo: ctx.recinto.tipo, bancadas: ctx.recinto.bancadas } : null,
      tipos: tiposVisiveis.map((t) => ({
        id: t.id,
        nome: t.nome,
        preco: t.precoCents / 100,
        bancadaId: t.bancadaId,
        bancada: nomeDaBancada(t.bancadaId),
        para: t.para,
        tierId: t.tierId,
        tierNome: t.tierId ? (nomes.get(t.tierId) ?? null) : null,
      })),
      livres: ctx.livres,
      livresNoJogo: ctx.livresNoJogo,
      reservaMinutos: RESERVA_MINUTOS,
    };
  }

  /** `GET /api/clubes/:slug/bilhetes/:matchId`: a venda, sem cache, para o momento de comprar. */
  async venda(slug: string, matchId: string) {
    const academyId = await this.clube(slug);
    return this.prisma.runAs(academyId, async (db) => {
      const ctx = await contextoDoJogo(db, academyId, matchId);
      if (!ctx || !ctx.venda.open) throw new NotFoundException("Este jogo não tem bilhetes à venda.");
      return this.formaDaVenda(ctx, await this.tiersDoClube(db));
    });
  }

  /* ------------------------------------------------------------------------ */
  /* O sócio no site: número e data de nascimento                               */
  /* ------------------------------------------------------------------------ */

  private contarFalha(chave: string, agora: number) {
    const lista = (this.falhas.get(chave) ?? []).filter((t) => t > agora - JANELA_MS);
    lista.push(agora);
    this.falhas.set(chave, lista);
    if (this.falhas.size > 20_000) this.falhas.clear();
  }

  private bloqueado(chave: string, limite: number, janela: number, agora: number): boolean {
    return (this.falhas.get(chave) ?? []).filter((t) => t > agora - janela).length >= limite;
  }

  private assinarCredencial(memberId: string, matchId: string, ate: number): string {
    const corpo = `${memberId}.${matchId}.${ate}`;
    const sig = createHmac("sha256", this.emissao.segredo()).update(`credencial-socio:${corpo}`).digest("base64url");
    return `${corpo}.${sig}`;
  }

  private lerCredencial(credencial: string, matchId: string): string | null {
    const partes = credencial.split(".");
    if (partes.length !== 4) return null;
    const [memberId, deJogo, ate, sig] = partes;
    const certa = Buffer.from(createHmac("sha256", this.emissao.segredo()).update(`credencial-socio:${memberId}.${deJogo}.${ate}`).digest("base64url"));
    const dada = Buffer.from(sig);
    if (certa.length !== dada.length || !timingSafeEqual(certa, dada)) return null;
    if (deJogo !== matchId || !(Number(ate) > Date.now())) return null;
    return memberId;
  }

  /**
   * Identifica um sócio pelo número e pela data de nascimento, para o preço
   * de sócio deste jogo.
   *
   * A resposta a um número que não existe e a uma data errada é a mesma, e
   * nunca devolve dados do sócio (nem o nome). Cada tentativa gasta uma ficha
   * (3 segundos, uma vez, presa ao clube), e cinco falhas no mesmo número
   * bloqueiam-no 15 minutos. Não há bloqueio do clube inteiro: com ele,
   * sessenta palpites errados deixavam todos os sócios sem preço de sócio
   * durante uma hora. Quem acerta nos dois e tem a quota em atraso sabe-o:
   * já provou quem é.
   */
  async identificarSocio(slug: string, matchId: string, dto: IdentificarSocioDto) {
    const academyId = await this.clube(slug);
    const recusa = this.ficha.verificar(dto.ficha, Date.now(), academyId);
    if (recusa) throw new BadRequestException(recusa);
    const agora = Date.now();
    const porNumero = `${academyId}:${dto.numero}`;
    const GENERICO = "Não encontrámos um sócio com esse número e essa data de nascimento.";

    if (this.bloqueado(porNumero, FALHAS_POR_NUMERO, JANELA_MS, agora)) {
      throw new BadRequestException("Demasiadas tentativas com este número. Tenta daqui a 15 minutos, ou compra na app do clube.");
    }

    const r = await this.prisma.runAs(academyId, async (db) => {
      const ctx = await contextoDoJogo(db, academyId, matchId);
      if (!ctx || !ctx.venda.open) throw new NotFoundException("Este jogo não tem bilhetes à venda.");
      const socio = await db.member.findFirst({
        where: { number: dto.numero },
        select: { id: true, birthdate: true, status: true, tierId: true },
      });
      if (!socio || !mesmaData(socio.birthdate, dto.nascimento)) return { falhou: true as const };
      const emDia = socio.status === "ACTIVE" && (await quotaDoSocioCobre(db, academyId, socio.id, ctx.jogo.startsAt));
      if (!emDia) return { falhou: false as const, emDia: false as const };
      const comprador: Comprador = { kind: "socio", memberId: socio.id, tierId: socio.tierId, jaTemBilheteDeSocio: await this.jaTemBilheteDeSocio(db, ctx, socio.id) };
      return { falhou: false as const, emDia: true as const, memberId: socio.id, venda: this.formaDaVenda(ctx, await this.tiersDoClube(db), tiposPara(ctx.tipos, comprador)), jaTem: comprador.jaTemBilheteDeSocio };
    });

    if (r.falhou) {
      this.contarFalha(porNumero, agora);
      throw new BadRequestException(GENERICO);
    }
    if (!r.emDia) {
      throw new BadRequestException("As tuas quotas não cobrem o mês deste jogo, por isso não há preço de sócio. Podes comprar ao preço do público, ou pôr as quotas em dia na app.");
    }
    return {
      credencial: this.assinarCredencial(r.memberId, matchId, agora + CREDENCIAL_MINUTOS * 60_000),
      venda: r.venda,
      jaTemBilheteDeSocio: r.jaTem,
    };
  }

  /**
   * Este sócio já tem a entrada de sócio neste jogo? Um bilhete de sócio pago
   * ou guardado, ou o lugar anual da época no recinto do jogo (que já é a
   * entrada dele: comprar outro a preço de sócio eram duas).
   */
  private async jaTemBilheteDeSocio(db: ScopedClient, ctx: ContextoDoJogo, memberId: string): Promise<boolean> {
    const n = await db.matchTicket.count({
      where: {
        matchId: ctx.jogo.id,
        memberId,
        status: { not: "VOID" },
        order: { OR: [{ status: "PAID" }, { status: "RESERVED", reservedUntil: { gt: new Date() } }] },
      },
    });
    if (n > 0) return true;
    if (!ctx.jogo.seasonId || !ctx.venda.venueId) return false;
    return (await db.seasonSeat.count({ where: { memberId, seasonId: ctx.jogo.seasonId, venueId: ctx.venda.venueId } })) > 0;
  }

  /* ------------------------------------------------------------------------ */
  /* Comprar                                                                    */
  /* ------------------------------------------------------------------------ */

  /** `POST /api/clubes/:slug/bilhetes/:matchId`: comprar no site. */
  async reservarNoSite(slug: string, matchId: string, dto: ReservarDto, ip?: string) {
    if (dto.notaExtra?.trim()) {
      this.log.warn(`Compra de bilhetes deitada fora (campo-armadilha) de ${ip ?? "?"}`);
      throw new BadRequestException("Não foi possível guardar a compra. Recarrega a página e tenta outra vez.");
    }
    if (dto.metodo === "MBWAY" && !dto.telefone?.trim()) throw new BadRequestException("Para pagar por MB WAY, escreve o número de telemóvel.");
    const academyId = await this.clube(slug);
    const recusa = this.ficha.verificar(dto.ficha, Date.now(), academyId);
    if (recusa) throw new BadRequestException(recusa);
    let memberId: string | null = null;
    if (dto.credencial) {
      memberId = this.lerCredencial(dto.credencial, matchId);
      if (!memberId) throw new BadRequestException("A identificação de sócio expirou. Identifica-te outra vez.");
    }
    return this.comprarEPagar(academyId, matchId, {
      memberId,
      exigirQuota: true,
      linhas: dto.linhas,
      nome: dto.nome.trim(),
      email: dto.email.trim().toLowerCase(),
      telefone: dto.telefone?.trim() || null,
      canal: "SITE",
      metodo: dto.metodo,
    });
  }

  /** `POST /api/socio/bilhetes/:matchId`: comprar na app, como sócio. */
  async reservarNaApp(authorization: string | undefined, slug: string, matchId: string, dto: ReservarNaAppDto) {
    const eu = await this.app.socioParaBilhetes(authorization, slug);
    if (!(await this.prisma.runAs(eu.academyId, (db) => siteIncluido(db, eu.academyId)))) throw new NotFoundException();
    if (dto.metodo === "MBWAY" && !(dto.telefone?.trim() || eu.telefone)) throw new BadRequestException("Para pagar por MB WAY, escreve o número de telemóvel.");
    if (!eu.email) throw new BadRequestException("A tua ficha de sócio não tem email para onde mandar os bilhetes. Fala com o clube.");
    return this.comprarEPagar(eu.academyId, matchId, {
      memberId: eu.memberId,
      // Na app, quem tem a quota em atraso compra como público geral (não leva preço de sócio).
      exigirQuota: false,
      linhas: dto.linhas,
      nome: eu.nome,
      email: eu.email.toLowerCase(),
      telefone: dto.telefone?.trim() || eu.telefone || null,
      canal: "APP",
      metodo: dto.metodo,
    });
  }

  private async comprarEPagar(
    academyId: string,
    matchId: string,
    p: {
      memberId: string | null;
      exigirQuota: boolean;
      linhas: LinhaDoPedido[];
      nome: string;
      email: string;
      telefone: string | null;
      canal: "SITE" | "APP";
      metodo: "MBWAY" | "MULTIBANCO";
    },
  ) {
    const compra = await this.criarCompra(academyId, matchId, p);

    if (compra.totalCents === 0) {
      // Bilhetes a 0 € (um jogo de entrada livre para sócios): não há nada a pagar.
      await this.emissao.enviarBilhetes(academyId, compra.id).catch((e: unknown) => this.log.error(`Email de bilhetes a 0 € falhou: ${e}`));
      return { token: compra.accessToken, estado: "pago" as const, totalCents: 0, reservadoAte: compra.reservedUntil.toISOString(), pagamento: null };
    }

    try {
      const pagamento = await this.billing.startTicketPayment(academyId, compra.id, p.metodo as PaymentMethod, p.telefone ?? undefined);
      return {
        token: compra.accessToken,
        estado: "a-pagar" as const,
        totalCents: pagamento.amountCents,
        reservadoAte: compra.reservedUntil.toISOString(),
        pagamento: {
          metodo: pagamento.method,
          entidade: pagamento.entity,
          referencia: pagamento.reference,
          valorCents: pagamento.amountCents,
        },
      };
    } catch (e) {
      // Sem pagamento, a compra não pode ficar a segurar lugares.
      await this.prisma
        .runAs(academyId, async (db) => {
          await db.ticketOrder.updateMany({ where: { id: compra.id, status: "RESERVED" }, data: { status: "EXPIRED" } });
          await db.matchTicket.updateMany({ where: { orderId: compra.id }, data: { status: "VOID" } });
        })
        .catch(() => undefined);
      throw e;
    }
  }

  /**
   * Guarda os lugares. O único sítio que escreve uma compra, com o jogo
   * bloqueado do princípio ao fim (ver `bloquearJogo`).
   */
  private async criarCompra(
    academyId: string,
    matchId: string,
    p: { memberId: string | null; exigirQuota: boolean; linhas: LinhaDoPedido[]; nome: string; email: string; telefone: string | null; canal: "SITE" | "APP"; metodo: "MBWAY" | "MULTIBANCO" },
  ) {
    return this.naFila(matchId, () => this.prisma.runAs(academyId, async (db) => {
      const agora = new Date();
      await bloquearJogo(db, matchId);
      await this.expirarCompras(db, matchId, agora);

      const ctx = await contextoDoJogo(db, academyId, matchId, agora);
      if (!ctx) throw new NotFoundException("Este jogo não tem bilhetes à venda.");

      let quem: Comprador = { kind: "publico" };
      if (p.memberId) {
        const socio = await db.member.findFirst({ where: { id: p.memberId }, select: { id: true, tierId: true } });
        const emDia = !!socio && (await quotaDoSocioCobre(db, academyId, p.memberId, ctx.jogo.startsAt));
        if (emDia && socio) {
          quem = { kind: "socio", memberId: socio.id, tierId: socio.tierId, jaTemBilheteDeSocio: await this.jaTemBilheteDeSocio(db, ctx, socio.id) };
        } else if (p.exigirQuota) {
          throw new BadRequestException("As tuas quotas não cobrem o mês deste jogo, por isso não há preço de sócio.");
        }
      }

      /*
       * Por pessoa: o email como caixa de correio (sem `+etiquetas`) e o
       * telemóvel pelos últimos nove algarismos, para "9 1234 5678" e
       * "+351912345678" serem o mesmo número. Contam as compras à espera e as
       * gratuitas já emitidas (essas não esperam por pagamento nenhum).
       */
      const vivas = { matchId, status: "RESERVED" as const, reservedUntil: { gt: agora } };
      const caixa = caixaDoEmail(p.email);
      const telemovel = numeroDoTelefone(p.telefone);
      const dePessoas = await db.ticketOrder.findMany({
        where: { matchId, OR: [vivas, { status: "PAID", totalCents: 0 }] },
        select: { buyerEmail: true, buyerPhone: true },
      });
      const doEmail = dePessoas.filter((o) => caixaDoEmail(o.buyerEmail) === caixa).length;
      const doTelemovel = telemovel ? dePessoas.filter((o) => o.buyerPhone === telemovel).length : 0;
      if (doEmail >= ESPERA_POR_EMAIL || doTelemovel >= ESPERA_POR_EMAIL) {
        throw new BadRequestException("Já tens compras para este jogo à espera de pagamento ou já emitidas. Paga-as, ou espera que expirem (10 minutos).");
      }
      // Um pedido MB WAY é uma notificação no telemóvel de alguém: no máximo 4 por hora para o mesmo número.
      if (p.metodo === "MBWAY" && telemovel) {
        const naHora = await db.ticketOrder.count({ where: { buyerPhone: telemovel, createdAt: { gt: new Date(agora.getTime() - 60 * 60_000) } } });
        if (naHora >= MBWAY_POR_TELEMOVEL_HORA) throw new BadRequestException("Já houve vários pedidos MB WAY para este número na última hora. Paga por Multibanco ou tenta mais tarde.");
      }

      // O tecto dos lugares guardados sem pagar. Ver `GUARDADOS_FRACAO`.
      const lotacao = ctx.venda.capacity ?? (ctx.recinto?.bancadas.reduce((n, b) => n + (b.lotacao ?? 0), 0) || null);
      const tecto = lotacao ? Math.max(GUARDADOS_MINIMO, Math.floor(lotacao * GUARDADOS_FRACAO)) : GUARDADOS_SEM_LOTACAO;
      const guardados = await db.matchTicket.count({ where: { matchId, status: { not: "VOID" }, order: vivas } });
      const pedidos = p.linhas.reduce((n, l) => n + (l.quantidade > 0 ? l.quantidade : 0), 0);
      // Só no site: na app quem compra é um sócio com conta, que não é o robô de que isto protege.
      if (p.canal === "SITE" && guardados + pedidos > tecto) {
        throw new BadRequestException("Há muitos lugares à espera de pagamento neste momento. Tenta outra vez daqui a alguns minutos.");
      }

      const r = verificarPedido({ linhas: p.linhas, tipos: ctx.tipos, quem, venda: ctx.estado, livres: ctx.livres, livresNoJogo: ctx.livresNoJogo });
      if (!r.ok) throw new BadRequestException(r.erro);

      const gratis = r.totalCents === 0;
      const compra = await db.ticketOrder.create({
        data: {
          academyId,
          matchId,
          status: gratis ? "PAID" : "RESERVED",
          channel: p.canal,
          buyerName: p.nome,
          buyerEmail: p.email,
          // Normalizado: é por aqui que se contam as compras do mesmo telemóvel.
          buyerPhone: telemovel,
          memberId: quem.kind === "socio" ? quem.memberId : null,
          totalCents: r.totalCents,
          reservedUntil: new Date(agora.getTime() + RESERVA_MINUTOS * 60_000),
          paidAt: gratis ? agora : null,
          accessToken: this.emissao.novoAcesso(),
        },
      });
      await db.matchTicket.createMany({
        data: r.bilhetes.map((b) => ({
          academyId,
          orderId: compra.id,
          matchId,
          typeId: b.typeId,
          typeName: b.typeName,
          bancadaId: b.bancadaId,
          priceCents: b.priceCents,
          memberId: b.deSocio && quem.kind === "socio" ? quem.memberId : null,
        })),
      });
      return compra;
    }));
  }

  /** As compras guardadas cujo prazo passou: os bilhetes deixam de contar e de valer. */
  private async expirarCompras(db: ScopedClient, matchId: string, agora: Date) {
    const mortas = await db.ticketOrder.findMany({ where: { matchId, status: "RESERVED", reservedUntil: { lte: agora } }, select: { id: true } });
    if (mortas.length === 0) return;
    const ids = mortas.map((m) => m.id);
    await db.ticketOrder.updateMany({ where: { id: { in: ids } }, data: { status: "EXPIRED" } });
    await db.matchTicket.updateMany({ where: { orderId: { in: ids } }, data: { status: "VOID" } });
  }

  /* ------------------------------------------------------------------------ */
  /* A página dos bilhetes                                                      */
  /* ------------------------------------------------------------------------ */

  /**
   * `GET /api/clubes/:slug/bilhetes/pedido/:token`: o estado de uma compra, e
   * os bilhetes quando está paga. O token é o que dá acesso (24 bytes
   * aleatórios, no email e na página depois de comprar): quem o tem é quem
   * comprou.
   */
  async pedido(slug: string, token: string) {
    const academyId = await this.auth.academyIdBySlug(slug.slice(0, 80));
    if (!academyId || !/^[A-Za-z0-9_-]{20,64}$/.test(token)) throw new NotFoundException();
    return this.prisma.runAs(academyId, async (db) => {
      const pedido = await db.ticketOrder.findFirst({
        where: { accessToken: token },
        include: {
          tickets: { where: { status: { not: "VOID" } }, orderBy: { createdAt: "asc" } },
          payments: { orderBy: { createdAt: "desc" }, take: 1 },
        },
      });
      if (!pedido) throw new NotFoundException();
      return this.formaDoPedido(db, academyId, pedido);
    });
  }

  private async formaDoPedido(
    db: ScopedClient,
    academyId: string,
    pedido: Prisma.TicketOrderGetPayload<{ include: { tickets: true; payments: true } }>,
  ) {
    const [jogo, venda, config] = await Promise.all([
      db.match.findFirst({ where: { id: pedido.matchId }, select: { startsAt: true, opponent: true, venue: true, team: { select: { name: true } } } }),
      db.siteMatchTickets.findUnique({ where: { matchId: pedido.matchId }, select: { venueId: true } }),
      db.siteConfig.findUnique({ where: { academyId }, select: { venues: true } }),
    ]);
    const recinto = recintosValidos(config?.venues).find((r) => r.id === venda?.venueId);
    const porta = (bancadaId: string) => recinto?.portas.find((p) => p.bancadaIds.includes(bancadaId))?.nome ?? null;
    const agora = new Date();
    const estado =
      pedido.status === "PAID"
        ? "pago"
        : pedido.status === "LATE_PAYMENT"
          ? "fora-do-prazo"
          : pedido.status === "CANCELLED"
            ? "anulado"
            : pedido.status === "EXPIRED" || pedido.reservedUntil <= agora
              ? "expirado"
              : "a-pagar";
    const pag = pedido.payments[0];
    return {
      estado,
      comprador: pedido.buyerName,
      reservadoAte: pedido.reservedUntil.toISOString(),
      totalCents: pag?.amountCents ?? pedido.totalCents,
      pagamento:
        estado === "a-pagar" && pag
          ? { metodo: pag.method, entidade: pag.entity, referencia: pag.reference, valorCents: pag.amountCents, estado: pag.status }
          : null,
      reembolso: pedido.refundDueCents ? { valorCents: pedido.refundDueCents, feito: !!pedido.refundedAt } : null,
      jogo: jogo ? { startsAt: jogo.startsAt.toISOString(), opponent: jogo.opponent, teamName: jogo.team.name, local: recinto?.nome ?? jogo.venue } : null,
      bilhetes:
        estado === "pago"
          ? pedido.tickets.map((t) => ({
              id: t.id,
              tipo: t.typeName,
              bancada: recinto?.bancadas.find((b) => b.id === t.bancadaId)?.nome ?? null,
              porta: porta(t.bancadaId),
              usado: t.status === "USED",
              codigo: this.emissao.codigo("T", t.id),
            }))
          : [],
    };
  }

  /* ------------------------------------------------------------------------ */
  /* A app                                                                      */
  /* ------------------------------------------------------------------------ */

  /** A venda de um jogo como este sócio a vê: os preços dele, e se a quota cobre o jogo. */
  async vendaNaApp(authorization: string | undefined, slug: string, matchId: string) {
    const eu = await this.app.socioParaBilhetes(authorization, slug);
    return this.prisma.runAs(eu.academyId, async (db) => {
      if (!(await siteIncluido(db, eu.academyId))) throw new NotFoundException();
      const ctx = await contextoDoJogo(db, eu.academyId, matchId);
      if (!ctx || !ctx.venda.open) throw new NotFoundException("Este jogo não tem bilhetes à venda.");
      const socio = await db.member.findFirst({ where: { id: eu.memberId }, select: { tierId: true } });
      const quotaEmDia = await quotaDoSocioCobre(db, eu.academyId, eu.memberId, ctx.jogo.startsAt);
      const jaTem = await this.jaTemBilheteDeSocio(db, ctx, eu.memberId);
      const quem: Comprador = quotaEmDia ? { kind: "socio", memberId: eu.memberId, tierId: socio?.tierId ?? null, jaTemBilheteDeSocio: jaTem } : { kind: "publico" };
      return { ...this.formaDaVenda(ctx, await this.tiersDoClube(db), tiposPara(ctx.tipos, quem)), quotaEmDia, jaTemBilheteDeSocio: jaTem };
    });
  }

  /** Os bilhetes deste sócio para jogos que ainda não passaram (comprados na app ou no site como sócio). */
  async meusBilhetes(authorization: string | undefined, slug: string) {
    const eu = await this.app.socioParaBilhetes(authorization, slug);
    return this.prisma.runAs(eu.academyId, async (db) => {
      const ontem = new Date(Date.now() - 24 * 60 * 60_000);
      const pedidos = await db.ticketOrder.findMany({
        where: { memberId: eu.memberId, status: { in: ["PAID", "RESERVED", "LATE_PAYMENT", "CANCELLED"] }, createdAt: { gt: new Date(Date.now() - 180 * 86_400_000) } },
        include: { tickets: { where: { status: { not: "VOID" } }, orderBy: { createdAt: "asc" } }, payments: { orderBy: { createdAt: "desc" }, take: 1 } },
        orderBy: { createdAt: "desc" },
        take: 50,
      });
      const formas = await Promise.all(pedidos.map(async (p) => ({ token: p.accessToken, ...(await this.formaDoPedido(db, eu.academyId, p)) })));
      return formas.filter((f) => f.estado !== "expirado" && (!f.jogo || new Date(f.jogo.startsAt) > ontem));
    });
  }

  /**
   * O lugar anual deste sócio na época em curso, com o QR que entra no
   * estádio. Diz também se a quota cobre hoje: em atraso, o leitor recusa.
   */
  async meuLugarAnual(authorization: string | undefined, slug: string) {
    const eu = await this.app.socioParaBilhetes(authorization, slug);
    return this.prisma.runAs(eu.academyId, async (db) => {
      const hoje = new Date();
      const lugares = await db.seasonSeat.findMany({
        where: { memberId: eu.memberId, season: { startsOn: { lte: hoje }, endsOn: { gte: hoje } } },
        include: { season: { select: { label: true } } },
      });
      if (lugares.length === 0) return { lugares: [] };
      const config = await db.siteConfig.findUnique({ where: { academyId: eu.academyId }, select: { venues: true } });
      const recintos = recintosValidos(config?.venues);
      const quotaEmDia = await quotaDoSocioCobre(db, eu.academyId, eu.memberId, hoje);
      return {
        lugares: lugares.map((l) => {
          const r = recintos.find((x) => x.id === l.venueId);
          return {
            id: l.id,
            epoca: l.season.label,
            recinto: r?.nome ?? null,
            bancada: r?.bancadas.find((b) => b.id === l.bancadaId)?.nome ?? null,
            porta: r?.portas.find((p) => p.bancadaIds.includes(l.bancadaId))?.nome ?? null,
            lugar: l.seat,
            quotaEmDia,
            codigo: this.emissao.codigo("S", l.id),
          };
        }),
      };
    });
  }

  /* ------------------------------------------------------------------------ */
  /* A consola: vendas, anular, reembolsos                                      */
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
    if (!can(ctx, "website:write")) throw new ForbiddenException("Sem permissão para mexer na bilheteira");
    await this.noPlano(ctx.academyId);
  }

  /** As vendas de um jogo: por bancada e por tipo, as compras, os reembolsos e as entradas. */
  async vendas(ctx: RequestContext, matchId: string) {
    await this.lerSite(ctx);
    return this.prisma.runAs(ctx.academyId, async (db) => {
      const c = await contextoDoJogo(db, ctx.academyId, matchId);
      if (!c) throw new NotFoundException("Este jogo não tem bilheteira");
      const pedidos = await db.ticketOrder.findMany({
        where: { matchId, status: { not: "EXPIRED" } },
        include: { tickets: true, member: { select: { number: true } }, payments: { where: { status: "PAID" }, select: { amountCents: true, method: true } } },
        orderBy: { createdAt: "desc" },
        take: 2000,
      });
      const entradas = await db.ticketScan.groupBy({ by: ["gateId"], where: { matchId, result: "OK" }, _count: { _all: true } });
      const pagos = pedidos.filter((p) => p.status === "PAID");
      const porTipo = new Map<string, { nome: string; vendidos: number; receitaCents: number }>();
      for (const p of pagos) {
        for (const t of p.tickets) {
          if (t.status === "VOID") continue;
          const x = porTipo.get(t.typeId) ?? { nome: t.typeName, vendidos: 0, receitaCents: 0 };
          x.vendidos++;
          x.receitaCents += t.priceCents;
          porTipo.set(t.typeId, x);
        }
      }
      return {
        venda: this.formaDaVenda(c, await this.tiersDoClube(db)),
        anuais: c.anuais,
        ocupados: c.ocupados,
        porTipo: [...porTipo].map(([typeId, x]) => ({ typeId, ...x })),
        receitaCents: pagos.reduce((n, p) => n + p.payments.reduce((m, x) => m + x.amountCents, 0), 0),
        entradas: Object.fromEntries(entradas.map((e) => [e.gateId, e._count._all])),
        pedidos: pedidos.map((p) => ({
          id: p.id,
          estado: p.status,
          canal: p.channel,
          comprador: { nome: p.buyerName, email: p.buyerEmail, telefone: p.buyerPhone, socio: p.member?.number ?? null },
          bilhetes: p.tickets.filter((t) => t.status !== "VOID" || p.status !== "PAID").map((t) => ({ tipo: t.typeName, estado: t.status })),
          totalCents: p.totalCents,
          pagoCents: p.payments.reduce((n, x) => n + x.amountCents, 0),
          criadaEm: p.createdAt.toISOString(),
          pagaEm: p.paidAt?.toISOString() ?? null,
          reembolso: p.refundDueCents ? { valorCents: p.refundDueCents, feitoEm: p.refundedAt?.toISOString() ?? null, nota: p.refundNote } : null,
        })),
      };
    });
  }

  /** Anular uma compra: os bilhetes deixam de valer, e se estava paga fica o reembolso por fazer. */
  async anular(ctx: RequestContext, orderId: string, motivo: string) {
    await this.escreverSite(ctx);
    const enviar = await this.prisma.runAs(ctx.academyId, async (db) => this.anularNaBase(db, orderId));
    if (enviar) await this.emissao.enviarAnulados(ctx.academyId, orderId, motivo.trim()).catch(() => undefined);
    return { ok: true as const };
  }

  private async anularNaBase(db: ScopedClient, orderId: string): Promise<boolean> {
    const p = await db.ticketOrder.findFirst({ where: { id: orderId }, include: { payments: { where: { status: "PAID" } } } });
    if (!p) throw new NotFoundException("Compra não encontrada");
    if (p.status === "CANCELLED" || p.status === "EXPIRED") return false;
    const pago = p.payments.reduce((n, x) => n + x.amountCents, 0);
    await db.ticketOrder.update({
      where: { id: p.id },
      data: { status: "CANCELLED", cancelledAt: new Date(), refundDueCents: p.status === "PAID" || p.status === "LATE_PAYMENT" ? Math.max(pago, p.refundDueCents ?? 0) || null : p.refundDueCents },
    });
    await db.matchTicket.updateMany({ where: { orderId: p.id }, data: { status: "VOID" } });
    return p.status === "PAID";
  }

  /**
   * Jogo cancelado: fecha a venda, anula todas as compras e avisa quem
   * comprou. As pagas ficam com o reembolso por fazer.
   */
  async cancelarVendas(ctx: RequestContext, matchId: string, motivo: string) {
    await this.escreverSite(ctx);
    const avisar = await this.prisma.runAs(ctx.academyId, async (db) => {
      await bloquearJogo(db, matchId);
      await db.siteMatchTickets.updateMany({ where: { matchId }, data: { open: false } });
      const vivas = await db.ticketOrder.findMany({ where: { matchId, status: { in: ["PAID", "RESERVED"] } }, select: { id: true } });
      const pagas: string[] = [];
      for (const v of vivas) if (await this.anularNaBase(db, v.id)) pagas.push(v.id);
      return pagas;
    });
    for (const id of avisar) await this.emissao.enviarAnulados(ctx.academyId, id, motivo.trim()).catch(() => undefined);
    return { anuladas: avisar.length };
  }

  /** O clube devolveu o dinheiro por fora: fica marcado, com uma nota. */
  async marcarReembolsado(ctx: RequestContext, orderId: string, nota?: string) {
    await this.escreverSite(ctx);
    return this.prisma.runAs(ctx.academyId, async (db) => {
      const p = await db.ticketOrder.findFirst({ where: { id: orderId } });
      if (!p) throw new NotFoundException("Compra não encontrada");
      if (!p.refundDueCents) throw new BadRequestException("Esta compra não tem reembolso por fazer");
      if (p.refundedAt) throw new BadRequestException("Este reembolso já está marcado como feito");
      const quem = await db.user.findFirst({ where: { id: ctx.userId }, select: { name: true } });
      await db.ticketOrder.update({
        where: { id: p.id },
        data: { refundedAt: new Date(), refundNote: [nota?.trim(), quem?.name ? `Marcado por ${quem.name}.` : null].filter(Boolean).join(" ") || null },
      });
      return { ok: true as const };
    });
  }

  async reenviar(ctx: RequestContext, orderId: string) {
    await this.escreverSite(ctx);
    const pago = await this.prisma.runAs(ctx.academyId, (db) => db.ticketOrder.findFirst({ where: { id: orderId, status: "PAID" }, select: { id: true } }));
    if (!pago) throw new BadRequestException("Só se reenviam bilhetes de compras pagas");
    await this.emissao.enviarBilhetes(ctx.academyId, orderId);
    return { ok: true as const };
  }

  /* ------------------------------------------------------------------------ */
  /* Lugares anuais                                                             */
  /* ------------------------------------------------------------------------ */

  async lugaresAnuais(ctx: RequestContext, filtro: { seasonId?: string; memberId?: string }) {
    if (!can(ctx, "member:read")) throw new ForbiddenException("Sem acesso aos sócios");
    await this.noPlano(ctx.academyId);
    return this.prisma.runAs(ctx.academyId, async (db) => {
      const lugares = await db.seasonSeat.findMany({
        where: { ...(filtro.seasonId ? { seasonId: filtro.seasonId } : {}), ...(filtro.memberId ? { memberId: filtro.memberId } : {}) },
        include: { member: { select: { id: true, name: true, number: true } }, season: { select: { label: true } } },
        orderBy: [{ venueId: "asc" }, { bancadaId: "asc" }, { seat: "asc" }],
        take: 5000,
      });
      return lugares.map((l) => ({
        id: l.id,
        socio: l.member,
        seasonId: l.seasonId,
        epoca: l.season.label,
        venueId: l.venueId,
        bancadaId: l.bancadaId,
        lugar: l.seat,
        notas: l.notes,
      }));
    });
  }

  async criarLugarAnual(ctx: RequestContext, dto: LugarAnualDto) {
    if (!can(ctx, "member:write")) throw new ForbiddenException("Sem permissão para mexer nos sócios");
    await this.noPlano(ctx.academyId);
    return this.prisma.runAs(ctx.academyId, async (db) => {
      const [socio, epoca, config] = await Promise.all([
        db.member.findFirst({ where: { id: dto.memberId }, select: { id: true } }),
        db.season.findFirst({ where: { id: dto.seasonId }, select: { id: true } }),
        db.siteConfig.findUnique({ where: { academyId: ctx.academyId }, select: { venues: true } }),
      ]);
      if (!socio) throw new NotFoundException("Sócio não encontrado");
      if (!epoca) throw new NotFoundException("Época não encontrada");
      const recinto = recintosValidos(config?.venues).find((r) => r.id === dto.venueId);
      if (!recinto || !recinto.bancadas.some((b) => b.id === dto.bancadaId)) throw new BadRequestException("Escolhe uma bancada do recinto");
      try {
        const l = await db.seasonSeat.create({
          data: {
            academyId: ctx.academyId,
            memberId: dto.memberId,
            seasonId: dto.seasonId,
            venueId: dto.venueId,
            bancadaId: dto.bancadaId,
            seat: dto.seat?.trim() || null,
            notes: dto.notes?.trim() || null,
          },
        });
        return { id: l.id };
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
          throw new BadRequestException("Este sócio já tem lugar anual neste recinto nesta época, ou esse lugar já é de outro sócio.");
        }
        throw e;
      }
    });
  }

  async apagarLugarAnual(ctx: RequestContext, id: string) {
    if (!can(ctx, "member:write")) throw new ForbiddenException("Sem permissão para mexer nos sócios");
    await this.noPlano(ctx.academyId);
    await this.prisma.runAs(ctx.academyId, (db) => db.seasonSeat.deleteMany({ where: { id } }));
    return { ok: true as const };
  }
}

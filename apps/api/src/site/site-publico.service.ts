import { randomBytes } from "node:crypto";
import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Prisma } from "@prisma/client";
import { PrismaService, type ScopedClient } from "../prisma/prisma.service";
import { AuthService } from "../auth/auth.service";
import { MailClient } from "../mail/mail.client";
import { siteMensagemEmail } from "../mail/mail.templates";
import { FichaDoSite, caixaDoEmail, numeroDoTelefone } from "../platform/ficha-do-site";
import { TurnstileService } from "../common/turnstile.service";
import type { ContactoDoSiteDto } from "./site.dto";
import {
  dominioLimpo,
  equipasValidas,
  identidadeValida,
  inicioValido,
  layoutValido,
  lojaValida,
  paragrafos,
  recintosValidos,
  tiposValidos,
  type EquipaNoSite,
  type Layout,
} from "./site.tipos";
import { siteIncluido } from "./plano";
import { legalPublico } from "./site-legal";
import { estadoDaVenda } from "../bilheteira/regras";
import { lojaVende } from "../loja/regras";
import { vendeOnline, tiposQueSeVendem } from "../common/vendas-online";
import { SELECT_PRODUTO_PARA_VENDA, produtoParaVenda, reservadosPorLinha, type ProdutoLido } from "../loja/contexto";
import { FALLBACK_HEADLINE, FALLBACK_INTRO, FALLBACK_POINTS } from "../landing/membership.template";

/**
 * Os tectos do formulário de contactos de **um** clube. Um clube pequeno
 * recebe uma ou duas mensagens por semana; isto nunca o apanha, e trava uma
 * enxurrada num site só sem tocar nos outros. Ver `TicketsService` para a
 * mesma regra no site de marketing.
 */
const TECTO_HORA = 10;
const TECTO_DIA = 60;
const POR_PESSOA_DIA = 3;
const FILA_MAXIMA = 20;

/**
 * O que o site público do clube lê (`apps/clube-site`), sem sessão.
 *
 * ## Só clubes que publicaram
 *
 * Tudo começa em `clube()`: um clube sem `SiteConfig.published`, ou sem o
 * site no plano (Connect Pro), não existe para estes endpoints, e respondem
 * 404. Nenhum clube ganha um site aberto ao mundo por esta API existir.
 *
 * ## O que nunca sai daqui
 *
 * Treinos (dizem onde estão crianças e a que horas), contactos de famílias e
 * atletas, e **nada de uma equipa que o clube não ligou**: nem a ficha, nem o
 * plantel, nem os jogos, nem os resultados. Uma equipa só aparece depois de o
 * clube a ligar no menu Website (ver `equipasValidas`). Os jogos ficam numa
 * janela de três meses para trás e seis para a frente.
 *
 * As formas devolvidas são as de `apps/clube-site/src/dados/tipos.ts`.
 */
@Injectable()
export class SitePublicoService {
  private readonly log = new Logger(SitePublicoService.name);
  private readonly ficha: FichaDoSite;

  /* A fila dos envios do formulário, na memória da API. Ver `TicketsService.emFila`. */
  private fila: Promise<unknown> = Promise.resolve();
  private aEspera = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly config: ConfigService,
    private readonly mail: MailClient,
    private readonly turnstile: TurnstileService,
  ) {
    const segredo = this.config.get<string>("SITE_FORM_SECRET") || this.config.get<string>("SUPABASE_JWT_SECRET") || "";
    if (!segredo) this.log.warn("Sem SITE_FORM_SECRET nem SUPABASE_JWT_SECRET: o formulário dos sites dos clubes recusa todos os envios");
    // Um fim próprio: uma ficha do site de marketing não vale no site de um clube, nem ao contrário.
    this.ficha = new FichaDoSite(segredo || randomBytes(32).toString("hex"), "site-do-clube");
  }

  /* ------------------------------------------------------------------------ */
  /* De quem é o pedido                                                         */
  /* ------------------------------------------------------------------------ */

  /** `adfafe.pt` ou `www.adfafe.pt` → o clube, se o domínio for de um clube com site publicado. */
  async porDominio(host: string) {
    const rows = await this.prisma.$queryRaw<{ id: string | null }[]>`
      SELECT app.resolve_site_by_domain(${dominioLimpo(host)}) AS id
    `;
    const academyId = rows[0]?.id;
    if (!academyId) throw new NotFoundException();
    return this.prisma.runAs(academyId, async (db) => {
      const a = await this.clube(db, academyId);
      return { slug: a.slug, layout: a.layout, dominio: a.dominio };
    });
  }

  /** O resumo pelo slug (`ad-fafe.website.academias.pt`): o layout, e o domínio próprio se tiver. */
  async resumo(slug: string) {
    return this.comClube(slug, async (_db, a) => ({ slug: a.slug, layout: a.layout, dominio: a.dominio }));
  }

  /* ------------------------------------------------------------------------ */
  /* O clube                                                                    */
  /* ------------------------------------------------------------------------ */

  async clubePorSlug(slug: string) {
    return this.comClube(slug, async (db, a) => {
      const [sports, sponsors] = await Promise.all([
        db.sport.findMany({ select: { name: true }, orderBy: { name: "asc" } }),
        db.siteSponsor.findMany({ orderBy: [{ position: "asc" }, { createdAt: "asc" }] }),
      ]);
      const id = a.identidade;
      const linhasDaMorada = id.morada.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      const base = this.config.get<string>("PUBLIC_BASE_URL");
      const membershipUrl = base
        ? `${base.replace(/\/$/, "").replace("{slug}", a.slug)}/ser-socio`
        : `https://${a.slug}.academias.pt/ser-socio`;

      return {
        slug: a.slug,
        layout: a.layout,
        dominio: a.dominio,
        name: a.name,
        shortName: a.shortName,
        city: a.city ?? undefined,
        signalColor: a.signalColor,
        logoUrl: a.logoUrl ?? undefined,
        foundedYear: id.fundacao ? Number(id.fundacao) : undefined,
        motto: id.lema || undefined,
        about: id.sobre || `${a.name}${a.city ? `, ${a.city}` : ""}.`,
        history: paragrafos(id.historia),
        modalidades: sports.map((s) => s.name),
        address: {
          lines: linhasDaMorada,
          mapsUrl: linhasDaMorada.length ? `https://maps.google.com/?q=${encodeURIComponent(linhasDaMorada.join(", "))}` : undefined,
        },
        phone: id.telefone || undefined,
        email: id.email || undefined,
        social: id.redes,
        membershipUrl,
        board: id.direcao.map((d) => ({ name: d.nome, role: d.cargo })),
        facilities: id.instalacoes.map((i) => ({ name: i.nome, description: i.descricao, image: i.imagem || undefined })),
        sponsors: sponsors.map((s) => ({ name: s.name, logoUrl: s.logoUrl ?? undefined, url: s.url ?? undefined })),
        // Vazia, o site usa a fotografia de omissão (uma bancada).
        photo: id.foto || undefined,
        recintos: a.recintos,
        /** A página de início: a ordem das secções e o banner. Ver `inicioValido`. */
        home: a.inicio,
        /** A loja: se vende online, e como entrega. Ver `lojaValida`. */
        loja: {
          compraOnline: a.lojaVende,
          levantamento: a.loja.levantamento.ativo ? { local: a.loja.levantamento.local, nota: a.loja.levantamento.nota } : null,
          envio: a.loja.envio.ativo
            ? { preco: a.loja.envio.precoCents / 100, gratisAPartirDe: a.loja.envio.gratisAPartirDeCents === null ? null : a.loja.envio.gratisAPartirDeCents / 100, nota: a.loja.envio.nota }
            : null,
          aviso: a.loja.aviso || undefined,
        },
        /** Nome legal, NIPC, arbitragem e os textos do clube nas páginas legais. Ver `site-legal.ts`. */
        legal: legalPublico(id.legal, a.city, a.vendeOnline),
      };
    });
  }

  /* ------------------------------------------------------------------------ */
  /* O formulário de contactos                                                  */
  /* ------------------------------------------------------------------------ */

  /** A ficha que o formulário pede ao abrir. Ver `FichaDoSite`. */
  fichaDeContacto() {
    return { ficha: this.ficha.emitir() };
  }

  /**
   * Uma mensagem para o clube, pelo site dele.
   *
   * Grava na caixa de mensagens do clube (menu Website › Mensagens) e avisa o
   * clube por email, para o endereço que ele pôs na Identidade do site. O
   * crivo é o do formulário de marketing (`TicketsService.createFromSite`):
   * campo-armadilha, ficha assinada pelo servidor, repetições, tectos por
   * pessoa e por clube, um envio de cada vez.
   *
   * Só clubes com o site publicado (`comClube`): um clube sem site não tem
   * caixa de mensagens para encher.
   */
  async contacto(slug: string, dto: ContactoDoSiteDto, ip?: string) {
    const nome = dto.nome.trim();
    const email = dto.email.trim().toLowerCase();
    const telefone = dto.telefone?.trim() || null;
    const assunto = dto.assunto.trim();
    const mensagem = dto.mensagem.trim();

    if (dto.notaExtra?.trim()) {
      this.log.warn(`Mensagem do site ${slug} deitada fora (campo-armadilha) de ${ip ?? "?"}`);
      return { ok: true as const };
    }
    const recusa = this.ficha.verificar(dto.ficha);
    if (recusa) {
      this.log.warn(`Mensagem do site ${slug} recusada (ficha) de ${ip ?? "?"}: ${recusa}`);
      throw new BadRequestException(recusa);
    }
    await this.turnstile.exigir(dto.turnstile, `contacto-${slug}`, ip);

    const caixa = caixaDoEmail(email);
    const numero = numeroDoTelefone(telefone);

    const resultado = await this.emFila(() =>
      this.comClube(slug, async (db, a) => {
        const agora = Date.now();
        const recentes = await db.siteMessage.findMany({
          where: { createdAt: { gte: new Date(agora - 24 * 60 * 60 * 1000) } },
          select: { email: true, phone: true, subject: true, message: true, createdAt: true },
        });
        const naHora = recentes.filter((m) => m.createdAt.getTime() >= agora - 60 * 60 * 1000).length;
        if (naHora >= TECTO_HORA || recentes.length >= TECTO_DIA) return "cheio" as const;

        const daPessoa = recentes.filter(
          (m) => caixaDoEmail(m.email) === caixa || (numero !== null && numeroDoTelefone(m.phone) === numero),
        );
        const repetido = daPessoa.some(
          (m) => m.createdAt.getTime() >= agora - 60 * 60 * 1000 && m.subject === assunto && m.message === mensagem,
        );
        if (repetido) return "repetido" as const;
        if (daPessoa.length >= POR_PESSOA_DIA) return "pessoa" as const;

        const gravada = await db.siteMessage.create({
          data: { academyId: a.id, name: nome, email, phone: telefone, subject: assunto, message: mensagem, ip: ip ?? null },
          select: { id: true },
        });
        return { id: gravada.id, clube: a };
      }),
    );

    if (resultado === "repetido") return { ok: true as const };
    if (resultado === "pessoa") {
      this.log.warn(`Mensagem do site ${slug} recusada (tecto por pessoa) de ${ip ?? "?"}: ${caixa}`);
      throw new BadRequestException("Já recebemos as tuas mensagens de hoje. O clube responde por email.");
    }
    if (resultado === "cheio") {
      this.log.warn(`Mensagem do site ${slug} recusada (tecto do clube) de ${ip ?? "?"}`);
      throw new BadRequestException("O clube recebeu muitas mensagens agora. Tenta daqui a uma hora, ou liga-lhe.");
    }

    // O aviso ao clube, depois de a mensagem estar gravada: um problema no
    // correio não pode fazer o site dizer a quem escreveu que não passou.
    const { clube } = resultado;
    const para = clube.identidade.email.trim();
    if (para) {
      const base = this.config.get<string>("PUBLIC_BASE_URL");
      const link = base
        ? `${base.replace(/\/$/, "").replace("{slug}", clube.slug)}/consola/website?secao=mensagens`
        : `https://${clube.slug}.academias.pt/consola/website?secao=mensagens`;
      const corpo = siteMensagemEmail({
        brand: { shortName: clube.shortName, name: clube.name, signalColor: clube.signalColor, logoUrl: clube.logoUrl },
        nome,
        email,
        telefone,
        assunto,
        mensagem,
        link,
      });
      await this.mail.send({ to: para, toName: clube.shortName, ...corpo, replyTo: { email, name: nome }, kind: "site-mensagem" });
    }
    return { ok: true as const };
  }

  private async emFila<T>(fn: () => Promise<T>): Promise<T | "cheio"> {
    if (this.aEspera >= FILA_MAXIMA) return "cheio";
    this.aEspera++;
    const vez = this.fila.then(fn, fn);
    this.fila = vez.catch(() => undefined);
    try {
      return await vez;
    } finally {
      this.aEspera--;
    }
  }

  /* ------------------------------------------------------------------------ */
  /* Notícias                                                                   */
  /* ------------------------------------------------------------------------ */

  async noticias(slug: string, opts: { limit?: number; category?: string }) {
    return this.comClube(slug, async (db) => {
      const lista = await db.siteNews.findMany({
        where: { publishedAt: { not: null, lte: new Date() }, ...(opts.category ? { category: opts.category } : {}) },
        orderBy: { publishedAt: "desc" },
        take: Math.min(Math.max(opts.limit ?? 50, 1), 100),
      });
      return lista.map(noticiaPublica);
    });
  }

  async noticia(slug: string, id: string) {
    return this.comClube(slug, async (db) => {
      const n = await db.siteNews.findFirst({ where: { id, publishedAt: { not: null, lte: new Date() } } });
      if (!n) throw new NotFoundException();
      return noticiaPublica(n);
    });
  }

  /* ------------------------------------------------------------------------ */
  /* Equipas                                                                    */
  /* ------------------------------------------------------------------------ */

  async equipas(slug: string) {
    return this.comClube(slug, async (db, a) => {
      const teams = await this.equipasVisiveis(db, a.equipas);
      return teams.map((t) => equipaPublica(t, true, a.equipas[t.id]?.foto));
    });
  }

  async equipa(slug: string, id: string) {
    return this.comClube(slug, async (db, a) => {
      const t = (await this.equipasVisiveis(db, a.equipas, id))[0];
      if (!t) throw new NotFoundException();
      return equipaPublica(t, true, a.equipas[t.id]?.foto);
    });
  }

  /**
   * As equipas da época em curso que o clube não escondeu, das mais velhas
   * para as mais novas (como no menu de jogos do sócio).
   *
   * A época em curso é a marcada, ou, sem nenhuma marcada, a mais recente: é
   * a regra do arranque da consola. Muitos clubes nunca carregam na marca, e o
   * site deles saía sem equipas nem jogos (AD Fafe, 14/10).
   */
  private async equipasVisiveis(db: ScopedClient, visibilidade: Record<string, EquipaNoSite>, so?: string) {
    const epoca = await db.season.findFirst({
      orderBy: [{ isCurrent: "desc" }, { startsOn: "desc" }],
      select: { id: true },
    });
    if (!epoca) return [];
    const teams = await db.team.findMany({
      where: { seasonId: epoca.id, ...(so ? { id: so } : {}) },
      orderBy: [{ maxAge: "desc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        maxAge: true,
        gender: true,
        sport: { select: { name: true } },
        staff: {
          where: { leftAt: null, membership: { isActive: true } },
          orderBy: { title: "asc" },
          select: { title: true, membership: { select: { user: { select: { name: true } } } } },
        },
        athletes: {
          where: { leftAt: null },
          orderBy: [{ squadNumber: "asc" }],
          select: { squadNumber: true, position: true, athlete: { select: { name: true } } },
        },
      },
    });
    // Só as que o clube ligou. Sem configuração, a equipa não aparece.
    return teams.filter((t) => visibilidade[t.id]?.visivel === true);
  }

  /* ------------------------------------------------------------------------ */
  /* Jogos e eventos                                                            */
  /* ------------------------------------------------------------------------ */

  async jogos(slug: string) {
    return this.comClube(slug, async (db, a) => {
      const visiveis = new Set((await this.equipasVisiveis(db, a.equipas)).map((t) => t.id));
      const agora = Date.now();
      const jogos = await db.match.findMany({
        where: {
          teamId: { in: [...visiveis] },
          startsAt: { gte: new Date(agora - 90 * 86_400_000), lte: new Date(agora + 180 * 86_400_000) },
        },
        orderBy: { startsAt: "asc" },
        select: SELECT_JOGO,
      });
      return jogos.map((j) => jogoPublico(j, a.vendeOnline));
    });
  }

  async jogo(slug: string, id: string) {
    return this.comClube(slug, async (db, a) => {
      /*
       * As mesmas regras da lista: só de equipas ligadas (e da época em curso).
       * Um jogo de uma equipa escondida não se abre nem pelo endereço.
       */
      const visiveis = new Set((await this.equipasVisiveis(db, a.equipas)).map((t) => t.id));
      const j = await db.match.findFirst({ where: { id }, select: SELECT_JOGO });
      if (!j || !visiveis.has(j.teamId)) throw new NotFoundException();
      return jogoPublico(j, a.vendeOnline);
    });
  }

  /**
   * Os eventos que o clube marcou como públicos (`CalendarEvent.isPublic`):
   * assembleias, jantares, torneios. Nunca treinos nem jogos (vivem noutras
   * tabelas; os jogos saem por `jogos`). Do dia de ontem a um ano, por ordem.
   */
  async eventos(slug: string) {
    return this.comClube(slug, async (db) => {
      const agora = Date.now();
      const lista = await db.calendarEvent.findMany({
        where: {
          isPublic: true,
          cancelled: false,
          startsAt: { gte: new Date(agora - 86_400_000), lte: new Date(agora + 365 * 86_400_000) },
        },
        orderBy: { startsAt: "asc" },
        take: 100,
        select: { id: true, title: true, startsAt: true, endsAt: true, venue: true },
      });
      return lista.map((e) => ({
        id: e.id,
        title: e.title,
        startsAt: e.startsAt.toISOString(),
        endsAt: e.endsAt.toISOString(),
        venue: e.venue || undefined,
      }));
    });
  }

  /* ------------------------------------------------------------------------ */
  /* Loja                                                                       */
  /* ------------------------------------------------------------------------ */

  async produtos(slug: string) {
    return this.comClube(slug, async (db) => {
      const lista = await db.siteProduct.findMany({
        where: { visible: true },
        orderBy: [{ position: "asc" }, { createdAt: "asc" }],
        select: SELECT_PRODUTO_PUBLICO,
      });
      // O que outras encomendas têm guardado (10 minutos) já não está à venda.
      const reservados = await reservadosPorLinha(db, lista.map((p) => p.id), new Date());
      // Um produto de um artigo arquivado sai do site sem ninguém o desligar.
      return lista.filter((p) => !p.inventoryItem?.archivedAt).map((p) => produtoPublico(p, reservados));
    });
  }

  async produto(slug: string, id: string) {
    return this.comClube(slug, async (db) => {
      const p = await db.siteProduct.findFirst({ where: { id, visible: true }, select: SELECT_PRODUTO_PUBLICO });
      if (!p || p.inventoryItem?.archivedAt) throw new NotFoundException();
      return produtoPublico(p, await reservadosPorLinha(db, [p.id], new Date()));
    });
  }

  /* ------------------------------------------------------------------------ */
  /* Sócios                                                                     */
  /* ------------------------------------------------------------------------ */

  /**
   * O "Ser sócio" dentro do site: o texto que o clube escreveu para a página
   * de adesão (ou o de omissão, o mesmo da página da API) e as categorias
   * públicas. O pedido em si vai para `POST /api/clubes/:slug/socios`, o mesmo
   * da página `/ser-socio`, e cai no painel como sempre.
   */
  async socios(slug: string) {
    return this.comClube(slug, async (db, a) => {
      const [academia, tiers] = await Promise.all([
        db.academy.findFirst({
          where: { slug: a.slug },
          select: { membershipHeadline: true, membershipIntro: true, membershipPoints: true },
        }),
        db.memberTier.findMany({
          where: { isPublic: true, archivedAt: null },
          orderBy: [{ order: "asc" }, { name: "asc" }],
          select: { id: true, name: true, description: true, benefits: true, feeCents: true, billing: true, minAge: true, maxAge: true },
        }),
      ]);
      const pontos = (academia?.membershipPoints ?? []).map((p) => p.trim()).filter(Boolean);
      return {
        headline: academia?.membershipHeadline?.trim() || FALLBACK_HEADLINE,
        intro: academia?.membershipIntro?.trim() || FALLBACK_INTRO,
        points: pontos.length ? pontos : FALLBACK_POINTS,
        tiers,
      };
    });
  }

  /* ------------------------------------------------------------------------ */
  /* O clube publicado                                                          */
  /* ------------------------------------------------------------------------ */

  private async comClube<T>(slug: string, fn: (db: ScopedClient, a: ClubePublicado) => Promise<T>): Promise<T> {
    const academyId = await this.auth.academyIdBySlug(slug);
    if (!academyId) throw new NotFoundException();
    return this.prisma.runAs(academyId, async (db) => fn(db, await this.clube(db, academyId)));
  }

  private async clube(db: ScopedClient, academyId: string): Promise<ClubePublicado> {
    const [a, config, noPlano] = await Promise.all([
      db.academy.findFirst({
        where: { id: academyId },
        select: { slug: true, name: true, shortName: true, city: true, signalColor: true, logoUrl: true, siteDomain: true, paymentsEnabled: true, invoicingConfirmedAt: true },
      }),
      db.siteConfig.findUnique({ where: { academyId } }),
      siteIncluido(db, academyId),
    ]);
    if (!a || !config?.published || !noPlano) throw new NotFoundException();
    const { paymentsEnabled, invoicingConfirmedAt, ...resto } = a;
    // Cobra no site com os pagamentos e a faturação ligados (ver `common/vendas-online.ts`).
    const vende = vendeOnline({ paymentsEnabled, invoicingConfirmedAt });
    const loja = lojaValida(config.shop);
    return {
      ...resto,
      id: academyId,
      dominio: a.siteDomain ?? null,
      layout: layoutValido(config.layout),
      identidade: identidadeValida(config.identity),
      equipas: equipasValidas(config.teams),
      recintos: recintosValidos(config.venues),
      inicio: inicioValido(config.home),
      loja,
      // A loja vende online com pagamentos e faturação ligados e uma forma de entrega. Sem isso, fica em catálogo.
      lojaVende: lojaVende(loja, vende),
      /** O clube cobra vendas no site: a bilheteira vende bilhetes pagos e a loja pode vender. */
      vendeOnline: vende,
    };
  }
}

type ClubePublicado = {
  id: string;
  slug: string;
  name: string;
  shortName: string;
  city: string | null;
  signalColor: string;
  logoUrl: string | null;
  dominio: string | null;
  layout: Layout;
  identidade: ReturnType<typeof identidadeValida>;
  equipas: ReturnType<typeof equipasValidas>;
  recintos: ReturnType<typeof recintosValidos>;
  inicio: ReturnType<typeof inicioValido>;
  loja: ReturnType<typeof lojaValida>;
  lojaVende: boolean;
  vendeOnline: boolean;
};

/* -------------------------------------------------------------------------- */
/* Formas públicas                                                              */
/* -------------------------------------------------------------------------- */

function noticiaPublica(n: {
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
    slug: n.id,
    title: n.title,
    summary: n.summary,
    body: paragrafos(n.body),
    category: n.category,
    image: n.imageUrl ?? undefined,
    publishedAt: (n.publishedAt ?? new Date()).toISOString(),
    featured: n.featured,
  };
}

function equipaPublica(
  t: {
    id: string;
    name: string;
    maxAge: number;
    gender: "MALE" | "FEMALE" | "MIXED" | null;
    sport: { name: string };
    staff: { title: string; membership: { user: { name: string } } }[];
    athletes: { squadNumber: number | null; position: string | null; athlete: { name: string } }[];
  },
  comPlantel: boolean,
  /** A fotografia que o clube carregou. Sem ela, o site usa a de omissão da modalidade. */
  foto?: string,
) {
  return {
    id: t.id,
    slug: t.id,
    name: t.name,
    sport: t.sport.name,
    image: foto || undefined,
    // 99 é "sem limite" (os seniores): o site não mostra idade nenhuma.
    maxAge: t.maxAge >= 99 ? null : t.maxAge,
    gender: t.gender === "FEMALE" ? "F" : t.gender === "MIXED" ? "MISTA" : t.gender === "MALE" ? "M" : undefined,
    staff: t.staff.map((s) => ({ name: s.membership.user.name, role: s.title })),
    roster: comPlantel
      ? t.athletes.map((m) => ({ name: m.athlete.name, number: m.squadNumber ?? undefined, position: m.position ?? undefined }))
      : [],
  };
}

const SELECT_JOGO = {
  id: true,
  teamId: true,
  startsAt: true,
  venue: true,
  opponent: true,
  isHome: true,
  status: true,
  roundLabel: true,
  ourScore: true,
  theirScore: true,
  team: { select: { name: true } },
  competition: { select: { label: true } },
  siteTickets: true,
} as const;

/**
 * Um jogo como o site o mostra. `cobra` falso (sem pagamentos ou sem
 * faturação): só os bilhetes a 0 € ficam à venda, e uma venda só com preços
 * pagos não aparece.
 */
function jogoPublico(j: {
  id: string;
  teamId: string;
  startsAt: Date;
  venue: string;
  opponent: string;
  isHome: boolean;
  status: "SCHEDULED" | "PLAYED" | "CANCELLED";
  roundLabel: string | null;
  ourScore: number | null;
  theirScore: number | null;
  team: { name: string };
  competition: { label: string } | null;
  siteTickets: {
    open: boolean;
    venueId: string | null;
    capacity: number | null;
    note: string;
    types: unknown;
    membersFrom: Date | null;
    publicFrom: Date | null;
    membersOnly: boolean;
    closesAt: Date | null;
  } | null;
}, cobra: boolean) {
  const comVenda = j.status !== "CANCELLED" ? j.siteTickets : null;
  const tipos = comVenda ? tiposQueSeVendem(tiposValidos(comVenda.types), cobra) : [];
  const t = comVenda && tipos.length > 0 ? comVenda : null;
  // As fases, para o cartaz dizer "só para sócios" ou "abre ao público a…". A lotação conta-se na compra (sem cache).
  const fases = t ? estadoDaVenda(t, { startsAt: j.startsAt, status: j.status }) : null;
  return {
    id: j.id,
    teamId: j.teamId,
    teamName: j.team.name,
    startsAt: j.startsAt.toISOString(),
    venue: j.venue,
    opponent: j.opponent,
    isHome: j.isHome,
    competition: j.competition?.label,
    roundLabel: j.roundLabel ?? undefined,
    status: j.status,
    ourScore: j.ourScore ?? undefined,
    theirScore: j.theirScore ?? undefined,
    tickets: t
      ? {
          open: t.open,
          capacity: t.capacity ?? undefined,
          note: t.note || undefined,
          recintoId: t.venueId ?? undefined,
          types: tipos.map((x) => ({
            id: x.id,
            name: x.nome,
            price: x.precoCents / 100,
            bancadaId: x.bancadaId ?? undefined,
            forMembers: x.para === "socios",
            tierId: x.tierId ?? undefined,
          })),
          membersOnly: t.membersOnly,
          membersOpen: fases?.socios ?? false,
          publicOpen: fases?.publico ?? false,
          membersFrom: fases?.abreSociosEm?.toISOString(),
          publicFrom: fases?.abrePublicoEm?.toISOString(),
        }
      : undefined,
  };
}

/** O que a loja pública lê de um produto: o da venda (`contexto.ts`) mais a descrição e a galeria. */
const SELECT_PRODUTO_PUBLICO = { ...SELECT_PRODUTO_PARA_VENDA, category: true, description: true, images: true } satisfies Prisma.SiteProductSelect;

/**
 * Um produto como o site o vê.
 *
 * Os tamanhos e o que há de cada um vêm de `produtoParaVenda`: com um artigo
 * do Inventário por trás, são as variantes e o disponível de cada uma; sem
 * artigo, os tamanhos escritos e o stock gravado no produto. O que outras
 * encomendas têm guardado já está descontado. `stock` é por tamanho (`""`
 * num produto sem tamanhos; `null` = sem contagem), e "esgotado" é não haver
 * nenhum tamanho com stock. Os tamanhos esgotados continuam na lista, para o
 * site os mostrar riscados em vez de os fazer desaparecer.
 */
function produtoPublico(p: ProdutoLido & { category: string; description: string; images: string[] }, reservados: Map<string, number>) {
  const v = produtoParaVenda(p, reservados);
  const esgotado = !v.visivel || Object.values(v.disponivel).every((n) => n !== null && n <= 0);
  return {
    id: p.id,
    slug: p.id,
    name: p.name,
    price: p.priceCents / 100,
    image: p.imageUrl ?? undefined,
    images: [p.imageUrl, ...p.images].filter((x): x is string => !!x),
    category: p.category,
    description: p.description,
    variants: v.tamanhos.length ? { name: "Tamanho", options: v.tamanhos } : undefined,
    stock: v.disponivel,
    soldOut: esgotado,
  };
}

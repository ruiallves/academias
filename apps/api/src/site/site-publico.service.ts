import { Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService, type ScopedClient } from "../prisma/prisma.service";
import { AuthService } from "../auth/auth.service";
import {
  dominioLimpo,
  equipasValidas,
  identidadeValida,
  paragrafos,
  recintosValidos,
  tiposValidos,
  type EquipaNoSite,
  type Layout,
} from "./site.tipos";
import { siteIncluido } from "./plano";
import { FALLBACK_HEADLINE, FALLBACK_INTRO, FALLBACK_POINTS } from "../landing/membership.template";

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

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
        board: [],
        facilities: [],
        sponsors: sponsors.map((s) => ({ name: s.name, logoUrl: s.logoUrl ?? undefined, url: s.url ?? undefined })),
        // Vazia, o site usa a fotografia de omissão (uma bancada).
        photo: id.foto || undefined,
        recintos: a.recintos,
      };
    });
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
      return jogos.map(jogoPublico);
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
      return jogoPublico(j);
    });
  }

  /** Eventos públicos ainda não existem no calendário (não há a marca). Lista vazia, de propósito. */
  async eventos(slug: string) {
    return this.comClube(slug, async () => [] as never[]);
  }

  /* ------------------------------------------------------------------------ */
  /* Loja                                                                       */
  /* ------------------------------------------------------------------------ */

  async produtos(slug: string) {
    return this.comClube(slug, async (db) => {
      const lista = await db.siteProduct.findMany({ where: { visible: true }, orderBy: [{ position: "asc" }, { createdAt: "asc" }] });
      return lista.map(produtoPublico);
    });
  }

  async produto(slug: string, id: string) {
    return this.comClube(slug, async (db) => {
      const p = await db.siteProduct.findFirst({ where: { id, visible: true } });
      if (!p) throw new NotFoundException();
      return produtoPublico(p);
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
        select: { slug: true, name: true, shortName: true, city: true, signalColor: true, logoUrl: true, siteDomain: true },
      }),
      db.siteConfig.findUnique({ where: { academyId } }),
      siteIncluido(db, academyId),
    ]);
    if (!a || !config?.published || !noPlano) throw new NotFoundException();
    return {
      ...a,
      dominio: a.siteDomain ?? null,
      layout: (config.layout === "porto" ? "porto" : "classico") as Layout,
      identidade: identidadeValida(config.identity),
      equipas: equipasValidas(config.teams),
      recintos: recintosValidos(config.venues),
    };
  }
}

type ClubePublicado = {
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
  siteTickets: { open: boolean; venueId: string | null; capacity: number | null; note: string; types: unknown } | null;
}) {
  const t = j.isHome && j.status !== "CANCELLED" ? j.siteTickets : null;
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
          types: tiposValidos(t.types).map((x) => ({ id: x.id, name: x.nome, price: x.precoCents / 100, bancadaId: x.bancadaId ?? undefined })),
        }
      : undefined,
  };
}

function produtoPublico(p: {
  id: string;
  name: string;
  category: string;
  priceCents: number;
  imageUrl: string | null;
  description: string;
  sizes: string;
  soldOut: boolean;
}) {
  const tamanhos = p.sizes
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    id: p.id,
    slug: p.id,
    name: p.name,
    price: p.priceCents / 100,
    image: p.imageUrl ?? undefined,
    category: p.category,
    description: p.description,
    variants: tamanhos.length ? { name: "Tamanho", options: tamanhos } : undefined,
    soldOut: p.soldOut,
  };
}

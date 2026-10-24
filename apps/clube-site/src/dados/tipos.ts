/**
 * O que o site de um clube sabe.
 *
 * Os nomes dos campos seguem os do esquema da API (`Academy.signalColor`,
 * `Match.opponent`, `Match.isHome`, `Team.maxAge`) de propósito: quando os
 * endpoints públicos existirem, a troca em `fonte.ts` é passar o JSON, e não
 * traduzir um modelo para outro.
 *
 * O que o site mostra é o que o clube marcou como público. Treinos nunca
 * entram aqui: dizem onde estão crianças e a que horas.
 */

import type { Recinto } from "@academia/ui/estadio";

export type { Recinto, Bancada } from "@academia/ui/estadio";

/**
 * Os temas do site. `tribuna`: claro, cabeçalho em dois andares, o site de
 * clube de sempre. `holofote`: escuro, barra lateral e herói a toda a
 * largura, o jogo à noite. O clube escolhe um; a pré-visualização troca com
 * um cookie. Chamavam-se "classico" e "porto" até 20/10/2026: ver
 * `layoutNormalizado`.
 */
export const LAYOUTS = ["tribuna", "holofote"] as const;

/** O tema como vem da API ou de um cookie antigo, já com os nomes de hoje. Desconhecido é Tribuna. */
export function layoutNormalizado(v: unknown): Layout {
  if (v === "holofote" || v === "porto") return "holofote";
  return "tribuna";
}

/** O cookie com que o interruptor da demonstração troca de layout (ver `layoutAtual`). */
export const COOKIE_LAYOUT = "site-layout";
export type Layout = (typeof LAYOUTS)[number];

export function layoutValido(v: unknown): v is Layout {
  return typeof v === "string" && (LAYOUTS as readonly string[]).includes(v);
}

/**
 * As secções da página de início que o clube ordena e liga no menu Website.
 * O herói (notícias em destaque) fica sempre no topo e não entra aqui.
 */
export const SECCOES_INICIO = ["jogo", "noticias", "equipas", "socios", "banner", "loja", "patrocinadores"] as const;
export type SeccaoInicioKey = (typeof SECCOES_INICIO)[number];

/**
 * Uma secção da página de início. As seis fixas existem uma vez; os banners
 * são quantos o clube quiser, cada um com o seu conteúdo e o seu `id`.
 */
export type SeccaoInicio = { id: string; key: SeccaoInicioKey; visivel: boolean; banner?: Banner };

/** A faixa de destaque do início: um torneio, uma campanha, uma inscrição. */
export type Banner = {
  titulo: string;
  texto: string;
  /** URL público, ou vazio. */
  imagem: string;
  /** O rótulo do botão; sem ele, ou sem `url`, a faixa não tem botão. */
  botao: string;
  /** Um caminho do site (`/loja`) ou um endereço completo (`https://...`). */
  url: string;
};

export type Inicio = {
  /** O que está na página, pela ordem que o clube escolheu. Uma fixa que o clube tirou não vem. */
  seccoes: SeccaoInicio[];
  banner: Banner;
};

/** O início de um clube que ainda não mexeu em nada: tudo visível, pela ordem de sempre. */
export const INICIO_POR_OMISSAO: Inicio = {
  seccoes: SECCOES_INICIO.map((key) =>
    key === "banner"
      ? { id: "banner-1", key, visivel: true, banner: { titulo: "", texto: "", imagem: "", botao: "", url: "" } }
      : { id: key, key, visivel: true },
  ),
  banner: { titulo: "", texto: "", imagem: "", botao: "", url: "" },
};

export type Clube = {
  slug: string;
  layout: Layout;
  /** O domínio próprio do clube ("adfafe.pt"), se tiver. É o endereço oficial do site. */
  dominio?: string | null;
  name: string;
  shortName: string;
  city?: string;
  signalColor: string;
  logoUrl?: string;
  /** "Fundado em 1934" no rodapé e na página do clube. */
  foundedYear?: number;
  /** A frase do clube, se a tiver. Vai para o herói e para o rodapé. */
  motto?: string;
  /** Um parágrafo sobre o clube, para o OG e para a página "Clube". */
  about: string;
  /** Parágrafos da história, por ordem. */
  history: string[];
  modalidades: string[];
  address: { lines: string[]; mapsUrl?: string };
  phone?: string;
  email?: string;
  social: Partial<Record<"facebook" | "instagram" | "youtube" | "x" | "tiktok", string>>;
  /** Onde se faz sócio: a página pública da plataforma ou outra. */
  membershipUrl: string;
  board: { name: string; role: string }[];
  /** A imagem é opcional: uma instalação sem fotografia desenha-se só com o texto. */
  facilities: { name: string; description: string; image?: string }[];
  /** A página de início: que secções, por que ordem, e a faixa de destaque. */
  home: Inicio;
  /** Os recintos vistos de cima, desenhados na consola. Vazio = bilhetes sem mapa. */
  recintos: Recinto[];
  /** A fotografia do clube (bloco de sócios). Sem ela, a de omissão: ver `lib/fotos.ts`. */
  photo?: string;
  sponsors: { name: string; logoUrl?: string; url?: string }[];
  /** A loja: se vende online e como entrega. Ausente num servidor antigo = catálogo. */
  loja?: LojaDoClube;
};

/**
 * Como a loja do clube vende. `compraOnline` é falso sem pagamentos ligados
 * ou sem forma de entrega: a loja fica em catálogo e os botões levam aos
 * contactos. As duas formas de entrega vêm nulas quando o clube as desligou.
 */
export type LojaDoClube = {
  compraOnline: boolean;
  levantamento: { local: string; nota: string } | null;
  /** Em euros. `gratisAPartirDe` nulo = nunca é grátis. */
  envio: { preco: number; gratisAPartirDe: number | null; nota: string } | null;
  /** Uma frase no topo da loja. */
  aviso?: string;
};

export type Noticia = {
  id: string;
  slug: string;
  title: string;
  summary: string;
  /** Parágrafos, por ordem. Texto corrido; sem HTML. */
  body: string[];
  category: string;
  /** Sem foto, o site desenha um bloco na cor do clube. */
  image?: string;
  imageAlt?: string;
  publishedAt: string;
  /** Até três ficam em destaque no herói; a primeira é a grande. */
  featured?: boolean;
};

export type Equipa = {
  id: string;
  slug: string;
  name: string;
  sport: string;
  maxAge: number | null;
  gender?: "M" | "F" | "MISTA";
  image?: string;
  /** Equipa técnica, por ordem. A pública, não a interna. */
  staff: { name: string; role: string }[];
  /**
   * O plantel vai com a equipa: aparece quando o clube liga a equipa no site, e os menores só com
   * consentimento. Vazio por omissão.
   */
  roster: { name: string; number?: number; position?: string }[];
  competition?: string;
};

export type TipoBilhete = {
  id: string;
  name: string;
  /** Em euros. */
  price: number;
  description?: string;
  /** A bancada do recinto do jogo. Ausente = qualquer lugar. */
  bancadaId?: string;
  /** Preço de sócio: só se compra depois de o sócio se identificar. */
  forMembers?: boolean;
  /** Com `forMembers`: só para os sócios desta categoria. Ausente = qualquer sócio. */
  tierId?: string;
};

export type Jogo = {
  id: string;
  teamId: string;
  teamName: string;
  startsAt: string;
  venue: string;
  opponent: string;
  opponentLogoUrl?: string;
  isHome: boolean;
  competition?: string;
  roundLabel?: string;
  status: "SCHEDULED" | "PLAYED" | "CANCELLED";
  ourScore?: number;
  theirScore?: number;
  /** Presente só quando há bilhetes à venda para este jogo. */
  tickets?: {
    types: TipoBilhete[];
    capacity?: number;
    open: boolean;
    note?: string;
    recintoId?: string;
    /**
     * As fases da venda, como a API as calcula no momento da leitura (com o
     * minuto de cache do site). A lotação não vem: conta-se na compra.
     */
    membersOnly?: boolean;
    /** Os sócios já compram. */
    membersOpen?: boolean;
    /** O público já compra. */
    publicOpen?: boolean;
    /** Quando abre aos sócios, se ainda não abriu. */
    membersFrom?: string;
    /** Quando abre ao público, se ainda não abriu (nunca num jogo só para sócios). */
    publicFrom?: string;
  };
};

export type Evento = {
  id: string;
  title: string;
  startsAt: string;
  endsAt?: string;
  venue?: string;
  description?: string;
};

export type Produto = {
  id: string;
  slug: string;
  name: string;
  /** Em euros. */
  price: number;
  image?: string;
  images?: string[];
  category: string;
  description: string;
  /** "Tamanho" → ["S", "M", "L"]. Sem variantes num cachecol. */
  variants?: { name: string; options: string[] };
  /**
   * O que há de cada tamanho (`""` num produto sem tamanhos), já sem o que
   * outras encomendas têm guardado. `null` = sem contagem. Ausente num
   * servidor antigo: vale só `soldOut`.
   */
  stock?: Record<string, number | null>;
  soldOut?: boolean;
};

/** A fronteira entre o site e os dados. Uma implementação por origem. */
/** Uma categoria de sócio que o clube publica (as mesmas da página `/ser-socio` da API). */
export type CategoriaDeSocio = {
  id: string;
  name: string;
  description: string | null;
  benefits: string[];
  /** No período de `billing`. Nulo: "a definir". */
  feeCents: number | null;
  billing?: "MONTHLY" | "ANNUAL";
  minAge: number | null;
  maxAge: number | null;
};

/** O "Ser sócio" do site: o texto do clube e as categorias. */
export type Adesao = {
  headline: string;
  intro: string;
  points: string[];
  tiers: CategoriaDeSocio[];
};

export interface Fonte {
  clube(slug: string): Promise<Clube | null>;
  socios(slug: string): Promise<Adesao>;
  noticias(slug: string, opts?: { limit?: number; category?: string }): Promise<Noticia[]>;
  noticia(slug: string, id: string): Promise<Noticia | null>;
  equipas(slug: string): Promise<Equipa[]>;
  equipa(slug: string, id: string): Promise<Equipa | null>;
  jogos(slug: string): Promise<Jogo[]>;
  jogo(slug: string, id: string): Promise<Jogo | null>;
  eventos(slug: string): Promise<Evento[]>;
  produtos(slug: string): Promise<Produto[]>;
  produto(slug: string, id: string): Promise<Produto | null>;
}

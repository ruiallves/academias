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
 * Os layouts do site. `classico`: claro, cabeçalho em dois andares, como a
 * AD Fafe. `porto`: escuro, barra lateral e herói a toda a largura, como o
 * FC Porto. O clube escolhe um; a pré-visualização troca com um cookie.
 */
export const LAYOUTS = ["classico", "porto"] as const;
export type Layout = (typeof LAYOUTS)[number];

export function layoutValido(v: unknown): v is Layout {
  return typeof v === "string" && (LAYOUTS as readonly string[]).includes(v);
}

export type Clube = {
  slug: string;
  layout: Layout;
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
  facilities: { name: string; description: string; image: string }[];
  /** Os recintos vistos de cima, desenhados na consola. Vazio = bilhetes sem mapa. */
  recintos: Recinto[];
  sponsors: { name: string; logoUrl?: string; url?: string }[];
};

export type Noticia = {
  id: string;
  slug: string;
  title: string;
  summary: string;
  /** Parágrafos, por ordem. Texto corrido; sem HTML. */
  body: string[];
  category: string;
  image: string;
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
   * O plantel só aparece se o clube o publicar, e os menores só com
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
  tickets?: { types: TipoBilhete[]; capacity?: number; open: boolean; note?: string; recintoId?: string };
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
  image: string;
  images?: string[];
  category: string;
  description: string;
  /** "Tamanho" → ["S", "M", "L"]. Sem variantes num cachecol. */
  variants?: { name: string; options: string[] };
  soldOut?: boolean;
};

/** A fronteira entre o site e os dados. Uma implementação por origem. */
export interface Fonte {
  clube(slug: string): Promise<Clube | null>;
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

/**
 * As formas do site do clube, e a limpeza do que chega de fora.
 *
 * Dois lados:
 *
 *   - **A consola** fala em português e em euros (`SiteDoClube`), a mesma
 *     forma que `apps/console/src/lib/website.ts` sempre usou: a troca do
 *     armazenamento do browser para a API não lhe mudou os tipos.
 *   - **O site público** lê a forma de `apps/clube-site/src/dados/tipos.ts`
 *     (`Clube`, `Noticia`, `Jogo`…), em inglês e com os nomes do esquema.
 *
 * O que vive em JSON na base (`SiteConfig.identity`, `teams`, `venues`,
 * `SiteMatchTickets.types`) passa sempre por aqui antes de ser gravado **e**
 * antes de ser lido: um JSON partido não pode chegar a um ecrã, e o recinto
 * do estádio é desenhado, por isso um recinto partido leva a página com ele
 * (ver `recintoValido` em `packages/ui/src/estadio.tsx`, de que isto é o par
 * do lado do servidor).
 */

import { legalValido, type Legal } from "./site-legal";

/**
 * Os dois temas do site: **Tribuna**, claro, com o cabeçalho em dois andares
 * (o site de clube de sempre), e **Holofote**, escuro, com barra lateral e a
 * notícia a toda a largura (o jogo à noite). Chamavam-se "classico" e
 * "porto", e o segundo era o nome de um clube a sério: a migração
 * `20261020150000_site_fase_1` renomeia o que está gravado, e
 * `layoutValido` aceita os nomes antigos enquanto houver algum por aí.
 */
export const LAYOUTS = ["tribuna", "holofote"] as const;
export type Layout = (typeof LAYOUTS)[number];

/** O layout gravado, com os nomes antigos a cair nos novos. Desconhecido é Tribuna. */
export function layoutValido(v: unknown): Layout {
  if (v === "holofote" || v === "porto") return "holofote";
  return "tribuna";
}

export const REDES = ["facebook", "instagram", "youtube", "x", "tiktok"] as const;

/** Um membro da direção, como aparece na página "O clube". */
export type Dirigente = { nome: string; cargo: string };

/** Uma instalação do clube (o estádio, o pavilhão, a sede), com fotografia. */
export type Instalacao = { nome: string; descricao: string; imagem: string };

export type Identidade = {
  lema: string;
  sobre: string;
  historia: string;
  fundacao: string;
  morada: string;
  telefone: string;
  email: string;
  redes: Partial<Record<(typeof REDES)[number], string>>;
  /**
   * A fotografia do clube: o bloco de sócios e a "Área do sócio". Vazio, o
   * site usa a de omissão (uma bancada). Só imagens do próprio clube, no
   * bucket do site: quem grava confere (`SiteService.atualizar`).
   */
  foto: string;
  /** A direção, pela ordem em que o clube a escreveu. Vazia, a página não a mostra. */
  direcao: Dirigente[];
  /** As instalações. As imagens passam pelo mesmo crivo da `foto`. */
  instalacoes: Instalacao[];
  /** Nome legal, NIPC, arbitragem e os textos do clube nas páginas legais. Ver `site-legal.ts`. */
  legal: Legal;
};

/* -------------------------------------------------------------------------- */
/* A página de início                                                           */
/* -------------------------------------------------------------------------- */

/**
 * As secções da página de início que o clube pode ordenar e ligar.
 *
 * O herói (as notícias em destaque) fica sempre no topo: é a abertura do
 * site nos dois layouts, e não é uma secção. O resto vai por esta ordem por
 * omissão, que é a que a AD Fafe tinha; o clube arrasta como quiser.
 */
export const SECCOES_INICIO = ["jogo", "noticias", "equipas", "socios", "banner", "loja", "patrocinadores"] as const;
export type SeccaoInicioKey = (typeof SECCOES_INICIO)[number];

/**
 * O banner: um bloco livre na página de início (uma campanha de sócios, o
 * torneio do verão, um patrocinador). Sem título nem imagem não aparece,
 * mesmo ligado.
 */
export type Banner = { titulo: string; texto: string; imagem: string; botao: string; url: string };

/**
 * Uma secção da página de início. As seis fixas (jogo, notícias, equipas,
 * sócios, loja, patrocinadores) existem uma vez cada; os banners são quantos
 * o clube quiser (até `BANNERS_MAX`), cada um com o seu conteúdo e um `id`
 * seu, para a consola os distinguir ao arrastar.
 */
export type SeccaoInicio = { id: string; key: SeccaoInicioKey; visivel: boolean; banner?: Banner };

/** Quantos banners cabem numa página de início. Acima disto é um site de anúncios. */
export const BANNERS_MAX = 4;

/**
 * `banner` é o primeiro banner da lista, repetido: o site de antes de 20/10
 * lia-o daqui, e um deploy a meio não pode partir a página de início. Sai
 * quando o site em produção já ler os banners das secções.
 */
export type Inicio = { seccoes: SeccaoInicio[]; banner: Banner };

export const BANNER_VAZIO: Banner = { titulo: "", texto: "", imagem: "", botao: "", url: "" };

/** O que cada equipa leva no site. `foto` vazia: a de omissão da modalidade. */
/**
 * `fotos`: as fotografias dos atletas no plantel do site. Desligadas por
 * omissão, e só com a equipa no site: são fotografias de menores, e quem as
 * liga é o clube, com a autorização das famílias (decisão do Rui, 25/10/2026).
 * Desligadas, o plantel mostra a imagem padrão.
 */
/**
 * `resultados`: os resultados dos jogos desta equipa. Há federações que não
 * deixam publicar resultados abaixo de um certo escalão (pedido do Rui,
 * 25/10/2026). Desligados, o site mostra só os próximos jogos, sem marcador,
 * e nenhum jogo já jogado. Ligados por omissão: era assim antes da opção, e
 * quem tem de os esconder sabe em que escalões.
 */
export type EquipaNoSite = { visivel: boolean; plantel: boolean; foto: string; fotos: boolean; resultados: boolean };

export const LADOS = ["norte", "sul", "nascente", "poente", "noroeste", "nordeste", "sudoeste", "sudeste"] as const;
export type Lado = (typeof LADOS)[number];

export type Bancada = { id: string; nome: string; lado: Lado; ordem: number; peso: number; lotacao: number | null; coberta: boolean };
/** Uma porta de entrada e as bancadas que entram por ela. Ver `Porta` em `packages/ui/src/estadio.tsx`. */
export type Porta = { id: string; nome: string; bancadaIds: string[] };
export type Recinto = { id: string; nome: string; tipo: "campo" | "pavilhao"; bancadas: Bancada[]; portas: Porta[] };

/**
 * Para quem é um tipo de bilhete: o público geral, ou os sócios. Com
 * `tierId`, só os sócios dessa categoria; sem ele, qualquer sócio.
 */
export type ParaQuem = "publico" | "socios";

export type TipoDeBilhete = { id: string; nome: string; preco: number; bancadaId: string | null; para: ParaQuem; tierId: string | null };

/* -------------------------------------------------------------------------- */
/* Limpeza                                                                      */
/* -------------------------------------------------------------------------- */

const texto = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const numero = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Só endereços web; o resto (javascript:, data:) não entra num `href`. */
export function urlSegura(v: unknown, max = 500): string {
  const s = texto(v, max);
  return /^https?:\/\/[^\s]+$/i.test(s) ? s : "";
}

export function identidadeValida(v: unknown): Identidade {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const redesIn = (o.redes && typeof o.redes === "object" ? o.redes : {}) as Record<string, unknown>;
  const redes: Identidade["redes"] = {};
  for (const r of REDES) {
    const u = urlSegura(redesIn[r]);
    if (u) redes[r] = u;
  }
  const direcao: Dirigente[] = (Array.isArray(o.direcao) ? o.direcao : [])
    .slice(0, 40)
    .map((d) => {
      const x = (d && typeof d === "object" ? d : {}) as Record<string, unknown>;
      return { nome: texto(x.nome, 80), cargo: texto(x.cargo, 80) };
    })
    .filter((d) => d.nome);
  const instalacoes: Instalacao[] = (Array.isArray(o.instalacoes) ? o.instalacoes : [])
    .slice(0, 12)
    .map((d) => {
      const x = (d && typeof d === "object" ? d : {}) as Record<string, unknown>;
      return { nome: texto(x.nome, 80), descricao: texto(x.descricao, 400), imagem: urlSegura(x.imagem) };
    })
    .filter((d) => d.nome);
  return {
    lema: texto(o.lema, 120),
    sobre: texto(o.sobre, 1200),
    historia: texto(o.historia, 12000),
    fundacao: texto(o.fundacao, 4).replace(/\D/g, ""),
    morada: texto(o.morada, 300),
    telefone: texto(o.telefone, 40),
    email: texto(o.email, 160),
    redes,
    foto: urlSegura(o.foto),
    direcao,
    instalacoes,
    legal: legalValido(o.legal),
  };
}

export function bannerValido(v: unknown): Banner {
  const b = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  return {
    titulo: texto(b.titulo, 120),
    texto: texto(b.texto, 400),
    imagem: urlSegura(b.imagem),
    botao: texto(b.botao, 40),
    url: urlSegura(b.url) || (typeof b.url === "string" && /^\/[a-z0-9\-/?=&]*$/i.test(b.url.trim()) ? b.url.trim().slice(0, 200) : ""),
  };
}

const temConteudo = (b: Banner) => b.titulo !== "" || b.texto !== "" || b.imagem !== "";

/**
 * A página de início: **o que está na lista é o que está na página.**
 *
 * As seis secções fixas podem estar ou não (um clube sem loja tira a loja;
 * outro não quer o bloco de sócios no início), uma vez cada, pela ordem
 * gravada. Os banners são as secções `banner`, cada uma com o seu conteúdo.
 * Uma chave desconhecida cai. Sem nada gravado, a página de origem: as sete,
 * pela ordem de sempre, com um banner vazio.
 *
 * `visivel: false` era "escondida" na primeira versão da consola (20/10, de
 * manhã); a de hoje tira em vez de esconder, por isso uma secção escondida
 * passa a estar fora da lista. O site filtra por `visivel` na mesma, por isso
 * o que sai daqui vem sempre `visivel: true`.
 *
 * Uma página gravada antes de 20/10 tinha um banner só, fora da lista
 * (`banner`): entra como conteúdo do primeiro banner da lista que não tenha
 * o seu, para nenhum clube perder o que escreveu.
 */
export function inicioValido(v: unknown): Inicio {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const fixas = new Set<string>();
  const ids = new Set<string>();
  const seccoes: SeccaoInicio[] = [];
  let banners = 0;
  const gravadas = Array.isArray(o.seccoes);
  for (const s of gravadas ? (o.seccoes as unknown[]).slice(0, 40) : []) {
    const x = (s && typeof s === "object" ? s : {}) as Record<string, unknown>;
    const key = typeof x.key === "string" ? x.key : "";
    if (!(SECCOES_INICIO as readonly string[]).includes(key)) continue;
    if (x.visivel === false) continue;
    if (key === "banner") {
      if (banners >= BANNERS_MAX) continue;
      banners++;
      let id = texto(x.id, 40).replace(/[^a-z0-9-]/gi, "") || `banner-${banners}`;
      while (ids.has(id)) id = `${id}-${banners}`;
      ids.add(id);
      seccoes.push({ id, key: "banner", visivel: true, banner: bannerValido(x.banner) });
      continue;
    }
    if (fixas.has(key)) continue;
    fixas.add(key);
    ids.add(key);
    seccoes.push({ id: key, key: key as SeccaoInicioKey, visivel: true });
  }
  // Sem nada gravado, a página de origem.
  if (!gravadas) {
    for (const key of SECCOES_INICIO) {
      if (key === "banner") seccoes.push({ id: "banner-1", key, visivel: true, banner: { ...BANNER_VAZIO } });
      else seccoes.push({ id: key, key, visivel: true });
    }
    banners = 1;
  }

  // O banner antigo, fora da lista: vai para o primeiro banner sem conteúdo.
  const antigo = bannerValido(o.banner);
  if (temConteudo(antigo)) {
    const vago = seccoes.find((s) => s.key === "banner" && !temConteudo(s.banner!));
    if (vago) vago.banner = antigo;
  }

  const primeiro = seccoes.find((s) => s.key === "banner")?.banner;
  return { seccoes, banner: primeiro ? { ...primeiro } : { ...BANNER_VAZIO } };
}

/**
 * O que cada equipa mostra no site: uma opção só.
 *
 * Ligada, a equipa aparece com tudo (equipa técnica, plantel, jogos e
 * resultados). Desligada, não aparece nada dela. **Desligada por omissão**:
 * uma equipa nova não vai para um site público sem alguém a ligar, porque o
 * plantel publica nomes, e nos escalões de formação são menores.
 *
 * `plantel` fica na forma por compatibilidade com o que já está gravado, e
 * acompanha sempre `visivel`. `foto` é a fotografia da equipa no site.
 */
export function equipasValidas(v: unknown): Record<string, EquipaNoSite> {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const out: Record<string, EquipaNoSite> = {};
  for (const [id, e] of Object.entries(o).slice(0, 500)) {
    if (!id || id.length > 60 || !e || typeof e !== "object") continue;
    const x = e as Record<string, unknown>;
    const visivel = x.visivel === true;
    out[id] = { visivel, plantel: visivel, foto: urlSegura(x.foto), fotos: visivel && x.fotos === true, resultados: x.resultados !== false };
  }
  return out;
}

/**
 * Um jogo de uma equipa com os resultados desligados no site (ver
 * `EquipaNoSite.resultados`): só os que ainda não começaram aparecem, e
 * sempre sem marcador. "esconder" para um jogo já jogado ou com a hora de
 * início passada (um jogo a meio, ou que ninguém marcou como jogado); "limpar"
 * para um jogo por jogar; nulo quando a equipa publica os resultados.
 */
export function semResultado(
  j: { teamId: string; startsAt: Date; status: "SCHEDULED" | "PLAYED" | "CANCELLED" },
  equipas: Record<string, EquipaNoSite>,
  agora: number,
): "esconder" | "limpar" | null {
  if (equipas[j.teamId]?.resultados !== false) return null;
  return j.status === "PLAYED" || j.startsAt.getTime() < agora ? "esconder" : "limpar";
}

export function recintosValidos(v: unknown): Recinto[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, 10).map((r, i) => {
    const o = (r && typeof r === "object" ? r : {}) as Record<string, unknown>;
    const bancadas = Array.isArray(o.bancadas) ? o.bancadas : [];
    const limpas = bancadas.slice(0, 40).map((b, k) => {
      const x = (b && typeof b === "object" ? b : {}) as Record<string, unknown>;
      const lado = (LADOS as readonly string[]).includes(x.lado as string) ? (x.lado as Lado) : "norte";
      const peso = numero(x.peso);
      const lotacao = numero(x.lotacao);
      return {
        id: texto(x.id, 60) || `bancada-${i}-${k}`,
        nome: texto(x.nome, 60) || "Bancada",
        lado,
        ordem: numero(x.ordem) ?? k,
        peso: peso && peso > 0 && peso < 1000 ? peso : 1,
        lotacao: lotacao && lotacao > 0 && lotacao < 200_000 ? Math.round(lotacao) : null,
        coberta: x.coberta === true,
      };
    });
    // As portas só apontam para bancadas deste recinto; uma bancada apagada sai das portas.
    const ids = new Set(limpas.map((b) => b.id));
    const portas = (Array.isArray(o.portas) ? o.portas : []).slice(0, 20).map((p, k) => {
      const x = (p && typeof p === "object" ? p : {}) as Record<string, unknown>;
      const bancadaIds = Array.isArray(x.bancadaIds) ? x.bancadaIds.filter((b): b is string => typeof b === "string" && ids.has(b)) : [];
      return { id: texto(x.id, 60) || `porta-${i}-${k}`, nome: texto(x.nome, 60) || `Porta ${k + 1}`, bancadaIds: [...new Set(bancadaIds)] };
    });
    return {
      id: texto(o.id, 60) || `recinto-${i}`,
      nome: texto(o.nome, 80) || "Recinto",
      tipo: o.tipo === "pavilhao" ? "pavilhao" : "campo",
      bancadas: limpas,
      portas,
    };
  });
}

export type TipoGuardado = { id: string; nome: string; precoCents: number; bancadaId: string | null; para: ParaQuem; tierId: string | null };

/**
 * Os tipos de bilhete, guardados em cêntimos. Cada um é um preço numa
 * bancada para o público geral ou para os sócios (de uma categoria, ou de
 * qualquer uma). Os gravados antes de haver sócios são do público.
 */
export function tiposValidos(v: unknown): TipoGuardado[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, 60).flatMap((t, i) => {
    const o = (t && typeof t === "object" ? t : {}) as Record<string, unknown>;
    const nome = texto(o.nome, 60);
    const preco = numero(o.preco) ?? (numero(o.precoCents) !== null ? numero(o.precoCents)! / 100 : null);
    if (!nome || preco === null || preco < 0 || preco > 10_000) return [];
    const para: ParaQuem = o.para === "socios" ? "socios" : "publico";
    return [
      {
        id: texto(o.id, 60) || `tipo-${i}`,
        nome,
        precoCents: Math.round(preco * 100),
        bancadaId: texto(o.bancadaId, 60) || null,
        para,
        tierId: para === "socios" ? texto(o.tierId, 40) || null : null,
      },
    ];
  });
}

export function tiposParaConsola(v: unknown): TipoDeBilhete[] {
  return tiposValidos(v).map((t) => ({ id: t.id, nome: t.nome, preco: t.precoCents / 100, bancadaId: t.bancadaId, para: t.para, tierId: t.tierId }));
}

/* -------------------------------------------------------------------------- */
/* A loja                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Como a loja entrega. Em cêntimos por dentro (`SiteConfig.shop`); a consola
 * e o site falam em euros, por `lojaParaConsola`.
 *
 * - **Levantamento** no clube: onde (a sede, o bar do pavilhão) e uma nota
 *   (horário). Ligado por omissão: é o que todo o clube pequeno faz.
 * - **Envio** pelo correio: o preço, e a partir de que valor é grátis
 *   (nulo = nunca). Desligado por omissão: quem envia tem de saber o preço.
 * - **Aviso**: uma frase no topo da loja ("As encomendas de dezembro seguem
 *   até dia 20").
 *
 * Sem nenhuma das duas formas de entrega ligada a loja não vende (fica em
 * catálogo), mesmo com pagamentos no clube.
 */
export type Loja = {
  levantamento: { ativo: boolean; local: string; nota: string };
  envio: { ativo: boolean; precoCents: number; gratisAPartirDeCents: number | null; nota: string };
  aviso: string;
};

export const LOJA_POR_OMISSAO: Loja = {
  levantamento: { ativo: true, local: "", nota: "" },
  envio: { ativo: false, precoCents: 0, gratisAPartirDeCents: null, nota: "" },
  aviso: "",
};

/** Aceita cêntimos (`xCents`) ou euros (`x`), como os tipos de bilhete. */
function cents(o: Record<string, unknown>, chave: string): number | null {
  const c = numero(o[`${chave}Cents`]);
  if (c !== null) return Math.max(0, Math.round(c));
  const e = numero(o[chave]);
  return e !== null ? Math.max(0, Math.round(e * 100)) : null;
}

export function lojaValida(v: unknown): Loja {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const l = (o.levantamento && typeof o.levantamento === "object" ? o.levantamento : {}) as Record<string, unknown>;
  const e = (o.envio && typeof o.envio === "object" ? o.envio : {}) as Record<string, unknown>;
  const preco = cents(e, "preco") ?? 0;
  const gratis = cents(e, "gratisAPartirDe");
  return {
    levantamento: {
      ativo: "ativo" in l ? l.ativo === true : LOJA_POR_OMISSAO.levantamento.ativo,
      local: texto(l.local, 160),
      nota: texto(l.nota, 300),
    },
    envio: {
      ativo: e.ativo === true,
      precoCents: Math.min(preco, 1_000_00),
      gratisAPartirDeCents: gratis !== null && gratis > 0 ? Math.min(gratis, 100_000_00) : null,
      nota: texto(e.nota, 300),
    },
    aviso: texto(o.aviso, 200),
  };
}

/** A loja como a consola e o site a leem: em euros. */
export function lojaParaConsola(v: unknown) {
  const l = lojaValida(v);
  return {
    levantamento: l.levantamento,
    envio: { ativo: l.envio.ativo, preco: l.envio.precoCents / 100, gratisAPartirDe: l.envio.gratisAPartirDeCents === null ? null : l.envio.gratisAPartirDeCents / 100, nota: l.envio.nota },
    aviso: l.aviso,
  };
}

/**
 * O stock por tamanho de um produto sem artigo do Inventário:
 * `{ "S": 3, "M": 0 }`, ou `{ "": 12 }` num produto sem tamanhos. Um tamanho
 * que não está aqui vende-se sem contagem; `null` na consola quer dizer isso
 * e não se grava.
 */
export function stockValido(v: unknown): Record<string, number> {
  const o = (v && typeof v === "object" && !Array.isArray(v) ? v : {}) as Record<string, unknown>;
  const out: Record<string, number> = {};
  for (const [tamanho, q] of Object.entries(o).slice(0, 60)) {
    const n = numero(q);
    if (n === null) continue;
    out[tamanho.trim().slice(0, 40)] = Math.max(0, Math.min(1_000_000, Math.round(n)));
  }
  return out;
}

/** Os tamanhos escritos no produto ("S, M, L") como lista, sem repetidos. */
export function tamanhosDoProduto(sizes: string): string[] {
  return [...new Set(sizes.split(",").map((s) => s.trim()).filter(Boolean))].slice(0, 60);
}

/** "Parágrafo um\n\nParágrafo dois" → ["Parágrafo um", "Parágrafo dois"]. */
export function paragrafos(s: string): string[] {
  return s
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s*\n\s*/g, " ").trim())
    .filter(Boolean);
}

/** O domínio como se guarda: minúsculas, sem esquema, sem `www.`, sem caminho. */
export function dominioLimpo(v: string): string {
  return v
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/^www\./, "")
    .replace(/\.$/, "");
}

export function dominioValido(d: string): boolean {
  return d.length <= 200 && /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(d);
}

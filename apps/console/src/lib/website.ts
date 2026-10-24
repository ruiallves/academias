import { useEffect, useSyncExternalStore } from "react";
import { recintoValido, type Recinto } from "@academia/ui/estadio";
import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from "@/lib/http";

export type { Recinto, Bancada, Lado, Porta } from "@academia/ui/estadio";

/**
 * O site do clube, tal como a consola o edita (menu Website). **Só em DEV**,
 * por agora: ver `GRUPO_WEBSITE` em `lib/nav.ts`.
 *
 * ## Grava na API
 *
 * Os dados vivem na API (`/api/site`, ver `apps/api/src/site/`). Este ficheiro
 * guarda uma cópia em memória para o ecrã desenhar, e é por ele que tudo se
 * grava:
 *
 *   - **Na hora**, e o ecrã mostra já o resultado: notícias, produtos,
 *     patrocinadores, bilhetes, publicar o site, o layout.
 *   - **Juntando meio segundo**, o que muda muitas vezes seguidas: arrastar
 *     bancadas, escrever o nome de um patrocinador, os interruptores das
 *     equipas. Um pedido por letra era um pedido por letra.
 *
 * Se o servidor recusar, o erro aparece no cartão de erros (é o `lib/http`
 * que o mostra) e a cópia volta a ser lida do servidor: o ecrã nunca fica a
 * mostrar uma coisa que não ficou gravada. Ver `academia-escritas-locais`.
 */

/** Os temas do site: Tribuna (claro) e Holofote (escuro). Chamavam-se "classico" e "porto" até 20/10/2026. */
export type Layout = "tribuna" | "holofote";

export type Redes = Partial<Record<"facebook" | "instagram" | "youtube" | "x" | "tiktok", string>>;

export type NoticiaDoSite = {
  /** Vazio numa notícia nova, ainda por gravar. */
  id: string;
  titulo: string;
  resumo: string;
  /** Parágrafos separados por uma linha em branco. */
  corpo: string;
  categoria: string;
  imagem: string;
  destaque: boolean;
  estado: "rascunho" | "publicada";
  /** ISO. Posta ao publicar pela primeira vez. */
  publicadaEm: string | null;
};

export type ProdutoDoSite = {
  id: string;
  nome: string;
  categoria: string;
  /** Em euros. */
  preco: number;
  imagem: string;
  descricao: string;
  /** "S, M, L, XL" — vazio num cachecol. */
  tamanhos: string;
  esgotado: boolean;
  visivel: boolean;
  /** A galeria, a seguir à capa (`imagem`). Até 8. */
  imagens: string[];
  /**
   * O stock por tamanho de um produto sem artigo (`{ "M": 3 }`; `{ "": 12 }`
   * num produto sem tamanhos). Um tamanho que não está aqui vende-se sem
   * contagem. Desce sozinho quando uma encomenda é paga.
   */
  stock: Record<string, number>;
  /**
   * O artigo do Inventário que este produto vende. Quando não é nulo, o nome
   * vem do artigo e os tamanhos, o esgotado e o stock saem do artigo: a API
   * ignora-os ao editar. Põe-se à venda na ficha do artigo, não aqui.
   */
  artigoId: string | null;
};

/** Como a loja entrega. Em euros; a API guarda em cêntimos. */
export type LojaConfig = {
  levantamento: { ativo: boolean; local: string; nota: string };
  envio: { ativo: boolean; preco: number; gratisAPartirDe: number | null; nota: string };
  /** Uma frase no topo da loja do site. */
  aviso: string;
};

export const LOJA_VAZIA: LojaConfig = {
  levantamento: { ativo: true, local: "", nota: "" },
  envio: { ativo: false, preco: 0, gratisAPartirDe: null, nota: "" },
  aviso: "",
};

/** A quem um preço se vende: ao público geral, ou aos sócios. */
export type ParaQuem = "publico" | "socios";

/**
 * Um tipo de bilhete: um preço numa bancada para um público. `bancadaId` liga-o
 * a uma bancada do recinto do jogo (é o que deixa quem compra ver no mapa onde
 * vai ficar); nulo = qualquer lugar. Com `para: "socios"`, `tierId` nulo é
 * para qualquer sócio, e com `tierId` só para os sócios dessa categoria.
 */
export type TipoDeBilhete = { id: string; nome: string; preco: number; bancadaId: string | null; para: ParaQuem; tierId: string | null };

export type BilheteiraDoJogo = {
  aberta: boolean;
  /** Em que recinto se joga. Nulo = sem mapa, só a lista de bilhetes. */
  recintoId: string | null;
  lotacao: number | null;
  nota: string;
  tipos: TipoDeBilhete[];
  /** ISO. Desde quando os sócios compram. Nulo = desde que abre. */
  sociosDesde: string | null;
  /** ISO. Desde quando o público compra. Nulo = desde que abre. */
  publicoDesde: string | null;
  /** Só os sócios compram, o público nunca. */
  soSocios: boolean;
  /** ISO. Quando fecha. Nulo = à hora do jogo. */
  fechaEm: string | null;
};

/** Uma categoria de sócio, para as colunas dos preços de sócio. */
export type CategoriaDeSocio = { id: string; nome: string };

export type Patrocinador = { id: string; nome: string; url: string; logo: string };

/** Um membro da direção, como aparece na página "O clube". */
export type Dirigente = { nome: string; cargo: string };

/** Uma instalação do clube (o estádio, o pavilhão, a sede). A imagem vem de `enviarImagem`, como a `foto`. */
export type Instalacao = { nome: string; descricao: string; imagem: string };

export type Identidade = {
  lema: string;
  sobre: string;
  historia: string;
  fundacao: string;
  morada: string;
  telefone: string;
  email: string;
  redes: Redes;
  /** A fotografia do clube (bloco de sócios). Vazia: o site usa uma de bancada. */
  foto: string;
  /** A direção, pela ordem em que o clube a escreveu (máx. 40). Vazia, a página não a mostra. */
  direcao: Dirigente[];
  /** As instalações (máx. 12). */
  instalacoes: Instalacao[];
};

/* -------------------------------------------------------------------------- */
/* A página de início                                                           */
/* -------------------------------------------------------------------------- */

export type SeccaoInicioKey = "jogo" | "noticias" | "equipas" | "socios" | "banner" | "loja" | "patrocinadores";

/** O banner: só aparece com título e imagem ou texto, mesmo com a secção ligada. */
export type Banner = { titulo: string; texto: string; imagem: string; botao: string; url: string };

export const BANNER_VAZIO: Banner = { titulo: "", texto: "", imagem: "", botao: "", url: "" };

/**
 * Uma secção da página de início. As seis fixas existem uma vez cada; os
 * banners são quantos o clube quiser (até `BANNERS_MAX`), cada um com o seu
 * conteúdo e um `id` seu, que é o que o arrastar segura.
 */
export type SeccaoInicio = { id: string; key: SeccaoInicioKey; visivel: boolean; banner?: Banner };

export const BANNERS_MAX = 4;

/**
 * O que cada secção da página de início é, por palavras. A ordem aqui é a de
 * origem; a que conta é a gravada em `inicio.seccoes`. O herói (as notícias
 * em destaque) não é uma secção: fica sempre no topo.
 */
export const SECCOES_INICIO: { key: SeccaoInicioKey; rotulo: string; descricao: string }[] = [
  { key: "jogo", rotulo: "Próximo jogo e último resultado", descricao: "A faixa com o jogo que vem aí e o resultado do último." },
  { key: "noticias", rotulo: "Mais notícias", descricao: "As notícias publicadas a seguir às que estão em destaque." },
  { key: "equipas", rotulo: "Equipas", descricao: "As equipas ligadas na secção Equipas, com ligação à página de cada uma." },
  { key: "socios", rotulo: "Bloco de sócios", descricao: "O convite a ser sócio, com a fotografia do clube." },
  { key: "banner", rotulo: "Banner", descricao: "Um bloco livre: uma campanha, um torneio, um apoio. Podes ter vários, em sítios diferentes." },
  { key: "loja", rotulo: "Loja", descricao: "Os produtos visíveis da loja." },
  { key: "patrocinadores", rotulo: "Patrocinadores", descricao: "Os patrocinadores em faixa. Continuam no rodapé de todas as páginas." },
];

/** `banner` é o primeiro banner da lista, repetido pelo servidor para o site antigo. A consola não lhe mexe. */
export type Inicio = { seccoes: SeccaoInicio[]; banner: Banner };

export function inicioVazio(): Inicio {
  return {
    seccoes: SECCOES_INICIO.map((s) => (s.key === "banner" ? { id: "banner-1", key: s.key, visivel: true, banner: { ...BANNER_VAZIO } } : { id: s.key, key: s.key, visivel: true })),
    banner: { ...BANNER_VAZIO },
  };
}

export type SiteDoClube = {
  slug: string;
  /** O domínio próprio. Só leitura aqui: liga-se no painel da plataforma. */
  dominio: string;
  /** Falso = o site não está no ar (o endereço mostra "não ligado"). */
  publicado: boolean;
  layout: Layout;
  identidade: Identidade;
  /** A página de início: a ordem das secções, o que se mostra, e o banner. */
  inicio: Inicio;
  noticias: NoticiaDoSite[];
  produtos: ProdutoDoSite[];
  /** Os recintos do clube vistos de cima: o estádio, o pavilhão. */
  recintos: Recinto[];
  /** Por id de jogo. Um jogo sem entrada não tem bilheteira. */
  bilheteira: Record<string, BilheteiraDoJogo>;
  /** Por id de equipa. Sem entrada = não aparece; ligada = aparece com tudo (plantel incluído). */
  equipas: Record<string, { visivel: boolean; plantel: boolean; foto?: string }>;
  patrocinadores: Patrocinador[];
  /** Mensagens do formulário de contactos ainda por abrir. A pastilha do submenu. */
  mensagensPorLer: number;
  /** Os preços por omissão da bilheteira, por id de recinto. Um jogo novo começa neles. */
  precosBilheteira: Record<string, TipoDeBilhete[]>;
  /** As categorias de sócio do clube (as não arquivadas), pela ordem do clube. */
  categoriasDeSocio: CategoriaDeSocio[];
  /** A loja: como se entrega e o aviso. */
  loja: LojaConfig;
  /** Encomendas pagas à espera de preparar. A pastilha do submenu. */
  encomendasPorTratar: number;
  /** Os pagamentos do clube estão ligados? Sem eles a loja fica em catálogo. */
  pagamentosLigados: boolean;
};

export function siteVazio(): SiteDoClube {
  return {
    slug: "",
    dominio: "",
    publicado: false,
    layout: "tribuna",
    identidade: {
      lema: "",
      sobre: "",
      historia: "",
      fundacao: "",
      morada: "",
      telefone: "",
      email: "",
      redes: {},
      foto: "",
      direcao: [],
      instalacoes: [],
    },
    inicio: inicioVazio(),
    noticias: [],
    produtos: [],
    recintos: [],
    bilheteira: {},
    equipas: {},
    patrocinadores: [],
    mensagensPorLer: 0,
    precosBilheteira: {},
    categoriasDeSocio: [],
    loja: { ...LOJA_VAZIA, levantamento: { ...LOJA_VAZIA.levantamento }, envio: { ...LOJA_VAZIA.envio } },
    encomendasPorTratar: 0,
    pagamentosLigados: false,
  };
}

/**
 * Um tipo como a consola o desenha. Um servidor de antes das fases e dos
 * preços de sócio mandava só `{ id, nome, preco, bancadaId }`: o que falta é
 * do público geral.
 */
export function tipoNormalizado(t: Partial<TipoDeBilhete> & { id: string; nome: string; preco: number }): TipoDeBilhete {
  const para: ParaQuem = t.para === "socios" ? "socios" : "publico";
  return { id: t.id, nome: t.nome, preco: t.preco, bancadaId: t.bancadaId ?? null, para, tierId: para === "socios" ? (t.tierId ?? null) : null };
}

/** A bilheteira de um jogo com todos os campos, venha de onde vier. */
export function bilheteiraNormalizada(b: Partial<BilheteiraDoJogo> & { aberta: boolean; tipos: TipoDeBilhete[] }): BilheteiraDoJogo {
  return {
    aberta: b.aberta,
    recintoId: b.recintoId ?? null,
    lotacao: b.lotacao ?? null,
    nota: b.nota ?? "",
    tipos: (Array.isArray(b.tipos) ? b.tipos : []).map(tipoNormalizado),
    sociosDesde: b.sociosDesde ?? null,
    publicoDesde: b.publicoDesde ?? null,
    soSocios: b.soSocios === true,
    fechaEm: b.fechaEm ?? null,
  };
}

/* -------------------------------------------------------------------------- */
/* As mensagens do formulário de contactos                                      */
/* -------------------------------------------------------------------------- */

export type MensagemDoSite = {
  id: string;
  nome: string;
  email: string;
  telefone: string;
  assunto: string;
  mensagem: string;
  lida: boolean;
  tratada: boolean;
  /** O nome de quem a deu por tratada. Nulo enquanto não estiver. */
  tratadaPor: string | null;
  /** ISO. */
  tratadaEm: string | null;
  /** ISO. */
  recebidaEm: string;
};

/* -------------------------------------------------------------------------- */
/* A cópia em memória                                                           */
/* -------------------------------------------------------------------------- */

type Estado = { slug: string | null; site: SiteDoClube; carregado: boolean; erro: string | null };

let estado: Estado = { slug: null, site: siteVazio(), carregado: false, erro: null };
let aCarregar: Promise<void> | null = null;
const ouvintes = new Set<() => void>();

function emitir(novo: Partial<Estado>) {
  estado = { ...estado, ...novo };
  ouvintes.forEach((o) => o());
}

function mudarLocal(f: (s: SiteDoClube) => SiteDoClube) {
  emitir({ site: f(estado.site) });
}

/**
 * Os recintos desenham-se, e um recinto partido leva a página com ele: ver
 * `recintoValido`. A identidade e o início completam-se com o vazio, para um
 * servidor antigo (sem `direcao`, sem `inicio`) não deixar um `.map` sem lista.
 */
function normalizar(s: SiteDoClube): SiteDoClube {
  const vazio = siteVazio();
  const layout = s.layout as string;
  return {
    ...vazio,
    ...s,
    // Os nomes antigos dos temas, de um servidor por atualizar, caem nos de hoje.
    layout: layout === "holofote" || layout === "porto" ? "holofote" : "tribuna",
    identidade: { ...vazio.identidade, ...(s.identidade ?? {}) },
    // Um servidor de antes dos vários banners mandava as secções sem `id`: dá-se-lhes um.
    inicio: s.inicio
      ? {
          ...vazio.inicio,
          ...s.inicio,
          seccoes: (s.inicio.seccoes ?? vazio.inicio.seccoes).map((x, i) =>
            x.key === "banner" ? { ...x, id: x.id || `banner-${i}`, banner: x.banner ?? s.inicio.banner ?? { ...BANNER_VAZIO } } : { ...x, id: x.id || x.key },
          ),
        }
      : vazio.inicio,
    recintos: Array.isArray(s.recintos) ? s.recintos.map((r, i) => recintoValido(r, i)) : [],
    // Um servidor de antes das fases da venda e dos preços de sócio não os manda.
    bilheteira: Object.fromEntries(Object.entries(s.bilheteira ?? {}).map(([id, b]) => [id, bilheteiraNormalizada(b)])),
    precosBilheteira: Object.fromEntries(
      Object.entries(s.precosBilheteira && typeof s.precosBilheteira === "object" ? s.precosBilheteira : {}).map(([id, tipos]) => [
        id,
        (Array.isArray(tipos) ? tipos : []).map(tipoNormalizado),
      ]),
    ),
    categoriasDeSocio: Array.isArray(s.categoriasDeSocio) ? s.categoriasDeSocio : [],
    // Um servidor de antes da loja a vender não manda a galeria, o stock nem a entrega.
    produtos: (s.produtos ?? []).map((p) => ({ ...p, imagens: Array.isArray(p.imagens) ? p.imagens : [], stock: p.stock && typeof p.stock === "object" ? p.stock : {} })),
    loja: s.loja ? { ...vazio.loja, ...s.loja, levantamento: { ...vazio.loja.levantamento, ...(s.loja.levantamento ?? {}) }, envio: { ...vazio.loja.envio, ...(s.loja.envio ?? {}) } } : vazio.loja,
    encomendasPorTratar: typeof s.encomendasPorTratar === "number" ? s.encomendasPorTratar : 0,
    pagamentosLigados: s.pagamentosLigados === true,
  };
}

export function carregarSite(slug: string, forcar = false): Promise<void> {
  if (!forcar && estado.slug === slug && (estado.carregado || aCarregar)) return aCarregar ?? Promise.resolve();
  if (estado.slug !== slug) emitir({ slug, site: siteVazio(), carregado: false, erro: null });
  aCarregar = apiGet<SiteDoClube>("/api/site")
    .then((s) => emitir({ site: normalizar(s), carregado: true, erro: null }))
    .catch((e: unknown) => emitir({ carregado: false, erro: e instanceof Error ? e.message : "Não foi possível abrir o site do clube." }))
    .finally(() => {
      aCarregar = null;
    });
  return aCarregar;
}

const subscrever = (o: () => void) => {
  ouvintes.add(o);
  return () => ouvintes.delete(o);
};

/** O site deste clube. Começa a carregar da primeira vez que se pede. */
export function useSite(slug: string): SiteDoClube {
  useEffect(() => {
    void carregarSite(slug);
  }, [slug]);
  return useSyncExternalStore(subscrever, () => estado.site);
}

export function useCarregamentoDoSite(slug: string): { carregado: boolean; erro: string | null } {
  useEffect(() => {
    void carregarSite(slug);
  }, [slug]);
  const carregado = useSyncExternalStore(subscrever, () => estado.carregado);
  const erro = useSyncExternalStore(subscrever, () => estado.erro);
  return { carregado, erro };
}

/** O servidor recusou: volta a ler o que ficou gravado, para o ecrã não mentir. */
function repor() {
  if (estado.slug) void carregarSite(estado.slug, true);
}

/* -------------------------------------------------------------------------- */
/* A configuração (layout, identidade, equipas, recintos, publicar)             */
/* -------------------------------------------------------------------------- */

type Configuracao = Partial<Pick<SiteDoClube, "publicado" | "layout" | "identidade" | "inicio" | "equipas" | "recintos" | "loja">>;

let pendente: Configuracao = {};
let temporizador: ReturnType<typeof setTimeout> | null = null;

/**
 * Muda a configuração. O ecrã muda já; o servidor recebe ao fim de meio
 * segundo sem mais mudanças (ou já, com `imediato`). Várias mudanças nesse
 * meio segundo vão juntas num pedido só.
 */
export function guardarConfig(patch: Configuracao, opts: { imediato?: boolean } = {}): Promise<void> {
  mudarLocal((s) => ({ ...s, ...patch }));
  pendente = { ...pendente, ...patch };
  if (temporizador) clearTimeout(temporizador);
  if (opts.imediato) return enviarConfig();
  return new Promise((ok) => {
    temporizador = setTimeout(() => void enviarConfig().then(ok), 500);
  });
}

async function enviarConfig() {
  temporizador = null;
  const corpo = pendente;
  pendente = {};
  if (Object.keys(corpo).length === 0) return;
  try {
    await apiPatch("/api/site", corpo);
  } catch {
    repor();
  }
}

/* -------------------------------------------------------------------------- */
/* Listas                                                                       */
/* -------------------------------------------------------------------------- */

/** Grava uma notícia (nova se não tiver `id`) e devolve-a como ficou no servidor. */
export async function guardarNoticia(n: NoticiaDoSite): Promise<NoticiaDoSite> {
  const corpo = { titulo: n.titulo, resumo: n.resumo, corpo: n.corpo, categoria: n.categoria, imagem: n.imagem, destaque: n.destaque, estado: n.estado };
  const gravada = n.id ? await apiPatch<NoticiaDoSite>(`/api/site/noticias/${n.id}`, corpo) : await apiPost<NoticiaDoSite>("/api/site/noticias", corpo);
  mudarLocal((s) => ({
    ...s,
    noticias: s.noticias.some((x) => x.id === gravada.id) ? s.noticias.map((x) => (x.id === gravada.id ? gravada : x)) : [gravada, ...s.noticias],
  }));
  return gravada;
}

export async function apagarNoticia(id: string) {
  await apiDelete(`/api/site/noticias/${id}`);
  mudarLocal((s) => ({ ...s, noticias: s.noticias.filter((x) => x.id !== id) }));
}

export async function guardarProduto(p: ProdutoDoSite): Promise<ProdutoDoSite> {
  const corpo = {
    nome: p.nome,
    categoria: p.categoria,
    preco: p.preco,
    imagem: p.imagem,
    imagens: p.imagens,
    descricao: p.descricao,
    tamanhos: p.tamanhos,
    esgotado: p.esgotado,
    visivel: p.visivel,
    stock: p.stock,
  };
  const gravado = p.id ? await apiPatch<ProdutoDoSite>(`/api/site/produtos/${p.id}`, corpo) : await apiPost<ProdutoDoSite>("/api/site/produtos", corpo);
  mudarLocal((s) => ({
    ...s,
    produtos: s.produtos.some((x) => x.id === gravado.id) ? s.produtos.map((x) => (x.id === gravado.id ? gravado : x)) : [...s.produtos, gravado],
  }));
  return gravado;
}

export async function apagarProduto(id: string) {
  await apiDelete(`/api/site/produtos/${id}`);
  mudarLocal((s) => ({ ...s, produtos: s.produtos.filter((x) => x.id !== id) }));
}

export async function guardarPatrocinador(p: Patrocinador): Promise<Patrocinador> {
  const corpo = { nome: p.nome, url: p.url, logo: p.logo };
  const gravado = p.id ? await apiPatch<Patrocinador>(`/api/site/patrocinadores/${p.id}`, corpo) : await apiPost<Patrocinador>("/api/site/patrocinadores", corpo);
  mudarLocal((s) => ({
    ...s,
    patrocinadores: s.patrocinadores.some((x) => x.id === gravado.id)
      ? s.patrocinadores.map((x) => (x.id === gravado.id ? gravado : x))
      : [...s.patrocinadores, gravado],
  }));
  return gravado;
}

const patrocinadoresPendentes = new Map<string, ReturnType<typeof setTimeout>>();

/** Escrever no nome ou no site de um patrocinador: o ecrã muda já, o servidor ao fim de meio segundo. */
export function editarPatrocinadorAdiado(p: Patrocinador) {
  mudarLocal((s) => ({ ...s, patrocinadores: s.patrocinadores.map((x) => (x.id === p.id ? p : x)) }));
  const antes = patrocinadoresPendentes.get(p.id);
  if (antes) clearTimeout(antes);
  patrocinadoresPendentes.set(
    p.id,
    setTimeout(() => {
      patrocinadoresPendentes.delete(p.id);
      const atual = estado.site.patrocinadores.find((x) => x.id === p.id);
      // Um nome vazio não se grava (o servidor recusava); fica à espera de ser escrito.
      if (atual && atual.nome.trim()) void guardarPatrocinador(atual).catch(repor);
    }, 500),
  );
}

export async function apagarPatrocinador(id: string) {
  await apiDelete(`/api/site/patrocinadores/${id}`);
  mudarLocal((s) => ({ ...s, patrocinadores: s.patrocinadores.filter((x) => x.id !== id) }));
}

/**
 * Grava a bilheteira de um jogo. Com `tipos: []` num jogo que ainda não os
 * tem, o servidor copia os preços por omissão do recinto; volta a forma como
 * ficou, e é essa que a cópia guarda.
 */
export async function guardarBilheteira(matchId: string, b: BilheteiraDoJogo): Promise<BilheteiraDoJogo> {
  const gravada = bilheteiraNormalizada(await apiPut<BilheteiraDoJogo>(`/api/site/bilheteira/${matchId}`, b));
  mudarLocal((s) => ({ ...s, bilheteira: { ...s.bilheteira, [matchId]: gravada } }));
  return gravada;
}

/**
 * Os preços por omissão, por recinto: o que um jogo novo nesse recinto traz.
 * Grava todos de uma vez (o servidor substitui), e a cópia fica com o que o
 * servidor devolveu, já limpo das categorias de sócio que deixaram de existir.
 */
export async function guardarPrecos(porRecinto: Record<string, TipoDeBilhete[]>): Promise<Record<string, TipoDeBilhete[]>> {
  const gravados = await apiPut<Record<string, TipoDeBilhete[]>>("/api/site/bilheteira-precos", { porRecinto });
  const limpos = Object.fromEntries(Object.entries(gravados ?? {}).map(([id, tipos]) => [id, (tipos ?? []).map(tipoNormalizado)]));
  mudarLocal((s) => ({ ...s, precosBilheteira: limpos }));
  return limpos;
}

export async function apagarBilheteira(matchId: string) {
  await apiDelete(`/api/site/bilheteira/${matchId}`);
  mudarLocal((s) => {
    const { [matchId]: _fora, ...resto } = s.bilheteira;
    void _fora;
    return { ...s, bilheteira: resto };
  });
}

/* -------------------------------------------------------------------------- */
/* Mensagens                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * As mensagens não vivem na cópia em memória: chegam de fora a qualquer hora,
 * e a lista lê-se de fresco de cada vez que a secção abre. O que fica na cópia
 * é só a contagem das por ler, que é a pastilha do submenu.
 */
export function listarMensagens(): Promise<MensagemDoSite[]> {
  return apiGet<MensagemDoSite[]>("/api/site/mensagens");
}

/**
 * Abrir (`lida`), dar por tratada ou reabrir (`tratada`). Devolve a mensagem
 * como ficou. Uma mensagem que passa a lida baixa a contagem local: a pastilha
 * acompanha sem voltar a pedir o site todo.
 */
export async function mudarMensagem(id: string, patch: { lida?: boolean; tratada?: boolean }, antes?: MensagemDoSite): Promise<MensagemDoSite> {
  const depois = await apiPatch<MensagemDoSite>(`/api/site/mensagens/${id}`, patch);
  const eraPorLer = antes ? !antes.lida : patch.lida === true;
  if (eraPorLer && depois.lida) mudarLocal((s) => ({ ...s, mensagensPorLer: Math.max(0, s.mensagensPorLer - 1) }));
  return depois;
}

export async function apagarMensagem(id: string, antes?: MensagemDoSite) {
  await apiDelete(`/api/site/mensagens/${id}`);
  // Apagar uma mensagem por ler também a tira da pastilha.
  if (antes && !antes.lida) mudarLocal((s) => ({ ...s, mensagensPorLer: Math.max(0, s.mensagensPorLer - 1) }));
}

/* -------------------------------------------------------------------------- */
/* Imagens                                                                      */
/* -------------------------------------------------------------------------- */

export const novoId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2);

/**
 * Carrega uma imagem para o site e devolve o endereço público dela.
 *
 * Reduzida antes de sair (a fotografia de um telemóvel tem 4000 px; uma
 * notícia precisa de 1600, um logótipo de 320) e sempre em WebP, que guarda
 * a transparência dos logótipos. Vai do browser para o armazenamento sem
 * passar pela API, como o símbolo do clube: a API só autoriza.
 */
export async function enviarImagem(ficheiro: File, max = 1600): Promise<string> {
  const reduzida = await imagemReduzida(ficheiro, max);
  const { url, token, publicUrl } = await apiPost<{ url: string; token: string; publicUrl: string }>("/api/site/imagens", {
    contentType: reduzida.type,
  });
  const res = await fetch(url, { method: "PUT", headers: { "Content-Type": reduzida.type, Authorization: `Bearer ${token}` }, body: reduzida });
  if (!res.ok) throw new Error("A imagem não chegou ao armazenamento. Tenta outra vez.");
  return publicUrl;
}

/** A imagem reduzida a `max` píxeis no lado maior, em WebP (ou PNG, num browser sem WebP). */
async function imagemReduzida(ficheiro: File, max: number): Promise<Blob> {
  if (!/^image\/(png|jpeg|webp)$/.test(ficheiro.type)) throw new Error("A imagem tem de ser PNG, JPEG ou WebP.");
  if (ficheiro.size > 20 * 1024 * 1024) throw new Error("A imagem passa de 20 MB. Escolhe uma mais pequena.");
  const bitmap = await createImageBitmap(ficheiro).catch(() => {
    throw new Error("Não foi possível abrir a imagem.");
  });
  const escala = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * escala));
  canvas.height = Math.max(1, Math.round(bitmap.height * escala));
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = (tipo: string) => new Promise<Blob | null>((ok) => canvas.toBlob(ok, tipo, 0.88));
  const webp = await blob("image/webp");
  const final = webp && webp.type === "image/webp" ? webp : await blob("image/png");
  if (!final) throw new Error("Não foi possível preparar a imagem.");
  if (final.size > 5 * 1024 * 1024) throw new Error("A imagem continua grande demais depois de reduzida.");
  return final;
}

/** Onde se vê o site: o domínio do clube, ou a pré-visualização. */
export function enderecoDoSite(slug: string, dominio: string): string {
  return dominio ? `https://${dominio}` : `https://${slug}.website.academias.pt`;
}

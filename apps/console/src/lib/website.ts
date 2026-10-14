import { useEffect, useSyncExternalStore } from "react";
import { recintoValido, type Recinto } from "@academia/ui/estadio";
import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from "@/lib/http";

export type { Recinto, Bancada, Lado } from "@academia/ui/estadio";

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

export type Layout = "classico" | "porto";

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
};

/**
 * Um tipo de bilhete. `bancadaId` liga-o a uma bancada do recinto do jogo:
 * é o que deixa quem compra ver no mapa onde vai ficar. Nulo = qualquer lugar.
 */
export type TipoDeBilhete = { id: string; nome: string; preco: number; bancadaId: string | null };

export type BilheteiraDoJogo = {
  aberta: boolean;
  /** Em que recinto se joga. Nulo = sem mapa, só a lista de bilhetes. */
  recintoId: string | null;
  lotacao: number | null;
  nota: string;
  tipos: TipoDeBilhete[];
};

export type Patrocinador = { id: string; nome: string; url: string; logo: string };

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
};

export type SiteDoClube = {
  slug: string;
  /** O domínio próprio. Só leitura aqui: liga-se no painel da plataforma. */
  dominio: string;
  /** Falso = o site não está no ar (o endereço mostra "não ligado"). */
  publicado: boolean;
  layout: Layout;
  identidade: Identidade;
  noticias: NoticiaDoSite[];
  produtos: ProdutoDoSite[];
  /** Os recintos do clube vistos de cima: o estádio, o pavilhão. */
  recintos: Recinto[];
  /** Por id de jogo. Um jogo sem entrada não tem bilheteira. */
  bilheteira: Record<string, BilheteiraDoJogo>;
  /** Por id de equipa. Sem entrada = não aparece; ligada = aparece com tudo (plantel incluído). */
  equipas: Record<string, { visivel: boolean; plantel: boolean; foto?: string }>;
  patrocinadores: Patrocinador[];
};

export function siteVazio(): SiteDoClube {
  return {
    slug: "",
    dominio: "",
    publicado: false,
    layout: "classico",
    identidade: { lema: "", sobre: "", historia: "", fundacao: "", morada: "", telefone: "", email: "", redes: {}, foto: "" },
    noticias: [],
    produtos: [],
    recintos: [],
    bilheteira: {},
    equipas: {},
    patrocinadores: [],
  };
}

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

/** Os recintos desenham-se, e um recinto partido leva a página com ele: ver `recintoValido`. */
function normalizar(s: SiteDoClube): SiteDoClube {
  return { ...siteVazio(), ...s, recintos: Array.isArray(s.recintos) ? s.recintos.map((r, i) => recintoValido(r, i)) : [] };
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

type Configuracao = Partial<Pick<SiteDoClube, "publicado" | "layout" | "identidade" | "equipas" | "recintos">>;

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
  const corpo = { nome: p.nome, categoria: p.categoria, preco: p.preco, imagem: p.imagem, descricao: p.descricao, tamanhos: p.tamanhos, esgotado: p.esgotado, visivel: p.visivel };
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

export async function guardarBilheteira(matchId: string, b: BilheteiraDoJogo): Promise<BilheteiraDoJogo> {
  const gravada = await apiPut<BilheteiraDoJogo>(`/api/site/bilheteira/${matchId}`, b);
  mudarLocal((s) => ({ ...s, bilheteira: { ...s.bilheteira, [matchId]: gravada } }));
  return gravada;
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

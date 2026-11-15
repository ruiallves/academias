/**
 * Onde vive cada parte do Website na consola.
 *
 * Até 15/11/2026 o Website era uma página só (`/website`) com treze secções
 * num submenu próprio (`?secao=noticias`). Passou a ser um grupo do menu
 * principal com seis páginas, cada uma com os seus separadores:
 *
 *   Site        /website             geral · identidade · aspeto · inicio · dominio · legal
 *   Conteúdo    /website/conteudo    noticias · equipas
 *   Loja        /website/loja        produtos · categorias · codigos · entrega
 *   Encomendas  /website/encomendas
 *   Bilheteira  /website/bilheteira  jogos · anuais · estadio
 *   Mensagens   /website/mensagens
 *
 * As Encomendas eram um separador da Loja; são o trabalho de todos os dias e
 * passaram a página própria. Os Patrocinadores eram um separador do Conteúdo;
 * vivem só em Gestão › Patrocinadores (`/patrocinadores`, a mesma lista), e
 * quem pedir a secção vai para lá (`FORA`).
 *
 * O separador fica sempre em `?secao=` (o F5 e o voltar atrás funcionam, e um
 * link leva direto a ele).
 *
 * ## Os endereços antigos continuam a abrir
 *
 * Há `/website?secao=loja&vista=encomendas` nos emails de encomenda já
 * enviados, `/website?secao=mensagens` nos avisos do formulário e
 * `/website?secao=noticias` nos cartões do Assistente IA guardados na base.
 * A página Site lê esses e passa para o sítio novo (`destinoAntigo`).
 */

export type PaginaDoWebsite = "site" | "conteudo" | "loja" | "encomendas" | "bilheteira" | "mensagens";

export const CAMINHO: Record<PaginaDoWebsite, string> = {
  site: "/website",
  conteudo: "/website/conteudo",
  loja: "/website/loja",
  encomendas: "/website/encomendas",
  bilheteira: "/website/bilheteira",
  mensagens: "/website/mensagens",
};

/** Cada secção de antes (e cada separador de agora): em que página está, e com que `?secao=`. Nulo = o separador por omissão. */
const ONDE: Record<string, [PaginaDoWebsite, string | null]> = {
  geral: ["site", null],
  identidade: ["site", "identidade"],
  aspeto: ["site", "aspeto"],
  inicio: ["site", "inicio"],
  dominio: ["site", "dominio"],
  legal: ["site", "legal"],
  noticias: ["conteudo", null],
  equipas: ["conteudo", "equipas"],
  loja: ["loja", null],
  produtos: ["loja", null],
  encomendas: ["encomendas", null],
  categorias: ["loja", "categorias"],
  codigos: ["loja", "codigos"],
  entrega: ["loja", "entrega"],
  bilheteira: ["bilheteira", null],
  jogos: ["bilheteira", null],
  anuais: ["bilheteira", "anuais"],
  estadio: ["bilheteira", "estadio"],
  mensagens: ["mensagens", null],
};

/** Secções que saíram do Website e vivem noutro menu da consola. */
const FORA: Record<string, string> = {
  patrocinadores: "/patrocinadores",
};

/**
 * Um separador que já não existe na página onde foi pedido
 * (`/website/loja?secao=encomendas`, `/website/conteudo?secao=patrocinadores`):
 * para onde vai. Nulo = fica.
 */
export function separadorQueSaiu(pagina: PaginaDoWebsite, params: URLSearchParams): string | null {
  const secao = params.get("secao");
  if (!secao) return null;
  if (FORA[secao]) return FORA[secao];
  const onde = ONDE[secao];
  return onde && onde[0] !== pagina ? enderecoDaSecao(secao) : null;
}

/**
 * O endereço de uma secção, venha o nome de onde vier (a Visão geral, a
 * Página de início, um cartão do assistente). Um nome desconhecido dá a
 * página Site.
 */
export function enderecoDaSecao(secao: string): string {
  if (FORA[secao]) return FORA[secao];
  const [pagina, separador] = ONDE[secao] ?? ["site", null];
  return separador ? `${CAMINHO[pagina]}?secao=${separador}` : CAMINHO[pagina];
}

/**
 * Um endereço antigo (`/website?secao=…`) que já não é da página Site: para
 * onde vai. Nulo = é da página Site, fica.
 *
 * A Loja tinha as vistas em `&vista=` (`?secao=loja&vista=encomendas`); essa
 * vista passa a ser o separador.
 */
export function destinoAntigo(params: URLSearchParams): string | null {
  const secao = params.get("secao");
  if (!secao) return null;
  if (FORA[secao]) return FORA[secao];
  const onde = ONDE[secao];
  if (!onde || onde[0] === "site") return null;
  if (secao === "loja") {
    // `?secao=loja&vista=encomendas` (emails antigos): a vista é das partes da loja, agora a página Encomendas incluída.
    const vista = params.get("vista");
    if (vista && (ONDE[vista]?.[0] === "loja" || ONDE[vista]?.[0] === "encomendas")) return enderecoDaSecao(vista);
  }
  return enderecoDaSecao(secao);
}

/**
 * A informação legal do site do clube: quem vende, o NIPC, a entidade de
 * resolução alternativa de litígios, e os textos que o clube acrescenta às
 * páginas legais geradas pelo site (privacidade, condições de venda, termos
 * do sócio).
 *
 * Vive dentro de `SiteConfig.identity.legal` (JSON): sem migração. O site
 * gera as páginas com estes dados; o clube só escreve o que é dele.
 *
 * Porquê: com a loja e a bilheteira a vender, o site de um clube é comércio
 * eletrónico. A lei pede a identificação do vendedor (DL 7/2004, art. 10.º),
 * as condições da venda à distância (DL 24/2014), o Livro de Reclamações
 * Eletrónico (DL 74/2017) e a entidade de RAL (Lei 144/2015, art. 18.º). A
 * ligação à plataforma europeia de litígios em linha deixou de ser exigida a
 * 20/07/2025 (Regulamento (UE) 2024/3228), por isso não está aqui.
 */

/**
 * Os centros de arbitragem de conflitos de consumo apoiados pelo Ministério
 * da Justiça, com a área de cada um (gov.pt, consultado a 25/10/2026). O
 * CNIACC é nacional e supletivo: serve onde não há centro regional, e é o de
 * omissão. "outra" deixa o clube escrever a sua (Madeira, Açores, setorial).
 */
export const ENTIDADES_RAL = [
  { key: "cniacc", sigla: "CNIACC", nome: "Centro Nacional de Informação e Arbitragem de Conflitos de Consumo", url: "https://www.cniacc.pt", area: "Todo o país, onde não haja centro regional" },
  { key: "caccl", sigla: "CACCL", nome: "Centro de Arbitragem de Conflitos de Consumo de Lisboa", url: "https://www.centroarbitragemlisboa.pt", area: "Área Metropolitana de Lisboa" },
  { key: "cicap", sigla: "CICAP", nome: "Centro de Informação de Consumo e Arbitragem do Porto", url: "https://www.cicap.pt", area: "Área Metropolitana do Porto" },
  { key: "triave", sigla: "TRIAVE", nome: "Centro de Arbitragem de Conflitos de Consumo do Vale do Ave / Tribunal Arbitral", url: "https://www.triave.pt", area: "Vale do Ave" },
  { key: "ciab", sigla: "CIAB", nome: "Centro de Informação, Mediação e Arbitragem de Consumo / Tribunal Arbitral", url: "https://www.ciab.pt", area: "Braga e Minho" },
  { key: "caccdc", sigla: "CACCDC", nome: "Centro de Arbitragem de Conflitos de Consumo do Distrito de Coimbra", url: "https://www.centrodearbitragemdecoimbra.com", area: "Distrito de Coimbra" },
  { key: "cimaal", sigla: "CIMAAL", nome: "Centro de Informação, Mediação e Arbitragem de Conflitos de Consumo do Algarve", url: "https://www.consumidoronline.pt", area: "Distrito de Faro" },
] as const;

export type EntidadeRalKey = (typeof ENTIDADES_RAL)[number]["key"] | "outra";

/** Os municípios de cada centro regional, para sugerir o centro pela cidade do clube. */
const MUNICIPIOS: Record<Exclude<EntidadeRalKey, "cniacc" | "outra">, string[]> = {
  caccl: ["Alcochete", "Almada", "Amadora", "Barreiro", "Cascais", "Lisboa", "Loures", "Mafra", "Moita", "Montijo", "Odivelas", "Oeiras", "Palmela", "Seixal", "Sesimbra", "Setúbal", "Sintra", "Vila Franca de Xira"],
  // O Vale do Ave e o Minho vêm antes do Porto: Póvoa de Varzim, Vila do Conde, Santo Tirso e Trofa estão nos dois, e o centro de proximidade é o do Ave.
  triave: ["Cabeceiras de Basto", "Fafe", "Guimarães", "Póvoa de Lanhoso", "Póvoa de Varzim", "Santo Tirso", "Trofa", "Vieira do Minho", "Vila do Conde", "Vila Nova de Famalicão", "Vizela"],
  ciab: ["Amares", "Arcos de Valdevez", "Barcelos", "Braga", "Caminha", "Esposende", "Melgaço", "Monção", "Montalegre", "Paredes de Coura", "Ponte da Barca", "Terras de Bouro", "Valença", "Viana do Castelo", "Vila Nova de Cerveira", "Vila Verde"],
  cicap: ["Arouca", "Espinho", "Gondomar", "Maia", "Matosinhos", "Oliveira de Azeméis", "Paredes", "Porto", "Santa Maria da Feira", "São João da Madeira", "Vale de Cambra", "Valongo", "Vila Nova de Gaia"],
  caccdc: ["Arganil", "Cantanhede", "Coimbra", "Condeixa-a-Nova", "Figueira da Foz", "Góis", "Lousã", "Mira", "Miranda do Corvo", "Montemor-o-Velho", "Oliveira do Hospital", "Penacova", "Penela", "Soure", "Tábua", "Vila Nova de Poiares"],
  cimaal: ["Albufeira", "Alcoutim", "Aljezur", "Castro Marim", "Faro", "Lagoa", "Lagos", "Loulé", "Monchique", "Olhão", "Portimão", "São Brás de Alportel", "Silves", "Tavira", "Vila do Bispo", "Vila Real de Santo António"],
};

const semAcentos = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/**
 * O centro que serve a cidade do clube. Só uma sugestão: a cidade gravada é
 * às vezes a freguesia ("Loureiro"), e aí cai no CNIACC, que vale em todo o
 * lado onde não há centro regional. O clube confirma na consola.
 */
export function entidadeSugerida(cidade: string | null | undefined): EntidadeRalKey {
  const c = semAcentos(cidade ?? "");
  if (!c) return "cniacc";
  for (const [key, lista] of Object.entries(MUNICIPIOS)) {
    if (lista.some((m) => semAcentos(m) === c)) return key as EntidadeRalKey;
  }
  return "cniacc";
}

export type Legal = {
  /** A denominação legal ("Clube Desportivo de Loureiro"). Vazia: o nome do clube. */
  nome: string;
  /** O NIPC, 9 algarismos. Vazio até o clube o escrever. */
  nipc: string;
  /** A entidade de RAL escolhida. Vazia: a sugerida pela cidade. */
  ral: EntidadeRalKey | "";
  /** Só com `ral: "outra"`. */
  ralNome: string;
  ralUrl: string;
  /** O que o clube acrescenta aos termos do sócio (quotas, regulamento interno). Parágrafos. */
  termosSocio: string;
  /** Os estatutos ou o regulamento de sócios, se estiverem online. */
  estatutosUrl: string;
  /** O que o clube acrescenta às condições de venda (trocas, prazos próprios). */
  notaVenda: string;
  /** O que o clube acrescenta à política de privacidade. */
  notaPrivacidade: string;
};

export const LEGAL_VAZIO: Legal = { nome: "", nipc: "", ral: "", ralNome: "", ralUrl: "", termosSocio: "", estatutosUrl: "", notaVenda: "", notaPrivacidade: "" };

/** A conta de controlo do NIF/NIPC português. A mesma de `subscription/declaracao.ts`. */
export function nipcValido(nif: string): boolean {
  if (!/^\d{9}$/.test(nif)) return false;
  const d = nif.split("").map(Number);
  const soma = d.slice(0, 8).reduce((s, x, i) => s + x * (9 - i), 0);
  const resto = soma % 11;
  return d[8] === (resto < 2 ? 0 : 11 - resto);
}

const texto = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const url = (v: unknown): string => {
  const s = texto(v, 500);
  return /^https?:\/\/[^\s]+$/i.test(s) ? s : "";
};

/**
 * A limpeza do que chega. Um NIPC que não passa na conta não se grava: um
 * número errado no rodapé de um site que vende é pior do que nenhum.
 */
export function legalValido(v: unknown): Legal {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const nipc = texto(o.nipc, 20).replace(/\D/g, "");
  const chaves = [...ENTIDADES_RAL.map((e) => e.key), "outra"] as string[];
  const ral = typeof o.ral === "string" && chaves.includes(o.ral) ? (o.ral as EntidadeRalKey) : "";
  return {
    nome: texto(o.nome, 160),
    nipc: nipcValido(nipc) ? nipc : "",
    ral,
    ralNome: ral === "outra" ? texto(o.ralNome, 160) : "",
    ralUrl: ral === "outra" ? url(o.ralUrl) : "",
    termosSocio: texto(o.termosSocio, 12000),
    estatutosUrl: url(o.estatutosUrl),
    notaVenda: texto(o.notaVenda, 4000),
    notaPrivacidade: texto(o.notaPrivacidade, 4000),
  };
}

const paragrafos = (s: string) =>
  s
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s*\n\s*/g, " ").trim())
    .filter(Boolean);

/**
 * O que o site público recebe: a entidade de RAL já resolvida (a escolhida,
 * ou a sugerida pela cidade), os textos do clube em parágrafos, e se o clube
 * vende online (é isso que liga a página de condições de venda).
 */
export function legalPublico(l: Legal, cidade: string | null, vendeOnline: boolean) {
  let ral: { nome: string; sigla?: string; url?: string };
  if (l.ral === "outra" && l.ralNome) ral = { nome: l.ralNome, url: l.ralUrl || undefined };
  else {
    const key = l.ral && l.ral !== "outra" ? l.ral : entidadeSugerida(cidade);
    const e = ENTIDADES_RAL.find((x) => x.key === key) ?? ENTIDADES_RAL[0];
    ral = { nome: e.nome, sigla: e.sigla, url: e.url };
  }
  return {
    nome: l.nome || undefined,
    nipc: l.nipc || undefined,
    ral,
    termosSocio: paragrafos(l.termosSocio),
    estatutosUrl: l.estatutosUrl || undefined,
    notaVenda: paragrafos(l.notaVenda),
    notaPrivacidade: paragrafos(l.notaPrivacidade),
    vendeOnline,
  };
}

import type { EntidadeRalKey } from "@/lib/website";

/**
 * Os centros de arbitragem de conflitos de consumo, para o clube escolher o
 * seu. Cópia de `ENTIDADES_RAL` e da sugestão em `api/src/site/site-legal.ts`:
 * mudando lá, muda-se aqui. A API resolve na mesma o que o site mostra; isto
 * é só para a consola sugerir e descrever.
 */
export const ENTIDADES_RAL: { key: Exclude<EntidadeRalKey, "outra">; sigla: string; nome: string; area: string }[] = [
  { key: "cniacc", sigla: "CNIACC", nome: "Centro Nacional de Informação e Arbitragem de Conflitos de Consumo", area: "Todo o país, onde não haja centro regional" },
  { key: "caccl", sigla: "CACCL", nome: "Centro de Arbitragem de Conflitos de Consumo de Lisboa", area: "Área Metropolitana de Lisboa" },
  { key: "cicap", sigla: "CICAP", nome: "Centro de Informação de Consumo e Arbitragem do Porto", area: "Área Metropolitana do Porto" },
  { key: "triave", sigla: "TRIAVE", nome: "Centro de Arbitragem de Conflitos de Consumo do Vale do Ave", area: "Vale do Ave (Guimarães, Fafe, Famalicão…)" },
  { key: "ciab", sigla: "CIAB", nome: "Centro de Informação, Mediação e Arbitragem de Consumo", area: "Braga e Minho" },
  { key: "caccdc", sigla: "CACCDC", nome: "Centro de Arbitragem de Conflitos de Consumo do Distrito de Coimbra", area: "Distrito de Coimbra" },
  { key: "cimaal", sigla: "CIMAAL", nome: "Centro de Arbitragem de Conflitos de Consumo do Algarve", area: "Distrito de Faro" },
];

const MUNICIPIOS: Record<string, string[]> = {
  caccl: ["Alcochete", "Almada", "Amadora", "Barreiro", "Cascais", "Lisboa", "Loures", "Mafra", "Moita", "Montijo", "Odivelas", "Oeiras", "Palmela", "Seixal", "Sesimbra", "Setúbal", "Sintra", "Vila Franca de Xira"],
  triave: ["Cabeceiras de Basto", "Fafe", "Guimarães", "Póvoa de Lanhoso", "Póvoa de Varzim", "Santo Tirso", "Trofa", "Vieira do Minho", "Vila do Conde", "Vila Nova de Famalicão", "Vizela"],
  ciab: ["Amares", "Arcos de Valdevez", "Barcelos", "Braga", "Caminha", "Esposende", "Melgaço", "Monção", "Montalegre", "Paredes de Coura", "Ponte da Barca", "Terras de Bouro", "Valença", "Viana do Castelo", "Vila Nova de Cerveira", "Vila Verde"],
  cicap: ["Arouca", "Espinho", "Gondomar", "Maia", "Matosinhos", "Oliveira de Azeméis", "Paredes", "Porto", "Santa Maria da Feira", "São João da Madeira", "Vale de Cambra", "Valongo", "Vila Nova de Gaia"],
  caccdc: ["Arganil", "Cantanhede", "Coimbra", "Condeixa-a-Nova", "Figueira da Foz", "Góis", "Lousã", "Mira", "Miranda do Corvo", "Montemor-o-Velho", "Oliveira do Hospital", "Penacova", "Penela", "Soure", "Tábua", "Vila Nova de Poiares"],
  cimaal: ["Albufeira", "Alcoutim", "Aljezur", "Castro Marim", "Faro", "Lagoa", "Lagos", "Loulé", "Monchique", "Olhão", "Portimão", "São Brás de Alportel", "Silves", "Tavira", "Vila do Bispo", "Vila Real de Santo António"],
};

const semAcentos = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** O centro que serve a cidade do clube; sem correspondência, o nacional. */
export function entidadeSugerida(cidade: string | null | undefined): Exclude<EntidadeRalKey, "outra"> {
  const c = semAcentos(cidade ?? "");
  if (!c) return "cniacc";
  for (const [key, lista] of Object.entries(MUNICIPIOS)) {
    if (lista.some((m) => semAcentos(m) === c)) return key as Exclude<EntidadeRalKey, "outra">;
  }
  return "cniacc";
}

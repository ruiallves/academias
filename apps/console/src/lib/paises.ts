/**
 * Os países, para o seletor da ficha do atleta.
 *
 * Guarda-se o código ISO 3166-1 alfa-2 ("PT"); o nome vem do browser, em
 * português. Gémea de `apps/api/src/inscricoes/paises.ts`, que acrescenta o
 * código de três letras do boletim da FPF. Os códigos têm de ser os mesmos:
 * o servidor recusa um que não conheça.
 */

const CODIGOS = (
  "AD AE AF AG AI AL AM AO AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BW BY " +
  "BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ " +
  "FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GT GU GW GY HK HN HR HT HU ID IE IL IM IN IQ IR IS " +
  "IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK " +
  "ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL " +
  "PM PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TG " +
  "TH TJ TL TM TN TO TR TT TV TW TZ UA UG US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW"
).split(" ");

/**
 * Os que aparecem primeiro: Portugal e os países de onde mais atletas chegam
 * aos clubes portugueses. O resto segue por ordem alfabética.
 */
const PRIMEIROS = ["PT", "BR", "AO", "CV", "GW", "MZ", "ST", "ES", "FR", "UA"];

function nomeDe(codigo: string): string {
  try {
    return new Intl.DisplayNames(["pt-PT"], { type: "region" }).of(codigo) ?? codigo;
  } catch {
    return codigo;
  }
}

let cache: { codigo: string; nome: string }[] | null = null;

export function paises(): { codigo: string; nome: string }[] {
  if (cache) return cache;
  const todos = CODIGOS.map((codigo) => ({ codigo, nome: nomeDe(codigo) }));
  const primeiros = PRIMEIROS.map((c) => todos.find((p) => p.codigo === c)!).filter(Boolean);
  const resto = todos
    .filter((p) => !PRIMEIROS.includes(p.codigo))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt"));
  cache = [...primeiros, ...resto];
  return cache;
}

export function nomeDoPais(codigo: string | null | undefined): string {
  return codigo ? nomeDe(codigo) : "";
}

/**
 * As associações distritais e regionais, sem o prefixo: "Braga" é a AF Braga
 * numa modalidade de futebol e a AB Braga numa de basquetebol. Gémea de
 * `ASSOCIACOES` em `inscricoes/regras.ts` na API.
 */
export const ASSOCIACOES = [
  "Algarve", "Angra do Heroísmo", "Aveiro", "Beja", "Braga", "Bragança", "Castelo Branco",
  "Coimbra", "Évora", "Guarda", "Horta", "Leiria", "Lisboa", "Madeira", "Ponta Delgada",
  "Portalegre", "Porto", "Santarém", "Setúbal", "Viana do Castelo", "Vila Real", "Viseu",
] as const;

/** Os distritos e as regiões autónomas, para o boletim da FPB. Gémea de `DISTRITOS` na API. */
export const DISTRITOS = [
  "Aveiro", "Beja", "Braga", "Bragança", "Castelo Branco", "Coimbra", "Évora", "Faro", "Guarda", "Leiria",
  "Lisboa", "Portalegre", "Porto", "Santarém", "Setúbal", "Viana do Castelo", "Vila Real", "Viseu",
  "Região Autónoma dos Açores", "Região Autónoma da Madeira",
] as const;

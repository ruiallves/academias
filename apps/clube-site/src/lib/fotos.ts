import { INICIO_POR_OMISSAO, type Clube, type Equipa } from "@/dados/tipos";

/**
 * As fotografias de omissão: o que o site mostra enquanto o clube não carrega
 * as suas (menu Website: a fotografia do clube em Identidade, e uma por equipa
 * em Equipas).
 *
 * Sem elas, os cartões das equipas e o bloco de sócios eram só a cor do clube.
 * São fotografias de banco de imagens de uso livre (licenças Unsplash e
 * Pexels), guardadas em `public/padrao/` e servidas por nós: sem marcas, sem
 * emblemas de clubes e sem caras de crianças. As fontes estão em
 * `public/padrao/FONTES.md`.
 *
 * Várias equipas da mesma modalidade lado a lado levam variantes diferentes:
 * três cartões de futebol com a mesma fotografia pareciam um erro.
 */

const PASTA = "/padrao";

/** A modalidade pelo nome (sem acentos, por conteúdo), e quantas variantes há dela. */
const MODALIDADES: { teste: RegExp; ficheiro: string; variantes: number }[] = [
  // O futsal antes do futebol: "futebol de salão" é futsal.
  { teste: /futsal|salao|futebol\s*de\s*5/, ficheiro: "futsal", variantes: 3 },
  { teste: /futebol|futbol|football|soccer/, ficheiro: "futebol", variantes: 3 },
  { teste: /basquet|basket/, ficheiro: "basquetebol", variantes: 3 },
  { teste: /volei|volley/, ficheiro: "voleibol", variantes: 1 },
  { teste: /natac|swim|polo aquatico/, ficheiro: "natacao", variantes: 1 },
  { teste: /andebol|handball/, ficheiro: "andebol", variantes: 1 },
];

export const FOTO_DO_CLUBE = `${PASTA}/bancada.jpg`;
const FOTO_GENERICA = `${PASTA}/generico.jpg`;

function semAcentos(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** A n-ésima fotografia (0, 1, 2…) da modalidade, a dar a volta às variantes. */
function fotoDaModalidade(sport: string, n: number): string {
  const m = MODALIDADES.find((x) => x.teste.test(semAcentos(sport)));
  if (!m) return FOTO_GENERICA;
  const k = n % m.variantes;
  return `${PASTA}/${m.ficheiro}${k === 0 ? "" : `-${k + 1}`}.jpg`;
}

/**
 * As equipas com fotografia: a do clube, ou a de omissão da modalidade. As
 * equipas sem fotografia da mesma modalidade levam variantes por ordem, para
 * a lista não repetir a mesma imagem seguida.
 */
export function equipasComFoto(equipas: Equipa[]): Equipa[] {
  const vistas = new Map<string, number>();
  return equipas.map((e) => {
    if (e.image) return e;
    const chave = MODALIDADES.find((x) => x.teste.test(semAcentos(e.sport)))?.ficheiro ?? "generico";
    const n = vistas.get(chave) ?? 0;
    vistas.set(chave, n + 1);
    return { ...e, image: fotoDaModalidade(e.sport, n) };
  });
}

/**
 * O clube com a fotografia de omissão e com o `home` garantido: o resto dos
 * campos passa tal como veio. Uma API ainda sem `home` (um deploy a meio)
 * não pode deitar a página de início abaixo: fica a ordem de sempre.
 */
export function clubeComFoto(clube: Clube): Clube {
  return { ...clube, photo: clube.photo || FOTO_DO_CLUBE, home: clube.home ?? INICIO_POR_OMISSAO };
}

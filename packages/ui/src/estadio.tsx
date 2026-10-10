import { useRef, useState, type KeyboardEvent, type PointerEvent as RPointerEvent } from "react";

/**
 * O recinto visto de cima: o campo (ou o pavilhão) ao meio e as bancadas à
 * volta. Um desenho só, partilhado pela consola (onde o clube desenha as
 * bancadas) e pelo site (onde quem compra escolhe onde se senta).
 *
 * ## Paramétrico, não desenhado à mão
 *
 * Um clube não tem um arquitecto à mão para traçar polígonos. O que sabe dizer
 * é "temos a central do lado nascente e um topo a norte, que é dois terços da
 * claque e um terço de visitantes". É isso que se guarda: de que lado fica
 * cada bancada, por que ordem, e quanto do lado ocupa (`peso`). O desenho sai
 * daí.
 *
 * ## Editar arrastando
 *
 * Com `onMudar`, o mapa edita-se com o rato ou o dedo: arrasta-se o separador
 * entre duas bancadas do mesmo lado para mudar quanto cada uma ocupa, e
 * arrasta-se uma bancada para outro lado ou outra posição. Enquanto se
 * arrasta, o mapa já se desenha como vai ficar. Os separadores também se
 * mexem com as setas do teclado.
 *
 * Cores pelas variáveis do tema (`--color-signal-*`), com valores de recurso
 * para o desenho funcionar mesmo fora das apps.
 */

/** Os quatro lados do campo e os quatro cantos. */
export type Lado = "norte" | "sul" | "nascente" | "poente" | "noroeste" | "nordeste" | "sudoeste" | "sudeste";

export type Bancada = {
  id: string;
  nome: string;
  lado: Lado;
  /** A posição dentro do lado, da esquerda para a direita (ou de cima para baixo). */
  ordem: number;
  /**
   * Quanto do lado ocupa, em relação às vizinhas. Duas bancadas com pesos 2 e
   * 1 ficam com dois terços e um terço. Ausente = 1.
   */
  peso?: number;
  lotacao: number | null;
  coberta: boolean;
};

export type Recinto = {
  id: string;
  nome: string;
  tipo: "campo" | "pavilhao";
  bancadas: Bancada[];
};

export const LADOS: { key: Lado; nome: string; curto: string }[] = [
  { key: "norte", nome: "Norte (em cima)", curto: "Norte" },
  { key: "sul", nome: "Sul (em baixo)", curto: "Sul" },
  { key: "poente", nome: "Poente (à esquerda)", curto: "Poente" },
  { key: "nascente", nome: "Nascente (à direita)", curto: "Nascente" },
  { key: "noroeste", nome: "Canto noroeste (em cima, à esquerda)", curto: "Canto NO" },
  { key: "nordeste", nome: "Canto nordeste (em cima, à direita)", curto: "Canto NE" },
  { key: "sudoeste", nome: "Canto sudoeste (em baixo, à esquerda)", curto: "Canto SO" },
  { key: "sudeste", nome: "Canto sudeste (em baixo, à direita)", curto: "Canto SE" },
];

export const eCanto = (l: Lado) => l === "noroeste" || l === "nordeste" || l === "sudoeste" || l === "sudeste";

/* -------------------------------------------------------------------------- */
/* Geometria                                                                    */
/* -------------------------------------------------------------------------- */

const W = 400;
const H = 300;
const CAMPO = { x: 92, y: 74, w: 216, h: 152 };
const FOLGA = 10;
const ESPESSURA = 48;
const VAO = 4;
/** A bancada mais estreita que se deixa fazer arrastando: cabe o nome. */
const MINIMO = 26;

const ORDEM_DOS_LADOS: Lado[] = ["norte", "sul", "poente", "nascente", "noroeste", "nordeste", "sudoeste", "sudeste"];
const peso = (b: Bancada) => (b.peso && b.peso > 0 ? b.peso : 1);
const vertical = (l: Lado) => l === "poente" || l === "nascente";

/**
 * A faixa onde vivem as bancadas de cada sítio: uma tira ao longo de cada
 * lado do campo, e um quadrado em cada canto. As bancadas de um sítio partem
 * a faixa ao comprido (nos cantos, da esquerda para a direita).
 */
function faixa(l: Lado): { x: number; y: number; w: number; h: number } {
  const esq = CAMPO.x - FOLGA - ESPESSURA;
  const dir = CAMPO.x + CAMPO.w + FOLGA;
  const cima = CAMPO.y - FOLGA - ESPESSURA;
  const baixo = CAMPO.y + CAMPO.h + FOLGA;
  switch (l) {
    case "norte": return { x: CAMPO.x, y: cima, w: CAMPO.w, h: ESPESSURA };
    case "sul": return { x: CAMPO.x, y: baixo, w: CAMPO.w, h: ESPESSURA };
    case "poente": return { x: esq, y: CAMPO.y, w: ESPESSURA, h: CAMPO.h };
    case "nascente": return { x: dir, y: CAMPO.y, w: ESPESSURA, h: CAMPO.h };
    case "noroeste": return { x: esq, y: cima, w: ESPESSURA, h: ESPESSURA };
    case "nordeste": return { x: dir, y: cima, w: ESPESSURA, h: ESPESSURA };
    case "sudoeste": return { x: esq, y: baixo, w: ESPESSURA, h: ESPESSURA };
    case "sudeste": return { x: dir, y: baixo, w: ESPESSURA, h: ESPESSURA };
  }
}
/* --- Os cantos: um quarto de anel à volta da esquina do campo ------------- */

/**
 * Num canto a bancada é curva, como nos estádios: um quarto de anel centrado
 * na esquina do campo, entre a bancada do topo e a lateral. Ao longo de um
 * canto as medidas são **ângulos** (em graus, no sentido do SVG, com o y para
 * baixo: 0° a nascente, 90° a sul, 180° a poente, 270° a norte); o resto do
 * código não precisa de saber, porque `a` e `b` de uma forma são sempre "o
 * início e o fim ao longo do sítio", seja em píxeis ou em graus.
 */
const R_DENTRO = FOLGA;
const R_FORA = FOLGA + ESPESSURA;
const R_MEIO = (R_DENTRO + R_FORA) / 2;
const GRAUS = 180 / Math.PI;
/** O vão entre bancadas de um canto, e entre o canto e as faixas vizinhas, em graus. */
const VAO_CANTO = (VAO / R_MEIO) * GRAUS;

const CANTOS: Record<"noroeste" | "nordeste" | "sudoeste" | "sudeste", { cx: number; cy: number; t0: number }> = {
  noroeste: { cx: CAMPO.x, cy: CAMPO.y, t0: 180 },
  nordeste: { cx: CAMPO.x + CAMPO.w, cy: CAMPO.y, t0: 270 },
  sudeste: { cx: CAMPO.x + CAMPO.w, cy: CAMPO.y + CAMPO.h, t0: 0 },
  sudoeste: { cx: CAMPO.x, cy: CAMPO.y + CAMPO.h, t0: 90 },
};
const centroDoCanto = (l: Lado) => CANTOS[l as keyof typeof CANTOS];

/** Um ponto a `r` do centro do canto, no ângulo `t` (graus). */
function noArco(l: Lado, r: number, t: number): { x: number; y: number } {
  const c = centroDoCanto(l);
  return { x: c.cx + r * Math.cos(t / GRAUS), y: c.cy + r * Math.sin(t / GRAUS) };
}

/** O ângulo de um ponto visto do centro de um canto, dentro do quarto desse canto. */
function anguloNoCanto(l: Lado, x: number, y: number): number {
  const c = centroDoCanto(l);
  let t = Math.atan2(y - c.cy, x - c.cx) * GRAUS;
  // Pôr o ângulo na mesma volta que o quarto do canto (o sudeste vai de 0 a 90).
  while (t < c.t0 - 90) t += 360;
  while (t > c.t0 + 180) t -= 360;
  return t;
}

/**
 * O contorno de uma fatia do canto entre os ângulos `a` e `b`.
 *
 * ## Porque é que as pontas não são raios
 *
 * Um quarto de anel puro tem as pontas em raio, e o raio sai inclinado em
 * relação às faixas vizinhas (que acabam numa linha direita): a bancada do
 * canto ficava a fazer cunha contra o topo e a lateral, sem encostar. Aqui a
 * fatia é o anel **cortado por duas linhas direitas**, paralelas às pontas
 * das faixas e a `VAO` delas, e por isso encosta como as bancadas de um lado
 * encostam umas às outras. Por dentro e por fora continua curva. Os cortes
 * entre bancadas do mesmo canto é que são radiais, como os setores de um
 * estádio.
 *
 * Num raio `r`, a linha direita corta o anel a `asin(VAO / r)` da ponta do
 * quarto: é esse o ângulo útil em cada raio, e o contorno faz-se com pontos
 * ao longo dos dois arcos dentro dele.
 */
function contornoDoCanto(l: Lado, a: number, b: number, r1 = R_DENTRO, r2 = R_FORA, g = VAO): { x: number; y: number }[] {
  const t0 = centroDoCanto(l).t0;
  const faixaUtil = (r: number) => {
    const d = Math.asin(Math.min(1, g / r)) * GRAUS;
    let s = Math.max(a, t0 + d);
    let e = Math.min(b, t0 + 90 - d);
    // Uma fatia estreita junto à ponta pode não chegar ao arco de dentro:
    // fica um ponto só, e a fatia fecha em bico.
    if (s > e) s = e = Math.min(Math.max((a + b) / 2, t0 + d), t0 + 90 - d);
    return { s, e };
  };
  const arco = (r: number, s: number, e: number, passos: number) =>
    Array.from({ length: passos + 1 }, (_, i) => noArco(l, r, s + ((e - s) * i) / passos));
  const fora = faixaUtil(r2);
  const dentro = faixaUtil(r1);
  return [...arco(r2, fora.s, fora.e, 16), ...arco(r1, dentro.s, dentro.e, 8).reverse()];
}

function caminhoDe(pts: { x: number; y: number }[], ox: number, oy: number): string {
  return `${pts.map((p, i) => `${i ? "L" : "M"}${(p.x - ox).toFixed(2)} ${(p.y - oy).toFixed(2)}`).join(" ")} Z`;
}

function caixaDe(pts: { x: number; y: number }[]): { x: number; y: number; w: number; h: number } {
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** O caminho de uma fatia do canto, relativo a (ox, oy). */
function caminhoDoArco(l: Lado, a: number, b: number, ox: number, oy: number, r1 = R_DENTRO, r2 = R_FORA, g = VAO): string {
  return caminhoDe(contornoDoCanto(l, a, b, r1, r2, g), ox, oy);
}

/** A caixa que contém uma fatia do canto: para posicionar, arrastar e escrever. */
function caixaDoArco(l: Lado, a: number, b: number): { x: number; y: number; w: number; h: number } {
  return caixaDe(contornoDoCanto(l, a, b));
}

/**
 * Quanto texto cabe numa fatia de canto, em linha reta.
 *
 * O texto vai direito e o canto é curvo: medir o arco dava espaço a mais, e
 * as pontas do texto saíam pela curva. Mede-se o segmento reto, tangente a
 * meio do anel, que cabe ao mesmo tempo dentro do anel (com uma linha de
 * folga para as duas linhas de texto) e entre as pontas da fatia.
 */
function espacoNoCanto(l: Lado, a: number, b: number): number {
  const fora = contornoDoCanto(l, a, b);
  // O ângulo útil por fora (as pontas direitas já descontadas).
  const ini = anguloNoCanto(l, fora[0].x, fora[0].y);
  const fim = anguloNoCanto(l, fora[16].x, fora[16].y);
  const meia = Math.max(0, (fim - ini) / 2 - 4) / GRAUS;
  const rc = R_MEIO;
  const pelaCurva = Math.sqrt(Math.max(0, (R_FORA - 3) ** 2 - (rc + 9) ** 2));
  const pelasPontas = rc * Math.tan(meia);
  return Math.max(0, 2 * Math.min(pelaCurva, pelasPontas) - 4);
}

/**
 * Um texto ajustado a `espaco`: primeiro encolhe a letra até `minimo`, e só
 * depois corta com reticências. `largura` é a largura média de um carácter
 * em frações do tamanho da letra (mais larga em negrito).
 */
function caber(texto: string, espaco: number, base: number, minimo: number, largura: number): { texto: string; tamanho: number } {
  const precisa = texto.length * largura;
  const tamanho = Math.max(minimo, Math.min(base, espaco / Math.max(precisa, 0.01)));
  const cabem = Math.floor(espaco / (tamanho * largura));
  if (cabem >= texto.length) return { texto, tamanho };
  return { texto: cabem <= 1 ? "" : `${texto.slice(0, Math.max(1, cabem - 1)).trimEnd()}…`, tamanho };
}

// Num canto o comprimento é o quarto inteiro: as pontas já ficam afastadas
// das faixas vizinhas pelo corte direito (ver `contornoDoCanto`).
const comprimentoDoLado = (l: Lado) => (eCanto(l) ? 90 : vertical(l) ? faixa(l).h : faixa(l).w);
const inicioDoLado = (l: Lado) => (eCanto(l) ? centroDoCanto(l).t0 : vertical(l) ? faixa(l).y : faixa(l).x);
const vaoDoLado = (l: Lado) => (eCanto(l) ? VAO_CANTO : VAO);
/** A bancada mais estreita que se deixa fazer arrastando (nos cantos, em graus). */
const minimoDoLado = (l: Lado) => (eCanto(l) ? (12 / R_MEIO) * GRAUS : MINIMO);

export type Forma = {
  bancada: Bancada;
  x: number;
  y: number;
  w: number;
  h: number;
  vertical: boolean;
  /** Início e fim ao longo do sítio: píxeis num lado, graus num canto. */
  a: number;
  b: number;
  /** Só nos cantos: o caminho da fatia de anel, relativo a (x, y). */
  arco?: string;
};

/** As bancadas de um lado, pela ordem. */
export function doLado(recinto: Recinto, lado: Lado): Bancada[] {
  return recinto.bancadas.filter((b) => b.lado === lado).sort((a, b) => a.ordem - b.ordem);
}

/** Onde fica cada bancada no desenho. `a` e `b` são o início e o fim ao longo do lado. */
export function formas(recinto: Recinto): Forma[] {
  const out: Forma[] = [];
  for (const lado of ORDEM_DOS_LADOS) {
    const lista = doLado(recinto, lado);
    if (!lista.length) continue;
    const v = vertical(lado);
    const vao = vaoDoLado(lado);
    const util = comprimentoDoLado(lado) - vao * (lista.length - 1);
    const soma = lista.reduce((s, b) => s + peso(b), 0);
    let cursor = inicioDoLado(lado);
    const base = faixa(lado);
    for (const b of lista) {
      const len = (util * peso(b)) / soma;
      const a = cursor;
      const fim = cursor + len;
      cursor = fim + vao;
      if (eCanto(lado)) {
        const caixa = caixaDoArco(lado, a, fim);
        out.push({ bancada: b, ...caixa, vertical: false, a, b: fim, arco: caminhoDoArco(lado, a, fim, caixa.x, caixa.y) });
        continue;
      }
      out.push(
        v
          ? { bancada: b, x: base.x, y: a, w: base.w, h: len, vertical: v, a, b: fim }
          : { bancada: b, x: a, y: base.y, w: len, h: base.h, vertical: v, a, b: fim },
      );
    }
  }
  return out;
}

/** A fração do lado que esta bancada ocupa, de 0 a 1. */
export function fracaoNoLado(recinto: Recinto, id: string): number {
  const b = recinto.bancadas.find((x) => x.id === id);
  if (!b) return 0;
  const lista = doLado(recinto, b.lado);
  return peso(b) / lista.reduce((s, x) => s + peso(x), 0);
}

/**
 * Põe a bancada a ocupar `fracao` do lado, e reparte o resto pelas outras na
 * proporção em que já estavam. Os pesos ficam a somar o número de bancadas,
 * para não crescerem nem encolherem sem fim de edição em edição.
 */
export function comFracao(recinto: Recinto, id: string, fracao: number): Recinto {
  const b = recinto.bancadas.find((x) => x.id === id);
  if (!b) return recinto;
  const lista = doLado(recinto, b.lado);
  if (lista.length < 2) return recinto;
  const util = comprimentoDoLado(b.lado) - vaoDoLado(b.lado) * (lista.length - 1);
  const minF = Math.min(minimoDoLado(b.lado) / util, 1 / lista.length);
  const f = Math.min(1 - minF * (lista.length - 1), Math.max(minF, fracao));
  const outras = lista.filter((x) => x.id !== id);
  const somaOutras = outras.reduce((s, x) => s + peso(x), 0);
  const n = lista.length;
  const novos = new Map<string, number>([[id, f * n]]);
  for (const x of outras) novos.set(x.id, ((1 - f) * n * peso(x)) / somaOutras);
  return { ...recinto, bancadas: recinto.bancadas.map((x) => (novos.has(x.id) ? { ...x, peso: arred(novos.get(x.id)!) } : x)) };
}

/** Muda a bancada para o lado `lado`, na posição `indice` entre as que lá estão. */
export function moverBancada(recinto: Recinto, id: string, lado: Lado, indice: number): Recinto {
  const b = recinto.bancadas.find((x) => x.id === id);
  if (!b) return recinto;
  const destino = doLado(recinto, lado).filter((x) => x.id !== id);
  const i = Math.max(0, Math.min(destino.length, indice));
  // Noutro lado, entra com o tamanho médio das que lá estão: o peso que trazia
  // era relativo às vizinhas antigas e não quer dizer nada ao pé das novas.
  const pesoNovo = lado === b.lado ? peso(b) : destino.length ? destino.reduce((s, x) => s + peso(x), 0) / destino.length : 1;
  const novaOrdem = [...destino.slice(0, i), { ...b, lado, peso: arred(pesoNovo) }, ...destino.slice(i)];
  const origem = lado === b.lado ? [] : doLado(recinto, b.lado).filter((x) => x.id !== id);
  const porId = new Map<string, Bancada>();
  novaOrdem.forEach((x, k) => porId.set(x.id, { ...x, ordem: k }));
  origem.forEach((x, k) => porId.set(x.id, { ...x, ordem: k }));
  return { ...recinto, bancadas: recinto.bancadas.map((x) => porId.get(x.id) ?? x) };
}

const arred = (v: number) => Math.round(v * 1000) / 1000;

/** O lado e a posição para onde um ponto do desenho manda uma bancada arrastada. */
function destinoDoPonto(recinto: Recinto, id: string, x: number, y: number): { lado: Lado; indice: number } {
  // Nos cantos: o ponto está fora do campo nas duas direcções ao mesmo tempo.
  const foraX = x < CAMPO.x - FOLGA / 2 ? "o" : x > CAMPO.x + CAMPO.w + FOLGA / 2 ? "e" : null;
  const foraY = y < CAMPO.y - FOLGA / 2 ? "n" : y > CAMPO.y + CAMPO.h + FOLGA / 2 ? "s" : null;
  const nx = (x - W / 2) / (CAMPO.w / 2 + FOLGA + ESPESSURA / 2);
  const ny = (y - H / 2) / (CAMPO.h / 2 + FOLGA + ESPESSURA / 2);
  const lado: Lado =
    foraX && foraY
      ? (({ no: "noroeste", ne: "nordeste", so: "sudoeste", se: "sudeste" }) as const)[`${foraY === "n" ? "n" : "s"}${foraX}` as "no" | "ne" | "so" | "se"]
      : Math.abs(ny) >= Math.abs(nx)
        ? ny < 0
          ? "norte"
          : "sul"
        : nx < 0
          ? "poente"
          : "nascente";
  const eixo = eCanto(lado) ? anguloNoCanto(lado, x, y) : vertical(lado) ? y : x;
  const outras = formas(recinto).filter((f) => f.bancada.lado === lado && f.bancada.id !== id);
  const indice = outras.filter((f) => (f.a + f.b) / 2 < eixo).length;
  return { lado, indice };
}

/** A faixa de um lado inteiro, para acender o destino de uma bancada arrastada. */
function faixaDoLado(lado: Lado): { x: number; y: number; w: number; h: number } {
  const m = 3;
  const f = faixa(lado);
  return { x: f.x - m, y: f.y - m, w: f.w + 2 * m, h: f.h + 2 * m };
}

/* -------------------------------------------------------------------------- */
/* Desenho                                                                      */
/* -------------------------------------------------------------------------- */

export type EstadoDaBancada = "ativa" | "inativa";

type Arrasto =
  | { tipo: "bancada"; id: string; x0: number; y0: number; px: number; py: number; moveu: boolean; lado: Lado; previa: Recinto }
  | { tipo: "separador"; antes: string; depois: string; previa: Recinto };

/** A curva de todos os movimentos do mapa: sai depressa, pousa devagar. */
const CURVA = "cubic-bezier(0.2, 0, 0, 1)";
const DURACAO = 240;

/**
 * O mapa.
 *
 * ## A animação de arrastar
 *
 * Cada bancada é desenhada na origem e posta no sítio com um `transform` em
 * CSS, e o retângulo tem a largura e a altura também em CSS. É isso que deixa
 * as vizinhas **deslizar** para abrir espaço quando outra passa por cima, e o
 * lugar de destino crescer e encolher, em vez de saltar de posição.
 *
 * A bancada que se arrasta sai do desenho e é desenhada à parte, por cima de
 * tudo: levantada (maior, com sombra) e presa ao ponteiro, sem transição para
 * não ficar para trás do dedo. No lugar onde vai cair fica o contorno a
 * tracejado, e o lado de destino acende. Ao largar, a bancada aparece no
 * lugar marcado com uma pequena pulsação.
 *
 * O separador é o contrário: segue o ponteiro sem atraso nenhum, porque é
 * uma régua, e uma régua com mola é imprecisa.
 *
 * Em `prefers-reduced-motion` não há transições: tudo muda de uma vez.
 */
export function MapaDoRecinto({
  recinto,
  estado = () => "ativa",
  rotulo,
  selecionada,
  onEscolher,
  onMudar,
  className,
  titulo,
}: {
  recinto: Recinto;
  /** `inativa` = sem bilhetes neste jogo: cinzenta e não se escolhe. */
  estado?: (b: Bancada) => EstadoDaBancada;
  /** Uma segunda linha por baixo do nome: "desde 5 €", "1 200 lugares". */
  rotulo?: (b: Bancada) => string | undefined;
  selecionada?: string | null;
  /** Sem isto o mapa é só para ver. */
  onEscolher?: (id: string) => void;
  /** Com isto o mapa edita-se arrastando: ver o cabeçalho deste ficheiro. */
  onMudar?: (r: Recinto) => void;
  className?: string;
  titulo?: string;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [arrasto, setArrasto] = useState<Arrasto | null>(null);
  /** A bancada que acabou de pousar, para a pulsação de chegada. */
  const [pousada, setPousada] = useState<string | null>(null);
  const editavel = !!onMudar;

  // Enquanto se arrasta, desenha-se a prévia; ao largar, grava-se.
  const visto = arrasto?.previa ?? recinto;
  const lista = formas(visto);
  const pavilhao = recinto.tipo === "pavilhao";

  const aArrastar = arrasto?.tipo === "bancada" && arrasto.moveu ? arrasto : null;
  const animar = arrasto?.tipo !== "separador";
  /*
   * As transições como lista, juntas no fim. `none` não pode entrar numa
   * lista (`none, fill 150ms` é inválido e o browser deita a regra inteira
   * fora, ficando com a anterior): sem geometria animada, a lista leva só o
   * que sobra.
   */
  const geometria = animar ? [`transform ${DURACAO}ms ${CURVA}`, `width ${DURACAO}ms ${CURVA}`, `height ${DURACAO}ms ${CURVA}`] : [];
  const transicao = (...mais: string[]) => [...geometria, ...mais].join(", ") || "none";

  /** Do ecrã para as coordenadas do desenho. */
  const ponto = (e: RPointerEvent): { x: number; y: number } => {
    const svg = svgRef.current!;
    const m = svg.getScreenCTM();
    if (!m) return { x: 0, y: 0 };
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  };

  const comecarBancada = (e: RPointerEvent<SVGGElement>, b: Bancada) => {
    if (!editavel || e.button !== 0) return;
    const p = ponto(e);
    svgRef.current?.setPointerCapture(e.pointerId);
    setArrasto({ tipo: "bancada", id: b.id, x0: p.x, y0: p.y, px: p.x, py: p.y, moveu: false, lado: b.lado, previa: recinto });
  };

  const comecarSeparador = (e: RPointerEvent<SVGRectElement>, antes: string, depois: string) => {
    if (!editavel || e.button !== 0) return;
    e.stopPropagation();
    svgRef.current?.setPointerCapture(e.pointerId);
    setArrasto({ tipo: "separador", antes, depois, previa: recinto });
  };

  const mover = (e: RPointerEvent<SVGSVGElement>) => {
    if (!arrasto) return;
    const p = ponto(e);
    if (arrasto.tipo === "bancada") {
      const moveu = arrasto.moveu || Math.hypot(p.x - arrasto.x0, p.y - arrasto.y0) > 6;
      if (!moveu) return;
      const { lado, indice } = destinoDoPonto(recinto, arrasto.id, p.x, p.y);
      setArrasto({ ...arrasto, px: p.x, py: p.y, moveu: true, lado, previa: moverBancada(recinto, arrasto.id, lado, indice) });
      return;
    }
    // Separador: a fronteira entre as duas segue o ponteiro, e as duas
    // repartem entre si o espaço que já tinham. As outras não mexem.
    const fs = formas(recinto);
    const fa = fs.find((f) => f.bancada.id === arrasto.antes);
    const fb = fs.find((f) => f.bancada.id === arrasto.depois);
    if (!fa || !fb) return;
    const ladoSep = fa.bancada.lado;
    // Num canto a fronteira anda em graus, à volta da esquina do campo.
    const eixo = eCanto(ladoSep) ? anguloNoCanto(ladoSep, p.x, p.y) : fa.vertical ? p.y : p.x;
    const min = minimoDoLado(ladoSep);
    const vao = vaoDoLado(ladoSep);
    const fronteira = Math.min(fb.b - min, Math.max(fa.a + min, eixo - vao / 2));
    const lenA = fronteira - fa.a;
    const lenB = fb.b - (fronteira + vao);
    const soma = peso(fa.bancada) + peso(fb.bancada);
    const pa = (soma * lenA) / (lenA + lenB);
    const previa = {
      ...recinto,
      bancadas: recinto.bancadas.map((x) =>
        x.id === fa.bancada.id ? { ...x, peso: arred(pa) } : x.id === fb.bancada.id ? { ...x, peso: arred(soma - pa) } : x,
      ),
    };
    setArrasto({ ...arrasto, previa });
  };

  const largar = () => {
    if (!arrasto) return;
    if (arrasto.tipo === "bancada" && !arrasto.moveu) onEscolher?.(arrasto.id);
    else if (arrasto.previa !== recinto) onMudar?.(arrasto.previa);
    if (arrasto.tipo === "bancada" && arrasto.moveu) {
      setPousada(arrasto.id);
      setTimeout(() => setPousada((v) => (v === arrasto.id ? null : v)), 450);
    }
    setArrasto(null);
  };

  const teclaBancada = (e: KeyboardEvent<SVGGElement>, id: string) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onEscolher?.(id);
    }
  };

  /** As setas mexem o separador 5% do lado de cada vez. */
  const teclaSeparador = (e: KeyboardEvent<SVGRectElement>, antes: string) => {
    const mais = e.key === "ArrowRight" || e.key === "ArrowDown";
    const menos = e.key === "ArrowLeft" || e.key === "ArrowUp";
    if (!mais && !menos) return;
    e.preventDefault();
    onMudar?.(comFracao(recinto, antes, fracaoNoLado(recinto, antes) + (mais ? 0.05 : -0.05)));
  };

  // Os separadores: um entre cada par de bancadas vizinhas do mesmo lado. Não
  // aparecem enquanto se arrasta uma bancada, que só atrapalhavam o alvo.
  const separadores: { antes: Forma; depois: Forma }[] = [];
  if (editavel && !aArrastar) {
    for (const lado of ORDEM_DOS_LADOS) {
      const doEste = lista.filter((f) => f.bancada.lado === lado);
      for (let i = 0; i < doEste.length - 1; i++) separadores.push({ antes: doEste[i], depois: doEste[i + 1] });
    }
  }

  /** Uma bancada desenhada: o retângulo, a faixa de cobertura e o texto. */
  const corpo = (f: Forma, cores: { fundo: string; traco: string; tinta: string; espessura: number }, linha2?: string) => {
    const { bancada: b, w, h, vertical: v } = f;
    const canto = eCanto(b.lado);
    // Num canto o texto segue a curva: vai ao meio do anel, deitado ao longo do arco.
    const meioDoArco = canto ? (f.a + f.b) / 2 : 0;
    const centroTexto = canto ? noArco(b.lado, R_MEIO, meioDoArco) : null;
    const tx = centroTexto ? centroTexto.x - f.x : w / 2;
    const ty = centroTexto ? centroTexto.y - f.y : h / 2;
    const espaco = canto ? espacoNoCanto(b.lado, f.a, f.b) : (v ? h : w) - 10;
    const titulo = caber(b.nome || "Sem nome", espaco, 10, 7, 0.62);
    const sub = linha2 ? caber(linha2, espaco, 8.5, 6.5, 0.56) : null;
    // A segunda linha só fica se disser alguma coisa: "3…" não ajuda ninguém.
    const segunda = sub && sub.texto.length >= 4 ? sub : null;
    let angulo = canto ? meioDoArco + 90 : v ? (b.lado === "poente" ? -90 : 90) : 0;
    // De pernas para o ar não se lê: volta-se meia volta.
    while (angulo > 90) angulo -= 180;
    while (angulo < -90) angulo += 180;
    const rodar = angulo ? ` rotate(${angulo.toFixed(1)}deg)` : "";
    return (
      <>
        {f.arco ? (
          <path
            className="forma"
            d={f.arco}
            fill={cores.fundo}
            stroke={cores.traco}
            strokeWidth={cores.espessura}
            strokeLinejoin="round"
            style={{ transition: "fill 150ms, stroke-width 150ms" }}
          />
        ) : (
          <rect
            className="forma"
            x={0}
            y={0}
            width={w}
            height={h}
            rx="6"
            fill={cores.fundo}
            stroke={cores.traco}
            strokeWidth={cores.espessura}
            style={{ width: w, height: h, transition: transicao("fill 150ms", "stroke-width 150ms") }}
          />
        )}
        {b.coberta && !canto && (
          <rect
            x={0}
            y={0}
            width={v ? 5 : w}
            height={v ? h : 5}
            rx="2"
            fill={cores.traco}
            fillOpacity="0.5"
            aria-hidden
            style={{
              width: v ? 5 : w,
              height: v ? h : 5,
              transform: `translate(${b.lado === "nascente" ? w - 5 : 0}px, ${b.lado === "sul" ? h - 5 : 0}px)`,
              transition: transicao(),
            }}
          />
        )}
        <g pointerEvents="none" style={{ transform: `translate(${tx}px, ${ty}px)${rodar}`, transition: animar && !canto ? `transform ${DURACAO}ms ${CURVA}` : "none" }}>
          <text x={0} y={segunda ? -2 : titulo.tamanho * 0.35} textAnchor="middle" fontSize={titulo.tamanho} fontWeight="700" fill={cores.tinta}>
            {titulo.texto}
          </text>
          {segunda && (
            <text x={0} y={2 + segunda.tamanho} textAnchor="middle" fontSize={segunda.tamanho} fill={cores.tinta} fillOpacity="0.85">
              {segunda.texto}
            </text>
          )}
        </g>
      </>
    );
  };

  const fantasma = aArrastar ? lista.find((f) => f.bancada.id === aArrastar.id) : null;

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${W} ${H}`}
      className={className}
      role="group"
      aria-label={titulo ?? `Mapa de ${recinto.nome}`}
      onPointerMove={mover}
      onPointerUp={largar}
      onPointerCancel={() => setArrasto(null)}
      style={{ touchAction: editavel ? "none" : undefined, userSelect: "none", overflow: "visible" }}
    >
      {/* O foco do teclado, o realce e as animações: aqui e não em classes do
          Tailwind, porque o pacote não entra no varrimento de nenhuma app. */}
      <style>{`
        .mapa-bancada:focus-visible .forma { stroke-width: 3.5; }
        .mapa-bancada[role="button"]:not([aria-disabled]):hover .forma { stroke-width: 2.2; }
        .mapa-separador { cursor: var(--cursor-sep); }
        .mapa-separador > .pega { opacity: .55; transition: opacity 120ms; }
        .mapa-separador:hover > .pega, .mapa-separador[data-ativo] > .pega { opacity: 1; }
        .mapa-separador > [role="separator"]:focus { outline: none; }
        .mapa-separador > [role="separator"]:focus-visible + .pega { opacity: 1; stroke: var(--color-signal-line, #0f6b62); stroke-width: 2.5; }
        .mapa-bancada:focus { outline: none; }
        .mapa-lugar { animation: mapa-tracejado 0.8s linear infinite; }
        .mapa-fantasma { animation: mapa-levantar 160ms ${CURVA} both; }
        .mapa-pousou { animation: mapa-pousar 420ms ${CURVA}; transform-box: fill-box; transform-origin: center; }
        .mapa-faixa { animation: mapa-acender 180ms ease-out both; }
        @keyframes mapa-tracejado { to { stroke-dashoffset: -12; } }
        @keyframes mapa-levantar { from { opacity: .4; } to { opacity: 1; } }
        @keyframes mapa-pousar { 0% { transform: scale(1.06); } 60% { transform: scale(.98); } 100% { transform: scale(1); } }
        @keyframes mapa-acender { from { opacity: 0; } to { opacity: 1; } }
        @media (prefers-reduced-motion: reduce) {
          .mapa-raiz * { transition: none !important; animation: none !important; }
        }
      `}</style>
      <defs>
        <filter id="mapa-sombra" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="4" stdDeviation="4" floodColor="#1a1917" floodOpacity="0.28" />
        </filter>
      </defs>

      <g className="mapa-raiz">
        <rect x="8" y="8" width={W - 16} height={H - 16} rx="22" fill="var(--color-sunken, #efede8)" />

        {/* O campo, com as linhas que dizem que é um campo. */}
        <g aria-hidden>
          <rect x={CAMPO.x} y={CAMPO.y} width={CAMPO.w} height={CAMPO.h} rx="4" fill={pavilhao ? "#ead9bb" : "#cfe3c6"} />
          <g fill="none" stroke="#ffffff" strokeWidth="1.6" strokeOpacity="0.95">
            <rect x={CAMPO.x + 6} y={CAMPO.y + 6} width={CAMPO.w - 12} height={CAMPO.h - 12} />
            <line x1={W / 2} y1={CAMPO.y + 6} x2={W / 2} y2={CAMPO.y + CAMPO.h - 6} />
            <circle cx={W / 2} cy={H / 2} r={pavilhao ? 16 : 20} />
            {pavilhao ? (
              <>
                <path d={`M${CAMPO.x + 6} ${H / 2 - 34} a34 34 0 0 1 0 68`} />
                <path d={`M${CAMPO.x + CAMPO.w - 6} ${H / 2 - 34} a34 34 0 0 0 0 68`} />
              </>
            ) : (
              <>
                <rect x={CAMPO.x + 6} y={H / 2 - 36} width="30" height="72" />
                <rect x={CAMPO.x + CAMPO.w - 36} y={H / 2 - 36} width="30" height="72" />
              </>
            )}
          </g>
          <text x={W / 2} y={CAMPO.y + CAMPO.h - 14} textAnchor="middle" fontSize="9" fontWeight="600" letterSpacing="1.5" fill="#ffffff" fillOpacity="0.9">
            {pavilhao ? "PAVILHÃO" : "RELVADO"}
          </text>
        </g>

        {/* O lado para onde a bancada arrastada vai, aceso por baixo de tudo. */}
        {aArrastar &&
          (eCanto(aArrastar.lado) ? (
            <path
              key={aArrastar.lado}
              className="mapa-faixa"
              d={caminhoDoArco(aArrastar.lado, centroDoCanto(aArrastar.lado).t0, centroDoCanto(aArrastar.lado).t0 + 90, 0, 0, R_DENTRO - 3, R_FORA + 3, 1)}
              fill="var(--color-signal-soft, #e7f0ee)"
              stroke="var(--color-signal-line, #0f6b62)"
              strokeOpacity="0.35"
              strokeWidth="1"
              aria-hidden
            />
          ) : (
            <rect
              key={aArrastar.lado}
              className="mapa-faixa"
              {...faixaDoLado(aArrastar.lado)}
              rx="9"
              fill="var(--color-signal-soft, #e7f0ee)"
              stroke="var(--color-signal-line, #0f6b62)"
              strokeOpacity="0.35"
              strokeWidth="1"
              aria-hidden
            />
          ))}

        {lista.length === 0 && (
          <text x={W / 2} y="40" textAnchor="middle" fontSize="11" fill="var(--color-ink-3, #8a867c)">
            Sem bancadas. Acrescenta a primeira.
          </text>
        )}

        {lista.map((f) => {
          const b = f.bancada;
          const ativa = estado(b) === "ativa";
          const sel = selecionada === b.id;
          const clicavel = (!!onEscolher || editavel) && ativa;
          const lugar = aArrastar?.id === b.id;
          const linha2 = rotulo?.(b);
          const cores = {
            fundo: sel ? "var(--color-signal-strong, #0f6b62)" : ativa ? "var(--color-signal-soft, #e7f0ee)" : "var(--color-line, #e5e2dc)",
            traco: sel || ativa ? "var(--color-signal-line, #0f6b62)" : "var(--color-line-strong, #d3cfc6)",
            tinta: sel ? "var(--color-signal-on, #ffffff)" : ativa ? "var(--color-signal-ink, #0a4c45)" : "var(--color-ink-4, #ada89d)",
            espessura: sel ? 2 : 1.2,
          };

          return (
            <g
              key={b.id}
              role={onEscolher || editavel ? "button" : undefined}
              tabIndex={clicavel ? 0 : undefined}
              aria-pressed={onEscolher ? sel : undefined}
              aria-disabled={(onEscolher || editavel) && !ativa ? true : undefined}
              aria-label={`${b.nome}${linha2 ? `, ${linha2}` : ""}${!ativa ? ", sem bilhetes" : ""}`}
              onPointerDown={editavel ? (e) => comecarBancada(e, b) : undefined}
              onClick={!editavel && clicavel ? () => onEscolher!(b.id) : undefined}
              onKeyDown={clicavel ? (e) => teclaBancada(e, b.id) : undefined}
              className="mapa-bancada"
              style={{
                transform: `translate(${f.x}px, ${f.y}px)`,
                // Um arco muda de forma de uma vez (o `d` não se anima em todos os
                // browsers): deslizar a caixa por baixo dele só o desalinhava.
                transition: animar && !f.arco ? `transform ${DURACAO}ms ${CURVA}` : "none",
                cursor: editavel ? "grab" : clicavel ? "pointer" : "default",
                outline: "none",
              }}
            >
              <title>{editavel ? `${b.nome}: arrasta para mudar de lugar` : b.nome}</title>
              {lugar && f.arco ? (
                <path
                  className="mapa-lugar"
                  d={f.arco}
                  fill="var(--color-signal-soft, #e7f0ee)"
                  fillOpacity="0.6"
                  stroke="var(--color-signal-line, #0f6b62)"
                  strokeWidth="1.5"
                  strokeDasharray="6 6"
                />
              ) : lugar ? (
                // O lugar onde vai cair: só o contorno, a tracejado e a andar.
                <rect
                  className="mapa-lugar"
                  x={0}
                  y={0}
                  width={f.w}
                  height={f.h}
                  rx="6"
                  fill="var(--color-signal-soft, #e7f0ee)"
                  fillOpacity="0.6"
                  stroke="var(--color-signal-line, #0f6b62)"
                  strokeWidth="1.5"
                  strokeDasharray="6 6"
                  style={{ width: f.w, height: f.h, transition: transicao() }}
                />
              ) : (
                <g className={pousada === b.id ? "mapa-pousou" : undefined}>{corpo(f, cores, linha2)}</g>
              )}
            </g>
          );
        })}

        {/* Os separadores, por cima das bancadas para se apanharem bem. */}
        {separadores.map(({ antes, depois }) => {
          const v = antes.vertical;
          const meio = (antes.b + depois.a) / 2;
          const transversal = v ? antes.x : antes.y;
          const lado = antes.bancada.lado;
          const canto = eCanto(lado);
          // Num canto, a pega fica no vão entre as duas fatias, a meio do anel.
          const noCanto = canto ? noArco(lado, R_MEIO, meio) : null;
          // Área de toque larga à volta de uma pega fina e visível.
          const hit = noCanto
            ? { x: noCanto.x - 9, y: noCanto.y - 9, w: 18, h: 18 }
            : v
              ? { x: transversal, y: meio - 7, w: ESPESSURA, h: 14 }
              : { x: meio - 7, y: transversal, w: 14, h: ESPESSURA };
          const pega = noCanto
            ? { x: noCanto.x - 4, y: noCanto.y - 4, w: 8, h: 8 }
            : v
              ? { x: transversal + ESPESSURA / 2 - 11, y: meio - 2.5, w: 22, h: 5 }
              : { x: meio - 2.5, y: transversal + ESPESSURA / 2 - 11, w: 5, h: 22 };
          // A etiqueta das percentagens: fora do anel num canto, ao lado da faixa num lado.
          const etiqueta = noCanto
            ? (() => {
                const q = noArco(lado, R_FORA + 14, meio);
                return { x: q.x - 28, y: q.y - 9, tx: q.x, ty: q.y + 3.5 };
              })()
            : v
              ? {
                  x: lado === "nascente" ? transversal - 60 : transversal + ESPESSURA + 4,
                  y: meio - 9,
                  tx: lado === "nascente" ? transversal - 32 : transversal + ESPESSURA + 32,
                  ty: meio + 3.5,
                }
              : {
                  x: meio - 28,
                  y: faixa(lado).y > CAMPO.y ? transversal + ESPESSURA + 4 : transversal - 22,
                  tx: meio,
                  ty: faixa(lado).y > CAMPO.y ? transversal + ESPESSURA + 16.5 : transversal - 9.5,
                };
          const ativo = arrasto?.tipo === "separador" && arrasto.antes === antes.bancada.id;
          const pct = Math.round(fracaoNoLado(visto, antes.bancada.id) * 100);
          const pctDepois = Math.round(fracaoNoLado(visto, depois.bancada.id) * 100);
          return (
            <g
              key={`${antes.bancada.id}|${depois.bancada.id}`}
              className="mapa-separador"
              data-ativo={ativo ? "" : undefined}
              style={{ ["--cursor-sep" as string]: canto ? "grab" : v ? "row-resize" : "col-resize" }}
            >
              <rect
                x={hit.x}
                y={hit.y}
                width={hit.w}
                height={hit.h}
                fill="transparent"
                role="separator"
                tabIndex={0}
                aria-orientation={v ? "horizontal" : "vertical"}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={pct}
                aria-label={`Divisão entre ${antes.bancada.nome} e ${depois.bancada.nome}: ${antes.bancada.nome} ocupa ${pct}% do lado`}
                onPointerDown={(e) => comecarSeparador(e, antes.bancada.id, depois.bancada.id)}
                onKeyDown={(e) => teclaSeparador(e, antes.bancada.id)}
              />
              <rect className="pega" x={pega.x} y={pega.y} width={pega.w} height={pega.h} rx={canto ? 4 : 2.5} fill="var(--color-ink, #1a1917)" stroke="#ffffff" strokeWidth="1" pointerEvents="none" />
              {ativo && (
                <g pointerEvents="none">
                  <rect x={etiqueta.x} y={etiqueta.y} width="56" height="18" rx="9" fill="var(--color-ink, #1a1917)" />
                  <text
                    x={etiqueta.tx}
                    y={etiqueta.ty}
                    textAnchor="middle"
                    fontSize="9"
                    fontWeight="700"
                    fill="#ffffff"
                  >
                    {pct}% · {pctDepois}%
                  </text>
                </g>
              )}
            </g>
          );
        })}

        {/* A bancada levantada: segue o ponteiro, por cima de tudo, com sombra.
            Toma a forma do lugar para onde vai (deitada num topo, de pé numa
            lateral), e essa mudança de forma é animada. */}
        {aArrastar && fantasma && (
          <g
            className="mapa-fantasma"
            pointerEvents="none"
            style={{ transform: `translate(${aArrastar.px - fantasma.w / 2}px, ${aArrastar.py - fantasma.h / 2}px)`, cursor: "grabbing" }}
          >
            <g filter="url(#mapa-sombra)" style={{ transform: `translate(${fantasma.w / 2}px, ${fantasma.h / 2}px) scale(1.06) translate(${-fantasma.w / 2}px, ${-fantasma.h / 2}px)` }}>
              {corpo(
                fantasma,
                {
                  fundo: "var(--color-signal-strong, #0f6b62)",
                  traco: "var(--color-signal-line, #0f6b62)",
                  tinta: "var(--color-signal-on, #ffffff)",
                  espessura: 2,
                },
                rotulo?.(fantasma.bancada),
              )}
            </g>
          </g>
        )}
      </g>
    </svg>
  );
}

/**
 * Um recinto vindo de fora (o armazenamento do browser, a API) posto em
 * condições de se desenhar: nome sempre texto, sítio conhecido, peso
 * positivo, ordem numérica.
 *
 * Existe porque um recinto partido não falha com uma mensagem: falha ao
 * desenhar, e leva a página inteira com ele. Uma bancada gravada sem nome por
 * uma versão anterior do editor deixava a secção Estádio em branco para
 * sempre nesse browser.
 */
export function recintoValido(r: Partial<Recinto> | null | undefined, i = 0): Recinto {
  const lados = new Set<Lado>(LADOS.map((l) => l.key));
  const bancadas = Array.isArray(r?.bancadas) ? r!.bancadas : [];
  return {
    id: typeof r?.id === "string" && r.id ? r.id : `recinto-${i}`,
    nome: typeof r?.nome === "string" ? r.nome : "Recinto",
    tipo: r?.tipo === "pavilhao" ? "pavilhao" : "campo",
    bancadas: bancadas
      .filter((b): b is Bancada => !!b && typeof b === "object")
      .map((b, k) => {
        const lado: Lado = lados.has(b.lado) ? b.lado : "norte";
        return {
          id: typeof b.id === "string" && b.id ? b.id : `bancada-${i}-${k}`,
          nome: typeof b.nome === "string" ? b.nome : LADOS.find((l) => l.key === lado)!.curto,
          lado,
          ordem: Number.isFinite(b.ordem) ? b.ordem : k,
          peso: typeof b.peso === "number" && b.peso > 0 ? b.peso : 1,
          lotacao: typeof b.lotacao === "number" && b.lotacao > 0 ? b.lotacao : null,
          coberta: !!b.coberta,
        };
      }),
  };
}

/** Um recinto de partida: um campo com a central e um topo. */
export function recintoDePartida(id: string, nome: string, novoId: () => string): Recinto {
  return {
    id,
    nome,
    tipo: "campo",
    bancadas: [
      { id: novoId(), nome: "Central", lado: "nascente", ordem: 0, peso: 1, lotacao: 600, coberta: true },
      { id: novoId(), nome: "Topo Norte", lado: "norte", ordem: 0, peso: 1, lotacao: 300, coberta: false },
    ],
  };
}

/**
 * Espelho em TypeScript dos tokens de theme.css, para o que não pode ser CSS:
 * séries de gráficos, geração de manifest PWA, e-mails.
 *
 * Se editares um valor aqui, edita-o também em theme.css. São poucos e estáveis.
 */

export const ink = {
  1: "#1a1917",
  2: "#524f48",
  3: "#8a867c",
  4: "#ada89d",
} as const;

export const neutral = {
  canvas: "#f6f5f2",
  surface: "#ffffff",
  sunken: "#efede8",
  line: "#e5e2dc",
  lineStrong: "#d3cfc6",
} as const;

/** Estado. Fixo em todas as academias. */
export const status = {
  ok: "#1f7a45",
  warn: "#9a5b08",
  risk: "#a82a20",
} as const;

/** Omissão do tenant; cada academia sobrepõe com a sua. */
export const DEFAULT_SIGNAL = "#0f6b62";

/**
 * Séries de gráfico. A primeira é sempre o sinal do tenant (injectada em runtime);
 * as restantes são neutros quentes de contraste decrescente, para que um gráfico
 * com seis séries continue legível a preto e branco.
 */
export const seriesNeutral = [
  "#2f2c27",
  "#6b6660",
  "#a29c93",
  "#c8c2b8",
  "#e0dbd2",
] as const;

/**
 * Paleta categórica — para distinguir escalões no calendário.
 *
 * Isto parece contrariar a regra "cor semântica só para estado", e por isso a regra
 * é reforçada e não aberta: **categoria e estado vivem em canais diferentes.**
 * A categoria é o *preenchimento* (fundo suave + ponto); o estado é o *contorno e a
 * etiqueta* (um treino sem treinador ganha borda e rótulo vermelhos, seja qual for
 * o escalão). Como nunca partilham o mesmo canal, nunca se confundem.
 *
 * As matizes foram escolhidas longe do verde-de-pago, do âmbar-de-aviso e do
 * vermelho-de-erro: teais, azuis, violetas e ameixas. Baixa saturação, porque um
 * mês inteiro destas cores tem de se poder olhar durante um minuto seguido.
 */
export const categorical = [
  { name: "teal", base: "#0f6b62", soft: "#e7f0ee", ink: "#0a4c45" },
  { name: "indigo", base: "#3b4d8f", soft: "#ebedf7", ink: "#2a3768" },
  { name: "violet", base: "#6a4b93", soft: "#f0ecf7", ink: "#4c356b" },
  { name: "plum", base: "#8a3f63", soft: "#f6eaf0", ink: "#652c48" },
  { name: "slate", base: "#4a5b66", soft: "#ecf0f2", ink: "#35434c" },
  { name: "cyan", base: "#1c6a86", soft: "#e6f1f5", ink: "#144e63" },
  { name: "moss", base: "#5d6b34", soft: "#f0f2e6", ink: "#434e25" },
  { name: "bronze", base: "#8a6a2f", soft: "#f4efe3", ink: "#664e22" },
] as const;

export type CategoricalColor = (typeof categorical)[number];

/**
 * Cor estável para uma categoria.
 *
 * Baseada no índice e não num hash do nome: uma academia que renomeie "Sub-11" para
 * "Iniciados" não vê o calendário todo mudar de cor. Passadas as oito, repete-se —
 * uma nona cor distinguível não existe, e fingir que sim é pior que repetir.
 */
export function categoryColor(index: number): CategoricalColor {
  return categorical[index % categorical.length];
}

/* -------------------------------------------------------------------------- */
/* Contraste                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Contraste — a parte do white-label que ninguém devia ter de configurar.
 *
 * ## O problema
 *
 * A cor do clube pinta botões, pastilhas, o herói da app da família e a página de
 * sócios. Por cima escrevia-se **branco**, sempre. Funciona para um azul-escuro e
 * desaparece num amarelo claro — e nenhum director tem de saber o que é um rácio
 * de contraste para o produto ser legível. Tinha de ser automático, e é aqui.
 *
 * ## O que se decide
 *
 * Duas perguntas diferentes, e é por isso que são dois tokens:
 *
 *   `--color-signal-on`     o que se escreve **por cima** da cor cheia — branco ou
 *                           tinta escura, o que contrastar mais.
 *   `--color-signal-ink`    a cor do clube **como texto**, sobre fundo claro. Aqui
 *                           não se escolhe entre dois: escurece-se a própria cor
 *                           até dar para ler, mantendo a matiz do clube.
 *   `--color-signal-strong` a cor do clube para **superfícies com texto por cima**.
 *                           Igual à do clube em quase todos os casos.
 *
 * A conta é a da WCAG 2.1 (luminância relativa e rácio de contraste), que é a
 * mesma que qualquer auditoria de acessibilidade vai usar. O alvo é 4.5:1 — o
 * mínimo AA para texto normal.
 *
 * ## Porque é que existe um `strong`
 *
 * Há uma família de cores — cinzentos médios, vermelhos-tijolo — em que **nem o
 * branco nem o preto** chegam a 4.5:1. Aí não há tinta que resolva, e a única
 * saída é mover a cor: um passo ou dois na direcção que já ia (mais escura se o
 * texto é branco, mais clara se é preto), mantendo a matiz. Para as outras
 * cores, `strong` **é** a cor do clube, sem um bit de diferença.
 *
 * O `strong` é para superfícies que carregam texto — o botão cheio, o herói da
 * app, o emblema. O `--color-signal` continua a ser a identidade e é o que pinta
 * o que não tem texto por cima: o ponto de hoje no calendário, a barra de
 * progresso, a linha de foco.
 *
 * ## O que isto **não** faz
 *
 * Não redesenha a identidade do clube. Um clube amarelo continua amarelo: o que
 * muda é a tinta por cima. É a diferença entre corrigir o produto e corrigir o
 * cliente.
 */

/** Luminância relativa (WCAG 2.1). */
function luminance({ r, g, b }: { r: number; g: number; b: number }): number {
  const canal = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b);
}

/** Rácio de contraste entre duas cores (1 = igual, 21 = preto sobre branco). */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(hexToRgb(a));
  const lb = luminance(hexToRgb(b));
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** A tinta escura das interfaces — o mesmo `ink.1`, para não haver dois pretos. */
const INK = ink[1];

/**
 * O que se escreve por cima desta cor: branco ou tinta.
 *
 * Ganha quem contrastar mais. Empates vão para o branco de propósito — a
 * linguagem da marca é texto claro sobre a cor, e só se abandona quando deixa
 * mesmo de se ler.
 */
export function onColor(hex: string): string {
  return contrastRatio(hex, "#ffffff") >= contrastRatio(hex, INK) ? "#ffffff" : INK;
}

/** `"255 255 255"` ou `"26 25 23"` — para as variantes com transparência. */
export function onColorRgb(hex: string): string {
  const { r, g, b } = hexToRgb(onColor(hex));
  return `${r} ${g} ${b}`;
}

/**
 * A cor do clube escurecida até se poder ler sobre um fundo claro.
 *
 * Escurece 8% de cada vez em vez de saltar para um valor calculado: mantém a
 * matiz e o passo é pequeno o suficiente para não estragar uma cor que já
 * estava boa. Um verde-escuro pára ao primeiro ou segundo passo — praticamente
 * onde o antigo `dark(0.72)` o punha —, um amarelo claro desce até ficar ocre.
 *
 * Vinte passos chegam para ir de branco a quase preto; o limite existe para o
 * ciclo terminar sempre, não porque alguma cor lá chegue.
 */
export function readableInk(hex: string, sobre = "#ffffff", alvo = 4.5): string {
  let { r, g, b } = hexToRgb(hex);
  for (let i = 0; i < 20 && contrastRatio(rgbToHex(r, g, b), sobre) < alvo; i += 1) {
    r = Math.round(r * 0.92);
    g = Math.round(g * 0.92);
    b = Math.round(b * 0.92);
  }
  return rgbToHex(r, g, b);
}

/** Aproxima `hex` de `destino`, em partes de 0 a 1. */
function towards(hex: string, t: number, destino: string): string {
  const a = hexToRgb(hex);
  const b = hexToRgb(destino);
  return rgbToHex(
    Math.round(a.r + (b.r - a.r) * t),
    Math.round(a.g + (b.g - a.g) * t),
    Math.round(a.b + (b.b - a.b) * t),
  );
}

/**
 * A cor do clube ajustada até a sua própria tinta se ler nela.
 *
 * Devolve a cor intacta para quase todas — só mexe nas que não passam com tinta
 * nenhuma, e mesmo aí anda o mínimo, na direcção que a tinta já escolheu. Ver o
 * cabeçalho desta secção.
 */
export function strongSignal(hex: string, alvo = 4.5): string {
  const on = onColor(hex);
  const rumo = on === "#ffffff" ? "#000000" : "#ffffff";
  let cor = hex;
  for (let i = 0; i < 20 && contrastRatio(cor, on) < alvo; i += 1) cor = towards(cor, 0.08, rumo);
  return cor;
}

/**
 * A cor do clube escurecida até se **ver sobre a página**.
 *
 * ## O problema que isto resolve
 *
 * `strongSignal` garante que a tinta se lê **em cima** da cor — serve para
 * superfícies cheias, como um botão. Não diz nada sobre o caso oposto: a cor
 * desenhada como um traço fino **sobre** o branco da página.
 *
 * E é aí que ela desaparece. O realce de foco é `outline: 2px solid` na cor do
 * clube; num clube de amarelo claro isso dá 1,3:1 contra o branco. O contorno
 * está lá, ninguém o vê, e quem navega pelo teclado deixa de saber onde está.
 * Um clube verde-escuro tem 6,4:1 e nunca deu por nada — que é o que faz este
 * tipo de defeito passar meses sem ser encontrado.
 *
 * ## Porquê 3:1
 *
 * É o mínimo que a WCAG (1.4.11, "Non-text Contrast") pede para um indicador de
 * interface — precisamente o caso de um contorno de foco. Não é um número
 * escolhido a gosto.
 *
 * ## Não mexe em quem já estava bem
 *
 * Anda 8% de cada vez em direcção ao preto e pára assim que chega aos 3:1. Um
 * clube com uma cor escolhida com cuidado fica com exactamente o tom que tinha.
 */
export function signalOnSurface(hex: string, alvo = 3): string {
  let cor = hex;
  for (let i = 0; i < 24 && contrastRatio(cor, "#ffffff") < alvo; i += 1) {
    cor = towards(cor, 0.08, "#000000");
  }
  return cor;
}

/**
 * Deriva os tons de um sinal de tenant. Recebe hex, devolve as variáveis CSS que a
 * app escreve no :root. `soft` é o sinal a 8% sobre a superfície branca.
 */
export function signalVars(hex: string): Record<string, string> {
  const { r, g, b } = hexToRgb(hex);
  const mix = (t: number) => rgbToHex(Math.round(r + (255 - r) * t), Math.round(g + (255 - g) * t), Math.round(b + (255 - b) * t));
  const soft = mix(0.92);
  const dark = rgbToHex(Math.round(r * 0.72), Math.round(g * 0.72), Math.round(b * 0.72));
  const on = onColor(hex);
  const strong = strongSignal(hex);
  const claro = on === "#ffffff";

  return {
    "--color-signal": hex,
    /*
     * A tinta continua a partir do mesmo sítio de sempre — a cor a 72% — e só
     * escurece mais se não se ler. Um clube com uma cor escolhida com cuidado
     * fica com **exactamente** o tom que já tinha; muda só quem estava ilegível.
     * Medida sobre o `soft` e não sobre o branco: é aí que este texto vive
     * (pastilhas, linhas seleccionadas), e é o mais escuro dos dois fundos.
     */
    "--color-signal-ink": readableInk(dark, soft),
    "--color-signal-soft": soft,
    "--color-signal-strong": strong,
    /*
     * A cor para o que se desenha **sobre** a página: contornos de foco, o arco
     * do disco de carregamento, um anel fino. Ver `signalOnSurface`.
     */
    "--color-signal-line": signalOnSurface(hex),
    "--color-signal-on": on,
    "--signal-on-rgb": onColorRgb(hex),
    /*
     * Os dois tons de um gradiente com texto por cima — o herói da app da
     * família. É a **tinta** que decide para onde vão: `deep` afasta-se dela e
     * `lift` aproxima-se um pouco, o suficiente para o realce se ver sem engolir
     * a legibilidade.
     *
     * Sem isto, o gradiente ia sempre de claro para escuro: o canto iluminado de
     * um clube vermelho ficava a 2,8:1 e o texto lá em cima desaparecia, mesmo
     * com a cor de base a passar; e num clube de cor clara, com tinta escura, era
     * o fim do gradiente que ficava preto sobre preto.
     *
     * Calculados aqui e não com `color-mix` no CSS: a percentagem teria de vir
     * de uma variável, e o minificador do Vite (Lightning CSS) resolve mal um
     * `color-mix` cuja percentagem não consegue ler — colapsava o gradiente para
     * branco e preto puros. Cores inteiras dentro de `var()` passam intactas.
     */
    "--signal-lift": towards(strong, 0.12, on),
    "--signal-deep": towards(strong, 0.28, claro ? "#000000" : "#ffffff"),
  };
}

function hexToRgb(hex: string) {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

function rgbToHex(r: number, g: number, b: number) {
  return "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0")).join("");
}

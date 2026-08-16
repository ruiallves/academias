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

/**
 * Deriva os tons de um sinal de tenant. Recebe hex, devolve as variáveis CSS que a
 * app escreve no :root. `soft` é o sinal a 8% sobre a superfície branca.
 */
export function signalVars(hex: string): Record<string, string> {
  const { r, g, b } = hexToRgb(hex);
  const mix = (t: number) => rgbToHex(Math.round(r + (255 - r) * t), Math.round(g + (255 - g) * t), Math.round(b + (255 - b) * t));
  const dark = (t: number) => rgbToHex(Math.round(r * t), Math.round(g * t), Math.round(b * t));

  return {
    "--color-signal": hex,
    "--color-signal-ink": dark(0.72),
    "--color-signal-soft": mix(0.92),
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

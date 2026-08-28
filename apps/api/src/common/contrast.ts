/**
 * Contraste — a cor do texto que a cor do clube exige.
 *
 * ## Porquê uma segunda cópia
 *
 * Gémeo de `packages/ui/src/tokens.ts`, e duplicado de propósito, pela mesma
 * razão do `ROLE_RANK` em `academy.service.ts`: `@academia/ui` exporta TypeScript
 * cru para o Vite compilar, e puxá-lo para dentro do build do Nest só para
 * partilhar trinta linhas de aritmética de cor sairia mais caro do que as trinta
 * linhas. As páginas servidas pelo servidor — a landing, a página de sócios, o
 * e-mail de convite — precisam delas na mesma: um e-mail não tem `color-mix`,
 * e a cor tem de ir já calculada no HTML.
 *
 * Se um dia divergirem, o sintoma é visível a olho — a mesma academia com
 * tintas diferentes na app e na página pública.
 *
 * ## O que decide
 *
 * `onColor`      o que se escreve por cima da cor cheia: branco ou tinta escura.
 * `strongSignal` a cor do clube ajustada só quando **nenhuma** das duas passa.
 * `readableInk`  a cor do clube escurecida até se ler sobre papel branco.
 *
 * Tudo em WCAG 2.1, com o alvo em 4.5:1 (AA para texto normal).
 */

/** A tinta escura das páginas públicas — o mesmo `--ink` dos templates. */
const INK = "#14130f";

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
  return "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
}

function luminance({ r, g, b }: { r: number; g: number; b: number }) {
  const canal = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b);
}

export function contrastRatio(a: string, b: string): number {
  const la = luminance(hexToRgb(a));
  const lb = luminance(hexToRgb(b));
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** `"#ffffff"` → `"255 255 255"`. */
function hexToRgbList(hex: string): string {
  const { r, g, b } = hexToRgb(hex);
  return `${r} ${g} ${b}`;
}

function towards(hex: string, t: number, destino: string): string {
  const a = hexToRgb(hex);
  const b = hexToRgb(destino);
  return rgbToHex(a.r + (b.r - a.r) * t, a.g + (b.g - a.g) * t, a.b + (b.b - a.b) * t);
}

/** Branco ou tinta — o que contrastar mais com esta cor. Empate vai para o branco. */
export function onColor(hex: string): string {
  return contrastRatio(hex, "#ffffff") >= contrastRatio(hex, INK) ? "#ffffff" : INK;
}

/** A cor do clube escurecida até se ler sobre `sobre` (papel branco, por omissão). */
export function readableInk(hex: string, sobre = "#ffffff", alvo = 4.5): string {
  let { r, g, b } = hexToRgb(hex);
  for (let i = 0; i < 20 && contrastRatio(rgbToHex(r, g, b), sobre) < alvo; i += 1) {
    r *= 0.92;
    g *= 0.92;
    b *= 0.92;
  }
  return rgbToHex(r, g, b);
}

/**
 * A cor do clube ajustada até a sua própria tinta se ler nela.
 *
 * Devolve a cor intacta para quase todas: só mexe nas que não passam nem com
 * branco nem com preto — cinzentos médios, vermelhos-tijolo — e mesmo aí anda o
 * mínimo, na direcção que a tinta já escolheu.
 */
export function strongSignal(hex: string, alvo = 4.5): string {
  const on = onColor(hex);
  const rumo = on === "#ffffff" ? "#000000" : "#ffffff";
  let cor = hex;
  for (let i = 0; i < 20 && contrastRatio(cor, on) < alvo; i += 1) cor = towards(cor, 0.08, rumo);
  return cor;
}

/**
 * As cores de uma academia, prontas a interpolar num template.
 *
 * `club` é a identidade e continua a pintar o que não tem texto por cima.
 *
 * `deep` e `lift` são os dois tons de um gradiente com texto por cima, e é a
 * tinta que decide para onde vão: `deep` afasta-se dela (mais escuro quando o
 * texto é branco, mais claro quando é preto) e `lift` aproxima-se um pouco, o
 * suficiente para o realce se ver sem engolir a legibilidade. Era isto que
 * faltava: o cartão de sócio ia sempre de claro para escuro, e num clube de cor
 * clara o topo ficava branco sobre amarelo.
 */
export type ClubPalette = ReturnType<typeof clubPalette>;

export function clubPalette(signalColor: string) {
  const hex = /^#[0-9a-f]{6}$/i.test(signalColor) ? signalColor.toLowerCase() : "#0f6b62";
  const strong = strongSignal(hex);
  const on = onColor(hex);
  const contrario = on === "#ffffff" ? "#000000" : "#ffffff";

  return {
    club: hex,
    strong,
    on,
    /**
     * A tinta em componentes — `"255 255 255"` ou `"20 19 15"`.
     *
     * Um cartão não é uma cor chapada: tem rótulos a 60%, um círculo a 22%, um
     * estilhaço a 8%. Todas essas transparências precisam da tinta em partes, e
     * `rgb(var(--club-on-rgb) / .6)` é a única forma de as escrever sem voltar a
     * fixar o branco.
     */
    onRgb: hexToRgbList(on),
    ink: readableInk(hex),
    deep: towards(strong, 0.28, contrario),
    lift: towards(strong, 0.12, on),
  };
}

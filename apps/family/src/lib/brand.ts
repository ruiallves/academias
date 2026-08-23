import { signalVars } from "@academia/ui/tokens";

/**
 * A identidade da academia — a cara que a app veste.
 *
 * Guarda-se a última conhecida no `localStorage` por duas razões:
 *
 *  1. **Abrir já certo.** Sem isso, cada arranque começava no verde por omissão e
 *     trocava de cor quando o bootstrap chegasse, à frente de quem está a olhar.
 *     Um ícone de app não muda de cor ao abrir; esta também não deve.
 *  2. **A barreira de instalação corre antes dos dados.** O `StandaloneGate`
 *     decide se a app sequer renderiza, muito antes de haver sessão ou API — e
 *     precisa de dizer "Instala a app do Life Club", não "da academia".
 *
 * O resto do sistema visual deriva da cor por `color-mix` (ver `.brandlit` em
 * `styles.css`), por isso isto é tudo o que o white-label precisa.
 */

const KEY = "academia.brand";
const FALLBACK: Brand = { color: "#0f6b62", shortName: "", mark: "" };

export type Brand = { color: string; shortName: string; mark: string };

export function readBrand(): Brand {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...FALLBACK, ...(JSON.parse(raw) as Partial<Brand>) } : FALLBACK;
  } catch {
    return FALLBACK;
  }
}

/**
 * O slug da academia.
 *
 * Delegado a `lib/invite.ts`, que sabe de mais fontes do que esta sabia: o clube de
 * onde veio o convite, o subdomínio, e só depois o `.env`. Um sítio só, senão a
 * barreira de instalação acaba a falar de uma academia e os pedidos de outra.
 */
export { academySlug } from "@/lib/invite";

/**
 * Pinta a app. Sem argumento, usa a última identidade conhecida — é o que corre
 * antes do primeiro render; com argumento, grava a nova.
 */
export function applyBrand(brand?: Partial<Brand>): void {
  const current = readBrand();
  const next: Brand = { ...current, ...brand };

  for (const [key, value] of Object.entries(signalVars(next.color))) {
    document.documentElement.style.setProperty(key, value);
  }
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", next.color);

  if (brand) {
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* modo privado: a app funciona na mesma, só reabre no valor por omissão */
    }
  }
}

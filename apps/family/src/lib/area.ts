import type { ContextType } from "@/lib/contexts";

/**
 * A área vestida, lida de onde não se pode importar o store dos contextos.
 *
 * ## Porque é que isto existe
 *
 * O `lib/http.ts` tem de dizer ao servidor que chapéu esta pessoa veste —
 * `x-app: family` ou `x-app: athlete` — e quem sabe isso é `lib/contexts.ts`.
 * Só que `contexts.ts` importa `http.ts` para perguntar os contextos, e o
 * caminho inverso fechava um ciclo. Um módulo mínimo, sem importações em tempo
 * de execução (o tipo é apagado ao compilar), quebra-o: `contexts.ts` escreve
 * aqui, `http.ts` lê.
 *
 * Sem área vestida a resposta é `family`, que é o que a app sempre mandou.
 */

let area: ContextType | null = null;

export function setActiveArea(next: ContextType | null): void {
  area = next;
}

export function activeArea(): ContextType | null {
  return area;
}

/** O cabeçalho `x-app` — ver `escolherMembership` na API. */
export function appHeader(): "family" | "athlete" {
  return area === "ATHLETE" ? "athlete" : "family";
}

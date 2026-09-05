import { useSyncExternalStore } from "react";

/**
 * "Estamos num telemóvel?" — a mesma pergunta que o CSS faz, respondida em JS.
 *
 * ## Porquê uma hook, quando há `max-md:`
 *
 * Para o que muda de **forma**, não de estilo. Uma tabela que no telemóvel
 * passa a lista de cartões não é a mesma marcação com outras classes: é outra
 * árvore. Desenhar as duas e esconder uma com `md:hidden` custava o dobro dos
 * nós em listas de duzentos atletas, e mantinha vivos — com foco, com cliques —
 * elementos que ninguém vê.
 *
 * O ponto de corte é o mesmo do `md` do Tailwind e do bloco "Telemóvel" do
 * `styles.css`: 768px. Uma fronteira só, para a marcação em JS e o CSS nunca
 * discordarem sobre em que ecrã estamos.
 */
const QUERY = "(max-width: 767.98px)";

function subscribe(onChange: () => void): () => void {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

/** Leitura fora de React — para valores iniciais de estado, por exemplo. */
export function isMobile(): boolean {
  return typeof window !== "undefined" && window.matchMedia(QUERY).matches;
}

export function useMobile(): boolean {
  return useSyncExternalStore(subscribe, isMobile, () => false);
}

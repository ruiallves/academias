import { useSyncExternalStore } from "react";

/**
 * O motor de scroll.
 *
 * Uma cena é uma secção alta com o conteúdo preso ao ecrã (`position: sticky`,
 * que é nativo: ninguém sequestra o scroll). O que este ficheiro faz é dizer a
 * cada cena, a cada fotograma, em que ponto do seu percurso ela vai: um número
 * de 0 a 1.
 *
 * Um ouvinte de scroll para a página inteira, um `requestAnimationFrame` por
 * fotograma, e cada cena inscrita recebe o seu progresso. Vinte ouvintes de
 * scroll a medir cada um a sua secção eram vinte leituras de layout por evento.
 */

type Ouvinte = {
  el: HTMLElement;
  fn: (p: number, r: DOMRect, vh: number) => void;
};

const ouvintes = new Set<Ouvinte>();
let pedido = 0;
let ligado = false;

const limitar = (x: number) => Math.min(1, Math.max(0, x));

function medir() {
  pedido = 0;
  const vh = window.innerHeight;
  for (const o of ouvintes) {
    const r = o.el.getBoundingClientRect();
    const curso = r.height - vh;
    // Uma secção mais baixa do que o ecrã não tem percurso: ou já passou ou não.
    const p = curso > 1 ? limitar(-r.top / curso) : r.top < vh * 0.4 ? 1 : 0;
    o.fn(p, r, vh);
  }
}

function pedir() {
  if (!pedido) pedido = requestAnimationFrame(medir);
}

/** Inscreve um elemento. Devolve a função que o desinscreve. */
export function seguir(el: HTMLElement, fn: Ouvinte["fn"]): () => void {
  if (!ligado) {
    ligado = true;
    window.addEventListener("scroll", pedir, { passive: true });
    window.addEventListener("resize", pedir);
  }
  const o = { el, fn };
  ouvintes.add(o);
  pedir();
  return () => {
    ouvintes.delete(o);
  };
}

/** A secção atravessa a linha dos 45% do ecrã: é a cena em que a pessoa está. */
export const estaAtiva = (r: DOMRect, vh: number) => r.top <= vh * 0.45 && r.bottom > vh * 0.45;

export function useMedia(consulta: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(consulta);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(consulta).matches,
    () => false,
  );
}

/** Telemóvel e tablet ao alto: as cenas mudam de composição. */
export const useEstreito = () => useMedia("(max-width: 860px)");

/** Quem pediu menos movimento ao sistema. */
export const useParado = () => useMedia("(prefers-reduced-motion: reduce)");

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { Router, UNSAFE_createBrowserHistory, type Location, type NavigationType } from "react-router-dom";

/**
 * O `BrowserRouter`, com a página a desvanecer para a seguinte.
 *
 * Usa as View Transitions do navegador, como o site do Adjunto: o navegador
 * fotografa a página que sai, desenha a nova e cruza as duas em 0,25 s. A barra
 * do topo tem nome próprio no CSS (`view-transition-name`) e não entra no
 * cruzamento, fica parada enquanto o resto muda por baixo.
 *
 * O `BrowserRouter` do react-router não faz isto fora do modo de dados, daí este.
 * É a mesma peça com uma diferença: a mudança de estado corre dentro de
 * `startViewTransition` e com `flushSync`, para a página nova estar desenhada
 * (e já no topo, ver `ScrollToTop`) quando o navegador tira a segunda fotografia.
 *
 * Sem transição: navegadores sem a API, quem pediu menos movimento no sistema, e
 * saltos dentro da mesma página (âncoras), que não são mudar de página.
 */
export function RouterComTransicao({ children }: { children: ReactNode }) {
  const historia = useRef<ReturnType<typeof UNSAFE_createBrowserHistory>>(null);
  if (historia.current == null) historia.current = UNSAFE_createBrowserHistory({ v5Compat: true });
  const h = historia.current;

  const [estado, setEstado] = useState<{ action: NavigationType; location: Location }>({
    action: h.action,
    location: h.location,
  });
  const atual = useRef(estado.location.pathname);

  useLayoutEffect(
    () =>
      h.listen(({ action, location }) => {
        const novo = { action, location };
        const mudaDePagina = location.pathname !== atual.current;
        atual.current = location.pathname;

        if (!mudaDePagina || !document.startViewTransition || menosMovimento()) {
          setEstado(novo);
          return;
        }
        document.startViewTransition(() => flushSync(() => setEstado(novo)));
      }),
    [h],
  );

  return (
    <Router location={estado.location} navigationType={estado.action} navigator={h}>
      {children}
    </Router>
  );
}

function menosMovimento(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

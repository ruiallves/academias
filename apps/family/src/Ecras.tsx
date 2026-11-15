import { useLayoutEffect, type ReactNode } from "react";
import { Routes, useLocation } from "react-router-dom";
import { ultimaTroca } from "@/lib/navegacao";

/**
 * O sítio onde os ecrãs se desenham, com a entrada de cada um.
 *
 * A troca em si (quando muda, se desliza, se funde) decide-se no router, em
 * `lib/navegacao.tsx`, no instante do toque. Aqui só se lê o resultado:
 *
 *  - **Trocar de separador**: o `<main>` nasce de novo (`key` pelo ecrã) e
 *    entra com um fundido curto em CSS (`[data-entra="funde"]`), sem
 *    View Transition e sem fotografias pelo meio.
 *  - **Entrar e voltar**: o browser anima o deslize com o CSS de
 *    `styles.css` (`::view-transition-*`, `data-nav` no `<html>`); o `<main>`
 *    não precisa de fazer nada.
 *
 * ## O scroll
 *
 * Entrar num ecrã novo começa no topo; voltar atrás volta ao sítio onde se
 * estava. O browser já não faz isto sozinho numa app de uma página só — o
 * `scrollRestoration = "manual"` em `main.tsx` é para ele não tentar. O
 * scroll aplica-se depois de o ecrã novo estar desenhado (`useLayoutEffect`):
 * antes disso a página ainda é a antiga, e pode ser curta de mais para lá chegar.
 */

/**
 * Já se esteve neste ecrã desde que a app abriu?
 *
 * A resposta decide se a entrada em cascata (`.rise`) toca. Módulo e não
 * estado: quer-se exactamente que sobreviva à navegação e morra quando a app
 * fecha — voltar a "Hoje" pela quinta vez não é uma estreia, mas abrir a app
 * amanhã é.
 *
 * A resposta é lembrada para o caminho actual em vez de recalculada: o React
 * volta a desenhar este componente sempre que o store muda (e duas vezes por
 * render em desenvolvimento), e sem isto a segunda passagem já dizia "não é a
 * primeira" — cortando a animação a meio da primeira vez que ela devia tocar.
 */
const visitados = new Set<string>();
let ultimoCaminho = "";
let ultimaResposta = false;

function primeiraVisita(pathname: string): boolean {
  if (pathname === ultimoCaminho) return ultimaResposta;
  ultimoCaminho = pathname;
  ultimaResposta = !visitados.has(pathname);
  visitados.add(pathname);
  return ultimaResposta;
}

export function Ecras({ children, className }: { children: ReactNode; className?: string }) {
  const { key, pathname } = useLocation();
  const troca = ultimaTroca();

  useLayoutEffect(() => {
    window.scrollTo(0, troca.scroll);
    // Só quando o ecrã muda: `troca` é o que estava guardado nesse momento.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  /* A cascata só na primeira visita, e nunca por cima de outra animação:
     duas ao mesmo tempo é o contrário de fluidez. */
  const cascata = primeiraVisita(pathname) && !troca.animada;

  return (
    <main
      key={key}
      data-anima={cascata ? "on" : "off"}
      data-entra={troca.sentido === "trocar" && troca.animada ? "funde" : undefined}
      className={className}
    >
      <Routes>{children}</Routes>
    </main>
  );
}

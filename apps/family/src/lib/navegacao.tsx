import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { Router, UNSAFE_createBrowserHistory, type Location, type NavigationType } from "react-router-dom";

/**
 * O router da app, com a troca de ecrã a começar no próprio toque.
 *
 * ## O que se sentia
 *
 * Tocar num separador e a app parecer pensar: um atraso, e depois o ecrã
 * novo a aparecer de repente. Medido num processador quatro vezes mais lento
 * (um telemóvel médio): do toque até a animação começar passavam 100 a 200 ms,
 * e a animação em si eram 160 ms de fundido. O olho lê isso como "espera e
 * salta", não como fluidez.
 *
 * Metade dessa espera era nossa. A transição era pedida num `useEffect` do
 * `Ecras`, ou seja, **depois** de o React desenhar e o browser pintar a app
 * inteira uma vez com o endereço novo e o ecrã velho, só para então o browser
 * fotografar esse ecrã velho, desenhar o novo e fotografá-lo também. A outra
 * metade são as duas fotografias, que uma View Transition custa sempre.
 *
 * ## O que se faz
 *
 * A mudança é apanhada aqui, no instante em que o `history` muda, antes de o
 * React saber dela. É o mesmo `BrowserRouter` do react-router (`Router` por
 * cima de `createBrowserHistory`), com uma diferença: quem decide quando é
 * que o estado muda somos nós.
 *
 *  - **Trocar de separador** não passa pela View Transition. O estado muda já,
 *    o ecrã novo é desenhado no fotograma seguinte e entra com um fundido
 *    curto em CSS (`main[data-entra="funde"]`, ver `Ecras.tsx`). É o que as
 *    apps nativas fazem na barra de separadores: nada de deslizar, e nada de
 *    esperar. Sem fotografias, o primeiro fotograma do ecrã novo chega logo a
 *    seguir ao toque.
 *  - **Entrar num detalhe e voltar** continuam a deslizar com a View
 *    Transition, porque aí o movimento diz de onde se veio. Mas a transição é
 *    pedida aqui, e o estado muda dentro dela (`flushSync`): poupa-se a pintura
 *    a mais, e o deslize começa um fotograma mais cedo.
 *
 * A direcção, o gesto de voltar do sistema e a posição do scroll de cada ecrã
 * ficam aqui, porque é aqui que se sabe de onde se vem e para onde se vai. O
 * `Ecras` lê o resultado em `ultimaTroca()`.
 */

export type Sentido = "entrar" | "voltar" | "trocar";

export type Troca = {
  /** `null` no primeiro ecrã da app. */
  sentido: Sentido | null;
  /** O ecrã entrou com animação (deslize ou fundido) e a cascata de entrada não deve tocar. */
  animada: boolean;
  /** Onde o ecrã deve ficar: no topo ao entrar, onde estava ao voltar. */
  scroll: number;
};

/** Os ecrãs de primeiro nível, os que vivem na barra de separadores. */
const RAIZES = new Set([
  "/",
  "/agenda",
  "/pagamentos",
  "/atleta",
  "/perfil",
  "/socio",
  "/socio/quotas",
  "/socio/jogos",
  "/socio/parcerias",
  "/socio/novidades",
]);

const profundidade = (pathname: string): number => (RAIZES.has(pathname) ? 0 : pathname.split("/").filter(Boolean).length);

function sentidoDe(de: string, para: string, tipo: NavigationType): Sentido {
  const a = profundidade(de);
  const b = profundidade(para);
  if (tipo === "POP") return a === 0 && b === 0 ? "trocar" : "voltar";
  if (b > a) return "entrar";
  if (b < a) return "voltar";
  return "trocar";
}

/*
 * Um "voltar" pelo gesto do sistema (arrastar da borda no iOS, o gesto de
 * voltar no Android) chega já animado pelo próprio sistema. O `popstate` di-lo
 * (`hasUAVisualTransition`), e ouve-se aqui, antes de o router o processar.
 */
let ultimoPopFoiGesto = false;
if (typeof window !== "undefined") {
  window.addEventListener("popstate", (e) => {
    ultimoPopFoiGesto = (e as PopStateEvent & { hasUAVisualTransition?: boolean }).hasUAVisualTransition === true;
  });
}

type DocumentoComTransicao = Document & {
  startViewTransition?: (update: () => void) => { finished: Promise<void> };
};

/** O browser anima a troca de ecrã? Sem a API, ou com "reduzir movimento", não. */
function animavel(): boolean {
  const doc = document as DocumentoComTransicao;
  if (typeof doc.startViewTransition !== "function") return false;
  return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Onde cada ecrã estava quando se saiu dele, para voltar ao mesmo sítio. */
const scrollPorEcra = new Map<string, number>();

let troca: Troca = { sentido: null, animada: false, scroll: 0 };

/** A última mudança de ecrã: o que o `Ecras` precisa para desenhar a entrada. */
export const ultimaTroca = (): Troca => troca;

/** Há uma View Transition a correr. Outra mudança pelo meio entra sem animação, por cima. */
let emCurso = false;

export function RouterComTransicao({ basename, children }: { basename?: string; children: ReactNode }) {
  const historia = useRef<ReturnType<typeof UNSAFE_createBrowserHistory> | null>(null);
  if (historia.current == null) historia.current = UNSAFE_createBrowserHistory({ v5Compat: true });
  const h = historia.current;

  const [estado, setEstado] = useState<{ action: NavigationType; location: Location }>({ action: h.action, location: h.location });
  const actual = useRef(estado.location);

  /* O `history` traz o caminho inteiro (`/app/agenda`); a direcção olha para o caminho da app. */
  const semBase = (pathname: string): string => (basename && pathname.startsWith(basename) ? pathname.slice(basename.length) || "/" : pathname);

  useLayoutEffect(
    () =>
      h.listen(({ action, location }) => {
        const de = actual.current;
        actual.current = location;
        scrollPorEcra.set(de.key, window.scrollY);

        const sentido = sentidoDe(semBase(de.pathname), semBase(location.pathname), action);
        const gesto = action === "POP" && ultimoPopFoiGesto;
        ultimoPopFoiGesto = false;
        const scroll = (action === "POP" ? scrollPorEcra.get(location.key) : undefined) ?? 0;
        const anima = !gesto && animavel();

        const mudar = (animada: boolean) => {
          troca = { sentido, animada, scroll };
          setEstado({ action, location });
        };

        if (sentido === "trocar" || emCurso || !anima) {
          mudar(sentido === "trocar" && anima);
          return;
        }

        emCurso = true;
        document.documentElement.dataset.nav = sentido;
        const transicao = (document as DocumentoComTransicao).startViewTransition!(() => {
          flushSync(() => mudar(true));
        });
        void transicao.finished.finally(() => {
          emCurso = false;
          delete document.documentElement.dataset.nav;
        });
      }),
    [h, basename],
  );

  return (
    <Router basename={basename} location={estado.location} navigationType={estado.action} navigator={h}>
      {children}
    </Router>
  );
}

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { Routes, useLocation, useNavigationType, type Location } from "react-router-dom";

/**
 * A troca de ecrã, animada.
 *
 * ## O que faltava
 *
 * As rotas trocavam de um fotograma para o outro: o ecrã antigo desaparecia e
 * o novo aparecia, sem nada pelo meio. Abrir um jogo e voltar atrás pareciam a
 * mesma coisa. É o corte seco que se sente como "não é fluido", mesmo com a
 * app a responder depressa.
 *
 * ## Como se faz
 *
 * Com a View Transitions API do browser (`document.startViewTransition`): o
 * browser tira uma fotografia ao ecrã antigo, deixa o React desenhar o novo, e
 * anima um sobre o outro com o CSS de `styles.css` (`::view-transition-*`).
 * Nada da lógica de navegação muda — os `Link`, os `navigate(-1)` e o gesto de
 * voltar do telemóvel passam todos por aqui, porque o que se observa é a
 * própria `location`.
 *
 * O truque é desenhar as rotas com a **última localização mostrada**, e não
 * com a actual: quando a actual muda, pede-se ao browser a transição, e só
 * dentro dela (com `flushSync`, para o React desenhar já) é que a mostrada
 * passa a ser a actual. Sem a API (iOS antigo, "reduzir movimento" ligado)
 * a mostrada passa a actual na hora, e fica tudo como era.
 *
 * ## A direcção
 *
 * Entrar num detalhe desliza da direita; voltar desliza para a direita; trocar
 * de separador funde. A direcção vai em `data-nav` no `<html>`, que é o que o
 * CSS lê. Um "voltar" por gesto no iOS ou no Android já vem animado pelo
 * sistema (`hasUAVisualTransition`), e aí não se anima duas vezes.
 *
 * ## O scroll
 *
 * Entrar num ecrã novo começa no topo; voltar atrás volta ao sítio onde se
 * estava. O browser já não faz isto sozinho numa app de uma página só — o
 * `scrollRestoration = "manual"` em `main.tsx` é para ele não tentar. O
 * scroll aplica-se depois de o ecrã novo estar desenhado (`useLayoutEffect`):
 * antes disso a página ainda é a antiga, e pode ser curta de mais para lá chegar.
 */

type Direccao = "entrar" | "voltar" | "trocar";

/** Os ecrãs de primeiro nível — os que vivem na barra de separadores. */
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

const profundidade = (pathname: string): number =>
  RAIZES.has(pathname) ? 0 : pathname.split("/").filter(Boolean).length;

function direccao(de: string, para: string, tipo: "PUSH" | "POP" | "REPLACE"): Direccao {
  const a = profundidade(de);
  const b = profundidade(para);
  if (tipo === "POP") return a === 0 && b === 0 ? "trocar" : "voltar";
  if (b > a) return "entrar";
  if (b < a) return "voltar";
  return "trocar";
}

/*
 * Um "voltar" pelo gesto do sistema (arrastar da borda no iOS, o gesto de
 * voltar no Android) chega já animado pelo próprio sistema. O `popstate` diz-o
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
  const actual = useLocation();
  const tipo = useNavigationType();
  const [mostrada, setMostrada] = useState<Location>(actual);
  /* Se o ecrã mostrado entrou a deslizar — e a cascata, por isso, não toca:
     duas animações ao mesmo tempo é o contrário de fluidez. */
  const [deslizou, setDeslizou] = useState(false);
  const emCurso = useRef(false);
  const scrollPendente = useRef<number | null>(null);

  useEffect(() => {
    if (actual.key === mostrada.key) return;

    scrollPorEcra.set(mostrada.key, window.scrollY);
    const sentido = direccao(mostrada.pathname, actual.pathname, tipo);
    const gesto = tipo === "POP" && ultimoPopFoiGesto;
    ultimoPopFoiGesto = false;

    const mudar = (animado: boolean) => {
      scrollPendente.current = (tipo === "POP" ? scrollPorEcra.get(actual.key) : undefined) ?? 0;
      setDeslizou(animado);
      setMostrada(actual);
    };

    /*
     * Uma transição a correr e outra a pedir (um `Navigate` de redirecção logo
     * a seguir a um clique): a segunda entra sem animação, por cima.
     */
    if (emCurso.current || gesto || !animavel()) {
      mudar(false);
      return;
    }

    emCurso.current = true;
    document.documentElement.dataset.nav = sentido;
    const transicao = (document as DocumentoComTransicao).startViewTransition!(() => {
      flushSync(() => mudar(true));
    });
    void transicao.finished.finally(() => {
      emCurso.current = false;
      delete document.documentElement.dataset.nav;
    });
  }, [actual, mostrada, tipo]);

  useLayoutEffect(() => {
    if (scrollPendente.current === null) return;
    window.scrollTo(0, scrollPendente.current);
    scrollPendente.current = null;
  }, [mostrada]);

  return (
    <main data-anima={primeiraVisita(mostrada.pathname) && !deslizou ? "on" : "off"} className={className}>
      <Routes location={mostrada}>{children}</Routes>
    </main>
  );
}

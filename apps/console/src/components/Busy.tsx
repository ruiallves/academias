import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";

/**
 * O carregamento da página, num sítio só.
 *
 * ## O que isto substitui
 *
 * Cada página tinha a sua maneira de dizer que estava a carregar: umas com um
 * "A carregar…" no meio de uma tabela vazia, outras com um spinner solto, outras
 * com nada. Três problemas de uma vez:
 *
 *  1. **A moldura mentia.** Uma tabela com cabeçalhos e uma linha a dizer "A
 *     carregar" parece uma tabela com um resultado. O olho lê a estrutura antes
 *     de ler o texto.
 *  2. **Saltava.** O conteúdo entrava por cima da mensagem e a página mudava de
 *     altura — o que a régua do UX chama *layout shift*.
 *  3. **Era inconsistente.** A mesma espera tinha três caras conforme o ecrã.
 *
 * Agora é sempre o mesmo: o conteúdo desfoca-se, fica inerte, e um disco roda por
 * cima. O menu lateral **não** desfoca — é a única coisa que continua a servir
 * para alguma coisa enquanto se espera, e tirá-la deixava a pessoa presa.
 *
 * ## Porque é que não aparece logo
 *
 * Porque a maior parte das leituras demora menos de duzentos milissegundos, e um
 * desfoque que pisca a cada navegação é pior do que espera nenhuma. Só aparece
 * depois de `ATRASO`; e, se aparecer, fica pelo menos `MINIMO` — um spinner que
 * entra e sai em 50 ms lê-se como um erro, não como progresso.
 *
 * ## Como se usa
 *
 * Numa página:
 *
 * ```tsx
 * const { data, loading } = qualquerCoisa();
 * useBusy(loading);
 * ```
 *
 * E mais nada: sem `if (loading) return <Loading/>`. A página desenha-se com o
 * que tem — vazia, à primeira vez — e o desfoque trata do resto.
 */

/** Antes disto, não se mostra nada. Cobre a esmagadora maioria das leituras. */
const ATRASO = 180;

/** Depois de aparecer, fica pelo menos isto. Evita o pisca-pisca. */
const MINIMO = 320;

type Ctx = { retain: () => void; release: () => void };

const BusyContext = createContext<Ctx | null>(null);

/**
 * Um contador, e não um booleano.
 *
 * Duas leituras a decorrer ao mesmo tempo — o que acontece em qualquer página com
 * dois painéis — e a primeira a terminar apagava o desfoque com a segunda ainda a
 * caminho. Contar quem entrou e quem saiu é o que faz isso funcionar.
 */
export function BusyProvider({ children }: { children: ReactNode }) {
  const [n, setN] = useState(0);

  const ctx = useRef<Ctx>({
    retain: () => setN((x) => x + 1),
    release: () => setN((x) => Math.max(0, x - 1)),
  }).current;

  return (
    <BusyContext.Provider value={ctx}>
      <BusyCount.Provider value={n}>{children}</BusyCount.Provider>
    </BusyContext.Provider>
  );
}

const BusyCount = createContext(0);

/**
 * Declara que esta página está à espera de alguma coisa.
 *
 * Seguro fora do `BusyProvider` — devolve sem fazer nada. Um componente usado num
 * diálogo ou numa pré-visualização não deve rebentar por não estar debaixo da
 * casca.
 */
export function useBusy(active: boolean) {
  const ctx = useContext(BusyContext);

  useEffect(() => {
    if (!ctx || !active) return;
    ctx.retain();
    return () => ctx.release();
  }, [ctx, active]);
}

/**
 * O que a casca desenha: o conteúdo, desfocado quando é preciso, e o disco.
 *
 * O desfoque vive num `<div>` **dentro** do `<main>` e não no `<main>` em si:
 * `filter` cria um contexto de empilhamento novo, e um `position: fixed` lá
 * dentro passaria a medir-se contra ele em vez de contra a janela. Com a camada
 * separada, o disco fica por cima e os diálogos continuam a comportar-se.
 */
export function BusyScreen({ children }: { children: ReactNode }) {
  const n = useContext(BusyCount);
  const [visivel, setVisivel] = useState(false);
  const desde = useRef(0);

  useEffect(() => {
    if (n > 0) {
      if (visivel) return;
      const t = setTimeout(() => {
        desde.current = Date.now();
        setVisivel(true);
      }, ATRASO);
      return () => clearTimeout(t);
    }

    if (!visivel) return;
    const falta = Math.max(0, MINIMO - (Date.now() - desde.current));
    const t = setTimeout(() => setVisivel(false), falta);
    return () => clearTimeout(t);
  }, [n, visivel]);

  return (
    <>
      <div
        aria-busy={visivel}
        // `aria-hidden` enquanto espera: um leitor de ecrã a atravessar conteúdo
        // que está prestes a ser substituído lê coisas que já não são verdade.
        aria-hidden={visivel || undefined}
        className={cxBusy(
          "page-pad w-full transition-[filter,opacity] duration-200 motion-reduce:transition-none",
          visivel && "pointer-events-none select-none blur-[3px] opacity-60",
        )}
      >
        {children}
      </div>

      {visivel && (
        <div
          role="status"
          aria-live="polite"
          aria-label="A carregar"
          /*
            `fixed`, e centrado no **conteúdo**.

            Passou por duas versões antes desta. `absolute` contra o `<main>`
            media-se contra a altura do documento, e numa página comprida o centro
            caía fora da vista — daí ter estado preso a 22vh do topo. `fixed`
            resolveu isso mas centrava na janela inteira, e com o menu a ocupar a
            esquerda o disco aparecia descaído para a direita do sítio onde o olho
            o procura.

            `left: var(--nav-w)` começa a área de centragem onde o conteúdo começa.
            A variável vem da casca e acompanha o menu quando ele encolhe.

            Isto só funciona porque esta camada vive **fora** do `<div>` que leva
            o `blur`: um `filter` cria um bloco de contenção, e um `fixed` lá
            dentro passaria a medir-se contra ele em vez de contra a janela.
          */
          style={{ left: "var(--nav-w, 0px)" }}
          className="pointer-events-none fixed inset-y-0 right-0 z-20 flex items-center justify-center"
        >
          <span
            className="size-9 animate-spin rounded-full border-[3px] border-line bg-surface/0"
            style={{ borderTopColor: "var(--signal)" }}
            aria-hidden
          />
        </div>
      )}
    </>
  );
}

/** Local, para não arrastar `primitives` para dentro de um ficheiro da casca. */
function cxBusy(...xs: (string | false | null | undefined)[]) {
  return xs.filter(Boolean).join(" ");
}

/**
 * Um disco pequeno, para o que carrega **dentro** de uma página já utilizável.
 *
 * Um painel lateral a ir buscar uma lista, uma gaveta que abre, um bloco que só
 * interessa a quem lá chega. Desfocar a página inteira por causa disso seria
 * tirar o ecrã a quem está a trabalhar noutra parte dele — o desfoque é para
 * quando **não há** página, não para quando falta um pedaço.
 *
 * Sem texto de propósito: "A carregar…" escrito é a coisa que se quis tirar de
 * toda a aplicação. O movimento diz o mesmo e não ocupa uma linha.
 */
export function Spinner({ className }: { className?: string }) {
  return (
    <div role="status" aria-label="A carregar" className={cxBusy("flex justify-center py-8", className)}>
      <span
        className="size-6 animate-spin rounded-full border-2 border-line"
        style={{ borderTopColor: "var(--signal)" }}
        aria-hidden
      />
    </div>
  );
}

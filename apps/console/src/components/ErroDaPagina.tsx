import { Component, type ErrorInfo, type ReactNode } from "react";
import { useLocation } from "react-router-dom";

/**
 * A rede por baixo de cada página da consola.
 *
 * ## Porquê
 *
 * Sem ela, um erro a desenhar uma página desmontava a consola inteira e ficava
 * um ecrã vazio, sem menu nem forma de sair. Foi o que aconteceu à lista de
 * sócios do CB Fundão a 15/11/2026: uma quota anual com o período "2026" (sem
 * mês) fazia rebentar o nome do mês, e a direção via só branco, mesmo a
 * reiniciar a app.
 *
 * Com ela, o menu e as barras ficam, e no lugar da página aparece o que se
 * passou e como tentar outra vez. Mudar de página limpa o erro (a `key` é o
 * caminho), por isso o resto da consola continua a funcionar.
 */
export function ErroDaPagina({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return <Rede key={pathname}>{children}</Rede>;
}

class Rede extends Component<{ children: ReactNode }, { erro: Error | null }> {
  state = { erro: null as Error | null };

  static getDerivedStateFromError(erro: Error) {
    return { erro };
  }

  componentDidCatch(erro: Error, info: ErrorInfo) {
    console.error("A página rebentou:", erro, info.componentStack);
  }

  render() {
    if (!this.state.erro) return this.props.children;
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <h1 className="text-[17px] font-semibold text-ink">Esta página não abriu</h1>
        <p className="mt-2 text-body leading-relaxed text-ink-3">
          Houve um erro ao mostrar esta página. O resto da consola funciona: podes ir para outra página pelo menu ou tentar outra vez.
        </p>
        <button type="button" className="ctl-outline mx-auto mt-5" onClick={() => window.location.reload()}>
          Tentar outra vez
        </button>
        <p className="mt-6 break-words text-meta text-ink-4">{this.state.erro.message}</p>
      </div>
    );
  }
}

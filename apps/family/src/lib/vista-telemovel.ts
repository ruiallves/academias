/**
 * A app vê-se sempre como no telemóvel, mesmo com "Ver como computador" ligado.
 *
 * ## O que esse modo faz
 *
 * No Chrome e no Safari do telemóvel, "Site para computador" / "Pedir site para
 * computador" faz o browser fingir que é um computador: desenha a página numa
 * largura de ~980px e ignora o `width=device-width` do `index.html`. A app, que é
 * uma coluna de 480px, aparecia minúscula no meio de um ecrã largo, com letra que
 * não se lê. O modo é do browser (às vezes ligado para todos os sites) e nenhum
 * site o consegue desligar.
 *
 * ## O que se faz
 *
 * Detecta-se o caso, que é inconfundível: um ecrã de telemóvel (estreito e de
 * toque) com uma página muito mais larga do que ele. Aí amplia-se a página
 * inteira (`zoom`) na proporção exacta entre as duas larguras, e a app volta a
 * ocupar o ecrã como se o modo não existisse.
 *
 * O `zoom` também multiplica as alturas em `dvh`, e o modo de computador já as
 * mede na página larga: um `min-h-dvh` ficava com várias alturas de ecrã.
 * `--altura-da-app` é a altura visível já dividida pelo zoom, e o `styles.css`
 * usa-a nesses sítios enquanto `data-vista-telemovel` estiver no `<html>`.
 *
 * Tablets ficam de fora de propósito: um iPad pede o site de computador por
 * omissão, e aí a coluna centrada é a leitura certa.
 */

/** Largura a partir da qual um ecrã deixa de ser de telemóvel. */
const TELEMOVEL_ATE = 600;

export function forcarVistaDeTelemovel(): void {
  const raiz = document.documentElement;

  const aplicar = () => {
    const toque = navigator.maxTouchPoints > 0 || window.matchMedia("(pointer: coarse)").matches;
    const ecra = Math.min(window.screen.width, window.screen.height);
    const larguraDoEcra = window.screen.width;

    // Mede sem o zoom posto, para a conta não se alimentar a si própria.
    raiz.style.removeProperty("zoom");
    const pagina = raiz.clientWidth || window.innerWidth;

    const modoDeComputador = toque && ecra > 0 && ecra <= TELEMOVEL_ATE && pagina > larguraDoEcra * 1.25;
    if (!modoDeComputador) {
      raiz.removeAttribute("data-vista-telemovel");
      raiz.style.removeProperty("--altura-da-app");
      return;
    }

    const zoom = pagina / larguraDoEcra;
    raiz.style.setProperty("zoom", String(zoom));
    raiz.style.setProperty("--altura-da-app", `${window.innerHeight / zoom}px`);
    raiz.setAttribute("data-vista-telemovel", "");
  };

  aplicar();
  window.addEventListener("resize", aplicar);
  window.addEventListener("orientationchange", aplicar);
}

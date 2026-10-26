import { StrictMode } from "react";
import { renderToString } from "react-dom/server";
import { StaticRouter } from "react-router-dom";
import App from "./App";

/**
 * O site desenhado no build, página a página (`scripts/prerender.mjs`).
 *
 * Sem isto o Google recebia um `<div id="root"></div>` vazio em todas as
 * páginas, com o mesmo título, e tinha de correr o JavaScript para ver o texto.
 * Agora cada página chega com o texto todo, e o navegador só lhe dá vida.
 */
export function render(url: string): string {
  return renderToString(
    <StrictMode>
      <StaticRouter location={url}>
        <App />
      </StaticRouter>
    </StrictMode>,
  );
}

export { PAGINAS, PAGINA_404, SITE_URL, dadosEstruturados } from "./lib/seo";

import { StrictMode } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import App from "./App";
import { RouterComTransicao } from "./lib/transicao";
import "./brand.css";

const raiz = document.getElementById("root")!;
const arvore = (
  <StrictMode>
    <RouterComTransicao>
      <App />
    </RouterComTransicao>
  </StrictMode>
);

// No build cada página já vem desenhada (ver `entry-server.tsx`): aproveita-se
// esse HTML. Em desenvolvimento a raiz vem vazia e desenha-se do zero.
if (raiz.hasChildNodes()) hydrateRoot(raiz, arvore);
else createRoot(raiz).render(arvore);

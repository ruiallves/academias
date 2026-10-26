import { StrictMode } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./brand.css";

const raiz = document.getElementById("root")!;
const arvore = (
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>
);

// No build cada página já vem desenhada (ver `entry-server.tsx`): aproveita-se
// esse HTML. Em desenvolvimento a raiz vem vazia e desenha-se do zero.
if (raiz.hasChildNodes()) hydrateRoot(raiz, arvore);
else createRoot(raiz).render(arvore);

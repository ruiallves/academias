import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { SessionProvider } from "./session";
import { LoginGate } from "./components/LoginGate";
import { AcademyBoot } from "./components/AcademyBoot";

import "./styles.css";

/**
 * O prefixo onde a consola vive.
 *
 * `/consola/` em produção, `/` em desenvolvimento — o mesmo valor que o `base` do
 * Vite, que ele próprio expõe em `BASE_URL`. Sem o `basename`, o react-router
 * pensava que `/consola/equipas` era uma rota chamada "consola" e não encontrava
 * nada. Vem do build para não haver dois sítios a dizer onde a consola está.
 */
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter basename={BASE || undefined}>
      {/* Nada da consola renderiza sem sessão — nem sequer a casca. */}
      <LoginGate>
        <AcademyBoot>
          <SessionProvider>
            <App />
          </SessionProvider>
        </AcademyBoot>
      </LoginGate>
    </BrowserRouter>
  </StrictMode>,
);

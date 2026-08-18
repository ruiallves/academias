import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { SessionProvider } from "./session";
import { LoginGate } from "./components/LoginGate";
import { AcademyBoot } from "./components/AcademyBoot";

import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
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

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { StandaloneGate } from "./StandaloneGate";
import { academy } from "./data";
import { signalVars } from "@academia/ui/tokens";
import "./styles.css";

/**
 * Antes do primeiro render: a cor da academia entra no `:root` e a app inteira
 * segue. Em produção o slug vem do subdomínio (`life-club.academia.pt`) e estes
 * valores vêm da API — o pai instala a app da academia dele.
 */
for (const [key, value] of Object.entries(signalVars(academy.signalColor))) {
  document.documentElement.style.setProperty(key, value);
}
document.querySelector('meta[name="theme-color"]')?.setAttribute("content", academy.signalColor);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StandaloneGate>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </StandaloneGate>
  </StrictMode>,
);

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { SessionProvider } from "./session";
import { academy } from "./data/demo";
import { signalVars } from "@academia/ui/tokens";
import "./styles.css";

/**
 * O white-label aplica-se antes do primeiro render: a cor do tenant entra como
 * variável CSS no `:root` e todo o produto a segue. Nenhum componente conhece a
 * cor da academia.
 */
for (const [key, value] of Object.entries(signalVars(academy.signalColor))) {
  document.documentElement.style.setProperty(key, value);
}
document.title = `${academy.shortName} · Consola`;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <SessionProvider>
        <App />
      </SessionProvider>
    </BrowserRouter>
  </StrictMode>,
);

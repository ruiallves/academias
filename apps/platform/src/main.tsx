import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { LoginGate } from "./components/LoginGate";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      {/* Nada do painel renderiza sem se saber que quem entrou é dono disto. */}
      <LoginGate>{(me) => <App me={me} />}</LoginGate>
    </BrowserRouter>
  </StrictMode>,
);

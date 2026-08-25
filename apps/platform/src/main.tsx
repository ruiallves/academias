import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { LoginGate } from "./components/LoginGate";
import { AdminInvite } from "./components/AdminInvite";
import "./styles.css";

/**
 * A única porta que não passa pelo `LoginGate`.
 *
 * Quem chega a `/convite-admin/:token` ainda não tem sessão nenhuma — é
 * precisamente por isso que está a aceitar um convite. Ler o caminho aqui, antes
 * de qualquer `Routes`, evita ensinar o router aninhado a distinguir uma página
 * pública de todo o resto que exige sessão; é a mesma verificação directa que
 * `captureFromUrl` faz na app da família antes do primeiro render.
 */
const inviteToken = window.location.pathname.match(/^\/convite-admin\/([^/]+)\/?$/)?.[1];

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      {inviteToken ? (
        <AdminInvite token={inviteToken} />
      ) : (
        // Nada do painel renderiza sem se saber que quem entrou é dono disto.
        <LoginGate>{(me) => <App me={me} />}</LoginGate>
      )}
    </BrowserRouter>
  </StrictMode>,
);

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { StandaloneGate } from "./StandaloneGate";
import { applyBrand } from "./lib/brand";
import { captureFromUrl } from "./lib/invite";
import "./styles.css";

/**
 * A cor da academia entra no `:root` **antes** do primeiro render, com o último
 * valor conhecido (guardado no `localStorage`), e é reconfirmada quando o
 * bootstrap chega — ver `applyBrand` e o `load()` do store.
 *
 * Sem o valor guardado, a app abria sempre no verde por omissão e mudava de cor a
 * meio do arranque, à frente de quem está a olhar. Em produção o slug vem do
 * subdomínio (`life-club.academia.pt`); o pai instala a app da academia dele.
 */
/*
 * O convite e a academia saem do endereço antes de qualquer render, e a barra
 * fica limpa. Tem de correr aqui, e não dentro de um ecrã: a app pode abrir
 * directamente numa rota qualquer, e o token só passa uma vez — quem vem da
 * landing traz `?convite=`, e a `start_url` do manifest, depois de instalada, já
 * não traz nada.
 */
captureFromUrl();

applyBrand();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StandaloneGate>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </StandaloneGate>
  </StrictMode>,
);

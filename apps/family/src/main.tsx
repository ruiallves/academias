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

/**
 * O prefixo onde a app vive: `/app/` em produção, `/` em desenvolvimento.
 *
 * Vem do `base` do Vite para não haver dois sítios a dizer a mesma coisa. Sem
 * `basename`, o react-router lia `/app/pagamentos` como uma rota chamada "app" e
 * caía no `Navigate to="/"` — a app abria sempre no ecrã de hoje, viesse de onde
 * viesse.
 */
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StandaloneGate>
      <BrowserRouter basename={BASE || undefined}>
        <App />
      </BrowserRouter>
    </StandaloneGate>
  </StrictMode>,
);

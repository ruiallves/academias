import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { SessionProvider } from "./session";
import { LoginGate } from "./components/LoginGate";
import { AcademyBoot } from "./components/AcademyBoot";
import { LegalGate } from "./components/LegalGate";
import { Avisos } from "./components/Avisos";
import { vigiarVersao } from "@academia/ui/versao";
import { vigiarPromessasPerdidas } from "./lib/avisos";

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

/*
 * A consola nunca fica numa versão antiga.
 *
 * Um separador aberto há dias — ou a consola aberta no telemóvel pela área de
 * Staff — mantinha em memória o JavaScript com que arrancou. Duas pessoas do
 * mesmo clube viam ecrãs diferentes, e do lado de quem dá apoio isso é uma
 * avaria impossível de reproduzir. Ver `packages/ui/src/versao.ts`.
 */
vigiarVersao({ atual: __BUILD_ID__, base: import.meta.env.BASE_URL });

/*
 * Os erros que ninguém apanhou também aparecem.
 *
 * Um `void gravar()` sem `catch`, um efeito que rejeita: hoje morriam na consola
 * do browser e o ecrã ficava parado, sem nada a dizer porquê — que é a pior
 * forma de falhar, porque parece que o clique não chegou a registar.
 */
vigiarPromessasPerdidas();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter basename={BASE || undefined}>
      {/*
        Os avisos vivem **fora** dos portões, e é de propósito.

        Dentro da casca, um erro no arranque da academia não tinha onde
        aparecer: o componente que o ia mostrar ainda não existia, e a pessoa
        ficava com um ecrã parado. Sendo `position: fixed`, isto não precisa de
        estar dentro de nada — e aqui cobre também o que corre antes de haver
        consola. Ver `components/Avisos.tsx`.
      */}
      <Avisos />

      {/* Nada da consola renderiza sem sessão — nem sequer a casca. */}
      <LoginGate>
        {/* Com sessão mas antes da academia: com termos por aceitar, o servidor recusa o arranque. */}
        <LegalGate>
          <AcademyBoot>
            <SessionProvider>
              <App />
            </SessionProvider>
          </AcademyBoot>
        </LegalGate>
      </LoginGate>
    </BrowserRouter>
  </StrictMode>,
);

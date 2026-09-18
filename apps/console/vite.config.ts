import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";
import { versaoDoBuild } from "../../scripts/vite-versao.mjs";

export default defineConfig(({ command }) => ({
  /**
   * Em produção a consola é servida pela API, na origem do clube:
   * `fafe.academias.pt/consola`. O `base` faz o Vite escrever os caminhos dos
   * bundles com esse prefixo — sem ele, o `index.html` pediria `/assets/…` e
   * apanhava a landing do clube em vez do JavaScript.
   *
   * Em `vite dev` fica na raiz: a consola continua em `localhost:5173/`, sem
   * prefixo nenhum, como sempre esteve.
   */
  base: command === "build" ? "/consola/" : "/",
  // `versaoDoBuild` assina o bundle e escreve `version.json` — é o que permite à
  // consola descobrir que está velha e recarregar-se. Ver `packages/ui/src/versao.ts`.
  plugins: [react(), tailwindcss(), versaoDoBuild()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // Apontar o pacote partilhado à fonte (e não ao symlink em node_modules)
      // faz o Vite tratá-lo como código do projecto: TypeScript transformado e
      // HMR a funcionar quando se edita um token.
      "@academia/ui": fileURLToPath(new URL("../../packages/ui/src", import.meta.url)),
    },
  },
  // Em produção não emitimos source maps: quem abrir o "Sources" vê o bundle
  // minificado, não o TypeScript comentado. Não é segurança — a segurança está
  // no servidor —, é só não entregar a lógica de negócio de bandeja. Ver a nota
  // "O código do cliente não é uma fronteira de segurança" em docs/03-estado.md.
  build: { sourcemap: false },
  // Fora do `dev`, cai `console.*` e `debugger` do bundle. Em dev ficam, que é
  // onde servem para alguma coisa.
  esbuild: command === "build" ? { drop: ["console", "debugger"] } : {},
  /*
   * A 5173, e mais nenhuma.
   *
   * A app do clube entrega a sessão a `localhost:5173` quando se escolhe Staff
   * (`consoleUrl` em `apps/family/src/lib/handoff.ts`). Sem `strictPort`, uma
   * 5173 ocupada fazia o Vite mudar-se sozinho para a 5174 — que é a porta da
   * app do clube — e a entrega caía numa porta sem ninguém, ou na app errada,
   * sem erro nenhum a dizer porquê. Assim, porta ocupada é um erro no arranque,
   * que é onde se vê.
   *
   * Só `vite dev` lê isto: em produção a consola é `/consola`, servida pela API.
   */
  server: { port: 5173, strictPort: true },
}));

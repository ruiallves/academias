import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

export default defineConfig(({ command }) => ({
  plugins: [react(), tailwindcss()],
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
  server: { port: 5173 },
}));

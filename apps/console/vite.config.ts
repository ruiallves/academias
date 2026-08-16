import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
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
  server: { port: 5173 },
});

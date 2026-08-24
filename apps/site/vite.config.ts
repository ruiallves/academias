import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

/**
 * O site público — a marca, não o produto.
 *
 * App à parte de propósito. A consola, a app das famílias e o painel da plataforma
 * partilham `packages/ui` porque são o **mesmo produto** visto de três lados; este
 * é a montra, e uma montra que herdasse os tokens do produto acabaria a parecer
 * uma captura de ecrã dele. A identidade vive em `src/brand.css`, e não sai daqui.
 *
 * Sem dependência da API: é HTML, CSS e um pouco de JavaScript. Uma página de
 * marketing que precisa de um servidor a responder para abrir é uma página que
 * fica em baixo quando o servidor fica.
 */
export default defineConfig(({ command }) => ({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  build: { sourcemap: false },
  esbuild: command === "build" ? { drop: ["console", "debugger"] } : {},
  server: { port: 5190 },
}));

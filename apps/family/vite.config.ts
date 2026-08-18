import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { fileURLToPath, URL } from "node:url";

/**
 * O manifest está aqui em modo estático para o desenvolvimento. Em produção é
 * gerado por tenant: o NestJS serve `/{slug}/manifest.webmanifest` com o nome,
 * o ícone e a `theme_color` da academia. O pai instala a app da academia dele —
 * o nosso nome não aparece.
 */
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      workbox: {
        // A landing da academia vive no mesmo domínio que a PWA
        // (`{slug}.dominio.pt/l/...` — ver docs/02-arquitetura.md). Sem esta
        // exclusão, o service worker — cujo âmbito é `/` — responderia à landing
        // com a casca da aplicação, e um pai que já tivesse a app instalada
        // deixaria de conseguir abrir o link que a academia lhe mandou.
        navigateFallbackDenylist: [/^\/l\//],
        // Acrescenta os ouvintes de push ao service worker gerado, sem trocar
        // para injectManifest (que obrigaria a reimplementar o precache à mão).
        importScripts: ["/push-sw.js"],
      },
      manifest: {
        name: "Academia Life Club",
        short_name: "Life Club",
        description: "Treinos, pagamentos e progresso do teu atleta.",
        start_url: "/",
        display: "standalone",
        background_color: "#f6f5f2",
        theme_color: "#0f6b62",
        lang: "pt-PT",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      // Sem isto, o service worker só existe no build de produção — e as
      // notificações push só funcionam com um service worker activo. Ligá-lo em
      // `vite dev` deixa testar o push em `localhost:5174` (num browser de
      // secretária que suporte Web Push), sem ter de fazer build e instalar.
      devOptions: { enabled: true, type: "module", navigateFallback: "index.html" },
    }),
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@academia/ui": fileURLToPath(new URL("../../packages/ui/src", import.meta.url)),
    },
  },
  // `host: true` liga o Vite a todas as interfaces (0.0.0.0), não só a
  // `localhost` — sem isto, um telemóvel na mesma rede não encontra o servidor
  // nenhuma. Para abrir no telemóvel: `http://<IP da máquina>:5174`.
  server: { port: 5174, host: true },
  // `true` só serve para testar num telemóvel a sério através de um túnel
  // (loca.lt, ngrok) durante o desenvolvimento — o Vite bloqueia por omissão
  // qualquer Host desconhecido para evitar DNS rebinding. Em produção isto não
  // se aplica: `vite preview` não corre, o build estático é servido por um CDN.
  preview: { port: 5174, allowedHosts: true },
});

import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { fileURLToPath, URL } from "node:url";

/**
 * A app da família.
 *
 * ## Onde é que ela vive
 *
 * Em produção é servida pela própria API, na origem do clube:
 * `fafe.academias.pt/app/`. Não é uma preferência de arrumação — a instalação de
 * uma PWA é **same-origin**, e a página que a oferece é a landing do clube, em
 * `fafe.academias.pt/`. Uma app noutro domínio não se consegue instalar a partir
 * do link que o diretor manda ao pai, que é o único caminho que ela tem.
 *
 * Em `vite dev` continua na raiz de `localhost:5174`, sem prefixo.
 *
 * ## O manifest não está aqui
 *
 * É gerado pela API, por clube, com o nome, a cor e o emblema da academia — ver
 * `apps/api/src/tenant/tenant-assets.controller.ts`. Um manifest estático só sabe
 * dizer uma coisa a todos os clubes, e o que ele diz é o que fica escrito no ecrã
 * inicial do telemóvel do pai. Por isso `manifest: false` aqui, e um `<link>` fixo
 * no `index.html` — em desenvolvimento o proxy abaixo vai buscá-lo à API.
 *
 * ## O âmbito do service worker
 *
 * O ficheiro vive em `/app/sw.js` mas o âmbito é `/`: tem de controlar a
 * `start_url` **e** a landing que oferece a instalação. Quem lho permite é o
 * cabeçalho `Service-Worker-Allowed: /` que a API envia com o ficheiro.
 *
 * Âmbito `/` traz um risco, e é o que a `navigateFallbackAllowlist` fecha: sem
 * ela, o service worker respondia a `/`, a `/ser-socio` e a `/consola` com a
 * casca da app da família — e um pai com a app instalada deixava de conseguir
 * abrir o link que o clube lhe mandou. Só as navegações para `/app/…` caem no
 * `index.html`; tudo o resto vai à rede.
 */
export default defineConfig(({ command, mode }) => {
  const build = command === "build";
  const base = build ? "/app/" : "/";

  /*
   * O login tem de estar configurado **antes** de a app sair daqui.
   *
   * `signIn` fala directamente com o Supabase; sem estes dois valores o botão
   * "Já tenho conta — entrar" falha com "A app não está configurada para entrar"
   * — no telemóvel de um pai, depois do deploy, onde ninguém repara até alguém
   * telefonar ao clube. As variáveis são embutidas no bundle em tempo de
   * compilação, por isso é aqui, e só aqui, que isto se pode apanhar.
   */
  if (build) {
    const env = loadEnv(mode, process.cwd(), "");
    const faltam = ["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY"].filter((k) => !env[k]?.trim());
    if (faltam.length > 0) {
      throw new Error(
        `A app da família não pode ser compilada sem ${faltam.join(" e ")}. ` +
          `Estão em apps/family/.env.production — ver o cabeçalho desse ficheiro.`,
      );
    }
  }

  return {
    base,
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: "autoUpdate",
        // O âmbito do registo, não o do ficheiro. Ver o cabeçalho acima.
        scope: "/",
        // Gerado pela API, por clube.
        manifest: false,
        workbox: {
          navigateFallback: `${base}index.html`,
          navigateFallbackAllowlist: build ? [/^\/app\//] : [/^\/(?!api\/)/],
          // Acrescenta os ouvintes de push ao service worker gerado, sem trocar
          // para injectManifest (que obrigaria a reimplementar o precache à mão).
          importScripts: [`${base}push-sw.js`],
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
    server: {
      port: 5174,
      // Liga a todas as interfaces (0.0.0.0), não só a `localhost` — sem isto, um
      // telemóvel na mesma rede (ou um túnel, que chega pela rede) não encontra o
      // servidor nenhum.
      host: true,
      // O Vite recusa por omissão qualquer `Host` desconhecido (protecção contra
      // DNS rebinding) — é o que barrava o link do localtunnel ("this host is not
      // allowed"). `true` só é aceitável em desenvolvimento; em produção não há
      // `vite dev` a correr.
      allowedHosts: true,
      proxy: {
        // `/api/*` passa para a API local, sem o browser lhe falar directamente.
        //
        // Isto resolve dois problemas de uma vez, e é a razão de existir deste
        // proxy em vez de apontar `VITE_API_URL` para o IP da máquina:
        //
        //   1. **Mixed content**: a app corre atrás de um túnel HTTPS (obrigatório
        //      para o service worker e o push), mas a API local só fala HTTP. Um
        //      pedido directo do browser https→http seria bloqueado. Aqui o pedido
        //      do browser é para o mesmo domínio do túnel (https); é o Vite, a
        //      correr neste PC, que fala com a API em HTTP — servidor a servidor,
        //      onde "mixed content" não se aplica.
        //   2. **CORS**: o pedido do browser deixa de ser cross-origin (é sempre
        //      para a própria origem da app), por isso não depende de a API
        //      reconhecer o domínio do túnel, que muda a cada arranque.
        "/api": { target: "http://localhost:3000", changeOrigin: true },

        /*
         * O manifest, em desenvolvimento.
         *
         * Em produção a API sabe de que clube é pelo `Host`. Em `localhost` não há
         * subdomínio nenhum, por isso o slug vai na query — é a saída que o
         * controlador do manifest aceita, e só serve para aqui.
         */
        "/manifest.webmanifest": {
          target: "http://localhost:3000",
          changeOrigin: true,
          rewrite: () =>
            `/manifest.webmanifest?academia=${encodeURIComponent(
              process.env.VITE_ACADEMY_SLUG ?? "life-club",
            )}`,
        },
      },
    },
    // `true` só serve para testar num telemóvel a sério através de um túnel
    // (loca.lt, ngrok) durante o desenvolvimento — o Vite bloqueia por omissão
    // qualquer Host desconhecido para evitar DNS rebinding.
    preview: { port: 5174, allowedHosts: true },
  };
});

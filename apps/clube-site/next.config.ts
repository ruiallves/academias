import type { NextConfig } from "next";
import path from "node:path";

/**
 * O site dos clubes: uma app Next para todos os clubes, no Vercel.
 *
 * É a única app Next do monorepo, e `02-arquitetura.md` diz "sem Next.js" por
 * uma razão que continua válida para a consola e para a app da família: são
 * apps de sessão, sem Google. Este site é o contrário: vive do Google, do
 * WhatsApp e do Facebook, e cada página tem de chegar já desenhada, com os
 * OG tags certos e em cache. É o caso para que o Next existe.
 *
 * A raiz do monorepo entra aqui duas vezes: `outputFileTracingRoot` para o
 * Vercel levar `packages/ui` no deploy, e `turbopack.root` para o bundler
 * aceitar ficheiros fora da pasta da app (o `tsconfig.paths` aponta
 * `@academia/ui/*` à fonte, como nas outras apps — ver
 * `scripts/check-workspace-deps.mjs`).
 */
const raiz = path.join(import.meta.dirname, "../../");

const config: NextConfig = {
  reactStrictMode: true,
  // O Next gera um AGENTS.md por omissão; o projeto tem a documentação em docs/.
  agentRules: false,
  transpilePackages: ["@academia/ui"],
  outputFileTracingRoot: raiz,
  turbopack: { root: raiz },
  /*
   * Fixadas na build, para o proxy e as páginas lerem o mesmo.
   *
   * No Vercel, o proxy viu `SITE_FONTE=api` (do `.env.production`) e as
   * páginas não: no servidor das páginas o `.env.production` não chegava, a
   * fonte caía para `demo` e todo o clube real dava 404 (14/10). Postas aqui,
   * entram no código de ambos no momento da build. Mudar uma delas pede um
   * novo deploy. O segredo da revalidação fica de fora de propósito: lê-se em
   * tempo de execução, das variáveis do projeto no Vercel.
   */
  env: {
    SITE_FONTE: process.env.SITE_FONTE ?? "demo",
    SITE_API_URL: process.env.SITE_API_URL ?? "",
    SITE_PREVIEW_DOMAIN: process.env.SITE_PREVIEW_DOMAIN ?? "",
    SITE_DEMO_SLUG: process.env.SITE_DEMO_SLUG ?? "",
    // A chave pública do Cloudflare Turnstile (a do browser; a secreta fica na API). Ver `componentes/Turnstile`.
    TURNSTILE_SITE_KEY: process.env.TURNSTILE_SITE_KEY ?? "",
  },
  images: {
    remotePatterns: [
      // As fotos do clube vivem no Supabase Storage, como tudo o resto.
      { protocol: "https", hostname: "*.supabase.co" },
      // Só para a demonstração, enquanto não há fotos reais. Sai quando houver.
      { protocol: "https", hostname: "picsum.photos" },
      { protocol: "https", hostname: "fastly.picsum.photos" },
    ],
  },
};

export default config;

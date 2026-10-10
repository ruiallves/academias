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

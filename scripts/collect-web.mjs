/**
 * Junta a consola e a app da família dentro da API.
 *
 * ## Porque é que isto existe
 *
 * Em produção há **uma origem por clube** — `fafe.academias.pt` — e é a API que a
 * serve inteira: a landing, a adesão a sócio, os convites, a API, a consola em
 * `/consola` e a app da família em `/app`.
 *
 * A razão de fundo é a instalação da PWA: o manifest, o service worker, os ícones
 * e a `start_url` têm de ser da mesma origem da página que oferece a instalação, e
 * essa página é a landing do clube. Uma app noutro domínio não se consegue
 * instalar a partir do link que o diretor manda ao pai — que é o único caminho que
 * ela tem. Ver `apps/api/src/main.ts`, função `serveApps`.
 *
 * ## O que faz
 *
 * Copia os `dist/` já compilados para `apps/api/public/`. Nada mais: não compila
 * (isso é do `npm run build:web`, que corre os `vite build` antes deste ficheiro)
 * e não sabe nada sobre o servidor.
 *
 * `apps/api/public/` é gerado — está no `.gitignore` e é reconstruído a cada
 * deploy. Nunca se edita nada lá dentro.
 */

import { cp, rm, mkdir, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const destino = join(raiz, "apps", "api", "public");

/** De onde vem cada app, e sob que caminho passa a ser servida. */
const APPS = [
  { nome: "consola", de: join(raiz, "apps", "console", "dist"), para: join(destino, "consola") },
  { nome: "app da família", de: join(raiz, "apps", "family", "dist"), para: join(destino, "app") },
];

async function existe(caminho) {
  try {
    await access(caminho);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  await mkdir(destino, { recursive: true });

  for (const { nome, de, para } of APPS) {
    if (!(await existe(de))) {
      console.error(`\n  ✗ ${de} não existe.\n    Corre \`npm run build:web\` na raiz — é ele que compila antes de copiar.\n`);
      process.exit(1);
    }

    // Apagar antes de copiar: sem isto, um ficheiro que deixou de ser produzido
    // pelo build ficava lá para sempre, servido a quem o pedisse.
    await rm(para, { recursive: true, force: true });
    await cp(de, para, { recursive: true });
    console.log(`  ✓ ${nome} → apps/api/public/${para.slice(destino.length + 1)}`);
  }

  console.log("\n  A API serve agora /consola e /app.\n");
}

await main();

#!/usr/bin/env node
/**
 * Quem importa um pacote do workspace declara-o — e aponta-o à fonte.
 *
 * ## Porque é que isto existe
 *
 * O site importava `@academia/ui/legal-markdown` sem ter `@academia/ui` nas
 * dependências, sem o mapeamento no `tsconfig` e sem o alias no Vite. **Compilou
 * e construiu aqui na perfeição**, porque o npm hasteia os pacotes do workspace
 * para o `node_modules` da raiz e a resolução por omissão encontra-os lá.
 *
 * No Vercel não encontrou: a build corre com a *Root Directory* da app, sem esse
 * symlink, e caiu com `Cannot find module '@academia/ui/legal-markdown'` — a
 * primeira notícia foi o deploy vermelho. É o padrão que o projecto já conhece
 * (ver `check-http-clients.mjs`): uma coisa que compila na perfeição e só falha
 * onde não há como a ver.
 *
 * ## As três peças, e o que cada uma resolve
 *
 *   1. **`dependencies`** — declara a ligação. É o que o npm lê.
 *   2. **`tsconfig.paths`** — o TypeScript resolve à fonte (`packages/<pacote>/src`),
 *      e deixa de depender de o symlink existir.
 *   3. **`vite.resolve.alias`** — o mesmo para o bundler, e de lambuja o HMR
 *      passa a funcionar quando se edita o pacote partilhado.
 *
 * As duas últimas são o que torna a build reprodutível fora daqui. A primeira
 * sozinha bastaria ao npm, mas não a quem instala só uma app.
 *
 * Uso: npm run check:deps  (corre dentro do `typecheck`)
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const ler = (rel) => readFileSync(path.join(RAIZ, rel), "utf8");
const existe = (rel) => existsSync(path.join(RAIZ, rel));

/** Os pacotes partilhados que existem — `packages/*`. */
const PARTILHADOS = new Set(
  readdirSync(path.join(RAIZ, "packages"), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => JSON.parse(ler(`packages/${d.name}/package.json`)).name),
);

/** Todos os ficheiros de código de uma pasta. */
function ficheiros(dir) {
  const out = [];
  const abs = path.join(RAIZ, dir);
  if (!existsSync(abs)) return out;
  for (const e of readdirSync(abs, { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) out.push(...ficheiros(rel));
    else if (/\.(ts|tsx|mts)$/.test(e.name)) out.push(rel);
  }
  return out;
}

const problemas = [];
const apps = readdirSync(path.join(RAIZ, "apps"), { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

for (const app of apps) {
  const usados = new Set();
  for (const f of ficheiros(`apps/${app}/src`)) {
    const src = ler(f);
    for (const m of src.matchAll(/from\s+"(@[a-z0-9-]+\/[a-z0-9-]+)(?:\/[^"]*)?"/g)) {
      if (PARTILHADOS.has(m[1])) usados.add(m[1]);
    }
  }
  if (usados.size === 0) continue;

  const pkg = JSON.parse(ler(`apps/${app}/package.json`));
  const declarados = { ...pkg.dependencies, ...pkg.devDependencies };
  const tsconfig = existe(`apps/${app}/tsconfig.json`) ? ler(`apps/${app}/tsconfig.json`) : "";
  const viteFile = ["vite.config.ts", "vite.config.mts", "vite.config.js"].find((f) => existe(`apps/${app}/${f}`));
  const vite = viteFile ? ler(`apps/${app}/${viteFile}`) : "";

  for (const nome of [...usados].sort()) {
    if (!declarados[nome]) {
      problemas.push(`apps/${app}/package.json não declara "${nome}" — a build fora daqui não o encontra`);
    }
    // O `paths` e o alias só se exigem a quem tem TypeScript e Vite próprios.
    if (tsconfig && !tsconfig.includes(`"${nome}/*"`)) {
      problemas.push(`apps/${app}/tsconfig.json não mapeia "${nome}/*" para packages/*/src`);
    }
    if (vite && !new RegExp(`["']${nome.replace("/", "\\/")}["']`).test(vite)) {
      problemas.push(`apps/${app}/${viteFile} não tem alias de "${nome}" para a fonte`);
    }
  }
}

if (problemas.length) {
  console.error("\n  FALHA  pacotes do workspace mal ligados\n");
  for (const p of problemas) console.error(`    · ${p}`);
  console.error("\n  Ver o cabeçalho de scripts/check-workspace-deps.mjs.\n");
  process.exit(1);
}

console.log(`  OK  ${apps.length} apps — os pacotes do workspace estão declarados e apontados à fonte.`);

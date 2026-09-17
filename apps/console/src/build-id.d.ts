/**
 * O identificador deste build.
 *
 * Posto pelo `versaoDoBuild` (`scripts/vite-versao.mjs`) no `define` do Vite, e
 * comparado com o `version.json` que o mesmo plugin escreve ao lado do
 * `index.html` — é assim que a app sabe que está velha. Em `vite dev` vale
 * "dev", e a vigilância não faz nada. Ver `packages/ui/src/versao.ts`.
 */
declare const __BUILD_ID__: string;

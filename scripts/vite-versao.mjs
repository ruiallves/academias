import { execSync } from "node:child_process";

/**
 * Assina o build e publica a assinatura ao lado do `index.html`.
 *
 * Faz duas coisas, e as duas são a mesma coisa vista de dois lados:
 *
 * - substitui `__BUILD_ID__` no código pelo identificador deste build, que fica
 *   dentro do bundle que o browser tem em memória;
 * - escreve `version.json` com o mesmo identificador, que fica no servidor.
 *
 * A app compara os dois e recarrega quando diferem — ver `versao.ts`. É por isso
 * que o identificador tem de mudar **a cada build**: usa-se o commit quando há um
 * (é o que identifica o que foi para produção) e a hora do build a seguir, para
 * que dois builds do mesmo commit também se distingam.
 *
 * Em `vite dev` o identificador é "dev" e a vigilância desliga-se: o HMR já
 * troca o código em memória, e não há `version.json` para pedir.
 *
 * É JavaScript puro, e não TypeScript no pacote partilhado, porque isto corre
 * dentro do `vite.config` das três apps: um `.mjs` importado por caminho não
 * depende de o Vite conseguir transformar um ficheiro do workspace antes de a
 * configuração existir.
 */
export function versaoDoBuild() {
  const id = identificador();
  return {
    name: "academias-versao-do-build",
    config(_config, { command }) {
      return { define: { __BUILD_ID__: JSON.stringify(command === "build" ? id : "dev") } };
    },
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "version.json",
        source: `${JSON.stringify({ build: id }, null, 2)}\n`,
      });
    },
  };
}

function identificador() {
  const carimbo = new Date().toISOString().replace(/[-:]/g, "").slice(0, 13);
  try {
    const commit = execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
    return commit ? `${commit}-${carimbo}` : carimbo;
  } catch {
    /* Sem git (um tarball, um contentor de build) o carimbo chega. */
    return carimbo;
  }
}

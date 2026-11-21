#!/usr/bin/env node
/**
 * Arranca as aplicações todas em desenvolvimento, num terminal só.
 *
 *   npm run dev                      tudo
 *   npm run dev -- consola api       só estas
 *   npm run dev -- --sem site,clube  tudo menos estas
 *   npm run dev -- --lista           o que existe, e em que porta
 *
 * ## O que faz
 *
 * - Lança cada aplicação com o mesmo comando de sempre (`npm run dev:*`), e
 *   cada linha que ela escreve sai com o nome dela à frente, numa cor sua.
 * - **Não arranca o que já está a correr**: se a porta de uma aplicação já
 *   está ocupada (a API que já tinhas aberta noutro terminal, por exemplo),
 *   diz que está a correr e salta-a. Nunca mata nada que não lançou.
 * - Quando cada uma fica pronta (a porta responde), diz o endereço; quando
 *   estão todas, mostra o resumo.
 * - Ctrl+C fecha tudo o que lançou, com os processos filhos (o `nest --watch`,
 *   o Vite, o Next), e mais nada.
 *
 * Se uma aplicação cai, as outras continuam; o erro dela fica no ecrã.
 *
 * ## As portas
 *
 * As mesmas dos `npm run dev:*`. O site dos clubes corre na **5191**: a 5190 é
 * do site academias.pt (o CORS da API e os links legais do painel contam com
 * ela), e as duas apps estavam marcadas para a mesma porta. A API é arrancada
 * com a 5191 também aceite no CORS, porque o site dos clubes fala com ela a
 * partir do browser (carrinho, ser sócio, bilheteira).
 *
 * Sem dependências: só Node, para correr em qualquer máquina com o repositório.
 */
import { spawn, execSync } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WINDOWS = process.platform === "win32";

/** As aplicações, pela ordem em que arrancam. `nomes` são os que se escrevem na linha de comandos. */
const APPS = [
  {
    chave: "api",
    nomes: ["api", "servidor"],
    rotulo: "API",
    porta: 3000,
    script: "dev:api",
    url: "http://localhost:3000",
    // O site dos clubes (5191) chama a API a partir do browser: entra no CORS, só neste arranque.
    env: { SITE_ORIGIN: process.env.SITE_ORIGIN ?? "http://localhost:5190,http://localhost:5191" },
    // A primeira compilação do Nest demora.
    espera: 240,
  },
  { chave: "consola", nomes: ["consola", "console"], rotulo: "Consola", porta: 5173, script: "dev:console", url: "http://localhost:5173" },
  { chave: "app", nomes: ["app", "familia", "family"], rotulo: "App do clube", porta: 5174, script: "dev:family", url: "http://localhost:5174" },
  { chave: "painel", nomes: ["painel", "plataforma", "platform"], rotulo: "Painel da plataforma", porta: 5180, script: "dev:platform", url: "http://localhost:5180" },
  { chave: "site", nomes: ["site", "academias"], rotulo: "Site academias.pt", porta: 5190, script: "dev:site", url: "http://localhost:5190" },
  {
    chave: "clube",
    nomes: ["clube", "clube-site", "sites"],
    rotulo: "Site dos clubes",
    porta: 5191,
    script: "dev:clube-site",
    url: "http://localhost:5191",
    espera: 180,
  },
];

const CORES = [36, 35, 33, 32, 34, 91];
const cor = (n, t) => (process.stdout.isTTY ? `\x1b[${n}m${t}\x1b[0m` : t);
const negrito = (t) => cor(1, t);
const cinza = (t) => cor(90, t);
const largura = Math.max(...APPS.map((a) => a.chave.length));

/* ------------------------------------------------------------- argumentos --- */

const args = process.argv.slice(2);
if (args.includes("--lista") || args.includes("--ajuda") || args.includes("-h")) {
  console.log(negrito("\nAplicações\n"));
  for (const a of APPS) console.log(`  ${a.chave.padEnd(largura + 2)}${a.rotulo.padEnd(24)}${a.url}   ${cinza(`(também: ${a.nomes.join(", ")})`)}`);
  console.log(`\n  npm run dev                      tudo`);
  console.log(`  npm run dev -- consola api       só estas`);
  console.log(`  npm run dev -- --sem site,clube  tudo menos estas\n`);
  process.exit(0);
}

const acharApp = (nome) => APPS.find((a) => a.nomes.includes(nome.toLowerCase()));
const semIdx = args.indexOf("--sem");
const sem = semIdx >= 0 ? (args[semIdx + 1] ?? "").split(",").filter(Boolean) : [];
const pedidas = args.filter((a, i) => !a.startsWith("--") && !(semIdx >= 0 && i === semIdx + 1));

const desconhecidas = [...pedidas, ...sem].filter((n) => !acharApp(n));
if (desconhecidas.length) {
  console.error(`Não conheço: ${desconhecidas.join(", ")}. Corre "npm run dev -- --lista" para ver os nomes.`);
  process.exit(1);
}
let escolhidas = pedidas.length ? APPS.filter((a) => pedidas.some((n) => acharApp(n) === a)) : [...APPS];
escolhidas = escolhidas.filter((a) => !sem.some((n) => acharApp(n) === a));
if (escolhidas.length === 0) {
  console.error("Não sobrou nenhuma aplicação para arrancar.");
  process.exit(1);
}

/* ------------------------------------------------------------------ portas --- */

/** A porta já responde? (alguém a ouvir em localhost) */
function portaOcupada(porta) {
  return new Promise((resolve) => {
    const s = net.connect({ host: "127.0.0.1", port: porta });
    s.setTimeout(800);
    s.once("connect", () => (s.destroy(), resolve(true)));
    s.once("timeout", () => (s.destroy(), resolve(false)));
    s.once("error", () => resolve(false));
  });
}

/* --------------------------------------------------------------- arrancar --- */

const filhos = new Map(); // chave → processo
const estado = new Map(); // chave → "a arrancar" | "pronta" | "ja" | "caiu"
let aFechar = false;

function prefixo(app) {
  const i = APPS.indexOf(app);
  return cor(CORES[i % CORES.length], app.chave.padEnd(largura)) + cinza(" │ ");
}

function encaminhar(app, stream, destino) {
  let resto = "";
  stream.on("data", (pedaco) => {
    const texto = resto + pedaco.toString();
    const linhas = texto.split(/\r?\n/);
    resto = linhas.pop() ?? "";
    for (const l of linhas) if (l.trim()) destino.write(prefixo(app) + l + "\n");
  });
  stream.on("end", () => resto.trim() && destino.write(prefixo(app) + resto + "\n"));
}

function arrancar(app) {
  const npm = WINDOWS ? "npm.cmd" : "npm";
  const filho = spawn(npm, ["run", app.script], {
    cwd: RAIZ,
    env: { ...process.env, FORCE_COLOR: "1", ...(app.env ?? {}) },
    shell: WINDOWS,
    stdio: ["ignore", "pipe", "pipe"],
    // Fora do Windows, um grupo próprio para o Ctrl+C levar os netos (o watcher, o Vite).
    detached: !WINDOWS,
  });
  filhos.set(app.chave, filho);
  estado.set(app.chave, "a arrancar");
  encaminhar(app, filho.stdout, process.stdout);
  encaminhar(app, filho.stderr, process.stderr);
  filho.on("exit", (codigo) => {
    filhos.delete(app.chave);
    if (aFechar) return;
    estado.set(app.chave, "caiu");
    console.log(prefixo(app) + cor(31, `parou (código ${codigo ?? "?"}). As outras continuam; corrige e volta a correr "npm run dev -- ${app.chave}".`));
  });
}

async function esperarPronta(app) {
  const limite = Date.now() + (app.espera ?? 90) * 1000;
  while (Date.now() < limite) {
    if (estado.get(app.chave) === "caiu") return;
    if (await portaOcupada(app.porta)) {
      estado.set(app.chave, "pronta");
      console.log(prefixo(app) + cor(32, `pronta em ${app.url}`));
      return;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.log(prefixo(app) + cor(33, `ainda não responde em ${app.url} ao fim de ${app.espera ?? 90} s. Vê as linhas acima.`));
}

function resumo() {
  console.log(negrito("\nAplicações\n"));
  for (const a of escolhidas) {
    const e = estado.get(a.chave);
    const marca =
      e === "pronta" ? cor(32, "pronta     ")
      : e === "ja" ? cor(36, "já corria  ")
      : e === "caiu" ? cor(31, "parou      ")
      : cor(33, "a arrancar ");
    console.log(`  ${marca} ${a.rotulo.padEnd(24)} ${a.url}`);
  }
  console.log(cinza("\n  Ctrl+C fecha tudo o que este terminal abriu.\n"));
}

/* ------------------------------------------------------------------ fechar --- */

function fechar() {
  if (aFechar) return;
  aFechar = true;
  console.log(cinza("\nA fechar…"));
  for (const filho of filhos.values()) {
    try {
      if (WINDOWS) execSync(`taskkill /pid ${filho.pid} /T /F`, { stdio: "ignore" });
      else process.kill(-filho.pid, "SIGTERM");
    } catch {
      /* já tinha saído */
    }
  }
  setTimeout(() => process.exit(0), 300);
}
process.on("SIGINT", fechar);
process.on("SIGTERM", fechar);

/* -------------------------------------------------------------------- já --- */

console.log(negrito(`\nA arrancar: ${escolhidas.map((a) => a.rotulo).join(", ")}\n`));

const ocupadas = await Promise.all(escolhidas.map((a) => portaOcupada(a.porta)));
const esperas = [];
escolhidas.forEach((app, i) => {
  if (ocupadas[i]) {
    estado.set(app.chave, "ja");
    console.log(prefixo(app) + cor(36, `já está a correr em ${app.url} (a porta ${app.porta} está ocupada). Não lhe toco.`));
    return;
  }
  arrancar(app);
  esperas.push(esperarPronta(app));
});

if (esperas.length === 0) {
  resumo();
  console.log("Estava tudo a correr; não arranquei nada.");
  process.exit(0);
}

await Promise.all(esperas);
resumo();

/**
 * Capturas da consola, tiradas ao código verdadeiro com a rede toda simulada.
 *
 *   node apps/site/scripts/capturas/consola.mjs                 todas as cenas
 *   node apps/site/scripts/capturas/consola.mjs con-atleta      só essas
 *   node apps/site/scripts/capturas/consola.mjs --sem-build     reaproveita o último build
 *
 * O que faz, por ordem:
 *
 *  1. Compila `apps/console` para uma pasta temporária, com o ambiente de
 *     `consola/ambiente/.env` (API e Supabase em portas mortas). Não escreve nada
 *     dentro de `apps/console`.
 *  2. Abre o Chromium e interceta TODOS os pedidos. A consola é servida a partir
 *     do build, em memória; a API e o Supabase são respondidos por
 *     `consola/api.mjs` com os dados de `consola/clube.mjs`; as fontes do Google
 *     passam; tudo o resto é abortado. Não há servidor nenhum à escuta.
 *  3. Para cada cena: congela o relógio, entra com uma sessão falsa, navega,
 *     espera pelas fontes e pelas animações, mede os focos e guarda as imagens e
 *     o manifesto em `apps/site/public/shots/`.
 *
 * Ver LEIA-ME.md ao lado.
 */
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, extname, join, resolve } from "node:path";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

import { criarClube } from "./consola/clube.mjs";
import { criarApi } from "./consola/api.mjs";
import { CENAS } from "./consola/cenas.mjs";

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(AQUI, "../../../..");
const CONSOLA = join(RAIZ, "apps/console");
const SAIDA = join(RAIZ, "apps/site/public/shots");
const MANIFESTO = join(SAIDA, "manifesto-consola.json");
const EMBLEMA = join(RAIZ, "apps/site/public/clube/emblema.png");

/** Onde vivem o playwright-core, o build e os registos. Fora do repositório. */
const TRABALHO = process.env.CAPTURAS_TRABALHO ?? join(tmpdir(), "claude", "capturas-consola");
const BUILD = join(TRABALHO, "build");

const ORIGEM = "http://127.0.0.1:5193";
const API = "http://127.0.0.1:3999";
const SUPABASE = "http://127.0.0.1:3998";
const FONTES = new Set(["fonts.googleapis.com", "fonts.gstatic.com"]);

const args = process.argv.slice(2);
const pedidas = args.filter((a) => !a.startsWith("--"));
const SEM_BUILD = args.includes("--sem-build");
const VER = args.includes("--ver");
const SEM_REMENDOS = args.includes("--sem-remendos");

/* -------------------------------------------------------------------------- */
/* 1. O build                                                                  */
/* -------------------------------------------------------------------------- */

async function compilar() {
  if (SEM_BUILD && existsSync(join(BUILD, "index.html"))) return;
  const { build } = await import("vite");
  console.log("A compilar a consola para", BUILD);
  /*
   * O ambiente das capturas vai também para `process.env`.
   *
   * O `vite.config.ts` da consola recusa compilar sem as variáveis do Supabase e
   * procura-as com `loadEnv` na pasta de onde se corre, não no `envDir`. As do
   * processo ganham a qualquer ficheiro `.env`, por isso é isto que garante que
   * o build leva as portas mortas, corra-se de onde se correr.
   */
  for (const linha of readFileSync(join(AQUI, "consola/ambiente/.env"), "utf8").split(/\r?\n/)) {
    const m = /^([A-Z_]+)=(.*)$/.exec(linha.trim());
    if (m) process.env[m[1]] = m[2];
  }
  await build({
    configFile: join(CONSOLA, "vite.config.ts"),
    root: CONSOLA,
    // A raiz e não `/consola/`: aqui não há API a servir a consola num prefixo.
    base: "/",
    envDir: join(AQUI, "consola/ambiente"),
    cacheDir: join(TRABALHO, "vite-cache"),
    logLevel: "warn",
    build: { outDir: BUILD, emptyOutDir: true },
  });
}

/* -------------------------------------------------------------------------- */
/* 2. A rede                                                                   */
/* -------------------------------------------------------------------------- */

const TIPOS = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp",
  ".woff2": "font/woff2", ".woff": "font/woff", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8",
};

/** Um JWT bem formado e sem valor: a consola só lhe lê o `exp`, o `iat` e o `sub`. */
function jwtFalso(sub) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub, iat: 1790000000, exp: 4102444800, role: "authenticated" })}.assinatura-das-capturas`;
}

const CORS = {
  "access-control-allow-origin": ORIGEM,
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
};

function instalarRede(context, responder, registo) {
  return context.route("**/*", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const metodo = req.method();

    // A consola, servida do build.
    if (url.origin === ORIGEM) {
      const ficheiro = join(BUILD, decodeURIComponent(url.pathname));
      const existe = extname(url.pathname) && existsSync(ficheiro);
      const alvo = existe ? ficheiro : join(BUILD, "index.html");
      return route.fulfill({
        status: 200,
        contentType: TIPOS[extname(alvo)] ?? "application/octet-stream",
        body: readFileSync(alvo),
      });
    }

    // A API.
    if (url.origin === API) {
      if (metodo === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
      const r = responder(metodo, url.pathname, url.searchParams, req.postData());
      if (r) {
        registo.simulados.push(`${metodo} ${url.pathname}${url.search}`);
        if (r.corpo !== undefined) {
          return route.fulfill({ status: r.status, headers: CORS, contentType: r.tipo, body: r.corpo });
        }
        return route.fulfill({
          status: r.status,
          headers: CORS,
          contentType: "application/json",
          body: r.json === undefined ? "" : JSON.stringify(r.json),
        });
      }
      registo.naoSimulados.push(`${metodo} ${url.pathname}${url.search}`);
      return route.fulfill({
        status: 404,
        headers: CORS,
        contentType: "application/json",
        body: JSON.stringify({ message: "Não simulado nas capturas." }),
      });
    }

    // O Supabase: a renovação da sessão e o emblema do clube.
    if (url.origin === SUPABASE) {
      if (metodo === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
      if (url.pathname.startsWith("/auth/v1/")) {
        registo.simulados.push(`${metodo} ${url.pathname}`);
        return route.fulfill({
          status: 200,
          headers: CORS,
          contentType: "application/json",
          body: JSON.stringify({
            access_token: jwtFalso("u-paulo-rebelo"), refresh_token: "refresh-das-capturas", token_type: "bearer", expires_in: 3600,
            user: { id: "u-paulo-rebelo", email: "paulo.rebelo@cdacademias.pt" },
          }),
        });
      }
      if (url.pathname.endsWith("/emblema.png")) {
        return route.fulfill({ status: 200, headers: CORS, contentType: "image/png", body: readFileSync(EMBLEMA) });
      }
      registo.naoSimulados.push(`${metodo} ${url.href}`);
      return route.fulfill({ status: 404, headers: CORS, body: "" });
    }

    // As fontes são a única coisa que sai para a rede.
    if (FONTES.has(url.hostname)) {
      registo.rede.push(url.href);
      return route.continue();
    }

    if (url.protocol === "data:" || url.protocol === "blob:") return route.continue();

    // Qualquer outro destino nunca chega a sair.
    registo.abortados.push(`${metodo} ${url.href}`);
    return route.abort("blockedbyclient");
  });
}

/* -------------------------------------------------------------------------- */
/* 3. As cenas                                                                 */
/* -------------------------------------------------------------------------- */

function chromium() {
  const pw = createRequire(pathToFileURL(join(TRABALHO, "package.json")))("playwright-core");
  let exe = process.env.CAPTURAS_CHROMIUM;
  if (!exe) {
    const base = join(process.env.LOCALAPPDATA ?? "", "ms-playwright");
    const pasta = existsSync(base) ? readdirSync(base).filter((d) => /^chromium-\d+$/.test(d)).sort().pop() : null;
    if (pasta) exe = join(base, pasta, "chrome-win64", "chrome.exe");
  }
  if (!exe || !existsSync(exe)) throw new Error("Chromium não encontrado. Define CAPTURAS_CHROMIUM com o caminho do executável.");
  return { pw, exe };
}

const CSS_DA_CAPTURA = `
  *, *::before, *::after { caret-color: transparent !important; }
  ::-webkit-scrollbar { display: none !important; width: 0 !important; height: 0 !important; }
  * { scrollbar-width: none !important; }
`;

/**
 * Remendos: defeitos de desenho do produto que estragavam todas as capturas.
 *
 * São CSS injetado na página, não alterações ao código. Cada um corresponde a
 * um defeito real da consola, descrito no LEIA-ME; quando o produto for
 * corrigido, apaga-se a linha. `--sem-remendos` fotografa a consola tal como
 * está.
 */
const REMENDOS = `
  /* Os títulos de grupo do menu (OPERAÇÃO, ÁREA TÉCNICA, GESTÃO, CLÍNICO) têm
     line-height 1 e overflow hidden: os acentos das maiúsculas ficam cortados. */
  .nav-group-head > span.truncate { line-height: 1.6 !important; }
`;

async function sossegar(page) {
  // Sem nada a carregar: nem o arranque, nem o blur global, nem um painel.
  await page.waitForFunction(
    () =>
      document.querySelector("#root")?.children.length &&
      !document.querySelector('[role="status"][aria-label^="A carregar"]') &&
      !document.querySelector('[aria-busy="true"]') &&
      !document.querySelector(".animate-spin"),
    null,
    { timeout: 20_000 },
  );
  await page.evaluate(() => document.fonts.ready);
  // As animações de entrada acabam; as infinitas não contam.
  await page.evaluate(async () => {
    const finitas = document.getAnimations().filter((a) => {
      const t = a.effect?.getComputedTiming();
      return t && Number.isFinite(t.endTime);
    });
    await Promise.race([
      Promise.allSettled(finitas.map((a) => a.finished)),
      new Promise((r) => setTimeout(r, 4000)),
    ]);
  });
  await page.waitForTimeout(250);
}

async function capturar(browser, cena, sharp) {
  const registo = { simulados: [], naoSimulados: [], abortados: [], rede: [], consola: [] };
  const clube = criarClube(cena.agora, cena.clube ?? {});
  const responder = criarApi(clube, cena.api ? cena.api(clube) : {});

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 2,
    locale: "pt-PT",
    timezoneId: "Europe/Lisbon",
    serviceWorkers: "block",
    colorScheme: "light",
  });
  await context.clock.setFixedTime(cena.agora);
  await instalarRede(context, responder, registo);
  await context.addInitScript(
    ([sessao, extra]) => {
      localStorage.setItem("academia.session", sessao);
      for (const [k, v] of Object.entries(extra)) localStorage.setItem(k, v);
    },
    [
      JSON.stringify({ accessToken: jwtFalso("u-paulo-rebelo"), refreshToken: "refresh-das-capturas", academySlug: "cd-academias" }),
      cena.localStorage ?? {},
    ],
  );

  const page = await context.newPage();
  await page.routeWebSocket?.(/.*/, (ws) => ws.close());
  page.on("pageerror", (e) => registo.consola.push(`erro: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") registo.consola.push(`console: ${m.text()}`);
  });

  try {
    await page.goto(ORIGEM + cena.url, { waitUntil: "load" });
    await page.addStyleTag({ content: CSS_DA_CAPTURA + (SEM_REMENDOS ? "" : REMENDOS) });
    await sossegar(page);
    if (cena.preparar) {
      await cena.preparar(page, clube);
      await sossegar(page);
    }
    // O rato fora do ecrã: nenhuma linha fica com o realce de quem passa por cima.
    await page.mouse.move(0, 0);
    await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
    await page.waitForTimeout(150);

    const problemas = [];

    /*
     * Remendos de texto de uma cena: frases que o produto tem escritas à mão no
     * código e que ficam erradas para este clube ou para esta data. Trocam-se na
     * página já desenhada, nó de texto a nó de texto. Cada um está explicado na
     * cena que o pede (ver cenas.mjs) e desliga-se com `--sem-remendos`.
     */
    if (cena.remendarTexto && !SEM_REMENDOS) {
      const feitos = await page.evaluate((trocas) => {
        const n = {};
        const andar = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let no = andar.nextNode(); no; no = andar.nextNode()) {
          for (const [de, para] of Object.entries(trocas)) {
            if (no.nodeValue.includes(de)) {
              no.nodeValue = no.nodeValue.replace(de, para);
              n[de] = (n[de] ?? 0) + 1;
            }
          }
        }
        return n;
      }, cena.remendarTexto);
      for (const de of Object.keys(cena.remendarTexto)) {
        // Se o texto já não está lá, o produto foi corrigido e o remendo pode sair.
        if (!feitos[de]) problemas.push(`remendo de texto sem efeito (o produto já não diz "${de}"?)`);
      }
    }
    const avisos = await page.locator('[role="log"] p').allTextContents();
    if (avisos.length) problemas.push(`avisos de erro no ecrã: ${avisos.join(" | ")}`);
    if (registo.naoSimulados.length) problemas.push(`${registo.naoSimulados.length} pedidos não simulados`);
    if (!page.url().startsWith(ORIGEM)) problemas.push(`a consola saiu para ${page.url()}`);

    const focos = {};
    for (const [nome, escolher] of Object.entries(cena.focos ?? {})) {
      const caixa = await escolher(page).first().boundingBox().catch(() => null);
      if (caixa) focos[nome] = [caixa.x, caixa.y, caixa.width, caixa.height].map((n) => Math.round(n * 10) / 10);
      else problemas.push(`foco "${nome}" não encontrado`);
    }

    const png = await page.screenshot({ type: "png" });
    mkdirSync(SAIDA, { recursive: true });
    await sharp(png).webp({ quality: 90 }).toFile(join(SAIDA, `${cena.id}.webp`));
    await sharp(png).resize({ width: 1920 }).webp({ quality: 90 }).toFile(join(SAIDA, `${cena.id}-m.webp`));
    if (VER) writeFileSync(join(TRABALHO, `${cena.id}.png`), await sharp(png).resize({ width: 1920 }).png().toBuffer());

    const manifesto = existsSync(MANIFESTO) ? JSON.parse(readFileSync(MANIFESTO, "utf8")) : {};
    manifesto[cena.id] = {
      ficheiro: `${cena.id}.webp`,
      largura: 1920, altura: 1080, escala: 2,
      descricao: cena.descricao,
      focos,
    };
    writeFileSync(MANIFESTO, JSON.stringify(manifesto, null, 2) + "\n");

    return { registo, problemas };
  } finally {
    writeFileSync(join(TRABALHO, `registo-${cena.id}.json`), JSON.stringify(registo, null, 2));
    await context.close();
  }
}

async function main() {
  mkdirSync(TRABALHO, { recursive: true });
  await compilar();

  const sharp = createRequire(join(RAIZ, "package.json"))("sharp");
  const { pw, exe } = chromium();
  const browser = await pw.chromium.launch({ executablePath: exe, headless: true });

  const cenas = pedidas.length ? CENAS.filter((c) => pedidas.includes(c.id)) : CENAS;
  const desconhecidas = pedidas.filter((p) => !CENAS.some((c) => c.id === p));
  if (desconhecidas.length) console.warn("Cenas desconhecidas:", desconhecidas.join(", "));

  const rede = new Set();
  const abortados = new Set();
  let falhas = 0;
  try {
    for (const cena of cenas) {
      try {
        const { registo, problemas } = await capturar(browser, cena, sharp);
        registo.rede.forEach((u) => rede.add(new URL(u).hostname));
        registo.abortados.forEach((u) => abortados.add(u));
        console.log(`${problemas.length ? "!" : "ok"} ${cena.id}`);
        for (const p of problemas) console.log(`    ${p}`);
        for (const n of [...new Set(registo.naoSimulados)]) console.log(`    não simulado: ${n}`);
        for (const e of [...new Set(registo.consola)].slice(0, 6)) console.log(`    ${e}`);
        if (problemas.length) falhas++;
      } catch (e) {
        falhas++;
        console.log(`X ${cena.id}: ${e.message.split("\n")[0]}`);
      }
    }
  } finally {
    await browser.close();
  }

  console.log("");
  console.log("Saíram para a rede (só fontes):", [...rede].join(", ") || "nada");
  console.log("Abortados antes de sair:", abortados.size ? [...abortados].join(", ") : "nenhum");
  if (falhas) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

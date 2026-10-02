#!/usr/bin/env node
/**
 * Uma sessão viva nunca se deita fora.
 *
 * ## O que aconteceu
 *
 * As pessoas perdiam a sessão "do nada": na consola eram mandadas entrar outra
 * vez a meio do trabalho, e na app do clube caíam no ecrã de entrada sem terem
 * saído. O Supabase não matava sessão nenhuma — medido contra o projecto real,
 * ele só recusa um refresh com duas rodas de atraso, e mesmo aí a sessão
 * continua viva. Éramos nós que a largávamos:
 *
 *  - renovando com uma cópia velha do refresh (a consola e a app guardam a
 *    mesma sessão em duas chaves, e a app guardava-a também em memória);
 *  - tratando qualquer 4xx do Supabase como recusa (409, 429);
 *  - terminando a sessão num 401 da nossa API, mesmo com o Supabase a dizer
 *    que ela estava boa — ou sem se ter conseguido falar com ele.
 *
 * ## O que este teste prova
 *
 * Corre o `lib/session.ts` e o `lib/http.ts` **verdadeiros** da consola e da
 * app (compilados aqui, sem browser) contra um Supabase de mentira que roda os
 * refresh como o verdadeiro: aceita o actual e o imediatamente anterior, recusa
 * os mais velhos com `refresh_token_already_used`. Em cada caso, a pergunta é a
 * mesma: a sessão ainda lá está?
 *
 * Uso: npm run test:sessao
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SUPA = "https://supabase.de-mentira";
const ORIGEM = "https://life-club.academias.pt";
const K_CONSOLA = "academia.session";
const K_APP = "academia.family.session";
const K_FIM = "academia.sessao.fim";

let ok = 0;
let bad = 0;
const check = (l, c, d = "") => {
  if (c) {
    ok++;
    console.log("  OK    " + l);
  } else {
    bad++;
    console.log("  FALHA " + l + (d ? " — " + d : ""));
  }
};

/* -------------------------------------------------------------------------- */
/* Compilar o código verdadeiro das duas apps                                  */
/* -------------------------------------------------------------------------- */

/** O que não interessa aqui (a academia, os avisos, o React) fica de mentira. */
const DE_MENTIRA = {
  console: {
    "@/lib/api": `export const academy = { slug: "life-club" };`,
    "@/lib/avisos": `export const mostrarErro = (t) => globalThis.__avisos.push(t);`,
  },
  family: {
    react: `export const useSyncExternalStore = () => null;`,
    "@/lib/area": `export const appHeader = () => "family";`,
  },
};

async function compilar(app) {
  const src = path.join(RAIZ, "apps", app, "src");
  const mentira = DE_MENTIRA[app];
  const r = await build({
    stdin: {
      contents: `export * as sessao from "@/lib/session"; export * as http from "@/lib/http";`,
      resolveDir: src,
      loader: "ts",
    },
    bundle: true,
    write: false,
    format: "esm",
    platform: "neutral",
    logLevel: "warning",
    define: {
      "import.meta.env": JSON.stringify({ VITE_SUPABASE_URL: SUPA, VITE_SUPABASE_ANON_KEY: "anon", DEV: false, BASE_URL: "/" }),
    },
    plugins: [
      {
        name: "de-mentira",
        setup(b) {
          b.onResolve({ filter: /^(@\/|react$)/ }, (a) => {
            if (mentira[a.path]) return { path: a.path, namespace: "mentira" };
            if (!a.path.startsWith("@/")) return null;
            const base = path.join(src, a.path.slice(2));
            for (const ext of [".ts", ".tsx"]) if (existsSync(base + ext)) return { path: base + ext };
            return null;
          });
          b.onLoad({ filter: /.*/, namespace: "mentira" }, (a) => ({ contents: mentira[a.path], loader: "js" }));
        },
      },
    ],
  });
  return r.outputFiles[0].text;
}

const CODIGO = { console: await compilar("console"), family: await compilar("family") };

/* -------------------------------------------------------------------------- */
/* O mundo de cada caso: relógio, armazenamento, Supabase e a nossa API        */
/* -------------------------------------------------------------------------- */

let agora = 1_800_000_000; // segundos
const relogioReal = Date.now;
Date.now = () => agora * 1000;
const passam = (minutos) => (agora += minutos * 60);

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (sub) => `${b64({ alg: "ES256" })}.${b64({ sub, iat: agora, exp: agora + 3600 })}.assinatura`;
const lerJwt = (t) => JSON.parse(Buffer.from(t.split(".")[1], "base64url").toString());

/** Um `localStorage`: as chaves são propriedades, como no verdadeiro (`Object.keys` vê-as). */
function armazem() {
  const s = {};
  Object.defineProperties(s, {
    getItem: { value: (k) => (Object.keys(s).includes(k) ? s[k] : null) },
    setItem: { value: (k, v) => void (s[k] = String(v)) },
    removeItem: { value: (k) => void delete s[k] },
  });
  return s;
}

const resposta = (status, corpo) =>
  new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } });

let nModulo = 0;

/** Um mundo novo. Devolve os comandos para o montar e para ver o que aconteceu. */
function mundo() {
  const ls = armazem();
  const ss = armazem();
  const idas = [];
  const ouvintes = {};
  const poe = (nome, valor) => Object.defineProperty(globalThis, nome, { value: valor, configurable: true, writable: true });
  poe("localStorage", ls);
  poe("sessionStorage", ss);
  poe("window", {
    localStorage: ls,
    sessionStorage: ss,
    location: { hostname: "life-club.academias.pt", protocol: "https:", origin: ORIGEM, pathname: "/consola/", search: "", hash: "", replace: (u) => idas.push(u) },
    history: { replaceState() {} },
    addEventListener: (tipo, f) => (ouvintes[tipo] = f),
  });
  poe("__avisos", []);

  /* ---- o Supabase: cada sessão é uma cadeia de refresh, e o último é o activo ---- */
  const sessoes = [];
  let n = 0;
  const sup = {
    renovacoes: [], // os refresh com que se tentou renovar, por ordem
    forcar: [], // respostas impostas às próximas renovações: [status, corpo] ou "rede"
    antesDeResponder: null,
    entrar(sub) {
      const s = { sub, cadeia: [`rt-${++n}`], viva: true };
      sessoes.push(s);
      return { sessao: s, par: { accessToken: jwt(sub), refreshToken: s.cadeia[0] } };
    },
    renovar(rt) {
      const s = sessoes.find((x) => x.cadeia.includes(rt));
      if (!s || !s.viva) return [400, { code: 400, error_code: "refresh_token_not_found", msg: "Invalid Refresh Token: Refresh Token Not Found" }];
      const i = s.cadeia.indexOf(rt);
      const ultimo = s.cadeia.length - 1;
      if (i === ultimo) s.cadeia.push(`rt-${++n}`);
      else if (i < ultimo - 1) return [400, { code: 400, error_code: "refresh_token_already_used", msg: "Invalid Refresh Token: Already Used" }];
      return [200, { access_token: jwt(s.sub), refresh_token: s.cadeia.at(-1) }];
    },
    /** A sessão trabalhou noutro sítio: `rodas` renovações, uma por hora. Devolve o par em que ficou. */
    trabalhar(par, rodas) {
      let p = par;
      for (let i = 0; i < rodas; i++) {
        passam(60);
        const [, corpo] = sup.renovar(p.refreshToken);
        p = { accessToken: corpo.access_token, refreshToken: corpo.refresh_token };
      }
      return p;
    },
  };

  /* ---- a nossa API: aceita um token dentro da validade, salvo ordem em contrário ---- */
  const api = { modo: "normal", pedidos: 0 };

  poe("fetch", async (url, init = {}) => {
    if (String(url).startsWith(SUPA)) {
      const rt = JSON.parse(init.body).refresh_token;
      sup.renovacoes.push(rt);
      sup.antesDeResponder?.(rt);
      const forcada = sup.forcar.shift();
      if (forcada === "rede") throw new TypeError("fetch failed");
      return resposta(...(forcada ?? sup.renovar(rt)));
    }
    api.pedidos++;
    if (api.modo === "503") return resposta(503, { message: "Não foi possível verificar a sessão agora." });
    const token = (init.headers?.Authorization ?? "").replace("Bearer ", "");
    const valido = token && lerJwt(token).exp > agora;
    if (api.modo === "401" || !valido) return resposta(401, { message: "Sessão inválida ou expirada" });
    return resposta(200, { ok: true });
  });

  const guardada = (k) => JSON.parse(ls.getItem(k) ?? "null");
  return {
    ls,
    idas,
    ouvintes,
    sup,
    api,
    guardada,
    naConsola: (par) => ls.setItem(K_CONSOLA, JSON.stringify({ ...par, academySlug: "life-club" })),
    naApp: (par) => ls.setItem(K_APP, JSON.stringify({ ...par, name: "Ana Ferreira" })),
    fim: () => guardada(K_FIM)?.motivo ?? null,
    /** Abre a app: só aqui o módulo lê o que está guardado, como ao carregar a página. */
    abrir: (app) => import(`data:text/javascript;base64,${Buffer.from(CODIGO[app] + `\n// ${++nModulo}`).toString("base64")}`),
  };
}

/** O que um pedido fez: `"ok"`, ou o estado e a frase com que falhou. */
async function pedir(m, silencioso = false) {
  try {
    await (silencioso ? m.http.apiGetSilencioso : m.http.apiGet)("/api/qualquer-coisa");
    return "ok";
  } catch (e) {
    return `${e.status}: ${e.message}`;
  }
}

const NAO_CONFIRMADA = "401: Não foi possível confirmar a sessão. Tenta outra vez daqui a pouco.";

/* ========================================================================== */
/* A consola                                                                   */
/* ========================================================================== */

console.log("=== Consola: o token acaba e renova-se ===");
{
  const w = mundo();
  w.naConsola(w.sup.entrar("rui").par);
  passam(59.5);
  const m = await w.abrir("console");
  check("o pedido passa", (await pedir(m)) === "ok");
  check("com uma renovação só", w.sup.renovacoes.length === 1, `${w.sup.renovacoes.length}`);
  check("e o refresh novo ficou guardado", w.guardada(K_CONSOLA)?.refreshToken === "rt-2");
}

console.log("\n=== Consola: a app do clube trabalhou e a cópia da consola envelheceu ===");
{
  const w = mundo();
  const { par } = w.sup.entrar("rui");
  w.naConsola(par); // a entrega copia o par para as duas chaves
  w.naApp(w.sup.trabalhar(par, 2)); // a app rodou o refresh duas vezes
  passam(59.5);
  const m = await w.abrir("console");
  check("o pedido passa", (await pedir(m)) === "ok");
  check("renovou com o refresh da app, e não com o seu, que já seria recusado", w.sup.renovacoes[0] === "rt-3", w.sup.renovacoes.join(","));
  check("a sessão continua guardada", w.guardada(K_CONSOLA) !== null);
  check("ninguém foi mandado entrar", w.idas.length === 0);
}

console.log("\n=== Consola: outro separador renovou a meio ===");
{
  const w = mundo();
  const { par } = w.sup.entrar("rui");
  w.naConsola(par);
  const novo = w.sup.trabalhar(par, 2);
  passam(59.5);
  // O outro separador guarda o par dele no instante em que este pede a renovação.
  w.sup.antesDeResponder = () => {
    w.naConsola(novo);
    w.sup.antesDeResponder = null;
  };
  const m = await w.abrir("console");
  check("o pedido passa", (await pedir(m)) === "ok");
  check("a recusa do refresh velho confirmou-se com o que estava guardado", w.sup.renovacoes.join(",") === "rt-1,rt-3", w.sup.renovacoes.join(","));
  check("ninguém foi mandado entrar", w.idas.length === 0 && w.guardada(K_CONSOLA) !== null);
}

console.log("\n=== Consola: o Supabase responde, mas não é uma recusa ===");
for (const [nome, forcada] of [
  ["409, duas renovações ao mesmo tempo", [409, { code: 409, error_code: "conflict", msg: "Too many concurrent token refresh requests on the same session or refresh token" }]],
  ["429, pedidos a mais", [429, { code: 429, error_code: "over_request_rate_limit", msg: "Request rate limit reached" }]],
  ["500", [500, { code: 500, error_code: "unexpected_failure", msg: "Unexpected failure" }]],
  ["a rede falha uma vez", "rede"],
]) {
  const w = mundo();
  w.naConsola(w.sup.entrar("rui").par);
  passam(61);
  w.sup.forcar = [forcada];
  const m = await w.abrir("console");
  check(`${nome}: o pedido acaba por passar`, (await pedir(m)) === "ok");
  check(`${nome}: a sessão continua guardada`, w.guardada(K_CONSOLA) !== null && w.idas.length === 0);
}

console.log("\n=== Consola: não se consegue falar com o Supabase ===");
{
  const w = mundo();
  w.naConsola(w.sup.entrar("rui").par);
  passam(61);
  w.sup.forcar = Array(6).fill("rede"); // três tentativas por renovação, duas renovações
  const m = await w.abrir("console");
  check("o pedido falha, a dizer que não se confirmou a sessão", (await pedir(m)) === NAO_CONFIRMADA);
  check("mas a sessão continua guardada e ninguém foi mandado entrar", w.guardada(K_CONSOLA) !== null && w.idas.length === 0);
  check("e quando o Supabase volta, o pedido seguinte passa", (await pedir(m)) === "ok");
}

console.log("\n=== Consola: a nossa API responde 401 com a sessão boa ===");
{
  const w = mundo();
  w.naConsola(w.sup.entrar("rui").par);
  w.api.modo = "401";
  const m = await w.abrir("console");
  check("o pedido falha, a dizer que não se confirmou a sessão", (await pedir(m)) === NAO_CONFIRMADA);
  check("tentou renovar, e o Supabase renovou", w.sup.renovacoes.length === 1 && w.guardada(K_CONSOLA)?.refreshToken === "rt-2");
  check("a sessão continua guardada e ninguém foi mandado entrar", w.guardada(K_CONSOLA) !== null && w.idas.length === 0);
  check("o erro aparece no cartão de avisos", globalThis.__avisos.length === 1);
  check("uma sondagem de fundo também não põe ninguém na rua", (await pedir(m, true)) === NAO_CONFIRMADA && w.idas.length === 0 && w.guardada(K_CONSOLA) !== null);
  w.api.modo = "normal";
  check("e quando a API se recompõe, o pedido seguinte passa", (await pedir(m)) === "ok");
}

console.log("\n=== Consola: a API não consegue verificar (503) ===");
{
  const w = mundo();
  w.naConsola(w.sup.entrar("rui").par);
  w.api.modo = "503";
  const m = await w.abrir("console");
  check("o pedido falha com 503", (await pedir(m)).startsWith("503"));
  check("sem renovar e sem mexer na sessão", w.sup.renovacoes.length === 0 && w.guardada(K_CONSOLA) !== null && w.idas.length === 0);
}

console.log("\n=== Consola: a sessão acabou mesmo ===");
{
  const w = mundo();
  const { par, sessao } = w.sup.entrar("rui");
  w.naConsola(par);
  w.naApp(par);
  sessao.viva = false; // palavra-passe mudada noutro aparelho
  passam(61);
  const m = await w.abrir("console");
  check("o pedido falha com 401", (await pedir(m)).startsWith("401"));
  check("a sessão sai do armazenamento", w.guardada(K_CONSOLA) === null);
  check("a pessoa é levada à página de entrada do clube", w.idas.length === 1 && w.idas[0] === `${ORIGEM}/`, w.idas.join(","));
  check("sem cartão de erro por cima", globalThis.__avisos.length === 0);
  check("a cópia da app, que é da mesma conta, sai também", w.guardada(K_APP) === null);
  check("e fica escrito porquê", w.fim() === "refresh_token_not_found", String(w.fim()));
}
{
  const w = mundo();
  const { par, sessao } = w.sup.entrar("treinador");
  w.naConsola(par);
  w.naApp(w.sup.entrar("mae").par); // outra pessoa, na app do mesmo telemóvel
  sessao.viva = false;
  passam(61);
  await pedir(await w.abrir("console"));
  check("a sessão de outra pessoa na app do clube não é tocada", w.guardada(K_CONSOLA) === null && w.guardada(K_APP) !== null);
}

console.log("\n=== Consola: a conta da app é outra ===");
{
  const w = mundo();
  const { par } = w.sup.entrar("treinador");
  w.naConsola(par);
  passam(5);
  w.naApp(w.sup.entrar("mae").par); // mais nova, mas de outra pessoa
  const m = await w.abrir("console");
  check("a consola fica com a sua sessão", m.sessao.readSession()?.accessToken === par.accessToken);
}

console.log("\n=== Consola: sessão sem refresh, e o token já passou ===");
{
  const w = mundo();
  w.naConsola({ accessToken: w.sup.entrar("rui").par.accessToken, refreshToken: "" });
  passam(61);
  const m = await w.abrir("console");
  check("o pedido falha com 401", (await pedir(m)).startsWith("401"));
  check("e a pessoa é levada a entrar, em vez de ficar presa", w.guardada(K_CONSOLA) === null && w.idas.length === 1 && w.fim() === "sem_refresh");
}

/* ========================================================================== */
/* A app do clube                                                              */
/* ========================================================================== */

console.log("\n=== App: o token acaba e renova-se ===");
{
  const w = mundo();
  w.naApp(w.sup.entrar("ana").par);
  passam(59.5);
  const m = await w.abrir("family");
  check("o pedido passa", (await pedir(m)) === "ok");
  check("com uma renovação só, e o refresh novo guardado", w.sup.renovacoes.length === 1 && w.guardada(K_APP)?.refreshToken === "rt-2");
  check("o nome de quem entrou não se perde", w.guardada(K_APP)?.name === "Ana Ferreira");
}

console.log("\n=== App: a consola trabalhou e a cópia da app envelheceu ===");
{
  const w = mundo();
  const { par } = w.sup.entrar("rui");
  w.naApp(par);
  w.naConsola(w.sup.trabalhar(par, 3)); // três horas de consola no telemóvel
  passam(20 * 60); // e a app só volta a abrir no dia seguinte, pelo ícone
  const m = await w.abrir("family");
  check("o pedido passa", (await pedir(m)) === "ok");
  check("renovou com o refresh da consola, e não com o seu, que já seria recusado", w.sup.renovacoes[0] === "rt-4", w.sup.renovacoes.join(","));
  check("a app continua com sessão", m.sessao.readToken() !== null && w.guardada(K_APP) !== null);
  check("e a consola também", w.guardada(K_CONSOLA) !== null);
}

console.log("\n=== App: outra janela da app renovou, e esta tinha a sessão em memória ===");
{
  const w = mundo();
  const { par } = w.sup.entrar("ana");
  w.naApp(par);
  const m = await w.abrir("family"); // esta janela fica com o par de há três horas em memória
  w.naApp(w.sup.trabalhar(par, 3)); // a outra janela (a instalada, por exemplo) foi renovando
  passam(59.5);
  check("o pedido passa", (await pedir(m)) === "ok");
  check("renovou com o refresh guardado, e não com o que tinha em memória", w.sup.renovacoes[0] === "rt-4", w.sup.renovacoes.join(","));
  check("a app continua com sessão", m.sessao.readToken() !== null);
}
{
  const w = mundo();
  const { par } = w.sup.entrar("ana");
  w.naApp(par);
  const m = await w.abrir("family");
  const novo = w.sup.trabalhar(par, 1);
  w.naApp(novo);
  w.ouvintes.storage({ key: K_APP });
  check("o aviso do armazenamento actualiza a sessão em memória", m.sessao.readToken() === novo.accessToken);
  w.ls.removeItem(K_APP);
  w.ouvintes.storage({ key: K_APP });
  check("e sair noutra janela sai também desta", m.sessao.readToken() === null);
}

console.log("\n=== App: o Supabase responde, mas não é uma recusa ===");
for (const [nome, forcada] of [
  ["409, duas renovações ao mesmo tempo", [409, { code: 409, error_code: "conflict", msg: "Too many concurrent token refresh requests on the same session or refresh token" }]],
  ["429, pedidos a mais", [429, { code: 429, error_code: "over_request_rate_limit", msg: "Request rate limit reached" }]],
  ["a rede falha uma vez", "rede"],
]) {
  const w = mundo();
  w.naApp(w.sup.entrar("ana").par);
  passam(61);
  w.sup.forcar = [forcada];
  const m = await w.abrir("family");
  check(`${nome}: o pedido acaba por passar`, (await pedir(m)) === "ok");
  check(`${nome}: a app continua com sessão`, m.sessao.readToken() !== null && w.guardada(K_APP) !== null);
}

console.log("\n=== App: a nossa API responde 401 com a sessão boa ===");
{
  const w = mundo();
  w.naApp(w.sup.entrar("ana").par);
  w.api.modo = "401";
  const m = await w.abrir("family");
  check("o pedido falha, a dizer que não se confirmou a sessão", (await pedir(m)) === NAO_CONFIRMADA);
  check("a app continua com sessão, e não cai no ecrã de entrada", m.sessao.readToken() !== null && w.guardada(K_APP) !== null);
  w.api.modo = "normal";
  check("e quando a API se recompõe, o pedido seguinte passa", (await pedir(m)) === "ok");
}

console.log("\n=== App: não se consegue falar com o Supabase ===");
{
  const w = mundo();
  w.naApp(w.sup.entrar("ana").par);
  passam(61);
  w.sup.forcar = Array(6).fill("rede"); // três tentativas por renovação, duas renovações
  const m = await w.abrir("family");
  check("o pedido falha, a dizer que não se confirmou a sessão", (await pedir(m)) === NAO_CONFIRMADA);
  check("a app continua com sessão", m.sessao.readToken() !== null && w.guardada(K_APP) !== null);
}

console.log("\n=== App: a sessão acabou mesmo ===");
{
  const w = mundo();
  const { par, sessao } = w.sup.entrar("rui");
  w.naApp(par);
  w.naConsola(par);
  sessao.viva = false;
  passam(61);
  const m = await w.abrir("family");
  check("o pedido falha com 401", (await pedir(m)).startsWith("401"));
  check("a app fica sem sessão — é o que a leva ao ecrã de entrada", m.sessao.readToken() === null && w.guardada(K_APP) === null);
  check("a cópia da consola, que é da mesma conta, sai também", w.guardada(K_CONSOLA) === null);
  check("e fica escrito porquê", w.fim() === "refresh_token_not_found", String(w.fim()));
}
{
  const w = mundo();
  const { par, sessao } = w.sup.entrar("mae");
  w.naApp(par);
  w.naConsola(w.sup.entrar("treinador").par);
  sessao.viva = false;
  passam(61);
  await pedir(await w.abrir("family"));
  check("a sessão de outra pessoa na consola não é tocada", w.guardada(K_APP) === null && w.guardada(K_CONSOLA) !== null);
}

console.log("\n=== App: o que se entrega à consola é o par mais novo ===");
{
  const w = mundo();
  const { par } = w.sup.entrar("rui");
  w.naApp(par);
  const m = await w.abrir("family");
  const novo = w.sup.trabalhar(par, 2);
  w.naConsola(novo); // a consola trabalhou; a app, aberta ao lado, tem o par antigo em memória
  check("a entrega leva o par da consola, e não o antigo por cima dele", m.sessao.readStoredSession()?.refreshToken === novo.refreshToken);
}

Date.now = relogioReal;
console.log(`\n${ok} passaram, ${bad} falharam`);
process.exit(bad ? 1 : 0);

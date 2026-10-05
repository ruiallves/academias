/**
 * Capturas reais da App do Clube (apps/family), com a rede toda simulada.
 *
 * Como correr (a partir de academia-pro):
 *
 *   1. Uma vez, fora do repositório:
 *        mkdir %TEMP%\claude\capturas-app && cd %TEMP%\claude\capturas-app && npm init -y && npm i playwright-core
 *      (outra pasta: CAPTURAS_PW_DIR=<pasta>; outro Chromium: CAPTURAS_CHROMIUM=<chrome.exe>)
 *   2. node apps/site/scripts/capturas/app.mjs              todas as capturas
 *      node apps/site/scripts/capturas/app.mjs app-inicio   só as que começam por esse id
 *      node apps/site/scripts/capturas/app.mjs --ver        guarda também PNG pequenos para ver (pasta temporária)
 *
 * O que faz:
 *  - Arranca um Vite próprio para apps/family na porta 5194, dentro deste processo, a partir da
 *    configuração verdadeira da app mas SEM proxy (nada chega à API da porta 3000) e sem o
 *    service worker. O Supabase aponta para http://127.0.0.1:3998, onde não há nada.
 *  - No browser interceta todos os pedidos: só passa o código servido pelo Vite e as fontes do
 *    Google. /api, /auth, /billing, /icone, o manifest e o Supabase são respondidos daqui, com as
 *    fixtures de fixtures-app/. O que não estiver simulado leva 404 e fica no registo final.
 *  - Guarda <id>.webp (1170×2532), <id>-m.webp (585 de largura) e, nos ecrãs mais altos do que o
 *    telemóvel, <id>-alto.webp, em apps/site/public/shots/, e atualiza manifesto-app.json a cada
 *    captura.
 *
 * As fixtures descrevem o clube ao longo da semana do GUIAO. Cada cena diz a hora, e o "servidor"
 * simulado responde com o mundo como estava nessa hora: o que já foi pago, a convocatória que já
 * saiu, os avisos já publicados, os treinos já registados.
 */
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import net from "node:net";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(AQUI, "../../../..");
const FAMILY = path.join(REPO, "apps/family");
const SHOTS = path.join(REPO, "apps/site/public/shots");
const CLUBE = path.join(REPO, "apps/site/public/clube");
const FIX = path.join(AQUI, "fixtures-app");
const MANIFESTO = path.join(SHOTS, "manifesto-app.json");

const PW_DIR = process.env.CAPTURAS_PW_DIR ?? path.join(os.tmpdir(), "claude", "capturas-app");
const CHROMIUM =
  process.env.CAPTURAS_CHROMIUM ??
  path.join(process.env.LOCALAPPDATA ?? "", "ms-playwright", "chromium-1234", "chrome-win64", "chrome.exe");

const PORTA = 5194;
const ORIGEM = `http://127.0.0.1:${PORTA}`;
const SUPABASE = "http://127.0.0.1:3998";
const FONTES = new Set(["fonts.googleapis.com", "fonts.gstatic.com"]);

const LARGURA = 390;
const ALTURA = 844;
const ESCALA = 3;
const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

const args = process.argv.slice(2);
const VER = args.includes("--ver");
const FILTROS = args.filter((a) => !a.startsWith("--"));
const PREVIEWS = path.join(PW_DIR, "ver");

const requireRepo = createRequire(path.join(REPO, "package.json"));
const requirePw = createRequire(path.join(PW_DIR, "package.json"));

const ler = (nome) => JSON.parse(fs.readFileSync(path.join(FIX, nome), "utf8"));
const CLUBES = ler("clubes.json");
const PESSOAS = ler("pessoas.json");
const SESSIONS = ler("sessions.json");
const MATCHES = ler("matches.json");
const CHARGES = ler("charges.json");
const AVISOS = ler("avisos.json");
const DESENVOLVIMENTO = ler("desenvolvimento.json");
const SOCIO = ler("socio.json");

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const t = (iso) => new Date(iso).getTime();

/* -------------------------------------------------------------------------- */
/* Registo: o que foi simulado, o que faltou e o que foi travado               */
/* -------------------------------------------------------------------------- */

const registo = {
  simulados: new Map(),
  naoSimulados: [],
  bloqueados: [],
  /** Para onde seguiram pedidos a sério. Só pode ter o Vite e as fontes. */
  passaram: new Map(),
  errosDaPagina: [],
};
const contar = (mapa, chave) => mapa.set(chave, (mapa.get(chave) ?? 0) + 1);

/* -------------------------------------------------------------------------- */
/* O mundo à hora da cena                                                      */
/* -------------------------------------------------------------------------- */

const logoUrl = (clube) => `/__capturas/clube/${clube.emblema}`;

function semPrivados(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([k]) => !k.startsWith("_")));
}

function mundo(cena) {
  const agora = cena.agora.getTime();
  const clube = CLUBES[cena.clube];
  const pessoa = PESSOAS[cena.pessoa];
  const atleta = pessoa.role === "ATHLETE";

  const sessions = SESSIONS.map((s) => {
    const feito = t(s.endsAt) <= agora;
    return { ...s, status: feito ? "DONE" : s.status, recorded: feito, absences: feito ? s.absences : [] };
  });

  const matches = MATCHES.map((m) => {
    const submitted = t(m._submittedAt) <= agora;
    const acabou = t(m.endsAt) <= agora;
    const resposta = cena.respostas[m.id];
    return {
      ...semPrivados(m),
      submitted,
      status: acabou ? "PLAYED" : m.status,
      ourScore: acabou && m._resultado ? m._resultado[0] : m.ourScore,
      theirScore: acabou && m._resultado ? m._resultado[1] : m.theirScore,
      calledUp: submitted ? m.calledUp.map((c) => (resposta ? { ...c, ...resposta } : c)) : [],
    };
  });

  const charges = CHARGES.map((c) => {
    const pago = t(c._settledAt) <= agora;
    return {
      ...semPrivados(c),
      status: pago ? "SETTLED" : "OPEN",
      overdue: !pago && t(c.dueDate) < agora,
      openPayment: pago ? null : (cena.pagamentos[c.id] ?? null),
    };
  });

  const porData = (campo) => (a, b) => t(b[campo]) - t(a[campo]);

  const announcements = AVISOS.announcements.filter((a) => t(a.publishedAt) <= agora).sort(porData("publishedAt"));

  const notifications = (atleta ? AVISOS.notificationsAtleta : AVISOS.notifications)
    .filter((n) => t(n.createdAt) <= agora)
    .sort(porData("createdAt"))
    .map((n) => ({
      ...semPrivados(n),
      readAt: cena.lidas.has(n.id)
        ? cena.agora.toISOString()
        : n._readAt && t(n._readAt) <= agora
          ? new Date(n._readAt).toISOString()
          : null,
    }));

  const evaluations = DESENVOLVIMENTO.evaluations.filter((e) => t(e.publishedAt) <= agora);
  const reports = DESENVOLVIMENTO.reports.filter((r) => t(r.publishedAt) <= agora);

  const contextos = cena.contextos.map((type) => {
    if (type === "MEMBER") return { type, memberId: SOCIO.member.id, number: SOCIO.member.number, status: SOCIO.member.status };
    // Só nas cenas do seletor com as quatro áreas: aí a conta também é da equipa técnica.
    if (type === "STAFF") return { type, role: "COACH" };
    return { type };
  });

  return {
    clube,
    pessoa,
    atleta,
    contextos,
    bootstrap: {
      academy: {
        id: clube.id,
        slug: clube.slug,
        name: clube.name,
        shortName: clube.shortName,
        signalColor: clube.signalColor,
        city: clube.city,
        logoUrl: logoUrl(clube),
      },
      sports: PESSOAS.sports,
      season: PESSOAS.season,
      me: pessoa,
    },
    athletes: PESSOAS.athletes,
    teams: PESSOAS.teams,
    sessions,
    matches,
    charges,
    announcements,
    notifications,
    evaluations,
    reports,
    nutricao: DESENVOLVIMENTO.nutricao,
    events: AVISOS.events,
    socio: {
      ...SOCIO,
      academy: {
        name: clube.name,
        shortName: clube.shortName,
        slug: clube.slug,
        logoUrl: logoUrl(clube),
        signalColor: clube.signalColor,
        ...SOCIO.academy,
      },
    },
  };
}

/* -------------------------------------------------------------------------- */
/* A API simulada                                                              */
/* -------------------------------------------------------------------------- */

const json = (route, corpo, status = 200) =>
  route.fulfill({
    status,
    contentType: "application/json; charset=utf-8",
    headers: { "access-control-allow-origin": "*" },
    body: JSON.stringify(corpo),
  });

function sessaoSupabase(cena) {
  const pessoa = PESSOAS[cena.pessoa];
  return {
    access_token: jwt(pessoa),
    refresh_token: "refresh-de-capturas",
    token_type: "bearer",
    expires_in: 3600,
    user: { id: pessoa.userId, email: pessoa.email, user_metadata: { name: pessoa.name } },
  };
}

/** Devolve `true` se respondeu. */
async function simular(route, req, url, cena) {
  const metodo = req.method();
  const p = url.pathname;
  const m = mundo(cena);
  const ok = async (corpo, status = 200) => {
    contar(registo.simulados, `${metodo} ${p.replace(/(atl|cob|jogo|treino)-[\w-]+/g, ":id")}`);
    await json(route, corpo, status);
    return true;
  };
  let corpo = null;
  if (metodo !== "GET") {
    try {
      corpo = req.postDataJSON();
    } catch {
      corpo = null;
    }
  }

  if (metodo === "GET") {
    if (p === "/auth/memberships") return ok({ academies: [{ slug: m.clube.slug, role: m.pessoa.role }] });
    if (p === "/api/app/contexts") return ok({ contexts: m.contextos });
    if (p === "/api/legal/status") return ok(PESSOAS.legalStatus);
    if (p === "/api/bootstrap") return ok(m.bootstrap);
    if (p === "/api/athletes") return ok(m.athletes);
    if (/^\/api\/athletes\/[\w-]+\/fee$/.test(p)) return ok(PESSOAS.fee);
    if (/^\/api\/athletes\/[\w-]+\/notas-escolares$/.test(p)) {
      return ok({ ...PESSOAS.notasEscolares, editable: !m.atleta });
    }
    if (p === "/api/teams") return ok(m.teams);
    if (p === "/api/sessions") return ok(m.sessions);
    if (p === "/api/matches") return ok(m.matches);
    if (p === "/api/charges") return ok(m.charges);
    if (p === "/api/announcements") return ok(m.announcements);
    if (p === "/api/notifications") return ok(m.notifications);
    if (p === "/api/evaluations") return ok(m.evaluations);
    if (p === "/api/reports") return ok(m.reports);
    if (p === "/api/nutricao") return ok(m.nutricao);
    if (p === "/api/events") return ok(m.events);
    if (p === "/api/socio/inicio") return ok(m.socio);
    if (p === "/api/socio/notificacoes") return ok(m.notifications);
    if (p === "/billing/cotacao") return ok(PESSOAS.cotacao);
    if (p === "/billing/mandate") return ok(null);
    if (p === "/manifest.webmanifest") {
      return ok({ name: m.clube.name, short_name: m.clube.shortName, display: "standalone", theme_color: m.clube.signalColor, icons: [] });
    }
    if (p.startsWith("/icone/")) {
      contar(registo.simulados, "GET /icone/*");
      await route.fulfill({ status: 200, contentType: "image/svg+xml", body: fs.readFileSync(path.join(CLUBE, m.clube.emblema)) });
      return true;
    }
  }

  if (metodo === "POST" && p === "/api/presence") return ok({ ok: true }, 201);

  if (metodo === "PATCH" && (p === "/api/notifications/read" || p === "/api/socio/notificacoes/read")) {
    for (const id of corpo?.ids ?? []) cena.lidas.add(id);
    return ok({ ok: true });
  }

  /* Responder à convocatória: fica dito, e a releitura seguinte já o traz. */
  const resposta = p.match(/^\/api\/matches\/([\w-]+)\/convocatoria\/resposta$/);
  if (metodo === "POST" && resposta) {
    const status = corpo?.going ? "CONFIRMED" : "DECLINED";
    cena.respostas[resposta[1]] = {
      status,
      declineReason: corpo?.going ? null : (corpo?.reason ?? null),
      respondedAt: cena.agora.toISOString(),
    };
    return ok({ matchId: resposta[1], athleteId: corpo?.athleteId, status, declineReason: corpo?.reason ?? null }, 201);
  }

  /* Iniciar um pagamento: nenhuma euPago do outro lado, só a resposta que a app espera. */
  const pagar = p.match(/^\/billing\/charges\/([\w-]+)\/pay$/);
  if (metodo === "POST" && pagar) {
    const cobranca = CHARGES.find((c) => c.id === pagar[1]);
    const iniciado = {
      method: corpo?.method ?? "MBWAY",
      status: "PROCESSING",
      amountCents: cobranca?.amountCents ?? 0,
      entity: null,
      reference: null,
      redirectUrl: null,
    };
    cena.pagamentos[pagar[1]] = iniciado;
    return ok(iniciado, 201);
  }

  return false;
}

async function rotear(route, cena) {
  const req = route.request();
  let url;
  try {
    url = new URL(req.url());
  } catch {
    registo.bloqueados.push(`${req.method()} ${req.url()}`);
    return route.abort();
  }

  if (url.origin === ORIGEM) {
    const p = url.pathname;

    if (p.startsWith("/__capturas/clube/")) {
      const ficheiro = path.join(CLUBE, path.basename(p));
      const tipo = ficheiro.endsWith(".svg") ? "image/svg+xml" : "image/png";
      return route.fulfill({ status: 200, contentType: tipo, body: fs.readFileSync(ficheiro) });
    }

    /* Tudo o que em produção é a API, mesmo sendo da mesma origem. */
    if (/^\/(api|auth|billing|icone|webhooks|l)(\/|$)/.test(p) || p === "/manifest.webmanifest") {
      if (await simular(route, req, url, cena)) return;
      registo.naoSimulados.push(`[${cena.nome}] ${req.method()} ${p}${url.search}`);
      return json(route, { message: "Não simulado nas capturas." }, 404);
    }

    /* O resto é código e ficheiros da app, servidos pelo Vite desta captura. */
    if (req.method() !== "GET") {
      registo.naoSimulados.push(`[${cena.nome}] ${req.method()} ${p}`);
      return json(route, { message: "Não simulado nas capturas." }, 404);
    }
    contar(registo.passaram, url.host);
    return route.continue();
  }

  if (FONTES.has(url.hostname)) {
    contar(registo.passaram, url.host);
    return route.continue();
  }

  if (url.origin === SUPABASE) {
    if (req.method() === "OPTIONS") {
      return route.fulfill({
        status: 204,
        headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" },
      });
    }
    if (url.pathname === "/auth/v1/token") {
      contar(registo.simulados, "POST supabase /auth/v1/token");
      return json(route, sessaoSupabase(cena));
    }
    if (url.pathname === "/auth/v1/user") {
      contar(registo.simulados, "GET supabase /auth/v1/user");
      return json(route, sessaoSupabase(cena).user);
    }
    registo.naoSimulados.push(`[${cena.nome}] ${req.method()} supabase ${url.pathname}`);
    return json(route, { message: "Não simulado nas capturas." }, 404);
  }

  registo.bloqueados.push(`[${cena.nome}] ${req.method()} ${url.origin}${url.pathname}`);
  return route.abort();
}

/* -------------------------------------------------------------------------- */
/* Sessão                                                                       */
/* -------------------------------------------------------------------------- */

const b64u = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");

/** Um JWT bem formado e sem valor nenhum: a assinatura é texto, e nenhum servidor o vai ver. */
function jwt(pessoa) {
  const cabecalho = b64u({ alg: "HS256", typ: "JWT" });
  const corpo = b64u({
    sub: pessoa.userId,
    email: pessoa.email,
    role: "authenticated",
    aud: "authenticated",
    iat: 1790000000, // 21/09/2026
    exp: 1893456000, // 01/01/2030
  });
  return `${cabecalho}.${corpo}.${Buffer.from("assinatura-de-capturas").toString("base64url")}`;
}

function armazenamento(cena) {
  const clube = CLUBES[cena.clube];
  const pessoa = PESSOAS[cena.pessoa];
  const p = clube.shortName.trim().split(/\s+/);
  return {
    "academia.family.session": JSON.stringify({ accessToken: jwt(pessoa), refreshToken: "refresh-de-capturas", name: pessoa.name }),
    "academia.family.slug": clube.slug,
    "academia.brand": JSON.stringify({
      color: clube.signalColor,
      shortName: clube.shortName,
      mark: ((p[0]?.[0] ?? "") + (p[1]?.[0] ?? "")).toUpperCase(),
      logoUrl: logoUrl(clube),
    }),
    "academia.family.onboarded.v1": "1",
    [`academia.socio.foto-sugerida:${SOCIO.member.id}`]: "2026-09-14T10:00:00.000Z",
    [`academias.pagamentos.aceita.${clube.name}`]: "1",
  };
}

/* -------------------------------------------------------------------------- */
/* Vite                                                                         */
/* -------------------------------------------------------------------------- */

function portaLivre(porta) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once("error", () => resolve(false));
    s.once("listening", () => s.close(() => resolve(true)));
    s.listen(porta, "127.0.0.1");
  });
}

async function arrancarVite() {
  if (!(await portaLivre(PORTA))) throw new Error(`A porta ${PORTA} está ocupada. Fecha o que lá estiver e volta a correr.`);

  // O Supabase da app passa a ser um endereço onde não há nada; a chave é um texto qualquer.
  process.env.VITE_SUPABASE_URL = SUPABASE;
  process.env.VITE_SUPABASE_ANON_KEY = "chave-de-capturas";
  process.env.VITE_API_URL = "";
  process.env.VITE_ACADEMY_SLUG = "cd-academias";

  const vite = await import(pathToFileURL(path.join(REPO, "node_modules/vite/dist/node/index.js")).href);
  const carregada = await vite.loadConfigFromFile({ command: "serve", mode: "development" }, path.join(FAMILY, "vite.config.ts"), FAMILY);
  const base = carregada.config;

  // Sem service worker: nas capturas não há nada para ele guardar, e escrevia em apps/family/dev-dist.
  const plugins = (base.plugins ?? []).flat(Infinity).filter((p) => p && !String(p.name ?? "").startsWith("vite-plugin-pwa"));

  const servidor = await vite.createServer({
    ...base,
    configFile: false,
    root: FAMILY,
    // Sem ficheiros .env: o que a app lê vem das quatro variáveis acima e de mais lado nenhum.
    envDir: FIX,
    cacheDir: path.join(PW_DIR, "vite-cache"),
    plugins,
    logLevel: "warn",
    clearScreen: false,
    // SEM PROXY. Na configuração da app, /api e /auth seguem para a API da porta 3000.
    server: { ...base.server, host: "127.0.0.1", port: PORTA, strictPort: true, proxy: {}, open: false, allowedHosts: undefined },
  });
  await servidor.listen();

  // Prova de que a app compilada aponta para o Supabase de mentira.
  const fonte = await (await fetch(`${ORIGEM}/src/lib/session.ts`)).text();
  const lido = fonte.match(/"VITE_SUPABASE_URL":\s*"([^"]*)"/)?.[1];
  if (lido !== SUPABASE || /supabase\.co/.test(fonte)) {
    await servidor.close();
    throw new Error(`A app ficou com o Supabase "${lido}" no ambiente, e devia ser ${SUPABASE}. Não se captura nada assim.`);
  }
  if (Object.keys(servidor.config.server.proxy ?? {}).length > 0) {
    await servidor.close();
    throw new Error("O Vite das capturas ficou com proxy. Não se captura nada assim.");
  }
  console.log(`Vite das capturas em ${ORIGEM}, sem proxy; Supabase da app: ${lido}`);
  return servidor;
}

/* -------------------------------------------------------------------------- */
/* Capturar                                                                     */
/* -------------------------------------------------------------------------- */

let browser;
let sharp;
const feitas = [];

function lerManifesto() {
  try {
    return JSON.parse(fs.readFileSync(MANIFESTO, "utf8"));
  } catch {
    return {};
  }
}

function gravarManifesto(id, entrada) {
  const manifesto = lerManifesto();
  manifesto[id] = entrada;
  // Os retângulos dos focos numa linha só, como no GUIAO: [x, y, largura, altura].
  const texto = JSON.stringify(manifesto, null, 2).replace(
    /\[\s+(-?\d+),\s+(-?\d+),\s+(-?\d+),\s+(-?\d+)\s+\]/g,
    "[$1, $2, $3, $4]",
  );
  fs.writeFileSync(MANIFESTO, `${texto}\n`, "utf8");
}

const CSS_DAS_CAPTURAS = `
  *, *::before, *::after { caret-color: transparent !important; }
  ::-webkit-scrollbar { display: none !important; width: 0 !important; height: 0 !important; }
  html { scrollbar-width: none !important; }
`;

/**
 * Abre a app numa cena: uma pessoa, um clube, uma hora, e o que essa conta tem no clube.
 *
 * Cada cena tem o seu contexto de browser, limpo, com o relógio parado na hora da cena.
 */
async function abrir({ nome, agora, pessoa = "carla", clube = "cd-academias", contextos = ["FAMILY", "MEMBER"], area = "FAMILY", rota = "/", respostas = {} }) {
  const cena = {
    nome,
    agora: new Date(agora),
    pessoa,
    clube,
    contextos,
    respostas: { ...respostas },
    pagamentos: {},
    lidas: new Set(),
  };

  const contexto = await browser.newContext({
    viewport: { width: LARGURA, height: ALTURA },
    deviceScaleFactor: ESCALA,
    isMobile: true,
    hasTouch: true,
    userAgent: IPHONE,
    locale: "pt-PT",
    timezoneId: "Europe/Lisbon",
    colorScheme: "light",
    serviceWorkers: "block",
  });
  await contexto.route("**/*", (route) => rotear(route, cena));

  await contexto.addInitScript(
    ({ guardar, css }) => {
      try {
        for (const [k, v] of Object.entries(guardar)) localStorage.setItem(k, v);
      } catch {
        /* about:blank não tem armazenamento */
      }
      const por = () => {
        const s = document.createElement("style");
        s.setAttribute("data-capturas", "");
        s.textContent = css;
        document.head?.appendChild(s);
      };
      if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", por);
      else por();
    },
    { guardar: armazenamento(cena), css: CSS_DAS_CAPTURAS },
  );

  const page = await contexto.newPage();
  page.on("pageerror", (e) => registo.errosDaPagina.push(`[${nome}] ${e.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error" && !/Failed to load resource|404/.test(msg.text())) {
      registo.errosDaPagina.push(`[${nome}] consola: ${msg.text().slice(0, 300)}`);
    }
  });

  // O relógio do browser fica parado na hora da cena: datas, "hoje" e "amanhã", e os
  // temporizadores da app (releituras, presença, marcar notificações como lidas).
  await page.clock.install({ time: new Date(cena.agora.getTime() - 1000) });
  await page.clock.pauseAt(cena.agora);

  const destino = area ? `${rota}${rota.includes("?") ? "&" : "?"}area=${area}` : rota;
  await page.goto(`${ORIGEM}${destino}`, { waitUntil: "load" });

  return { page, cena, contexto, fechar: () => contexto.close() };
}

/** Fontes carregadas, imagens desenhadas, animações acabadas. */
async function assentar(page) {
  await page.evaluate(() => document.fonts.ready.then(() => true));
  const limite = Date.now() + 8000;
  for (;;) {
    const estado = await page.evaluate(() => {
      const animacoes = document.getAnimations().filter((a) => {
        if (a.playState !== "running") return false;
        const tempo = a.effect?.getComputedTiming();
        return tempo ? tempo.iterations !== Infinity : true;
      }).length;
      const imagens = [...document.images].filter((i) => !i.complete || i.naturalWidth === 0).length;
      return { animacoes, imagens };
    });
    if (estado.animacoes === 0 && estado.imagens === 0) break;
    if (Date.now() > limite) throw new Error(`O ecrã não assentou: ${JSON.stringify(estado)}`);
    await dormir(60);
  }
  await dormir(150);
}

/** O que nunca pode estar à vista numa captura. */
const PROIBIDO = [
  "A carregar",
  "Não foi possível",
  "Instala a app",
  "Antes de começar",
  "Os termos foram atualizados",
  "Sem acesso",
  "expirou",
  "Está a demorar",
  "Esta conta não",
  "Ainda não há atletas",
  "Este evento já não existe",
  "Bem-vindo à",
];

async function verificar(page, id) {
  const texto = await page.evaluate(() => document.body.innerText);
  const achado = PROIBIDO.find((p) => texto.includes(p));
  if (achado) throw new Error(`${id}: o ecrã tem "${achado}" à vista.`);
  const aGirar = await page.evaluate(() => document.querySelectorAll(".animate-pulse, .animate-spin, [aria-busy]").length);
  if (aGirar > 0) throw new Error(`${id}: há ${aGirar} elemento(s) de carregamento à vista.`);
}

async function retangulo(alvo) {
  if ((await alvo.count()) === 0) return null;
  const caixa = await alvo.first().boundingBox();
  if (!caixa) return null;
  return [Math.round(caixa.x), Math.round(caixa.y), Math.round(caixa.width), Math.round(caixa.height)];
}

/**
 * Tira a captura do que está no ecrã e regista-a no manifesto.
 *
 * `focos` é um mapa nome → locator. `alto` pede também a página inteira, como um telemóvel
 * muito comprido: o cabeçalho em cima, a barra em baixo, tudo o resto pelo meio.
 */
async function tirar(sessao, id, descricao, { focos = {}, alto = "auto" } = {}) {
  const { page, cena } = sessao;
  await assentar(page);
  await verificar(page, id);

  const rects = {};
  for (const [nome, alvo] of Object.entries(focos)) {
    const r = await retangulo(alvo);
    if (r) rects[nome] = r;
    // Um foco que este ecrã não tem (a convocatória antes de sair, por exemplo) fica de fora.
  }

  const png = await page.screenshot({ type: "png", caret: "hide" });
  const meta = await sharp(png).metadata();
  if (meta.width !== LARGURA * ESCALA || meta.height !== ALTURA * ESCALA) {
    throw new Error(`${id}: saiu ${meta.width}×${meta.height}, e devia ser ${LARGURA * ESCALA}×${ALTURA * ESCALA}.`);
  }
  await sharp(png).webp({ quality: 90 }).toFile(path.join(SHOTS, `${id}.webp`));
  await sharp(png).resize({ width: (LARGURA * ESCALA) / 2 }).webp({ quality: 90 }).toFile(path.join(SHOTS, `${id}-m.webp`));
  if (VER) await sharp(png).resize({ width: LARGURA }).png().toFile(path.join(PREVIEWS, `${id}.png`));

  const entrada = {
    ficheiro: `${id}.webp`,
    movel: `${id}-m.webp`,
    largura: LARGURA,
    altura: ALTURA,
    escala: ESCALA,
    descricao,
    cena: cena.agora.toLocaleString("pt-PT", { timeZone: "Europe/Lisbon", weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }),
    focos: rects,
  };

  /* A página inteira, quando é mais alta do que o telemóvel e não há folha por cima. */
  const deslocado = await page.evaluate(() => window.scrollY);
  const total = await page.evaluate(() => document.documentElement.scrollHeight);
  const querAlto = alto === true || (alto === "auto" && deslocado === 0 && total > ALTURA + 24);
  const ficheiroAlto = path.join(SHOTS, `${id}-alto.webp`);
  if (querAlto && total * ESCALA <= 16000) {
    await page.setViewportSize({ width: LARGURA, height: total });
    await dormir(250);
    const real = await page.evaluate(() => document.documentElement.scrollHeight);
    if (real !== total) {
      await page.setViewportSize({ width: LARGURA, height: real });
      await dormir(250);
    }
    await assentar(page);
    const pngAlto = await page.screenshot({ type: "png", caret: "hide" });
    const metaAlto = await sharp(pngAlto).metadata();
    await sharp(pngAlto).webp({ quality: 90 }).toFile(ficheiroAlto);
    if (VER) await sharp(pngAlto).resize({ width: LARGURA }).png().toFile(path.join(PREVIEWS, `${id}-alto.png`));
    entrada.alto = { ficheiro: `${id}-alto.webp`, largura: LARGURA, altura: Math.round(metaAlto.height / ESCALA), escala: ESCALA };
    await page.setViewportSize({ width: LARGURA, height: ALTURA });
    await dormir(200);
  } else if (fs.existsSync(ficheiroAlto)) {
    fs.rmSync(ficheiroAlto);
  }

  gravarManifesto(id, entrada);
  feitas.push({ id, descricao, focos: Object.keys(rects), alto: Boolean(entrada.alto) });
  console.log(`  ✓ ${id}${entrada.alto ? ` (+ alto ${entrada.alto.altura}px)` : ""}  focos: ${Object.keys(rects).join(", ") || "nenhum"}`);
}

/* -------------------------------------------------------------------------- */
/* As cenas                                                                     */
/* -------------------------------------------------------------------------- */

const SEG_0912 = "2026-10-05T09:12:00+01:00";
const SEG_0916 = "2026-10-05T09:16:00+01:00";
const QUI_2115 = "2026-10-08T21:15:00+01:00";
const SEX_1745 = "2026-10-09T17:45:00+01:00";
const SEX_1752 = "2026-10-09T17:52:00+01:00";
const DOM_1030 = "2026-10-11T10:30:00+01:00";

/** A Carla já confirmou o Tomás no jogo de sábado (a partir de sexta às 17:52). */
const CONFIRMADO = { "jogo-j5": { status: "CONFIRMED", declineReason: null, respondedAt: new Date(SEX_1752).toISOString() } };

/** O cartão de um bloco pelo seu título: sobe do texto até ao primeiro antepassado com a classe. */
const comTexto = (page, seletor, texto) => page.locator(seletor, { hasText: texto });

const CENAS = [
  {
    ids: ["app-mensalidades-por-pagar", "app-pagar-metodos", "app-pagar", "app-pagar-enviado"],
    async correr(quer) {
      const s = await abrir({ nome: "mensalidades", agora: SEG_0912, rota: "/pagamentos" });
      const { page } = s;
      await page.getByRole("heading", { name: "Pagamentos" }).waitFor();
      const outubro = page.getByRole("checkbox", { name: /Outubro/ });
      await outubro.waitFor();
      await outubro.click();
      const pagar = page.locator("button.cta", { hasText: "Pagar" });
      await pagar.waitFor();

      if (quer("app-mensalidades-por-pagar")) {
        await tirar(s, "app-mensalidades-por-pagar", "Pagamentos na segunda de manhã: outubro do Tomás em aberto, 35,00 €, escolhido para pagar", {
          focos: {
            estado: comTexto(page, "div.bg-ink", "A pagar"),
            outubro: page.locator("li", { has: outubro }),
            "botao-pagar": pagar,
            "ja-pagas": page.locator("section", { hasText: "Já pagas" }),
          },
        });
      }

      await pagar.click();
      const folha = page.locator("div.fixed.inset-0 > div.relative");
      await page.getByRole("button", { name: /MB Way/ }).waitFor();
      if (quer("app-pagar-metodos")) {
        await tirar(s, "app-pagar-metodos", "A folha de pagamento: 35,00 €, MB Way ou referência Multibanco", {
          alto: false,
          focos: {
            folha,
            mbway: page.getByRole("button", { name: /MB Way/ }),
            multibanco: page.getByRole("button", { name: /Multibanco/ }),
          },
        });
      }

      await page.getByRole("button", { name: /MB Way/ }).click();
      const telemovel = page.getByPlaceholder("9xx xxx xxx");
      await telemovel.fill("912 345 678");
      const confirmar = page.getByRole("button", { name: "Confirmar MB Way" });
      if (quer("app-pagar")) {
        await tirar(s, "app-pagar", "Pagar por MB Way: o telemóvel escrito, pronto a confirmar", {
          alto: false,
          focos: { folha, telemovel, confirmar, valor: folha.locator("div.mb-4") },
        });
      }

      // O pedido de pagamento é respondido aqui mesmo: não existe euPago nenhuma do outro lado.
      await confirmar.click();
      await page.getByText("Pedido enviado").waitFor();
      if (quer("app-pagar-enviado")) {
        await tirar(s, "app-pagar-enviado", "Pedido de MB Way enviado: a mensalidade fica a confirmar até o banco responder", {
          alto: false,
          focos: { folha: page.locator("div.fixed.inset-0 > div.relative"), concluir: page.getByRole("button", { name: "Concluir" }) },
        });
      }
      await s.fechar();
    },
  },
  {
    ids: ["app-mensalidades-pago"],
    async correr() {
      const s = await abrir({ nome: "mensalidades-pago", agora: SEG_0916, rota: "/pagamentos" });
      const { page } = s;
      await page.getByText("Está tudo pago").waitFor();
      await tirar(s, "app-mensalidades-pago", "Pagamentos depois do MB Way: está tudo pago e outubro passou para as já pagas", {
        focos: {
          estado: page.locator("div.bg-surface", { hasText: "Está tudo pago" }).first(),
          outubro: page.locator("li", { hasText: "Outubro" }),
          "ja-pagas": page.locator("section", { hasText: "Já pagas" }),
        },
      });
      await s.fechar();
    },
  },
  {
    ids: ["app-inicio", "app-agenda"],
    async correr(quer) {
      const s = await abrir({ nome: "inicio", agora: QUI_2115 });
      const { page } = s;
      await page.getByText("Próximo treino").waitFor();
      if (quer("app-inicio")) await tirarInicio(s, "app-inicio", "O início da família na quinta à noite: treino de sexta, a semana e os avisos do clube");

      if (quer("app-agenda")) {
        await page.locator('nav a[href="/agenda"]').click();
        await page.getByRole("heading", { name: "Agenda" }).waitFor();
        const linha = (texto) => page.locator("li", { hasText: texto }).first();
        await tirar(s, "app-agenda", "A agenda do Tomás: treino de sexta às 19:00 no Campo 2 e jogo de sábado às 15:00", {
          focos: {
            "treino-sexta": page.locator("section", { hasText: "amanhã" }).first(),
            "jogo-sabado": linha("vs União da Serra"),
            "treino-quarta": page.locator("section", { hasText: "quarta" }).first(),
          },
        });
      }
      await s.fechar();
    },
  },
  {
    /* O mesmo início e a mesma agenda um dia depois, já com a convocatória lançada. */
    ids: ["app-inicio-sexta", "app-agenda-sexta"],
    async correr(quer) {
      const s = await abrir({ nome: "inicio-sexta", agora: SEX_1745 });
      const { page } = s;
      await page.getByText("Próximo treino").waitFor();
      if (quer("app-inicio-sexta")) {
        await tirarInicio(s, "app-inicio-sexta", "O início da família na sexta à tarde: treino de hoje, convocatória para sábado e o aviso do jogo");
      }
      if (quer("app-agenda-sexta")) {
        await page.locator('nav a[href="/agenda"]').click();
        await page.getByRole("heading", { name: "Agenda" }).waitFor();
        await tirar(s, "app-agenda-sexta", "A agenda na sexta: treino de hoje às 19:00 no Campo 2 e o Tomás convocado para o jogo de sábado", {
          focos: {
            "treino-sexta": page.locator("section", { hasText: "Hoje" }).first(),
            "jogo-sabado": page.locator("li", { hasText: "vs União da Serra" }).first(),
            "treino-quarta": page.locator("section", { hasText: "quarta" }).first(),
          },
        });
      }
      await s.fechar();
    },
  },
  {
    ids: ["app-atleta"],
    async correr() {
      const s = await abrir({ nome: "atleta", agora: QUI_2115, rota: "/atleta" });
      const { page } = s;
      await page.getByRole("heading", { name: "Tomás Ferreira" }).waitFor();
      await page.getByText("Avaliação do treinador").waitFor();
      await page.getByRole("heading", { name: "Escola" }).waitFor();
      await tirar(s, "app-atleta", "A ficha do Tomás vista pela mãe: presença de 92% (11 de 12 treinos), convocatórias e a avaliação do treinador", {
        focos: {
          assiduidade: page.locator("div.bg-surface", { hasText: "Presença" }).first(),
          convocatorias: page.locator("div.bg-surface", { hasText: "Convocatórias" }).first(),
          avaliacao: page.locator("section", { hasText: "Avaliação do treinador" }).first(),
        },
      });
      await s.fechar();
    },
  },
  {
    ids: ["app-atleta-avaliacoes"],
    async correr() {
      const s = await abrir({ nome: "atleta-avaliacoes", agora: DOM_1030, rota: "/atleta", respostas: CONFIRMADO });
      const { page } = s;
      await page.getByText("Outubro de 2026").waitFor();
      await page.getByRole("heading", { name: "Escola" }).waitFor();
      await assentar(page);
      const cartao = page.locator("section", { hasText: "Avaliação do treinador" }).first();
      // O cartão da avaliação sobe para debaixo do cabeçalho, como quem desliza o ecrã.
      await cartao.evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 76));
      await dormir(200);
      await tirar(s, "app-atleta-avaliacoes", "A avaliação de outubro do Tomás, com a evolução desde junho em cada competência", {
        alto: false,
        focos: {
          avaliacao: cartao,
          evolucao: cartao.locator("ul"),
          "a-trabalhar": cartao.locator("div", { hasText: "A trabalhar" }).last(),
        },
      });
      await s.fechar();
    },
  },
  {
    ids: ["app-convocatoria", "app-convocatoria-confirmada"],
    async correr(quer) {
      const s = await abrir({ nome: "convocatoria", agora: SEX_1752, rota: "/evento/jogo/jogo-j5" });
      const { page } = s;
      await page.getByRole("heading", { name: "vs União da Serra" }).waitFor();
      const vai = page.getByRole("button", { name: "Vai jogar" });
      await vai.waitFor();
      const bloco = page.locator("section", { hasText: "Convocado" }).first();
      const logistica = page.locator("section", { hasText: "Local do jogo" }).first();
      if (quer("app-convocatoria")) {
        await tirar(s, "app-convocatoria", "O jogo de sábado com o Tomás convocado: o clube pede confirmação", {
          focos: { resposta: page.locator("div.grid", { has: vai }), estado: bloco, logistica, "do-clube": page.locator("section", { hasText: "Do clube" }).last() },
        });
      }
      await vai.click();
      await page.getByText("Presença confirmada").waitFor();
      if (quer("app-convocatoria-confirmada")) {
        await tirar(s, "app-convocatoria-confirmada", "Depois de responder: presença do Tomás confirmada, com a hora da resposta", {
          focos: { resposta: page.locator("div.bg-ok-soft", { hasText: "Presença confirmada" }), estado: bloco, logistica },
        });
      }
      await s.fechar();
    },
  },
  {
    ids: ["app-aviso"],
    async correr() {
      const s = await abrir({ nome: "aviso", agora: SEX_1745, rota: "/notificacoes" });
      const { page } = s;
      await page.getByRole("heading", { name: "Notificações" }).waitFor();
      await page.getByText("Jogo de sábado").waitFor();
      const linha = (texto) => page.locator("li", { hasText: texto }).first();
      await tirar(s, "app-aviso", "As notificações na sexta à tarde: o aviso do jogo de sábado e a convocatória por responder", {
        focos: {
          aviso: linha("Jogo de sábado"),
          convocatoria: linha("Confirma a presença do Tomás"),
          sino: page.getByRole("button", { name: "Notificações" }),
        },
      });
      await s.fechar();
    },
  },
  {
    ids: ["app-contextos"],
    async correr() {
      const s = await abrir({ nome: "contextos", agora: QUI_2115, contextos: ["STAFF", "FAMILY", "ATHLETE", "MEMBER"], area: null });
      const { page } = s;
      await page.getByText("Como queres continuar?").waitFor();
      const area = (nome) => page.locator("button", { has: page.locator("span.text-\\[17px\\]", { hasText: new RegExp(`^${nome}$`) }) });
      await tirar(s, "app-contextos", "O seletor de área ao abrir a app: Staff, Família, Atleta e Sócio na mesma conta", {
        focos: { areas: page.locator("div.space-y-3"), staff: area("Staff"), familia: area("Família"), atleta: area("Atleta"), socio: area("Sócio") },
      });
      await s.fechar();
    },
  },
  {
    /* A conta do GUIAO, sem acrescentos: a Carla é família e sócia, e mais nada. */
    ids: ["app-contextos-duas"],
    async correr() {
      const s = await abrir({ nome: "contextos-duas", agora: QUI_2115, contextos: ["FAMILY", "MEMBER"], area: null });
      const { page } = s;
      await page.getByText("Como queres continuar?").waitFor();
      const area = (nome) => page.locator("button", { has: page.locator("span.text-\\[17px\\]", { hasText: new RegExp(`^${nome}$`) }) });
      await tirar(s, "app-contextos-duas", "O seletor de área da Carla ao abrir a app: Família e Sócio", {
        focos: { areas: page.locator("div.space-y-3"), familia: area("Família"), socio: area("Sócio") },
      });
      await s.fechar();
    },
  },
  {
    ids: ["app-contextos-folha"],
    async correr() {
      const s = await abrir({ nome: "contextos-folha", agora: QUI_2115, contextos: ["STAFF", "FAMILY", "ATHLETE", "MEMBER"] });
      const { page } = s;
      await page.getByText("Próximo treino").waitFor();
      await assentar(page);
      await page.getByRole("button", { name: "Mudar de área" }).click();
      await page.getByText("Mudar de área", { exact: true }).waitFor();
      const folha = page.locator("div.fixed.inset-0 > div").first();
      await tirar(s, "app-contextos-folha", "Trocar de área sem sair da conta: a folha que abre no cabeçalho, com a Família vestida", {
        alto: false,
        focos: { folha, botao: page.getByRole("button", { name: "Mudar de área" }) },
      });
      await s.fechar();
    },
  },
  {
    ids: ["app-socio-inicio", "app-socio-quotas"],
    async correr(quer) {
      const s = await abrir({ nome: "socio", agora: "2026-10-08T21:17:00+01:00", area: "MEMBER" });
      const { page } = s;
      await page.getByText("Cartão de sócio").waitFor();
      if (quer("app-socio-inicio")) {
        await tirar(s, "app-socio-inicio", "A área de sócio da Carla: quotas em dia e o cartão n.º 1284", {
          focos: {
            cartao: page.locator("div.rounded-\\[24px\\]", { hasText: "Cartão de sócio" }).first(),
            quota: page.locator("button", { hasText: "Quotas em dia" }),
            "proximo-jogo": page.locator("section", { hasText: "Próximo jogo" }).first(),
          },
        });
      }
      if (quer("app-socio-quotas")) {
        await page.locator('nav a[href="/socio/quotas"]').click();
        await page.getByText("Quotas regularizadas").waitFor();
        await tirar(s, "app-socio-quotas", "As quotas de sócia: regularizadas até outubro, com os próximos meses para pagar adiantado", {
          focos: {
            estado: page.locator("div.rise", { hasText: "Quotas regularizadas" }).first(),
            proximos: page.locator("section", { hasText: "Próximos meses" }).first(),
            historico: page.locator("section", { hasText: "Histórico" }).first(),
          },
        });
      }
      await s.fechar();
    },
  },
  {
    ids: ["app-area-atleta"],
    async correr() {
      const s = await abrir({ nome: "area-atleta", agora: SEX_1745, pessoa: "tomas", contextos: ["ATHLETE"], area: "ATHLETE" });
      const { page } = s;
      await page.getByText("Próximo treino").waitFor();
      await tirarInicio(s, "app-area-atleta", "A área de atleta do Tomás na sexta à tarde: treino às 19:00 e a convocatória para sábado");
      await s.fechar();
    },
  },
  {
    ids: ["app-inicio-serra"],
    async correr() {
      const s = await abrir({ nome: "inicio-serra", agora: QUI_2115, clube: "atletico-da-serra" });
      await s.page.getByText("Próximo treino").waitFor();
      await tirarInicio(s, "app-inicio-serra", "O mesmo início noutro clube: Atlético da Serra, grená, com o seu emblema");
      await s.fechar();
    },
  },
  {
    ids: ["app-inicio-mar"],
    async correr() {
      const s = await abrir({ nome: "inicio-mar", agora: QUI_2115, clube: "uniao-do-mar" });
      await s.page.getByText("Próximo treino").waitFor();
      await tirarInicio(s, "app-inicio-mar", "O mesmo início noutro clube: União do Mar, coral, com o seu emblema");
      await s.fechar();
    },
  },
];

/** O ecrã inicial tem os mesmos focos em todas as roupas. */
async function tirarInicio(s, id, descricao) {
  const { page } = s;
  await tirar(s, id, descricao, {
    focos: {
      cabecalho: page.locator("header.sticky"),
      proximo: page.locator("a.brandlit"),
      convocatoria: page.locator("a", { hasText: "Convocado" }),
      semana: page.locator("section", { hasText: "Esta semana" }).first(),
      avisos: page.locator("section", { hasText: "Da academia" }).first(),
      barra: page.locator("nav ul"),
    },
  });
}

/* -------------------------------------------------------------------------- */

async function principal() {
  fs.mkdirSync(SHOTS, { recursive: true });
  if (VER) fs.mkdirSync(PREVIEWS, { recursive: true });
  sharp = requireRepo("sharp");
  const { chromium } = requirePw("playwright-core");

  const quer = (id) => FILTROS.length === 0 || FILTROS.some((f) => id.startsWith(f));
  const cenas = CENAS.filter((c) => c.ids.some(quer));
  if (cenas.length === 0) throw new Error(`Nenhuma captura começa por: ${FILTROS.join(", ")}`);

  console.log("A arrancar o Vite das capturas…");
  const vite = await arrancarVite();
  browser = await chromium.launch({ executablePath: CHROMIUM, headless: true });

  const falhas = [];
  try {
    // Uma abertura a frio: o Vite prepara as dependências e recarrega a página uma vez.
    const frio = await abrir({ nome: "aquecimento", agora: QUI_2115 });
    await frio.page.getByText("Próximo treino").waitFor({ timeout: 90_000 });
    await dormir(1500);
    await frio.fechar();

    for (const cena of cenas) {
      console.log(`\n${cena.ids.filter(quer).join(", ")}`);
      try {
        await cena.correr(quer);
      } catch (e) {
        falhas.push(`${cena.ids.join(", ")}: ${e.message.split("\n")[0]}`);
        console.error(`  ✗ ${e.message.split("\n").slice(0, 6).join("\n    ")}`);
        for (const c of browser.contexts()) await c.close().catch(() => {});
      }
    }
  } finally {
    await browser.close().catch(() => {});
    await vite.close().catch(() => {});
  }

  /* O registo da rede. */
  console.log("\n— Rede —");
  console.log("Passaram a sério (só pode ser o Vite das capturas e as fontes):");
  for (const [host, n] of registo.passaram) console.log(`  ${host}  ${n} pedidos`);
  const estranhos = [...registo.passaram.keys()].filter((h) => h !== `127.0.0.1:${PORTA}` && !FONTES.has(h));
  console.log(estranhos.length ? `  !!! ESCAPARAM: ${estranhos.join(", ")}` : "  Nenhum pedido escapou para a API, para o Supabase ou para outro domínio.");
  console.log(`Simulados: ${[...registo.simulados.values()].reduce((a, b) => a + b, 0)} pedidos em ${registo.simulados.size} endpoints.`);
  const unicos = (l) => [...new Set(l)];
  if (registo.naoSimulados.length) console.log(`Não simulados (levaram 404):\n  ${unicos(registo.naoSimulados).join("\n  ")}`);
  if (registo.bloqueados.length) console.log(`Bloqueados (outros domínios):\n  ${unicos(registo.bloqueados).join("\n  ")}`);
  if (registo.errosDaPagina.length) console.log(`Erros nas páginas:\n  ${unicos(registo.errosDaPagina).join("\n  ")}`);

  console.log(`\n${feitas.length} capturas em ${path.relative(REPO, SHOTS)}`);
  if (falhas.length) {
    console.log(`Falharam:\n  ${falhas.join("\n  ")}`);
    process.exitCode = 1;
  }
  if (estranhos.length) process.exitCode = 2;
}

principal().catch((e) => {
  console.error(e);
  process.exit(1);
});

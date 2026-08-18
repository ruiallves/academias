#!/usr/bin/env node
/**
 * Pré-visualização da landing + PWA, num processo só.
 *
 * Serve duas coisas na mesma origem, que é exactamente como vão viver em produção
 * (`{slug}.dominio.pt` — ver docs/02-arquitetura.md):
 *
 *   /l/:slug   → a landing gerada no servidor (HTML com OG tags)
 *   tudo o resto → o build estático da PWA das famílias
 *
 * Porquê num processo só, e não a landing aqui e a PWA no `vite preview`: para
 * testar num telemóvel é preciso um túnel HTTPS, e dois servidores obrigavam a dois
 * túneis — duas ligações a poderem cair, dois avisos de "continuar", e um link de
 * instalação a atravessar origens. Assim o botão "instalar" é uma navegação normal
 * dentro do mesmo sítio.
 *
 * `PrismaService.onModuleInit` liga-se a sério ao Postgres no arranque, por isso
 * `npm run start:dev` não sobe sem base de dados. Este script usa só as funções
 * puras de `landing.template.js` e `landing.service.js`. É uma ferramenta de
 * desenvolvimento — não substitui o controlador Nest.
 *
 * Uso: node scripts/preview-landing.cjs [porta]
 *   Requer `npm run build` feito em apps/family.
 */
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const webpush = require("web-push");
const { LandingService } = require(path.join(__dirname, "..", "dist", "landing", "landing.service.js"));
const { detectPlatform, renderLanding } = require(path.join(__dirname, "..", "dist", "landing", "landing.template.js"));

const port = Number(process.argv[2] ?? 3000);
const FAMILY_DIST = path.resolve(__dirname, "..", "..", "family", "dist");
const consoleOrigin = process.env.CONSOLE_ORIGIN ?? "http://localhost:5173";

if (!fs.existsSync(path.join(FAMILY_DIST, "index.html"))) {
  console.error(`Falta o build da PWA em ${FAMILY_DIST}`);
  console.error("Corre primeiro:  cd apps/family && npm run build");
  process.exit(1);
}

const landing = new LandingService();

/* -------------------------------------------------------------------------- */
/* Configuração do Supabase                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Lida do `.env` — a página de login precisa do URL e da anon key. A anon key é
 * pública por desenho; a service-role nunca chega ao browser.
 */
function envValue(key) {
  const file = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(file)) return "";
  const line = fs.readFileSync(file, "utf8").split(String.fromCharCode(10)).find((l) => l.startsWith(key + "="));
  return line ? line.slice(key.length + 1).trim().replace(/^"|"$/g, "") : "";
}

const SUPABASE_URL = (envValue("SUPABASE_URL") || "").replace(/\/$/, "");
const SUPABASE_ANON_KEY = envValue("SUPABASE_ANON_KEY");

/**
 * `/api/auth/memberships` — quem sou e a que academias pertenço.
 *
 * Reencaminha para o Supabase para verificar o token e depois consulta a nossa
 * base pela função `app.resolve_memberships`. É a mesma resposta que o
 * `AuthController` do Nest dá; existe aqui para o login funcionar na
 * pré-visualização, onde o Nest não sobe.
 */
async function handleAuth(req, res, pathname) {
  if ((pathname !== "/api/auth/memberships" && pathname !== "/auth/memberships") || req.method !== "GET") return false;

  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) return json(res, 401, { error: "falta o token" });
  const token = header.slice(7);

  // Validação do token pelo próprio Supabase — não se confia no que o cliente diz.
  const who = await fetch(SUPABASE_URL + "/auth/v1/user", {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: "Bearer " + token },
  });
  if (!who.ok) return json(res, 401, { error: "sessão inválida" });
  const user = await who.json();

  const { Client } = require("pg");
  const db = new Client({
    connectionString: envValue("DATABASE_URL"),
    ssl: { rejectUnauthorized: false },
  });

  try {
    await db.connect();
    const rows = await db.query("SELECT * FROM app.resolve_memberships($1)", [user.id]);
    return json(res, 200, {
      authId: user.id,
      email: user.email,
      academies: rows.rows.map((r) => ({
        id: r.academy_id,
        slug: r.academy_slug,
        name: r.academy_name,
        role: r.role,
      })),
    });
  } catch (error) {
    console.error("auth:", error.message);
    return json(res, 500, { error: "falhou a consulta" });
  } finally {
    try { await db.end(); } catch {}
  }
}

/* -------------------------------------------------------------------------- */
/* Notificações push                                                           */
/* -------------------------------------------------------------------------- */

/**
 * As chaves VAPID identificam o servidor perante o serviço de push do browser.
 * Em produção vêm do ambiente e são fixas — se mudarem, todas as subscrições
 * existentes deixam de funcionar. Aqui há um par de desenvolvimento por omissão
 * para o teste no telemóvel não exigir configuração.
 */
const VAPID_PUBLIC =
  process.env.VAPID_PUBLIC_KEY ??
  "BMj-jt_jM-SYojUCVHpOCujKBqvycN4gQ2LwcK09UqtfmnB-gcQMBzuK3LscTCfDN5KU5NfpACMl2uyXYbGLrJs";
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY ?? "b83UNBnGYl0XPcupCVWz5MZnOeqIRdR-V91C_KLCLag";

webpush.setVapidDetails("mailto:suporte@academia.pt", VAPID_PUBLIC, VAPID_PRIVATE);

/** Em produção isto é a tabela `PushSubscription`; aqui basta memória. */
const subscriptions = new Map();

/**
 * O conteúdo das notificações de teste.
 *
 * Repara que o texto é específico — "Agosto · Martim · 40,00 €" — e não "Tens uma
 * notificação". Uma notificação que obriga a abrir a app para saber do que se
 * trata gasta a paciência de quem a recebe, e é o primeiro passo para alguém as
 * desligar.
 */
const TEST_PAYLOADS = {
  "payment-overdue": {
    title: "Mensalidade em falta",
    body: "Agosto do Martim — 40,00 €. Vencida a 8 de agosto.",
    url: "/pagamentos",
    tag: "payment-2026-08",
  },
  "training-changed": {
    title: "Treino alterado",
    body: "Sub-11 Futebol de quarta passa das 18h00 para as 18h30, no Campo 2.",
    url: "/agenda",
    tag: "session-changed",
  },
};

async function handlePush(req, res, pathname) {
  if (pathname === "/api/push/key" && req.method === "GET") {
    return json(res, 200, { publicKey: VAPID_PUBLIC });
  }

  if (pathname === "/api/push/subscribe" && req.method === "POST") {
    const sub = await readJson(req);
    if (!sub?.endpoint) return json(res, 400, { error: "subscrição inválida" });
    subscriptions.set(sub.endpoint, sub);
    console.log(`push: subscrito (${subscriptions.size} activas)`);
    return json(res, 201, { ok: true });
  }

  if (pathname === "/api/push/unsubscribe" && req.method === "POST") {
    const { endpoint } = (await readJson(req)) ?? {};
    subscriptions.delete(endpoint);
    return json(res, 200, { ok: true });
  }

  if (pathname === "/api/push/test" && req.method === "POST") {
    const { endpoint, kind } = (await readJson(req)) ?? {};
    const sub = subscriptions.get(endpoint);
    if (!sub) return json(res, 404, { error: "subscrição desconhecida" });

    const payload = TEST_PAYLOADS[kind] ?? TEST_PAYLOADS["payment-overdue"];

    try {
      await webpush.sendNotification(sub, JSON.stringify(payload));
      console.log(`push: enviado "${payload.title}"`);
      return json(res, 200, { ok: true });
    } catch (error) {
      // 404/410 do serviço de push significam subscrição morta — o telemóvel
      // desinstalou a app ou revogou a permissão. Limpa-se, senão a lista enche-se
      // de endpoints que nunca mais vão responder.
      if (error.statusCode === 404 || error.statusCode === 410) subscriptions.delete(endpoint);
      console.error("push: falhou", error.statusCode, error.body ?? error.message);
      return json(res, 502, { error: String(error.body ?? error.message) });
    }
  }

  return false;
}

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
  return true;
}

function readJson(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve(null);
      }
    });
  });
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const pathname = decodeURIComponent(url.pathname);

  if (pathname.startsWith("/api/auth/") || pathname.startsWith("/auth/")) {
    const handled = await handleAuth(req, res, pathname);
    if (handled !== false) return;
  }

  if (pathname.startsWith("/api/push/")) {
    const handled = await handlePush(req, res, pathname);
    if (handled !== false) return;
  }

  const landingMatch = /^\/l\/([^/]+)\/?$/.exec(pathname);
  if (landingMatch) return serveLanding(landingMatch[1], req, res, url);

  return serveStatic(pathname, res);
});

async function serveLanding(slug, req, res, url) {
  const academy = await landing.findBySlug(slug);

  if (!academy) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(`Academia "${slug}" não encontrada. Tenta /l/life-club`);
    return;
  }

  const userAgent = req.headers["user-agent"] ?? "";
  // Mesma origem: o botão de instalar é uma navegação normal, sem saltos entre
  // domínios nem um segundo aviso de túnel pelo caminho.
  const origin = `${req.headers["x-forwarded-proto"] ?? "http"}://${req.headers.host}`;

  const html = renderLanding({
    academy,
    platform: detectPlatform(userAgent),
    userAgent,
    pageUrl: `${origin}${url.pathname}`,
    familyUrl: `${origin}/?academia=${encodeURIComponent(slug)}`,
    consoleUrl: consoleOrigin,
    supabaseUrl: SUPABASE_URL,
    supabaseAnonKey: SUPABASE_ANON_KEY,
  });

  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

function serveStatic(pathname, res) {
  const requested = path.join(FAMILY_DIST, pathname);

  // Impede que "/../../etc/passwd" saia da pasta do build.
  if (!requested.startsWith(FAMILY_DIST)) {
    res.writeHead(403).end("Proibido");
    return;
  }

  let file = requested;
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    // Fallback de SPA — mas só para navegações, não para assets em falta. Um
    // /assets/x.js inexistente deve dar 404, não a casca da app com content-type
    // errado (é assim que se perde uma hora a perceber porque é que "o JS não corre").
    if (path.extname(pathname)) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Não encontrado");
      return;
    }
    file = path.join(FAMILY_DIST, "index.html");
  }

  const type = MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream";
  const headers = { "Content-Type": type };

  // O service worker tem de poder actualizar-se; se ficar em cache, o telemóvel
  // fica preso a uma versão antiga da app e nenhum rebuild aparece.
  if (path.basename(file) === "sw.js" || path.basename(file) === "index.html") {
    headers["Cache-Control"] = "no-cache";
  }

  res.writeHead(200, headers);
  fs.createReadStream(file).pipe(res);
}

server.listen(port, "0.0.0.0", () => {
  console.log(`landing  → http://localhost:${port}/l/life-club`);
  console.log(`PWA      → http://localhost:${port}/`);
  console.log(`consola  → ${consoleOrigin}`);
  console.log(`push     → VAPID ${VAPID_PUBLIC.slice(0, 12)}…`);
  console.log(`supabase → ${SUPABASE_URL || "(não configurado)"}`);
});

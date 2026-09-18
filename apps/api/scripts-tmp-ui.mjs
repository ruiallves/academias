/* Ecrã de espera na app (5174) e bloco de pedidos na consola (5173). */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import net from "node:net";
import pg from "pg";

const pasta = process.argv[2];
mkdirSync(pasta, { recursive: true });
const ENV = "C:/Users/ruist/Desktop/club-man/academia-pro/apps/api/.env";
const env = (k) => { const l = readFileSync(ENV, "utf8").split("\n").find((x) => x.startsWith(k + "=")); return l.slice(k.length + 1).trim().replace(/^"|"$/g, ""); };
const S = env("SUPABASE_URL").replace(/\/$/, "");
const login = async (e) => (await (await fetch(`${S}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: env("SUPABASE_ANON_KEY"), "Content-Type": "application/json" }, body: JSON.stringify({ email: e, password: "academia2026" }) })).json());
const hashDe = (j) => "#s=" + encodeURIComponent(Buffer.from(JSON.stringify({ accessToken: j.access_token ?? j.accessToken, refreshToken: j.refresh_token ?? j.refreshToken, academySlug: "life-club" })).toString("base64"));

const db = new pg.Client({ connectionString: env("MIGRATE_DATABASE_URL"), ssl: { rejectUnauthorized: false } });
await db.connect();
const stamp = Date.now().toString(36);
const TOKEN = randomBytes(24).toString("hex");
const ATL = `zz_atl_ui_${stamp}`, NIF = "2" + String(Date.now()).slice(-8), MAE = `ana.ferreira.${stamp}@exemplo.pt`;
const team = (await db.query(`SELECT id FROM "Team" WHERE "academyId"='acd_lifeclub' AND name ILIKE 'Sub-13%' LIMIT 1`)).rows[0]?.id;
await db.query(`INSERT INTO "Athlete" (id,"academyId",name,birthdate,"taxId","updatedAt") VALUES ($1,'acd_lifeclub','Duarte Ferreira','2013-05-20',$2,now())`, [ATL, NIF]);
if (team) await db.query(`INSERT INTO "TeamMembership" (id,"teamId","athleteId") VALUES ('zz_tm_'||$2,$1,$2)`, [team, ATL]).catch((e) => console.log("equipa:", e.message));
await db.query(`INSERT INTO "FamilyInvite" (id,"academyId",token,"updatedAt") VALUES ($1,'acd_lifeclub',$2,now())`, [`zz_fi_ui_${stamp}`, TOKEN]);

try {
  const reg = await (await fetch(`http://localhost:3000/api/convite-familia/${TOKEN}/registar`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Ana Ferreira", email: MAE, phone: "913 456 789", password: "academia2026", relation: "Mãe", taxId: NIF, birthdate: "2013-05-20", acceptLegal: true }) })).json();
  console.log("registo:", reg.pending, Boolean(reg.accessToken), reg.message ?? "");

  const CHROME = `${process.env.USERPROFILE}/AppData/Local/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe`;
  const espera = (ms) => new Promise((r) => setTimeout(r, ms));
  async function abrir(url, w, h, ficheiro, pronto, mobile = false) {
    const PORT = 9300 + Math.floor(Math.random() * 400);
    const chrome = spawn(CHROME, [`--remote-debugging-port=${PORT}`, "--headless", "--disable-gpu", "--no-sandbox", `--window-size=${w},${h}`, "about:blank"], { stdio: "ignore" });
    for (let i = 0; i < 60; i++) { try { await new Promise((res, rej) => { const s = net.connect(PORT, "127.0.0.1", () => { s.end(); res(); }); s.on("error", rej); }); break; } catch { await espera(250); } }
    const page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === "page");
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    let id = 0; const pend = new Map(); const erros = [];
    ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } if (m.method === "Runtime.exceptionThrown") erros.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text); };
    await new Promise((r) => (ws.onopen = r));
    const cmd = (method, params = {}) => new Promise((res) => { const n = ++id; pend.set(n, res); ws.send(JSON.stringify({ id: n, method, params })); });
    const ev = async (expr) => (await cmd("Runtime.evaluate", { returnByValue: true, awaitPromise: true, expression: expr })).result?.result?.value;
    await cmd("Page.enable"); await cmd("Runtime.enable");
    if (mobile) await cmd("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 2, mobile: true });
    await cmd("Page.navigate", { url });
    let t = "";
    for (let i = 0; i < 30; i++) { await espera(1000); t = await ev(`document.body.innerText`); if (pronto.test(t ?? "")) break; }
    await espera(1200);
    const r = await cmd("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    writeFileSync(`${pasta}/${ficheiro}`, Buffer.from(r.result.data, "base64"));
    console.log(ficheiro, "→", (t ?? "").slice(0, 300).replace(/\n+/g, " | "));
    if (erros.length) console.log("erros:", erros.slice(0, 3));
    ws.close(); chrome.kill();
    return ev;
  }

  await abrir("http://localhost:5174/" + hashDe(reg), 390, 844, "app-espera.png", /Pedido enviado/, true);
  const dir = await login("direcao@lifeclub.pt");
  await abrir("http://localhost:5173/familias" + hashDe(dir), 1280, 1000, "consola-pedidos.png", /Pedidos de acesso/);
  await abrir("http://localhost:5173/familias" + hashDe(dir), 390, 1400, "consola-pedidos-mobile.png", /Pedidos de acesso/, true);
} finally {
  const u = `SELECT id FROM "User" WHERE email=$1`;
  await db.query(`DELETE FROM "LegalAcceptance" WHERE "userId" IN (${u})`, [MAE]).catch(() => {});
  await db.query(`DELETE FROM "Membership" WHERE "userId" IN (${u})`, [MAE]);
  await db.query(`DELETE FROM "User" WHERE email=$1`, [MAE]);
  await db.query(`DELETE FROM "TeamMembership" WHERE "athleteId"=$1`, [ATL]).catch(() => {});
  await db.query(`DELETE FROM "Athlete" WHERE id=$1`, [ATL]);
  await db.query(`DELETE FROM "FamilyInvite" WHERE token=$1`, [TOKEN]);
  await db.end();
}
process.exit(0);

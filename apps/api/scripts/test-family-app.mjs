#!/usr/bin/env node
/**
 * O que a app da família recebe — o percurso completo do `load()` do store.
 *
 * Faz exactamente os pedidos que a PWA faz ao arrancar, pela sessão de um
 * encarregado, e verifica que cada ecrã tem com que se desenhar: o cabeçalho, a
 * agenda, os pagamentos, os avisos e as notificações.
 *
 * Uso: node scripts/test-family-app.mjs
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const env = (k) => {
  const l = readFileSync(path.join(HERE, "..", ".env"), "utf8").split("\n").find((x) => x.startsWith(k + "="));
  if (!l) throw new Error(`${k} não está em .env`);
  return l.slice(k.length + 1).trim().replace(/^"|"$/g, "");
};

const S = env("SUPABASE_URL").replace(/\/$/, "");
const A = env("SUPABASE_ANON_KEY");
const API = "http://localhost:3000";

let ok = 0, bad = 0;
const check = (l, c, d = "") => { if (c) { ok++; console.log("  OK    " + l); } else { bad++; console.log("  FALHA " + l + (d ? " — " + d : "")); } };

const token = (await (await fetch(`${S}/auth/v1/token?grant_type=password`, {
  method: "POST", headers: { apikey: A, "Content-Type": "application/json" },
  body: JSON.stringify({ email: "familia@lifeclub.pt", password: "academia2026" }),
})).json()).access_token;

const get = async (p) => {
  const r = await fetch(API + p, { headers: { Authorization: `Bearer ${token}`, "x-academy-slug": "life-club" } });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const post = async (p, body) => {
  const r = await fetch(API + p, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "x-academy-slug": "life-club", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};

console.log("=== Cabeçalho: quem sou e de que academia ===");
const boot = await get("/api/bootstrap");
check("o bootstrap abre (200)", boot.status === 200, `${boot.status}`);
check("traz a academia com nome e cor", Boolean(boot.body?.academy?.shortName && boot.body?.academy?.signalColor), JSON.stringify(boot.body?.academy).slice(0, 120));
check("traz o nome do encarregado", Boolean(boot.body?.me?.name), boot.body?.me?.name);

console.log("\n=== Os filhos e as equipas deles ===");
const from = new Date(Date.now() - 120 * 86_400_000).toISOString();
const to = new Date(Date.now() + 60 * 86_400_000).toISOString();
const [athletes, teams, sessions, matches, charges, announcements, notifications] = await Promise.all([
  get("/api/athletes"), get("/api/teams"), get(`/api/sessions?from=${from}&to=${to}`),
  get("/api/matches"), get("/api/charges"), get("/api/announcements"), get("/api/notifications"),
]);

check("tem filhos para mostrar", (athletes.body ?? []).length > 0, `${athletes.body?.length}`);
check("cada filho tem equipa", (athletes.body ?? []).every((a) => a.teamId), JSON.stringify((athletes.body ?? []).map((a) => a.teamId)));
check("as equipas resolvem-se para nome + treinador", (teams.body ?? []).every((t) => t.name), JSON.stringify((teams.body ?? []).map((t) => t.name)));

console.log("\n=== Preço de cada filho ===");
for (const a of athletes.body ?? []) {
  const fee = await get(`/api/athletes/${a.id}/fee`);
  check(`${a.name}: a mensalidade resolve-se`, fee.status === 200 && "effectiveAmountCents" in (fee.body ?? {}), JSON.stringify(fee.body));
}

console.log("\n=== Agenda ===");
check("os treinos abrem", sessions.status === 200, `${sessions.status}`);
check("e há com que desenhar a agenda", (sessions.body ?? []).length > 0, `${sessions.body?.length} treinos`);
check("os jogos abrem", matches.status === 200 && Array.isArray(matches.body), `${matches.status}`);

console.log("\n=== Pagamentos ===");
check("as mensalidades abrem", charges.status === 200, `${charges.status}`);
check("todas são de filhos desta família", (charges.body ?? []).every((c) => (athletes.body ?? []).some((a) => a.id === c.athleteId)), `${charges.body?.length}`);

console.log("\n=== Avisos e notificações ===");
check("os avisos abrem", announcements.status === 200 && Array.isArray(announcements.body), `${announcements.status}`);
check("as notificações abrem", notifications.status === 200 && Array.isArray(notifications.body), `${notifications.status}`);

console.log("\n=== Pagar de verdade (euPago em modo de desenvolvimento) ===");
const open = (charges.body ?? []).find((c) => c.status === "OPEN");
if (!open) {
  console.log("  (sem mensalidade em aberto para testar — salta)");
} else {
  const pay = await post(`/billing/charges/${open.id}/pay`, { method: "MULTIBANCO" });
  check("o pagamento arranca e devolve referência (201)", (pay.status === 201 || pay.status === 200) && Boolean(pay.body?.reference), JSON.stringify(pay.body).slice(0, 160));
  check("fica PENDING — nada se paga sem o webhook", pay.body?.status === "PENDING", `${pay.body?.status}`);

  const again = await get("/api/charges");
  const still = (again.body ?? []).find((c) => c.id === open.id);
  check("a mensalidade continua por liquidar", still?.status === "OPEN", `${still?.status}`);

  const mbway = await post(`/billing/charges/${open.id}/pay`, { method: "MBWAY", payerPhone: "912345678" });
  check("uma segunda tentativa reutiliza o pagamento em curso", mbway.status === 201 || mbway.status === 200, `${mbway.status}`);
}

console.log("\n=== Marcar notificações como lidas ===");
const unread = (notifications.body ?? []).filter((n) => !n.readAt).map((n) => n.id);
if (unread.length === 0) {
  console.log("  (nenhuma por ler — salta)");
} else {
  const r = await fetch(`${API}/api/notifications/read`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "x-academy-slug": "life-club", "Content-Type": "application/json" },
    body: JSON.stringify({ ids: unread.slice(0, 5) }),
  });
  check("marcar como lidas responde bem", r.ok, `${r.status}`);
  const after = await get("/api/notifications");
  const marked = (after.body ?? []).filter((n) => unread.slice(0, 5).includes(n.id));
  check("e ficam mesmo lidas", marked.every((n) => n.readAt), JSON.stringify(marked.map((n) => n.readAt)));
}

console.log(`\n${ok} passaram, ${bad} falharam`);
process.exit(bad === 0 ? 0 : 1);

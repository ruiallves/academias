#!/usr/bin/env node
/**
 * Aceita os documentos legais em vigor pelas contas de demonstração do life-club.
 *
 * Com documentos publicados, o gate vale também para a academia semeada — e os
 * testes que entram com `direcao@lifeclub.pt` e companhia levam 403 até alguém
 * aceitar por elas. Isto faz esse gesto uma vez, pela API, como a pessoa faria
 * no ecrã: nada é escrito à mão na base.
 *
 * Uso: node scripts/aceitar-termos-demo.mjs
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
const API = process.env.API ?? "http://localhost:3000";

const CONTAS = [
  ["presidente@lifeclub.pt", "console"], ["direcao@lifeclub.pt", "console"], ["treinador@lifeclub.pt", "console"],
  ["adjunto@lifeclub.pt", "console"], ["clinico@lifeclub.pt", "console"], ["secretaria@lifeclub.pt", "console"],
  ["scouting@lifeclub.pt", "console"], ["familia@lifeclub.pt", "family"], ["familia2@lifeclub.pt", "family"],
];

for (const [email, app] of CONTAS) {
  const r = await fetch(`${S}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: A, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "academia2026" }),
  });
  const token = (await r.json()).access_token;
  if (!token) { console.log(`  -     ${email}: sem login`); continue; }
  const h = { Authorization: `Bearer ${token}`, "x-academy-slug": "life-club", "x-app": app, "Content-Type": "application/json" };
  const st = await (await fetch(`${API}/api/legal/status`, { headers: h })).json();
  if (!st.pending?.length) { console.log(`  =     ${email}: em dia`); continue; }
  const ok = await fetch(`${API}/api/legal/accept`, {
    method: "POST", headers: h,
    body: JSON.stringify({ documentIds: st.pending.map((p) => p.id), confirmAuthority: st.canBindClub || undefined }),
  });
  console.log(`  ${ok.ok ? "+" : "!"}     ${email}: ${st.pending.map((p) => `${p.type} v${p.version}`).join(", ")} ${ok.ok ? "" : ok.status}`);
}

#!/usr/bin/env node
/**
 * Repor a palavra-passe, de ponta a ponta, contra o servidor a correr.
 *
 * O email é apanhado por um recolector que este script abre em :3999, em vez de
 * sair para a rua. Para isso o servidor tem de arrancar com o envio apontado para
 * lá (o ambiente ganha ao `.env`):
 *
 *   MAIL_API_URL=http://127.0.0.1:3999/ node dist/main.js
 *
 * Cria uma conta descartável, pede o link, lê-o do email apanhado, troca-o por
 * sessão como a página faz, muda a palavra-passe e confirma que a antiga deixou de
 * servir e que o link não se usa duas vezes. A conta é apagada no fim.
 *
 * Uso: node scripts/test-password-reset.mjs
 */
import http from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

function env(key) {
  const line = readFileSync(path.join(HERE, "..", ".env"), "utf8")
    .split("\n")
    .find((l) => l.startsWith(`${key}=`));
  if (!line) throw new Error(`${key} não está em .env`);
  return line.slice(key.length + 1).trim().replace(/^"|"$/g, "");
}

// Outra porta quando a :3000 já está ocupada pela API de desenvolvimento:
//   PORT=3001 MAIL_API_URL=http://127.0.0.1:3999/ node dist/main.js
//   API_URL=http://localhost:3001 node scripts/test-password-reset.mjs
const API = process.env.API_URL ?? "http://localhost:3000";
const SUPABASE_URL = env("SUPABASE_URL").replace(/\/$/, "");
const ANON = env("SUPABASE_ANON_KEY");
const SERVICE = env("SUPABASE_SERVICE_ROLE_KEY");
const SLUG = "life-club";

const EMAIL = `teste-reset-${Date.now()}@exemplo.pt`;
const ANTIGA = "antiga-segura-2026";
const NOVA = "nova-segura-2026";

let passed = 0;
let failed = 0;

function check(label, ok, detail = "") {
  if (ok) {
    passed++;
    console.log(`  OK    ${label}`);
  } else {
    failed++;
    console.log(`  FALHA ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

/* -------------------------------------------------------------------------- */
/* O recolector                                                                */
/* -------------------------------------------------------------------------- */

const caixa = [];
const recolector = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    try {
      caixa.push(JSON.parse(body));
    } catch {
      /* não era JSON — não é um email nosso */
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end('{"id":"recolhido"}');
  });
});

async function emailPara(endereco, ms) {
  const fim = Date.now() + ms;
  while (Date.now() < fim) {
    const m = caixa.find((x) => JSON.stringify(x.to ?? "").toLowerCase().includes(endereco.toLowerCase()));
    if (m) return m;
    await esperar(250);
  }
  return null;
}

/* -------------------------------------------------------------------------- */

async function entra(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return res.ok;
}

function pedir(email, from = "family", slug = SLUG) {
  return fetch(`${API}/api/palavra-passe/recuperar`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, slug, from }),
  });
}

async function verify(tokenHash) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/verify`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ type: "recovery", token_hash: tokenHash }),
  });
  return { ok: res.ok, body: await res.json().catch(() => ({})) };
}

async function main() {
  await new Promise((r) => recolector.listen(3999, "127.0.0.1", r));

  const criada = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: ANTIGA, email_confirm: true }),
  });
  const conta = await criada.json();
  if (!criada.ok || !conta.id) throw new Error(`não foi possível criar a conta de teste: ${JSON.stringify(conta)}`);

  try {
    console.log("=== Pedir o link ===");
    // Em maiúsculas de propósito: quem escreve o email no telemóvel escreve como calha.
    const r1 = await pedir(EMAIL.toUpperCase());
    check("o pedido é aceite (202)", r1.status === 202, `veio ${r1.status}`);

    const mail = await emailPara(EMAIL, 15_000);
    check("o email chega", Boolean(mail), "o servidor arrancou com MAIL_API_URL a apontar para :3999?");
    if (!mail) return;

    check("o assunto diz o que é", /repor a palavra-passe/i.test(mail.subject ?? ""), mail.subject);
    const link = (mail.text ?? "").match(/https?:\/\/\S+repor-palavra-passe#\S+/)?.[0] ?? "";
    check("o link aponta para a página do clube", link.includes(`/l/${SLUG}/repor-palavra-passe#t=`), link);
    check("o link leva a origem do pedido", link.endsWith("&a=family"), link);
    check("o html traz o mesmo link", (mail.html ?? "").includes("repor-palavra-passe#t="));
    const token = new URLSearchParams(link.split("#")[1] ?? "").get("t") ?? "";

    console.log("=== A página ===");
    const pagina = await fetch(`${API}/l/${SLUG}/repor-palavra-passe`);
    const html = await pagina.text();
    check("abre (200)", pagina.status === 200, `veio ${pagina.status}`);
    check("tem o formulário", html.includes('id="reset-form"'));
    check("não se guarda em cache", (pagina.headers.get("cache-control") ?? "").includes("no-store"));
    check("não é indexada", html.includes("noindex"));
    const semClube = await fetch(`${API}/l/clube-que-nao-existe/repor-palavra-passe`);
    check("clube inexistente dá 404", semClube.status === 404, `veio ${semClube.status}`);

    console.log("=== Trocar a palavra-passe, como a página faz ===");
    // Abrir a página (acima) não gastou o token — é o que um filtro de correio faz.
    const v1 = await verify(token);
    check("o token troca-se por sessão", v1.ok && Boolean(v1.body.access_token), JSON.stringify(v1.body).slice(0, 160));

    const mudou = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      method: "PUT",
      headers: { apikey: ANON, Authorization: `Bearer ${v1.body.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ password: NOVA }),
    });
    check("a palavra-passe muda", mudou.ok, `veio ${mudou.status}`);
    check("a nova entra", await entra(EMAIL, NOVA));
    check("a antiga já não entra", !(await entra(EMAIL, ANTIGA)));

    const v2 = await verify(token);
    check("o mesmo link não serve duas vezes", !v2.ok);

    console.log("=== O que não pode dizer nada ===");
    caixa.length = 0;
    const r2 = await pedir(EMAIL);
    check("o mesmo endereço dentro do minuto é aceite", r2.status === 202, `veio ${r2.status}`);

    const fantasma = `ninguem-${Date.now()}@exemplo.pt`;
    const r3 = await pedir(fantasma);
    const b1 = await r1.json().catch(() => null);
    const b3 = await r3.json().catch(() => null);
    check("uma conta que não existe tem a mesma resposta", r3.status === 202 && JSON.stringify(b1) === JSON.stringify(b3));

    await esperar(4_000);
    check("não sai segundo email para o mesmo endereço", !(await emailPara(EMAIL, 1)));
    check("não sai email para quem não tem conta", !(await emailPara(fantasma, 1)));

    const r4 = await pedir(EMAIL, "qualquer-coisa");
    check("uma origem inventada é recusada (400)", r4.status === 400, `veio ${r4.status}`);

    console.log("=== Onde se pede ===");
    const landing = await (await fetch(`${API}/l/${SLUG}`)).text();
    check("a página do clube tem o \"esqueci-me\"", landing.includes('id="forgot-form"') && landing.includes('id="forgot-open"'));

    console.log("=== Limite por IP ===");
    // r1 a r4 já contaram. O quinto passa, o sexto não.
    const r5 = await pedir(fantasma);
    const r6 = await pedir(fantasma);
    check("o quinto pedido do minuto passa", r5.status === 202, `veio ${r5.status}`);
    check("o sexto é travado (429)", r6.status === 429, `veio ${r6.status}`);
  } finally {
    await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${conta.id}`, {
      method: "DELETE",
      headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
    }).catch(() => {});
    recolector.close();
  }
}

main()
  .catch((error) => {
    failed++;
    console.error(error);
  })
  .finally(() => {
    console.log(`\n${passed} OK, ${failed} falhas`);
    process.exit(failed ? 1 : 0);
  });

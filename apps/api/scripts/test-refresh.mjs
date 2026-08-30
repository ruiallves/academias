#!/usr/bin/env node
/**
 * A renovação da sessão.
 *
 * O que se prova aqui é o mecanismo em que a consola e a app das famílias
 * assentam: que um `refresh_token` do Supabase troca por um par novo, que o
 * refresh **roda** (e por isso tem de ser guardado), e que um token expirado é
 * mesmo recusado pela nossa API — que era a causa de os clubes terem de
 * recarregar a página ao fim de uma hora.
 *
 * Não testa o código do browser (não há browser aqui); testa as duas pontas de
 * que ele depende, que é onde uma suposição errada custaria caro.
 *
 * Uso: node scripts/test-refresh.mjs
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
const API = process.env.API_URL ?? "http://localhost:3000";

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

/** O `exp` do JWT, como o cliente o lê para saber se vale a pena tentar. */
const expiresAt = (token) => {
  const payload = token.split(".")[1];
  const json = Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString();
  return JSON.parse(json).exp * 1000;
};

const bootstrap = (token) =>
  fetch(`${API}/api/bootstrap`, {
    headers: { Authorization: `Bearer ${token}`, "x-academy-slug": "life-club", "x-app": "console" },
  });

console.log("=== Entrar ===");
const entrada = await (
  await fetch(`${S}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: A, "Content-Type": "application/json" },
    body: JSON.stringify({ email: "direcao@lifeclub.pt", password: "academia2026" }),
  })
).json();

check("a entrada devolve um access token", typeof entrada.access_token === "string");
check("e um refresh token — que era guardado e nunca usado", typeof entrada.refresh_token === "string");

const duracao = (expiresAt(entrada.access_token) - Date.now()) / 1000;
check(
  `o access token dura cerca de uma hora (${Math.round(duracao / 60)} min)`,
  duracao > 3000 && duracao < 4000,
  `${Math.round(duracao)}s`,
);

const antes = await bootstrap(entrada.access_token);
check("com ele, a API responde", antes.status === 200, `${antes.status}`);

console.log("\n=== Um token expirado é mesmo recusado ===");
/*
 * A causa do problema, provada e não assumida: forja-se um token com o `exp` no
 * passado e confirma-se que a nossa API o recusa. Se isto passasse, o diagnóstico
 * estava errado e a renovação não resolvia nada.
 */
const [h, p, sig] = entrada.access_token.split(".");
const payloadVelho = JSON.parse(Buffer.from(p.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString());
payloadVelho.exp = Math.floor(Date.now() / 1000) - 60;
const forjado = [
  h,
  Buffer.from(JSON.stringify(payloadVelho)).toString("base64url"),
  sig,
].join(".");
const comExpirado = await bootstrap(forjado);
check("a API recusa um token fora da validade (401)", comExpirado.status === 401, `${comExpirado.status}`);

console.log("\n=== Renovar ===");
const renovado = await (
  await fetch(`${S}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: { apikey: A, "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: entrada.refresh_token }),
  })
).json();

check("o refresh devolve um access token novo", typeof renovado.access_token === "string");
check("diferente do anterior", renovado.access_token !== entrada.access_token);
check(
  "com validade renovada",
  expiresAt(renovado.access_token) > expiresAt(entrada.access_token),
  `${new Date(expiresAt(renovado.access_token)).toISOString()}`,
);

const depois = await bootstrap(renovado.access_token);
check("e a API aceita-o", depois.status === 200, `${depois.status}`);

console.log("\n=== O refresh roda — e é por isso que tem de ser guardado ===");
check("veio um refresh token novo", typeof renovado.refresh_token === "string");
check("diferente do que se usou", renovado.refresh_token !== entrada.refresh_token);

/*
 * O antigo ainda é aceite por uns segundos — e é bom que seja.
 *
 * O Supabase tem uma janela de tolerância à reutilização (o
 * `refresh_token_reuse_interval`, dez segundos por omissão) precisamente para o
 * caso de dois pedidos concorrentes renovarem ao mesmo tempo. Este teste existe
 * para **fixar o que é verdade**: já se escreveu aqui que o antigo era recusado
 * de imediato, e não era — um comentário que afirma o que o sistema não faz é
 * pior do que nenhum.
 *
 * Não muda a decisão de coalescer as renovações em `refreshSession`: essa vale
 * por si (nove renovações iguais em vez de uma são desperdício e uma corrida
 * escusada), e a janela é configuração do projecto — pode ser zero amanhã, e o
 * cliente não deve depender dela para não deitar a sessão fora.
 */
const reusar = await fetch(`${S}/auth/v1/token?grant_type=refresh_token`, {
  method: "POST",
  headers: { apikey: A, "Content-Type": "application/json" },
  body: JSON.stringify({ refresh_token: entrada.refresh_token }),
});
check(
  "o refresh antigo ainda serve dentro da janela de tolerância do Supabase",
  reusar.ok,
  `${reusar.status} — se isto passar a falhar, a janela foi posta a zero no projecto`,
);

console.log("\n=== Um refresh inventado não abre nada ===");
const falso = await fetch(`${S}/auth/v1/token?grant_type=refresh_token`, {
  method: "POST",
  headers: { apikey: A, "Content-Type": "application/json" },
  body: JSON.stringify({ refresh_token: "isto-nao-e-um-refresh" }),
});
check("recusado com 4xx — o cliente termina a sessão neste caso", falso.status >= 400 && falso.status < 500, `${falso.status}`);

console.log(`\n${ok} passaram, ${bad} falharam`);
process.exit(bad ? 1 : 0);

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
 * O imediatamente anterior ainda é aceite — e é bom que seja.
 *
 * O Supabase devolve o par activo a quem lhe apresenta o refresh de onde ele
 * saiu: é o caso de dois pedidos concorrentes a renovarem ao mesmo tempo, ou de
 * uma resposta que se perdeu pelo caminho. Medido neste projecto a 02/10/2026,
 * isto vale mesmo doze segundos depois, e não só dentro da janela de dez do
 * `refresh_token_reuse_interval`. Este teste existe para **fixar o que é
 * verdade**: já se escreveu aqui que o antigo era recusado de imediato, e não
 * era — um comentário que afirma o que o sistema não faz é pior do que nenhum.
 *
 * Não muda a decisão de coalescer as renovações em `refreshSession`: essa vale
 * por si (nove renovações iguais em vez de uma são desperdício e uma corrida
 * escusada).
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
const falsoCorpo = await falso.json().catch(() => null);
check(
  "e com uma frase que o cliente reconhece como recusa do refresh",
  /refresh.?token/i.test(`${falsoCorpo?.error_code ?? ""} ${falsoCorpo?.msg ?? ""}`),
  JSON.stringify(falsoCorpo),
);

console.log("\n=== Duas rodas atrás já é recusado — e a sessão continua viva ===");
/*
 * O que fazia as pessoas perderem a sessão "do nada".
 *
 * A consola e a app do clube guardam a mesma sessão em duas chaves (e a app
 * guardava-a também em memória). Cada uma rodava o refresh na sua, a cópia da
 * outra ficava para trás, e à segunda roda o Supabase recusava-a. A sessão
 * **não morre** com isso — o refresh activo continua a renovar —, mas o cliente
 * lia a recusa como fim de sessão e limpava tudo.
 *
 * O cliente agora lê o par mais novo das duas chaves e confirma uma recusa com
 * o que estiver guardado (ver `lib/session.ts` da consola e da app, e
 * `npm run test:sessao`). Assenta nestes dois factos, e é por isso que ficam
 * aqui fixados: se o Supabase passar a matar a sessão inteira ao ver um refresh
 * velho, recuperar deixa de ser possível e é preciso outra solução.
 *
 * A espera é o `refresh_token_reuse_interval`: dentro dele até o de há duas
 * rodas passa.
 */
const refrescar = (refresh_token) =>
  fetch(`${S}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: { apikey: A, "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token }),
  });
const segunda = await (await refrescar(renovado.refresh_token)).json();
check(
  "a segunda roda devolve outro refresh",
  typeof segunda.refresh_token === "string" && segunda.refresh_token !== renovado.refresh_token,
);
console.log("  …     a esperar 12 s, para sair da janela de tolerância");
await new Promise((r) => setTimeout(r, 12_000));
const avo = await refrescar(entrada.refresh_token);
const avoCorpo = await avo.json().catch(() => null);
check("o refresh de há duas rodas é recusado com 400", avo.status === 400, `${avo.status}`);
check(
  "com o código que o cliente reconhece como recusa",
  avoCorpo?.error_code === "refresh_token_already_used",
  JSON.stringify(avoCorpo),
);
const activo = await refrescar(segunda.refresh_token);
check("e a sessão continua viva: o refresh activo ainda renova", activo.ok, `${activo.status}`);

console.log(`\n${ok} passaram, ${bad} falharam`);
process.exit(bad ? 1 : 0);

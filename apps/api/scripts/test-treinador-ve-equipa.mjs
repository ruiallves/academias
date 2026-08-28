#!/usr/bin/env node
/**
 * Um treinador vê quem treina a sua equipa.
 *
 * ## O bug
 *
 * A consola resolvia o nome do treinador de uma equipa pela lista de staff
 * (`coachById`). Essa lista vem de `/api/staff`, que exige `staff:read` — e um
 * treinador não tem. O pedido dava 403, o `soft()` do store engolia-o e devolvia
 * `[]`, e a partir daí nenhum nome resolvia: o treinador abria "Equipas" e via a
 * **sua própria equipa** marcada como *sem treinador*.
 *
 * Não havia erro no ecrã porque não havia erro — havia uma lista vazia a passar
 * por uma resposta.
 *
 * ## O que se verifica aqui
 *
 * Que os dados de que a consola precisa **já vêm** com a equipa, e chegam a quem
 * não pode ler o staff. E que a fronteira se mantém: o nome de quem treina não é
 * ficha de pessoal, mas o email e o telefone são.
 *
 * Uso: node scripts/test-treinador-ve-equipa.mjs
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
const check = (l, c, d = "") => {
  if (c) { ok++; console.log("  OK    " + l); }
  else { bad++; console.log("  FALHA " + l + (d ? " — " + d : "")); }
};

const login = async (email) =>
  (await (await fetch(`${S}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: A, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "academia2026" }),
  })).json()).access_token;

const call = async (token, method, pathname) => {
  const r = await fetch(API + pathname, {
    method,
    headers: { Authorization: `Bearer ${token}`, "x-academy-slug": "life-club" },
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};

const treinador = await login("treinador@lifeclub.pt");
const direcao = await login("direcao@lifeclub.pt");

console.log("=== A lista de staff continua fechada ao treinador ===");
/*
 * É esta recusa que criou o bug — e está certa. O que estava errado era o
 * cliente depender dela para uma pergunta que não é sobre staff.
 */
const staff = await call(treinador, "GET", "/api/staff");
check("`/api/staff` recusa (403)", staff.status === 403, `${staff.status}`);

console.log("\n=== Mas as equipas dele trazem quem as treina ===");
const equipas = await call(treinador, "GET", "/api/teams");
check("`/api/teams` responde", equipas.status === 200, `${equipas.status}`);
check("e traz equipas", (equipas.body ?? []).length > 0, `${(equipas.body ?? []).length}`);

const comTreinador = (equipas.body ?? []).filter((t) => (t.coaches ?? []).length > 0);
check("pelo menos uma tem treinador atribuído", comTreinador.length > 0, "");

/*
 * O coração do bug: sem o nome aqui, a consola não tinha por onde o descobrir, e
 * desenhava "Sem treinador".
 */
const nomes = comTreinador.flatMap((t) => (t.coaches ?? []).map((c) => c.name));
check("e o nome vem com a equipa, não só o id", nomes.every((n) => typeof n === "string" && n.length > 0), JSON.stringify(nomes));
check("com o cargo à frente", comTreinador.every((t) => t.coaches.every((c) => typeof c.title === "string")), "");

console.log("\n=== E ele vê-se a si próprio ===");
const eu = (await call(treinador, "GET", "/api/bootstrap")).body?.me;
check("o arranque diz quem ele é", Boolean(eu?.membershipId), "");
const asMinhas = comTreinador.filter((t) => t.coaches.some((c) => c.id === eu.membershipId));
check("e ele aparece como treinador das equipas dele", asMinhas.length > 0, `${asMinhas.length} de ${comTreinador.length}`);

console.log("\n=== A fronteira mantém-se ===");
/*
 * O nome de quem treina é da equipa; o email e o telefone são ficha de pessoal.
 * Se um dia alguém acrescentar contactos a este payload, é aqui que se vê.
 */
const campos = new Set(comTreinador.flatMap((t) => t.coaches.flatMap((c) => Object.keys(c))));
check("a equipa traz id, nome e cargo", ["id", "name", "title"].every((k) => campos.has(k)), [...campos].join(","));
check("e mais nada — sem email nem telefone", !campos.has("email") && !campos.has("phone"), [...campos].join(","));

console.log("\n=== A direção continua a ver tudo ===");
const staffDirecao = await call(direcao, "GET", "/api/staff");
check("`/api/staff` responde à direção", staffDirecao.status === 200, `${staffDirecao.status}`);
check("com contactos", (staffDirecao.body ?? []).some((m) => m.email), "");

console.log(`\n${ok} passaram, ${bad} falharam`);
process.exit(bad === 0 ? 0 : 1);

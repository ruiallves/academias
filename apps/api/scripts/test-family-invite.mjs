#!/usr/bin/env node
/**
 * O caminho de uma família até dentro da app.
 *
 * O fluxo inteiro, pela ordem em que acontece na vida real: a secretaria gera o
 * link, o pai abre-o, identifica o filho pelo NIF e pela data de nascimento, cria
 * conta, e passa a ver **o filho dele e mais ninguém**.
 *
 * O que aqui interessa mesmo são as recusas:
 *
 *  - NIF certo com data errada é **a mesma resposta** que NIF inventado. Se fossem
 *    respostas diferentes, isto era um oráculo para confirmar NIFs de crianças.
 *  - Um link fechado deixa de servir, e um link fechado não deixa registar.
 *  - A conta criada vê um atleta. Não a academia, não a equipa: um.
 *
 * Pressupõe `node dist/main.js` e `npm run seed`.
 *
 * O registo está atrás de um throttle (5/min): correr a suite duas vezes
 * seguidas dá 429 no fim. Espera um minuto entre corridas.
 *
 * Uso: node scripts/test-family-invite.mjs
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const env = (k) => {
  const l = readFileSync(path.join(HERE, "..", ".env"), "utf8").split("\n").find((x) => x.startsWith(k + "="));
  if (!l) throw new Error(`${k} não está em .env`);
  return l.slice(k.length + 1).trim().replace(/^"|"$/g, "");
};

const S = env("SUPABASE_URL").replace(/\/$/, ""), A = env("SUPABASE_ANON_KEY"), API = "http://localhost:3000";
const SLUG = "life-club";

let ok = 0, bad = 0;
const check = (l, c, d = "") => { if (c) { ok++; console.log("  OK    " + l); } else { bad++; console.log("  FALHA " + l + (d ? " — " + d : "")); } };

const login = async (e, p) =>
  (await (await fetch(`${S}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: A, "Content-Type": "application/json" },
    body: JSON.stringify({ email: e, password: p }),
  })).json()).access_token;

/** Um pedido da consola: com sessão e com academia. */
const asStaff = async (token, method, p, body) => {
  const r = await fetch(API + p, {
    method,
    headers: {
      Authorization: `Bearer ${token}`, "x-academy-slug": SLUG,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};

/** Um pedido de quem ainda não tem conta: sem nada. */
const anon = async (method, p, body) => {
  const r = await fetch(API + p, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};

const director = await login("direcao@lifeclub.pt", "academia2026");
const coach = await login("treinador@lifeclub.pt", "academia2026");

const db = new pg.Client({ connectionString: env("MIGRATE_DATABASE_URL"), ssl: { rejectUnauthorized: false } });
await db.connect();

const stamp = Date.now().toString(36);
const NIF = "2" + String(Date.now()).slice(-8); // nove dígitos, sem colidir com nada real
const EMAIL = `pai-${stamp}@exemplo.pt`;

console.log("=== O NIF do atleta ===");
const atletas = (await asStaff(director, "GET", "/api/athletes")).body;
/*
 * O alvo tem de ser um atleta que o TREINADOR também veja — a prova lá em baixo
 * é "vê o atleta, não vê o NIF". Era `atletas[0]` da lista da direcção, e
 * funcionou enquanto o treinador esteve em todas as equipas; no dia em que
 * saiu dos Sub-13, o primeiro da lista podia ser de lá e a prova avaliava um
 * `undefined` — a acusar o que era, na verdade, o âmbito a funcionar.
 */
const daEquipaDoCoach = (await asStaff(coach, "GET", "/api/athletes")).body ?? [];
const alvo = atletas.find((a) => daEquipaDoCoach.some((c) => c.id === a.id)) ?? atletas[0];
check("a direção vê os atletas", Array.isArray(atletas) && atletas.length > 0, `${atletas?.length}`);

const posto = await asStaff(director, "PATCH", `/api/athletes/${alvo.id}/nif`, { taxId: NIF });
check("a direção escreve o NIF", posto.status === 200, JSON.stringify(posto.body).slice(0, 100));
check("nove dígitos ou nada", (await asStaff(director, "PATCH", `/api/athletes/${alvo.id}/nif`, { taxId: "123" })).status === 400);

// Um treinador tem `athlete:read` e não tem `family:read`. Não precisa do número
// de contribuinte de uma criança para escalar uma equipa.
const vistoPeloTreinador = (await asStaff(coach, "GET", "/api/athletes")).body.find((a) => a.id === alvo.id);
check("o treinador não recebe o NIF", vistoPeloTreinador?.taxId === null, `${vistoPeloTreinador?.taxId}`);

console.log("\n=== O link ===");
const criado = await asStaff(director, "POST", "/api/family-invite", { days: 7 });
check("a direção gera o link", criado.status === 201 || criado.status === 200, JSON.stringify(criado.body).slice(0, 120));
check("com prazo", Boolean(criado.body.expiresAt));
check("e aponta para a landing do clube", criado.body.link.includes(`/l/${SLUG}/familia/`), criado.body.link);

const token = criado.body.link.split("/familia/")[1];

const relido = await asStaff(director, "GET", "/api/family-invite");
check("volta a ser lido — não se mostra uma vez só", relido.body?.link === criado.body.link);

// Gerar outro fecha o anterior: um vivo de cada vez.
const segundo = await asStaff(director, "POST", "/api/family-invite", { days: null });
check("gerar outro dá um link diferente", segundo.body.link !== criado.body.link);
check("sem prazo quando se pede sem prazo", segundo.body.expiresAt === null);
check("e o primeiro deixa de resolver", (await anon("GET", `/api/convite-familia/${token}`)).status === 404);

const vivo = segundo.body.link.split("/familia/")[1];

console.log("\n=== O que o pai vê antes de ter conta ===");
const preview = await anon("GET", `/api/convite-familia/${vivo}`);
check("o link diz de que clube é", preview.body?.academy?.slug === SLUG, JSON.stringify(preview.body).slice(0, 100));
check("com a cor da academia", typeof preview.body?.academy?.signalColor === "string");
check("e não diz mais nada", !JSON.stringify(preview.body).includes("athlete"));

const redirect = await fetch(`${API}/l/${SLUG}/familia/${vivo}`, { redirect: "manual" });
check("o link redirecciona para a landing", redirect.status === 302, `deu ${redirect.status}`);
check("com o convite agarrado", (redirect.headers.get("location") ?? "").includes(`?convite=${vivo}`), redirect.headers.get("location"));

console.log("\n=== Identificar o educando ===");
const nasc = alvo.birthdate.slice(0, 10);

const inventado = await anon("POST", `/api/convite-familia/${vivo}/educando`, { taxId: "999999999", birthdate: nasc });
const dataErrada = await anon("POST", `/api/convite-familia/${vivo}/educando`, { taxId: NIF, birthdate: "2001-01-01" });
check("um NIF inventado não encontra ninguém", inventado.status === 404);
check("o NIF certo com a data errada também não", dataErrada.status === 404);
check(
  "e as duas recusas são indistinguíveis — não é um oráculo",
  inventado.body?.message === dataErrada.body?.message,
  `${inventado.body?.message} / ${dataErrada.body?.message}`,
);

const encontrado = await anon("POST", `/api/convite-familia/${vivo}/educando`, { taxId: NIF, birthdate: nasc });
check("os dois juntos encontram o atleta", encontrado.status === 200 || encontrado.status === 201, JSON.stringify(encontrado.body).slice(0, 100));
check("devolve o primeiro nome", encontrado.body?.firstName === alvo.name.split(" ")[0], encontrado.body?.firstName);
check("e não devolve o nome completo", !JSON.stringify(encontrado.body).includes(alvo.name));

console.log("\n=== Criar a conta ===");
const registo = await anon("POST", `/api/convite-familia/${vivo}/registar`, {
  name: "Pai De Teste", email: EMAIL, phone: "912 000 000", password: "academia2026",
  relation: "Pai", taxId: NIF, birthdate: nasc,
});
check("cria a conta e liga ao educando", registo.status === 200 || registo.status === 201, JSON.stringify(registo.body).slice(0, 140));
check("devolve a sessão — a app entra já dentro", typeof registo.body?.accessToken === "string");
check("e diz de que academia é", registo.body?.slug === SLUG);

const semProva = await anon("POST", `/api/convite-familia/${vivo}/registar`, {
  name: "Intruso", email: `intruso-${stamp}@exemplo.pt`, phone: "912 000 001", password: "academia2026",
  relation: "Pai", taxId: "999999999", birthdate: nasc,
});
check("sem o par NIF+data não se regista ninguém", semProva.status === 404);

console.log("\n=== O que a conta nova vê ===");
const pai = registo.body.accessToken;
const meus = await asStaff(pai, "GET", "/api/athletes");
check("vê exactamente um atleta", meus.body?.length === 1, `${meus.body?.length}`);
check("e é o filho dele", meus.body?.[0]?.id === alvo.id);
check("sem o NIF — a app do pai não precisa dele", meus.body?.[0]?.taxId === null);
check("e não vê o link das famílias", (await asStaff(pai, "GET", "/api/family-invite")).status === 403);

const usos = await asStaff(director, "GET", "/api/family-invite");
check("o contador subiu", usos.body?.usedCount === 1, `${usos.body?.usedCount}`);

console.log("\n=== Fechar a porta ===");
check("fecha", (await asStaff(director, "DELETE", "/api/family-invite")).status === 200);
check("e o link deixa de resolver", (await anon("GET", `/api/convite-familia/${vivo}`)).status === 404);
check("nem sequer para registar", (await anon("POST", `/api/convite-familia/${vivo}/registar`, {
  name: "Tarde Demais", email: `tarde-${stamp}@exemplo.pt`, phone: "912 000 002", password: "academia2026",
  relation: "Pai", taxId: NIF, birthdate: nasc,
})).status === 404);
check("e não há link vivo para a consola mostrar", (await asStaff(director, "GET", "/api/family-invite")).body === null);

console.log("\n=== Limpeza ===");
await db.query(`DELETE FROM "GuardianLink" WHERE "membershipId" IN (SELECT m.id FROM "Membership" m JOIN "User" u ON u.id = m."userId" WHERE u.email = $1)`, [EMAIL]);
await db.query(`DELETE FROM "Membership" WHERE "userId" IN (SELECT id FROM "User" WHERE email = $1)`, [EMAIL]);
await db.query(`DELETE FROM "User" WHERE email = $1`, [EMAIL]);
await db.query(`UPDATE "Athlete" SET "taxId" = NULL WHERE id = $1`, [alvo.id]);
await db.query(`DELETE FROM "FamilyInvite" WHERE "academyId" = (SELECT id FROM "Academy" WHERE slug = $1)`, [SLUG]);
await db.end();

// A conta no Supabase fica — apagá-la exige a service role e não vale o risco de
// enganar o alvo. Fica com um email de teste irrepetível, e ninguém entra nela.
console.log("  feito");

console.log(`\n${ok} passaram, ${bad} falharam`);
process.exit(bad === 0 ? 0 : 1);

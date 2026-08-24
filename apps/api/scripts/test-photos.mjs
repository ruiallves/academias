#!/usr/bin/env node
/**
 * Fotografias de atletas e de staff, do princípio ao fim.
 *
 * O caminho real: pedir autorização, **carregar mesmo o ficheiro** para o Supabase,
 * confirmar, e ver a fotografia a chegar na lista de atletas com um link que abre.
 * Um teste que só chamasse a API e nunca carregasse bytes não provava nada — era
 * exactamente assim que isto estava avariado sem ninguém dar por ela.
 *
 * O que guarda, além de funcionar:
 *
 *  - a chave de um atleta não serve para outro;
 *  - um treinador não põe fotografia num atleta fora do âmbito dele;
 *  - qualquer pessoa põe a **sua própria** foto; a de outro exige `staff:write`;
 *  - o link é assinado e com prazo — nunca um endereço público.
 *
 * Pressupõe `node dist/main.js` e `npm run seed`.
 *
 * Uso: node scripts/test-photos.mjs
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

const S = env("SUPABASE_URL").replace(/\/$/, ""), A = env("SUPABASE_ANON_KEY");
// `API_URL` para poder correr contra uma segunda instância sem tocar na que está a
// servir o dia-a-dia. Sem ela, o valor de sempre.
const API = process.env.API_URL ?? "http://localhost:3000";

let ok = 0, bad = 0;
const check = (l, c, d = "") => { if (c) { ok++; console.log("  OK    " + l); } else { bad++; console.log("  FALHA " + l + (d ? " — " + d : "")); } };

const login = async (email) =>
  (await (await fetch(`${S}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: A, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "academia2026" }),
  })).json()).access_token;

const call = async (token, method, p, body) => {
  const r = await fetch(API + p, {
    method,
    headers: { Authorization: `Bearer ${token}`, "x-academy-slug": "life-club", ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};

/** Um PNG de 1×1 — o ficheiro mais pequeno que é mesmo uma imagem. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/** O que o browser faz no passo 2: PUT dos bytes para o endereço assinado. */
const upload = async (signed) =>
  fetch(signed.url, {
    method: "PUT",
    headers: { "Content-Type": "image/png", ...(signed.token ? { Authorization: `Bearer ${signed.token}` } : {}) },
    body: PNG,
  });

const [director, coach, adjunto] = await Promise.all([
  login("direcao@lifeclub.pt"),
  login("treinador@lifeclub.pt"),
  login("adjunto@lifeclub.pt"),
]);

const atletas = (await call(director, "GET", "/api/athletes")).body;
const alvo = atletas[0];
const doAdjunto = new Set((await call(adjunto, "GET", "/api/athletes")).body.map((a) => a.id));
const foraDoAdjunto = atletas.find((a) => !doAdjunto.has(a.id));

console.log("=== Autorizar ===");
const auth = await call(director, "POST", `/api/athletes/${alvo.id}/foto/upload`, { contentType: "image/png" });
check("a direção recebe autorização", auth.status === 200 || auth.status === 201, JSON.stringify(auth.body).slice(0, 160));
check("com um endereço do Supabase", (auth.body?.url ?? "").includes("/storage/v1/object/upload/sign/fotos/"), auth.body?.url);
check("e uma chave com o id do atleta", (auth.body?.key ?? "").startsWith(`atletas/${alvo.id}/`), auth.body?.key);
check("um PDF é recusado", (await call(director, "POST", `/api/athletes/${alvo.id}/foto/upload`, { contentType: "application/pdf" })).status === 400);

console.log("\n=== Carregar mesmo o ficheiro ===");
const put = await upload(auth.body);
check("o Supabase aceita os bytes", put.ok, `${put.status} ${(await put.text()).slice(0, 120)}`);

console.log("\n=== Confirmar ===");
const confirmada = await call(director, "POST", `/api/athletes/${alvo.id}/foto`, { key: auth.body.key });
check("a API grava a fotografia", confirmada.status === 200 || confirmada.status === 201, JSON.stringify(confirmada.body).slice(0, 160));
check("e devolve um link assinado", (confirmada.body?.photoUrl ?? "").includes("token="), (confirmada.body?.photoUrl ?? "").slice(0, 90));

const aberta = await fetch(confirmada.body.photoUrl);
check("o link abre mesmo a imagem", aberta.ok && (aberta.headers.get("content-type") ?? "").includes("image"), `${aberta.status} ${aberta.headers.get("content-type")}`);

const semAssinatura = await fetch(confirmada.body.photoUrl.split("?")[0]);
check("sem a assinatura não abre — o bucket é privado", !semAssinatura.ok, `${semAssinatura.status}`);

console.log("\n=== Na lista de atletas ===");
const naLista = (await call(director, "GET", "/api/athletes")).body.find((a) => a.id === alvo.id);
check("o atleta traz a fotografia", typeof naLista?.photoUrl === "string" && naLista.photoUrl.includes("token="));
check("e não expõe a chave", naLista?.photoKey === undefined);

console.log("\n=== O que não se pode ===");
const outro = atletas.find((a) => a.id !== alvo.id);
const authOutro = await call(director, "POST", `/api/athletes/${outro.id}/foto/upload`, { contentType: "image/png" });
check(
  "a chave de um atleta não serve para outro",
  (await call(director, "POST", `/api/athletes/${alvo.id}/foto`, { key: authOutro.body.key })).status === 400,
);
check(
  "uma chave inventada não passa — o ficheiro tem de existir",
  (await call(director, "POST", `/api/athletes/${alvo.id}/foto`, { key: `atletas/${alvo.id}/naoexiste.png` })).status === 400,
);
check(
  "um treinador não mexe em atletas fora do âmbito",
  (await call(adjunto, "POST", `/api/athletes/${foraDoAdjunto.id}/foto/upload`, { contentType: "image/png" })).status === 404,
  foraDoAdjunto?.name,
);

console.log("\n=== Staff ===");
const staff = (await call(director, "GET", "/api/staff")).body;
const eu = staff.find((m) => m.email === "treinador@lifeclub.pt");
const outraPessoa = staff.find((m) => m.email === "clinico@lifeclub.pt");

const authEu = await call(coach, "POST", `/api/staff/${eu.id}/foto/upload`, { contentType: "image/png" });
check("cada um põe a sua própria foto", authEu.status === 200 || authEu.status === 201, JSON.stringify(authEu.body).slice(0, 120));
check("com a chave presa à pessoa", (authEu.body?.key ?? "").startsWith("staff/"), authEu.body?.key);

const putEu = await upload(authEu.body);
check("carrega", putEu.ok, `${putEu.status}`);
const confirmEu = await call(coach, "POST", `/api/staff/${eu.id}/foto`, { key: authEu.body.key });
check("e confirma", confirmEu.status === 200 || confirmEu.status === 201, JSON.stringify(confirmEu.body).slice(0, 120));

check(
  "um treinador não põe foto noutra pessoa",
  (await call(coach, "POST", `/api/staff/${outraPessoa.id}/foto/upload`, { contentType: "image/png" })).status === 403,
);
check(
  "a direção põe (tem staff:write)",
  [200, 201].includes((await call(director, "POST", `/api/staff/${outraPessoa.id}/foto/upload`, { contentType: "image/png" })).status),
);

const staffDepois = (await call(director, "GET", "/api/staff")).body.find((m) => m.id === eu.id);
check("a lista de staff traz a fotografia", typeof staffDepois?.photoUrl === "string" && staffDepois.photoUrl.includes("token="));

console.log("\n=== Apagar ===");
check("apaga a do atleta", (await call(director, "DELETE", `/api/athletes/${alvo.id}/foto`)).status === 200);
check("e o atleta fica sem ela", ((await call(director, "GET", "/api/athletes")).body.find((a) => a.id === alvo.id)?.photoUrl ?? null) === null);
check("apaga a do treinador", (await call(coach, "DELETE", `/api/staff/${eu.id}/foto`)).status === 200);

console.log("\n=== Limpeza ===");
const db = new pg.Client({ connectionString: env("MIGRATE_DATABASE_URL"), ssl: { rejectUnauthorized: false } });
await db.connect();
await db.query(`UPDATE "Athlete" SET "photoKey" = NULL WHERE "photoKey" IS NOT NULL`);
await db.query(`UPDATE "User" SET "photoKey" = NULL WHERE "photoKey" IS NOT NULL`);
await db.end();
console.log("  feito");

console.log(`\n${ok} passaram, ${bad} falharam`);
process.exit(bad === 0 ? 0 : 1);

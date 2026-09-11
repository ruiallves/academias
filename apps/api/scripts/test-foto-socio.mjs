#!/usr/bin/env node
/**
 * A fotografia do sócio — pela consola.
 *
 * ## O que este teste guarda
 *
 * O mesmo caminho em três passos das fotografias de atletas, agora para os
 * sócios: pedir autorização, carregar **directamente** para o armazenamento,
 * confirmar. E o que o caminho protege:
 *
 * - a chave é escolhida pelo servidor e leva o id do sócio — confirmar uma
 *   chave de **outro** sócio é recusado, e confirmar uma chave sem ficheiro
 *   por trás também (uma chave gravada sem ficheiro é uma fotografia partida
 *   em todos os ecrãs);
 * - a ficha e a lista passam a trazer `photoUrl` assinado; remover deixa-o
 *   nulo; apagar a ficha leva o ficheiro com ela.
 *
 * O lado da app (o próprio pela sessão de sócio) está em
 * `test-app-do-clube.mjs`, que é onde há uma sessão de sócio.
 *
 * Uso: node scripts/test-foto-socio.mjs
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

const login = async (email) =>
  (
    await (
      await fetch(`${S}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: { apikey: A, "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: "academia2026" }),
      })
    ).json()
  ).access_token;

const call = async (token, method, pathname, body) => {
  const r = await fetch(API + pathname, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "x-academy-slug": "life-club",
      "x-app": "console",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};

/** Um PNG de 1×1 — o ficheiro mais pequeno que o bucket aceita como imagem. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

/** O passo do meio: o ficheiro vai direito ao armazenamento, sem passar pela API. */
const carregar = async (signed) => {
  const r = await fetch(signed.url, {
    method: "PUT",
    headers: { "Content-Type": "image/png", ...(signed.token ? { Authorization: `Bearer ${signed.token}` } : {}) },
    body: PNG,
  });
  return r.status;
};

const db = new pg.Client({ connectionString: env("MIGRATE_DATABASE_URL"), ssl: { rejectUnauthorized: false } });
await db.connect();

const limpar = async () => {
  await db.query(`DELETE FROM "Member" WHERE name LIKE 'ZF %'`);
};
await limpar();

const director = await login("direcao@lifeclub.pt");

console.log("=== Dois sócios sem fotografia ===");
const a = await call(director, "POST", "/api/members", { name: "ZF Ana Foto", phone: "912000201", status: "ACTIVE" });
const b = await call(director, "POST", "/api/members", { name: "ZF Bento Sem", phone: "912000202", status: "PENDING" });
check("criados", a.status === 201 && b.status === 201, `${a.status} ${b.status}`);
const idA = a.body?.id;
const idB = b.body?.id;

let ficha = await call(director, "GET", `/api/members/${idA}`);
check("a ficha traz `photoUrl` nulo", ficha.body?.photoUrl === null, JSON.stringify(ficha.body?.photoUrl));
check("e não traz a chave", !("photoKey" in (ficha.body ?? {})));

console.log("\n=== Carregar pela consola ===");
const tipoMau = await call(director, "POST", `/api/members/${idA}/foto/upload`, { contentType: "application/pdf" });
check("um PDF é recusado (400)", tipoMau.status === 400, `${tipoMau.status}`);

const autorizado = await call(director, "POST", `/api/members/${idA}/foto/upload`, { contentType: "image/png" });
check("autoriza com endereço assinado e chave", autorizado.status === 201 && autorizado.body?.url && autorizado.body?.key, `${autorizado.status} ${JSON.stringify(autorizado.body).slice(0, 120)}`);
check("a chave leva o id do sócio", String(autorizado.body?.key ?? "").startsWith(`socios/${idA}/`), autorizado.body?.key);

const semFicheiro = await call(director, "POST", `/api/members/${idA}/foto`, { key: autorizado.body?.key });
check("confirmar antes de carregar é recusado — o ficheiro não chegou (400)", semFicheiro.status === 400, `${semFicheiro.status} ${semFicheiro.body?.message}`);

const put = await carregar(autorizado.body);
check("o ficheiro sobe direito ao armazenamento", put === 200, `${put}`);

const alheia = await call(director, "POST", `/api/members/${idB}/foto`, { key: autorizado.body?.key });
check("a chave de um sócio não serve para outro (400)", alheia.status === 400, `${alheia.status}`);

const confirmado = await call(director, "POST", `/api/members/${idA}/foto`, { key: autorizado.body?.key });
check("confirma e devolve o link assinado", confirmado.status === 201 && String(confirmado.body?.photoUrl ?? "").includes("/storage/v1/object/sign/"), `${confirmado.status} ${JSON.stringify(confirmado.body).slice(0, 120)}`);

ficha = await call(director, "GET", `/api/members/${idA}`);
check("a ficha passa a trazer `photoUrl`", typeof ficha.body?.photoUrl === "string" && ficha.body.photoUrl.length > 0);
const lista = await call(director, "GET", "/api/members?q=ZF");
const naLista = lista.body?.members?.find((m) => m.id === idA);
const outroNaLista = lista.body?.members?.find((m) => m.id === idB);
check("a lista também — e só para quem a tem", typeof naLista?.photoUrl === "string" && outroNaLista?.photoUrl === null, JSON.stringify({ a: naLista?.photoUrl?.slice(0, 40), b: outroNaLista?.photoUrl }));
const fotoUrlOk = (await fetch(ficha.body.photoUrl)).status;
check("o link assinado serve mesmo a imagem", fotoUrlOk === 200, `${fotoUrlOk}`);

const chaveAntiga = (await db.query(`SELECT "photoKey" FROM "Member" WHERE id = $1`, [idA])).rows[0]?.photoKey;

console.log("\n=== Trocar: a anterior sai do armazenamento ===");
const segunda = await call(director, "POST", `/api/members/${idA}/foto/upload`, { contentType: "image/png" });
await carregar(segunda.body);
await call(director, "POST", `/api/members/${idA}/foto`, { key: segunda.body?.key });
const chaveNova = (await db.query(`SELECT "photoKey" FROM "Member" WHERE id = $1`, [idA])).rows[0]?.photoKey;
check("a ficha aponta para a nova", chaveNova === segunda.body?.key && chaveNova !== chaveAntiga);
const antigaSumiu = await call(director, "POST", `/api/members/${idA}/foto`, { key: chaveAntiga });
check("a anterior já não existe no armazenamento (400 ao confirmar)", antigaSumiu.status === 400, `${antigaSumiu.status}`);

console.log("\n=== Remover ===");
const removida = await call(director, "DELETE", `/api/members/${idA}/foto`);
check("remove", removida.status === 200 && removida.body?.ok === true, `${removida.status}`);
ficha = await call(director, "GET", `/api/members/${idA}`);
check("a ficha volta a nulo", ficha.body?.photoUrl === null);
const semChave = (await db.query(`SELECT "photoKey" FROM "Member" WHERE id = $1`, [idA])).rows[0]?.photoKey;
check("e a coluna também", semChave === null);

console.log("\n=== Apagar a ficha leva o ficheiro ===");
const terceira = await call(director, "POST", `/api/members/${idB}/foto/upload`, { contentType: "image/png" });
await carregar(terceira.body);
await call(director, "POST", `/api/members/${idB}/foto`, { key: terceira.body?.key });
const apagado = await call(director, "DELETE", `/api/members/${idB}`);
check("apaga o sócio sem número", apagado.status === 200, `${apagado.status} ${JSON.stringify(apagado.body).slice(0, 100)}`);
// Não há rota pública para "a chave X existe?" — pergunta-se ao armazenamento.
const existe = await fetch(`${S}/storage/v1/object/info/authenticated/fotos/${terceira.body?.key}`, {
  headers: { apikey: env("SUPABASE_SERVICE_ROLE_KEY"), Authorization: `Bearer ${env("SUPABASE_SERVICE_ROLE_KEY")}` },
});
check("o ficheiro dela saiu do armazenamento", existe.status === 400 || existe.status === 404, `${existe.status}`);

await limpar();
await db.end();

console.log(`\n${ok} OK · ${bad} falhas`);
process.exit(bad === 0 ? 0 : 1);

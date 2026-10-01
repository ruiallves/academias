#!/usr/bin/env node
/**
 * Adicionar staff sem enviar o convite, enviar depois, e importar de uma folha.
 *
 * - `enviar: false` guarda a pessoa: sem link, sem email, `sentAt` nulo;
 * - enviar depois emite o link (que abre) e põe o prazo a contar;
 * - reenviar troca o link: o antigo deixa de abrir;
 * - a importação cria várias de uma vez, sem enviar por omissão, e as linhas
 *   más voltam com o motivo sem travar as boas;
 * - quem não tem `staff:write` não faz nada disto.
 *
 * Com convites criados aqui no Life Club (emails `zz.*@teste.academias.pt`),
 * apagados no fim. A API de teste tem de correr com `MAIL_API_KEY=` vazio.
 *
 * Uso: API_URL=http://localhost:3012 node scripts/test-staff-por-convidar.mjs
 * Nunca contra a :3000 nem a :3001 (as do Rui).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const env = (k) => {
  const l = readFileSync(path.join(HERE, "..", ".env"), "utf8").split(/\r?\n/).find((x) => x.startsWith(k + "="));
  if (!l) throw new Error(`${k} não está em .env`);
  return l.slice(k.length + 1).trim().replace(/^"|"$/g, "");
};

const S = env("SUPABASE_URL").replace(/\/$/, "");
const A = env("SUPABASE_ANON_KEY");
const API = process.env.API_URL ?? "http://localhost:3012";
if (/:300[01]\b/.test(API)) throw new Error("Não corras isto contra a :3000 nem a :3001.");

let ok = 0, bad = 0;
const check = (l, c, d = "") => { if (c) { ok++; console.log("  OK    " + l); } else { bad++; console.log("  FALHA " + l + (d ? " — " + d : "")); } };

const login = async (email) =>
  (await (await fetch(`${S}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: A, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "academia2026" }),
  })).json()).access_token;

const call = async (token, method, pathname, body) => {
  const r = await fetch(API + pathname, {
    method,
    headers: { Authorization: `Bearer ${token}`, "x-academy-slug": "life-club", ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};
/** A página do convite abre? (200 abre, 404 não.) */
const abre = async (link) => (await fetch(API + new URL(link).pathname)).status;

const db = new pg.Client({ connectionString: env("MIGRATE_DATABASE_URL"), ssl: { rejectUnauthorized: false } });
await db.connect();
const limpar = () => db.query(`DELETE FROM "StaffInvite" WHERE email LIKE 'zz.%@teste.academias.pt'`);
const linha = async (email) => (await db.query(`SELECT id, "sentAt", "expiresAt", "revokedAt" FROM "StaffInvite" WHERE email = $1 ORDER BY "createdAt" DESC LIMIT 1`, [email])).rows[0];

try {
  await limpar();
  const cargo = (await db.query(`SELECT id, name FROM "AcademyRole" WHERE "academyId" = 'acd_lifeclub' AND "baseRole" = 'COACH' AND "archivedAt" IS NULL ORDER BY "createdAt" LIMIT 1`)).rows[0];
  const direcao = await login("direcao@lifeclub.pt");
  const treinador = await login("treinador@lifeclub.pt");
  const dias = (d) => (new Date(d).getTime() - Date.now()) / 86_400_000;

  console.log("=== Guardar sem enviar ===");
  const g = await call(direcao, "POST", "/api/invites", { name: "ZZ Ana Teste", email: "zz.ana@teste.academias.pt", academyRoleId: cargo.id, teamIds: ["t_sub11"], enviar: false });
  const l1 = await linha("zz.ana@teste.academias.pt");
  check("guarda (201), sem link e sem email", g.status === 201 && g.body?.sent === false && g.body?.link === "" && g.body?.emailed === false, JSON.stringify(g.body));
  check("na base fica por enviar, e não expira para a semana", l1?.sentAt === null && dias(l1.expiresAt) > 365, JSON.stringify(l1));
  const lista = await call(direcao, "GET", "/api/invites");
  const naLista = lista.body?.find?.((i) => i.id === g.body?.id);
  check("aparece na lista, com sentAt nulo, o cargo e a equipa", naLista && naLista.sentAt === null && naLista.title === cargo.name && naLista.teamIds?.join() === "t_sub11", JSON.stringify(naLista));
  const dup = await call(direcao, "POST", "/api/invites", { name: "ZZ Ana Outra", email: "zz.ana@teste.academias.pt", academyRoleId: cargo.id, enviar: false });
  check("a mesma pessoa não entra duas vezes (409)", dup.status === 409, String(dup.status));

  console.log("\n=== Enviar depois, e reenviar ===");
  const e1 = await call(direcao, "POST", `/api/invites/${g.body.id}/enviar`, {});
  const l2 = await linha("zz.ana@teste.academias.pt");
  check("enviar emite o link e põe o prazo a 7 dias", e1.status === 201 && e1.body?.sent === true && /\/convite\//.test(e1.body?.link ?? "") && l2.sentAt !== null && dias(l2.expiresAt) > 6.9 && dias(l2.expiresAt) < 7.1, `${e1.status} ${JSON.stringify(e1.body)} ${dias(l2.expiresAt)}`);
  check("o link abre a página do convite", (await abre(e1.body.link)) === 200);
  const e2 = await call(direcao, "POST", `/api/invites/${g.body.id}/enviar`, {});
  check("reenviar dá um link novo", e2.status === 201 && e2.body?.link && e2.body.link !== e1.body.link);
  check("o link antigo deixa de abrir, e o novo abre", (await abre(e1.body.link)) === 404 && (await abre(e2.body.link)) === 200);

  console.log("\n=== Como sempre: enviar logo ===");
  const n = await call(direcao, "POST", "/api/invites", { name: "ZZ Bruno Teste", email: "zz.bruno@teste.academias.pt", academyRoleId: cargo.id });
  const l3 = await linha("zz.bruno@teste.academias.pt");
  check("sem `enviar`, o convite sai logo com link", n.status === 201 && n.body?.sent === true && n.body?.link && l3.sentAt !== null, JSON.stringify(n.body));

  console.log("\n=== Importar ===");
  const imp = await call(direcao, "POST", "/api/invites/importar", {
    rows: [
      { name: "ZZ Carla Teste", email: "zz.carla@teste.academias.pt", academyRoleId: cargo.id, teamIds: ["t_sub11", "t_sub13"] },
      { name: "ZZ Duarte Teste", email: "zz.duarte@teste.academias.pt", academyRoleId: cargo.id },
      { name: "ZZ Ana Repetida", email: "zz.ana@teste.academias.pt", academyRoleId: cargo.id },
      { name: "ZZ Eva Teste", email: "zz.eva@teste.academias.pt", academyRoleId: "cargo_que_nao_existe" },
    ],
  });
  check("duas entram, duas voltam com o motivo", imp.status === 201 && imp.body?.created === 2 && imp.body?.errors?.length === 2 && imp.body.errors.map((e) => e.row).join() === "2,3", JSON.stringify(imp.body));
  const lc = await linha("zz.carla@teste.academias.pt");
  check("importar não envia nada por omissão", imp.body?.emailed === 0 && lc?.sentAt === null, JSON.stringify(lc));
  const mau = await call(direcao, "POST", "/api/invites/importar", { rows: [{ name: "ZZ Sem Email", email: "nao-e-email", academyRoleId: cargo.id }] });
  check("um email inválido na folha é recusado (400)", mau.status === 400, String(mau.status));

  console.log("\n=== Enviar a todos ===");
  const porEnviar = (await call(direcao, "GET", "/api/invites")).body.filter((i) => i.sentAt === null && i.email.startsWith("zz."));
  const todos = await call(direcao, "POST", "/api/invites/enviar", { ids: porEnviar.map((i) => i.id) });
  const ld = await linha("zz.duarte@teste.academias.pt");
  check("os dois guardados passam a enviados", porEnviar.length === 2 && todos.status === 201 && todos.body?.resultados?.length === 2 && ld.sentAt !== null, `${porEnviar.length} ${JSON.stringify(todos.body)}`);

  console.log("\n=== Quem pode ===");
  check("o treinador não adiciona (403)", (await call(treinador, "POST", "/api/invites", { name: "ZZ Xis", email: "zz.x@teste.academias.pt", academyRoleId: cargo.id, enviar: false })).status === 403);
  check("nem importa (403)", (await call(treinador, "POST", "/api/invites/importar", { rows: [{ name: "ZZ Xis", email: "zz.x@teste.academias.pt", academyRoleId: cargo.id }] })).status === 403);
  check("nem envia (403)", (await call(treinador, "POST", `/api/invites/${g.body.id}/enviar`, {})).status === 403);

  const rem = await call(direcao, "DELETE", `/api/invites/${lc.id}`);
  const lr = await linha("zz.carla@teste.academias.pt");
  check("remover tira da lista", rem.status === 200 && lr.revokedAt !== null);
} finally {
  await limpar();
  await db.end();
}

console.log(`\n${ok} OK, ${bad} falhas`);
process.exit(bad ? 1 : 0);

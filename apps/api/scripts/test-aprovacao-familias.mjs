#!/usr/bin/env node
/**
 * A aprovação das famílias pelo clube.
 *
 * O pai regista-se pelo link com o NIF e a data de nascimento do educando, e a
 * conta nasce à espera: a app mostra "pedido enviado ao clube", o servidor
 * recusa tudo com `FAMILY_APPROVAL_PENDING`, e a secretaria responde na página
 * Famílias. O que se prova aqui:
 *
 *  - à espera, o pai não vê nada, e a recusa diz porquê (não é "conta errada");
 *  - o pedido aparece à secretaria com o educando, e fora da lista de famílias;
 *  - aprovar abre a app; recusar apaga a conta nova;
 *  - quem já é encarregado aprovado não volta para a fila por passar outra vez
 *    pelo link (o segundo filho);
 *  - quem foi desactivado pelo clube já não se reactiva sozinho pelo link.
 *
 * Dados próprios (dois atletas e um link), criados e apagados aqui: os links e
 * os atletas do clube não são tocados.
 *
 * O registo está a 5 pedidos por minuto por IP, e este teste faz 5: espera um
 * minuto entre corridas.
 *
 * Uso: API=http://localhost:3001 node scripts/test-aprovacao-familias.mjs
 */
import { randomBytes } from "node:crypto";
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
const API = process.env.API ?? "http://localhost:3001";
const SLUG = "life-club";
const ACADEMY = "acd_lifeclub";

let ok = 0, bad = 0;
const check = (l, c, d = "") => { if (c) { ok++; console.log("  OK    " + l); } else { bad++; console.log("  FALHA " + l + (d ? " — " + d : "")); } };

const login = async (e, p) =>
  (await (await fetch(`${S}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: A, "Content-Type": "application/json" },
    body: JSON.stringify({ email: e, password: p }),
  })).json()).access_token;

const pedido = async (token, method, p, body, app) => {
  const r = await fetch(API + p, {
    method,
    headers: {
      Authorization: `Bearer ${token}`, "x-academy-slug": SLUG,
      ...(app ? { "x-app": app } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const naApp = (token, p) => pedido(token, "GET", p, undefined, "family");

const registar = async (dados) => {
  const r = await fetch(`${API}/api/convite-familia/${TOKEN}/registar`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone: "912 000 000", password: "academia2026", relation: "Mãe", acceptLegal: true, ...dados }),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};

const db = new pg.Client({ connectionString: env("MIGRATE_DATABASE_URL"), ssl: { rejectUnauthorized: false } });
await db.connect();

const stamp = Date.now().toString(36);
const TOKEN = randomBytes(24).toString("hex");
const nif = () => "2" + String(Date.now() + Math.floor(Math.random() * 1e6)).slice(-8);
const ATL1 = { id: `zz_atl_aprov1_${stamp}`, nome: "Tomás Aprovação", nif: nif(), nasc: "2013-04-02" };
const ATL2 = { id: `zz_atl_aprov2_${stamp}`, nome: "Inês Aprovação", nif: nif(), nasc: "2015-09-11" };
const MAE = `mae-aprov-${stamp}@exemplo.pt`;
const PAI = `pai-aprov-${stamp}@exemplo.pt`;

async function limpar() {
  const users = `SELECT id FROM "User" WHERE email IN ($1, $2)`;
  await db.query(`DELETE FROM "LegalAcceptance" WHERE "userId" IN (${users})`, [MAE, PAI]).catch(() => {});
  await db.query(`DELETE FROM "Membership" WHERE "userId" IN (${users})`, [MAE, PAI]);
  await db.query(`DELETE FROM "User" WHERE email IN ($1, $2)`, [MAE, PAI]);
  await db.query(`DELETE FROM "Athlete" WHERE id IN ($1, $2)`, [ATL1.id, ATL2.id]);
  await db.query(`DELETE FROM "FamilyInvite" WHERE token = $1`, [TOKEN]);
}

try {
  console.log("=== Preparar ===");
  for (const a of [ATL1, ATL2]) {
    await db.query(
      `INSERT INTO "Athlete" (id, "academyId", name, birthdate, "taxId", "updatedAt") VALUES ($1, $2, $3, $4, $5, now())`,
      [a.id, ACADEMY, a.nome, a.nasc, a.nif],
    );
  }
  await db.query(
    `INSERT INTO "FamilyInvite" (id, "academyId", token, "updatedAt") VALUES ($1, $2, $3, now())`,
    [`zz_fi_${stamp}`, ACADEMY, TOKEN],
  );
  const director = await login("direcao@lifeclub.pt", "academia2026");
  const coach = await login("treinador@lifeclub.pt", "academia2026");
  check("sessões de staff", Boolean(director && coach));

  console.log("\n=== O registo fica à espera ===");
  const r1 = await registar({ name: "Marta Aprovação", email: MAE, taxId: ATL1.nif, birthdate: ATL1.nasc });
  check("o registo passa", r1.status === 201 || r1.status === 200, JSON.stringify(r1.body).slice(0, 160));
  check("e diz que ficou à espera", r1.body?.pending === true);
  check("com sessão, para a app mostrar o ecrã de espera", typeof r1.body?.accessToken === "string");
  const mae = r1.body.accessToken;

  const m1 = (await db.query(
    `SELECT m.id, m."isActive", m."approvalRequestedAt", m."approvedAt" FROM "Membership" m JOIN "User" u ON u.id = m."userId" WHERE u.email = $1`,
    [MAE],
  )).rows;
  check("uma membership, desligada e marcada", m1.length === 1 && !m1[0].isActive && m1[0].approvalRequestedAt && !m1[0].approvedAt);
  const maeId = m1[0].id;

  const ctx1 = await pedido(mae, "GET", "/api/app/contexts");
  check("os contextos mostram a família à espera",
    ctx1.body?.contexts?.some((c) => c.type === "FAMILY" && c.pending === true), JSON.stringify(ctx1.body));

  const boot1 = await naApp(mae, "/api/bootstrap");
  check("a app da família é recusada", boot1.status === 403, `${boot1.status}`);
  check("com o código de espera, não o de conta errada", boot1.body?.code === "FAMILY_APPROVAL_PENDING", JSON.stringify(boot1.body));
  const semApp = await pedido(mae, "GET", "/api/athletes");
  check("sem cabeçalho de app também", semApp.status === 403 && semApp.body?.code === "FAMILY_APPROVAL_PENDING");

  const r1b = await registar({ name: "Marta Aprovação", email: MAE, taxId: ATL1.nif, birthdate: ATL1.nasc });
  const dup = (await db.query(`SELECT count(*)::int n FROM "Membership" m JOIN "User" u ON u.id = m."userId" WHERE u.email = $1`, [MAE])).rows[0].n;
  check("um segundo toque não duplica nada", r1b.body?.pending === true && dup === 1, `${r1b.status} ${dup}`);

  console.log("\n=== A secretaria vê o pedido ===");
  const lista = await pedido(director, "GET", "/api/family-invite/pedidos");
  const meu = lista.body?.find?.((p) => p.membershipId === maeId);
  check("aparece nos pedidos", Boolean(meu), JSON.stringify(lista.body).slice(0, 160));
  check("com o educando", meu?.children?.[0]?.name === ATL1.nome && meu?.children?.[0]?.relation === "Mãe");
  check("e com o contacto", meu?.email === MAE && Boolean(meu?.requestedAt));

  const atletas1 = (await pedido(director, "GET", "/api/athletes")).body;
  const ficha1 = atletas1?.find?.((a) => a.id === ATL1.id);
  check("e fica fora da lista de famílias (a ficha não o mostra)", ficha1 && ficha1.guardians.length === 0, JSON.stringify(ficha1?.guardians));

  const doTreinador = await pedido(coach, "POST", `/api/family-invite/pedidos/${maeId}/aprovar`, {});
  check("o treinador não aprova (falta family:write)", doTreinador.status === 403, `${doTreinador.status}`);

  console.log("\n=== Aprovar ===");
  const aprov = await pedido(director, "POST", `/api/family-invite/pedidos/${maeId}/aprovar`, {});
  check("a direcção aprova", aprov.status === 201 || aprov.status === 200, JSON.stringify(aprov.body));
  check("aprovar duas vezes dá 404, não parte nada",
    (await pedido(director, "POST", `/api/family-invite/pedidos/${maeId}/aprovar`, {})).status === 404);

  const ctx2 = await pedido(mae, "GET", "/api/app/contexts");
  const fam2 = ctx2.body?.contexts?.find((c) => c.type === "FAMILY");
  check("a família deixa de estar à espera", fam2 && !fam2.pending, JSON.stringify(ctx2.body));
  const filhos = await naApp(mae, "/api/athletes");
  check("e a mãe vê o filho", filhos.status === 200 && filhos.body?.length === 1 && filhos.body[0].id === ATL1.id, `${filhos.status}`);
  check("sai da lista de pedidos",
    !(await pedido(director, "GET", "/api/family-invite/pedidos")).body?.some((p) => p.membershipId === maeId));
  const ficha2 = (await pedido(director, "GET", "/api/athletes")).body?.find?.((a) => a.id === ATL1.id);
  check("e entra na ficha do atleta", ficha2?.guardians?.some((g) => g.membershipId === maeId && g.isActive));

  console.log("\n=== O segundo filho, já aprovada ===");
  const r2 = await registar({ name: "Marta Aprovação", email: MAE, taxId: ATL2.nif, birthdate: ATL2.nasc });
  check("passa sem voltar à fila", r2.body?.pending === false, JSON.stringify(r2.body).slice(0, 120));
  const dois = await naApp(mae, "/api/athletes");
  check("e vê os dois filhos logo", dois.body?.length === 2, `${dois.body?.length}`);

  console.log("\n=== Recusar uma conta nova ===");
  const r3 = await registar({ name: "Rui Recusado", email: PAI, taxId: ATL1.nif, birthdate: ATL1.nasc, relation: "Pai" });
  check("o pai fica à espera", r3.body?.pending === true, JSON.stringify(r3.body).slice(0, 120));
  const paiId = (await db.query(`SELECT m.id FROM "Membership" m JOIN "User" u ON u.id = m."userId" WHERE u.email = $1`, [PAI])).rows[0]?.id;
  const rec = await pedido(director, "POST", `/api/family-invite/pedidos/${paiId}/recusar`, {});
  check("a direcção recusa", rec.status === 201 || rec.status === 200, JSON.stringify(rec.body));
  const resto = (await db.query(`SELECT count(*)::int n FROM "Membership" WHERE id = $1`, [paiId])).rows[0].n;
  const links = (await db.query(`SELECT count(*)::int n FROM "GuardianLink" WHERE "membershipId" = $1`, [paiId])).rows[0].n;
  check("a conta nova é apagada, com a ligação ao educando", resto === 0 && links === 0, `${resto} ${links}`);
  const depois = await naApp(r3.body.accessToken, "/api/bootstrap");
  check("e a app passa a dizer que não é encarregado", depois.status === 403 && depois.body?.code !== "FAMILY_APPROVAL_PENDING");

  console.log("\n=== Desactivada pelo clube, volta pelo link ===");
  const desl = await pedido(director, "PATCH", `/api/memberships/${maeId}/active`, { active: false });
  check("a direcção desactiva a mãe", desl.status === 200, JSON.stringify(desl.body));
  const r4 = await registar({ name: "Marta Aprovação", email: MAE, taxId: ATL1.nif, birthdate: ATL1.nasc });
  check("o link já não a reactiva: volta à fila", r4.body?.pending === true, JSON.stringify(r4.body).slice(0, 120));
  check("e a app diz que está à espera", (await naApp(mae, "/api/bootstrap")).body?.code === "FAMILY_APPROVAL_PENDING");
  await pedido(director, "POST", `/api/family-invite/pedidos/${maeId}/recusar`, {});
  const arq = (await db.query(`SELECT "isActive", "approvalRequestedAt" FROM "Membership" WHERE id = $1`, [maeId])).rows[0];
  const linksMae = (await db.query(`SELECT count(*)::int n FROM "GuardianLink" WHERE "membershipId" = $1`, [maeId])).rows[0].n;
  check("recusar quem já foi aprovada não apaga o histórico", arq && !arq.isActive && !arq.approvalRequestedAt && linksMae === 2,
    JSON.stringify(arq) + " " + linksMae);
  const react = await pedido(director, "PATCH", `/api/memberships/${maeId}/active`, { active: true });
  check("reactivar à mão continua a funcionar", react.status === 200 && (await naApp(mae, "/api/athletes")).body?.length === 2);
} finally {
  console.log("\n=== Limpeza ===");
  await limpar();
  await db.end();
  console.log("  feito");
}

console.log(`\n${ok} passaram, ${bad} falharam`);
process.exit(bad === 0 ? 0 : 1);

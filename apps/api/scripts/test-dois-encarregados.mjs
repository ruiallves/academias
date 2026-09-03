#!/usr/bin/env node
/**
 * Prova: o pai E a mãe podem aceder ao mesmo atleta.
 *
 * Dois registos independentes, com o mesmo NIF + data de nascimento, a partir do
 * mesmo link de convite. Cada um cria a sua conta; ambos ficam a ver o mesmo
 * educando. É a pergunta do clube sobre pais separados.
 */
import { readFileSync } from "node:fs";
import pg from "pg";

const env = (k) => {
  const l = readFileSync(".env", "utf8").split(/\r?\n/).find((x) => x.startsWith(k + "="));
  return l ? l.slice(k.length + 1).trim().replace(/^"|"$/g, "") : "";
};
const S = env("SUPABASE_URL").replace(/\/$/, "");
const A = env("SUPABASE_ANON_KEY");
const SR = env("SUPABASE_SERVICE_ROLE_KEY");
const API = "http://127.0.0.1:3000";

let ok = 0, bad = 0;
const check = (l, c, d = "") => { if (c) { ok++; console.log("  OK    " + l); } else { bad++; console.log("  FALHA " + l + (d ? " — " + d : "")); } };

const db = new pg.Client({ connectionString: env("MIGRATE_DATABASE_URL"), ssl: { rejectUnauthorized: false } });
await db.connect();

/** Entrar como quem quer que seja — devolve o token de acesso. */
const entrar = async (email, password = "academia2026") => {
  const j = await (await fetch(`${S}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: A, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  })).json();
  return j.access_token;
};

const AC = "acd_lifeclub";
const NIF = "199299399";
const NASC = "2014-05-09";
const PAI = `zz-pai-${Date.now().toString(36)}@exemplo.pt`;
const MAE = `zz-mae-${Date.now().toString(36)}@exemplo.pt`;

/* Um atleta só deste teste, com NIF próprio — não se mexe em ninguém real. */
const atletaId = `zz_atl_${Date.now().toString(36)}`;
const equipa = (await db.query(`SELECT id FROM "Team" WHERE "academyId" = $1 LIMIT 1`, [AC])).rows[0].id;
await db.query(
  `INSERT INTO "Athlete" (id, "academyId", name, birthdate, "taxId", status, "updatedAt")
   VALUES ($1, $2, 'ZZ Filho de Pais Separados', $3::date, $4, 'ACTIVE', now())`,
  [atletaId, AC, NASC, NIF],
);
await db.query(
  `INSERT INTO "TeamMembership" (id, "academyId", "teamId", "athleteId")
   VALUES ($1, $2, $3, $4)`,
  [`zz_tm_${Date.now().toString(36)}`, AC, equipa, atletaId],
).catch(() => null);

/* Um link de convite vivo, como o clube geraria. */
const token = `zz${Buffer.from(String(Date.now())).toString("hex")}${"a".repeat(20)}`;
const conviteId = `zz_inv_${Date.now().toString(36)}`;
await db.query(
  `INSERT INTO "FamilyInvite" (id, "academyId", token, "expiresAt", "updatedAt")
   VALUES ($1, $2, $3, now() + interval '1 day', now())`,
  [conviteId, AC, token],
);

const registar = (email, nome, relacao) =>
  fetch(`${API}/api/convite-familia/${token}/registar`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: nome, email, phone: "911111111", password: "academia2026",
      relation: relacao, taxId: NIF, birthdate: NASC,
    }),
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

const apagarConta = async (email) => {
  const r = await fetch(`${S}/auth/v1/admin/users?per_page=200`, { headers: { apikey: SR, Authorization: `Bearer ${SR}` } });
  const { users = [] } = await r.json().catch(() => ({ users: [] }));
  const u = users.find((x) => x.email === email);
  if (u) await fetch(`${S}/auth/v1/admin/users/${u.id}`, { method: "DELETE", headers: { apikey: SR, Authorization: `Bearer ${SR}` } });
};

try {
  console.log("=== O pai regista-se ===");
  const r1 = await registar(PAI, "ZZ Pai Separado", "Pai");
  check("o primeiro encarregado entra", r1.status === 201 || r1.status === 200, `${r1.status} ${JSON.stringify(r1.body).slice(0, 140)}`);
  check("e fica com o educando", r1.body?.athlete === "ZZ Filho de Pais Separados", `${r1.body?.athlete}`);

  console.log("\n=== A mãe regista-se, com o MESMO NIF ===");
  const r2 = await registar(MAE, "ZZ Mãe Separada", "Mãe");
  check("o segundo encarregado também entra", r2.status === 201 || r2.status === 200, `${r2.status} ${JSON.stringify(r2.body).slice(0, 140)}`);
  check("e fica com o mesmo educando", r2.body?.athlete === "ZZ Filho de Pais Separados", `${r2.body?.athlete}`);

  console.log("\n=== O que ficou na base ===");
  const links = (await db.query(`
    SELECT u.email, u.name, g.relation
      FROM "GuardianLink" g
      JOIN "Membership" m ON m.id = g."membershipId"
      JOIN "User" u ON u.id = m."userId"
     WHERE g."athleteId" = $1 ORDER BY u.email`, [atletaId])).rows;
  console.table(links);

  check("o atleta tem dois encarregados", links.length === 2, `${links.length}`);
  check("cada um com a sua relação", links.some((l) => l.relation === "Pai") && links.some((l) => l.relation === "Mãe"));
  check("e contas separadas", new Set(links.map((l) => l.email)).size === 2);

  /*
   * Nenhum é "o" pagador — a coluna `isPayer` foi apagada (ver a migração
   * `sem_pagador_designado`). Qualquer um paga, e os avisos vão aos dois.
   */
  const colunas = (await db.query(`
    SELECT column_name FROM information_schema.columns
     WHERE table_name = 'GuardianLink' AND column_name = 'isPayer'`)).rows;
  check("já não há encarregado pagador designado", colunas.length === 0, "a coluna isPayer ainda existe");

  console.log("\n=== E os dois vêem o atleta pela API ===");
  for (const [quem, email] of [["o pai", PAI], ["a mãe", MAE]]) {
    const t = await entrar(email);
    const r = await fetch(`${API}/api/athletes`, {
      headers: { Authorization: `Bearer ${t}`, "x-academy-slug": "life-club", "x-app": "family" },
    });
    const lista = await r.json().catch(() => []);
    check(`${quem} vê o educando na app`, Array.isArray(lista) && lista.some((x) => x.id === atletaId), JSON.stringify(lista).slice(0, 90));
    check(`e vê ${quem === "o pai" ? "só um" : "só um"} educando`, Array.isArray(lista) && lista.length === 1, `${lista?.length}`);
  }
  console.log("\n=== E a consola mostra os dois ===");
  /*
   * A página Famílias desenha uma linha por encarregado, a partir dos
   * `guardians` que vêm dentro de cada atleta (`byGuardian`, agrupado por
   * membership). Dois pais são duas memberships — logo, duas linhas. Aqui
   * verifica-se a fonte: o que a API entrega à consola.
   */
  const tDir = await entrar("direcao@lifeclub.pt");
  const rAt = await fetch(`${API}/api/athletes`, {
    headers: { Authorization: `Bearer ${tDir}`, "x-academy-slug": "life-club" },
  });
  const atletas = await rAt.json().catch(() => []);
  const oNosso = Array.isArray(atletas) ? atletas.find((a) => a.id === atletaId) : null;

  check("a consola vê o atleta", Boolean(oNosso), `${rAt.status}`);
  check("com os dois encarregados", oNosso?.guardians?.length === 2, JSON.stringify(oNosso?.guardians?.map((g) => g.name)));
  check(
    "cada um com nome, relação e contacto",
    (oNosso?.guardians ?? []).every((g) => g.name && g.relation && g.email),
    JSON.stringify(oNosso?.guardians),
  );
  check(
    "e memberships diferentes — duas linhas na lista de famílias",
    new Set((oNosso?.guardians ?? []).map((g) => g.membershipId)).size === 2,
  );

  console.log("     o que a consola recebe:");
  console.table((oNosso?.guardians ?? []).map((g) => ({ nome: g.name, relação: g.relation, email: g.email })));

} finally {
  console.log("\n=== Limpeza ===");
  await db.query(`DELETE FROM "FamilyInvite" WHERE id = $1`, [conviteId]);
  await db.query(`DELETE FROM "Athlete" WHERE id = $1`, [atletaId]);
  for (const e of [PAI, MAE]) {
    await db.query(`DELETE FROM "Membership" WHERE "userId" IN (SELECT id FROM "User" WHERE email = $1)`, [e]);
    await db.query(`DELETE FROM "User" WHERE email = $1`, [e]);
    await apagarConta(e);
  }
  const sobrou = Number((await db.query(`SELECT count(*) FROM "Athlete" WHERE "taxId" = $1`, [NIF])).rows[0].count);
  check("não ficou lixo", sobrou === 0, `${sobrou}`);
  await db.end();
}

console.log(`\n${ok} passaram, ${bad} falharam`);
process.exit(bad === 0 ? 0 : 1);

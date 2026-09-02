#!/usr/bin/env node
/**
 * O fluxo do convite de ponta a ponta, contra o servidor a correr.
 *
 * Ao contrário de `test-invites.mjs` — que exercita a base de dados — este bate no
 * HTTP a sério: cria um convite pela API autenticada, abre a página de resgate,
 * resgata, e confirma que a pessoa passou a existir com o papel e as equipas
 * certas. E que o link deixou de valer.
 *
 * Pressupõe `node dist/main.js` a correr em :3000 e a seed aplicada.
 *
 * Uso: node scripts/test-invite-flow.mjs
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const HERE = path.dirname(fileURLToPath(import.meta.url));

function env(key) {
  const line = readFileSync(path.join(HERE, "..", ".env"), "utf8")
    .split("\n")
    .find((l) => l.startsWith(`${key}=`));
  if (!line) throw new Error(`${key} não está em .env`);
  return line.slice(key.length + 1).trim().replace(/^"|"$/g, "");
}

const API = "http://localhost:3000";
const SUPABASE_URL = env("SUPABASE_URL").replace(/\/$/, "");
const ANON = env("SUPABASE_ANON_KEY");
const SERVICE = env("SUPABASE_SERVICE_ROLE_KEY");
const ADMIN_DB = env("MIGRATE_DATABASE_URL");
const SLUG = "life-club";

// Um email por corrida, para o teste não depender de limpezas anteriores.
const NEW_EMAIL = `teste-fluxo-${Date.now()}@exemplo.pt`;
const NEW_PASSWORD = "convite-seguro-2026";

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

async function signIn(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`login falhou: ${(await res.text()).slice(0, 140)}`);
  return (await res.json()).access_token;
}

/** O cabeçalho de tenant que o guard aceita em desenvolvimento (em produção é o subdomínio). */
const headers = (token) => ({
  Authorization: `Bearer ${token}`,
  "x-academy-slug": SLUG,
  "Content-Type": "application/json",
});

async function main() {
  const db = new pg.Client({ connectionString: ADMIN_DB, ssl: { rejectUnauthorized: false } });
  await db.connect();

  console.log("=== Quem convida ===");
  const director = await signIn("direcao@lifeclub.pt", "academia2026");
  check("a direção entra", Boolean(director));

  const team = await db.query(`SELECT id, name FROM "Team" WHERE "academyId" = 'acd_lifeclub' LIMIT 1`);
  const teamId = team.rows[0].id;
  console.log(`      equipa de teste: ${team.rows[0].name}`);

  /*
   * O convite aponta para um **cargo**, e não para um papel.
   *
   * Este teste mandava `role: "COACH"`, `title` e `department` — a forma que a
   * API tinha antes de os departamentos existirem. Deixou de passar da primeira
   * chamada, e ficou assim: uma suite inteira vermelha por uma razão que não
   * tinha nada que ver com o que ela testa. O que se convida hoje é um
   * `academyRoleId`, e é dele que o servidor lê o papel-base, o cargo e as
   * permissões (ver `InvitesService.create`).
   *
   * O cargo cria-se aqui em vez de se ir buscar um existente: o `title` do
   * membro passa a ser o nome do cargo, e um nome próprio deste teste é o que
   * torna a asserção lá em baixo uma prova e não uma coincidência.
   */
  await db.query(`DELETE FROM "AcademyRole" WHERE "academyId" = 'acd_lifeclub' AND name LIKE 'ZZ %'`);
  const tecnica = await db.query(
    `SELECT id FROM "Department" WHERE "academyId" = 'acd_lifeclub' AND key = 'tecnica'`,
  );
  const cargo = await db.query(
    `INSERT INTO "AcademyRole" (id, "academyId", key, name, "baseRole", "departmentId", permissions, "navKeys", "isSystem", rank, "updatedAt")
     VALUES ($1, 'acd_lifeclub', $2, 'ZZ Treinador adjunto', 'COACH', $3, $4, '{}', false, 40, now())
     RETURNING id`,
    [
      `zz_role_${Date.now().toString(36)}`,
      `zz-treinador-adjunto-${Date.now().toString(36)}`,
      tecnica.rows[0]?.id ?? null,
      ["team:read", "calendar:read", "attendance:write"],
    ],
  );
  const cargoId = cargo.rows[0].id;

  /* O do presidente, para a prova de escalada: está acima da direção. */
  const presidencia = await db.query(
    `SELECT id FROM "AcademyRole" WHERE "academyId" = 'acd_lifeclub' AND key = 'presidente'`,
  );

  console.log("\n=== Criar o convite ===");
  const created = await fetch(`${API}/api/invites`, {
    method: "POST",
    headers: headers(director),
    body: JSON.stringify({
      name: "Treinador de Teste",
      email: NEW_EMAIL,
      academyRoleId: cargoId,
      teamIds: [teamId],
    }),
  });
  const invite = await created.json();
  check("a direção pode convidar", created.ok, JSON.stringify(invite).slice(0, 160));
  check("devolve um link", typeof invite.link === "string" && invite.link.includes("/convite/"));

  const token = invite.link?.split("/convite/")[1] ?? "";
  check("o token tem tamanho de 32 bytes em base64url", token.length >= 42, `tem ${token.length}`);

  console.log("\n=== O que está guardado ===");
  const row = await db.query(`SELECT "tokenHash", email, role FROM "StaffInvite" WHERE email = $1`, [NEW_EMAIL]);
  check("o convite existe na base", row.rows.length === 1);
  check("o token em claro não está guardado", row.rows[0]?.tokenHash !== token);

  console.log("\n=== A página de resgate ===");
  const page = await fetch(`${API}/l/${SLUG}/convite/${token}`);
  const html = await page.text();
  check("a página abre", page.status === 200, `status ${page.status}`);
  check("mostra o nome de quem foi convidado", html.includes("Treinador de Teste"));
  check("mostra o email, e como texto e não campo editável",
    html.includes(NEW_EMAIL) && !html.includes(`value="${NEW_EMAIL}"`));
  check("mostra a equipa atribuída", html.includes(team.rows[0].name));
  check("pede a palavra-passe duas vezes", html.includes('id="password"') && html.includes('id="password2"'));
  check("não é indexável", html.includes("noindex"));

  console.log("\n=== Uma página com token inventado ===");
  const bogus = await fetch(`${API}/l/${SLUG}/convite/${"x".repeat(43)}`);
  check("dá 404", bogus.status === 404, `deu ${bogus.status}`);
  const bogusHtml = await bogus.text();
  check("e não revela nada", !bogusHtml.includes(NEW_EMAIL) && bogusHtml.includes("já não é válido"));

  console.log("\n=== Password fraca ===");
  const weak = await fetch(`${API}/api/convites/${token}/aceitar`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "curta" }),
  });
  check("é recusada", weak.status === 400, `deu ${weak.status}`);

  console.log("\n=== Resgatar ===");
  const accepted = await fetch(`${API}/api/convites/${token}/aceitar`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: NEW_PASSWORD, phone: "912345678" }),
  });
  const acceptedBody = await accepted.json();
  check("o resgate funciona", accepted.ok, JSON.stringify(acceptedBody).slice(0, 160));

  console.log("\n=== O que ficou criado ===");
  const membership = await db.query(
    `SELECT m.role, m.title, u.email, u.phone, u."authId"
     FROM "Membership" m JOIN "User" u ON u.id = m."userId"
     WHERE u.email = $1`,
    [NEW_EMAIL],
  );
  check("a pessoa tem membership", membership.rows.length === 1);
  check("com o papel do convite", membership.rows[0]?.role === "COACH", `veio ${membership.rows[0]?.role}`);
  check("com o cargo do convite", membership.rows[0]?.title === "ZZ Treinador adjunto", `${membership.rows[0]?.title}`);
  check("e o telemóvel que indicou", membership.rows[0]?.phone === "912345678");

  const staffRows = await db.query(
    `SELECT ts."teamId" FROM "TeamStaff" ts
     JOIN "Membership" m ON m.id = ts."membershipId"
     JOIN "User" u ON u.id = m."userId"
     WHERE u.email = $1`,
    [NEW_EMAIL],
  );
  check("ficou atribuída à equipa do convite", staffRows.rows.length === 1 && staffRows.rows[0].teamId === teamId);

  console.log("\n=== Entrar com a conta nova ===");
  const newToken = await signIn(NEW_EMAIL, NEW_PASSWORD);
  check("a pessoa consegue entrar", Boolean(newToken));

  const me = await fetch(`${API}/auth/memberships`, { headers: { Authorization: `Bearer ${newToken}` } });
  const meBody = await me.json();
  const here = (meBody.academies ?? []).find((a) => a.slug === SLUG);
  check("e pertence a esta academia", Boolean(here), JSON.stringify(meBody).slice(0, 140));
  check("como equipa técnica", here?.role === "COACH");

  console.log("\n=== O link depois de usado ===");
  const again = await fetch(`${API}/api/convites/${token}/aceitar`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: NEW_PASSWORD }),
  });
  check("não pode ser resgatado outra vez", !again.ok, `deu ${again.status}`);

  const pageAgain = await fetch(`${API}/l/${SLUG}/convite/${token}`);
  check("e a página deixa de abrir", pageAgain.status === 404, `deu ${pageAgain.status}`);

  /*
   * O caso que dá mais trabalho e é o mais comum numa academia a sério: a mãe que
   * já é encarregada de educação e passa a treinar um escalão. Não se cria conta
   * nova — usa-se a que existe, e prova-se que é ela pedindo a password actual.
   */
  console.log("\n=== Quem já tem conta ===");
  const GUARDIAN = "familia@lifeclub.pt";
  await db.query(`DELETE FROM "StaffInvite" WHERE email = $1`, [GUARDIAN]);

  const second = await fetch(`${API}/api/invites`, {
    method: "POST",
    headers: headers(director),
    body: JSON.stringify({
      name: "Sandra Bragança",
      email: GUARDIAN,
      academyRoleId: cargoId,
      teamIds: [teamId],
    }),
  });
  const secondInvite = await second.json();
  check("pode convidar-se quem já tem conta", second.ok, JSON.stringify(secondInvite).slice(0, 140));

  const secondToken = secondInvite.link?.split("/convite/")[1] ?? "";
  const secondPage = await fetch(`${API}/l/${SLUG}/convite/${secondToken}`);
  const secondHtml = await secondPage.text();
  check("a página reconhece a conta existente", secondHtml.includes("Já tens conta"));
  check("e não pede palavra-passe nova", !secondHtml.includes('id="password2"'));

  const wrong = await fetch(`${API}/api/convites/${secondToken}/aceitar`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "isto-nao-e-a-password" }),
  });
  check("com a password errada é recusado", wrong.status === 403, `deu ${wrong.status}`);
  check("e o convite continua por usar", (await fetch(`${API}/l/${SLUG}/convite/${secondToken}`)).status === 200);

  const right = await fetch(`${API}/api/convites/${secondToken}/aceitar`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "academia2026" }),
  });
  check("com a password certa é aceite", right.ok, JSON.stringify(await right.clone().json()).slice(0, 140));

  const bothRoles = await db.query(
    `SELECT m.role FROM "Membership" m JOIN "User" u ON u.id = m."userId"
     WHERE u.email = $1 ORDER BY m.role`,
    [GUARDIAN],
  );
  const roles = bothRoles.rows.map((r) => r.role);
  check("fica com os dois papéis, na mesma conta", roles.includes("GUARDIAN") && roles.includes("COACH"),
    `tem ${roles.join(", ")}`);

  console.log("\n=== Quem não pode convidar ===");
  const coach = await signIn("treinador@lifeclub.pt", "academia2026");
  const forbidden = await fetch(`${API}/api/invites`, {
    method: "POST",
    headers: headers(coach),
    body: JSON.stringify({ name: "Alguém", email: `nao-devia-${Date.now()}@exemplo.pt`, academyRoleId: cargoId }),
  });
  check("um treinador não convida ninguém", forbidden.status === 403, `deu ${forbidden.status}`);

  console.log("\n=== Escalada de privilégios ===");
  // A direção não deve poder criar um OWNER, que está acima dela.
  const escalate = await fetch(`${API}/api/invites`, {
    method: "POST",
    headers: headers(director),
    body: JSON.stringify({ name: "Dono", email: `dono-${Date.now()}@exemplo.pt`, academyRoleId: presidencia.rows[0]?.id }),
  });
  check("a direção não pode convidar um OWNER", escalate.status === 403, `deu ${escalate.status}`);

  console.log("\n=== Sem autenticação ===");
  const anon = await fetch(`${API}/api/invites`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-academy-slug": SLUG },
    body: JSON.stringify({ name: "X", email: "x@exemplo.pt", academyRoleId: cargoId }),
  });
  check("não se convida sem sessão", anon.status === 401, `deu ${anon.status}`);

  console.log("\n=== Limpeza ===");
  await db.query(`DELETE FROM "AcademyRole" WHERE "academyId" = 'acd_lifeclub' AND name LIKE 'ZZ %'`);
  const authId = membership.rows[0]?.authId;
  await db.query(
    `DELETE FROM "StaffInvite" WHERE email LIKE 'teste-fluxo-%' OR email LIKE 'dono-%' OR email LIKE 'nao-devia-%' OR email = $1`,
    [GUARDIAN],
  );
  await db.query(`DELETE FROM "User" WHERE email = $1`, [NEW_EMAIL]);
  // A Sandra volta a ser só encarregada de educação — a seed deixa-a assim.
  await db.query(
    `DELETE FROM "Membership" m USING "User" u
     WHERE m."userId" = u.id AND u.email = $1 AND m.role = 'COACH'`,
    [GUARDIAN],
  );
  if (authId) {
    await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${authId}`, {
      method: "DELETE",
      headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
    });
  }
  console.log("  feito");

  await db.end();
  console.log(`\n${passed} passaram, ${failed} falharam`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("\nErro:", error.message);
  process.exit(1);
});

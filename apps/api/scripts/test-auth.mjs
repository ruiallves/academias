#!/usr/bin/env node
/**
 * Testa o login de ponta a ponta contra o Supabase real.
 *
 * Autentica-se com password, recebe um JWT verdadeiro, e verifica o que o
 * servidor consegue fazer com ele: verificar a assinatura ES256 contra o JWKS,
 * encontrar a membership, e derivar papel e âmbito.
 *
 * Corre sem o NestJS a subir — usa as mesmas peças que o guard usa. É o que
 * permite validar a autenticação antes de haver interface de login.
 *
 * Uso: node scripts/test-auth.mjs
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRemoteJWKSet, jwtVerify } from "jose";
import pg from "pg";

const HERE = path.dirname(fileURLToPath(import.meta.url));

function env(key) {
  const line = readFileSync(path.join(HERE, "..", ".env"), "utf8")
    .split("\n")
    .find((l) => l.startsWith(`${key}=`));
  return line.slice(key.length + 1).trim().replace(/^"|"$/g, "");
}

const SUPABASE_URL = env("SUPABASE_URL").replace(/\/$/, "");
const ANON = env("SUPABASE_ANON_KEY");
const APP_DB = env("DATABASE_URL");

const PASSWORD = "academia2026";
const SLUG = "life-club";

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

/** O que a app de login faz: trocar email+password por um JWT. */
async function signIn(email) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`login falhou (${res.status}): ${(await res.text()).slice(0, 120)}`);
  return res.json();
}

const jwks = createRemoteJWKSet(new URL(`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`));

/** O que o guard faz: verificar a assinatura sem confiar no cliente. */
async function verify(token) {
  const { payload, protectedHeader } = await jwtVerify(token, jwks, {
    issuer: `${SUPABASE_URL}/auth/v1`,
    audience: "authenticated",
  });
  return { payload, alg: protectedHeader.alg };
}

async function main() {
  const db = new pg.Client({ connectionString: APP_DB, ssl: { rejectUnauthorized: false } });
  await db.connect();

  console.log("=== Sessão ===");
  const session = await signIn("direcao@lifeclub.pt");
  check("login com password devolve token", Boolean(session.access_token));

  const { payload, alg } = await verify(session.access_token);
  check("assinatura verifica contra o JWKS", Boolean(payload.sub));
  check("algoritmo é assimétrico (ES256)", alg === "ES256", `era ${alg}`);
  check("emissor e audiência conferem", payload.aud === "authenticated");

  console.log("\n=== Password errada ===");
  let rejected = false;
  try {
    await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: ANON, "Content-Type": "application/json" },
      body: JSON.stringify({ email: "direcao@lifeclub.pt", password: "errada" }),
    }).then((r) => {
      rejected = !r.ok;
    });
  } catch {
    rejected = true;
  }
  check("password errada é recusada", rejected);

  console.log("\n=== Token forjado ===");
  let forgedRejected = false;
  try {
    // Mesmo payload, assinatura inventada. Se isto passasse, qualquer pessoa
    // entrava como qualquer pessoa.
    const [h, p] = session.access_token.split(".");
    await verify(`${h}.${p}.YXNzaW5hdHVyYS1mYWxzYQ`);
  } catch {
    forgedRejected = true;
  }
  check("token com assinatura falsa é recusado", forgedRejected);

  console.log("\n=== Resolução de tenant e papel ===");
  const academy = await db.query("SELECT app.resolve_academy_by_slug($1) AS id", [SLUG]);
  check("o slug resolve para uma academia", academy.rows[0].id !== null, `devolveu ${academy.rows[0].id}`);

  for (const [email, expectedRole] of [
    ["direcao@lifeclub.pt", "DIRECTOR"],
    ["treinador@lifeclub.pt", "COACH"],
    ["clinico@lifeclub.pt", "MEDICAL"],
    ["familia@lifeclub.pt", "GUARDIAN"],
  ]) {
    const s = await signIn(email);
    const { payload: pl } = await verify(s.access_token);
    const rows = await db.query("SELECT * FROM app.resolve_memberships($1)", [pl.sub]);
    const m = rows.rows.find((r) => r.academy_id === academy.rows[0].id);
    check(`${email.padEnd(23)} → ${expectedRole}`, m?.role === expectedRole, `veio ${m?.role}`);
  }

  console.log("\n=== Âmbito ===");
  const coachSession = await signIn("treinador@lifeclub.pt");
  const { payload: coachJwt } = await verify(coachSession.access_token);
  const coachRows = await db.query("SELECT * FROM app.resolve_memberships($1)", [coachJwt.sub]);
  const coachMembership = coachRows.rows[0];

  await db.query("BEGIN");
  await db.query("SELECT set_config('app.academy_id', $1, true)", [coachMembership.academy_id]);
  const teams = await db.query(`SELECT "teamId" FROM "TeamStaff" WHERE "membershipId" = $1`, [
    coachMembership.membership_id,
  ]);
  await db.query("COMMIT");
  check("o treinador tem equipas atribuídas", teams.rows.length > 0,
    `${teams.rows.length} equipas`);

  const paiSession = await signIn("familia@lifeclub.pt");
  const { payload: paiJwt } = await verify(paiSession.access_token);
  const paiRows = await db.query("SELECT * FROM app.resolve_memberships($1)", [paiJwt.sub]);

  await db.query("BEGIN");
  await db.query("SELECT set_config('app.academy_id', $1, true)", [paiRows.rows[0].academy_id]);
  const kids = await db.query(`SELECT "athleteId" FROM "GuardianLink" WHERE "membershipId" = $1`, [
    paiRows.rows[0].membership_id,
  ]);
  await db.query("COMMIT");
  // A seed dá-lhe duas filhas de propósito: uma família com mais do que um
  // educando é o caso em que a app das famílias tem de escolher, e é onde as
  // coisas partem. Exigir exactamente um punha o teste a defender o caso fácil.
  check("o encarregado tem educandos ligados", kids.rows.length >= 1,
    `${kids.rows.length} educandos`);
  check("e o caso de vários educandos existe na seed", kids.rows.length >= 2,
    `só ${kids.rows.length}`);

  console.log("\n=== Utilizador sem membership nesta academia ===");
  const orphan = await db.query("SELECT * FROM app.resolve_memberships($1)", [
    "00000000-0000-0000-0000-000000000000",
  ]);
  check("um authId desconhecido não tem academias", orphan.rows.length === 0);

  await db.end();
  console.log(`\n${passed} passaram, ${failed} falharam`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("\nErro:", error.message);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * Semeia a plataforma: os planos que vendemos e a nossa conta de administração.
 *
 * Separado de `seed.mjs` de propósito — aquele semeia **uma academia** (um
 * cliente), este semeia **o negócio**. Correr um não implica correr o outro, e
 * misturá-los faria parecer que a academia de demonstração é dona da plataforma.
 *
 * Uso: node prisma/seed-platform.mjs [email]
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

const SUPABASE_URL = env("SUPABASE_URL").replace(/\/$/, "");
const SERVICE_KEY = env("SUPABASE_SERVICE_ROLE_KEY");
const EMAIL = process.argv[2] ?? "admin@academias.pt";
const PASSWORD = "plataforma2026";

async function ensureAuthUser(email, name) {
  const create = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD, email_confirm: true, user_metadata: { name } }),
  });
  if (create.ok) return { id: (await create.json()).id, created: true };

  const list = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=200`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  const found = (await list.json()).users.find((u) => u.email === email);
  if (!found) throw new Error(`não consegui criar nem encontrar ${email}`);
  return { id: found.id, created: false };
}

const db = new pg.Client({ connectionString: env("MIGRATE_DATABASE_URL"), ssl: { rejectUnauthorized: false } });
await db.connect();

console.log("Planos…");
// Preço base + por atleta acima do incluído. É como uma academia pensa no custo:
// cresce com o clube, e não com o número de funcionalidades.
for (const [id, name, base, perAthlete, included, trial] of [
  ["plan_arranque", "Arranque", 2900, 0, 40, 30],
  ["plan_clube", "Clube", 6900, 60, 120, 30],
  ["plan_academia", "Academia", 14900, 45, 300, 30],
]) {
  await db.query(
    `INSERT INTO "Plan" (id,name,"amountCents","perAthleteCents","includedAthletes","trialDays","isActive","updatedAt")
     VALUES ($1,$2,$3,$4,$5,$6,true,now())
     ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, "amountCents"=EXCLUDED."amountCents"`,
    [id, name, base, perAthlete, included, trial],
  );
  console.log(`  ${name.padEnd(10)} ${(base / 100).toFixed(2)} €/mês + ${(perAthlete / 100).toFixed(2)} €/atleta acima de ${included}`);
}

console.log("\nAdministração…");
const { id: authId, created } = await ensureAuthUser(EMAIL, "Rui");
await db.query(
  `INSERT INTO "PlatformAdmin" (id,"authId",email,name,role,"isActive","updatedAt")
   VALUES ($1,$2,$3,$4,'OWNER',true,now())
   ON CONFLICT ("authId") DO UPDATE SET role='OWNER', "isActive"=true`,
  [`padm_${authId.slice(0, 8)}`, authId, EMAIL, "Rui"],
);
console.log(`  ${EMAIL}  (${created ? "criada" : "já existia"})  papel OWNER`);

// A academia de demonstração é um cliente como outro qualquer: dá-lhe uma
// subscrição activa para o MRR deixar de ser zero e os ecrãs terem o que mostrar.
await db.query(
  `INSERT INTO "Subscription" (id,"academyId","planId",status,"currentPeriodEnd","updatedAt")
   VALUES ('sub_lifeclub','acd_lifeclub','plan_clube','ACTIVE',now() + interval '1 month',now())
   ON CONFLICT ("academyId") DO UPDATE SET status='ACTIVE', "planId"='plan_clube'`,
);
await db.query(`UPDATE "Academy" SET status='ACTIVE' WHERE id='acd_lifeclub'`);

const o = (await db.query("SELECT * FROM app.platform_overview()")).rows[0];
console.log(`\n  ${o.academies} academias · ${o.athletes} atletas · MRR ${(Number(o.mrr_cents) / 100).toFixed(2)} €`);
console.log(`\nEntrar no painel: ${EMAIL} / ${PASSWORD}`);

await db.end();

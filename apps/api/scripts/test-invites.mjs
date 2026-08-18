#!/usr/bin/env node
/**
 * Testa os convites de staff contra o Postgres e o Supabase reais.
 *
 * O que importa verificar aqui não é "o convite funciona" — é que **não funciona
 * quando não deve**. Um convite é um link que dá acesso a uma academia; os testes
 * que valem são os que tentam usá-lo mal:
 *
 *   - resgatar duas vezes;
 *   - resgatar depois de revogado ou expirado;
 *   - resgatar com o hash errado;
 *   - alcançar convites de outra academia com o contexto de tenant aberto.
 *
 * Corre sem o NestJS a subir, como `test-auth.mjs`: usa as mesmas funções SQL que
 * o serviço usa.
 *
 * Uso: node scripts/test-invites.mjs
 */
import { createHash, randomBytes } from "node:crypto";
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

const ADMIN_DB = env("MIGRATE_DATABASE_URL");
const ACADEMY = "acd_lifeclub";

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

const hash = (t) => createHash("sha256").update(t).digest("hex");
const token = () => randomBytes(32).toString("base64url");

/**
 * Insere um convite directamente, como o serviço faria.
 *
 * As datas vão em ISO com `Z`, e isso não é um detalhe. `expiresAt` é
 * `timestamp without time zone`: se lhe passarmos um `Date`, o node-pg serializa-o
 * em hora **local com offset** e o Postgres descarta o offset ao guardar — em
 * Lisboa no verão, um convite expirado há um minuto ficava a valer mais 59. O
 * Prisma envia sempre UTC, por isso é UTC que este teste tem de imitar.
 */
async function insert(db, { tokenHash, email, role = "COACH", teamIds = [], expiresAt, extra = {} }) {
  const utc = (d) => (d instanceof Date ? d.toISOString() : d);

  const id = `inv_${randomBytes(6).toString("hex")}`;
  await db.query(
    `INSERT INTO "StaffInvite"
       (id,"academyId","tokenHash",email,name,role,title,department,"teamIds","expiresAt","acceptedAt","revokedAt","updatedAt")
     VALUES ($1,$2,$3,$4,$5,$6::"Role",$7,$8::"StaffDepartment",$9,$10,$11,$12,now())`,
    [
      id,
      extra.academyId ?? ACADEMY,
      tokenHash,
      email,
      extra.name ?? "Convidado de Teste",
      role,
      extra.title ?? "Treinador adjunto",
      extra.department ?? "TECHNICAL",
      teamIds,
      utc(expiresAt ?? new Date(Date.now() + 7 * 864e5)),
      utc(extra.acceptedAt ?? null),
      utc(extra.revokedAt ?? null),
    ],
  );
  return id;
}

/** O que `InvitesService.academyOf` faz: resolver a academia a partir do token. */
async function resolve(db, rawToken) {
  const r = await db.query("SELECT app.resolve_invite($1) AS academy", [hash(rawToken)]);
  return r.rows[0].academy;
}

async function main() {
  const db = new pg.Client({ connectionString: ADMIN_DB, ssl: { rejectUnauthorized: false } });
  await db.connect();

  // Limpa convites de corridas anteriores — o índice parcial de unicidade não
  // perdoa, e um teste que só passa à primeira não é um teste.
  await db.query(`DELETE FROM "StaffInvite" WHERE email LIKE 'teste-convite%'`);

  console.log("=== Um convite válido ===");
  const good = token();
  await insert(db, { tokenHash: hash(good), email: "teste-convite-1@exemplo.pt" });
  check("resolve para a academia certa", (await resolve(db, good)) === ACADEMY);

  console.log("\n=== O token não está guardado ===");
  const stored = await db.query(`SELECT "tokenHash" FROM "StaffInvite" WHERE email = $1`, [
    "teste-convite-1@exemplo.pt",
  ]);
  check("na base só existe o hash", stored.rows[0].tokenHash !== good);
  check("e é mesmo o SHA-256 do token", stored.rows[0].tokenHash === hash(good));

  console.log("\n=== Tokens que não devem abrir nada ===");
  check("token inventado não resolve", (await resolve(db, token())) === null);
  check("token quase certo não resolve", (await resolve(db, good.slice(0, -1) + "x")) === null);

  console.log("\n=== Convite já usado ===");
  const used = token();
  await insert(db, {
    tokenHash: hash(used),
    email: "teste-convite-2@exemplo.pt",
    extra: { acceptedAt: new Date() },
  });
  check("um convite aceite não resolve", (await resolve(db, used)) === null);

  console.log("\n=== Convite revogado ===");
  const revoked = token();
  await insert(db, {
    tokenHash: hash(revoked),
    email: "teste-convite-3@exemplo.pt",
    extra: { revokedAt: new Date() },
  });
  check("um convite revogado não resolve", (await resolve(db, revoked)) === null);

  console.log("\n=== Convite expirado ===");
  const expired = token();
  await insert(db, {
    tokenHash: hash(expired),
    email: "teste-convite-4@exemplo.pt",
    expiresAt: new Date(Date.now() - 60_000),
  });
  check("um convite fora de validade não resolve", (await resolve(db, expired)) === null);

  console.log("\n=== Uso único, com dois a chegar ao mesmo tempo ===");
  const race = token();
  const raceId = await insert(db, { tokenHash: hash(race), email: "teste-convite-5@exemplo.pt" });
  // É assim que o serviço reclama o convite: um UPDATE condicional. O segundo a
  // chegar encontra `count = 0` porque a condição já não bate certo.
  const first = await db.query(
    `UPDATE "StaffInvite" SET "acceptedAt" = now()
     WHERE id = $1 AND "acceptedAt" IS NULL AND "revokedAt" IS NULL`,
    [raceId],
  );
  const second = await db.query(
    `UPDATE "StaffInvite" SET "acceptedAt" = now()
     WHERE id = $1 AND "acceptedAt" IS NULL AND "revokedAt" IS NULL`,
    [raceId],
  );
  check("o primeiro resgate ganha", first.rowCount === 1);
  check("o segundo não apanha nada", second.rowCount === 0, `apanhou ${second.rowCount}`);
  check("e o link deixa de resolver", (await resolve(db, race)) === null);

  console.log("\n=== Dois convites vivos para a mesma pessoa e papel ===");
  const dup1 = token();
  await insert(db, { tokenHash: hash(dup1), email: "teste-convite-6@exemplo.pt" });
  let rejected = false;
  try {
    await insert(db, { tokenHash: hash(token()), email: "teste-convite-6@exemplo.pt" });
  } catch {
    rejected = true;
  }
  check("o segundo é recusado pelo índice parcial", rejected);

  // Mas depois de revogar o primeiro, deve poder emitir-se outro.
  await db.query(`UPDATE "StaffInvite" SET "revokedAt" = now() WHERE email = $1`, [
    "teste-convite-6@exemplo.pt",
  ]);
  let reissued = true;
  try {
    await insert(db, { tokenHash: hash(token()), email: "teste-convite-6@exemplo.pt" });
  } catch (error) {
    reissued = false;
    console.log(`        (${error.message})`);
  }
  check("depois de revogar, pode emitir-se outro", reissued);

  console.log("\n=== Isolamento entre academias ===");
  // Uma segunda academia, com um convite seu.
  await db.query(
    `INSERT INTO "Academy" (id, slug, name, "shortName", "updatedAt")
     VALUES ('acd_outro','outro-clube','Outro Clube','Outro',now())
     ON CONFLICT (id) DO NOTHING`,
  );
  const otherToken = token();
  await insert(db, {
    tokenHash: hash(otherToken),
    email: "teste-convite-outro@exemplo.pt",
    extra: { academyId: "acd_outro" },
  });

  check("o convite da outra academia resolve para ela", (await resolve(db, otherToken)) === "acd_outro");

  /*
   * Com o contexto do Life Club aberto, a RLS não deve deixar ver o convite alheio.
   *
   * `SET LOCAL ROLE academia_app` é obrigatório e é o ponto todo: esta ligação é a
   * de migração, que entra como `postgres` — superutilizador, e um superutilizador
   * **ignora RLS**. Sem trocar de papel, este teste passaria a dizer que não há
   * isolamento nenhum quando o que não há é RLS a correr. É o mesmo cuidado que
   * `test-rls.mjs` tem, e está explicado no cabeçalho da migração de RLS.
   */
  await db.query("BEGIN");
  await db.query("SET LOCAL ROLE academia_app");
  await db.query("SELECT set_config('app.academy_id', $1, true)", [ACADEMY]);
  const visible = await db.query(`SELECT id FROM "StaffInvite" WHERE "academyId" = 'acd_outro'`);
  const mine = await db.query(`SELECT id FROM "StaffInvite" WHERE "academyId" = $1`, [ACADEMY]);
  await db.query("COMMIT");

  check("com o tenant errado, o convite alheio não aparece", visible.rows.length === 0,
    `apareceram ${visible.rows.length}`);
  check("mas os próprios convites continuam à vista", mine.rows.length > 0,
    "não apareceu nenhum — a política pode estar a bloquear tudo");

  console.log("\n=== Limpeza ===");
  await db.query(`DELETE FROM "StaffInvite" WHERE email LIKE 'teste-convite%'`);
  await db.query(`DELETE FROM "Academy" WHERE id = 'acd_outro'`);
  console.log("  feito");

  await db.end();
  console.log(`\n${passed} passaram, ${failed} falharam`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("\nErro:", error.message);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * Verifica o isolamento entre academias contra um Postgres a sério.
 *
 * Usa PGlite (Postgres compilado para WASM) porque não é preciso Docker nem um
 * servidor — mas é Postgres verdadeiro, com RLS verdadeira. Testar isto importa
 * mais do que quase tudo o resto: uma política de isolamento escrita e nunca
 * corrida é uma política que não existe.
 *
 * O teste é adversarial de propósito. Não confirma só que a academia A vê as suas
 * linhas; tenta **activamente** ler e escrever as da academia B.
 *
 * Uso: node scripts/test-rls.mjs
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = path.join(HERE, "..", "prisma", "migrations");

const db = new PGlite();

let passed = 0;
let failed = 0;

function check(label, ok, detail = "") {
  if (ok) {
    passed++;
    console.log(`  OK   ${label}`);
  } else {
    failed++;
    console.log(`  FALHA ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

/** Corre como a aplicação: papel sem BYPASSRLS e tenant fixado na transação. */
async function asAcademy(academyId, sql, params = []) {
  await db.exec("BEGIN");
  try {
    await db.exec("SET LOCAL ROLE academia_app");
    // set_config com `true` = LOCAL: morre no fim da transação, tal como no servidor.
    await db.query("SELECT set_config('app.academy_id', $1, true)", [academyId]);
    const result = await db.query(sql, params);
    await db.exec("COMMIT");
    return result;
  } catch (error) {
    await db.exec("ROLLBACK");
    throw error;
  }
}

async function main() {
  console.log("A aplicar migrações…");
  for (const dir of readdirSync(MIGRATIONS).sort()) {
    const file = path.join(MIGRATIONS, dir, "migration.sql");
    await db.exec(readFileSync(file, "utf8"));
    console.log(`  ${dir}`);
  }

  // Semente mínima: duas academias, cada uma com um atleta e um boletim clínico.
  // Semeado como dono (sem SET ROLE), que é o que um script de migração faria.
  console.log("\nA semear duas academias…");
  await db.exec(`
    INSERT INTO "Academy" (id, slug, name, "shortName", "updatedAt")
    VALUES ('acd_a', 'alfa', 'Academia Alfa', 'Alfa', now()),
           ('acd_b', 'beta', 'Academia Beta', 'Beta', now());

    INSERT INTO "Athlete" (id, "academyId", name, birthdate, "updatedAt")
    VALUES ('ath_a', 'acd_a', 'Atleta da Alfa', '2014-05-01', now()),
           ('ath_b', 'acd_b', 'Atleta da Beta', '2014-06-01', now());

    INSERT INTO "ClinicalEntry" (id, "academyId", "athleteId", kind, date, title, impact, "updatedAt")
    VALUES ('cl_a', 'acd_a', 'ath_a', 'INJURY', '2026-08-01', 'Entorse — Alfa', 'OUT', now()),
           ('cl_b', 'acd_b', 'ath_b', 'INJURY', '2026-08-01', 'Entorse — Beta', 'OUT', now());
  `);

  console.log("\n=== Leitura ===");
  const aAthletes = await asAcademy("acd_a", 'SELECT id, name FROM "Athlete"');
  check("Alfa vê 1 atleta (o seu)", aAthletes.rows.length === 1 && aAthletes.rows[0].id === "ath_a",
    `viu ${aAthletes.rows.length}: ${aAthletes.rows.map(r => r.id).join(",")}`);

  const bAthletes = await asAcademy("acd_b", 'SELECT id FROM "Athlete"');
  check("Beta vê 1 atleta (o seu)", bAthletes.rows.length === 1 && bAthletes.rows[0].id === "ath_b");

  // Ataque directo: pedir explicitamente a linha da outra academia.
  const cross = await asAcademy("acd_a", `SELECT id FROM "Athlete" WHERE id = 'ath_b'`);
  check("Alfa NÃO consegue ler o atleta da Beta pelo id", cross.rows.length === 0,
    `devolveu ${cross.rows.length} linhas`);

  const crossClinical = await asAcademy("acd_a", `SELECT id, title FROM "ClinicalEntry" WHERE id = 'cl_b'`);
  check("Alfa NÃO consegue ler o boletim clínico da Beta", crossClinical.rows.length === 0);

  const ownClinical = await asAcademy("acd_a", 'SELECT id FROM "ClinicalEntry"');
  check("Alfa vê o seu próprio boletim", ownClinical.rows.length === 1 && ownClinical.rows[0].id === "cl_a");

  console.log("\n=== Escrita ===");
  // UPDATE cruzado: não deve rebentar, deve simplesmente não afectar nada.
  const upd = await asAcademy("acd_a", `UPDATE "Athlete" SET name = 'invadido' WHERE id = 'ath_b'`);
  check("UPDATE cruzado não afecta nenhuma linha", (upd.affectedRows ?? 0) === 0,
    `afectou ${upd.affectedRows}`);

  const stillOk = await asAcademy("acd_b", `SELECT name FROM "Athlete" WHERE id = 'ath_b'`);
  check("O atleta da Beta ficou intacto", stillOk.rows[0]?.name === "Atleta da Beta",
    `nome: ${stillOk.rows[0]?.name}`);

  const del = await asAcademy("acd_a", `DELETE FROM "Athlete" WHERE id = 'ath_b'`);
  check("DELETE cruzado não apaga nada", (del.affectedRows ?? 0) === 0);

  // INSERT com academyId de outra: o WITH CHECK tem de o recusar.
  let insertBlocked = false;
  try {
    await asAcademy("acd_a", `
      INSERT INTO "Athlete" (id, "academyId", name, birthdate, "updatedAt")
      VALUES ('ath_x', 'acd_b', 'Infiltrado', '2014-01-01', now())
    `);
  } catch (error) {
    insertBlocked = /row-level security|violates/i.test(error.message);
  }
  check("INSERT a fingir ser de outra academia é recusado", insertBlocked);

  console.log("\n=== Sem contexto (falha fechado) ===");
  await db.exec("BEGIN");
  await db.exec("SET LOCAL ROLE academia_app");
  const noCtx = await db.query('SELECT id FROM "Athlete"');
  await db.exec("COMMIT");
  check("Sem app.academy_id não se vê nada", noCtx.rows.length === 0,
    `viu ${noCtx.rows.length} linhas`);

  console.log("\n=== Tabelas-filhas (herdam o tenant do pai) ===");
  await db.exec(`
    INSERT INTO "Season" (id, "academyId", label, "startsOn", "endsOn")
    VALUES ('se_a','acd_a','2026/27','2026-09-01','2027-06-30'),
           ('se_b','acd_b','2026/27','2026-09-01','2027-06-30');
    INSERT INTO "Sport" (id, "academyId", name) VALUES ('sp_a','acd_a','Futebol'), ('sp_b','acd_b','Futebol');
    INSERT INTO "Team" (id,"academyId","sportId","seasonId",name,"maxAge","updatedAt")
    VALUES ('t_a','acd_a','sp_a','se_a','Sub-11',11, now()),
           ('t_b','acd_b','sp_b','se_b','Sub-11',11, now());
    INSERT INTO "TeamMembership" (id,"teamId","athleteId") VALUES ('tm_a','t_a','ath_a'), ('tm_b','t_b','ath_b');
  `);

  const tm = await asAcademy("acd_a", 'SELECT id FROM "TeamMembership"');
  check("Alfa vê 1 inscrição em equipa (a sua)", tm.rows.length === 1 && tm.rows[0].id === "tm_a",
    `viu ${tm.rows.map(r => r.id).join(",")}`);

  const tmCross = await asAcademy("acd_a", `SELECT id FROM "TeamMembership" WHERE id = 'tm_b'`);
  check("Alfa NÃO vê a inscrição da Beta", tmCross.rows.length === 0);

  console.log("\n=== Escotilha do webhook ===");
  await db.exec(`
    INSERT INTO "SubscriptionPlan" (id,"academyId",name,"amountCents") VALUES ('pl_b','acd_b','Mensal',4000);
    INSERT INTO "Charge" (id,"academyId","athleteId",period,"amountCents","dueDate","updatedAt")
    VALUES ('ch_b','acd_b','ath_b','2026-08',4000,'2026-08-08',now());
    INSERT INTO "Payment" (id,"chargeId","amountCents",method,provider,"providerRef","updatedAt")
    VALUES ('pay_b','ch_b',4000,'MBWAY','eupago','REF-999',now());
  `);

  // Sem contexto, como um webhook chega.
  await db.exec("BEGIN");
  await db.exec("SET LOCAL ROLE academia_app");
  const resolved = await db.query("SELECT app.resolve_payment_academy('eupago','REF-999') AS academy");
  const blindPayment = await db.query(`SELECT id FROM "Payment" WHERE "providerRef" = 'REF-999'`);
  await db.exec("COMMIT");

  check("O webhook descobre o tenant a partir da referência", resolved.rows[0].academy === "acd_b",
    `devolveu ${resolved.rows[0].academy}`);
  check("Mas NÃO consegue ler o pagamento sem contexto", blindPayment.rows.length === 0,
    `leu ${blindPayment.rows.length} linhas`);

  const withCtx = await asAcademy("acd_b", `SELECT id FROM "Payment" WHERE "providerRef" = 'REF-999'`);
  check("Com o tenant resolvido, já lê o pagamento", withCtx.rows.length === 1);

  console.log("\n=== Papel da aplicação ===");
  const role = await db.query(`SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = 'academia_app'`);
  check("academia_app não ignora RLS", role.rows[0].rolbypassrls === false);
  check("academia_app não é superutilizador", role.rows[0].rolsuper === false);

  console.log(`\n${passed} passaram, ${failed} falharam`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("\nErro:", error.message);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * Prova que o isolamento entre academias está activo na base de dados a sério.
 *
 * `test-rls.mjs` corre contra um Postgres em memória e verifica as políticas.
 * Este corre contra o **Supabase**, com a ligação que a aplicação usa de facto —
 * e é isso que testa a única coisa que o teste local não pode testar: se o
 * utilizador da aplicação ignora RLS ou não.
 *
 * É a diferença entre "as políticas estão certas" e "as políticas aplicam-se".
 * Um `DATABASE_URL` a ligar como `postgres` passa no primeiro teste e falha
 * neste, silenciosamente, em produção.
 *
 * Semeia duas academias descartáveis, tenta atravessá-las, e limpa tudo no fim.
 *
 * Uso: node scripts/verify-supabase.mjs
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const HERE = path.dirname(fileURLToPath(import.meta.url));

function envValue(key) {
  const line = readFileSync(path.join(HERE, "..", ".env"), "utf8")
    .split("\n")
    .find((l) => l.startsWith(`${key}=`));
  if (!line) throw new Error(`${key} não está em .env`);
  return line.slice(key.length + 1).trim().replace(/^"|"$/g, "");
}

const APP_URL = envValue("DATABASE_URL");
const ADMIN_URL = envValue("MIGRATE_DATABASE_URL");

const A = "zz_test_alfa";
const B = "zz_test_beta";

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

function connect(url) {
  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  return client.connect().then(() => client);
}

/** Como a aplicação corre: contexto de tenant fixado dentro da transação. */
async function asAcademy(app, academyId, sql, params = []) {
  await app.query("BEGIN");
  try {
    await app.query("SELECT set_config('app.academy_id', $1, true)", [academyId]);
    const result = await app.query(sql, params);
    await app.query("COMMIT");
    return result;
  } catch (error) {
    await app.query("ROLLBACK");
    throw error;
  }
}

async function main() {
  const admin = await connect(ADMIN_URL);
  const app = await connect(APP_URL);

  const who = await app.query("SELECT current_user");
  const role = await admin.query(
    "SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = current_setting('x', true) OR rolname = $1",
    [who.rows[0].current_user],
  );

  console.log(`ligação da aplicação: ${who.rows[0].current_user}`);
  check(
    "a aplicação NÃO liga como superutilizador",
    who.rows[0].current_user !== "postgres",
    "com `postgres` a RLS é ignorada e tudo abaixo passaria por acidente",
  );
  check("o papel da aplicação não ignora RLS", role.rows[0]?.rolbypassrls === false);

  try {
    console.log("\na semear duas academias de teste…");
    await admin.query(
      `INSERT INTO "Academy" (id, slug, name, "shortName", "updatedAt")
       VALUES ($1,$1,'Alfa (teste)','Alfa',now()), ($2,$2,'Beta (teste)','Beta',now())`,
      [A, B],
    );
    await admin.query(
      `INSERT INTO "Athlete" (id,"academyId",name,birthdate,"updatedAt")
       VALUES ('zz_ath_a',$1,'Atleta Alfa','2014-05-01',now()),
              ('zz_ath_b',$2,'Atleta Beta','2014-06-01',now())`,
      [A, B],
    );
    await admin.query(
      `INSERT INTO "ClinicalEntry" (id,"academyId","athleteId",kind,date,title,impact,"updatedAt")
       VALUES ('zz_cl_a',$1,'zz_ath_a','INJURY','2026-08-01','Diagnóstico Alfa','OUT',now()),
              ('zz_cl_b',$2,'zz_ath_b','INJURY','2026-08-01','Diagnóstico Beta','OUT',now())`,
      [A, B],
    );

    console.log("\n=== leitura ===");
    const own = await asAcademy(app, A, 'SELECT id FROM "Athlete" WHERE id LIKE $1', ["zz_%"]);
    check("Alfa vê apenas o seu atleta", own.rows.length === 1 && own.rows[0].id === "zz_ath_a",
      `viu ${own.rows.map((r) => r.id).join(",") || "nada"}`);

    const cross = await asAcademy(app, A, `SELECT id FROM "Athlete" WHERE id = 'zz_ath_b'`);
    check("Alfa NÃO lê o atleta da Beta pelo id", cross.rows.length === 0);

    const clinical = await asAcademy(app, A, `SELECT title FROM "ClinicalEntry" WHERE id = 'zz_cl_b'`);
    check("Alfa NÃO lê o boletim clínico da Beta", clinical.rows.length === 0);

    console.log("\n=== escrita ===");
    const upd = await asAcademy(app, A, `UPDATE "Athlete" SET name='invadido' WHERE id='zz_ath_b'`);
    check("UPDATE cruzado não afecta nada", upd.rowCount === 0, `afectou ${upd.rowCount}`);

    const del = await asAcademy(app, A, `DELETE FROM "Athlete" WHERE id='zz_ath_b'`);
    check("DELETE cruzado não apaga nada", del.rowCount === 0);

    let blocked = false;
    try {
      await asAcademy(app, A,
        `INSERT INTO "Athlete" (id,"academyId",name,birthdate,"updatedAt")
         VALUES ('zz_ath_x',$1,'Infiltrado','2014-01-01',now())`, [B]);
    } catch (error) {
      blocked = /row-level security|violates/i.test(error.message);
    }
    check("INSERT a fingir ser de outra academia é recusado", blocked);

    console.log("\n=== sem contexto ===");
    const blind = await app.query('SELECT id FROM "Athlete" WHERE id LIKE $1', ["zz_%"]);
    check("sem app.academy_id não se vê nada", blind.rows.length === 0,
      `viu ${blind.rows.length} linhas`);
  } finally {
    console.log("\na limpar dados de teste…");
    await admin.query(`DELETE FROM "Academy" WHERE id IN ($1,$2)`, [A, B]);
    const left = await admin.query(`SELECT count(*)::int n FROM "Athlete" WHERE id LIKE 'zz_%'`);
    console.log(`  atletas de teste restantes: ${left.rows[0].n}`);
    await admin.end();
    await app.end();
  }

  console.log(`\n${passed} passaram, ${failed} falharam`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("\nErro:", error.message);
  process.exit(1);
});

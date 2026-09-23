#!/usr/bin/env node
/**
 * Mudar o alcance de um departamento: até onde é que chega.
 *
 * Corre contra Postgres a sério (PGlite, WASM), sem servidor e sem tocar em base
 * nenhuma que exista. Aplica as migrações todas e exercita os mesmos comandos
 * que `DepartmentsService.update` faz.
 *
 * ## O que está aqui a ser fixado
 *
 * O ecrã de editar um departamento faz três promessas quando se muda o alcance,
 * e as três são sobre a **cadeia de cópias** que este produto usa em vez de
 * seguir referências:
 *
 *   Department.baseRole  →  AcademyRole.baseRole  →  Membership.role
 *
 * Cada seta é uma cópia feita no momento da criação (ou da atribuição), e é por
 * isso que mudar a origem não mexe em ninguém à distância. As promessas:
 *
 *  1. sem "aplicar aos cargos", só o departamento muda;
 *  2. com "aplicar aos cargos", os cargos mudam — e o cargo de sistema não;
 *  3. quem já tem o cargo mantém o alcance que tem, nos dois casos.
 *
 * Se algum dia a membership passar a seguir o cargo em vez de o copiar, é a
 * terceira que cai aqui — e o texto do ecrã passa a mentir. É esse o aviso que
 * este teste existe para dar.
 *
 * Uso: node scripts/test-alcance-do-departamento.mjs
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = path.join(HERE, "..", "prisma", "migrations");

const sanitize = (sql) =>
  sql
    .replace(/CREATE EXTENSION[^;]*btree_gist[^;]*;/gi, "-- [btree_gist ignorado no PGlite]")
    .replace(
      /ALTER TABLE\s+"TrainingCycle"\s+ADD CONSTRAINT\s+"[^"]*_sem_sobreposicao"[\s\S]*?;/gi,
      "-- [EXCLUDE ignorado]",
    );

const db = new PGlite();
let passed = 0;
let failed = 0;
const check = (label, ok, detail = "") => {
  if (ok) {
    passed++;
    console.log(`  ok    ${label}`);
  } else {
    failed++;
    console.log(`  FALHA ${label}${detail ? ` — ${detail}` : ""}`);
  }
};

async function migrar() {
  for (const dir of readdirSync(MIGRATIONS).sort()) {
    let sql;
    try {
      sql = readFileSync(path.join(MIGRATIONS, dir, "migration.sql"), "utf8");
    } catch {
      continue;
    }
    await db.exec(sanitize(sql));
  }
}

const uma = async (sql, params = []) => (await db.query(sql, params)).rows[0];

async function main() {
  await migrar();

  /* ---------------------------------------------------------------------- */
  /* Um departamento fechado, com dois cargos e uma pessoa                    */
  /* ---------------------------------------------------------------------- */

  await db.query(
    `INSERT INTO "Academy" (id, slug, name, "shortName", "updatedAt")
     VALUES ('ac1', 'clube-teste', 'Clube de Teste', 'Teste', now())`,
  );
  await db.query(
    `INSERT INTO "Department" (id, "academyId", key, name, "baseRole", "updatedAt")
     VALUES ('dep1', 'ac1', 'tecnico', 'Equipa Técnica', 'COACH', now())`,
  );
  await db.query(
    `INSERT INTO "AcademyRole" (id, "academyId", key, name, "baseRole", "departmentId", rank, "isSystem", "updatedAt")
     VALUES ('r1', 'ac1', 'treinador', 'Treinador', 'COACH', 'dep1', 40, false, now()),
            ('r2', 'ac1', 'adjunto', 'Adjunto', 'COACH', 'dep1', 30, false, now()),
            ('r3', 'ac1', 'presidente', 'Presidente', 'OWNER', 'dep1', 100, true, now())`,
  );
  await db.query(
    `INSERT INTO "User" (id, "authId", email, name, "updatedAt")
     VALUES ('u1', 'auth-u1', 'treinador@exemplo.pt', 'Treinador Teste', now())`,
  );
  /* A pessoa copiou o alcance do cargo quando o recebeu. Ver `assignRole`. */
  await db.query(
    `INSERT INTO "Membership" (id, "academyId", "userId", role, "customRoleId", "updatedAt")
     VALUES ('mem1', 'ac1', 'u1', 'COACH', 'r1', now())`,
  );

  /* ---------------------------------------------------------------------- */
  /* 1. Mudar o alcance sem levar aos cargos                                  */
  /* ---------------------------------------------------------------------- */

  await db.query(`UPDATE "Department" SET "baseRole" = 'COORDINATOR', "updatedAt" = now() WHERE id = 'dep1'`);

  check(
    "o departamento ficou com o alcance novo",
    (await uma(`SELECT "baseRole" FROM "Department" WHERE id = 'dep1'`))?.baseRole === "COORDINATOR",
  );
  check(
    "os cargos ficaram como estavam",
    (await uma(`SELECT count(*)::int AS n FROM "AcademyRole" WHERE "departmentId" = 'dep1' AND "baseRole" = 'COACH'`))
      ?.n === 2,
  );
  check(
    "a pessoa ficou como estava",
    (await uma(`SELECT role FROM "Membership" WHERE id = 'mem1'`))?.role === "COACH",
  );

  /* ---------------------------------------------------------------------- */
  /* 2. Agora levando aos cargos                                             */
  /* ---------------------------------------------------------------------- */

  const { count } = await uma(
    `WITH mexidos AS (
       UPDATE "AcademyRole" SET "baseRole" = 'COORDINATOR', "updatedAt" = now()
        WHERE "departmentId" = 'dep1' AND "archivedAt" IS NULL AND "isSystem" = false
        RETURNING 1
     ) SELECT count(*)::int AS count FROM mexidos`,
  );
  check(`mexeu nos 2 cargos do departamento (mexeu em ${count})`, count === 2);

  check(
    "o cargo de sistema não foi tocado",
    (await uma(`SELECT "baseRole" FROM "AcademyRole" WHERE id = 'r3'`))?.baseRole === "OWNER",
  );

  /*
   * A promessa que mais interessa, e a razão de ser deste ficheiro: a pessoa
   * que já tem o cargo **continua com o alcance que tinha**. É o que o ecrã diz
   * com estas palavras, e é o que a cadeia de cópias garante.
   */
  check(
    "quem já tem o cargo mantém o alcance até lho atribuírem outra vez",
    (await uma(`SELECT role FROM "Membership" WHERE id = 'mem1'`))?.role === "COACH",
  );

  /* E ao atribuir outra vez, aí sim: `assignRole` copia o do cargo. */
  const cargo = await uma(`SELECT "baseRole" FROM "AcademyRole" WHERE id = 'r1'`);
  await db.query(`UPDATE "Membership" SET role = $1, "customRoleId" = 'r1', "updatedAt" = now() WHERE id = 'mem1'`, [
    cargo.baseRole,
  ]);
  check(
    "reatribuir o cargo passa-lhe o alcance novo",
    (await uma(`SELECT role FROM "Membership" WHERE id = 'mem1'`))?.role === "COORDINATOR",
  );

  console.log(`\n${passed} certas, ${failed} falhas.`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

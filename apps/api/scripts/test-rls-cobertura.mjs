#!/usr/bin/env node
/**
 * Cobertura de isolamento — a rede que apanha a tabela nova que se esqueceu da RLS.
 *
 * Corre contra Postgres a sério (PGlite, WASM) — sem Docker, sem servidor, sem
 * rede, sem tocar em base nenhuma de produção. Aplica **todas** as migrações a
 * uma base descartável e pergunta ao catálogo do Postgres, não ao código:
 *
 *   1. Toda a tabela com coluna `academyId` tem RLS ligada, `FORCE`, e uma
 *      política — **ou** tem os privilégios de `academia_app` retirados (o padrão
 *      das tabelas de plataforma: `Contact`, `Subscription`, `SupportSession`).
 *      Qualquer tabela de tenant sem uma das duas redes é um vazamento entre
 *      academias à espera de acontecer.
 *   2. O histórico é mesmo só-escrita: `academia_app` não tem UPDATE nem DELETE
 *      em `ProfileChange` nem em `LegalAcceptance`, e em `AuditLog` só tem INSERT
 *      (nem lê). Um `GRANT ... ON ALL TABLES` ou um default privilege do Supabase
 *      que volte a dar arwd parte esta garantia — e é aqui que se vê.
 *   3. Prova adversarial: como `academia_app` com o tenant A fixado, não se lê
 *      nem se escreve nada do tenant B, não se edita o histórico, e a leitura de
 *      uma tabela de plataforma é recusada pelo Postgres.
 *
 * `btree_gist` (uma restrição anti-sobreposição de ciclos de treino) não existe
 * no PGlite; é irrelevante para isolamento e é neutralizada ao aplicar a migração.
 *
 * Uso: node scripts/test-rls-cobertura.mjs
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = path.join(HERE, "..", "prisma", "migrations");

/** Neutraliza o que o PGlite não corre e que nada tem a ver com isolamento. */
const sanitize = (sql) =>
  sql
    .replace(/CREATE EXTENSION[^;]*btree_gist[^;]*;/gi, "-- [btree_gist ignorado no PGlite]")
    .replace(/ALTER TABLE\s+"TrainingCycle"\s+ADD CONSTRAINT\s+"[^"]*_sem_sobreposicao"[\s\S]*?;/gi, "-- [EXCLUDE ignorado]");

/*
 * Uma tabela com `academyId` está segura por uma de duas vias, e o teste aceita
 * as duas:
 *
 *  - **RLS** com `FORCE` e política, que é o caso de tudo o que é da academia;
 *  - **sem privilégio nenhum** para `academia_app`, que é como as tabelas de
 *    plataforma (`Contact`, `Subscription`, `SupportSession`,
 *    `PlatformTransaction`) se protegem: vivem noutra fronteira, com o
 *    `PlatformGuard` e uma ligação à parte, e a ligação da academia nem lhes
 *    toca.
 *
 * A verificação é da **propriedade** e não de uma lista de nomes. A lista já
 * ficou desactualizada uma vez — uma tabela de plataforma nova (as contas do
 * painel) fazia o teste falhar sem nada estar errado —, e uma rede que grita
 * quando está tudo bem é uma rede que se aprende a ignorar.
 */

const db = new PGlite();
let passed = 0;
let failed = 0;
const check = (label, ok, detail = "") => {
  if (ok) {
    passed++;
    console.log(`  OK   ${label}`);
  } else {
    failed++;
    console.log(`  FALHA ${label}${detail ? ` — ${detail}` : ""}`);
  }
};

async function asAcademy(academyId, sql, params = []) {
  await db.exec("BEGIN");
  try {
    await db.exec("SET LOCAL ROLE academia_app");
    await db.query("SELECT set_config('app.academy_id', $1, true)", [academyId]);
    const r = await db.query(sql, params);
    await db.exec("COMMIT");
    return { rows: r.rows };
  } catch (e) {
    await db.exec("ROLLBACK");
    return { error: e.message };
  }
}

async function main() {
  console.log("A aplicar migrações a uma base descartável (PGlite)…");
  for (const dir of readdirSync(MIGRATIONS).sort()) {
    let sql;
    try {
      sql = readFileSync(path.join(MIGRATIONS, dir, "migration.sql"), "utf8");
    } catch {
      continue;
    }
    try {
      await db.exec(sanitize(sql));
    } catch (e) {
      console.error(`!! migração ${dir}: ${e.message}`);
      throw e;
    }
  }

  /* ---------------------------------------------------------------- 1 e 2 */
  const tenant = (
    await db.query(`
      SELECT c.relname AS t
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'academyId' AND a.attnum > 0 AND NOT a.attisdropped
      WHERE n.nspname = 'public' AND c.relkind = 'r'
      ORDER BY c.relname`)
  ).rows.map((r) => r.t);

  const rls = new Map(
    (
      await db.query(
        `SELECT c.relname t, c.relrowsecurity e, c.relforcerowsecurity f
         FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
         WHERE n.nspname='public' AND c.relkind='r'`,
      )
    ).rows.map((r) => [r.t, r]),
  );
  const pols = new Map(
    (await db.query(`SELECT tablename t, count(*)::int n FROM pg_policies WHERE schemaname='public' GROUP BY tablename`)).rows.map(
      (r) => [r.t, r.n],
    ),
  );
  const canApp = async (t, priv) =>
    (await db.query(`SELECT has_table_privilege('academia_app', '"public"."${t}"', $1) AS ok`, [priv])).rows[0].ok;

  console.log("\n=== 1. Toda a tabela de tenant tem RLS+FORCE+política, ou não é alcançável por academia_app ===");
  for (const t of tenant) {
    const r = rls.get(t) || {};
    const temRls = Boolean(r.e && r.f && (pols.get(t) || 0) > 0);
    if (temRls) {
      check(`${t}: RLS + FORCE + política`, true);
      continue;
    }
    /*
     * Sem RLS só passa quem a ligação da academia não consegue tocar de todo.
     * Um SELECT ou um INSERT que reste é uma tabela de tenant a descoberto.
     */
    const podeLer = await canApp(t, "SELECT");
    const podeEscrever =
      (await canApp(t, "INSERT")) || (await canApp(t, "UPDATE")) || (await canApp(t, "DELETE"));
    check(
      `${t}: sem RLS, mas inalcançável por academia_app (tabela de plataforma)`,
      !podeLer && !podeEscrever,
      `enabled=${!!r.e} forced=${!!r.f} políticas=${pols.get(t) || 0} SELECT=${podeLer} escrita=${podeEscrever}`,
    );
  }

  console.log("\n=== 2. O histórico é só-escrita (append-only) ===");
  check("ProfileChange: sem UPDATE para academia_app", !(await canApp("ProfileChange", "UPDATE")));
  check("ProfileChange: sem DELETE para academia_app", !(await canApp("ProfileChange", "DELETE")));
  check("LegalAcceptance: sem UPDATE para academia_app", !(await canApp("LegalAcceptance", "UPDATE")));
  check("LegalAcceptance: sem DELETE para academia_app", !(await canApp("LegalAcceptance", "DELETE")));
  check("AuditLog: academia_app só insere (sem SELECT)", !(await canApp("AuditLog", "SELECT")));
  check("AuditLog: sem UPDATE", !(await canApp("AuditLog", "UPDATE")));
  check("AuditLog: sem DELETE", !(await canApp("AuditLog", "DELETE")));

  /* -------------------------------------------------------------------- 3 */
  console.log("\n=== 3. Prova adversarial: A não toca em B ===");
  await db.exec(`
    INSERT INTO "Academy"(id,slug,name,"shortName","updatedAt") VALUES
      ('A','alfa','Alfa','Alfa',now()),('B','beta','Beta','Beta',now());
    INSERT INTO "Athlete"(id,"academyId",name,birthdate,"updatedAt") VALUES
      ('atA','A','Filho A','2012-01-01',now()),('atB','B','Filho B','2012-01-01',now());
    INSERT INTO "ProfileChange"(id,"academyId",kind,"subjectId",field,"byName","createdAt")
      VALUES ('pcA','A','ATHLETE','atA','name','Semente',now());
  `);
  const soVeOSeu = await asAcademy("A", `SELECT id FROM "Athlete" ORDER BY id`);
  check(
    "A só vê os próprios atletas",
    !soVeOSeu.error && soVeOSeu.rows.length === 1 && soVeOSeu.rows[0].id === "atA",
    JSON.stringify(soVeOSeu.rows ?? soVeOSeu.error),
  );
  const leB = await asAcademy("A", `SELECT id FROM "Athlete" WHERE id='atB'`);
  check("A não lê o atleta de B por id (0 linhas)", !leB.error && leB.rows.length === 0, JSON.stringify(leB.rows ?? leB.error));
  const escreveB = await asAcademy("A", `UPDATE "Athlete" SET name='x' WHERE id='atB'`);
  check("A não escreve no atleta de B", !escreveB.error, escreveB.error ?? "sem efeito");
  const verB = await db.query(`SELECT name FROM "Athlete" WHERE id='atB'`);
  check("o atleta de B ficou intacto", verB.rows[0].name === "Filho B", verB.rows[0].name);
  const editaHist = await asAcademy("A", `UPDATE "ProfileChange" SET field='x' WHERE id='pcA'`);
  check("A não edita o próprio histórico (permission denied)", Boolean(editaHist.error), editaHist.error ?? "SEM ERRO — regressão!");
  const leCrm = await asAcademy("A", `SELECT * FROM "Contact"`);
  check("A não lê o CRM da plataforma (permission denied)", Boolean(leCrm.error), leCrm.error ?? "SEM ERRO — regressão!");

  console.log(`\n${failed === 0 ? "TUDO OK" : "HÁ FALHAS"} — ${passed} ok, ${failed} falhas`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

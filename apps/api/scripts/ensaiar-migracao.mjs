#!/usr/bin/env node
/**
 * Ensaiar uma migração antes de a aplicar.
 *
 * Corre o SQL da pasta indicada numa transação pela ligação de migração
 * (`MIGRATE_DATABASE_URL`), mostra o que ficaria, e faz ROLLBACK. É o passo
 * que antecede o `prisma migrate deploy` (ver docs/05-deploy.md): um erro de
 * sintaxe ou uma coluna que já existe aparecem aqui, sem deixar a base a meio.
 *
 * Uso: node scripts/ensaiar-migracao.mjs 20261118120000_vencimentos
 *      node scripts/ensaiar-migracao.mjs 20261118120000_vencimentos --commit   (aplica, sem passar pelo Prisma)
 *
 * Com `--commit` a migração fica aplicada mas **não** registada em
 * `_prisma_migrations`; usar só quando o deploy do Prisma não é opção, e
 * depois `prisma migrate resolve --applied <nome>`.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const [, , nome, modo] = process.argv;
if (!nome) {
  console.error("Diz a pasta da migração: node scripts/ensaiar-migracao.mjs 20261118120000_vencimentos");
  process.exit(2);
}

const env = (k) => {
  const l = readFileSync(path.join(HERE, "..", ".env"), "utf8").split("\n").find((x) => x.startsWith(k + "="));
  if (!l) throw new Error(`${k} não está em .env`);
  return l.slice(k.length + 1).trim().replace(/^"|"$/g, "");
};

const sql = readFileSync(path.join(HERE, "..", "prisma", "migrations", nome, "migration.sql"), "utf8");
const db = new pg.Client({ connectionString: env("MIGRATE_DATABASE_URL"), ssl: { rejectUnauthorized: false } });
await db.connect();

try {
  await db.query("BEGIN");
  await db.query(sql);

  /* O que a migração tocou: tabelas criadas e colunas novas, pelo próprio SQL. */
  const tabelas = [...sql.matchAll(/CREATE TABLE IF NOT EXISTS "(\w+)"/g)].map((m) => m[1]);
  const colunas = [...sql.matchAll(/ALTER TABLE "(\w+)" ADD COLUMN IF NOT EXISTS "(\w+)"/g)].map((m) => [m[1], m[2]]);
  for (const t of tabelas) {
    const c = await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name = $1 ORDER BY ordinal_position`, [t]);
    const p = await db.query(`SELECT polname FROM pg_policy WHERE polrelid = ($1)::regclass`, [`"${t}"`]);
    const rls = await db.query(`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = ($1)::regclass`, [`"${t}"`]);
    console.log(`${t}: ${c.rows.map((r) => r.column_name).join(", ")}`);
    console.log(`  RLS ${rls.rows[0]?.relrowsecurity ? "ligada" : "DESLIGADA"}${rls.rows[0]?.relforcerowsecurity ? ", forçada" : ""} · políticas: ${p.rows.map((r) => r.polname).join(", ") || "nenhuma"}`);
  }
  for (const [t, c] of colunas) {
    const r = await db.query(`SELECT data_type FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`, [t, c]);
    console.log(`${t}.${c}: ${r.rows[0]?.data_type ?? "EM FALTA"}`);
  }

  if (modo === "--commit") {
    await db.query("COMMIT");
    console.log("\nCOMMIT: aplicada (regista-a no Prisma com `prisma migrate resolve --applied " + nome + "`).");
  } else {
    await db.query("ROLLBACK");
    console.log("\nROLLBACK: o ensaio correu sem erros; a base ficou como estava.");
  }
} catch (e) {
  await db.query("ROLLBACK").catch(() => {});
  console.error("\nFALHOU:", e.message);
  process.exitCode = 1;
} finally {
  await db.end();
}

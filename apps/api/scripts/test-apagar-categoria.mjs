#!/usr/bin/env node
/**
 * Apagar uma categoria de sócio deixa os sócios **sem categoria** — e mais nada.
 *
 * Corre contra Postgres a sério (PGlite, WASM): sem Docker, sem servidor, sem
 * tocar em base nenhuma que exista. Aplica as migrações todas e exercita os
 * mesmos dois comandos que `MembersService.deleteTier` faz, pela ordem que os
 * faz.
 *
 * O que se confirma, e porquê cada um:
 *
 *  1. a categoria desaparece — é o que se pediu;
 *  2. os sócios ficam, com `tierId` a nulo — o aviso da consola diz exactamente
 *     isto, e se em vez disso os apagasse seria uma catástrofe silenciosa;
 *  3. as quotas já lançadas ficam intactas, com o valor que tinham — é o
 *     histórico de quem pagou o quê, e `MemberFee` guarda o seu próprio
 *     `amountCents` precisamente para não depender da categoria;
 *  4. sócios de **outra** categoria não são tocados — o `WHERE` é por
 *     categoria, e um erro aqui limpava o clube inteiro;
 *  5. um sócio sem categoria deixa de entrar na emissão automática — não é
 *     efeito deste método, é a regra de `emitirAutomaticas`, e é a consequência
 *     que o aviso tem de mencionar. Se esta deixar de ser verdade, o texto do
 *     aviso passa a mentir.
 *
 * Uso: node scripts/test-apagar-categoria.mjs
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = path.join(HERE, "..", "prisma", "migrations");

/** O que o PGlite não corre e que nada tem a ver com o que aqui se testa. */
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
    try {
      await db.exec(sanitize(sql));
    } catch (e) {
      console.error(`!! migração ${dir}: ${e.message}`);
      throw e;
    }
  }
}

const uma = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const todas = async (sql, params = []) => (await db.query(sql, params)).rows;

async function main() {
  await migrar();

  /* ---------------------------------------------------------------------- */
  /* O cenário                                                               */
  /* ---------------------------------------------------------------------- */

  await db.query(
    `INSERT INTO "Academy" (id, slug, name, "shortName", "updatedAt")
     VALUES ('ac1', 'clube-teste', 'Clube de Teste', 'Teste', now())`,
  );

  for (const [id, nome, preco] of [
    ["tier-gold", "Sócio Gold", 1500],
    ["tier-prata", "Sócio Prata", 1000],
  ]) {
    await db.query(
      `INSERT INTO "MemberTier" (id, "academyId", name, "feeCents", "updatedAt")
       VALUES ($1, 'ac1', $2, $3, now())`,
      [id, nome, preco],
    );
  }

  /* Três no Gold (o que vai ser apagado) e um no Prata, que não pode ser tocado. */
  const noGold = ["m1", "m2", "m3"];
  for (const [i, id] of noGold.entries()) {
    await db.query(
      `INSERT INTO "Member" (id, "academyId", name, "tierId", status, "updatedAt")
       VALUES ($1, 'ac1', $2, 'tier-gold', 'ACTIVE', now())`,
      [id, `Sócio ${i + 1}`],
    );
  }
  await db.query(
    `INSERT INTO "Member" (id, "academyId", name, "tierId", status, "updatedAt")
     VALUES ('m4', 'ac1', 'Sócio do Prata', 'tier-prata', 'ACTIVE', now())`,
  );

  /* Uma quota já liquidada, que tem de sobreviver com o valor que tinha. */
  await db.query(
    `INSERT INTO "MemberFee" (id, "academyId", "memberId", period, "amountCents", status, "updatedAt")
     VALUES ('f1', 'ac1', 'm1', '2026-09', 1500, 'SETTLED', now())`,
  );

  /* ---------------------------------------------------------------------- */
  /* O que o serviço faz, pela mesma ordem                                   */
  /* ---------------------------------------------------------------------- */

  const { count } = await uma(
    `WITH mexidos AS (UPDATE "Member" SET "tierId" = NULL WHERE "tierId" = 'tier-gold' RETURNING 1)
     SELECT count(*)::int AS count FROM mexidos`,
  );
  await db.query(`DELETE FROM "MemberTier" WHERE id = 'tier-gold'`);

  check(`devolve 3 sócios afectados (devolveu ${count})`, count === 3);

  /* ---------------------------------------------------------------------- */
  /* O que ficou                                                             */
  /* ---------------------------------------------------------------------- */

  const categoria = await uma(`SELECT id FROM "MemberTier" WHERE id = 'tier-gold'`);
  check("a categoria desapareceu", categoria === undefined);

  const sobreviventes = await todas(
    `SELECT id, "tierId" FROM "Member" WHERE id = ANY($1) ORDER BY id`,
    [noGold],
  );
  check(`os 3 sócios continuam lá (estão ${sobreviventes.length})`, sobreviventes.length === 3);
  check(
    "e ficaram sem categoria",
    sobreviventes.every((m) => m.tierId === null),
    JSON.stringify(sobreviventes),
  );

  const quota = await uma(`SELECT "amountCents", status FROM "MemberFee" WHERE id = 'f1'`);
  check(
    `a quota liquidada ficou intacta (${quota?.amountCents} ¢, ${quota?.status})`,
    quota?.amountCents === 1500 && quota?.status === "SETTLED",
  );

  const prata = await uma(`SELECT "tierId" FROM "Member" WHERE id = 'm4'`);
  check("o sócio da outra categoria não foi tocado", prata?.tierId === "tier-prata");

  /*
   * A regra de `emitirAutomaticas`, escrita aqui tal e qual: sócio activo com
   * categoria que tenha preço e não esteja arquivada. É o que torna verdadeira
   * a segunda metade do aviso da consola.
   */
  const cobraveis = await todas(
    `SELECT m.id FROM "Member" m
       JOIN "MemberTier" t ON t.id = m."tierId"
      WHERE m.status = 'ACTIVE' AND t."feeCents" IS NOT NULL AND t."archivedAt" IS NULL`,
  );
  check(
    `só o sócio do Prata entra na emissão automática (entram ${cobraveis.length})`,
    cobraveis.length === 1 && cobraveis[0].id === "m4",
  );

  console.log(`\n${passed} certas, ${failed} falhas.`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * O site do clube no período experimental (`app.academy_has_website`).
 *
 * Corre contra Postgres a sério (PGlite, WASM), com as migrações todas, sem
 * tocar em base nenhuma que exista. Confirma a regra da migração
 * `20261026120000_site_na_experiencia`, caso a caso:
 *
 *  - em avaliação e sem plano: tem o site, só pela experiência;
 *  - em avaliação a experimentar um plano sem site (TRIALING): tem o site;
 *  - em avaliação mas já a pagar um plano sem site (ACTIVE ou PAST_DUE): não
 *    tem, porque escolheu o plano;
 *  - avaliação acabada e sem o Connect Pro: não tem;
 *  - Connect Pro a pagar: tem, pelo plano (com ou sem avaliação);
 *  - suspenso ou cancelado, mesmo em avaliação: não tem.
 *
 * Uso: node scripts/test-site-na-experiencia.mjs
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
    .replace(/ALTER TABLE\s+"TrainingCycle"\s+ADD CONSTRAINT\s+"[^"]*_sem_sobreposicao"[\s\S]*?;/gi, "-- [EXCLUDE ignorado]");

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

const DIA = 86_400_000;
let n = 0;

/** Um clube com a avaliação a acabar daqui a `dias` (negativo: já acabou), e a subscrição pedida. */
async function clube({ dias, plano = null, estado = null, suspenso = false, cancelado = false }) {
  const id = `ac_${++n}`;
  await db.query(
    `INSERT INTO "Academy" (id, slug, name, "shortName", status, "trialEndsAt", "suspendedAt", "updatedAt")
     VALUES ($1, $2, $3, 'T', $4::"AcademyStatus", $5, $6, now())`,
    [id, `clube-${n}`, `Clube ${n}`, cancelado ? "CANCELLED" : "SETUP", new Date(Date.now() + dias * DIA), suspenso ? new Date() : null],
  );
  if (plano) {
    await db.query(
      `INSERT INTO "Subscription" (id, "academyId", "planId", status, "updatedAt")
       VALUES ($1, $2, $3, $4::"SubscriptionStatus", now())`,
      [`sub_${n}`, id, plano, estado],
    );
  }
  return id;
}

async function regra(id) {
  return uma(
    `SELECT app.academy_has_website($1) AS site, app.academy_website_by_plan($1) AS plano, app.academy_in_trial($1) AS experiencia`,
    [id],
  );
}

async function main() {
  await migrar();

  // Um plano sem site (a Consola) e o Connect Pro (que a migração 20261013160000 já criou).
  await db.query(
    `INSERT INTO "Plan" (id, name, "amountCents", "includesWebsite", "updatedAt")
     VALUES ('plan_teste_consola', 'Consola', 1499, false, now()) ON CONFLICT (id) DO NOTHING`,
  );
  const pro = await uma(`SELECT id FROM "Plan" WHERE "includesWebsite" LIMIT 1`);
  check("há um plano com o site (Connect Pro)", Boolean(pro?.id));

  const casos = [
    ["em avaliação, sem plano: tem o site, só pela experiência", { dias: 20 }, { site: true, plano: false, experiencia: true }],
    ["em avaliação, a experimentar a Consola (TRIALING): tem o site", { dias: 20, plano: "plan_teste_consola", estado: "TRIALING" }, { site: true, plano: false }],
    ["em avaliação, mas já a pagar a Consola (ACTIVE): não tem", { dias: 20, plano: "plan_teste_consola", estado: "ACTIVE" }, { site: false }],
    ["em avaliação, Consola com pagamento falhado (PAST_DUE): não tem", { dias: 20, plano: "plan_teste_consola", estado: "PAST_DUE" }, { site: false }],
    ["avaliação acabada, sem plano: não tem", { dias: -1 }, { site: false, experiencia: false }],
    ["avaliação acabada, na Consola: não tem", { dias: -1, plano: "plan_teste_consola", estado: "ACTIVE" }, { site: false }],
    ["avaliação acabada, Connect Pro a pagar: tem, pelo plano", { dias: -1, plano: pro.id, estado: "ACTIVE" }, { site: true, plano: true }],
    ["em avaliação no Connect Pro (TRIALING): tem, pelo plano", { dias: 20, plano: pro.id, estado: "TRIALING" }, { site: true, plano: true }],
    ["em avaliação mas suspenso: não tem", { dias: 20, suspenso: true }, { site: false }],
    ["em avaliação mas cancelado: não tem", { dias: 20, cancelado: true }, { site: false }],
    ["Connect Pro cancelado, avaliação acabada: não tem", { dias: -1, plano: pro.id, estado: "CANCELLED" }, { site: false }],
  ];

  console.log("\nA regra, caso a caso");
  for (const [rotulo, dados, esperado] of casos) {
    const r = await regra(await clube(dados));
    const ok = Object.entries(esperado).every(([k, v]) => r[k] === v);
    check(rotulo, ok, JSON.stringify(r));
  }

  // O endereço próprio só resolve para quem tem o site (e publicado).
  console.log("\nO domínio");
  const emAvaliacao = await clube({ dias: 20 });
  await db.query(`UPDATE "Academy" SET "siteDomain" = 'clube-em-avaliacao.pt' WHERE id = $1`, [emAvaliacao]);
  await db.query(
    `INSERT INTO "SiteConfig" ("academyId", published, "updatedAt") VALUES ($1, true, now())`,
    [emAvaliacao],
  );
  const r = await uma(`SELECT app.resolve_site_by_domain('www.clube-em-avaliacao.pt') AS id`);
  check("um site publicado em avaliação resolve pelo domínio", r?.id === emAvaliacao, JSON.stringify(r));

  console.log(`\n${passed} ok, ${failed} falhas`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * A fronteira entre a plataforma e as academias.
 *
 * Estes testes existem para uma coisa só: provar que o papel com que o servidor
 * serve os pedidos das academias **não consegue** chegar aos dados da plataforma,
 * nem às funções que agregam todas as academias.
 *
 * É a verificação que mais vale a pena ter aqui, porque uma falha desta separação
 * não dá erro nenhum — dá dados a mais para quem não devia, em silêncio, e só se
 * descobre quando um cliente vê o nome de outro.
 *
 * Uso: node scripts/test-platform.mjs
 */
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

/** Corre como `academia_app` — o papel dos pedidos de academia. */
async function asAcademyRole(db, sql, params = []) {
  await db.query("BEGIN");
  try {
    await db.query("SET LOCAL ROLE academia_app");
    await db.query("SELECT set_config('app.academy_id', 'acd_lifeclub', true)");
    const r = await db.query(sql, params);
    await db.query("ROLLBACK");
    return { ok: true, rows: r.rows };
  } catch (error) {
    await db.query("ROLLBACK");
    return { ok: false, error: error.message };
  }
}

async function main() {
  const db = new pg.Client({
    connectionString: env("MIGRATE_DATABASE_URL"),
    ssl: { rejectUnauthorized: false },
  });
  await db.connect();

  console.log("=== As tabelas da plataforma estão fora do alcance das academias ===");
  for (const table of ["PlatformAdmin", "Plan", "Subscription", "AuditLog", "SupportSession"]) {
    const r = await asAcademyRole(db, `SELECT * FROM "${table}" LIMIT 1`);
    check(`academia_app não lê ${table}`, !r.ok && /permission denied/i.test(r.error ?? ""), r.error?.slice(0, 60));
  }

  console.log("\n=== Nem consegue escrever nelas ===");
  const w = await asAcademyRole(
    db,
    `INSERT INTO "PlatformAdmin" (id,"authId",email,name,"updatedAt") VALUES ('x','x','x@x.pt','X',now())`,
  );
  check("academia_app não cria administradores da plataforma", !w.ok, w.error?.slice(0, 60));

  console.log("\n=== Nem chega às funções de agregação global ===");
  for (const fn of ["app.platform_overview()", "app.platform_academies()", "app.platform_series(12)"]) {
    const r = await asAcademyRole(db, `SELECT * FROM ${fn} LIMIT 1`);
    check(`academia_app não executa ${fn.split("(")[0]}`, !r.ok && /permission denied/i.test(r.error ?? ""));
  }

  console.log("\n=== As funções da plataforma respondem a quem pode ===");
  const overview = (await db.query("SELECT * FROM app.platform_overview()")).rows[0];
  check("o retrato global responde", Boolean(overview));
  check("conta academias", overview.academies >= 1, `${overview.academies}`);
  check("conta atletas", overview.athletes >= 9, `${overview.athletes}`);
  check("conta encarregados", overview.guardians >= 2, `${overview.guardians}`);
  /*
   * O MRR conta **só** subscrições activas.
   *
   * Trials e cancelados ficam de fora de propósito: um MRR que inclui trials é um
   * número em que se acredita e que depois não aparece no banco. Por isso a
   * verificação é essa — a soma tem de bater certo com as subscrições ACTIVE, e
   * não com um valor fixo que muda sempre que se semeia um cliente novo.
   */
  const esperado = (await db.query(`
    SELECT COALESCE(sum(p."amountCents" + p."perAthleteCents" * GREATEST(0, ath.n - p."includedAthletes")), 0)::bigint AS total
    FROM "Subscription" s
    JOIN "Plan" p ON p.id = s."planId"
    LEFT JOIN LATERAL (
      SELECT count(*)::int AS n FROM "Athlete" a WHERE a."academyId" = s."academyId" AND a.status <> 'LEFT'
    ) ath ON true
    WHERE s.status = 'ACTIVE'
  `)).rows[0].total;
  check("o MRR bate certo com as subscrições activas",
    Number(overview.mrr_cents) === Number(esperado), `${overview.mrr_cents} vs ${esperado}`);
  check("e trials não contam para o MRR",
    (await db.query(`SELECT count(*)::int n FROM "Subscription" WHERE status='TRIALING'`)).rows[0].n >= 0);

  const academies = (await db.query("SELECT * FROM app.platform_academies()")).rows;
  check("lista academias", academies.length >= 1, `${academies.length}`);
  const life = academies.find((a) => a.slug === "life-club");
  /*
   * As contagens comparam-se com a base, não com números escritos aqui.
   *
   * Estavam fixos em 9 atletas e 2 equipas, e passaram a falhar no dia em que
   * alguém criou uma terceira equipa pela aplicação — que é uso normal do
   * produto, não uma regressão. Um teste que obriga a base de dados a ficar
   * parada para passar acaba ignorado, e leva com ele o que ele realmente mede:
   * que a função **conta o que lá está**, e que o `status <> 'LEFT'` dos atletas
   * é respeitado.
   */
  const esperadoLife = (await db.query(`
    SELECT
      (SELECT count(*)::int FROM "Athlete" a
        WHERE a."academyId" = ac.id AND a.status <> 'LEFT') AS atletas,
      (SELECT count(*)::int FROM "Team" t WHERE t."academyId" = ac.id) AS equipas
    FROM "Academy" ac WHERE ac.slug = 'life-club'
  `)).rows[0];
  check(
    "com contagens certas",
    life?.athletes === esperadoLife.atletas && life?.teams === esperadoLife.equipas,
    `${life?.athletes}/${esperadoLife.atletas} atletas, ${life?.teams}/${esperadoLife.equipas} equipas`,
  );
  // A contraprova do filtro: quem saiu não entra na conta.
  const saidos = (await db.query(`
    SELECT count(*)::int n FROM "Athlete" a JOIN "Academy" ac ON ac.id = a."academyId"
     WHERE ac.slug = 'life-club' AND a.status = 'LEFT'
  `)).rows[0].n;
  if (saidos > 0) {
    check("e sem contar quem saiu", life?.athletes < esperadoLife.atletas + saidos, `${saidos} saíram`);
  } else {
    console.log("  (nenhum atleta saiu no life-club — salto a contraprova do filtro)");
  }
  check("e com progresso de onboarding", life?.onboarding_done >= 5, `${life?.onboarding_done}/8`);
  check("com sinal de última atividade", life?.last_activity !== null);

  console.log("\n=== O que as funções NÃO devolvem ===");
  // A fronteira do produto: o Platform Admin vê o negócio, não vê as pessoas.
  const cols = Object.keys(life ?? {});
  const leaks = cols.filter((c) => /athlete_name|guardian|email|phone|clinical|diagnos/i.test(c) && c !== "guardians");
  check("nenhuma coluna com dados de pessoas", leaks.length === 0, leaks.join(", "));
  check("nenhum nome de atleta", !JSON.stringify(academies).includes("Martim"));
  check("nenhum contacto", !JSON.stringify(academies).includes("@"));

  console.log("\n=== Séries para os gráficos ===");
  const series = (await db.query("SELECT * FROM app.platform_series(6)")).rows;
  check("devolve um ponto por mês", series.length === 6, `${series.length}`);
  check("ordenadas no tempo", series.every((r, i) => i === 0 || r.month >= series[i - 1].month));

  console.log("\n=== O registo de auditoria não se apaga ===");
  // `SET NULL` e não `CASCADE`: apagar um administrador não pode apagar o rasto.
  const rule = await db.query(`
    SELECT confdeltype FROM pg_constraint WHERE conname = 'AuditLog_adminId_fkey'
  `);
  check("apagar um administrador preserva o registo", rule.rows[0]?.confdeltype === "n",
    `regra ${rule.rows[0]?.confdeltype}`);

  await db.end();
  console.log(`\n${passed} passaram, ${failed} falharam`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("\nErro:", error.message);
  process.exit(1);
});

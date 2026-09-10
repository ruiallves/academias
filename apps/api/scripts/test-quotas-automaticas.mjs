#!/usr/bin/env node
/**
 * As quotas do mês nascem sozinhas — no dia 1, sem ninguém carregar em nada.
 *
 * ## O que este teste existe para provar
 *
 * Havia um botão "Gerar quotas" na lista de sócios, e o que ele fazia era
 * lembrar a direcção de uma coisa que o produto sabe fazer sozinho. O mês em
 * que ninguém se lembrasse era um mês sem cobranças — sem erro nenhum a
 * dizê-lo, porque não havia erro: havia uma peça que faltava.
 *
 *  1. Um clube com categorias com preço ganha as quotas do mês corrente.
 *  2. Com o valor da **categoria** de cada sócio, e o rótulo do mês.
 *  3. O sócio com conta é avisado — uma quota que ninguém vê não foi emitida.
 *  4. Repetir a varredura não cria nada. É essa propriedade que permite correr
 *     de hora a hora em vez de um disparo único e frágil.
 *  5. Quem fica de fora fica de fora: sócio suspenso, sem categoria, categoria
 *     sem preço, categoria arquivada.
 *  6. Um clube cancelado não é sequer visitado.
 *  7. A rota está fechada a quem não é da plataforma.
 *
 * ## Porquê um clube de mentira
 *
 * Porque a varredura a sério percorre **todos** os clubes e lança quotas
 * verdadeiras, com avisos a caminho de telemóveis verdadeiros. Cria-se aqui um
 * clube descartável, aponta-se-lhe a varredura pelo `?academia=`, e apaga-se
 * tudo no fim — nenhum clube real é tocado. É a mesma manobra de
 * `test-emissao-automatica.mjs`, que faz isto para as mensalidades.
 *
 * Uso: node scripts/test-quotas-automaticas.mjs
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

const S = env("SUPABASE_URL").replace(/\/$/, "");
const A = env("SUPABASE_ANON_KEY");
const API = process.env.API_URL ?? "http://127.0.0.1:3000";

let ok = 0;
let bad = 0;
const check = (l, c, d = "") => {
  if (c) {
    ok++;
    console.log("  OK    " + l);
  } else {
    bad++;
    console.log("  FALHA " + l + (d ? " — " + d : ""));
  }
};

const login = async (email, password) =>
  (
    await (
      await fetch(`${S}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: { apikey: A, "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      })
    ).json()
  ).access_token;

const call = async (token, method, pathname) => {
  const r = await fetch(API + pathname, { method, headers: { Authorization: `Bearer ${token}` } });
  return { status: r.status, body: await r.json().catch(() => null) };
};

const db = new pg.Client({ connectionString: env("MIGRATE_DATABASE_URL"), ssl: { rejectUnauthorized: false } });
await db.connect();

/* ============================================== o clube descartável ===== */

const ID = "zq_academia";
const agora = new Date();
const PERIODO = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, "0")}`;

const limpar = async () => {
  await db.query(`DELETE FROM "Notification" WHERE "academyId" = $1`, [ID]);
  await db.query(`DELETE FROM "MemberFee" WHERE "academyId" = $1`, [ID]);
  await db.query(`DELETE FROM "Member" WHERE "academyId" = $1`, [ID]);
  await db.query(`DELETE FROM "MemberTier" WHERE "academyId" = $1`, [ID]);
  await db.query(`DELETE FROM "Membership" WHERE "academyId" = $1`, [ID]);
  await db.query(`DELETE FROM "Academy" WHERE id = $1`, [ID]);
  await db.query(`DELETE FROM "User" WHERE id LIKE 'zq_%'`);
  await db.query(`DELETE FROM "PlatformAdmin" WHERE id = 'zq_admin'`);
};
await limpar();

await db.query(
  `INSERT INTO "Academy" (id, slug, name, "shortName", status, "updatedAt")
   VALUES ($1, 'zq-teste-quotas', 'ZQ Teste Quotas', 'ZQ', 'SETUP', now())`,
  [ID],
);

/*
 * Três categorias, para provar as três razões de ficar de fora.
 *
 * A quarta razão — o sócio suspenso — é do sócio e não da categoria, e vai
 * mais abaixo.
 */
await db.query(
  `INSERT INTO "MemberTier" (id, "academyId", name, "feeCents", "updatedAt") VALUES
     ('zq_tier_efectivo', $1, 'ZQ Efectivo', 1000, now()),
     ('zq_tier_gratis',   $1, 'ZQ Honorário', NULL, now())`,
  [ID],
);
await db.query(
  `INSERT INTO "MemberTier" (id, "academyId", name, "feeCents", "archivedAt", "updatedAt")
   VALUES ('zq_tier_velho', $1, 'ZQ Antiga', 2500, now(), now())`,
  [ID],
);

/* O sócio com conta — é o único que pode ser avisado. */
await db.query(
  `INSERT INTO "User" (id, "authId", name, email, "updatedAt")
   VALUES ('zq_user', 'zq-auth-teste', 'ZQ Sócio', 'zq@teste.local', now())`,
);
await db.query(
  `INSERT INTO "Member" (id, "academyId", "userId", "tierId", name, number, status, source, "updatedAt") VALUES
     ('zq_activo',    $1, 'zq_user', 'zq_tier_efectivo', 'ZQ Activo Com Conta', 1, 'ACTIVE',    'secretaria', now()),
     ('zq_sem_conta', $1, NULL,      'zq_tier_efectivo', 'ZQ Activo Sem Conta', 2, 'ACTIVE',    'secretaria', now()),
     ('zq_suspenso',  $1, NULL,      'zq_tier_efectivo', 'ZQ Suspenso',         3, 'SUSPENDED', 'secretaria', now()),
     ('zq_gratis',    $1, NULL,      'zq_tier_gratis',   'ZQ Honorário',        4, 'ACTIVE',    'secretaria', now()),
     ('zq_arquivado', $1, NULL,      'zq_tier_velho',    'ZQ Categoria Velha',  5, 'ACTIVE',    'secretaria', now()),
     ('zq_sem_tier',  $1, NULL,      NULL,               'ZQ Sem Categoria',    6, 'ACTIVE',    'secretaria', now())`,
  [ID],
);

const quotas = async () =>
  (
    await db.query(`SELECT * FROM "MemberFee" WHERE "academyId" = $1 AND period = $2 ORDER BY "memberId"`, [ID, PERIODO])
  ).rows;

/* ==================================================== a porta fechada ===== */

console.log("=== Só a plataforma emite ===");
const director = await login("direcao@lifeclub.pt", "academia2026");
const negado = await call(director, "POST", `/api/platform/billing/emitir?academia=${ID}`);
check("a direcção de um clube não emite pela plataforma (403)", negado.status === 403, `${negado.status}`);

const semSessao = await fetch(`${API}/api/platform/billing/emitir`, { method: "POST" });
check("sem sessão é 401", semSessao.status === 401, `${semSessao.status}`);
check("e nada foi lançado entretanto", (await quotas()).length === 0);

/*
 * O crachá de plataforma, emprestado por um instante — a mesma manobra de
 * `test-emissao-automatica.mjs`: a linha nasce e morre dentro deste ficheiro, e
 * vem **depois** do 403 de propósito.
 */
const authDaDireccao = (
  await db.query(`SELECT "authId" FROM "User" WHERE email = 'direcao@lifeclub.pt' LIMIT 1`)
).rows[0]?.authId;
check("há um authId para emprestar o acesso", Boolean(authDaDireccao));

await db.query(
  `INSERT INTO "PlatformAdmin" (id, "authId", name, email, role, "isActive", "updatedAt")
   VALUES ('zq_admin', $1, 'ZQ Admin de teste', 'zq-admin@teste.local', 'OWNER', true, now())`,
  [authDaDireccao],
);

/* ========================================================= a emissão ===== */

console.log("\n=== O mês lança-se sozinho ===");
const admin = await login("direcao@lifeclub.pt", "academia2026");
const passe = await call(admin, "POST", `/api/platform/billing/emitir?academia=${ID}`);
check("a plataforma emite (2xx)", passe.status === 200 || passe.status === 201, `${passe.status} ${JSON.stringify(passe.body).slice(0, 160)}`);
check("e as quotas vêm na resposta", passe.body?.quotas?.period === PERIODO, JSON.stringify(passe.body?.quotas));
check("com duas quotas criadas", passe.body?.quotas?.criadas === 2, JSON.stringify(passe.body?.quotas));

const criadas = await quotas();
check("duas linhas na base", criadas.length === 2, `${criadas.length}`);
check(
  "os dois activos com categoria com preço",
  criadas.map((f) => f.memberId).sort().join(",") === "zq_activo,zq_sem_conta",
  criadas.map((f) => f.memberId).join(","),
);
check("com o valor da categoria", criadas.every((f) => f.amountCents === 1000), JSON.stringify(criadas.map((f) => f.amountCents)));
check("por pagar", criadas.every((f) => f.status === "OPEN"));
check("com o rótulo do mês", criadas.every((f) => /^Quota de \w+ \d{4}$/.test(f.label ?? "")), `${criadas[0]?.label}`);

/*
 * O prazo lê-se como texto, do próprio Postgres: `dueOn` é `DATE`, e o `pg`
 * entrega-a como um `Date` à meia-noite **local** — em Lisboa no Verão isso é
 * 23:00 UTC do dia anterior, e a asserção acusava o produto de um erro que era
 * do teste. A mesma nota está em `test-emissao-automatica.mjs`.
 */
const prazo = (
  await db.query(
    `SELECT to_char("dueOn", 'YYYY-MM-DD') AS d FROM "MemberFee" WHERE "academyId" = $1 AND "memberId" = 'zq_activo'`,
    [ID],
  )
).rows[0]?.d;
check("com prazo no fim do próprio mês", prazo?.startsWith(PERIODO) === true, `${prazo}`);

console.log("\n=== Quem fica de fora ===");
const fora = criadas.map((f) => f.memberId);
check("o sócio suspenso não gera quota", !fora.includes("zq_suspenso"));
check("o sócio sem categoria também não", !fora.includes("zq_sem_tier"));
check("nem o de categoria sem preço", !fora.includes("zq_gratis"));
check("nem o de categoria arquivada", !fora.includes("zq_arquivado"));

console.log("\n=== O sócio é avisado ===");
const avisos = (
  await db.query(`SELECT "userId", title, body FROM "Notification" WHERE "academyId" = $1`, [ID])
).rows;
check("um aviso, e um só", avisos.length === 1, JSON.stringify(avisos));
check("para o sócio que tem conta", avisos[0]?.userId === "zq_user", `${avisos[0]?.userId}`);
check('a dizer "Nova quota"', avisos[0]?.title === "Nova quota", `${avisos[0]?.title}`);
check("com o valor no corpo", String(avisos[0]?.body ?? "").includes("10.00 €"), `${avisos[0]?.body}`);

/* ==================================================== idempotência ===== */

console.log("\n=== Repetir não duplica dinheiro ===");
const segundo = await call(admin, "POST", `/api/platform/billing/emitir?academia=${ID}`);
check("o segundo passe não cria nada", segundo.body?.quotas?.criadas === 0, JSON.stringify(segundo.body?.quotas));
check("continua a haver duas linhas", (await quotas()).length === 2);
check(
  "e nenhum aviso novo",
  (await db.query(`SELECT COUNT(*)::int AS n FROM "Notification" WHERE "academyId" = $1`, [ID])).rows[0].n === 1,
);

/*
 * Uma quota já paga não volta atrás.
 *
 * É o que separa "só cria o que falta" de "reescreve o mês": se a varredura
 * tocasse numa linha existente, o dia 2 desfazia o pagamento do dia 1.
 */
await db.query(
  `UPDATE "MemberFee" SET status = 'SETTLED', "settledAt" = now() WHERE "academyId" = $1 AND "memberId" = 'zq_activo'`,
  [ID],
);
await call(admin, "POST", `/api/platform/billing/emitir?academia=${ID}`);
const depois = (await quotas()).find((f) => f.memberId === "zq_activo");
check("uma quota paga continua paga depois da varredura", depois?.status === "SETTLED", `${depois?.status}`);
check("e não nasceu uma segunda ao lado", (await quotas()).length === 2);

/* ================================================== clube cancelado ===== */

console.log("\n=== Um clube cancelado fica de fora ===");
await db.query(`DELETE FROM "MemberFee" WHERE "academyId" = $1`, [ID]);
await db.query(`UPDATE "Academy" SET status = 'CANCELLED' WHERE id = $1`, [ID]);
const cancelado = await call(admin, "POST", `/api/platform/billing/emitir?academia=${ID}`);
check("não é sequer visitado", cancelado.body?.quotas?.academias === 0, JSON.stringify(cancelado.body?.quotas));
check("e continua sem quotas", (await quotas()).length === 0);

/* =========================================================== limpeza ===== */

await limpar();
const restos = (await db.query(`SELECT COUNT(*)::int AS n FROM "Academy" WHERE id = $1`, [ID])).rows[0].n;
check("\ntudo limpo no fim", restos === 0);

await db.end();
console.log(`\n${ok} OK, ${bad} FALHA${bad === 1 ? "" : "S"}`);
process.exit(bad ? 1 : 0);

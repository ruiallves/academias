#!/usr/bin/env node
/**
 * A emissão automática das mensalidades do mês.
 *
 * ## O que este teste existe para provar
 *
 * Que no dia 1 as mensalidades nascem sem ninguém carregar em nada, e que o
 * servidor pode repetir a varredura à vontade sem duplicar dinheiro:
 *
 * 1. Um clube com plano configurado ganha as mensalidades do mês corrente.
 * 2. Com o valor do plano e o dia de vencimento **do clube**.
 * 3. A família é avisada — uma mensalidade que ninguém vê não foi emitida.
 * 4. Repetir a varredura não cria nada (idempotência). É a propriedade que
 *    permite correr de hora a hora em vez de um disparo único e frágil.
 * 5. O calendário do clube manda: um mês fora de `billingMonths` não emite.
 * 6. Um clube cancelado fica de fora.
 * 7. A rota está fechada a quem não é da plataforma.
 *
 * ## Porquê um clube de mentira
 *
 * Porque a varredura a sério percorre **todos** os clubes e emite cobranças
 * verdadeiras, com avisos a caminho de telemóveis verdadeiros. Um teste não faz
 * isso. Cria-se aqui um clube descartável, aponta-se-lhe a varredura pelo
 * `?academia=`, e apaga-se tudo no fim — nenhum clube real é tocado.
 *
 * Uso: node scripts/test-emissao-automatica.mjs
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
const API = process.env.API_URL ?? "http://localhost:3000";

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

const ID = "zb_academia";
const agora = new Date();
const PERIODO = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, "0")}`;
const MES = agora.getMonth() + 1;
/** Um mês que não é este — para provar que o calendário do clube manda. */
const OUTRO_MES = MES === 1 ? 2 : 1;

const limpar = async () => {
  await db.query(`DELETE FROM "Notification" WHERE "academyId" = $1`, [ID]);
  await db.query(`DELETE FROM "Charge" WHERE "academyId" = $1`, [ID]);
  await db.query(`DELETE FROM "GuardianLink" WHERE "membershipId" LIKE 'zb_%'`);
  await db.query(`DELETE FROM "TeamMembership" WHERE "athleteId" LIKE 'zb_%'`);
  await db.query(`DELETE FROM "SubscriptionPlan" WHERE "academyId" = $1`, [ID]);
  await db.query(`DELETE FROM "Athlete" WHERE "academyId" = $1`, [ID]);
  await db.query(`DELETE FROM "Team" WHERE "academyId" = $1`, [ID]);
  await db.query(`DELETE FROM "Season" WHERE "academyId" = $1`, [ID]);
  await db.query(`DELETE FROM "Membership" WHERE "academyId" = $1`, [ID]);
  await db.query(`DELETE FROM "Sport" WHERE "academyId" = $1`, [ID]);
  await db.query(`DELETE FROM "Academy" WHERE id = $1`, [ID]);
  await db.query(`DELETE FROM "User" WHERE id LIKE 'zb_%'`);
  await db.query(`DELETE FROM "PlatformAdmin" WHERE id = 'zb_admin'`);
};
await limpar();

await db.query(
  `INSERT INTO "Academy" (id, slug, name, "shortName", status, "billingDueDay", "billingMonths", "updatedAt")
   VALUES ($1, 'zb-teste-emissao', 'ZB Teste Emissão', 'ZB', 'SETUP', 12, $2, now())`,
  [ID, [MES]],
);
await db.query(
  `INSERT INTO "Sport" (id, "academyId", name, positions, skills)
   VALUES ('zb_sport', $1, 'Futebol', ARRAY[]::text[], ARRAY[]::text[])`,
  [ID],
);
await db.query(
  `INSERT INTO "Season" (id, "academyId", label, "startsOn", "endsOn", "isCurrent")
   VALUES ('zb_season', $1, '2026/27', '2026-08-01', '2027-07-31', true)`,
  [ID],
);
await db.query(
  `INSERT INTO "Team" (id, "academyId", "sportId", "seasonId", name, "maxAge", "updatedAt")
   VALUES ('zb_team', $1, 'zb_sport', 'zb_season', 'ZB Sub-13', 13, now())`,
  [ID],
);
await db.query(
  `INSERT INTO "SubscriptionPlan" (id, "academyId", "teamId", name, "amountCents", "isActive")
   VALUES ('zb_plan', $1, 'zb_team', 'ZB Plano', 4500, true)`,
  [ID],
);
await db.query(
  `INSERT INTO "Athlete" (id, "academyId", name, birthdate, status, "joinedAt", "updatedAt")
   VALUES ('zb_atleta', $1, 'ZB Atleta', '2013-05-05', 'ACTIVE', '2026-01-10', now())`,
  [ID],
);
await db.query(
  `INSERT INTO "TeamMembership" (id, "teamId", "athleteId") VALUES ('zb_tm', 'zb_team', 'zb_atleta')`,
);
// Um encarregado, para o aviso ter a quem chegar.
await db.query(
  `INSERT INTO "User" (id, "authId", name, email, "updatedAt")
   VALUES ('zb_user', 'zb-auth-teste', 'ZB Encarregado', 'zb@teste.local', now())`,
);
await db.query(
  `INSERT INTO "Membership" (id, "academyId", "userId", role, "isActive", "updatedAt")
   VALUES ('zb_memb', $1, 'zb_user', 'GUARDIAN', true, now())`,
  [ID],
);
await db.query(
  `INSERT INTO "GuardianLink" (id, "athleteId", "membershipId", relation)
   VALUES ('zb_gl', 'zb_atleta', 'zb_memb', 'Encarregado')`,
);

/* ==================================================== a porta fechada ===== */

console.log("=== Só a plataforma emite ===");
const director = await login("direcao@lifeclub.pt", "academia2026");
const negado = await call(director, "POST", `/api/platform/billing/emitir?academia=${ID}`);
check("a direcção de um clube não emite pela plataforma (403)", negado.status === 403, `${negado.status}`);

const semSessao = await fetch(`${API}/api/platform/billing/emitir`, { method: "POST" });
check("sem sessão é 401", semSessao.status === 401, `${semSessao.status}`);

const naBase = async () =>
  (await db.query(`SELECT * FROM "Charge" WHERE "academyId" = $1 AND period = $2`, [ID, PERIODO])).rows;
check("e nada foi emitido entretanto", (await naBase()).length === 0);

/* ======================================================= a emissão ===== */

/*
 * O acesso de plataforma, emprestado por um instante.
 *
 * A varredura é global — emitir "os clubes todos" não é decisão de um clube —,
 * e por isso a rota vive atrás do `PlatformGuard`. Na base real há um único
 * administrador de plataforma, que é uma pessoa a sério com a password dela; um
 * teste não usa credenciais de ninguém.
 *
 * Em vez disso empresta-se o crachá: cria-se um `PlatformAdmin` ligado ao
 * `authId` da direcção de teste, corre-se o que há a correr, e apaga-se na
 * limpeza. É a mesma manobra que `test-platform-api.mjs` já faz ao trocar o
 * papel do administrador a meio — e aqui é ainda mais contida, porque a linha
 * nasce e morre dentro deste ficheiro.
 *
 * Vem **depois** da verificação do 403 de propósito: enquanto a direcção era só
 * direcção, tinha de bater com a porta fechada.
 */
const authDaDireccao = (
  await db.query(`SELECT "authId" FROM "User" WHERE email = 'direcao@lifeclub.pt' LIMIT 1`)
).rows[0]?.authId;
check("há um authId para emprestar o acesso", Boolean(authDaDireccao));

await db.query(
  `INSERT INTO "PlatformAdmin" (id, "authId", name, email, role, "isActive", "updatedAt")
   VALUES ('zb_admin', $1, 'ZB Admin de teste', 'zb-admin@teste.local', 'OWNER', true, now())`,
  [authDaDireccao],
);

console.log("\n=== O mês emite-se sozinho ===");
const admin = await login("direcao@lifeclub.pt", "academia2026");
const passe = await call(admin, "POST", `/api/platform/billing/emitir?academia=${ID}`);
check("a plataforma emite (2xx)", passe.status === 200 || passe.status === 201, `${passe.status} ${JSON.stringify(passe.body)}`);
check("e diz o período", passe.body?.period === PERIODO, JSON.stringify(passe.body));
check("com uma mensalidade criada", passe.body?.criadas === 1, JSON.stringify(passe.body));

const criadas = await naBase();
check("a linha existe na base", criadas.length === 1, `${criadas.length}`);
check("com o valor do plano", criadas[0]?.amountCents === 4500, `${criadas[0]?.amountCents}`);
check("como mensalidade (FEE)", criadas[0]?.kind === "FEE", `${criadas[0]?.kind}`);
check("por pagar", criadas[0]?.status === "OPEN", `${criadas[0]?.status}`);
/*
 * A data lê-se como texto, do próprio Postgres.
 *
 * `dueDate` é uma coluna `DATE`, e o `pg` entrega-a como um `Date` à meia-noite
 * **local**. Em Lisboa no Verão isso é 23:00 UTC do dia anterior, e um
 * `getUTCDate()` responde 11 a uma data que é 12 — a asserção acusava o produto
 * de um erro que era do teste.
 */
const vencimento = (
  await db.query(`SELECT to_char("dueDate", 'YYYY-MM-DD') AS d FROM "Charge" WHERE "academyId" = $1 AND period = $2`, [ID, PERIODO])
).rows[0]?.d;
check("e com o dia de vencimento do clube (12)", vencimento === `${PERIODO}-12`, `${vencimento}`);

const avisos = await db.query(
  `SELECT title FROM "Notification" WHERE "academyId" = $1 AND type = 'PAYMENT_PENDING'`,
  [ID],
);
check("a família foi avisada", avisos.rows.length === 1 && avisos.rows[0].title === "Nova mensalidade", JSON.stringify(avisos.rows));

/* ==================================================== idempotência ===== */

console.log("\n=== Repetir não duplica dinheiro ===");
const segundo = await call(admin, "POST", `/api/platform/billing/emitir?academia=${ID}`);
check("o segundo passe não cria nada", segundo.body?.criadas === 0, JSON.stringify(segundo.body));
check("continua a haver uma linha só", (await naBase()).length === 1);
check("e nenhum aviso novo", (await db.query(`SELECT COUNT(*)::int AS n FROM "Notification" WHERE "academyId" = $1`, [ID])).rows[0].n === 1);

/* ============================================= o calendário do clube ===== */

console.log("\n=== O calendário do clube manda ===");
await db.query(`DELETE FROM "Notification" WHERE "academyId" = $1`, [ID]);
await db.query(`DELETE FROM "Charge" WHERE "academyId" = $1`, [ID]);
await db.query(`UPDATE "Academy" SET "billingMonths" = $2 WHERE id = $1`, [ID, [OUTRO_MES]]);

const foraDoMes = await call(admin, "POST", `/api/platform/billing/emitir?academia=${ID}`);
check("um mês fora do calendário não emite", foraDoMes.body?.criadas === 0, JSON.stringify(foraDoMes.body));
check("e não há linha nenhuma", (await naBase()).length === 0);

/* ================================================== clube cancelado ===== */

console.log("\n=== Um clube cancelado fica de fora ===");
await db.query(`UPDATE "Academy" SET "billingMonths" = $2, status = 'CANCELLED' WHERE id = $1`, [ID, [MES]]);
const cancelado = await call(admin, "POST", `/api/platform/billing/emitir?academia=${ID}`);
check("não é sequer visitado", cancelado.body?.academias === 0, JSON.stringify(cancelado.body));
check("e continua sem mensalidades", (await naBase()).length === 0);

/* =========================================================== limpeza ===== */

await limpar();
const restos = (await db.query(`SELECT COUNT(*)::int AS n FROM "Academy" WHERE id = $1`, [ID])).rows[0].n;
check("\ntudo limpo no fim", restos === 0);

await db.end();
console.log(`\n${ok} OK, ${bad} FALHA${bad === 1 ? "" : "S"}`);
process.exit(bad ? 1 : 0);

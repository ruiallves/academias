#!/usr/bin/env node
/**
 * Cobrar a um atleta, a uma equipa, ou a todos.
 *
 * O pedido: *"adiciona a possibilidade de cobrar a uma família, nas contas,
 * adiciona equipas, todos ou atletas individualmente (este último já temos)"*.
 *
 * O que se guarda aqui:
 *
 * 1. Um atleta continua a funcionar como antes (`athleteId`), e a resposta diz
 *    que cobrou a um.
 * 2. `teamId` cria uma cobrança por atleta da equipa, e **só** dessa equipa.
 * 3. `todos` cria uma por atleta activo do clube — os inactivos ficam de fora,
 *    porque cobrar a quem saiu é criar dívida que ninguém paga.
 * 4. Cada cobrança avisa os encarregados activos de cada atleta, e o aviso leva
 *    o nome do atleta certo.
 * 5. Sem alvo nenhum é 400; uma equipa vazia é 404; um atleta que não existe é
 *    404 e não cria nada.
 *
 * Num clube descartável, com atletas e encarregados criados aqui (sem Supabase,
 * sem push, sem email a sair).
 *
 * Uso: API_URL=http://127.0.0.1:3011 node scripts/test-cobrar-equipa.mjs
 */
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
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

const Z = "ze-teste-cobrar";
const ZE = "ze_academia";

const login = async (email) =>
  (
    await (
      await fetch(`${S}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: { apikey: A, "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: "academia2026" }),
      })
    ).json()
  ).access_token;

const call = async (token, method, pathname, body) => {
  const r = await fetch(API + pathname, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "x-academy-slug": Z,
      "x-app": "console",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};

const db = new pg.Client({ connectionString: env("MIGRATE_DATABASE_URL"), ssl: { rejectUnauthorized: false } });
await db.connect();

const direcao = (await db.query(`SELECT id FROM "User" WHERE email = 'direcao@lifeclub.pt'`)).rows[0];

const limpar = async () => {
  await db.query(`DELETE FROM "Notification" WHERE "academyId" = $1`, [ZE]);
  await db.query(`DELETE FROM "Charge" WHERE "academyId" = $1`, [ZE]);
  await db.query(`DELETE FROM "GuardianLink" WHERE "athleteId" LIKE 'ze_%'`);
  await db.query(`DELETE FROM "TeamMembership" WHERE "athleteId" LIKE 'ze_%'`);
  await db.query(`DELETE FROM "Athlete" WHERE "academyId" = $1`, [ZE]);
  await db.query(`DELETE FROM "Team" WHERE "academyId" = $1`, [ZE]);
  await db.query(`DELETE FROM "Season" WHERE "academyId" = $1`, [ZE]);
  await db.query(`DELETE FROM "LegalAcceptance" WHERE "academyId" = $1`, [ZE]).catch(() => undefined);
  await db.query(`DELETE FROM "Membership" WHERE "academyId" = $1`, [ZE]);
  await db.query(`DELETE FROM "Sport" WHERE "academyId" = $1`, [ZE]);
  await db.query(`DELETE FROM "Academy" WHERE id = $1`, [ZE]);
  await db.query(`DELETE FROM "User" WHERE id LIKE 'ze_user_%'`);
};
await limpar();

/** As cobranças avulsas que existem, por atleta. */
const avulsas = async (titulo) =>
  (await db.query(
    `SELECT c."athleteId", a.name, c."amountCents", c.period FROM "Charge" c
       JOIN "Athlete" a ON a.id = c."athleteId"
      WHERE c."academyId" = $1 AND c.title = $2 ORDER BY a.name`,
    [ZE, titulo],
  )).rows;

const avisos = async () =>
  (await db.query(`SELECT "userId", title, body FROM "Notification" WHERE "academyId" = $1 ORDER BY "createdAt"`, [ZE])).rows;

/* Duas semanas para a frente, para o vencimento cair num mês cobrado. */
const daqui = (dias) => {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
};
const VENCIMENTO = daqui(14);

try {
  await db.query(
    `INSERT INTO "Academy" (id, slug, name, "shortName", status, "updatedAt")
     VALUES ($1, $2, 'ZE Teste Cobrar', 'ZE', 'ACTIVE', now())`, [ZE, Z],
  );
  await db.query(`INSERT INTO "Sport" (id, "academyId", name, positions, skills) VALUES ('ze_sport', $1, 'Futebol', ARRAY[]::text[], ARRAY[]::text[])`, [ZE]);
  await db.query(`INSERT INTO "Season" (id, "academyId", label, "startsOn", "endsOn", "isCurrent") VALUES ('ze_season', $1, 'época', '2026-08-01', '2027-07-31', true)`, [ZE]);
  for (const [id, nome, idade] of [["ze_team_a", "ZE Sub-15", 15], ["ze_team_b", "ZE Sub-17", 17]]) {
    await db.query(
      `INSERT INTO "Team" (id, "academyId", "sportId", "seasonId", name, "maxAge", "updatedAt") VALUES ($1, $2, 'ze_sport', 'ze_season', $3, $4, now())`,
      [id, ZE, nome, idade],
    );
  }

  /* Três na equipa A, um na B, e um que já saiu do clube. */
  const plantel = [
    ["ze_at1", "ZE Ana", "ze_team_a", "ACTIVE"],
    ["ze_at2", "ZE Bruno", "ze_team_a", "ACTIVE"],
    ["ze_at3", "ZE Carla", "ze_team_a", "ACTIVE"],
    ["ze_at4", "ZE Diogo", "ze_team_b", "ACTIVE"],
    ["ze_at5", "ZE Elsa", "ze_team_b", "LEFT"],
  ];
  for (const [id, nome, equipa, estado] of plantel) {
    await db.query(
      `INSERT INTO "Athlete" (id, "academyId", name, birthdate, status, "joinedAt", "updatedAt") VALUES ($1, $2, $3, '2011-05-05', $4, '2024-01-10', now())`,
      [id, ZE, nome, estado],
    );
    await db.query(`INSERT INTO "TeamMembership" (id, "teamId", "athleteId") VALUES ($1, $2, $3)`, [`tm_${id}`, equipa, id]);
  }

  await db.query(`INSERT INTO "Membership" (id, "academyId", "userId", role, "isActive", "updatedAt") VALUES ('ze_memb_dir', $1, $2, 'OWNER', true, now())`, [ZE, direcao.id]);

  /* Um encarregado por atleta, com conta própria (sem Supabase: nada sai daqui). */
  for (const [id] of plantel) {
    const user = `ze_user_${id}`;
    await db.query(`INSERT INTO "User" (id, "authId", name, email, "updatedAt") VALUES ($1, $2, $3, $4, now())`, [
      user, randomUUID(), `Pai de ${id}`, `${id}@teste.local`,
    ]);
    await db.query(
      `INSERT INTO "Membership" (id, "academyId", "userId", role, "isActive", "updatedAt") VALUES ($1, $2, $3, 'GUARDIAN', true, now())`,
      [`memb_${id}`, ZE, user],
    );
    await db.query(`INSERT INTO "GuardianLink" (id, "athleteId", "membershipId", relation) VALUES ($1, $2, $3, 'Pai')`, [
      `gl_${id}`, id, `memb_${id}`,
    ]);
  }

  const director = await login("direcao@lifeclub.pt");
  const pend = ((await call(director, "GET", "/api/legal/status")).body?.pending ?? []).map((d) => d.id);
  if (pend.length) {
    const aceite = await call(director, "POST", "/api/legal/accept", { documentIds: pend, confirmAuthority: true });
    check("(preparação) termos do clube aceites", aceite.status === 200 || aceite.status === 201, `${aceite.status}`);
  }

  const cobrar = (corpo) =>
    call(director, "POST", "/api/charges/avulsa", { amountCents: 1500, dueDate: VENCIMENTO, ...corpo });

  console.log("=== Um atleta, como sempre ===");
  const um = await cobrar({ athleteId: "ze_at1", title: "ZE Rifa individual" });
  check("responde (2xx)", um.status === 200 || um.status === 201, `${um.status} ${JSON.stringify(um.body).slice(0, 160)}`);
  check("cobrou a um", um.body?.cobrados === 1, `${um.body?.cobrados}`);
  const linhasUm = await avulsas("ZE Rifa individual");
  check("uma cobrança, do atleta certo", linhasUm.length === 1 && linhasUm[0].athleteId === "ze_at1", JSON.stringify(linhasUm));
  check("avisou o encarregado dele", (await avisos()).length === 1, JSON.stringify((await avisos()).map((a) => a.userId)));

  console.log("\n=== Uma equipa ===");
  const equipa = await cobrar({ teamId: "ze_team_a", title: "ZE Kit da equipa" });
  check("responde (2xx)", equipa.status === 200 || equipa.status === 201, `${equipa.status} ${JSON.stringify(equipa.body).slice(0, 160)}`);
  check("cobrou aos três da equipa", equipa.body?.cobrados === 3, `${equipa.body?.cobrados}`);
  const linhasEquipa = await avulsas("ZE Kit da equipa");
  check(
    "uma cobrança por atleta da equipa",
    linhasEquipa.map((l) => l.athleteId).sort().join(",") === "ze_at1,ze_at2,ze_at3",
    JSON.stringify(linhasEquipa.map((l) => l.athleteId)),
  );
  check("e ninguém da outra equipa", linhasEquipa.every((l) => l.athleteId !== "ze_at4"));
  check("cada uma com o valor pedido", linhasEquipa.every((l) => l.amountCents === 1500));
  check("avisou três encarregados", equipa.body?.avisados === 3, `${equipa.body?.avisados}`);
  const corpos = (await avisos()).filter((a) => a.title === "ZE Kit da equipa");
  check("e cada aviso diz o nome do seu atleta", corpos.some((a) => a.body.startsWith("ZE Ana")) && corpos.some((a) => a.body.startsWith("ZE Carla")), JSON.stringify(corpos.map((a) => a.body)));

  console.log("\n=== Todos ===");
  const todos = await cobrar({ todos: true, title: "ZE Rifa do clube" });
  check("responde (2xx)", todos.status === 200 || todos.status === 201, `${todos.status} ${JSON.stringify(todos.body).slice(0, 160)}`);
  check("cobrou aos quatro activos", todos.body?.cobrados === 4, `${todos.body?.cobrados}`);
  const linhasTodos = await avulsas("ZE Rifa do clube");
  check("e o que já saiu ficou de fora", linhasTodos.every((l) => l.athleteId !== "ze_at5"), JSON.stringify(linhasTodos.map((l) => l.athleteId)));

  console.log("\n=== O que não se deixa fazer ===");
  const semAlvo = await cobrar({ title: "ZE Sem alvo" });
  check("sem atleta, equipa ou todos é 400", semAlvo.status === 400, `${semAlvo.status} ${JSON.stringify(semAlvo.body).slice(0, 120)}`);
  const vazia = await cobrar({ teamId: "ze_team_inexistente", title: "ZE Equipa vazia" });
  check("uma equipa sem atletas é 404", vazia.status === 404, `${vazia.status}`);
  const fantasma = await cobrar({ athleteId: "ze_nao_existe", title: "ZE Fantasma" });
  check("um atleta que não existe é 404", fantasma.status === 404, `${fantasma.status}`);
  check("e não criou nada", (await avulsas("ZE Fantasma")).length === 0 && (await avulsas("ZE Equipa vazia")).length === 0);
} catch (error) {
  bad++;
  console.log("  FALHA (excepção) " + (error?.stack ?? error));
} finally {
  await limpar();
  await db.end();
}

console.log(`\n${ok} OK, ${bad} falha(s)`);
process.exit(bad ? 1 : 0);

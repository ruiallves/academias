#!/usr/bin/env node
/**
 * Apagar uma equipa.
 *
 * O que interessa provar não é que apaga — é **o que fica**: os atletas não
 * podem desaparecer com o escalão, e as mensalidades também não. Mais as
 * recusas: quem não pode, e o nome mal escrito.
 *
 * ## O caminho que este teste não via
 *
 * As contas da academia de demonstração não têm **cargo** atribuído, por isso
 * caem no mapa de permissões do código (`ROLE_PERMISSIONS`). Um clube a sério
 * tem sempre cargo — "Presidente", "Diretor" —, e aí manda a lista **guardada**
 * na linha do cargo (`basePermissions`).
 *
 * São dois caminhos diferentes para a mesma pergunta, e este teste só corria o
 * primeiro: passava a 14/14 enquanto 24 dos 26 cargos de topo da base não
 * conseguiam apagar equipa nenhuma, porque foram criados antes de `team:delete`
 * existir e guardaram a fotografia da altura. A secção do fim corre o segundo.
 *
 * A equipa de teste é criada e apagada aqui, e nunca é uma das semeadas.
 *
 * Uso: node scripts/test-delete-team.mjs
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
      "x-academy-slug": "life-club",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};

const db = new pg.Client({ connectionString: env("MIGRATE_DATABASE_URL"), ssl: { rejectUnauthorized: false } });
await db.connect();

const NOME = "ZZ Equipa Descartavel";

// Limpeza de uma corrida anterior que tenha rebentado a meio.
await db.query('DELETE FROM "Team" WHERE name = $1', [NOME]);
await db.query(`DELETE FROM "Athlete" WHERE name = 'ZZ Atleta da Equipa'`);
await db.query(`UPDATE "SubscriptionPlan" SET "teamId" = NULL WHERE name = 'ZZ Plano'`);
await db.query(`DELETE FROM "SubscriptionPlan" WHERE name = 'ZZ Plano'`);
/*
 * E o cargo da segunda metade — antes de tudo.
 *
 * Estava a ser limpo a meio do teste, e um `zzrole` deixado por uma corrida que
 * rebentou ficava agarrado à direção: a **primeira** metade passava a correr com
 * um cargo sem `team:delete` e falhava inteira, a apontar para um bug que não
 * existia. Lixo de teste que altera permissões tem de sair à entrada.
 */
await db.query(`UPDATE "Membership" SET "customRoleId" = NULL WHERE "customRoleId" = 'zzrole'`);
await db.query(`DELETE FROM "AcademyRole" WHERE id = 'zzrole'`);
await db.query(`DELETE FROM "Team" WHERE id = 'zzteam2'`);

const academia = (await db.query(`SELECT id FROM "Academy" WHERE slug = 'life-club'`)).rows[0];
const sport = (await db.query('SELECT id FROM "Sport" WHERE "academyId" = $1 LIMIT 1', [academia.id])).rows[0];
const season = (await db.query('SELECT id FROM "Season" WHERE "academyId" = $1 LIMIT 1', [academia.id])).rows[0];

await db.query(
  `INSERT INTO "Team" (id, "academyId", "sportId", "seasonId", name, "maxAge", "createdAt", "updatedAt")
   VALUES ('zzteam', $1, $2, $3, $4, 13, now(), now())`,
  [academia.id, sport.id, season.id, NOME],
);
// Um atleta na equipa — o que **não** pode desaparecer com ela.
await db.query(
  `INSERT INTO "Athlete" (id, "academyId", name, birthdate, "createdAt", "updatedAt")
   VALUES ('zzath', $1, 'ZZ Atleta da Equipa', '2014-03-01', now(), now())`,
  [academia.id],
);
await db.query(`INSERT INTO "TeamMembership" (id, "teamId", "athleteId") VALUES ('zztm','zzteam','zzath')`);
// Um treino com presenças fechadas — histórico a sério.
await db.query(
  `INSERT INTO "TrainingSession" (id, "academyId", "teamId", "startsAt", "endsAt", venue, "attendanceClosedAt", "createdAt", "updatedAt")
   VALUES ('zzts', $1, 'zzteam', '2026-09-15T18:00:00Z', '2026-09-15T19:30:00Z', 'Campo ZZ', now(), now(), now())`,
  [academia.id],
);
// Um plano de preços ligado à equipa — a chave estrangeira que rebentava.
await db.query(
  `INSERT INTO "SubscriptionPlan" (id, "academyId", "teamId", name, "amountCents")
   VALUES ('zzplan', $1, 'zzteam', 'ZZ Plano', 3000)`,
  [academia.id],
);

const director = await login("direcao@lifeclub.pt");
const coach = await login("treinador@lifeclub.pt");

console.log("=== O impacto, antes de decidir ===");
const impacto = await call(director, "GET", "/api/teams/zzteam/impacto");
check("o servidor diz o que a equipa leva atrás", impacto.status === 200, `${impacto.status}`);
check(
  "com os números certos",
  impacto.body?.atletas === 1 && impacto.body?.treinos === 1 && impacto.body?.treinosRegistados === 1,
  JSON.stringify(impacto.body),
);
check("e o plano de preços contado", impacto.body?.planos === 1);

console.log("\n=== Permissão ===");
const semPermissao = await call(coach, "DELETE", "/api/teams/zzteam", { confirmName: NOME });
check("um treinador não apaga equipas (403)", semPermissao.status === 403, `${semPermissao.status}`);

console.log("\n=== A confirmação pelo nome ===");
const nomeErrado = await call(director, "DELETE", "/api/teams/zzteam", { confirmName: "Outra Equipa" });
check("nome errado é recusado (400)", nomeErrado.status === 400, `${nomeErrado.status}`);
check("e a mensagem diz o nome certo", String(nomeErrado.body?.message ?? "").includes(NOME));
const aindaLa = await db.query(`SELECT 1 FROM "Team" WHERE id = 'zzteam'`);
check("depois da recusa a equipa continua lá", aindaLa.rowCount === 1);

console.log("\n=== Apagar ===");
const apagou = await call(director, "DELETE", "/api/teams/zzteam", { confirmName: `  ${NOME.toUpperCase()}  ` });
check("o nome confere com espaços e maiúsculas diferentes (200)", apagou.status === 200, `${apagou.status} ${JSON.stringify(apagou.body).slice(0, 140)}`);
check("a resposta diz o que se perdeu", apagou.body?.treinos === 1 && apagou.body?.atletas === 1, JSON.stringify(apagou.body));

const sumiu = await db.query(`SELECT 1 FROM "Team" WHERE id = 'zzteam'`);
check("a equipa desapareceu", sumiu.rowCount === 0);
const treino = await db.query(`SELECT 1 FROM "TrainingSession" WHERE id = 'zzts'`);
check("os treinos dela foram com ela", treino.rowCount === 0);
const ligacao = await db.query(`SELECT 1 FROM "TeamMembership" WHERE id = 'zztm'`);
check("a ligação atleta–equipa desapareceu", ligacao.rowCount === 0);

console.log("\n=== O que **não** pode desaparecer ===");
const atleta = await db.query(`SELECT 1 FROM "Athlete" WHERE id = 'zzath'`);
check("o atleta fica no clube, por atribuir", atleta.rowCount === 1);
const plano = await db.query(`SELECT "teamId" FROM "SubscriptionPlan" WHERE id = 'zzplan'`);
check("o plano de preços fica, desligado da equipa", plano.rowCount === 1 && plano.rows[0].teamId === null, JSON.stringify(plano.rows[0]));

console.log("\n=== Com um cargo atribuído — o caminho dos clubes a sério ===");
/*
 * A direção passa a ter um cargo cujas permissões estão **guardadas na linha**,
 * como acontece em qualquer clube real. A lista é a do mapa do código para
 * OWNER, que é o que a semeadura faz — e é o caminho que estava partido.
 */
const membroId = (await db.query(
  `SELECT m.id FROM "Membership" m
     JOIN "User" u ON u.id = m."userId"
    WHERE u.email = 'direcao@lifeclub.pt' LIMIT 1`,
)).rows[0]?.id;
const cargoAnterior = (await db.query(`SELECT "customRoleId" FROM "Membership" WHERE id = $1`, [membroId])).rows[0]
  ?.customRoleId ?? null;

// O cargo é criado com a lista que a semeadura daria hoje, menos `team:delete` —
// que é exactamente o estado em que os 24 cargos da base estavam.
await db.query(
  `INSERT INTO "AcademyRole" (id, "academyId", key, name, "baseRole", permissions, "navKeys", "isSystem", rank, "createdAt", "updatedAt")
   SELECT 'zzrole', $1, 'zz-diretor', 'ZZ Diretor', 'DIRECTOR',
          ARRAY(SELECT DISTINCT p FROM unnest(r.permissions) p WHERE p <> 'team:delete'),
          ARRAY[]::text[], false, 20, now(), now()
     FROM "AcademyRole" r
    WHERE r."academyId" = $1 AND r."baseRole" IN ('OWNER','DIRECTOR')
      AND r.permissions @> ARRAY['team:write']
    LIMIT 1`,
  [academia.id],
);
await db.query(`UPDATE "Membership" SET "customRoleId" = 'zzrole' WHERE id = $1`, [membroId]);

const semCargo = await call(director, "GET", "/api/teams");
check("a sessão continua a abrir com o cargo posto", semCargo.status === 200, `${semCargo.status}`);

/*
 * Uma equipa nova para esta metade — a primeira já foi apagada lá em cima.
 */
await db.query(
  `INSERT INTO "Team" (id, "academyId", "sportId", "seasonId", name, "maxAge", "createdAt", "updatedAt")
   VALUES ('zzteam2', $1, $2, $3, 'ZZ Equipa Cargo', 13, now(), now())`,
  [academia.id, sport.id, season.id],
);

const cargoSemDelete = await call(director, "DELETE", "/api/teams/zzteam2", { confirmName: "ZZ Equipa Cargo" });
check(
  "um cargo sem 'team:delete' é recusado (403) — era isto que os clubes viam",
  cargoSemDelete.status === 403,
  `${cargoSemDelete.status}`,
);

// E agora com a permissão no cargo, que é o que a migração `20260831120000` fez.
await db.query(
  `UPDATE "AcademyRole" SET permissions = ARRAY(SELECT DISTINCT p FROM unnest(permissions || ARRAY['team:delete']) p) WHERE id = 'zzrole'`,
);
const comPermissao = await call(director, "DELETE", "/api/teams/zzteam2", { confirmName: "ZZ Equipa Cargo" });
check("com a permissão no cargo, apaga (200)", comPermissao.status === 200, `${comPermissao.status} ${JSON.stringify(comPermissao.body).slice(0, 120)}`);
check("e a equipa desapareceu", (await db.query(`SELECT 1 FROM "Team" WHERE id = 'zzteam2'`)).rowCount === 0);

/*
 * O que o cliente recebe tem de dizer o mesmo que o servidor faz — senão o botão
 * aparece e a acção falha, ou o contrário. `GET /api/me` devolve as permissões
 * resolvidas, e é delas que sai o botão na ficha da equipa.
 */
const boot = await call(director, "GET", "/api/bootstrap");
check(
  "e o arranque do cliente traz a permissão — o botão aparece",
  (boot.body?.me?.permissions ?? []).includes("team:delete"),
  `${boot.status} · ${(boot.body?.me?.permissions ?? []).length} permissões`,
);

// Limpeza.
await db.query(`UPDATE "Membership" SET "customRoleId" = $2 WHERE id = $1`, [membroId, cargoAnterior]);
await db.query(`DELETE FROM "AcademyRole" WHERE id = 'zzrole'`);
await db.query(`DELETE FROM "Team" WHERE id = 'zzteam2'`);
await db.query(`DELETE FROM "SubscriptionPlan" WHERE id = 'zzplan'`);
await db.query(`DELETE FROM "Athlete" WHERE id = 'zzath'`);

await db.end();
console.log(`\n${ok} passaram, ${bad} falharam`);
process.exit(bad ? 1 : 0);

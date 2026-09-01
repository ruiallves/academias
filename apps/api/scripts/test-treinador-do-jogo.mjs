#!/usr/bin/env node
/**
 * De quem é este jogo?
 *
 * ## O bug
 *
 * Um jogo marcado no calendário aparecia **sempre** "sem treinador", tivesse a
 * equipa treinador ou não. Atribuir um treinador à equipa a seguir não mudava
 * nada — e a leitura óbvia de quem estava a usar era "o calendário não
 * actualiza". Não era: o jogo nunca chegava a perguntar por treinador nenhum.
 *
 * Duas omissões em fila, cada uma suficiente sozinha:
 *
 * 1. `MatchesService.list` não trazia o treinador nem recorria ao da equipa. Os
 *    treinos e os eventos genéricos faziam-no desde sempre — os jogos ficaram de
 *    fora porque `headCoaches` era privado do `AcademyService`, e os jogos vivem
 *    noutro serviço. Não foi decisão nenhuma: foi distância.
 * 2. `fromApiMatch`, no cliente, não mapeava os campos. Mesmo que a API os
 *    mandasse, a gaveta continuava a dizer "sem treinador atribuído".
 *
 * ## O que se guarda aqui
 *
 * Que o treinador é **derivado na leitura**, e não fotografado quando o jogo é
 * marcado. É a diferença entre atribuir um treinador e ver o calendário arrumar-se
 * sozinho, ou ter de reabrir jogo a jogo.
 *
 * Uso: node scripts/test-treinador-do-jogo.mjs
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
      "x-app": "console",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};

const db = new pg.Client({ connectionString: env("MIGRATE_DATABASE_URL"), ssl: { rejectUnauthorized: false } });
await db.connect();

const limpar = async () => {
  await db.query(`DELETE FROM "Match" WHERE opponent LIKE 'ZT %'`);
  await db.query(`DELETE FROM "TrainingSession" WHERE "teamId" IN (SELECT id FROM "Team" WHERE name LIKE 'ZT %')`);
  await db.query(`DELETE FROM "TeamStaff" WHERE "teamId" IN (SELECT id FROM "Team" WHERE name LIKE 'ZT %')`);
  await db.query(`DELETE FROM "Team" WHERE name LIKE 'ZT %'`);
  await db.query(`DELETE FROM "CatalogItem" WHERE label LIKE 'ZT %'`);
};
await limpar();

const director = await login("direcao@lifeclub.pt");

const academia = (await db.query(`SELECT id FROM "Academy" WHERE slug = 'life-club'`)).rows[0].id;
const sport = (await db.query(`SELECT id FROM "Sport" WHERE "academyId" = $1 LIMIT 1`, [academia])).rows[0];
const season = (await db.query(`SELECT id FROM "Season" WHERE "academyId" = $1 LIMIT 1`, [academia])).rows[0];

/* Uma equipa nova, deliberadamente **sem** treinador nenhum. */
await db.query(
  `INSERT INTO "Team" (id, "academyId", "sportId", "seasonId", name, "maxAge", "createdAt", "updatedAt")
   VALUES ('ztteam', $1, $2, $3, 'ZT Equipa Sem Treinador', 13, now(), now())`,
  [academia, sport.id, season.id],
);
const prova = await call(director, "POST", "/api/catalogs", { kind: "competitions", label: "ZT Amigável" });
const provaId = (await db.query(`SELECT id FROM "CatalogItem" WHERE label = 'ZT Amigável'`)).rows[0].id;
await db.query(
  `INSERT INTO "TeamCompetition" (id, "teamId", "competitionId") VALUES ('ztcomp', 'ztteam', $1)`,
  [provaId],
);
check("a equipa e a prova de teste existem", prova.status === 201 || prova.status === 200, `${prova.status}`);

/* Um jogo e um treino, marcados enquanto a equipa não tem treinador. */
const jogo = await call(director, "POST", "/api/events", {
  kind: "MATCH",
  teamId: "ztteam",
  title: "ZT Jogo",
  opponent: "ZT Adversario",
  startsAt: "2026-09-19T15:00:00.000Z",
  endsAt: "2026-09-19T16:30:00.000Z",
  venue: "Campo ZT",
  competitionId: provaId,
});
check("o jogo é marcado", jogo.status === 201, `${jogo.status} ${JSON.stringify(jogo.body).slice(0, 120)}`);
const jogoId = jogo.body.events[0].id;

const treino = await call(director, "POST", "/api/events", {
  kind: "TRAINING",
  teamId: "ztteam",
  title: "ZT Treino",
  startsAt: "2026-09-17T18:00:00.000Z",
  endsAt: "2026-09-17T19:30:00.000Z",
  venue: "Campo ZT",
});
check("e o treino também", treino.status === 201, `${treino.status}`);

/*
 * A lista traz, por omissão, de trinta dias atrás a noventa à frente — e é essa
 * a lista que o calendário consome. As datas de teste ficam lá dentro de
 * propósito: um jogo fora da janela não é um jogo sem treinador, é um jogo que a
 * lista não devolve, e confundir as duas coisas dava um teste a acusar o código
 * de um bug que não tem.
 */
const doJogo = async () => (await call(director, "GET", "/api/matches")).body.find((m) => m.id === jogoId);
/*
 * O treino não vem de `/api/events`: um treino vive na sua tabela, e `/api/events`
 * é só dos eventos genéricos do calendário. Três tabelas, três leituras — é a
 * mesma razão por que o `headCoaches` teve de sair de um serviço só.
 */
const doTreino = async () =>
  (await call(director, "GET", "/api/sessions?from=2026-09-01T00:00:00.000Z&to=2026-09-30T23:59:59.000Z")).body.find(
    (e) => e.id === treino.body.events[0].id,
  );

console.log("=== Sem treinador na equipa ===");
const semTreinador = await doJogo();
check("o jogo diz que não tem treinador", semTreinador?.coachName === null, JSON.stringify(semTreinador?.coachName));
check("e o campo existe na resposta", "coachId" in (semTreinador ?? {}), Object.keys(semTreinador ?? {}).join(","));

console.log("\n=== Atribui-se um treinador à equipa ===");
/*
 * O gesto que o utilizador fez e que não teve efeito nenhum: pôr um treinador na
 * ficha da equipa, com o jogo já marcado.
 */
const treinador = (await db.query(
  `SELECT m.id, u.name FROM "Membership" m JOIN "User" u ON u.id = m."userId"
    WHERE m."academyId" = $1 AND m.role = 'COACH' AND m."isActive" LIMIT 1`,
  [academia],
)).rows[0];

await db.query(
  `INSERT INTO "TeamStaff" (id, "teamId", "membershipId", title)
   VALUES ('ztstaff', 'ztteam', $1, 'Treinador principal')`,
  [treinador.id],
);

const comTreinador = await doJogo();
check(
  `o jogo passa a mostrá-lo (${treinador.name})`,
  comTreinador?.coachName === treinador.name,
  JSON.stringify(comTreinador?.coachName),
);
check("com o id, para a interface o poder ligar à ficha", comTreinador?.coachId === treinador.id, JSON.stringify(comTreinador?.coachId));

/*
 * Sem tocar no jogo. É o ponto todo: o treinador é derivado na leitura, e não
 * fotografado quando o jogo foi marcado — senão atribuir um treinador em
 * Setembro deixava os jogos de Agosto a dizer "sem treinador" para sempre.
 */
const naBase = await db.query(`SELECT "coachId" FROM "Match" WHERE id = $1`, [jogoId]);
check("e o jogo na base continua sem treinador próprio", naBase.rows[0].coachId === null, JSON.stringify(naBase.rows[0]));

console.log("\n=== O treino comportava-se assim desde sempre ===");
const treinoAgora = await doTreino();
check("o treino mostra o mesmo treinador", treinoAgora?.coachName === treinador.name, JSON.stringify(treinoAgora?.coachName));
check("os dois concordam — é a mesma equipa", treinoAgora?.coachId === comTreinador?.coachId);

console.log("\n=== A ficha do jogo diz o mesmo que a lista ===");
const ficha = await call(director, "GET", `/api/matches/${jogoId}`);
check("a ficha herda-o também", ficha.body?.coachName === treinador.name, JSON.stringify(ficha.body?.coachName));

console.log("\n=== O treinador do jogo ganha ao da equipa ===");
/*
 * Um jogo pode ter treinador próprio — o adjunto que dirige aquele jogo porque o
 * principal está de castigo. Quando o tem, é esse que manda.
 */
const outro = (await db.query(
  `SELECT m.id, u.name FROM "Membership" m JOIN "User" u ON u.id = m."userId"
    WHERE m."academyId" = $1 AND m.role = 'COACH' AND m."isActive" AND m.id <> $2 LIMIT 1`,
  [academia, treinador.id],
)).rows[0];

if (outro) {
  await db.query(`UPDATE "Match" SET "coachId" = $2 WHERE id = $1`, [jogoId, outro.id]);
  const comProprio = await doJogo();
  check(`o do jogo manda (${outro.name})`, comProprio?.coachName === outro.name, JSON.stringify(comProprio?.coachName));
  await db.query(`UPDATE "Match" SET "coachId" = NULL WHERE id = $1`, [jogoId]);
} else {
  console.log("  (só há um treinador nesta academia — salto)");
}

console.log("\n=== Tirar o treinador da equipa ===");
// O caminho de volta: o calendário desactualiza-se para o outro lado também.
await db.query(`DELETE FROM "TeamStaff" WHERE id = 'ztstaff'`);
const semOutraVez = await doJogo();
check("o jogo volta a dizer que não tem", semOutraVez?.coachName === null, JSON.stringify(semOutraVez?.coachName));

/* ------------------------------------------------------------------ limpeza */
await limpar();
await db.end();
console.log(`\n${ok} passaram, ${bad} falharam`);
process.exit(bad ? 1 : 0);

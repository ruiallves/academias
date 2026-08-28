#!/usr/bin/env node
/**
 * Tirar alguém de uma equipa tira-o dos treinos que ainda não aconteceram.
 *
 * ## O bug
 *
 * `setTeams` apagava a linha de `TeamStaff` e mais nada. O
 * `TrainingSession.coachId` continuava a apontar para a pessoa, e o calendário
 * desenhava o nome dela nos treinos de uma equipa onde já não trabalha — sem
 * nada que o explicasse, e sem forma de o corrigir, porque a página de onde se
 * removeu já dizia que ela tinha saído.
 *
 * ## A linha que este teste protege
 *
 * O passado **não** se limpa. Um treino de há duas semanas foi dado por quem lá
 * está escrito, e foi essa pessoa que lhe fechou as presenças. Apagar isso era
 * reescrever o passado para arrumar o presente — e é o erro fácil de cometer ao
 * corrigir este bug com um `updateMany` sem condição de data.
 *
 * Uso: node scripts/test-treinador-sai-da-equipa.mjs
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
const API = "http://localhost:3000";

let ok = 0, bad = 0;
const check = (l, c, d = "") => {
  if (c) { ok++; console.log("  OK    " + l); }
  else { bad++; console.log("  FALHA " + l + (d ? " — " + d : "")); }
};

const login = async (email) =>
  (await (await fetch(`${S}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: A, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "academia2026" }),
  })).json()).access_token;

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

const academia = (await db.query(`SELECT id FROM "Academy" WHERE slug = 'life-club'`)).rows[0].id;

/*
 * Uma equipa só deste teste, e não o Sub-13 a sério.
 *
 * A primeira versão usava o Sub-13 e falhou por uma boa razão: aquela equipa tem
 * um adjunto, e ao tirar o treinador principal o calendário passou a mostrar o
 * adjunto — que é o comportamento certo, e não o que se quer medir aqui. Para
 * ver que o treino fica **sem ninguém**, a equipa não pode ter mais ninguém.
 */
const equipa = "zz_t_treinador";
const treinador = (await db.query(
  `SELECT m.id FROM "Membership" m JOIN "User" u ON u.id = m."userId"
    WHERE m."academyId" = $1 AND u.email = 'treinador@lifeclub.pt'`,
  [academia],
)).rows[0].id;

/* As equipas com que este treinador entrou — repostas no fim. */
const equipasOriginais = (await db.query(
  `SELECT "teamId", title FROM "TeamStaff" WHERE "membershipId" = $1`, [treinador],
)).rows;

const limpar = async () => {
  await db.query(`DELETE FROM "TrainingSession" WHERE venue = 'ZZ Campo'`);
  await db.query(`DELETE FROM "TeamStaff" WHERE "teamId" = $1`, [equipa]);
  await db.query(`DELETE FROM "Team" WHERE id = $1`, [equipa]);
};
await limpar();

const modelo = (await db.query(
  `SELECT "sportId", "seasonId" FROM "Team" WHERE "academyId" = $1 LIMIT 1`, [academia],
)).rows[0];
await db.query(
  `INSERT INTO "Team" (id, "academyId", "sportId", "seasonId", name, "maxAge", "updatedAt")
   VALUES ($1, $2, $3, $4, 'ZZ Equipa do Treinador', 13, now())`,
  [equipa, academia, modelo.sportId, modelo.seasonId],
);

const director = await login("direcao@lifeclub.pt");

async function repor() {
  await limpar();
  await call(director, "PATCH", `/api/staff/${treinador}/teams`, {
    teamIds: equipasOriginais.map((e) => e.teamId),
  });
  for (const e of equipasOriginais) {
    await db.query(`UPDATE "TeamStaff" SET title = $1 WHERE "membershipId" = $2 AND "teamId" = $3`,
      [e.title, treinador, e.teamId]);
  }
}

const semear = (rotulo, dias) =>
  db.query(
    `INSERT INTO "TrainingSession" (id, "academyId", "teamId", "coachId", "startsAt", "endsAt", venue, status, "updatedAt")
     VALUES ($1, $2, $3, $4, now() + make_interval(days => $5), now() + make_interval(days => $5) + interval '90 min',
             'ZZ Campo', 'SCHEDULED', now())`,
    [rotulo, academia, equipa, treinador, dias],
  );

const coachDe = async (id) =>
  (await db.query(`SELECT "coachId" FROM "TrainingSession" WHERE id = $1`, [id])).rows[0]?.coachId ?? null;

try {
  console.log("=== O treinador está na equipa e dá treinos ===");
  await call(director, "PATCH", `/api/staff/${treinador}/teams`, {
    teamIds: [...new Set([...equipasOriginais.map((e) => e.teamId), equipa])],
  });
  await semear("zz_passado", -14);
  await semear("zz_futuro", 7);

  check("o treino passado é dele", (await coachDe("zz_passado")) === treinador, "");
  check("o treino futuro também", (await coachDe("zz_futuro")) === treinador, "");

  console.log("\n=== Tira-se da equipa ===");
  const fora = (await call(director, "PATCH", `/api/staff/${treinador}/teams`, {
    teamIds: equipasOriginais.map((e) => e.teamId).filter((t) => t !== equipa),
  }));
  check("a direção remove-o (200)", fora.status === 200, `${fora.status}`);
  const aindaNaEquipa = (await db.query(
    `SELECT count(*)::int n FROM "TeamStaff" WHERE "membershipId" = $1 AND "teamId" = $2`, [treinador, equipa],
  )).rows[0].n;
  check("e saiu mesmo do staff da equipa", aindaNaEquipa === 0, `${aindaNaEquipa}`);

  console.log("\n=== O treino futuro fica por atribuir ===");
  check("deixou de ter treinador", (await coachDe("zz_futuro")) === null, `${await coachDe("zz_futuro")}`);

  console.log("\n=== E o passado fica como aconteceu ===");
  /*
   * A linha que separa corrigir de reescrever. Aquele treino foi dado por ele.
   */
  check("o treino passado continua a ser dele", (await coachDe("zz_passado")) === treinador, `${await coachDe("zz_passado")}`);

  console.log("\n=== O calendário deixa de o mostrar ===");
  /*
   * É o que o utilizador via: o nome dele no evento, depois de o ter removido.
   * O `coachName` é achatado no servidor a partir do treino ou, na falta dele,
   * do treinador da equipa — por isso a verificação tem de ser feita na resposta
   * da API e não só na coluna.
   */
  const sessoes = await call(director, "GET", "/api/sessions");
  const futuro = (sessoes.body ?? []).find((x) => x.id === "zz_futuro");
  check("a API devolve o treino futuro", Boolean(futuro), "");
  check("sem treinador atribuído", futuro?.coachId === null && futuro?.coachName === null, JSON.stringify({ id: futuro?.coachId, nome: futuro?.coachName }));

  const passado = (sessoes.body ?? []).find((x) => x.id === "zz_passado");
  check("e o passado continua com o nome dele", passado?.coachId === treinador, JSON.stringify(passado?.coachName));

  console.log("\n=== Voltar a pô-lo na equipa não ressuscita nada ===");
  /*
   * O treino futuro ficou sem treinador — não fica "com o próximo que entrar".
   * Reatribuir é um gesto, e é na página da equipa que se faz.
   */
  await call(director, "PATCH", `/api/staff/${treinador}/teams`, {
    teamIds: [...new Set([...equipasOriginais.map((e) => e.teamId), equipa])],
  });
  check("o treino futuro continua por atribuir", (await coachDe("zz_futuro")) === null, `${await coachDe("zz_futuro")}`);
  /*
   * Mas o calendário volta a mostrar um nome — o do treinador **da equipa**, que
   * é o que a serialização usa quando o treino não tem um próprio. É a resposta
   * certa: quem treina o Sub-13 dá os treinos do Sub-13.
   */
  const outraVez = await call(director, "GET", "/api/sessions");
  const agora = (outraVez.body ?? []).find((x) => x.id === "zz_futuro");
  check("mas o calendário volta a mostrar o treinador da equipa", agora?.coachId === treinador, JSON.stringify(agora?.coachName));
} finally {
  console.log("\n=== Repor o estado original ===");
  await repor();
  const final = (await db.query(
    `SELECT count(*)::int n FROM "TeamStaff" WHERE "membershipId" = $1`, [treinador],
  )).rows[0].n;
  check("as equipas do treinador voltaram ao que eram", final === equipasOriginais.length, `${final} vs ${equipasOriginais.length}`);
  await db.end();
}

console.log(`\n${ok} passaram, ${bad} falharam`);
process.exit(bad === 0 ? 0 : 1);

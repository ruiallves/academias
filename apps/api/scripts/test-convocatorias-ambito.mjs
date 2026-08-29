#!/usr/bin/env node
/**
 * A fila de convocatórias é a minha, e é do que ainda não começou.
 *
 * ## Os dois bugs
 *
 *  1. **Jogos de equipas alheias.** A página listava tudo o que `/api/matches`
 *     devolve — e essa lista traz o clube inteiro **de propósito**: um treinador
 *     tem de saber quando joga o escalão de cima e onde (ver
 *     `calendarScopeFilter`). Está certo num calendário e errado numa fila de
 *     trabalho: um jogo dos Sub-13 na fila de quem não treina os Sub-13 é
 *     trabalho de outra pessoa, e a lista de convocáveis nem sequer lhe abre.
 *
 *  2. **Jogos já disputados.** Havia seis horas de tolerância depois do apito
 *     inicial. Um jogo de manhã aparecia por convocar à tarde, num sítio onde
 *     tudo o que lá está é uma coisa por fazer.
 *
 * ## O que este teste protege
 *
 * A distinção entre as duas listas: `/api/matches` **tem** de continuar a trazer
 * os jogos das outras equipas (é o calendário do clube), e é a bandeira `mine`
 * que separa o que se vê do que se faz. Um teste que exigisse a lista filtrada
 * no servidor partiria o calendário para consertar a fila.
 *
 * Uso: node scripts/test-convocatorias-ambito.mjs
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

const call = async (token, pathname) => {
  const r = await fetch(API + pathname, {
    headers: { Authorization: `Bearer ${token}`, "x-academy-slug": "life-club" },
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};

const db = new pg.Client({ connectionString: env("MIGRATE_DATABASE_URL"), ssl: { rejectUnauthorized: false } });
await db.connect();

const academia = (await db.query(`SELECT id FROM "Academy" WHERE slug = 'life-club'`)).rows[0].id;
const treinador = (await db.query(
  `SELECT m.id FROM "Membership" m JOIN "User" u ON u.id = m."userId"
    WHERE m."academyId" = $1 AND u.email = 'treinador@lifeclub.pt'`,
  [academia],
)).rows[0].id;

/** Uma equipa dele, e uma que não é — as duas descobertas, não escritas à mão. */
const minha = (await db.query(
  `SELECT "teamId" FROM "TeamStaff" WHERE "membershipId" = $1 LIMIT 1`, [treinador],
)).rows[0]?.teamId;
const alheia = (await db.query(
  `SELECT t.id FROM "Team" t
    WHERE t."academyId" = $1
      AND NOT EXISTS (SELECT 1 FROM "TeamStaff" ts WHERE ts."teamId" = t.id AND ts."membershipId" = $2)
    LIMIT 1`,
  [academia, treinador],
)).rows[0]?.id;

const limpar = () => db.query(`DELETE FROM "Match" WHERE opponent LIKE 'ZZ %'`);
await limpar();

/** `horas` negativas = já disputado. */
const semear = (id, teamId, horas) =>
  db.query(
    `INSERT INTO "Match" (id, "academyId", "teamId", opponent, "isHome", "startsAt", "endsAt", venue, status, "updatedAt")
     VALUES ($1, $2, $3, $4, true, now() + make_interval(hours => $5),
             now() + make_interval(hours => $5) + interval '90 min', 'ZZ Campo', 'SCHEDULED', now())`,
    [id, academia, teamId, `ZZ Adversário ${id}`, horas],
  );

try {
  check("o treinador tem uma equipa", Boolean(minha), `${minha}`);
  check("e há uma equipa que não é dele", Boolean(alheia), `${alheia}`);

  await semear("zz_m_futuro", minha, 48);
  await semear("zz_m_manha", minha, -5);      // disputado hoje de manhã
  await semear("zz_m_alheio", alheia, 48);

  const token = await login("treinador@lifeclub.pt");
  const jogos = await call(token, "/api/matches");
  check("a API responde", jogos.status === 200, `${jogos.status}`);

  const por = (id) => (jogos.body ?? []).find((m) => m.id === id);

  console.log("\n=== O calendário continua a ser do clube ===");
  /*
   * Esta é a parte que **não** se conserta: o treinador tem de ver o jogo do
   * escalão de cima. O que muda é o que se faz com essa informação.
   */
  check("o jogo da outra equipa vem na lista", Boolean(por("zz_m_alheio")), "");
  check("mas marcado como não sendo dele", por("zz_m_alheio")?.mine === false, `${por("zz_m_alheio")?.mine}`);
  check("e os dele marcados como dele", por("zz_m_futuro")?.mine === true, `${por("zz_m_futuro")?.mine}`);

  console.log("\n=== A fila de convocatórias, como o cliente a calcula ===");
  /*
   * A regra do `upcomingMatches`, aplicada aqui à resposta real da API. Sem
   * isto, o teste provava o servidor e deixava de fora a linha que estava errada.
   */
  const agora = Date.now();
  const fila = (jogos.body ?? [])
    .filter((m) => m.mine)
    .filter((m) => m.status === "SCHEDULED" && new Date(m.startsAt).getTime() >= agora);
  const ids = fila.map((m) => m.id);

  check("o jogo por disputar da minha equipa entra", ids.includes("zz_m_futuro"), ids.join(","));
  check("o da outra equipa não entra", !ids.includes("zz_m_alheio"), ids.join(","));
  check("e o que já se jogou hoje de manhã também não", !ids.includes("zz_m_manha"), ids.join(","));

  console.log("\n=== E a tolerância antiga deixava-o entrar ===");
  /*
   * A contraprova do segundo bug: com as seis horas de folga que lá estavam, o
   * jogo da manhã passava. É o que o utilizador via.
   */
  const comTolerancia = (jogos.body ?? [])
    .filter((m) => m.mine)
    .filter((m) => m.status === "SCHEDULED" && new Date(m.startsAt).getTime() >= agora - 6 * 3600_000)
    .map((m) => m.id);
  check("a regra antiga mostrava-o", comTolerancia.includes("zz_m_manha"), comTolerancia.join(","));

  console.log("\n=== A direção vê tudo ===");
  const direcao = await login("direcao@lifeclub.pt");
  const daDirecao = await call(direcao, "/api/matches");
  const seus = (daDirecao.body ?? []).filter((m) => m.id.startsWith("zz_m_"));
  check("os três jogos são dela", seus.length === 3 && seus.every((m) => m.mine), `${seus.length}`);
} finally {
  console.log("\n=== Limpeza ===");
  await limpar();
  const sobra = (await db.query(`SELECT count(*)::int n FROM "Match" WHERE opponent LIKE 'ZZ %'`)).rows[0].n;
  check("sem jogos de teste na base", sobra === 0, `${sobra}`);
  await db.end();
}

console.log(`\n${ok} passaram, ${bad} falharam`);
process.exit(bad === 0 ? 0 : 1);

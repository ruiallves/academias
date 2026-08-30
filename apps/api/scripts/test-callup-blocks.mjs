#!/usr/bin/env node
/**
 * Quem está de baixa não é convocado — e o treinador sabe-o **antes** de guardar.
 *
 * ## O bug que deu origem a isto
 *
 * O servidor mandava `availability` e `restriction` em cada atleta e o store da
 * consola deitava-os fora: `athlete.clinical` ficava sempre vazio, ninguém
 * aparecia bloqueado no plantel, e o treinador montava a convocatória inteira
 * para levar com "a Matilde está de baixa" ao carregar em guardar — com um nome
 * que ele não fazia ideia de porque estava ali.
 *
 * Este teste fixa as duas metades:
 *
 *  1. **A recusa do servidor**, que é a fronteira a sério.
 *  2. **O que o cliente precisa para avisar antes** — que o `/api/athletes`
 *     traga a disponibilidade e a restrição de cada atleta, incluindo a um
 *     treinador. Sem isso a interface fica cega, que foi exactamente o que
 *     aconteceu.
 *
 * Uso: node scripts/test-callup-blocks.mjs
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

const coach = await login("treinador@lifeclub.pt");

/* ---------------------------------------------------------------- preparação */

// Um jogo futuro do Sub-11, e dois atletas dessa equipa: um são, um a lesionar.
// O id da academia lê-se — escrevê-lo à mão é assumir uma semente em concreto.
const academia = (await db.query(`SELECT id FROM "Academy" WHERE slug = 'life-club'`)).rows[0];
if (!academia) throw new Error("Corre `npm run seed` — falta a academia de demonstração.");
const equipa = (await db.query(`SELECT id, name FROM "Team" WHERE id = 't_sub11'`)).rows[0];
const plantel = (
  await db.query(
    `SELECT a.id, a.name FROM "Athlete" a
       JOIN "TeamMembership" tm ON tm."athleteId" = a.id
      WHERE tm."teamId" = $1 AND a.status = 'ACTIVE' ORDER BY a.name LIMIT 2`,
    [equipa.id],
  )
).rows;
if (plantel.length < 2) throw new Error("Corre `npm run seed` — o Sub-11 precisa de dois atletas.");
const [sao, lesionado] = plantel;

await db.query(`DELETE FROM "ClinicalEntry" WHERE id = 'zzclin'`);
await db.query(`DELETE FROM "Match" WHERE opponent = 'ZZ Adversario Baixa'`);
const jogo = (
  await db.query(
    `INSERT INTO "Match" (id, "academyId", "teamId", "startsAt", "endsAt", venue, opponent, "isHome", "createdAt", "updatedAt")
     VALUES ('zzmatch', $2, $1, now() + interval '7 days', now() + interval '7 days 2 hours',
             'Campo ZZ', 'ZZ Adversario Baixa', true, now(), now())
     RETURNING id`,
    [equipa.id, academia.id],
  )
).rows[0];

console.log("=== Sem baixa, convoca-se ===");
const semBaixa = await call(coach, "POST", `/api/matches/${jogo.id}/convocatoria`, {
  athleteIds: [sao.id, lesionado.id],
});
check("os dois entram na convocatória", semBaixa.status === 200 || semBaixa.status === 201, `${semBaixa.status}`);

/* ------------------------------------------------------------ dar-lhe baixa */
await db.query(
  `INSERT INTO "ClinicalEntry" (id, "academyId", "athleteId", kind, status, date, title, impact, "createdAt", "updatedAt")
   VALUES ('zzclin', $2, $1, 'INJURY', 'DONE', now()::date, 'ZZ Lesão de teste', 'OUT', now(), now())`,
  [lesionado.id, academia.id],
);

console.log("\n=== Com baixa, o servidor recusa ===");
const comBaixa = await call(coach, "POST", `/api/matches/${jogo.id}/convocatoria`, {
  athleteIds: [sao.id, lesionado.id],
});
check("a convocatória é recusada (400)", comBaixa.status === 400, `${comBaixa.status}`);
check(
  "e a mensagem diz o nome de quem está parado",
  String(comBaixa.body?.message ?? "").includes(lesionado.name),
  JSON.stringify(comBaixa.body?.message),
);

const soOSao = await call(coach, "POST", `/api/matches/${jogo.id}/convocatoria`, { athleteIds: [sao.id] });
check("sem ele, a convocatória passa", soOSao.status === 200 || soOSao.status === 201, `${soOSao.status}`);

console.log("\n=== O que o cliente precisa para avisar antes ===");
/*
 * É esta a metade que faltava. A interface bloqueia a partir de
 * `athlete.clinical`, que o store monta a partir daqui — se o `/api/athletes`
 * não trouxer a disponibilidade, o plantel fica todo seleccionável e o erro só
 * aparece no fim.
 */
const atletas = await call(coach, "GET", "/api/athletes");
const oLesionado = (atletas.body ?? []).find((a) => a.id === lesionado.id);
const oSao = (atletas.body ?? []).find((a) => a.id === sao.id);

check("o treinador recebe a lista de atletas", Array.isArray(atletas.body), `${atletas.status}`);
check("quem está de baixa vem marcado como `out`", oLesionado?.availability === "out", `${oLesionado?.availability}`);
check("com a restrição que a explica", Boolean(oLesionado?.restriction), JSON.stringify(oLesionado?.restriction));
check(
  "e o motivo, porque o treinador tem `clinical:read`",
  oLesionado?.restriction?.title === "ZZ Lesão de teste",
  JSON.stringify(oLesionado?.restriction?.title),
);
check("quem está bom vem `available` e sem restrição", oSao?.availability === "available" && oSao?.restriction === null);

console.log("\n=== Dar alta liberta-o ===");
await db.query(`UPDATE "ClinicalEntry" SET "clearedOn" = now()::date WHERE id = 'zzclin'`);
const depoisDaAlta = await call(coach, "POST", `/api/matches/${jogo.id}/convocatoria`, {
  athleteIds: [sao.id, lesionado.id],
});
check("com alta dada, volta a poder ser convocado", depoisDaAlta.status === 200 || depoisDaAlta.status === 201, `${depoisDaAlta.status}`);
const depois = await call(coach, "GET", "/api/athletes");
check(
  "e a lista deixa de o marcar",
  (depois.body ?? []).find((a) => a.id === lesionado.id)?.availability === "available",
);

/* ------------------------------------------------------------------ limpeza */
await db.query(`DELETE FROM "ClinicalEntry" WHERE id = 'zzclin'`);
await db.query(`DELETE FROM "MatchCallUp" WHERE "matchId" = 'zzmatch'`);
await db.query(`DELETE FROM "Match" WHERE id = 'zzmatch'`);

await db.end();
console.log(`\n${ok} passaram, ${bad} falharam`);
process.exit(bad ? 1 : 0);

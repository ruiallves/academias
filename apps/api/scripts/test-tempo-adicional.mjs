#!/usr/bin/env node
/**
 * O tempo adicional de um jogo, por parte.
 *
 * - no futebol grava-se, por parte, e a página do jogo devolve-o;
 * - no futsal e no basquetebol (cronómetro parado) é recusado;
 * - mais partes do que a modalidade tem, minutos fora de 0 a 30 e um jogo que
 *   ainda não começou são recusados; a família não grava.
 *
 * Em jogos criados aqui no Life Club, apagados no fim.
 *
 * Uso: API_URL=http://localhost:3012 node scripts/test-tempo-adicional.mjs
 * Nunca contra a :3000 nem a :3001 (as do Rui).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const env = (k) => {
  const l = readFileSync(path.join(HERE, "..", ".env"), "utf8").split(/\r?\n/).find((x) => x.startsWith(k + "="));
  if (!l) throw new Error(`${k} não está em .env`);
  return l.slice(k.length + 1).trim().replace(/^"|"$/g, "");
};

const S = env("SUPABASE_URL").replace(/\/$/, "");
const A = env("SUPABASE_ANON_KEY");
const API = process.env.API_URL ?? "http://localhost:3012";
if (/:300[01]\b/.test(API)) throw new Error("Não corras isto contra a :3000 nem a :3001.");

let ok = 0, bad = 0;
const check = (l, c, d = "") => { if (c) { ok++; console.log("  OK    " + l); } else { bad++; console.log("  FALHA " + l + (d ? " — " + d : "")); } };

const login = async (email) =>
  (await (await fetch(`${S}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: A, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "academia2026" }),
  })).json()).access_token;

const call = async (token, method, pathname, body) => {
  const r = await fetch(API + pathname, {
    method,
    headers: { Authorization: `Bearer ${token}`, "x-academy-slug": "life-club", ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};

const db = new pg.Client({ connectionString: env("MIGRATE_DATABASE_URL"), ssl: { rejectUnauthorized: false } });
await db.connect();
const limpar = () => db.query(`DELETE FROM "Match" WHERE id LIKE 'zz_jogo_ta_%'`);

try {
  await limpar();
  // Uma equipa de cada modalidade, pelo código da modalidade.
  const equipas = (await db.query(`
    SELECT DISTINCT ON (s.code) s.code, t.id FROM "Team" t JOIN "Sport" s ON s.id = t."sportId"
     WHERE t."academyId" = 'acd_lifeclub' AND s.code IN ('football', 'futsal', 'basketball') ORDER BY s.code, t.name`)).rows;
  const equipaDe = Object.fromEntries(equipas.map((e) => [e.code, e.id]));
  const jogo = async (id, teamId, quando) =>
    db.query(
      `INSERT INTO "Match" (id, "academyId", "teamId", "startsAt", "endsAt", venue, opponent, "updatedAt")
       VALUES ($1, 'acd_lifeclub', $2, ${quando}, ${quando} + interval '2 hours', 'Campo teste', 'ZZ Adversário', now())`,
      [id, teamId],
    );
  await jogo("zz_jogo_ta_fut", equipaDe.football, `now() - interval '1 day'`);
  await jogo("zz_jogo_ta_futuro", equipaDe.football, `now() + interval '3 days'`);
  if (equipaDe.futsal) await jogo("zz_jogo_ta_futsal", equipaDe.futsal, `now() - interval '1 day'`);
  if (equipaDe.basketball) await jogo("zz_jogo_ta_basq", equipaDe.basketball, `now() - interval '1 day'`);

  const direcao = await login("direcao@lifeclub.pt");
  const familia = await login("familia@lifeclub.pt");
  const gravar = (t, id, minutes) => call(t, "POST", `/api/matches/${id}/tempo-adicional`, { minutes });

  const antes = await call(direcao, "GET", `/api/matches/zz_jogo_ta_fut`);
  check("um jogo sem registo devolve a lista vazia", antes.status === 200 && Array.isArray(antes.body?.addedMinutes) && antes.body.addedMinutes.length === 0, JSON.stringify(antes.body?.addedMinutes));

  const g1 = await gravar(direcao, "zz_jogo_ta_fut", [2, 5]);
  const depois = await call(direcao, "GET", `/api/matches/zz_jogo_ta_fut`);
  check("futebol: +2 na primeira e +5 na segunda ficam gravados", g1.status === 201 && depois.body?.addedMinutes?.join() === "2,5", `${g1.status} ${JSON.stringify(depois.body?.addedMinutes)}`);
  check("e não mexe na duração do jogo", depois.body?.matchMinutes === antes.body?.matchMinutes, `${depois.body?.matchMinutes}`);

  const g2 = await gravar(direcao, "zz_jogo_ta_fut", [3, 0]);
  check("zeros no fim caem: [3, 0] fica [3]", g2.status === 201 && g2.body?.addedMinutes?.join() === "3", JSON.stringify(g2.body));
  const g3 = await gravar(direcao, "zz_jogo_ta_fut", [0, 0]);
  check("tudo a zero volta a 'por registar'", g3.status === 201 && g3.body?.addedMinutes?.length === 0, JSON.stringify(g3.body));

  check("três partes num jogo de futebol: recusado", (await gravar(direcao, "zz_jogo_ta_fut", [1, 2, 3])).status === 400);
  check("31 minutos: recusado", (await gravar(direcao, "zz_jogo_ta_fut", [31])).status === 400);
  check("negativo: recusado", (await gravar(direcao, "zz_jogo_ta_fut", [-1])).status === 400);
  check("um jogo que ainda não começou: recusado", (await gravar(direcao, "zz_jogo_ta_futuro", [2, 3])).status === 400);
  const f = await gravar(familia, "zz_jogo_ta_fut", [2, 3]);
  check("a família não grava (403 ou 404)", f.status === 403 || f.status === 404, String(f.status));

  /*
   * Os minutos de cada atleta com o tempo adicional.
   *
   * Três convocados: A joga tudo, B sai ao intervalo, C entra ao intervalo. A
   * ficha grava-se primeiro, sem descontos; os descontos vêm depois e têm de
   * refazer os minutos sozinhos.
   */
  const D = antes.body.matchMinutes;
  const meio = D / 2;
  const tres = (await db.query(
    `SELECT a.id FROM "Athlete" a JOIN "TeamMembership" tm ON tm."athleteId" = a.id
      WHERE tm."teamId" = $1 AND tm."leftAt" IS NULL AND a.status = 'ACTIVE' ORDER BY a.name LIMIT 3`, [equipaDe.football])).rows.map((r) => r.id);
  for (const id of tres) {
    await db.query(`INSERT INTO "MatchCallUp" (id, "matchId", "athleteId") VALUES ($1, 'zz_jogo_ta_fut', $2)`, [`zz_cu_${id}`.slice(0, 30), id]);
  }
  const [A, B, C] = tres;
  const fichaRows = [
    { athleteId: A, minutes: 0, started: true, tally: 0, assists: 0, yellowCards: 0, redCard: false },
    { athleteId: B, minutes: 0, started: true, tally: 0, assists: 0, yellowCards: 0, redCard: false, offMinute: meio },
    { athleteId: C, minutes: 0, started: false, tally: 0, assists: 0, yellowCards: 0, redCard: false, onMinute: meio },
  ];
  const minutosDe = async () => {
    const m = (await call(direcao, "GET", `/api/matches/zz_jogo_ta_fut`)).body;
    const de = (id) => m.squad.find((s) => s.athleteId === id)?.minutes;
    return [de(A), de(B), de(C)].join();
  };
  const f0 = await call(direcao, "POST", `/api/matches/zz_jogo_ta_fut/ficha`, { rows: fichaRows });
  check(`sem descontos: ${D}, ${meio} e ${meio} minutos`, f0.status === 201 && (await minutosDe()) === [D, meio, meio].join(), `${f0.status} ${JSON.stringify(f0.body)} ${await minutosDe()}`);

  await gravar(direcao, "zz_jogo_ta_fut", [2, 3]);
  check(`com +2 e +3, os minutos refazem-se: ${D + 5}, ${meio + 2} e ${meio + 3}`, (await minutosDe()) === [D + 5, meio + 2, meio + 3].join(), await minutosDe());

  await call(direcao, "POST", `/api/matches/zz_jogo_ta_fut/ficha`, { rows: fichaRows });
  check("gravar a ficha outra vez dá os mesmos minutos", (await minutosDe()) === [D + 5, meio + 2, meio + 3].join(), await minutosDe());

  await gravar(direcao, "zz_jogo_ta_fut", [0, 0]);
  check("tirar os descontos devolve os minutos de antes", (await minutosDe()) === [D, meio, meio].join(), await minutosDe());

  if (equipaDe.futsal) {
    const r = await gravar(direcao, "zz_jogo_ta_futsal", [1, 1]);
    check("futsal: não há tempo adicional (400)", r.status === 400 && /não há tempo adicional/.test(r.body?.message ?? ""), `${r.status} ${r.body?.message}`);
  } else console.log("  (o Life Club não tem equipa de futsal: salta)");
  if (equipaDe.basketball) {
    const r = await gravar(direcao, "zz_jogo_ta_basq", [1, 1, 1, 1]);
    check("basquetebol: não há tempo adicional (400)", r.status === 400 && /não há tempo adicional/.test(r.body?.message ?? ""), `${r.status} ${r.body?.message}`);
  } else console.log("  (o Life Club não tem equipa de basquetebol: salta)");
} finally {
  await limpar();
  await db.end();
}

console.log(`\n${ok} OK, ${bad} falhas`);
process.exit(bad ? 1 : 0);

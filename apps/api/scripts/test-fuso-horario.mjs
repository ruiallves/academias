#!/usr/bin/env node
/**
 * As horas são as do clube, seja qual for o fuso da máquina onde a API corre.
 *
 * A queixa: *"nas convocatórias, quando edito os detalhes, fica sempre com +1
 * hora; se meter 12h e guardar, guarda 13h."* O servidor lia "12:00" com
 * `setHours`, que usa o fuso da máquina — e em produção a máquina está em UTC.
 * No PC de quem programa (Lisboa) a conta dava certo, e por isso passou.
 *
 * **Este teste só prova alguma coisa com a API em UTC**, como em produção:
 *
 *   TZ=UTC node dist/main   (numa porta de teste)
 *   API_URL=http://127.0.0.1:3001 node scripts/test-fuso-horario.mjs
 *
 * O que guarda:
 *
 * - os detalhes da convocatória: "09:30" é 09:30 em Lisboa, no Verão e no
 *   Inverno, e "22:00" para um jogo de manhã é na véspera;
 * - a repetição de treinos: um treino semanal às 18:30 continua às 18:30 depois
 *   da mudança de hora de 25 de Outubro (antes passava para as 17:30).
 *
 * Num clube descartável, sem ninguém convocado (nenhum aviso sai).
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

const Z = "zt-teste-fuso";
const ZT = "zt_academia";
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

/** A hora que o relógio de Lisboa marca num instante: "09:30". */
const emLisboa = (d) =>
  d ? new Date(d).toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Lisbon" }) : null;
const diaEmLisboa = (d) => new Date(d).toLocaleDateString("pt-PT", { timeZone: "Europe/Lisbon" });

/*
 * As colunas `timestamp` sem fuso (o `DateTime` do Prisma) guardam UTC. O `pg`
 * lê-as na hora local de quem corre o teste, o que num PC em Lisboa tira uma
 * hora no Verão — era o teste a mentir, não a API. Aqui lêem-se como UTC, que é
 * o que o Prisma escreveu.
 */
pg.types.setTypeParser(1114, (s) => new Date(`${s.replace(" ", "T")}Z`));

const db = new pg.Client({ connectionString: env("MIGRATE_DATABASE_URL"), ssl: { rejectUnauthorized: false } });
await db.connect();

const direcaoUser = (await db.query(`SELECT id FROM "User" WHERE email = 'direcao@lifeclub.pt'`)).rows[0];

const limpar = async () => {
  await db.query(`DELETE FROM "Notification" WHERE "academyId" = $1`, [ZT]);
  await db.query(`DELETE FROM "TrainingSession" WHERE "academyId" = $1`, [ZT]);
  await db.query(`DELETE FROM "Match" WHERE "academyId" = $1`, [ZT]);
  await db.query(`DELETE FROM "Team" WHERE "academyId" = $1`, [ZT]);
  await db.query(`DELETE FROM "Season" WHERE "academyId" = $1`, [ZT]);
  await db.query(`DELETE FROM "LegalAcceptance" WHERE "academyId" = $1`, [ZT]).catch(() => undefined);
  await db.query(`DELETE FROM "Membership" WHERE "academyId" = $1`, [ZT]);
  await db.query(`DELETE FROM "Sport" WHERE "academyId" = $1`, [ZT]);
  await db.query(`DELETE FROM "Academy" WHERE id = $1`, [ZT]);
};
await limpar();

try {
  await db.query(`INSERT INTO "Academy" (id, slug, name, "shortName", status, "updatedAt") VALUES ($1, $2, 'ZT Teste Fuso', 'ZT', 'ACTIVE', now())`, [ZT, Z]);
  await db.query(`INSERT INTO "Sport" (id, "academyId", name, positions, skills) VALUES ('zt_sport', $1, 'Futebol', ARRAY[]::text[], ARRAY[]::text[])`, [ZT]);
  await db.query(`INSERT INTO "Season" (id, "academyId", label, "startsOn", "endsOn", "isCurrent") VALUES ('zt_season', $1, 'época', '2026-08-01', '2027-07-31', true)`, [ZT]);
  await db.query(`INSERT INTO "Team" (id, "academyId", "sportId", "seasonId", name, "maxAge", "updatedAt") VALUES ('zt_team', $1, 'zt_sport', 'zt_season', 'ZT Sub-15', 15, now())`, [ZT]);
  await db.query(`INSERT INTO "Membership" (id, "academyId", "userId", role, "isActive", "updatedAt") VALUES ('zt_memb', $1, $2, 'OWNER', true, now())`, [ZT, direcaoUser.id]);

  const director = await login("direcao@lifeclub.pt");
  const pend = ((await call(director, "GET", "/api/legal/status")).body?.pending ?? []).map((d) => d.id);
  if (pend.length) {
    const aceite = await call(director, "POST", "/api/legal/accept", { documentIds: pend, confirmAuthority: true });
    check("(preparação) termos do clube aceites", aceite.status === 200 || aceite.status === 201, `${aceite.status}`);
  }

  /* Dois jogos já convocados: um no Verão (UTC+1) e um no Inverno (UTC+0). */
  const jogo = (id, inicio) =>
    db.query(
      `INSERT INTO "Match" (id, "academyId", "teamId", "startsAt", "endsAt", venue, opponent, "callUpsClosedAt", "updatedAt")
       VALUES ($1, $2, 'zt_team', $3::timestamptz, $3::timestamptz + interval '90 minutes', 'Campo', 'ZT Adversário', now(), now())`,
      [id, ZT, inicio],
    );
  await jogo("zt_verao", "2026-09-26T10:00:00Z"); // 11:00 em Lisboa
  await jogo("zt_inverno", "2026-12-05T11:00:00Z"); // 11:00 em Lisboa
  const logistica = async (id) =>
    (await db.query(`SELECT "meetingAt", "arrivalAt" FROM "Match" WHERE id = $1`, [id])).rows[0];

  console.log("=== Os detalhes da convocatória, no Verão ===");
  const verao = await call(director, "PATCH", "/api/matches/zt_verao/convocatoria/logistica", {
    meetingPoint: "Sede", meetingTime: "09:30", arrivalTime: "10:15",
  });
  check("grava (2xx)", verao.status === 200 || verao.status === 201, `${verao.status} ${JSON.stringify(verao.body).slice(0, 160)}`);
  const v = await logistica("zt_verao");
  check("o encontro fica às 09:30 em Lisboa", emLisboa(v.meetingAt) === "09:30", `${emLisboa(v.meetingAt)} (${v.meetingAt?.toISOString()})`);
  check("a chegada às 10:15", emLisboa(v.arrivalAt) === "10:15", `${emLisboa(v.arrivalAt)}`);
  check("no dia do jogo", diaEmLisboa(v.meetingAt) === "26/09/2026", diaEmLisboa(v.meetingAt));

  console.log("\n=== No Inverno, depois da mudança de hora ===");
  await call(director, "PATCH", "/api/matches/zt_inverno/convocatoria/logistica", { meetingTime: "12:00", arrivalTime: "10:30" });
  const i = await logistica("zt_inverno");
  check("\"12:00\" para um jogo às 11:00 é na véspera, às 12:00", emLisboa(i.meetingAt) === "12:00" && diaEmLisboa(i.meetingAt) === "04/12/2026", `${emLisboa(i.meetingAt)} ${diaEmLisboa(i.meetingAt)}`);
  check("a chegada às 10:30 do próprio dia", emLisboa(i.arrivalAt) === "10:30" && diaEmLisboa(i.arrivalAt) === "05/12/2026", `${emLisboa(i.arrivalAt)} ${diaEmLisboa(i.arrivalAt)}`);

  console.log("\n=== O caso da queixa: 12:00 fica 12:00 ===");
  await db.query(`UPDATE "Match" SET "startsAt" = '2026-09-26T14:00:00Z', "endsAt" = '2026-09-26T15:30:00Z' WHERE id = 'zt_verao'`);
  await call(director, "PATCH", "/api/matches/zt_verao/convocatoria/logistica", { meetingTime: "12:00" });
  const q = await logistica("zt_verao");
  check("escrever 12:00 guarda 12:00 (e não 13:00)", emLisboa(q.meetingAt) === "12:00", `${emLisboa(q.meetingAt)}`);

  console.log("\n=== A repetição de treinos atravessa a mudança de hora ===");
  const serie = await call(director, "POST", "/api/events", {
    kind: "TRAINING",
    teamId: "zt_team",
    title: "ZT Treino",
    startsAt: "2026-10-20T17:30:00.000Z", // terça, 18:30 em Lisboa
    endsAt: "2026-10-20T19:00:00.000Z",
    venue: "Campo",
    repeat: { freq: "WEEKLY", until: "2026-11-10", weekdays: [2] },
  });
  check("cria a série (2xx)", serie.status === 200 || serie.status === 201, `${serie.status} ${JSON.stringify(serie.body).slice(0, 160)}`);
  const treinos = (await db.query(`SELECT "startsAt", "endsAt" FROM "TrainingSession" WHERE "academyId" = $1 ORDER BY "startsAt"`, [ZT])).rows;
  check("quatro terças, até dia 10 inclusive", treinos.length === 4, `${treinos.length}: ${treinos.map((t) => diaEmLisboa(t.startsAt)).join(", ")}`);
  check("todos às 18:30 em Lisboa, antes e depois de 25 de Outubro", treinos.every((t) => emLisboa(t.startsAt) === "18:30"), treinos.map((t) => `${diaEmLisboa(t.startsAt)} ${emLisboa(t.startsAt)}`).join(" · "));
  check("e todos com hora e meia", treinos.every((t) => new Date(t.endsAt) - new Date(t.startsAt) === 90 * 60_000));
  check("e todos à terça", treinos.every((t) => new Date(t.startsAt).toLocaleDateString("pt-PT", { weekday: "long", timeZone: "Europe/Lisbon" }) === "terça-feira"));
} finally {
  console.log("\n=== Limpeza ===");
  await limpar();
  check("tudo apagado", (await db.query(`SELECT count(*)::int n FROM "Academy" WHERE id = $1`, [ZT])).rows[0].n === 0);
  await db.end();
}

console.log(`\n${ok} OK · ${bad} falhas`);
process.exit(bad === 0 ? 0 : 1);

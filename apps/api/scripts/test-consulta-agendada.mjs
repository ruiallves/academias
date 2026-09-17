#!/usr/bin/env node
/**
 * Agendar uma consulta: fica marcada, avisa a família e o atleta, e aparece.
 *
 * A queixa: *"quando tento agendar uma consulta, não está a marcá-la. Depois de
 * estar marcada, deve aparecer na app do pai e do atleta, e eles devem receber
 * notificação."*
 *
 * Eram duas coisas. A marcação **gravava** (é o que este teste fixa), mas o ecrã
 * de Consultas filtrava por tipo e o botão "Agendar consulta" abre no exame
 * médico: a linha não aparecia em lado nenhum a não ser na ficha do atleta.
 * E do lado da app não havia nada: nem aviso, nem ecrã.
 *
 * O que se guarda aqui:
 *
 * - `POST /api/athletes/:id/clinical` com `status: SCHEDULED` grava dia, hora,
 *   local e título, e deixa o atleta disponível (um agendamento não afasta
 *   ninguém);
 * - nasce uma notificação `CLINICAL_APPOINTMENT` por cada encarregado activo e
 *   para o atleta com conta própria, com a rota da app;
 * - a consulta vai na resposta de `/api/athletes` a quem tem `clinical:read` —
 *   que é o mesmo caminho por onde a app da família e a do atleta a recebem;
 * - remarcar (data, hora ou local) avisa outra vez; corrigir só o título não;
 * - dar a consulta como feita não avisa ninguém.
 *
 * Num clube descartável, com um encarregado e um atleta de contas próprias
 * criadas aqui (sem Supabase, sem push, sem email a sair).
 *
 * Uso: node scripts/test-consulta-agendada.mjs   (API_URL opcional)
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

const Z = "zc-teste-consulta";
const ZC = "zc_academia";
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

const daqui = (dias) => {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
};
const DIA = daqui(6);
const OUTRO_DIA = daqui(9);

const direcaoUser = (await db.query(`SELECT id FROM "User" WHERE email = 'direcao@lifeclub.pt'`)).rows[0];

const limpar = async () => {
  await db.query(`DELETE FROM "Notification" WHERE "academyId" = $1`, [ZC]);
  await db.query(`DELETE FROM "ClinicalEntry" WHERE "academyId" = $1`, [ZC]);
  await db.query(`DELETE FROM "GuardianLink" WHERE "athleteId" LIKE 'zc_%'`);
  await db.query(`DELETE FROM "TeamMembership" WHERE "athleteId" LIKE 'zc_%'`);
  await db.query(`UPDATE "Athlete" SET "accountMembershipId" = NULL WHERE "academyId" = $1`, [ZC]);
  await db.query(`DELETE FROM "Athlete" WHERE "academyId" = $1`, [ZC]);
  await db.query(`DELETE FROM "Team" WHERE "academyId" = $1`, [ZC]);
  await db.query(`DELETE FROM "Season" WHERE "academyId" = $1`, [ZC]);
  await db.query(`DELETE FROM "LegalAcceptance" WHERE "academyId" = $1`, [ZC]).catch(() => undefined);
  await db.query(`DELETE FROM "Membership" WHERE "academyId" = $1`, [ZC]);
  await db.query(`DELETE FROM "Sport" WHERE "academyId" = $1`, [ZC]);
  await db.query(`DELETE FROM "Academy" WHERE id = $1`, [ZC]);
  await db.query(`DELETE FROM "User" WHERE id IN ('zc_user_pai', 'zc_user_atleta')`);
};
await limpar();

const avisos = async () =>
  (await db.query(
    `SELECT n."userId", n.type, n.title, n.body, n.payload FROM "Notification" n WHERE n."academyId" = $1 ORDER BY n."createdAt"`,
    [ZC],
  )).rows;
const entrada = async () =>
  (await db.query(
    `SELECT id, status, kind, to_char(date, 'YYYY-MM-DD') dia, time, location, title, impact
       FROM "ClinicalEntry" WHERE "academyId" = $1 ORDER BY "createdAt" DESC`, [ZC],
  )).rows[0] ?? null;

try {
  /* ------------------------------------------------ o clube descartável --- */
  await db.query(
    `INSERT INTO "Academy" (id, slug, name, "shortName", status, "updatedAt")
     VALUES ($1, $2, 'ZC Teste Consulta', 'ZC', 'ACTIVE', now())`, [ZC, Z],
  );
  await db.query(`INSERT INTO "Sport" (id, "academyId", name, positions, skills) VALUES ('zc_sport', $1, 'Futebol', ARRAY[]::text[], ARRAY[]::text[])`, [ZC]);
  await db.query(`INSERT INTO "Season" (id, "academyId", label, "startsOn", "endsOn", "isCurrent") VALUES ('zc_season', $1, 'época', '2026-08-01', '2027-07-31', true)`, [ZC]);
  await db.query(`INSERT INTO "Team" (id, "academyId", "sportId", "seasonId", name, "maxAge", "updatedAt") VALUES ('zc_team', $1, 'zc_sport', 'zc_season', 'ZC Sub-15', 15, now())`, [ZC]);
  await db.query(`INSERT INTO "Athlete" (id, "academyId", name, birthdate, status, "joinedAt", "updatedAt") VALUES ('zc_atleta', $1, 'ZC Atleta', '2011-05-05', 'ACTIVE', '2024-01-10', now())`, [ZC]);
  await db.query(`INSERT INTO "TeamMembership" (id, "teamId", "athleteId") VALUES ('zc_tm', 'zc_team', 'zc_atleta')`);
  await db.query(`INSERT INTO "Membership" (id, "academyId", "userId", role, "isActive", "updatedAt") VALUES ('zc_memb_dir', $1, $2, 'OWNER', true, now())`, [ZC, direcaoUser.id]);

  /*
   * Um encarregado e o atleta, com contas nesta academia.
   *
   * Criadas na base e não no Supabase de propósito: o teste quer saber quem
   * **recebe** o aviso, e uma conta a sério mandaria um push a um telemóvel de
   * verdade. Sem subscrição de push, o `enqueue` grava a linha e mais nada.
   */
  for (const [id, nome, email] of [
    ["zc_user_pai", "ZC Pai", "zc-pai@teste.local"],
    ["zc_user_atleta", "ZC Atleta", "zc-atleta@teste.local"],
  ]) {
    await db.query(
      `INSERT INTO "User" (id, "authId", name, email, "updatedAt") VALUES ($1, $2, $3, $4, now())`,
      [id, randomUUID(), nome, email],
    );
  }
  await db.query(`INSERT INTO "Membership" (id, "academyId", "userId", role, "isActive", "updatedAt") VALUES ('zc_memb_pai', $1, 'zc_user_pai', 'GUARDIAN', true, now())`, [ZC]);
  await db.query(`INSERT INTO "Membership" (id, "academyId", "userId", role, "isActive", "updatedAt") VALUES ('zc_memb_atleta', $1, 'zc_user_atleta', 'ATHLETE', true, now())`, [ZC]);
  await db.query(`INSERT INTO "GuardianLink" (id, "athleteId", "membershipId", relation) VALUES ('zc_gl', 'zc_atleta', 'zc_memb_pai', 'Pai')`);
  await db.query(`UPDATE "Athlete" SET "accountMembershipId" = 'zc_memb_atleta' WHERE id = 'zc_atleta'`);

  const director = await login("direcao@lifeclub.pt");
  const pend = ((await call(director, "GET", "/api/legal/status")).body?.pending ?? []).map((d) => d.id);
  if (pend.length) {
    const aceite = await call(director, "POST", "/api/legal/accept", { documentIds: pend, confirmAuthority: true });
    check("(preparação) termos do clube aceites", aceite.status === 200 || aceite.status === 201, `${aceite.status}`);
  }

  console.log("=== Agendar ===");
  const marcar = await call(director, "POST", "/api/athletes/zc_atleta/clinical", {
    kind: "NUTRITION",
    status: "SCHEDULED",
    date: DIA,
    time: "10:30",
    location: "Clínica do Parque",
    title: "Consulta de nutrição",
  });
  check("responde (2xx)", marcar.status === 200 || marcar.status === 201, `${marcar.status} ${JSON.stringify(marcar.body).slice(0, 160)}`);
  const marcada = await entrada();
  check("fica marcada", marcada?.status === "SCHEDULED", JSON.stringify(marcada));
  check("com o dia", marcada?.dia === DIA, `${marcada?.dia} (esperava ${DIA})`);
  check("a hora", marcada?.time === "10:30", `${marcada?.time}`);
  check("e o sítio", marcada?.location === "Clínica do Parque", `${marcada?.location}`);
  check("sem afastar ninguém", marcada?.impact === "NONE", `${marcada?.impact}`);

  console.log("\n=== O aviso ===");
  const primeiros = await avisos();
  check("dois avisos: o pai e o atleta", primeiros.length === 2, JSON.stringify(primeiros.map((n) => n.userId)));
  check("do tipo certo", primeiros.every((n) => n.type === "CLINICAL_APPOINTMENT"), JSON.stringify(primeiros.map((n) => n.type)));
  check("ao pai", primeiros.some((n) => n.userId === "zc_user_pai"));
  check("e ao atleta", primeiros.some((n) => n.userId === "zc_user_atleta"));
  check("a dizer o que é", /Consulta de nutrição de ZC Atleta/.test(primeiros[0]?.body ?? ""), `${primeiros[0]?.body}`);
  check("com a hora e o sítio", /às 10:30, em Clínica do Parque/.test(primeiros[0]?.body ?? ""), `${primeiros[0]?.body}`);
  check("e a rota da app", primeiros[0]?.payload?.route === "/atleta", JSON.stringify(primeiros[0]?.payload));
  check("a resposta diz quantos foram avisados", marcar.body?.avisados === 2, `${marcar.body?.avisados}`);

  console.log("\n=== O que a app recebe ===");
  /*
   * A mesma leitura que a app da família e a do atleta fazem: `/api/athletes`
   * com `clinical:read`, que é o que os papéis GUARDIAN e ATHLETE têm dos seus.
   */
  const atletas = await call(director, "GET", "/api/athletes");
  const atleta = (atletas.body ?? []).find((a) => a.id === "zc_atleta");
  const consultas = (atleta?.clinical ?? []).filter((c) => c.status === "scheduled");
  check("a consulta vai na ficha do atleta", consultas.length === 1, JSON.stringify(atleta?.clinical));
  check("com hora e local", consultas[0]?.time === "10:30" && consultas[0]?.location === "Clínica do Parque", JSON.stringify(consultas[0]));
  check("e com o título", consultas[0]?.title === "Consulta de nutrição", `${consultas[0]?.title}`);
  check("o atleta continua disponível", atleta?.availability === "available", `${atleta?.availability}`);

  console.log("\n=== Remarcar avisa outra vez ===");
  const remarcar = await call(director, "PATCH", `/api/clinical/${marcada.id}`, { date: OUTRO_DIA, time: "09:00" });
  check("responde (2xx)", remarcar.status === 200 || remarcar.status === 201, `${remarcar.status}`);
  check("avisa os dois outra vez", remarcar.body?.avisados === 2, `${remarcar.body?.avisados}`);
  const depois = await avisos();
  check("há quatro avisos", depois.length === 4, `${depois.length}`);
  check("o último fala da data nova", /passou para/.test(depois[3]?.body ?? ""), `${depois[3]?.body}`);
  check("e o dia mudou na base", (await entrada())?.dia === OUTRO_DIA, `${(await entrada())?.dia}`);

  console.log("\n=== Corrigir o título não avisa ===");
  const titulo = await call(director, "PATCH", `/api/clinical/${marcada.id}`, { title: "Consulta de nutrição (revisão)" });
  check("responde (2xx)", titulo.status === 200 || titulo.status === 201, `${titulo.status}`);
  check("ninguém avisado", titulo.body?.avisados === 0, `${titulo.body?.avisados}`);
  check("continuam quatro avisos", (await avisos()).length === 4, `${(await avisos()).length}`);

  console.log("\n=== Dar a consulta como feita ===");
  const feita = await call(director, "PATCH", `/api/clinical/${marcada.id}`, { status: "DONE" });
  check("responde (2xx)", feita.status === 200 || feita.status === 201, `${feita.status}`);
  check("sem avisar ninguém", feita.body?.avisados === 0, `${feita.body?.avisados}`);
  check("e sai das marcadas", (await entrada())?.status === "DONE", `${(await entrada())?.status}`);

  console.log("\n=== Um registo normal não avisa ===");
  const registo = await call(director, "POST", "/api/athletes/zc_atleta/clinical", {
    kind: "INJURY", status: "DONE", date: daqui(0), impact: "OUT", title: "ZC Entorse",
  });
  check("responde (2xx)", registo.status === 200 || registo.status === 201, `${registo.status}`);
  check("ninguém avisado", registo.body?.avisados === 0, `${registo.body?.avisados}`);
  check("continuam quatro avisos", (await avisos()).length === 4, `${(await avisos()).length}`);
} finally {
  console.log("\n=== Limpeza ===");
  await limpar();
  check("tudo apagado", (await db.query(`SELECT count(*)::int n FROM "Academy" WHERE id = $1`, [ZC])).rows[0].n === 0);
  await db.end();
}

console.log(`\n${ok} OK · ${bad} falhas`);
process.exit(bad === 0 ? 0 : 1);

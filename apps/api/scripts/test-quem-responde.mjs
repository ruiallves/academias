#!/usr/bin/env node
/**
 * Quem responde por um atleta: o encarregado, ou o próprio.
 *
 * ## A avaria que isto fecha
 *
 * A resposta a uma convocatória e o aviso de falta ao treino autorizavam-se com
 * uma pergunta só — "este atleta é meu?". Um atleta com conta tem-se a si no
 * âmbito, e por isso confirmava a **sua própria** convocatória. Num escalão de
 * formação quem decide se o miúdo vai ao jogo é o encarregado de educação.
 *
 * ## O que se prova
 *
 *  1. Com `respondBy = GUARDIAN` (o normal): o encarregado responde, o atleta
 *     leva 403, e a mensagem diz-lhe porquê.
 *  2. Com `respondBy = ATHLETE`: troca-se exactamente — responde o atleta e o
 *     encarregado leva 403. É **um ou outro**, nunca os dois.
 *  3. O mesmo no aviso de falta a um treino.
 *  4. O staff não responde por esta porta: quem tem `attendance:write` regista
 *     a falta na folha, que é o instrumento dele.
 *
 * A conta de atleta é criada aqui pelo convite (como em `test-atleta.mjs`) e
 * desfeita no fim.
 *
 * Uso: API_URL=http://127.0.0.1:3012 node scripts/test-quem-responde.mjs
 */
import { readFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
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
const API = process.env.API_URL ?? process.env.API ?? "http://127.0.0.1:3000";
const PASSWORD = "academia2026";
const EMAIL = "atleta.responde@teste.local";
const JOGO = "mt_teste_responde";
const TREINO = "ses_teste_responde";

let ok = 0, bad = 0;
const check = (l, c, d = "") => {
  if (c) { ok++; console.log("  OK    " + l); }
  else { bad++; console.log("  FALHA " + l + (d ? " — " + d : "")); }
};

const login = async (email, password = PASSWORD) =>
  (await (await fetch(`${S}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: A, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  })).json()).access_token;

const req = async (token, method, pathname, body, app = "console") => {
  const res = await fetch(API + pathname, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "x-academy-slug": "life-club",
      "x-app": app,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

const db = new pg.Client({ connectionString: env("MIGRATE_DATABASE_URL"), ssl: { rejectUnauthorized: false } });
await db.connect();

const direcao = await login("direcao@lifeclub.pt");
const pai = await login("familia@lifeclub.pt");
const treinador = await login("treinador@lifeclub.pt");

/* O educando do pai é o atleta que vai ganhar conta. */
const meus = (await req(pai, "GET", "/api/athletes", undefined, "family")).body ?? [];
const alvo = meus[0];
const ACADEMIA = "acd_lifeclub";

const limpar = async () => {
  await db.query(`DELETE FROM "AbsenceNotice" WHERE "sessionId" = $1`, [TREINO]);
  await db.query(`DELETE FROM "TrainingSession" WHERE id = $1`, [TREINO]);
  await db.query(`DELETE FROM "MatchCallUp" WHERE "matchId" = $1`, [JOGO]);
  await db.query(`DELETE FROM "Match" WHERE id = $1`, [JOGO]);
  if (alvo) {
    const conta = (await db.query(`SELECT "accountMembershipId" AS m FROM "Athlete" WHERE id = $1`, [alvo.id])).rows[0];
    await db.query(
      `UPDATE "Athlete" SET email = NULL, "inviteTokenHash" = NULL, "inviteSentAt" = NULL, "accountMembershipId" = NULL WHERE id = $1`,
      [alvo.id],
    );
    const u = (await db.query(`SELECT id FROM "User" WHERE email = $1`, [EMAIL])).rows[0];
    if (u) {
      await db.query(`DELETE FROM "Notification" WHERE "userId" = $1`, [u.id]);
      await db.query(`DELETE FROM "Membership" WHERE "userId" = $1 AND role = 'ATHLETE'`, [u.id]);
    }
    if (conta?.m) await db.query(`DELETE FROM "Membership" WHERE id = $1`, [conta.m]);
  }
};

try {
  check("(preparação) há um atleta com encarregado", Boolean(alvo), JSON.stringify(meus).slice(0, 120));
  if (!alvo) throw new Error("sem atleta");
  await limpar();

  console.log("=== Preparar a conta do atleta ===");
  const token = randomBytes(32).toString("base64url");
  await db.query(
    `UPDATE "Athlete" SET email = $1, "inviteTokenHash" = $2, "inviteSentAt" = now() WHERE id = $3`,
    [EMAIL, createHash("sha256").update(token).digest("hex"), alvo.id],
  );
  const reg = await req(null, "POST", `/api/convite-atleta/${token}/registar`, { password: PASSWORD, acceptLegal: true });
  const atleta = reg.body?.accessToken;
  check("o atleta ganha conta própria", Boolean(atleta), `${reg.status} ${JSON.stringify(reg.body).slice(0, 120)}`);
  if (!atleta) throw new Error("sem conta de atleta");

  /* Um jogo futuro, com a convocatória já submetida e o atleta lá dentro. */
  const daqui = (dias, hora) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + dias);
    d.setUTCHours(hora, 0, 0, 0);
    return d.toISOString();
  };
  await db.query(
    `INSERT INTO "Match" (id, "academyId", "teamId", "startsAt", "endsAt", opponent, "isHome", venue, status, "callUpsClosedAt", "confirmationRequired", "respondBy", "updatedAt")
     VALUES ($1, $2, $3, $4::timestamptz, $5::timestamptz, 'ZZ Adversário de Teste', true, 'Campo de teste', 'SCHEDULED', now(), true, 'GUARDIAN', now())`,
    [JOGO, ACADEMIA, alvo.teamId, daqui(6, 10), daqui(6, 12)],
  );
  await db.query(
    `INSERT INTO "MatchCallUp" (id, "matchId", "athleteId", status) VALUES ($1, $2, $3, 'CALLED')`,
    [`zc_${Date.now().toString(36)}`, JOGO, alvo.id],
  );

  console.log("\n=== O jogo: responde o encarregado ===");
  const atletaTenta = await req(atleta, "POST", `/api/matches/${JOGO}/convocatoria/resposta`, { athleteId: alvo.id, going: true }, "athlete");
  check("o atleta não responde por si (403)", atletaTenta.status === 403, `${atletaTenta.status} ${JSON.stringify(atletaTenta.body).slice(0, 120)}`);
  check("e a mensagem diz de quem é a resposta", /encarregado/i.test(atletaTenta.body?.message ?? ""), atletaTenta.body?.message);

  const paiResponde = await req(pai, "POST", `/api/matches/${JOGO}/convocatoria/resposta`, { athleteId: alvo.id, going: true }, "family");
  check("o encarregado responde (200)", paiResponde.status < 300, `${paiResponde.status} ${JSON.stringify(paiResponde.body).slice(0, 120)}`);

  const staff = await req(treinador, "POST", `/api/matches/${JOGO}/convocatoria/resposta`, { athleteId: alvo.id, going: false, reason: "teste" });
  check("o staff não responde por esta porta (403)", staff.status === 403, `${staff.status}`);

  console.log("\n=== O jogo: respondem os atletas ===");
  await db.query(`UPDATE "Match" SET "respondBy" = 'ATHLETE' WHERE id = $1`, [JOGO]);
  const atletaResponde = await req(atleta, "POST", `/api/matches/${JOGO}/convocatoria/resposta`, { athleteId: alvo.id, going: false, reason: "Tenho prova na escola" }, "athlete");
  check("agora o atleta responde (200)", atletaResponde.status < 300, `${atletaResponde.status} ${JSON.stringify(atletaResponde.body).slice(0, 120)}`);
  const paiRecusado = await req(pai, "POST", `/api/matches/${JOGO}/convocatoria/resposta`, { athleteId: alvo.id, going: true }, "family");
  check("e o encarregado leva 403", paiRecusado.status === 403, `${paiRecusado.status} ${JSON.stringify(paiRecusado.body).slice(0, 120)}`);
  check("com a razão à frente", /atleta/i.test(paiRecusado.body?.message ?? ""), paiRecusado.body?.message);

  const guardado = (await db.query(`SELECT status, "declineReason" FROM "MatchCallUp" WHERE "matchId" = $1`, [JOGO])).rows[0];
  check("fica gravada a resposta do atleta", guardado?.status === "DECLINED" && /prova/i.test(guardado?.declineReason ?? ""), JSON.stringify(guardado));

  console.log("\n=== O treino: avisa o encarregado ===");
  await db.query(
    `INSERT INTO "TrainingSession" (id, "academyId", "teamId", "startsAt", "endsAt", venue, status, "respondBy", "updatedAt")
     VALUES ($1, $2, $3, $4::timestamptz, $5::timestamptz, 'Campo de teste', 'SCHEDULED', 'GUARDIAN', now())`,
    [TREINO, ACADEMIA, alvo.teamId, daqui(3, 18), daqui(3, 20)],
  );
  const atletaAvisa = await req(atleta, "POST", `/api/sessions/${TREINO}/ausencia`, { athleteId: alvo.id, reason: "Estou doente" }, "athlete");
  check("o atleta não avisa por si (403)", atletaAvisa.status === 403, `${atletaAvisa.status} ${JSON.stringify(atletaAvisa.body).slice(0, 120)}`);
  const paiAvisa = await req(pai, "POST", `/api/sessions/${TREINO}/ausencia`, { athleteId: alvo.id, reason: "Está doente" }, "family");
  check("o encarregado avisa (200)", paiAvisa.status < 300, `${paiAvisa.status} ${JSON.stringify(paiAvisa.body).slice(0, 120)}`);

  console.log("\n=== O treino: avisam os atletas ===");
  await db.query(`UPDATE "TrainingSession" SET "respondBy" = 'ATHLETE' WHERE id = $1`, [TREINO]);
  const paiRecusadoTreino = await req(pai, "POST", `/api/sessions/${TREINO}/ausencia`, { athleteId: alvo.id, reason: "Está doente" }, "family");
  check("o encarregado deixa de avisar (403)", paiRecusadoTreino.status === 403, `${paiRecusadoTreino.status}`);
  const atletaAvisaAgora = await req(atleta, "POST", `/api/sessions/${TREINO}/ausencia`, { athleteId: alvo.id, reason: "Estou doente" }, "athlete");
  check("e o atleta avisa (200)", atletaAvisaAgora.status < 300, `${atletaAvisaAgora.status} ${JSON.stringify(atletaAvisaAgora.body).slice(0, 120)}`);
  const retirar = await req(atleta, "DELETE", `/api/sessions/${TREINO}/ausencia/${alvo.id}`, undefined, "athlete");
  check("e retira o aviso que deu", retirar.status < 300, `${retirar.status}`);

  console.log("\n=== O que a app recebe ===");
  const agenda = (await req(atleta, "GET", `/api/sessions?from=${daqui(0, 0).slice(0, 10)}&to=${daqui(10, 0).slice(0, 10)}`, undefined, "athlete")).body ?? [];
  const meuTreino = (Array.isArray(agenda) ? agenda : []).find((s) => s.id === TREINO);
  check("o treino diz quem avisa", meuTreino?.respondBy === "ATHLETE", JSON.stringify(meuTreino?.respondBy));
  const jogos = (await req(pai, "GET", "/api/matches", undefined, "family")).body ?? [];
  const meuJogo = (Array.isArray(jogos) ? jogos : []).find((m) => m.id === JOGO);
  check("e o jogo também", meuJogo?.respondBy === "ATHLETE", JSON.stringify(meuJogo?.respondBy));
} finally {
  console.log("\n=== Limpeza ===");
  await limpar();
  await db.end();
  console.log("  feito");
}

console.log(`\n${ok} passaram, ${bad} falharam`);
process.exit(bad === 0 ? 0 : 1);

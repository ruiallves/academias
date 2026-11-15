#!/usr/bin/env node
/**
 * Convocar atletas de outro escalão.
 *
 * O que interessa provar: **sobe, nunca desce**. Um Sub-11 pode reforçar um jogo
 * de Sub-13; o contrário — um Sub-13 a "descer" para jogar com os Sub-11 — é
 * irregular em qualquer federação, e o servidor tem de o recusar mesmo que o
 * pedido venha com um id válido e uma sessão autenticada.
 *
 * E que a fronteira de dados se mantém: o treinador dos Sub-13 não ganha acesso
 * ao boletim clínico dos Sub-11 só porque pode ver os nomes deles.
 *
 * Uso: node scripts/test-guest-callups.mjs
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
// Permite correr contra uma instância própria — `API_URL=http://localhost:3001` —
// sem disputar a porta 3000 com o servidor de quem está a desenvolver.
const API = process.env.API_URL ?? "http://localhost:3000";

let ok = 0;
let bad = 0;
const check = (l, c, d = "") => {
  if (c) { ok++; console.log("  OK    " + l); }
  else { bad++; console.log("  FALHA " + l + (d ? " — " + d : "")); }
};

const login = async (email) =>
  (await (await fetch(`${S}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: A, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "academia2026" }),
  })).json()).access_token;

// `app`: a app da família manda `x-app: family`, e é o que escolhe o vínculo de
// encarregado quando o mesmo utilizador também é staff do clube.
const call = async (token, method, pathname, body, app) => {
  const res = await fetch(API + pathname, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "x-academy-slug": "life-club",
      ...(app ? { "x-app": app } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

/*
 * O `AuthGuard` recusa tudo a quem tenha documentos legais por aceitar (403
 * `LEGAL_ACCEPTANCE_REQUIRED`). Aceita-se o que estiver pendente para a conta,
 * como a app faz — ver `test-convocatoria-resposta.mjs`.
 */
const passarOGateLegal = async (token, quem) => {
  const st = await call(token, "GET", "/api/legal/status");
  const pendentes = (st.body?.pending ?? []).map((d) => d.id);
  if (pendentes.length === 0) return;
  const r = await call(token, "POST", "/api/legal/accept", { documentIds: pendentes });
  if (r.status !== 200 && r.status !== 201) console.log(`  (não consegui aceitar os documentos de ${quem}: ${r.status})`);
  else console.log(`  (${quem}: aceites ${pendentes.length} documentos legais pendentes)`);
};

// Rui Machado treina os Sub-9/11; André Peixoto (adjunto) treina só os Sub-11.
const coach11 = await login("treinador@lifeclub.pt");
await passarOGateLegal(coach11, "treinador");
// Quem monta a convocatória dos Sub-13: a direção, que vê o clube todo. O Rui
// já não está nos Sub-13 na base de demonstração (a seed dizia que sim).
const coach13Login = await login("direcao@lifeclub.pt");
await passarOGateLegal(coach13Login, "direção");

const db = new pg.Client({ connectionString: env("MIGRATE_DATABASE_URL"), ssl: { rejectUnauthorized: false } });
await db.connect();

/*
 * Os dois jogos da seed já passaram, e a lista de jogos só traz 30 dias para
 * trás: empurram-se para daqui a uma semana e repõem-se no fim, como em
 * `test-callups.mjs`.
 */
const originais = (await db.query(`SELECT id, "startsAt", "endsAt", "competitionId" FROM "Match" WHERE id IN ('mt_proximo','mt_seguinte')`)).rows;
/*
 * Num amigável convoca-se de qualquer escalão (`convocaDeQualquerEscalao`), e
 * os jogos da seed não têm prova. Para provar a regra da idade (sobe, nunca
 * desce), os dois jogos passam a contar para uma prova oficial do clube.
 */
const oficial = (await db.query(`SELECT id FROM "CatalogItem" WHERE "academyId"='acd_lifeclub' AND kind='competitions' AND official = true LIMIT 1`)).rows[0];
if (oficial) await db.query(`UPDATE "Match" SET "competitionId" = $1 WHERE id IN ('mt_proximo','mt_seguinte')`, [oficial.id]);
else console.log("  (o clube não tem prova oficial no catálogo: a regra da idade não se prova)");
const futuro = new Date(Date.now() + 7 * 86_400_000);
futuro.setHours(10, 30, 0, 0);
await db.query(`UPDATE "Match" SET "startsAt" = $1, "endsAt" = $2 WHERE id IN ('mt_proximo','mt_seguinte')`, [futuro, new Date(futuro.getTime() + 2 * 3600_000)]);

await db.query(`UPDATE "Match" SET "callUpsClosedAt" = NULL WHERE id IN ('mt_proximo','mt_seguinte')`);
await db.query(`DELETE FROM "MatchCallUp" WHERE "matchId" IN ('mt_proximo','mt_seguinte')`);

console.log("=== Quem pode subir ===");
// mt_proximo é dos Sub-11; mt_seguinte é dos Sub-13.
const pool13 = await call(coach13Login, "GET", "/api/matches/mt_seguinte/convidados-elegiveis");
check("o jogo dos Sub-13 tem candidatos dos Sub-11", pool13.status === 200 && pool13.body.length > 0, `${pool13.body?.length}`);
check("vêm com o nome da equipa de origem", pool13.body.every((a) => a.teamName), pool13.body[0]?.teamName);
check("sem diagnóstico — só se está bloqueado", pool13.body.every((a) => !("clinicalTitle" in a) && typeof a.blocked === "boolean"));

const pool11 = await call(coach11, "GET", "/api/matches/mt_proximo/convidados-elegiveis");
check("o jogo dos Sub-11 não tem candidatos dos Sub-13 (não se desce)", pool11.status === 200 && pool11.body.length === 0, `${pool11.body?.length}`);

console.log("\n=== Convocar para cima funciona ===");
const algumSub11 = pool13.body[0];
check("há pelo menos um Sub-11 disponível para convocar", Boolean(algumSub11), JSON.stringify(pool13.body[0]));

if (algumSub11) {
  const guardou = await call(coach13Login, "POST", "/api/matches/mt_seguinte/convocatoria", {
    athleteIds: [algumSub11.id],
  });
  check("guarda a convocatória com o convidado", guardou.status < 300, JSON.stringify(guardou.body).slice(0, 100));

  const lido = await call(coach13Login, "GET", "/api/matches");
  const jogo = lido.body.find((m) => m.id === "mt_seguinte");
  const entrada = jogo?.calledUp.find((c) => c.athleteId === algumSub11.id);
  check("aparece marcado como convidado", entrada?.isGuest === true, JSON.stringify(entrada));
  check("com a equipa de origem", entrada?.guestFromTeam === algumSub11.teamName, entrada?.guestFromTeam);

  /*
   * A família do convidado vê o jogo.
   *
   * O âmbito de um encarregado são as equipas dos filhos, e o jogo dos Sub-13
   * não é de nenhuma delas: ficava fora da lista, e a app abria "este evento já
   * não existe" depois de o aviso "estás convocado" ter chegado (Santa Maria
   * FC, 14/11/2026). Um jogo com um filho meu convocado é meu.
   */
  const encarregado = (await db.query(
    `SELECT u.email FROM "GuardianLink" g
       JOIN "Membership" m ON m.id = g."membershipId" AND m."isActive" = true
       JOIN "User" u ON u.id = m."userId"
      WHERE g."athleteId" = $1 LIMIT 1`,
    [algumSub11.id],
  )).rows[0];
  const paiDoConvidado = encarregado ? await login(encarregado.email) : null;
  if (paiDoConvidado) {
    const st = await call(paiDoConvidado, "GET", "/api/legal/status", undefined, "family");
    const pend = (st.body?.pending ?? []).map((d) => d.id);
    if (pend.length) await call(paiDoConvidado, "POST", "/api/legal/accept", { documentIds: pend }, "family");
    const daFamilia = await call(paiDoConvidado, "GET", "/api/matches", undefined, "family");
    const visto = (daFamilia.body ?? []).find((m) => m.id === "mt_seguinte");
    check("a família do convidado vê o jogo de outro escalão", Boolean(visto), `${daFamilia.status} com ${daFamilia.body?.length} jogos`);
    check("com a linha do filho na convocatória", visto?.calledUp?.some((c) => c.athleteId === algumSub11.id && c.isGuest) === true, `mine=${visto?.mine} calledUp=${JSON.stringify(visto?.calledUp)} filho=${algumSub11.id}`);
  } else {
    console.log(`  (o convidado ${algumSub11.name} não tem encarregado com conta na seed — salto a vista da família)`);
  }
}

console.log("\n=== Convocar para baixo é recusado ===");
// Tentar meter um atleta dos Sub-13 na convocatória dos Sub-11.
const sub13Athlete = await db.query(`SELECT id FROM "Athlete" WHERE "academyId"='acd_lifeclub' AND id='ath_rodrigo'`);
const desce = await call(coach11, "POST", "/api/matches/mt_proximo/convocatoria", {
  athleteIds: [sub13Athlete.rows[0].id],
});
check("um Sub-13 não pode ser convocado para um jogo de Sub-11", desce.status === 400, `${desce.status}`);

console.log("\n=== Um convidado de baixa continua bloqueado ===");
// A Matilde (Sub-11) está de baixa aberta na seed.
const matilde = pool13.body.find((a) => a.name.includes("Matilde"));
check("aparece na lista, mas marcada como bloqueada", matilde?.blocked === true, JSON.stringify(matilde));

if (matilde) {
  const tenta = await call(coach13Login, "POST", "/api/matches/mt_seguinte/convocatoria", {
    athleteIds: [matilde.id],
  });
  check("e continua recusada ao convocar", tenta.status === 400, `${tenta.status}`);
}

/*
 * A idade do atleta, e não a da equipa dele.
 *
 * É o caso que a regra antiga deixava passar. Comparava **equipas**: quem
 * estivesse nos Sub-11 era elegível para os Sub-13, fosse qual fosse a idade
 * que tivesse. Um miúdo repetente ou mal inscrito — e acontece — entrava numa
 * convocatória contra gente três anos mais nova do que ele.
 *
 * Agora compara-se a idade. Este atleta está no plantel dos Sub-11, logo passava
 * o teste antigo; tem 15 anos na época da seed, logo não passa o novo.
 */
console.log("\n=== Idade a mais, mesmo vindo de uma equipa de baixo ===");
await db.query(
  `INSERT INTO "Athlete" (id,"academyId",name,birthdate,status,"joinedAt","updatedAt")
   VALUES ('ath_zz_velho','acd_lifeclub','ZZ Atleta Crescido','2011-04-02','ACTIVE',now(),now())
   ON CONFLICT (id) DO UPDATE SET birthdate = EXCLUDED.birthdate`,
);
// Sem ON CONFLICT: a unicidade de (equipa, atleta) passou a ser parcial (só
// passagens vivas), e o Postgres não a aceita como árbitro.
await db.query(
  `INSERT INTO "TeamMembership" (id,"teamId","athleteId")
   SELECT 'tm_zz_velho','t_sub11','ath_zz_velho'
   WHERE NOT EXISTS (SELECT 1 FROM "TeamMembership" WHERE "teamId"='t_sub11' AND "athleteId"='ath_zz_velho' AND "leftAt" IS NULL)`,
);

const pool13Outra = await call(coach13Login, "GET", "/api/matches/mt_seguinte/convidados-elegiveis");
check(
  "um atleta com idade a mais não aparece como candidato",
  pool13Outra.status === 200 && !pool13Outra.body.some((a) => a.id === "ath_zz_velho"),
  JSON.stringify(pool13Outra.body?.map((a) => a.name)),
);

const velho = await call(coach13Login, "POST", "/api/matches/mt_seguinte/convocatoria", {
  athleteIds: ["ath_zz_velho"],
});
check("e o servidor recusa-o na convocatória (400)", velho.status === 400, `${velho.status}`);

console.log("\n=== Limpeza ===");
await db.query(`DELETE FROM "TeamMembership" WHERE "athleteId" = 'ath_zz_velho'`);
await db.query(`DELETE FROM "Athlete" WHERE id = 'ath_zz_velho'`);
await db.query(`UPDATE "Match" SET "callUpsClosedAt" = NULL WHERE id IN ('mt_proximo','mt_seguinte')`);
await db.query(`DELETE FROM "MatchCallUp" WHERE "matchId" IN ('mt_proximo','mt_seguinte')`);
for (const o of originais) await db.query(`UPDATE "Match" SET "startsAt" = $2, "endsAt" = $3, "competitionId" = $4 WHERE id = $1`, [o.id, o.startsAt, o.endsAt, o.competitionId]);
await db.end();
console.log("  feito");

console.log(`\n${ok} passaram, ${bad} falharam`);
process.exit(bad === 0 ? 0 : 1);

#!/usr/bin/env node
/**
 * Eventos do calendário via API.
 *
 * O que interessa: a permissão (`calendar:write`), o âmbito (um treinador cria para
 * as suas equipas mas não "toda a academia"), cancelar/reativar sem apagar, a
 * validação de forma, e a persistência real na base.
 *
 * Uso: node scripts/test-events.mjs
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
// Permite correr contra uma instância própria — `API_URL=http://localhost:3099` —
// sem disputar a porta 3000 com o servidor de quem está a desenvolver.
const API = process.env.API_URL ?? "http://localhost:3000";

let ok = 0, bad = 0;
const check = (l, c, d = "") => { if (c) { ok++; console.log("  OK    " + l); } else { bad++; console.log("  FALHA " + l + (d ? " — " + d : "")); } };

const login = async (email) =>
  (await (await fetch(`${S}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: A, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "academia2026" }),
  })).json()).access_token;

const call = async (token, method, pathname, body) => {
  const r = await fetch(API + pathname, {
    method, headers: { Authorization: `Bearer ${token}`, "x-academy-slug": "life-club", ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};

const db = new pg.Client({ connectionString: env("MIGRATE_DATABASE_URL"), ssl: { rejectUnauthorized: false } });
await db.connect();
/*
 * A limpeza tem de apanhar as tres tabelas.
 *
 * Um evento do calendario nao vive so em `CalendarEvent`: um treino e uma
 * `TrainingSession` e um jogo e um `Match` — sao as tabelas ricas, que abrem
 * folha de presencas e convocatoria. Ver `createEvent`.
 *
 * `TrainingSession` nao tem titulo, por isso nao ha "ZZ" por onde a apanhar: a
 * limpeza e pela hora fixa que este teste usa. Sem ela, uma corrida que rebentasse
 * a meio deixava o treino la, e a corrida seguinte falhava com "esta equipa ja tem
 * um treino marcado a esta hora" — que e o teste a bater em si proprio.
 */
/*
 * A limpeza tem de apanhar **todas** as horas que a suite usa.
 *
 * Apanhava duas, e o teste do adjunto usa outras: a segunda corrida seguida
 * batia em "esta equipa ja tem um treino marcado a esta hora" e caia com tres
 * falhas que nao tinham nada que ver com o que estava a ser testado. Um teste que
 * so passa a primeira vez e um teste que nao se pode acreditar.
 */
await db.query(`DELETE FROM "CalendarEvent" WHERE title LIKE 'ZZ %'`);
await db.query(
  `DELETE FROM "TrainingSession" WHERE "startsAt" = ANY($1::timestamp[])`,
  [["2026-09-01T18:00:00.000Z", "2026-09-01T20:00:00.000Z", "2026-09-02T20:00:00.000Z", "2026-09-04T20:00:00.000Z"]],
);
await db.query(`DELETE FROM "Match" WHERE opponent LIKE 'ZZ %' OR "startsAt" = '2026-09-01T18:00:00.000Z'`);

/*
 * A prova de cada jogo.
 *
 * A competição passou a ser obrigatória ao marcar um jogo (ver
 * `createSingleEvent`): "nenhuma prova" chama-se **Amigável**, existe em cada
 * academia e entra em cada equipa. Estes testes marcam jogos para testar outra
 * coisa — o âmbito, os choques de horário — e usam-na como qualquer clube usaria.
 */
const amigavelId = (
  await db.query(
    `SELECT c.id FROM "CatalogItem" c JOIN "Academy" a ON a.id = c."academyId"
      WHERE a.slug = 'life-club' AND c.kind = 'competitions' AND c.label = 'Amigável'`,
  )
).rows[0]?.id;

const director = await login("direcao@lifeclub.pt");
const coach = await login("treinador@lifeclub.pt");
const parent = await login("familia@lifeclub.pt");

const S1 = "2026-09-01T18:00:00.000Z";
const E1 = "2026-09-01T19:30:00.000Z";
const base = (title, extra = {}) => ({ kind: "TRAINING", title, startsAt: S1, endsAt: E1, venue: "Campo 1", ...extra });

console.log("=== Criar ===");
const teamEv = await call(director, "POST", "/api/events", base("ZZ Evento Equipa", { teamId: "t_sub11" }));
/*
 * A criação devolve um **resumo**, não um evento.
 *
 * Mudou quando os eventos passaram a poder repetir-se: um pedido pode criar
 * trinta linhas, e devolver só a primeira era esconder o que aconteceu. A forma
 * é sempre a mesma — `{ created, skipped, events }` — com ou sem repetição, para
 * quem lê não ter de adivinhar qual das duas veio.
 */
const primeiro = (r) => r.body?.events?.[0];

check("a direção cria um evento de equipa", teamEv.status === 201 || teamEv.status === 200, JSON.stringify(teamEv.body).slice(0, 140));
check("nasce por cancelar", primeiro(teamEv)?.cancelled === false);
check("com a equipa certa", primeiro(teamEv)?.teamId === "t_sub11");
const wideEv = await call(director, "POST", "/api/events", base("ZZ Evento Academia", { kind: "OTHER" }));
check("a direção cria um evento de toda a academia (sem equipa)", wideEv.status === 201 && primeiro(wideEv)?.teamId === null, `${wideEv.status}`);

console.log("\n=== Permissão e âmbito ===");
/*
 * Outra hora, de propósito.
 *
 * A direcao ja marcou um treino do t_sub11 as 18h, e a mesma equipa nao treina
 * duas vezes a mesma hora — o servidor recusa, e bem. O que este bloco verifica e
 * o **ambito** (o treinador cria para a equipa dele), nao a colisao de horarios,
 * que tem o seu proprio teste.
 */
const S2 = "2026-09-01T20:00:00.000Z";
const E2 = "2026-09-01T21:30:00.000Z";
const coachOwn = await call(coach, "POST", "/api/events", base("ZZ Evento Treinador", { teamId: "t_sub11", startsAt: S2, endsAt: E2 }));
check("um treinador cria para a sua equipa", coachOwn.status === 201 || coachOwn.status === 200, `${coachOwn.status}`);
const coachWide = await call(coach, "POST", "/api/events", base("ZZ Evento TreinadorAcademia"));
check("um treinador não cria 'toda a academia' (403)", coachWide.status === 403, `${coachWide.status}`);
const byParent = await call(parent, "POST", "/api/events", base("ZZ Evento Pai", { teamId: "t_sub11" }));
check("um encarregado não cria eventos (403)", byParent.status === 403, `${byParent.status}`);

/*
 * O âmbito por equipa, e não só o "toda a academia".
 *
 * O treinador semeado tem as **duas** equipas, por isso não serve para isto. O
 * adjunto tem só o Sub-11 — é com ele que se prova a fronteira que interessa: um
 * treinador marca para a equipa dele e para mais nenhuma, mesmo quando a outra
 * existe e ele a consegue nomear.
 *
 * Treino e jogo à parte de propósito. Por baixo são tabelas diferentes
 * (`TrainingSession` e `Match`) e podiam ter guardas diferentes; hoje partilham
 * a mesma, e é isso que estes dois pares verificam.
 */
const adjunto = await login("adjunto@lifeclub.pt");

/*
 * A "equipa de outro" descobre-se, não se escreve à mão.
 *
 * Estava fixa em `t_sub13`, com a nota de que o adjunto só tinha o Sub-11. Deixou
 * de ser verdade no dia em que a direcção lhe atribuiu mais escalões pela
 * aplicação — que é uso normal do produto. O teste passou a marcar eventos numa
 * equipa que **é** dele e a dar a fronteira por partida.
 *
 * Uma fronteira só se prova com um lado de fora. Se não houver nenhum, não há
 * nada para provar e diz-se isso, em vez de o inventar.
 */
const semAdjunto = (await db.query(`
  SELECT t.id FROM "Team" t JOIN "Academy" a ON a.id = t."academyId"
   WHERE a.slug = 'life-club'
     AND NOT EXISTS (
       SELECT 1 FROM "TeamStaff" ts
         JOIN "Membership" m ON m.id = ts."membershipId"
         JOIN "User" u ON u.id = m."userId"
        WHERE ts."teamId" = t.id AND u.email = 'adjunto@lifeclub.pt'
     )
   ORDER BY t.name LIMIT 1
`)).rows[0]?.id ?? null;

const S3 = "2026-09-02T20:00:00.000Z";
const E3 = "2026-09-02T21:30:00.000Z";

const treinoSeu = await call(adjunto, "POST", "/api/events", base("ZZ Treino Adjunto", { kind: "TRAINING", teamId: "t_sub11", startsAt: S3, endsAt: E3 }));
check("o adjunto marca treino na equipa dele", treinoSeu.status === 201 || treinoSeu.status === 200, `${treinoSeu.status}`);

if (semAdjunto) {
  const treinoAlheio = await call(adjunto, "POST", "/api/events", base("ZZ Treino Alheio", { kind: "TRAINING", teamId: semAdjunto, startsAt: S3, endsAt: E3 }));
  check("e não marca treino na equipa de outro (403)", treinoAlheio.status === 403, `${treinoAlheio.status}`);
} else {
  console.log("  (o adjunto está em todas as equipas — salto a fronteira do treino)");
}

const jogoSeu = await call(adjunto, "POST", "/api/events", base("ZZ Jogo Adjunto", { kind: "MATCH", teamId: "t_sub11", competitionId: amigavelId, opponent: "ZZ Adversário", startsAt: "2026-09-03T16:00:00.000Z", endsAt: "2026-09-03T17:30:00.000Z" }));
check("marca jogo na equipa dele", jogoSeu.status === 201 || jogoSeu.status === 200, `${jogoSeu.status}`);

if (semAdjunto) {
  const jogoAlheio = await call(adjunto, "POST", "/api/events", base("ZZ Jogo Alheio", { kind: "MATCH", teamId: semAdjunto, competitionId: amigavelId, opponent: "ZZ Adversário", startsAt: "2026-09-03T16:00:00.000Z", endsAt: "2026-09-03T17:30:00.000Z" }));
  check("e não marca jogo na equipa de outro (403)", jogoAlheio.status === 403, `${jogoAlheio.status}`);
} else {
  console.log("  (o adjunto está em todas as equipas — salto a fronteira do jogo)");
}

/* Nem desmarca o que é de outra equipa — a mesma fronteira, do outro lado. */
if (semAdjunto) {
  const doOutro = await call(director, "POST", "/api/events", base("ZZ Treino de Outra Equipa", { kind: "TRAINING", teamId: semAdjunto, startsAt: "2026-09-04T20:00:00.000Z", endsAt: "2026-09-04T21:30:00.000Z" }));
  const idDoOutro = primeiro(doOutro)?.id;
  const cancelarAlheio = await call(adjunto, "PATCH", `/api/events/${idDoOutro}`, { cancelled: true });
  check("e não desmarca o treino de outra equipa (403)", cancelarAlheio.status === 403, `${cancelarAlheio.status}`);
} else {
  console.log("  (o adjunto está em todas as equipas — salto a fronteira do desmarcar)");
}

/*
 * O calendario e do clube; o que se pode fazer nele e que e por equipa.
 *
 * Isto exigia que a lista trouxesse so a equipa dele — e passava por vazio, sem
 * ninguem dar por isso: os eventos criados acima para o t_sub13 ou eram treinos
 * (que vivem noutra tabela) ou tinham sido recusados, por isso nao havia
 * nenhum para ver. Agora cria-se um a serio e verifica-se as duas metades.
 */
/** O evento de uma equipa que não é dele — se houver uma. */
let idAlheio = null;

if (semAdjunto) {
  const eventoAlheio = await call(director, "POST", "/api/events", base("ZZ Reuniao de Outra Equipa", {
    kind: "OTHER", teamId: semAdjunto, startsAt: "2026-09-05T18:00:00.000Z", endsAt: "2026-09-05T19:00:00.000Z",
  }));
  check("a direcao marca um evento noutra equipa", eventoAlheio.status < 300, `${eventoAlheio.status}`);
  idAlheio = primeiro(eventoAlheio)?.id;

  const listaAdjunto = await call(adjunto, "GET", "/api/events");
  const alheioNaLista = (listaAdjunto.body ?? []).find((e) => e.id === idAlheio);
  check("o adjunto ve no calendario o evento de outra equipa", Boolean(alheioNaLista), "evento alheio");
  check("marcado como nao sendo dele", alheioNaLista?.mine === false, `${alheioNaLista?.mine}`);

  // O nome vem da equipa escolhida acima, não de um nome escrito à mão: a equipa
  // "de fora" é a que houver, e o clube pode ter-lhe mudado o nome.
  const nomeEsperado = (await db.query(`SELECT name FROM "Team" WHERE id = $1`, [semAdjunto])).rows[0]?.name;
  check("com o nome da equipa, que ele nao tem por outra via", alheioNaLista?.teamName === nomeEsperado, `${alheioNaLista?.teamName} vs ${nomeEsperado}`);
} else {
  console.log("  (o adjunto está em todas as equipas — salto a leitura do que não é dele)");
}

/*
 * E um do t_sub11, para a outra metade nao passar por vazio.
 *
 * Os eventos que o adjunto criou acima sao um treino e um jogo, e esses vivem em
 * `TrainingSession` e `Match` — nao em `CalendarEvent`. Sem isto, "os dele
 * continuam marcados como dele" media uma lista vazia, que e o mesmo erro que
 * esta suite ja tinha do outro lado.
 */
const eventoSeu = await call(adjunto, "POST", "/api/events", base("ZZ Reuniao Sub-11", {
  kind: "OTHER", teamId: "t_sub11", startsAt: "2026-09-05T20:00:00.000Z", endsAt: "2026-09-05T21:00:00.000Z",
}));
check("o adjunto marca um evento na equipa dele", eventoSeu.status < 300, `${eventoSeu.status}`);

const listaDepois = await call(adjunto, "GET", "/api/events");
const seusNaLista = (listaDepois.body ?? []).filter((e) => e.teamId === "t_sub11");
check("e os dele continuam marcados como dele", seusNaLista.length > 0 && seusNaLista.every((e) => e.mine === true), `${seusNaLista.length}`);

// Ver nao e poder: desmarcar continua a bater na fronteira.
if (idAlheio) {
  const desmarcarAlheio = await call(adjunto, "PATCH", `/api/events/${idAlheio}`, { cancelled: true });
  check("mas continua a nao poder desmarca-lo (403)", desmarcarAlheio.status === 403, `${desmarcarAlheio.status}`);
}

console.log("\n=== Regras de forma ===");
const badRange = await call(director, "POST", "/api/events", base("ZZ Evento Ordem", { teamId: "t_sub11", endsAt: S1, startsAt: E1 }));
check("fim antes do início recusado (400)", badRange.status === 400, `${badRange.status}`);
const badKind = await call(director, "POST", "/api/events", { kind: "FESTA", title: "ZZ Evento Kind", startsAt: S1, endsAt: E1, venue: "Campo 1" });
check("tipo inválido recusado (400)", badKind.status === 400, `${badKind.status}`);
const massAssign = await call(director, "POST", "/api/events", base("ZZ Evento Extra", { teamId: "t_sub11", academyId: "acd_outra", cancelled: true }));
check("campos extra (academyId/cancelled) rejeitados", massAssign.status === 400, `${massAssign.status}`);
const badTeam = await call(director, "POST", "/api/events", base("ZZ Evento TeamX", { teamId: "t_nao_existe" }));
check("equipa desconhecida recusada (400)", badTeam.status === 400, `${badTeam.status}`);

console.log("\n=== Ler no intervalo ===");
const list = await call(director, "GET", "/api/events?from=2026-08-01&to=2026-10-01");
/*
 * `/api/events` devolve **um**, e nao tres.
 *
 * Um treino nao e um `CalendarEvent` — e uma `TrainingSession`, porque abre folha
 * de presencas e a app da familia le-a de la. Ver o comentario em `createEvent`.
 * Dos tres eventos criados acima, dois sao treinos e vivem na outra tabela; so o
 * de "toda a academia" (kind OTHER) esta aqui.
 *
 * Este teste dizia 3 e passou a dizer 1 quando os treinos mudaram de casa. A
 * verificacao que interessa e a de baixo: os treinos existem, e existem no sitio
 * certo.
 */
check(
  "a leitura de eventos devolve o evento generico",
  Array.isArray(list.body) && list.body.filter((e) => e.title.startsWith("ZZ Evento")).length === 1,
  `${list.body?.length}`,
);

const sessoes = await call(director, "GET", "/api/sessions?from=2026-08-01&to=2026-10-01");
// Pelas horas exactas, e nao pelo dia: a academia de demonstracao ja tem
// treinos a 1 de Setembro, e o dia inteiro apanhava-os tambem.
const dosTestes = Array.isArray(sessoes.body)
  ? sessoes.body.filter((x) => [S1, S2].includes(new Date(x.startsAt).toISOString()))
  : [];
check("e os dois treinos estao em /api/sessions", dosTestes.length === 2, `${dosTestes.length}`);

console.log("\n=== Cancelar e reativar ===");
const id = primeiro(teamEv).id;
const cancelled = await call(director, "PATCH", `/api/events/${id}`, { cancelled: true });
check("cancela o evento (cancelled=true)", cancelled.status === 200 && cancelled.body?.cancelled === true, `${cancelled.status}`);
const reactivated = await call(director, "PATCH", `/api/events/${id}`, { cancelled: false });
check("reativa o evento (cancelled=false)", reactivated.status === 200 && reactivated.body?.cancelled === false, `${reactivated.status}`);
const coachCancelWide = await call(coach, "PATCH", `/api/events/${primeiro(wideEv).id}`, { cancelled: true });
check("um treinador não cancela evento de toda a academia (403)", coachCancelWide.status === 403, `${coachCancelWide.status}`);

console.log("\n=== Ficou na base ===");
const total = (await db.query(`SELECT count(*)::int n FROM "CalendarEvent" WHERE title LIKE 'ZZ Evento%'`)).rows[0].n;
check("1 evento generico na base", total === 1, `${total}`);
const treinos = (await db.query(
  `SELECT count(*)::int n FROM "TrainingSession" WHERE "startsAt" IN ('2026-09-01T18:00:00.000Z','2026-09-01T20:00:00.000Z')`,
)).rows[0].n;
check("2 treinos na tabela de treinos", treinos === 2, `${treinos}`);

console.log("\n=== Limpeza ===");
/*
 * Os três sítios onde um "evento" aterra.
 *
 * Isto apagava só `CalendarEvent` — e um treino já não é um evento genérico, é
 * uma `TrainingSession`; um jogo é um `Match`. As duas ficavam para trás a cada
 * corrida, a somar treinos fantasma ao calendário do clube de demonstração.
 *
 * A `TrainingSession` não tem título por onde a apanhar, por isso apaga-se pelas
 * horas que só este teste usa — 1, 2 e 4 de Setembro de 2026, sempre a horas
 * redondas que ninguém marca à mão.
 */
// O mesmo padrão da limpeza de entrada. Estava mais estreito (`ZZ Evento%`) e
// deixava para trás as reuniões que este teste cria — que a corrida seguinte
// apanhava, mas só depois de as ter contado como dados do clube.
await db.query(`DELETE FROM "CalendarEvent" WHERE title LIKE 'ZZ %'`);
await db.query(`DELETE FROM "Match" WHERE opponent LIKE 'ZZ %'`);
await db.query(
  `DELETE FROM "TrainingSession" WHERE "startsAt" = ANY($1::timestamp[])`,
  [["2026-09-01 18:00:00", "2026-09-01 20:00:00", "2026-09-02 20:00:00", "2026-09-04 20:00:00"]],
);
await db.end();
console.log("  feito");

console.log(`\n${ok} passaram, ${bad} falharam`);
process.exit(bad === 0 ? 0 : 1);

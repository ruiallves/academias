#!/usr/bin/env node
/**
 * Editar um evento do calendário.
 *
 * Até aqui, um evento marcado era imutável: um jogo adiado ou um treino que
 * mudava de campo obrigava a cancelar e a marcar outro — e com ele ia a folha de
 * presenças e a convocatória. `PUT /api/events/:id` alcança as três tabelas onde
 * um evento pode viver, tal como o `PATCH` que o cancela.
 *
 * O que este teste guarda são as **fronteiras**, que são a parte difícil:
 *
 * - o tipo e o escalão não se editam (não há por onde);
 * - um jogo já disputado não se remarca;
 * - as regras da criação — fim depois do início, sem dois eventos à mesma hora,
 *   a prova a ser da equipa — valem aqui na mesma. Um segundo caminho de escrita
 *   que não as repita é um caminho por onde elas se contornam.
 *
 * Uso: node scripts/test-edit-event.mjs
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

/* --------------------------------------------------- limpeza de uma corrida anterior */
const limpar = async () => {
  await db.query(`DELETE FROM "Match" WHERE opponent LIKE 'ZE %'`);
  await db.query(`DELETE FROM "TrainingSession" WHERE "teamId" IN (SELECT id FROM "Team" WHERE name LIKE 'ZE %')`);
  await db.query(`DELETE FROM "CalendarEvent" WHERE title LIKE 'ZE %'`);
  await db.query(`DELETE FROM "Team" WHERE name LIKE 'ZE %'`);
  await db.query(`DELETE FROM "CatalogItem" WHERE label LIKE 'ZE %'`);
};
await limpar();

const director = await login("direcao@lifeclub.pt");
const coach = await login("treinador@lifeclub.pt");
const clinico = await login("clinico@lifeclub.pt");

const sportId = (
  await db.query(
    `SELECT id FROM "Sport" WHERE "academyId" = (SELECT id FROM "Academy" WHERE slug='life-club') LIMIT 1`,
  )
).rows[0].id;

await call(director, "POST", "/api/catalogs", { kind: "competitions", label: "ZE Distrital" });
await call(director, "POST", "/api/catalogs", { kind: "competitions", label: "ZE Prova de outros" });
const provaId = (await db.query(`SELECT id FROM "CatalogItem" WHERE label = 'ZE Distrital'`)).rows[0].id;
const alheiaId = (await db.query(`SELECT id FROM "CatalogItem" WHERE label = 'ZE Prova de outros'`)).rows[0].id;

const equipa = await call(director, "POST", "/api/teams", {
  name: "ZE Equipa",
  sportId,
  maxAge: 13,
  season: "2026/27",
  schedule: [],
  competitionIds: [provaId],
});
const equipaId = equipa.body.id;
const amigavelId = equipa.body.competitions.find((c) => c.label === "Amigável").id;

/*
 * `POST /api/events` responde em lote — `{ created, skipped, events: [...] }` —
 * porque o mesmo pedido serve para marcar uma época inteira de treinos. Aqui
 * cria-se sempre um só; desembrulha-se para o teste falar de eventos e não da
 * forma da resposta.
 */
const criar = async (dto) => {
  const r = await call(director, "POST", "/api/events", dto);
  return { status: r.status, body: r.body?.events?.[0] ?? r.body };
};

console.log("=== Um treino muda de hora e de campo ===");
const treino = await criar({
  kind: "TRAINING",
  teamId: equipaId,
  title: "ZE Treino",
  startsAt: "2026-11-02T18:00:00.000Z",
  endsAt: "2026-11-02T19:30:00.000Z",
  venue: "Campo ZE",
  dressingRoom: "Balneário 1",
});
check("o treino é criado", treino.status === 201, `${treino.status} ${JSON.stringify(treino.body).slice(0, 140)}`);
const treinoId = treino.body.id;

const mudado = await call(director, "PUT", `/api/events/${treinoId}`, {
  startsAt: "2026-11-02T19:00:00.000Z",
  endsAt: "2026-11-02T20:30:00.000Z",
  venue: "Campo ZE 2",
  dressingRoom: "Balneário 3",
});
check("editar hora, campo e balneário devolve 200", mudado.status === 200, `${mudado.status} ${JSON.stringify(mudado.body).slice(0, 140)}`);

const naBase = await db.query(
  `SELECT "startsAt", "endsAt", venue, "dressingRoom", "teamId" FROM "TrainingSession" WHERE id = $1`,
  [treinoId],
);
check("e fica gravado", naBase.rows[0]?.venue === "Campo ZE 2" && naBase.rows[0]?.dressingRoom === "Balneário 3", JSON.stringify(naBase.rows[0]));
check(
  "a hora nova é a que se pediu",
  new Date(naBase.rows[0].startsAt).toISOString() === "2026-11-02T19:00:00.000Z",
  String(naBase.rows[0]?.startsAt),
);
/*
 * O escalão não se edita — não há campo para ele no DTO. Isto prova que nenhum
 * caminho lateral o mexe: um treino que trocasse de equipa levava atrás a folha
 * de presenças de outro plantel.
 */
check("e a equipa não mudou", naBase.rows[0].teamId === equipaId);

console.log("\n=== O balneário limpa-se, mas não por acidente ===");
const semBalneario = await call(director, "PUT", `/api/events/${treinoId}`, { dressingRoom: "" });
const limpo = await db.query(`SELECT "dressingRoom", venue FROM "TrainingSession" WHERE id = $1`, [treinoId]);
check("string vazia tira o balneário", semBalneario.status === 200 && limpo.rows[0].dressingRoom === null, JSON.stringify(limpo.rows[0]));
check("e o que não veio no pedido fica como estava", limpo.rows[0].venue === "Campo ZE 2", JSON.stringify(limpo.rows[0]));

console.log("\n=== As regras da criação valem na edição ===");
const aoContrario = await call(director, "PUT", `/api/events/${treinoId}`, {
  startsAt: "2026-11-02T20:00:00.000Z",
  endsAt: "2026-11-02T19:00:00.000Z",
});
check("um fim antes do início é recusado (400)", aoContrario.status === 400, `${aoContrario.status}`);

const outro = await criar({
  kind: "TRAINING",
  teamId: equipaId,
  title: "ZE Treino 2",
  startsAt: "2026-11-04T18:00:00.000Z",
  endsAt: "2026-11-04T19:30:00.000Z",
  venue: "Campo ZE",
});
const emCima = await call(director, "PUT", `/api/events/${outro.body.id}`, {
  startsAt: "2026-11-02T19:00:00.000Z",
  endsAt: "2026-11-02T20:30:00.000Z",
});
check("dois treinos da mesma equipa à mesma hora são recusados (400)", emCima.status === 400, `${emCima.status}`);

console.log("\n=== Um jogo muda de adversário, de lado e de prova ===");
const jogo = await criar({
  kind: "MATCH",
  teamId: equipaId,
  title: "ZE Jogo",
  opponent: "ZE Adversario",
  startsAt: "2026-11-08T15:00:00.000Z",
  endsAt: "2026-11-08T16:30:00.000Z",
  venue: "Campo ZE",
  competitionId: provaId,
});
check("o jogo é criado", jogo.status === 201, `${jogo.status}`);
const jogoId = jogo.body.id;

const editado = await call(director, "PUT", `/api/events/${jogoId}`, {
  opponent: "ZE Outro Adversario",
  isHome: false,
  competitionId: amigavelId,
  startsAt: "2026-11-08T17:00:00.000Z",
  endsAt: "2026-11-08T18:30:00.000Z",
});
check("editar devolve 200", editado.status === 200, `${editado.status} ${JSON.stringify(editado.body).slice(0, 140)}`);
check("o título devolvido acompanha o lado", editado.body?.title === "@ ZE Outro Adversario", JSON.stringify(editado.body?.title));

const jogoNaBase = await db.query(
  `SELECT opponent, "isHome", "competitionId", "teamId" FROM "Match" WHERE id = $1`,
  [jogoId],
);
check(
  "e fica tudo gravado",
  jogoNaBase.rows[0].opponent === "ZE Outro Adversario" &&
    jogoNaBase.rows[0].isHome === false &&
    jogoNaBase.rows[0].competitionId === amigavelId,
  JSON.stringify(jogoNaBase.rows[0]),
);
check("a equipa do jogo não mudou", jogoNaBase.rows[0].teamId === equipaId);

/*
 * A prova continua a ter de ser das que a equipa disputa. É a mesma verificação
 * da criação, e tem de estar nos dois sítios: a interface só mostra as da equipa,
 * mas a interface não é a fronteira.
 */
const provaAlheia = await call(director, "PUT", `/api/events/${jogoId}`, { competitionId: alheiaId });
check("uma prova que a equipa não disputa é recusada (400)", provaAlheia.status === 400, `${provaAlheia.status}`);

const semAdversario = await call(director, "PUT", `/api/events/${jogoId}`, { opponent: "   " });
check("um adversário em branco é recusado (400)", semAdversario.status === 400, `${semAdversario.status}`);

console.log("\n=== Um jogo disputado não se remarca ===");
/*
 * O resultado aconteceu. Mexer-lhe na data reescrevia o histórico da equipa — os
 * minutos jogados, a forma recente, a ficha. Corrigir um resultado é outra coisa,
 * e tem o seu caminho.
 */
await db.query(`UPDATE "Match" SET status = 'PLAYED' WHERE id = $1`, [jogoId]);
const disputado = await call(director, "PUT", `/api/events/${jogoId}`, { startsAt: "2026-11-09T15:00:00.000Z", endsAt: "2026-11-09T16:30:00.000Z" });
check("editar um jogo já disputado é recusado (400)", disputado.status === 400, `${disputado.status}`);
check(
  "e a mensagem manda-o para a ficha",
  String(disputado.body?.message ?? "").includes("ficha"),
  JSON.stringify(disputado.body?.message),
);
await db.query(`UPDATE "Match" SET status = 'SCHEDULED' WHERE id = $1`, [jogoId]);

console.log("\n=== Um evento genérico edita-se pelo título ===");
const evento = await criar({
  kind: "OTHER",
  teamId: equipaId,
  title: "ZE Reuniao de pais",
  startsAt: "2026-11-12T19:00:00.000Z",
  endsAt: "2026-11-12T20:00:00.000Z",
  venue: "Campo ZE",
});
const renomeado = await call(director, "PUT", `/api/events/${evento.body.id}`, { title: "ZE Reuniao de pais (adiada)" });
check("o título muda", renomeado.status === 200 && renomeado.body?.title === "ZE Reuniao de pais (adiada)", JSON.stringify(renomeado.body?.title));

console.log("\n=== Quem pode, e quem não pode ===");
/*
 * A mesma permissão do cancelamento: quem pode desmarcar um treino pode
 * trocar-lhe a hora. O departamento clínico não gere o calendário.
 */
const semPermissao = await call(clinico, "PUT", `/api/events/${treinoId}`, { venue: "Campo ZE 9" });
check("sem 'calendar:write' é recusado (403)", semPermissao.status === 403, `${semPermissao.status}`);

// O treinador tem `calendar:write`, mas só nas equipas dele — esta não é.
const foraDoAmbito = await call(coach, "PUT", `/api/events/${treinoId}`, { venue: "Campo ZE 9" });
check("um evento fora do âmbito é recusado (403)", foraDoAmbito.status === 403, `${foraDoAmbito.status}`);

const inexistente = await call(director, "PUT", "/api/events/nao-existe", { venue: "Campo ZE 9" });
check("um evento que não existe dá 404", inexistente.status === 404, `${inexistente.status}`);

console.log("\n=== O cancelamento continua a ser outra porta ===");
/*
 * `PATCH` cancela, `PUT` edita. Dois verbos para duas acções — em vez de um
 * corpo que significa coisas diferentes conforme os campos que traz.
 */
const cancelado = await call(director, "PATCH", `/api/events/${treinoId}`, { cancelled: true });
check("o PATCH cancela como sempre", cancelado.status === 200 && cancelado.body?.cancelled === true, JSON.stringify(cancelado.body?.cancelled));

const editarCancelado = await call(director, "PUT", `/api/events/${treinoId}`, { venue: "Campo ZE 4" });
const aindaCancelado = await db.query(`SELECT status, venue FROM "TrainingSession" WHERE id = $1`, [treinoId]);
check(
  "editar um evento cancelado não o reativa",
  editarCancelado.status === 200 && aindaCancelado.rows[0].status === "CANCELLED" && aindaCancelado.rows[0].venue === "Campo ZE 4",
  JSON.stringify(aindaCancelado.rows[0]),
);

/* ------------------------------------------------------------------ limpeza */
await limpar();
await db.end();
console.log(`\n${ok} passaram, ${bad} falharam`);
process.exit(bad ? 1 : 0);

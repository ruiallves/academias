#!/usr/bin/env node
/**
 * Avaliações e relatórios — as fronteiras que interessam.
 *
 * O que este teste guarda não é o CRUD; é **o que sai da academia e o que não sai**:
 *
 *  - um rascunho nunca chega ao pai, publicado chega;
 *  - um relatório interno nunca chega ao pai, **mesmo publicado**;
 *  - um treinador só avalia os atletas das equipas dele;
 *  - as pontuações só aceitam as competências da modalidade, e só de 1 a 5.
 *
 * Pressupõe `node dist/main.js` e `npm run seed`.
 *
 * Uso: node scripts/test-development.mjs
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

const S = env("SUPABASE_URL").replace(/\/$/, ""), A = env("SUPABASE_ANON_KEY"), API = "http://localhost:3000";
const PERIOD = "2026/27 · Teste";

let ok = 0, bad = 0;
const check = (l, c, d = "") => { if (c) { ok++; console.log("  OK    " + l); } else { bad++; console.log("  FALHA " + l + (d ? " — " + d : "")); } };

const login = async (email) =>
  (await (await fetch(`${S}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: A, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "academia2026" }),
  })).json()).access_token;

const call = async (token, method, p, body) => {
  const r = await fetch(API + p, {
    method,
    headers: { Authorization: `Bearer ${token}`, "x-academy-slug": "life-club", ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};

const [director, coach, adjunto, parent] = await Promise.all([
  login("direcao@lifeclub.pt"),
  login("treinador@lifeclub.pt"),
  login("adjunto@lifeclub.pt"),
  login("familia@lifeclub.pt"),
]);

// O Rui treina as duas equipas; o adjunto só uma. "Fora do âmbito" define-se a
// partir do que cada um vê, e não de nomes de equipas escritos aqui — assim o teste
// continua a dizer a verdade se o seed mudar de escalões.
const meusFilhos = (await call(parent, "GET", "/api/athletes")).body;
const filho = meusFilhos[0];
const todos = (await call(director, "GET", "/api/athletes")).body;
const doAdjunto = new Set((await call(adjunto, "GET", "/api/athletes")).body.map((a) => a.id));
const foraDoAdjunto = todos.find((a) => !doAdjunto.has(a.id));
const outro = todos.find((a) => a.id !== filho.id && doAdjunto.has(a.id)) ?? foraDoAdjunto;

console.log("=== Gravar uma avaliação ===");
const guardada = await call(coach, "POST", "/api/evaluations", {
  athleteId: filho.id,
  period: PERIOD,
  scores: { "Técnica": 4, "Atitude": 5, "Físico": 3 },
  note: "Cresceu muito no último mês.",
  strengths: "Primeiro toque e leitura de jogo.",
  focus: "Finalização com o pé esquerdo.",
});
check("o treinador grava", guardada.status === 200 || guardada.status === 201, JSON.stringify(guardada.body).slice(0, 120));
check("e nasce em rascunho", guardada.body?.status === "DRAFT", guardada.body?.status);

const idAval = (await call(coach, "GET", `/api/evaluations?period=${encodeURIComponent(PERIOD)}`)).body
  .find((e) => e.athleteId === filho.id)?.id;
check("aparece na lista do treinador", Boolean(idAval));

console.log("\n=== O que não se aceita ===");
check(
  "uma competência que a modalidade não tem",
  (await call(coach, "POST", "/api/evaluations", { athleteId: filho.id, period: PERIOD, scores: { "Natação sincronizada": 3 } })).status === 400,
);
check(
  "uma pontuação fora da escala",
  (await call(coach, "POST", "/api/evaluations", { athleteId: filho.id, period: PERIOD, scores: { "Técnica": 7 } })).status === 400,
);
check(
  "um atleta fora do âmbito do treinador",
  (await call(adjunto, "POST", "/api/evaluations", { athleteId: foraDoAdjunto.id, period: PERIOD, scores: { "Técnica": 3 } })).status === 404,
  `${foraDoAdjunto?.name} (o adjunto vê ${doAdjunto.size} de ${todos.length})`,
);

console.log("\n=== O rascunho não sai da consola ===");
const paiAntes = await call(parent, "GET", "/api/evaluations");
check("o pai lê avaliações (200)", paiAntes.status === 200, `${paiAntes.status}`);
check("mas não vê o rascunho", !(paiAntes.body ?? []).some((e) => e.id === idAval), `${paiAntes.body?.length} visíveis`);

console.log("\n=== Publicar ===");
const publicada = await call(coach, "POST", "/api/evaluations/publish", { ids: [idAval] });
check("publica", publicada.body?.published === 1, JSON.stringify(publicada.body));

const paiDepois = await call(parent, "GET", "/api/evaluations");
const vista = (paiDepois.body ?? []).find((e) => e.id === idAval);
check("agora o pai vê-a", Boolean(vista));
check("com as pontuações", vista?.scores?.["Técnica"] === 4);
check("com o que está bem e o que se vai trabalhar", Boolean(vista?.strengths) && Boolean(vista?.focus));
check("e com o nome de quem avaliou", typeof vista?.coachName === "string" && vista.coachName.length > 0);

const avisos = await call(parent, "GET", "/api/notifications");
check("o pai foi notificado", (avisos.body ?? []).some((n) => n.type === "EVALUATION_PUBLISHED"), `${avisos.body?.length} avisos`);

console.log("\n=== Publicar duas vezes, e publicar vazio ===");
const outra = await call(coach, "POST", "/api/evaluations/publish", { ids: [idAval] });
check("a segunda vez não republica", outra.body?.published === 0 && outra.body?.skipped?.[0]?.reason === "Já estava publicada", JSON.stringify(outra.body));

await call(coach, "POST", "/api/evaluations", { athleteId: outro.id, period: PERIOD, scores: {} });
const vazia = (await call(coach, "GET", `/api/evaluations?period=${encodeURIComponent(PERIOD)}`)).body
  .find((e) => e.athleteId === outro.id);
const semNada = await call(coach, "POST", "/api/evaluations/publish", { ids: [vazia.id] });
check("uma avaliação sem pontuações não se publica", semNada.body?.skipped?.[0]?.reason === "Sem pontuações", JSON.stringify(semNada.body));

check("e uma publicada não se apaga", (await call(coach, "DELETE", `/api/evaluations/${idAval}`)).status === 400);
check("um rascunho apaga-se", (await call(coach, "DELETE", `/api/evaluations/${vazia.id}`)).status === 200);

console.log("\n=== Relatórios: interno é interno ===");
const interno = await call(coach, "POST", "/api/reports", {
  athleteId: filho.id,
  title: "ZZ Parecer interno",
  period: PERIOD,
  body: "Candidato a subir de escalão em Janeiro. Falar com a direção antes de dizer seja o que for à família.",
});
check("cria um relatório interno", interno.status === 201 || interno.status === 200, JSON.stringify(interno.body).slice(0, 120));

const publicadoInterno = await call(coach, "POST", `/api/reports/${interno.body.id}/publish`);
check("publica-o", publicadoInterno.body?.ok === true);
check("e não foi partilhado", publicadoInterno.body?.shared === false);

const paiReports = await call(parent, "GET", "/api/reports");
check("o pai não vê o interno, mesmo publicado", !(paiReports.body ?? []).some((r) => r.id === interno.body.id), `${paiReports.body?.length} visíveis`);
check("mas a direção vê", (await call(director, "GET", "/api/reports")).body.some((r) => r.id === interno.body.id));

console.log("\n=== Relatórios: partilhado chega à família ===");
const familiar = await call(coach, "POST", "/api/reports", {
  athleteId: filho.id,
  title: "ZZ Relatório do período",
  period: PERIOD,
  body: "Evoluiu na leitura de jogo e na atitude competitiva. No próximo período vamos trabalhar a finalização.",
  visibility: "FAMILY",
});
const partilhado = await call(coach, "POST", `/api/reports/${familiar.body.id}/publish`);
check("publica e partilha", partilhado.body?.shared === true, JSON.stringify(partilhado.body));

const doPai = (await call(parent, "GET", "/api/reports")).body.find((r) => r.id === familiar.body.id);
check("o pai vê-o", Boolean(doPai));
check("com o texto todo", (doPai?.body ?? "").includes("finalização"));
check("e com os números congelados na publicação", doPai?.snapshot?.attendance !== undefined, JSON.stringify(doPai?.snapshot ?? null).slice(0, 120));
check("o pai foi notificado do relatório", (await call(parent, "GET", "/api/notifications")).body.some((n) => n.type === "REPORT_SHARED"));

console.log("\n=== E o que o pai não pode fazer ===");
check("não escreve relatórios", (await call(parent, "POST", "/api/reports", {
  athleteId: filho.id, title: "ZZ Não devia", body: "Isto não devia ser possível de todo.",
})).status === 403);
check("não avalia", (await call(parent, "POST", "/api/evaluations", {
  athleteId: filho.id, period: PERIOD, scores: { "Técnica": 5 },
})).status === 403);

console.log("\n=== Apagar um relatório publicado ===");
check("o treinador não apaga", (await call(coach, "DELETE", `/api/reports/${interno.body.id}`)).status === 403);
check("a direção apaga", (await call(director, "DELETE", `/api/reports/${interno.body.id}`)).status === 200);

console.log("\n=== Limpeza ===");
const db = new pg.Client({ connectionString: env("MIGRATE_DATABASE_URL"), ssl: { rejectUnauthorized: false } });
await db.connect();
await db.query(`DELETE FROM "AthleteReport" WHERE title LIKE 'ZZ %'`);
await db.query(`DELETE FROM "Evaluation" WHERE period = $1`, [PERIOD]);
await db.query(`DELETE FROM "Notification" WHERE type IN ('EVALUATION_PUBLISHED','REPORT_SHARED') AND "createdAt" > now() - interval '10 minutes'`);
await db.end();
console.log("  feito");

console.log(`\n${ok} passaram, ${bad} falharam`);
process.exit(bad === 0 ? 0 : 1);

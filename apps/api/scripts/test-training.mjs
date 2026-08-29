#!/usr/bin/env node
/**
 * Área técnica via API — exercícios, planos de treino, modelos de jogo e
 * bolas paradas.
 *
 * O que interessa, por ordem do que doeria mais estar errado:
 *
 *  1. **Visibilidade** — um exercício PRIVATE é do autor e mais ninguém o vê,
 *     nem o consegue meter num plano por id.
 *  2. **Âmbito** — um treinador com uma equipa só planeia essa; o plano de uma
 *     equipa alheia recusa com 403.
 *  3. **Permissão** — um encarregado não entra na área de todo.
 *  4. **Autoria** — o exercício de um colega não se edita; duplica-se.
 *  5. **Histórico** — apagar um exercício usado arquiva-o, nunca o apaga.
 *
 * Uso: node scripts/test-training.mjs   (API a correr; API_URL para outra porta)
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

// A limpeza apanha as duas pontas: o que este teste cria (prefixo ZZ) e o
// treino de apoio à hora fixa — senão a segunda corrida batia em si própria.
const TREINO_H = "2026-09-10T18:00:00.000Z";
await db.query(`DELETE FROM "Exercise" WHERE name LIKE 'ZZ %'`);
await db.query(`DELETE FROM "GameModel" WHERE name LIKE 'ZZ %'`);
await db.query(`DELETE FROM "SetPiece" WHERE name LIKE 'ZZ %'`);
await db.query(`DELETE FROM "TrainingSession" WHERE "startsAt" = $1`, [TREINO_H]);

const director = await login("direcao@lifeclub.pt");
const coach = await login("treinador@lifeclub.pt");
const adjunto = await login("adjunto@lifeclub.pt");
const parent = await login("familia@lifeclub.pt");

console.log("=== Permissão de porta ===");
const paiLista = await call(parent, "GET", "/api/training/exercises");
check("um encarregado não lê a biblioteca (403)", paiLista.status === 403, `${paiLista.status}`);
const paiCria = await call(parent, "POST", "/api/training/exercises", { name: "ZZ Pai" });
check("nem cria exercícios (403)", paiCria.status === 403, `${paiCria.status}`);

console.log("\n=== Exercícios: criar e ver ===");
const doClube = await call(coach, "POST", "/api/training/exercises", {
  name: "ZZ Posse 6v4",
  category: "Organização ofensiva",
  objectives: ["Construção"],
  intensity: 7,
  durationMin: 20,
  players: "6v4+GR",
  visibility: "CLUB",
  diagram: { field: "full", frames: [{ id: "f1", items: [{ id: "a", kind: "player", x: 30, y: 30, label: "7" }], arrows: [] }] },
});
check("o treinador cria um exercício do clube", doClube.status === 201 && !!doClube.body?.id, `${doClube.status}`);

const privado = await call(coach, "POST", "/api/training/exercises", { name: "ZZ Rascunho meu", visibility: "PRIVATE" });
check("e um privado", privado.status === 201, `${privado.status}`);

const doColega = await call(adjunto, "GET", "/api/training/exercises");
const nomes = (doColega.body ?? []).map((e) => e.name);
check("o colega vê o do clube", nomes.includes("ZZ Posse 6v4"));
check("mas não vê o privado", !nomes.includes("ZZ Rascunho meu"));
const privadoDireto = await call(adjunto, "GET", `/api/training/exercises/${privado.body.id}`);
check("nem lhe chega pelo id (404)", privadoDireto.status === 404, `${privadoDireto.status}`);

const doProprio = await call(coach, "GET", "/api/training/exercises");
check("o autor vê os dois", (doProprio.body ?? []).filter((e) => e.name.startsWith("ZZ ")).length === 2);

console.log("\n=== Autoria ===");
const editaAlheio = await call(adjunto, "PATCH", `/api/training/exercises/${doClube.body.id}`, { name: "ZZ Roubado" });
check("o colega não edita o exercício de outro (403)", editaAlheio.status === 403, `${editaAlheio.status}`);
const editaDirecao = await call(director, "PATCH", `/api/training/exercises/${doClube.body.id}`, { intensity: 8 });
check("a direção edita por cima do autor", editaDirecao.status === 200, `${editaDirecao.status}`);
const duplica = await call(adjunto, "POST", `/api/training/exercises/${doClube.body.id}/duplicate`, {});
check("duplicar dá-lhe a versão dele", duplica.status === 201 && duplica.body?.id, `${duplica.status}`);
const copia = await call(adjunto, "GET", `/api/training/exercises/${duplica.body.id}`);
check("a cópia nasce privada e editável", copia.body?.visibility === "PRIVATE" && copia.body?.editable === true);
await call(adjunto, "DELETE", `/api/training/exercises/${duplica.body.id}`);

console.log("\n=== Biblioteca do clube (sem autor) ===");
/*
 * Os exercícios semeados não têm autor — são do clube. Qualquer treinador os
 * afina (editar); tirá-los da biblioteca é só de quem responde pelo clube.
 */
const daCasa = (doColega.body ?? []).find((e) => e.name === "Rondo 5v2" && e.authorName === null);
if (daCasa) {
  const afina = await call(adjunto, "PATCH", `/api/training/exercises/${daCasa.id}`, { intensity: 5 });
  check("um treinador edita um exercício do clube (sem autor)", afina.status === 200, `${afina.status}`);
  const tira = await call(adjunto, "DELETE", `/api/training/exercises/${daCasa.id}`);
  check("mas não o apaga (403)", tira.status === 403, `${tira.status}`);
  const tiraDirecao = await call(director, "GET", `/api/training/exercises/${daCasa.id}`);
  check("a direção vê-o como apagável", tiraDirecao.body?.deletable === true);
} else {
  console.log("  (biblioteca semeada ausente nesta academia — salto)");
}

console.log("\n=== Favoritos ===");
const fav = await call(adjunto, "PUT", `/api/training/exercises/${doClube.body.id}/favorite`, { on: true });
check("marcar favorito", fav.status === 200, `${fav.status}`);
const comFav = await call(adjunto, "GET", "/api/training/exercises");
check("a lista traz a estrela", (comFav.body ?? []).find((e) => e.name === "ZZ Posse 6v4")?.favorite === true);
const semFavCoach = await call(coach, "GET", "/api/training/exercises");
check("a estrela é de quem a pôs, não do exercício", (semFavCoach.body ?? []).find((e) => e.name === "ZZ Posse 6v4")?.favorite === false);

console.log("\n=== Plano de treino ===");
// Um treino de apoio, criado pelo caminho normal do calendário.
const treino = await call(coach, "POST", "/api/events", {
  kind: "TRAINING", title: "ZZ Treino plano", teamId: "t_sub11",
  startsAt: TREINO_H, endsAt: "2026-09-10T19:30:00.000Z", venue: "Campo 1",
});
const sessionId = treino.body?.events?.[0]?.id;
check("há treino para planear", !!sessionId, JSON.stringify(treino.body).slice(0, 120));

const grava = await call(coach, "PUT", `/api/training/sessions/${sessionId}/plan`, {
  objective: "Transição defensiva",
  objectives: ["Reação à perda"],
  sessionType: "Aquisitivo",
  intensity: 7,
  expectedAthletes: 18,
  blocks: [
    { name: "Ativação", durationMin: 10, category: "Físico", intensity: 4 },
    { name: "Posse 6v4", durationMin: 20, category: "Organização ofensiva", intensity: 7, exerciseId: doClube.body.id },
    { name: "Jogo condicionado", durationMin: 25, category: "Transições", intensity: 8 },
  ],
});
check("o treinador grava o plano da equipa dele", grava.status === 200, `${grava.status} ${JSON.stringify(grava.body).slice(0, 120)}`);

const plano = await call(coach, "GET", `/api/training/sessions/${sessionId}/plan`);
check("o plano volta com os blocos por ordem", plano.body?.blocks?.length === 3 && plano.body?.blocks?.[1]?.name === "Posse 6v4");
check("o bloco liga ao exercício", plano.body?.blocks?.[1]?.exerciseId === doClube.body.id);
check("os campos da sessão ficaram", plano.body?.objective === "Transição defensiva" && plano.body?.intensity === 7);

const resumo = await call(coach, "GET", "/api/training/plans?from=2026-09-09T00:00:00.000Z&to=2026-09-11T00:00:00.000Z");
check("o resumo semanal traz este plano", (resumo.body ?? []).some((p) => p.sessionId === sessionId && p.blockCount === 3));

/*
 * O âmbito prova-se com um lado de fora — a "equipa de outro" descobre-se, não
 * se escreve à mão (a mesma lição de test-events).
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

const naDele = await call(adjunto, "PUT", `/api/training/sessions/${sessionId}/plan`, { objective: "Transição defensiva" });
check("o adjunto planeia a equipa dele", naDele.status === 200, `${naDele.status}`);

if (semAdjunto) {
  // O treino de apoio é do t_sub11 — que É do adjunto; a fronteira precisa de
  // um treino de equipa alheia, criado pela direção.
  const treinoAlheio = await call(director, "POST", "/api/events", {
    kind: "TRAINING", title: "ZZ Treino alheio", teamId: semAdjunto,
    startsAt: TREINO_H, endsAt: "2026-09-10T19:30:00.000Z", venue: "Campo 2",
  });
  const alheioId = treinoAlheio.body?.events?.[0]?.id;
  if (alheioId) {
    const tenta = await call(adjunto, "PUT", `/api/training/sessions/${alheioId}/plan`, { objective: "ZZ invasão" });
    check("e não planeia a equipa de outro (403)", tenta.status === 403, `${tenta.status}`);
    await db.query(`DELETE FROM "TrainingSession" WHERE id = $1`, [alheioId]);
  }
} else {
  console.log("  (o adjunto está em todas as equipas — salto a fronteira do plano)");
}

const exFantasma = await call(coach, "PUT", `/api/training/sessions/${sessionId}/plan`, {
  blocks: [{ name: "Bloco", durationMin: 10, exerciseId: privado.body.id }],
});
check("o autor mete o seu privado num plano", exFantasma.status === 200, `${exFantasma.status}`);
const exAlheioPriv = await call(adjunto, "PUT", `/api/training/sessions/${sessionId}/plan`, {
  blocks: [{ name: "Bloco", durationMin: 10, exerciseId: privado.body.id }],
});
check("um privado alheio num plano recusa (400)", exAlheioPriv.status === 400, `${exAlheioPriv.status}`);

console.log("\n=== Apagar com histórico ===");
// Repõe o plano com o exercício do clube, para ele contar como usado.
await call(coach, "PUT", `/api/training/sessions/${sessionId}/plan`, {
  blocks: [{ name: "Posse 6v4", durationMin: 20, exerciseId: doClube.body.id }],
});
const apagaUsado = await call(coach, "DELETE", `/api/training/exercises/${doClube.body.id}`);
check("apagar um exercício usado arquiva-o", apagaUsado.status === 200 && apagaUsado.body?.archived === true, JSON.stringify(apagaUsado.body));
const listaSem = await call(coach, "GET", "/api/training/exercises");
check("arquivado sai da biblioteca", !(listaSem.body ?? []).some((e) => e.id === doClube.body.id));
const planoAinda = await call(coach, "GET", `/api/training/sessions/${sessionId}/plan`);
check("o bloco do treino sobrevive-lhe", planoAinda.body?.blocks?.[0]?.name === "Posse 6v4");

const apagaLimpo = await call(coach, "DELETE", `/api/training/exercises/${privado.body.id}`);
check("um exercício nunca usado apaga-se mesmo", apagaLimpo.status === 200 && apagaLimpo.body?.archived === false, JSON.stringify(apagaLimpo.body));

console.log("\n=== Modelos de jogo e bolas paradas ===");
const modelo = await call(coach, "POST", "/api/training/game-models", {
  name: "ZZ Sub-11 4-3-3", system: "4-3-3", teamId: "t_sub11",
  lineup: [{ id: "gr", label: "GR", x: 6, y: 34 }],
  principles: { offensive: { "Saída de bola": "curta, pelo GR" } },
});
check("o treinador cria um modelo de jogo", modelo.status === 201, `${modelo.status}`);
const modelos = await call(adjunto, "GET", "/api/training/game-models");
check("o colega lê o modelo do clube", (modelos.body ?? []).some((m) => m.name === "ZZ Sub-11 4-3-3"));
const editaModeloAlheio = await call(adjunto, "PATCH", `/api/training/game-models/${modelo.body.id}`, { name: "ZZ Meu agora" });
check("mas não o edita (403)", editaModeloAlheio.status === 403, `${editaModeloAlheio.status}`);

const canto = await call(coach, "POST", "/api/training/set-pieces", {
  kind: "corner-off", name: "ZZ Canto 2º poste", teamId: "t_sub11",
  diagram: { field: "half", frames: [{ id: "f1", items: [], arrows: [] }] },
});
check("o treinador cria um canto", canto.status === 201, `${canto.status}`);
const cantosPai = await call(parent, "GET", "/api/training/set-pieces");
check("as bolas paradas não são para as famílias (403)", cantosPai.status === 403, `${cantosPai.status}`);

console.log("\n=== Limpeza ===");
await db.query(`DELETE FROM "Exercise" WHERE name LIKE 'ZZ %'`);
await db.query(`DELETE FROM "GameModel" WHERE name LIKE 'ZZ %'`);
await db.query(`DELETE FROM "SetPiece" WHERE name LIKE 'ZZ %'`);
await db.query(`DELETE FROM "TrainingSession" WHERE "startsAt" = $1`, [TREINO_H]);
console.log("  feito");

await db.end();
console.log(`\n${ok} passaram, ${bad} falharam`);
process.exit(bad ? 1 : 0);

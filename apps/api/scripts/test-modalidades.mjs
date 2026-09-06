#!/usr/bin/env node
/**
 * A Área técnica por modalidade, via API.
 *
 * O que interessa, por ordem do que doeria mais estar errado:
 *
 *  1. **Isolamento por modalidade** — um exercício de basquetebol não aparece
 *     na biblioteca do futebol, nem o contrário; os contadores da entrada
 *     contam o que a lista mostra.
 *  2. **Adopção** — o conteúdo que estava sem modalidade entra na modalidade
 *     certa quando ela é criada, e só o da disciplina certa.
 *  3. **Relações** — sistema ↔ exercícios ↔ situação gravam-se, lêem-se de
 *     volta e recusam o que quem liga não pode ver.
 *  4. **Disciplina** — só as três conhecidas; o resto é 400.
 *  5. **Permissão** — a porta continua a ser `training:read`.
 *
 * Uso: node scripts/test-modalidades.mjs   (API a correr; API_URL para outra porta)
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

const ACADEMY = (await db.query(`SELECT id FROM "Academy" WHERE slug = 'life-club'`)).rows[0].id;
const FUTEBOL = "sp_fut";

async function limpar() {
  await db.query(`DELETE FROM "SetPiece" WHERE name LIKE 'ZZ %'`);
  await db.query(`DELETE FROM "GameModel" WHERE name LIKE 'ZZ %'`);
  await db.query(`DELETE FROM "Exercise" WHERE name LIKE 'ZZ %'`);
  await db.query(`DELETE FROM "Sport" WHERE "academyId" = $1 AND name LIKE 'ZZ %'`, [ACADEMY]);
}
await limpar();

const director = await login("direcao@lifeclub.pt");
const coach = await login("treinador@lifeclub.pt");
const adjunto = await login("adjunto@lifeclub.pt");
const parent = await login("familia@lifeclub.pt");

const basketDiagram = { field: "basket-half", frames: [{ id: "f1", items: [{ id: "a", kind: "player", x: 20, y: 7.5, label: "1" }], arrows: [] }] };
const grassDiagram = { field: "f7", frames: [{ id: "f1", items: [], arrows: [] }] };

/* ------------------------------------------------------------------------ */
console.log("=== Detecção pelo nome ===");

/*
 * O nome manda. Um clube que chama "Futebol" à sua modalidade quer a área
 * técnica de futebol, e nunca vai carregar num botão para o confirmar — foi
 * assim que os clubes que já existiam ficaram todos sem área nenhuma.
 *
 * Estes testes correm **antes** de o basquetebol de prova ser criado, porque a
 * regra de uma disciplina por clube cruza-se com eles.
 */
const jaExiste = await call(director, "POST", "/api/sports", { name: "ZZ FUTEBOL Sénior" });
check(
  "maiúsculas e sufixos não enganam: 'ZZ FUTEBOL Sénior' é futebol, e o futebol já existe (400)",
  jaExiste.status === 400 && /já está configurada/i.test(jaExiste.body?.message ?? ""),
  `${jaExiste.status} ${JSON.stringify(jaExiste.body?.message)}`,
);

const salao = await call(director, "POST", "/api/sports", { name: "ZZ Futebol de Salão" });
check("'futebol de salão' é futsal, não futebol", salao.status === 201 && salao.body?.code === "futsal", `${salao.status} ${JSON.stringify(salao.body?.code)}`);

const andebol = await call(director, "POST", "/api/sports", { name: "ZZ Andebol" });
check("um nome que a regra não conhece fica sem disciplina", andebol.status === 201 && andebol.body?.code === null, `${andebol.status} ${JSON.stringify(andebol.body?.code)}`);

const renomeia = await call(director, "PATCH", `/api/sports/${andebol.body.id}`, { name: "ZZ Andebol de Praia" });
check("renomear para outro nome desconhecido mantém-no sem disciplina", renomeia.status === 200 && renomeia.body?.code === null, `${JSON.stringify(renomeia.body?.code)}`);

const escolheAMao = await call(director, "PATCH", `/api/sports/${andebol.body.id}`, { code: "basketball" });
check("quando o nome não diz, vale a escolha à mão", escolheAMao.status === 200 && escolheAMao.body?.code === "basketball", `${JSON.stringify(escolheAMao.body?.code)}`);

const basqueteDuplo = await call(director, "POST", "/api/sports", { name: "ZZ Basquete Sub-16" });
check("e o duplicado é recusado mesmo vindo do nome (400)", basqueteDuplo.status === 400, `${basqueteDuplo.status}`);

const renomeiaParaFutebol = await call(director, "PATCH", `/api/sports/${salao.body.id}`, { name: "ZZ Futebol Feminino" });
check("renomear para um nome de disciplina ocupada é recusado (400)", renomeiaParaFutebol.status === 400, `${renomeiaParaFutebol.status}`);

await call(director, "DELETE", `/api/sports/${salao.body.id}`);
await call(director, "DELETE", `/api/sports/${andebol.body.id}`);

/* ------------------------------------------------------------------------ */
console.log("\n=== Disciplina da modalidade ===");

// Dois órfãos antes de a modalidade existir: um de pavilhão de basquetebol e
// um de relva. Só o primeiro deve ser adoptado.
const orfaoBasket = "zz_orf_basket_" + Date.now();
const orfaoRelva = "zz_orf_relva_" + Date.now();
await db.query(
  `INSERT INTO "Exercise" (id, "academyId", visibility, name, diagram, "updatedAt") VALUES ($1, $2, 'CLUB', 'ZZ Órfão de pavilhão', $3, now()), ($4, $2, 'CLUB', 'ZZ Órfão de relva', $5, now())`,
  [orfaoBasket, ACADEMY, JSON.stringify(basketDiagram), orfaoRelva, JSON.stringify(grassDiagram)],
);

const xadrez = await call(director, "POST", "/api/sports", { name: "ZZ Xadrez", code: "chess" });
check("uma disciplina desconhecida é recusada (400)", xadrez.status === 400, `${xadrez.status}`);

const bk = await call(director, "POST", "/api/sports", { name: "ZZ Basquetebol", code: "basketball", positions: ["Base", "Poste"] });
check("a direção cria uma modalidade com disciplina", bk.status === 201 && bk.body?.code === "basketball", `${bk.status} ${JSON.stringify(bk.body)}`);
const BK = bk.body?.id;

const adoptados = await db.query(`SELECT id, "sportId" FROM "Exercise" WHERE id IN ($1, $2)`, [orfaoBasket, orfaoRelva]);
const porId = new Map(adoptados.rows.map((r) => [r.id, r.sportId]));
check("o órfão de pavilhão foi adoptado pela modalidade nova", porId.get(orfaoBasket) === BK, `${porId.get(orfaoBasket)}`);
check("o órfão de relva ficou como estava (não é basquetebol)", porId.get(orfaoRelva) === null, `${porId.get(orfaoRelva)}`);

const semCodigo = await call(director, "PATCH", `/api/sports/${BK}`, { code: "" });
check("tirar a disciplina é permitido e devolve código nulo", semCodigo.status === 200 && semCodigo.body?.code === null, `${semCodigo.status} ${JSON.stringify(semCodigo.body)}`);
const repoe = await call(director, "PATCH", `/api/sports/${BK}`, { code: "basketball" });
check("e volta a pôr-se", repoe.status === 200 && repoe.body?.code === "basketball", `${repoe.status}`);

/* ------------------------------------------------------------------------ */
console.log("\n=== Biblioteca por modalidade ===");

const drill = await call(coach, "POST", "/api/training/exercises", {
  name: "ZZ Drill de lançamento", category: "Técnica individual", objectives: ["Lançamento"], sportId: BK, diagram: basketDiagram,
});
check("o treinador cria um exercício de basquetebol", drill.status === 201 && !!drill.body?.id, `${drill.status} ${JSON.stringify(drill.body)}`);

const rondo = await call(coach, "POST", "/api/training/exercises", { name: "ZZ Rondo 4v2", sportId: FUTEBOL, diagram: grassDiagram });
check("e um de futebol", rondo.status === 201, `${rondo.status}`);

const invalido = await call(coach, "POST", "/api/training/exercises", { name: "ZZ Sem modalidade válida", sportId: "nao-existe" });
check("uma modalidade que não existe é recusada (400)", invalido.status === 400, `${invalido.status}`);

const doBasket = await call(coach, "GET", `/api/training/exercises?sport=${BK}`);
const nomesBasket = (doBasket.body ?? []).map((e) => e.name);
check("a biblioteca de basquetebol tem o drill", nomesBasket.includes("ZZ Drill de lançamento"));
check("e o órfão adoptado", nomesBasket.includes("ZZ Órfão de pavilhão"));
check("mas não o rondo", !nomesBasket.includes("ZZ Rondo 4v2"));

const doFutebol = await call(coach, "GET", `/api/training/exercises?sport=${FUTEBOL}`);
const nomesFutebol = (doFutebol.body ?? []).map((e) => e.name);
check("a biblioteca de futebol tem o rondo", nomesFutebol.includes("ZZ Rondo 4v2"));
check("e não o drill", !nomesFutebol.includes("ZZ Drill de lançamento"));

const tudo = await call(coach, "GET", "/api/training/exercises");
check("sem filtro vem tudo — é o que o plano de treino precisa", (tudo.body ?? []).some((e) => e.name === "ZZ Drill de lançamento") && (tudo.body ?? []).some((e) => e.name === "ZZ Rondo 4v2"));
check("cada exercício diz a modalidade", (tudo.body ?? []).find((e) => e.name === "ZZ Drill de lançamento")?.sportId === BK);

const resumo = await call(coach, "GET", `/api/training/summary?sport=${BK}`);
check(
  "os contadores da entrada contam o que a lista mostra",
  resumo.status === 200 && resumo.body?.exercises?.count === nomesBasket.length && resumo.body?.gameModels?.count === 0,
  JSON.stringify(resumo.body?.exercises),
);
check(
  "e a entrada traz os últimos nomes de cada módulo",
  Array.isArray(resumo.body?.exercises?.recent) &&
    resumo.body.exercises.recent.includes("ZZ Drill de lançamento") &&
    resumo.body.exercises.recent.length <= 3,
  JSON.stringify(resumo.body?.exercises?.recent),
);

const paiResumo = await call(parent, "GET", `/api/training/summary?sport=${BK}`);
check("um encarregado não vê a área técnica (403)", paiResumo.status === 403, `${paiResumo.status}`);

/* ------------------------------------------------------------------------ */
console.log("\n=== Sistemas de jogo e relações ===");

const gm = await call(coach, "POST", "/api/training/game-models", {
  name: "ZZ Pick & roll central", sportId: BK, kind: "offense", system: "5-out",
  lineup: { pitch: "basket", slots: [{ id: "s1", label: "1", x: 17.5, y: 7.5 }] },
  exerciseIds: [drill.body.id],
});
check("o treinador cria um sistema de ataque com exercícios ligados", gm.status === 201, `${gm.status} ${JSON.stringify(gm.body)}`);

const sistemas = await call(adjunto, "GET", `/api/training/game-models?sport=${BK}`);
const oSistema = (sistemas.body ?? []).find((m) => m.name === "ZZ Pick & roll central");
check("o colega lê o sistema, com o tipo", oSistema?.kind === "offense", JSON.stringify(oSistema?.kind));
check("e os exercícios ligados", oSistema?.exercises?.length === 1 && oSistema.exercises[0].id === drill.body.id, JSON.stringify(oSistema?.exercises));

const noFutebol = await call(coach, "GET", `/api/training/game-models?sport=${FUTEBOL}`);
check("o sistema de basquetebol não aparece no futebol", !(noFutebol.body ?? []).some((m) => m.name === "ZZ Pick & roll central"));

const privado = await call(adjunto, "POST", "/api/training/exercises", { name: "ZZ Privado do adjunto", sportId: BK, visibility: "PRIVATE" });
const ligaPrivado = await call(coach, "PATCH", `/api/training/game-models/${gm.body.id}`, { exerciseIds: [privado.body.id] });
check("ligar o exercício privado de um colega é recusado (400)", ligaPrivado.status === 400, `${ligaPrivado.status}`);

const esvazia = await call(coach, "PATCH", `/api/training/game-models/${gm.body.id}`, { exerciseIds: [] });
check("a lista de exercícios substitui-se inteira — esvaziar funciona", esvazia.status === 200);
const depois = (await call(coach, "GET", `/api/training/game-models?sport=${BK}`)).body.find((m) => m.id === gm.body.id);
check("e fica vazia", depois?.exercises?.length === 0, JSON.stringify(depois?.exercises));

const situacao = await call(coach, "POST", "/api/training/set-pieces", {
  kind: "inbound-baseline", name: "ZZ Reposição de fundo — últimos 5s", sportId: BK, gameModelId: gm.body.id,
  exerciseIds: [drill.body.id], diagram: basketDiagram,
});
check("uma situação nasce ligada ao sistema e a exercícios", situacao.status === 201, `${situacao.status} ${JSON.stringify(situacao.body)}`);

const situacoes = await call(adjunto, "GET", `/api/training/set-pieces?sport=${BK}`);
const aSituacao = (situacoes.body ?? []).find((s) => s.name.startsWith("ZZ Reposição"));
check("a lista diz o sistema de que parte", aSituacao?.gameModelId === gm.body.id && aSituacao?.gameModelName === "ZZ Pick & roll central", JSON.stringify([aSituacao?.gameModelId, aSituacao?.gameModelName]));
check("e os exercícios com que se ensaia", aSituacao?.exercises?.[0]?.id === drill.body.id, JSON.stringify(aSituacao?.exercises));

const sistemaFalso = await call(coach, "POST", "/api/training/set-pieces", { kind: "endgame-last", name: "ZZ Sem sistema", sportId: BK, gameModelId: "nao-existe" });
check("um sistema que não existe é recusado (400)", sistemaFalso.status === 400, `${sistemaFalso.status}`);

const ficha = await call(coach, "GET", `/api/training/exercises/${drill.body.id}`);
check("a ficha do exercício diz onde entra", ficha.body?.usedIn?.setPieces?.some((s) => s.id === situacao.body.id) && ficha.body?.usedIn?.gameModels?.length === 0, JSON.stringify(ficha.body?.usedIn));

const copia = await call(adjunto, "POST", `/api/training/exercises/${drill.body.id}/duplicate`, {});
const copiaFicha = await call(adjunto, "GET", `/api/training/exercises/${copia.body?.id}`);
check("a cópia fica na mesma modalidade", copiaFicha.body?.sportId === BK, `${copiaFicha.body?.sportId}`);
await db.query(`DELETE FROM "Exercise" WHERE id = $1`, [copia.body?.id]);

/* ------------------------------------------------------------------------ */
console.log("\n=== Apagar a modalidade ===");

const apagaExercicios = await db.query(`DELETE FROM "Exercise" WHERE name LIKE 'ZZ %' RETURNING id`);
await db.query(`DELETE FROM "SetPiece" WHERE name LIKE 'ZZ %'`);
await db.query(`DELETE FROM "GameModel" WHERE name LIKE 'ZZ %'`);
check("limpeza do conteúdo", apagaExercicios.rowCount >= 3);
const apaga = await call(director, "DELETE", `/api/sports/${BK}`);
check("a modalidade sem equipas apaga-se", apaga.status === 200, `${apaga.status} ${JSON.stringify(apaga.body)}`);

await limpar();
await db.end();
console.log(`\n${ok} passaram, ${bad} falharam`);
process.exit(bad ? 1 : 0);

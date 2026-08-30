#!/usr/bin/env node
/**
 * As competições, da equipa ao jogo.
 *
 * A cadeia que isto prova é a que o produto promete: a equipa diz que provas
 * disputa, o jogo escolhe **uma dessas**, e a convocatória imprime-a sem ninguém
 * a escrever nada. Antes, a competição era texto escrito à mão em cada
 * exportação e lembrado no browser de quem exportava.
 *
 * As recusas interessam mais do que o caminho feliz: um jogo do Sub-13 no
 * campeonato de seniores é um erro de dedo que ninguém apanha depois.
 *
 * Uso: node scripts/test-competitions.mjs
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

// Limpeza de uma corrida anterior.
await db.query(`DELETE FROM "Match" WHERE opponent LIKE 'ZZ %'`);
await db.query(`DELETE FROM "CatalogItem" WHERE kind = 'competitions' AND label LIKE 'ZZ %'`);
await db.query(`DELETE FROM "Team" WHERE name LIKE 'ZZ Equipa Prova%'`);

const director = await login("direcao@lifeclub.pt");
const coach = await login("treinador@lifeclub.pt");

console.log("=== A prova entra no catálogo ===");
const prova = await call(director, "POST", "/api/catalogs", { kind: "competitions", label: "ZZ Campeonato Distrital" });
check("a direção cria uma competição", prova.status === 201 || prova.status === 200, `${prova.status}`);
const outra = await call(director, "POST", "/api/catalogs", { kind: "competitions", label: "ZZ Taça" });
const local = await call(director, "POST", "/api/catalogs", { kind: "venues", label: "ZZ Campo do teste" });

const provaId = (await db.query(`SELECT id FROM "CatalogItem" WHERE label = 'ZZ Campeonato Distrital'`)).rows[0]?.id;
const outraId = (await db.query(`SELECT id FROM "CatalogItem" WHERE label = 'ZZ Taça'`)).rows[0]?.id;
const localId = (await db.query(`SELECT id FROM "CatalogItem" WHERE label = 'ZZ Campo do teste'`)).rows[0]?.id;
check("e fica no catálogo, do tipo certo", Boolean(provaId && outraId));

console.log("\n=== A equipa nasce com as provas que disputa ===");
const equipa = await call(director, "POST", "/api/teams", {
  name: "ZZ Equipa Prova",
  sportId: (await db.query(`SELECT id FROM "Sport" WHERE "academyId" = (SELECT id FROM "Academy" WHERE slug='life-club') LIMIT 1`)).rows[0].id,
  maxAge: 13,
  season: "2026/27",
  schedule: [],
  competitionIds: [provaId],
});
/*
 * Duas provas e não uma: a que se pediu, mais "Amigável", que entra sempre.
 * É ela que torna possível **exigir** a competição ao marcar um jogo — sem ela,
 * uma equipa acabada de criar não teria nada para escolher.
 */
check(
  "a equipa é criada com a prova pedida",
  equipa.status === 201 && equipa.body?.competitions?.some((c) => c.id === provaId),
  JSON.stringify(equipa.body?.competitions),
);
check(
  "e com 'Amigável', que entra sempre",
  equipa.body?.competitions?.some((c) => c.label === "Amigável"),
  JSON.stringify(equipa.body?.competitions),
);
const equipaId = equipa.body?.id;
const amigavelId = equipa.body?.competitions?.find((c) => c.label === "Amigável")?.id;

/*
 * O catálogo é uma tabela só — locais, balneários, tipos de evento e provas
 * partilham-na. Ligar uma equipa a um **local** por engano tem de ser recusado,
 * senão o `kind` não serve para nada.
 */
const comLocal = await call(director, "PUT", `/api/teams/${equipaId}/competicoes`, { competitionIds: [localId] });
check("um item que não é competição é recusado (400)", comLocal.status === 400, `${comLocal.status}`);

console.log("\n=== Editar as provas na ficha da equipa ===");
const editada = await call(director, "PUT", `/api/teams/${equipaId}/competicoes`, {
  competitionIds: [provaId, outraId, amigavelId],
});
check("passam a ser três", editada.status === 200 && editada.body?.competitions?.length === 3, JSON.stringify(editada.body));

const semPermissao = await call(coach, "PUT", `/api/teams/${equipaId}/competicoes`, { competitionIds: [provaId] });
check("um treinador não as edita (403)", semPermissao.status === 403, `${semPermissao.status}`);

const naLista = await call(director, "GET", "/api/teams");
const daLista = (naLista.body ?? []).find((t) => t.id === equipaId);
check("a listagem de equipas devolve-as", daLista?.competitions?.length === 3, JSON.stringify(daLista?.competitions));

console.log("\n=== O jogo escolhe uma delas ===");
const jogo = await call(director, "POST", "/api/events", {
  kind: "MATCH",
  teamId: equipaId,
  title: "ZZ Jogo com prova",
  opponent: "ZZ Adversario",
  startsAt: "2026-10-03T15:00:00.000Z",
  endsAt: "2026-10-03T16:30:00.000Z",
  venue: "Campo ZZ",
  competitionId: provaId,
});
check("o jogo é criado com a prova", jogo.status === 201, `${jogo.status} ${JSON.stringify(jogo.body).slice(0, 120)}`);

const gravada = await db.query(`SELECT "competitionId" FROM "Match" WHERE opponent = 'ZZ Adversario'`);
check("e fica gravada no jogo", gravada.rows[0]?.competitionId === provaId, JSON.stringify(gravada.rows[0]));

console.log("\n=== A prova tem de ser da equipa ===");
/*
 * Uma prova que existe no catálogo mas que **esta** equipa não disputa. É o erro
 * que a interface não deixa fazer (a lista é a da equipa) e que o servidor tem
 * de recusar na mesma, porque a interface não é a fronteira.
 */
const soDaOutra = await call(director, "POST", "/api/catalogs", { kind: "competitions", label: "ZZ Prova de outros" });
const soDaOutraId = (await db.query(`SELECT id FROM "CatalogItem" WHERE label = 'ZZ Prova de outros'`)).rows[0].id;
const jogoErrado = await call(director, "POST", "/api/events", {
  kind: "MATCH",
  teamId: equipaId,
  title: "ZZ Jogo prova alheia",
  opponent: "ZZ Adversario 2",
  startsAt: "2026-10-10T15:00:00.000Z",
  endsAt: "2026-10-10T16:30:00.000Z",
  venue: "Campo ZZ",
  competitionId: soDaOutraId,
});
check("uma prova que a equipa não disputa é recusada (400)", jogoErrado.status === 400, `${jogoErrado.status}`);

console.log("\n=== O que a convocatória recebe ===");
const jogos = await call(director, "GET", "/api/matches");
const oJogo = (jogos.body ?? []).find((m) => m.opponent === "ZZ Adversario");
check("a lista de jogos traz a prova", oJogo?.competition?.label === "ZZ Campeonato Distrital", JSON.stringify(oJogo?.competition));

const detalhe = await call(director, "GET", `/api/matches/${oJogo.id}`);
check("o detalhe do jogo também", detalhe.body?.competition?.label === "ZZ Campeonato Distrital", JSON.stringify(detalhe.body?.competition));

console.log("\n=== Um jogo tem sempre prova ===");
/*
 * A competição passou a ser obrigatória: é a convocatória que a exige, e um jogo
 * sem prova obrigava quem exporta a escrevê-la à mão — o remendo que isto veio
 * substituir. "Nenhuma prova" chama-se amigável, e diz-se.
 */
const semProva = await call(director, "POST", "/api/events", {
  kind: "MATCH",
  teamId: equipaId,
  title: "ZZ Sem prova",
  opponent: "ZZ Ninguem",
  startsAt: "2026-10-17T15:00:00.000Z",
  endsAt: "2026-10-17T16:30:00.000Z",
  venue: "Campo ZZ",
});
check("um jogo sem competição é recusado (400)", semProva.status === 400, `${semProva.status}`);
check(
  "e a mensagem diz o que fazer",
  String(semProva.body?.message ?? "").includes("Amigável"),
  JSON.stringify(semProva.body?.message),
);

const amigavel = await call(director, "POST", "/api/events", {
  kind: "MATCH",
  teamId: equipaId,
  title: "ZZ Amigavel",
  opponent: "ZZ Amigos",
  startsAt: "2026-10-17T15:00:00.000Z",
  endsAt: "2026-10-17T16:30:00.000Z",
  venue: "Campo ZZ",
  competitionId: amigavelId,
});
check("com 'Amigável' cria-se", amigavel.status === 201, `${amigavel.status}`);
const daBase = await db.query(
  `SELECT c.label FROM "Match" m JOIN "CatalogItem" c ON c.id = m."competitionId" WHERE m.opponent = 'ZZ Amigos'`,
);
check("e o jogo fica com ela", daBase.rows[0]?.label === "Amigável", JSON.stringify(daBase.rows[0]));

console.log("\n=== Arquivar a prova não apaga a história ===");
await db.query(`UPDATE "CatalogItem" SET "archivedAt" = now() WHERE id = $1`, [outraId]);
const depoisDeArquivar = await call(director, "GET", "/api/teams");
const equipaAgora = (depoisDeArquivar.body ?? []).find((t) => t.id === equipaId);
check(
  "uma prova arquivada sai da lista de escolha da equipa",
  equipaAgora?.competitions?.length === 2 && !equipaAgora.competitions.some((c) => c.id === outraId),
  JSON.stringify(equipaAgora?.competitions),
);
const jogoAindaTem = await call(director, "GET", "/api/matches");
check(
  "mas o jogo que se disputou nela mantém a sua",
  (jogoAindaTem.body ?? []).find((m) => m.opponent === "ZZ Adversario")?.competition?.label === "ZZ Campeonato Distrital",
);

/* ------------------------------------------------------------------ limpeza */
await db.query(`DELETE FROM "Match" WHERE opponent LIKE 'ZZ %'`);
await db.query(`DELETE FROM "Team" WHERE name LIKE 'ZZ Equipa Prova%'`);
// Só o que este teste criou. A "Amigável" é do sistema e fica.
await db.query(`DELETE FROM "CatalogItem" WHERE label LIKE 'ZZ %'`);

await db.end();
console.log(`\n${ok} passaram, ${bad} falharam`);
process.exit(bad ? 1 : 0);

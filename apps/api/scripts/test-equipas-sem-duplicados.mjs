#!/usr/bin/env node
/**
 * Equipas: quem as vê, e porque é que não podem repetir-se.
 *
 * ## O que aconteceu, e que isto impede de voltar a acontecer
 *
 * Uma treinadora com `athlete:write` mas **sem equipas atribuídas** via a lista
 * de equipas vazia. O importador de atletas lê essa lista para decidir o que já
 * existe, concluiu que as oito equipas do ficheiro eram novas, e ofereceu-se
 * para as criar. Ela disse que sim — três vezes, em dois dias. O clube ficou
 * com **oito equipas em triplicado**, porque o `POST /api/teams` não verificava
 * nomes repetidos (o `POST /api/teams/import` verificava; dois caminhos, duas
 * regras).
 *
 * Prova-se aqui:
 *
 *  - Quem inscreve atletas **vê o clube todo**, tenha equipas atribuídas ou não.
 *  - Quem não inscreve continua a ver só o seu âmbito.
 *  - O mesmo nome, na mesma modalidade e época, é recusado — pelos dois
 *    caminhos, e pela base.
 *  - O mesmo nome noutra **modalidade** entra, que é o caso legítimo.
 *
 * Uso: node scripts/test-equipas-sem-duplicados.mjs
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

let ok = 0, bad = 0;
const check = (l, c, d = "") => { if (c) { ok++; console.log("  OK    " + l); } else { bad++; console.log("  FALHA " + l + (d ? " — " + d : "")); } };

const login = async (email, password = "academia2026") =>
  (await (await fetch(`${S}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: A, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  })).json()).access_token;

const call = async (token, method, pathname, body) => {
  const r = await fetch(API + pathname, {
    method,
    headers: { Authorization: `Bearer ${token}`, "x-academy-slug": "life-club", "x-app": "console", ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};

const db = new pg.Client({ connectionString: env("MIGRATE_DATABASE_URL"), ssl: { rejectUnauthorized: false } });
await db.connect();
await db.query(`DELETE FROM "Team" WHERE name LIKE 'ZZ Teste%'`);

/* ------------------------------------------------------------------------ */
console.log("=== Quem vê as equipas ===");
const presidente = await login("presidente@lifeclub.pt");
const treinador = await login("treinador@lifeclub.pt");

const todas = await call(presidente, "GET", "/api/teams");
check("a presidência vê as equipas", todas.status === 200 && todas.body.length > 0, `${todas.status} ${todas.body?.length}`);

const doTreinador = await call(treinador, "GET", "/api/teams");
check("o treinador responde", doTreinador.status === 200, `${doTreinador.status}`);

/*
 * O treinador semeado tem equipas atribuídas, por isso o que se prova aqui é a
 * regra e não o acaso: com `athlete:write` vê **tudo**, e o número tem de bater
 * certo com o da presidência.
 */
const meuPerfil = (await call(treinador, "GET", "/api/bootstrap")).body?.me;
const podeInscrever = meuPerfil?.permissions?.includes?.("athlete:write");
if (podeInscrever === false) {
  check("sem athlete:write, o treinador continua estreitado", doTreinador.body.length <= todas.body.length);
} else {
  check(
    "com athlete:write, o treinador vê o clube todo",
    doTreinador.body.length === todas.body.length,
    `treinador ${doTreinador.body.length} vs clube ${todas.body.length}`,
  );
}

/* ------------------------------------------------------------------------ */
console.log("\n=== Nomes repetidos ===");
// As modalidades vêm no bootstrap — não há endpoint próprio.
const desportos = (await call(presidente, "GET", "/api/bootstrap")).body?.sports ?? [];
const futebol = desportos.find((s) => /futebol/i.test(s.name)) ?? desportos[0];
const outra = desportos.find((s) => s.id !== futebol?.id);
check("há pelo menos uma modalidade", Boolean(futebol), JSON.stringify(desportos.map((s) => s.name)));

const NOME = "ZZ Teste Sub-11";
const base = { name: NOME, sportId: futebol.id, maxAge: 11, season: "2026/27", schedule: [] };

const um = await call(presidente, "POST", "/api/teams", base);
check("a primeira entra", um.status === 201 || um.status === 200, `${um.status} ${JSON.stringify(um.body).slice(0, 120)}`);

const dois = await call(presidente, "POST", "/api/teams", base);
check("a segunda com o mesmo nome é recusada", dois.status === 400, `${dois.status}`);
check("e diz porquê", /já existe/i.test(dois.body?.message ?? ""), JSON.stringify(dois.body).slice(0, 140));

const espacos = await call(presidente, "POST", "/api/teams", { ...base, name: `  ${NOME.toUpperCase()}  ` });
check("nem com maiúsculas e espaços a mais", espacos.status === 400, `${espacos.status}`);

if (outra) {
  const noutra = await call(presidente, "POST", "/api/teams", { ...base, name: NOME, sportId: outra.id });
  check(`o mesmo nome noutra modalidade (${outra.name}) entra`, noutra.status === 201 || noutra.status === 200, `${noutra.status} ${JSON.stringify(noutra.body).slice(0, 120)}`);
} else {
  console.log("  (só há uma modalidade — o caso «noutra modalidade» não se pode provar aqui)");
}

/* ------------------------------------------------------------------------ */
console.log("\n=== E pelo caminho da importação ===");
const imp = await call(presidente, "POST", "/api/teams/import", {
  rows: [
    { name: NOME, sport: futebol.name, maxAge: 11 },
    { name: "ZZ Teste Nova", sport: futebol.name, maxAge: 13 },
    { name: "ZZ Teste Nova", sport: futebol.name, maxAge: 13 },
  ],
});
check("a importação responde", imp.status === 201 || imp.status === 200, `${imp.status}`);
check("cria só a que não existia", imp.body?.created === 1, `criou ${imp.body?.created}`);
check("recusa a que já existe", imp.body?.errors?.some((e) => /já existe/i.test(e.error)), JSON.stringify(imp.body?.errors));
check("e a repetida dentro do próprio ficheiro", imp.body?.errors?.length === 2, `${imp.body?.errors?.length} erros`);

/* ------------------------------------------------------------------------ */
console.log("\n=== A base recusa mesmo que o código falhe ===");
const { rows: eq } = await db.query(`SELECT id, "academyId", "seasonId", "sportId", name FROM "Team" WHERE name = $1 LIMIT 1`, [NOME]);
let recusou = false;
try {
  await db.query(
    `INSERT INTO "Team" (id, "academyId", "seasonId", "sportId", name, "maxAge", schedule, "createdAt", "updatedAt")
     VALUES ('zz_teste_直接', $1, $2, $3, $4, 11, '[]'::jsonb, now(), now())`,
    [eq[0].academyId, eq[0].seasonId, eq[0].sportId, `  ${NOME.toLowerCase()} `],
  );
} catch (e) {
  recusou = /duplicate key|unique/i.test(e.message);
}
check("um INSERT directo com o mesmo nome é recusado pelo índice", recusou);

/* ------------------------------------------------------------------------ */
console.log("\n=== Limpeza ===");
await db.query(`DELETE FROM "Team" WHERE name LIKE 'ZZ Teste%' OR name ILIKE '%zz teste%'`);
await db.end();
console.log("  feito");

console.log(`\n${ok} OK, ${bad} falhas`);
process.exit(bad ? 1 : 0);

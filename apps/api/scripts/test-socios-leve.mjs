#!/usr/bin/env node
/**
 * A ficha de sócio que não exige o que o clube não tem.
 *
 * Duas queixas do mesmo sítio, e a mesma raiz nas duas: pedia-se a ficha
 * completa a quem só tem meia.
 *
 * - **Editar** recusava a gravação com "morada obrigatória" a quem só queria
 *   corrigir um telefone. A interface mandava sempre os campos todos, os vazios
 *   batiam num comprimento mínimo do DTO, e a queixa saía sobre um campo em que
 *   ninguém tinha tocado.
 * - **Importar** exigia email, data de nascimento, morada, código postal,
 *   localidade, documento e NIF. *"Exige muita informação que o Excel não tem."*
 *
 * O que este teste guarda é o novo contrato: só o nome, o número e o telemóvel
 * são exigidos na edição; só o nome, o número, o telemóvel e a categoria na
 * folha; um campo vazio **apaga** em vez de recusar; e o que vier preenchido
 * continua a ter de estar bem — um NIF de oito dígitos é pior do que um NIF em
 * falta, porque ninguém sabe que está errado.
 *
 * Uso: node scripts/test-socios-leve.mjs
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

const limpar = async () => {
  await db.query(`DELETE FROM "Member" WHERE name LIKE 'ZS %'`);
  await db.query(`DELETE FROM "MemberTier" WHERE name LIKE 'ZS %'`);
};
await limpar();

const director = await login("direcao@lifeclub.pt");

/* ========================================================== a edição === */

console.log("=== Um sócio do balcão, com meia ficha ===");
const criado = await call(director, "POST", "/api/members", {
  name: "ZS Manuel Antunes",
  phone: "912000001",
});
check("cria-se só com nome e telemóvel", criado.status === 201, `${criado.status} ${JSON.stringify(criado.body).slice(0, 140)}`);
const id = criado.body?.id;

/*
 * A gravação que dava a queixa: a interface manda os campos todos, e os que a
 * ficha não tem vão vazios. Antes, o vazio batia num `@Length(3, 160)` e a
 * resposta era "morada obrigatória" a quem só mexeu no telefone.
 */
const comVazios = await call(director, "PATCH", `/api/members/${id}`, {
  name: "ZS Manuel Antunes",
  phone: "912000002",
  email: "",
  address: "",
  postalCode: "",
  city: "",
  birthdate: "",
  documentNumber: "",
  taxId: "",
  notes: "",
});
check("gravar com morada, código postal e cidade vazios passa", comVazios.status === 200, `${comVazios.status} ${JSON.stringify(comVazios.body).slice(0, 160)}`);

const depois = await db.query(`SELECT phone, address, "postalCode", city FROM "Member" WHERE id = $1`, [id]);
check("o telefone mudou", depois.rows[0].phone === "912000002", JSON.stringify(depois.rows[0]));
check(
  "e os vazios ficaram vazios, não recusados",
  depois.rows[0].address === null && depois.rows[0].postalCode === null && depois.rows[0].city === null,
  JSON.stringify(depois.rows[0]),
);

console.log("\n=== A identidade edita-se ===");
/*
 * Estes três campos não se editavam. O argumento — corrigem-se a olhar para o
 * documento — não sobrevivia ao balcão: um sócio inscrito à pressa ficava para
 * sempre sem NIF, e sem NIF o clube não lhe passa um recibo.
 */
const identidade = await call(director, "PATCH", `/api/members/${id}`, {
  birthdate: "1987-03-14",
  documentKind: "CC",
  documentNumber: "12345678 9 ZZ4",
  taxId: "212345678",
  sex: "MALE",
});
check("data de nascimento, documento, NIF e sexo gravam", identidade.status === 200, `${identidade.status} ${JSON.stringify(identidade.body).slice(0, 160)}`);

const ficha = await db.query(
  `SELECT birthdate, "documentNumber", "taxId", sex FROM "Member" WHERE id = $1`,
  [id],
);
check(
  "e ficam na base",
  ficha.rows[0].taxId === "212345678" && ficha.rows[0].documentNumber === "12345678 9 ZZ4" && ficha.rows[0].sex === "MALE",
  JSON.stringify(ficha.rows[0]),
);

console.log("\n=== O que vier, vem certo ===");
const nifCurto = await call(director, "PATCH", `/api/members/${id}`, { taxId: "1234" });
check("um NIF de quatro dígitos é recusado (400)", nifCurto.status === 400, `${nifCurto.status}`);

const cpTorto = await call(director, "PATCH", `/api/members/${id}`, { postalCode: "4700" });
check("um código postal sem hífen é recusado (400)", cpTorto.status === 400, `${cpTorto.status}`);

const emailTorto = await call(director, "PATCH", `/api/members/${id}`, { email: "isto-nao-e-email" });
check("um email inválido é recusado (400)", emailTorto.status === 400, `${emailTorto.status}`);

const limpaNif = await call(director, "PATCH", `/api/members/${id}`, { taxId: "" });
const semNif = await db.query(`SELECT "taxId" FROM "Member" WHERE id = $1`, [id]);
check("mas vazio apaga-o", limpaNif.status === 200 && semNif.rows[0].taxId === null, JSON.stringify(semNif.rows[0]));

/* ======================================================= a importação === */

console.log("\n=== A folha que o clube tem mesmo ===");
await call(director, "POST", "/api/members/tiers", { name: "ZS Efectivo" });

/*
 * Quatro colunas. Era esta a queixa: exigiam-se sete campos que um livro de
 * sócios em papel nunca teve.
 */
const magra = await call(director, "POST", "/api/members/import", {
  rows: [
    { line: 2, name: "ZS Ana Ferreira", number: 90001, phone: "912000010", tier: "ZS Efectivo" },
    { line: 3, name: "ZS Bruno Costa", number: 90002, phone: "912000011", tier: "ZS Efectivo" },
  ],
});
check("importa com nome, número, telemóvel e categoria", magra.status === 201 && magra.body?.ok === true, `${magra.status} ${JSON.stringify(magra.body).slice(0, 200)}`);
check("e cria os dois", magra.body?.created === 2, JSON.stringify(magra.body));

const importados = await db.query(`SELECT name, email, "taxId", address FROM "Member" WHERE name LIKE 'ZS A%' OR name LIKE 'ZS B%'`);
check(
  "sem inventar nada nos campos que a folha não trazia",
  importados.rows.every((r) => r.email === null && r.taxId === null && r.address === null),
  JSON.stringify(importados.rows),
);

console.log("\n=== Sem telemóvel, sem número ou sem categoria, não ===");
for (const [falta, row] of [
  ["telemóvel", { name: "ZS Sem Tlm", number: 90010, tier: "ZS Efectivo" }],
  ["número", { name: "ZS Sem Numero", phone: "912000012", tier: "ZS Efectivo" }],
  ["categoria", { name: "ZS Sem Tipo", number: 90011, phone: "912000013" }],
]) {
  const r = await call(director, "POST", "/api/members/import", { rows: [{ line: 2, ...row }] });
  check(`uma linha sem ${falta} é recusada (400)`, r.status === 400, `${r.status}`);
}

console.log("\n=== Uma categoria nova pergunta-se, não se inventa ===");
/*
 * O servidor pára e devolve os nomes. Uma categoria a mais no livro do clube é
 * uma categoria a mais nas quotas, nos benefícios e no site — não é uma decisão
 * para tomar sozinho enquanto alguém carrega um ficheiro.
 */
const comNova = await call(director, "POST", "/api/members/import", {
  rows: [{ line: 2, name: "ZS Carla Dias", number: 90003, phone: "912000014", tier: "ZS Ouro" }],
});
check("a importação pára", comNova.body?.ok === false, JSON.stringify(comNova.body).slice(0, 160));
check("e diz qual é a categoria nova", JSON.stringify(comNova.body?.unknownTiers) === JSON.stringify(["ZS Ouro"]), JSON.stringify(comNova.body?.unknownTiers));
check("sem criar ninguém", comNova.body?.created === 0);
const nenhuma = await db.query(`SELECT count(*)::int AS n FROM "MemberTier" WHERE name = 'ZS Ouro'`);
check("nem a categoria", nenhuma.rows[0].n === 0);

const confirmada = await call(director, "POST", "/api/members/import", {
  rows: [{ line: 2, name: "ZS Carla Dias", number: 90003, phone: "912000014", tier: "ZS Ouro" }],
  createTiers: true,
});
check("com a resposta 'sim', importa", confirmada.body?.ok === true && confirmada.body?.created === 1, JSON.stringify(confirmada.body).slice(0, 160));

const criada = await db.query(`SELECT "isPublic" FROM "MemberTier" WHERE name = 'ZS Ouro'`);
check("e a categoria nasce", criada.rowCount === 1, JSON.stringify(criada.rows));
/* Fora do site até alguém decidir publicá-la: uma categoria criada a meio de uma
   importação não é uma decisão de comunicação do clube. */
check("mas não publicada", criada.rows[0]?.isPublic === false, JSON.stringify(criada.rows[0]));

console.log("\n=== Maiúsculas e acentos não fazem categoria nova ===");
const mesmaCoisa = await call(director, "POST", "/api/members/import", {
  rows: [
    { line: 2, name: "ZS Diogo Melo", number: 90004, phone: "912000015", tier: "zs ouro" },
    { line: 3, name: "ZS Eva Pinto", number: 90005, phone: "912000016", tier: "ZS EFECTIVO" },
  ],
});
check("'zs ouro' e 'ZS Ouro' são a mesma", mesmaCoisa.body?.ok === true, JSON.stringify(mesmaCoisa.body).slice(0, 200));
check("e não se criam categorias novas", (await db.query(`SELECT count(*)::int AS n FROM "MemberTier" WHERE name LIKE 'ZS %'`)).rows[0].n === 2);

const ligadas = await db.query(
  `SELECT m.name, t.name AS tier FROM "Member" m JOIN "MemberTier" t ON t.id = m."tierId" WHERE m.name IN ('ZS Diogo Melo', 'ZS Eva Pinto') ORDER BY m.name`,
);
check(
  "cada um foi para a categoria certa",
  ligadas.rows[0]?.tier === "ZS Ouro" && ligadas.rows[1]?.tier === "ZS Efectivo",
  JSON.stringify(ligadas.rows),
);

console.log("\n=== Importar a mesma folha duas vezes ===");
/*
 * O NIF era a chave de duplicados. Com o NIF a deixar de ser obrigatório, uma
 * segunda importação da mesma folha duplicava o clube inteiro — agora manda o
 * número, que é o que identifica o sócio no livro.
 */
const outraVez = await call(director, "POST", "/api/members/import", {
  rows: [{ line: 2, name: "ZS Ana Ferreira", number: 90001, phone: "912000010", tier: "ZS Efectivo" }],
});
check("o mesmo número não entra duas vezes", outraVez.body?.created === 0, JSON.stringify(outraVez.body));
check("e é reportado como já existente", outraVez.body?.duplicates?.length === 1, JSON.stringify(outraVez.body?.duplicates));

console.log("\n=== A idade da categoria só conta se a folha trouxer a data ===");
await call(director, "POST", "/api/members/tiers", { name: "ZS Juvenil", maxAge: 17 });
const semData = await call(director, "POST", "/api/members/import", {
  rows: [{ line: 2, name: "ZS Filipe Novo", number: 90006, phone: "912000017", tier: "ZS Juvenil" }],
});
check("sem data de nascimento, entra", semData.body?.ok === true && semData.body?.created === 1, JSON.stringify(semData.body).slice(0, 160));

const velhoDemais = await call(director, "POST", "/api/members/import", {
  rows: [{ line: 2, name: "ZS Gil Antigo", number: 90007, phone: "912000018", tier: "ZS Juvenil", birthdate: "1970-01-01" }],
});
check("com data fora do escalão, é recusado", velhoDemais.body?.ok === false && velhoDemais.body?.problems?.length === 1, JSON.stringify(velhoDemais.body).slice(0, 200));

/* ------------------------------------------------------------------ limpeza */
await limpar();
await db.end();
console.log(`\n${ok} passaram, ${bad} falharam`);
process.exit(bad ? 1 : 0);

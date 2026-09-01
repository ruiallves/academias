#!/usr/bin/env node
/**
 * A época que o Orçamento usa quando ninguém escolheu nenhuma.
 *
 * ## O que rebentou em produção
 *
 * "Planear Orçamento" → **"Época não encontrada"**, em todos os clubes. O
 * servidor pedia `Season.isCurrent = true` e nenhum clube tinha essa marca: as
 * épocas nascem sozinhas quando se cria a primeira equipa, e nascem por marcar
 * de propósito. Nada, em lado nenhum do produto, escreve `isCurrent` — não havia
 * nada que a direcção pudesse fazer na consola para desbloquear a página.
 *
 * Este teste fixa a regra do `currentSeason`: a marcada, se houver; senão a mais
 * recente. E a diferença entre "não tens épocas" (clube por arrancar) e "essa
 * época não existe" (id errado), que são dois problemas com respostas
 * diferentes.
 *
 * Uso: node scripts/test-orcamento-epoca.mjs
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
    method,
    headers: { Authorization: `Bearer ${token}`, "x-academy-slug": "life-club", ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};

const db = new pg.Client({ connectionString: env("MIGRATE_DATABASE_URL"), ssl: { rejectUnauthorized: false } });
await db.connect();

const academyId = (await db.query(`SELECT id FROM "Academy" WHERE slug = 'life-club'`)).rows[0].id;

/*
 * O estado das épocas deste clube é dado de verdade — este teste mexe-lhe e tem
 * de o repor exactamente como estava, mesmo que rebente a meio.
 */
const original = (await db.query(
  `SELECT id, "isCurrent" FROM "Season" WHERE "academyId" = $1 ORDER BY "startsOn" DESC`, [academyId],
)).rows;
const repor = async () => {
  await db.query(`DELETE FROM "Season" WHERE "academyId" = $1 AND label LIKE 'ZZ %'`, [academyId]);
  for (const s of original) {
    await db.query(`UPDATE "Season" SET "isCurrent" = $2 WHERE id = $1`, [s.id, s.isCurrent]);
  }
};

const director = await login("direcao@lifeclub.pt");

try {
  console.log("=== O clube tem uma época, ninguém a marcou ===");
  /*
   * É este o estado de produção: uma época por clube, criada pela primeira
   * equipa, com `isCurrent = false`. Reproduz-se aqui em vez de se assumir.
   */
  await db.query(`UPDATE "Season" SET "isCurrent" = false WHERE "academyId" = $1`, [academyId]);

  const semMarca = await call(director, "GET", "/api/finance/budgets");
  check("o orçamento abre à mesma", semMarca.status === 200, `${semMarca.status} ${JSON.stringify(semMarca.body).slice(0, 120)}`);
  check("e vem com a época do clube", Boolean(semMarca.body?.season?.id), JSON.stringify(semMarca.body?.season));
  check("com as categorias de despesa", Array.isArray(semMarca.body?.rows));

  console.log("\n=== Duas épocas ===");
  /* Uma época mais recente, por marcar: sem marca nenhuma, ganha a mais nova. */
  const nova = `zz_season_${Date.now().toString(36)}`;
  await db.query(
    `INSERT INTO "Season" (id, "academyId", label, "startsOn", "endsOn", "isCurrent")
     VALUES ($1, $2, 'ZZ 2027/28', '2027-08-01', '2028-07-31', false)`,
    [nova, academyId],
  );
  const maisRecente = await call(director, "GET", "/api/finance/budgets");
  check("sem marca, ganha a mais recente", maisRecente.body?.season?.id === nova, `${maisRecente.body?.season?.label}`);

  /*
   * E com marca, ganha a marcada — mesmo sendo a mais antiga.
   *
   * É o ponto todo do campo: uma pessoa a dizer em que época o clube está vale
   * mais do que a ordem das datas. Se a regra fosse só "a mais recente", marcar
   * uma época deixava de servir para alguma coisa.
   */
  const antiga = original[0].id;
  await db.query(`UPDATE "Season" SET "isCurrent" = true WHERE id = $1`, [antiga]);
  const marcada = await call(director, "GET", "/api/finance/budgets");
  check("com marca, ganha a marcada mesmo sendo mais antiga", marcada.body?.season?.id === antiga, `${marcada.body?.season?.label}`);

  console.log("\n=== Escolher uma época à mão ===");
  const pedida = await call(director, "GET", `/api/finance/budgets?seasonId=${nova}`);
  check("o seasonId pedido ganha a tudo", pedida.body?.season?.id === nova, `${pedida.body?.season?.label}`);
  const inventada = await call(director, "GET", "/api/finance/budgets?seasonId=nao_existe");
  check("um id inventado dá 404", inventada.status === 404, `${inventada.status}`);
  check("e diz que é a época que não existe", inventada.body?.message === "Época não encontrada", `${inventada.body?.message}`);

  console.log("\n=== Gravar um tecto na época que veio ===");
  const alvo = await call(director, "GET", "/api/finance/budgets");
  const categoria = alvo.body?.rows?.[0]?.categoryId;
  if (categoria) {
    const gravou = await call(director, "PUT", "/api/finance/budgets", {
      seasonId: alvo.body.season.id, categoryId: categoria, amountCents: 123456,
    });
    check("o tecto grava-se na época que a página mostrou", gravou.status === 200, `${gravou.status}`);
    const relido = await call(director, "GET", "/api/finance/budgets");
    check("e relê-se", relido.body?.rows?.find((r) => r.categoryId === categoria)?.budgetCents === 123456);
    /* Zero apaga a linha — é como a página desfaz. Repõe o clube como estava. */
    await call(director, "PUT", "/api/finance/budgets", { seasonId: alvo.body.season.id, categoryId: categoria, amountCents: 0 });
    const limpo = await call(director, "GET", "/api/finance/budgets");
    check("e zero apaga-o", limpo.body?.rows?.find((r) => r.categoryId === categoria)?.budgetCents === 0);
  } else {
    check("há categorias de despesa para orçamentar", false, "o catálogo veio vazio");
  }

  console.log("\n=== Um clube sem épocas nenhumas ===");
  /*
   * Este caso não se prova a mexer em dados reais.
   *
   * Acontece a um clube acabado de abrir — sem equipas, sem épocas — e para o
   * reproduzir aqui era preciso tirar a época ao clube de demonstração, com as
   * equipas dele penduradas nela. Uma corrida interrompida a meio deixava um
   * clube partido para provar uma mensagem de erro: não compensa.
   *
   * Fica a garantia que interessa e que não custa nada: que as duas mensagens
   * são mesmo duas, e que ninguém volta a pôr um `isCurrent: true` cru num
   * serviço — que foi exactamente o que causou isto.
   */
  const fonte = (rel) => readFileSync(path.join(HERE, "..", "src", rel), "utf8");
  const finance = fonte("finance/finance.service.ts");
  check(
    "o clube sem épocas ouve o que há-de fazer",
    finance.includes("a primeira abre com a primeira equipa"),
  );
  check("e o id inventado continua a dar a outra frase", finance.includes('"Época não encontrada"'));

  /*
   * A varredura é por serviço e não pelo `src` todo: `academy.service.ts` lê
   * `isCurrent` de propósito (traz **todas** as épocas e escolhe em memória), e
   * `store` já fazia a escolha certa antes de isto existir.
   */
  /*
   * Sem comentários, primeiro.
   *
   * A nota que explica porque é que `isCurrent: true` estava errado contém, ela
   * própria, `isCurrent: true`. Uma varredura que se deixa apanhar pela sua
   * própria explicação é uma varredura que grita para sempre — e que a seguir se
   * desliga, que é o pior fim de um guarda.
   */
  const semComentarios = (t) => t.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
  const suspeitos = ["finance/finance.service.ts", "inventory/inventory.service.ts"]
    .filter((rel) => /isCurrent:\s*true/.test(semComentarios(fonte(rel))));
  check("nenhum serviço pede `isCurrent: true` à base", suspeitos.length === 0, suspeitos.join(", "));
  check("e os dois passaram a usar o `currentSeason`",
    ["finance/finance.service.ts", "inventory/inventory.service.ts"].every((rel) => fonte(rel).includes("currentSeason(db)")));

} finally {
  console.log("\n=== Repor ===");
  await repor();
  const final = (await db.query(
    `SELECT id, "isCurrent" FROM "Season" WHERE "academyId" = $1 ORDER BY "startsOn" DESC`, [academyId],
  )).rows;
  check(
    "o clube fica exactamente como estava",
    JSON.stringify(final) === JSON.stringify(original),
    `${JSON.stringify(final)} vs ${JSON.stringify(original)}`,
  );
  await db.end();
}

console.log(`\n${ok} passaram, ${bad} falharam`);
process.exit(bad === 0 ? 0 : 1);

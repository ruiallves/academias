#!/usr/bin/env node
/**
 * Apagar um sócio, e o número que ele deixa para trás.
 *
 * ## As duas queixas
 *
 * *"Deve ser possível apagar sócios que tenham criado; neste momento não deixa
 * apagar sócios que já tenham conta."* Não deixava apagar **nenhum** sócio com
 * número atribuído — e o número sai na aprovação, ou seja em todos os que
 * chegaram a ser sócios. O travão existia por uma razão certa: apagar a linha
 * libertava o número, e um livro com o 34 a pertencer a duas pessoas ao longo
 * do tempo deixa de servir. Mas o travão estava no gesto errado.
 *
 * *"Se apagar o 2, a nova adesão deve continuar a ser o 4, não deve entrar no
 * 2 — o 2 seria apenas para inserções manuais."* É a regra que substitui o
 * travão: o buraco fica aberto, e só se enche à mão.
 *
 * ## O que este teste guarda
 *
 * - **apaga-se** um sócio com número, com conta na app e com quotas pagas;
 * - o buraco **no meio** não volta à fila (era o caso que já funcionava, por
 *   acidente: `MAX(number)` não desce quando se apaga do meio);
 * - o buraco **no topo** também não — e este é o que estava avariado. Apagar a
 *   ficha com o número mais alto fazia `MAX(number)` descer, e a adesão
 *   seguinte herdava o número de quem tinha acabado de sair. Uma ficha de teste
 *   fica sempre com o número mais alto: era o caso mais fácil de provocar sem
 *   dar por isso;
 * - o buraco **enche-se à mão**, escrevendo o número na ficha;
 * - um número escrito à mão **acima** da marca de água levanta-a, senão a
 *   numeração automática caminhava anos até bater num número já ocupado;
 * - o que sai com a ficha: quotas e pagamentos. O que fica: a conta da app.
 *
 * Uso: node scripts/test-numero-de-socio.mjs
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
const AC = "acd_lifeclub";

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

const marcaDeAgua = async () =>
  (await db.query(`SELECT "lastMemberNumber" AS n FROM "Academy" WHERE id = $1`, [AC])).rows[0].n;

/**
 * A limpeza devolve a marca de água ao que era.
 *
 * Sem isto, cada corrida do teste empurrava a numeração do Life Club uns
 * números para a frente — e um teste que estraga o livro do clube que serve
 * para o demonstrar é um teste que só se corre uma vez.
 */
const marcaInicial = await marcaDeAgua();

const limpar = async () => {
  await db.query(
    `DELETE FROM "Payment" WHERE "memberFeeId" IN (
       SELECT f.id FROM "MemberFee" f JOIN "Member" m ON m.id = f."memberId" WHERE m.name LIKE 'ZN %')`,
  );
  await db.query(`DELETE FROM "MemberFee" WHERE "memberId" IN (SELECT id FROM "Member" WHERE name LIKE 'ZN %')`);
  await db.query(`DELETE FROM "Member" WHERE name LIKE 'ZN %'`);
  await db.query(`UPDATE "Academy" SET "lastMemberNumber" = $2 WHERE id = $1`, [AC, marcaInicial]);
};
await limpar();

const director = await login("direcao@lifeclub.pt");

/** Um sócio activo, criado como a secretaria o cria — o número vem automático. */
const criar = async (nome) => {
  const r = await call(director, "POST", "/api/members", {
    name: nome,
    phone: `9120001${String(Math.floor(Math.random() * 90) + 10)}`,
    status: "ACTIVE",
  });
  if (r.status !== 201) throw new Error(`não criou ${nome}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
};

/* ========================================================================== */

console.log("=== Três sócios seguidos ===");
const um = await criar("ZN Um");
const dois = await criar("ZN Dois");
const tres = await criar("ZN Tres");
check(
  "os números saem seguidos",
  dois.number === um.number + 1 && tres.number === um.number + 2,
  `${um.number}, ${dois.number}, ${tres.number}`,
);
check("e a marca de água acompanha", (await marcaDeAgua()) === tres.number, `${await marcaDeAgua()}`);

console.log("\n=== Apagar o do meio: o buraco fica aberto ===");
const apagouMeio = await call(director, "DELETE", `/api/members/${dois.id}`);
check("apaga um sócio com número", apagouMeio.status === 200 && apagouMeio.body?.ok === true, `${apagouMeio.status} ${JSON.stringify(apagouMeio.body)}`);
check("e diz qual o número que ficou aberto", apagouMeio.body?.freedNumber === dois.number, `${apagouMeio.body?.freedNumber}`);
check("a ficha desapareceu (404)", (await call(director, "GET", `/api/members/${dois.id}`)).status === 404);

const quatro = await criar("ZN Quatro");
check(
  `a adesão seguinte é ${tres.number + 1}, e não o ${dois.number} que vagou`,
  quatro.number === tres.number + 1,
  `${quatro.number}`,
);

console.log("\n=== Apagar o do topo: também fica aberto ===");
/*
 * Este era o caso avariado. Com `MAX(number) + 1`, apagar o número mais alto
 * fazia-o voltar à fila — e a ficha de teste que se acabou de criar é sempre a
 * mais alta.
 */
const apagouTopo = await call(director, "DELETE", `/api/members/${quatro.id}`);
check("apaga", apagouTopo.status === 200, `${apagouTopo.status}`);
check("a marca de água não desce", (await marcaDeAgua()) === quatro.number, `${await marcaDeAgua()}`);

const cinco = await criar("ZN Cinco");
check(
  `a adesão seguinte é ${quatro.number + 1}, e não o ${quatro.number} que vagou`,
  cinco.number === quatro.number + 1,
  `${cinco.number}`,
);

console.log("\n=== Um buraco enche-se à mão ===");
const aMao = await call(director, "POST", "/api/members", {
  name: "ZN A Mao",
  phone: "912000199",
  status: "ACTIVE",
  number: dois.number,
});
check(`o ${dois.number} aceita-se escrito à mão`, aMao.status === 201 && aMao.body?.number === dois.number, `${aMao.status} ${JSON.stringify(aMao.body)}`);
check("e a marca de água não desce por causa disso", (await marcaDeAgua()) === cinco.number, `${await marcaDeAgua()}`);

const repetido = await call(director, "POST", "/api/members", {
  name: "ZN Repetido",
  phone: "912000198",
  status: "ACTIVE",
  number: dois.number,
});
check("um número ocupado continua a ser recusado", repetido.status === 400, `${repetido.status}`);

console.log("\n=== Um número à mão acima da marca levanta-a ===");
const alto = cinco.number + 500;
const saltou = await call(director, "POST", "/api/members", {
  name: "ZN Alto",
  phone: "912000197",
  status: "ACTIVE",
  number: alto,
});
check(`aceita o ${alto}`, saltou.status === 201, `${saltou.status}`);
check("a marca de água sobe até lá", (await marcaDeAgua()) === alto, `${await marcaDeAgua()}`);
const depoisDoAlto = await criar("ZN Depois");
check(
  `e a adesão seguinte é ${alto + 1} — não volta atrás para o meio do livro`,
  depoisDoAlto.number === alto + 1,
  `${depoisDoAlto.number}`,
);

console.log("\n=== Apagar quem tem conta na app e quotas pagas ===");
/*
 * A conta: liga-se pela base a um utilizador deste clube que ainda não seja
 * sócio (`@@unique([academyId, userId])`). O que interessa provar é que a API
 * já não recusa por causa dela — e que a conta **sobrevive** à ficha.
 */
const candidato = (
  await db.query(
    `SELECT u.id, u.email FROM "User" u
      JOIN "Membership" ms ON ms."userId" = u.id AND ms."academyId" = $1
     WHERE NOT EXISTS (SELECT 1 FROM "Member" m WHERE m."academyId" = $1 AND m."userId" = u.id)
     LIMIT 1`,
    [AC],
  )
).rows[0];
check("(preparação) há um utilizador do clube sem ficha de sócio", Boolean(candidato), "nenhum");

const comConta = await criar("ZN Com Conta");
await db.query(`UPDATE "Member" SET "userId" = $2 WHERE id = $1`, [comConta.id, candidato.id]);

/* Duas quotas, uma delas paga — e a paga deixa um `Payment` manual atrás. */
const lancou = await call(director, "POST", `/api/members/${comConta.id}/fees`, {
  periods: [mesRelativo(-1), mesRelativo(0)],
  amountCents: 1000,
});
check("(preparação) duas quotas lançadas", lancou.body?.created === 2, JSON.stringify(lancou.body));
const quotas = await call(director, "GET", `/api/members/${comConta.id}/fees`);
await call(director, "PATCH", `/api/members/fees/${quotas.body[0].id}/status`, { status: "SETTLED" });

const idsDasQuotas = quotas.body.map((f) => f.id);
const apagouComConta = await call(director, "DELETE", `/api/members/${comConta.id}`);
check("apaga um sócio com conta na app, número e quota paga", apagouComConta.status === 200, `${apagouComConta.status} ${JSON.stringify(apagouComConta.body).slice(0, 160)}`);

const quotasVivas = (
  await db.query(`SELECT count(*)::int AS n FROM "MemberFee" WHERE id = ANY($1)`, [idsDasQuotas])
).rows[0].n;
check("as quotas saíram com ela", quotasVivas === 0, `${quotasVivas}`);
const pagamentosVivos = (
  await db.query(`SELECT count(*)::int AS n FROM "Payment" WHERE "memberFeeId" = ANY($1)`, [idsDasQuotas])
).rows[0].n;
check("e os pagamentos delas também", pagamentosVivos === 0, `${pagamentosVivos}`);

const contaViva = (await db.query(`SELECT count(*)::int AS n FROM "User" WHERE id = $1`, [candidato.id])).rows[0].n;
check("a conta da app NÃO é apagada — é a pessoa, não a ficha", contaViva === 1, `${contaViva}`);

console.log("\n=== Fecho ===");
await limpar();
check("a marca de água do clube volta ao que era", (await marcaDeAgua()) === marcaInicial, `${await marcaDeAgua()} != ${marcaInicial}`);
await db.end();

console.log(`\n${ok} OK · ${bad} falhas`);
process.exit(bad === 0 ? 0 : 1);

/** `AAAA-MM` com um recuo de meses — o formato que as quotas usam. */
function mesRelativo(recuo) {
  const agora = new Date();
  const d = new Date(agora.getFullYear(), agora.getMonth() + recuo, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

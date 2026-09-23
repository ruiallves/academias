#!/usr/bin/env node
/**
 * Apagar um cargo com gente lá dentro.
 *
 * ## O que estava fechado
 *
 * Apagar um cargo exigia que ele estivesse vazio: *"Ainda há 3 pessoas com este
 * papel"*. Para desfazer um cargo era preciso reatribuir as pessoas uma a uma
 * primeiro — e um clube a reorganizar-se faz o contrário: desfaz a estrutura
 * velha e arruma as pessoas depois. O botão nem aparecia, e não havia
 * confirmação nenhuma no que aparecia.
 *
 * ## O que se prova
 *
 *  1. Apaga-se um cargo com pessoas, e a resposta diz **quantas ficaram sem
 *     cargo** — o número que o aviso mostra antes e repete depois.
 *  2. Quem fica sem cargo **não fica sem acesso**: cai nos valores por omissão
 *     do papel-base. É a parte contra-intuitiva, e a que decide se isto é
 *     seguro.
 *  3. A cópia do nome do cargo em `Membership.title` sai com ele — senão a
 *     lista de staff continuava a dizer "ZZ Cargo" e apagar não mudava nada no
 *     ecrã onde se ia confirmar.
 *  4. O cargo não ressuscita: `semearCargosEmFalta` corre a cada leitura.
 *  5. O do presidente não se apaga, nem o que a própria pessoa veste.
 *
 * Uso: API_URL=http://127.0.0.1:3012 node scripts/test-apagar-cargos.mjs
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
const API = process.env.API_URL ?? process.env.API ?? "http://localhost:3000";
const ACADEMIA = "acd_lifeclub";

let ok = 0, bad = 0;
const check = (l, c, d = "") => {
  if (c) { ok++; console.log("  OK    " + l); }
  else { bad++; console.log("  FALHA " + l + (d ? " — " + d : "")); }
};

const login = async (email) =>
  (await (await fetch(`${S}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: A, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "academia2026" }),
  })).json()).access_token;

const call = async (token, method, pathname, body) => {
  const r = await fetch(API + pathname, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "x-academy-slug": "life-club",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};

const db = new pg.Client({ connectionString: env("MIGRATE_DATABASE_URL"), ssl: { rejectUnauthorized: false } });
await db.connect();

const presidente = await login("presidente@lifeclub.pt");
const treinador = await login("treinador@lifeclub.pt");

/* O vínculo do treinador, e o que ele tinha antes — para repor no fim. */
const dele = (await db.query(
  `SELECT m.id, m."customRoleId", m.title, m.role FROM "Membership" m JOIN "User" u ON u.id = m."userId"
   WHERE m."academyId" = $1 AND u.email = 'treinador@lifeclub.pt'`,
  [ACADEMIA],
)).rows[0];

const limpar = async () => {
  await db.query(`DELETE FROM "MembershipRole" WHERE "roleId" IN (SELECT id FROM "AcademyRole" WHERE name LIKE 'ZZ %')`);
  await db.query(`UPDATE "Membership" SET "customRoleId" = NULL WHERE "customRoleId" IN (SELECT id FROM "AcademyRole" WHERE name LIKE 'ZZ %')`);
  await db.query(`DELETE FROM "AcademyRole" WHERE name LIKE 'ZZ %'`);
  await db.query(`DELETE FROM "Department" WHERE name LIKE 'ZZ %'`);
};

const repor = async () => {
  await db.query(`UPDATE "Membership" SET "customRoleId" = $1, title = $2 WHERE id = $3`, [
    dele?.customRoleId ?? null, dele?.title ?? null, dele?.id,
  ]);
};

try {
  check("(preparação) o treinador tem vínculo", Boolean(dele), JSON.stringify(dele ?? null));
  if (!dele) throw new Error("sem fixtures");
  await limpar();

  console.log("=== Um cargo com uma pessoa lá dentro ===");
  const dep = await call(presidente, "POST", "/api/departments", {
    name: "ZZ Departamento", baseRole: "COACH", permissions: ["academy:read", "team:read", "attendance:write"],
  });
  check("nasce o departamento", dep.status < 300, `${dep.status} ${JSON.stringify(dep.body).slice(0, 120)}`);

  const cargo = await call(presidente, "POST", "/api/roles", {
    name: "ZZ Cargo", departmentId: dep.body.id, permissions: ["academy:read", "team:read", "attendance:write"],
  });
  check("nasce o cargo", cargo.status < 300, `${cargo.status} ${JSON.stringify(cargo.body).slice(0, 120)}`);

  const atribuir = await call(presidente, "PATCH", `/api/roles/assign/${dele.id}`, { roleId: cargo.body.id });
  check("e o treinador veste-o", atribuir.status < 300, `${atribuir.status}`);
  // O convite copia o nome do cargo para `title`; aqui simula-se o mesmo.
  await db.query(`UPDATE "Membership" SET title = 'ZZ Cargo' WHERE id = $1`, [dele.id]);

  const lista = await call(presidente, "GET", "/api/roles");
  check("a lista diz que tem uma pessoa", (lista.body ?? []).find((r) => r.id === cargo.body.id)?.people === 1, "");

  console.log("\n=== Apagar, com a pessoa lá dentro ===");
  const apagado = await call(presidente, "DELETE", `/api/roles/${cargo.body.id}`);
  check("passa (2xx), e já não diz 'ainda há pessoas'", apagado.status < 300, `${apagado.status} ${JSON.stringify(apagado.body).slice(0, 140)}`);
  check("e diz quantas ficaram sem cargo", apagado.body?.people === 1, `${apagado.body?.people}`);

  const depois = (await db.query(`SELECT "customRoleId", title, role FROM "Membership" WHERE id = $1`, [dele.id])).rows[0];
  check("a pessoa fica sem cargo", depois.customRoleId === null, JSON.stringify(depois));
  check("e sem a cópia do nome no título", depois.title === null, `${depois.title}`);
  check("o papel-base fica onde estava", depois.role === "COACH", depois.role);

  console.log("\n=== Sem cargo não é sem acesso ===");
  /*
   * A parte contra-intuitiva. Sem cargo principal, `exceptionsFor` devolve
   * `rolePermissions: null` e a pessoa vive dos valores por omissão do
   * papel-base. Se isto falhar, apagar um cargo tranca gente fora do produto.
   */
  const comoEle = await call(treinador, "GET", "/api/athletes");
  check("o treinador continua a entrar", comoEle.status === 200, `${comoEle.status}`);
  const folha = await call(treinador, "GET", "/api/sessions");
  check("e continua a ver os treinos dele", folha.status === 200, `${folha.status}`);

  console.log("\n=== E não volta a nascer ===");
  await call(presidente, "GET", "/api/departments");
  const relido = await call(presidente, "GET", "/api/roles");
  check(
    "o cargo apagado não reaparece",
    !(relido.body ?? []).some((r) => r.id === cargo.body.id),
    `${(relido.body ?? []).length} cargos`,
  );

  console.log("\n=== O que continua fechado ===");
  const oPresidente = (relido.body ?? []).find((r) => r.key === "presidente");
  const tentativa = await call(presidente, "DELETE", `/api/roles/${oPresidente?.id}`);
  check("o cargo do presidente não se apaga (403)", tentativa.status === 403, `${tentativa.status} ${JSON.stringify(tentativa.body).slice(0, 120)}`);
  check("e a mensagem fala de apagar, não de editar", /não se apaga/i.test(tentativa.body?.message ?? ""), tentativa.body?.message);

  /* O cargo que a própria pessoa veste: a regra de sempre, agora também a apagar. */
  const meu = (await db.query(
    `SELECT m."customRoleId" AS id FROM "Membership" m JOIN "User" u ON u.id = m."userId"
     WHERE m."academyId" = $1 AND u.email = 'presidente@lifeclub.pt'`,
    [ACADEMIA],
  )).rows[0];
  if (meu?.id && meu.id !== oPresidente?.id) {
    const oMeu = await call(presidente, "DELETE", `/api/roles/${meu.id}`);
    check("ninguém apaga o cargo que veste (403)", oMeu.status === 403, `${oMeu.status}`);
  } else {
    console.log("  (o presidente veste o cargo de presidente — já coberto acima)");
  }

  console.log("\n=== Apagar o departamento leva os cargos ===");
  const dep2 = await call(presidente, "POST", "/api/departments", {
    name: "ZZ Departamento 2", baseRole: "STAFF", permissions: ["academy:read"],
  });
  const cargo2 = await call(presidente, "POST", "/api/roles", {
    name: "ZZ Cargo 2", departmentId: dep2.body.id, permissions: ["academy:read"],
  });
  await call(presidente, "PATCH", `/api/roles/assign/${dele.id}`, { roleId: cargo2.body.id });

  const depApagado = await call(presidente, "DELETE", `/api/departments/${dep2.body.id}`);
  check("apaga o departamento", depApagado.status < 300, `${depApagado.status}`);
  check("leva os cargos dele", depApagado.body?.roles >= 1, `${depApagado.body?.roles}`);
  check("e diz quantas pessoas ficaram sem cargo", depApagado.body?.people === 1, `${depApagado.body?.people}`);
  const semCargo = (await db.query(`SELECT "customRoleId" FROM "Membership" WHERE id = $1`, [dele.id])).rows[0];
  check("a pessoa ficou mesmo sem cargo", semCargo.customRoleId === null, JSON.stringify(semCargo));
} finally {
  console.log("\n=== Limpeza ===");
  await limpar();
  await repor();
  await db.end();
  console.log("  feito");
}

console.log(`\n${ok} passaram, ${bad} falharam`);
process.exit(bad === 0 ? 0 : 1);

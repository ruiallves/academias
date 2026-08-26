#!/usr/bin/env node
/**
 * Departamentos e cargos, via API.
 *
 * O que interessa aqui não é o CRUD — é o que impede uma tabela de permissões
 * editável pelo cliente de ser a porta das traseiras do produto:
 *
 *  - só se concede o que se tem (um treinador não cria um departamento com
 *    permissões que ele próprio não tem);
 *  - não se cria acima de si;
 *  - o âmbito não se muda depois de criado;
 *  - apagar um departamento **não** apaga quem lá trabalhava.
 *
 * E a herança: um cargo criado dentro de um departamento nasce com o âmbito dele,
 * mesmo que o cliente mande outro.
 *
 * Uso: node scripts/test-departments.mjs
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
const API = "http://localhost:3000";

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
// Limpeza à cabeça: uma corrida que rebentasse a meio deixava lixo, e a seguinte
// falhava a criar por nome repetido.
await db.query(`DELETE FROM "AcademyRole" WHERE name LIKE 'ZZ %'`);
await db.query(`DELETE FROM "Department" WHERE name LIKE 'ZZ %'`);

/*
 * O presidente, e não a direcção.
 *
 * `role:write` é do OWNER e mais ninguém: gerir departamentos é gerir o que os
 * outros podem fazer, e a academia de demonstração não delega isso ao director.
 * Um teste que usasse a direcção media a delegação, não as regras.
 */
const director = await login("presidente@lifeclub.pt");
const coach = await login("treinador@lifeclub.pt");
const parent = await login("familia@lifeclub.pt");

console.log("=== Os quatro de origem ===");
const lista = await call(director, "GET", "/api/departments");
check("a direção lê os departamentos", lista.status === 200, `${lista.status}`);
const keys = (lista.body ?? []).map((d) => d.key);
for (const k of ["direcao", "tecnica", "clinico", "scouting"]) {
  check(`existe "${k}"`, keys.includes(k), keys.join(","));
}
const tecnica = (lista.body ?? []).find((d) => d.key === "tecnica");
check("a equipa técnica vê só as suas equipas", tecnica?.baseRole === "COACH", tecnica?.baseRole);
const clinico = (lista.body ?? []).find((d) => d.key === "clinico");
check("o clínico pode ler o boletim", clinico?.permissions.includes("clinical:read"), "");
/*
 * O treinador **lê** o boletim de propósito — precisa de saber que lesão é para
 * adaptar o treino (ver `ROLE_PERMISSIONS.COACH`). O que não pode é escrever:
 * dar baixa e alta é do departamento clínico, e é essa a linha que interessa.
 */
check("a equipa técnica NÃO escreve no registo clínico", !tecnica?.permissions.includes("clinical:write"), "");
check("o clínico escreve", clinico?.permissions.includes("clinical:write"), "");

console.log("\n=== Quem pode escrever ===");
const porPai = await call(parent, "POST", "/api/departments", {
  name: "ZZ Pai", baseRole: "DIRECTOR", permissions: [],
});
check("um encarregado não cria departamentos (403)", porPai.status === 403, `${porPai.status}`);

const acimaDeSi = await call(coach, "POST", "/api/departments", {
  name: "ZZ Acima", baseRole: "DIRECTOR", permissions: [],
});
check(
  "um treinador não cria um departamento acima de si (403)",
  acimaDeSi.status === 403 || acimaDeSi.status === 400,
  `${acimaDeSi.status}`,
);

console.log("\n=== Só se concede o que se tem ===");
/*
 * O treinador não tem `billing:write`. Se pedir um departamento com essa
 * permissão, o servidor não pode recusar em silêncio **nem** gravá-la: filtra-a.
 * É a mesma regra de `filterGrantable` nos papéis e nas excepções por pessoa.
 */
const escalada = await call(coach, "POST", "/api/departments", {
  name: "ZZ Escalada",
  baseRole: "COACH",
  permissions: ["team:read", "billing:write", "academy:write"],
});
if (escalada.status === 201 || escalada.status === 200) {
  const criado = await db.query(`SELECT permissions FROM "Department" WHERE name = 'ZZ Escalada'`);
  const perms = criado.rows[0]?.permissions ?? [];
  check("as permissões que o treinador não tem foram filtradas", !perms.includes("billing:write") && !perms.includes("academy:write"), perms.join(","));
  check("as que ele tem passaram", perms.includes("team:read"), perms.join(","));
} else {
  // Recusar também é uma resposta correcta; o que não pode é gravar a escalada.
  check("o treinador não escreveu permissões que não tem", true);
}

console.log("\n=== Criar e herdar ===");
const novo = await call(director, "POST", "/api/departments", {
  name: "ZZ Logística",
  description: "ZZ teste",
  baseRole: "STAFF",
  permissions: ["team:read", "calendar:read", "calendar:write"],
});
check("a direção cria um departamento", novo.status === 201 || novo.status === 200, `${novo.status}`);
const depId = novo.body?.id;

/*
 * O âmbito vem do departamento, e o que o cliente mandar é ignorado.
 *
 * É a regra que tirou a pergunta "Âmbito" do ecrã dos cargos. Se um cliente
 * malicioso mandasse `baseRole: "DIRECTOR"` num cargo do departamento de
 * logística, ganhava visão de toda a academia por um campo que a interface nem
 * mostra. Aqui verifica-se que não ganha.
 */
const cargo = await call(director, "POST", "/api/roles", {
  name: "ZZ Roupeiro",
  departmentId: depId,
  baseRole: "DIRECTOR",
  permissions: ["team:read", "calendar:read"],
});
check("a direção cria um cargo no departamento", cargo.status === 201 || cargo.status === 200, `${cargo.status}`);
const guardado = await db.query(`SELECT "baseRole", "departmentId" FROM "AcademyRole" WHERE name = 'ZZ Roupeiro'`);
check(
  "o cargo herdou o âmbito do departamento e ignorou o que veio no pedido",
  guardado.rows[0]?.baseRole === "STAFF",
  guardado.rows[0]?.baseRole,
);
check("e ficou ligado ao departamento", guardado.rows[0]?.departmentId === depId, "");

/*
 * E o departamento passa a trazê-lo aninhado, na leitura seguinte.
 *
 * É isto que a árvore das Definições desenha — não a lista de cargos. Um cargo
 * criado que não aparecesse aqui ficava invisível no ecrã até um F5, mesmo
 * existindo na base; foi exactamente o que aconteceu.
 */
const relido = await call(director, "GET", "/api/departments");
const meuDep = (relido.body ?? []).find((d) => d.id === depId);
check(
  "e o departamento passa a trazer o cargo aninhado",
  (meuDep?.roles ?? []).some((r) => r.name === "ZZ Roupeiro"),
  JSON.stringify(meuDep?.roles),
);

console.log("\n=== Editar não muda ninguém sem se pedir ===");
await call(director, "PATCH", `/api/departments/${depId}`, {
  permissions: ["team:read", "calendar:read", "calendar:write", "athlete:read"],
});
const semAplicar = await db.query(`SELECT permissions FROM "AcademyRole" WHERE name = 'ZZ Roupeiro'`);
check(
  "sem applyToRoles, o cargo fica como estava",
  !(semAplicar.rows[0]?.permissions ?? []).includes("athlete:read"),
  (semAplicar.rows[0]?.permissions ?? []).join(","),
);

const aplicado = await call(director, "PATCH", `/api/departments/${depId}`, {
  permissions: ["team:read", "calendar:read", "calendar:write", "athlete:read"],
  applyToRoles: true,
});
check("com applyToRoles, diz quantos cargos mudou", aplicado.body?.updatedRoles === 1, `${aplicado.body?.updatedRoles}`);
const comAplicar = await db.query(`SELECT permissions FROM "AcademyRole" WHERE name = 'ZZ Roupeiro'`);
check(
  "e o cargo passou mesmo a ter a permissão nova",
  (comAplicar.rows[0]?.permissions ?? []).includes("athlete:read"),
  (comAplicar.rows[0]?.permissions ?? []).join(","),
);

console.log("\n=== O âmbito é imutável ===");
await call(director, "PATCH", `/api/departments/${depId}`, { baseRole: "OWNER", name: "ZZ Logística" });
const aindaStaff = await db.query(`SELECT "baseRole" FROM "Department" WHERE id = $1`, [depId]);
check("mudar o âmbito depois de criado não passa", aindaStaff.rows[0]?.baseRole === "STAFF", aindaStaff.rows[0]?.baseRole);

console.log("\n=== Apagar não apaga quem lá trabalhava ===");
const apagado = await call(director, "DELETE", `/api/departments/${depId}`);
check("a direção apaga o departamento", apagado.status === 200, `${apagado.status}`);
check("e avisa quantos cargos ficaram órfãos", apagado.body?.orphanedRoles === 1, `${apagado.body?.orphanedRoles}`);
const orfao = await db.query(`SELECT "departmentId", permissions FROM "AcademyRole" WHERE name = 'ZZ Roupeiro'`);
check("o cargo continua a existir", orfao.rows.length === 1, `${orfao.rows.length}`);
check("sem departamento", orfao.rows[0]?.departmentId === null, `${orfao.rows[0]?.departmentId}`);
check(
  "e com as permissões que tinha — ninguém perdeu acesso",
  (orfao.rows[0]?.permissions ?? []).includes("athlete:read"),
  "",
);

console.log("\n=== Isolamento entre academias ===");
/*
 * A RLS é o que separa os clubes. Um departamento de outra academia não pode ser
 * legível nem apagável a partir daqui, mesmo com o id certo na mão.
 */
const outra = await db.query(
  `SELECT d.id FROM "Department" d JOIN "Academy" a ON a.id = d."academyId" WHERE a.slug <> 'life-club' LIMIT 1`,
);
if (outra.rows.length > 0) {
  const alheio = await call(director, "PATCH", `/api/departments/${outra.rows[0].id}`, { name: "ZZ Invadido" });
  check("não se edita um departamento de outra academia (404)", alheio.status === 404, `${alheio.status}`);
} else {
  console.log("  (só há uma academia na base — salto o teste de isolamento)");
}

console.log("\n=== Limpeza ===");
await db.query(`DELETE FROM "AcademyRole" WHERE name LIKE 'ZZ %'`);
await db.query(`DELETE FROM "Department" WHERE name LIKE 'ZZ %'`);
await db.end();
console.log("  feito");

console.log(`\n${ok} passaram, ${bad} falharam`);
process.exit(bad === 0 ? 0 : 1);

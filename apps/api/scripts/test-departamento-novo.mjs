#!/usr/bin/env node
/**
 * Um departamento novo tem de servir para convidar alguém.
 *
 * ## O que estava partido
 *
 * "Criei um departamento e depois, ao convidar staff, ele não está na lista."
 * Estava certo: ninguém pertence a um departamento — pertence a um **cargo**, e
 * é o cargo que carrega as permissões. Um departamento nascia sem cargos, e sem
 * cargos não há nada para convidar, por isso desaparecia do menu.
 *
 * E não era só o departamento acabado de criar. `SEED_DEPARTMENTS` semeava as
 * quatro áreas de origem e `SYSTEM_ROLES` semeava só o presidente: **14 dos 17
 * clubes** tinham departamentos sem um único cargo, os de origem incluídos. Num
 * clube acabado de abrir, convidar staff só oferecia "Sem departamento".
 *
 * Este teste fixa as duas metades da regra: um departamento que nasce traz o
 * primeiro cargo, e um departamento que já existe sem cargos ganha um à leitura
 * seguinte — sem desfazer o que o clube arrumou de propósito.
 *
 * Uso: node scripts/test-departamento-novo.mjs
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
const limpar = async () => {
  await db.query(`DELETE FROM "AcademyRole" WHERE "academyId" = $1 AND name LIKE 'ZZ %'`, [academyId]);
  await db.query(`DELETE FROM "Department" WHERE "academyId" = $1 AND name LIKE 'ZZ %'`, [academyId]);
};
await limpar();

const presidente = await login("presidente@lifeclub.pt");
const treinador = await login("treinador@lifeclub.pt");

/*
 * A lista de grupos que o diálogo de convite desenha, montada aqui com as mesmas
 * duas leituras que ele faz. É isto que o utilizador vê no menu "Departamento".
 */
const menuDeConvite = async (token) => {
  const [deps, roles] = await Promise.all([
    call(token, "GET", "/api/departments"),
    call(token, "GET", "/api/roles"),
  ]);
  return { deps: deps.body ?? [], roles: roles.body ?? [] };
};

try {
  console.log("=== Um departamento novo ===");
  const criado = await call(presidente, "POST", "/api/departments", {
    name: "ZZ Marketing",
    baseRole: "COORDINATOR",
    permissions: ["comms:read", "calendar:read"],
    navKeys: [],
  });
  check("o presidente cria o departamento", criado.status === 201 || criado.status === 200, `${criado.status} ${JSON.stringify(criado.body)}`);
  check("e recebe o cargo que nasceu com ele", Boolean(criado.body?.roleId), JSON.stringify(criado.body));

  const { deps, roles } = await menuDeConvite(presidente);
  const dep = deps.find((d) => d.id === criado.body.id);
  check("aparece nas definições", Boolean(dep));
  check("já com um cargo lá dentro", dep?.roles?.length === 1, JSON.stringify(dep?.roles));
  check("com o nome do departamento", dep?.roles?.[0]?.name === "ZZ Marketing", `${dep?.roles?.[0]?.name}`);

  /*
   * A prova que interessa: o departamento está mesmo convidável.
   *
   * Não basta existir na lista de departamentos — o menu do convite só o mostra
   * se houver um cargo dentro dele que quem convida possa dar.
   */
  const cargo = roles.find((r) => r.departmentId === criado.body.id);
  check("e há um cargo por onde convidar para lá", Boolean(cargo), "nenhum cargo aponta para o departamento novo");
  check("o cargo herdou o âmbito do departamento", cargo?.baseRole === "COORDINATOR", `${cargo?.baseRole}`);
  check("e copiou-lhe as permissões", ["comms:read", "calendar:read"].every((p) => (cargo?.permissions ?? []).includes(p)), JSON.stringify(cargo?.permissions));
  check("mas não nasce trancado", cargo?.isSystem === false, `${cargo?.isSystem}`);
  check("nem com ninguém lá dentro", cargo?.people === 0, `${cargo?.people}`);

  console.log("\n=== O convite chega mesmo a ser emitido ===");
  const convite = await call(presidente, "POST", "/api/invites", {
    name: "ZZ Pessoa Marketing",
    email: `zz-marketing-${Date.now()}@exemplo.pt`,
    academyRoleId: cargo.id,
    teamIds: [],
  });
  check("convidar para o departamento novo funciona", convite.status === 201 || convite.status === 200, `${convite.status} ${JSON.stringify(convite.body).slice(0, 140)}`);
  if (convite.body?.id) await db.query(`DELETE FROM "StaffInvite" WHERE id = $1`, [convite.body.id]);

  console.log("\n=== Departamentos que já existiam sem cargos ===");
  /*
   * Reproduz o estado real dos clubes: o departamento existe, os cargos não.
   * A leitura seguinte tem de o reparar — é o que faz isto valer para quem já
   * tem o clube montado, e não só para os departamentos criados a partir de hoje.
   */
  await db.query(`DELETE FROM "AcademyRole" WHERE "departmentId" = $1`, [criado.body.id]);
  const vazio = (await db.query(
    `SELECT count(*) FROM "AcademyRole" WHERE "departmentId" = $1`, [criado.body.id],
  )).rows[0].count;
  check("(preparação) o departamento ficou sem cargos", vazio === "0", vazio);

  const reparado = (await menuDeConvite(presidente)).deps.find((d) => d.id === criado.body.id);
  check("a leitura seguinte dá-lhe um cargo", reparado?.roles?.length === 1, JSON.stringify(reparado?.roles));

  /* E não cria um segundo na leitura a seguir — semear não é multiplicar. */
  const outra = (await menuDeConvite(presidente)).deps.find((d) => d.id === criado.body.id);
  check("e a leitura a seguir não cria outro", outra?.roles?.length === 1, JSON.stringify(outra?.roles));

  console.log("\n=== Um cargo arquivado não ressuscita ===");
  /*
   * A diferença entre "nunca teve cargos" e "não tem nenhum activo".
   *
   * Arquivar um cargo é o clube a dizer "este já não se usa". Se a reparação
   * olhasse para os activos, o cargo voltava na leitura seguinte e o produto
   * passava a discutir com quem o arrumou.
   */
  await db.query(
    `UPDATE "AcademyRole" SET "archivedAt" = now() WHERE "departmentId" = $1`, [criado.body.id],
  );
  const comArquivado = (await menuDeConvite(presidente)).deps.find((d) => d.id === criado.body.id);
  check("o departamento fica sem cargos activos", comArquivado?.roles?.length === 0, JSON.stringify(comArquivado?.roles));
  const aindaArquivado = Number((await db.query(
    `SELECT count(*) FROM "AcademyRole" WHERE "departmentId" = $1`, [criado.body.id],
  )).rows[0].count);
  check("e não lhe nasce um cargo por cima do arquivado", aindaArquivado === 1, `${aindaArquivado}`);

  console.log("\n=== Os departamentos de origem ===");
  const todos = (await menuDeConvite(presidente)).deps;
  const origem = todos.filter((d) => d.isSystem);
  check("os quatro de origem existem", origem.length === 4, `${origem.length}`);
  const semCargos = origem.filter((d) => d.roles.length === 0).map((d) => d.name);
  check("e nenhum deles ficou sem cargos", semCargos.length === 0, semCargos.join(", "));

  console.log("\n=== Quem convida ===");
  const doTreinador = await call(treinador, "POST", "/api/departments", {
    name: "ZZ Do Treinador", baseRole: "COORDINATOR", permissions: [], navKeys: [],
  });
  check("um treinador não cria departamentos (403)", doTreinador.status === 403, `${doTreinador.status}`);
} finally {
  console.log("\n=== Limpeza ===");
  await limpar();
  const sobrou = Number((await db.query(
    `SELECT count(*) FROM "Department" WHERE "academyId" = $1 AND name LIKE 'ZZ %'`, [academyId],
  )).rows[0].count);
  check("não ficou lixo no clube", sobrou === 0, `${sobrou}`);
  await db.end();
}

console.log(`\n${ok} passaram, ${bad} falharam`);
process.exit(bad === 0 ? 0 : 1);

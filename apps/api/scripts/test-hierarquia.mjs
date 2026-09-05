#!/usr/bin/env node
/**
 * A hierarquia: ninguém mexe em quem está acima.
 *
 * ## O que este teste existe para provar
 *
 * Que um cargo inferior não consegue tomar uma conta superior — por nenhuma das
 * portas. Apagar é a óbvia; as outras três são as que davam o clube sem fazer
 * barulho:
 *
 * 1. **Apagar** o presidente (`DELETE /api/memberships/:id`).
 * 2. **Desactivar** o presidente (`PATCH /api/memberships/:id/active`).
 * 3. **Despromover** o presidente — dar-lhe um cargo pequeno, ou tirar-lhe o
 *    cargo todo (`PATCH /api/roles/assign/:id`). Era a mais perigosa: uma vez
 *    despromovido, o presidente ficava apagável pelas regras normais, e a
 *    protecção do ponto 1 tornava-se decorativa.
 * 4. **Neutralizar** o presidente — retirar-lhe permissões pela ficha de acesso
 *    (`PATCH /api/staff/:id/access`). Uma conta sem poder nenhum é uma conta
 *    tomada, e esta era a mais silenciosa das quatro.
 *
 * E prova o reverso, para a regra não ser só um muro: a direcção continua a
 * poder fazer tudo isso a quem está **abaixo** dela.
 *
 * ## O caso que motivou metade disto
 *
 * Desde que a mesma pessoa pode ter vários cargos, o principal deixou de a
 * descrever. Na base real havia uma treinadora com o cargo secundário de
 * *Diretora* (patente 100): pelo principal valia 40, e qualquer treinador podia
 * apagá-la. A patente passou a ser a **mais alta** de todos os cargos que a
 * pessoa veste — e o ponto 5 abaixo prova-o.
 *
 * ## Como corre sem tocar em ninguém
 *
 * Num clube descartável, com contas descartáveis, criado e apagado pelo próprio
 * teste. As sessões são emprestadas: cada personagem é uma `Membership` nova no
 * clube de teste, ligada ao `authId` de uma conta de teste que já existe — é o
 * `x-academy-slug` que decide de que clube é o pedido, e por isso a mesma pessoa
 * pode ser presidente aqui e o que já era no clube dela.
 *
 * Uso: node scripts/test-hierarquia.mjs
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
const SLUG = "zh-teste-hierarquia";

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

const login = async (email, password) =>
  (
    await (
      await fetch(`${S}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: { apikey: A, "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      })
    ).json()
  ).access_token;

const call = async (token, method, pathname, body) => {
  const r = await fetch(API + pathname, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "x-academy-slug": SLUG,
      "x-app": "console",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};

const db = new pg.Client({ connectionString: env("MIGRATE_DATABASE_URL"), ssl: { rejectUnauthorized: false } });
await db.connect();

const ID = "zh_academia";

const limpar = async () => {
  await db.query(`DELETE FROM "MembershipRole" WHERE "membershipId" LIKE 'zh_%'`);
  await db.query(`DELETE FROM "Membership" WHERE "academyId" = $1`, [ID]);
  await db.query(`DELETE FROM "AcademyRole" WHERE "academyId" = $1`, [ID]);
  await db.query(`DELETE FROM "Academy" WHERE id = $1`, [ID]);
};
await limpar();

/* ===================================================== o clube de teste ===== */

await db.query(
  `INSERT INTO "Academy" (id, slug, name, "shortName", status, "updatedAt")
   VALUES ($1, $2, 'ZH Teste Hierarquia', 'ZH', 'SETUP', now())`,
  [ID, SLUG],
);

/** Os cargos, com as patentes de sempre. */
const cargo = async (key, name, baseRole, rank) => {
  await db.query(
    `INSERT INTO "AcademyRole" (id, "academyId", key, name, "baseRole", permissions, "navKeys", "isSystem", rank, "updatedAt")
     VALUES ($1, $2, $3, $4, $5, $6, ARRAY[]::text[], false, $7, now())`,
    [
      `zh_${key}`,
      ID,
      key,
      name,
      baseRole,
      // O suficiente para tentar todas as portas: gerir staff e gerir acessos.
      ["academy:read", "staff:read", "staff:write", "access:write", "role:write"],
      rank,
    ],
  );
  return `zh_${key}`;
};

await cargo("presidente", "Presidente", "OWNER", 100);
await cargo("director", "Director", "DIRECTOR", 80);
await cargo("treinador", "Treinador", "COACH", 40);

/**
 * Uma pessoa no clube de teste, com a sessão emprestada de uma conta que já
 * existe. O `authId` é o que a liga; o `x-academy-slug` é o que faz o pedido
 * ser deste clube e não do dela.
 */
const pessoa = async (id, email, roleKey, enumRole) => {
  const authId = (await db.query(`SELECT "authId" FROM "User" WHERE email = $1 LIMIT 1`, [email])).rows[0]?.authId;
  if (!authId) throw new Error(`sem authId para ${email}`);
  const userId = (await db.query(`SELECT id FROM "User" WHERE email = $1 LIMIT 1`, [email])).rows[0].id;
  await db.query(
    `INSERT INTO "Membership" (id, "academyId", "userId", role, "customRoleId", "isActive", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, true, now())`,
    [id, ID, userId, enumRole, roleKey ? `zh_${roleKey}` : null],
  );
  return id;
};

// A direcção do clube de demonstração empresta a sessão ao **director** daqui;
// o treinador empresta ao treinador. São as duas contas de teste que existem.
const MEMB_DIRECTOR = await pessoa("zh_m_director", "direcao@lifeclub.pt", "director", "DIRECTOR");
const MEMB_TREINADOR = await pessoa("zh_m_treinador", "treinador@lifeclub.pt", "treinador", "COACH");

// O presidente e a treinadora-que-também-é-directora não precisam de sessão:
// são **alvos**. Ligam-se a um utilizador qualquer que já exista.
const outroUser = (await db.query(`SELECT id FROM "User" WHERE email = 'familia@lifeclub.pt' LIMIT 1`)).rows[0].id;
await db.query(
  `INSERT INTO "Membership" (id, "academyId", "userId", role, "customRoleId", "isActive", "updatedAt")
   VALUES ('zh_m_presidente', $1, $2, 'OWNER', 'zh_presidente', true, now())`,
  [ID, outroUser],
);
/*
 * O caso da treinadora que também é directora: principal de patente 40,
 * secundário de patente 80. Pelo principal, um treinador podia apagá-la.
 */
await db.query(
  `INSERT INTO "Membership" (id, "academyId", "userId", role, "customRoleId", "isActive", "updatedAt")
   VALUES ('zh_m_dupla', $1, $2, 'COACH', 'zh_treinador', true, now())`,
  [ID, outroUser],
);
await db.query(`INSERT INTO "MembershipRole" ("membershipId", "roleId") VALUES ('zh_m_dupla', 'zh_director')`);

const director = await login("direcao@lifeclub.pt", "academia2026");
const treinador = await login("treinador@lifeclub.pt", "academia2026");

const existe = async (id) =>
  (await db.query(`SELECT count(*)::int AS n FROM "Membership" WHERE id = $1`, [id])).rows[0].n === 1;
const estado = async (id) =>
  (await db.query(`SELECT "isActive", role, "customRoleId" FROM "Membership" WHERE id = $1`, [id])).rows[0];

/* ============================================ a direcção contra o topo ===== */

console.log("=== A direcção não toca no presidente ===");

const apagar = await call(director, "DELETE", `/api/memberships/zh_m_presidente`);
check("não o apaga (403)", apagar.status === 403, `${apagar.status} ${JSON.stringify(apagar.body)}`);
check("e ele continua lá", await existe("zh_m_presidente"));

const desactivar = await call(director, "PATCH", `/api/memberships/zh_m_presidente/active`, { active: false });
check("não o desactiva (403)", desactivar.status === 403, `${desactivar.status}`);
check("e continua activo", (await estado("zh_m_presidente")).isActive === true);

const despromover = await call(director, "PATCH", `/api/roles/assign/zh_m_presidente`, { roleId: "zh_treinador" });
check("não lhe dá um cargo pequeno (403)", despromover.status === 403, `${despromover.status} ${JSON.stringify(despromover.body)}`);

const semCargo = await call(director, "PATCH", `/api/roles/assign/zh_m_presidente`, { roleId: null });
check("nem lhe tira o cargo (403)", semCargo.status === 403, `${semCargo.status}`);

const depois = await estado("zh_m_presidente");
check("o cargo dele está intacto", depois.customRoleId === "zh_presidente" && depois.role === "OWNER", JSON.stringify(depois));

const neutralizar = await call(director, "PATCH", `/api/staff/zh_m_presidente/access`, {
  grants: [],
  revokes: ["role:write", "staff:write"],
});
check("não lhe retira permissões (403)", neutralizar.status === 403, `${neutralizar.status}`);
const revokes = (await db.query(`SELECT revokes FROM "Membership" WHERE id = 'zh_m_presidente'`)).rows[0].revokes;
check("e as retiradas dele continuam vazias", revokes.length === 0, JSON.stringify(revokes));

/* ================================== o cargo secundário também protege ===== */

console.log("\n=== O cargo secundário conta para a protecção ===");
const contraDupla = await call(treinador, "DELETE", `/api/memberships/zh_m_dupla`);
check(
  "um treinador não apaga quem é também director (403)",
  contraDupla.status === 403,
  `${contraDupla.status} ${JSON.stringify(contraDupla.body)}`,
);
check("e ela continua lá", await existe("zh_m_dupla"));

const desactivarDupla = await call(treinador, "PATCH", `/api/memberships/zh_m_dupla/active`, { active: false });
check("nem a desactiva (403)", desactivarDupla.status === 403, `${desactivarDupla.status}`);

/* ============================================== e para baixo, funciona ===== */

console.log("\n=== Para baixo, a direcção manda ===");
const desactivarTreinador = await call(director, "PATCH", `/api/memberships/zh_m_treinador/active`, { active: false });
check("desactiva um treinador (200)", desactivarTreinador.status === 200, `${desactivarTreinador.status}`);
check("e ele fica inactivo", (await estado("zh_m_treinador")).isActive === false);

await call(director, "PATCH", `/api/memberships/zh_m_treinador/active`, { active: true });

const cargoAoTreinador = await call(director, "PATCH", `/api/roles/assign/zh_m_treinador`, { roleId: "zh_director" });
check("e dá-lhe um cargo até ao nível dela (200)", cargoAoTreinador.status === 200, `${cargoAoTreinador.status}`);

const apagarTreinador = await call(director, "DELETE", `/api/memberships/zh_m_treinador`);
check("e apaga-o (200)", apagarTreinador.status === 200, `${apagarTreinador.status} ${JSON.stringify(apagarTreinador.body)}`);
check("desapareceu mesmo", (await existe("zh_m_treinador")) === false);

/* =========================================================== limpeza ===== */

await limpar();
const restos = (await db.query(`SELECT count(*)::int AS n FROM "Academy" WHERE id = $1`, [ID])).rows[0].n;
check("\ntudo limpo no fim", restos === 0);

await db.end();
console.log(`\n${ok} OK, ${bad} FALHA${bad === 1 ? "" : "S"}`);
process.exit(bad ? 1 : 0);

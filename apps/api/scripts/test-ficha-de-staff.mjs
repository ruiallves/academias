#!/usr/bin/env node
/**
 * A ficha de quem trabalha no clube grava-se no servidor.
 *
 * A queixa: *"mudei o cargo principal e o também é de um perfil de staff, e a
 * label em cima continua desatualizada, e mesmo nas tabelas, etc em todo o
 * lado"*. Ao investigar apareceram dois problemas, e este teste guarda o
 * segundo: o ecrã "Editar ficha" escrevia **só no browser** (um armazém em
 * memória que a consola fundia por cima do que vinha da API). Ficava certo no
 * ecrã de quem editou, não chegava a mais ninguém, e desaparecia no primeiro F5.
 *
 * O que se guarda aqui:
 *
 * 1. `PATCH /api/staff/:id` grava nome, telemóvel, cargo escrito e departamento,
 *    e a lista de staff passa a dizê-lo.
 * 2. O nome e o telemóvel são da **conta**: mudam onde a pessoa estiver.
 * 3. O papel-base só muda a quem **não** tem cargo atribuído — com cargo, é o
 *    cargo que manda (400 com a razão).
 * 4. Sem `staff:write` é 403; acima da própria patente é 403.
 * 5. Fica registado no histórico da pessoa (`ProfileChange`).
 *
 * Num clube descartável, com contas criadas aqui (sem Supabase: o email não se
 * mexe, que é o único campo que precisaria de lá ir).
 *
 * Uso: API_URL=http://127.0.0.1:3011 node scripts/test-ficha-de-staff.mjs
 */
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
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

const Z = "zg-teste-ficha";
const ZG = "zg_academia";

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
      "x-academy-slug": Z,
      "x-app": "console",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};

const db = new pg.Client({ connectionString: env("MIGRATE_DATABASE_URL"), ssl: { rejectUnauthorized: false } });
await db.connect();

const conta = async (email) => (await db.query(`SELECT id FROM "User" WHERE email = $1`, [email])).rows[0].id;
const direcao = await conta("direcao@lifeclub.pt");
const presidente = await conta("presidente@lifeclub.pt");

const limpar = async () => {
  await db.query(`DELETE FROM "ProfileChange" WHERE "academyId" = $1`, [ZG]).catch(() => undefined);
  await db.query(`DELETE FROM "MembershipRole" WHERE "membershipId" LIKE 'zg_%'`);
  await db.query(`DELETE FROM "AcademyRole" WHERE "academyId" = $1`, [ZG]);
  await db.query(`DELETE FROM "Department" WHERE "academyId" = $1`, [ZG]);
  await db.query(`DELETE FROM "LegalAcceptance" WHERE "academyId" = $1`, [ZG]).catch(() => undefined);
  await db.query(`DELETE FROM "Membership" WHERE "academyId" = $1`, [ZG]);
  await db.query(`DELETE FROM "Academy" WHERE id = $1`, [ZG]);
  await db.query(`DELETE FROM "User" WHERE id LIKE 'zg_user_%'`);
};
await limpar();

const ficha = async () =>
  (await db.query(
    `SELECT u.name, u.phone, m.title, m.department, m.role FROM "Membership" m JOIN "User" u ON u.id = m."userId" WHERE m.id = $1`,
    ["zg_memb_fisio"],
  )).rows[0];

try {
  await db.query(
    `INSERT INTO "Academy" (id, slug, name, "shortName", status, "updatedAt")
     VALUES ($1, $2, 'ZG Teste Ficha', 'ZG', 'ACTIVE', now())`, [ZG, Z],
  );
  /* A direcção edita fichas; a presidência está acima dela (é o 403 lá em baixo). */
  await db.query(`INSERT INTO "Membership" (id, "academyId", "userId", role, "isActive", "updatedAt") VALUES ('zg_memb_dir', $1, $2, 'DIRECTOR', true, now())`, [ZG, direcao]);
  await db.query(`INSERT INTO "Membership" (id, "academyId", "userId", role, "isActive", "updatedAt") VALUES ('zg_memb_pres', $1, $2, 'OWNER', true, now())`, [ZG, presidente]);

  /* O fisioterapeuta: conta própria, sem cargo atribuído. */
  await db.query(`INSERT INTO "User" (id, "authId", name, email, phone, "updatedAt") VALUES ('zg_user_fisio', $1, 'ZG Fisio', 'zg-fisio@teste.local', '911111111', now())`, [randomUUID()]);
  await db.query(
    `INSERT INTO "Membership" (id, "academyId", "userId", role, title, department, "isActive", "updatedAt")
     VALUES ('zg_memb_fisio', $1, 'zg_user_fisio', 'MEDICAL', 'Fisio', 'CLINICAL', true, now())`, [ZG],
  );

  /* Um treinador sem `staff:write`, para a recusa. */
  await db.query(`INSERT INTO "User" (id, "authId", name, email, "updatedAt") VALUES ('zg_user_coach', $1, 'ZG Treinador', 'zg-coach@teste.local', now())`, [randomUUID()]);
  await db.query(`INSERT INTO "Membership" (id, "academyId", "userId", role, "isActive", "updatedAt") VALUES ('zg_memb_coach', $1, 'zg_user_coach', 'COACH', true, now())`, [ZG]);

  const director = await login("direcao@lifeclub.pt");
  const pend = ((await call(director, "GET", "/api/legal/status")).body?.pending ?? []).map((d) => d.id);
  if (pend.length) {
    const aceite = await call(director, "POST", "/api/legal/accept", { documentIds: pend, confirmAuthority: true });
    check("(preparação) termos do clube aceites", aceite.status === 200 || aceite.status === 201, `${aceite.status}`);
  }

  console.log("=== A ficha grava ===");
  const guardar = await call(director, "PATCH", "/api/staff/zg_memb_fisio", {
    name: "ZG Fisioterapeuta",
    phone: "922222222",
    title: "Fisioterapeuta do plantel",
    department: "TECHNICAL",
  });
  check("responde (2xx)", guardar.status === 200 || guardar.status === 201, `${guardar.status} ${JSON.stringify(guardar.body).slice(0, 160)}`);

  const depois = await ficha();
  check("o nome ficou", depois?.name === "ZG Fisioterapeuta", `${depois?.name}`);
  check("o telemóvel também", depois?.phone === "922222222", `${depois?.phone}`);
  check("o cargo escrito", depois?.title === "Fisioterapeuta do plantel", `${depois?.title}`);
  check("e o departamento", depois?.department === "TECHNICAL", `${depois?.department}`);

  const lista = await call(director, "GET", "/api/staff");
  const na = (lista.body ?? []).find((m) => m.id === "zg_memb_fisio");
  check("a lista de staff diz o mesmo", na?.name === "ZG Fisioterapeuta" && na?.title === "Fisioterapeuta do plantel", JSON.stringify(na).slice(0, 200));

  console.log("\n=== Fica no histórico ===");
  const mudancas = (await db.query(
    `SELECT field, before, after FROM "ProfileChange" WHERE "subjectId" = $1 ORDER BY field`,
    ["zg_memb_fisio"],
  )).rows;
  check("o histórico regista o que mudou", mudancas.length >= 3, JSON.stringify(mudancas.map((m) => m.field)));
  check("com o valor antigo e o novo", mudancas.some((m) => m.before === "Fisio" && m.after === "Fisioterapeuta do plantel"), JSON.stringify(mudancas));

  console.log("\n=== O papel-base ===");
  const semCargo = await call(director, "PATCH", "/api/staff/zg_memb_fisio", { role: "COACH" });
  check("sem cargo atribuído, o papel muda", semCargo.status === 200 || semCargo.status === 201, `${semCargo.status} ${JSON.stringify(semCargo.body).slice(0, 140)}`);
  check("e fica gravado", (await ficha())?.role === "COACH", `${(await ficha())?.role}`);

  /* Agora com cargo: o cargo manda, e a ficha recusa. */
  await db.query(
    `INSERT INTO "AcademyRole" (id, "academyId", key, name, "baseRole", rank, permissions, "navKeys", "updatedAt")
     VALUES ('zg_role', $1, 'zg-cargo', 'ZG Cargo', 'MEDICAL', 40, ARRAY['academy:read']::text[], ARRAY[]::text[], now())`, [ZG],
  );
  await db.query(`UPDATE "Membership" SET "customRoleId" = 'zg_role' WHERE id = 'zg_memb_fisio'`);
  const comCargo = await call(director, "PATCH", "/api/staff/zg_memb_fisio", { role: "STAFF" });
  check("com cargo atribuído, o papel não muda aqui (400)", comCargo.status === 400, `${comCargo.status}`);
  check("e a mensagem manda ao sítio certo", /separador Acesso/i.test(JSON.stringify(comCargo.body)), JSON.stringify(comCargo.body).slice(0, 160));

  console.log("\n=== O departamento do cargo ===");
  /*
   * A queixa foi esta: "selecionei treinadora e a secretaria e operações ainda
   * aparece em cima em vez de equipa técnica". São dois departamentos — o do
   * cargo (tabela `Department`) e o enum antigo da ficha — e quem manda é o do
   * cargo. Aqui garante-se que a consola recebe o do cargo para o poder mostrar.
   */
  await db.query(
    `INSERT INTO "Department" (id, "academyId", key, name, "baseRole", permissions, "navKeys", "updatedAt")
     VALUES ('zg_dep', $1, 'tecnica', 'Equipa técnica', 'COACH', ARRAY['academy:read']::text[], ARRAY[]::text[], now())`, [ZG],
  );
  await db.query(`UPDATE "AcademyRole" SET "departmentId" = 'zg_dep' WHERE id = 'zg_role'`);

  const listaComDep = await call(director, "GET", "/api/staff");
  const fisio = (listaComDep.body ?? []).find((m) => m.id === "zg_memb_fisio");
  check("o cargo vem com o departamento dele", fisio?.roleDepartment?.name === "Equipa técnica", JSON.stringify(fisio?.roleDepartment));
  check("com a chave, para a pastilha do clínico", fisio?.roleDepartment?.key === "tecnica", JSON.stringify(fisio?.roleDepartment));
  check("e o enum escrito na ficha continua o que era", fisio?.department === "TECHNICAL", `${fisio?.department}`);

  const semCargoAtribuido = (listaComDep.body ?? []).find((m) => m.id === "zg_memb_coach");
  check("quem não tem cargo não traz departamento nenhum", (semCargoAtribuido?.roleDepartment ?? null) === null, JSON.stringify(semCargoAtribuido?.roleDepartment));

  console.log("\n=== Quem não pode ===");
  const coach = await login("treinador@lifeclub.pt");
  const semPermissao = await call(coach, "PATCH", "/api/staff/zg_memb_fisio", { title: "Nada" });
  check("um treinador não edita fichas (403/404)", semPermissao.status === 403 || semPermissao.status === 404, `${semPermissao.status}`);

  const acimaDaPatente = await call(director, "PATCH", "/api/staff/zg_memb_pres", { title: "Patrão" });
  check("nem se edita quem está acima (403)", acimaDaPatente.status === 403, `${acimaDaPatente.status} ${JSON.stringify(acimaDaPatente.body).slice(0, 120)}`);

  const nomeVazio = await call(director, "PATCH", "/api/staff/zg_memb_fisio", { name: " " });
  check("um nome vazio é recusado (400)", nomeVazio.status === 400, `${nomeVazio.status}`);
} catch (error) {
  bad++;
  console.log("  FALHA (excepção) " + (error?.stack ?? error));
} finally {
  await limpar();
  await db.end();
}

console.log(`\n${ok} OK, ${bad} falha(s)`);
process.exit(bad ? 1 : 0);

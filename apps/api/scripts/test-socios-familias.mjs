#!/usr/bin/env node
/**
 * Quem vê sócios, e quem vê famílias.
 *
 * Duas regras do produto, e as duas são sobre **omissões** — o que cada base traz
 * antes de alguém delegar seja o que for:
 *
 *  - os **sócios** são da direcção. Nem o coordenador nem um departamento novo os
 *    vêem sem que alguém lhes dê um cargo que os inclua;
 *  - o **treinador** vê as famílias, mas só as dos atletas das equipas dele — e
 *    não o número de contribuinte de nenhuma criança.
 *
 * O que interessa aqui não é a interface: é que o servidor recuse, e que o âmbito
 * seja real e não uma lista filtrada no browser.
 *
 * Uso: node scripts/test-socios-familias.mjs
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

const call = async (token, method, p, body) => {
  const r = await fetch(API + p, {
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

const direcao = await login("direcao@lifeclub.pt");
const coach = await login("treinador@lifeclub.pt");
const secretaria = await login("secretaria@lifeclub.pt");
const clinico = await login("clinico@lifeclub.pt");

/* -------------------------------------------------------------------------- */

console.log("=== Sócios: só a direcção, por omissão ===");

const permissoes = async (token) => {
  const r = await call(token, "GET", "/api/bootstrap");
  return new Set(r.body?.me?.permissions ?? []);
};

const pDirecao = await permissoes(direcao);
const pCoach = await permissoes(coach);
const pSecretaria = await permissoes(secretaria);
const pClinico = await permissoes(clinico);

check("a direção vê sócios", pDirecao.has("member:read"), "");
check("o treinador não", !pCoach.has("member:read"), "");
/*
 * A secretaria é STAFF, e STAFF deixou de trazer sócios.
 *
 * Não é a secretaria que se está a fechar: é que STAFF é o âmbito por omissão de
 * qualquer departamento que o clube invente, e um departamento de equipamentos
 * não devia nascer a ver a lista de sócios com quotas e contactos. Um clube que
 * queira a secretaria a tratar disso cria-lhe um cargo com essa permissão — que é
 * a delegação que os cargos existem para fazer.
 */
check("um âmbito STAFF também não, por omissão", !pSecretaria.has("member:read"), "");
check("nem o departamento clínico", !pClinico.has("member:read"), "");

/*
 * E o servidor recusa, não é só o menu que desaparece.
 *
 * É a diferença entre esconder e fechar: quem souber o endereço chega ao endpoint
 * na mesma, e é aqui que tem de bater na porta.
 */
const socios = await call(coach, "GET", "/api/members");
check("o treinador leva 403 nos sócios", socios.status === 403, `${socios.status}`);
const sociosSecretaria = await call(secretaria, "GET", "/api/members");
check("e um âmbito STAFF também", sociosSecretaria.status === 403, `${sociosSecretaria.status}`);
const sociosDirecao = await call(direcao, "GET", "/api/members");
check("a direção entra", sociosDirecao.status === 200, `${sociosDirecao.status}`);

/* -------------------------------------------------------------------------- */

console.log("\n=== Famílias: o treinador vê as das equipas dele ===");

check("o treinador passa a ver famílias", pCoach.has("family:read"), "");

const doCoach = (await db.query(
  `SELECT DISTINCT ts."teamId" FROM "TeamStaff" ts
   JOIN "Membership" m ON m.id = ts."membershipId"
   JOIN "User" u ON u.id = m."userId"
   WHERE u.email = 'treinador@lifeclub.pt'`,
)).rows.map((r) => r.teamId);
check("e tem equipas atribuídas", doCoach.length > 0, `${doCoach.length}`);

const atletasCoach = await call(coach, "GET", "/api/athletes");
const atletasDirecao = await call(direcao, "GET", "/api/athletes");

/*
 * As famílias vêm **dentro** do atleta — é assim que a consola monta a lista de
 * Famílias. Logo, o âmbito das famílias é o âmbito dos atletas, e não uma
 * segunda regra que se pudesse esquecer de aplicar.
 */
const encarregadosDe = (r) =>
  new Set((r.body ?? []).flatMap((a) => (a.guardians ?? []).map((g) => g.membershipId)));

const doTreinador = encarregadosDe(atletasCoach);
const daDirecao = encarregadosDe(atletasDirecao);

check("o treinador recebe encarregados", doTreinador.size > 0, `${doTreinador.size}`);
check("e a direção recebe mais", daDirecao.size >= doTreinador.size, `${daDirecao.size} vs ${doTreinador.size}`);
check(
  "os do treinador são um subconjunto dos da direção",
  [...doTreinador].every((id) => daDirecao.has(id)),
  "",
);

/*
 * A prova do âmbito: nenhum atleta fora das equipas dele, logo nenhuma família
 * de fora.
 */
const foraDoAmbito = (atletasCoach.body ?? []).filter((a) => !doCoach.includes(a.teamId));
check("nenhum atleta fora das equipas dele", foraDoAmbito.length === 0, foraDoAmbito.map((a) => a.name).join(","));

/*
 * Um encarregado de uma equipa que não é dele não pode aparecer. Confirma-se
 * contra a base, e não contra a resposta: é a diferença entre "a API não mo
 * mandou" e "não existe maneira de eu lá chegar".
 */
const alheios = (await db.query(
  `SELECT DISTINCT ag."membershipId"
     FROM "GuardianLink" ag
     JOIN "Athlete" a ON a.id = ag."athleteId"
    WHERE NOT EXISTS (
      SELECT 1 FROM "TeamMembership" tm
       WHERE tm."athleteId" = a.id AND tm."teamId" = ANY($1::text[])
    )`,
  [doCoach],
)).rows.map((r) => r.membershipId);

if (alheios.length > 0) {
  check(
    "nenhum encarregado de fora das equipas dele chega ao treinador",
    alheios.every((id) => !doTreinador.has(id)),
    "",
  );
} else {
  console.log("  (todas as famílias da demo são das equipas deste treinador — salto)");
}

console.log("\n=== Ver famílias não é convidar famílias ===");
/*
 * O treinador vê a lista, mas não convida ninguém para a app.
 *
 * São duas coisas diferentes, e o servidor já as separava — `family:read` para
 * ler, `family:write` para convidar. O botão da consola é que não perguntava, e
 * passou a aparecer ao treinador no dia em que ele ganhou a leitura. Um botão que
 * só serve para dar um erro é pior do que botão nenhum.
 */
const convitePorCoach = await call(coach, "POST", "/api/family-invite", { days: 7 });
check("o treinador não gera convite de família (403)", convitePorCoach.status === 403, `${convitePorCoach.status}`);
check("e não tem family:write", !pCoach.has("family:write"), "");

const convitePorDirecao = await call(direcao, "POST", "/api/family-invite", { days: 7 });
check("a direção gera", convitePorDirecao.status < 300, `${convitePorDirecao.status}`);

// O convite criado por este teste não fica pendurado.
await db.query(`DELETE FROM "FamilyInvite" WHERE "academyId" = (SELECT id FROM "Academy" WHERE slug = 'life-club')`);

console.log("\n=== O NIF da criança não acompanha o treinador ===");
/*
 * `family:read` abriu a lista de famílias ao treinador. O número de contribuinte
 * de uma criança é outra coisa: passou a exigir `family:write`, que é quem emite
 * recibos. Sem esta separação, dar-lhe a lista dava-lhe também os NIF.
 */
const comNif = (atletasCoach.body ?? []).filter((a) => a.taxId !== null);
check("o treinador não recebe NIF nenhum", comNif.length === 0, `${comNif.length}`);
check("o treinador não tem family:write", !pCoach.has("family:write"), "");

const nifDirecao = (atletasDirecao.body ?? []).some((a) => a.taxId !== null);
const haNifNaBase = (await db.query(`SELECT count(*)::int n FROM "Athlete" WHERE "taxId" IS NOT NULL`)).rows[0].n;
if (haNifNaBase > 0) {
  check("mas a direção recebe", nifDirecao, "");
} else {
  console.log("  (nenhum atleta da demo tem NIF — salto a contraprova)");
}

await db.end();
console.log(`\n${ok} passaram, ${bad} falharam`);
process.exit(bad === 0 ? 0 : 1);

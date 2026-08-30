#!/usr/bin/env node
/**
 * Apagar um clube.
 *
 * A operação mais destrutiva do produto, e por isso a que mais precisa de
 * provas — não do caminho feliz, mas das **recusas**: quem não pode, quem
 * escreve o nome errado, e o que acontece à academia do lado.
 *
 * O clube de teste é criado e apagado aqui, e nunca é a `life-club`: um teste
 * que se engane a apontar não deixa "falhou", deixa a base vazia.
 *
 * Uso: node scripts/test-delete-academy.mjs
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

const SLUG = "zz-descartavel";
const NOME = "ZZ Clube Descartavel";

const call = async (token, method, pathname, body, slug = SLUG) => {
  const r = await fetch(API + pathname, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "x-academy-slug": slug,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};

const db = new pg.Client({ connectionString: env("MIGRATE_DATABASE_URL"), ssl: { rejectUnauthorized: false } });
await db.connect();

// Limpeza de uma corrida anterior que tenha rebentado a meio.
await db.query('DELETE FROM "Academy" WHERE slug = $1', [SLUG]);
await db.query(`DELETE FROM "AuditLog" WHERE "targetId" = 'zzacad'`);

/*
 * O clube de teste, com um diretor (que pode apagar) e um treinador (que não
 * pode). As contas reaproveitam-se das que a semente já criou: o que se testa
 * aqui é a permissão, não o registo de utilizadores.
 */
const users = (
  await db.query(`SELECT id, email FROM "User" WHERE email IN ('direcao@lifeclub.pt','treinador@lifeclub.pt')`)
).rows;
const dirUser = users.find((u) => u.email === "direcao@lifeclub.pt");
const coachUser = users.find((u) => u.email === "treinador@lifeclub.pt");
if (!dirUser || !coachUser) throw new Error("Corre `npm run seed` primeiro — faltam as contas de teste.");

await db.query(
  `INSERT INTO "Academy" (id, slug, name, "shortName", "signalColor", status, "createdAt", "updatedAt")
   VALUES ('zzacad', $1, $2, 'ZZ', '#0f6b62', 'ACTIVE', now(), now())`,
  [SLUG, NOME],
);
await db.query(
  `INSERT INTO "Membership" (id, "academyId", "userId", role, "isActive", "createdAt", "updatedAt")
   VALUES ('zzm1', 'zzacad', $1, 'DIRECTOR', true, now(), now()),
          ('zzm2', 'zzacad', $2, 'COACH', true, now(), now())`,
  [dirUser.id, coachUser.id],
);
await db.query(`INSERT INTO "Sport" (id, "academyId", name) VALUES ('zzsp','zzacad','Futebol')`);
await db.query(
  `INSERT INTO "Season" (id, "academyId", label, "startsOn", "endsOn", "isCurrent")
   VALUES ('zzse','zzacad','2026/27','2026-08-01','2027-07-31',true)`,
);
await db.query(
  `INSERT INTO "Team" (id, "academyId", "sportId", "seasonId", name, "maxAge", "createdAt", "updatedAt")
   VALUES ('zzt','zzacad','zzsp','zzse','ZZ Sub-11', 11, now(), now())`,
);
await db.query(
  `INSERT INTO "Athlete" (id, "academyId", name, birthdate, "createdAt", "updatedAt")
   VALUES ('zza','zzacad','ZZ Atleta','2015-01-01', now(), now())`,
);

const director = await login("direcao@lifeclub.pt");
const coach = await login("treinador@lifeclub.pt");

console.log("=== Permissão ===");
const semPermissao = await call(coach, "DELETE", "/api/academy", { confirmName: NOME });
check("um treinador não apaga o clube (403)", semPermissao.status === 403, `${semPermissao.status}`);

console.log("\n=== A confirmação pelo nome ===");
const nomeErrado = await call(director, "DELETE", "/api/academy", { confirmName: "Outro Clube" });
check("nome errado é recusado (400)", nomeErrado.status === 400, `${nomeErrado.status}`);
check("e a mensagem diz qual é o nome certo", String(nomeErrado.body?.message ?? "").includes(NOME));
const semNome = await call(director, "DELETE", "/api/academy", {});
check("sem confirmação é recusado (400)", semNome.status === 400, `${semNome.status}`);

const aindaLa = await db.query('SELECT 1 FROM "Academy" WHERE slug = $1', [SLUG]);
check("depois das recusas o clube continua lá", aindaLa.rowCount === 1);

console.log("\n=== A academia do lado ===");
/*
 * A mesma sessão a apontar à academia de demonstração. O diretor **tem** lá
 * membership (é a conta semeada), por isso o que a trava não é a permissão: é a
 * confirmação pelo nome, que não bate certo. É exactamente a razão de a
 * confirmação existir.
 */
const outra = await call(director, "DELETE", "/api/academy", { confirmName: NOME }, "life-club");
check("o nome deste clube não apaga a do lado (400)", outra.status === 400, `${outra.status}`);
const lifeClub = await db.query(`SELECT 1 FROM "Academy" WHERE slug = 'life-club'`);
check("a life-club continua intacta", lifeClub.rowCount === 1);

console.log("\n=== Apagar a sério ===");
const apagou = await call(director, "DELETE", "/api/academy", { confirmName: `  ${NOME.toUpperCase()}  ` });
check(
  "o nome confere com espaços e maiúsculas diferentes (200)",
  apagou.status === 200,
  `${apagou.status} ${JSON.stringify(apagou.body).slice(0, 140)}`,
);
check("a resposta diz o que se perdeu", apagou.body?.atletas === 1 && apagou.body?.equipas === 1, JSON.stringify(apagou.body));

const sumiu = await db.query('SELECT 1 FROM "Academy" WHERE slug = $1', [SLUG]);
check("a academia desapareceu", sumiu.rowCount === 0);

for (const tabela of ["Team", "Athlete", "Membership", "Sport", "Season"]) {
  const r = await db.query(`SELECT 1 FROM "${tabela}" WHERE "academyId" = 'zzacad'`);
  check(`a cascata levou ${tabela}`, r.rowCount === 0);
}

const contas = await db.query('SELECT 1 FROM "User" WHERE id = $1', [dirUser.id]);
check("as contas das pessoas ficam — não são da academia", contas.rowCount === 1);

console.log("\n=== O registo na plataforma ===");
const log = await db.query(`SELECT detail FROM "AuditLog" WHERE action = 'academy.deleted' AND "targetId" = 'zzacad'`);
check("ficou registado que o clube foi apagado", log.rowCount === 1, `${log.rowCount} linhas`);
if (log.rowCount === 1) {
  const d = log.rows[0].detail;
  check("o registo guarda o slug, quem apagou e as contagens", d.slug === SLUG && d.atletas === 1 && !!d.porUserId, JSON.stringify(d).slice(0, 160));
  check("e sobreviveu à cascata — é da plataforma, não da academia", true);
}

await db.query(`DELETE FROM "AuditLog" WHERE "targetId" = 'zzacad'`);
await db.end();
console.log(`\n${ok} passaram, ${bad} falharam`);
process.exit(bad ? 1 : 0);

#!/usr/bin/env node
/**
 * O histórico de alterações de uma ficha.
 *
 * O que se prova:
 *  - editar um atleta escreve uma linha por campo, com o antes e o depois
 *    (o caso que o pediu: peso e altura);
 *  - gravar sem mudar nada não escreve nada, e um campo que não veio no
 *    formulário não aparece no histórico;
 *  - o mesmo para um sócio, e para o staff (equipas, acessos, estado);
 *  - quem lê é quem pode editar: um treinador vê o histórico dos atletas das
 *    equipas dele e leva 403 nos outros; uma família não entra;
 *  - o histórico não se apaga nem se edita (a base só dá SELECT e INSERT).
 *
 * Dados próprios, criados e apagados aqui.
 *
 * Uso: API=http://localhost:3001 node scripts/test-historico.mjs
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

const S = env("SUPABASE_URL").replace(/\/$/, ""), A = env("SUPABASE_ANON_KEY");
const API = process.env.API ?? process.env.API_URL ?? "http://localhost:3001";
const SLUG = "life-club";
const ACADEMY = "acd_lifeclub";

let ok = 0, bad = 0;
const check = (l, c, d = "") => { if (c) { ok++; console.log("  OK    " + l); } else { bad++; console.log("  FALHA " + l + (d ? " — " + d : "")); } };

const login = async (e) =>
  (await (await fetch(`${S}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: A, "Content-Type": "application/json" },
    body: JSON.stringify({ email: e, password: "academia2026" }),
  })).json()).access_token;

const req = async (token, method, p, body) => {
  const r = await fetch(API + p, {
    method,
    headers: { Authorization: `Bearer ${token}`, "x-academy-slug": SLUG, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};

const db = new pg.Client({ connectionString: env("MIGRATE_DATABASE_URL"), ssl: { rejectUnauthorized: false } });
await db.connect();

const stamp = Date.now().toString(36);
const ATLETA = `zz_atl_hist_${stamp}`;
const SOCIO = `zz_mem_hist_${stamp}`;
const campo = (linhas, f) => (linhas ?? []).find((x) => x.field === f);

try {
  console.log("=== Preparar ===");
  const equipa = (await db.query(`SELECT id FROM "Team" WHERE "academyId" = $1 AND name ILIKE 'Sub-11%' LIMIT 1`, [ACADEMY])).rows[0].id;
  await db.query(
    `INSERT INTO "Athlete" (id, "academyId", name, birthdate, "heightCm", "weightKg", "updatedAt")
     VALUES ($1, $2, 'ZZ Histórico', '2015-03-04', 150, 42.0, now())`,
    [ATLETA, ACADEMY],
  );
  await db.query(`INSERT INTO "TeamMembership" (id, "teamId", "athleteId") VALUES ($1, $2, $3)`, [`zz_tm_${stamp}`, equipa, ATLETA]);
  await db.query(
    `INSERT INTO "Member" (id, "academyId", name, status, "updatedAt") VALUES ($1, $2, 'ZZ Sócio Histórico', 'ACTIVE', now())`,
    [SOCIO, ACADEMY],
  );
  const director = await login("direcao@lifeclub.pt");
  const coach = await login("treinador@lifeclub.pt");
  const familia = await login("familia@lifeclub.pt");
  check("sessões", Boolean(director && coach && familia));

  console.log("\n=== O atleta: peso e altura ===");
  const vazio = await req(director, "GET", `/api/historico/atletas/${ATLETA}`);
  check("uma ficha nova não tem histórico", vazio.status === 200 && vazio.body.length === 0, JSON.stringify(vazio.body).slice(0, 120));

  const edita = await req(director, "PATCH", `/api/athletes/${ATLETA}`, { heightCm: 154, weightDg: 455 });
  check("a direção edita o atleta", edita.status === 200, `${edita.status} ${JSON.stringify(edita.body).slice(0, 120)}`);
  let hist = (await req(director, "GET", `/api/historico/atletas/${ATLETA}`)).body ?? [];
  check("duas linhas, uma por campo", hist.length === 2, JSON.stringify(hist.map((h) => h.field)));
  check("a altura diz de quanto para quanto", campo(hist, "heightCm")?.before === "150" && campo(hist, "heightCm")?.after === "154",
    JSON.stringify(campo(hist, "heightCm")));
  check("o peso também, em quilos", campo(hist, "weightKg")?.before === "42" && campo(hist, "weightKg")?.after === "45.5",
    JSON.stringify(campo(hist, "weightKg")));
  check("com quem mexeu", typeof campo(hist, "weightKg")?.byName === "string" && campo(hist, "weightKg").byName.length > 2, campo(hist, "weightKg")?.byName);

  await req(director, "PATCH", `/api/athletes/${ATLETA}`, { heightCm: 154 });
  hist = (await req(director, "GET", `/api/historico/atletas/${ATLETA}`)).body ?? [];
  check("gravar o mesmo valor não escreve nada", hist.length === 2, `${hist.length}`);

  await req(director, "PATCH", `/api/athletes/${ATLETA}`, { name: "ZZ Histórico II" });
  hist = (await req(director, "GET", `/api/historico/atletas/${ATLETA}`)).body ?? [];
  check("o nome entra, e só o nome", hist.length === 3 && hist[0].field === "name" && hist[0].after === "ZZ Histórico II",
    JSON.stringify(hist.map((h) => h.field)));
  check("o mais recente vem primeiro", new Date(hist[0].createdAt) >= new Date(hist[1].createdAt));

  console.log("\n=== O sócio ===");
  const editaSocio = await req(director, "PATCH", `/api/members/${SOCIO}`, { phone: "912345678", city: "Fundão" });
  check("a direção edita o sócio", editaSocio.status === 200, `${editaSocio.status}`);
  const histSocio = (await req(director, "GET", `/api/historico/socios/${SOCIO}`)).body ?? [];
  check("o telefone e a cidade ficaram no histórico",
    campo(histSocio, "phone")?.after === "912345678" && campo(histSocio, "city")?.after === "Fundão",
    JSON.stringify(histSocio.map((h) => `${h.field}:${h.after}`)));
  check("e a data de gravação não conta como alteração", !campo(histSocio, "updatedAt"), JSON.stringify(histSocio.map((h) => h.field)));

  console.log("\n=== O staff ===");
  const alvo = (await db.query(
    `SELECT m.id FROM "Membership" m JOIN "User" u ON u.id = m."userId" WHERE u.email = 'adjunto@lifeclub.pt' AND m."academyId" = $1`,
    [ACADEMY],
  )).rows[0].id;
  const equipasAntes = (await db.query(`SELECT "teamId" FROM "TeamStaff" WHERE "membershipId" = $1`, [alvo])).rows.map((r) => r.teamId);
  const semUma = equipasAntes.slice(0, Math.max(1, equipasAntes.length - 1));
  const mexe = await req(director, "PATCH", `/api/staff/${alvo}/teams`, { teamIds: semUma });
  check("a direção muda as equipas de alguém do staff", mexe.status === 200, `${mexe.status}`);
  const histStaff = (await req(director, "GET", `/api/historico/staff/${alvo}`)).body ?? [];
  check("as equipas ficaram no histórico, por nome", Boolean(campo(histStaff, "equipas")) && /Sub-/.test(campo(histStaff, "equipas").before ?? ""),
    JSON.stringify(campo(histStaff, "equipas")));
  await req(director, "PATCH", `/api/staff/${alvo}/teams`, { teamIds: equipasAntes });

  console.log("\n=== Quem vê ===");
  const doTreinador = await req(coach, "GET", `/api/historico/atletas/${ATLETA}`);
  check("o treinador vê o histórico de um atleta da equipa dele", doTreinador.status === 200 && doTreinador.body.length >= 3, `${doTreinador.status}`);
  const outro = (await db.query(
    `SELECT a.id FROM "Athlete" a WHERE a."academyId" = $1 AND NOT EXISTS (
       SELECT 1 FROM "TeamMembership" tm JOIN "TeamStaff" ts ON ts."teamId" = tm."teamId"
         JOIN "Membership" m ON m.id = ts."membershipId" JOIN "User" u ON u.id = m."userId"
        WHERE tm."athleteId" = a.id AND u.email = 'treinador@lifeclub.pt')
     AND EXISTS (SELECT 1 FROM "TeamMembership" tm2 WHERE tm2."athleteId" = a.id) LIMIT 1`,
    [ACADEMY],
  )).rows[0]?.id;
  if (outro) {
    check("e não vê o de um atleta de outra equipa", (await req(coach, "GET", `/api/historico/atletas/${outro}`)).status === 403);
  } else {
    console.log("  (o treinador tem todas as equipas — salto essa fronteira)");
  }
  check("o treinador não vê o histórico do staff", (await req(coach, "GET", `/api/historico/staff/${alvo}`)).status === 403);
  check("uma família não entra", (await req(familia, "GET", `/api/historico/atletas/${ATLETA}`)).status === 403);

  console.log("\n=== O histórico não se reescreve ===");
  let erro = null;
  try {
    await db.query(`SET ROLE academia_app`);
    await db.query(`UPDATE "ProfileChange" SET after = 'mentira' WHERE "subjectId" = $1`, [ATLETA]);
  } catch (e) { erro = e.code; } finally { await db.query(`RESET ROLE`); }
  check("a base recusa editar uma linha do histórico", erro === "42501", `${erro}`);
} finally {
  console.log("\n=== Limpeza ===");
  await db.query(`DELETE FROM "ProfileChange" WHERE "subjectId" IN ($1, $2)`, [ATLETA, SOCIO]);
  await db.query(`DELETE FROM "TeamMembership" WHERE "athleteId" = $1`, [ATLETA]);
  await db.query(`DELETE FROM "Athlete" WHERE id = $1`, [ATLETA]);
  await db.query(`DELETE FROM "Member" WHERE id = $1`, [SOCIO]);
  await db.end();
  console.log("  feito");
}

console.log(`\n${ok} passaram, ${bad} falharam`);
process.exit(bad === 0 ? 0 : 1);

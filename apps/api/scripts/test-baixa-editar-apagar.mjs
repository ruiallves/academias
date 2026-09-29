#!/usr/bin/env node
/**
 * Corrigir e apagar uma baixa, e as presenças de quem estava de baixa.
 *
 * - quem escreve no boletim (`clinical:write`) corrige uma baixa e apaga-a,
 *   mesmo já passada; o treinador não;
 * - a folha de presenças recusa falta a quem estava de baixa **no dia do
 *   treino**, e aceita a quem estava condicionado ou já tinha alta nesse dia;
 * - apagar a baixa tira-a da base (e com ela, a recusa).
 *
 * Num treino e numa baixa criados aqui no Life Club, apagados no fim.
 *
 * Uso: API_URL=http://localhost:3012 node scripts/test-baixa-editar-apagar.mjs
 * Nunca contra a :3000 nem a :3001 (as do Rui).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const env = (k) => {
  const l = readFileSync(path.join(HERE, "..", ".env"), "utf8").split(/\r?\n/).find((x) => x.startsWith(k + "="));
  if (!l) throw new Error(`${k} não está em .env`);
  return l.slice(k.length + 1).trim().replace(/^"|"$/g, "");
};

const S = env("SUPABASE_URL").replace(/\/$/, "");
const A = env("SUPABASE_ANON_KEY");
const API = process.env.API_URL ?? "http://localhost:3012";
if (/:300[01]\b/.test(API)) throw new Error("Não corras isto contra a :3000 nem a :3001.");
const TREINO = "zz_sess_baixa";
const BAIXA = "zz_clin_baixa";

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
const limpar = async () => {
  await db.query(`DELETE FROM "ClinicalEntry" WHERE id = $1`, [BAIXA]);
  await db.query(`DELETE FROM "TrainingSession" WHERE id = $1`, [TREINO]);
};

try {
  await limpar();
  const atleta = (await db.query(`
    SELECT a.id, a.name FROM "Athlete" a JOIN "TeamMembership" tm ON tm."athleteId" = a.id
     WHERE a."academyId" = 'acd_lifeclub' AND tm."teamId" = 't_sub11' AND tm."leftAt" IS NULL AND a.status = 'ACTIVE'
     ORDER BY a.name LIMIT 1`)).rows[0];

  // Um treino a 18/09/2026, 18:00 em Lisboa (17:00 UTC).
  await db.query(
    `INSERT INTO "TrainingSession" (id, "academyId", "teamId", "startsAt", "endsAt", venue, "updatedAt")
     VALUES ($1, 'acd_lifeclub', 't_sub11', '2026-09-18T17:00:00Z', '2026-09-18T18:30:00Z', 'Campo 1', now())`,
    [TREINO],
  );
  // De baixa de 15/09 a 25/09 (alta a 25).
  await db.query(
    `INSERT INTO "ClinicalEntry" (id, "academyId", "athleteId", kind, status, date, title, impact, "clearedOn", "updatedAt")
     VALUES ($1, 'acd_lifeclub', $2, 'INJURY', 'DONE', '2026-09-15', 'ZZ Entorse (teste)', 'OUT', '2026-09-25', now())`,
    [BAIXA, atleta.id],
  );

  const medica = await login("clinico@lifeclub.pt");
  const treinador = await login("treinador@lifeclub.pt");
  // As presenças pela direção: o treinador de demonstração não tem \`attendance:write\`.
  const direcao = await login("direcao@lifeclub.pt");
  const falta = [{ athleteId: atleta.id, kind: "absent" }];

  const f1 = await call(direcao, "PUT", `/api/sessions/${TREINO}/attendance`, { absences: falta });
  check("de baixa no dia do treino (já com alta hoje): falta recusada", f1.status === 400, `${f1.status} ${JSON.stringify(f1.body)}`);

  const semMarca = await call(direcao, "PUT", `/api/sessions/${TREINO}/attendance`, { absences: [] });
  const gravado = (await db.query(`SELECT count(*)::int n FROM "AttendanceRecord" WHERE "sessionId" = $1`, [TREINO])).rows[0].n;
  check("sem marca, a folha fecha e não grava nada para ele", semMarca.status === 200 && gravado === 0, `${semMarca.status} ${gravado}`);

  // Condicionado nesse dia: treina, pode levar falta.
  const e1 = await call(treinador, "PATCH", `/api/clinical/${BAIXA}`, { impact: "LIMITED" });
  check("o treinador não corrige o boletim (403)", e1.status === 403, String(e1.status));
  const e2 = await call(medica, "PATCH", `/api/clinical/${BAIXA}`, { impact: "LIMITED", title: "ZZ Entorse leve (teste)", expectedReturn: null });
  const depois = (await db.query(`SELECT impact, title, "expectedReturn" FROM "ClinicalEntry" WHERE id = $1`, [BAIXA])).rows[0];
  check("a médica corrige a baixa para condicionado", e2.status === 200 && depois.impact === "LIMITED" && depois.title === "ZZ Entorse leve (teste)", `${e2.status} ${JSON.stringify(depois)}`);
  const f2 = await call(direcao, "PUT", `/api/sessions/${TREINO}/attendance`, { absences: falta });
  check("condicionado no dia: a falta já é aceite", f2.status === 200, `${f2.status} ${JSON.stringify(f2.body)}`);

  // A baixa começa depois do treino: nesse dia estava apto.
  await call(medica, "PATCH", `/api/clinical/${BAIXA}`, { impact: "OUT", date: "2026-09-20" });
  const f3 = await call(direcao, "PUT", `/api/sessions/${TREINO}/attendance`, { absences: falta });
  check("baixa que começa depois do treino não impede a falta", f3.status === 200, `${f3.status} ${JSON.stringify(f3.body)}`);

  // Volta a cobrir o dia, e apaga-se.
  await call(medica, "PATCH", `/api/clinical/${BAIXA}`, { date: "2026-09-15" });
  const t1 = await call(treinador, "DELETE", `/api/clinical/${BAIXA}`);
  check("o treinador não apaga (403)", t1.status === 403, String(t1.status));
  const m1 = await call(medica, "DELETE", `/api/clinical/${BAIXA}`);
  const existe = (await db.query(`SELECT count(*)::int n FROM "ClinicalEntry" WHERE id = $1`, [BAIXA])).rows[0].n;
  check("a médica apaga uma baixa já passada, e sai da base", m1.status === 200 && existe === 0, `${m1.status} ${JSON.stringify(m1.body)} ${existe}`);
  const f4 = await call(direcao, "PUT", `/api/sessions/${TREINO}/attendance`, { absences: falta });
  check("sem a baixa, a falta volta a ser aceite", f4.status === 200, `${f4.status}`);
} finally {
  await limpar();
  await db.end();
}

console.log(`\n${ok} OK, ${bad} falhas`);
process.exit(bad ? 1 : 0);

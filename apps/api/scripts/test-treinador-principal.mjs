#!/usr/bin/env node
/**
 * Quem é o treinador de uma equipa — e de uma convocatória.
 *
 * ## A queixa que isto fecha
 *
 * Um clube: "o Paulo Pais aparece como treinador principal quando não é ele que
 * está nesse cargo, e juntei equipa técnica na convocatória e não aparece".
 *
 * O Paulo Pais era treinador de guarda-redes. Duas causas:
 *
 *  - Os clientes escolhiam o treinador como **o primeiro da lista** da equipa
 *    técnica (`coaches[0]`), e essa lista vem da base sem ordem nenhuma. Agora
 *    `/api/teams` diz quem é (`headCoach`), com a regra do servidor.
 *  - A folha só lia a equipa escalada para o jogo, e o clube tinha preenchido a
 *    equipa técnica na ficha da equipa. Agora a página do jogo manda também a
 *    equipa técnica da equipa (`teamStaff`), com o principal primeiro.
 *
 * E um caso do mesmo defeito que a regra aceitava: uma equipa só com uma médica
 * na equipa técnica tinha a médica como "treinador".
 *
 * ## Porquê uma equipa de mentira
 *
 * Mexer na equipa técnica de uma equipa do seed partia os testes que dependem
 * dela. Copia-se uma equipa e um jogo do life-club, com ids próprios, e apaga-se
 * tudo no fim.
 *
 * Uso: node scripts/test-treinador-principal.mjs
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

let ok = 0;
let bad = 0;
const check = (l, c, d = "") => {
  if (c) { ok++; console.log("  OK    " + l); }
  else { bad++; console.log("  FALHA " + l + (d ? " — " + d : "")); }
};

const login = async (email) =>
  (await (await fetch(`${S}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: A, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "academia2026" }),
  })).json()).access_token;

const call = async (token, method, pathname, body) => {
  const res = await fetch(API + pathname, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "x-academy-slug": "life-club",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

const db = new pg.Client({ connectionString: env("MIGRATE_DATABASE_URL"), ssl: { rejectUnauthorized: false } });
await db.connect();

const director = await login("direcao@lifeclub.pt");

/* O gate legal bloqueia tudo a quem tenha documentos por aceitar — ver
   `passarOGateLegal` em test-convocatoria-resposta.mjs. */
const pendentes = ((await call(director, "GET", "/api/legal/status")).body?.pending ?? []).map((d) => d.id);
if (pendentes.length) await call(director, "POST", "/api/legal/accept", { documentIds: pendentes });

const TEAM = "zz_tr_team";
const MATCH = "zz_tr_match";

const limpar = async () => {
  await db.query(`DELETE FROM "Match" WHERE id = $1`, [MATCH]);
  await db.query(`DELETE FROM "TeamStaff" WHERE "teamId" = $1`, [TEAM]);
  await db.query(`DELETE FROM "Team" WHERE id = $1`, [TEAM]);
};

/**
 * Copia uma linha com outro id — as colunas que a tabela tiver, sem as adivinhar.
 *
 * O tipo de cada coluna vem do catálogo: uma lista do Postgres (`text[]`) vai
 * como lista, um `json`/`jsonb` vai como texto JSON. Tratar os dois da mesma
 * maneira partia a cópia de uma forma ou de outra — foi o que aconteceu à
 * primeira: "malformed array literal".
 */
async function copiar(tabela, deId, sobrepor) {
  const { rows } = await db.query(`SELECT * FROM "${tabela}" WHERE id = $1`, [deId]);
  if (!rows[0]) throw new Error(`${tabela} ${deId} não existe no seed`);
  const tipos = new Map(
    (await db.query(
      `SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`,
      [tabela],
    )).rows.map((r) => [r.column_name, r.data_type]),
  );
  const linha = { ...rows[0], ...sobrepor };
  const cols = Object.keys(linha);
  const valor = (c) => {
    const v = linha[c];
    if (v === null || v === undefined) return null;
    const t = tipos.get(c);
    if (t === "json" || t === "jsonb") return JSON.stringify(v);
    return v;
  };
  await db.query(
    `INSERT INTO "${tabela}" (${cols.map((c) => `"${c}"`).join(", ")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")})`,
    cols.map(valor),
  );
}

try {
  await limpar();

  const AC = (await db.query(`SELECT id FROM "Academy" WHERE slug = 'life-club'`)).rows[0].id;
  const pessoas = (await db.query(
    `SELECT m.id, u.name FROM "Membership" m JOIN "User" u ON u.id = m."userId"
      WHERE m."academyId" = $1 AND m.role NOT IN ('GUARDIAN','ATHLETE') AND m."isActive"
      ORDER BY m.id LIMIT 3`, [AC],
  )).rows;
  check("há três pessoas de staff activas no seed", pessoas.length === 3, JSON.stringify(pessoas));
  const [medica, gr, principal] = pessoas;

  await copiar("Team", "t_sub11", { id: TEAM, name: "ZZ Equipa do Treinador", updatedAt: new Date() });
  const quando = new Date(Date.now() + 10 * 86_400_000);
  await copiar("Match", "mt_proximo", {
    id: MATCH, teamId: TEAM, coachId: null, startsAt: quando, endsAt: new Date(quando.getTime() + 2 * 3600_000),
    callUpsClosedAt: null, sourceProvider: null, sourceUrl: null, importedAt: null, updatedAt: new Date(),
  });

  const staff = (id, title) =>
    db.query(`INSERT INTO "TeamStaff" (id, "teamId", "membershipId", title) VALUES ($1, $2, $3, $4)`,
      [`zz_tr_${id}`, TEAM, id, title]);

  const daEquipa = async () =>
    ((await call(director, "GET", "/api/teams")).body ?? []).find((t) => t.id === TEAM);

  /* ------------------------------------------------ quem não treina --- */
  console.log("=== Uma equipa só com uma médica ===");
  await staff(medica.id, "Médica");
  const soMedica = await daEquipa();
  check("a equipa aparece em /api/teams", Boolean(soMedica), "não veio");
  check("e não tem treinador — a médica não treina", soMedica?.headCoach === null, JSON.stringify(soMedica?.headCoach));

  /* ----------------------------- o GR gravado antes do principal ------ */
  console.log("\n=== Treinador de GR gravado antes do principal ===");
  await staff(gr.id, "Treinador de GR");
  await staff(principal.id, "Treinador principal");
  const tres = await daEquipa();
  check("o treinador é o principal", tres?.headCoach?.name === principal.name, `${tres?.headCoach?.name} (esperava ${principal.name})`);
  check("e a lista continua a trazer os três", tres?.coaches?.length === 3, `${tres?.coaches?.length}`);

  /* --------------------------------------------- a página do jogo ----- */
  console.log("\n=== A página do jogo ===");
  const jogo = (await call(director, "GET", `/api/matches/${MATCH}`)).body;
  check("o treinador do jogo é o principal da equipa", jogo?.coachName === principal.name, `${jogo?.coachName}`);
  check("traz a equipa técnica da equipa", jogo?.teamStaff?.length === 3, JSON.stringify(jogo?.teamStaff));
  check("com o principal primeiro", jogo?.teamStaff?.[0]?.role === "Treinador principal", JSON.stringify(jogo?.teamStaff?.[0]));
  check("e o treinador de GR com a sua função", jogo?.teamStaff?.some((s) => s.name === gr.name && s.role === "Treinador de GR"));
  check("sem equipa escalada para o jogo", Array.isArray(jogo?.staff) && jogo.staff.length === 0, JSON.stringify(jogo?.staff));

  const naLista = ((await call(director, "GET", "/api/matches")).body ?? []).find((m) => m.id === MATCH);
  check("a lista de jogos diz o mesmo treinador", naLista?.coachName === principal.name, `${naLista?.coachName}`);

  /* ----------------------------------- "principal" não promove quem não treina */
  console.log("\n=== \"Delegado principal\" não é treinador ===");
  await db.query(`UPDATE "TeamStaff" SET title = 'Delegado principal' WHERE id = $1`, [`zz_tr_${principal.id}`]);
  const semPrincipal = await daEquipa();
  check("o treinador passa a ser o de GR", semPrincipal?.headCoach?.name === gr.name, `${semPrincipal?.headCoach?.name}`);
} finally {
  console.log("\n=== Limpeza ===");
  await limpar();
  const restos = (await db.query(`SELECT COUNT(*)::int n FROM "Team" WHERE id = $1`, [TEAM])).rows[0].n;
  check("tudo apagado", restos === 0);
  await db.end();
}

console.log(`\n${ok} passaram, ${bad} falharam`);
process.exit(bad === 0 ? 0 : 1);

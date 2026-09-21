#!/usr/bin/env node
/**
 * A periodização: mesociclos e microciclos (semanas) por equipa.
 *
 * O que se prova:
 *  - criar, editar e apagar ciclos, com o âmbito do treinador;
 *  - no mesmo nível e na mesma equipa não há sobreposições (e a mensagem diz
 *    com qual choca); mesociclos e semanas sobrepõem-se à vontade;
 *  - o microciclo é sempre uma semana, de segunda a domingo, e o mesociclo é
 *    feito de semanas inteiras (começa a uma segunda, acaba a um domingo);
 *  - criar um mesociclo cria logo as semanas dele (as de quinta-feira dentro
 *    das datas), só onde ainda não há; alargá-lo cria as que faltam;
 *  - apagar um mesociclo leva as semanas dele que estão vazias, e deixa as
 *    que têm trabalho;
 *  - um micro ou um mesociclo antigos (de antes destas regras) continuam
 *    editáveis, e a semana de um mesociclo antigo é a da quinta-feira;
 *  - apagar um ciclo não toca em treinos (não há ligação por chave).
 *
 * Uma equipa própria, criada e apagada aqui (os ciclos vão com ela).
 *
 * Uso: API=http://localhost:3001 node scripts/test-periodizacao.mjs
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
const API = process.env.API ?? "http://localhost:3001";
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
const TEAM = `zz_team_period_${stamp}`;
const SESSAO = `zz_sess_period_${stamp}`;
const micros = (cs) => cs.filter((c) => c.level === "MICRO").map((c) => `${c.startsOn}..${c.endsOn}`);
const todos = async (token) => (await req(token, "GET", `/api/training/cycles?teamId=${TEAM}`)).body ?? [];

try {
  console.log("=== Preparar ===");
  const season = (await db.query(`SELECT id FROM "Season" WHERE "academyId" = $1 ORDER BY "startsOn" DESC LIMIT 1`, [ACADEMY])).rows[0].id;
  const sport = (await db.query(`SELECT "sportId" FROM "Team" WHERE "academyId" = $1 LIMIT 1`, [ACADEMY])).rows[0].sportId;
  await db.query(
    `INSERT INTO "Team" (id, "academyId", "sportId", "seasonId", name, "maxAge", "updatedAt") VALUES ($1, $2, $3, $4, $5, 15, now())`,
    [TEAM, ACADEMY, sport, season, `ZZ Periodização ${stamp}`],
  );
  await db.query(
    `INSERT INTO "TrainingSession" (id, "academyId", "teamId", "startsAt", "endsAt", venue, "updatedAt")
     VALUES ($1, $2, $3, '2026-08-18T17:30:00Z', '2026-08-18T19:00:00Z', 'Campo 1', now())`,
    [SESSAO, ACADEMY, TEAM],
  );
  const director = await login("direcao@lifeclub.pt");
  const coach = await login("treinador@lifeclub.pt");
  check("sessões de staff", Boolean(director && coach));

  console.log("\n=== Ler ===");
  const lista0 = await req(director, "GET", `/api/training/cycles?teamId=${TEAM}`);
  check("a direção lê a periodização de qualquer equipa", lista0.status === 200 && Array.isArray(lista0.body), `${lista0.status}`);
  const doOutro = await req(coach, "GET", `/api/training/cycles?teamId=${TEAM}`);
  check("um treinador não lê a de uma equipa que não é dele", doOutro.status === 403, `${doOutro.status}`);
  const semEquipa = await req(coach, "GET", "/api/training/cycles");
  check("e sem equipa pedida só recebe as dele", semEquipa.status === 200 && !(semEquipa.body ?? []).some((c) => c.teamId === TEAM),
    JSON.stringify((semEquipa.body ?? []).map((c) => c.teamId).slice(0, 4)));

  console.log("\n=== O microciclo é uma semana ===");
  check("começar a uma terça é recusado", (await req(director, "POST", "/api/training/cycles", {
    teamId: TEAM, level: "MICRO", startsOn: "2026-08-11", endsOn: "2026-08-17",
  })).status === 400);
  check("oito dias também", (await req(director, "POST", "/api/training/cycles", {
    teamId: TEAM, level: "MICRO", startsOn: "2026-08-10", endsOn: "2026-08-17",
  })).status === 400);
  const semana = await req(director, "POST", "/api/training/cycles", {
    teamId: TEAM, level: "MICRO", startsOn: "2026-08-10", endsOn: "2026-08-16", objective: "Escrito à mão",
  });
  check("segunda a domingo passa", semana.status === 201, JSON.stringify(semana.body).slice(0, 120));

  console.log("\n=== O mesociclo traz as semanas ===");
  const meso = await req(director, "POST", "/api/training/cycles", {
    teamId: TEAM, level: "MESO", startsOn: "2026-08-03", endsOn: "2026-08-30",
    name: "Pré-época", color: "#2bc48f", focus: ["Físico", "Bolas paradas ofensivas"], objective: "Base aeróbia",
  });
  check("a direção cria um mesociclo", meso.status === 201, JSON.stringify(meso.body).slice(0, 160));
  check("com as datas em texto, e o foco escrito à mão", meso.body?.startsOn === "2026-08-03" && meso.body?.focus?.includes("Bolas paradas ofensivas"));
  let lista = await todos(director);
  check("nasceu com as quatro semanas dele", JSON.stringify(micros(lista)) ===
    JSON.stringify(["2026-08-03..2026-08-09", "2026-08-10..2026-08-16", "2026-08-17..2026-08-23", "2026-08-24..2026-08-30"]),
    JSON.stringify(micros(lista)));
  check("a semana escrita à mão ficou como estava", lista.find((c) => c.startsOn === "2026-08-10")?.objective === "Escrito à mão");

  const choque = await req(director, "POST", "/api/training/cycles", {
    teamId: TEAM, level: "MESO", startsOn: "2026-08-24", endsOn: "2026-10-18", name: "Desenvolvimento",
  });
  check("dois mesociclos não se sobrepõem", choque.status === 409, `${choque.status}`);
  check("e a mensagem diz com qual choca", /Pré-época/.test(choque.body?.message ?? ""), choque.body?.message);
  const meso2 = await req(director, "POST", "/api/training/cycles", {
    teamId: TEAM, level: "MESO", startsOn: "2026-08-31", endsOn: "2026-09-27", name: "Desenvolvimento", color: "#123abc",
  });
  check("o seguinte encosta ao anterior, com uma cor livre", meso2.status === 201 && meso2.body?.color === "#123abc", JSON.stringify(meso2.body).slice(0, 120));
  lista = await todos(director);
  check("e trouxe as suas quatro semanas", micros(lista).filter((m) => m >= "2026-08-31").length === 4, JSON.stringify(micros(lista)));

  const alarga = await req(director, "PUT", `/api/training/cycles/${meso2.body.id}`, { endsOn: "2026-10-11" });
  lista = await todos(director);
  check("alargar o mesociclo cria as semanas que passam a faltar", alarga.status === 200 && micros(lista).filter((m) => m >= "2026-08-31").length === 6,
    JSON.stringify(micros(lista).filter((m) => m >= "2026-08-31")));

  check("um mesociclo que começa a uma quarta é recusado", (await req(director, "POST", "/api/training/cycles", {
    teamId: TEAM, level: "MESO", startsOn: "2026-11-04", endsOn: "2026-11-15", name: "Começa à quarta",
  })).status === 400);
  const aMeio = await req(director, "POST", "/api/training/cycles", {
    teamId: TEAM, level: "MESO", startsOn: "2026-11-02", endsOn: "2026-11-11", name: "Acaba à quarta",
  });
  check("e um que acaba a meio da semana também", aMeio.status === 400 && /segunda|domingo/.test(aMeio.body?.message ?? ""), aMeio.body?.message);
  check("alargá-lo para acabar a meio da semana também", (await req(director, "PUT", `/api/training/cycles/${meso2.body.id}`, { endsOn: "2026-10-14" })).status === 400);
  const quarta = await req(director, "POST", "/api/training/cycles", {
    teamId: TEAM, level: "MESO", startsOn: "2026-11-02", endsOn: "2026-11-15", name: "Duas semanas",
  });
  lista = await todos(director);
  check("semanas inteiras passam, e trazem as suas",
    quarta.status === 201 && JSON.stringify(micros(lista).filter((m) => m >= "2026-11")) === JSON.stringify(["2026-11-02..2026-11-08", "2026-11-09..2026-11-15"]),
    JSON.stringify(micros(lista).filter((m) => m >= "2026-11")));

  // Um mesociclo antigo, de quarta a quarta: aceita um nome novo sem lhe mexer nas datas.
  await db.query(
    `INSERT INTO "TrainingCycle" (id, "academyId", "teamId", level, "startsOn", "endsOn", name, "updatedAt")
     VALUES ($1, $2, $3, 'MESO', '2027-01-06', '2027-01-20', 'Antigo', now())`,
    [`zz_meso_antigo_${stamp}`, ACADEMY, TEAM],
  );
  const antigoMeso = await req(director, "PUT", `/api/training/cycles/zz_meso_antigo_${stamp}`, { name: "Antigo, renomeado" });
  check("um mesociclo antigo continua a aceitar um nome", antigoMeso.status === 200 && antigoMeso.body?.name === "Antigo, renomeado", `${antigoMeso.status}`);

  check("datas ao contrário dão 400", (await req(director, "POST", "/api/training/cycles", {
    teamId: TEAM, level: "MESO", startsOn: "2026-10-20", endsOn: "2026-10-16",
  })).status === 400);
  check("uma data que não existe dá 400", (await req(director, "POST", "/api/training/cycles", {
    teamId: TEAM, level: "MESO", startsOn: "2026-02-30", endsOn: "2026-03-10",
  })).status === 400);
  check("uma cor que não é cor dá 400", (await req(director, "POST", "/api/training/cycles", {
    teamId: TEAM, level: "MESO", startsOn: "2027-02-01", endsOn: "2027-02-07", color: "vermelho",
  })).status === 400);

  console.log("\n=== Âmbito ===");
  const doTreinador = await req(coach, "POST", "/api/training/cycles", {
    teamId: TEAM, level: "MICRO", startsOn: "2027-03-01", endsOn: "2027-03-07",
  });
  check("o treinador não planeia uma equipa que não é dele", doTreinador.status === 403, `${doTreinador.status}`);
  check("nem apaga", (await req(coach, "DELETE", `/api/training/cycles/${meso.body.id}`)).status === 403);

  console.log("\n=== Gerar à parte ===");
  const outraVez = await req(director, "POST", "/api/training/cycles/gerar", { teamId: TEAM, from: "2026-08-03", to: "2026-08-30" });
  check("encher um mesociclo já cheio não cria nada", outraVez.status === 201 && outraVez.body?.created === 0, `${outraVez.status} ${outraVez.body?.created}`);

  let codigo = null;
  try {
    await db.query(
      `INSERT INTO "TrainingCycle" (id, "academyId", "teamId", level, "startsOn", "endsOn", "updatedAt")
       VALUES ($1, $2, $3, 'MICRO', '2026-08-20', '2026-08-25', now())`,
      [`zz_cyc_${stamp}`, ACADEMY, TEAM],
    );
  } catch (e) { codigo = e.code; }
  check("a própria base recusa a sobreposição (dois pedidos ao mesmo tempo)", codigo === "23P01", `${codigo}`);

  console.log("\n=== Editar ===");
  const s17 = lista.find((c) => c.level === "MICRO" && c.startsOn === "2026-08-17");
  const editado = await req(director, "PUT", `/api/training/cycles/${s17.id}`, {
    objective: "Transição ofensiva", focus: ["Transições"], notes: "Jogo com o líder",
  });
  check("editar o objetivo do micro", editado.status === 200 && editado.body?.objective === "Transição ofensiva", JSON.stringify(editado.body).slice(0, 120));
  check("mudar-lhe as datas para não ser semana dá 400", (await req(director, "PUT", `/api/training/cycles/${s17.id}`, { endsOn: "2026-08-24" })).status === 400);
  check("null apaga um campo", (await req(director, "PUT", `/api/training/cycles/${s17.id}`, { notes: null })).body?.notes === null);

  // Um micro de antes de serem todos semanas: de uma quarta a um domingo.
  await db.query(
    `INSERT INTO "TrainingCycle" (id, "academyId", "teamId", level, "startsOn", "endsOn", "updatedAt")
     VALUES ($1, $2, $3, 'MICRO', '2026-12-02', '2026-12-06', now())`,
    [`zz_cyc_antigo_${stamp}`, ACADEMY, TEAM],
  );
  const antigo = await req(director, "PUT", `/api/training/cycles/zz_cyc_antigo_${stamp}`, { objective: "Ainda se edita" });
  check("um micro antigo continua a aceitar um objetivo", antigo.status === 200 && antigo.body?.objective === "Ainda se edita", `${antigo.status}`);

  console.log("\n=== Apagar ===");
  const apagado = await req(director, "DELETE", `/api/training/cycles/${s17.id}`);
  check("apagar um micro", apagado.status === 200, `${apagado.status}`);
  const treino = (await db.query(`SELECT id FROM "TrainingSession" WHERE id = $1`, [SESSAO])).rows.length;
  check("o treino dessa semana continua lá", treino === 1);
  const buraco = await req(director, "POST", "/api/training/cycles/gerar", { teamId: TEAM, from: "2026-08-03", to: "2026-08-30" });
  check("encher outra vez só repõe essa semana", buraco.body?.created === 1, `${buraco.body?.created}`);

  // O mesociclo da quarta: uma das semanas ganha trabalho, a outra fica vazia.
  lista = await todos(director);
  const s1109 = lista.find((c) => c.level === "MICRO" && c.startsOn === "2026-11-09");
  await req(director, "PUT", `/api/training/cycles/${s1109.id}`, { objective: "Esta tem trabalho" });
  const semMeso = await req(director, "DELETE", `/api/training/cycles/${quarta.body.id}`);
  lista = await todos(director);
  check("apagar o mesociclo leva as semanas vazias dele", semMeso.body?.microsRemoved === 1 && !micros(lista).includes("2026-11-02..2026-11-08"),
    `${semMeso.body?.microsRemoved} ${JSON.stringify(micros(lista).filter((m) => m >= "2026-11"))}`);
  check("e deixa a que tem trabalho", micros(lista).includes("2026-11-09..2026-11-15"));
  check("sem tocar nas dos outros mesociclos", micros(lista).filter((m) => m < "2026-11").length === 10, JSON.stringify(micros(lista)));

  console.log("\n=== Ler por intervalo ===");
  const janela = await req(director, "GET", `/api/training/cycles?teamId=${TEAM}&from=2026-08-28&to=2026-09-03`);
  check("o intervalo devolve o que lhe toca", JSON.stringify(micros(janela.body)) === JSON.stringify(["2026-08-24..2026-08-30", "2026-08-31..2026-09-06"]), JSON.stringify(micros(janela.body ?? [])));
  check("e os dois mesociclos", (janela.body ?? []).filter((c) => c.level === "MESO").length === 2);
} finally {
  console.log("\n=== Limpeza ===");
  await db.query(`DELETE FROM "TrainingSession" WHERE id = $1`, [SESSAO]);
  await db.query(`DELETE FROM "Team" WHERE id = $1`, [TEAM]);
  await db.end();
  console.log("  feito");
}

console.log(`\n${ok} passaram, ${bad} falharam`);
process.exit(bad === 0 ? 0 : 1);

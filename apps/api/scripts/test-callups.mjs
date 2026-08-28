#!/usr/bin/env node
/**
 * Convocatórias, contra o servidor a correr.
 *
 * O que interessa provar: quem pode montar, quem não pode ser convocado, e que
 * **guardar não avisa ninguém** — só submeter avisa. Essa última é a que se parte
 * mais facilmente ao refactorizar, e a que estraga a relação do produto com as
 * famílias quando se parte.
 *
 * Uso: node scripts/test-callups.mjs
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
// Permite correr contra uma instância própria — `API_URL=http://localhost:3001` —
// sem disputar a porta 3000 com o servidor de quem está a desenvolver.
const API = process.env.API_URL ?? "http://localhost:3000";

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

const director = await login("direcao@lifeclub.pt");
const coach = await login("treinador@lifeclub.pt");
const adjunto = await login("adjunto@lifeclub.pt");
const parent = await login("familia@lifeclub.pt");

const db = new pg.Client({ connectionString: env("MIGRATE_DATABASE_URL"), ssl: { rejectUnauthorized: false } });
await db.connect();

// Estado limpo: o jogo por montar, e sem avisos antigos a contar para o teste.
await db.query(`UPDATE "Match" SET "callUpsClosedAt" = NULL WHERE id = 'mt_proximo'`);
await db.query(`DELETE FROM "MatchCallUp" WHERE "matchId" = 'mt_proximo'`);
await db.query(`DELETE FROM "Notification" WHERE type = 'MATCH_CALLED_UP'`);

console.log("=== Quem vê que jogos ===");
const dir = await call(director, "GET", "/api/matches");
check("a direção vê jogos", dir.status === 200 && dir.body.length >= 3, `${dir.body?.length}`);

/*
 * O adjunto ve o calendario do clube, e trabalha so no dele.
 *
 * Isto exigia que a lista trouxesse **so** os jogos do t_sub11 — e essa era a
 * regra ate o calendario passar a ser do clube: um treinador tem de saber quando
 * joga o escalao de cima e onde. O que mudou foi o que se ve de cada jogo, nao
 * quem trabalha nele. Ver `calendarScopeFilter` e `inTeamScope`.
 */
/*
 * As equipas onde o adjunto **não** está — descobertas, não escritas à mão.
 *
 * Este teste assumia que ele só treinava o Sub-11. Deixou de ser verdade quando a
 * direcção lhe atribuiu mais escalões pela aplicação, e as verificações de
 * fronteira passaram a medir uma equipa que é dele — dando-a por partida. Uma
 * fronteira só se prova com um lado de fora; sem ele, diz-se que não há.
 */
const dele = new Set(
  (await db.query(`
    SELECT ts."teamId" FROM "TeamStaff" ts
      JOIN "Membership" m ON m.id = ts."membershipId"
      JOIN "User" u ON u.id = m."userId"
     WHERE u.email = 'adjunto@lifeclub.pt'
  `)).rows.map((r) => r.teamId),
);

const adj = await call(adjunto, "GET", "/api/matches");
check("o adjunto ve o calendario do clube", adj.body.some((m) => m.teamId !== "t_sub11"), `${adj.body.length} jogos`);
check("com os dele marcados como dele", adj.body.filter((m) => m.teamId === "t_sub11").every((m) => m.mine === true), "mine");
const naoDele = adj.body.filter((m) => !dele.has(m.teamId));
if (naoDele.length > 0) {
  check("e os das outras equipas marcados como alheios", naoDele.every((m) => m.mine === false), "mine");
} else {
  console.log("  (o adjunto está em todas as equipas com jogos — salto a marca de alheio)");
}
/*
 * A parte que interessa a serio: o que atravessa e o que nao atravessa.
 *
 * Um jogo de outro escalao chega com adversario, data e resultado — e sem uma
 * unica linha de convocatoria ou de ficha, que levam nomes de atletas.
 */
/*
 * `dele` e não `t_sub11`: são as equipas que o adjunto tem hoje, e não as que
 * tinha quando isto foi escrito. E com uma guarda — três `every()` sobre uma
 * lista vazia passam todos, e este bloco é sobre privacidade: passar por vazio
 * era dar por provado que nada vaza, sem ter olhado para nada.
 */
const alheios = adj.body.filter((m) => !dele.has(m.teamId));
if (alheios.length > 0) {
  check("sem convocatoria nos jogos alheios", alheios.every((m) => m.calledUp.length === 0), "calledUp");
  check("e sem ficha tecnica", alheios.every((m) => m.appearances.length === 0), "appearances");
  check("mas com adversario e equipa", alheios.every((m) => m.opponent && m.teamName), "opponent/teamName");
} else {
  console.log("  (o adjunto está em todas as equipas com jogos — salto o que não é dele)");
}
/*
 * Um encarregado vê os jogos das equipas dos filhos — é deles que a app da
 * família precisa para dizer "o teu filho foi convocado para sábado".
 *
 * O âmbito dele tem duas metades: as equipas dos filhos (que abrem os jogos e os
 * treinos) e os próprios filhos (que fecham tudo o que é pessoal). Aqui verifica-se
 * a primeira, e que a segunda não deixa passar jogos de equipas alheias.
 */
const doPai = await call(parent, "GET", "/api/matches");
const teamsDoPai = new Set((doPai.body ?? []).map((m) => m.teamId));
check("um encarregado vê os jogos das equipas dos filhos", (doPai.body ?? []).length > 0, `${doPai.status} com ${doPai.body?.length} jogos`);
check("e nenhum de uma equipa que não seja dos filhos", [...teamsDoPai].every((t) => t === "t_sub11" || t === "t_sub13"), JSON.stringify([...teamsDoPai]));
check("mas não escreve convocatórias (403)", (await call(parent, "POST", "/api/matches/mt_proximo/convocatoria", { athleteIds: [] })).status === 403);

const proximo = dir.body.find((m) => m.id === "mt_proximo");
check("o próximo jogo traz o tecto da equipa", proximo?.maxCallUps === 14, `${proximo?.maxCallUps}`);
check("e ainda não está submetido", proximo?.submitted === false);

console.log("\n=== Quem não pode ser convocado ===");
// A Matilde tem baixa aberta; o Afonso está em pausa.
const comLesionada = await call(coach, "POST", "/api/matches/mt_proximo/convocatoria", {
  athleteIds: ["ath_martim", "ath_matilde"],
});
check("um atleta de baixa é recusado, com o nome", comLesionada.status === 400 && /Matilde/.test(comLesionada.body?.message ?? ""), comLesionada.body?.message);

const deOutraEquipa = await call(coach, "POST", "/api/matches/mt_proximo/convocatoria", { athleteIds: ["ath_rodrigo"] });
check("um atleta de outra equipa é recusado", deOutraEquipa.status === 400, `${deOutraEquipa.status}`);

console.log("\n=== O tecto de convocados ===");
await call(director, "PATCH", "/api/matches/equipas/t_sub11/max-convocados", { max: 3 });
const acima = await call(coach, "POST", "/api/matches/mt_proximo/convocatoria", {
  athleteIds: ["ath_martim", "ath_gustavo", "ath_dinis", "ath_tomas"],
});
check("não se convoca acima do tecto", acima.status === 400 && /3/.test(acima.body?.message ?? ""), acima.body?.message);
// O treinador é quem monta a convocatória — muda o tecto da SUA equipa (é ele que
// melhor sabe quantos precisa), mas o âmbito impede-o de mexer noutras.
const coachMax = await call(coach, "PATCH", "/api/matches/equipas/t_sub11/max-convocados", { max: 16 });
check("o treinador muda o tecto da sua equipa (200)", coachMax.status === 200 && coachMax.body?.maxCallUps === 16, `${coachMax.status}`);
const coachMaxAlheia = await call(coach, "PATCH", "/api/matches/equipas/t_nao_existe/max-convocados", { max: 20 });
check("mas não o de uma equipa que não é dele (403)", coachMaxAlheia.status === 403, `${coachMaxAlheia.status}`);
await call(director, "PATCH", "/api/matches/equipas/t_sub11/max-convocados", { max: 14 });

console.log("\n=== Guardar não avisa ninguém ===");
const guardou = await call(coach, "POST", "/api/matches/mt_proximo/convocatoria", {
  athleteIds: ["ath_martim", "ath_gustavo", "ath_dinis"],
});
check("guarda a convocatória", guardou.status < 300, JSON.stringify(guardou.body).slice(0, 90));

const avisosAposGuardar = (await db.query(`SELECT count(*)::int n FROM "Notification" WHERE type='MATCH_CALLED_UP'`)).rows[0].n;
check("e não manda aviso nenhum", avisosAposGuardar === 0, `${avisosAposGuardar} avisos`);

console.log("\n=== Submeter avisa as famílias ===");
const submeteu = await call(coach, "POST", "/api/matches/mt_proximo/convocatoria/submeter");
check("submete", submeteu.status < 300, JSON.stringify(submeteu.body).slice(0, 90));
check("e conta os convocados", submeteu.body?.convocados === 3, `${submeteu.body?.convocados}`);

const avisos = (await db.query(`
  SELECT n.title, n.body, u.email
  FROM "Notification" n JOIN "User" u ON u.id = n."userId"
  WHERE n.type = 'MATCH_CALLED_UP'
`)).rows;

// Martim é da Sandra; Gustavo é do Nuno; Dinis não tem encarregado ligado.
check("avisa só as famílias dos convocados", avisos.length === 2, `${avisos.length} avisos`);
check("com o nome do atleta no título", avisos.some((a) => /Martim/.test(a.title)) && avisos.some((a) => /Gustavo/.test(a.title)));
check("e adversário, hora e sítio no corpo", avisos.every((a) => /Fão/.test(a.body)), avisos[0]?.body);
check("ninguém do staff é avisado", !avisos.some((a) => /clinico|treinador|direcao|secretaria/.test(a.email)));

console.log("\n=== Depois de submetida ===");
const depois = await call(coach, "POST", "/api/matches/mt_proximo/convocatoria", { athleteIds: ["ath_martim"] });
check("não se altera sem reabrir", depois.status === 400 && /eabr/.test(depois.body?.message ?? ""), depois.body?.message);
check("reabrir funciona", (await call(coach, "POST", "/api/matches/mt_proximo/convocatoria/reabrir")).status < 300);
check("e depois já se altera", (await call(coach, "POST", "/api/matches/mt_proximo/convocatoria", { athleteIds: ["ath_martim"] })).status < 300);

console.log("\n=== Um jogo já disputado ===");
const jogado = await call(coach, "POST", "/api/matches/mt_passado/convocatoria", { athleteIds: ["ath_martim"] });
check("não se reescreve a convocatória de um jogo jogado", jogado.status === 400, `${jogado.status}`);

console.log("\n=== Âmbito na escrita ===");
// Um jogo de uma equipa que não é dele — se existir algum.
const jogoAlheio = (await db.query(`
  SELECT m.id FROM "Match" m JOIN "Academy" a ON a.id = m."academyId"
   WHERE a.slug = 'life-club' AND m."teamId" <> ALL($1::text[]) LIMIT 1
`, [[...dele]])).rows[0]?.id ?? null;

if (jogoAlheio) {
  const fora = await call(adjunto, "POST", `/api/matches/${jogoAlheio}/convocatoria`, { athleteIds: ["ath_leonor"] });
  check("o adjunto não mexe no jogo de outra equipa", fora.status === 404, `${fora.status}`);
} else {
  console.log("  (o adjunto está em todas as equipas com jogos — salto a fronteira de escrita)");
}

console.log("\n=== Limpeza ===");
await db.query(`UPDATE "Match" SET "callUpsClosedAt" = NULL WHERE id = 'mt_proximo'`);
await db.query(`DELETE FROM "MatchCallUp" WHERE "matchId" = 'mt_proximo'`);
await db.query(`DELETE FROM "Notification" WHERE type = 'MATCH_CALLED_UP'`);
await db.end();
console.log("  feito");

console.log(`\n${ok} passaram, ${bad} falharam`);
process.exit(bad === 0 ? 0 : 1);

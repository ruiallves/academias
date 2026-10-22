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

/*
 * Os avisos contam-se e apagam-se **só no Life Club**.
 *
 * Isto apagava os avisos de convocatória de todas as academias da base, e a
 * base é a de produção: cada corrida tirava às famílias dos clubes reais o
 * registo das convocatórias que receberam. As contagens eram também globais, e
 * uma convocatória submetida noutro clube durante o teste fazia-o falhar.
 */
const LIFE = (await db.query(`SELECT id FROM "Academy" WHERE slug = 'life-club'`)).rows[0]?.id;
if (!LIFE) throw new Error("Não encontrei o Life Club.");
const avisosDoTeste = async () =>
  (await db.query(`SELECT count(*)::int n FROM "Notification" WHERE type = 'MATCH_CALLED_UP' AND "academyId" = $1`, [LIFE])).rows[0].n;
const apagarAvisosDoTeste = () =>
  db.query(`DELETE FROM "Notification" WHERE type = 'MATCH_CALLED_UP' AND "academyId" = $1`, [LIFE]);

/*
 * O `mt_proximo` tem de estar no futuro.
 *
 * O seed marcou-o para uma data fixa, que já passou, e submeter um jogo
 * começado passou a ser recusado (é o que se prova em "Um jogo começado"). Empurra-se
 * para daqui a uma semana e repõe-se no fim, como em `test-convocatoria-resposta`.
 */
const original = (await db.query(`SELECT "startsAt", "endsAt" FROM "Match" WHERE id = 'mt_proximo'`)).rows[0];
const futuro = new Date(Date.now() + 7 * 86_400_000);
futuro.setHours(10, 30, 0, 0);
await db.query(`UPDATE "Match" SET "startsAt" = $1, "endsAt" = $2 WHERE id = 'mt_proximo'`, [
  futuro,
  new Date(futuro.getTime() + 2 * 3600_000),
]);

// Estado limpo: o jogo por montar, e sem avisos antigos a contar para o teste.
await db.query(`UPDATE "Match" SET "callUpsClosedAt" = NULL WHERE id = 'mt_proximo'`);
await db.query(`DELETE FROM "MatchCallUp" WHERE "matchId" = 'mt_proximo'`);
await apagarAvisosDoTeste();

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

const avisosAposGuardar = await avisosDoTeste();
check("e não manda aviso nenhum", avisosAposGuardar === 0, `${avisosAposGuardar} avisos`);

console.log("\n=== Submeter avisa as famílias ===");
const submeteu = await call(coach, "POST", "/api/matches/mt_proximo/convocatoria/submeter");
check("submete", submeteu.status < 300, JSON.stringify(submeteu.body).slice(0, 90));
check("e conta os convocados", submeteu.body?.convocados === 3, `${submeteu.body?.convocados}`);

const avisos = (await db.query(`
  SELECT n.title, n.body, u.email
  FROM "Notification" n JOIN "User" u ON u.id = n."userId"
  WHERE n.type = 'MATCH_CALLED_UP' AND n."academyId" = $1
`, [LIFE])).rows;

// Martim é da Sandra; Gustavo é do Nuno; Dinis não tem encarregado ligado.
check("avisa só as famílias dos convocados", avisos.length === 2, `${avisos.length} avisos`);
check("com o nome do atleta no título", avisos.some((a) => /Martim/.test(a.title)) && avisos.some((a) => /Gustavo/.test(a.title)));
check("e adversário, hora e sítio no corpo", avisos.every((a) => /Fão/.test(a.body)), avisos[0]?.body);
check("ninguém do staff é avisado", !avisos.some((a) => /clinico|treinador|direcao|secretaria/.test(a.email)));

console.log("\n=== Depois de submetida ===");
/*
 * Abrir a página não pode dar erro.
 *
 * A consola pede os convidados de outros escalões assim que a convocatória
 * abre — e abre sozinha no próximo jogo. Esse pedido é uma leitura, e recusá-lo
 * com "já foi submetida" punha o aviso de erro no ecrã de quem só entrou na
 * página. O guarda é para quem escreve, e continua lá (a prova a seguir).
 */
// Fechada na base, e não só pelo passo anterior: esta prova não pode depender
// de a submissão acima ter corrido bem para medir o que diz medir.
await db.query(`UPDATE "Match" SET "callUpsClosedAt" = COALESCE("callUpsClosedAt", now()) WHERE id = 'mt_proximo'`);
const convidadosDepois = await call(coach, "GET", "/api/matches/mt_proximo/convidados-elegiveis");
check("os convidados continuam a ler-se", convidadosDepois.status === 200 && Array.isArray(convidadosDepois.body),
  `${convidadosDepois.status} ${JSON.stringify(convidadosDepois.body).slice(0, 90)}`);

const depois = await call(coach, "POST", "/api/matches/mt_proximo/convocatoria", { athleteIds: ["ath_martim"] });
check("não se altera sem reabrir", depois.status === 400 && /eabr/.test(depois.body?.message ?? ""), depois.body?.message);
check("reabrir funciona", (await call(coach, "POST", "/api/matches/mt_proximo/convocatoria/reabrir")).status < 300);
check("e depois já se altera", (await call(coach, "POST", "/api/matches/mt_proximo/convocatoria", { athleteIds: ["ath_martim"] })).status < 300);

console.log("\n=== Um jogo já disputado ===");
const jogado = await call(coach, "POST", "/api/matches/mt_passado/convocatoria", { athleteIds: ["ath_martim"] });
check("não se reescreve a convocatória de um jogo jogado", jogado.status === 400, `${jogado.status}`);

console.log("\n=== Um jogo começado ===");
/*
 * O mesmo jogo, agora com o apito dado há duas horas e a convocatória por
 * enviar: é o caso das vistas "Em atraso" da consola.
 */
await db.query(`UPDATE "Match" SET "startsAt" = now() - interval '2 hours', "callUpsClosedAt" = NULL WHERE id = 'mt_proximo'`);
await apagarAvisosDoTeste();
const tarde = await call(coach, "POST", "/api/matches/mt_proximo/convocatoria/submeter");
check("submeter um jogo começado é recusado (400)", tarde.status === 400, `${tarde.status} ${tarde.body?.message}`);
const avisosTarde = await avisosDoTeste();
check("e não avisa ninguém", avisosTarde === 0, `${avisosTarde} avisos`);

/*
 * Registar o jogo passado: não avisa, e corrigi-lo depois não apaga as
 * respostas de quem continua na lista.
 */
await db.query(`DELETE FROM "MatchCallUp" WHERE "matchId" = 'mt_proximo'`);
/*
 * Um terceiro atleta do Sub-11, lido da base e não escrito à mão: o plantel do
 * Life Club muda (o `ath_gustavo` do seed já não existe), e esta parte prova o
 * registo, não a composição da equipa.
 */
const terceiro = (await db.query(`
  SELECT tm."athleteId" FROM "TeamMembership" tm JOIN "Athlete" a ON a.id = tm."athleteId"
   WHERE tm."teamId" = 't_sub11' AND tm."leftAt" IS NULL AND a.status <> 'LEFT'
     AND tm."athleteId" NOT IN ('ath_martim', 'ath_dinis')
   ORDER BY tm."athleteId" LIMIT 1
`)).rows[0]?.athleteId;
check("há um terceiro atleta no Sub-11 para o teste", Boolean(terceiro));
const registou = await call(coach, "POST", "/api/matches/mt_proximo/plantel", { athleteIds: ["ath_martim", terceiro] });
check("regista a convocatória do jogo passado", registou.status < 300, `${registou.status} ${JSON.stringify(registou.body).slice(0, 90)}`);
const fechado = (await db.query(`SELECT "callUpsClosedAt" FROM "Match" WHERE id = 'mt_proximo'`)).rows[0].callUpsClosedAt;
check("e fica fechada", fechado !== null);
const avisosRegisto = await avisosDoTeste();
check("sem aviso nenhum", avisosRegisto === 0, `${avisosRegisto} avisos`);

await db.query(
  `UPDATE "MatchCallUp" SET status = 'DECLINED', "declineReason" = 'Teste de escola', "respondedAt" = now()
    WHERE "matchId" = 'mt_proximo' AND "athleteId" = 'ath_martim'`,
);
const corrigiu = await call(coach, "POST", "/api/matches/mt_proximo/plantel", { athleteIds: ["ath_martim", "ath_dinis"] });
check("corrige a convocatória do jogo passado", corrigiu.status < 300, `${corrigiu.status}`);
const linhas = (await db.query(
  `SELECT "athleteId", status, "declineReason" FROM "MatchCallUp" WHERE "matchId" = 'mt_proximo' ORDER BY "athleteId"`,
)).rows;
const martim = linhas.find((l) => l.athleteId === "ath_martim");
check("quem fica mantém a resposta e o motivo", martim?.status === "DECLINED" && martim?.declineReason === "Teste de escola", JSON.stringify(martim));
check("quem sai, sai", !linhas.some((l) => l.athleteId === terceiro), JSON.stringify(linhas));
check("quem entra, entra", linhas.some((l) => l.athleteId === "ath_dinis" && l.status === "CALLED"), JSON.stringify(linhas));

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
await db.query(`UPDATE "Match" SET "callUpsClosedAt" = NULL, "startsAt" = $1, "endsAt" = $2 WHERE id = 'mt_proximo'`, [
  original.startsAt,
  original.endsAt,
]);
await db.query(`DELETE FROM "MatchCallUp" WHERE "matchId" = 'mt_proximo'`);
await apagarAvisosDoTeste();
await db.end();
console.log("  feito");

console.log(`\n${ok} passaram, ${bad} falharam`);
process.exit(bad === 0 ? 0 : 1);

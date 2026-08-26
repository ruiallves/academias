#!/usr/bin/env node
/**
 * A página do jogo: detalhe, resultado, ficha e equipa de trabalho.
 *
 * O que interessa:
 *
 *  - o **âmbito**: um treinador chega aos jogos das equipas dele e a mais nenhum,
 *    mesmo com o id certo na mão;
 *  - a **permissão**: ver o jogo e preencher a ficha são coisas diferentes;
 *  - a ficha só aceita **quem foi convocado**;
 *  - os limites são apertados no servidor, e não só no formulário;
 *  - `statsEnteredAt` fica marcado — é o que protege este trabalho do importador
 *    do ZeroZero que há-de vir.
 *
 * Uso: node scripts/test-match-sheet.mjs
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

const limpar = async () => {
  await db.query(`DELETE FROM "Match" WHERE opponent LIKE 'ZZ %'`);
  await db.query(`DELETE FROM "Team" WHERE id LIKE 'zz_t_%'`);
  await db.query(`DELETE FROM "Athlete" WHERE id LIKE 'zz_a_%'`);
};
await limpar();

const presidente = await login("presidente@lifeclub.pt");
const coach = await login("treinador@lifeclub.pt");
const parent = await login("familia@lifeclub.pt");

/* -------------------------------------------------------------------------- */

console.log("=== Preparar um jogo com convocatória ===");
const academyId = (await db.query(`SELECT id FROM "Academy" WHERE slug = 'life-club'`)).rows[0].id;

// A equipa do treinador da demonstração, para o teste de âmbito significar algo.
const doCoach = (await db.query(
  `SELECT DISTINCT ts."teamId" FROM "TeamStaff" ts
   JOIN "Membership" m ON m.id = ts."membershipId"
   JOIN "User" u ON u.id = m."userId"
   WHERE u.email = 'treinador@lifeclub.pt' LIMIT 1`,
)).rows[0]?.teamId;
/*
 * Uma equipa mesmo **fora do âmbito**, e não só diferente daquela.
 *
 * O treinador da demonstração tem duas equipas. Escolher "uma qualquer que não
 * seja esta" apanhava a outra equipa dele — e o teste do âmbito passava a medir
 * que ele conseguia ver o que devia mesmo conseguir ver, o que é não medir nada.
 */
const dele = (await db.query(
  `SELECT DISTINCT ts."teamId" FROM "TeamStaff" ts
   JOIN "Membership" m ON m.id = ts."membershipId"
   JOIN "User" u ON u.id = m."userId"
   WHERE u.email = 'treinador@lifeclub.pt'`,
)).rows.map((r) => r.teamId);
/*
 * Se não houver nenhuma, cria-se.
 *
 * A academia de demonstração tem duas equipas e o treinador é de ambas — não há
 * lá nada fora do âmbito dele, e sem isso o teste do âmbito não tem o que medir.
 * A equipa de teste desaparece na limpeza, como tudo o resto.
 */
let outra = (await db.query(
  `SELECT id FROM "Team" WHERE "academyId" = $1 AND id <> ALL($2::text[]) AND id NOT LIKE 'zz_%' LIMIT 1`,
  [academyId, dele],
)).rows[0]?.id;

if (!outra) {
  outra = "zz_t_alheia";
  const modelo = (await db.query(`SELECT "sportId", "seasonId" FROM "Team" WHERE id = $1`, [doCoach])).rows[0];
  await db.query(
    `INSERT INTO "Team" (id, "academyId", "sportId", "seasonId", name, "ageGroup", "updatedAt")
     VALUES ($1, $2, $3, $4, 'ZZ Equipa Alheia', 'Sub-19', NOW())
     ON CONFLICT (id) DO NOTHING`,
    [outra, academyId, modelo.sportId, modelo.seasonId],
  );
}

check("a demonstração tem uma equipa do treinador", Boolean(doCoach), `${doCoach}`);
check("e outra fora do âmbito dele", Boolean(outra), `${outra}`);

const criar = async (teamId, opponent, quando) => {
  const id = `zz_m_${Math.random().toString(36).slice(2, 10)}`;
  await db.query(
    `INSERT INTO "Match" (id, "academyId", "teamId", "startsAt", "endsAt", venue, opponent, "isHome", status, "updatedAt")
     VALUES ($1,$2,$3,$4,$5,'ZZ Campo',$6,true,'SCHEDULED',NOW())`,
    [id, academyId, teamId, quando, new Date(quando.getTime() + 5_400_000), opponent],
  );
  return id;
};

const ontem = new Date(Date.now() - 86_400_000);
const amanha = new Date(Date.now() + 3 * 86_400_000);
const meuJogo = await criar(doCoach, "ZZ Adversário", ontem);
const jogoAlheio = await criar(outra, "ZZ Alheio", ontem);
/* Um jogo por jogar, e um passado sem plantel nenhum. */
const jogoFuturo = await criar(doCoach, "ZZ Futuro", amanha);
const semPlantel = await criar(doCoach, "ZZ Sem Plantel", new Date(Date.now() - 2 * 86_400_000));

// Convocar três atletas da equipa do treinador.
const plantel = (await db.query(
  `SELECT "athleteId" FROM "TeamMembership" WHERE "teamId" = $1 AND "leftAt" IS NULL LIMIT 3`,
  [doCoach],
)).rows.map((r) => r.athleteId);
check("a equipa tem plantel para convocar", plantel.length >= 2, `${plantel.length}`);

for (const a of plantel) {
  await db.query(
    `INSERT INTO "MatchCallUp" (id, "matchId", "athleteId", status, "isGuest")
     VALUES ($1,$2,$3,'CALLED',false)`,
    [`zz_c_${Math.random().toString(36).slice(2, 10)}`, meuJogo, a],
  );
}

/* -------------------------------------------------------------------------- */

console.log("\n=== Ler a página do jogo ===");
const detalhe = await call(coach, "GET", `/api/matches/${meuJogo}`);
check("o treinador abre o jogo da equipa dele", detalhe.status === 200, `${detalhe.status}`);
check("com o plantel convocado", detalhe.body?.squad?.length === plantel.length, `${detalhe.body?.squad?.length}`);
check("ninguém marcado como tendo jogado ainda", detalhe.body?.squad?.every((s) => !s.played), "");
check("e sem staff atribuído", detalhe.body?.staff?.length === 0, "");
check("o jogo diz que foi marcado à mão", detalhe.body?.source === null, JSON.stringify(detalhe.body?.source));

/*
 * O âmbito, que é a razão de este endpoint não ser uma leitura qualquer.
 *
 * Com o id na mão — que é exactamente o que alguém teria ao trocar um número no
 * endereço — um treinador não pode abrir o jogo de outro escalão.
 */
const alheio = await call(coach, "GET", `/api/matches/${jogoAlheio}`);
check("mas não abre o jogo de outra equipa (404)", alheio.status === 404, `${alheio.status}`);

const porPresidente = await call(presidente, "GET", `/api/matches/${jogoAlheio}`);
check("o presidente abre qualquer jogo do clube", porPresidente.status === 200, `${porPresidente.status}`);

const porPai = await call(parent, "GET", `/api/matches/${meuJogo}`);
/*
 * Um encarregado **tem** `calendar:read` e a equipa do filho no âmbito. O que o
 * trava é a regra explícita em `get()`: esta página é de staff, e a app da
 * família tem os endpoints dela, com o âmbito no atleta e não na equipa.
 */
check("um encarregado não abre a ficha de jogo (403)", porPai.status === 403, `${porPai.status}`);

console.log("\n=== Resultado ===");
const res = await call(coach, "POST", `/api/matches/${meuJogo}/resultado`, { ourScore: 3, theirScore: 1 });
check("o treinador regista o resultado", res.status === 201 || res.status === 200, `${res.status}`);
const guardado = (await db.query(`SELECT "ourScore","theirScore",status,"statsEnteredAt" FROM "Match" WHERE id=$1`, [meuJogo])).rows[0];
check("ficou 3–1", guardado.ourScore === 3 && guardado.theirScore === 1, `${guardado.ourScore}-${guardado.theirScore}`);
check("e o jogo passou a PLAYED", guardado.status === "PLAYED", guardado.status);
/*
 * A marca que protege este trabalho do importador que há-de vir.
 *
 * Sem ela, a primeira sincronização com o ZeroZero não teria como distinguir um
 * jogo que ninguém tocou de um que o treinador preencheu ao minuto.
 */
check("e ficou marcado como preenchido à mão", guardado.statsEnteredAt !== null, "");

const limpo = await call(coach, "POST", `/api/matches/${meuJogo}/resultado`, {});
check("limpar o resultado devolve o jogo a agendado", limpo.status < 300, `${limpo.status}`);
const apos = (await db.query(`SELECT "ourScore",status FROM "Match" WHERE id=$1`, [meuJogo])).rows[0];
check("sem resultado e SCHEDULED", apos.ourScore === null && apos.status === "SCHEDULED", `${apos.status}`);

await call(coach, "POST", `/api/matches/${meuJogo}/resultado`, { ourScore: 2, theirScore: 2 });

const disparate = await call(coach, "POST", `/api/matches/${meuJogo}/resultado`, { ourScore: 500, theirScore: 0 });
check("um resultado absurdo é recusado (400)", disparate.status === 400, `${disparate.status}`);

console.log("\n=== Ficha de jogo ===");
const ficha = await call(coach, "POST", `/api/matches/${meuJogo}/ficha`, {
  rows: [
    { athleteId: plantel[0], minutes: 90, started: true, tally: 2, assists: 1, yellowCards: 1, redCard: false },
    { athleteId: plantel[1], minutes: 25, started: false, tally: 0, assists: 0, yellowCards: 0, redCard: true },
  ],
});
check("grava a ficha", ficha.status === 201 || ficha.status === 200, `${ficha.status}`);
check("com duas linhas", ficha.body?.saved === 2, `${ficha.body?.saved}`);

const linhas = (await db.query(
  `SELECT "athleteId", minutes, started, tally, assists, "yellowCards", "redCard"
   FROM "MatchAppearance" WHERE "matchId" = $1 ORDER BY minutes DESC`,
  [meuJogo],
)).rows;
check("o titular ficou com 90 minutos e 2 golos", linhas[0]?.minutes === 90 && linhas[0]?.tally === 2, JSON.stringify(linhas[0]));
check("com um amarelo", linhas[0]?.yellowCards === 1, `${linhas[0]?.yellowCards}`);
check("o suplente entrou aos 25 e foi expulso", linhas[1]?.started === false && linhas[1]?.redCard === true, JSON.stringify(linhas[1]));

/*
 * Quem ficou no banco não tem linha — a ausência é a resposta.
 *
 * Uma linha com zero minutos dizia "jogou zero minutos", que é a mesma coisa no
 * papel e outra coisa em qualquer soma de jogos por atleta.
 */
check("quem não jogou não tem linha nenhuma", linhas.length === 2, `${linhas.length}`);

/*
 * A convocatória é a lista fechada de quem podia lá estar.
 *
 * Sem esta regra, um id no corpo do pedido punha um miúdo de outro escalão — ou
 * de outra academia — na ficha de um jogo em que nunca esteve.
 */
const deFora = (await db.query(
  `SELECT id FROM "Athlete" WHERE "academyId" = $1 AND id <> ALL($2::text[]) LIMIT 1`,
  [academyId, plantel],
)).rows[0]?.id;
const intruso = await call(coach, "POST", `/api/matches/${meuJogo}/ficha`, {
  rows: [
    { athleteId: plantel[0], minutes: 90 },
    { athleteId: deFora, minutes: 90, tally: 5 },
  ],
});
check("um atleta não convocado é ignorado, não gravado", intruso.body?.saved === 1 && intruso.body?.ignored === 1, JSON.stringify(intruso.body));
const semIntruso = (await db.query(`SELECT count(*)::int n FROM "MatchAppearance" WHERE "matchId"=$1 AND "athleteId"=$2`, [meuJogo, deFora])).rows[0].n;
check("e não entrou mesmo na base", semIntruso === 0, `${semIntruso}`);

const tresAmarelos = await call(coach, "POST", `/api/matches/${meuJogo}/ficha`, {
  rows: [{ athleteId: plantel[0], minutes: 90, yellowCards: 3 }],
});
check("três amarelos são recusados — só existem dois (400)", tresAmarelos.status === 400, `${tresAmarelos.status}`);

const semPermissao = await call(parent, "POST", `/api/matches/${meuJogo}/ficha`, {
  rows: [{ athleteId: plantel[0], minutes: 90 }],
});
check("um encarregado não preenche fichas (403)", semPermissao.status === 403, `${semPermissao.status}`);

const fichaAlheia = await call(coach, "POST", `/api/matches/${jogoAlheio}/ficha`, {
  rows: [{ athleteId: plantel[0], minutes: 90 }],
});
check("nem se preenche a ficha de um jogo de outra equipa (404)", fichaAlheia.status === 404, `${fichaAlheia.status}`);

console.log("\n=== O resultado só existe depois do apito ===");
/*
 * Um resultado antes do jogo não é um resultado — é um palpite.
 *
 * Sem esta regra, um dedo trocado na lista gravava "3–1" num jogo de sábado à
 * quarta-feira, o jogo passava a PLAYED, e a convocatória desaparecia do ecrã de
 * quem ainda a ia montar. A interface esconde o formulário; isto verifica que o
 * servidor recusa na mesma, que é onde a regra tem de viver.
 */
const cedoDemais = await call(coach, "POST", `/api/matches/${jogoFuturo}/resultado`, { ourScore: 3, theirScore: 1 });
check("um jogo por jogar recusa resultado (400)", cedoDemais.status === 400, `${cedoDemais.status}`);
const futuroLimpo = (await db.query(`SELECT "ourScore", status FROM "Match" WHERE id = $1`, [jogoFuturo])).rows[0];
check("e continua sem resultado e agendado", futuroLimpo.ourScore === null && futuroLimpo.status === "SCHEDULED", futuroLimpo.status);

/*
 * Limpar continua a poder ser feito a qualquer hora: desfazer um engano não tem
 * horário, e trancá-lo deixava um resultado errado preso para sempre.
 */
const limparFuturo = await call(coach, "POST", `/api/matches/${jogoFuturo}/resultado`, {});
check("mas limpar um jogo futuro passa", limparFuturo.status < 300, `${limparFuturo.status}`);

console.log("\n=== Plantel retroactivo ===");
/*
 * O caso real: o jogo passou e nunca houve convocatória no sistema — o clube
 * geria isso em papel. Sem plantel não há ficha, porque a ficha só aceita
 * convocados. Esta porta existe só na página do jogo.
 */
const elegiveis = await call(coach, "GET", `/api/matches/${semPlantel}/plantel-elegivel`);
check("lê quem podia ter jogado", elegiveis.status === 200 && Array.isArray(elegiveis.body), `${elegiveis.status}`);
check("com nomes do plantel da equipa", (elegiveis.body ?? []).length >= 2, `${elegiveis.body?.length}`);

const doisIds = (elegiveis.body ?? []).slice(0, 2).map((a) => a.athleteId);
const registado = await call(coach, "POST", `/api/matches/${semPlantel}/plantel`, { athleteIds: doisIds });
check("regista o plantel retroactivo", registado.status === 201 || registado.status === 200, `${registado.status}`);
check("com os dois", registado.body?.calledUp === 2, `${registado.body?.calledUp}`);

/*
 * Fechado à nascença: isto é um registo, não um convite por responder. Se
 * ficasse aberto, aparecia no ecrã de Convocatórias como trabalho por fazer —
 * de um jogo que já aconteceu.
 */
const fechado = (await db.query(`SELECT "callUpsClosedAt" FROM "Match" WHERE id = $1`, [semPlantel])).rows[0];
check("e nasce já fechado", fechado.callUpsClosedAt !== null, "");

const agoraComFicha = await call(coach, "POST", `/api/matches/${semPlantel}/ficha`, {
  rows: [{ athleteId: doisIds[0], minutes: 70, started: true, tally: 1 }],
});
check("e a ficha passa a aceitar quem lá está", agoraComFicha.body?.saved === 1, JSON.stringify(agoraComFicha.body));

/*
 * Tirar alguém do plantel apaga a linha da ficha dele.
 *
 * Sem isto, ficava lá uma linha órfã: minutos de um jogo em que a pessoa
 * oficialmente não esteve.
 */
const soUm = await call(coach, "POST", `/api/matches/${semPlantel}/plantel`, { athleteIds: [doisIds[1]] });
check("reduzir o plantel passa", soUm.status < 300, `${soUm.status}`);
const orfa = (await db.query(`SELECT count(*)::int n FROM "MatchAppearance" WHERE "matchId" = $1 AND "athleteId" = $2`, [semPlantel, doisIds[0]])).rows[0].n;
check("e a ficha de quem saiu foi apagada com ele", orfa === 0, `${orfa}`);

console.log("\n  --- E as portas que continuam fechadas ---");
const retroNoFuturo = await call(coach, "POST", `/api/matches/${jogoFuturo}/plantel`, { athleteIds: doisIds });
check("um jogo por jogar não aceita plantel retroactivo (400)", retroNoFuturo.status === 400, `${retroNoFuturo.status}`);

const retroPorPai = await call(parent, "POST", `/api/matches/${semPlantel}/plantel`, { athleteIds: doisIds });
check("um encarregado não regista plantel (403)", retroPorPai.status === 403, `${retroPorPai.status}`);

const retroAlheio = await call(coach, "POST", `/api/matches/${jogoAlheio}/plantel`, { athleteIds: doisIds });
check("nem se regista o plantel de um jogo de outra equipa (404)", retroAlheio.status === 404, `${retroAlheio.status}`);

const retroVazio = await call(coach, "POST", `/api/matches/${semPlantel}/plantel`, { athleteIds: [] });
check("um plantel vazio é recusado (400)", retroVazio.status === 400, `${retroVazio.status}`);

/*
 * A elegibilidade de escalão mantém-se — essa não muda com o calendário. Um
 * atleta de outra equipa não entra num plantel retroactivo só porque o jogo já
 * passou.
 */
/*
 * Um atleta sem equipa nenhuma — o caso mais claro de "não podia lá estar".
 *
 * A primeira versão procurava alguém na equipa alheia, que é criada vazia por
 * este teste: a variável vinha `undefined` e a verificação saltava em silêncio,
 * que é o mesmo que não a ter escrito.
 */
/*
 * Um atleta sem equipa nenhuma — o caso mais claro de "não podia lá estar".
 *
 * Criado aqui porque a academia de demonstração não tem nenhum: toda a gente
 * está num escalão. A primeira versão deste teste procurava alguém na equipa
 * alheia, que este ficheiro cria vazia — a variável vinha `undefined` e a
 * verificação saltava em silêncio, que é o mesmo que não a ter escrito.
 */
await db.query(
  `INSERT INTO "Athlete" (id, "academyId", name, birthdate, status, "updatedAt")
   VALUES ('zz_a_solto', $1, 'ZZ Atleta Sem Equipa', '2012-01-01', 'ACTIVE', NOW())
   ON CONFLICT (id) DO NOTHING`,
  [academyId],
);
const deOutraEquipa = "zz_a_solto";
if (deOutraEquipa) {
  const intruso = await call(coach, "POST", `/api/matches/${semPlantel}/plantel`, {
    athleteIds: [doisIds[1], deOutraEquipa],
  });
  check("um atleta de fora do escalão é recusado (400)", intruso.status === 400, `${intruso.status}`);
}

console.log("\n=== Equipa de trabalho ===");
const pool = await call(coach, "GET", "/api/matches/equipa-tecnica");
/*
 * O treinador lê esta lista, e é de propósito: quem preenche a ficha é quem tem
 * de dizer que houve massagista. Pedia `staff:read` e isso trancava-o fora de
 * uma funcionalidade que é dele. Ver `staffPool`.
 */
check("o treinador lê quem pode entrar na ficha técnica", pool.status === 200 && Array.isArray(pool.body), `${pool.status}`);
const poolPai = await call(parent, "GET", "/api/matches/equipa-tecnica");
check("mas um encarregado não (403)", poolPai.status === 403, `${poolPai.status}`);
/*
 * Nenhuma família na lista. Um encarregado na ficha técnica não é um erro de
 * digitação — é o começo de alguém a aparecer em relatórios de staff sem nunca
 * ter sido staff.
 */
const familias = (await db.query(
  `SELECT m.id FROM "Membership" m WHERE m."academyId" = $1 AND m.role = 'GUARDIAN'`,
  [academyId],
)).rows.map((r) => r.id);
check(
  "e não traz famílias",
  !(pool.body ?? []).some((p) => familias.includes(p.membershipId)),
  "",
);

const alguem = pool.body?.[0];
const staff = await call(coach, "POST", `/api/matches/${meuJogo}/staff`, {
  rows: [{ membershipId: alguem.membershipId, role: "Massagista" }],
});
check("atribui alguém ao jogo", staff.body?.saved === 1, JSON.stringify(staff.body));

const comStaff = await call(coach, "GET", `/api/matches/${meuJogo}`);
check("e aparece na página do jogo", comStaff.body?.staff?.[0]?.role === "Massagista", JSON.stringify(comStaff.body?.staff));

const familiaNaFicha = await call(coach, "POST", `/api/matches/${meuJogo}/staff`, {
  rows: [{ membershipId: familias[0], role: "Massagista" }],
});
check("uma família é ignorada, não gravada", familiaNaFicha.body?.saved === 0 && familiaNaFicha.body?.ignored === 1, JSON.stringify(familiaNaFicha.body));

console.log("\n=== Escalado para um jogo ===");
/*
 * O caso que motivou isto: a médica abriu os Jogos e leu "2 convocatórias por
 * enviar · Convocar" — trabalho que não é dela e que o servidor lhe recusa. O que
 * ela devia ver é onde **é precisa**.
 */
const clinico = await login("clinico@lifeclub.pt");

// O clínico não convoca nem preenche fichas — é a linha que a interface tem de
// respeitar, e que o servidor já respeitava.
const clinicoConvoca = await call(clinico, "POST", `/api/matches/${jogoFuturo}/resultado`, { ourScore: 1, theirScore: 0 });
check("o clínico não regista resultados (403)", clinicoConvoca.status === 403, `${clinicoConvoca.status}`);

const membroClinicoId = (await db.query(
  `SELECT m.id FROM "Membership" m JOIN "User" u ON u.id = m."userId" WHERE u.email = $1`,
  ["clinico@lifeclub.pt"],
)).rows[0].id;

/*
 * Estado limpo antes de medir.
 *
 * O bloco da equipa de trabalho, mais acima, escala a primeira pessoa do pool —
 * que por ordem alfabética é esta. Sem esta limpeza, o teste começava com ela já
 * escalada e media o contrário do que diz medir.
 */
await db.query(`DELETE FROM "MatchStaff" WHERE "membershipId" = $1`, [membroClinicoId]);

// Mas lê a lista de jogos: precisa de saber quando joga o miúdo que recupera.
const listaClinico = await call(clinico, "GET", "/api/matches");
check("mas lê a lista de jogos", listaClinico.status === 200, `${listaClinico.status}`);

/*
 * Antes de ser escalado, `myStaffRole` é nulo em todos.
 *
 * É este campo que faz a lista dela dizer "onde estou escalado" sem lhe mostrar
 * a equipa de trabalho toda de cada jogo.
 */
check(
  "e nenhum jogo aparece como dela",
  (listaClinico.body ?? []).every((m) => m.myStaffRole === null),
  "",
);

const membroClinico = (await db.query(
  `SELECT m.id, m."userId" FROM "Membership" m JOIN "User" u ON u.id = m."userId" WHERE u.email = 'clinico@lifeclub.pt'`,
)).rows[0];

await db.query(`DELETE FROM "Notification" WHERE "userId" = $1 AND type = 'MATCH_STAFF_ASSIGNED'`, [membroClinico.userId]);

const escala = await call(coach, "POST", `/api/matches/${jogoFuturo}/staff`, {
  rows: [{ membershipId: membroClinico.id, role: "Fisioterapeuta" }],
});
check("o treinador escala a clínica para o jogo", escala.body?.saved === 1, JSON.stringify(escala.body));

const aviso = (await db.query(
  `SELECT title, body, payload FROM "Notification" WHERE "userId" = $1 AND type = 'MATCH_STAFF_ASSIGNED'`,
  [membroClinico.userId],
)).rows[0];
check("e ela recebe aviso no site", Boolean(aviso), "");
check("com a função no corpo", aviso?.body?.includes("Fisioterapeuta"), aviso?.body);
/*
 * O destino tem de vir em `payload.link`.
 *
 * É a chave que a consola lê. Havia três nomes no código para a mesma ideia
 * (`link`, `route`, `url`), e o painel não conseguia navegar para lado nenhum —
 * ver `listForUser`.
 */
check("e com o caminho para o jogo", aviso?.payload?.link === `/jogos/${jogoFuturo}`, JSON.stringify(aviso?.payload));

const depois = await call(clinico, "GET", "/api/matches");
const meu = (depois.body ?? []).find((m) => m.id === jogoFuturo);
check("o jogo passa a aparecer como dela", meu?.myStaffRole === "Fisioterapeuta", `${meu?.myStaffRole}`);
check(
  "e é o único onde ela está escalada",
  (depois.body ?? []).filter((m) => m.myStaffRole !== null).length === 1,
  (depois.body ?? []).filter((m) => m.myStaffRole !== null).map((m) => m.opponent).join(","),
);

/*
 * Gravar outra vez sem a mexer não a volta a avisar.
 *
 * A gravação substitui a lista toda, por isso sem a comparação de quem é novo uma
 * mudança de função do delegado voltava a avisar toda a gente. Um aviso repetido
 * ensina a ignorar avisos.
 */
const outraPessoa = (await db.query(
  `SELECT m.id FROM "Membership" m JOIN "User" u ON u.id = m."userId" WHERE u.email = 'secretaria@lifeclub.pt'`,
)).rows[0];
await call(coach, "POST", `/api/matches/${jogoFuturo}/staff`, {
  rows: [
    { membershipId: membroClinico.id, role: "Fisioterapeuta" },
    { membershipId: outraPessoa.id, role: "Delegado ao jogo" },
  ],
});
const quantos = (await db.query(
  `SELECT count(*)::int n FROM "Notification" WHERE "userId" = $1 AND type = 'MATCH_STAFF_ASSIGNED'`,
  [membroClinico.userId],
)).rows[0].n;
check("quem já lá estava não é avisado outra vez", quantos === 1, `${quantos}`);

/*
 * E a notificação chega ao cliente numa forma que ele saiba ler.
 *
 * A coluna chama-se `type` e o cliente espera `kind`; o destino vive no
 * `payload` e o cliente espera `link`. Sem o mapeamento, o painel mostrava as
 * notificações e nenhuma delas era clicável.
 */
const paraOCliente = await call(clinico, "GET", "/api/notifications");
const minha = (paraOCliente.body ?? []).find((n) => n.kind === "MATCH_STAFF_ASSIGNED");
check("a notificação chega com kind e link", minha?.link === `/jogos/${jogoFuturo}`, JSON.stringify(minha));

await db.query(`DELETE FROM "Notification" WHERE "userId" = $1 AND type = 'MATCH_STAFF_ASSIGNED'`, [membroClinico.userId]);

console.log("\n=== Isolamento na base ===");
/*
 * `MatchStaff` não tem `academyId` — chega ao seu por `Match`. Se a política de
 * RLS não o fosse buscar lá, a tabela ficava de fora do isolamento e um clube lia
 * a ficha técnica de outro.
 */
const pol = (await db.query(
  `SELECT count(*)::int n FROM pg_policies WHERE tablename = 'MatchStaff' AND policyname = 'tenant_isolation'`,
)).rows[0].n;
check("MatchStaff tem política de isolamento", pol === 1, `${pol}`);
const rls = (await db.query(
  `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'MatchStaff'`,
)).rows[0];
check("com RLS activo e forçado", rls.relrowsecurity && rls.relforcerowsecurity, JSON.stringify(rls));

console.log("\n=== Limpeza ===");
await limpar();
await db.end();
console.log("  feito");

console.log(`\n${ok} passaram, ${bad} falharam`);
process.exit(bad === 0 ? 0 : 1);

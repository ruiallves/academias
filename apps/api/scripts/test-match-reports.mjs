#!/usr/bin/env node
/**
 * A duração do jogo por equipa, o minuto de entrada opcional, e os relatórios
 * do jogo e do adversário.
 *
 * O que interessa:
 *
 *  - a **duração** é da equipa: cria-se com ela, muda-se na ficha da equipa, e é
 *    ela — não a da modalidade — que fecha os minutos de quem jogou até ao fim;
 *  - um suplente **sem minuto de entrada** grava na mesma, a zero;
 *  - o **relatório do jogo** e o **do adversário** gravam-se inteiros, só depois
 *    do apito, só por quem preenche a ficha, e voltam na página do jogo;
 *  - o **histórico** do adversário aparece nos outros jogos contra o mesmo nome,
 *    e a lista de adversários agrupa-os;
 *  - as famílias e quem está fora do âmbito não chegam a nada disto.
 *
 * Uso: node scripts/test-match-reports.mjs
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
  await db.query(`DELETE FROM "Team" WHERE id LIKE 'zz_t_%' OR name LIKE 'ZZ %'`);
};
await limpar();

const presidente = await login("presidente@lifeclub.pt");
const coach = await login("treinador@lifeclub.pt");
const parent = await login("familia@lifeclub.pt");

const academyId = (await db.query(`SELECT id FROM "Academy" WHERE slug = 'life-club'`)).rows[0].id;

/* -------------------------------------------------------------------------- */

console.log("=== A duração do jogo é da equipa ===");

const modalidade = (await db.query(
  `SELECT id, "matchMinutes" FROM "Sport" WHERE "academyId" = $1 AND "matchMinutes" IS NOT NULL ORDER BY name LIMIT 1`,
  [academyId],
)).rows[0];
check("a demonstração tem uma modalidade com duração por omissão", Boolean(modalidade), "");

const epoca = (await db.query(`SELECT label FROM "Season" WHERE "academyId" = $1 ORDER BY "isCurrent" DESC LIMIT 1`, [academyId])).rows[0]?.label;

// Uma equipa criada **com** duração própria.
const comDuracao = await call(presidente, "POST", "/api/teams", {
  name: "ZZ Sub-11 Sessenta", sportId: modalidade.id, maxAge: 11, season: epoca, schedule: [], matchMinutes: 60,
});
check("cria uma equipa com a duração escrita", comDuracao.status < 300, `${comDuracao.status} ${JSON.stringify(comDuracao.body)}`);
check("e a resposta traz 60", comDuracao.body?.matchMinutes === 60, `${comDuracao.body?.matchMinutes}`);

// E uma **sem**: herda o da modalidade.
const semDuracao = await call(presidente, "POST", "/api/teams", {
  name: "ZZ Sub-19 Herda", sportId: modalidade.id, maxAge: 19, season: epoca, schedule: [],
});
check("cria uma equipa sem dizer a duração", semDuracao.status < 300, `${semDuracao.status}`);
check(
  "e herda a da modalidade",
  semDuracao.body?.matchMinutes === modalidade.matchMinutes,
  `${semDuracao.body?.matchMinutes} vs ${modalidade.matchMinutes}`,
);

const equipas = await call(presidente, "GET", "/api/teams");
const lida = equipas.body?.find?.((t) => t.id === comDuracao.body.id);
check("a lista de equipas traz a duração", lida?.matchMinutes === 60, `${lida?.matchMinutes}`);

const mudada = await call(presidente, "PATCH", `/api/teams/${comDuracao.body.id}/duracao-jogo`, { minutes: 70 });
check("a direção muda a duração na ficha da equipa", mudada.status < 300, `${mudada.status}`);
check(
  "e fica gravada",
  (await db.query(`SELECT "matchMinutes" FROM "Team" WHERE id = $1`, [comDuracao.body.id])).rows[0]?.matchMinutes === 70,
  "",
);

const absurda = await call(presidente, "PATCH", `/api/teams/${comDuracao.body.id}/duracao-jogo`, { minutes: 999 });
check("uma duração absurda é recusada (400)", absurda.status === 400, `${absurda.status}`);

const porPai = await call(parent, "PATCH", `/api/teams/${comDuracao.body.id}/duracao-jogo`, { minutes: 50 });
check("uma família não muda a duração (403)", porPai.status === 403, `${porPai.status}`);

const semDuracaoNaModalidade = await call(presidente, "PATCH", `/api/sports/${modalidade.id}`, { matchMinutes: 120 });
check(
  "a modalidade já não aceita a duração",
  semDuracaoNaModalidade.status === 400 || (await db.query(`SELECT "matchMinutes" FROM "Sport" WHERE id = $1`, [modalidade.id])).rows[0].matchMinutes === modalidade.matchMinutes,
  `${semDuracaoNaModalidade.status}`,
);

/* -------------------------------------------------------------------------- */

console.log("\n=== A ficha usa a duração da equipa ===");

// O treinador da demonstração passa a treinar a equipa de 70 minutos, com o
// plantel de uma equipa dele — para o âmbito e a convocatória funcionarem.
const doCoach = (await db.query(
  `SELECT ts."teamId",
          (SELECT count(*) FROM "TeamMembership" tm WHERE tm."teamId" = ts."teamId" AND tm."leftAt" IS NULL) AS n
     FROM "TeamStaff" ts
     JOIN "Membership" m ON m.id = ts."membershipId"
     JOIN "User" u ON u.id = m."userId"
    WHERE u.email = 'treinador@lifeclub.pt'
    GROUP BY ts."teamId"
    ORDER BY n DESC
    LIMIT 1`,
)).rows[0]?.teamId;
const treinador = (await db.query(
  `SELECT m.id FROM "Membership" m JOIN "User" u ON u.id = m."userId" WHERE u.email = 'treinador@lifeclub.pt' AND m."academyId" = $1`,
  [academyId],
)).rows[0].id;

const equipa70 = comDuracao.body.id;
await db.query(
  `INSERT INTO "TeamStaff" (id, "teamId", "membershipId", title)
   VALUES ('zz_ts_setenta', $1, $2, 'Treinador principal') ON CONFLICT DO NOTHING`,
  [equipa70, treinador],
);
// Mesma idade máxima que a equipa do coach não é garantida; usam-se atletas com
// idade que caiba num Sub-11: os mais novos da equipa dele.
const plantel = (await db.query(
  `SELECT tm."athleteId" FROM "TeamMembership" tm JOIN "Athlete" a ON a.id = tm."athleteId"
    WHERE tm."teamId" = $1 AND tm."leftAt" IS NULL ORDER BY a.birthdate DESC LIMIT 3`,
  [doCoach],
)).rows.map((r) => r.athleteId);
for (const a of plantel) {
  await db.query(
    `INSERT INTO "TeamMembership" (id, "teamId", "athleteId", "joinedAt")
     VALUES ($1, $2, $3, NOW()) ON CONFLICT DO NOTHING`,
    [`zz_tm_${a.slice(-8)}`, equipa70, a],
  );
}

const criar = async (teamId, opponent, quando) => {
  const id = `zz_m_${Math.random().toString(36).slice(2, 10)}`;
  await db.query(
    `INSERT INTO "Match" (id, "academyId", "teamId", "startsAt", "endsAt", venue, opponent, "isHome", status, "updatedAt")
     VALUES ($1,$2,$3,$4,$5,'ZZ Campo',$6,true,'SCHEDULED',NOW())`,
    [id, academyId, teamId, quando, new Date(quando.getTime() + 5_400_000), opponent],
  );
  return id;
};
const dias = (n) => new Date(Date.now() + n * 86_400_000);

const jogo = await criar(equipa70, "ZZ Fafe", dias(-1));
const jogoAntigo = await criar(equipa70, "zz fafe", dias(-40));
const jogoFuturo = await criar(equipa70, "ZZ Fafe", dias(5));
const jogoOutro = await criar(equipa70, "ZZ Vizela", dias(-10));

for (const m of [jogo, jogoAntigo, jogoOutro]) {
  await db.query(`UPDATE "Match" SET "ourScore" = 2, "theirScore" = 1, status = 'PLAYED' WHERE id = $1`, [m]);
  for (const a of plantel) {
    await db.query(
      `INSERT INTO "MatchCallUp" (id, "matchId", "athleteId", status) VALUES ($1, $2, $3, 'CALLED')`,
      [`zz_cu_${m.slice(-6)}_${a.slice(-6)}`, m, a],
    );
  }
}

const detalhe = await call(coach, "GET", `/api/matches/${jogo}`);
check("o treinador abre o jogo", detalhe.status === 200, `${detalhe.status}`);
check("e a página traz a duração da equipa (70)", detalhe.body?.matchMinutes === 70, `${detalhe.body?.matchMinutes}`);
check("sem relatório ainda", detalhe.body?.report === null && detalhe.body?.opponentReport === null, "");

const ficha = await call(coach, "POST", `/api/matches/${jogo}/ficha`, {
  rows: [
    { athleteId: plantel[0], started: true },
    // Um suplente **sem** minuto de entrada: já não é recusado.
    { athleteId: plantel[1], started: false, tally: 1 },
    { athleteId: plantel[2], started: false, onMinute: 50 },
  ],
});
check("a ficha grava com um suplente sem minuto de entrada", ficha.status < 300, `${ficha.status} ${JSON.stringify(ficha.body)}`);
const minutos = Object.fromEntries(
  (await db.query(`SELECT "athleteId", minutes FROM "MatchAppearance" WHERE "matchId" = $1`, [jogo])).rows.map((r) => [r.athleteId, r.minutes]),
);
check("o titular ficou com os 70 da equipa, não os 90 da modalidade", minutos[plantel[0]] === 70, `${minutos[plantel[0]]}`);
check("o suplente sem entrada fica a zero, não a um palpite", minutos[plantel[1]] === 0, `${minutos[plantel[1]]}`);
check("o suplente que entrou aos 50 fica com 20", minutos[plantel[2]] === 20, `${minutos[plantel[2]]}`);

/* -------------------------------------------------------------------------- */

console.log("\n=== O relatório do jogo ===");

const manhoso = await call(coach, "PUT", `/api/matches/${jogo}/relatorio`, {
  summary: "Jogo controlado.",
  videos: [{ url: "javascript:alert(1)", label: "manhoso" }],
});
check("uma ligação que não é https é recusada (400)", manhoso.status === 400, `${manhoso.status}`);
check("com a frase em português", /ligações de vídeo/.test(JSON.stringify(manhoso.body)), JSON.stringify(manhoso.body));

const relatorio = await call(coach, "PUT", `/api/matches/${jogo}/relatorio`, {
  summary: "Jogo controlado do início ao fim.",
  positives: "Saída de bola a três.",
  negatives: "",
  toImprove: "Bolas paradas defensivas.",
  videos: [
    { url: "https://youtube.com/watch?v=abc", label: "1.ª parte" },
    { url: "https://drive.google.com/x" },
  ],
});
check("o treinador grava o relatório", relatorio.status === 200, `${relatorio.status} ${JSON.stringify(relatorio.body)}`);
check("um campo vazio fica nulo", relatorio.body?.negatives === null, `${relatorio.body?.negatives}`);
check("o autor vem com o relatório", typeof relatorio.body?.authorName === "string", `${relatorio.body?.authorName}`);
check("as duas ligações entram", relatorio.body?.videos?.length === 2, JSON.stringify(relatorio.body?.videos));
check("a ligação sem nome fica sem nome", relatorio.body?.videos?.[1]?.label === null, JSON.stringify(relatorio.body?.videos?.[1]));

const outraVez = await call(coach, "PUT", `/api/matches/${jogo}/relatorio`, { summary: "Corrigido.", videos: [] });
check("gravar outra vez substitui, não duplica", outraVez.status === 200 && outraVez.body?.summary === "Corrigido.", `${outraVez.status}`);
check("e os campos que não vieram ficaram vazios", outraVez.body?.positives === null, `${outraVez.body?.positives}`);
check(
  "há um relatório só para este jogo",
  (await db.query(`SELECT count(*)::int AS n FROM "MatchReport" WHERE "matchId" = $1`, [jogo])).rows[0].n === 1,
  "",
);

const naPagina = await call(coach, "GET", `/api/matches/${jogo}`);
check("a página do jogo traz o relatório", naPagina.body?.report?.summary === "Corrigido.", JSON.stringify(naPagina.body?.report));

const futuro = await call(coach, "PUT", `/api/matches/${jogoFuturo}/relatorio`, { summary: "Vai correr bem." });
check("um relatório de um jogo por jogar é recusado (400)", futuro.status === 400, `${futuro.status}`);

const pelaFamilia = await call(parent, "PUT", `/api/matches/${jogo}/relatorio`, { summary: "O meu filho foi o melhor." });
check("uma família não escreve o relatório (403)", pelaFamilia.status === 403, `${pelaFamilia.status}`);

const grande = await call(coach, "PUT", `/api/matches/${jogo}/relatorio`, { summary: "x".repeat(5000) });
check("um texto de cinco mil caracteres é recusado (400)", grande.status === 400, `${grande.status}`);

/* -------------------------------------------------------------------------- */

console.log("\n=== O adversário ===");

const adversario = await call(coach, "PUT", `/api/matches/${jogo}/adversario`, {
  formation: "4-3-3",
  style: "Pressão alta nos primeiros 20 minutos, depois baixam.",
  weaknesses: "Lateral esquerdo lento.",
  keyPlayers: "O 10 remata de fora.",
});
check("o treinador regista como o adversário jogou", adversario.status === 200, `${adversario.status} ${JSON.stringify(adversario.body)}`);
check("com a formação", adversario.body?.formation === "4-3-3", `${adversario.body?.formation}`);

const antigo = await call(coach, "PUT", `/api/matches/${jogoAntigo}/adversario`, { formation: "4-4-2", notes: "Da outra vez." });
check("e o do jogo antigo contra o mesmo nome", antigo.status === 200, `${antigo.status}`);

const paginaFutura = await call(coach, "GET", `/api/matches/${jogoFuturo}`);
check("o jogo por jogar contra o Fafe traz o histórico", Array.isArray(paginaFutura.body?.opponentHistory), "");
check(
  "com os dois jogos anteriores, apesar da diferença de maiúsculas",
  paginaFutura.body?.opponentHistory?.length === 2,
  `${paginaFutura.body?.opponentHistory?.length}`,
);
check(
  "o mais recente primeiro, com a formação",
  paginaFutura.body?.opponentHistory?.[0]?.matchId === jogo && paginaFutura.body?.opponentHistory?.[0]?.report?.formation === "4-3-3",
  JSON.stringify(paginaFutura.body?.opponentHistory?.[0]),
);
check("e o próprio jogo não entra no histórico dele", !paginaFutura.body?.opponentHistory?.some((h) => h.matchId === jogoFuturo), "");

const paginaVizela = await call(coach, "GET", `/api/matches/${jogoOutro}`);
check("o jogo com o Vizela não traz o histórico do Fafe", paginaVizela.body?.opponentHistory?.length === 0, `${paginaVizela.body?.opponentHistory?.length}`);

console.log("\n=== A lista de adversários ===");

const lista = await call(coach, "GET", "/api/matches/adversarios");
check("o treinador lê a lista", lista.status === 200 && Array.isArray(lista.body), `${lista.status}`);
const fafe = lista.body?.find?.((r) => r.name.toLowerCase() === "zz fafe");
check("o Fafe aparece uma vez só", lista.body?.filter?.((r) => r.name.toLowerCase() === "zz fafe").length === 1, "");
// O jogo de daqui a cinco dias não é história: só os dois já jogados.
check("com os jogos já jogados contra ele", fafe?.matches?.length === 2, `${fafe?.matches?.length}`);
check("e sem o que ainda não aconteceu", !fafe?.matches?.some?.((m) => m.matchId === jogoFuturo), "");
check("dois jogados, ambos ganhos", fafe?.played === 2 && fafe?.wins === 2, `${fafe?.played} ${fafe?.wins}`);
check("dois relatórios", fafe?.reports === 2, `${fafe?.reports}`);
check("e a última formação vista", fafe?.lastFormation === "4-3-3", `${fafe?.lastFormation}`);
check("o Vizela também lá está", lista.body?.some?.((r) => r.name === "ZZ Vizela"), "");

const listaPai = await call(parent, "GET", "/api/matches/adversarios");
check("uma família não lê a lista (403)", listaPai.status === 403, `${listaPai.status}`);

/*
 * O âmbito: um treinador de outra equipa não escreve sobre este jogo, e não
 * vê o Fafe na lista dele.
 */
const outroTreinador = (await db.query(
  `SELECT u.email FROM "Membership" m JOIN "User" u ON u.id = m."userId"
    WHERE m."academyId" = $1 AND m.role = 'COACH' AND u.email <> 'treinador@lifeclub.pt' AND m."isActive"
    LIMIT 1`,
  [academyId],
)).rows[0]?.email;
if (outroTreinador) {
  const outro = await login(outroTreinador);
  const foraDoAmbito = await call(outro, "PUT", `/api/matches/${jogo}/adversario`, { formation: "3-5-2" });
  check("um treinador de outra equipa não escreve sobre este jogo (404)", foraDoAmbito.status === 404, `${foraDoAmbito.status}`);
  const listaOutro = await call(outro, "GET", "/api/matches/adversarios");
  check("nem vê o Fafe na lista dele", listaOutro.status === 200 && !listaOutro.body?.some?.((r) => r.name.toLowerCase() === "zz fafe"), `${listaOutro.status}`);
} else {
  console.log("  (sem segundo treinador na demonstração — âmbito não testado)");
}

/* -------------------------------------------------------------------------- */

await limpar();
await db.query(`DELETE FROM "TeamStaff" WHERE id = 'zz_ts_setenta'`);
await db.end();

console.log(`\n${ok} OK, ${bad} FALHA`);
process.exit(bad ? 1 : 0);

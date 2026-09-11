#!/usr/bin/env node
/**
 * A convocatória: logística ao submeter, e resposta da família.
 *
 * ## O que este teste existe para provar
 *
 * Duas coisas que não existiam, e uma que existia mal.
 *
 * **A logística** (ponto de encontro, horas, jornada) vivia no `localStorage` de
 * quem exportava o PDF — por equipa, por computador — e por isso o pai nunca a
 * via. Passa a ser dita ao submeter e a viver no jogo, de onde a app da família
 * a lê. Ver a migração `20260912120000`.
 *
 * **A resposta da família** não tinha por onde ser dada: `MatchCallUp.status`
 * tinha `CONFIRMED | DECLINED` e nunca saía de `CALLED`. Agora o pai pode dizer
 * que o filho não vai — com motivo obrigatório, porque "não vai" sem mais nada
 * deixa o treinador sem saber se procura substituto.
 *
 * **O silêncio não é recusa.** Quem não responde continua `CALLED`, que conta
 * como quem vai. É a asserção que impede alguém de um dia "arrumar" isto
 * tratando o não-responder como ausência.
 *
 *  1. Submeter guarda a logística no jogo, e a hora de encontro é do dia certo.
 *  2. Um encontro depois do apito é da **véspera** (concentração).
 *  3. A logística sai na lista de jogos — é assim que a app da família a lê.
 *  4. O pai recusa com motivo; a linha fica `DECLINED` com autor e hora.
 *  5. Recusar sem motivo é recusado (400) — e a base tem o mesmo CHECK.
 *  6. O pai desfaz: volta a `CONFIRMED` e o motivo desaparece.
 *  7. Um pai não responde por um atleta que não é filho dele (403).
 *  8. Não se responde a uma convocatória por submeter, nem a um jogo passado.
 *
 * Uso: node scripts/test-convocatoria-resposta.mjs
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

const coach = await login("treinador@lifeclub.pt");
const parent = await login("familia@lifeclub.pt");

/**
 * Passar o gate legal, como um utilizador passa.
 *
 * ## Porque é que um teste tem de fazer isto
 *
 * O `AuthGuard` recusa **todas** as rotas autenticadas a quem tenha documentos
 * por aceitar — 403 `LEGAL_ACCEPTANCE_REQUIRED`. Um teste de API tem de
 * atravessar os mesmos portões que a app atravessa; a alternativa era escrever
 * na base por baixo do produto, e aí deixa de se estar a testar o produto.
 *
 * ## E porque é que não se salta
 *
 * Porque um 403 do gate é indistinguível de um 403 de autorização, e há
 * asserções aqui que **esperam** 403 ("um pai não responde por um filho que não
 * é dele"). Sem isto, essa passava pela razão errada — e um teste que passa por
 * acidente é pior do que um teste que falha.
 *
 * Aceita-se o que estiver pendente para esta conta e mais nada. O que está
 * pendente na base de desenvolvimento são fixtures de teste (`Teste
 * TERMS_OF_USE`, versão `0.0.770`, "apagado no fim") deixadas por uma corrida
 * das suites legais que não chegou à limpeza.
 */
const passarOGateLegal = async (token, quem) => {
  const st = await call(token, "GET", "/api/legal/status");
  const pendentes = (st.body?.pending ?? []).map((d) => d.id);
  if (pendentes.length === 0) return true;

  const r = await call(token, "POST", "/api/legal/accept", { documentIds: pendentes });
  if (r.status !== 200 && r.status !== 201) {
    console.log(`  (não consegui aceitar os documentos de ${quem}: ${r.status} ${JSON.stringify(r.body).slice(0, 120)})`);
    return false;
  }
  console.log(`  (${quem}: aceites ${pendentes.length} documentos legais pendentes)`);
  return true;
};

await passarOGateLegal(coach, "treinador");
await passarOGateLegal(parent, "encarregado");

const sonda = await call(coach, "GET", "/api/matches");
if (sonda.body?.code === "LEGAL_ACCEPTANCE_REQUIRED" || sonda.status !== 200) {
  console.log(`PARADO — /api/matches devolveu ${sonda.status}: ${JSON.stringify(sonda.body).slice(0, 200)}`);
  await db.end();
  process.exit(2);
}

/* Estado limpo — o mesmo jogo que `test-callups.mjs` usa. */
const MATCH = "mt_proximo";
const limpar = async () => {
  await db.query(`UPDATE "Match" SET "callUpsClosedAt" = NULL, "meetingPoint" = NULL, "meetingAt" = NULL,
                  "arrivalAt" = NULL, "roundLabel" = NULL, "callUpNotes" = NULL, "confirmationRequired" = false
                  WHERE id = $1`, [MATCH]);
  await db.query(`DELETE FROM "MatchCallUp" WHERE "matchId" = $1`, [MATCH]);
  await db.query(`DELETE FROM "Notification" WHERE type = 'MATCH_CALLED_UP'`);
  await db.query(`DELETE FROM "Notification" WHERE type = 'SESSION_CHANGED'`);
};
await limpar();

/* De quem é este pai? A convocatória tem de o incluir, ou não há o que responder. */
const filhos = (await db.query(
  `SELECT gl."athleteId" FROM "GuardianLink" gl
     JOIN "Membership" m ON m.id = gl."membershipId"
     JOIN "User" u ON u.id = m."userId"
    WHERE u.email = 'familia@lifeclub.pt'`,
)).rows.map((r) => r.athleteId);
check("o pai de teste tem filhos", filhos.length > 0, JSON.stringify(filhos));

/*
 * O jogo de teste tem de estar no futuro — responder a uma convocatória de um
 * jogo já disputado não faz sentido, e é isso mesmo que se prova mais abaixo.
 *
 * O `mt_proximo` do seed foi marcado para uma data fixa e já envelheceu: um
 * teste que dependa de a semente ser recente falha sozinho com o passar do
 * tempo, e depois ninguém sabe se foi o produto ou o calendário. Empurra-se
 * para daqui a uma semana e repõe-se no fim.
 */
const original = (await db.query(`SELECT "startsAt", "endsAt" FROM "Match" WHERE id = $1`, [MATCH])).rows[0];
check("o jogo de teste existe", Boolean(original), MATCH);

const daquiA = (dias) => new Date(Date.now() + dias * 86_400_000);
const futuro = daquiA(7);
futuro.setHours(10, 30, 0, 0);
await db.query(
  `UPDATE "Match" SET "startsAt" = $2, "endsAt" = $3 WHERE id = $1`,
  [MATCH, futuro, new Date(futuro.getTime() + 2 * 3600_000)],
);
const kickOff = (await db.query(`SELECT "startsAt" FROM "Match" WHERE id = $1`, [MATCH])).rows[0]?.startsAt;
check("e está no futuro", kickOff && kickOff.getTime() > Date.now(), `${kickOff}`);

/* ============================ o aviso diz o que é preciso fazer ===== */

/*
 * "O Rui está convocado" é uma informação: lê-se e arruma-se. Se o clube precisa
 * de resposta e o aviso não o disser, o pai lê, fecha, e o treinador fica à
 * espera de uma confirmação que ninguém sabe que tem de dar.
 */
console.log("\n=== O aviso pede, quando há que pedir ===");
await db.query(`DELETE FROM "Notification" WHERE type = 'MATCH_CALLED_UP'`);
await call(coach, "POST", `/api/matches/${MATCH}/convocatoria`, { athleteIds: filhos.slice(0, 1) });
await call(coach, "POST", `/api/matches/${MATCH}/convocatoria/submeter`, { confirmationRequired: true });

const comPedido = (await db.query(
  `SELECT title, body, payload FROM "Notification" WHERE type = 'MATCH_CALLED_UP' ORDER BY "createdAt" DESC LIMIT 1`,
)).rows[0];
check("o título pede em vez de informar", /confirma a presença/i.test(comPedido?.title ?? ""), `${comPedido?.title}`);
check("e o corpo diz o que fazer", /abre para dizer se vai/i.test(comPedido?.body ?? ""), `${comPedido?.body}`);
check(
  "e leva ao jogo",
  (comPedido?.payload?.route ?? "") === `/evento/jogo/${MATCH}`,
  JSON.stringify(comPedido?.payload),
);

/* Sem pedido de confirmação, o aviso volta a ser uma informação. */
await db.query(`DELETE FROM "Notification" WHERE type = 'MATCH_CALLED_UP'`);
await db.query(`UPDATE "Match" SET "callUpsClosedAt" = NULL WHERE id = $1`, [MATCH]);
await call(coach, "POST", `/api/matches/${MATCH}/convocatoria/submeter`, {});
const semPedido = (await db.query(
  `SELECT title FROM "Notification" WHERE type = 'MATCH_CALLED_UP' ORDER BY "createdAt" DESC LIMIT 1`,
)).rows[0];
check("sem confirmação pedida, informa", /está convocado/i.test(semPedido?.title ?? ""), `${semPedido?.title}`);

/* Reposto para o resto do ficheiro montar a convocatória de raiz. */
await db.query(`UPDATE "Match" SET "callUpsClosedAt" = NULL WHERE id = $1`, [MATCH]);
await db.query(`DELETE FROM "MatchCallUp" WHERE "matchId" = $1`, [MATCH]);
await db.query(`DELETE FROM "Notification" WHERE type = 'MATCH_CALLED_UP'`);

/* ====================================================== a logística ===== */

console.log("\n=== Submeter guarda a logística ===");
const montou = await call(coach, "POST", `/api/matches/${MATCH}/convocatoria`, { athleteIds: filhos.slice(0, 1) });
check("o treinador monta a lista", montou.status === 200 || montou.status === 201, `${montou.status} ${JSON.stringify(montou.body).slice(0, 120)}`);

/*
 * As horas vão como `HH:MM` e a data é a do jogo. Calcula-se a partir do apito
 * para o teste não depender da hora a que o seed marcou o jogo.
 */
const hhmm = (d) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
const encontro = new Date(kickOff.getTime() - 90 * 60_000);
const chegada = new Date(kickOff.getTime() - 40 * 60_000);

const submeteu = await call(coach, "POST", `/api/matches/${MATCH}/convocatoria/submeter`, {
  roundLabel: "Jornada 7",
  meetingPoint: "Parque do clube",
  meetingTime: hhmm(encontro),
  arrivalTime: hhmm(chegada),
  notes: "Levar equipamento alternativo.",
  confirmationRequired: false,
});
check("submete (2xx)", submeteu.status === 200 || submeteu.status === 201, `${submeteu.status} ${JSON.stringify(submeteu.body).slice(0, 140)}`);

const guardado = (await db.query(
  `SELECT "roundLabel", "meetingPoint", "callUpNotes", "confirmationRequired",
          to_char("meetingAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI') mt,
          to_char("arrivalAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI') at
     FROM "Match" WHERE id = $1`, [MATCH],
)).rows[0];
check("a jornada ficou no jogo", guardado?.roundLabel === "Jornada 7", `${guardado?.roundLabel}`);
check("o ponto de encontro também", guardado?.meetingPoint === "Parque do clube", `${guardado?.meetingPoint}`);
check("e o recado às famílias", guardado?.callUpNotes === "Levar equipamento alternativo.", `${guardado?.callUpNotes}`);
check("a confirmação nasce desligada", guardado?.confirmationRequired === false, `${guardado?.confirmationRequired}`);

const listaJogos = (await call(coach, "GET", "/api/matches")).body;
const naLista = Array.isArray(listaJogos) ? listaJogos.find((m) => m.id === MATCH) : null;
check("a lista de jogos responde", Array.isArray(listaJogos), JSON.stringify(listaJogos).slice(0, 160));
check("a logística sai na lista de jogos", naLista?.meetingPoint === "Parque do clube", JSON.stringify(naLista?.meetingPoint));
check("com a hora do encontro", Boolean(naLista?.meetingAt), `${naLista?.meetingAt}`);
check(
  "no dia do jogo, e antes do apito",
  Boolean(naLista?.meetingAt) &&
    new Date(naLista.meetingAt) < new Date(naLista.startsAt) &&
    new Date(naLista.meetingAt).toDateString() === new Date(naLista.startsAt).toDateString(),
  `${naLista?.meetingAt} vs ${naLista?.startsAt}`,
);

/*
 * Um encontro **depois** da hora do apito só pode ser da véspera: ninguém marca
 * concentração onze horas depois do jogo começar. Ver `horaNoDia`.
 *
 * Pelo `PATCH` e não por `submeter`: a convocatória já saiu, e `submeter`
 * recusa-a — "reabre-a para alterar". Foi assim que este bloco passou uma vez
 * sem provar nada: o `submeter` falhava em silêncio, a hora ficava a do passe
 * anterior (que também era menor que a do apito) e a asserção dava OK à mesma.
 * Daí verificar-se agora o estado da resposta.
 */
console.log("\n=== Um encontro na véspera ===");
const depoisDoApito = new Date(kickOff.getTime() + 3 * 3600_000);
const pediuVespera = await call(coach, "PATCH", `/api/matches/${MATCH}/convocatoria/logistica`, {
  meetingPoint: "Parque do clube",
  meetingTime: hhmm(depoisDoApito),
});
check("o pedido da véspera passa (200)", pediuVespera.status === 200, `${pediuVespera.status} ${JSON.stringify(pediuVespera.body).slice(0, 140)}`);

const listaVespera = (await call(coach, "GET", "/api/matches")).body;
const vespera = Array.isArray(listaVespera) ? listaVespera.find((m) => m.id === MATCH) : null;
check(
  "a hora maior que a do jogo cai no dia anterior",
  Boolean(vespera?.meetingAt) &&
    new Date(vespera.meetingAt).toDateString() !== new Date(vespera.startsAt).toDateString() &&
    new Date(vespera.meetingAt) < new Date(vespera.startsAt),
  `${vespera?.meetingAt} vs ${vespera?.startsAt}`,
);

/* Repõe uma logística sensata para o resto do teste. */
await call(coach, "PATCH", `/api/matches/${MATCH}/convocatoria/logistica`, {
  meetingPoint: "Parque do clube",
  meetingTime: hhmm(encontro),
});

/* ================================================= a resposta do pai ===== */

console.log("\n=== O pai diz que não vai ===");
const filho = filhos[0];

const semMotivo = await call(parent, "POST", `/api/matches/${MATCH}/convocatoria/resposta`, {
  athleteId: filho, going: false,
});
check("recusar sem motivo é recusado (400)", semMotivo.status === 400, `${semMotivo.status}`);
check("e a mensagem explica porquê", /porque|motivo|decidir/i.test(semMotivo.body?.message ?? ""), `${semMotivo.body?.message}`);

const recusou = await call(parent, "POST", `/api/matches/${MATCH}/convocatoria/resposta`, {
  athleteId: filho, going: false, reason: "Tem prova na escola.",
});
check("recusar com motivo passa (2xx)", recusou.status === 200 || recusou.status === 201, `${recusou.status} ${JSON.stringify(recusou.body).slice(0, 140)}`);

const linha = (await db.query(
  `SELECT status, "declineReason", "respondedAt", "respondedById" FROM "MatchCallUp"
    WHERE "matchId" = $1 AND "athleteId" = $2`, [MATCH, filho],
)).rows[0];
check("a linha fica DECLINED", linha?.status === "DECLINED", `${linha?.status}`);
check("com o motivo", linha?.declineReason === "Tem prova na escola.", `${linha?.declineReason}`);
check("e com hora e autor", Boolean(linha?.respondedAt) && Boolean(linha?.respondedById), JSON.stringify(linha));

/*
 * A base tem o mesmo CHECK que o serviço. Uma regra que só vive no serviço é
 * uma regra que a próxima rota esquece.
 */
let baseRecusou = false;
try {
  await db.query(
    `UPDATE "MatchCallUp" SET status = 'DECLINED', "declineReason" = NULL WHERE "matchId" = $1 AND "athleteId" = $2`,
    [MATCH, filho],
  );
} catch {
  baseRecusou = true;
}
check("a base recusa uma recusa sem motivo", baseRecusou);

/*
 * O treinador tem de **ver** a recusa sem abrir a base.
 *
 * É o que a lista de convocatórias lê para dizer quem confirmou e quem não vai
 * (ver `EstadoNaLista` e `Respostas` na consola). Sem isto na resposta da API,
 * o motivo ficava guardado e invisível — e o treinador telefonava na mesma,
 * que é o que isto veio evitar.
 */
console.log("\n=== O treinador vê a recusa ===");
const paraOTreinador = (await call(coach, "GET", "/api/matches")).body;
const jogoVisto = Array.isArray(paraOTreinador) ? paraOTreinador.find((m) => m.id === MATCH) : null;
const linhaVista = jogoVisto?.calledUp?.find((c) => c.athleteId === filho);
check("a convocatória traz o estado de cada convocado", linhaVista?.status === "DECLINED", JSON.stringify(linhaVista));
check("com o motivo à vista", linhaVista?.declineReason === "Tem prova na escola.", `${linhaVista?.declineReason}`);
check("e a hora da resposta", Boolean(linhaVista?.respondedAt), `${linhaVista?.respondedAt}`);

/*
 * O silêncio dos outros continua a ser silêncio.
 *
 * `CALLED` e não `DECLINED`: quem não respondeu vai. É a asserção que impede
 * alguém de um dia "arrumar" isto tratando o não-responder como ausência — e é
 * também o que faz a consola só contar "sem resposta" quando o clube pediu
 * confirmação.
 */
const outros = (jogoVisto?.calledUp ?? []).filter((c) => c.athleteId !== filho);
check(
  "quem não respondeu fica em CALLED",
  outros.every((c) => c.status === "CALLED"),
  JSON.stringify(outros.map((c) => c.status)),
);

console.log("\n=== E desfaz ===");
const afinalVai = await call(parent, "POST", `/api/matches/${MATCH}/convocatoria/resposta`, {
  athleteId: filho, going: true,
});
check("responder que vai passa", afinalVai.status === 200 || afinalVai.status === 201, `${afinalVai.status}`);
const depois = (await db.query(
  `SELECT status, "declineReason" FROM "MatchCallUp" WHERE "matchId" = $1 AND "athleteId" = $2`, [MATCH, filho],
)).rows[0];
check("fica CONFIRMED", depois?.status === "CONFIRMED", `${depois?.status}`);
check("e o motivo desaparece", depois?.declineReason === null, `${depois?.declineReason}`);

/*
 * `submeter` recusa uma convocatória já enviada, e é isso que dá sentido ao
 * `PATCH` existir: sem ele, corrigir uma hora obrigava a reabrir.
 */
const resubmeter = await call(coach, "POST", `/api/matches/${MATCH}/convocatoria/submeter`, { meetingPoint: "x" });
check("submeter outra vez é recusado (400)", resubmeter.status === 400, `${resubmeter.status}`);
check(
  "a dizer que é preciso reabrir",
  /reabre/i.test(resubmeter.body?.message ?? ""),
  `${resubmeter.body?.message}`,
);

/* ======================================= corrigir sem reabrir ===== */

/*
 * Mudar a hora do encontro não pode obrigar a reabrir a convocatória.
 *
 * Reabrir desfaz a lista, e ressubmeter avisa outra vez toda a gente de que foi
 * convocada — catorze pushes por causa de meia hora. E era isso que deixava
 * todas as convocatórias anteriores a esta funcionalidade sem logística e sem
 * forma de lha dar.
 */
console.log("\n=== Corrigir os detalhes sem reabrir ===");
await db.query(`DELETE FROM "Notification" WHERE type = 'SESSION_CHANGED'`);

const novoEncontro = new Date(kickOff.getTime() - 120 * 60_000);
const corrigiu = await call(coach, "PATCH", `/api/matches/${MATCH}/convocatoria/logistica`, {
  meetingPoint: "Bomba de gasolina da saída",
  meetingTime: hhmm(novoEncontro),
  arrivalTime: hhmm(chegada),
});
check("a correcção passa (200)", corrigiu.status === 200, `${corrigiu.status} ${JSON.stringify(corrigiu.body).slice(0, 160)}`);
check("e diz que mudou alguma coisa", corrigiu.body?.mudou === true, JSON.stringify(corrigiu.body?.mudancas));
check(
  "nomeando a mudança, não 'houve alterações'",
  (corrigiu.body?.mudancas ?? []).some((m) => /encontro passou para as/i.test(m)),
  JSON.stringify(corrigiu.body?.mudancas),
);

const aindaSubmetida = (await db.query(
  `SELECT "callUpsClosedAt", "meetingPoint" FROM "Match" WHERE id = $1`, [MATCH],
)).rows[0];
check("a convocatória continua enviada", aindaSubmetida?.callUpsClosedAt !== null, `${aindaSubmetida?.callUpsClosedAt}`);
check("com o ponto de encontro novo", aindaSubmetida?.meetingPoint === "Bomba de gasolina da saída", `${aindaSubmetida?.meetingPoint}`);

const convocadosDepois = (await db.query(
  `SELECT COUNT(*)::int n FROM "MatchCallUp" WHERE "matchId" = $1`, [MATCH],
)).rows[0].n;
check("e a lista de convocados intacta", convocadosDepois === 1, `${convocadosDepois}`);

const avisos = (await db.query(
  `SELECT title, body, payload FROM "Notification" WHERE type = 'SESSION_CHANGED'`,
)).rows;
check("a família foi avisada", avisos.length >= 1, `${avisos.length}`);
check("com o que mudou no corpo", /encontro passou para as/i.test(avisos[0]?.body ?? ""), `${avisos[0]?.body}`);
check(
  "e a levar ao jogo, não à agenda",
  (avisos[0]?.payload?.route ?? "") === `/evento/jogo/${MATCH}`,
  JSON.stringify(avisos[0]?.payload),
);

/*
 * Gravar sem mexer em nada não é um acontecimento. Um push por cada vez que
 * alguém abre o formulário e carrega em Gravar gasta a atenção que se vai
 * precisar da próxima vez.
 */
await db.query(`DELETE FROM "Notification" WHERE type = 'SESSION_CHANGED'`);
const semMexer = await call(coach, "PATCH", `/api/matches/${MATCH}/convocatoria/logistica`, {
  meetingPoint: "Bomba de gasolina da saída",
  meetingTime: hhmm(novoEncontro),
  arrivalTime: hhmm(chegada),
});
check("gravar sem mudar nada não avisa ninguém", semMexer.body?.mudou === false, JSON.stringify(semMexer.body));
check(
  "e não deixa notificação nenhuma",
  (await db.query(`SELECT COUNT(*)::int n FROM "Notification" WHERE type = 'SESSION_CHANGED'`)).rows[0].n === 0,
);

/* Uma convocatória por enviar pede os detalhes ao submeter, não por aqui. */
await db.query(`UPDATE "Match" SET "callUpsClosedAt" = NULL WHERE id = $1`, [MATCH]);
const porEnviar = await call(coach, "PATCH", `/api/matches/${MATCH}/convocatoria/logistica`, { meetingPoint: "x" });
check("não se corrige uma convocatória por enviar (400)", porEnviar.status === 400, `${porEnviar.status}`);
await db.query(`UPDATE "Match" SET "callUpsClosedAt" = now() WHERE id = $1`, [MATCH]);

/* Um pai não corrige a logística de um jogo. */
const peloPai = await call(parent, "PATCH", `/api/matches/${MATCH}/convocatoria/logistica`, { meetingPoint: "x" });
check("um encarregado não mexe nos detalhes (403)", peloPai.status === 403, `${peloPai.status}`);

/* ============================================ a confirmação pedida ===== */

/*
 * Com confirmação pedida, o silêncio passa a ser uma pergunta em aberto — é
 * para isso que serve o interruptor, e é o que a consola conta como "sem
 * resposta". O estado dos convocados não muda por se ligar: o que muda é a
 * leitura que se faz dele.
 */
console.log("\n=== A confirmação pedida ===");
const ligou = await call(coach, "PATCH", `/api/matches/${MATCH}/convocatoria/logistica`, {
  meetingPoint: "Bomba de gasolina da saída",
  meetingTime: hhmm(novoEncontro),
  arrivalTime: hhmm(chegada),
  confirmationRequired: true,
});
check("ligar a confirmação passa (200)", ligou.status === 200, `${ligou.status} ${JSON.stringify(ligou.body).slice(0, 140)}`);
check(
  "e avisa que passou a pedir confirmação",
  (ligou.body?.mudancas ?? []).some((m) => /confirmes a presença/i.test(m)),
  JSON.stringify(ligou.body?.mudancas),
);
const comConfirmacao = (await call(coach, "GET", "/api/matches")).body;
const jogoConf = Array.isArray(comConfirmacao) ? comConfirmacao.find((m) => m.id === MATCH) : null;
check("o jogo diz que pede confirmação", jogoConf?.confirmationRequired === true, `${jogoConf?.confirmationRequired}`);
check(
  "e quem já tinha confirmado continua confirmado",
  jogoConf?.calledUp?.find((c) => c.athleteId === filho)?.status === "CONFIRMED",
  JSON.stringify(jogoConf?.calledUp?.find((c) => c.athleteId === filho)),
);

/* ================================= o que a consola sonda ao vivo ===== */

/*
 * A consola pergunta isto de doze em doze segundos enquanto tem a convocatória
 * aberta — é o que faz a confirmação de um pai aparecer sem ninguém carregar em
 * F5. Recarregar a academia para o saber seriam nove pedidos.
 */
console.log("\n=== As respostas ao vivo ===");
const vivas = await call(coach, "GET", `/api/matches/${MATCH}/convocatoria/respostas`);
check("o endpoint responde (200)", vivas.status === 200, `${vivas.status}`);
check("diz que a convocatória está submetida", vivas.body?.submitted === true, JSON.stringify(vivas.body?.submitted));
check("e se pede confirmação", vivas.body?.confirmationRequired === true, `${vivas.body?.confirmationRequired}`);
const linhaViva = (vivas.body?.rows ?? []).find((r) => r.athleteId === filho);
check("traz o estado de cada convocado", linhaViva?.status === "CONFIRMED", JSON.stringify(linhaViva));

/*
 * E não traz nomes: quem tem a página aberta já tem o plantel carregado. Mandar
 * os nomes em cada sondagem era repetir a mesma coisa vinte vezes por hora.
 */
check(
  "sem nomes — só o que muda",
  Object.keys(linhaViva ?? {}).sort().join(",") === "athleteId,declineReason,respondedAt,status",
  Object.keys(linhaViva ?? {}).join(","),
);

/*
 * Um encarregado não lê isto. Tem `calendar:read` e a equipa do filho no
 * âmbito — sem a recusa explícita, lia quem recusou e porquê, com nomes de
 * miúdos e motivos de saúde lá dentro.
 */
const vivasPeloPai = await call(parent, "GET", `/api/matches/${MATCH}/convocatoria/respostas`);
check("um encarregado não lê as respostas dos outros (403)", vivasPeloPai.status === 403, `${vivasPeloPai.status}`);

/* ==================================================== as fronteiras ===== */

console.log("\n=== As fronteiras ===");
const alheio = (await db.query(
  `SELECT id FROM "Athlete" WHERE id <> ALL($1::text[]) LIMIT 1`, [filhos],
)).rows[0]?.id;
if (alheio) {
  const doOutro = await call(parent, "POST", `/api/matches/${MATCH}/convocatoria/resposta`, {
    athleteId: alheio, going: false, reason: "x",
  });
  check(
    "um pai não responde por um filho que não é dele (403)",
    doOutro.status === 403 && /não é teu/i.test(doOutro.body?.message ?? ""),
    `${doOutro.status} ${doOutro.body?.message}`,
  );
} else {
  console.log("  SALTO — não há atleta de outra família na base");
}

/*
 * Uma convocatória por submeter não é pública. 404 e não 403: dizer "existe mas
 * não podes" já é dizer que a lista existe.
 */
await db.query(`UPDATE "Match" SET "callUpsClosedAt" = NULL WHERE id = $1`, [MATCH]);
const porSubmeter = await call(parent, "POST", `/api/matches/${MATCH}/convocatoria/resposta`, {
  athleteId: filho, going: false, reason: "x",
});
check("não se responde a uma convocatória por submeter (404)", porSubmeter.status === 404, `${porSubmeter.status}`);

/* Um jogo já começado não se responde — não há nada a decidir depois do apito. */
await db.query(`UPDATE "Match" SET "callUpsClosedAt" = now(), "startsAt" = now() - interval '2 hours' WHERE id = $1`, [MATCH]);
const passado = await call(parent, "POST", `/api/matches/${MATCH}/convocatoria/resposta`, {
  athleteId: filho, going: false, reason: "x",
});
check("nem a um jogo que já começou (400)", passado.status === 400, `${passado.status}`);
await db.query(`UPDATE "Match" SET "startsAt" = $2 WHERE id = $1`, [MATCH, futuro]);

/* =========================================================== limpeza ===== */

console.log("\n=== Limpeza ===");
await limpar();
await db.query(
  `UPDATE "Match" SET "startsAt" = $2, "endsAt" = $3 WHERE id = $1`,
  [MATCH, original.startsAt, original.endsAt],
);
const restos = (await db.query(
  `SELECT "meetingPoint", "callUpsClosedAt" FROM "Match" WHERE id = $1`, [MATCH],
)).rows[0];
check("o jogo volta ao estado inicial", restos?.meetingPoint === null && restos?.callUpsClosedAt === null, JSON.stringify(restos));

await db.end();
console.log(`\n${ok} passaram, ${bad} falharam`);
process.exit(bad === 0 ? 0 : 1);

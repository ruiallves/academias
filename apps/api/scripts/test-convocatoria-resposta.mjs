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

/*
 * O gate legal, se estiver a bloquear, bloqueia tudo — e em silêncio.
 *
 * Sem esta paragem, cada asserção falhava com 403 e uma delas **passava pela
 * razão errada**: "um pai não responde por um filho que não é dele" espera 403,
 * e o gate devolve 403 a toda a gente. Um teste que passa por acidente é pior
 * do que um teste que falha.
 */
const sonda = await call(coach, "GET", "/api/matches");
if (sonda.body?.code === "LEGAL_ACCEPTANCE_REQUIRED") {
  console.log("PARADO — as contas de teste têm documentos legais por aceitar.");
  console.log("         Todas as rotas autenticadas devolvem 403, e nenhuma asserção deste");
  console.log("         ficheiro (nem das outras suites) diz nada enquanto isso não mudar.");
  await db.end();
  process.exit(2);
}
if (sonda.status !== 200) {
  console.log(`PARADO — /api/matches devolveu ${sonda.status}: ${JSON.stringify(sonda.body).slice(0, 160)}`);
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
 */
console.log("\n=== Um encontro na véspera ===");
const depoisDoApito = new Date(kickOff.getTime() + 3 * 3600_000);
await call(coach, "POST", `/api/matches/${MATCH}/convocatoria/submeter`, { meetingTime: hhmm(depoisDoApito) });
const listaVespera = (await call(coach, "GET", "/api/matches")).body;
const vespera = Array.isArray(listaVespera) ? listaVespera.find((m) => m.id === MATCH) : null;
check(
  "a hora maior que a do jogo cai no dia anterior",
  Boolean(vespera?.meetingAt) && new Date(vespera.meetingAt) < new Date(vespera.startsAt),
  `${vespera?.meetingAt} vs ${vespera?.startsAt}`,
);

/* Repõe uma logística sensata para o resto do teste. */
await call(coach, "POST", `/api/matches/${MATCH}/convocatoria/submeter`, {
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

/* ============================================ a confirmação pedida ===== */

/*
 * Com confirmação pedida, o silêncio passa a ser uma pergunta em aberto — é
 * para isso que serve o interruptor, e é o que a consola conta como "sem
 * resposta". O estado dos convocados não muda por se ligar: o que muda é a
 * leitura que se faz dele.
 */
console.log("\n=== A confirmação pedida ===");
await call(coach, "POST", `/api/matches/${MATCH}/convocatoria/submeter`, { confirmationRequired: true });
const comConfirmacao = (await call(coach, "GET", "/api/matches")).body;
const jogoConf = Array.isArray(comConfirmacao) ? comConfirmacao.find((m) => m.id === MATCH) : null;
check("o jogo diz que pede confirmação", jogoConf?.confirmationRequired === true, `${jogoConf?.confirmationRequired}`);
check(
  "e quem já tinha confirmado continua confirmado",
  jogoConf?.calledUp?.find((c) => c.athleteId === filho)?.status === "CONFIRMED",
  JSON.stringify(jogoConf?.calledUp?.find((c) => c.athleteId === filho)),
);

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

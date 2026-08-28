#!/usr/bin/env node
/**
 * Geração de mensalidades.
 *
 * O buraco que isto testa: a página de Mensalidades lê `Charge`, o preço vivia em
 * `SubscriptionPlan`/`Enrollment`, e **nada no produto criava um `Charge`**. Um
 * atleta inscrito hoje nunca aparecia nas mensalidades — sem erro nenhum, porque
 * não havia erro: havia uma peça a faltar.
 *
 * O que interessa verificar:
 *
 *  - inscrever um atleta cria a mensalidade do mês corrente;
 *  - sem preço configurado, a inscrição **não falha** — fica por gerar;
 *  - definir o preço depois apanha quem ficou para trás;
 *  - gerar duas vezes não duplica nem reescreve (é idempotente);
 *  - o ajuste individual sobrepõe-se ao preço da equipa;
 *  - um mês fora do calendário do clube (`Academy.billingMonths`) não gera nada.
 *
 * Uso: node scripts/test-charge-generation.mjs
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

const hoje = new Date();
const PERIODO = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}`;
const MES = hoje.getMonth() + 1;

/*
 * O calendário de teste cobra o mês corrente, seja ele qual for.
 *
 * A primeira versão deste teste assumiu que o mês de hoje é cobrado — e falhou
 * em Agosto, porque o calendário por omissão exclui Agosto de propósito ("muitas
 * academias não cobram agosto"). O teste estava errado, não o código: a geração
 * recusou-se a cobrar um mês em que o clube não cobra, que é exactamente o que
 * tem de fazer.
 *
 * O calendário é do **clube** (`Academy.billingMonths`) e já não de cada plano —
 * ver a migração `meses_de_cobranca`. Este teste põe lá o mês corrente e o
 * seguinte, e repõe o original no fim.
 */
const proximoMes = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 1);
const MESES_DO_TESTE = [MES, proximoMes.getMonth() + 1];

const limpar = async () => {
  await db.query(`DELETE FROM "Charge" WHERE "athleteId" IN (SELECT id FROM "Athlete" WHERE name LIKE 'ZZ %')`);
  await db.query(`DELETE FROM "Enrollment" WHERE "athleteId" IN (SELECT id FROM "Athlete" WHERE name LIKE 'ZZ %')`);
  await db.query(`DELETE FROM "Athlete" WHERE name LIKE 'ZZ %'`);
  await db.query(`DELETE FROM "SubscriptionPlan" WHERE name LIKE 'ZZ %' OR name LIKE 'Individual — ZZ %'`);
  await db.query(`DELETE FROM "Team" WHERE name LIKE 'ZZ %'`);
};
await limpar();

const direcao = await login("direcao@lifeclub.pt");

const academyId = (await db.query(`SELECT id FROM "Academy" WHERE slug = 'life-club'`)).rows[0].id;
const modelo = (await db.query(`SELECT "sportId", "seasonId" FROM "Team" WHERE "academyId" = $1 LIMIT 1`, [academyId])).rows[0];

/*
 * O calendário de cobrança da academia, guardado para ser reposto no fim.
 *
 * Isto mexe numa definição real do clube de demonstração, por isso a reposição
 * não é opcional — está no `fim()`, que corre em qualquer saída.
 */
const calendarioOriginal = (await db.query(
  `SELECT "billingMonths" FROM "Academy" WHERE id = $1`, [academyId],
)).rows[0].billingMonths;
const porCalendario = (meses) =>
  db.query(`UPDATE "Academy" SET "billingMonths" = $1 WHERE id = $2`, [meses, academyId]);
const reporCalendario = () => porCalendario(calendarioOriginal);

await porCalendario(MESES_DO_TESTE);

/* -------------------------------------------------------------------------- */

console.log("=== Inscrever sem preço configurado ===");

// Uma equipa nova, sem plano nenhum — o estado de um clube a arrancar.
await db.query(
  `INSERT INTO "Team" (id, "academyId", "sportId", "seasonId", name, "maxAge", "updatedAt")
   VALUES ('zz_t_sem_preco', $1, $2, $3, 'ZZ Equipa Sem Preço', 13, NOW())`,
  [academyId, modelo.sportId, modelo.seasonId],
);

const semPreco = await call(direcao, "POST", "/api/athletes", {
  name: "ZZ Atleta Sem Preço",
  birthdate: "2013-05-05",
  taxId: "911111111",
  teamId: "zz_t_sem_preco",
});
/*
 * A inscrição não pode falhar por não haver preço.
 *
 * Um clube que ainda não configurou mensalidades tem de conseguir inscrever
 * atletas — o preço define-se depois, e a cobrança nasce nessa altura.
 */
check("inscreve sem preço configurado", semPreco.status === 201 || semPreco.status === 200, JSON.stringify(semPreco.body).slice(0, 120));
const idSemPreco = semPreco.body?.id;

const semCobranca = (await db.query(
  `SELECT count(*)::int n FROM "Charge" WHERE "athleteId" = $1 AND period = $2`,
  [idSemPreco, PERIODO],
)).rows[0].n;
check("e fica sem mensalidade — não há valor para inventar", semCobranca === 0, `${semCobranca}`);

console.log("\n=== Definir o preço apanha quem ficou para trás ===");
/*
 * O bug seguinte, se isto não existisse: "configurei o preço e continua a não
 * aparecer". O atleta foi inscrito antes de haver preço e nada voltava a tentar.
 */
const preco = await call(direcao, "PATCH", "/api/teams/zz_t_sem_preco/fee", { amountCents: 3500 });
check("a direção define o preço da equipa", preco.status === 200, `${preco.status}`);

// O calendário do clube já inclui o mês corrente (ver o topo), por isso basta
// gerar outra vez agora que existe preço.
await call(direcao, "POST", `/api/charges/gerar?periodo=${PERIODO}`);

const agoraTem = (await db.query(
  `SELECT "amountCents", status FROM "Charge" WHERE "athleteId" = $1 AND period = $2`,
  [idSemPreco, PERIODO],
)).rows[0];
check("e a mensalidade do mês nasce nesse momento", agoraTem?.amountCents === 3500, JSON.stringify(agoraTem));
check("por pagar", agoraTem?.status === "OPEN", agoraTem?.status);

console.log("\n=== Inscrever com preço já configurado ===");
const comPreco = await call(direcao, "POST", "/api/athletes", {
  name: "ZZ Atleta Com Preço",
  birthdate: "2013-06-06",
  taxId: "922222222",
  teamId: "zz_t_sem_preco",
});
check("inscreve", comPreco.status === 201 || comPreco.status === 200, `${comPreco.status}`);
const idComPreco = comPreco.body?.id;

/* É este o caso que foi reportado: criar o atleta e ele aparecer nas mensalidades. */
/*
 * `dueDate` lido como **texto**, e não como `Date`.
 *
 * A coluna é `@db.Date` — uma data sem hora nem fuso. O `pg` devolve-a como um
 * `Date` de JS à meia-noite **local**, e num fuso a leste de Greenwich o
 * `getUTCDate()` dessa data dá o dia anterior. Foi o que aconteceu aqui: o valor
 * guardado era 2026-08-08 e este teste lia 7. O erro era do teste, não do código.
 */
const cobrancaImediata = (await db.query(
  `SELECT "amountCents", "dueDate"::text AS due FROM "Charge" WHERE "athleteId" = $1 AND period = $2`,
  [idComPreco, PERIODO],
)).rows[0];
check("e a mensalidade aparece logo", cobrancaImediata?.amountCents === 3500, JSON.stringify(cobrancaImediata));

const diaAcademia = (await db.query(`SELECT "billingDueDay" FROM "Academy" WHERE id = $1`, [academyId])).rows[0].billingDueDay;
/*
 * O dia é o da academia — o **mês** é que depende de quando se entrou.
 *
 * Este atleta acabou de ser inscrito. Se hoje já passou do dia de vencimento, a
 * mensalidade deste mês vence no prazo seguinte, para não nascer vencida (ver o
 * bloco "Quem entra num mês fechado"). O dia mantém-se em qualquer dos casos, e
 * é isso que este teste verifica — o mês é consequência da data de hoje, e um
 * teste preso a ele falhava metade do calendário.
 */
check(
  "com o dia de vencimento da academia",
  Number(cobrancaImediata.due.slice(8, 10)) === diaAcademia,
  `${cobrancaImediata.due} vs dia ${diaAcademia}`,
);

/* E aparece mesmo na leitura que a página faz. */
const naPagina = await call(direcao, "GET", `/api/charges?period=${PERIODO}`);
check(
  "e a página de Mensalidades vê-a",
  (naPagina.body ?? []).some((c) => c.athleteId === idComPreco),
  `${naPagina.status}`,
);

console.log("\n=== Idempotência ===");
/*
 * Gerar duas vezes não pode duplicar nem reescrever: alguém pode já ter marcado
 * a mensalidade como paga, e uma segunda geração a repor "OPEN" apagava trabalho.
 */
await db.query(`UPDATE "Charge" SET status = 'SETTLED' WHERE "athleteId" = $1 AND period = $2`, [idComPreco, PERIODO]);

const g1 = await call(direcao, "POST", `/api/charges/gerar?periodo=${PERIODO}`);
check("gerar outra vez responde", g1.status === 201 || g1.status === 200, `${g1.status}`);
check("e não cria nada de novo para quem já tem", g1.body?.jaExistiam >= 2, JSON.stringify(g1.body));

const quantas = (await db.query(
  `SELECT count(*)::int n FROM "Charge" WHERE "athleteId" = $1 AND period = $2`,
  [idComPreco, PERIODO],
)).rows[0].n;
check("continua a haver uma só", quantas === 1, `${quantas}`);

const aindaPaga = (await db.query(
  `SELECT status FROM "Charge" WHERE "athleteId" = $1 AND period = $2`,
  [idComPreco, PERIODO],
)).rows[0].status;
check("e continua marcada como paga — a geração não reescreve", aindaPaga === "SETTLED", aindaPaga);

console.log("\n=== O ajuste individual manda ===");
const individual = await call(direcao, "PUT", `/api/athletes/${idSemPreco}/fee`, { amountCents: 1000 });
check("a direção ajusta um atleta em concreto", individual.status === 200, `${individual.status}`);

/*
 * A mensalidade deste mês já existia a 35 € e **passa** a valer o ajuste.
 *
 * Isto verificava o contrário — que ficava como estava, "pela mesma regra da
 * idempotência". A regra estava confundida com outra: `gerarCobrancas` é
 * idempotente porque só *cria* o que falta, e isso continua igual. Mas definir um
 * preço com "aplicar neste mês" não é gerar: é dizer quanto se cobra. Deixar a
 * mensalidade a 35 € punha a ficha do atleta a dizer 10 €, a tabela das
 * mensalidades a dizer 35 € e a app do pai a dizer 35 € — três ecrãs, dois
 * números, nenhum aviso. Foi assim que um clube em produção deu por isto.
 *
 * O que continua intocável é o que já não se pode mudar: pago, anulado, ou com
 * um pagamento a caminho. Ver `reprecificarCobrancas`.
 */
const reprecada = (await db.query(
  `SELECT "amountCents", status FROM "Charge" WHERE "athleteId" = $1 AND period = $2`,
  [idSemPreco, PERIODO],
)).rows[0];
check("a mensalidade já emitida passa a valer o ajuste", reprecada?.amountCents === 1000, `${reprecada?.amountCents}`);
check("e continua por pagar", reprecada?.status === "OPEN", reprecada?.status);
check("o servidor diz que a actualizou", individual.body?.reprecadas?.actualizadas === 1, JSON.stringify(individual.body?.reprecadas));

/*
 * E a que já foi paga não se mexe, no mesmo gesto.
 *
 * `idComPreco` tem a mensalidade deste mês marcada como paga umas linhas acima.
 * É a contraprova que dá sentido à verificação anterior: sem ela, "reprecifica"
 * lia-se como "reescreve tudo".
 */
const paga = await call(direcao, "PUT", `/api/athletes/${idComPreco}/fee`, { amountCents: 1200 });
check("ajustar quem já pagou não falha", paga.status === 200, `${paga.status}`);
const intacta = (await db.query(
  `SELECT "amountCents", status FROM "Charge" WHERE "athleteId" = $1 AND period = $2`,
  [idComPreco, PERIODO],
)).rows[0];
check("mas a mensalidade paga fica pelo valor que foi pago", intacta?.amountCents !== 1200, `${intacta?.amountCents}`);
check("e continua paga", intacta?.status === "SETTLED", intacta?.status);

/*
 * E desfaz-se o ajuste, para este atleta voltar ao preço da equipa.
 *
 * O que vem a seguir mede a diferença entre quem tem ajuste individual e quem
 * não tem, e este é o "quem não tem". Deixá-lo ajustado aqui fazia a verificação
 * seguinte falhar por causa desta, e não por causa do que ela mede.
 */
await call(direcao, "DELETE", `/api/athletes/${idComPreco}/fee`);

// Mas num mês por emitir, o ajuste é o que vale.
const proximo = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 1);
const PERIODO_SEG = `${proximo.getFullYear()}-${String(proximo.getMonth() + 1).padStart(2, "0")}`;
await call(direcao, "POST", `/api/charges/gerar?periodo=${PERIODO_SEG}`);
const doProximo = (await db.query(
  `SELECT "amountCents" FROM "Charge" WHERE "athleteId" = $1 AND period = $2`,
  [idSemPreco, PERIODO_SEG],
)).rows[0];
check("e no mês seguinte vale o ajuste individual", doProximo?.amountCents === 1000, JSON.stringify(doProximo));

const doOutro = (await db.query(
  `SELECT "amountCents" FROM "Charge" WHERE "athleteId" = $1 AND period = $2`,
  [idComPreco, PERIODO_SEG],
)).rows[0];
check("e o outro continua no preço da equipa", doOutro?.amountCents === 3500, JSON.stringify(doOutro));

console.log("\n=== Um mês em que não se cobra ===");
/*
 * `Academy.billingMonths` existe porque muitas academias não cobram Agosto. Um
 * período fora do calendário do clube não é uma dívida por pagar — é um mês em
 * que não se cobra, e não deve gerar linha nenhuma.
 *
 * Fecha-se no **clube** e já não em cada plano: era essa a correcção da migração
 * `meses_de_cobranca`. Antes, um atleta com ajuste individual escapava ao
 * calendário da equipa — tinha um plano próprio, com os meses por omissão — e
 * continuava a ser cobrado num mês que o clube tinha fechado.
 */
await porCalendario([1, 2, 3]);
const foraDoMes = `${hoje.getFullYear()}-07`;
const gFora = await call(direcao, "POST", `/api/charges/gerar?periodo=${foraDoMes}`);
const nadaEmJulho = (await db.query(
  `SELECT count(*)::int n FROM "Charge" c JOIN "Athlete" a ON a.id = c."athleteId"
    WHERE a.name LIKE 'ZZ %' AND c.period = $1`,
  [foraDoMes],
)).rows[0].n;
check("um mês fora do calendário do clube não gera nada", nadaEmJulho === 0, `${nadaEmJulho}`);
check("e diz quantos ficaram de fora por isso", (gFora.body?.foraDoMes ?? 0) >= 1, JSON.stringify(gFora.body));

console.log("\n=== Quem entra num mês fechado é cobrado à mesma ===");
/*
 * A excepção que a direcção pediu, e a razão dela.
 *
 * O calendário responde a "que meses é que o clube cobra a quem já cá está".
 * Não responde à inscrição: um miúdo que entra a 27 de Agosto treina em Agosto,
 * e a mensalidade tem de aparecer — mesmo num clube que não cobra Agosto ao
 * resto do plantel. Se não for para cobrar, anula-se; uma anulação registada
 * vale mais do que uma cobrança que nunca existiu.
 */
await porCalendario([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].filter((m) => m !== MES));

const tardio = await call(direcao, "POST", "/api/athletes", {
  name: "ZZ Atleta Fora do Calendário",
  birthdate: "2012-09-09",
  taxId: "913333333",
  teamId: "zz_t_sem_preco",
});
check("inscreve num mês que o clube não cobra", tardio.status === 201 || tardio.status === 200, `${tardio.status}`);

const cobrancaTardia = (await db.query(
  `SELECT "amountCents", status, "dueDate"::date::text AS due FROM "Charge"
    WHERE "athleteId" = $1 AND period = $2`,
  [tardio.body?.id, PERIODO],
)).rows[0];
check(
  "e a mensalidade do mês nasce à mesma, por pagar",
  cobrancaTardia?.amountCents === 3500 && cobrancaTardia?.status === "OPEN",
  JSON.stringify(cobrancaTardia),
);

/*
 * E não nasce vencida.
 *
 * Inscrever alguém depois do dia de vencimento e emitir-lhe uma mensalidade já
 * fora do prazo era pô-la a vermelho no segundo em que nasce — e a caminho de
 * um lembrete automático à família nessa mesma noite. Quem chega tarde paga no
 * vencimento seguinte, sem deixar de ser a mensalidade deste mês.
 */
const venceHoje = new Date(cobrancaTardia?.due ?? 0) >= new Date(new Date().toISOString().slice(0, 10));
check("e não nasce vencida", venceHoje, `vence a ${cobrancaTardia?.due}`);

// Que o calendário continua a valer para quem **não** entrou neste mês está
// provado no bloco de Julho, acima: lá ninguém se inscreveu, e não nasceu nada.

/*
 * Reabrir o calendário antes de seguir.
 *
 * O bloco seguinte verifica que um atleta **em pausa** não gera mensalidade — e
 * com o calendário fechado ninguém geraria nada, por isso o teste passaria sem
 * provar coisa nenhuma. Um verde falso é pior do que um vermelho.
 */
await porCalendario(MESES_DO_TESTE);

console.log("\n=== Permissões ===");
const coach = await login("treinador@lifeclub.pt");
const porTreinador = await call(coach, "POST", `/api/charges/gerar?periodo=${PERIODO}`);
check("um treinador não gera mensalidades (403)", porTreinador.status === 403, `${porTreinador.status}`);

const periodoMau = await call(direcao, "POST", "/api/charges/gerar?periodo=agosto");
check("um período mal escrito é recusado (400)", periodoMau.status === 400, `${periodoMau.status}`);

console.log("\n=== Atletas em pausa ===");
/*
 * Quem está em pausa não gera mensalidade — é essa a diferença entre pausar e
 * apagar, e cobrar a quem está parado é o tipo de erro que custa um telefonema.
 */
await db.query(`UPDATE "Athlete" SET status = 'PAUSED' WHERE id = $1`, [idComPreco]);
await db.query(`DELETE FROM "Charge" WHERE "athleteId" = $1 AND period = $2`, [idComPreco, PERIODO_SEG]);
await call(direcao, "POST", `/api/charges/gerar?periodo=${PERIODO_SEG}`);
const pausado = (await db.query(
  `SELECT count(*)::int n FROM "Charge" WHERE "athleteId" = $1 AND period = $2`,
  [idComPreco, PERIODO_SEG],
)).rows[0].n;
check("um atleta em pausa não gera mensalidade", pausado === 0, `${pausado}`);

console.log("\n=== Limpeza ===");
await limpar();
// O calendário do clube de demonstração volta ao que era — isto mexeu numa
// definição real, e deixá-la alterada estragava a academia para o próximo.
await reporCalendario();
await db.end();
console.log("  feito");

console.log(`\n${ok} passaram, ${bad} falharam`);
process.exit(bad === 0 ? 0 : 1);

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

/*
 * O que tem de ser reposto mesmo que o teste rebente a meio.
 *
 * Um `fetch` que falha (a API a reiniciar, por exemplo) deitava o processo
 * abaixo entre "fechar um mês" e "repor o calendário", e o Life Club ficava com
 * o calendário de teste. A corrida seguinte lia esse estado como o original e
 * "repunha-o". Agora cada passo que mexe no clube regista aqui como se desfaz,
 * e um pedido que falha desfaz tudo antes de sair.
 */
const reposicoes = [];
const reporTudo = async () => {
  for (const f of reposicoes.splice(0).reverse()) await f().catch((e) => console.error("  (reposição falhou)", e.message));
};
const abortar = async (e) => {
  console.error("\n  O teste rebentou a meio — a repor o Life Club antes de sair.", e?.message ?? e);
  await reporTudo();
  await db.end().catch(() => undefined);
  process.exit(1);
};

const call = async (token, method, p, body) => {
  let r;
  try {
    r = await fetch(API + p, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "x-academy-slug": "life-club",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    return abortar(e);
  }
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
reposicoes.push(reporCalendario);

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

console.log("\n=== Quem entra num mês fechado não é cobrado nesse mês ===");
/*
 * Havia aqui uma excepção: quem se inscrevia num mês fechado era cobrado nesse
 * mês, "calendário ou não". A intenção era o miúdo que entra a 27 de agosto.
 * Na prática apanhou três clubes inteiros: `joinedAt` nasce como a data em que
 * o atleta é criado na plataforma, e um clube que carrega o plantel em agosto
 * entra todo em agosto. Ficaram 62 mensalidades de um mês que esses clubes
 * não cobram, com o ecrã das definições a prometer que "um mês desligado não
 * gera mensalidades". O ecrã tinha razão.
 *
 * Quem quiser cobrar a um recém-chegado um mês fechado tem a cobrança avulsa.
 */
await porCalendario([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].filter((m) => m !== MES));

const tardio = await call(direcao, "POST", "/api/athletes", {
  name: "ZZ Atleta Fora do Calendário",
  birthdate: "2012-09-09",
  taxId: "913333333",
  teamId: "zz_t_sem_preco",
});
check("inscreve num mês que o clube não cobra", tardio.status === 201 || tardio.status === 200, `${tardio.status}`);

const contarDoTardio = async () => (await db.query(
  `SELECT count(*)::int n FROM "Charge" WHERE "athleteId" = $1 AND period = $2`,
  [tardio.body?.id, PERIODO],
)).rows[0].n;
check("e não nasce mensalidade nenhuma desse mês", (await contarDoTardio()) === 0);

// Nem pela geração explícita: o calendário manda para toda a gente.
const gerarFechado = await call(direcao, "POST", `/api/charges/gerar?periodo=${PERIODO}`);
const calendarioNaAltura = (await db.query(`SELECT "billingMonths" FROM "Academy" WHERE id = $1`, [academyId])).rows[0].billingMonths;
check(
  "nem ao gerar o mês à mão",
  (await contarDoTardio()) === 0,
  `resposta ${JSON.stringify(gerarFechado.body)} · calendário ${JSON.stringify(calendarioNaAltura)} · atleta ${tardio.body?.id}`,
);

/*
 * Com o mês aberto, a mensalidade nasce, e não nasce vencida.
 *
 * Inscrever alguém depois do dia de vencimento e emitir-lhe uma mensalidade já
 * fora do prazo era pô-la a vermelho no segundo em que nasce, e a caminho de
 * um lembrete automático à família nessa mesma noite. Quem chega tarde paga no
 * vencimento seguinte, sem deixar de ser a mensalidade deste mês.
 */
await porCalendario(MESES_DO_TESTE);
await call(direcao, "POST", `/api/charges/gerar?periodo=${PERIODO}`);
const cobrancaTardia = (await db.query(
  `SELECT "amountCents", status, "dueDate"::date::text AS due FROM "Charge"
    WHERE "athleteId" = $1 AND period = $2`,
  [tardio.body?.id, PERIODO],
)).rows[0];
check(
  "com o mês aberto, a mensalidade nasce por pagar",
  cobrancaTardia?.amountCents === 3500 && cobrancaTardia?.status === "OPEN",
  JSON.stringify(cobrancaTardia),
);
const venceHoje = new Date(cobrancaTardia?.due ?? 0) >= new Date(new Date().toISOString().slice(0, 10));
check("e não nasce vencida", venceHoje, `vence a ${cobrancaTardia?.due}`);

console.log("\n=== Desligar um mês esvazia-o ===");
/*
 * O outro lado da mesma regra. Um mês que o clube deixa de cobrar deixa de
 * existir: as mensalidades desaparecem — por pagar, anuladas, e marcadas como
 * pagas à mão. Só ficam as que têm dinheiro que passou pela euPago. E é pelo
 * endpoint das definições, que é por onde o clube o faz.
 *
 * Isto toca o clube de demonstração, não só os atletas ZZ. Por isso:
 * - desliga-se **só** o mês corrente, e liga-se tudo o resto — gravar o
 *   calendário esvazia todos os meses desligados da época, e com meia dúzia
 *   deles fechados apagava a época inteira do Life Club;
 * - guardam-se as linhas inteiras do mês, em todos os estados, e os pagamentos
 *   delas (em JSON feito pelo Postgres, para as datas não passarem pelo fuso do
 *   node), e repõem-se no fim — ou a meio, se o teste rebentar.
 */
const TODOS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const guardadas = (await db.query(
  `SELECT row_to_json(c) AS linha FROM "Charge" c
    WHERE c."academyId" = $1 AND c.period = $2 AND c.kind = 'FEE'`,
  [academyId, PERIODO],
)).rows.map((r) => r.linha);
const pagamentosGuardados = (await db.query(
  `SELECT row_to_json(p) AS linha FROM "Payment" p JOIN "Charge" c ON c.id = p."chargeId"
    WHERE c."academyId" = $1 AND c.period = $2 AND c.kind = 'FEE'`,
  [academyId, PERIODO],
)).rows.map((r) => r.linha);
const reporMes = async () => {
  await db.query(`DELETE FROM "Charge" WHERE "academyId" = $1 AND period = $2 AND kind = 'FEE'`, [academyId, PERIODO]);
  await db.query(`INSERT INTO "Charge" SELECT * FROM json_populate_recordset(NULL::"Charge", $1::json)`, [JSON.stringify(guardadas)]);
  await db.query(`INSERT INTO "Payment" SELECT * FROM json_populate_recordset(NULL::"Payment", $1::json)`, [JSON.stringify(pagamentosGuardados)]);
};
reposicoes.push(reporMes);

/* O que a regra manda ficar: dinheiro online, ou uma referência ainda por pagar. */
const ficam = (await db.query(
  `SELECT count(*)::int n FROM "Charge" c
    WHERE c."academyId" = $1 AND c.period = $2 AND c.kind = 'FEE'
      AND EXISTS (SELECT 1 FROM "Payment" p WHERE p."chargeId" = c.id AND (
        p.status = 'PENDING' OR (p.provider <> 'manual' AND p.status IN ('PAID', 'PROCESSING', 'REFUNDED'))))`,
  [academyId, PERIODO],
)).rows[0].n;
const estadosZZ = async () => Object.fromEntries((await db.query(
  `SELECT c.status, count(*)::int n FROM "Charge" c JOIN "Athlete" a ON a.id = c."athleteId"
    WHERE a.name LIKE 'ZZ %' AND c.period = $1 GROUP BY c.status`,
  [PERIODO],
)).rows.map((r) => [r.status, r.n]));
const antes = await estadosZZ();
check("há mensalidades por pagar para retirar", (antes.OPEN ?? 0) >= 1, JSON.stringify(antes));

const fechar = await call(direcao, "PATCH", "/api/pagamentos", { months: TODOS.filter((m) => m !== MES) });
check("desligar o mês corrente responde", fechar.status === 200, `${fechar.status} ${JSON.stringify(fechar.body)}`);
check("e diz quantas retirou", fechar.body?.apagadas === guardadas.length - ficam, `${fechar.body?.apagadas} vs ${guardadas.length - ficam}`);

const depois = await estadosZZ();
check("nenhuma ficou por pagar", (depois.OPEN ?? 0) === 0, JSON.stringify(depois));
check("e nenhuma ficou como anulada: desapareceram", (depois.VOID ?? 0) === 0, JSON.stringify(depois));
check("as marcadas como pagas à mão também saem", (depois.SETTLED ?? 0) === 0, JSON.stringify(depois));

// Voltar a ligar o mês emite-as outra vez: o calendário mudou, as mensalidades seguem-no.
const reabrir = await call(direcao, "PATCH", "/api/pagamentos", { months: TODOS });
check("ligar o mês outra vez volta a emitir", (reabrir.body?.cobrancas?.criadas ?? 0) >= (antes.OPEN ?? 0), JSON.stringify(reabrir.body));

// O Life Club volta exactamente ao que era: o mês reposto linha a linha, e o calendário do teste.
reposicoes.splice(reposicoes.indexOf(reporMes), 1);
await reporMes();
await porCalendario(MESES_DO_TESTE);

console.log("\n=== Ligar um mês que já passou não o emite ===");
/*
 * O caso de produção: um clube tinha Agosto desligado (é o calendário por
 * omissão) e ligou-o a meio de Setembro. Gravar o calendário emite o mês
 * corrente e não emite meses que já passaram, e é de propósito: cobrar um mês
 * que passou é uma decisão, e toma-se no "Lançar mensalidade", a quem se quer.
 *
 * O mês que já passou é o primeiro da época (Agosto). Em Agosto não há mês
 * passado na época, e o bloco não tem o que provar.
 *
 * Toca o Life Club: lançar "a todos" cria mensalidades e avisos ao plantel
 * inteiro. Guarda-se Agosto antes e repõe-se no fim; o que o teste criar noutros
 * meses sai pela data de criação, e os avisos também. Nenhuma conta do Life
 * Club tem push, por isso os avisos ficam só na base.
 */
if (MES === 8) {
  console.log("  (Agosto: não há mês passado nesta época para testar)");
} else {
  const anoDaEpoca = MES >= 8 ? hoje.getFullYear() : hoje.getFullYear() - 1;
  const PASSADO = `${anoDaEpoca}-08`;
  const MAIO = `${anoDaEpoca + 1}-05`;
  const JUNHO = `${anoDaEpoca + 1}-06`;
  const ABRIL = `${anoDaEpoca + 1}-04`;
  /*
   * O marco em texto, em UTC, e comparado como `timestamp`.
   *
   * `createdAt` é `timestamp` sem fuso. Um `Date` do node-pg vai com o fuso de
   * Lisboa, o Postgres descarta-o, e o marco ficava uma hora à frente: o
   * restauro por data não apagava nada e as linhas do teste ficavam no clube.
   */
  const marco = (await db.query(`SELECT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS.MS') AS t`)).rows[0].t;
  const agostoGuardado = (await db.query(
    `SELECT row_to_json(c) AS linha FROM "Charge" c WHERE c."academyId" = $1 AND c.period = $2 AND c.kind = 'FEE'`,
    [academyId, PASSADO],
  )).rows.map((r) => r.linha);
  const pagamentosDeAgosto = (await db.query(
    `SELECT row_to_json(p) AS linha FROM "Payment" p JOIN "Charge" c ON c.id = p."chargeId"
      WHERE c."academyId" = $1 AND c.period = $2 AND c.kind = 'FEE'`,
    [academyId, PASSADO],
  )).rows.map((r) => r.linha);
  const reporAgosto = async () => {
    await db.query(`DELETE FROM "Charge" WHERE "academyId" = $1 AND period = $2 AND kind = 'FEE'`, [academyId, PASSADO]);
    await db.query(
      `DELETE FROM "Charge" WHERE "academyId" = $1 AND period = ANY($2::text[]) AND kind = 'FEE' AND "createdAt" >= $3::timestamp`,
      [academyId, [PERIODO, ABRIL, MAIO, JUNHO], marco],
    );
    await db.query(`INSERT INTO "Charge" SELECT * FROM json_populate_recordset(NULL::"Charge", $1::json)`, [JSON.stringify(agostoGuardado)]);
    await db.query(`INSERT INTO "Payment" SELECT * FROM json_populate_recordset(NULL::"Payment", $1::json)`, [JSON.stringify(pagamentosDeAgosto)]);
    await db.query(
      `DELETE FROM "Notification" WHERE "academyId" = $1 AND "createdAt" >= $2::timestamp AND title = 'Nova mensalidade'`,
      [academyId, marco],
    );
    await porCalendario(MESES_DO_TESTE);
  };
  reposicoes.push(reporAgosto);

  // Agosto desligado, directamente na base: é o estado de partida, não o que se testa.
  await porCalendario([1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12]);
  await db.query(
    `DELETE FROM "Charge" c USING "Athlete" a WHERE a.id = c."athleteId" AND a.name LIKE 'ZZ %' AND c.period = $1`,
    [PASSADO],
  );
  const doMesDosZZ = async (period) => (await db.query(
    `SELECT a.id, c.status, c."amountCents" FROM "Charge" c JOIN "Athlete" a ON a.id = c."athleteId"
      WHERE a.name LIKE 'ZZ %' AND c.period = $1`,
    [period],
  )).rows;

  const ligar = await call(direcao, "PATCH", "/api/pagamentos", { months: TODOS, aplicarEm: "atual" });
  check("ligar Agosto já nesta época responde", ligar.status === 200, `${ligar.status} ${JSON.stringify(ligar.body).slice(0, 160)}`);
  check("e não emite Agosto, que já passou", (await doMesDosZZ(PASSADO)).length === 0, JSON.stringify(await doMesDosZZ(PASSADO)));

  console.log("\n=== Lançar mensalidade: atletas, equipas ou todos ===");
  /* Os atletas activos da equipa ZZ com preço (3500), que é o que "por equipa" deve apanhar. */
  const daEquipa = (await db.query(
    `SELECT a.id FROM "Athlete" a JOIN "TeamMembership" tm ON tm."athleteId" = a.id
      WHERE tm."teamId" = 'zz_t_sem_preco' AND a.status = 'ACTIVE'`,
  )).rows.map((r) => r.id);
  check("a equipa ZZ tem atletas activos", daEquipa.length >= 1, `${daEquipa.length}`);

  const porEquipa = await call(direcao, "POST", "/api/charges/mensalidade", {
    alvo: "equipas", teamIds: ["zz_t_sem_preco"], periods: [PASSADO],
  });
  check("lançar Agosto a uma equipa responde", porEquipa.status === 200 || porEquipa.status === 201, `${porEquipa.status} ${JSON.stringify(porEquipa.body).slice(0, 160)}`);
  const agostoDaEquipa = (await doMesDosZZ(PASSADO)).filter((c) => daEquipa.includes(c.id));
  check("cada atleta da equipa fica com Agosto", agostoDaEquipa.length === daEquipa.length, `${agostoDaEquipa.length} de ${daEquipa.length}`);
  /*
   * Ao preço de cada um: o da equipa (3500), ou o ajuste individual de quem o
   * tem — o bloco "O ajuste individual manda" deixou um atleta a 1000.
   */
  const individuais = Object.fromEntries((await db.query(
    `SELECT DISTINCT ON (e."athleteId") e."athleteId", p."amountCents" - e."discountCents" AS valor
       FROM "Enrollment" e JOIN "SubscriptionPlan" p ON p.id = e."planId"
      WHERE e."athleteId" = ANY($1::text[]) AND p."teamId" IS NULL AND p."isActive"
        AND (e."endsOn" IS NULL OR e."endsOn" >= now())
      ORDER BY e."athleteId", e."startsOn" DESC`,
    [daEquipa],
  )).rows.map((r) => [r.athleteId, r.valor]));
  check(
    "ao preço de cada atleta, por pagar",
    agostoDaEquipa.every((c) => c.status === "OPEN" && c.amountCents === (individuais[c.id] ?? 3500)),
    JSON.stringify({ agostoDaEquipa, individuais }),
  );
  check("e a resposta conta-os", porEquipa.body?.criadas === daEquipa.length && porEquipa.body?.atletas === daEquipa.length, JSON.stringify(porEquipa.body));

  const outraVez = await call(direcao, "POST", "/api/charges/mensalidade", {
    alvo: "equipas", teamIds: ["zz_t_sem_preco"], periods: [PASSADO],
  });
  check("repetir não duplica", outraVez.body?.criadas === 0, JSON.stringify(outraVez.body));
  check("e diz em que mês já havia", outraVez.body?.jaExistiam?.includes(PASSADO), JSON.stringify(outraVez.body));

  /*
   * Lançar como pagas um mês que já existe por pagar marca-o como pago.
   *
   * O caso de produção: a emissão automática tinha lançado Setembro a todos, e
   * "lançar Setembro como pago" respondia "Não foi lançada nenhuma mensalidade".
   * Uma das mensalidades tem uma referência Multibanco por pagar: essa não se
   * mexe, que o dinheiro ainda pode chegar pela euPago.
   */
  const agostoAntes = (await db.query(
    `SELECT c.id, c."amountCents" FROM "Charge" c WHERE c."athleteId" = ANY($1::text[]) AND c.period = $2 ORDER BY c.id`,
    [daEquipa, PASSADO],
  )).rows;
  const comReferencia = agostoAntes[0].id;
  await db.query(
    `INSERT INTO "Payment" (id, "chargeId", "amountCents", method, status, provider, reference, "expiresAt", "updatedAt")
     VALUES ('zz_pay_ref', $1, 3500, 'MULTIBANCO', 'PENDING', 'eupago', '999999999', now() + interval '3 days', now())`,
    [comReferencia],
  );
  const marcarExistentes = await call(direcao, "POST", "/api/charges/mensalidade", {
    alvo: "equipas", teamIds: ["zz_t_sem_preco"], periods: [PASSADO], estado: "SETTLED", metodo: "CASH",
  });
  check("lançar como pagas um mês que já existe responde", marcarExistentes.status === 200 || marcarExistentes.status === 201, `${marcarExistentes.status}`);
  check(
    "marca como pagas as que estavam por pagar",
    marcarExistentes.body?.marcadas === daEquipa.length - 1 && marcarExistentes.body?.criadas === 0,
    JSON.stringify(marcarExistentes.body),
  );
  check("e deixa de fora a que tem um pagamento online a decorrer", marcarExistentes.body?.emPagamento === 1, JSON.stringify(marcarExistentes.body));
  const agostoDepois = (await db.query(
    `SELECT c.id, c.status, c."amountCents",
            (SELECT count(*)::int FROM "Payment" p WHERE p."chargeId" = c.id AND p.provider = 'manual' AND p.method = 'CASH' AND p.status = 'PAID') AS manuais
       FROM "Charge" c WHERE c."athleteId" = ANY($1::text[]) AND c.period = $2 ORDER BY c.id`,
    [daEquipa, PASSADO],
  )).rows;
  check(
    "ficam pagas, com o pagamento manual e o mesmo valor",
    agostoDepois.filter((c) => c.id !== comReferencia).every((c, i) =>
      c.status === "SETTLED" && c.manuais === 1 && c.amountCents === agostoAntes.filter((x) => x.id !== comReferencia)[i].amountCents),
    JSON.stringify(agostoDepois),
  );
  check("a da referência continua por pagar", agostoDepois.find((c) => c.id === comReferencia)?.status === "OPEN", JSON.stringify(agostoDepois));
  await db.query(`DELETE FROM "Payment" WHERE id = 'zz_pay_ref'`);

  const denovoPagas = await call(direcao, "POST", "/api/charges/mensalidade", {
    alvo: "equipas", teamIds: ["zz_t_sem_preco"], periods: [PASSADO], estado: "SETTLED", metodo: "CASH",
  });
  check(
    "repetir não duplica pagamentos e diz em que mês já estavam pagas",
    denovoPagas.body?.jaPagas?.includes(PASSADO) && denovoPagas.body?.marcadas === 1,
    JSON.stringify(denovoPagas.body),
  );

  /* Atletas escolhidos, com valor fixo. */
  const escolhidos = daEquipa.slice(0, 2);
  const fixo = await call(direcao, "POST", "/api/charges/mensalidade", {
    alvo: "atletas", athleteIds: escolhidos, amountCents: 2000, periods: [MAIO],
  });
  check("lançar a atletas escolhidos com valor fixo responde", fixo.status === 200 || fixo.status === 201, `${fixo.status} ${JSON.stringify(fixo.body).slice(0, 160)}`);
  const deMaio = (await doMesDosZZ(MAIO)).filter((c) => escolhidos.includes(c.id));
  check("só os escolhidos, pelo valor fixo", deMaio.length === escolhidos.length && deMaio.every((c) => c.amountCents === 2000), JSON.stringify(deMaio));

  /* Uma equipa sem preço: ninguém é cobrado, e a resposta diz quem ficou de fora. */
  await db.query(
    `INSERT INTO "Team" (id, "academyId", "sportId", "seasonId", name, "maxAge", "updatedAt")
     VALUES ('zz_t_nada', $1, $2, $3, 'ZZ Equipa Nada', 13, NOW())`,
    [academyId, modelo.sportId, modelo.seasonId],
  );
  await db.query(
    `INSERT INTO "Athlete" (id, "academyId", name, birthdate, status, "joinedAt", "updatedAt")
     VALUES ('zz_a_nada', $1, 'ZZ Atleta Nada', '2013-01-01', 'ACTIVE', now(), now())`,
    [academyId],
  );
  await db.query(`INSERT INTO "TeamMembership" (id, "teamId", "athleteId") VALUES ('zz_tm_nada', 'zz_t_nada', 'zz_a_nada')`);
  const semPrecoNenhum = await call(direcao, "POST", "/api/charges/mensalidade", {
    alvo: "equipas", teamIds: ["zz_t_nada"], periods: [MAIO],
  });
  check("uma equipa sem preço não é cobrada", semPrecoNenhum.body?.criadas === 0, JSON.stringify(semPrecoNenhum.body));
  check("e diz quem ficou de fora", semPrecoNenhum.body?.semPreco?.some((a) => a.id === "zz_a_nada"), JSON.stringify(semPrecoNenhum.body));
  await db.query(`DELETE FROM "TeamMembership" WHERE id = 'zz_tm_nada'`);

  /* Todos: o plantel activo inteiro, ao preço de cada um. */
  const activosComPreco = daEquipa.length;
  const todos = await call(direcao, "POST", "/api/charges/mensalidade", { alvo: "todos", periods: [JUNHO] });
  check("lançar a todos responde", todos.status === 200 || todos.status === 201, `${todos.status} ${JSON.stringify(todos.body).slice(0, 160)}`);
  const deJunho = (await doMesDosZZ(JUNHO)).filter((c) => daEquipa.includes(c.id));
  check("apanha os atletas da equipa ZZ", deJunho.length === activosComPreco, `${deJunho.length} de ${activosComPreco}`);
  check("e o atleta sem preço aparece em semPreco", todos.body?.semPreco?.some((a) => a.id === "zz_a_nada"), JSON.stringify(todos.body?.semPreco ?? []).slice(0, 160));

  /* Lançadas como pagas: para registar, sem pedir nada à família. */
  const avisosDoMes = async (mes) => (await db.query(
    `SELECT count(*)::int n FROM "Notification" n JOIN "Charge" c ON c.id = n.payload->>'chargeId'
      WHERE n."academyId" = $1 AND n."createdAt" >= $2::timestamp AND c.period = $3`,
    [academyId, marco, mes],
  )).rows[0].n;
  check("lançar por pagar avisa as famílias (Junho)", (await avisosDoMes(JUNHO)) >= 1, `${await avisosDoMes(JUNHO)}`);

  const pagasATodos = await call(direcao, "POST", "/api/charges/mensalidade", {
    alvo: "todos", periods: [ABRIL], estado: "SETTLED", metodo: "MBWAY",
  });
  check("lançar pagas a todos responde", pagasATodos.status === 200 || pagasATodos.status === 201, `${pagasATodos.status} ${JSON.stringify(pagasATodos.body).slice(0, 160)}`);
  const deAbril = (await db.query(
    `SELECT c.id, c.status, c."settledAt" IS NOT NULL AS liquidada,
            (SELECT count(*)::int FROM "Payment" p WHERE p."chargeId" = c.id AND p.provider = 'manual' AND p.status = 'PAID' AND p.method = 'MBWAY') AS manuais
       FROM "Charge" c WHERE c."academyId" = $1 AND c.period = $2 AND c."createdAt" >= $3::timestamp`,
    [academyId, ABRIL, marco],
  )).rows;
  check("nascem pagas", deAbril.length >= 1 && deAbril.every((c) => c.status === "SETTLED" && c.liquidada), JSON.stringify(deAbril.slice(0, 3)));
  check("com o registo de pagamento manual por MB WAY, um por mensalidade", deAbril.every((c) => c.manuais === 1), JSON.stringify(deAbril.slice(0, 3)));
  check("e a família não é avisada", (await avisosDoMes(ABRIL)) === 0 && pagasATodos.body?.avisados === 0, `${await avisosDoMes(ABRIL)} avisos, avisados=${pagasATodos.body?.avisados}`);

  /* Marcar como paga na tabela, dizendo como: o método fica no pagamento e chega à lista. */
  const umaDeMaio = (await db.query(
    `SELECT c.id FROM "Charge" c WHERE c."athleteId" = $1 AND c.period = $2`,
    [escolhidos[0], MAIO],
  )).rows[0]?.id;
  const marcar = await call(direcao, "PATCH", `/api/charges/${umaDeMaio}/status`, { status: "SETTLED", method: "CARD" });
  check("marcar como paga com o método responde", marcar.status === 200, `${marcar.status} ${JSON.stringify(marcar.body).slice(0, 120)}`);
  const pagamentoDaTabela = (await db.query(
    `SELECT method, provider, status FROM "Payment" WHERE "chargeId" = $1`, [umaDeMaio],
  )).rows;
  check(
    "fica um pagamento manual por cartão",
    pagamentoDaTabela.length === 1 && pagamentoDaTabela[0].method === "CARD" && pagamentoDaTabela[0].provider === "manual",
    JSON.stringify(pagamentoDaTabela),
  );
  const naLista = ((await call(direcao, "GET", "/api/charges")).body ?? []).find((c) => c.id === umaDeMaio);
  check("a lista traz o método e o dia do pagamento", naLista?.paidMethod === "CARD" && Boolean(naLista?.paidAt), JSON.stringify(naLista ?? {}).slice(0, 200));

  const metodoOnline = await call(direcao, "PATCH", `/api/charges/${umaDeMaio}/status`, { status: "SETTLED", method: "MULTIBANCO" });
  check("um método que só chega pela euPago é recusado (400)", metodoOnline.status === 400, `${metodoOnline.status}`);

  const semAlvo = await call(direcao, "POST", "/api/charges/mensalidade", { alvo: "equipas", teamIds: [], periods: [JUNHO] });
  check("equipas sem nenhuma escolhida é recusado (400)", semAlvo.status === 400, `${semAlvo.status}`);

  reposicoes.splice(reposicoes.indexOf(reporAgosto), 1);
  await reporAgosto();
}

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

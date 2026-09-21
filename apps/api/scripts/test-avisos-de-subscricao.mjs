#!/usr/bin/env node
/**
 * O aviso mensal de pagamento da subscrição.
 *
 * ## O que isto prova
 *
 * Que quem representa o clube recebe, todos os meses, o aviso da mensalidade de
 * uso da plataforma, no dia em que aceitou as condições.
 *
 *  1. **A conta dos meses** (`subscription/ciclo.ts`), que é onde mora o
 *     problema: quem assina a 31 de Janeiro recebe a 28 de Fevereiro e volta ao
 *     dia 31 em Março; quem assina a 29 de Fevereiro recebe a 28 nos anos
 *     normais. Sem drift: o dia encolhe no mês curto e não fica encolhido.
 *  2. **Um aviso por período**, garantido pela base: correr a varredura duas
 *     vezes não manda dois emails.
 *  3. **Para quem vai**: o responsável do clube — o mais antigo com poderes para
 *     o representar —, com o período e o valor da ordem assinada.
 *  4. **O que fica de fora**: clubes sem ordem assinada, subscrições canceladas,
 *     períodos anteriores ao início do contrato, e o passado longínquo (a
 *     janela de recuperação).
 *
 * ## Porque é que ninguém recebe email aqui
 *
 * A API de teste corre **sem chave de correio** (`MAIL_API_KEY=`), e o serviço
 * de email responde "por configurar" sem tocar na rede. O aviso fica gravado com
 * o endereço a quem se destinava e com a nota de que não saiu — que é
 * exactamente o que se quer verificar sem mandar correio a ninguém.
 *
 * Uso:
 *   MAIL_API_KEY= PORT=3012 npm run start:dev --workspace=@academia/api
 *   API=http://127.0.0.1:3012 node scripts/test-avisos-de-subscricao.mjs
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/*
 * A conta dos meses vem do código compilado, e não do `.ts`.
 *
 * O `ciclo.ts` importa `common/fuso` sem extensão — como todo o resto da API —, e
 * o Node não resolve isso. O `dist` está sempre fresco: quem corre este teste
 * tem a API a correr, e é ela que o escreve. Assim testa-se o **mesmo** código
 * que o servidor executa, e não uma cópia da conta escrita aqui.
 */
const ciclo = await import(new URL("../dist/subscription/ciclo.js", import.meta.url).href).catch(() => {
  console.error("Falta o dist/. Arranca a API de teste primeiro — ver o cabeçalho deste ficheiro.");
  process.exit(1);
});

const env = (k) => {
  const l = readFileSync(path.join(HERE, "..", ".env"), "utf8").split("\n").find((x) => x.startsWith(k + "="));
  if (!l) throw new Error(`${k} não está em .env`);
  return l.slice(k.length + 1).trim().replace(/^"|"$/g, "");
};

const S = env("SUPABASE_URL").replace(/\/$/, "");
const A = env("SUPABASE_ANON_KEY");
const API = process.env.API ?? process.env.API_URL ?? "http://127.0.0.1:3012";

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

const call = async (token, method, pathname) => {
  const res = await fetch(API + pathname, {
    method,
    headers: { Authorization: `Bearer ${token}`, "x-academy-slug": "life-club" },
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

const dia = (s) => new Date(s + "T00:00:00Z");
/** A chave de uma data **calculada** aqui: vivem todas à meia-noite UTC. */
const chave = (d) => new Date(d).toISOString().slice(0, 10);
/**
 * A chave de uma data **lida da base**.
 *
 * O `pg` devolve uma coluna `DATE` como meia-noite **local**, e passá-la por
 * `toISOString()` num fuso a leste dá o dia anterior. O dia certo lê-se pelos
 * componentes locais, que é o que a coluna guarda.
 */
const chaveDb = (d) => {
  if (!d) return String(d);
  const x = new Date(d);
  const dois = (n) => String(n).padStart(2, "0");
  return `${x.getFullYear()}-${dois(x.getMonth() + 1)}-${dois(x.getDate())}`;
};

/* ========================================================================== */
/* 1. A conta dos meses — sem base de dados, sem servidor                      */
/* ========================================================================== */

console.log("=== O dia do mês, e os meses que não o têm ===");
{
  const passo = (assinatura, n) => chave(ciclo.dataDoAviso(dia(assinatura), n, "MONTHLY"));

  check("assinou a 20, recebe a 20 do mês seguinte", passo("2026-09-20", 1) === "2026-10-20", passo("2026-09-20", 1));
  check("e a 20 do mês a seguir", passo("2026-09-20", 2) === "2026-11-20", passo("2026-09-20", 2));

  check("assinou a 31 de Janeiro, recebe a 28 de Fevereiro", passo("2026-01-31", 1) === "2026-02-28", passo("2026-01-31", 1));
  check("e volta ao dia 31 em Março", passo("2026-01-31", 2) === "2026-03-31", passo("2026-01-31", 2));
  check("em Abril, que tem 30, recebe a 30", passo("2026-01-31", 3) === "2026-04-30", passo("2026-01-31", 3));
  check("e em Maio volta ao 31", passo("2026-01-31", 4) === "2026-05-31", passo("2026-01-31", 4));

  check("num ano bissexto, 31 de Janeiro dá 29 de Fevereiro", passo("2024-01-31", 1) === "2024-02-29", passo("2024-01-31", 1));
  check("quem assinou a 29 de Fevereiro recebe a 28 no ano seguinte", passo("2024-02-29", 12) === "2025-02-28", passo("2024-02-29", 12));
  check("e a 29 no bissexto seguinte", passo("2024-02-29", 48) === "2028-02-29", passo("2024-02-29", 48));

  check("assinou a 30, recebe a 28 em Fevereiro", passo("2026-01-30", 1) === "2026-02-28", passo("2026-01-30", 1));
  check("um contrato anual salta um ano", chave(ciclo.dataDoAviso(dia("2026-09-20"), 1, "ANNUAL")) === "2027-09-20",
    chave(ciclo.dataDoAviso(dia("2026-09-20"), 1, "ANNUAL")));

  // Doze meses seguidos a partir do dia 31: nenhum aviso perde o dia por causa
  // de Fevereiro. É esta a prova de que o encolhimento não arrasta.
  const dias = Array.from({ length: 12 }, (_, i) => Number(passo("2026-01-31", i + 1).slice(8, 10)));
  check("ao fim de um ano o dia é sempre o último possível", JSON.stringify(dias) === JSON.stringify([28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31, 31]),
    JSON.stringify(dias));
}

console.log("\n=== O que se deve, e o que já não se cobra ===");
{
  const devidos = (assinatura, hoje, jaEmitidos = [], janelaDias = 35, desde = assinatura) =>
    ciclo.avisosDevidos({
      assinatura: dia(assinatura),
      desde: dia(desde),
      hoje: dia(hoje),
      periodo: "MONTHLY",
      jaEmitidos: new Set(jaEmitidos),
      janelaDias,
    });

  const um = devidos("2026-09-20", "2026-10-20");
  check("no dia do aniversário há um aviso", um.length === 1, JSON.stringify(um.map((x) => chave(x.issuedOn))));
  check("e cobre o mês que passou", um[0] && chave(um[0].periodStart) === "2026-09-20" && chave(um[0].periodEnd) === "2026-10-19",
    JSON.stringify(um[0] && [chave(um[0].periodStart), chave(um[0].periodEnd)]));

  check("na véspera ainda não há nada", devidos("2026-09-20", "2026-10-19").length === 0);
  check("um aviso já emitido não se repete", devidos("2026-09-20", "2026-10-20", ["2026-09-20"]).length === 0);

  check("dois meses sem servidor recuperam os dois", devidos("2026-09-20", "2026-11-20", [], 70).length === 2,
    JSON.stringify(devidos("2026-09-20", "2026-11-20", [], 70).map((x) => chave(x.issuedOn))));
  check("mas a janela corta o que é velho de mais", devidos("2026-09-20", "2026-11-20", [], 15).length === 1,
    JSON.stringify(devidos("2026-09-20", "2026-11-20", [], 15).map((x) => chave(x.issuedOn))));
  /*
   * Um ano de atraso não vira doze avisos: a janela de 35 dias deixa passar o
   * período corrente e, quando muito, o anterior. O resto cobra-se a falar com
   * o cliente.
   */
  check("um ano de atraso não vira doze avisos", devidos("2025-09-20", "2026-09-20", [], 35).length <= 2,
    `${devidos("2025-09-20", "2026-09-20", [], 35).length}`);

  check("um contrato que começa depois não cobra o antes",
    devidos("2026-09-20", "2026-10-20", [], 35, "2026-10-01").length === 0);
}

/* ========================================================================== */
/* 2. A varredura, contra o servidor                                          */
/* ========================================================================== */

const db = new pg.Client({ connectionString: env("MIGRATE_DATABASE_URL"), ssl: { rejectUnauthorized: false } });
await db.connect();

const AC = "za_academia";

const limpar = async () => {
  await db.query(`DELETE FROM "SubscriptionNotice" WHERE "academyId" = $1`, [AC]);
  await db.query(`DELETE FROM "SubscriptionOrder" WHERE "academyId" = $1`, [AC]);
  await db.query(`DELETE FROM "Subscription" WHERE "academyId" = $1`, [AC]);
  await db.query(`DELETE FROM "Membership" WHERE id LIKE 'za_%'`);
  await db.query(`DELETE FROM "AcademyRole" WHERE id LIKE 'za_%'`);
  await db.query(`DELETE FROM "User" WHERE id LIKE 'za_%'`);
  await db.query(`DELETE FROM "Academy" WHERE id = $1`, [AC]);
  await db.query(`DELETE FROM "PlatformAdmin" WHERE id = 'za_admin'`);
};

/** Os avisos deste clube, do mais recente para o mais antigo. */
const avisos = async () =>
  (await db.query(`SELECT * FROM "SubscriptionNotice" WHERE "academyId" = $1 ORDER BY "issuedOn" DESC`, [AC])).rows;

/** Põe a ordem assinada em `quandoISO` e limpa os avisos já emitidos. */
const assinarEm = async (quandoISO, startsOn = quandoISO) => {
  await db.query(`DELETE FROM "SubscriptionNotice" WHERE "academyId" = $1`, [AC]);
  /*
   * Meio-dia UTC, e não `::date`.
   *
   * `'2026-08-20'::date` num servidor com o fuso de Lisboa é a meia-noite de
   * Lisboa, que em UTC é o dia 19 às 23:00 — e o teste passava a falar de outro
   * dia. Meio-dia é o mesmo dia em qualquer um dos dois fusos.
   */
  await db.query(
    `UPDATE "SubscriptionOrder"
        SET "signedAt" = ($2 || ' 12:00:00+00')::timestamptz, "startsOn" = $3::date
      WHERE "academyId" = $1`,
    [AC, quandoISO, startsOn],
  );
};

try {
  await limpar();

  console.log("\n=== Preparar o clube descartável ===");
  await db.query(
    `INSERT INTO "Academy" (id, slug, name, "shortName", status, "updatedAt")
     VALUES ($1, 'za-teste-avisos', 'ZA Clube de Teste', 'ZA', 'SETUP', now())`, [AC],
  );
  await db.query(
    `INSERT INTO "AcademyRole" (id, "academyId", key, name, "baseRole", permissions, "updatedAt")
     VALUES ('za_cargo', $1, 'presidente', 'Presidente', 'OWNER', ARRAY['legal:club']::text[], now())`, [AC],
  );
  /* Duas pessoas com poderes: o aviso vai ao **mais antigo**, como o contrato. */
  await db.query(
    `INSERT INTO "User" (id, "authId", name, email, "updatedAt")
     VALUES ('za_user', 'za-auth-teste', 'ZA Presidente', 'za-presidente@teste.local', now()),
            ('za_user2', 'za-auth-teste2', 'ZA Vice', 'za-vice@teste.local', now())`,
  );
  await db.query(
    `INSERT INTO "Membership" (id, "academyId", "userId", role, "customRoleId", "isActive", "createdAt", "updatedAt")
     VALUES ('za_memb', $1, 'za_user', 'OWNER', 'za_cargo', true, now() - interval '400 days', now()),
            ('za_memb2', $1, 'za_user2', 'OWNER', 'za_cargo', true, now(), now())`, [AC],
  );
  const plano = (await db.query(
    `SELECT id, name, "amountCents" FROM "Plan" WHERE "isActive" ORDER BY "amountCents" ASC LIMIT 1`)).rows[0];
  check("há um plano activo no catálogo", Boolean(plano));

  const authDaDireccao = (await db.query(
    `SELECT "authId" FROM "User" WHERE email = 'direcao@lifeclub.pt' LIMIT 1`)).rows[0]?.authId;
  await db.query(
    `INSERT INTO "PlatformAdmin" (id, "authId", name, email, role, "isActive", "updatedAt")
     VALUES ('za_admin', $1, 'ZA Admin de teste', 'za-admin@teste.local', 'OWNER', true, now())`, [authDaDireccao],
  );
  const admin = await login("direcao@lifeclub.pt");
  const correr = () => call(admin, "POST", `/api/platform/subscricao/avisos?academia=${AC}`);

  /* A ordem, ainda por assinar. */
  await db.query(
    `INSERT INTO "SubscriptionOrder"
       (id, "academyId", "planId", "planName", "billingPeriod", "listMonthlyCents", "discountPct", "amountCents",
        "startsOn", "minimumMonths", status, "createdAt", "updatedAt")
     VALUES ('za_ordem', $1, $2, $3, 'MONTHLY', $4, 0, $4, now()::date, 1, 'PENDING', now(), now())`,
    [AC, plano.id, plano.name, plano.amountCents],
  );

  console.log("\n=== Sem contrato assinado não se cobra nada ===");
  const semOrdem = await correr();
  check("a varredura corre (2xx)", semOrdem.status === 200 || semOrdem.status === 201, `${semOrdem.status} ${JSON.stringify(semOrdem.body).slice(0, 160)}`);
  check("e não emite nada", (await avisos()).length === 0, JSON.stringify(await avisos()));

  console.log("\n=== Um mês depois de assinar, sai o aviso ===");
  await db.query(`UPDATE "SubscriptionOrder" SET status = 'SIGNED' WHERE id = 'za_ordem'`);
  /* Assinou há um mês exacto: hoje é o dia do primeiro aviso. */
  /* O "hoje" do clube, que é o que o servidor usa — ver `diaDoClube`. */
  const hoje = ciclo.diaDoClube(new Date());
  const assinatura = ciclo.dataDoAviso(hoje, -1, "MONTHLY");
  await assinarEm(chave(assinatura));

  const primeira = await correr();
  check("a varredura emite um aviso", primeira.body?.criados === 1, JSON.stringify(primeira.body));
  const linhas = await avisos();
  check("e fica uma linha só", linhas.length === 1, `${linhas.length}`);
  const aviso = linhas[0];
  check("o período começa no dia da assinatura", chaveDb(aviso?.periodStart) === chave(assinatura), `${chaveDb(aviso?.periodStart)}`);
  check("e acaba na véspera de hoje", chaveDb(aviso?.periodEnd) === chave(ciclo.somaDias(hoje, -1)), `${chaveDb(aviso?.periodEnd)}`);
  check("sai hoje", chaveDb(aviso?.issuedOn) === chave(hoje), `${chaveDb(aviso?.issuedOn)}`);
  check("com data-limite oito dias depois", chaveDb(aviso?.dueOn) === chave(ciclo.somaDias(hoje, 8)), `${chaveDb(aviso?.dueOn)}`);
  check("pelo valor da ordem", aviso?.amountCents === plano.amountCents, `${aviso?.amountCents}`);
  check("com o plano copiado", aviso?.planName === plano.name, `${aviso?.planName}`);
  check("para o responsável mais antigo", aviso?.toEmail === "za-presidente@teste.local", `${aviso?.toEmail}`);
  /* Sem chave de correio não sai email nenhum — e o aviso diz isso em vez de mentir. */
  check("sem correio configurado, fica por enviar", aviso?.sentAt === null && Boolean(aviso?.failureNote), JSON.stringify([aviso?.sentAt, aviso?.failureNote]));

  console.log("\n=== Correr outra vez não manda o segundo email ===");
  const segunda = await correr();
  check("a segunda passagem não emite nada", segunda.body?.criados === 0, JSON.stringify(segunda.body));
  check("e continua uma linha só", (await avisos()).length === 1, `${(await avisos()).length}`);

  console.log("\n=== O passado não se cobra todo de uma vez ===");
  await assinarEm(chave(ciclo.dataDoAviso(hoje, -8, "MONTHLY")));
  const atrasada = await correr();
  /*
   * A janela de 35 dias deixa passar o período corrente e, quando muito, o
   * anterior. Oito meses de atraso **não** viram oito emails de uma vez.
   */
  check("oito meses de atraso não viram oito avisos", (atrasada.body?.criados ?? 99) <= 2, JSON.stringify(atrasada.body));

  console.log("\n=== Uma subscrição cancelada não recebe avisos ===");
  await db.query(
    `INSERT INTO "Subscription" (id, "academyId", "planId", status, "createdAt", "updatedAt")
     VALUES ('za_sub', $1, $2, 'CANCELLED', now(), now())`, [AC, plano.id],
  );
  await assinarEm(chave(ciclo.dataDoAviso(hoje, -1, "MONTHLY")));
  const cancelada = await correr();
  check("cancelada não emite", cancelada.body?.criados === 0, JSON.stringify(cancelada.body));
  check("e não fica nenhuma linha", (await avisos()).length === 0, `${(await avisos()).length}`);

  console.log("\n=== Um contrato que ainda não começou ===");
  await db.query(`UPDATE "Subscription" SET status = 'ACTIVE' WHERE id = 'za_sub'`);
  const amanha = chave(ciclo.somaDias(hoje, 1));
  await assinarEm(chave(ciclo.dataDoAviso(hoje, -1, "MONTHLY")), amanha);
  const cedo = await correr();
  check("um início futuro não cobra o passado", cedo.body?.criados === 0, JSON.stringify(cedo.body));

  console.log("\n=== Anual: cobra uma vez por ano ===");
  await db.query(`UPDATE "SubscriptionOrder" SET "billingPeriod" = 'ANNUAL' WHERE id = 'za_ordem'`);
  await assinarEm(chave(ciclo.dataDoAviso(hoje, -1, "MONTHLY")));
  check("um mês depois de assinar, um contrato anual não cobra", (await correr()).body?.criados === 0);
  await assinarEm(chave(ciclo.dataDoAviso(hoje, -12, "MONTHLY")));
  const anual = await correr();
  check("um ano depois, cobra", anual.body?.criados === 1, JSON.stringify(anual.body));
  check("e o período é o ano inteiro", chaveDb((await avisos())[0]?.periodStart) === chave(ciclo.dataDoAviso(hoje, -12, "MONTHLY")),
    chaveDb((await avisos())[0]?.periodStart));
} finally {
  console.log("\n=== Limpeza ===");
  await limpar();
  await db.end();
  console.log("  feito");
}

console.log(`\n${ok} passaram, ${bad} falharam`);
process.exit(bad === 0 ? 0 : 1);

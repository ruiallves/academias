#!/usr/bin/env node
/**
 * O identificador do pagamento, e quem pagou.
 *
 * A queixa: *"não existe forma de o clube saber a quem pertence cada pagamento:
 * na app aparece que pagou, e no backoffice da euPago aparece o pagamento mas
 * não sabemos de quem vem."*
 *
 * O que se guarda aqui:
 *
 * 1. O formato, TIPO-MES-ATLETAS-PAGADOR-ID, em casos soltos: acentos,
 *    partículas, vários meses (seguidos e soltos), vários atletas, tipos
 *    misturados, nomes que não cabem.
 * 2. Num clube descartável, a mensalidade e o kit pagos pela app: o pagamento
 *    nasce com o identificador, é **esse** que segue para a euPago (a
 *    referência simulada leva-o dentro), guarda quem pagou e o que é do atleta,
 *    e o webhook que volta com ele liquida a cobrança.
 * 3. Três meses de quota de sócio num pagamento: `QUOTA-SET26_A_NOV26-…`.
 * 4. A consola recebe quem pagou e o identificador nas Mensalidades e nas
 *    quotas do sócio.
 *
 * ## O que este teste NUNCA faz
 *
 * Chamar a euPago. A API tem de estar a correr **sem** `EUPAGO_API_KEY`
 * (modo de desenvolvimento): as referências saem `dev-*`. Se alguma sair sem
 * esse prefixo, o teste pára logo e diz porquê.
 *
 * Uso (API de teste, euPago desligada):
 *   EUPAGO_API_KEY= TZ=UTC PORT=3011 AUTO_BILLING_INTERVAL_MIN=0 \
 *     AUTO_MEMBER_FEES_INTERVAL_MIN=0 RECONCILE_INTERVAL_MIN=0 node dist/main
 *   API_URL=http://127.0.0.1:3011 node scripts/test-identificador-pagamento.mjs
 */
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import pg from "pg";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const env = (k) => {
  const l = readFileSync(path.join(HERE, "..", ".env"), "utf8").split("\n").find((x) => x.startsWith(k + "="));
  if (!l) throw new Error(`${k} não está em .env`);
  return l.slice(k.length + 1).trim().replace(/^"|"$/g, "");
};

const S = env("SUPABASE_URL").replace(/\/$/, "");
const A = env("SUPABASE_ANON_KEY");
const SECRET = env("EUPAGO_WEBHOOK_SECRET");
/*
 * Nunca contra as APIs de desenvolvimento (3000, 3001): correm com a chave de
 * PRODUÇÃO da euPago, e um pagamento aqui cria uma referência a sério. Já
 * aconteceu (2026-09-19): o `nest start --watch` estava na 3001 e o teste foi lá
 * parar. A API deste teste arranca-se numa porta própria, sem chave, e confirma-
 * -se no log que diz "as referências são simuladas".
 */
const API = process.env.API_URL ?? "";
if (!API || /:(3000|3001)(\/|$)/.test(API)) {
  console.log("Recusado: indica API_URL de uma API arrancada SEM EUPAGO_API_KEY, fora da 3000 e da 3001.");
  process.exit(1);
}

let ok = 0;
let bad = 0;
const check = (l, c, d = "") => {
  if (c) {
    ok++;
    console.log("  OK    " + l);
  } else {
    bad++;
    console.log("  FALHA " + l + (d ? " — " + d : ""));
  }
};

/* -------------------------------------------------------------- 1. formato --- */

const { montarIdentificador, nomeCurto, MAXIMO } = await import(
  pathToFileURL(path.join(HERE, "..", "dist", "billing", "identificador.js")).href
);

console.log("=== O formato ===");
const FIXO = "7K2F9Q";
const mens = (periodo, nome) => ({ tipo: "MENS", periodo, nome });

check(
  "uma mensalidade",
  montarIdentificador([mens("2026-09", "João Miguel da Silva")], "Maria Fernandes da Silva", FIXO) ===
    "MENS-SET26-JOAO_SILVA-MARIA_SILVA-7K2F9Q",
  montarIdentificador([mens("2026-09", "João Miguel da Silva")], "Maria Fernandes da Silva", FIXO),
);
check("sem acentos nem cedilhas", nomeCurto("Inês Conceição") === "INES_CONCEICAO", nomeCurto("Inês Conceição"));
check("um nome só fica como está", nomeCurto("Zé") === "ZE", nomeCurto("Zé"));
check(
  "um kit é EXTRA",
  montarIdentificador([{ tipo: "EXTRA", periodo: "2026-09", nome: "Ana Costa" }], "Rui Costa", FIXO) ===
    "EXTRA-SET26-ANA_COSTA-RUI_COSTA-7K2F9Q",
);
check(
  "meses seguidos são um intervalo",
  montarIdentificador(["2026-09", "2026-10", "2026-11"].map((p) => ({ tipo: "QUOTA", periodo: p, nome: "Rui Costa" })), "Rui Costa", FIXO) ===
    "QUOTA-SET26_A_NOV26-RUI_COSTA-RUI_COSTA-7K2F9Q",
);
check(
  "o intervalo passa a passagem de ano",
  montarIdentificador([mens("2026-12", "Ana Costa"), mens("2027-01", "Ana Costa")], "Rui Costa", FIXO) ===
    "MENS-DEZ26_A_JAN27-ANA_COSTA-RUI_COSTA-7K2F9Q",
);
check(
  "meses soltos dizem-se um a um",
  montarIdentificador([mens("2026-09", "Ana Costa"), mens("2026-11", "Ana Costa")], "Rui Costa", FIXO) ===
    "MENS-SET26_E_NOV26-ANA_COSTA-RUI_COSTA-7K2F9Q",
);
check(
  "mais de três soltos dizem quantos são",
  montarIdentificador(["2026-09", "2026-11", "2027-01", "2027-03"].map((p) => mens(p, "Ana Costa")), "Rui Costa", FIXO) ===
    "MENS-4MESES-ANA_COSTA-RUI_COSTA-7K2F9Q",
);
check(
  "dois irmãos no mesmo pagamento",
  montarIdentificador([mens("2026-09", "Ana Costa"), mens("2026-09", "Tiago Costa")], "Rui Costa", FIXO) ===
    "MENS-SET26-ANA_COSTA_E_TIAGO_COSTA-RUI_COSTA-7K2F9Q",
);
check(
  "mensalidade e kit juntos são VARIOS",
  montarIdentificador([mens("2026-09", "Ana Costa"), { tipo: "EXTRA", periodo: "2026-09", nome: "Ana Costa" }], "Rui Costa", FIXO) ===
    "VARIOS-SET26-ANA_COSTA-RUI_COSTA-7K2F9Q",
);
const longo = montarIdentificador(
  [mens("2026-09", "Maximiliano Bartolomeu Vasconcelos"), mens("2026-09", "Constantino Albuquerque"), mens("2026-09", "Bernardino Figueiredo")],
  "Maria Madalena Vasconcelos",
  FIXO,
);
check(`nunca passa de ${MAXIMO} caracteres`, longo.length <= MAXIMO, `${longo} (${longo.length})`);
check("e nunca perde o ID", longo.endsWith("-7K2F9Q"), longo);
check("só maiúsculas, algarismos, - e _", /^[A-Z0-9_-]+$/.test(longo), longo);
const sozinho = montarIdentificador([mens("2026-09", "Ana Costa")], "Rui Costa");
check("o ID ao acaso tem 6 caracteres legíveis", /-[2-9A-HJ-NP-Z]{6}$/.test(sozinho), sozinho);
check("sem pagador diz SEM_NOME", montarIdentificador([mens("2026-09", "Ana Costa")], null, FIXO) === "MENS-SET26-ANA_COSTA-SEM_NOME-7K2F9Q");

/* --------------------------------------------------------- 2. clube de teste --- */

const login = async (email) =>
  (
    await (
      await fetch(`${S}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: { apikey: A, "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: "academia2026" }),
      })
    ).json()
  ).access_token;

const Z = "zd-teste-identificador";
const ZD = "zd_academia";
const call = async (token, method, pathname, body, app = "console") => {
  const r = await fetch(API + pathname, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "x-academy-slug": Z,
      ...(app ? { "x-app": app } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};

const webhook = async (payload) => {
  const raw = JSON.stringify(payload);
  const sig = createHmac("sha256", SECRET).update(raw, "utf8").digest("base64");
  const r = await fetch(`${API}/webhooks/eupago`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Signature": sig },
    body: raw,
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const pago = (identifier, euros) => ({
  transactions: {
    identifier,
    reference: 999_000_333,
    trid: `zd-trid-${identifier}-${randomUUID().slice(0, 6)}`,
    method: "Multibanco",
    amount: { value: euros, currency: "EUR" },
    date: new Date().toISOString(),
    status: "PAID",
  },
  channel: { name: "teste" },
});

const db = new pg.Client({ connectionString: env("MIGRATE_DATABASE_URL"), ssl: { rejectUnauthorized: false } });
await db.connect();

const direcao = (await db.query(`SELECT id, name FROM "User" WHERE email = 'direcao@lifeclub.pt'`)).rows[0];
const PAGADOR = nomeCurto(direcao.name);

const limpar = async () => {
  await db.query(`DELETE FROM "Notification" WHERE "academyId" = $1`, [ZD]);
  await db.query(
    `DELETE FROM "Payment" WHERE "chargeId" IN (SELECT id FROM "Charge" WHERE "academyId" = $1)
        OR "memberFeeId" IN (SELECT id FROM "MemberFee" WHERE "academyId" = $1)`,
    [ZD],
  );
  await db.query(`DELETE FROM "Charge" WHERE "academyId" = $1`, [ZD]);
  await db.query(`DELETE FROM "MemberFee" WHERE "academyId" = $1`, [ZD]);
  await db.query(`DELETE FROM "Member" WHERE "academyId" = $1`, [ZD]);
  await db.query(`DELETE FROM "GuardianLink" WHERE "athleteId" LIKE 'zd_%'`);
  await db.query(`DELETE FROM "TeamMembership" WHERE "athleteId" LIKE 'zd_%'`);
  await db.query(`DELETE FROM "Athlete" WHERE "academyId" = $1`, [ZD]);
  await db.query(`DELETE FROM "Team" WHERE "academyId" = $1`, [ZD]);
  await db.query(`DELETE FROM "Season" WHERE "academyId" = $1`, [ZD]);
  await db.query(`DELETE FROM "LegalAcceptance" WHERE "academyId" = $1`, [ZD]).catch(() => undefined);
  await db.query(`DELETE FROM "Membership" WHERE "academyId" = $1`, [ZD]);
  await db.query(`DELETE FROM "Sport" WHERE "academyId" = $1`, [ZD]);
  await db.query(`DELETE FROM "Academy" WHERE id = $1`, [ZD]);
};
await limpar();

const pagamentoDe = async (col, id) =>
  (await db.query(
    `SELECT identificador, "payerName", "payerRelation", "providerRef", status FROM "Payment" WHERE "${col}" = $1 ORDER BY "createdAt" DESC`,
    [id],
  )).rows[0] ?? null;

/** Uma referência que não seja simulada quer dizer que a euPago foi chamada: parar. */
const soSimulada = (p) => {
  if (p?.providerRef && !p.providerRef.startsWith("dev-")) {
    console.log(`\n  PARADO: a referência ${p.providerRef} não é simulada. A API de teste tem EUPAGO_API_KEY?`);
    process.exitCode = 1;
    throw new Error("euPago chamada a sério");
  }
};

try {
  await db.query(
    `INSERT INTO "Academy" (id, slug, name, "shortName", status, "updatedAt")
     VALUES ($1, $2, 'ZD Teste Identificador', 'ZD', 'ACTIVE', now())`, [ZD, Z],
  );
  await db.query(`INSERT INTO "Sport" (id, "academyId", name, positions, skills) VALUES ('zd_sport', $1, 'Futebol', ARRAY[]::text[], ARRAY[]::text[])`, [ZD]);
  await db.query(`INSERT INTO "Season" (id, "academyId", label, "startsOn", "endsOn", "isCurrent") VALUES ('zd_season', $1, 'época', '2026-08-01', '2027-07-31', true)`, [ZD]);
  await db.query(`INSERT INTO "Team" (id, "academyId", "sportId", "seasonId", name, "maxAge", "updatedAt") VALUES ('zd_team', $1, 'zd_sport', 'zd_season', 'ZD Sub-15', 15, now())`, [ZD]);
  await db.query(`INSERT INTO "Athlete" (id, "academyId", name, birthdate, status, "joinedAt", "updatedAt") VALUES ('zd_atleta', $1, 'João Miguel da Silva', '2011-05-05', 'ACTIVE', '2024-01-10', now())`, [ZD]);
  await db.query(`INSERT INTO "TeamMembership" (id, "teamId", "athleteId") VALUES ('zd_tm', 'zd_team', 'zd_atleta')`);
  await db.query(`INSERT INTO "Membership" (id, "academyId", "userId", role, "isActive", "updatedAt") VALUES ('zd_memb_dir', $1, $2, 'OWNER', true, now())`, [ZD, direcao.id]);
  // A direcção faz de mãe: é quem carrega em "pagar", com o laço ao atleta.
  await db.query(`INSERT INTO "GuardianLink" (id, "athleteId", "membershipId", relation) VALUES ('zd_gl', 'zd_atleta', 'zd_memb_dir', 'Mãe')`);
  await db.query(
    `INSERT INTO "Charge" (id, "academyId", "athleteId", kind, period, slot, "amountCents", "dueDate", status, "updatedAt")
     VALUES ('zd_mens', $1, 'zd_atleta', 'FEE', '2026-09', '', 3000, '2026-09-08', 'OPEN', now()),
            ('zd_kit',  $1, 'zd_atleta', 'EXTRA', '2026-09', 'kit', 4500, '2026-09-30', 'OPEN', now())`,
    [ZD],
  );
  await db.query(`UPDATE "Charge" SET title = 'Kit de treino' WHERE id = 'zd_kit'`);

  const director = await login("direcao@lifeclub.pt");
  const pend = ((await call(director, "GET", "/api/legal/status")).body?.pending ?? []).map((d) => d.id);
  if (pend.length) {
    const aceite = await call(director, "POST", "/api/legal/accept", { documentIds: pend, confirmAuthority: true });
    check("(preparação) termos do clube aceites", aceite.status === 200 || aceite.status === 201, `${aceite.status}`);
  }

  // A app da família só deixa pagar a quem é encarregado neste clube: a conta
  // passa a GUARDIAN para pagar e volta a OWNER para ver a consola.
  const papel = (role) => db.query(`UPDATE "Membership" SET role = $1 WHERE id = 'zd_memb_dir'`, [role]);
  await papel("GUARDIAN");

  console.log("\n=== A mensalidade paga pela app ===");
  const r1 = await call(director, "POST", "/billing/charges/zd_mens/pay", { method: "MULTIBANCO" }, "family");
  check("o pagamento começa (2xx)", r1.status === 200 || r1.status === 201, `${r1.status} ${JSON.stringify(r1.body).slice(0, 200)}`);
  const p1 = await pagamentoDe("chargeId", "zd_mens");
  soSimulada(p1);
  const esperado1 = new RegExp(`^MENS-SET26-JOAO_SILVA-${PAGADOR}-[2-9A-HJ-NP-Z]{6}$`);
  check("nasce com o identificador", esperado1.test(p1?.identificador ?? ""), `${p1?.identificador}`);
  check("é esse que segue para a euPago", p1?.providerRef === `dev-mb-${p1?.identificador}`, `${p1?.providerRef}`);
  check("guarda quem pagou", p1?.payerName === direcao.name, `${p1?.payerName}`);
  check("e o que é do atleta", p1?.payerRelation === "Mãe", `${p1?.payerRelation}`);

  const w1 = await webhook(pago(p1.identificador, 30));
  check("o webhook com o identificador é aceite", w1.status === 200 || w1.status === 201, `${w1.status}`);
  const c1 = (await db.query(`SELECT status FROM "Charge" WHERE id = 'zd_mens'`)).rows[0];
  check("e liquida a mensalidade", c1?.status === "SETTLED", `${c1?.status}`);

  console.log("\n=== O kit ===");
  const r2 = await call(director, "POST", "/billing/charges/zd_kit/pay", { method: "MULTIBANCO" }, "family");
  check("o pagamento começa (2xx)", r2.status === 200 || r2.status === 201, `${r2.status}`);
  const p2 = await pagamentoDe("chargeId", "zd_kit");
  soSimulada(p2);
  check("é EXTRA", new RegExp(`^EXTRA-SET26-JOAO_SILVA-${PAGADOR}-`).test(p2?.identificador ?? ""), `${p2?.identificador}`);
  check("dois pagamentos, dois identificadores", p1.identificador !== p2?.identificador);

  await papel("OWNER");

  console.log("\n=== A consola: Mensalidades ===");
  const lista = await call(director, "GET", "/api/charges?period=2026-09");
  const linha = (lista.body ?? []).find((c) => c.id === "zd_mens");
  check("diz quem pagou", linha?.paidBy === direcao.name, JSON.stringify(linha).slice(0, 300));
  check("com o laço", linha?.paidByRelation === "Mãe", `${linha?.paidByRelation}`);
  check("e o identificador da euPago", linha?.paymentId === p1.identificador, `${linha?.paymentId}`);
  const kit = (lista.body ?? []).find((c) => c.id === "zd_kit");
  check("uma por pagar não diz quem pagou", kit && kit.paidBy === null && kit.paymentId === null, JSON.stringify(kit).slice(0, 200));

  console.log("\n=== Os Movimentos dizem o método ===");
  const movs = await call(director, "GET", "/api/finance/transactions");
  const mov = (movs.body ?? []).find((t) => t.id === "charge_zd_mens");
  check("a mensalidade paga aparece", Boolean(mov), `${movs.status} ${JSON.stringify(movs.body).slice(0, 200)}`);
  check("com o método", mov?.method === "MULTIBANCO", `${mov?.method}`);
  check("e quem pagou", mov?.counterparty === `${direcao.name} (Mãe)`, `${mov?.counterparty}`);

  console.log("\n=== O mínimo da euPago ===");
  // Só a recusa passa pela API: uma avulsa aceite avisaria a família por push.
  const barata = await call(director, "POST", "/api/charges/avulsa", {
    athleteId: "zd_atleta", title: "Rifa", amountCents: 40, dueDate: "2026-09-30",
  });
  check("uma cobrança de 0,40 € é recusada", barata.status === 400, `${barata.status} ${JSON.stringify(barata.body).slice(0, 160)}`);
  check("a dizer o mínimo", /0,50 €/.test(JSON.stringify(barata.body)), JSON.stringify(barata.body).slice(0, 160));
  await db.query(
    `INSERT INTO "Charge" (id, "academyId", "athleteId", kind, period, slot, title, "amountCents", "dueDate", status, "updatedAt")
     VALUES ('zd_rifa', $1, 'zd_atleta', 'EXTRA', '2026-09', 'rifa', 'Rifa', 60, '2026-09-30', 'OPEN', now())`,
    [ZD],
  );
  await papel("GUARDIAN");
  const mb = await call(director, "POST", "/billing/charges/zd_rifa/pay", { method: "MULTIBANCO" }, "family");
  check("0,60 € por Multibanco é recusado (mínimo 1 €)", mb.status === 400, `${mb.status}`);
  check("e manda pagar por MB WAY", /MB WAY/.test(JSON.stringify(mb.body)), JSON.stringify(mb.body).slice(0, 160));
  const mbw = await call(director, "POST", "/billing/charges/zd_rifa/pay", { method: "MBWAY", payerPhone: "912345678" }, "family");
  check("0,60 € por MB WAY passa (mínimo 0,50 €)", mbw.status === 200 || mbw.status === 201, `${mbw.status} ${JSON.stringify(mbw.body).slice(0, 160)}`);
  soSimulada(await pagamentoDe("chargeId", "zd_rifa"));
  await papel("OWNER");

  console.log("\n=== Três meses de quota num pagamento ===");
  await db.query(
    `INSERT INTO "Member" (id, "academyId", name, status, "userId", "updatedAt")
     VALUES ('zd_socio', $1, 'Rui Manuel Costa', 'ACTIVE', $2, now())`,
    [ZD, direcao.id],
  );
  await db.query(
    `INSERT INTO "MemberFee" (id, "academyId", "memberId", period, "amountCents", status, "updatedAt")
     VALUES ('zd_q09', $1, 'zd_socio', '2026-09', 500, 'OPEN', now()),
            ('zd_q10', $1, 'zd_socio', '2026-10', 500, 'OPEN', now()),
            ('zd_q11', $1, 'zd_socio', '2026-11', 500, 'OPEN', now())`,
    [ZD],
  );
  let r3 = await call(director, "POST", "/api/socio/quotas/ate/2026-11/pagar", { method: "MULTIBANCO" }, null);
  if (r3.status === 403 && /termos|legal|aceit/i.test(JSON.stringify(r3.body))) {
    // O sócio também tem termos a aceitar: aceitam-se como o sócio os aceitaria.
    const docs = ((await call(director, "GET", "/api/legal/status?context=member", undefined, null)).body?.pending ?? []).map((d) => d.id);
    await call(director, "POST", "/api/legal/accept", { documentIds: docs, context: "member" }, null);
    r3 = await call(director, "POST", "/api/socio/quotas/ate/2026-11/pagar", { method: "MULTIBANCO" }, null);
  }
  check("o pagamento começa (2xx)", r3.status === 200 || r3.status === 201, `${r3.status} ${JSON.stringify(r3.body).slice(0, 200)}`);
  const p3 = await pagamentoDe("memberFeeId", "zd_q09");
  soSimulada(p3);
  const esperado3 = new RegExp(`^QUOTA-SET26_A_NOV26-RUI_COSTA-${PAGADOR}-[2-9A-HJ-NP-Z]{6}$`);
  check("um identificador para os três meses", esperado3.test(p3?.identificador ?? ""), `${p3?.identificador}`);
  check("guarda quem pagou", Boolean(p3?.payerName), `${p3?.payerName}`);
  check("sem laço (é o próprio sócio)", p3?.payerRelation === null, `${p3?.payerRelation}`);

  const w3 = await webhook(pago(p3.identificador, 15));
  check("o webhook é aceite", w3.status === 200 || w3.status === 201, `${w3.status}`);
  const q = (await db.query(`SELECT period, status FROM "MemberFee" WHERE "memberId" = 'zd_socio' ORDER BY period`)).rows;
  check("e liquida os três meses", q.length === 3 && q.every((x) => x.status === "SETTLED"), JSON.stringify(q));

  console.log("\n=== A consola: quotas do sócio ===");
  const quotas = await call(director, "GET", "/api/members/zd_socio/fees");
  const nov = (quotas.body ?? []).find((f) => f.period === "2026-11");
  check("diz quem pagou", nov?.paidBy === p3.payerName, JSON.stringify(nov).slice(0, 300));
  check("e o identificador, o mesmo nos três meses", (quotas.body ?? []).every((f) => f.paymentId === p3.identificador), JSON.stringify((quotas.body ?? []).map((f) => f.paymentId)));
} catch (error) {
  if (!String(error).includes("euPago chamada")) {
    bad++;
    console.log("  FALHA (excepção) " + (error?.stack ?? error));
  }
} finally {
  await limpar();
  await db.end();
}

console.log(`\n${ok} OK, ${bad} falha(s)`);
process.exit(bad ? 1 : 0);

#!/usr/bin/env node
/**
 * A quota anual vista da app do sócio — só aparece quando o período vira.
 *
 * ## O que o clube pediu
 *
 * *"Garantir que a notificação e o pagamento só aparecem quando o período
 * acaba."* Um sócio anual que já pagou não pode ver nada para pagar até o
 * período virar; quando vira, nasce a quota nova, aparece na app como por
 * pagar, e ele é avisado. Nem antes, nem uma segunda vez.
 *
 * ## Como se testa sem relógio
 *
 * A abertura do ano de quotas é **do clube** (`Academy.memberAnnualStartMonth`
 * e `memberAnnualStartDay`), e é mudá-la que dá as situações **hoje**, sem
 * mexer na data:
 *
 * 1. com o ano a abrir no **dia 1 do mês corrente**, o período anterior acabou
 *    no fim do mês passado. Um sócio com o anterior pago é o caso "o período
 *    acabou": a emissão de hoje dá-lhe a quota nova e avisa-o;
 * 2. com o ano a abrir no **mês seguinte**, o período corrente acaba no fim
 *    deste mês. Um sócio com o corrente pago é o caso "ainda não acabou": a
 *    emissão não cria nada, a app não oferece nada, e o seguinte não se paga
 *    antes do tempo;
 * 3. com o ano a abrir **amanhã** (mês corrente, dia de hoje + 1), o período
 *    corrente é ainda o do ano passado — o dia conta, não só o mês.
 *
 * Correm em sequência, cada uma com a abertura do clube posta no seu, e cada
 * sócio de teste só nasce no cenário dele — senão o do cenário 2 apanhava a
 * quota do cenário 1. A abertura volta ao que era no fim.
 *
 * ## O que este teste faz ao Life Club, e desfaz
 *
 * Mudar a abertura muda o período corrente de **todos** os sócios anuais do
 * clube, e a emissão que este teste dispara cria-lhes quotas nesse período. Por
 * isso tira-se uma fotografia das quotas antes, e no fim apaga-se tudo o que
 * nasceu entretanto e não é de um sócio de teste — quotas, e os avisos que
 * apontam para elas.
 *
 * ## O que este teste NUNCA faz
 *
 * Chamar a euPago: a chave em `.env` é de produção. Do pagamento prova-se o que
 * acontece **antes** do provedor — as guardas — e o caminho de volta, o
 * webhook, está em `test-app-do-clube.mjs`.
 *
 * Uso: node scripts/test-quotas-anuais-app.mjs   (com a API em :3000)
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
  if (c) {
    ok++;
    console.log("  OK    " + l);
  } else {
    bad++;
    console.log("  FALHA " + l + (d ? " — " + d : ""));
  }
};

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

const call = async (token, method, pathname, body) => {
  const r = await fetch(API + pathname, {
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

const LC = (await db.query(`SELECT id FROM "Academy" WHERE slug = 'life-club'`)).rows[0].id;
const mm = (m) => String(m).padStart(2, "0");
const rotulo = (inicio, ano) => (inicio === 1 ? String(ano) : `${ano}/${mm((ano + 1) % 100)}`);

const agora = new Date();
const ANO = agora.getFullYear();
const MES = agora.getMonth() + 1;
const DIA = agora.getDate();
const MES_SEGUINTE = MES === 12 ? 1 : MES + 1;
const ANO_ABERTURA_SEGUINTE = MES_SEGUINTE === 1 ? ANO : ANO - 1;
const FIM_DO_MES = new Date(Date.UTC(ANO, MES, 0)).toISOString().slice(0, 10);
const DIAS_DO_MES = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/* A fotografia: o que o Life Club já tinha antes de se mexer na abertura. */
const original = (await db.query(`SELECT "memberAnnualStartMonth" AS m, "memberAnnualStartDay" AS d FROM "Academy" WHERE id = $1`, [LC])).rows[0];
const quotasAntes = new Set((await db.query(`SELECT id FROM "MemberFee" WHERE "academyId" = $1`, [LC])).rows.map((r) => r.id));

const limpar = async () => {
  const novasAlheias = (await db.query(`SELECT id FROM "MemberFee" WHERE "academyId" = $1 AND "memberId" NOT LIKE 'zb_%'`, [LC]))
    .rows.map((r) => r.id).filter((id) => !quotasAntes.has(id));
  const dosTestes = (await db.query(`SELECT id FROM "MemberFee" WHERE "memberId" LIKE 'zb_%'`)).rows.map((r) => r.id);
  const aApagar = [...novasAlheias, ...dosTestes];
  if (aApagar.length) {
    await db.query(`DELETE FROM "Notification" WHERE "academyId" = $1 AND payload->>'memberFeeId' = ANY($2)`, [LC, aApagar]);
    await db.query(`DELETE FROM "Payment" WHERE "memberFeeId" = ANY($1)`, [aApagar]);
    await db.query(`DELETE FROM "MemberFee" WHERE id = ANY($1)`, [aApagar]);
  }
  await db.query(`DELETE FROM "Member" WHERE id LIKE 'zb_%'`);
  await db.query(`DELETE FROM "MemberTier" WHERE "academyId" = $1 AND name LIKE 'ZB %'`, [LC]);
  await db.query(`DELETE FROM "PlatformAdmin" WHERE id = 'zb_admin'`);
  await db.query(`UPDATE "Academy" SET "memberAnnualStartMonth" = $2, "memberAnnualStartDay" = $3 WHERE id = $1`, [LC, original.m, original.d]);
  return novasAlheias.length;
};
await limpar();

try {
  /* ------------------------------------------------ as contas de sócio ---- */
  const livres = (
    await db.query(
      `SELECT u.id, u.email FROM "User" u
        JOIN "Membership" ms ON ms."userId" = u.id AND ms."academyId" = $1
       WHERE u.email LIKE '%@lifeclub.pt'
         AND NOT EXISTS (SELECT 1 FROM "Member" m WHERE m."academyId" = $1 AND m."userId" = u.id)
       ORDER BY u.email LIMIT 3`,
      [LC],
    )
  ).rows;
  check("(preparação) há três utilizadores do clube sem ficha de sócio", livres.length === 3, livres.map((u) => u.email).join(", "));
  if (livres.length < 3) throw new Error("sem contas livres para o teste");
  const [contaAcabou, contaNaoAcabou, contaDia] = livres;

  const director = await login("direcao@lifeclub.pt");
  const tier = (await call(director, "POST", "/api/members/tiers", { name: "ZB Anual", feeCents: 3000, billing: "ANNUAL", isPublic: false })).body;
  check("(preparação) a categoria anual existe", Boolean(tier?.id));

  const authDaDireccao = (await db.query(`SELECT "authId" FROM "User" WHERE email = 'direcao@lifeclub.pt' LIMIT 1`)).rows[0]?.authId;
  await db.query(
    `INSERT INTO "PlatformAdmin" (id, "authId", name, email, role, "isActive", "updatedAt")
     VALUES ('zb_admin', $1, 'ZB Admin de teste', 'zb-admin@teste.local', 'OWNER', true, now())`, [authDaDireccao],
  );
  const emitir = () => call(director, "POST", `/api/platform/billing/emitir?academia=${LC}`);
  const abertura = (m, d = 1) => call(director, "PATCH", "/api/member-annual-period", { startMonth: m, startDay: d });
  const quotas = async (id) =>
    (await db.query(`SELECT id, period, label, status, to_char("dueOn", 'YYYY-MM-DD') AS d FROM "MemberFee" WHERE "memberId" = $1 ORDER BY period`, [id])).rows;
  const avisos = async (userId, feeIds) =>
    (await db.query(`SELECT type, body, payload FROM "Notification" WHERE "userId" = $1 AND "academyId" = $2 AND payload->>'memberFeeId' = ANY($3)`, [userId, LC, feeIds])).rows;
  const socio = async (id, nome, numero, conta) =>
    db.query(
      `INSERT INTO "Member" (id, "academyId", "tierId", "userId", name, number, status, source, "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVE', 'secretaria', now())`, [id, LC, tier.id, conta.id, nome, numero],
    );
  const quotaPaga = (id, memberId, period, label, vence) =>
    db.query(
      `INSERT INTO "MemberFee" (id, "academyId", "memberId", period, label, "amountCents", "dueOn", status, "settledAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, 3000, ${vence}, 'SETTLED', now() - interval '200 days', now())`, [id, LC, memberId, period, label],
    );
  const sessao = async (email) => {
    const t = await login(email);
    const pend = ((await call(t, "GET", "/api/legal/status")).body?.pending ?? []).map((d) => d.id);
    if (pend.length) await call(t, "POST", "/api/legal/accept", { documentIds: pend });
    return t;
  };

  /* ====================================================================== */
  /* 1. O período acabou: o ano abre no dia 1 do mês corrente               */
  /* ====================================================================== */
  console.log(`=== 1. O ano do clube abre a 1 de ${mm(MES)}: o período anterior acabou ===`);
  const mudou1 = await abertura(MES, 1);
  check("a direcção põe a abertura do clube", mudou1.status === 200 && mudou1.body?.startMonth === MES && mudou1.body?.startDay === 1, `${mudou1.status} ${JSON.stringify(mudou1.body)}`);

  await socio("zb_acabou", "ZB Período Acabou", 98811, contaAcabou);
  const PERIODO_ANTERIOR = `${ANO - 1}-${mm(MES)}`;
  const PERIODO_NOVO = `${ANO}-${mm(MES)}`;
  await quotaPaga("zb_fee_anterior", "zb_acabou", PERIODO_ANTERIOR, `Quota anual ${rotulo(MES, ANO - 1)}`, "now() - interval '40 days'");
  const socioAcabou = await sessao(contaAcabou.email);

  const antes1 = await call(socioAcabou, "GET", "/api/socio/inicio");
  check("antes da emissão, a app não tem nada em aberto", antes1.status === 200 && (antes1.body?.fees ?? []).every((f) => f.status !== "OPEN"), `${antes1.status}`);

  const passe1 = await emitir();
  check("a emissão corre (2xx)", passe1.status === 200 || passe1.status === 201, `${passe1.status} ${JSON.stringify(passe1.body).slice(0, 120)}`);

  const doAcabou = await quotas("zb_acabou");
  check("nasceu a quota do período novo", doAcabou.length === 2 && doAcabou[1].period === PERIODO_NOVO, JSON.stringify(doAcabou.map((q) => [q.period, q.status])));
  check("em aberto", doAcabou[1]?.status === "OPEN", `${doAcabou[1]?.status}`);
  check("com o rótulo do período novo", doAcabou[1]?.label === `Quota anual ${rotulo(MES, ANO)}`, `${doAcabou[1]?.label}`);
  check("a vencer no fim deste mês, não no dia em que nasceu", doAcabou[1]?.d === FIM_DO_MES, `${doAcabou[1]?.d} (esperava ${FIM_DO_MES})`);

  await emitir();
  check("repetir a emissão não duplica", (await quotas("zb_acabou")).length === 2);

  const avisos1 = await avisos(contaAcabou.id, doAcabou.map((q) => q.id));
  check("recebeu um aviso, e só um", avisos1.length === 1, `${avisos1.length}`);
  check("do tipo pagamento pendente", avisos1[0]?.type === "PAYMENT_PENDING", `${avisos1[0]?.type}`);
  check("a falar da quota anual, não de um mês", /anual/i.test(avisos1[0]?.body ?? ""), `${avisos1[0]?.body}`);
  check("a apontar para a quota nova", avisos1[0]?.payload?.memberFeeId === doAcabou[1]?.id, JSON.stringify(avisos1[0]?.payload));

  const depois1 = await call(socioAcabou, "GET", "/api/socio/inicio");
  const abertas1 = (depois1.body?.fees ?? []).filter((f) => f.status === "OPEN");
  check("a app mostra uma quota em aberto — a nova", abertas1.length === 1 && abertas1[0].period === PERIODO_NOVO, JSON.stringify(abertas1.map((f) => f.period)));
  check("dentro do prazo, não em atraso", abertas1[0]?.overdue === false, `${abertas1[0]?.overdue}`);
  check("`upcoming` é o período novo, já com quota", depois1.body?.upcoming?.length === 1 && depois1.body.upcoming[0].period === PERIODO_NOVO && depois1.body.upcoming[0].feeId === doAcabou[1]?.id, `${depois1.status} ${JSON.stringify(depois1.body?.upcoming ?? depois1.body).slice(0, 200)}`);

  console.log("\n--- as guardas do pagamento, antes da euPago");
  const umMes = await call(socioAcabou, "POST", `/api/socio/quotas/mes/${ANO}-${mm(MES_SEGUINTE)}/pagar`, { method: "MULTIBANCO" });
  check("pagar \"um mês\" numa categoria anual é recusado (400)", umMes.status === 400, `${umMes.status} ${umMes.body?.message}`);
  const numerario = await call(socioAcabou, "POST", `/api/socio/quotas/${doAcabou[1]?.id}/pagar`, { method: "CASH" });
  check("CASH não é pagamento online (400)", numerario.status === 400, `${numerario.status}`);
  const ate = await call(socioAcabou, "POST", `/api/socio/quotas/ate/${PERIODO_NOVO}/pagar`, { method: "MULTIBANCO" });
  check("\"pagar até\" é das mensais — recusado (400)", ate.status === 400, `${ate.status}`);

  console.log("\n--- a direcção marca a nova como paga: a app fica limpa");
  const marcou = await call(director, "PATCH", `/api/members/fees/${doAcabou[1]?.id}/status`, { status: "SETTLED" });
  check("marca como paga", marcou.status === 200, `${marcou.status}`);
  const limpa = await call(socioAcabou, "GET", "/api/socio/inicio");
  check("já não há nada em aberto", (limpa.body?.fees ?? []).every((f) => f.status !== "OPEN"));
  check("`upcoming` mostra o período como pago", limpa.body?.upcoming?.[0]?.status === "SETTLED", JSON.stringify(limpa.body?.upcoming));
  await emitir();
  check("e a emissão seguinte não traz nada de novo", (await quotas("zb_acabou")).length === 2);

  /* ====================================================================== */
  /* 2. Ainda não acabou: o ano abre no mês seguinte                        */
  /* ====================================================================== */
  console.log(`\n=== 2. O ano do clube abre a 1 de ${mm(MES_SEGUINTE)}: o período corrente acaba no fim deste mês ===`);
  const mudou2 = await abertura(MES_SEGUINTE, 1);
  check("a direcção muda a abertura do clube", mudou2.status === 200 && mudou2.body?.startMonth === MES_SEGUINTE, `${mudou2.status}`);

  /* O sócio deste cenário nasce agora — se existisse no cenário 1, a emissão de lá dava-lhe a quota de lá. */
  await socio("zb_nao_acabou", "ZB Período Não Acabou", 98812, contaNaoAcabou);
  const PERIODO_CORRENTE = `${ANO_ABERTURA_SEGUINTE}-${mm(MES_SEGUINTE)}`;
  const PERIODO_SEGUINTE = `${ANO_ABERTURA_SEGUINTE + 1}-${mm(MES_SEGUINTE)}`;
  await quotaPaga("zb_fee_corrente", "zb_nao_acabou", PERIODO_CORRENTE, `Quota anual ${rotulo(MES_SEGUINTE, ANO_ABERTURA_SEGUINTE)}`, "now() + interval '10 days'");
  const socioNaoAcabou = await sessao(contaNaoAcabou.email);

  const passe2 = await emitir();
  check("a emissão corre (2xx)", passe2.status === 200 || passe2.status === 201, `${passe2.status}`);
  const doNaoAcabou = await quotas("zb_nao_acabou");
  check("continua com uma quota só — a corrente, paga", doNaoAcabou.length === 1 && doNaoAcabou[0].status === "SETTLED", JSON.stringify(doNaoAcabou.map((q) => [q.period, q.status])));
  await emitir();
  check("nem cria a do período seguinte antes do tempo", (await quotas("zb_nao_acabou")).length === 1);
  check("não recebeu aviso nenhum", (await avisos(contaNaoAcabou.id, doNaoAcabou.map((q) => q.id))).length === 0);

  const inicio2 = await call(socioNaoAcabou, "GET", "/api/socio/inicio");
  check("a app não tem nada em aberto", (inicio2.body?.fees ?? []).every((f) => f.status !== "OPEN"));
  check("`upcoming` é o período corrente, marcado como pago — nada a fazer", inicio2.body?.upcoming?.length === 1 && inicio2.body.upcoming[0].period === PERIODO_CORRENTE && inicio2.body.upcoming[0].status === "SETTLED", `${inicio2.status} ${JSON.stringify(inicio2.body?.upcoming ?? inicio2.body).slice(0, 200)}`);
  check("e o seguinte não é oferecido", !(inicio2.body?.upcoming ?? []).some((u) => u.period === PERIODO_SEGUINTE));

  console.log("\n--- as guardas do pagamento, antes da euPago");
  const seguinte = await call(socioNaoAcabou, "POST", `/api/socio/quotas/mes/${PERIODO_SEGUINTE}/pagar`, { method: "MULTIBANCO" });
  check("pagar o período seguinte antes do tempo é recusado (400)", seguinte.status === 400, `${seguinte.status} ${seguinte.body?.message}`);
  check("e a mensagem explica", /seguinte|corrente/i.test(seguinte.body?.message ?? ""), `${seguinte.body?.message}`);
  check("e não nasceu quota nenhuma", (await quotas("zb_nao_acabou")).length === 1);
  const jaPaga = await call(socioNaoAcabou, "POST", `/api/socio/quotas/mes/${PERIODO_CORRENTE}/pagar`, { method: "MULTIBANCO" });
  check("pagar o corrente já pago é recusado (400)", jaPaga.status === 400, `${jaPaga.status} ${jaPaga.body?.message}`);
  check("porque já está paga", /paga/i.test(jaPaga.body?.message ?? ""), `${jaPaga.body?.message}`);
  const alheia = await call(socioNaoAcabou, "POST", `/api/socio/quotas/${doAcabou[1]?.id}/pagar`, { method: "MULTIBANCO" });
  check("outro sócio não paga a quota deste (404)", alheia.status === 404, `${alheia.status}`);

  /* ====================================================================== */
  /* 3. O dia conta: o ano abre amanhã                                       */
  /* ====================================================================== */
  if (DIA >= DIAS_DO_MES[MES - 1]) {
    console.log("\n=== 3. SALTO — hoje é o último dia do mês, não há 'amanhã' dentro dele ===");
  } else {
    console.log(`\n=== 3. O ano do clube abre a ${DIA + 1} de ${mm(MES)}: hoje ainda é o período do ano passado ===`);
    const mudou3 = await abertura(MES, DIA + 1);
    check("a direcção põe o dia de abertura amanhã", mudou3.status === 200 && mudou3.body?.startDay === DIA + 1, `${mudou3.status} ${JSON.stringify(mudou3.body)}`);

    await socio("zb_dia", "ZB Abre Amanhã", 98813, contaDia);
    const PERIODO_DO_ANO_PASSADO = `${ANO - 1}-${mm(MES)}`;
    await quotaPaga("zb_fee_dia", "zb_dia", PERIODO_DO_ANO_PASSADO, `Quota anual ${rotulo(MES, ANO - 1)}`, "now() + interval '1 day'");
    const socioDia = await sessao(contaDia.email);

    await emitir();
    const doDia = await quotas("zb_dia");
    check("a emissão não cria a quota deste ano — o período só abre amanhã", doDia.length === 1 && doDia[0].period === PERIODO_DO_ANO_PASSADO, JSON.stringify(doDia.map((q) => [q.period, q.status])));
    const inicio3 = await call(socioDia, "GET", "/api/socio/inicio");
    check("a app diz que o período corrente é o do ano passado, pago", inicio3.body?.upcoming?.[0]?.period === PERIODO_DO_ANO_PASSADO && inicio3.body?.upcoming?.[0]?.status === "SETTLED", JSON.stringify(inicio3.body?.upcoming));
    const cedo = await call(socioDia, "POST", `/api/socio/quotas/mes/${ANO}-${mm(MES)}/pagar`, { method: "MULTIBANCO" });
    check("pagar o período que abre amanhã é recusado (400)", cedo.status === 400, `${cedo.status} ${cedo.body?.message}`);
    const ficha3 = await call(director, "GET", "/api/members/zb_dia");
    check("a ficha também está no ano passado", ficha3.body?.fees?.currentPeriod === PERIODO_DO_ANO_PASSADO, `${ficha3.body?.fees?.currentPeriod}`);
  }

  /*
   * "Marcar como paga" deixa um `Payment` manual (CASH, provedor `manual`) como
   * rasto — esse é suposto existir. O que não pode existir é um pagamento
   * **online** a nascer de uma das tentativas recusadas.
   */
  check("nenhuma tentativa de pagamento online chegou a nascer — tudo parou nas guardas",
    (await db.query(`SELECT COUNT(*)::int n FROM "Payment" WHERE provider <> 'manual' AND "memberFeeId" IN (SELECT id FROM "MemberFee" WHERE "memberId" LIKE 'zb_%')`)).rows[0].n === 0);

  console.log("\n--- a abertura do clube não aceita disparates");
  check("o mês 13 é recusado (400)", (await abertura(13)).status === 400);
  check("o dia 0 é recusado (400)", (await abertura(3, 0)).status === 400);
  check("30 de Fevereiro é recusado (400)", (await abertura(2, 30)).status === 400);
  check("31 de Abril é recusado (400)", (await abertura(4, 31)).status === 400);
  check("29 de Fevereiro é recusado — só existe de quatro em quatro anos (400)", (await abertura(2, 29)).status === 400);
  check("15 de Setembro aceita-se", (await abertura(9, 15)).status === 200);
  const treinador = await login("treinador@lifeclub.pt");
  check("um treinador não muda a abertura do clube (403)", (await call(treinador, "PATCH", "/api/member-annual-period", { startMonth: 3 })).status === 403);
} finally {
  console.log("\n=== Limpeza ===");
  const alheias = await limpar();
  console.log(`  quotas nascidas a sócios a sério durante o teste, apagadas: ${alheias}`);
  const restos = (await db.query(`SELECT COUNT(*)::int n FROM "Member" WHERE id LIKE 'zb_%'`)).rows[0].n
    + (await db.query(`SELECT COUNT(*)::int n FROM "MemberTier" WHERE name LIKE 'ZB %'`)).rows[0].n;
  check("tudo apagado", restos === 0, `${restos} linhas ficaram`);
  const depois = (await db.query(`SELECT "memberAnnualStartMonth" AS m, "memberAnnualStartDay" AS d FROM "Academy" WHERE id = $1`, [LC])).rows[0];
  check(`a abertura do clube voltou ao que era (${original.d}/${original.m})`, depois.m === original.m && depois.d === original.d, JSON.stringify(depois));
  await db.end();
}

console.log(`\n${ok} OK · ${bad} falhas`);
process.exit(bad === 0 ? 0 : 1);

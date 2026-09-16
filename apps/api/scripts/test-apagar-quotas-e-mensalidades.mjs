#!/usr/bin/env node
/**
 * Apagar quotas de sócio e mensalidades de atleta.
 *
 * ## O pedido
 *
 * *"Devia dar para apagar quotas criadas, além de mudar o estado — quotas e
 * mensalidades."* Mudar o estado deixa a linha no livro e na app; às vezes foi
 * lançada por engano e o que se quer é que nunca tenha existido.
 *
 * ## O que este teste guarda
 *
 * 1. **Apaga-se** uma quota por pagar, uma marcada paga à mão, e uma mensalidade
 *    — mensal ou avulsa.
 * 2. **Não volta.** A emissão automática cria o que falta, e uma apagada é, para
 *    ela, uma que falta: sem a marca (`MemberFeeSkip`, `ChargeSkip`) a quota do
 *    mês voltava na passagem seguinte. Nem a emissão, nem o botão "Gerar
 *    mensalidades", nem a app do sócio a trazem de volta.
 * 3. **Lançar à mão é voltar atrás** — a marca sai, e a linha volta a existir.
 * 4. **Duas coisas travam**: paga online (apagá-la levava o registo do dinheiro
 *    que entrou) e uma tentativa online ainda viva (o webhook ignora pagamentos
 *    que não encontra, e o dinheiro entrava sem rasto). Uma referência expirada
 *    já não trava. Um pagamento de grupo ("pagar até") conta para cada quota
 *    que cobre, não só para a âncora.
 * 5. Sem permissão, não se apaga.
 *
 * ## Onde corre
 *
 * As **quotas** no Life Club, com sócios de teste criados pela base (sem
 * convites). A emissão que o teste dispara também cria quotas a sócios a sério
 * — as que a varredura horária criaria de qualquer forma —, e por isso tira-se
 * uma fotografia antes e apaga-se o que nasceu.
 *
 * As **mensalidades** num clube descartável com um atleta sem encarregado: a
 * emissão de mensalidades avisa as famílias, e no Life Club isso eram avisos a
 * contas reais (e pushes para telemóveis reais). A direcção do Life Club
 * empresta a conta, com uma membership de dono (OWNER) no clube descartável — os termos de âmbito de clube só os aceita quem o representa.
 *
 * Nunca chama a euPago: os pagamentos são inseridos na base.
 *
 * Uso: node scripts/test-apagar-quotas-e-mensalidades.mjs   (com a API em :3000)
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

const call = async (token, method, pathname, body, slug = "life-club", app = "console") => {
  const r = await fetch(API + pathname, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "x-academy-slug": slug,
      ...(app ? { "x-app": app } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};

const db = new pg.Client({ connectionString: env("MIGRATE_DATABASE_URL"), ssl: { rejectUnauthorized: false } });
await db.connect();

const mm = (m) => String(m).padStart(2, "0");
const agora = new Date();
const CORRENTE = `${agora.getFullYear()}-${mm(agora.getMonth() + 1)}`;
const ANTERIOR = (() => { const d = new Date(agora.getFullYear(), agora.getMonth() - 1, 1); return `${d.getFullYear()}-${mm(d.getMonth() + 1)}`; })();
const DOIS_ATRAS = (() => { const d = new Date(agora.getFullYear(), agora.getMonth() - 2, 1); return `${d.getFullYear()}-${mm(d.getMonth() + 1)}`; })();

const LC = (await db.query(`SELECT id FROM "Academy" WHERE slug = 'life-club'`)).rows[0].id;
const ZX = "zx_academia";
const quotasAntes = new Set((await db.query(`SELECT id FROM "MemberFee" WHERE "academyId" = $1`, [LC])).rows.map((r) => r.id));
const direcaoUser = (await db.query(`SELECT id, "authId" FROM "User" WHERE email = 'direcao@lifeclub.pt'`)).rows[0];

const limpar = async () => {
  /* Life Club: os sócios de teste, e o que a emissão criou a sócios a sério. */
  const alheias = (await db.query(`SELECT id FROM "MemberFee" WHERE "academyId" = $1 AND "memberId" NOT LIKE 'zx_%'`, [LC]))
    .rows.map((r) => r.id).filter((id) => !quotasAntes.has(id));
  const dosTestes = (await db.query(`SELECT id FROM "MemberFee" WHERE "memberId" LIKE 'zx_%'`)).rows.map((r) => r.id);
  const fees = [...alheias, ...dosTestes];
  if (fees.length) {
    await db.query(`DELETE FROM "Notification" WHERE payload->>'memberFeeId' = ANY($1)`, [fees]);
    await db.query(`DELETE FROM "Payment" WHERE "memberFeeId" = ANY($1)`, [fees]);
    await db.query(`DELETE FROM "MemberFee" WHERE id = ANY($1)`, [fees]);
  }
  await db.query(`DELETE FROM "Payment" WHERE id LIKE 'zx_%'`);
  await db.query(`DELETE FROM "MemberFeeSkip" WHERE "memberId" LIKE 'zx_%'`);
  await db.query(`DELETE FROM "Member" WHERE id LIKE 'zx_%'`);
  await db.query(`DELETE FROM "MemberTier" WHERE "academyId" = $1 AND name LIKE 'ZX %'`, [LC]);

  /* O clube descartável. */
  await db.query(`DELETE FROM "Notification" WHERE "academyId" = $1`, [ZX]);
  await db.query(`DELETE FROM "ChargeSkip" WHERE "academyId" = $1`, [ZX]);
  await db.query(`DELETE FROM "Charge" WHERE "academyId" = $1`, [ZX]);
  await db.query(`DELETE FROM "TeamMembership" WHERE "athleteId" LIKE 'zx_%'`);
  await db.query(`DELETE FROM "SubscriptionPlan" WHERE "academyId" = $1`, [ZX]);
  await db.query(`DELETE FROM "Athlete" WHERE "academyId" = $1`, [ZX]);
  await db.query(`DELETE FROM "Team" WHERE "academyId" = $1`, [ZX]);
  await db.query(`DELETE FROM "Season" WHERE "academyId" = $1`, [ZX]);
  await db.query(`DELETE FROM "LegalAcceptance" WHERE "academyId" = $1`, [ZX]).catch(() => undefined);
  await db.query(`DELETE FROM "Membership" WHERE "academyId" = $1`, [ZX]);
  await db.query(`DELETE FROM "Sport" WHERE "academyId" = $1`, [ZX]);
  await db.query(`DELETE FROM "Academy" WHERE id = $1`, [ZX]);
  await db.query(`DELETE FROM "PlatformAdmin" WHERE id = 'zx_admin'`);
};
await limpar();

const pagamento = (id, feeOuCharge, coluna, { status, provider = "eupago", method = "MULTIBANCO", expira = null }) =>
  db.query(
    `INSERT INTO "Payment" (id, "${coluna}", "amountCents", method, status, provider, "providerRef", "expiresAt", "paidAt", "updatedAt")
     VALUES ($1, $2, 1000, $3, $4, $5, $1, ${expira ?? "NULL"}, ${status === "PAID" ? "now()" : "NULL"}, now())`,
    [id, feeOuCharge, method, status, provider],
  );

try {
  const director = await login("direcao@lifeclub.pt");
  const treinador = await login("treinador@lifeclub.pt");

  await db.query(
    `INSERT INTO "PlatformAdmin" (id, "authId", name, email, role, "isActive", "updatedAt")
     VALUES ('zx_admin', $1, 'ZX Admin de teste', 'zx-admin@teste.local', 'OWNER', true, now())`, [direcaoUser.authId],
  );

  /* ====================================================================== */
  /* Quotas de sócio                                                         */
  /* ====================================================================== */
  console.log("=== Quotas: apagar uma por pagar ===");
  const tier = (await call(director, "POST", "/api/members/tiers", { name: "ZX Mensal", feeCents: 1000, billing: "MONTHLY", isPublic: false })).body;
  check("(preparação) categoria mensal", Boolean(tier?.id));

  /* Uma conta do clube sem ficha de sócio, para ver a app. */
  const conta = (await db.query(
    `SELECT u.id, u.email FROM "User" u JOIN "Membership" ms ON ms."userId" = u.id AND ms."academyId" = $1
      WHERE u.email LIKE '%@lifeclub.pt' AND NOT EXISTS (SELECT 1 FROM "Member" m WHERE m."academyId" = $1 AND m."userId" = u.id)
      ORDER BY u.email LIMIT 1`, [LC])).rows[0];
  check("(preparação) há uma conta livre para a app", Boolean(conta), "");

  await db.query(
    `INSERT INTO "Member" (id, "academyId", "tierId", "userId", name, number, status, source, "updatedAt")
     VALUES ('zx_socio', $1, $2, $3, 'ZX Sócio', 98831, 'ACTIVE', 'secretaria', now())`, [LC, tier.id, conta?.id ?? null],
  );
  const lancou = await call(director, "POST", "/api/members/zx_socio/fees", { periods: [ANTERIOR, CORRENTE], amountCents: 1000 });
  check("(preparação) duas quotas lançadas", lancou.body?.created === 2, JSON.stringify(lancou.body));

  const quota = async (period) => (await db.query(`SELECT id, status FROM "MemberFee" WHERE "memberId" = 'zx_socio' AND period = $1`, [period])).rows[0];
  const skip = async (period) => (await db.query(`SELECT 1 FROM "MemberFeeSkip" WHERE "memberId" = 'zx_socio' AND period = $1`, [period])).rows.length === 1;

  const anterior = await quota(ANTERIOR);
  const semPermissao = await call(treinador, "DELETE", `/api/members/fees/${anterior.id}`);
  check("um treinador não apaga (403)", semPermissao.status === 403, `${semPermissao.status}`);

  const apagou = await call(director, "DELETE", `/api/members/fees/${anterior.id}`);
  check("a direcção apaga a do mês anterior", apagou.status === 200 && apagou.body?.ok === true, `${apagou.status} ${JSON.stringify(apagou.body)}`);
  check("a linha saiu", !(await quota(ANTERIOR)));
  check("e ficou a marca de que foi apagada", await skip(ANTERIOR));
  check("apagar outra vez dá 404", (await call(director, "DELETE", `/api/members/fees/${anterior.id}`)).status === 404);

  console.log("\n=== Quotas: a do mês corrente não volta ===");
  const corrente = await quota(CORRENTE);
  check("apaga a do mês corrente", (await call(director, "DELETE", `/api/members/fees/${corrente.id}`)).status === 200);
  const ficha = await call(director, "GET", "/api/members/zx_socio");
  check("a ficha diz que foi apagada, não que está por lançar", ficha.body?.fees?.currentStatus === "dismissed", `${ficha.body?.fees?.currentStatus}`);

  const emitir = await call(director, "POST", `/api/platform/billing/emitir?academia=${LC}`);
  check("a emissão automática corre (2xx)", emitir.status === 200 || emitir.status === 201, `${emitir.status}`);
  check("e não a recria", !(await quota(CORRENTE)));

  if (conta) {
    const socio = await login(conta.email);
    const pend = ((await call(socio, "GET", "/api/legal/status", null, "life-club", null)).body?.pending ?? []).map((d) => d.id);
    if (pend.length) await call(socio, "POST", "/api/legal/accept", { documentIds: pend }, "life-club", null);
    const inicio = await call(socio, "GET", "/api/socio/inicio", null, "life-club", null);
    check("a app do sócio abre", inicio.status === 200, `${inicio.status}`);
    check("e não oferece a pagar o mês apagado", !(inicio.body?.upcoming ?? []).some((u) => u.period === CORRENTE), JSON.stringify((inicio.body?.upcoming ?? []).map((u) => u.period)));
    const pagar = await call(socio, "POST", `/api/socio/quotas/mes/${CORRENTE}/pagar`, { method: "MULTIBANCO" }, "life-club", null);
    check("pagar o mês apagado pela app é recusado (400)", pagar.status === 400, `${pagar.status} ${pagar.body?.message}`);
    check("com a razão", /dispensou/i.test(pagar.body?.message ?? ""), `${pagar.body?.message}`);
    check("e a app não o fez nascer", !(await quota(CORRENTE)));
  }

  console.log("\n=== Quotas: lançar à mão é voltar atrás ===");
  const relancou = await call(director, "POST", "/api/members/zx_socio/fees", { periods: [CORRENTE], amountCents: 1000 });
  check("lança-se outra vez", relancou.body?.created === 1, JSON.stringify(relancou.body));
  check("e a marca saiu", !(await skip(CORRENTE)));

  console.log("\n=== Quotas: marcada paga à mão apaga-se, com o pagamento manual ===");
  const deNovo = await quota(CORRENTE);
  await call(director, "PATCH", `/api/members/fees/${deNovo.id}/status`, { status: "SETTLED" });
  const manuais = async (id) => (await db.query(`SELECT count(*)::int n FROM "Payment" WHERE "memberFeeId" = $1`, [id])).rows[0].n;
  check("(preparação) ficou um pagamento manual", (await manuais(deNovo.id)) === 1);
  check("apaga a paga à mão", (await call(director, "DELETE", `/api/members/fees/${deNovo.id}`)).status === 200);
  check("e o pagamento manual saiu com ela", (await manuais(deNovo.id)) === 0);

  console.log("\n=== Quotas: o que trava ===");
  await call(director, "POST", "/api/members/zx_socio/fees", { periods: [DOIS_ATRAS], amountCents: 1000 });
  const travada = await quota(DOIS_ATRAS);

  await pagamento("zx_pay_online", travada.id, "memberFeeId", { status: "PAID" });
  const online = await call(director, "DELETE", `/api/members/fees/${travada.id}`);
  check("paga online: recusa (400)", online.status === 400, `${online.status}`);
  check("a dizer porquê", /online/i.test(online.body?.message ?? ""), `${online.body?.message}`);
  check("e continua lá", Boolean(await quota(DOIS_ATRAS)));
  await db.query(`DELETE FROM "Payment" WHERE id = 'zx_pay_online'`);

  await pagamento("zx_pay_viva", travada.id, "memberFeeId", { status: "PENDING", expira: "now() + interval '2 days'" });
  const viva = await call(director, "DELETE", `/api/members/fees/${travada.id}`);
  check("referência Multibanco viva: recusa (400)", viva.status === 400, `${viva.status}`);
  check("a dizer porquê", /Multibanco/i.test(viva.body?.message ?? ""), `${viva.body?.message}`);

  await db.query(`UPDATE "Payment" SET "expiresAt" = now() - interval '1 day' WHERE id = 'zx_pay_viva'`);
  check("expirada, já não trava", (await call(director, "DELETE", `/api/members/fees/${travada.id}`)).status === 200);

  /* O pagamento de grupo: âncora noutra quota, esta coberta pela tabela de ligação. */
  await call(director, "POST", "/api/members/zx_socio/fees", { periods: [ANTERIOR, DOIS_ATRAS], amountCents: 1000 });
  const ancora = await quota(DOIS_ATRAS);
  const coberta = await quota(ANTERIOR);
  await pagamento("zx_pay_grupo", ancora.id, "memberFeeId", { status: "PENDING", expira: "now() + interval '2 days'" });
  await db.query(`INSERT INTO "MemberFeePayment" ("paymentId", "memberFeeId") VALUES ('zx_pay_grupo', $1), ('zx_pay_grupo', $2)`, [ancora.id, coberta.id]);
  const grupo = await call(director, "DELETE", `/api/members/fees/${coberta.id}`);
  check("coberta por um \"pagar até\" vivo (sem ser a âncora): recusa (400)", grupo.status === 400, `${grupo.status} ${grupo.body?.message}`);

  /* ====================================================================== */
  /* Mensalidades de atleta — num clube descartável                          */
  /* ====================================================================== */
  console.log("\n=== Mensalidades: preparar o clube descartável ===");
  await db.query(
    `INSERT INTO "Academy" (id, slug, name, "shortName", status, "billingDueDay", "billingMonths", "updatedAt")
     VALUES ($1, 'zx-teste-apagar', 'ZX Teste Apagar', 'ZX', 'ACTIVE', 8, $2, now())`, [ZX, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]],
  );
  await db.query(`INSERT INTO "Sport" (id, "academyId", name, positions, skills) VALUES ('zx_sport', $1, 'Futebol', ARRAY[]::text[], ARRAY[]::text[])`, [ZX]);
  await db.query(`INSERT INTO "Season" (id, "academyId", label, "startsOn", "endsOn", "isCurrent") VALUES ('zx_season', $1, '2026/27', '2026-08-01', '2027-07-31', true)`, [ZX]);
  await db.query(`INSERT INTO "Team" (id, "academyId", "sportId", "seasonId", name, "maxAge", "updatedAt") VALUES ('zx_team', $1, 'zx_sport', 'zx_season', 'ZX Sub-13', 13, now())`, [ZX]);
  await db.query(`INSERT INTO "SubscriptionPlan" (id, "academyId", "teamId", name, "amountCents", "isActive") VALUES ('zx_plan', $1, 'zx_team', 'ZX Plano', 3500, true)`, [ZX]);
  await db.query(`INSERT INTO "Athlete" (id, "academyId", name, birthdate, status, "joinedAt", "updatedAt") VALUES ('zx_atleta', $1, 'ZX Atleta', '2013-05-05', 'ACTIVE', '2025-01-10', now())`, [ZX]);
  await db.query(`INSERT INTO "TeamMembership" (id, "teamId", "athleteId") VALUES ('zx_tm', 'zx_team', 'zx_atleta')`);
  await db.query(`INSERT INTO "Membership" (id, "academyId", "userId", role, "isActive", "updatedAt") VALUES ('zx_memb_dir', $1, $2, 'OWNER', true, now())`, [ZX, direcaoUser.id]);

  const Z = "zx-teste-apagar";
  /*
   * Os termos do clube novo. Os de âmbito de clube (Termos, DPA) só os aceita
   * quem o representa, e a primeira vez com a confirmação de poderes — por isso
   * a membership emprestada é de dono (`OWNER`), e vai `confirmAuthority`.
   */
  const pend = ((await call(director, "GET", "/api/legal/status", null, Z)).body?.pending ?? []).map((d) => d.id);
  if (pend.length) {
    const aceite = await call(director, "POST", "/api/legal/accept", { documentIds: pend, confirmAuthority: true }, Z);
    check("(preparação) os termos do clube descartável ficam aceites", aceite.status === 200 || aceite.status === 201, `${aceite.status} ${JSON.stringify(aceite.body).slice(0, 160)}`);
  }
  const mensalidade = async (period = CORRENTE) =>
    (await db.query(`SELECT id, kind FROM "Charge" WHERE "athleteId" = 'zx_atleta' AND period = $1 AND kind = 'FEE'`, [period])).rows[0];
  const chargeSkip = async (period = CORRENTE) =>
    (await db.query(`SELECT 1 FROM "ChargeSkip" WHERE "athleteId" = 'zx_atleta' AND period = $1`, [period])).rows.length === 1;

  const emissao = await call(director, "POST", `/api/platform/billing/emitir?academia=${ZX}`);
  check("a emissão cria a mensalidade do mês", (emissao.status === 200 || emissao.status === 201) && Boolean(await mensalidade()), `${emissao.status} ${JSON.stringify(emissao.body).slice(0, 120)}`);

  console.log("\n=== Mensalidades: apagar, e não voltar ===");
  const m1 = await mensalidade();
  const apagaM = await call(director, "DELETE", `/api/charges/${m1.id}`, null, Z);
  check("a direcção apaga a mensalidade do mês", apagaM.status === 200 && apagaM.body?.ok === true, `${apagaM.status} ${JSON.stringify(apagaM.body)}`);
  check("a linha saiu", !(await mensalidade()));
  check("e ficou a marca", await chargeSkip());

  await call(director, "POST", `/api/platform/billing/emitir?academia=${ZX}`);
  check("a emissão automática não a recria", !(await mensalidade()));
  const gerar = await call(director, "POST", `/api/charges/gerar?periodo=${CORRENTE}`, null, Z);
  check("nem o botão \"Gerar mensalidades\"", (gerar.status === 200 || gerar.status === 201) && !(await mensalidade()), `${gerar.status}`);

  console.log("\n=== Mensalidades: lançar à mão é voltar atrás ===");
  const manual = await call(director, "POST", "/api/charges/mensalidade", { athleteId: "zx_atleta", amountCents: 3500, periods: [CORRENTE] }, Z);
  check("lança-se à mão", (manual.status === 200 || manual.status === 201) && Boolean(await mensalidade()), `${manual.status} ${JSON.stringify(manual.body).slice(0, 120)}`);
  check("e a marca saiu", !(await chargeSkip()));

  console.log("\n=== Mensalidades: o que trava ===");
  const m2 = await mensalidade();
  await pagamento("zx_pay_m_online", m2.id, "chargeId", { status: "PAID" });
  const mOnline = await call(director, "DELETE", `/api/charges/${m2.id}`, null, Z);
  check("paga online: recusa (400)", mOnline.status === 400 && /online/i.test(mOnline.body?.message ?? ""), `${mOnline.status} ${mOnline.body?.message}`);
  await db.query(`DELETE FROM "Payment" WHERE id = 'zx_pay_m_online'`);

  await pagamento("zx_pay_m_mbway", m2.id, "chargeId", { status: "PENDING", method: "MBWAY" });
  const mbway = await call(director, "DELETE", `/api/charges/${m2.id}`, null, Z);
  check("MB Way com menos de dez minutos: recusa (400)", mbway.status === 400 && /MB Way/i.test(mbway.body?.message ?? ""), `${mbway.status} ${mbway.body?.message}`);
  await db.query(`UPDATE "Payment" SET "createdAt" = now() - interval '15 minutes' WHERE id = 'zx_pay_m_mbway'`);
  check("com mais de dez minutos, já não trava", (await call(director, "DELETE", `/api/charges/${m2.id}`, null, Z)).status === 200);

  console.log("\n=== Mensalidades: uma avulsa apaga-se sem marca ===");
  const avulsa = await call(director, "POST", "/api/charges/avulsa", {
    athleteId: "zx_atleta", title: "ZX Equipamento", amountCents: 2000, dueDate: `${CORRENTE}-20`,
  }, Z);
  const avulsaId = avulsa.body?.id ?? (await db.query(`SELECT id FROM "Charge" WHERE "athleteId" = 'zx_atleta' AND kind = 'EXTRA'`)).rows[0]?.id;
  check("(preparação) a avulsa existe", Boolean(avulsaId), `${avulsa.status} ${JSON.stringify(avulsa.body).slice(0, 120)}`);
  const skipsAntes = (await db.query(`SELECT count(*)::int n FROM "ChargeSkip" WHERE "athleteId" = 'zx_atleta'`)).rows[0].n;
  check("apaga a avulsa", (await call(director, "DELETE", `/api/charges/${avulsaId}`, null, Z)).status === 200);
  const skipsDepois = (await db.query(`SELECT count(*)::int n FROM "ChargeSkip" WHERE "athleteId" = 'zx_atleta'`)).rows[0].n;
  check("e não deixa marca — uma avulsa não se emite", skipsDepois === skipsAntes, `${skipsAntes} → ${skipsDepois}`);
} finally {
  console.log("\n=== Limpeza ===");
  await limpar();
  const restos =
    (await db.query(`SELECT count(*)::int n FROM "Member" WHERE id LIKE 'zx_%'`)).rows[0].n +
    (await db.query(`SELECT count(*)::int n FROM "Academy" WHERE id = $1`, [ZX])).rows[0].n;
  check("tudo apagado", restos === 0, `${restos} linhas ficaram`);
  await db.end();
}

console.log(`\n${ok} OK · ${bad} falhas`);
process.exit(bad === 0 ? 0 : 1);

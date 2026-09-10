#!/usr/bin/env node
/**
 * A app do clube — contextos, área de sócio, quotas e sondagens.
 *
 * ## O que se prova
 *
 *  - **Uma conta, vários contextos.** Quem só é pai tem [FAMILY]; quem só é
 *    sócio tem [MEMBER]; quem é os dois tem os dois — e é a mesma conta.
 *  - **O convite reclama a ficha.** O token do email cria (ou liga) a conta com
 *    o email **da ficha**, marca `userId`, e morre ao ser usado.
 *  - **A área de sócio é só do próprio.** A ficha, as quotas e o voto são de
 *    quem entrou; outro clube não responde; um estranho não entra.
 *  - **Quotas.** Geradas da categoria, idempotentes, liquidáveis ao balcão e
 *    pelo webhook — que é o único caminho que confirma dinheiro online.
 *  - **Sondagens.** Um sócio, um voto; rascunho→aberta→fechada; resultados.
 *
 * ## O que NÃO se toca
 *
 * A euPago real. O arranque de um pagamento online criaria uma referência a
 * sério no provedor; aqui o pagamento nasce na base e confirma-se pelo webhook
 * assinado — que é exactamente o caminho que a produção percorre a partir do
 * momento em que o dinheiro entra.
 *
 * O resgate do convite está atrás de um throttle apertado (5/min) — correr a
 * suite duas vezes seguidas dá 429 nesse bloco. Espera um minuto entre corridas.
 *
 * Uso: node scripts/test-app-do-clube.mjs
 */
import { createHash, createHmac, randomBytes } from "node:crypto";
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
const SR = env("SUPABASE_SERVICE_ROLE_KEY");
const API = process.env.API_URL ?? "http://127.0.0.1:3000";

let ok = 0, bad = 0;
const check = (l, c, d = "") => { if (c) { ok++; console.log("  OK    " + l); } else { bad++; console.log("  FALHA " + l + (d ? " — " + d : "")); } };

const login = async (email, password = "academia2026") =>
  (await (await fetch(`${S}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: A, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  })).json()).access_token;

const call = async (token, method, pathname, body, slug = "life-club") => {
  const r = await fetch(API + pathname, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "x-academy-slug": slug,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};

const db = new pg.Client({ connectionString: env("MIGRATE_DATABASE_URL"), ssl: { rejectUnauthorized: false } });
await db.connect();

const AC = "acd_lifeclub";
const EMAIL_SOCIO = `zz-socio-${Date.now().toString(36)}@exemplo.pt`;
let authIdCriado = null;

const limpar = async () => {
  await db.query(`DELETE FROM "Poll" WHERE "academyId" = $1 AND question LIKE 'ZZ %'`, [AC]);
  await db.query(`DELETE FROM "MemberFee" WHERE "academyId" = $1 AND "memberId" IN (SELECT id FROM "Member" WHERE name LIKE 'ZZ %')`, [AC]);
  await db.query(`DELETE FROM "Member" WHERE "academyId" = $1 AND name LIKE 'ZZ %'`, [AC]);
  await db.query(`DELETE FROM "MemberTier" WHERE "academyId" = $1 AND name LIKE 'ZZ %'`, [AC]);
  await db.query(`DELETE FROM "Announcement" WHERE "academyId" = $1 AND title LIKE 'ZZ %'`, [AC]);
  await db.query(`DELETE FROM "WebhookEvent" WHERE "eventId" LIKE 'zz-%'`);
  await db.query(`DELETE FROM "User" WHERE email LIKE 'zz-socio-%@exemplo.pt'`);
};
await limpar();

try {
  const director = await login("direcao@lifeclub.pt");
  const familia = await login("familia@lifeclub.pt");

  /* ------------------------------------------------------------------ */
  console.log("=== Contextos: quem só é pai ===");
  const soPai = await call(familia, "GET", "/api/app/contexts");
  check("responde", soPai.status === 200, `${soPai.status} ${JSON.stringify(soPai.body).slice(0, 120)}`);
  check("tem o contexto de família", soPai.body?.contexts?.some((c) => c.type === "FAMILY"));
  check("e não o de sócio", !soPai.body?.contexts?.some((c) => c.type === "MEMBER"));
  check("nem o de staff", !soPai.body?.contexts?.some((c) => c.type === "STAFF"));

  /*
   * Staff: qualquer membership que não seja de família. A app não desenha essa
   * vista — entrega a pessoa à consola — mas tem de saber que existe para a
   * oferecer no ecrã de escolha, com o papel para o nomear.
   */
  const treinador = await login("treinador@lifeclub.pt");
  const doTreinador = await call(treinador, "GET", "/api/app/contexts");
  check("um treinador responde", doTreinador.status === 200, `${doTreinador.status}`);
  const staff = doTreinador.body?.contexts?.find((c) => c.type === "STAFF");
  check("tem o contexto de staff", Boolean(staff), JSON.stringify(doTreinador.body?.contexts));
  check("com o papel dele", staff?.role === "COACH", `${staff?.role}`);

  /* ------------------------------------------------------------------ */
  console.log("\n=== A ficha de sócio, com categoria e quota ===");
  const tier = await call(director, "POST", "/api/members/tiers", {
    name: "ZZ Categoria Efectivo", feeCents: 1000, benefits: [], isPublic: false,
  });
  check("a categoria cria-se", tier.status === 201 || tier.status === 200, `${tier.status}`);

  /*
   * A ficha nasce pela base, e não por POST /api/members — de propósito.
   *
   * Criar pela API dispara o convite automático (é a funcionalidade!), que
   * (1) manda um email real do Resend para um endereço inventado a cada corrida
   * e (2) corre em fundo e escreve o SEU token por cima do que este teste
   * semeia — o gancho lê a ficha já com o email que o teste lá pôs entretanto,
   * e a suite ficava intermitente. A criação pela API tem os seus testes
   * (test-socios-leve); aqui o sócio é só o suporte do convite e das quotas.
   */
  const memberId = `zz_member_${Date.now().toString(36)}`;
  await db.query(
    `INSERT INTO "Member" (id, "academyId", "tierId", name, email, number, status, "approvedAt", source, "updatedAt")
     VALUES ($1, $2, $3, 'ZZ Sócio de Teste', $4, 90000 + floor(random() * 9000)::int, 'ACTIVE', now(), 'secretaria', now())`,
    [memberId, AC, tier.body?.id, EMAIL_SOCIO],
  );
  check("(preparação) a ficha existe", true);

  /* ------------------------------------------------------------------ */
  console.log("\n=== O convite reclama a ficha ===");
  /*
   * O token põe-se na base directamente, em vez de se pedir o envio do email:
   * o servidor de testes tem uma chave Resend a sério, e cada corrida a mandar
   * correio para um endereço inventado é spam pago. O que interessa provar é o
   * resgate — e esse percorre-se por inteiro.
   */
  const tokenConvite = randomBytes(32).toString("base64url");
  await db.query(`UPDATE "Member" SET "inviteTokenHash" = $2, "inviteSentAt" = now() WHERE id = $1`, [
    memberId, createHash("sha256").update(tokenConvite).digest("hex"),
  ]);

  const preview = await call(null, "GET", `/api/convite-socio/${tokenConvite}`);
  check("o convite abre sem sessão", preview.status === 200, `${preview.status}`);
  check("diz o clube", preview.body?.academy?.slug === "life-club", JSON.stringify(preview.body?.academy).slice(0, 80));
  check("e o primeiro nome", preview.body?.firstName === "ZZ", `${preview.body?.firstName}`);
  check("mas só uma ponta do email", preview.body?.emailHint?.includes("••"), `${preview.body?.emailHint}`);
  check("e nunca o NIF nem a morada", !JSON.stringify(preview.body).match(/taxId|address|birthdate/));

  const fraca = await call(null, "POST", `/api/convite-socio/${tokenConvite}/registar`, { password: "curta" });
  check("uma password curta é recusada (400)", fraca.status === 400, `${fraca.status}`);

  const registo = await call(null, "POST", `/api/convite-socio/${tokenConvite}/registar`, { password: "academia2026", acceptLegal: true });
  check("o registo cria a conta e devolve a sessão", registo.status === 201 || registo.status === 200, `${registo.status} ${JSON.stringify(registo.body).slice(0, 140)}`);
  check("com o slug do clube", registo.body?.slug === "life-club");

  const ligado = (await db.query(`SELECT "userId", "inviteTokenHash" FROM "Member" WHERE id = $1`, [memberId])).rows[0];
  check("a ficha ficou reclamada", Boolean(ligado?.userId));
  check("e o convite morreu ao ser usado", ligado?.inviteTokenHash === null);
  authIdCriado = ligado?.userId
    ? ((await db.query(`SELECT "authId" FROM "User" WHERE id = $1`, [ligado.userId])).rows[0]?.authId ?? null)
    : null;

  const outraVez = await call(null, "POST", `/api/convite-socio/${tokenConvite}/registar`, { password: "academia2026", acceptLegal: true });
  check("o mesmo link outra vez já não entra (404)", outraVez.status === 404, `${outraVez.status}`);

  /* ------------------------------------------------------------------ */
  console.log("\n=== Contextos: quem só é sócio ===");
  const socio = registo.body?.accessToken ?? null;
  const soSocio = await call(socio, "GET", "/api/app/contexts");
  check("a conta nova responde", soSocio.status === 200, `${soSocio.status}`);
  check("tem só o contexto de sócio", soSocio.body?.contexts?.length === 1 && soSocio.body.contexts[0].type === "MEMBER", JSON.stringify(soSocio.body?.contexts));
  check("com o número no contexto", Boolean(soSocio.body?.contexts?.[0]?.number));

  /* ------------------------------------------------------------------ */
  console.log("\n=== Quotas: lançadas da categoria ===");
  /*
   * A quota do mês nasce sozinha, no dia 1 — o botão "Gerar quotas" deixou de
   * existir e a rota com ele. A emissão prova-se em `test-quotas-automaticas.mjs`,
   * num clube descartável; aqui lança-se à mão a do sócio de teste, que é a
   * outra porta e a que o resto deste ficheiro precisa.
   */
  const foiRota = await call(director, "POST", "/api/members/fees/generate");
  check("o botão de gerar quotas já não existe (404)", foiRota.status === 404, `${foiRota.status}`);

  const PERIODO = new Date().toISOString().slice(0, 7);
  const lancou = await call(director, "POST", `/api/members/${memberId}/fees`, {
    periods: [PERIODO],
    amountCents: 1000,
  });
  check("a direcção lança a quota do mês na ficha", lancou.body?.created === 1, `${lancou.status} ${JSON.stringify(lancou.body)}`);
  const repetida = await call(director, "POST", `/api/members/${memberId}/fees`, {
    periods: [PERIODO],
    amountCents: 1000,
  });
  check("lançar o mesmo mês outra vez não duplica", repetida.body?.created === 0, JSON.stringify(repetida.body));

  const doZZ = await call(director, "GET", `/api/members/${memberId}/fees`);
  check("a ficha lista a quota", doZZ.body?.length === 1, `${doZZ.body?.length}`);
  check("com o valor da categoria", doZZ.body?.[0]?.amountCents === 1000, `${doZZ.body?.[0]?.amountCents}`);
  const feeId = doZZ.body?.[0]?.id;

  /* ------------------------------------------------------------------ */
  console.log("\n=== A área de sócio ===");
  const inicio = await call(socio, "GET", "/api/socio/inicio");
  check("o início abre", inicio.status === 200, `${inicio.status} ${JSON.stringify(inicio.body).slice(0, 140)}`);
  check("com a ficha do próprio", inicio.body?.member?.name === "ZZ Sócio de Teste");
  check("a quota em aberto", inicio.body?.fees?.some((f) => f.id === feeId && f.status === "OPEN"));
  check("o QR do cartão vem desligado por omissão", inicio.body?.academy?.cardQrEnabled === false && inicio.body?.member?.cardQr === null, JSON.stringify({ qr: inicio.body?.academy?.cardQrEnabled, cardQr: inicio.body?.member?.cardQr }));
  check("sem NIF nem morada na resposta", !JSON.stringify(inicio.body?.member ?? {}).match(/taxId|address|documentNumber/));
  check("os pagamentos online estão ligados", inicio.body?.academy?.onlinePayments === true, `${inicio.body?.academy?.onlinePayments}`);

  /* Os meses que a app oferece a pagar: do corrente até Julho, fim da época. */
  const hoje = new Date();
  const mesCorrente = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}`;
  const anoFim = hoje.getMonth() + 1 >= 8 ? hoje.getFullYear() + 1 : hoje.getFullYear();
  const upcoming = inicio.body?.upcoming ?? [];
  check("os próximos meses começam no corrente", upcoming[0]?.period === mesCorrente, JSON.stringify(upcoming[0]));
  check("e acabam em Julho, fim da época", upcoming.at(-1)?.period === `${anoFim}-07`, `${upcoming.at(-1)?.period}`);
  check("o corrente traz a quota que já existe", upcoming[0]?.feeId === feeId && upcoming[0]?.status === "OPEN", JSON.stringify(upcoming[0]));
  check("os outros trazem o valor da categoria e ainda sem quota", upcoming.slice(1).every((m) => m.feeId === null && m.amountCents === 1000 && /^Quota de /.test(m.label)), JSON.stringify(upcoming[1]));

  console.log("\n=== Pagar um mês pela app: as guardas ===");
  const proximo = upcoming[1]?.period;
  const foraDaEpoca = await call(socio, "POST", `/api/socio/quotas/mes/${anoFim}-08/pagar`, { method: "MULTIBANCO" });
  check("Agosto do ano seguinte já é outra época (400)", foraDaEpoca.status === 400, `${foraDaEpoca.status}`);
  const passado = await call(socio, "POST", `/api/socio/quotas/mes/${hoje.getFullYear() - 1}-01/pagar`, { method: "MULTIBANCO" });
  check("um mês passado não se paga pela app (400)", passado.status === 400, `${passado.status}`);
  const mesMau = await call(socio, "POST", `/api/socio/quotas/mes/setembro/pagar`, { method: "MULTIBANCO" });
  check("um mês fora do formato (400)", mesMau.status === 400, `${mesMau.status}`);
  const numerario = await call(socio, "POST", `/api/socio/quotas/mes/${proximo}/pagar`, { method: "CASH" });
  check("CASH não é pagamento online (400)", numerario.status === 400, `${numerario.status}`);
  const naoSocio = await call(familia, "POST", `/api/socio/quotas/mes/${proximo}/pagar`, { method: "MULTIBANCO" });
  check("quem não é sócio não paga meses (404)", naoSocio.status === 404, `${naoSocio.status}`);
  const semQuotaCriada = (await db.query(`SELECT count(*)::int AS n FROM "MemberFee" WHERE "memberId" = $1 AND period = $2`, [memberId, proximo])).rows[0].n;
  check("nenhuma das guardas criou quota", semQuotaCriada === 0, `${semQuotaCriada}`);

  /* O QR só existe quando o clube o liga — e a portaria só o lê então. */
  const ligarQr = await call(director, "PATCH", "/api/member-card", { qrEnabled: true });
  check("o clube liga o QR nas definições", ligarQr.status === 200 && ligarQr.body?.qrEnabled === true, `${ligarQr.status} ${JSON.stringify(ligarQr.body)}`);
  const inicioComQr = await call(socio, "GET", "/api/socio/inicio");
  check("e o cartão passa a trazer o QR opaco", String(inicioComQr.body?.member?.cardQr ?? "").startsWith("academias:socio:"));

  const noutroClube = await call(socio, "GET", "/api/socio/inicio", undefined, "ad-fafe");
  check("noutro clube não há ficha (404)", noutroClube.status === 404, `${noutroClube.status}`);
  const paiNaAreaDeSocio = await call(familia, "GET", "/api/socio/inicio");
  check("quem não é sócio não entra (404)", paiNaAreaDeSocio.status === 404, `${paiNaAreaDeSocio.status}`);
  const semSessao = await call(null, "GET", "/api/socio/inicio");
  check("sem sessão é 401", semSessao.status === 401, `${semSessao.status}`);

  /* O QR valida-se na portaria — atrás de member:read, e só devolve o cartão. */
  const tokenCartao = String(inicioComQr.body?.member?.cardQr ?? "").replace("academias:socio:", "");
  const portaria = await call(director, "GET", `/api/members/card/${tokenCartao}`);
  check("a portaria troca o QR pelo sócio", portaria.status === 200 && portaria.body?.name === "ZZ Sócio de Teste", `${portaria.status}`);
  check("só nome, número, categoria e estado", Object.keys(portaria.body ?? {}).sort().join(",") === "name,number,status,tierName");
  const portariaAnonima = await call(null, "GET", `/api/members/card/${tokenCartao}`);
  check("sem sessão, o QR não diz nada (401)", portariaAnonima.status === 401, `${portariaAnonima.status}`);
  await call(director, "PATCH", "/api/member-card", { qrEnabled: false });

  /* ------------------------------------------------------------------ */
  console.log("\n=== O webhook liquida a quota ===");
  const paymentId = `zz_pay_${Date.now().toString(36)}`;
  await db.query(
    `INSERT INTO "Payment" (id, "memberFeeId", "amountCents", method, status, provider, "providerRef", "updatedAt")
     VALUES ($1, $2, 1000, 'MBWAY', 'PROCESSING', 'eupago', $1, now())`,
    [paymentId, feeId],
  );

  const corpo = JSON.stringify({
    transactions: { identifier: paymentId, reference: paymentId, trid: `zz-${paymentId}`, amount: { value: 10 }, status: "PAID", date: new Date().toISOString() },
  });
  const assinatura = createHmac("sha256", env("EUPAGO_WEBHOOK_SECRET")).update(corpo, "utf8").digest("base64");
  const webhook = await fetch(`${API}/webhooks/eupago`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-signature": assinatura },
    body: corpo,
  });
  check("o webhook aceita", webhook.status === 200, `${webhook.status}`);

  const depoisDoWebhook = (await db.query(`SELECT status, "settledAt", method FROM "MemberFee" WHERE id = $1`, [feeId])).rows[0];
  check("a quota liquidou", depoisDoWebhook?.status === 'SETTLED', JSON.stringify(depoisDoWebhook));
  check("com o método do pagamento", depoisDoWebhook?.method === "MBWAY");
  const estadoPagamento = (await db.query(`SELECT status FROM "Payment" WHERE id = $1`, [paymentId])).rows[0];
  check("e o pagamento ficou PAID", estadoPagamento?.status === "PAID", `${estadoPagamento?.status}`);

  /* Um valor errado não liquida — 1 € não paga uma quota de 10 €. */
  const feeId2 = (await db.query(
    `INSERT INTO "MemberFee" (id, "academyId", "memberId", period, "amountCents", "updatedAt")
     VALUES ('zz_fee2_' || $1, $2, $3, '2099-01', 1000, now()) RETURNING id`,
    [Date.now().toString(36), AC, memberId],
  )).rows[0].id;
  const payment2 = `zz_pay2_${Date.now().toString(36)}`;
  await db.query(
    `INSERT INTO "Payment" (id, "memberFeeId", "amountCents", method, status, provider, "providerRef", "updatedAt")
     VALUES ($1, $2, 1000, 'MBWAY', 'PROCESSING', 'eupago', $1, now())`,
    [payment2, feeId2],
  );
  const corpo2 = JSON.stringify({
    transactions: { identifier: payment2, reference: payment2, trid: `zz-${payment2}`, amount: { value: 0.01 }, status: "PAID", date: new Date().toISOString() },
  });
  const sig2 = createHmac("sha256", env("EUPAGO_WEBHOOK_SECRET")).update(corpo2, "utf8").digest("base64");
  await fetch(`${API}/webhooks/eupago`, { method: "POST", headers: { "Content-Type": "application/json", "x-signature": sig2 }, body: corpo2 });
  const divergente = (await db.query(`SELECT status FROM "MemberFee" WHERE id = $1`, [feeId2])).rows[0];
  check("um valor divergente não liquida", divergente?.status === "OPEN", `${divergente?.status}`);

  /* ------------------------------------------------------------------ */
  console.log("\n=== Pagar da app: só o dono, só métodos a sério ===");
  const metodoMau = await call(socio, "POST", `/api/socio/quotas/${feeId2}/pagar`, { method: "CASH" });
  check("CASH não é pagamento online (400)", metodoMau.status === 400, `${metodoMau.status}`);
  const quotaAlheia = await call(familia, "POST", `/api/socio/quotas/${feeId2}/pagar`, { method: "MULTIBANCO" });
  check("quem não é sócio não paga quotas (404)", quotaAlheia.status === 404, `${quotaAlheia.status}`);

  /* ------------------------------------------------------------------ */
  console.log("\n=== Sondagens ===");
  const poll = await call(director, "POST", "/api/polls", {
    question: "ZZ Qual deve ser o equipamento da próxima época?",
    options: ["Riscas", "Liso", "Aos quadrados"],
  });
  check("a direcção cria", poll.status === 201 || poll.status === 200, `${poll.status}`);
  const pollId = poll.body?.id;

  const cedo = await call(socio, "POST", `/api/socio/sondagens/${pollId}/votar`, { optionId: "qualquer" });
  check("num rascunho não se vota", cedo.status === 400 || cedo.status === 404, `${cedo.status}`);

  await call(director, "POST", `/api/polls/${pollId}/publish`);
  const aberta = (await call(socio, "GET", "/api/socio/inicio")).body?.polls?.find((p) => p.id === pollId);
  check("aberta, aparece na app", Boolean(aberta), "não veio no início");
  check("com as três opções", aberta?.options?.length === 3);

  const opcao = aberta.options[1].id;
  const voto = await call(socio, "POST", `/api/socio/sondagens/${pollId}/votar`, { optionId: opcao });
  check("o sócio vota", voto.status === 201 || voto.status === 200, `${voto.status} ${JSON.stringify(voto.body)}`);
  const repetido = await call(socio, "POST", `/api/socio/sondagens/${pollId}/votar`, { optionId: opcao });
  check("o segundo voto é recusado (409)", repetido.status === 409, `${repetido.status}`);

  const resultados = (await call(director, "GET", "/api/polls")).body?.find((p) => p.id === pollId);
  check("a consola vê o resultado", resultados?.totalVotes === 1 && resultados.options.find((o) => o.id === opcao)?.votes === 1);

  await call(director, "POST", `/api/polls/${pollId}/close`);
  const tarde = await call(socio, "POST", `/api/socio/sondagens/${pollId}/votar`, { optionId: opcao });
  check("fechada, já não se vota (400)", tarde.status === 400, `${tarde.status}`);

  const paiVota = await call(familia, "POST", `/api/socio/sondagens/${pollId}/votar`, { optionId: opcao });
  check("quem não é sócio não vota (404)", paiVota.status === 404, `${paiVota.status}`);

  /* ------------------------------------------------------------------ */
  console.log("\n=== Notícias: a audiência dos sócios ===");
  const aviso = await call(director, "POST", "/api/announcements", {
    title: "ZZ Comunicado aos sócios", body: "A assembleia geral é já no sábado.", audience: "members",
  });
  check("a direcção publica para Sócios", aviso.status === 201 || aviso.status === 200, `${aviso.status} ${JSON.stringify(aviso.body).slice(0, 100)}`);

  const noticias = (await call(socio, "GET", "/api/socio/inicio")).body?.news ?? [];
  check("o sócio vê o comunicado", noticias.some((n) => n.title === "ZZ Comunicado aos sócios"));

  /* ------------------------------------------------------------------ */
  console.log("\n=== A ficha liga-se sozinha à conta que já existe ===");
  /*
   * O pai que também é sócio: a direcção inscreve-o com o email da conta que
   * ele já tem na app. Não há botão nenhum — a ficha é dele na primeira
   * ocasião: ao gravar na consola, ou quando ele abre a app. Aqui a ficha
   * nasce na base (sem passar pela consola, para o teste provar o caminho da
   * app) e é o `/api/app/contexts` que a reclama.
   */
  const idLigar = `zz_lig_${Date.now().toString(36)}`;
  await db.query(
    `INSERT INTO "Member" (id, "academyId", name, email, number, status, source, "updatedAt")
     VALUES ($1, $2, 'ZZ Sócio Ligado', 'familia@lifeclub.pt', 98765, 'ACTIVE', 'secretaria', now())`,
    [idLigar, AC],
  );

  const doisContextos = await call(familia, "GET", "/api/app/contexts");
  check("o pai abre a app e tem os dois contextos", doisContextos.body?.contexts?.length === 2, JSON.stringify(doisContextos.body?.contexts));
  check("família e sócio", ["FAMILY", "MEMBER"].every((t) => doisContextos.body?.contexts?.some((c) => c.type === t)));
  const ligada = (await db.query(`SELECT "userId" FROM "Member" WHERE id = $1`, [idLigar])).rows[0];
  check("e a ficha ficou com dono", Boolean(ligada?.userId), JSON.stringify(ligada));

  const outraFicha = `zz_lig2_${Date.now().toString(36)}`;
  await db.query(
    `INSERT INTO "Member" (id, "academyId", name, email, number, status, source, "updatedAt")
     VALUES ($1, $2, 'ZZ Segunda Ficha', 'familia@lifeclub.pt', 98766, 'ACTIVE', 'secretaria', now())`,
    [outraFicha, AC],
  );
  const aindaDois = await call(familia, "GET", "/api/app/contexts");
  check("uma conta não fica com duas fichas do mesmo clube", aindaDois.body?.contexts?.length === 2, JSON.stringify(aindaDois.body?.contexts));
  const segunda = (await db.query(`SELECT "userId" FROM "Member" WHERE id = $1`, [outraFicha])).rows[0];
  check("a segunda ficha fica sem dono", segunda?.userId === null, JSON.stringify(segunda));

  /* Uma conta de outro clube com o mesmo email não se cola: só quem tem vínculo aqui. */
  const idForasteiro = `zz_lig3_${Date.now().toString(36)}`;
  const forasteiro = (await db.query(
    `SELECT u.email FROM "User" u
      WHERE NOT EXISTS (SELECT 1 FROM "Membership" m WHERE m."userId" = u.id AND m."academyId" = $1)
        AND NOT EXISTS (SELECT 1 FROM "Member" mb WHERE mb."userId" = u.id AND mb."academyId" = $1)
      LIMIT 1`, [AC])).rows[0];
  if (forasteiro) {
    await db.query(
      `INSERT INTO "Member" (id, "academyId", name, email, number, status, source, "updatedAt")
       VALUES ($1, $2, 'ZZ Forasteiro', $3, 98767, 'ACTIVE', 'secretaria', now())`,
      [idForasteiro, AC, forasteiro.email],
    );
    const editada = await call(director, "PATCH", `/api/members/${idForasteiro}`, { email: forasteiro.email });
    const semDono = (await db.query(`SELECT "userId" FROM "Member" WHERE id = $1`, [idForasteiro])).rows[0];
    check("uma conta sem vínculo neste clube não é ligada pela consola", editada.status === 200 && semDono?.userId === null, `${editada.status} ${JSON.stringify(semDono)}`);
    await db.query(`DELETE FROM "Member" WHERE id = $1`, [idForasteiro]);
  } else {
    console.log("  SALTO — não há nenhuma conta sem vínculo neste clube para o caso do forasteiro");
  }

  const ligarAntigo = await call(director, "POST", `/api/members/${idLigar}/link-account`);
  check("o botão antigo de ligar já não existe (404)", ligarAntigo.status === 404, `${ligarAntigo.status}`);

  const porTreinador = await call(await login("treinador@lifeclub.pt"), "DELETE", `/api/members/${idLigar}/link-account`);
  check("um treinador não desliga contas (403)", porTreinador.status === 403, `${porTreinador.status}`);

  const desligou = await call(director, "DELETE", `/api/members/${idLigar}/link-account`);
  check("a direcção desliga se foi engano", desligou.status === 200, `${desligou.status}`);
  await db.query(`UPDATE "Member" SET email = 'zz.outro@exemplo.pt' WHERE id = $1`, [idLigar]);
  await db.query(`DELETE FROM "Member" WHERE id = $1`, [outraFicha]);
  const voltouAUm = await call(familia, "GET", "/api/app/contexts");
  check("com o email corrigido, o contexto de sócio desaparece", voltouAUm.body?.contexts?.length === 1, JSON.stringify(voltouAUm.body?.contexts));

  /* O caminho da consola: a ficha muda pela API e liga-se ao gravar. */
  const corrigida = await call(director, "PATCH", `/api/members/${idLigar}`, { email: "familia@lifeclub.pt" });
  const ligadaAoGravar = (await db.query(`SELECT "userId" FROM "Member" WHERE id = $1`, [idLigar])).rows[0];
  check("ao gravar o email na consola, a ficha liga-se logo", corrigida.status === 200 && Boolean(ligadaAoGravar?.userId), `${corrigida.status} ${JSON.stringify(ligadaAoGravar)}`);
  await db.query(`UPDATE "Member" SET "userId" = NULL, email = 'zz.outro@exemplo.pt' WHERE id = $1`, [idLigar]);

  /* Uma ficha sem dono e com email, para o bloco dos convites. */
  await db.query(
    `INSERT INTO "Member" (id, "academyId", name, email, number, status, source, "updatedAt")
     VALUES ($1, $2, 'ZZ Segunda Ficha', 'zz.convite@exemplo.pt', 98766, 'ACTIVE', 'secretaria', now())`,
    [outraFicha, AC],
  );

  console.log("\n=== Os convites de sócio ===");
  /*
   * O interruptor é `MEMBER_INVITES_ENABLED` e nasce desligado (ver
   * `MemberInvitesService.activo`). Desligado, o botão recusa com uma frase.
   * **Ligado, este bloco salta**: o botão mandava um email a sério pelo
   * Resend, e um teste não manda correio a ninguém.
   */
  const convitesLigados = (() => {
    try { return env("MEMBER_INVITES_ENABLED").toLowerCase() === "true"; } catch { return false; }
  })();
  if (convitesLigados) {
    console.log("  SALTO — MEMBER_INVITES_ENABLED=true no .env: não se carrega no botão para não mandar email");
  } else {
    const conviteOff = await call(director, "POST", `/api/members/${outraFicha}/invite`);
    check("o botão de convite recusa com uma frase (400)", conviteOff.status === 400, `${conviteOff.status}`);
    check("e diz que estão desligados", String(conviteOff.body?.message ?? "").includes("desligados"), `${conviteOff.body?.message}`);
    const semToken = (await db.query(`SELECT "inviteTokenHash" FROM "Member" WHERE id = $1`, [outraFicha])).rows[0];
    check("e não deixa um token órfão na ficha", semToken?.inviteTokenHash === null);
  }

  console.log("\n=== O menu de estado da ficha ===");
  const balcao = await call(director, "PATCH", `/api/members/fees/${feeId2}/status`, { status: "SETTLED" });
  check("marcar como paga", balcao.status === 200 && balcao.body?.status === "SETTLED", `${balcao.status}`);
  const reaberta = await call(director, "PATCH", `/api/members/fees/${feeId2}/status`, { status: "OPEN" });
  check("e volta a por pagar se foi engano", reaberta.status === 200 && reaberta.body?.status === "OPEN", `${reaberta.status}`);
  const anulada = await call(director, "PATCH", `/api/members/fees/${feeId2}/status`, { status: "VOID" });
  check("anular uma aberta passa", anulada.status === 200 && anulada.body?.status === "VOID", `${anulada.status}`);
  const pagarAnulada = await call(socio, "POST", `/api/socio/quotas/${feeId2}/pagar`, { method: "MULTIBANCO" });
  check("uma anulada já não se paga (400)", pagarAnulada.status === 400, `${pagarAnulada.status}`);
} finally {
  console.log("\n=== Limpeza ===");
  await limpar();
  if (authIdCriado) {
    const r = await fetch(`${S}/auth/v1/admin/users/${authIdCriado}`, {
      method: "DELETE",
      headers: { apikey: SR, Authorization: `Bearer ${SR}` },
    });
    console.log("  conta de teste no Supabase:", r.ok ? "apagada" : `ficou (HTTP ${r.status})`);
  }
  await db.end();
}

console.log(`\n${ok} passaram, ${bad} falharam`);
process.exit(bad === 0 ? 0 : 1);

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
    name: "ZZ Categoria Efectivo", feeCents: 1000, period: "MONTHLY", benefits: [], isPublic: false,
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

  const registo = await call(null, "POST", `/api/convite-socio/${tokenConvite}/registar`, { password: "academia2026" });
  check("o registo cria a conta e devolve a sessão", registo.status === 201 || registo.status === 200, `${registo.status} ${JSON.stringify(registo.body).slice(0, 140)}`);
  check("com o slug do clube", registo.body?.slug === "life-club");

  const ligado = (await db.query(`SELECT "userId", "inviteTokenHash" FROM "Member" WHERE id = $1`, [memberId])).rows[0];
  check("a ficha ficou reclamada", Boolean(ligado?.userId));
  check("e o convite morreu ao ser usado", ligado?.inviteTokenHash === null);
  authIdCriado = ligado?.userId
    ? ((await db.query(`SELECT "authId" FROM "User" WHERE id = $1`, [ligado.userId])).rows[0]?.authId ?? null)
    : null;

  const outraVez = await call(null, "POST", `/api/convite-socio/${tokenConvite}/registar`, { password: "academia2026" });
  check("o mesmo link outra vez já não entra (404)", outraVez.status === 404, `${outraVez.status}`);

  /* ------------------------------------------------------------------ */
  console.log("\n=== Contextos: quem só é sócio ===");
  const socio = registo.body?.accessToken ?? null;
  const soSocio = await call(socio, "GET", "/api/app/contexts");
  check("a conta nova responde", soSocio.status === 200, `${soSocio.status}`);
  check("tem só o contexto de sócio", soSocio.body?.contexts?.length === 1 && soSocio.body.contexts[0].type === "MEMBER", JSON.stringify(soSocio.body?.contexts));
  check("com o número no contexto", Boolean(soSocio.body?.contexts?.[0]?.number));

  /* ------------------------------------------------------------------ */
  console.log("\n=== Quotas: geradas da categoria ===");
  const g1 = await call(director, "POST", "/api/members/fees/generate");
  check("gerar responde", g1.status === 201 || g1.status === 200, `${g1.status} ${JSON.stringify(g1.body)}`);
  check("criou pelo menos a do ZZ", (g1.body?.created ?? 0) >= 1, `${g1.body?.created}`);
  const g2 = await call(director, "POST", "/api/members/fees/generate");
  check("gerar outra vez não duplica", g2.body?.created === 0, `${g2.body?.created}`);

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
  check("o cartão com QR opaco", String(inicio.body?.member?.cardQr ?? "").startsWith("academias:socio:"));
  check("sem NIF nem morada na resposta", !JSON.stringify(inicio.body?.member ?? {}).match(/taxId|address|documentNumber/));

  const noutroClube = await call(socio, "GET", "/api/socio/inicio", undefined, "ad-fafe");
  check("noutro clube não há ficha (404)", noutroClube.status === 404, `${noutroClube.status}`);
  const paiNaAreaDeSocio = await call(familia, "GET", "/api/socio/inicio");
  check("quem não é sócio não entra (404)", paiNaAreaDeSocio.status === 404, `${paiNaAreaDeSocio.status}`);
  const semSessao = await call(null, "GET", "/api/socio/inicio");
  check("sem sessão é 401", semSessao.status === 401, `${semSessao.status}`);

  /* O QR valida-se na portaria — atrás de member:read, e só devolve o cartão. */
  const tokenCartao = String(inicio.body?.member?.cardQr ?? "").replace("academias:socio:", "");
  const portaria = await call(director, "GET", `/api/members/card/${tokenCartao}`);
  check("a portaria troca o QR pelo sócio", portaria.status === 200 && portaria.body?.name === "ZZ Sócio de Teste", `${portaria.status}`);
  check("só nome, número, categoria e estado", Object.keys(portaria.body ?? {}).sort().join(",") === "name,number,status,tierName");
  const portariaAnonima = await call(null, "GET", `/api/members/card/${tokenCartao}`);
  check("sem sessão, o QR não diz nada (401)", portariaAnonima.status === 401, `${portariaAnonima.status}`);

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
  console.log("\n=== Ligar uma conta que já existe (sem email) ===");
  /*
   * O caminho que faltava no dia em que os convites foram desligados: uma ficha
   * de sócio cujo email é o de uma conta que já existe neste clube — o pai que
   * também é sócio. Ligar é um gesto da direcção, não um emparelhamento
   * automático, e não manda nada a ninguém.
   */
  const idLigar = `zz_lig_${Date.now().toString(36)}`;
  await db.query(
    `INSERT INTO "Member" (id, "academyId", name, email, number, status, source, "updatedAt")
     VALUES ($1, $2, 'ZZ Sócio Ligado', 'familia@lifeclub.pt', 98765, 'ACTIVE', 'secretaria', now())`,
    [idLigar, AC],
  );

  const ligou = await call(director, "POST", `/api/members/${idLigar}/link-account`);
  check("a direcção liga a ficha à conta", ligou.status === 201 || ligou.status === 200, `${ligou.status} ${JSON.stringify(ligou.body).slice(0, 120)}`);
  check("e diz de quem é a conta", ligou.body?.email === "familia@lifeclub.pt", `${ligou.body?.email}`);

  const doisContextos = await call(familia, "GET", "/api/app/contexts");
  check("o pai passa a ter os dois contextos", doisContextos.body?.contexts?.length === 2, JSON.stringify(doisContextos.body?.contexts));
  check("família e sócio", ["FAMILY", "MEMBER"].every((t) => doisContextos.body.contexts.some((c) => c.type === t)));

  const outraFicha = `zz_lig2_${Date.now().toString(36)}`;
  await db.query(
    `INSERT INTO "Member" (id, "academyId", name, email, number, status, source, "updatedAt")
     VALUES ($1, $2, 'ZZ Segunda Ficha', 'familia@lifeclub.pt', 98766, 'ACTIVE', 'secretaria', now())`,
    [outraFicha, AC],
  );
  const duplicada = await call(director, "POST", `/api/members/${outraFicha}/link-account`);
  check("uma conta não fica com duas fichas do mesmo clube (400)", duplicada.status === 400, `${duplicada.status}`);

  const jaLigada = await call(director, "POST", `/api/members/${idLigar}/link-account`);
  check("ligar a mesma ficha outra vez é recusado (400)", jaLigada.status === 400, `${jaLigada.status}`);

  const porTreinador = await call(await login("treinador@lifeclub.pt"), "POST", `/api/members/${idLigar}/link-account`);
  check("um treinador não liga contas (403)", porTreinador.status === 403, `${porTreinador.status}`);

  const desligou = await call(director, "DELETE", `/api/members/${idLigar}/link-account`);
  check("e desliga-se se foi engano", desligou.status === 200, `${desligou.status}`);
  const voltouAUm = await call(familia, "GET", "/api/app/contexts");
  check("o contexto de sócio desaparece", voltouAUm.body?.contexts?.length === 1, JSON.stringify(voltouAUm.body?.contexts));

  console.log("\n=== Os convites de sócio estão desligados ===");
  /*
   * O interruptor é `MEMBER_INVITES_ENABLED` e nasce desligado (ver
   * `MemberInvitesService.activo`). Enquanto assim for, esta é a asserção certa;
   * no dia em que os convites forem ligados é este bloco que passa a esperar
   * 200 — e a falha aqui é o lembrete de que alguém mexeu no interruptor.
   */
  const conviteOff = await call(director, "POST", `/api/members/${outraFicha}/invite`);
  check("o botão de convite recusa com uma frase (400)", conviteOff.status === 400, `${conviteOff.status}`);
  check("e diz que estão desligados", String(conviteOff.body?.message ?? "").includes("desligados"), `${conviteOff.body?.message}`);
  const semToken = (await db.query(`SELECT "inviteTokenHash" FROM "Member" WHERE id = $1`, [outraFicha])).rows[0];
  check("e não deixa um token órfão na ficha", semToken?.inviteTokenHash === null);

  console.log("\n=== Liquidar ao balcão ===");
  const balcao = await call(director, "POST", `/api/members/fees/${feeId2}/settle`, { method: "CASH" });
  check("numerário liquida", balcao.status === 201 || balcao.status === 200, `${balcao.status}`);
  const reaberta = await call(director, "POST", `/api/members/fees/${feeId2}/reopen`);
  check("e reabre-se se foi engano", reaberta.status === 201 || reaberta.status === 200, `${reaberta.status}`);
  const anulada = await call(director, "POST", `/api/members/fees/${feeId2}/void`);
  check("anular uma aberta passa", anulada.status === 201 || anulada.status === 200, `${anulada.status}`);
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

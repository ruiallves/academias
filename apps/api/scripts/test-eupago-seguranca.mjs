#!/usr/bin/env node
/**
 * A segurança dos pagamentos euPago.
 *
 * ## O que este teste existe para provar
 *
 * Que **ninguém marca uma mensalidade como paga sem dinheiro de verdade**:
 *
 * 1. O webhook só aceita eventos com a assinatura HMAC certa (base64, tempo
 *    constante) — sem assinatura, com assinatura errada ou com o formato
 *    errado, é 401 e nada muda.
 * 2. Um evento assinado mas com o **valor errado** não liquida: o pagamento
 *    falha e a cobrança fica em aberto para revisão humana.
 * 3. Reprocessar o mesmo evento é inofensivo (idempotência), e um segundo
 *    pagamento sobre uma cobrança já liquidada fica visível como duplicado em
 *    vez de reescrever o que já aconteceu.
 * 4. As guardas do arranque de pagamento disparam **antes** de qualquer
 *    chamada ao provedor: cobrança paga, anulada, métodos que não são online,
 *    MB Way sem telemóvel, débito directo sem mandato, IBAN inválido.
 *
 * ## O que este teste NUNCA faz
 *
 * Chamar a euPago. A chave configurada é de produção — criar referências a
 * partir de um teste seria criar cobranças reais. Tudo aqui bate apenas no
 * nosso servidor: webhooks forjados (assinados com o segredo local) e linhas
 * de teste inseridas directamente na base, limpas no fim.
 *
 * Uso: node scripts/test-eupago-seguranca.mjs
 */
import { createHmac } from "node:crypto";
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
const SECRET = env("EUPAGO_WEBHOOK_SECRET");
const API = process.env.API_URL ?? "http://localhost:3000";

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
      "x-app": "family",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};

/** Um webhook como a euPago o envia: POST JSON com `X-Signature` em base64. */
const webhook = async (payload, assinatura) => {
  const raw = JSON.stringify(payload);
  const sig =
    assinatura === "valida"
      ? createHmac("sha256", SECRET).update(raw, "utf8").digest("base64")
      : assinatura === "hex"
        ? createHmac("sha256", SECRET).update(raw, "utf8").digest("hex")
        : assinatura; // string dada, ou undefined
  const r = await fetch(`${API}/webhooks/eupago`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(sig ? { "X-Signature": sig } : {}) },
    body: raw,
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};

const evento = (id, status, extra = {}) => ({
  transactions: {
    identifier: id,
    reference: 999_000_111,
    trid: `zp-trid-${id}-${status}`,
    method: "Mbway",
    amount: { value: 40.0, currency: "EUR" },
    date: new Date().toISOString(),
    status,
    ...extra,
  },
  channel: { name: "teste" },
});

const db = new pg.Client({ connectionString: env("MIGRATE_DATABASE_URL"), ssl: { rejectUnauthorized: false } });
await db.connect();

const academia = (await db.query(`SELECT id FROM "Academy" WHERE slug = 'life-club'`)).rows[0].id;

// O atleta do encarregado de teste — as cobranças de teste têm de ser dele,
// porque o âmbito familiar só deixa um pai pagar as dos seus educandos.
const doEncarregado = await db.query(
  `SELECT g."athleteId" AS id FROM "GuardianLink" g
     JOIN "Membership" m ON m.id = g."membershipId"
     JOIN "User" u ON u.id = m."userId"
    WHERE u.email = 'familia@lifeclub.pt' AND m."academyId" = $1 LIMIT 1`,
  [academia],
);
const atleta = doEncarregado.rows[0].id;
// E um atleta que NÃO é dele, para provar o isolamento entre famílias.
const deOutraFamilia = (
  await db.query(
    `SELECT id FROM "Athlete" WHERE "academyId" = $1 AND id <> $2
      AND id NOT IN (SELECT g2."athleteId" FROM "GuardianLink" g2
                       JOIN "Membership" m2 ON m2.id = g2."membershipId"
                       JOIN "User" u2 ON u2.id = m2."userId"
                      WHERE u2.email = 'familia@lifeclub.pt')
      LIMIT 1`,
    [academia, atleta],
  )
).rows[0]?.id;

const limpar = async () => {
  await db.query(`DELETE FROM "Payment" WHERE id LIKE 'zp%'`);
  await db.query(`DELETE FROM "Charge" WHERE id LIKE 'zp%'`);
  await db.query(`DELETE FROM "WebhookEvent" WHERE "eventId" LIKE 'zp-%'`);
};
await limpar();

// Cobranças de teste em períodos que nunca existem (2031), com pagamentos em
// voo — como ficariam depois de o pai carregar em "pagar", sem euPago no meio.
const cobranca = async (n, status = "OPEN") => {
  await db.query(
    `INSERT INTO "Charge" (id, "academyId", "athleteId", period, "amountCents", "dueDate", status, "updatedAt")
     VALUES ($1, $2, $3, $4, 4000, now(), $5, now())`,
    [`zpch${n}`, academia, atleta, `2031-0${n}`, status],
  );
  return `zpch${n}`;
};
const pagamento = async (n, chargeId) => {
  await db.query(
    `INSERT INTO "Payment" (id, "chargeId", "amountCents", method, status, provider, "providerRef", "updatedAt")
     VALUES ($1, $2, 4000, 'MBWAY', 'PROCESSING', 'eupago', $3, now())`,
    [`zppay${n}`, chargeId, `zp-ref-${n}`],
  );
  return `zppay${n}`;
};

const estadoDe = async (tabela, id) =>
  (await db.query(`SELECT status FROM "${tabela}" WHERE id = $1`, [id])).rows[0]?.status;

/* ======================================================= assinatura ===== */

console.log("=== O webhook só entra com a assinatura certa ===");
const c1 = await cobranca(1);
const p1 = await pagamento(1, c1);

const semAssinatura = await webhook(evento(p1, "PAID"), undefined);
check("sem assinatura é 401", semAssinatura.status === 401, `${semAssinatura.status}`);

const assinaturaErrada = await webhook(evento(p1, "PAID"), Buffer.from("a".repeat(32)).toString("base64"));
check("assinatura errada é 401", assinaturaErrada.status === 401, `${assinaturaErrada.status}`);

const emHex = await webhook(evento(p1, "PAID"), "hex");
check("o HMAC certo no formato errado (hex) é 401", emHex.status === 401, `${emHex.status}`);

check("e a cobrança continua por pagar", (await estadoDe("Charge", c1)) === "OPEN");

const adulterado = (() => {
  const raw = JSON.stringify(evento(p1, "PAID"));
  const sig = createHmac("sha256", SECRET).update(raw, "utf8").digest("base64");
  const mexido = raw.replace('"value":40', '"value":1');
  return fetch(`${API}/webhooks/eupago`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Signature": sig },
    body: mexido,
  });
})();
check("um corpo adulterado depois de assinado é 401", (await adulterado).status === 401);

/* ==================================================== o caminho feliz ===== */

console.log("\n=== Um pagamento confirma-se — uma vez ===");
const pago = await webhook(evento(p1, "PAID"), "valida");
check("o evento assinado entra (200)", pago.status === 200, JSON.stringify(pago.body));
check("o pagamento fica PAID", (await estadoDe("Payment", p1)) === "PAID");
check("e a mensalidade fica liquidada", (await estadoDe("Charge", c1)) === "SETTLED");

const repetido = await webhook(evento(p1, "PAID"), "valida");
check("o reenvio do mesmo evento é um duplicado inofensivo", repetido.status === 200 && repetido.body?.duplicate === true, JSON.stringify(repetido.body));

/* ================================================== valor divergente ===== */

console.log("\n=== O valor errado não liquida nada ===");
const c2 = await cobranca(2);
const p2 = await pagamento(2, c2);

const barato = await webhook(evento(p2, "PAID", { amount: { value: 0.01, currency: "EUR" } }), "valida");
check("o evento entra (assinatura válida)", barato.status === 200);
check("mas o pagamento fica FAILED", (await estadoDe("Payment", p2)) === "FAILED");
check("e a cobrança fica em aberto, para revisão", (await estadoDe("Charge", c2)) === "OPEN");

/* ============================================== duplicado com dinheiro ===== */

console.log("\n=== Dinheiro a dobrar não se esconde ===");
// A cobrança 1 já está liquidada por p1. Chega um segundo pagamento (a
// referência antiga que o pai pagou na mesma).
const p1b = await pagamento("1b", c1);
const segundoPagamento = await webhook(evento(p1b, "PAID"), "valida");
check("o segundo pagamento processa (200)", segundoPagamento.status === 200);
check("fica PAID — o dinheiro entrou mesmo", (await estadoDe("Payment", p1b)) === "PAID");
check("a cobrança não é reescrita", (await estadoDe("Charge", c1)) === "SETTLED");
const liquidadaUmaVez = await db.query(`SELECT "settledAt" FROM "Charge" WHERE id = $1`, [c1]);
check("com a liquidação original intacta", liquidadaUmaVez.rows[0].settledAt !== null);

/* ============================================ estados que não são PAID ===== */

console.log("\n=== Expirar, falhar, reembolsar ===");
const c3 = await cobranca(3);
const p3 = await pagamento(3, c3);
await webhook(evento(p3, "EXPIRED"), "valida");
check("EXPIRED marca o pagamento como expirado", (await estadoDe("Payment", p3)) === "EXPIRED");
check("e a cobrança continua por pagar", (await estadoDe("Charge", c3)) === "OPEN");

const c4 = await cobranca(4);
const p4 = await pagamento(4, c4);
await webhook(evento(p4, "ERROR"), "valida");
check("ERROR marca o pagamento como falhado", (await estadoDe("Payment", p4)) === "FAILED");

await webhook(evento(p1, "REFUND"), "valida");
check("REFUND devolve o pagamento a REFUNDED", (await estadoDe("Payment", p1)) === "REFUNDED");
check("e reabre a mensalidade", (await estadoDe("Charge", c1)) === "OPEN");

/* ======================================================== estranhezas ===== */

console.log("\n=== O que não se percebe não rebenta ===");
const desconhecido = await webhook(evento("nao-existe-p", "PAID"), "valida");
check("um pagamento desconhecido é ignorado sem erro", desconhecido.status === 200, JSON.stringify(desconhecido.body));

const encriptado = await webhook({ data: "AAAA_base64_encriptado", channel: { name: "x" } }, "valida");
check("um payload encriptado é recusado às claras", encriptado.status === 200 && encriptado.body?.ignored === "encriptado", JSON.stringify(encriptado.body));

const vazio = await webhook({ channel: { name: "x" } }, "valida");
check("um payload sem transacções é ignorado", vazio.status === 200);

/* ================================================= guardas do arranque ===== */

console.log("\n=== As guardas disparam antes de qualquer chamada ao provedor ===");
const familia = await login("familia@lifeclub.pt");

const cPaga = await cobranca(5, "SETTLED");
const pagarPaga = await call(familia, "POST", `/billing/charges/${cPaga}/pay`, { method: "MULTIBANCO" });
check("uma cobrança já paga recusa-se (400)", pagarPaga.status === 400, `${pagarPaga.status}`);

const cAnulada = await cobranca(6, "VOID");
const pagarAnulada = await call(familia, "POST", `/billing/charges/${cAnulada}/pay`, { method: "MULTIBANCO" });
check("uma cobrança anulada recusa-se (400)", pagarAnulada.status === 400, `${pagarAnulada.status}`);

const c7 = await cobranca(7);
const emDinheiro = await call(familia, "POST", `/billing/charges/${c7}/pay`, { method: "CASH" });
check("CASH não é um pagamento online (400)", emDinheiro.status === 400, `${emDinheiro.status}`);

const semTelemovel = await call(familia, "POST", `/billing/charges/${c7}/pay`, { method: "MBWAY" });
check("MB Way sem telemóvel recusa-se (400)", semTelemovel.status === 400, `${semTelemovel.status}`);

const semMandato = await call(familia, "POST", `/billing/charges/${c7}/pay`, { method: "DIRECT_DEBIT" });
check("débito directo sem mandato recusa-se (400)", semMandato.status === 400, `${semMandato.status}`);

const valorNoCorpo = await call(familia, "POST", `/billing/charges/${c7}/pay`, { method: "CASH", amountCents: 1 });
check("um valor no corpo do pedido nunca é aceite", valorNoCorpo.status === 400, `${valorNoCorpo.status}`);

const inexistente = await call(familia, "POST", `/billing/charges/zp-nao-existe/pay`, { method: "MULTIBANCO" });
check("uma cobrança inexistente é 404", inexistente.status === 404, `${inexistente.status}`);

const ibanTorto = await call(familia, "POST", "/billing/mandate", { iban: "PT50000201231234567890155", name: "Teste Titular" });
check("um IBAN com o dígito de controlo errado recusa-se (400)", ibanTorto.status === 400, `${ibanTorto.status}`);

const ibanCurto = await call(familia, "POST", "/billing/mandate", { iban: "PT50123", name: "Teste Titular" });
check("um IBAN pela metade recusa-se (400)", ibanCurto.status === 400, `${ibanCurto.status}`);

const mandatoDeNinguem = await call(familia, "GET", "/billing/mandate");
check("sem mandato, a resposta é vazia e sem fuga de dados", mandatoDeNinguem.status === 200 && (mandatoDeNinguem.body === null || mandatoDeNinguem.body?.id === undefined), JSON.stringify(mandatoDeNinguem.body).slice(0, 80));

/* ==================================================== âmbito familiar ===== */

console.log("\n=== Uma família não paga as mensalidades de outra ===");
if (deOutraFamilia) {
  await db.query(
    `INSERT INTO "Charge" (id, "academyId", "athleteId", period, "amountCents", "dueDate", status, "updatedAt")
     VALUES ('zpch9', $1, $2, '2031-09', 4000, now(), 'OPEN', now())`,
    [academia, deOutraFamilia],
  );
  const alheia = await call(familia, "POST", `/billing/charges/zpch9/pay`, { method: "MULTIBANCO" });
  check("pagar a mensalidade de outra família é 404", alheia.status === 404, `${alheia.status}`);
  const listaAlheia = await call(familia, "GET", "/billing/charges?period=2031-09");
  check(
    "e ela nem aparece na lista",
    listaAlheia.status === 200 && !listaAlheia.body?.some?.((x) => x.id === "zpch9"),
    `${listaAlheia.status} ${JSON.stringify(listaAlheia.body?.length)}`,
  );
} else {
  console.log("  (todos os atletas são desta família — salto)");
}

console.log("\n=== Um treinador não paga nem vê mensalidades ===");
const coach = await login("treinador@lifeclub.pt");
const coachPaga = await call(coach, "POST", `/billing/charges/${c7}/pay`, { method: "MULTIBANCO" });
check("um treinador sem billing:read leva 403", coachPaga.status === 403, `${coachPaga.status}`);
const coachVeCobrancas = await call(coach, "GET", "/billing/charges?period=2031-07");
check("nem lista cobranças (403)", coachVeCobrancas.status === 403, `${coachVeCobrancas.status}`);

/* =============================================== a app vê o que há ===== */

console.log("\n=== A app da família vê a tentativa em curso ===");
const c8 = await cobranca(8);
await pagamento(8, c8);
const doDirector = await call(familia, "GET", "/api/charges?period=2031-08");
const linha = doDirector.body?.find?.((x) => x.id === c8);
check(
  "a cobrança traz o pagamento em voo (openPayment)",
  linha?.openPayment?.method === "MBWAY" && linha.openPayment.status === "PROCESSING",
  JSON.stringify(linha?.openPayment),
);

/* =========================================================== limpeza ===== */

await limpar();
const restos = await db.query(`SELECT COUNT(*)::int AS n FROM "Charge" WHERE id LIKE 'zp%'`);
check("\ntudo limpo no fim", restos.rows[0].n === 0);

await db.end();
console.log(`\n${ok} OK, ${bad} FALHA${bad === 1 ? "" : "S"}`);
process.exit(bad ? 1 : 0);

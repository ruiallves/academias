#!/usr/bin/env node
/**
 * Sócio-atleta: converter atletas em sócios, e quem paga as quotas.
 *
 * O que se defende (ver `src/members/socio-menor.ts`):
 *   - "Novo sócio" com um atleta escolhido liga a ficha a ele; numa categoria de
 *     menores é paga pela família e não sai convite; o mesmo atleta não é sócio duas vezes;
 *   - um sócio novo (à mão ou importado) com o NIF de um atleta fica associado a ele;
 *   - a quota aparece ao encarregado em `GET /billing/quotas` e paga-se em
 *     `POST /billing/quotas/:id/pay`, em nome dele;
 *   - a ficha nunca se liga a uma conta, nem com o email de uma conta do clube;
 *   - quem não é encarregado do atleta não vê nem paga a quota.
 *
 * Inicia um pagamento, por isso **só corre contra uma API arrancada por nós**,
 * pelo bash, com `EUPAGO_API_KEY=` vazio (as referências são simuladas). Recusa
 * as portas 3000 e 3001. Deixa o Life Club como o encontrou: apaga a ficha, o
 * pagamento e as categorias que criou.
 *
 * Uso: API=http://localhost:3011 node scripts/test-socio-atleta.mjs
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const env = (k) => {
  const l = readFileSync(path.join(HERE, "..", ".env"), "utf8").split(/\r?\n/).find((x) => x.startsWith(`${k}=`));
  if (!l) throw new Error(`${k} não está em .env`);
  return l.slice(k.length + 1).trim().replace(/^"|"$/g, "");
};

const API = process.env.API ?? "http://localhost:3011";
if (/:(3000|3001)\b/.test(API)) throw new Error("Este teste inicia pagamentos: nunca contra a 3000 nem a 3001 (têm a chave real da euPago).");
const SUPABASE_URL = env("SUPABASE_URL").replace(/\/$/, "");
const ANON = env("SUPABASE_ANON_KEY");
const SLUG = "life-club";

let passed = 0;
let failed = 0;
const check = (label, ok, detail = "") => {
  if (ok) passed++;
  else failed++;
  console.log(`  ${ok ? "OK   " : "FALHA"} ${label}${!ok && detail ? ` — ${detail}` : ""}`);
};

async function signIn(email) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "academia2026" }),
  });
  if (!r.ok) throw new Error(`login de ${email}: ${r.status}`);
  return (await r.json()).access_token;
}

async function api(token, method, caminho, body, app) {
  const r = await fetch(`${API}${caminho}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "x-academy-slug": SLUG, "Content-Type": "application/json", ...(app ? { "x-app": app } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const t = await r.text();
  let json = null;
  try { json = t ? JSON.parse(t) : null; } catch { json = t; }
  return { status: r.status, body: json };
}

const idade = (iso) => {
  const d = new Date(iso);
  const h = new Date();
  let a = h.getFullYear() - d.getFullYear();
  if (h.getMonth() < d.getMonth() || (h.getMonth() === d.getMonth() && h.getDate() < d.getDate())) a--;
  return a;
};

const db = new pg.Client({ connectionString: env("MIGRATE_DATABASE_URL"), ssl: { rejectUnauthorized: false } });
await db.connect();

const direcao = await signIn("direcao@lifeclub.pt");
const familia = await signIn("familia@lifeclub.pt");
const treinador = await signIn("treinador@lifeclub.pt");

const criado = { tiers: [], members: [], nifs: [] };

try {
  console.log("\n=== Preparar ===");
  // Um filho do encarregado de teste, menor, que ainda não seja sócio.
  const filhos = (await api(familia, "GET", "/api/athletes", undefined, "family")).body ?? [];
  const socios = (await api(direcao, "GET", "/api/members")).body?.members ?? [];
  const jaSocios = new Set(socios.filter((s) => s.athlete).map((s) => s.athlete.id));
  const filho = filhos.find((a) => a.birthdate && idade(a.birthdate) < 18 && !jaSocios.has(a.id));
  check("há um filho menor do encarregado de teste para converter", !!filho, `filhos: ${filhos.length}`);
  if (!filho) throw new Error("sem atleta para o teste");

  const menores = await api(direcao, "POST", "/api/members/tiers", { name: "[TESTE-SA] Menores", feeCents: 300, billing: "MONTHLY", maxAge: 18, isPublic: false });
  const adultos = await api(direcao, "POST", "/api/members/tiers", { name: "[TESTE-SA] Adultos", feeCents: 600, billing: "MONTHLY", minAge: 18, isPublic: false });
  check("categorias de teste criadas", menores.status === 201 && adultos.status === 201, `${menores.status} ${adultos.status}`);
  criado.tiers.push(menores.body.id, adultos.body.id);

  console.log("\n=== Novo sócio: o atleta escolhido ===");
  const corpo = { name: filho.name, phone: "910000001", tierId: menores.body.id, athleteId: filho.id, status: "PENDING" };
  check("o treinador não cria (403)", (await api(treinador, "POST", "/api/members", corpo)).status === 403);
  const criadoPeloAtleta = await api(direcao, "POST", "/api/members", corpo);
  check("criar o sócio ligado ao filho, numa categoria de menores", criadoPeloAtleta.status === 201 && criadoPeloAtleta.body.athleteId === filho.id && criadoPeloAtleta.body.paidByFamily === true, JSON.stringify(criadoPeloAtleta.body).slice(0, 200));
  const memberId = criadoPeloAtleta.body?.id;
  if (memberId) criado.members.push(memberId);
  const outraVez = await api(direcao, "POST", "/api/members", { ...corpo, phone: "910000002" });
  check("o mesmo atleta não fica sócio duas vezes (400)", outraVez.status === 400 && /já é sócio/i.test(JSON.stringify(outraVez.body)), JSON.stringify(outraVez.body).slice(0, 160));
  // Aprovar gera logo a quota do período (ver `update`), como acontece sozinho ao fim de uma hora.
  await api(direcao, "PATCH", `/api/members/${memberId}`, { status: "ACTIVE" });
  const convites = (await db.query(`SELECT "inviteSentAt" FROM "Member" WHERE id = $1`, [memberId])).rows[0];
  check("não saiu convite nenhum", convites && convites.inviteSentAt === null, JSON.stringify(convites));

  console.log("\n=== Pelo NIF: na criação e na importação ===");
  // Dois atletas do clube que ainda não são sócios, com um NIF de teste posto só durante o teste.
  const outros = ((await api(direcao, "GET", "/api/athletes")).body ?? []).filter((a) => a.id !== filho.id && !jaSocios.has(a.id)).slice(0, 2);
  check("há mais dois atletas para os testes do NIF", outros.length === 2);
  const nifs = ["299999990", "299999991"];
  for (const [i, a] of outros.entries()) {
    const antes = (await db.query(`SELECT "taxId" FROM "Athlete" WHERE id = $1`, [a.id])).rows[0]?.taxId ?? null;
    criado.nifs.push({ id: a.id, antes });
    await db.query(`UPDATE "Athlete" SET "taxId" = $1 WHERE id = $2`, [nifs[i], a.id]);
  }
  const peloNif = await api(direcao, "POST", "/api/members", { name: "[TESTE-SA] Pelo NIF", phone: "910000003", tierId: adultos.body.id, taxId: nifs[0], status: "PENDING" });
  check("um sócio novo com o NIF de um atleta fica associado a ele", peloNif.status === 201 && peloNif.body.athleteId === outros[0].id, JSON.stringify(peloNif.body).slice(0, 160));
  if (peloNif.body?.id) criado.members.push(peloNif.body.id);

  const imp = await api(direcao, "POST", "/api/members/import", {
    rows: [{ line: 2, name: "[TESTE-SA] Importado", number: 9999001, phone: "910000004", tier: "[TESTE-SA] Adultos", taxId: nifs[1] }],
  });
  const importado = (await db.query(`SELECT id, "athleteId" FROM "Member" WHERE number = 9999001 AND "academyId" = 'acd_lifeclub'`)).rows[0];
  if (importado) criado.members.push(importado.id);
  check("na importação, o NIF de um atleta associa logo a ficha", imp.status === 201 && imp.body.associados === 1 && importado?.athleteId === outros[1].id, JSON.stringify(imp.body).slice(0, 200));

  const ficha = (await api(direcao, "GET", `/api/members/${memberId}`)).body;
  check("a ficha é do atleta, ativa e com número", ficha?.athlete?.id === filho.id && ficha.status === "ACTIVE" && ficha.number != null, JSON.stringify({ a: ficha?.athlete, s: ficha?.status, n: ficha?.number, e: ficha?.email }));
  check("a ficha diz que é paga pela família", ficha?.paidByFamily === true);
  const naLista = (await api(direcao, "GET", "/api/members")).body.members.find((m) => m.id === memberId);
  check("e a lista também", naLista?.paidByFamily === true && naLista.athlete?.id === filho.id);

  console.log("\n=== A ficha nunca se liga a uma conta ===");
  const contaDoPai = (await db.query(`SELECT email FROM "User" WHERE email = $1`, ["familia@lifeclub.pt"])).rows[0]?.email;
  await api(direcao, "PATCH", `/api/members/${memberId}`, { email: contaDoPai });
  const depois = (await db.query(`SELECT "userId" FROM "Member" WHERE id = $1`, [memberId])).rows[0];
  check("com o email de uma conta do clube, continua sem conta ligada", depois && depois.userId === null, JSON.stringify(depois));
  const contextos = (await api(familia, "GET", "/api/app/contexts")).body;
  check("o encarregado não ganha a área de sócio desta ficha", !(contextos?.contexts ?? []).some((c) => c.type === "MEMBER" && c.memberId === memberId), JSON.stringify(contextos).slice(0, 160));
  await api(direcao, "PATCH", `/api/members/${memberId}`, { email: null });

  console.log("\n=== O encarregado paga ===");
  const quotas = (await api(familia, "GET", "/billing/quotas", undefined, "family")).body;
  const quota = Array.isArray(quotas) ? quotas.find((q) => q.athleteId === filho.id && q.status === "OPEN") : null;
  check("a quota do filho aparece ao encarregado, com a forma das mensalidades", !!quota && quota.kind === "QUOTA" && quota.amountCents === 300, JSON.stringify(quotas).slice(0, 200));
  const doTreinador = (await api(treinador, "GET", "/billing/quotas")).body;
  check("o treinador não vê a quota", !Array.isArray(doTreinador) || !doTreinador.some((q) => q.id === quota?.id), JSON.stringify(doTreinador).slice(0, 120));

  if (quota) {
    const pagar = await api(familia, "POST", `/billing/quotas/${quota.id}/pay`, { method: "MULTIBANCO" }, "family");
    check("o encarregado inicia o pagamento por Multibanco", pagar.status === 201 && pagar.body?.status === "PENDING", JSON.stringify(pagar.body).slice(0, 200));
    const pag = (await db.query(`SELECT "payerName", "payerRelation", "memberFeeId" FROM "Payment" WHERE id = $1`, [pagar.body?.id])).rows[0];
    const pai = (await db.query(`SELECT name FROM "User" WHERE email = $1`, ["familia@lifeclub.pt"])).rows[0]?.name;
    check("o pagamento fica em nome do encarregado", pag?.payerName === pai && pag?.memberFeeId === quota.id, JSON.stringify(pag));
    const deNovo = (await api(familia, "GET", "/billing/quotas", undefined, "family")).body.find((q) => q.id === quota.id);
    check("a quota mostra a referência em curso", !!deNovo?.openPayment?.reference || deNovo?.openPayment?.status === "PENDING", JSON.stringify(deNovo?.openPayment));
    { const r = await api(treinador, "POST", `/billing/quotas/${quota.id}/pay`, { method: "MULTIBANCO" }); check("o treinador não paga a quota (403 ou 404)", r.status === 403 || r.status === 404, `${r.status} ${JSON.stringify(r.body).slice(0, 160)}`); }
  }
} catch (e) {
  failed++;
  console.log(`  FALHA ${e.message}`);
} finally {
  console.log("\n=== Arrumar ===");
  for (const id of criado.members) await api(direcao, "DELETE", `/api/members/${id}`);
  for (const id of criado.tiers) await api(direcao, "DELETE", `/api/members/tiers/${id}`);
  for (const n of criado.nifs) await db.query(`UPDATE "Athlete" SET "taxId" = $1 WHERE id = $2`, [n.antes, n.id]);
  const restos = (await db.query(`SELECT count(*)::int n FROM "Member" WHERE id = ANY($1)`, [criado.members])).rows[0].n
    + (await db.query(`SELECT count(*)::int n FROM "MemberTier" WHERE id = ANY($1)`, [criado.tiers])).rows[0].n;
  check("nada do teste ficou na base", restos === 0, `${restos} linhas`);
  await db.end();
}

console.log(`\n${failed === 0 ? "TUDO OK" : "FALHAS"} — ${passed} ok, ${failed} falhas\n`);
process.exit(failed === 0 ? 0 : 1);

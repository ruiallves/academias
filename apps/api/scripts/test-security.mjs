#!/usr/bin/env node
/**
 * Testes de regressão de segurança.
 *
 * Cada caso aqui corresponde a uma vulnerabilidade encontrada na auditoria — ou a
 * uma fronteira que resistiu e tem de continuar a resistir. Corre contra o servidor
 * a correr, com uma academia atacante real. Uma falha aqui é uma regressão de
 * segurança, e deve travar o CI.
 *
 * Pressupõe `node dist/main.js`, `npm run seed` e `npm run seed:platform`.
 *
 * Uso: node scripts/test-security.mjs
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHmac, createHash, randomBytes } from "node:crypto";
import pg from "pg";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const env = (k) => {
  const l = readFileSync(path.join(HERE, "..", ".env"), "utf8").split("\n").find((x) => x.startsWith(k + "="));
  if (!l) throw new Error(`${k} não está em .env`);
  return l.slice(k.length + 1).trim().replace(/^"|"$/g, "");
};

const S = env("SUPABASE_URL").replace(/\/$/, "");
const A = env("SUPABASE_ANON_KEY");
const SVC = env("SUPABASE_SERVICE_ROLE_KEY");
const API = "http://localhost:3000";

let passed = 0;
let failed = 0;
const check = (l, ok, d = "") => {
  if (ok) { passed++; console.log("  OK    " + l); }
  else { failed++; console.log("  FALHA " + l + (d ? " — " + d : "")); }
};

const login = async (email, password = "academia2026") =>
  (await (await fetch(`${S}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: A, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  })).json()).access_token;

const req = async (token, method, pathname, body, slug = "life-club") => {
  const res = await fetch(API + pathname, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "x-academy-slug": slug,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

async function ensureAuthUser(email, password) {
  const c = await fetch(`${S}/auth/v1/admin/users`, {
    method: "POST",
    headers: { apikey: SVC, Authorization: `Bearer ${SVC}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  if (c.ok) return (await c.json()).id;
  const l = await fetch(`${S}/auth/v1/admin/users?per_page=200`, { headers: { apikey: SVC, Authorization: `Bearer ${SVC}` } });
  return (await l.json()).users.find((u) => u.email === email).id;
}

async function main() {
  const db = new pg.Client({ connectionString: env("MIGRATE_DATABASE_URL"), ssl: { rejectUnauthorized: false } });
  await db.connect();

  const director = await login("direcao@lifeclub.pt");
  const coach = await login("treinador@lifeclub.pt");
  const staff = await login("secretaria@lifeclub.pt");
  const parent = await login("familia@lifeclub.pt");

  /* -------------------------------------------------------------------- */
  console.log("=== 1. Isolamento entre academias (a fronteira que tem de resistir) ===");
  await db.query(`INSERT INTO "Academy" (id,slug,name,"shortName","updatedAt") VALUES ('acd_atk','clube-atk','Clube Atacante','Atk',now()) ON CONFLICT (id) DO NOTHING`);
  const atkAuth = await ensureAuthUser("atk@rival.pt", "atacante2026");
  await db.query(`INSERT INTO "User" (id,"authId",email,name,"updatedAt") VALUES ('usr_atk',$1,'atk@rival.pt','Atk',now()) ON CONFLICT ("authId") DO UPDATE SET email=EXCLUDED.email`, [atkAuth]);
  await db.query(`INSERT INTO "Membership" (id,"academyId","userId",role,"updatedAt") VALUES ('mem_atk','acd_atk','usr_atk','DIRECTOR',now()) ON CONFLICT (id) DO NOTHING`);
  const atk = await login("atk@rival.pt", "atacante2026");

  for (const p of ["/api/bootstrap", "/api/athletes", "/api/teams", "/api/charges", "/api/matches"]) {
    const r = await req(atk, "GET", p, undefined, "life-club");
    const leak = JSON.stringify(r.body ?? "").includes("Martim") || JSON.stringify(r.body ?? "").includes("Sub-11");
    check(`atacante com x-academy-slug=life-club é bloqueado em ${p}`, r.status === 403 && !leak, `${r.status}`);
  }
  const lcCharge = (await db.query(`SELECT id FROM "Charge" WHERE "academyId"='acd_lifeclub' LIMIT 1`)).rows[0].id;
  const idor = await req(atk, "POST", `/billing/charges/${lcCharge}/pay`, { method: "MULTIBANCO" }, "clube-atk");
  check("IDOR: pagar charge de outra academia pelo id conhecido é 404", idor.status === 404, `${idor.status}`);

  /* -------------------------------------------------------------------- */
  console.log("\n=== 2. Platform Admin isolado das academias ===");
  const admin = await login("admin@academias.pt", "plataforma2026");
  check("um DIRECTOR não entra no /api/platform/overview", (await req(director, "GET", "/api/platform/overview")).status === 403);
  check("um DIRECTOR não lista academias da plataforma", (await req(director, "GET", "/api/platform/academies")).status === 403);
  const adminInConsole = await req(admin, "GET", "/api/bootstrap", undefined, "life-club");
  check("um platform admin não entra numa consola de academia", adminInConsole.status === 403, `${adminInConsole.status}`);

  /* -------------------------------------------------------------------- */
  console.log("\n=== 3. RBAC — coach não faz operações de director ===");
  check("coach não convida staff (sem staff:write)", (await req(coach, "POST", "/api/invites", { name: "Alguem Valido", email: `csw-${Date.now()}@e.pt`, role: "COACH" })).status === 403);
  check("coach não vê mensalidades (sem billing:read)", (await req(coach, "GET", "/api/charges")).status === 403);
  // O treinador pode mudar o tecto da SUA equipa (monta a convocatória, sabe quantos
  // precisa) — mas o âmbito impede-o de mexer numa equipa que não é dele.
  check("coach não muda o tecto de uma equipa fora do seu âmbito", (await req(coach, "PATCH", "/api/matches/equipas/t_nao_existe/max-convocados", { max: 30 })).status === 403);

  /* -------------------------------------------------------------------- */
  console.log("\n=== 4. Escalada de privilégios via convite ===");
  const owner = await req(director, "POST", "/api/invites", { name: "Dono", email: `owner-${Date.now()}@e.pt`, role: "OWNER" });
  check("director não convida um OWNER (acima do seu nível)", owner.status === 403, `${owner.status}`);

  /* -------------------------------------------------------------------- */
  console.log("\n=== 5. Mass assignment (VULN-005) ===");
  const ma = await req(director, "POST", "/api/invites", {
    name: "Teste", email: `ma-${Date.now()}@e.pt`, role: "COACH",
    academyId: "acd_atk", isAdmin: true, grants: ["billing:write"],
  });
  check("campos extra (academyId/isAdmin/grants) rejeitados com 400", ma.status === 400, `${ma.status}`);

  /* -------------------------------------------------------------------- */
  console.log("\n=== 6. Dados clínicos (VULN-002) ===");
  await db.query(`INSERT INTO "TeamStaff" (id,"teamId","membershipId",title) VALUES ('ts_sec','t_sub11','mem_sec','Apoio') ON CONFLICT (id) DO NOTHING`);
  const staffAthletes = (await req(staff, "GET", "/api/athletes")).body;
  const staffMatilde = (staffAthletes || []).find((a) => a.name?.startsWith("Matilde"));
  check("STAFF vê a disponibilidade (clinical:status)", staffMatilde?.availability === "out");
  check("STAFF NÃO vê o diagnóstico (clinical:read)", staffMatilde?.restriction?.title === null, JSON.stringify(staffMatilde?.restriction));
  const coachAthletes = (await req(coach, "GET", "/api/athletes")).body;
  const coachMatilde = (coachAthletes || []).find((a) => a.name?.startsWith("Matilde"));
  check("COACH (com clinical:read) continua a ver o diagnóstico", coachMatilde?.restriction?.title === "Entorse do tornozelo direito");
  await db.query(`DELETE FROM "TeamStaff" WHERE id='ts_sec'`);

  /* -------------------------------------------------------------------- */
  console.log("\n=== 7. Família só vê os seus (âmbito por atleta) ===");
  // A app da família precisa dos filhos — o que não pode é ver os colegas deles.
  // A fronteira mudou de "não vê nada" para "vê os seus": ver test-family-scope.
  const parentAthletes = (await req(parent, "GET", "/api/athletes")).body ?? [];
  const allAthletes = (await req(director, "GET", "/api/athletes")).body ?? [];
  check("GUARDIAN vê os próprios filhos", parentAthletes.length > 0, `${parentAthletes.length}`);
  check("GUARDIAN não vê a academia toda", parentAthletes.length < allAthletes.length, `${parentAthletes.length} de ${allAthletes.length}`);
  check("e todos os que vê são mesmo dele", parentAthletes.every((a) => (a.guardians ?? []).some((g) => g.email === "familia@lifeclub.pt")), JSON.stringify(parentAthletes.map((a) => a.name)));
  check("GUARDIAN não chega ao quadro de staff", (await req(parent, "GET", "/api/staff")).status === 403);

  /* -------------------------------------------------------------------- */
  console.log("\n=== 8. Pagamento — o browser não decide (VULN-001) ===");
  const charge = (await db.query(`SELECT id,"amountCents" FROM "Charge" WHERE "academyId"='acd_lifeclub' AND status='OPEN' LIMIT 1`)).rows[0];
  await db.query(`INSERT INTO "Payment" (id,"chargeId","amountCents",method,status,"providerRef","updatedAt") VALUES ('pay_sec','${charge.id}',${charge.amountCents},'MULTIBANCO','PENDING','SECREF',now()) ON CONFLICT (id) DO UPDATE SET status='PENDING',"providerRef"='SECREF'`);
  const body = JSON.stringify({ transacao: "sec1", referencia: "SECREF", estado: "pago", sucesso: true });

  const forged = await fetch(`${API}/webhooks/eupago`, { method: "POST", headers: { "Content-Type": "application/json", "x-eupago-signature": createHmac("sha256", "").update(body, "utf8").digest("hex") }, body });
  check("webhook forjado (segredo vazio) recusado com 401", forged.status === 401, `${forged.status}`);
  check("mensalidade continua OPEN após o forjado", (await db.query(`SELECT status FROM "Charge" WHERE id='${charge.id}'`)).rows[0].status === "OPEN");
  const nosig = await fetch(`${API}/webhooks/eupago`, { method: "POST", headers: { "Content-Type": "application/json" }, body });
  check("webhook sem assinatura recusado", nosig.status === 401);

  const valid = await fetch(`${API}/webhooks/eupago`, { method: "POST", headers: { "Content-Type": "application/json", "x-eupago-signature": createHmac("sha256", env("EUPAGO_WEBHOOK_SECRET")).update(body, "utf8").digest("hex") }, body });
  check("webhook com assinatura correta é aceite e liquida", valid.status === 200 && (await db.query(`SELECT status FROM "Charge" WHERE id='${charge.id}'`)).rows[0].status === "SETTLED");

  await db.query(`DELETE FROM "Payment" WHERE id='pay_sec'`);
  await db.query(`UPDATE "Charge" SET status='OPEN', "settledAt"=NULL WHERE id='${charge.id}'`);
  await db.query(`DELETE FROM "WebhookEvent" WHERE "eventId"='sec1'`);
  await db.query(`DELETE FROM "Notification" WHERE type='PAYMENT_RECEIVED' AND "createdAt" > now() - interval '2 min'`);

  /* -------------------------------------------------------------------- */
  console.log("\n=== 9. XSS na página de convite (VULN-004) ===");
  const xssEmail = "x</script><script>alert(1)</script>@e.pt";
  check("email com </script> rejeitado pela validação", (await req(director, "POST", "/api/invites", { name: "X", email: xssEmail, role: "COACH" })).status === 400);
  // Defesa em profundidade: mesmo injectado direto na base, o template escapa.
  const tok = randomBytes(32).toString("base64url");
  await db.query(
    `INSERT INTO "StaffInvite" (id,"academyId","tokenHash",email,name,role,"expiresAt","updatedAt")
     VALUES ('inv_xss','acd_lifeclub',$1,$2,'X','COACH',now()+interval '7 days',now())`,
    [createHash("sha256").update(tok).digest("hex"), xssEmail],
  );
  const html = await (await fetch(`${API}/l/life-club/convite/${tok}`)).text();
  check("o template não deixa o </script> quebrar o bloco", !html.includes("</script><script>alert(1)</script>"));
  check("o < do email vem escapado como \\u003c", html.includes("x\\u003c/script"));
  await db.query(`DELETE FROM "StaffInvite" WHERE id='inv_xss'`);

  /* -------------------------------------------------------------------- */
  console.log("\n=== 10. Rate limiting no resgate de convite (VULN-003) ===");
  let got429 = false;
  for (let i = 0; i < 8; i++) {
    const r = await fetch(`${API}/api/convites/${"z".repeat(43)}/aceitar`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "tentativa12" }) });
    if (r.status === 429) got429 = true;
  }
  check("após 5 tentativas por minuto, o resgate devolve 429", got429);

  /* -------------------------------------------------------------------- */
  console.log("\n=== 11. Convite: uso único e expiração ===");
  check("um token inventado não resolve (404)", (await fetch(`${API}/l/life-club/convite/${"a".repeat(43)}`)).status === 404);

  /* -------------------------------------------------------------------- */
  console.log("\n=== 12. Sem autenticação, tudo fechado ===");
  check("sem token, /api/bootstrap é 401", (await req(null, "GET", "/api/bootstrap")).status === 401);
  check("sem token, /api/platform/overview é 401", (await req(null, "GET", "/api/platform/overview")).status === 401);

  /* -------------------------------------------------------------------- */
  console.log("\n=== 13. Slug reservado não pode ser registado ===");
  const reserved = await req(admin, "POST", "/api/platform/academies", { name: "Painel Falso", slug: "admin", directorName: "X", directorEmail: `res-${Date.now()}@e.pt` });
  check("slug 'admin' recusado", reserved.status === 400, `${reserved.status}`);

  /* -------------------------------------------------------------------- */
  console.log("\n=== Limpeza ===");
  await db.query(`DELETE FROM "StaffInvite" WHERE email LIKE '%@e.pt' OR email LIKE 'owner-%' OR email LIKE 'ma-%'`);
  await db.query(`DELETE FROM "Membership" WHERE id='mem_atk'`);
  await db.query(`DELETE FROM "User" WHERE id='usr_atk'`);
  await db.query(`DELETE FROM "Academy" WHERE id='acd_atk'`);
  await db.query(`DELETE FROM "Academy" WHERE slug LIKE 'painel-falso%'`);
  await db.end();
  console.log("  feito");

  console.log(`\n${passed} passaram, ${failed} falharam`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("\nErro:", error.message);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * A área de atleta na app do clube.
 *
 * Percorre o caminho inteiro e, sobretudo, as fronteiras:
 *
 *   1. o convite — o token resolve-se sem sessão, o registo cria a conta e a
 *      membership de atleta, e o link morre ao ser usado;
 *   2. o chapéu — `x-app: athlete` estreita tudo ao próprio, sem mensalidades;
 *   3. o que o treinador partilha — plano, avaliação, relatório, nutrição —
 *      chega ao atleta **só** quando foi aberto a ele, e não chega à família
 *      pelo mesmo caminho;
 *   4. os avisos ao público "Atletas" chegam ao atleta e não à família;
 *   5. a fotografia é só do próprio.
 *
 * Não manda emails: o token entra pela base, como se o email tivesse saído.
 * Cria uma conta a sério no Supabase (`atleta.teste@lifeclub.pt`) — nas
 * corridas seguintes entra na que existe. Limpa tudo o resto no fim.
 *
 * Pressupõe o servidor a correr e `npm run seed`.
 *
 * Uso: npm run test:atleta
 */
import { createHash, randomBytes } from "node:crypto";
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
const API = process.env.API ?? "http://localhost:3000";
const EMAIL = "atleta.teste@lifeclub.pt";
const PASSWORD = "academia2026";
const SESSAO = "ses_teste_atleta";

let passed = 0;
let failed = 0;
const check = (l, ok, d = "") => {
  if (ok) { passed++; console.log("  OK    " + l); }
  else { failed++; console.log("  FALHA " + l + (d ? " — " + d : "")); }
};

const login = async (email, password = PASSWORD) =>
  (await (await fetch(`${S}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: A, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  })).json()).access_token;

const req = async (token, method, pathname, body, app = "console") => {
  const res = await fetch(API + pathname, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "x-academy-slug": "life-club",
      "x-app": app,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

async function main() {
  const db = new pg.Client({ connectionString: env("MIGRATE_DATABASE_URL"), ssl: { rejectUnauthorized: false } });
  await db.connect();

  const direcao = await login("direcao@lifeclub.pt");
  const pai = await login("familia@lifeclub.pt");
  const clinico = await login("clinico@lifeclub.pt");
  if (!direcao || !pai || !clinico) throw new Error("login falhou — correr `npm run seed`");

  // O educando do pai 1 é o atleta que vai ganhar conta.
  const meus = (await req(pai, "GET", "/api/athletes", undefined, "family")).body ?? [];
  const alvo = meus[0];
  check("(preparação) há um atleta para ligar", Boolean(alvo), JSON.stringify(meus).slice(0, 120));
  if (!alvo) return;
  const teamId = alvo.teamId;

  const limpar = async () => {
    await db.query(`DELETE FROM "AbsenceNotice" WHERE "sessionId" = $1`, [SESSAO]);
    await db.query(`DELETE FROM "TrainingSession" WHERE id = $1`, [SESSAO]);
    await db.query(`DELETE FROM "NutritionPlan" WHERE "athleteId" = $1 AND title LIKE 'Teste atleta%'`, [alvo.id]);
    await db.query(`DELETE FROM "AthleteReport" WHERE "athleteId" = $1 AND title LIKE 'Teste atleta%'`, [alvo.id]);
    await db.query(`DELETE FROM "Evaluation" WHERE "athleteId" = $1 AND period = 'Teste atleta'`, [alvo.id]);
    await db.query(`DELETE FROM "Announcement" WHERE title LIKE 'Teste atleta%'`);
    const conta = (await db.query(`SELECT "accountMembershipId" AS m FROM "Athlete" WHERE id = $1`, [alvo.id])).rows[0];
    await db.query(
      `UPDATE "Athlete" SET email = NULL, "inviteTokenHash" = NULL, "inviteSentAt" = NULL, "accountMembershipId" = NULL WHERE id = $1`,
      [alvo.id],
    );
    // A conta de teste: a membership vai, o `User` fica (o Supabase também fica).
    const u = (await db.query(`SELECT id FROM "User" WHERE email = $1`, [EMAIL])).rows[0];
    if (u) {
      await db.query(`DELETE FROM "Notification" WHERE "userId" = $1`, [u.id]);
      await db.query(`DELETE FROM "Membership" WHERE "userId" = $1 AND role = 'ATHLETE'`, [u.id]);
    }
    if (conta?.m) await db.query(`DELETE FROM "Membership" WHERE id = $1`, [conta.m]);
  };
  await limpar();

  try {
    /* ------------------------------------------------------------------ */
    console.log("=== 1. O convite ===");
    const token = randomBytes(32).toString("base64url");
    await db.query(
      `UPDATE "Athlete" SET email = $1, "inviteTokenHash" = $2, "inviteSentAt" = now() WHERE id = $3`,
      [EMAIL, createHash("sha256").update(token).digest("hex"), alvo.id],
    );

    const lista = (await req(direcao, "GET", "/api/athletes")).body ?? [];
    const naLista = lista.find((a) => a.id === alvo.id);
    check("a consola vê o email e o estado 'convidado'", naLista?.email === EMAIL && naLista?.app === "invited", JSON.stringify({ email: naLista?.email, app: naLista?.app }));

    const preview = await req(null, "GET", `/api/convite-atleta/${token}`);
    check("o token resolve-se sem sessão", preview.status === 200 && preview.body?.firstName, `${preview.status} ${JSON.stringify(preview.body)?.slice(0, 120)}`);
    check("o email vai meio tapado", typeof preview.body?.emailHint === "string" && preview.body.emailHint.includes("••"), preview.body?.emailHint);
    const lixo = await req(null, "GET", `/api/convite-atleta/${"x".repeat(43)}`);
    check("um token inventado é 404", lixo.status === 404, `${lixo.status}`);

    const curta = await req(null, "POST", `/api/convite-atleta/${token}/registar`, { password: "curta", acceptLegal: true });
    check("palavra-passe curta é recusada", curta.status === 400, `${curta.status}`);

    const reg = await req(null, "POST", `/api/convite-atleta/${token}/registar`, { password: PASSWORD, acceptLegal: true });
    check("o registo cria a conta e devolve a sessão", reg.status < 300 && Boolean(reg.body?.accessToken), `${reg.status} ${JSON.stringify(reg.body)?.slice(0, 160)}`);
    const atleta = reg.body?.accessToken;
    if (!atleta) return;

    const ligado = (await db.query(
      `SELECT a."accountMembershipId" AS m, m.role, m."isActive", a."inviteTokenHash" AS h FROM "Athlete" a LEFT JOIN "Membership" m ON m.id = a."accountMembershipId" WHERE a.id = $1`,
      [alvo.id],
    )).rows[0];
    check("a ficha aponta para uma membership ATHLETE viva", ligado?.role === "ATHLETE" && ligado?.isActive === true, JSON.stringify(ligado));
    check("o token morreu ao ser usado", ligado?.h === null);
    const outraVez = await req(null, "POST", `/api/convite-atleta/${token}/registar`, { password: PASSWORD, acceptLegal: true });
    check("usar o link outra vez é 404", outraVez.status === 404, `${outraVez.status}`);

    /* ------------------------------------------------------------------ */
    console.log("\n=== 2. O chapéu de atleta ===");
    const ctx = await req(atleta, "GET", "/api/app/contexts", undefined, "family");
    const tipos = (ctx.body?.contexts ?? []).map((c) => c.type);
    check("a app vê o contexto ATHLETE", tipos.includes("ATHLETE"), JSON.stringify(tipos));
    check("… e não o de família", !tipos.includes("FAMILY"), JSON.stringify(tipos));

    const boot = await req(atleta, "GET", "/api/bootstrap", undefined, "athlete");
    check("o bootstrap entra com o papel ATHLETE", boot.status === 200 && boot.body?.me?.role === "ATHLETE", `${boot.status} ${boot.body?.me?.role}`);
    const eu = await req(atleta, "GET", "/api/athletes", undefined, "athlete");
    check("`/api/athletes` devolve o próprio e mais ninguém", eu.status === 200 && eu.body?.length === 1 && eu.body[0].id === alvo.id, `${eu.status} ${eu.body?.length}`);
    const cobrancas = await req(atleta, "GET", "/api/charges", undefined, "athlete");
    check("as mensalidades são recusadas ao atleta (403)", cobrancas.status === 403, `${cobrancas.status}`);
    const avisos = await req(atleta, "GET", "/api/announcements", undefined, "athlete");
    check("os avisos abrem ao atleta", avisos.status === 200, `${avisos.status}`);
    const comoFamilia = await req(atleta, "GET", "/api/bootstrap", undefined, "family");
    check("com `x-app: family` a conta de atleta ainda entra (é família de um)", comoFamilia.status === 200, `${comoFamilia.status}`);

    const consola = (await req(direcao, "GET", "/api/athletes")).body?.find((a) => a.id === alvo.id);
    check("a consola vê a conta ligada", consola?.app === "account", consola?.app);

    /* ------------------------------------------------------------------ */
    console.log("\n=== 3. O plano de treino ===");
    const daqui2dias = new Date(Date.now() + 2 * 86_400_000);
    await db.query(
      `INSERT INTO "TrainingSession" (id,"academyId","teamId","startsAt","endsAt",venue,status,objective,"updatedAt")
       VALUES ($1,'acd_lifeclub',$2,$3,$4,'Campo de teste','SCHEDULED','Transição defensiva',now())`,
      [SESSAO, teamId, daqui2dias, new Date(daqui2dias.getTime() + 5_400_000)],
    );
    const antes = await req(atleta, "GET", `/api/training/sessions/${SESSAO}/plano-partilhado`, undefined, "athlete");
    check("sem partilha, o plano não existe para o atleta (404)", antes.status === 404, `${antes.status}`);
    const partilha = await req(direcao, "PATCH", `/api/training/sessions/${SESSAO}/plan/partilha`, { shared: true });
    check("o treinador partilha", partilha.status === 200 && partilha.body?.sharedAt, `${partilha.status} ${JSON.stringify(partilha.body)}`);
    const depois = await req(atleta, "GET", `/api/training/sessions/${SESSAO}/plano-partilhado`, undefined, "athlete");
    check("… e o atleta lê o objectivo", depois.status === 200 && depois.body?.objective === "Transição defensiva", `${depois.status} ${JSON.stringify(depois.body)?.slice(0, 120)}`);
    const familiaLe = await req(pai, "GET", `/api/training/sessions/${SESSAO}/plano-partilhado`, undefined, "family");
    check("a família não lê por aqui (403)", familiaLe.status === 403, `${familiaLe.status}`);
    const treinos = await req(atleta, "GET", `/api/sessions?from=${new Date().toISOString()}&to=${new Date(Date.now() + 5 * 86_400_000).toISOString()}`, undefined, "athlete");
    const t = (treinos.body ?? []).find((s) => s.id === SESSAO);
    check("a lista de treinos traz a bandeira `planShared`", t?.planShared === true, JSON.stringify({ planShared: t?.planShared }));
    const fecha = await req(direcao, "PATCH", `/api/training/sessions/${SESSAO}/plan/partilha`, { shared: false });
    const fechado = await req(atleta, "GET", `/api/training/sessions/${SESSAO}/plano-partilhado`, undefined, "athlete");
    check("voltar a guardar fecha-o (404)", fecha.status === 200 && fechado.status === 404, `${fecha.status} ${fechado.status}`);

    /* ------------------------------------------------------------------ */
    console.log("\n=== 4. Avaliações ===");
    const equipas = (await req(direcao, "GET", "/api/teams")).body ?? [];
    const sportId = equipas.find((e) => e.id === teamId)?.sportId;
    const skills = (boot.body?.sports ?? []).find((s) => s.id === sportId)?.skills ?? [];
    const skill = skills[0];
    check("(preparação) a modalidade tem competências", Boolean(skill), JSON.stringify(skills));
    if (skill) {
      const guardada = await req(direcao, "POST", "/api/evaluations", { athleteId: alvo.id, period: "Teste atleta", scores: { [skill]: 4 }, athleteVisible: false });
      check("avaliação gravada, fechada ao atleta", guardada.status < 300, `${guardada.status} ${JSON.stringify(guardada.body)}`);
      const pub = await req(direcao, "POST", "/api/evaluations/publish", { ids: [guardada.body?.id] });
      check("publicada", pub.body?.published === 1, JSON.stringify(pub.body));
      const veAtleta = (await req(atleta, "GET", "/api/evaluations", undefined, "athlete")).body ?? [];
      check("fechada: o atleta não a vê", !veAtleta.some((e) => e.period === "Teste atleta"), JSON.stringify(veAtleta.map((e) => e.period)));
      const vePai = (await req(pai, "GET", "/api/evaluations", undefined, "family")).body ?? [];
      check("… mas a família sim", vePai.some((e) => e.period === "Teste atleta"));
      await req(direcao, "POST", "/api/evaluations", { athleteId: alvo.id, period: "Teste atleta", scores: { [skill]: 4 }, athleteVisible: true });
      const veAgora = (await req(atleta, "GET", "/api/evaluations", undefined, "athlete")).body ?? [];
      check("aberta: o atleta vê-a", veAgora.some((e) => e.period === "Teste atleta"));
    }

    /* ------------------------------------------------------------------ */
    console.log("\n=== 5. Relatórios ===");
    const rel = await req(direcao, "POST", "/api/reports", { athleteId: alvo.id, title: "Teste atleta — relatório", body: "Um texto com mais de dez caracteres.", visibility: "INTERNAL", athleteVisible: true });
    check("relatório interno, aberto ao atleta", rel.status < 300, `${rel.status} ${JSON.stringify(rel.body)}`);
    await req(direcao, "POST", `/api/reports/${rel.body?.id}/publish`, {});
    const relAtleta = (await req(atleta, "GET", "/api/reports", undefined, "athlete")).body ?? [];
    check("o atleta lê-o, mesmo interno", relAtleta.some((r) => r.id === rel.body?.id));
    const relPai = (await req(pai, "GET", "/api/reports", undefined, "family")).body ?? [];
    check("a família não — é interno", !relPai.some((r) => r.id === rel.body?.id));
    await req(direcao, "PATCH", `/api/reports/${rel.body?.id}`, { athleteVisible: false });
    const relDepois = (await req(atleta, "GET", "/api/reports", undefined, "athlete")).body ?? [];
    check("fechado ao atleta, deixa de o ver", !relDepois.some((r) => r.id === rel.body?.id));

    /* ------------------------------------------------------------------ */
    console.log("\n=== 6. Nutrição ===");
    const plano = await req(clinico, "POST", `/api/athletes/${alvo.id}/nutricao`, { title: "Teste atleta — nutrição", body: "Pequeno-almoço: aveia.", athleteVisible: true, familyVisible: false });
    check("o departamento clínico escreve o plano", plano.status < 300 && plano.body?.status === "DRAFT", `${plano.status} ${JSON.stringify(plano.body)?.slice(0, 120)}`);
    const rascunho = (await req(atleta, "GET", "/api/nutricao", undefined, "athlete")).body ?? [];
    check("em rascunho não sai da consola", !rascunho.some((p) => p.id === plano.body?.id));
    const publicado = await req(clinico, "POST", `/api/nutricao/${plano.body?.id}/publicar`, {});
    check("publicado", publicado.status < 300 && publicado.body?.status === "PUBLISHED", `${publicado.status}`);
    const nutAtleta = (await req(atleta, "GET", "/api/nutricao", undefined, "athlete")).body ?? [];
    check("o atleta lê-o", nutAtleta.some((p) => p.id === plano.body?.id));
    const nutPai = (await req(pai, "GET", "/api/nutricao", undefined, "family")).body ?? [];
    check("a família não — não lhe foi aberto", !nutPai.some((p) => p.id === plano.body?.id));
    await req(clinico, "PATCH", `/api/nutricao/${plano.body?.id}`, { familyVisible: true });
    const nutPaiDepois = (await req(pai, "GET", "/api/nutricao", undefined, "family")).body ?? [];
    check("aberto à família, a família lê-o", nutPaiDepois.some((p) => p.id === plano.body?.id));
    const semPerm = await req(pai, "POST", `/api/athletes/${alvo.id}/nutricao`, { title: "Teste atleta x", body: "nada disto" }, "family");
    check("a família não escreve planos (403)", semPerm.status === 403, `${semPerm.status}`);

    /* ------------------------------------------------------------------ */
    console.log("\n=== 7. Avisos aos atletas ===");
    const aviso = await req(direcao, "POST", "/api/announcements", { title: "Teste atleta — aviso", body: "Só para atletas.", audience: "athletes" });
    check("a direcção publica para os atletas", aviso.status < 300 && aviso.body?.audience === "Atletas", `${aviso.status} ${JSON.stringify(aviso.body)?.slice(0, 120)}`);
    const avAtleta = (await req(atleta, "GET", "/api/announcements", undefined, "athlete")).body ?? [];
    check("o atleta vê-o", avAtleta.some((a) => a.id === aviso.body?.id));
    const avPai = (await req(pai, "GET", "/api/announcements", undefined, "family")).body ?? [];
    check("a família não", !avPai.some((a) => a.id === aviso.body?.id));
    const notifs = (await req(atleta, "GET", "/api/notifications", undefined, "athlete")).body ?? [];
    const tiposN = new Set(notifs.map((n) => n.type));
    check("o atleta recebeu o push do aviso, do plano e da nutrição", tiposN.has("ANNOUNCEMENT_PUBLISHED") && tiposN.has("TRAINING_PLAN_SHARED") && tiposN.has("NUTRITION_PLAN_SHARED"), JSON.stringify([...tiposN]));

    /* ------------------------------------------------------------------ */
    console.log("\n=== 8. A fotografia ===");
    const foto = await req(atleta, "POST", "/api/atleta/foto/upload", { contentType: "image/jpeg" }, "athlete");
    check("o atleta pede uma autorização para a própria fotografia", foto.status < 300 && String(foto.body?.key ?? "").startsWith(`atletas/${alvo.id}/`), `${foto.status} ${foto.body?.key}`);
    const fotoPai = await req(pai, "POST", "/api/atleta/foto/upload", { contentType: "image/jpeg" }, "family");
    check("a família não passa por esta porta (403)", fotoPai.status === 403, `${fotoPai.status}`);

    /* ------------------------------------------------------------------ */
    console.log("\n=== 9. Desligar ===");
    const des = await req(direcao, "DELETE", `/api/athletes/${alvo.id}/conta`);
    check("a direcção desliga a conta", des.status === 200, `${des.status} ${JSON.stringify(des.body)}`);
    const semConta = await req(atleta, "GET", "/api/bootstrap", undefined, "athlete");
    check("… e o chapéu de atleta deixa de entrar (403)", semConta.status === 403, `${semConta.status}`);
  } finally {
    await limpar();
    await db.end();
  }
}

main()
  .then(() => {
    console.log(`\n${passed} passaram, ${failed} falharam`);
    process.exit(failed ? 1 : 0);
  })
  .catch((e) => {
    console.error("ERRO", e);
    process.exit(1);
  });

#!/usr/bin/env node
/**
 * Documentos legais e o gate de aceitação — de ponta a ponta.
 *
 * Cobre os critérios de aceitação do pedido:
 *
 *   1. clube existente sem aceitação: o responsável é bloqueado, aceita, entra;
 *   2. utilizador normal: só vê os documentos pessoais, não vincula o clube;
 *   3. família: gate na app do clube, com os documentos da audiência dela;
 *   4. termos actualizados: nova versão → gate outra vez, histórico intacto;
 *   5. segurança: o gate não se contorna pelo cliente; o servidor valida;
 *   6. isolamento: ninguém vê aceitações de outro clube; a plataforma é só da plataforma.
 *
 * ## NÃO CORRE CONTRA UMA BASE COM DOCUMENTOS A SÉRIO
 *
 * Este teste **publica documentos legais**, e um `LegalDocument` é global: não
 * tem `academyId`, e uma versão publicada entra em vigor para **todos os
 * clubes** ao mesmo tempo. Enquanto o teste corre, quem abrir a consola ou a
 * app leva o gate com documentos chamados "Teste TERMS_OF_SERVICE" e versões
 * `0.0.512`. Aconteceu a sério, a um clube a usar o produto.
 *
 * Por isso o teste **recusa-se a arrancar** quando encontra na base uma versão
 * publicada que não seja dele (ou seja: depois de o `seed:legal` ter corrido).
 * Para o correr é preciso uma base sem documentos a sério — apontar
 * `DATABASE_URL` e `MIGRATE_DATABASE_URL` a uma base de rascunho — ou dizer
 * explicitamente `LEGAL_TEST_FORCE=1`, sabendo o que isso faz a quem estiver
 * dentro do produto nesse minuto.
 *
 * O que o teste cria (versões `0.0.<n>`) é apagado no fim, aceitações
 * incluídas. Isso limita o estrago; não o evita.
 *
 * Pressupõe o servidor a correr, `npm run seed` e `npm run seed:platform`.
 *
 * Uso: npm run test:legal
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
const SVC = env("SUPABASE_SERVICE_ROLE_KEY");
const API = "http://localhost:3000";
// Três dígitos: a versão aceita `0.0.<até 3 dígitos>`.
const RUN = String(Date.now() % 900 + 100);

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

/** Uma conta no Supabase para o clube atacante — a mesma de `test-security.mjs`. */
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

const req = async (token, method, pathname, body, { slug = "life-club", app } = {}) => {
  const res = await fetch(API + pathname, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "x-academy-slug": slug,
      ...(app ? { "x-app": app } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

async function main() {
  const db = new pg.Client({ connectionString: env("MIGRATE_DATABASE_URL"), ssl: { rejectUnauthorized: false } });
  await db.connect();

  /*
   * A porta: uma base com documentos a sério é uma base de gente a trabalhar.
   * Ver o cabeçalho — isto publica documentos que toda a gente vê.
   */
  const reais = await db.query(
    `SELECT count(*)::int AS n FROM "LegalDocument" WHERE status = 'PUBLISHED' AND version NOT LIKE '0.0.%'`,
  );
  if (reais.rows[0].n > 0 && process.env.LEGAL_TEST_FORCE !== "1") {
    console.log(`\n  SALTA tudo — esta base tem ${reais.rows[0].n} documentos legais publicados a sério.`);
    console.log("  Este teste publica documentos que entram em vigor para TODOS os clubes enquanto corre.");
    console.log("  Corre-o contra uma base de rascunho, ou com LEGAL_TEST_FORCE=1 se souberes o que fazes.\n");
    await db.end();
    process.exit(0);
  }

  const director = await login("direcao@lifeclub.pt");
  const coach = await login("treinador@lifeclub.pt");
  const parent = await login("familia@lifeclub.pt");
  const admin = await login("admin@academias.pt", "plataforma2026");
  if (!director || !coach || !parent || !admin) throw new Error("login falhou — correr `npm run seed` e `npm run seed:platform`");

  /*
   * A conta de plataforma semeada pode já não ser administradora — o painel
   * apaga a de origem depois de criar a própria (ver `test-platform-api.mjs`).
   * Aqui não se salta: a linha entra só durante o teste e sai no fim, com o
   * que ela publicou. O `sub` do JWT é o `authId`.
   */
  const adminAuthId = JSON.parse(Buffer.from(admin.split(".")[1], "base64url").toString("utf8")).sub;
  const adminTemp = (await db.query(`SELECT 1 FROM "PlatformAdmin" WHERE "authId"=$1`, [adminAuthId])).rows.length === 0;
  if (adminTemp) {
    await db.query(
      `INSERT INTO "PlatformAdmin" (id,"authId",email,name,role,"isActive","createdAt","updatedAt") VALUES ('pad_legal_test',$1,'legal-test@academias.pt','Teste legal','OWNER',true,now(),now())`,
      [adminAuthId],
    );
  }

  const criados = [];
  const limpar = async () => {
    // Retirar pela API primeiro: invalida a cache de "em vigor" do servidor.
    // Apagar só na base deixava as versões de teste em cache um minuto.
    for (const id of criados) {
      await req(admin, "POST", `/api/platform/legal/documents/${id}/retire`, {}).catch(() => {});
    }
    if (criados.length) {
      await db.query(`DELETE FROM "LegalAcceptance" WHERE "documentId" = ANY($1)`, [criados]);
      await db.query(`DELETE FROM "AuditLog" WHERE "targetType"='LegalDocument' AND "targetId" = ANY($1)`, [criados]);
      await db.query(`DELETE FROM "LegalDocument" WHERE id = ANY($1)`, [criados]);
    }
    if (adminTemp) await db.query(`DELETE FROM "PlatformAdmin" WHERE id='pad_legal_test'`);
  };
  // Restos de uma corrida anterior interrompida.
  const restos = await db.query(`SELECT id FROM "LegalDocument" WHERE version LIKE '0.0.%'`);
  if (restos.rows.length) {
    await db.query(`DELETE FROM "LegalAcceptance" WHERE "documentId" = ANY($1)`, [restos.rows.map((r) => r.id)]);
    await db.query(`DELETE FROM "LegalDocument" WHERE version LIKE '0.0.%'`);
  }

  try {
    /* ------------------------------------------------------------------ */
    console.log("=== 0. O ponto de partida ===");
    /*
     * Pode já haver documentos a sério publicados (o `seed:legal`). As versões
     * de teste, publicadas agora, passam-lhes à frente (effectiveAt mais
     * recente) e voltam a sair no fim — o que se prova é o mecanismo, com
     * versões que ninguém a sério aceitou.
     */
    const statusVazio = await req(director, "GET", "/api/legal/status");
    check("o status responde", statusVazio.status === 200, JSON.stringify(statusVazio.body));
    check("o responsável do clube tem `legal:club` (canBindClub)", statusVazio.body.canBindClub === true);

    /* ------------------------------------------------------------------ */
    console.log("\n=== 1. A plataforma publica uma versão de cada documento ===");
    const naoAdmin = await req(director, "GET", "/api/platform/legal/documents");
    check("um DIRECTOR não entra na gestão de documentos da plataforma", naoAdmin.status === 403, `${naoAdmin.status}`);

    const publicar = async (type, extra = {}) => {
      const c = await req(admin, "POST", "/api/platform/legal/documents", {
        type,
        version: `0.0.${RUN}`,
        title: `Teste ${type}`,
        summary: "Documento de teste — apagado no fim.",
        content: `# Teste\n\nTexto de teste de ${type}.\n\n- um\n- dois\n`,
        ...extra,
      });
      if (c.status !== 201 && c.status !== 200) throw new Error(`criar ${type}: ${c.status} ${JSON.stringify(c.body)}`);
      criados.push(c.body.id);
      const p = await req(admin, "POST", `/api/platform/legal/documents/${c.body.id}/publish`, {});
      if (p.status !== 201 && p.status !== 200) throw new Error(`publicar ${type}: ${p.status} ${JSON.stringify(p.body)}`);
      return p.body;
    };

    const rascunho = await req(admin, "POST", "/api/platform/legal/documents", {
      type: "TERMS_OF_SERVICE", version: `0.0.${RUN}`, title: "x", content: "y",
    });
    criados.push(rascunho.body.id);
    check("criar rascunho responde 201", rascunho.status === 201, `${rascunho.status}`);
    const aindaNada = await req(director, "GET", "/api/legal/status");
    check("um rascunho não conta como pendente", !aindaNada.body.pending.some((p) => p.id === rascunho.body.id));
    const publico = await req(null, "GET", `/api/legal/documents/termos-de-servico`);
    check("um rascunho não aparece no site", publico.status === 404 || publico.body?.id !== rascunho.body.id, `${publico.status}`);

    const edit = await req(admin, "PATCH", `/api/platform/legal/documents/${rascunho.body.id}`, {
      title: "Teste TERMS_OF_SERVICE", content: "# Termos de teste\n\nVersão de teste.\n",
    });
    check("editar rascunho responde 200", edit.status === 200, `${edit.status}`);
    const pub = await req(admin, "POST", `/api/platform/legal/documents/${rascunho.body.id}/publish`, {});
    check("publicar responde 200/201", pub.status === 200 || pub.status === 201, `${pub.status} ${JSON.stringify(pub.body)}`);
    const editPub = await req(admin, "PATCH", `/api/platform/legal/documents/${rascunho.body.id}`, { title: "outro" });
    check("uma versão publicada não se edita (409)", editPub.status === 409, `${editPub.status}`);

    await publicar("DPA");
    await publicar("TERMS_OF_USE");
    await publicar("PRIVACY_POLICY");
    await publicar("ACCEPTABLE_USE");
    await publicar("COOKIE_POLICY");

    const site = await req(null, "GET", "/api/legal/documents/termos-de-servico");
    check("o site lê a versão em vigor, com texto e versão", site.status === 200 && site.body.version === `0.0.${RUN}` && typeof site.body.content === "string", JSON.stringify(site.body).slice(0, 120));
    const idx = await req(null, "GET", "/api/legal/documents");
    check("o índice público traz 6 documentos em vigor, sem texto", idx.status === 200 && idx.body.length === 6 && !("content" in idx.body[0]), `${idx.body?.length}`);

    /* ------------------------------------------------------------------ */
    console.log("\n=== 2. Clube existente sem aceitação: o responsável é bloqueado ===");
    const bloqueado = await req(director, "GET", "/api/bootstrap");
    check("bootstrap recusado com LEGAL_ACCEPTANCE_REQUIRED", bloqueado.status === 403 && bloqueado.body?.code === "LEGAL_ACCEPTANCE_REQUIRED", `${bloqueado.status} ${JSON.stringify(bloqueado.body)}`);
    const atletas = await req(director, "GET", "/api/athletes");
    check("qualquer rota de domínio é recusada", atletas.status === 403 && atletas.body?.code === "LEGAL_ACCEPTANCE_REQUIRED", `${atletas.status}`);
    const presenca = await req(director, "POST", "/api/presence");
    check("o sinal de presença continua a passar (exempt)", presenca.status === 204, `${presenca.status}`);

    const st = await req(director, "GET", "/api/legal/status");
    const tipos = st.body.pending.map((p) => p.type).sort();
    check("o responsável vê ToS + DPA (pelo clube) + Privacidade + Utilização aceitável",
      JSON.stringify(tipos) === JSON.stringify(["ACCEPTABLE_USE", "DPA", "PRIVACY_POLICY", "TERMS_OF_SERVICE"]), JSON.stringify(tipos));
    check("cookies (NONE) nunca aparece no gate", !tipos.includes("COOKIE_POLICY"));
    check("cada pendente diz se já havia versão anterior aceite", st.body.pending.every((p) => "previousVersion" in p));

    const ids = st.body.pending.map((p) => p.id);
    /*
     * A confirmação de poderes é uma vez por clube. O life-club pode já estar
     * inaugurado (aceitações a sério, do `seed:legal`), e aí ninguém volta a
     * ser interrogado — o que se prova nos dois casos é a coerência entre o que
     * o servidor anuncia (`needsAuthority`) e o que exige.
     */
    const semAutoridade = await req(director, "POST", "/api/legal/accept", { documentIds: ids });
    if (st.body.needsAuthority) {
      check("clube por inaugurar: aceitar sem confirmar poderes é 400", semAutoridade.status === 400, `${semAutoridade.status}`);
    } else {
      check("clube já inaugurado: não se volta a pedir a confirmação de poderes", semAutoridade.status < 300, `${semAutoridade.status}`);
    }
    const parcial = await req(director, "POST", "/api/legal/accept", { documentIds: [ids[0]], confirmAuthority: true, context: "SIGNUP" });
    check("`context` só aceita SETTINGS (400 na validação)", parcial.status === 400, `${parcial.status}`);

    const aceite = await req(director, "POST", "/api/legal/accept", { documentIds: ids, confirmAuthority: true });
    check("aceitar tudo responde 200/201 e fica sem pendentes", (aceite.status === 200 || aceite.status === 201) && aceite.body.pending.length === 0, `${aceite.status} ${JSON.stringify(aceite.body).slice(0, 200)}`);
    const entra = await req(director, "GET", "/api/bootstrap");
    check("bootstrap volta a responder 200", entra.status === 200, `${entra.status}`);

    const hist = await req(director, "GET", "/api/legal/history");
    const deTeste = hist.body.filter((h) => h.version === `0.0.${RUN}`);
    check("o histórico tem as 4 aceitações desta versão, 2 delas pelo clube", deTeste.length === 4 && deTeste.filter((h) => h.onBehalfOfClub).length === 2, JSON.stringify(deTeste.map((h) => [h.type, h.onBehalfOfClub])));
    const ctx = deTeste.map((h) => h.context);
    check("o contexto é LOGIN_GATE ou TERMS_UPDATE (conta antiga)", ctx.every((c) => c === "LOGIN_GATE" || c === "TERMS_UPDATE"), JSON.stringify(ctx));
    const linha = await db.query(`SELECT ip, "userAgent", "contentHash" FROM "LegalAcceptance" WHERE "documentId" = $1`, [ids[0]]);
    check("a aceitação guarda IP, user-agent e o hash do texto", linha.rows.length === 1 && linha.rows[0].ip && linha.rows[0].userAgent && /^[0-9a-f]{64}$/.test(linha.rows[0].contentHash), JSON.stringify(linha.rows[0]));

    const repete = await req(director, "POST", "/api/legal/accept", { documentIds: ids, confirmAuthority: true });
    const n = await db.query(`SELECT count(*)::int AS n FROM "LegalAcceptance" WHERE "documentId" = ANY($1)`, [ids]);
    check("aceitar duas vezes não duplica a prova (idempotente)", repete.status < 300 && n.rows[0].n === 4, `${n.rows[0].n}`);

    /* ------------------------------------------------------------------ */
    console.log("\n=== 3. Utilizador normal: só o que lhe cabe ===");
    const stCoach = await req(coach, "GET", "/api/legal/status");
    const tiposCoach = stCoach.body.pending.map((p) => p.type).sort();
    check("o treinador vê Termos de Utilização + Privacidade + Utilização aceitável — nunca ToS/DPA",
      JSON.stringify(tiposCoach) === JSON.stringify(["ACCEPTABLE_USE", "PRIVACY_POLICY", "TERMS_OF_USE"]), JSON.stringify(tiposCoach));
    check("o treinador não pode vincular o clube", stCoach.body.canBindClub === false);
    const dpaId = criados.find((id) => id) && (await db.query(`SELECT id FROM "LegalDocument" WHERE type='DPA' AND version=$1`, [`0.0.${RUN}`])).rows[0].id;
    const coachDpa = await req(coach, "POST", "/api/legal/accept", { documentIds: [dpaId], confirmAuthority: true });
    check("o treinador não consegue aceitar o DPA em nome do clube (403)", coachDpa.status === 403, `${coachDpa.status}`);
    const coachBloq = await req(coach, "GET", "/api/athletes");
    check("o treinador está bloqueado até aceitar os dele", coachBloq.status === 403 && coachBloq.body?.code === "LEGAL_ACCEPTANCE_REQUIRED", `${coachBloq.status}`);
    const coachOk = await req(coach, "POST", "/api/legal/accept", { documentIds: stCoach.body.pending.map((p) => p.id) });
    check("o treinador aceita os dele e entra", coachOk.status < 300 && (await req(coach, "GET", "/api/athletes")).status === 200);
    const histCoach = await req(coach, "GET", "/api/legal/history");
    check("o histórico do treinador não traz as aceitações do clube", histCoach.body.every((h) => h.mine && !h.onBehalfOfClub), JSON.stringify(histCoach.body.map((h) => [h.type, h.mine])));

    /* ------------------------------------------------------------------ */
    console.log("\n=== 3b. Criar conta: os termos aceitam-se ao escolher a password ===");
    const cargos = (await req(director, "GET", "/api/roles")).body ?? [];
    const cargoTreinador = cargos.find((r) => r.baseRole === "COACH") ?? cargos.find((r) => !r.isSystem);
    const cargoPresidente = cargos.find((r) => r.key === "presidente");
    const equipas = (await req(director, "GET", "/api/teams")).body ?? [];
    const emailNovo = `legal-staff-${RUN}-${Date.now()}@exemplo.pt`;
    const convite = await req(director, "POST", "/api/invites", {
      name: "Staff Legal", email: emailNovo, academyRoleId: cargoTreinador?.id, teamIds: equipas[0] ? [equipas[0].id] : [],
    });
    const tokenStaff = convite.body?.link?.split("/convite/")[1] ?? "";
    check("(preparação) o convite de staff existe", convite.status < 300 && tokenStaff.length > 20, JSON.stringify(convite.body).slice(0, 120));
    const pagina = await fetch(`${API}/l/life-club/convite/${tokenStaff}`).then((r) => r.text());
    check("a página do convite mostra os termos a aceitar, com link para o site", pagina.includes('data-legal="1"') && pagina.includes("/legal/termos-de-utilizacao"));
    check("um treinador não vê a confirmação de autoridade", !pagina.includes('id="legal-authority"'));
    const semAceitar = await req(null, "POST", `/api/convites/${tokenStaff}/aceitar`, { password: "academia2026", phone: "912345678" });
    check("resgatar sem aceitar os termos é 400 — e a conta não é criada", semAceitar.status === 400, `${semAceitar.status}`);
    const aceitou = await req(null, "POST", `/api/convites/${tokenStaff}/aceitar`, { password: "academia2026", phone: "912345678", acceptLegal: true });
    check("resgatar a aceitar cria a conta", aceitou.status < 300, `${aceitou.status} ${JSON.stringify(aceitou.body)}`);
    const novoStaff = await login(emailNovo, "academia2026");
    const stNovo = await req(novoStaff, "GET", "/api/legal/status");
    check("quem aceitou ao criar conta não vê o gate", stNovo.status === 200 && stNovo.body.pending.length === 0, JSON.stringify(stNovo.body.pending?.map((p) => p.type)));
    const histNovo = await req(novoStaff, "GET", "/api/legal/history");
    check("e as aceitações ficam com contexto SIGNUP", histNovo.body.length >= 3 && histNovo.body.every((h) => h.context === "SIGNUP"), JSON.stringify(histNovo.body.map((h) => [h.type, h.context])));
    check("o novo staff entra na consola", (await req(novoStaff, "GET", "/api/bootstrap")).status === 200);

    /*
     * O life-club pode já estar inaugurado — e aí a página do convite **não**
     * pede poderes a ninguém, nem sequer a um presidente novo. É a regra: uma
     * vez por clube. Testam-se os dois lados conforme o estado real da base.
     */
    const inaugurado = (await db.query(
      `SELECT count(*)::int AS n FROM "LegalAcceptance" WHERE "academyId" = 'acd_lifeclub' AND "onBehalfOfClub" = true`,
    )).rows[0].n > 0;
    const emailPres = `legal-pres-${RUN}-${Date.now()}@exemplo.pt`;
    // Só a presidência convida para a presidência (patente) — é o presidente que convida.
    const presidente = await login("presidente@lifeclub.pt");
    // O presidente também está atrás do gate das versões de teste — aceita-as primeiro.
    const stPres = await req(presidente, "GET", "/api/legal/status");
    if (stPres.body?.pending?.length) {
      await req(presidente, "POST", "/api/legal/accept", { documentIds: stPres.body.pending.map((p) => p.id), confirmAuthority: true });
    }
    const convitePres = await req(presidente, "POST", "/api/invites", { name: "Presidente Legal", email: emailPres, academyRoleId: cargoPresidente?.id, teamIds: [] });
    const tokenPres = convitePres.body?.link?.split("/convite/")[1] ?? "";
    if (tokenPres) {
      const paginaPres = await fetch(`${API}/l/life-club/convite/${tokenPres}`).then((r) => r.text());
      check("um cargo com legal:club vê os Termos de Serviço na página do convite", paginaPres.includes("/legal/termos-de-servico"));
      check(
        inaugurado
          ? "clube já inaugurado: a página não repete a confirmação de poderes"
          : "clube por inaugurar: a página pede a confirmação de poderes",
        paginaPres.includes('id="legal-authority"') === !inaugurado,
      );
      if (!inaugurado) {
        const semAutoridadePres = await req(null, "POST", `/api/convites/${tokenPres}/aceitar`, { password: "academia2026", acceptLegal: true });
        check("sem confirmar a autoridade é 400", semAutoridadePres.status === 400, `${semAutoridadePres.status}`);
      }
      const presOk = await req(null, "POST", `/api/convites/${tokenPres}/aceitar`, { password: "academia2026", acceptLegal: true, confirmAuthority: true });
      check("o convite do presidente é resgatado", presOk.status < 300, `${presOk.status} ${JSON.stringify(presOk.body)}`);
      await db.query(`DELETE FROM "Membership" WHERE "userId" IN (SELECT id FROM "User" WHERE email = $1)`, [emailPres]);
    } else {
      check("(preparação) convite de presidente", false, JSON.stringify(convitePres.body).slice(0, 120));
    }
    // A conta de staff de teste sai do clube; a conta no Supabase fica (inofensiva).
    await db.query(`DELETE FROM "Membership" WHERE "userId" IN (SELECT id FROM "User" WHERE email = $1)`, [emailNovo]);

    const publicos = await req(null, "GET", "/api/legal/required?audience=FAMILY");
    check("`/api/legal/required` diz o que uma família tem de aceitar, com link", publicos.status === 200 && publicos.body.length === 3 && publicos.body.every((d) => typeof d.url === "string"), JSON.stringify(publicos.body?.map((d) => d.type)));
    check("audiência desconhecida é 400", (await req(null, "GET", "/api/legal/required?audience=X")).status === 400);

    /* ------------------------------------------------------------------ */
    console.log("\n=== 4. Família: o gate na app do clube ===");
    const stPai = await req(parent, "GET", "/api/legal/status", undefined, { app: "family" });
    const tiposPai = stPai.body.pending.map((p) => p.type).sort();
    check("o encarregado vê os documentos da audiência FAMILY", JSON.stringify(tiposPai) === JSON.stringify(["ACCEPTABLE_USE", "PRIVACY_POLICY", "TERMS_OF_USE"]), JSON.stringify(tiposPai));
    const paiBloq = await req(parent, "GET", "/api/athletes", undefined, { app: "family" });
    check("a app da família é recusada até aceitar", paiBloq.status === 403 && paiBloq.body?.code === "LEGAL_ACCEPTANCE_REQUIRED", `${paiBloq.status}`);
    const ctxs = await req(parent, "GET", "/api/app/contexts", undefined, { app: "family" });
    check("`/api/app/contexts` continua a responder (é a pergunta que decide o gate)", ctxs.status === 200, `${ctxs.status}`);
    const paiOk = await req(parent, "POST", "/api/legal/accept", { documentIds: stPai.body.pending.map((p) => p.id) }, { app: "family" });
    check("o encarregado aceita e entra", paiOk.status < 300 && (await req(parent, "GET", "/api/athletes", undefined, { app: "family" })).status === 200);

    /* ------------------------------------------------------------------ */
    console.log("\n=== 5. Termos actualizados: nova versão, gate outra vez, histórico intacto ===");
    const v2 = await req(admin, "POST", "/api/platform/legal/documents", {
      type: "TERMS_OF_SERVICE", version: `0.0.${RUN}b`, title: "Teste ToS v2", content: "# v2\n\nMudou.\n", changeNote: "Secção 7 reescrita.",
    });
    check("versão inválida é recusada (400)", v2.status === 400, `${v2.status}`);
    const v2ok = await req(admin, "POST", "/api/platform/legal/documents", {
      type: "TERMS_OF_SERVICE", version: `0.0.${(Number(RUN) + 1) % 1000}`, title: "Teste ToS v2", content: "# v2\n\nMudou.\n", changeNote: "Secção 7 reescrita.",
    });
    criados.push(v2ok.body.id);
    const antesDePublicar = await req(director, "GET", "/api/bootstrap");
    check("antes de publicar a v2, o responsável continua a entrar", antesDePublicar.status === 200);
    await req(admin, "POST", `/api/platform/legal/documents/${v2ok.body.id}/publish`, {});

    const stV2 = await req(director, "GET", "/api/legal/status");
    check("depois de publicar, só os Termos de Serviço voltam a estar pendentes", stV2.body.pending.length === 1 && stV2.body.pending[0].type === "TERMS_OF_SERVICE", JSON.stringify(stV2.body.pending.map((p) => p.type)));
    check("o gate sabe que é actualização e qual era a versão anterior", stV2.body.isUpdate === true && stV2.body.pending[0].previousVersion === `0.0.${RUN}`, JSON.stringify(stV2.body.pending[0]));
    check("o gate leva a nota do que mudou", stV2.body.pending[0].changeNote === "Secção 7 reescrita.");
    const bloqV2 = await req(director, "GET", "/api/bootstrap");
    check("o responsável volta a ser bloqueado", bloqV2.status === 403, `${bloqV2.status}`);
    const coachV2 = await req(coach, "GET", "/api/athletes");
    check("o treinador não é afectado por uma versão nova de um documento de clube", coachV2.status === 200, `${coachV2.status}`);

    const v1 = await req(null, "GET", `/api/legal/documents/termos-de-servico/0.0.${RUN}`);
    check("a versão anterior continua a abrir pelo endereço dela", v1.status === 200 && v1.body.version === `0.0.${RUN}`, `${v1.status}`);
    const versions = await req(null, "GET", "/api/legal/documents/termos-de-servico/versions");
    const deTesteV = versions.body?.filter((v) => v.version.startsWith("0.0.")) ?? [];
    check("o histórico público lista as duas versões de teste", versions.status === 200 && deTesteV.length === 2, `${versions.body?.length}`);

    const aceitaV2 = await req(director, "POST", "/api/legal/accept", { documentIds: [v2ok.body.id], confirmAuthority: true });
    check("aceita a v2 e entra", aceitaV2.status < 300 && (await req(director, "GET", "/api/bootstrap")).status === 200);
    const histV2 = await req(director, "GET", "/api/legal/history");
    const tos = histV2.body.filter((h) => h.type === "TERMS_OF_SERVICE" && h.version.startsWith("0.0.")).map((h) => [h.version, h.context]);
    check("o histórico guarda a v1 e a v2 de teste, e a v2 é TERMS_UPDATE", tos.length === 2 && tos.find((t) => t[0] === v2ok.body.version)?.[1] === "TERMS_UPDATE", JSON.stringify(tos));

    const retira = await req(admin, "POST", `/api/platform/legal/documents/${v2ok.body.id}/retire`, {});
    check("retirar a v2 responde 200/201", retira.status < 300, `${retira.status}`);
    const stRet = await req(director, "GET", "/api/legal/status");
    check("retirada a v2, a v1 volta a valer e já estava aceite — sem pendentes", stRet.body.pending.length === 0, JSON.stringify(stRet.body.pending));
    const apagaPub = await req(admin, "DELETE", `/api/platform/legal/documents/${v2ok.body.id}`);
    check("uma versão retirada não se apaga (409)", apagaPub.status === 409, `${apagaPub.status}`);

    /* ------------------------------------------------------------------ */
    console.log("\n=== 6. Plataforma: estatísticas e registo ===");
    const stats = await req(admin, "GET", "/api/platform/legal/stats");
    const tosStat = stats.body.documents.find((d) => d.type === "TERMS_OF_SERVICE");
    check("as estatísticas contam o life-club como aceite e listam quem falta", stats.status === 200 && tosStat.acceptedAcademies.some((a) => a.slug === "life-club") && tosStat.pendingAcademies.length === stats.body.academies - tosStat.accepted, JSON.stringify(tosStat && { accepted: tosStat.accepted, total: tosStat.total }));
    const acc = await req(admin, "GET", "/api/platform/legal/acceptances?limit=10");
    check("o registo da plataforma traz IP e clube", acc.status === 200 && acc.body.length > 0 && acc.body[0].academy?.slug === "life-club", `${acc.status}`);
    const audit = await db.query(`SELECT count(*)::int AS n FROM "AuditLog" WHERE action IN ('legal.publish','legal.retire') AND "createdAt" > now() - interval '5 minutes'`);
    check("publicar e retirar ficam no AuditLog", audit.rows[0].n >= 2, `${audit.rows[0].n}`);

    /* ------------------------------------------------------------------ */
    console.log("\n=== 7. Isolamento entre clubes ===");
    await db.query(`INSERT INTO "Academy" (id,slug,name,"shortName","updatedAt") VALUES ('acd_lgl','clube-lgl','Clube Legal','Lgl',now()) ON CONFLICT (id) DO NOTHING`);
    const atkAuth = await ensureAuthUser("atk@rival.pt", "atacante2026");
    await db.query(`INSERT INTO "User" (id,"authId",email,name,"updatedAt") VALUES ('usr_atk',$1,'atk@rival.pt','Atk',now()) ON CONFLICT ("authId") DO UPDATE SET email=EXCLUDED.email`, [atkAuth]);
    const atkRows = await db.query(`SELECT id FROM "User" WHERE "authId"=$1`, [atkAuth]);
    let isolado = "sem utilizador atacante";
    if (atkRows.rows.length) {
      await db.query(`INSERT INTO "Membership" (id,"academyId","userId",role,"updatedAt") VALUES ('mem_lgl','acd_lgl',$1,'DIRECTOR',now()) ON CONFLICT (id) DO NOTHING`, [atkRows.rows[0].id]);
      const atk = await login("atk@rival.pt", "atacante2026");
      const stAtk = await req(atk, "GET", "/api/legal/status", undefined, { slug: "clube-lgl" });
      check("outro clube vê os documentos de clube por aceitar — a aceitação do life-club não conta para ele", stAtk.body.pending.some((p) => p.type === "TERMS_OF_SERVICE"), JSON.stringify(stAtk.body.pending.map((p) => p.type)));

      /* ---- A confirmação de poderes: uma vez por clube, a quem o inaugura ---- */
      check("um clube por inaugurar pede a confirmação de poderes", stAtk.body.needsAuthority === true, JSON.stringify(stAtk.body.needsAuthority));
      const semPoderes = await req(atk, "POST", "/api/legal/accept", { documentIds: stAtk.body.pending.map((p) => p.id) }, { slug: "clube-lgl" });
      check("e sem a confirmação recusa (400)", semPoderes.status === 400, `${semPoderes.status}`);
      const comPoderes = await req(atk, "POST", "/api/legal/accept", { documentIds: stAtk.body.pending.map((p) => p.id), confirmAuthority: true }, { slug: "clube-lgl" });
      check("com a confirmação, o clube fica inaugurado", comPoderes.status < 300 && comPoderes.body.pending.length === 0, `${comPoderes.status}`);
      check("e a partir daí já não se pede", comPoderes.body.needsAuthority === false, JSON.stringify(comPoderes.body.needsAuthority));

      // Uma versão nova de um documento de clube: aceita-se, sem repetir a pergunta.
      const v3 = await req(admin, "POST", "/api/platform/legal/documents", {
        type: "TERMS_OF_SERVICE", version: `0.0.${(Number(RUN) + 2) % 1000}`, title: "Teste ToS v3", content: "# v3\n\nOutra vez.\n",
      });
      criados.push(v3.body.id);
      await req(admin, "POST", `/api/platform/legal/documents/${v3.body.id}/publish`, {});
      const stV3 = await req(atk, "GET", "/api/legal/status", undefined, { slug: "clube-lgl" });
      check("numa versão nova o clube volta ao gate", stV3.body.pending.some((p) => p.type === "TERMS_OF_SERVICE"), JSON.stringify(stV3.body.pending.map((p) => p.type)));
      check("mas já sem a pergunta dos poderes", stV3.body.needsAuthority === false, JSON.stringify(stV3.body.needsAuthority));
      const semPerguntar = await req(atk, "POST", "/api/legal/accept", { documentIds: stV3.body.pending.map((p) => p.id) }, { slug: "clube-lgl" });
      check("e aceita-se sem a confirmar outra vez", semPerguntar.status < 300, `${semPerguntar.status} ${JSON.stringify(semPerguntar.body).slice(0, 120)}`);
      const hAtk = await req(atk, "GET", "/api/legal/history", undefined, { slug: "clube-lgl" });
      check(
        "o histórico de outro clube só traz as aceitações desse clube",
        hAtk.status === 200 && hAtk.body.every((h) => h.mine && h.by === "Atk"),
        JSON.stringify(hAtk.body.map((h) => [h.type, h.by])),
      );
      const cross = await req(atk, "GET", "/api/legal/history", undefined, { slug: "life-club" });
      check("com o slug do life-club, o atacante leva 403", cross.status === 403, `${cross.status}`);
      isolado = null;
      await db.query(`DELETE FROM "LegalAcceptance" WHERE "academyId"='acd_lgl'`);
      await db.query(`DELETE FROM "Membership" WHERE id='mem_lgl'`);
    } else {
      check("isolamento entre clubes", false, isolado);
    }
    await db.query(`DELETE FROM "Academy" WHERE id='acd_lgl'`);

    const rls = await db.query(`SELECT count(*)::int AS n FROM pg_policies WHERE tablename IN ('LegalDocument','LegalAcceptance')`);
    check("as duas tabelas têm política de RLS", rls.rows[0].n === 2, `${rls.rows[0].n}`);
    const grants = await db.query(`SELECT privilege_type FROM information_schema.role_table_grants WHERE grantee='academia_app' AND table_name='LegalAcceptance'`);
    const privs = grants.rows.map((r) => r.privilege_type).sort();
    check("academia_app só lê e insere aceitações (append-only)", JSON.stringify(privs) === JSON.stringify(["INSERT", "SELECT"]), JSON.stringify(privs));
    const grantsDoc = await db.query(`SELECT privilege_type FROM information_schema.role_table_grants WHERE grantee='academia_app' AND table_name='LegalDocument'`);
    check("academia_app só lê documentos", JSON.stringify(grantsDoc.rows.map((r) => r.privilege_type)) === JSON.stringify(["SELECT"]), JSON.stringify(grantsDoc.rows));
  } finally {
    await limpar();
    await db.end();
  }

  console.log(`\n${passed} OK, ${failed} FALHA`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

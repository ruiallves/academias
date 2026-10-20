#!/usr/bin/env node
/**
 * O canal de denúncia, de ponta a ponta, no Life Club.
 *
 *   PORT=3011 EUPAGO_API_KEY= node dist/main.js &   (uma API própria)
 *   npm run test:denuncias
 *
 * O que se defende (ver `src/conduct/`):
 *   - a família envia uma denúncia e vê só as suas; o treinador não vê a lista (403);
 *   - a direção vê a lista, abre o caso e responde; a família recebe a resposta;
 *   - numa denúncia anónima a direção não vê nome, email nem telefone, nem nas mensagens;
 *   - as notas internas nunca chegam à família;
 *   - fechar o caso avisa a família e fecha a conversa do lado dela;
 *   - os documentos de conduta leem-se pela família e só a direção os cria.
 *
 * Inicia nada de pagamentos, mas segue a regra da casa: nunca contra a 3000 nem a 3001.
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
if (/:(3000|3001)\b/.test(API)) throw new Error("Nunca contra a 3000 nem a 3001: são as APIs do Rui.");
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

const db = new pg.Client({ connectionString: env("MIGRATE_DATABASE_URL"), ssl: { rejectUnauthorized: false } });
await db.connect();

const direcao = await signIn("direcao@lifeclub.pt");
const familia = await signIn("familia@lifeclub.pt");
const treinador = await signIn("treinador@lifeclub.pt");

const criado = { casos: [], docs: [] };
const TEXTO = "[TESTE-DEN] O meu filho contou-me que no balneário dois colegas lhe tiraram a roupa e gozaram com ele. Já é a segunda vez.";

try {
  console.log("\n=== Enviar ===");
  const opcoes = await api(familia, "GET", "/api/denuncias/opcoes", undefined, "family");
  check("a app recebe as categorias", opcoes.status === 200 && opcoes.body?.categorias?.length === 5, JSON.stringify(opcoes.body).slice(0, 120));

  const curta = await api(familia, "POST", "/api/denuncias", { category: "BULLYING", description: "curta" }, "family");
  check("uma descrição curta é recusada (400)", curta.status === 400, `${curta.status}`);

  const filhos = (await api(familia, "GET", "/api/athletes", undefined, "family")).body ?? [];
  const filho = filhos[0];
  const identificada = await api(familia, "POST", "/api/denuncias", {
    category: "BULLYING", anonymous: false, athleteId: filho?.id ?? null, happenedOn: "2026-10-18", place: "Balneário", involved: "Dois colegas da equipa", description: TEXTO,
  }, "family");
  check("a família envia uma denúncia identificada (201)", identificada.status === 201 && identificada.body?.number > 0 && identificada.body?.status === "NEW", JSON.stringify(identificada.body).slice(0, 200));
  if (identificada.body?.id) criado.casos.push(identificada.body.id);

  const anonima = await api(familia, "POST", "/api/denuncias", { category: "ETHICS", anonymous: true, description: `${TEXTO} (anónima)` }, "family");
  check("e uma anónima (201)", anonima.status === 201 && anonima.body?.anonymous === true, JSON.stringify(anonima.body).slice(0, 200));
  if (anonima.body?.id) criado.casos.push(anonima.body.id);

  const doTreinador = await api(treinador, "POST", "/api/denuncias", { category: "OTHER", description: TEXTO });
  check("o treinador não envia pela consola (403)", doTreinador.status === 403, `${doTreinador.status}`);
  if (doTreinador.body?.id) criado.casos.push(doTreinador.body.id);

  console.log("\n=== Quem vê ===");
  const minhas = await api(familia, "GET", "/api/denuncias/minhas", undefined, "family");
  check("a família vê as suas", minhas.status === 200 && criado.casos.every((id) => minhas.body.some((c) => c.id === id)), `${minhas.status} ${minhas.body?.length}`);
  check("a família não vê a lista do clube (403)", (await api(familia, "GET", "/api/denuncias", undefined, "family")).status === 403);
  check("o treinador não vê a lista (403)", (await api(treinador, "GET", "/api/denuncias")).status === 403);
  check("o treinador não abre um caso (403)", (await api(treinador, "GET", `/api/denuncias/${criado.casos[0]}`)).status === 403);

  const lista = await api(direcao, "GET", "/api/denuncias");
  check("a direção vê a lista", lista.status === 200 && criado.casos.every((id) => lista.body.some((c) => c.id === id)), `${lista.status}`);
  const naLista = (id) => lista.body.find((c) => c.id === id);
  const pai = (await db.query(`SELECT name, email FROM "User" WHERE email = $1`, ["familia@lifeclub.pt"])).rows[0];
  check("na identificada a direção vê quem enviou", naLista(criado.casos[0])?.reporter?.name === pai.name && naLista(criado.casos[0])?.reporter?.email === pai.email, JSON.stringify(naLista(criado.casos[0])?.reporter));
  check("na anónima não vê ninguém", naLista(criado.casos[1])?.reporter === null && naLista(criado.casos[1])?.anonymous === true, JSON.stringify(naLista(criado.casos[1])?.reporter));
  check("o caso novo está por ler", naLista(criado.casos[0])?.unread === true);
  check("o educando indicado aparece", !filho || naLista(criado.casos[0])?.athlete?.id === filho.id, JSON.stringify(naLista(criado.casos[0])?.athlete));

  const resumo = await api(direcao, "GET", "/api/denuncias/resumo");
  check("o resumo conta as novas", resumo.status === 200 && resumo.body.novas >= 2, JSON.stringify(resumo.body));

  console.log("\n=== Responder ===");
  const id = criado.casos[0];
  const aberto = await api(direcao, "GET", `/api/denuncias/${id}`);
  check("a direção abre o caso e deixa de estar por ler", aberto.status === 200 && (await api(direcao, "GET", "/api/denuncias")).body.find((c) => c.id === id)?.unread === false);

  const nota = await api(direcao, "POST", `/api/denuncias/${id}/mensagens`, { body: "[nota] Falar com o treinador dos Sub-13 amanhã.", internal: true });
  check("a direção escreve uma nota interna", nota.status === 201 && nota.body?.internal === true);
  const resposta = await api(direcao, "POST", `/api/denuncias/${id}/mensagens`, { body: "Obrigado por nos contar. Vamos falar com a equipa esta semana e dizemos-lhe algo até sexta." });
  check("e responde à família", resposta.status === 201 && resposta.body?.fromStaff === true);
  const depois = await api(direcao, "GET", `/api/denuncias/${id}`);
  check("responder a um caso novo passa-o a Em análise", depois.body?.status === "IN_REVIEW", depois.body?.status);
  check("a direção vê as duas mensagens", depois.body?.messages?.length === 2);

  const daFamilia = await api(familia, "GET", `/api/denuncias/${id}`, undefined, "family");
  check("a família vê a resposta e não a nota interna", daFamilia.status === 200 && daFamilia.body.messages.length === 1 && daFamilia.body.messages[0].fromStaff === true && !daFamilia.body.messages[0].body.includes("[nota]"), JSON.stringify(daFamilia.body.messages).slice(0, 200));
  check("a família ficou com a resposta por ler até abrir", (await api(familia, "GET", "/api/denuncias/minhas", undefined, "family")).body.find((c) => c.id === id)?.unread === false);
  const avisoFamilia = (await db.query(`SELECT count(*)::int n FROM "Notification" n JOIN "User" u ON u.id = n."userId" WHERE u.email = $1 AND n.type = 'CONDUCT_REPORT_REPLIED' AND n."createdAt" > now() - interval '2 minutes'`, ["familia@lifeclub.pt"])).rows[0].n;
  check("a família foi avisada da resposta", avisoFamilia >= 1, `${avisoFamilia} avisos`);
  const avisoDirecao = (await db.query(`SELECT count(*)::int n FROM "Notification" n JOIN "User" u ON u.id = n."userId" WHERE u.email = $1 AND n.type = 'CONDUCT_REPORT_CREATED' AND n."createdAt" > now() - interval '2 minutes'`, ["direcao@lifeclub.pt"])).rows[0].n;
  check("a direção foi avisada das denúncias novas", avisoDirecao >= 2, `${avisoDirecao} avisos`);
  const avisoTreinador = (await db.query(`SELECT count(*)::int n FROM "Notification" n JOIN "User" u ON u.id = n."userId" WHERE u.email = $1 AND n.type = 'CONDUCT_REPORT_CREATED' AND n."createdAt" > now() - interval '2 minutes'`, ["treinador@lifeclub.pt"])).rows[0].n;
  check("o treinador não foi avisado", avisoTreinador === 0, `${avisoTreinador} avisos`);

  const daFamiliaResposta = await api(familia, "POST", `/api/denuncias/${id}/mensagens`, { body: "Obrigada. Fico a aguardar.", internal: true }, "family");
  check("a família responde (e nunca como nota interna)", daFamiliaResposta.status === 201 && daFamiliaResposta.body?.internal === false && daFamiliaResposta.body?.fromStaff === false);

  const anonimaAberta = await api(direcao, "GET", `/api/denuncias/${criado.casos[1]}`);
  await api(familia, "POST", `/api/denuncias/${criado.casos[1]}/mensagens`, { body: "Mais um pormenor." }, "family");
  const anonimaDepois = await api(direcao, "GET", `/api/denuncias/${criado.casos[1]}`);
  check("na anónima as mensagens da família saem sem nome", anonimaAberta.status === 200 && anonimaDepois.body.messages.every((m) => m.fromStaff || m.authorName === null), JSON.stringify(anonimaDepois.body.messages).slice(0, 200));

  console.log("\n=== Fechar ===");
  check("o treinador não muda o estado (403)", (await api(treinador, "PATCH", `/api/denuncias/${id}`, { status: "RESOLVED" })).status === 403);
  const responsaveis = await api(direcao, "GET", "/api/denuncias/responsaveis");
  check("os responsáveis são quem vê denúncias (sem o treinador)", responsaveis.status === 200 && responsaveis.body.length > 0 && !responsaveis.body.some((r) => /treinador/i.test(r.name ?? "")), JSON.stringify(responsaveis.body).slice(0, 200));
  const atribuido = await api(direcao, "PATCH", `/api/denuncias/${id}`, { assigneeId: responsaveis.body[0]?.id });
  check("a direção atribui o caso", atribuido.status === 200 && atribuido.body?.assignee?.id === responsaveis.body[0]?.id);
  const fechado = await api(direcao, "PATCH", `/api/denuncias/${id}`, { status: "RESOLVED" });
  check("e dá-o como resolvido", fechado.status === 200 && fechado.body?.status === "RESOLVED" && fechado.body?.resolvedAt);
  const fechadoFamilia = await api(familia, "POST", `/api/denuncias/${id}/mensagens`, { body: "Ainda uma coisa." }, "family");
  check("a família já não escreve num caso fechado (400)", fechadoFamilia.status === 400);

  console.log("\n=== Documentos de conduta ===");
  check("a família lê os documentos (200)", (await api(familia, "GET", "/api/conduta/documentos", undefined, "family")).status === 200);
  check("a família não cria documentos (403)", (await api(familia, "POST", "/api/conduta/documentos", { title: "x", files: [] }, "family")).status === 403);
  check("o treinador não cria documentos (403)", (await api(treinador, "POST", "/api/conduta/documentos", { title: "x", files: [] })).status === 403);
  const semFicheiros = await api(direcao, "POST", "/api/conduta/documentos", { title: "[TESTE-DEN] Código", files: [] });
  check("a direção não cria um documento sem ficheiros (400)", semFicheiros.status === 400, `${semFicheiros.status}`);
  if (semFicheiros.body?.id) criado.docs.push(semFicheiros.body.id);
  const upload = await api(direcao, "POST", "/api/conduta/documentos/upload", { contentType: "application/pdf" });
  check("a direção recebe um endereço para carregar", upload.status === 201 && typeof upload.body?.url === "string" && /\/conduta\//.test(upload.body?.key ?? ""), JSON.stringify(upload.body).slice(0, 160));
  const chaveAlheia = await api(direcao, "POST", "/api/conduta/documentos", { title: "[TESTE-DEN] Código", files: [{ key: "acd_outro/conduta/0123456789abcdef.pdf", name: "x.pdf" }] });
  check("uma chave fora da pasta do clube é recusada (400)", chaveAlheia.status === 400);
} catch (e) {
  failed++;
  console.log(`  FALHA ${e.message}`);
} finally {
  console.log("\n=== Arrumar ===");
  for (const id of criado.docs) await db.query(`DELETE FROM "ConductDocument" WHERE id = $1`, [id]);
  if (criado.casos.length) await db.query(`DELETE FROM "ConductReport" WHERE id = ANY($1)`, [criado.casos]);
  await db.query(`DELETE FROM "Notification" WHERE type IN ('CONDUCT_REPORT_CREATED', 'CONDUCT_REPORT_REPLIED') AND "academyId" = 'acd_lifeclub' AND "createdAt" > now() - interval '10 minutes'`);
  const restos = (await db.query(`SELECT count(*)::int n FROM "ConductReport" WHERE description LIKE '[TESTE-DEN]%' AND "academyId" = 'acd_lifeclub'`)).rows[0].n;
  check("nada do teste ficou na base", restos === 0, `${restos} linhas`);
  await db.end();
}
console.log(`\n${failed === 0 ? "TUDO OK" : "FALHAS"} — ${passed} ok, ${failed} falhas\n`);
process.exit(failed === 0 ? 0 : 1);

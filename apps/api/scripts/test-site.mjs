#!/usr/bin/env node
/**
 * O site do clube, contra o servidor a correr: o menu Website da consola
 * (`/api/site`) e o que o site pÃºblico lÃª (`/public/sites`).
 *
 * O que se defende:
 *   - quem mexe Ã© quem tem `settings:write` (direÃ§Ã£o); treinador e famÃ­lia nÃ£o;
 *   - um clube que nÃ£o publicou nÃ£o existe para o pÃºblico;
 *   - um rascunho, um produto escondido e uma equipa não ligada (com o plantel e os jogos) não saem;
 *   - uma imagem de fora do armazenamento do clube Ã© recusada;
 *   - o que se grava na consola aparece no pÃºblico.
 *
 * Deixa o clube como o encontrou: apaga o que criou e repÃµe a configuraÃ§Ã£o.
 *
 * PressupÃµe a API a correr (por omissÃ£o em :3011, com o correio desligado) e o
 * seed do Life Club. Uso: API=http://localhost:3011 node scripts/test-site.mjs
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const HERE = path.dirname(fileURLToPath(import.meta.url));

function env(key) {
  const line = readFileSync(path.join(HERE, "..", ".env"), "utf8")
    .split(/\r?\n/)
    .find((l) => l.startsWith(`${key}=`));
  if (!line) throw new Error(`${key} nÃ£o estÃ¡ em .env`);
  return line.slice(key.length + 1).trim().replace(/^"|"$/g, "");
}

const API = process.env.API ?? "http://localhost:3011";
const SUPABASE_URL = env("SUPABASE_URL").replace(/\/$/, "");
const ANON = env("SUPABASE_ANON_KEY");
const SLUG = "life-club";
const PASSWORD = "academia2026";

let passed = 0;
let failed = 0;
function check(label, ok, detail = "") {
  if (ok) {
    passed++;
    console.log(`  OK    ${label}`);
  } else {
    failed++;
    console.log(`  FALHA ${label}${detail ? ` â€” ${detail}` : ""}`);
  }
}

async function signIn(email) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`login falhou para ${email}: ${(await res.text()).slice(0, 120)}`);
  return (await res.json()).access_token;
}

async function api(token, method, pathname, body) {
  const res = await fetch(`${API}${pathname}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "x-academy-slug": SLUG, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, body: json };
}

const publico = async (p) => {
  const res = await fetch(`${API}/public/sites/${SLUG}${p}`);
  return { status: res.status, body: res.ok ? await res.json() : null };
};

/*
 * O plano. O site Ã© do Connect Pro: o teste pÃµe o Life Club nesse plano, prova
 * o 403 e o 404 sem ele, e no fim devolve-lhe o plano que tinha. A troca Ã©
 * pela base (as tabelas dos planos estÃ£o fechadas Ã  API do clube).
 */
const db = new pg.Client({ connectionString: env("MIGRATE_DATABASE_URL"), ssl: { rejectUnauthorized: false } });
await db.connect();
const planoOriginal = (await db.query(`SELECT "planId" FROM "Subscription" WHERE "academyId"='acd_lifeclub'`)).rows[0]?.planId;
if (!planoOriginal) throw new Error("o Life Club nÃ£o tem subscriÃ§Ã£o");
const porPlano = (id) => db.query(`UPDATE "Subscription" SET "planId"=$1 WHERE "academyId"='acd_lifeclub'`, [id]);
/*
 * Desde 26/10 o período experimental também dá o site (migração
 * `20261026120000_site_na_experiencia`). Para ver o clube "sem o site", a
 * avaliação do Life Club vai ao passado durante essa verificação e volta logo a
 * seguir (e no `finally`, se algo falhar a meio).
 */
const trialOriginal = (await db.query(`SELECT "trialEndsAt" FROM "Academy" WHERE id='acd_lifeclub'`)).rows[0]?.trialEndsAt ?? null;
const porTrial = (d) => db.query(`UPDATE "Academy" SET "trialEndsAt"=$1 WHERE id='acd_lifeclub'`, [d]);

let director, coach, parent, inicial, antes, equipasDoClube, todasLigadas;
const criados = { noticias: [], produtos: [], patrocinadores: [], bilheteira: [] };

/*
 * Daqui até ao `try` de baixo o plano do Life Club já pode ter mudado: uma
 * falha a meio (um login que não responde, a API em baixo) não pode deixar o
 * clube noutro plano. Aconteceu a 14/10, e as corridas seguintes leram a
 * Consola como o plano "original".
 */
try {
director = await signIn("direcao@lifeclub.pt");
coach = await signIn("treinador@lifeclub.pt");
parent = await signIn("familia@lifeclub.pt");

console.log("\n=== O plano ===");
await porTrial(new Date(Date.now() - 86_400_000));
await porPlano("plan_clube");
const semPlano = await api(director, "GET", "/api/site");
check("sem o Connect Pro, a direÃ§Ã£o nÃ£o lÃª (403 SITE_NOT_IN_PLAN)", semPlano.status === 403 && JSON.stringify(semPlano.body).includes("SITE_NOT_IN_PLAN"), JSON.stringify(semPlano.body).slice(0, 120));
const bootSem = await api(director, "GET", "/api/bootstrap");
await porPlano("plan_connect_pro");
await porTrial(trialOriginal);
const bootCom = await api(director, "GET", "/api/bootstrap");
if (bootSem.status === 200 && bootCom.status === 200) {
  check("o arranque diz se o site estÃ¡ no plano", bootSem.body.academy.websiteIncluido === false && bootCom.body.academy.websiteIncluido === true);
}

console.log("\n=== Quem pode ===");
inicial = await api(director, "GET", "/api/site");
check("a direÃ§Ã£o lÃª o site", inicial.status === 200, String(inicial.status));
check("o treinador nÃ£o lÃª (403)", (await api(coach, "GET", "/api/site")).status === 403);
check("a famÃ­lia nÃ£o lÃª (403)", (await api(parent, "GET", "/api/site")).status === 403);
check("o treinador nÃ£o escreve (403)", (await api(coach, "POST", "/api/site/noticias", { titulo: "x" })).status === 403);

antes = inicial.body;
// As equipas do clube, para as ligar no site: sem isso, nenhuma aparece (ver `equipasValidas`).
equipasDoClube = (await api(director, "GET", "/api/teams")).body ?? [];
todasLigadas = Object.fromEntries(equipasDoClube.map((t) => [t.id, { visivel: true, plantel: true }]));
} catch (e) {
  await porPlano(planoOriginal);
  await db.end();
  throw e;
}

try {
  console.log("\n=== Publicar ===");
  await api(director, "PATCH", "/api/site", { publicado: false });
  check("por publicar, o pÃºblico dÃ¡ 404", (await publico("")).status === 404);
  const pub = await api(director, "PATCH", "/api/site", {
    publicado: true,
    equipas: todasLigadas,
    layout: "holofote",
    identidade: { lema: "Lema do teste", sobre: "Sobre do teste", redes: { facebook: "https://facebook.com/x", instagram: "javascript:alert(1)" } },
  });
  check("publicar e mudar o layout", pub.status === 200 && pub.body.publicado === true && pub.body.layout === "holofote", JSON.stringify(pub.body).slice(0, 120));
  check("a rede com javascript: Ã© descartada", pub.body.identidade.redes.instagram === undefined && pub.body.identidade.redes.facebook === "https://facebook.com/x");
  const clube = await publico("");
  check("publicado, o pÃºblico vÃª o clube com o lema", clube.status === 200 && clube.body.motto === "Lema do teste");
  check("layout holofote no resumo", (await publico("/resumo")).body?.layout === "holofote");

  console.log("\n=== NotÃ­cias ===");
  const rasc = await api(director, "POST", "/api/site/noticias", { titulo: "[TESTE-SITE] Rascunho", resumo: "r", corpo: "a", estado: "rascunho" });
  check("criar rascunho", rasc.status === 201 && rasc.body.estado === "rascunho" && rasc.body.publicadaEm === null, JSON.stringify(rasc.body).slice(0, 120));
  if (rasc.body?.id) criados.noticias.push(rasc.body.id);
  check("o rascunho nÃ£o sai no pÃºblico", !(await publico("/noticias")).body.some((n) => n.title === "[TESTE-SITE] Rascunho"));
  const publicada = await api(director, "PATCH", `/api/site/noticias/${rasc.body.id}`, { titulo: "[TESTE-SITE] Publicada", resumo: "r", corpo: "Um.\n\nDois.", estado: "publicada", destaque: true });
  check("publicar a notÃ­cia", publicada.status === 200 && publicada.body.estado === "publicada" && !!publicada.body.publicadaEm);
  const naLista = (await publico("/noticias")).body.find((n) => n.id === rasc.body.id);
  check("publicada sai no pÃºblico, com os parÃ¡grafos partidos", naLista && naLista.body.length === 2 && naLista.featured === true, JSON.stringify(naLista ?? null).slice(0, 120));
  const deFora = await api(director, "POST", "/api/site/noticias", { titulo: "[TESTE-SITE] Imagem de fora", imagem: "https://exemplo.com/x.jpg", estado: "rascunho" });
  check("imagem de fora do armazenamento recusada (400)", deFora.status === 400, String(deFora.status));
  if (deFora.body?.id) criados.noticias.push(deFora.body.id);
  const sem = await api(director, "POST", "/api/site/noticias", { estado: "publicada" });
  check("notÃ­cia sem tÃ­tulo recusada (400)", sem.status === 400);

  console.log("\n=== Imagens ===");
  const img = await api(director, "POST", "/api/site/imagens", { contentType: "image/webp" });
  check("autorizaÃ§Ã£o de carregamento com o endereÃ§o pÃºblico", img.status === 201 && /\/site-publico\/acd_lifeclub\/site-[0-9a-f]+\.webp$/.test(img.body.publicUrl ?? ""), JSON.stringify(img.body).slice(0, 160));
  check("SVG recusado (400)", (await api(director, "POST", "/api/site/imagens", { contentType: "image/svg+xml" })).status === 400);
  const comImagem = await api(director, "POST", "/api/site/noticias", { titulo: "[TESTE-SITE] Com imagem", imagem: img.body.publicUrl, estado: "rascunho" });
  check("imagem do prÃ³prio clube aceite", comImagem.status === 201 && comImagem.body.imagem === img.body.publicUrl);
  if (comImagem.body?.id) criados.noticias.push(comImagem.body.id);

  console.log("\n=== Loja ===");
  const prod = await api(director, "POST", "/api/site/produtos", { nome: "[TESTE-SITE] Camisola", preco: 39.9, tamanhos: "S, M" });
  check("criar produto", prod.status === 201 && prod.body.preco === 39.9, JSON.stringify(prod.body).slice(0, 120));
  if (prod.body?.id) criados.produtos.push(prod.body.id);
  const pp = (await publico("/produtos")).body.find((p) => p.id === prod.body.id);
  check("no pÃºblico em euros, com os tamanhos", pp && pp.price === 39.9 && pp.variants?.options?.length === 2);
  await api(director, "PATCH", `/api/site/produtos/${prod.body.id}`, { nome: "[TESTE-SITE] Camisola", preco: 39.9, visivel: false });
  check("escondido sai do pÃºblico", !(await publico("/produtos")).body.some((p) => p.id === prod.body.id));
  check("preÃ§o negativo recusado (400)", (await api(director, "POST", "/api/site/produtos", { nome: "x", preco: -1 })).status === 400);

  console.log("\n=== Patrocinadores ===");
  const pat = await api(director, "POST", "/api/site/patrocinadores", { nome: "[TESTE-SITE] CafÃ©", url: "javascript:alert(1)" });
  check("criar patrocinador, sem o link perigoso", pat.status === 201 && pat.body.url === "", JSON.stringify(pat.body));
  if (pat.body?.id) criados.patrocinadores.push(pat.body.id);
  check("no pÃºblico", (await publico("")).body.sponsors.some((s) => s.name === "[TESTE-SITE] CafÃ©"));

  console.log("\n=== Bilheteira e estÃ¡dio ===");
  await api(director, "PATCH", "/api/site", {
    recintos: [{ id: "rt", nome: "EstÃ¡dio do teste", tipo: "campo", bancadas: [{ id: "bt", nome: "Central", lado: "nascente", ordem: 0, peso: 1, lotacao: 100, coberta: true }, { lado: "inexistente" }] }],
  });
  const recintos = (await api(director, "GET", "/api/site")).body.recintos;
  check("recintos limpos (lado desconhecido vira norte, sem nome ganha nome)", recintos[0]?.bancadas?.[1]?.lado === "norte" && !!recintos[0]?.bancadas?.[1]?.nome);
  const jogos = (await publico("/jogos")).body;
  const casa = jogos.find((j) => j.isHome && j.status === "SCHEDULED" && new Date(j.startsAt) > new Date());
  const fora = jogos.find((j) => !j.isHome && j.status === "SCHEDULED" && new Date(j.startsAt) > new Date());
  if (casa) {
    const b = await api(director, "PUT", `/api/site/bilheteira/${casa.id}`, { aberta: true, recintoId: "rt", nota: "[TESTE-SITE]", tipos: [{ id: "t1", nome: "Central", preco: 8, bancadaId: "bt" }] });
    check("abrir a bilheteira de um jogo em casa", b.status === 200 && b.body.aberta === true && b.body.tipos[0].preco === 8, JSON.stringify(b.body).slice(0, 120));
    criados.bilheteira.push(casa.id);
    const j = (await publico(`/jogos/${casa.id}`)).body;
    check("o jogo pÃºblico traz os bilhetes com a bancada", j?.tickets?.open === true && j.tickets.types[0].bancadaId === "bt" && j.tickets.recintoId === "rt");
    check("bilheteira sem tipos recusada (400)", (await api(director, "PUT", `/api/site/bilheteira/${casa.id}`, { aberta: true, tipos: [] })).status === 400);
  } else {
    check("hÃ¡ um jogo em casa no futuro para testar", false, "sem jogo em casa futuro no Life Club");
  }
  if (fora) {
    // Fora também se vende: o clube leva bilhetes para os seus adeptos.
    const f = await api(director, "PUT", `/api/site/bilheteira/${fora.id}`, { aberta: true, recintoId: "rt", nota: "[TESTE-SITE]", tipos: [{ id: "t1", nome: "Visitantes", preco: 5, bancadaId: "bt" }] });
    check("abrir a bilheteira de um jogo fora", f.status === 200 && f.body.aberta === true, JSON.stringify(f.body).slice(0, 120));
    criados.bilheteira.push(fora.id);
  }

  console.log("\n=== Equipas ===");
  const equipas = (await publico("/equipas")).body;
  check("ligadas, as equipas saem com o plantel", equipas.length > 0 && equipas.some((e) => e.roster.length > 0));
  // A equipa com mais jogos, para o teste dizer alguma coisa sobre os jogos.
  const jogosAntes = (await publico("/jogos")).body;
  const alvo = [...equipas].sort((a, b) => jogosAntes.filter((j) => j.teamId === b.id).length - jogosAntes.filter((j) => j.teamId === a.id).length)[0];
  const jogoDoAlvo = jogosAntes.find((j) => j.teamId === alvo.id);
  await api(director, "PATCH", "/api/site", { equipas: { ...todasLigadas, [alvo.id]: { visivel: false, plantel: false } } });
  check("equipa desligada sai do público", !(await publico("/equipas")).body.some((e) => e.id === alvo.id));
  check("e não se abre pelo endereço (404)", (await publico(`/equipas/${alvo.id}`)).status === 404);
  check("e os jogos e resultados dela também", !(await publico("/jogos")).body.some((j) => j.teamId === alvo.id));
  if (jogoDoAlvo) check("e um jogo dela não se abre pelo endereço (404)", (await publico(`/jogos/${jogoDoAlvo.id}`)).status === 404);
  console.log("\n=== Fotografias do clube e das equipas ===");
  const outra = equipas.find((e) => e.id !== alvo.id) ?? alvo;
  const fotoDeFora = await api(director, "PATCH", "/api/site", { equipas: { ...todasLigadas, [outra.id]: { visivel: true, foto: "https://exemplo.com/equipa.jpg" } } });
  check("fotografia de equipa de fora do clube recusada (400)", fotoDeFora.status === 400, String(fotoDeFora.status));
  await api(director, "PATCH", "/api/site", { equipas: { ...todasLigadas, [outra.id]: { visivel: true, foto: img.body.publicUrl } } });
  check("fotografia da equipa no público", (await publico(`/equipas/${outra.id}`)).body?.image === img.body.publicUrl);
  check("sem fotografia, a equipa não leva image (o site põe a de omissão)", (await publico("/equipas")).body.filter((e) => e.id !== outra.id).every((e) => !e.image));
  const idFora = await api(director, "PATCH", "/api/site", { identidade: { ...antes.identidade, foto: "https://exemplo.com/clube.jpg" } });
  check("fotografia do clube de fora recusada (400)", idFora.status === 400, String(idFora.status));
  await api(director, "PATCH", "/api/site", { identidade: { ...antes.identidade, foto: img.body.publicUrl } });
  check("fotografia do clube no público", (await publico("")).body?.photo === img.body.publicUrl);

  await api(director, "PATCH", "/api/site", { equipas: {} });
  check("sem configuração, nenhuma equipa aparece", (await publico("/equipas")).body.length === 0);
  check("nem nenhum jogo", (await publico("/jogos")).body.length === 0);

  console.log("\n=== Publicado, mas sem o plano ===");
  await porPlano("plan_academia");
  check("o pÃºblico dÃ¡ 404 (Connect sem Pro)", (await publico("")).status === 404);
  check("e o resumo tambÃ©m", (await publico("/resumo")).status === 404);
  await porPlano("plan_connect_pro");
  check("com o plano de volta, o pÃºblico vÃª o clube", (await publico("")).status === 200);
} finally {
  await porPlano("plan_connect_pro");
  await porTrial(trialOriginal);
  console.log("\n=== Arrumar ===");
  for (const id of criados.noticias) await api(director, "DELETE", `/api/site/noticias/${id}`);
  for (const id of criados.produtos) await api(director, "DELETE", `/api/site/produtos/${id}`);
  for (const id of criados.patrocinadores) await api(director, "DELETE", `/api/site/patrocinadores/${id}`);
  for (const id of criados.bilheteira) await api(director, "DELETE", `/api/site/bilheteira/${id}`);
  const reposto = await api(director, "PATCH", "/api/site", {
    publicado: antes.publicado,
    layout: antes.layout,
    identidade: antes.identidade,
    equipas: antes.equipas,
    recintos: antes.recintos,
  });
  check("configuraÃ§Ã£o reposta", reposto.status === 200);
  await porPlano(planoOriginal);
  await db.end();
}

console.log(`\n${failed === 0 ? "TUDO OK" : "FALHAS"} â€” ${passed} ok, ${failed} falhas\n`);
process.exit(failed === 0 ? 0 : 1);

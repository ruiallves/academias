#!/usr/bin/env node
/**
 * Modelos de treino — guardar um plano para o voltar a usar.
 *
 * O que interessa provar:
 *
 *  - **Que não se duplica.** Foi o pedido explícito ("garante que esse treino já
 *    não existe na DB"), e são duas perguntas: o nome já está tomado, e o
 *    conteúdo já está guardado com outro nome. A segunda é a que interessa — é a
 *    que um treinador faz sem dar por isso, duas terças-feiras seguidas.
 *  - **Que aplicar substitui.** O plano do modelo passa a ser o plano da sessão,
 *    e a data, a equipa e o local ficam onde estavam.
 *  - **O âmbito e a privacidade.** Um treinador não guarda nem aplica modelos em
 *    equipas que não são dele, e um modelo privado não aparece a mais ninguém —
 *    nem se lhe souberem o id.
 *
 * Uso: node scripts/test-modelos-de-treino.mjs
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
const API = process.env.API_URL ?? "http://localhost:3000";

let ok = 0, bad = 0;
const check = (l, c, d = "") => { if (c) { ok++; console.log("  OK    " + l); } else { bad++; console.log("  FALHA " + l + (d ? " — " + d : "")); } };

const login = async (email) =>
  (await (await fetch(`${S}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: A, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "academia2026" }),
  })).json()).access_token;

const call = async (token, method, pathname, body) => {
  const r = await fetch(API + pathname, {
    method,
    headers: { Authorization: `Bearer ${token}`, "x-academy-slug": "life-club", ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};

const db = new pg.Client({ connectionString: env("MIGRATE_DATABASE_URL"), ssl: { rejectUnauthorized: false } });
await db.connect();

/*
 * Limpeza à entrada, e não só à saída.
 *
 * O nome é único por academia: um modelo deixado para trás por uma corrida que
 * rebentou a meio faz a corrida seguinte falhar com 409 em testes que não têm
 * nada que ver com nomes repetidos.
 */
const limpar = async () => {
  await db.query(`DELETE FROM "SessionTemplate" WHERE name LIKE 'ZZ %'`);
  await db.query(`DELETE FROM "TrainingSession" WHERE venue = 'ZZ Campo de teste'`);
  await db.query(`DELETE FROM "Team" WHERE name LIKE 'ZZ %'`);
};
await limpar();

const academyId = (await db.query(`SELECT id FROM "Academy" WHERE slug = 'life-club'`)).rows[0].id;

/**
 * Um treino de raiz, sem passar pelo calendário.
 *
 * Podia criar-se por `/api/events`, mas isso arrasta as regras de choque de
 * horário e de repetição — que têm o seu próprio teste. Aqui o treino é só o
 * suporte do plano; o que se mede é o que lhe acontece a seguir.
 */
let hora = 0;
const novoTreino = async (teamId) => {
  const id = `zz_sess_${Date.now().toString(36)}_${hora}`;
  const inicio = new Date(Date.UTC(2026, 8, 20, 8 + hora++, 0, 0));
  const fim = new Date(inicio.getTime() + 90 * 60_000);
  await db.query(
    `INSERT INTO "TrainingSession" (id, "academyId", "teamId", "startsAt", "endsAt", venue, status, "updatedAt")
     VALUES ($1, $2, $3, $4, $5, 'ZZ Campo de teste', 'SCHEDULED', now())`,
    [id, academyId, teamId, inicio, fim],
  );
  return id;
};

const PLANO = {
  objective: "ZZ Posse em bloco médio",
  objectives: ["Organização ofensiva"],
  sessionType: "Táctico",
  intensity: 7,
  expectedAthletes: 18,
  material: "12 coletes, 8 cones",
  planNotes: "ZZ nota do plano",
  blocks: [
    { name: "Activação", durationMin: 15, category: "Aquecimento", intensity: 4 },
    { name: "Posse 6x6", durationMin: 25, category: "Posse", intensity: 8 },
    { name: "Jogo formal", durationMin: 20, category: "Jogo", intensity: 9 },
  ],
};
const TOTAL = PLANO.blocks.reduce((n, b) => n + b.durationMin, 0);

const director = await login("direcao@lifeclub.pt");
const coach = await login("treinador@lifeclub.pt");
const adjunto = await login("adjunto@lifeclub.pt");
const parent = await login("familia@lifeclub.pt");

/* A equipa do treinador semeado — é nela que ele planeia. */
const minha = "t_sub11";

console.log("=== Guardar um plano como modelo ===");
const s1 = await novoTreino(minha);
const gravado = await call(coach, "PUT", `/api/training/sessions/${s1}/plan`, PLANO);
check("o treinador grava o plano do seu treino", gravado.status === 200, `${gravado.status}`);

const criado = await call(coach, "POST", `/api/training/sessions/${s1}/template`, { name: "ZZ Modelo Terça" });
check("guarda-o como modelo", criado.status === 201 || criado.status === 200, JSON.stringify(criado.body).slice(0, 140));
check("e recebe o id de volta", Boolean(criado.body?.id));

const lista = await call(coach, "GET", "/api/training/templates");
const meu = (lista.body ?? []).find((t) => t.id === criado.body?.id);
check("aparece na lista", Boolean(meu));
check("com os blocos contados", meu?.blockCount === PLANO.blocks.length, `${meu?.blockCount}`);
check("e o tempo somado", meu?.totalMin === TOTAL, `${meu?.totalMin}`);
check("por usar ainda", meu?.useCount === 0, `${meu?.useCount}`);
check("com o objectivo do plano", meu?.objective === PLANO.objective);
check("visível ao clube por omissão", meu?.visibility === "CLUB", `${meu?.visibility}`);

console.log("\n=== Não duplicar ===");
const mesmoNome = await call(coach, "POST", `/api/training/sessions/${s1}/template`, { name: "ZZ Modelo Terça" });
check("o mesmo nome outra vez é recusado (409)", mesmoNome.status === 409, `${mesmoNome.status}`);
check("e a mensagem diz qual", String(mesmoNome.body?.message ?? "").includes("ZZ Modelo Terça"), `${mesmoNome.body?.message}`);

/*
 * O caso que interessa: **outro** treino, com o mesmo plano.
 *
 * É assim que o duplicado nasce na vida real — não a carregar duas vezes no
 * mesmo botão, mas duas semanas depois, no treino da semana seguinte, montado
 * igual. Se a verificação fosse só pelo nome, este passava.
 */
const s2 = await novoTreino(minha);
await call(coach, "PUT", `/api/training/sessions/${s2}/plan`, PLANO);
const gemeo = await call(coach, "POST", `/api/training/sessions/${s2}/template`, { name: "ZZ Modelo Quinta" });
check("o mesmo plano com outro nome é recusado (409)", gemeo.status === 409, `${gemeo.status}`);
check("e diz qual é o que já existe", String(gemeo.body?.message ?? "").includes("ZZ Modelo Terça"), `${gemeo.body?.message}`);

const contagem = Number((await db.query(`SELECT count(*) FROM "SessionTemplate" WHERE name LIKE 'ZZ %'`)).rows[0].count);
check("e nada foi criado às escondidas", contagem === 1, `${contagem}`);

/* Um plano diferente com outro nome passa — senão a verificação estava a impedir trabalho. */
const outro = await call(coach, "PUT", `/api/training/sessions/${s2}/plan`, {
  ...PLANO,
  objective: "ZZ Pressing alto",
  blocks: [{ name: "Pressing 8x8", durationMin: 30, category: "Jogo", intensity: 9 }],
});
check("grava um plano diferente", outro.status === 200, `${outro.status}`);
const segundo = await call(coach, "POST", `/api/training/sessions/${s2}/template`, { name: "ZZ Modelo Quinta" });
check("um plano diferente guarda-se sem chatice", segundo.status === 201 || segundo.status === 200, `${segundo.status}`);

console.log("\n=== O que não é modelo ===");
const s3 = await novoTreino(minha);
const semBlocos = await call(coach, "POST", `/api/training/sessions/${s3}/template`, { name: "ZZ Modelo Vazio" });
check("um treino sem blocos não dá modelo (400)", semBlocos.status === 400, `${semBlocos.status}`);
const semNome = await call(coach, "POST", `/api/training/sessions/${s1}/template`, { name: "x" });
check("um nome de uma letra é recusado (400)", semNome.status === 400, `${semNome.status}`);

console.log("\n=== Aplicar ===");
const antes = (await db.query(`SELECT "startsAt", "teamId", venue FROM "TrainingSession" WHERE id = $1`, [s3])).rows[0];
const aplicado = await call(coach, "POST", `/api/training/sessions/${s3}/template/${criado.body.id}`);
check("aplica o modelo ao treino vazio", aplicado.status === 201 || aplicado.status === 200, `${aplicado.status}`);
check("e devolve o plano já com ele lá dentro", aplicado.body?.blocks?.length === PLANO.blocks.length, `${aplicado.body?.blocks?.length}`);
check("com os blocos pela ordem certa", aplicado.body?.blocks?.[0]?.name === "Activação" && aplicado.body?.blocks?.[2]?.name === "Jogo formal");
check("e os campos da sessão", aplicado.body?.objective === PLANO.objective && aplicado.body?.intensity === PLANO.intensity);

const depois = (await db.query(`SELECT "startsAt", "teamId", venue FROM "TrainingSession" WHERE id = $1`, [s3])).rows[0];
check("a data do treino não mexe", String(antes.startsAt) === String(depois.startsAt));
check("a equipa também não", antes.teamId === depois.teamId);
check("nem o local", antes.venue === depois.venue);

const usado = ((await call(coach, "GET", "/api/training/templates")).body ?? []).find((t) => t.id === criado.body.id);
check("a contagem de uso sobe", usado?.useCount === 1, `${usado?.useCount}`);
check("e fica a data da última utilização", Boolean(usado?.lastUsedAt));

/*
 * Aplicar por cima substitui — não funde.
 *
 * O treino s3 já tem os três blocos do modelo. Aplicar o segundo modelo (um
 * bloco) tem de o deixar com **um**; se ficasse com quatro, a interface estava a
 * prometer "substitui" e o servidor a fazer outra coisa.
 */
const porCima = await call(coach, "POST", `/api/training/sessions/${s3}/template/${segundo.body.id}`);
check("aplicar por cima substitui em vez de somar", porCima.body?.blocks?.length === 1, `${porCima.body?.blocks?.length}`);

console.log("\n=== Âmbito e permissão ===");
const negadoAoPai = await call(parent, "GET", "/api/training/templates");
check("um encarregado não vê modelos (403)", negadoAoPai.status === 403, `${negadoAoPai.status}`);
const guardaPai = await call(parent, "POST", `/api/training/sessions/${s1}/template`, { name: "ZZ Modelo Pai" });
check("nem os guarda (403)", guardaPai.status === 403, `${guardaPai.status}`);

/*
 * A equipa de fora fabrica-se, não se procura.
 *
 * A primeira versão deste bloco ia à base procurar uma equipa a que o adjunto não
 * pertencesse — e não encontrou nenhuma, porque a direcção lhe atribuiu todos os
 * escalões pela aplicação. Um teste de fronteira que se salta a si próprio quando
 * os dados mudam não prova nada: a equipa passa a ser criada aqui, sem ninguém na
 * equipa técnica, e desaparece na limpeza.
 */
const equipaDeFora = `zz_team_${Date.now().toString(36)}`;
const molde = (await db.query(
  `SELECT "sportId", "seasonId" FROM "Team" WHERE "academyId" = $1 LIMIT 1`, [academyId],
)).rows[0];
await db.query(
  `INSERT INTO "Team" (id, "academyId", "sportId", "seasonId", name, "maxAge", "updatedAt")
   VALUES ($1, $2, $3, $4, 'ZZ Equipa Sem Treinador', 99, now())`,
  [equipaDeFora, academyId, molde.sportId, molde.seasonId],
);

const alheio = await novoTreino(equipaDeFora);
const planoAlheio = await call(director, "PUT", `/api/training/sessions/${alheio}/plan`, PLANO);
check("a direcção planeia em qualquer equipa", planoAlheio.status === 200, `${planoAlheio.status}`);

const guardaAlheio = await call(coach, "POST", `/api/training/sessions/${alheio}/template`, { name: "ZZ Modelo Alheio" });
check("um treinador não guarda modelo de uma equipa que não é dele (403)", guardaAlheio.status === 403, `${guardaAlheio.status}`);
const aplicaAlheio = await call(coach, "POST", `/api/training/sessions/${alheio}/template/${criado.body.id}`);
check("nem lhe aplica um modelo (403)", aplicaAlheio.status === 403, `${aplicaAlheio.status}`);

console.log("\n=== Privacidade ===");
const s4 = await novoTreino(minha);
await call(coach, "PUT", `/api/training/sessions/${s4}/plan`, {
  ...PLANO,
  objective: "ZZ Só meu",
  blocks: [{ name: "Finalização", durationMin: 20, category: "Finalização", intensity: 7 }],
});
const privado = await call(coach, "POST", `/api/training/sessions/${s4}/template`, { name: "ZZ Modelo Privado", visibility: "PRIVATE" });
check("um modelo pode nascer privado", privado.status === 201 || privado.status === 200, `${privado.status}`);

const doOutro = (await call(adjunto, "GET", "/api/training/templates")).body ?? [];
check("a lista do adjunto traz alguma coisa", doOutro.length > 0, `${doOutro.length}`);
check("mas não o modelo privado de outro", !doOutro.some((t) => t.id === privado.body?.id));
check("e traz os do clube", doOutro.some((t) => t.id === criado.body?.id));

const s5 = await novoTreino(minha);
const espreitar = await call(adjunto, "POST", `/api/training/sessions/${s5}/template/${privado.body.id}`);
check("nem o consegue aplicar sabendo o id (404)", espreitar.status === 404, `${espreitar.status}`);

console.log("\n=== Apagar ===");
const apagaAlheio = await call(adjunto, "DELETE", `/api/training/templates/${privado.body.id}`);
check("um treinador não apaga o modelo de outro (403)", apagaAlheio.status === 403, `${apagaAlheio.status}`);
const apagaOSeu = await call(coach, "DELETE", `/api/training/templates/${privado.body.id}`);
check("o autor apaga o dele", apagaOSeu.status === 200, `${apagaOSeu.status}`);
const apagaDirecao = await call(director, "DELETE", `/api/training/templates/${segundo.body.id}`);
check("a direcção apaga um do clube", apagaDirecao.status === 200, `${apagaDirecao.status}`);

const sobraram = Number((await db.query(`SELECT count(*) FROM "SessionTemplate" WHERE name LIKE 'ZZ %'`)).rows[0].count);
check("e ficam só os que não foram apagados", sobraram === 1, `${sobraram}`);

/*
 * Apagar um modelo não desfaz os treinos que o usaram.
 *
 * O plano foi copiado para a sessão: o modelo é a fôrma, não a peça. Se apagar a
 * fôrma esvaziasse o treino de sábado, ninguém se atrevia a arrumar a lista.
 */
const aindaLaEsta = await call(coach, "GET", `/api/training/sessions/${s3}/plan`);
check("e o treino que o usou fica com o plano", aindaLaEsta.body?.blocks?.length === 1, `${aindaLaEsta.body?.blocks?.length}`);

console.log("\n=== Limpeza ===");
await limpar();
await db.end();
console.log("  feito");

console.log(`\n${ok} passaram, ${bad} falharam`);
process.exit(bad === 0 ? 0 : 1);

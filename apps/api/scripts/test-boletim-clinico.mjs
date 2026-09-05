#!/usr/bin/env node
/**
 * O boletim clínico grava mesmo — e o exame não pede o NIF.
 *
 * ## As duas queixas
 *
 *  1. *"A médica não consegue registar a data do exame sem preencher o NIF do
 *     atleta."* A validade do exame só se escrevia no formulário administrativo
 *     da ficha, que exige `athlete:write` (que o departamento clínico não tem) e
 *     um NIF válido para gravar seja o que for. Passou a escrever-se ao registar
 *     o exame, com `clinical:write`.
 *
 *  2. *"Agendo uma consulta ou faço um registo e fica só local, não actualiza na
 *     base."* Estava certo: não havia endpoint nenhum. O que a consola registava
 *     vivia num objecto em memória no browser e desaparecia ao recarregar — com
 *     o atleta a voltar a apto para o treinador convocar.
 *
 * Uso: node scripts/test-boletim-clinico.mjs
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const env = (k) => {
  const l = readFileSync(path.join(HERE, "..", ".env"), "utf8").split(/\r?\n/).find((x) => x.startsWith(k + "="));
  if (!l) throw new Error(`${k} não está em .env`);
  return l.slice(k.length + 1).trim().replace(/^"|"$/g, "");
};

const S = env("SUPABASE_URL").replace(/\/$/, "");
const A = env("SUPABASE_ANON_KEY");
const API = process.env.API_URL ?? "http://127.0.0.1:3000";
const SLUG = "life-club";

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
    headers: { Authorization: `Bearer ${token}`, "x-academy-slug": SLUG, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};

const db = new pg.Client({ connectionString: env("MIGRATE_DATABASE_URL"), ssl: { rejectUnauthorized: false } });
await db.connect();

const limpar = () => db.query(`DELETE FROM "ClinicalEntry" WHERE title LIKE 'ZZ %'`);
await limpar();

const medica = await login("clinico@lifeclub.pt");
const treinador = await login("treinador@lifeclub.pt");
const familia = await login("familia@lifeclub.pt");

/*
 * Um atleta que serve as **duas** verificações: está no Sub-11 (a equipa do
 * treinador semeado, para o âmbito dele) e é filho da família semeada (para a
 * verificação de privacidade). Sem as duas coisas no mesmo atleta, uma delas
 * saltava — e a que saltava era a da privacidade, que é a que interessa quando
 * se alarga uma leitura de dados de saúde.
 */
const atleta = (await db.query(`
  SELECT a.id, a.name, a."medicalValidUntil"
    FROM "Athlete" a
    JOIN "TeamMembership" tm ON tm."athleteId" = a.id
    JOIN "GuardianLink" g ON g."athleteId" = a.id
    JOIN "Membership" m ON m.id = g."membershipId"
    JOIN "User" u ON u.id = m."userId"
   WHERE a."academyId" = 'acd_lifeclub' AND tm."teamId" = 't_sub11'
     AND a.status = 'ACTIVE' AND u.email = 'familia@lifeclub.pt'
   ORDER BY a.name LIMIT 1`)).rows[0];
const validadeOriginal = atleta.medicalValidUntil;
const nifOriginal = (await db.query(`SELECT "taxId" FROM "Athlete" WHERE id = $1`, [atleta.id])).rows[0]?.taxId;

try {
  console.log(`=== O atleta: ${atleta.name} ===`);

  console.log("\n=== Registar uma baixa — e ficar mesmo gravada ===");
  const baixa = await call(medica, "POST", `/api/athletes/${atleta.id}/clinical`, {
    kind: "INJURY",
    status: "DONE",
    impact: "OUT",
    date: "2026-09-01",
    title: "ZZ Entorse do tornozelo",
    detail: "ZZ grau 1",
    expectedReturn: "2026-09-22",
  });
  check("a médica regista a baixa", baixa.status === 201 || baixa.status === 200, `${baixa.status} ${JSON.stringify(baixa.body).slice(0, 130)}`);

  const naBase = (await db.query(
    `SELECT * FROM "ClinicalEntry" WHERE id = $1`, [baixa.body?.id],
  )).rows[0];
  check("está na base de dados", Boolean(naBase), "não encontrei a linha");
  check("com o autor registado", Boolean(naBase?.authorId), "sem autor — o boletim tem de ser rastreável");
  check("e os dias de paragem calculados", naBase?.outDays === 21, `${naBase?.outDays}`);

  /* A prova que interessa: o atleta fica indisponível para toda a gente. */
  const comoTreinador = await call(treinador, "GET", "/api/athletes");
  const visto = (comoTreinador.body ?? []).find((a) => a.id === atleta.id);
  check("o treinador vê-o indisponível", visto?.availability === "out", `${visto?.availability}`);
  /*
   * E vê o diagnóstico — de propósito. O treinador tem `clinical:read` porque
   * precisa de saber que lesão é para adaptar o treino; quem só tem
   * `clinical:status` (a família) vê o estado e a retoma, e mais nada. É a
   * razão de existirem duas permissões em vez de uma.
   */
  check("com o diagnóstico, que ele pode ler", visto?.restriction?.title === "ZZ Entorse do tornozelo", JSON.stringify(visto?.restriction));

  console.log("\n=== O exame, sem NIF nenhum ===");
  const exame = await call(medica, "POST", `/api/athletes/${atleta.id}/clinical`, {
    kind: "EXAM",
    status: "DONE",
    impact: "NONE",
    date: "2026-09-03",
    title: "ZZ Exame médico-desportivo",
    validUntil: "2027-09-03",
  });
  check("a médica regista o exame", exame.status === 201 || exame.status === 200, `${exame.status}`);

  /*
   * `::text` e não `toISOString()`: o `pg` lê uma coluna `date` como meia-noite
   * **local**, e a meia-noite de Lisboa em Setembro é 23:00 UTC do dia anterior.
   * A primeira versão desta asserção falhava por isso, com o valor certo na base.
   */
  const ficha = (await db.query(
    `SELECT "medicalValidUntil"::text AS d FROM "Athlete" WHERE id = $1`, [atleta.id],
  )).rows[0];
  check("e a validade passou para a ficha do atleta", ficha?.d === "2027-09-03", `${ficha?.d}`);
  const nif = (await db.query(`SELECT "taxId" FROM "Athlete" WHERE id = $1`, [atleta.id])).rows[0];
  check("sem lhe tocar no NIF", nif?.taxId === nifOriginal, `${nif?.taxId} vs ${nifOriginal}`);

  /* E a médica continua a **não** poder editar a ficha — a fronteira mantém-se. */
  const tentaEditar = await call(medica, "PATCH", `/api/athletes/${atleta.id}`, { name: "ZZ Nome Alterado" });
  check("a médica continua sem poder editar a ficha (403)", tentaEditar.status === 403, `${tentaEditar.status}`);

  console.log("\n=== Agendar uma consulta ===");
  const consulta = await call(medica, "POST", `/api/athletes/${atleta.id}/clinical`, {
    kind: "NUTRITION",
    status: "SCHEDULED",
    impact: "OUT",
    date: "2026-09-30",
    time: "10:30",
    location: "ZZ Clínica",
    title: "ZZ Consulta de nutrição",
  });
  check("agenda", consulta.status === 201 || consulta.status === 200, `${consulta.status}`);

  const agendada = (await db.query(`SELECT * FROM "ClinicalEntry" WHERE id = $1`, [consulta.body?.id])).rows[0];
  check("fica gravada com hora e local", agendada?.time === "10:30" && agendada?.location === "ZZ Clínica");
  /*
   * O impacto de um agendamento é sempre NONE, mesmo que o cliente mande OUT:
   * uma consulta marcada para o fim do mês não pode pôr o atleta de baixa hoje.
   */
  check("e nunca afasta ninguém, mesmo pedindo OUT", agendada?.impact === "NONE", `${agendada?.impact}`);

  /*
   * A prova que faltava, e que era a queixa: **a consulta tem de voltar na
   * leitura**.
   *
   * Gravar nunca chegou a ser o problema todo. O `/api/athletes` trazia o
   * boletim filtrado a `impact != NONE` — e um agendamento tem `NONE` por
   * definição —, por isso a consulta ficava na base e desaparecia do ecrã. Do
   * lado do cliente era pior: o store deitava fora o boletim e fabricava uma
   * entrada a partir da restrição activa.
   */
  const boletim = await call(medica, "GET", "/api/athletes");
  const fichaDela = (boletim.body ?? []).find((a) => a.id === atleta.id);
  const entradas = fichaDela?.clinical ?? [];

  check("o boletim vem na resposta", Array.isArray(fichaDela?.clinical), JSON.stringify(fichaDela?.clinical));
  const aConsulta = entradas.find((e) => e.id === consulta.body.id);
  check("e a consulta agendada está lá", Boolean(aConsulta), JSON.stringify(entradas.map((e) => e.kind + "/" + e.status)));
  check("com o tipo certo", aConsulta?.kind === "nutrition", `${aConsulta?.kind}`);
  check("marcada como agendamento", aConsulta?.status === "scheduled", `${aConsulta?.status}`);
  check("com hora e local", aConsulta?.time === "10:30" && aConsulta?.location === "ZZ Clínica");

  /* O exame também — é `impact: NONE` e desaparecia pela mesma razão. */
  check("o exame também aparece", entradas.some((e) => e.id === exame.body.id), "o exame não voltou no boletim");

  /*
   * A fronteira da família — que não é a que parecia.
   *
   * A primeira versão deste bloco afirmava que a família **não** vê o boletim, e
   * falhou. Estava errada: `GUARDIAN` tem `clinical:read` de propósito — o pai é
   * o encarregado legal, e a app da família existe em parte para lhe mostrar as
   * consultas do filho (o formulário de agendamento diz-lhe "a família vê esta
   * nota"). Ver o boletim do próprio filho é a funcionalidade, não a fuga.
   *
   * A fuga seria ver o boletim do filho **de outra pessoa**, e isso é o âmbito
   * (`athleteIds`), não a permissão. É isso que se verifica.
   */
  const comoFamilia = await call(familia, "GET", "/api/athletes");
  const lista = comoFamilia.body ?? [];
  const vistoPeloPai = lista.find((a) => a.id === atleta.id);

  check("o pai vê o boletim do próprio filho", (vistoPeloPai?.clinical ?? []).length > 0, JSON.stringify(vistoPeloPai?.clinical?.length));
  check(
    "incluindo a consulta agendada, que é para ele ver",
    (vistoPeloPai?.clinical ?? []).some((e) => e.id === consulta.body.id),
  );

  /* E não vê mais ninguém — nem o boletim, nem o atleta. */
  const doClube = (await call(medica, "GET", "/api/athletes")).body ?? [];
  check("mas só vê os filhos dele", lista.length < doClube.length, `${lista.length} de ${doClube.length}`);
  check(
    "e nenhum atleta que não seja seu",
    lista.every((a) => (a.guardians ?? []).some((g) => g.email === "familia@lifeclub.pt")),
    JSON.stringify(lista.map((a) => a.name)),
  );

  console.log("\n=== Dar alta ===");
  const alta = await call(medica, "POST", `/api/clinical/${baixa.body.id}/alta`, { on: "2026-09-20" });
  check("a alta é aceite", alta.status === 201 || alta.status === 200, `${alta.status}`);

  const depoisDaAlta = await call(treinador, "GET", "/api/athletes");
  const jaApto = (depoisDaAlta.body ?? []).find((a) => a.id === atleta.id);
  check("e o atleta volta a apto para o treinador", jaApto?.availability === "available", `${jaApto?.availability}`);

  const reabrir = await call(medica, "POST", `/api/clinical/${baixa.body.id}/reabrir`);
  check("uma alta dada por engano desfaz-se", reabrir.status === 201 || reabrir.status === 200, `${reabrir.status}`);
  await call(medica, "POST", `/api/clinical/${baixa.body.id}/alta`, { on: "2026-09-20" });

  console.log("\n=== O que se apaga e o que não se apaga ===");
  const apagaAgendamento = await call(medica, "DELETE", `/api/clinical/${consulta.body.id}`);
  check("um agendamento desmarca-se", apagaAgendamento.status === 200, `${apagaAgendamento.status}`);
  const apagaHistorial = await call(medica, "DELETE", `/api/clinical/${baixa.body.id}`);
  check("um registo do que aconteceu não se apaga (400)", apagaHistorial.status === 400, `${apagaHistorial.status}`);

  console.log("\n=== Quem pode escrever ===");
  const porFamilia = await call(familia, "POST", `/api/athletes/${atleta.id}/clinical`, {
    kind: "NOTE", title: "ZZ Não devia", date: "2026-09-01",
  });
  check("um encarregado não escreve no boletim (403)", porFamilia.status === 403, `${porFamilia.status}`);

  /*
   * Um treinador não tem `clinical:write` — vê o estado, não escreve o boletim.
   * É a fronteira que faz `clinical:status` e `clinical:read` serem duas
   * permissões e não uma.
   */
  const porTreinador = await call(treinador, "POST", `/api/athletes/${atleta.id}/clinical`, {
    kind: "NOTE", title: "ZZ Também não", date: "2026-09-01",
  });
  check("um treinador também não (403)", porTreinador.status === 403, `${porTreinador.status}`);

  console.log("\n=== Datas ===");
  /* `@db.Date` com fuso a oeste grava o dia anterior se não se forçar UTC. */
  const diaCerto = (await db.query(
    `SELECT date::text AS d FROM "ClinicalEntry" WHERE id = $1`, [baixa.body.id],
  )).rows[0];
  check("a data gravada é a que foi escrita", diaCerto?.d === "2026-09-01", `${diaCerto?.d}`);

  const retomaAntes = await call(medica, "POST", `/api/athletes/${atleta.id}/clinical`, {
    kind: "INJURY", status: "DONE", impact: "OUT",
    date: "2026-09-10", expectedReturn: "2026-09-01", title: "ZZ Impossível",
  });
  check("uma retoma anterior ao registo é recusada (400)", retomaAntes.status === 400, `${retomaAntes.status}`);
} finally {
  console.log("\n=== Limpeza ===");
  await limpar();
  await db.query(
    `UPDATE "Athlete" SET "medicalValidUntil" = $2 WHERE id = $1`,
    [atleta.id, validadeOriginal],
  );
  const sobrou = Number((await db.query(
    `SELECT count(*) FROM "ClinicalEntry" WHERE title LIKE 'ZZ %'`,
  )).rows[0].count);
  check("não ficou lixo no boletim", sobrou === 0, `${sobrou}`);
  const reposta = (await db.query(`SELECT "medicalValidUntil" FROM "Athlete" WHERE id = $1`, [atleta.id])).rows[0];
  check(
    "e a validade do exame voltou ao que era",
    String(reposta?.medicalValidUntil) === String(validadeOriginal),
    `${reposta?.medicalValidUntil} vs ${validadeOriginal}`,
  );
  await db.end();
}

console.log(`\n${ok} passaram, ${bad} falharam`);
process.exit(bad === 0 ? 0 : 1);

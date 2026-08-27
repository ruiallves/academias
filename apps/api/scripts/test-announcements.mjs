#!/usr/bin/env node
/**
 * Comunicações via API.
 *
 * O que interessa: o público (a direção manda para Geral/Pais/Treinadores, o
 * treinador só para os pais das suas equipas), o **recorte por escalão** dentro
 * de "Pais", a criação de notificações por destinatário, a taxa de leitura, e a
 * validação de forma.
 *
 * Uso: node scripts/test-announcements.mjs
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
const API = "http://localhost:3000";

let ok = 0, bad = 0;
const check = (l, c, d = "") => { if (c) { ok++; console.log("  OK    " + l); } else { bad++; console.log("  FALHA " + l + (d ? " — " + d : "")); } };

const login = async (email) =>
  (await (await fetch(`${S}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: A, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "academia2026" }),
  })).json()).access_token;

const call = async (token, method, pathname, body) => {
  const r = await fetch(API + pathname, {
    method, headers: { Authorization: `Bearer ${token}`, "x-academy-slug": "life-club", ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};

const db = new pg.Client({ connectionString: env("MIGRATE_DATABASE_URL"), ssl: { rejectUnauthorized: false } });
await db.connect();
// Estado limpo — remove avisos de teste e as notificações que geraram.
const cleanup = async () => {
  const ids = (await db.query(`SELECT id FROM "Announcement" WHERE title LIKE 'ZZ Aviso%'`)).rows.map((r) => r.id);
  for (const id of ids) {
    await db.query(`DELETE FROM "Notification" WHERE payload->>'announcementId' = $1`, [id]);
  }
  await db.query(`DELETE FROM "Announcement" WHERE title LIKE 'ZZ Aviso%'`);
};
await cleanup();

const director = await login("direcao@lifeclub.pt");
const coach = await login("treinador@lifeclub.pt");
const parent = await login("familia@lifeclub.pt");

console.log("=== A direção comunica ===");
const geral = await call(director, "POST", "/api/announcements", { title: "ZZ Aviso Geral", body: "Fecho de agosto.", audience: "all" });
check("publica para toda a academia (201)", geral.status === 201 || geral.status === 200, JSON.stringify(geral.body).slice(0, 140));
check("o rótulo do público é 'Geral'", geral.body?.audience === "Geral");
check("chegou a alguém (reach > 0)", (geral.body?.reach ?? 0) > 0, `reach=${geral.body?.reach}`);

const paisDir = await call(director, "POST", "/api/announcements", { title: "ZZ Aviso Pais", body: "Reunião de pais.", audience: "guardians" });
check("publica para os pais (201)", paisDir.status === 201 && paisDir.body?.audience === "Pais", `${paisDir.status}`);
const treinadores = await call(director, "POST", "/api/announcements", { title: "ZZ Aviso Treinadores", body: "Reunião técnica.", audience: "coaches" });
check("publica para os treinadores (201)", treinadores.status === 201 && treinadores.body?.audience === "Treinadores", `${treinadores.status}`);

console.log("\n=== O treinador só fala com os pais ===");
const coachPais = await call(coach, "POST", "/api/announcements", { title: "ZZ Aviso Treino", body: "Sábado muda de hora.", audience: "guardians" });
check("o treinador publica para os pais (201)", coachPais.status === 201 || coachPais.status === 200, `${coachPais.status}`);
check("só os pais das suas equipas (reach > 0)", (coachPais.body?.reach ?? 0) > 0, `reach=${coachPais.body?.reach}`);
const coachGeral = await call(coach, "POST", "/api/announcements", { title: "ZZ Aviso NaoDeve", body: "x", audience: "all" });
check("o treinador não manda 'Geral' (403)", coachGeral.status === 403, `${coachGeral.status}`);
const coachTr = await call(coach, "POST", "/api/announcements", { title: "ZZ Aviso NaoDeve2", body: "x", audience: "coaches" });
check("o treinador não manda 'Treinadores' (403)", coachTr.status === 403, `${coachTr.status}`);

console.log("\n=== O escalão estreita os pais ===");
/*
 * A equipa com mais famílias — para o recorte ter a quem chegar. Sai da base e
 * não de um id escrito à mão: o seed muda, e um teste preso a um id morre com ele.
 */
const alvo = (await db.query(`
  SELECT t.id, t.name, count(DISTINCT gl."membershipId")::int AS n
  FROM "Team" t
  JOIN "TeamMembership" tm ON tm."teamId" = t.id
  JOIN "GuardianLink" gl ON gl."athleteId" = tm."athleteId"
  JOIN "Membership" m ON m.id = gl."membershipId" AND m."isActive"
  GROUP BY t.id, t.name
  ORDER BY n DESC
  LIMIT 1
`)).rows[0];

// Quantos avisos esta secção chega a publicar — a contagem da lista, mais abaixo,
// tem de saber contar com eles.
let publicadosAqui = 0;

if (!alvo) {
  console.log("  (sem equipas com famílias no seed — secção saltada)");
} else {
  const recorte = await call(director, "POST", "/api/announcements", {
    title: "ZZ Aviso Escalao", body: "Treino de sábado muda de campo.", audience: "guardians", teamIds: [alvo.id],
  });
  check("a direção publica só para um escalão (201)", recorte.status === 201 || recorte.status === 200, `${recorte.status}`);
  if (recorte.body?.id) publicadosAqui += 1;
  check("o rótulo nomeia o escalão", recorte.body?.audience === `Pais · ${alvo.name}`, `${recorte.body?.audience}`);
  check("chega a alguém, mas não a mais do que esse escalão",
    (recorte.body?.reach ?? 0) > 0 && recorte.body.reach <= alvo.n,
    `reach=${recorte.body?.reach} de ${alvo.n}`);
  check("nunca chega a mais gente do que 'Pais' sem recorte",
    (recorte.body?.reach ?? 0) <= (paisDir.body?.reach ?? 0),
    `${recorte.body?.reach} vs ${paisDir.body?.reach}`);

  // O recorte fica gravado: é o que o registo mostra e o que a app da família lê.
  const gravado = (await db.query(`SELECT audience FROM "Announcement" WHERE id = $1`, [recorte.body.id])).rows[0]?.audience;
  check("o escalão fica gravado na audiência", Array.isArray(gravado?.teamIds) && gravado.teamIds[0] === alvo.id, JSON.stringify(gravado));

  const comTodos = await call(director, "POST", "/api/announcements", {
    title: "ZZ Aviso Escalao Mau", body: "x", audience: "all", teamIds: [alvo.id],
  });
  check("escalão com público 'Geral' recusado (400)", comTodos.status === 400, `${comTodos.status}`);

  const inexistente = await call(director, "POST", "/api/announcements", {
    title: "ZZ Aviso Escalao Bad", body: "x", audience: "guardians", teamIds: ["tea_nao_existe"],
  });
  check("escalão desconhecido recusado (400)", inexistente.status === 400, `${inexistente.status}`);

  // Um escalão que não é do treinador: procura-se um fora do âmbito dele.
  const doTreinador = await call(coach, "GET", "/api/teams");
  const dele = new Set((Array.isArray(doTreinador.body) ? doTreinador.body : []).map((t) => t.id));
  const todas = await call(director, "GET", "/api/teams");
  const alheia = (Array.isArray(todas.body) ? todas.body : []).find((t) => !dele.has(t.id));
  if (!alheia) {
    console.log("  (o treinador tem todas as equipas — sem escalão alheio para testar)");
  } else {
    const foraDoAmbito = await call(coach, "POST", "/api/announcements", {
      title: "ZZ Aviso Escalao Alheio", body: "x", audience: "guardians", teamIds: [alheia.id],
    });
    check("o treinador não recorta para um escalão alheio (403)", foraDoAmbito.status === 403, `${foraDoAmbito.status}`);
  }
}

console.log("\n=== Quem não pode, não comunica ===");
const paiPost = await call(parent, "POST", "/api/announcements", { title: "ZZ Aviso Pai", body: "x", audience: "guardians" });
check("um encarregado não comunica (403)", paiPost.status === 403, `${paiPost.status}`);

console.log("\n=== Validação de forma ===");
const semTitulo = await call(director, "POST", "/api/announcements", { title: "Z", body: "corpo", audience: "all" });
check("título demasiado curto recusado (400)", semTitulo.status === 400, `${semTitulo.status}`);
const publicoInvalido = await call(director, "POST", "/api/announcements", { title: "ZZ Aviso Bad", body: "x", audience: "toda-a-gente" });
check("público inválido recusado (400)", publicoInvalido.status === 400, `${publicoInvalido.status}`);
const massAssign = await call(director, "POST", "/api/announcements", { title: "ZZ Aviso Extra", body: "x", audience: "all", academyId: "acd_outra", reach: 999 });
check("campos extra (academyId/reach) rejeitados", massAssign.status === 400, `${massAssign.status}`);

console.log("\n=== Ler e taxa de leitura ===");
const list = await call(director, "GET", "/api/announcements");
const mine = Array.isArray(list.body) ? list.body.filter((a) => a.title.startsWith("ZZ Aviso")) : [];
check("a leitura devolve os avisos publicados", mine.length === 4 + publicadosAqui, `${mine.length}`);
check("cada aviso traz autor e reach", mine.every((a) => a.authorName && typeof a.reach === "number"));

// Marca uma notificação como lida na base e confirma que a taxa sobe.
const geralId = geral.body.id;
await db.query(`UPDATE "Notification" SET "readAt" = now() WHERE payload->>'announcementId' = $1 AND "readAt" IS NULL AND id = (SELECT id FROM "Notification" WHERE payload->>'announcementId' = $1 LIMIT 1)`, [geralId]);
const list2 = await call(director, "GET", "/api/announcements");
const geralLido = list2.body.find((a) => a.id === geralId);
check("uma leitura conta na taxa (read >= 1)", (geralLido?.read ?? 0) >= 1, `read=${geralLido?.read}`);

console.log("\n=== Editar (e a notificação na app segue) ===");
const edit = await call(director, "PATCH", `/api/announcements/${geralId}`, { title: "ZZ Aviso Geral Editado", body: "Fecho de agosto — atualizado." });
check("a direção edita o aviso (200)", edit.status === 200, `${edit.status}`);
const notifTitle = (await db.query(`SELECT title FROM "Notification" WHERE payload->>'announcementId' = $1 LIMIT 1`, [geralId])).rows[0]?.title;
check("a notificação na app reflete a edição", notifTitle === "ZZ Aviso Geral Editado", notifTitle);
const coachEditDir = await call(coach, "PATCH", `/api/announcements/${geralId}`, { title: "ZZ Aviso Hack", body: "x" });
check("o treinador não edita um aviso da direção (403)", coachEditDir.status === 403, `${coachEditDir.status}`);
const coachEditOwn = await call(coach, "PATCH", `/api/announcements/${coachPais.body.id}`, { title: "ZZ Aviso Treino Editado", body: "Agora às 11h." });
check("o treinador edita o seu próprio aviso (200)", coachEditOwn.status === 200, `${coachEditOwn.status}`);

console.log("\n=== Eliminar (e a notificação na app desaparece) ===");
const paiDelete = await call(parent, "DELETE", `/api/announcements/${geralId}`);
check("um encarregado não elimina (403)", paiDelete.status === 403, `${paiDelete.status}`);
const coachDeleteDir = await call(coach, "DELETE", `/api/announcements/${geralId}`);
check("o treinador não elimina um aviso da direção (403)", coachDeleteDir.status === 403, `${coachDeleteDir.status}`);
const del = await call(director, "DELETE", `/api/announcements/${coachPais.body.id}`);
check("a direção elimina qualquer aviso (200)", del.status === 200, `${del.status}`);
const gone = await call(director, "GET", "/api/announcements");
check("o aviso eliminado sai da lista", Array.isArray(gone.body) && !gone.body.some((a) => a.id === coachPais.body.id));
const notifGone = (await db.query(`SELECT count(*)::int n FROM "Notification" WHERE payload->>'announcementId' = $1`, [coachPais.body.id])).rows[0].n;
check("as notificações na app do aviso eliminado desaparecem", notifGone === 0, `${notifGone}`);

console.log("\n=== Limpeza ===");
await cleanup();
await db.end();
console.log("  feito");

console.log(`\n${ok} passaram, ${bad} falharam`);
process.exit(bad === 0 ? 0 : 1);

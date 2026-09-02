#!/usr/bin/env node
/**
 * Presenças via API — e sobretudo: **ficam mesmo gravadas**.
 *
 * ## O bug que isto codifica
 *
 * O registo de presenças vivia inteiro num `Record` em memória do browser
 * (`lib/attendance.ts`). O treinador marcava as faltas, carregava em Guardar, via
 * a folha fechada — e ao recarregar a página estava tudo por registar outra vez.
 * Sem erro nenhum, porque não havia erro: **não existia endpoint de escrita**. O
 * `GET /api/sessions` já devolvia as presenças da base desde sempre; ninguém lá
 * punha nada.
 *
 * Por isso o primeiro teste desta suite é o que faltava: gravar, voltar a ler, e
 * exigir que esteja lá. É o equivalente ao recarregar da página.
 *
 * O resto é a fronteira do costume: a permissão (`attendance:write`), o âmbito
 * (um treinador fecha a folha das suas equipas), quem está de baixa não leva
 * falta, um atleta de outro escalão não entra na folha, e a distinção que dá
 * sentido a tudo — lista vazia é "estiveram todos", ausência de registo é
 * "ninguém verificou".
 *
 * Uso: node scripts/test-attendance.mjs
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
    headers: {
      Authorization: `Bearer ${token}`, "x-academy-slug": "life-club",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};

const db = new pg.Client({ connectionString: env("MIGRATE_DATABASE_URL"), ssl: { rejectUnauthorized: false } });
await db.connect();

/*
 * O treino deste teste é criado por ele — e a uma hora que mais nenhuma suite
 * usa. Reaproveitar um treino semeado punha esta suite a reescrever presenças
 * que outro teste tinha acabado de gravar, e a falhar por ordem de execução.
 */
const QUANDO = "2026-11-12T18:00:00.000Z";
const ATE = "2026-11-12T19:30:00.000Z";
await db.query(`DELETE FROM "TrainingSession" WHERE "startsAt" = $1`, [QUANDO]);
// Uma baixa deste teste que tenha ficado para trás — senão o atleta fica parado
// para sempre e a suite seguinte apanha-o de baixa sem perceber porquê.
await db.query(`DELETE FROM "ClinicalEntry" WHERE detail = 'ZZ teste de presenças'`);

const director = await login("direcao@lifeclub.pt");
const coach = await login("treinador@lifeclub.pt");
const adjunto = await login("adjunto@lifeclub.pt");
const parent = await login("familia@lifeclub.pt");

/* O treino, e o plantel com que se vai trabalhar. */
const criado = await call(director, "POST", "/api/events", {
  kind: "TRAINING", title: "ZZ Treino Presenças", teamId: "t_sub11",
  startsAt: QUANDO, endsAt: ATE, venue: "Campo 1",
});
const treinoId = criado.body?.events?.[0]?.id;
check("treino criado para o teste", Boolean(treinoId), JSON.stringify(criado.body).slice(0, 140));

const plantel = (await call(coach, "GET", "/api/athletes")).body.filter((a) => a.teamId === "t_sub11" || a.teams?.some?.((t) => t.teamId === "t_sub11"));
const doSub11 = (await db.query(
  `SELECT a.id, a.name FROM "Athlete" a
     JOIN "TeamMembership" tm ON tm."athleteId" = a.id
    WHERE tm."teamId" = 't_sub11' AND a.status <> 'LEFT' ORDER BY a.name LIMIT 3`,
)).rows;
check("o Sub-11 tem plantel para testar", doSub11.length >= 2, `${doSub11.length} atletas`);

const janela = `?from=${QUANDO}&to=${ATE}`;
const lerTreino = async (token) =>
  (await call(token, "GET", "/api/sessions" + janela)).body?.find((s) => s.id === treinoId);

console.log("=== Antes de registar ===");
const antes = await lerTreino(coach);
check("o treino nasce por registar", antes?.recorded === false, JSON.stringify(antes?.recorded));
check("e sem faltas nenhumas", (antes?.absences ?? []).length === 0);

console.log("\n=== Gravar e voltar a ler (o bug) ===");
const gravar = await call(coach, "PUT", `/api/sessions/${treinoId}/attendance`, {
  absences: [
    { athleteId: doSub11[0].id, kind: "absent" },
    { athleteId: doSub11[1].id, kind: "justified", note: "Consulta médica" },
  ],
});
check("o treinador fecha a folha da sua equipa", gravar.status === 200, `${gravar.status} ${JSON.stringify(gravar.body).slice(0, 120)}`);

/*
 * Uma leitura nova, com um pedido novo — é o que a página faz ao recarregar.
 * Era exactamente aqui que o produto perdia tudo.
 */
const depois = await lerTreino(coach);
check("o treino passa a registado", depois?.recorded === true, JSON.stringify(depois?.recorded));
check("as duas faltas sobrevivem à releitura", (depois?.absences ?? []).length === 2, JSON.stringify(depois?.absences));
check(
  "a falta seca fica ABSENT",
  depois?.absences?.find((a) => a.athleteId === doSub11[0].id)?.status === "ABSENT",
);
const justificada = depois?.absences?.find((a) => a.athleteId === doSub11[1].id);
check("a justificada fica JUSTIFIED", justificada?.status === "JUSTIFIED");
check("e o motivo vem com ela", justificada?.note === "Consulta médica", JSON.stringify(justificada?.note));

/* A base, não só a API: é onde a assiduidade vai buscar os números. */
const naBase = await db.query(`SELECT status, note FROM "AttendanceRecord" WHERE "sessionId" = $1 ORDER BY status`, [treinoId]);
check("estão mesmo gravadas na base", naBase.rows.length === 2, `${naBase.rows.length} linhas`);
const fechado = await db.query(`SELECT "attendanceClosedAt", status FROM "TrainingSession" WHERE id = $1`, [treinoId]);
check("a folha fica marcada como fechada", fechado.rows[0]?.attendanceClosedAt !== null);
check("e o treino passa a realizado", fechado.rows[0]?.status === "DONE", fechado.rows[0]?.status);

console.log("\n=== Corrigir substitui, não acumula ===");
const corrigir = await call(coach, "PUT", `/api/sessions/${treinoId}/attendance`, {
  absences: [{ athleteId: doSub11[0].id, kind: "late" }],
});
check("gravar outra vez é aceite", corrigir.status === 200, `${corrigir.status}`);
const corrigido = await lerTreino(coach);
check("fica só a falta nova", (corrigido?.absences ?? []).length === 1, JSON.stringify(corrigido?.absences));
check("com o estado corrigido", corrigido?.absences?.[0]?.status === "LATE");
const orfas = await db.query(`SELECT count(*)::int AS n FROM "AttendanceRecord" WHERE "sessionId" = $1`, [treinoId]);
check("e não sobrou lixo da gravação anterior", orfas.rows[0].n === 1, `${orfas.rows[0].n} linhas`);

console.log("\n=== Lista vazia é 'estiveram todos' ===");
const todos = await call(coach, "PUT", `/api/sessions/${treinoId}/attendance`, { absences: [] });
check("uma folha sem faltas é aceite", todos.status === 200, `${todos.status}`);
const semFaltas = await lerTreino(coach);
check("continua registado (≠ por verificar)", semFaltas?.recorded === true);
check("e sem faltas nenhumas", (semFaltas?.absences ?? []).length === 0);

console.log("\n=== Permissão e âmbito ===");
const porPai = await call(parent, "PUT", `/api/sessions/${treinoId}/attendance`, { absences: [] });
check("um encarregado não regista presenças (403)", porPai.status === 403, `${porPai.status}`);

/*
 * A "equipa de outro" descobre-se, não se escreve à mão.
 *
 * A primeira versão pediu "uma equipa que não seja o t_sub11" e apanhou o
 * t_sub13 — que o **adjunto** também treina. O 403 não veio, e por um segundo
 * pareceu uma fronteira a falhar quando era o teste a apontar ao sítio errado.
 *
 * Agora a equipa sai da negação do `TeamStaff` de quem vai tentar: é alheia por
 * construção, e continua a sê-lo no dia em que a semeadura mudar de mãos. O
 * `quemTenta` é escolhido pela mesma regra — o primeiro dos dois treinadores
 * semeados a quem sobre uma equipa que não é dele.
 */
const alheiaPara = async (email) =>
  (await db.query(
    `SELECT t.id FROM "Team" t
      WHERE t."academyId" = (SELECT id FROM "Academy" WHERE slug = 'life-club')
        AND t.id NOT IN (
          SELECT ts."teamId" FROM "TeamStaff" ts
            JOIN "Membership" m ON m.id = ts."membershipId"
            JOIN "User" u ON u.id = m."userId"
           WHERE u.email = $1
        )
      LIMIT 1`,
    [email],
  )).rows[0]?.id;

const candidatos = [
  ["treinador@lifeclub.pt", coach],
  ["adjunto@lifeclub.pt", adjunto],
];
let outraEquipa = null;
let quemTenta = null;
for (const [email, token] of candidatos) {
  const encontrada = await alheiaPara(email);
  if (encontrada) {
    outraEquipa = encontrada;
    quemTenta = token;
    break;
  }
}
check("há um treinador com uma equipa alheia para testar a fronteira", Boolean(outraEquipa));
if (outraEquipa) {
  await db.query(`DELETE FROM "TrainingSession" WHERE "startsAt" = '2026-11-12T20:00:00.000Z'`);
  const alheio = await call(director, "POST", "/api/events", {
    kind: "TRAINING", title: "ZZ Treino Alheio", teamId: outraEquipa,
    startsAt: "2026-11-12T20:00:00.000Z", endsAt: "2026-11-12T21:30:00.000Z", venue: "Campo 2",
  });
  const alheioId = alheio.body?.events?.[0]?.id;
  const tentativa = await call(quemTenta, "PUT", `/api/sessions/${alheioId}/attendance`, { absences: [] });
  check("um treinador não fecha a folha de outra equipa (403)", tentativa.status === 403, `${tentativa.status}`);
  await db.query(`DELETE FROM "TrainingSession" WHERE id = $1`, [alheioId]);
}

console.log("\n=== O que o servidor recusa ===");
const deOutroEscalao = (await db.query(
  `SELECT a.id FROM "Athlete" a
     JOIN "TeamMembership" tm ON tm."athleteId" = a.id
    WHERE tm."teamId" <> 't_sub11'
      AND a.id NOT IN (SELECT "athleteId" FROM "TeamMembership" WHERE "teamId" = 't_sub11')
    LIMIT 1`,
)).rows[0]?.id;
if (deOutroEscalao) {
  const forasteiro = await call(coach, "PUT", `/api/sessions/${treinoId}/attendance`, {
    absences: [{ athleteId: deOutroEscalao, kind: "absent" }],
  });
  check("um atleta de outro escalão não entra na folha (400)", forasteiro.status === 400, `${forasteiro.status}`);
}

const invalido = await call(coach, "PUT", `/api/sessions/${treinoId}/attendance`, {
  absences: [{ athleteId: doSub11[0].id, kind: "presente" }],
});
check("um estado inventado é recusado (400)", invalido.status === 400, `${invalido.status}`);

/* Uma baixa activa é um impedimento, não uma falta — a mesma regra da convocatória. */
await db.query(
  `INSERT INTO "ClinicalEntry" (id, "academyId", "athleteId", kind, status, impact, title, detail, date, "createdAt", "updatedAt")
   VALUES ($1, (SELECT id FROM "Academy" WHERE slug = 'life-club'), $2, 'INJURY', 'DONE', 'OUT', 'ZZ Lesão', 'ZZ teste de presenças', current_date, now(), now())`,
  [`zz_att_${Date.now()}`, doSub11[0].id],
);
const comBaixa = await call(coach, "PUT", `/api/sessions/${treinoId}/attendance`, {
  absences: [{ athleteId: doSub11[0].id, kind: "absent" }],
});
check("quem está de baixa não leva falta (400)", comBaixa.status === 400, `${comBaixa.status}`);
check("e o erro diz de quem se trata", String(comBaixa.body?.message ?? "").includes(doSub11[0].name.split(" ")[0]), String(comBaixa.body?.message).slice(0, 120));
await db.query(`DELETE FROM "ClinicalEntry" WHERE detail = 'ZZ teste de presenças'`);

console.log("\n=== O que a família e os outros vêem ===");
const paiVe = (await call(parent, "GET", "/api/sessions" + janela)).body?.find((s) => s.id === treinoId);
check("o pai vê o treino do educando", Boolean(paiVe), "não veio na lista");

/* Limpeza. */
await db.query(`DELETE FROM "TrainingSession" WHERE "startsAt" = $1`, [QUANDO]);
await db.end();

console.log(`\n${ok} OK · ${bad} falhas`);
process.exit(bad === 0 ? 0 : 1);

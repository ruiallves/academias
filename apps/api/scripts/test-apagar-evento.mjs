#!/usr/bin/env node
/**
 * Apagar um jogo ou um treino leva as estatísticas com ele, e mais nada.
 *
 * Corre contra Postgres a sério (PGlite, WASM): sem Docker, sem servidor, sem
 * tocar em base nenhuma que exista. Aplica as migrações todas e faz os mesmos
 * comandos que `AcademyService.cancelarVarios` faz ao apagar com os dados
 * (o registo no `AuditLog` e o `DELETE`).
 *
 * O que se confirma, e porquê:
 *
 *  1. **a estrutura**: todas as tabelas que apontam para `Match`,
 *     `TrainingSession` ou `CalendarEvent` apagam em cascata ou ficam a nulo.
 *     As que ficam a nulo são as que não são estatística (o dinheiro e a
 *     análise de vídeo). Uma tabela nova que aponte para um jogo sem cascata
 *     faz este teste falhar: é aí que uma estatística ficaria órfã;
 *  2. a ficha, a convocatória, o plano, os relatórios e a equipa técnica do
 *     jogo desaparecem;
 *  3. os números do atleta (calculados das fichas, como na consola) deixam de
 *     contar o jogo apagado e continuam a contar os outros;
 *  4. as presenças, os avisos de falta e o plano do treino desaparecem, e a
 *     assiduidade do atleta deixa de o contar;
 *  5. os movimentos nas Contas ficam (o dinheiro existiu), sem ligação;
 *  6. o `AuditLog` guarda o que se apagou, e sobrevive ao jogo.
 *
 * Uso: node scripts/test-apagar-evento.mjs
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = path.join(HERE, "..", "prisma", "migrations");

/** O que o PGlite não corre e que nada tem a ver com o que aqui se testa. */
const sanitize = (sql) =>
  sql
    .replace(/CREATE EXTENSION[^;]*btree_gist[^;]*;/gi, "-- [btree_gist ignorado no PGlite]")
    .replace(
      /ALTER TABLE\s+"TrainingCycle"\s+ADD CONSTRAINT\s+"[^"]*_sem_sobreposicao"[\s\S]*?;/gi,
      "-- [EXCLUDE ignorado]",
    );

const db = new PGlite();
let passed = 0;
let failed = 0;
const check = (label, ok, detail = "") => {
  if (ok) {
    passed++;
    console.log(`  ok    ${label}`);
  } else {
    failed++;
    console.log(`  FALHA ${label}${detail ? ` — ${detail}` : ""}`);
  }
};

async function migrar() {
  for (const dir of readdirSync(MIGRATIONS).sort()) {
    let sql;
    try {
      sql = readFileSync(path.join(MIGRATIONS, dir, "migration.sql"), "utf8");
    } catch {
      continue;
    }
    try {
      await db.exec(sanitize(sql));
    } catch (e) {
      console.error(`!! migração ${dir}: ${e.message}`);
      throw e;
    }
  }
}

const uma = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const todas = async (sql, params = []) => (await db.query(sql, params)).rows;

/* -------------------------------------------------------------------------- */
/* Criar linhas sem escrever cada coluna obrigatória à mão                     */
/* -------------------------------------------------------------------------- */

let seq = 0;
const novoId = (p) => `${p}_${(++seq).toString(36)}`;
let ACADEMIA = null;

/**
 * Insere uma linha em `tabela` com `valores`, e preenche sozinho o resto do que
 * é obrigatório: `academyId` com a academia do teste, as chaves estrangeiras
 * criando a linha que falta, e o resto com um valor do tipo certo. Assim o
 * teste não parte quando uma migração junta uma coluna obrigatória nova.
 */
async function criar(tabela, valores = {}) {
  const colunas = await todas(
    `SELECT column_name, data_type, udt_name, is_nullable, column_default
       FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`,
    [tabela],
  );
  if (colunas.length === 0) throw new Error(`Tabela ${tabela} não existe`);
  const fks = await todas(
    `SELECT a.attname AS col, ref.relname AS ref
       FROM pg_constraint c
       JOIN pg_class t ON t.oid = c.conrelid
       JOIN pg_class ref ON ref.oid = c.confrelid
       JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
      WHERE c.contype = 'f' AND t.relname = $1`,
    [tabela],
  );
  const fkDe = new Map(fks.map((f) => [f.col, f.ref]));
  const linha = { ...valores };

  for (const c of colunas) {
    const nome = c.column_name;
    if (nome in linha) continue;
    if (c.is_nullable === "YES" || c.column_default !== null) continue;
    if (nome === "id") linha.id = novoId(tabela.toLowerCase());
    else if (nome === "academyId" && ACADEMIA) linha.academyId = ACADEMIA;
    else if (fkDe.has(nome)) linha[nome] = await criar(fkDe.get(nome));
    else if (c.data_type === "ARRAY") linha[nome] = [];
    else if (c.data_type === "USER-DEFINED") {
      const e = await uma(
        `SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
          WHERE t.typname = $1 ORDER BY e.enumsortorder LIMIT 1`,
        [c.udt_name],
      );
      linha[nome] = e?.enumlabel ?? null;
    } else if (/int|numeric|double|real/.test(c.data_type)) linha[nome] = 0;
    else if (c.data_type === "boolean") linha[nome] = false;
    else if (/timestamp|date/.test(c.data_type)) linha[nome] = new Date();
    else if (/json/.test(c.data_type)) linha[nome] = {};
    else linha[nome] = `${nome}-${novoId("v")}`;
  }

  const nomes = Object.keys(linha);
  const tipos = new Map(colunas.map((c) => [c.column_name, c]));
  const valoresSql = nomes.map((n) => {
    const v = linha[n];
    const c = tipos.get(n);
    if (c && /json/.test(c.data_type) && v !== null) return JSON.stringify(v);
    return v;
  });
  const marcas = nomes.map((n, i) => {
    const c = tipos.get(n);
    return c?.data_type === "USER-DEFINED" ? `$${i + 1}::"${c.udt_name}"` : `$${i + 1}`;
  });
  await db.query(
    `INSERT INTO "${tabela}" (${nomes.map((n) => `"${n}"`).join(", ")}) VALUES (${marcas.join(", ")})`,
    valoresSql,
  );
  return linha.id;
}

/** Os números do atleta, como a consola os calcula: das fichas e das folhas de presença. */
async function numerosDo(atleta) {
  const j = await uma(
    `SELECT count(*)::int AS jogos, coalesce(sum(tally), 0)::int AS golos, coalesce(sum(minutes), 0)::int AS minutos
       FROM "MatchAppearance" WHERE "athleteId" = $1`,
    [atleta],
  );
  const p = await uma(`SELECT count(*)::int AS presencas FROM "AttendanceRecord" WHERE "athleteId" = $1`, [atleta]);
  return { ...j, ...p };
}

async function main() {
  await migrar();

  /* ---------------------------------------------------------------------- */
  /* 1. A estrutura                                                          */
  /* ---------------------------------------------------------------------- */

  console.log("\nA estrutura: o que aponta para um evento");
  const ligacoes = await todas(
    `SELECT t.relname AS tabela, ref.relname AS evento, a.attname AS coluna, c.confdeltype AS regra
       FROM pg_constraint c
       JOIN pg_class t ON t.oid = c.conrelid
       JOIN pg_class ref ON ref.oid = c.confrelid
       JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
      WHERE c.contype = 'f' AND ref.relname IN ('Match', 'TrainingSession', 'CalendarEvent')
      ORDER BY ref.relname, t.relname`,
  );
  /*
   * Ficam a nulo, de propósito, as que não são estatística: o dinheiro existiu
   * e a análise de vídeo apaga-se pelo caminho dela (ficheiros e worker). E
   * travam, de propósito, as compras de bilhetes: o serviço recusa apagar um
   * jogo com compras antes de chegar ao DELETE.
   */
  const ANULAM = new Set(["FinancialTransaction", "AIAnalysis"]);
  const TRAVAM = new Set(["TicketOrder"]);
  for (const l of ligacoes) {
    const esperado = ANULAM.has(l.tabela) ? "n" : TRAVAM.has(l.tabela) ? "r" : "c";
    const nomeRegra = { c: "apaga em cascata", n: "fica a nulo", r: "trava", a: "trava (NO ACTION)" }[l.regra] ?? l.regra;
    check(
      `${l.tabela}.${l.coluna} → ${l.evento}: ${nomeRegra}`,
      l.regra === esperado || (esperado === "r" && l.regra === "a"),
      `esperava ${{ c: "cascata", n: "nulo", r: "travar" }[esperado]}`,
    );
  }

  /* ---------------------------------------------------------------------- */
  /* O cenário                                                               */
  /* ---------------------------------------------------------------------- */

  ACADEMIA = await criar("Academy", { id: "ac1", slug: "clube-teste", name: "Clube de Teste" });
  const equipa = await criar("Team", { name: "Sub-13" });
  const ana = await criar("Athlete", { name: "Ana" });
  const rui = await criar("Athlete", { name: "Rui" });

  const engano = await criar("Match", {
    teamId: equipa,
    opponent: "Clube Engano",
    startsAt: new Date("2026-10-18T10:00:00Z"),
    endsAt: new Date("2026-10-18T11:30:00Z"),
    status: "PLAYED",
    ourScore: 3,
    theirScore: 1,
  });
  const outro = await criar("Match", {
    teamId: equipa,
    opponent: "Clube Certo",
    startsAt: new Date("2026-10-11T10:00:00Z"),
    endsAt: new Date("2026-10-11T11:30:00Z"),
    status: "PLAYED",
    ourScore: 1,
    theirScore: 0,
  });

  // A ficha do jogo por engano: a Ana marcou 2 em 60 minutos, o Rui jogou 30.
  await criar("MatchAppearance", { matchId: engano, athleteId: ana, minutes: 60, tally: 2, assists: 1, yellowCards: 1 });
  await criar("MatchAppearance", { matchId: engano, athleteId: rui, minutes: 30, tally: 0 });
  await criar("MatchCallUp", { matchId: engano, athleteId: ana });
  await criar("MatchCallUp", { matchId: engano, athleteId: rui });
  await criar("MatchPlan", { matchId: engano });
  await criar("MatchReport", { matchId: engano });
  await criar("OpponentReport", { matchId: engano });
  await criar("MatchStaff", { matchId: engano });
  const dinheiroJogo = await criar("FinancialTransaction", { matchId: engano });

  // O jogo certo: a Ana marcou 1 em 70 minutos. Este tem de ficar.
  await criar("MatchAppearance", { matchId: outro, athleteId: ana, minutes: 70, tally: 1 });

  const treino = await criar("TrainingSession", {
    teamId: equipa,
    startsAt: new Date("2026-10-15T18:00:00Z"),
    endsAt: new Date("2026-10-15T19:30:00Z"),
  });
  const treinoCerto = await criar("TrainingSession", {
    teamId: equipa,
    startsAt: new Date("2026-10-13T18:00:00Z"),
    endsAt: new Date("2026-10-13T19:30:00Z"),
  });
  await criar("AttendanceRecord", { sessionId: treino, athleteId: ana });
  await criar("AttendanceRecord", { sessionId: treino, athleteId: rui });
  await criar("AttendanceRecord", { sessionId: treinoCerto, athleteId: ana });
  await criar("AbsenceNotice", { sessionId: treino, athleteId: rui });
  await criar("SessionBlock", { sessionId: treino });
  const dinheiroTreino = await criar("FinancialTransaction", { trainingSessionId: treino });

  const antes = await numerosDo(ana);
  console.log("\nAntes de apagar");
  check(`a Ana tem 2 jogos, 3 golos e 130 minutos`, antes.jogos === 2 && antes.golos === 3 && antes.minutos === 130, JSON.stringify(antes));
  check(`a Ana tem 2 presenças`, antes.presencas === 2, JSON.stringify(antes));

  /* ---------------------------------------------------------------------- */
  /* O que o serviço faz, pela mesma ordem: o registo e depois o DELETE      */
  /* ---------------------------------------------------------------------- */

  for (const [tipo, id] of [["match", engano], ["training", treino]]) {
    await db.query(
      `INSERT INTO "AuditLog" ("id", "action", "targetType", "targetId", "detail", "ip", "createdAt")
       VALUES ($1, 'event.deleted_with_data', $2, $3, $4::jsonb, NULL, now())`,
      [novoId("evd"), tipo, id, JSON.stringify({ academyId: ACADEMIA, perdas: ["teste"] })],
    );
  }
  await db.query(`DELETE FROM "TrainingSession" WHERE id = ANY($1)`, [[treino]]);
  await db.query(`DELETE FROM "Match" WHERE id = ANY($1)`, [[engano]]);

  /* ---------------------------------------------------------------------- */
  /* O que ficou                                                             */
  /* ---------------------------------------------------------------------- */

  console.log("\nO jogo apagado");
  for (const tabela of ["MatchAppearance", "MatchCallUp", "MatchPlan", "MatchReport", "OpponentReport", "MatchStaff"]) {
    const { n } = await uma(`SELECT count(*)::int AS n FROM "${tabela}" WHERE "matchId" = $1`, [engano]);
    check(`${tabela}: nada do jogo apagado`, n === 0, `ficaram ${n}`);
  }
  // Todas as tabelas em cascata, e não só as que este cenário encheu.
  for (const l of ligacoes.filter((x) => x.regra === "c")) {
    const id = l.evento === "Match" ? engano : l.evento === "TrainingSession" ? treino : null;
    if (!id) continue;
    const { n } = await uma(`SELECT count(*)::int AS n FROM "${l.tabela}" WHERE "${l.coluna}" = $1`, [id]);
    check(`${l.tabela}: nenhuma linha aponta para o ${l.evento === "Match" ? "jogo" : "treino"} apagado`, n === 0, `ficaram ${n}`);
  }

  const depois = await numerosDo(ana);
  console.log("\nOs números dos atletas");
  check(`a Ana passa a 1 jogo, 1 golo e 70 minutos (só o jogo certo)`, depois.jogos === 1 && depois.golos === 1 && depois.minutos === 70, JSON.stringify(depois));
  const doRui = await numerosDo(rui);
  check(`o Rui fica sem jogos e sem presenças`, doRui.jogos === 0 && doRui.presencas === 0, JSON.stringify(doRui));
  check(`a Ana passa a 1 presença (só o treino certo)`, depois.presencas === 1, JSON.stringify(depois));
  const certo = await uma(`SELECT "ourScore", status FROM "Match" WHERE id = $1`, [outro]);
  check(`o jogo certo continua lá, com o resultado`, certo?.ourScore === 1 && certo?.status === "PLAYED");

  console.log("\nO treino apagado");
  for (const tabela of ["AttendanceRecord", "AbsenceNotice", "SessionBlock"]) {
    const { n } = await uma(`SELECT count(*)::int AS n FROM "${tabela}" WHERE "sessionId" = $1`, [treino]);
    check(`${tabela}: nada do treino apagado`, n === 0, `ficaram ${n}`);
  }

  console.log("\nO que fica de propósito");
  const mj = await uma(`SELECT "matchId" FROM "FinancialTransaction" WHERE id = $1`, [dinheiroJogo]);
  check(`o movimento do jogo fica nas Contas, sem ligação`, mj !== undefined && mj.matchId === null, JSON.stringify(mj));
  const mt = await uma(`SELECT "trainingSessionId" FROM "FinancialTransaction" WHERE id = $1`, [dinheiroTreino]);
  check(`o movimento do treino fica nas Contas, sem ligação`, mt !== undefined && mt.trainingSessionId === null, JSON.stringify(mt));
  const { n: registos } = await uma(
    `SELECT count(*)::int AS n FROM "AuditLog" WHERE action = 'event.deleted_with_data' AND "targetId" = ANY($1)`,
    [[engano, treino]],
  );
  check(`o AuditLog guarda os dois apagados`, registos === 2, `${registos}`);

  console.log(`\n${passed} ok, ${failed} falhas`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * A bilheteira na base de dados, numa base descartável (PGlite).
 *
 * As regras puras provam-se em `test:bilheteira`; isto prova o que só a base
 * garante, com Postgres a sério e sem tocar na base de produção:
 *
 *   1. um clube não lê nem escreve as compras, os bilhetes, os lugares anuais,
 *      os acessos dos seguranças e as leituras de outro clube (RLS);
 *   2. o webhook da euPago encontra o clube de um pagamento de bilhetes
 *      (`app.resolve_payment_academy`), e só esse;
 *   3. a lotação conta o que deve: bilhetes pagos e guardados dentro do prazo,
 *      e não os expirados nem os anulados (a mesma consulta de `contexto.ts`);
 *   4. a ligação da app pode bloquear a venda de um jogo (`FOR UPDATE`);
 *   5. dois seguranças com o mesmo bilhete: só o primeiro o marca;
 *   6. um lugar anual entra uma vez por jogo, mesmo lido em duas portas ao
 *      mesmo tempo (o índice único e o `ON CONFLICT DO NOTHING` do leitor).
 *
 * Uso: npm run test:bilheteira-base
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = path.join(HERE, "..", "prisma", "migrations");

const sanitize = (sql) =>
  sql
    .replace(/CREATE EXTENSION[^;]*btree_gist[^;]*;/gi, "-- [btree_gist ignorado no PGlite]")
    .replace(/ALTER TABLE\s+"TrainingCycle"\s+ADD CONSTRAINT\s+"[^"]*_sem_sobreposicao"[\s\S]*?;/gi, "-- [EXCLUDE ignorado]");

const db = new PGlite();
let passed = 0;
let failed = 0;
const check = (label, ok, detail = "") => {
  if (ok) {
    passed++;
    console.log(`  OK   ${label}`);
  } else {
    failed++;
    console.log(`  FALHA ${label}${detail ? ` — ${detail}` : ""}`);
  }
};

/** Corre `sql` como a ligação da app, com o clube `academyId` (ou nenhum). */
async function comoApp(academyId, sql, params = []) {
  await db.exec("BEGIN");
  try {
    await db.exec("SET LOCAL ROLE academia_app");
    if (academyId) await db.query("SELECT set_config('app.academy_id', $1, true)", [academyId]);
    const r = await db.query(sql, params);
    await db.exec("COMMIT");
    return { rows: r.rows, affected: r.affectedRows ?? 0 };
  } catch (e) {
    await db.exec("ROLLBACK");
    return { error: e.message };
  }
}

/**
 * Insere uma linha como dono da base (sem RLS), preenchendo sozinho as
 * colunas obrigatórias sem valor por omissão que o teste não deu. Os testes
 * só querem dizer o que importa a cada caso.
 */
const colunasObrigatorias = new Map();
async function inserir(tabela, valores) {
  if (!colunasObrigatorias.has(tabela)) {
    const r = await db.query(
      `SELECT c.column_name AS nome, c.data_type AS tipo, c.udt_name AS udt
         FROM information_schema.columns c
        WHERE c.table_schema = 'public' AND c.table_name = $1 AND c.is_nullable = 'NO' AND c.column_default IS NULL`,
      [tabela],
    );
    colunasObrigatorias.set(tabela, r.rows);
  }
  const linha = { ...valores };
  for (const c of colunasObrigatorias.get(tabela)) {
    if (c.nome in linha) continue;
    if (c.tipo === "text" || c.tipo === "character varying") linha[c.nome] = `${c.nome}-${randomUUID().slice(0, 8)}`;
    else if (c.tipo === "integer" || c.tipo === "bigint" || c.tipo === "double precision" || c.tipo === "numeric") linha[c.nome] = 0;
    else if (c.tipo === "boolean") linha[c.nome] = false;
    else if (c.tipo.startsWith("timestamp") || c.tipo === "date") linha[c.nome] = new Date();
    else if (c.tipo === "jsonb") linha[c.nome] = "{}";
    else if (c.tipo === "ARRAY") linha[c.nome] = "{}";
    else if (c.tipo === "USER-DEFINED") {
      const e = await db.query(`SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = $1 ORDER BY e.enumsortorder LIMIT 1`, [c.udt]);
      linha[c.nome] = e.rows[0]?.enumlabel;
    }
  }
  const nomes = Object.keys(linha);
  await db.query(
    `INSERT INTO "${tabela}" (${nomes.map((n) => `"${n}"`).join(", ")}) VALUES (${nomes.map((_, i) => `$${i + 1}`).join(", ")})`,
    nomes.map((n) => linha[n]),
  );
  return linha;
}

/** A consulta da lotação, igual à de `ocupadosPorBancada` em `src/bilheteira/contexto.ts`. */
const OCUPADOS = `
  SELECT t."bancadaId" AS "bancadaId", count(*)::int AS n
    FROM "MatchTicket" t
    JOIN "TicketOrder" o ON o.id = t."orderId"
   WHERE t."matchId" = $1
     AND t.status <> 'VOID'
     AND (o.status = 'PAID' OR (o.status = 'RESERVED' AND o."reservedUntil" > $2))
     AND o.id <> $3
   GROUP BY t."bancadaId"`;

async function main() {
  console.log("A aplicar migrações a uma base descartável (PGlite)…");
  for (const dir of readdirSync(MIGRATIONS).sort()) {
    let sql;
    try {
      sql = readFileSync(path.join(MIGRATIONS, dir, "migration.sql"), "utf8");
    } catch {
      continue;
    }
    await db.exec(sanitize(sql));
  }

  /* -------------------------------------------------------------- os dados */
  const A = "acad-a";
  const B = "acad-b";
  for (const id of [A, B]) await inserir("Academy", { id, slug: id, name: id });
  const epoca = await inserir("Season", { id: "epoca-a", academyId: A, label: "2026/27", startsOn: new Date("2026-08-01"), endsOn: new Date("2027-07-31") });
  const sport = await inserir("Sport", { id: "sport-a", academyId: A, name: "Futebol" });
  const equipa = await inserir("Team", { id: "team-a", academyId: A, seasonId: epoca.id, sportId: sport.id, name: "Seniores" });
  const jogo = await inserir("Match", {
    id: "jogo-a",
    academyId: A,
    teamId: equipa.id,
    startsAt: new Date(Date.now() + 7 * 86_400_000),
    endsAt: new Date(Date.now() + 7 * 86_400_000 + 7_200_000),
    venue: "Estádio",
    opponent: "Visitante",
    isHome: true,
  });
  await inserir("SiteMatchTickets", { matchId: jogo.id, academyId: A, open: true, venueId: "estadio", types: "[]" });
  const socio = await inserir("Member", { id: "socio-a", academyId: A, name: "Sócio A", number: 12 });

  const agora = new Date();
  const futuro = new Date(Date.now() + 5 * 60_000);
  const passado = new Date(Date.now() - 5 * 60_000);
  const compra = async (id, status, reservedUntil) =>
    inserir("TicketOrder", { id, academyId: A, matchId: jogo.id, status, buyerName: "X", buyerEmail: "x@x.pt", totalCents: 1000, reservedUntil, accessToken: `tok-${id}` });
  const bilhete = async (id, orderId, bancadaId, status = "VALID") =>
    inserir("MatchTicket", { id, academyId: A, orderId, matchId: jogo.id, typeId: "t", typeName: "T", bancadaId, priceCents: 1000, status });

  await compra("o-paga", "PAID", passado);
  await bilhete("b1", "o-paga", "norte");
  await bilhete("b2", "o-paga", "norte");
  await bilhete("b-anulado", "o-paga", "norte", "VOID");
  await compra("o-guardada", "RESERVED", futuro);
  await bilhete("b3", "o-guardada", "norte");
  await compra("o-caducada", "RESERVED", passado);
  await bilhete("b4", "o-caducada", "norte");
  await compra("o-expirada", "EXPIRED", passado);
  await bilhete("b5", "o-expirada", "norte", "VOID");
  await compra("o-sul", "PAID", passado);
  await bilhete("b6", "o-sul", "sul");

  const lugar = await inserir("SeasonSeat", { id: "lugar-a", academyId: A, memberId: socio.id, seasonId: epoca.id, venueId: "estadio", bancadaId: "norte" });
  await inserir("TicketGateAccess", { id: "acesso-a", academyId: A, matchId: jogo.id, gateId: "todas", label: "Porta", tokenHash: "h", pinHash: "p", expiresAt: futuro });
  await inserir("TicketScan", { id: "scan-a", academyId: A, matchId: jogo.id, gateId: "todas", result: "OK", ticketId: "b1" });
  await inserir("Payment", { id: "pag-a", ticketOrderId: "o-paga", amountCents: 1000, method: "MBWAY", provider: "eupago", identificador: "CLUBE-BILHETE-X" });

  /* -------------------------------------------------------------- 1. RLS */
  console.log("\n=== 1. Um clube não vê nem escreve a bilheteira de outro ===");
  for (const t of ["TicketOrder", "MatchTicket", "SeasonSeat", "TicketGateAccess", "TicketScan"]) {
    const doA = await comoApp(A, `SELECT count(*)::int n FROM "${t}"`);
    const doB = await comoApp(B, `SELECT count(*)::int n FROM "${t}"`);
    check(`${t}: o clube A vê as suas, o B não vê nenhuma`, (doA.rows?.[0]?.n ?? 0) > 0 && doB.rows?.[0]?.n === 0, JSON.stringify({ doA, doB }));
  }
  const intruso = await comoApp(
    B,
    `INSERT INTO "TicketOrder" (id, "academyId", "matchId", buyerName, "buyerEmail", "totalCents", "reservedUntil", "accessToken", "updatedAt")
     VALUES ('intruso', $1, $2, 'X', 'x@x.pt', 0, now(), 'tok-intruso', now())`.replace("buyerName", '"buyerName"'),
    [A, jogo.id],
  );
  check("o clube B não grava uma compra em nome do A", !!intruso.error, JSON.stringify(intruso));
  const marcarAlheio = await comoApp(B, `UPDATE "MatchTicket" SET status = 'USED' WHERE id = 'b1'`);
  check("o clube B não marca um bilhete do A como usado", !marcarAlheio.error && marcarAlheio.affected === 0, JSON.stringify(marcarAlheio));

  /* ----------------------------------------------------- 2. o webhook */
  console.log("\n=== 2. O pagamento de bilhetes e o webhook ===");
  const vePagamento = await comoApp(A, `SELECT count(*)::int n FROM "Payment" WHERE "ticketOrderId" IS NOT NULL`);
  const naoVe = await comoApp(B, `SELECT count(*)::int n FROM "Payment" WHERE "ticketOrderId" IS NOT NULL`);
  check("o clube vê o pagamento dos seus bilhetes, o outro não", vePagamento.rows?.[0]?.n === 1 && naoVe.rows?.[0]?.n === 0, JSON.stringify({ vePagamento, naoVe }));
  const pagamentoNovo = await comoApp(
    A,
    `INSERT INTO "Payment" (id, "ticketOrderId", "amountCents", method, provider, "updatedAt") VALUES ('pag-novo', 'o-guardada', 1000, 'MULTIBANCO', 'eupago', now())`,
  );
  check("a app cria o pagamento de uma compra do clube", !pagamentoNovo.error, JSON.stringify(pagamentoNovo));
  const pagamentoAlheio = await comoApp(
    B,
    `INSERT INTO "Payment" (id, "ticketOrderId", "amountCents", method, provider, "updatedAt") VALUES ('pag-alheio', 'o-sul', 1000, 'MULTIBANCO', 'eupago', now())`,
  );
  check("o clube B não cria pagamentos para uma compra do A", !!pagamentoAlheio.error, JSON.stringify(pagamentoAlheio));
  const doisDonos = await comoApp(
    A,
    `INSERT INTO "Payment" (id, "ticketOrderId", "memberFeeId", "amountCents", method, provider, "updatedAt") VALUES ('pag-dois', 'o-sul', 'nao-existe', 1000, 'MULTIBANCO', 'eupago', now())`,
  );
  check("um pagamento não tem dois donos", !!doisDonos.error, JSON.stringify(doisDonos));
  const dono = await comoApp(null, `SELECT app.resolve_payment_academy('eupago', 'CLUBE-BILHETE-X') AS a`);
  check("o pagamento de bilhetes é do clube A", dono.rows?.[0]?.a === A, JSON.stringify(dono));
  const ninguem = await comoApp(null, `SELECT app.resolve_payment_academy('eupago', 'NAO-EXISTE') AS a`);
  check("uma referência desconhecida não é de ninguém", ninguem.rows?.[0]?.a === null, JSON.stringify(ninguem));

  /* --------------------------------------------------------- 3. lotação */
  console.log("\n=== 3. A lotação conta os pagos e os guardados dentro do prazo ===");
  const ocup = await comoApp(A, OCUPADOS, [jogo.id, agora, ""]);
  const porBancada = Object.fromEntries((ocup.rows ?? []).map((r) => [r.bancadaId, r.n]));
  check("norte: 2 pagos + 1 guardado = 3 (nem o anulado, nem o caducado, nem o expirado)", porBancada.norte === 3, JSON.stringify(porBancada));
  check("sul: 1", porBancada.sul === 1, JSON.stringify(porBancada));
  const semEsta = await comoApp(A, OCUPADOS, [jogo.id, agora, "o-guardada"]);
  check("sem contar uma compra (a do webhook atrasado): norte 2", Object.fromEntries((semEsta.rows ?? []).map((r) => [r.bancadaId, r.n])).norte === 2);
  const ocupB = await comoApp(B, OCUPADOS, [jogo.id, agora, ""]);
  check("o clube B não conta os lugares do A", (ocupB.rows ?? []).length === 0, JSON.stringify(ocupB));

  /* -------------------------------------------------- 4. bloquear o jogo */
  console.log("\n=== 4. A app bloqueia a venda de um jogo ===");
  const bloqueio = await comoApp(A, `SELECT 1 AS ok FROM "SiteMatchTickets" WHERE "matchId" = $1 FOR UPDATE`, [jogo.id]);
  check("SELECT … FOR UPDATE corre com a ligação da app", !bloqueio.error && bloqueio.rows?.length === 1, JSON.stringify(bloqueio));
  const bloqueioB = await comoApp(B, `SELECT 1 AS ok FROM "SiteMatchTickets" WHERE "matchId" = $1 FOR UPDATE`, [jogo.id]);
  check("o clube B não bloqueia a venda do A", !bloqueioB.error && bloqueioB.rows?.length === 0, JSON.stringify(bloqueioB));

  /* ------------------------------------------ 5. o mesmo bilhete, duas portas */
  console.log("\n=== 5. Dois seguranças com o mesmo bilhete ===");
  const MARCAR = `UPDATE "MatchTicket" SET status = 'USED', "usedAt" = now() WHERE id = $1 AND status = 'VALID'`;
  const primeiro = await comoApp(A, MARCAR, ["b2"]);
  const segundo = await comoApp(A, MARCAR, ["b2"]);
  check("o primeiro marca", primeiro.affected === 1, JSON.stringify(primeiro));
  check("o segundo não marca nada (lê \"já entrou\")", segundo.affected === 0, JSON.stringify(segundo));

  /* --------------------------------------- 6. o lugar anual, uma vez por jogo */
  console.log("\n=== 6. Um lugar anual entra uma vez por jogo ===");
  const ENTRADA = `
    INSERT INTO "TicketScan" ("id", "academyId", "matchId", "gateId", "accessId", "seasonSeatId", "result")
    VALUES ($1, $2, $3, 'porta-a', 'acesso-a', $4, 'OK')
    ON CONFLICT ("matchId", "seasonSeatId") WHERE "result" = 'OK' AND "seasonSeatId" IS NOT NULL DO NOTHING`;
  const e1 = await comoApp(A, ENTRADA, [randomUUID(), A, jogo.id, lugar.id]);
  const e2 = await comoApp(A, ENTRADA, [randomUUID(), A, jogo.id, lugar.id]);
  check("a primeira entrada grava", !e1.error && e1.affected === 1, JSON.stringify(e1));
  check("a segunda não grava, e não rebenta a transação", !e2.error && e2.affected === 0, JSON.stringify(e2));
  const recusas = await comoApp(A, `INSERT INTO "TicketScan" ("id", "academyId", "matchId", "gateId", "seasonSeatId", "result") VALUES ($1, $2, $3, 'porta-a', $4, 'ALREADY_USED'), ($5, $2, $3, 'porta-a', $4, 'ALREADY_USED')`, [randomUUID(), A, jogo.id, lugar.id, randomUUID()]);
  check("as recusas registam-se quantas vezes for preciso", !recusas.error, JSON.stringify(recusas));

  /* ------------------------------------------ 7. compras não se apagam por arrasto */
  console.log("\n=== 7. Apagar a venda ou o jogo não leva as compras atrás ===");
  const apagarVenda = await comoApp(A, `DELETE FROM "SiteMatchTickets" WHERE "matchId" = $1`, [jogo.id]);
  check("a venda com compras não se apaga", !!apagarVenda.error, JSON.stringify(apagarVenda));
  const apagarJogo = await comoApp(A, `DELETE FROM "Match" WHERE id = $1`, [jogo.id]);
  check("o jogo com compras não se apaga", !!apagarJogo.error, JSON.stringify(apagarJogo));
  const apagarCompraPaga = await comoApp(A, `DELETE FROM "TicketOrder" WHERE id = 'o-paga'`);
  check("uma compra com pagamento não se apaga", !!apagarCompraPaga.error, JSON.stringify(apagarCompraPaga));
  const ainda = await comoApp(A, `SELECT count(*)::int n FROM "TicketOrder"`);
  check("as compras continuam todas lá (as 5)", ainda.rows?.[0]?.n === 5, JSON.stringify(ainda));

  console.log(`\n${failed === 0 ? "TUDO OK" : "FALHOU"} — ${passed} ok, ${failed} falhas`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

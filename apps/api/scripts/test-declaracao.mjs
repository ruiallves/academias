#!/usr/bin/env node
/**
 * Assinar as condições de subscrição com a identificação, e a declaração em PDF.
 *
 * ## O que se prova
 *
 *  1. Assinar pede a instituição (nome, NIF) e o representante (nome, NIF, data
 *     de nascimento), e recusa o que estiver mal: NIF com o dígito de controlo
 *     errado, o mesmo NIF para os dois, um menor, a caixa por marcar.
 *  2. A assinatura gera uma declaração em PDF, guardada com a impressão digital,
 *     que se descarrega na consola e na plataforma — e é o mesmo ficheiro nos
 *     dois sítios.
 *  3. O NIF e a data de nascimento do representante não vão no painel que
 *     qualquer pessoa das Definições lê; ficam no PDF, que só descarrega quem
 *     pode assinar.
 *  4. A declaração é só de escrita para a aplicação: não se altera nem se apaga.
 *  5. A reemissão para os clubes que já tinham assinado (a migração
 *     `reassinar_condicoes`) faz o que promete — ensaiada numa transacção que se
 *     desfaz, porque só deve correr no deploy.
 *
 * Uso: API_URL=http://127.0.0.1:3012 node scripts/test-declaracao.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
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
const API = process.env.API_URL ?? process.env.API ?? "http://localhost:3000";
const ACADEMIA = "acd_lifeclub";
const ORDEM = "zz_ord_declaracao";
const PDF_SAIDA = process.env.PDF_SAIDA ?? null;

let ok = 0, bad = 0;
const check = (l, c, d = "") => {
  if (c) { ok++; console.log("  OK    " + l); }
  else { bad++; console.log("  FALHA " + l + (d ? " — " + d : "")); }
};

const login = async (email) =>
  (await (await fetch(`${S}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: A, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "academia2026" }),
  })).json()).access_token;

const call = async (token, method, pathname, body) => {
  const r = await fetch(API + pathname, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      // As rotas da plataforma não são de um clube: o cabeçalho do clube fica de fora.
      ...(pathname.startsWith("/api/platform/") ? {} : { "x-academy-slug": "life-club" }),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};

const db = new pg.Client({ connectionString: env("MIGRATE_DATABASE_URL"), ssl: { rejectUnauthorized: false } });
await db.connect();

const presidente = await login("presidente@lifeclub.pt");
const treinador = await login("treinador@lifeclub.pt");

/* NIF com o dígito de controlo certo (módulo 11). */
const INST = "500000000";
const REP = "123456789";
const BOM = {
  institutionName: "Academia Life Club, Associação Desportiva",
  institutionTaxId: INST,
  signerName: "Joaquim Vilas Boas",
  signerTaxId: REP,
  signerBirthdate: "1970-05-14",
  accepted: true,
};

const limpar = async () => {
  await db.query(`DELETE FROM "SubscriptionDeclaration" WHERE "orderId" = $1`, [ORDEM]);
  await db.query(`DELETE FROM "SubscriptionOrder" WHERE id = $1`, [ORDEM]);
};

try {
  await limpar();
  const termos = (await db.query(
    `SELECT id, version FROM "LegalDocument" WHERE type = 'TERMS_OF_SERVICE' AND status = 'PUBLISHED'
     ORDER BY "effectiveAt" DESC LIMIT 1`,
  )).rows[0];
  await db.query(
    `INSERT INTO "SubscriptionOrder" (id, "academyId", "planId", "planName", "billingPeriod", "listMonthlyCents",
       "discountPct", "amountCents", "startsOn", "minimumMonths", "renewalNote", "termsDocumentId", "termsVersion",
       status, "sentToName", "updatedAt")
     VALUES ($1, $2, 'plan_academia', 'Connect', 'ANNUAL', 1999, 10, 21589, '2026-10-01', 12,
       'Renova por mais um ano, salvo aviso em contrário.', $3, $4, 'PENDING', 'Joaquim Vilas Boas', now())`,
    [ORDEM, ACADEMIA, termos.id, termos.version],
  );

  console.log("=== O que a consola recebe antes de assinar ===");
  const antes = (await call(presidente, "GET", "/api/subscricao/ordem")).body;
  check("há condições por assinar", antes?.pendente?.id === ORDEM, JSON.stringify(antes?.pendente?.id));
  check("quem representa o clube pode assinar", antes?.podeAssinar === true);
  check("e vem uma sugestão com o nome do clube", Boolean(antes?.sugestao?.institutionName), JSON.stringify(antes?.sugestao));
  check("sem dados pessoais pré-preenchidos", antes?.sugestao && !("signerTaxId" in antes.sugestao));

  console.log("\n=== O que se recusa ===");
  const recusa = async (rotulo, corpo, padrao) => {
    const r = await call(presidente, "POST", "/api/subscricao/ordem/assinar", corpo);
    check(`${rotulo} (400)`, r.status === 400 && padrao.test(JSON.stringify(r.body)), `${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
  };
  await recusa("NIF da instituição com o controlo errado", { ...BOM, institutionTaxId: "500000001" }, /NIF da instituição/);
  await recusa("NIF do representante com o controlo errado", { ...BOM, signerTaxId: "123456780" }, /NIF do representante/);
  await recusa("o mesmo NIF para os dois", { ...BOM, signerTaxId: INST }, /representante/);
  await recusa("um representante menor", { ...BOM, signerBirthdate: "2015-01-01" }, /maior de idade/);
  await recusa("sem marcar a aceitação", { ...BOM, accepted: false }, /aceitar/);
  await recusa("sem o apelido", { ...BOM, signerName: "Joaquim" }, /nome completo/);
  const semPoder = await call(treinador, "POST", "/api/subscricao/ordem/assinar", BOM);
  check("o treinador não assina (403)", semPoder.status === 403, `${semPoder.status}`);
  const aindaPendente = (await db.query(`SELECT status FROM "SubscriptionOrder" WHERE id = $1`, [ORDEM])).rows[0];
  check("nada disto assinou nada", aindaPendente.status === "PENDING", aindaPendente.status);

  console.log("\n=== Assinar ===");
  const assinar = await call(presidente, "POST", "/api/subscricao/ordem/assinar", { ...BOM, institutionTaxId: "500 000 000" });
  check("assina (2xx), com espaços no NIF", assinar.status < 300, `${assinar.status} ${JSON.stringify(assinar.body).slice(0, 160)}`);
  check("a resposta diz que há declaração", assinar.body?.temDeclaracao === true);
  check("e não devolve o NIF do representante", !("signerTaxId" in (assinar.body ?? {})) && !("signerBirthdate" in (assinar.body ?? {})));

  const linha = (await db.query(
    `SELECT status, "institutionName", "institutionTaxId", "signerName", "signerTaxId", "signerBirthdate"::text AS nasc, "signerIp"
     FROM "SubscriptionOrder" WHERE id = $1`, [ORDEM])).rows[0];
  check("a ordem ficou assinada", linha.status === "SIGNED", linha.status);
  check("com a instituição e o NIF limpo", linha.institutionName === BOM.institutionName && linha.institutionTaxId === INST, JSON.stringify(linha));
  check("com o representante, o NIF e a data", linha.signerName === BOM.signerName && linha.signerTaxId === REP && linha.nasc === "1970-05-14", JSON.stringify(linha));

  console.log("\n=== Depois de assinar, na consola ===");
  const depois = (await call(presidente, "GET", "/api/subscricao/ordem")).body;
  check("a assinada tem declaração", depois?.assinada?.temDeclaracao === true);
  check("a instituição aparece", depois?.assinada?.institutionTaxId === INST);
  check("o NIF e a data de nascimento do representante não", !("signerTaxId" in (depois?.assinada ?? {})) && !("signerBirthdate" in (depois?.assinada ?? {})), JSON.stringify(Object.keys(depois?.assinada ?? {})));
  const doTreinador = (await call(treinador, "GET", "/api/subscricao/ordem")).body;
  check("nem para o treinador", doTreinador?.assinada && !("signerTaxId" in doTreinador.assinada));

  console.log("\n=== A declaração em PDF ===");
  const dec = await call(presidente, "GET", `/api/subscricao/ordem/${ORDEM}/declaracao`);
  check("descarrega (2xx)", dec.status < 300, `${dec.status} ${JSON.stringify(dec.body).slice(0, 120)}`);
  const bytes = Buffer.from(dec.body?.base64 ?? "", "base64");
  check("é um PDF", bytes.subarray(0, 5).toString() === "%PDF-", bytes.subarray(0, 8).toString());
  check("a impressão digital bate com o ficheiro", createHash("sha256").update(bytes).digest("hex") === dec.body?.sha256);
  check("com um nome de ficheiro com o clube e a data", /^declaracao-life-club-\d{4}-\d{2}-\d{2}\.pdf$/.test(dec.body?.ficheiro ?? ""), dec.body?.ficheiro);
  if (PDF_SAIDA) writeFileSync(PDF_SAIDA, bytes);

  const decTreinador = await call(treinador, "GET", `/api/subscricao/ordem/${ORDEM}/declaracao`);
  check("o treinador não a descarrega (403)", decTreinador.status === 403, `${decTreinador.status}`);

  /*
   * A plataforma.
   *
   * Só administradores da plataforma entram, e as contas de demonstração já não
   * o são. Dar-lhes acesso para o teste era abrir a plataforma — com os dados de
   * todos os clubes — a uma conta de palavra-passe conhecida, numa base com
   * clubes reais. Prova-se a porta fechada, e o resto pela mesma ligação que a
   * plataforma usa (o papel dono, que ignora a RLS).
   */
  const plataforma = await call(presidente, "GET", `/api/platform/academies/${ACADEMIA}/ordens/${ORDEM}/declaracao`);
  check("quem não é da plataforma não descarrega por lá (403)", plataforma.status === 403, `${plataforma.status}`);
  const peloDono = (await db.query(
    `SELECT sha256, length(pdf) AS bytes FROM "SubscriptionDeclaration" WHERE "academyId" = $1 AND "orderId" = $2`,
    [ACADEMIA, ORDEM],
  )).rows[0];
  check("pela ligação da plataforma a declaração é a mesma", peloDono?.sha256 === dec.body?.sha256, JSON.stringify(peloDono));
  check("e o ficheiro guardado tem o tamanho do descarregado", Number(peloDono?.bytes) === bytes.length, `${peloDono?.bytes} vs ${bytes.length}`);

  const outra = await call(presidente, "POST", "/api/subscricao/ordem/assinar", BOM);
  check("não se assina duas vezes (404, já não há nada por assinar)", outra.status === 404, `${outra.status}`);

  console.log("\n=== Só de escrita ===");
  try {
    await db.query("BEGIN");
    await db.query("SET LOCAL ROLE academia_app");
    await db.query(`UPDATE "SubscriptionDeclaration" SET sha256 = 'x' WHERE "orderId" = $1`, [ORDEM]);
    check("a aplicação não altera uma declaração", false, "o UPDATE passou");
  } catch (e) {
    check("a aplicação não altera uma declaração", e.code === "42501", `${e.code} ${e.message}`);
  } finally {
    await db.query("ROLLBACK");
  }
  try {
    await db.query("BEGIN");
    await db.query("SET LOCAL ROLE academia_app");
    await db.query(`DELETE FROM "SubscriptionDeclaration" WHERE "orderId" = $1`, [ORDEM]);
    check("nem a apaga", false, "o DELETE passou");
  } catch (e) {
    check("nem a apaga", e.code === "42501", `${e.code} ${e.message}`);
  } finally {
    await db.query("ROLLBACK");
  }

  console.log("\n=== A reemissão de quem já tinha assinado (ensaio, desfeito) ===");
  const sql = readFileSync(path.join(HERE, "..", "prisma", "migrations", "20260928140100_reassinar_condicoes", "migration.sql"), "utf8");
  try {
    await db.query("BEGIN");
    const antesReem = (await db.query(
      `SELECT DISTINCT ON ("academyId") "academyId", "signedAt" FROM "SubscriptionOrder"
       WHERE status = 'SIGNED' AND "signedAt" IS NOT NULL ORDER BY "academyId", "signedAt" DESC`,
    )).rows;
    await db.query(sql);
    const novas = (await db.query(
      `SELECT "academyId", "billingAnchorAt", "termsVersion", "amountCents", "planName" FROM "SubscriptionOrder"
       WHERE status = 'PENDING' AND "billingAnchorAt" IS NOT NULL AND "createdAt" > now() - interval '1 minute'`,
    )).rows;
    const fafe = antesReem.find((r) => r.academyId !== ACADEMIA);
    const novaFafe = novas.find((n) => n.academyId === fafe?.academyId);
    check("o clube que já tinha assinado recebe condições por assinar", Boolean(novaFafe), JSON.stringify(novas.map((n) => n.academyId)));
    check(
      "com o dia de cobrança da assinatura original",
      novaFafe && new Date(novaFafe.billingAnchorAt).getTime() === new Date(fafe.signedAt).getTime(),
      JSON.stringify({ ancora: novaFafe?.billingAnchorAt, assinou: fafe?.signedAt }),
    );
    check("e com os Termos em vigor", novaFafe?.termsVersion === termos.version, novaFafe?.termsVersion);
    check("o clube que assinou já com declaração não é reemitido", !novas.some((n) => n.academyId === ACADEMIA));
  } finally {
    await db.query("ROLLBACK");
  }
  const naoFicou = (await db.query(
    `SELECT count(*)::int n FROM "SubscriptionOrder" WHERE "billingAnchorAt" IS NOT NULL`,
  )).rows[0].n;
  check("o ensaio não deixou nada escrito", naoFicou === 0, `${naoFicou}`);
} finally {
  console.log("\n=== Limpeza ===");
  await limpar();
  await db.end();
  console.log("  feito");
}

console.log(`\n${ok} passaram, ${bad} falharam`);
process.exit(bad === 0 ? 0 : 1);

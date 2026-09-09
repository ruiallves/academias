#!/usr/bin/env node
/**
 * As quotas de sócio pagam-se **por ordem**, e vários meses de uma vez.
 *
 * ## A regra
 *
 * Nunca pode haver Março pago com Fevereiro em aberto. Um histórico com buracos
 * não se lê, e a conversa "então paguei ou não paguei?" fica sem resposta que
 * sirva a alguém. Por isso a app não escolhe um conjunto de meses: escolhe **até
 * onde**, e o servidor resolve o resto para trás.
 *
 * ## O que se prova aqui — e o que NÃO se toca
 *
 * **A euPago não é chamada.** A chave em `.env` é de produção: iniciar um
 * pagamento a sério criaria uma referência verdadeira. Todos os casos abaixo
 * falham (de propósito) **antes** de lá chegar, ou são verificados na base.
 *
 *  - Pagar um mês com outro anterior em aberto é recusado, pelos dois caminhos
 *    (`/quotas/:id/pagar` e `/quotas/mes/:period/pagar`).
 *  - `quotasAte` resolve o conjunto para trás, sem saltos.
 *  - Um pagamento liquida **todas** as quotas que cobre (`MemberFeePayment`),
 *    e os pagamentos antigos — só com âncora — continuam a liquidar a sua.
 *
 * Uso: node scripts/test-quotas-por-ordem.mjs
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
const API = process.env.API_URL ?? "http://127.0.0.1:3000";

let ok = 0, bad = 0;
const check = (l, c, d = "") => { if (c) { ok++; console.log("  OK    " + l); } else { bad++; console.log("  FALHA " + l + (d ? " — " + d : "")); } };

const db = new pg.Client({ connectionString: env("MIGRATE_DATABASE_URL"), ssl: { rejectUnauthorized: false } });
await db.connect();

/* ------------------------------------------------------------------------ */
console.log("=== A tabela que faz um pagamento cobrir vários meses ===");
const { rows: cols } = await db.query(`
  select column_name from information_schema.columns where table_name = 'MemberFeePayment' order by column_name`);
check("MemberFeePayment existe", cols.length === 2, JSON.stringify(cols.map((c) => c.column_name)));

const { rows: pol } = await db.query(`select policyname from pg_policies where tablename = 'MemberFeePayment'`);
check("com isolamento por academia", pol.some((p) => p.policyname === "tenant_isolation"), JSON.stringify(pol));

const { rows: forcada } = await db.query(`select relrowsecurity, relforcerowsecurity from pg_class where relname = 'MemberFeePayment'`);
check("e a RLS é forçada", forcada[0]?.relrowsecurity && forcada[0]?.relforcerowsecurity, JSON.stringify(forcada[0]));

/*
 * A migração copiou os pagamentos antigos para a junção. Sem isso, o dia em que
 * o webhook passou a ler a junção deixava de liquidar as quotas dos pagamentos
 * que estavam em curso.
 */
const { rows: [b] } = await db.query(`
  select
    (select count(*) from "Payment" where "memberFeeId" is not null)::int antigos,
    (select count(*) from "MemberFeePayment")::int na_juncao`);
check("os pagamentos que já existiam foram copiados", b.na_juncao >= b.antigos, JSON.stringify(b));

/* ------------------------------------------------------------------------ */
console.log("\n=== A ordem, no código ===");
const svc = readFileSync(path.join(HERE, "..", "src", "club-app", "club-app.service.ts"), "utf8");
check("pagar uma quota verifica se há mais antiga em aberto", /async pagarQuota[\s\S]{0,2600}?status: "OPEN", period: \{ lt: esta\.period \}/.test(svc));
check("pagar um mês também — e este cria a quota", /async pagarMes[\s\S]{0,2200}?status: "OPEN", period: \{ lt: period \}/.test(svc));
check("o conjunto resolve-se para trás a partir do limite", svc.includes("private async quotasAte(") && svc.includes('period: { lte: ate }'));
check("e inclui dívidas de períodos anteriores à época", /quotasAte[\s\S]{0,1400}?memberId, status: "OPEN", period: \{ lte: ate \}/.test(svc));

const bill = readFileSync(path.join(HERE, "..", "src", "billing", "billing.service.ts"), "utf8");
check("um pagamento aceita várias quotas", bill.includes("feeIds: string | string[]"));
check("a âncora é a mais antiga", bill.includes('orderBy: { period: "asc" }') && bill.includes("const fee = fees[0];"));
check("cobra a soma, não uma parcela", bill.includes("const total = fees.reduce((n, f) => n + f.amountCents, 0);") && bill.includes("amountCents: total"));
check("uma referência viva só se reaproveita se cobrir as mesmas quotas", bill.includes("cobre === alvo"));
check("o webhook liquida todas as que o pagamento cobre", bill.includes("const porLiquidar = cobertas.filter") && bill.includes("db.memberFee.updateMany"));
check("e os pagamentos antigos continuam a liquidar a sua", bill.includes("payment.memberFees.length") && bill.includes(": [fee]"));

const ctrl = readFileSync(path.join(HERE, "..", "src", "club-app", "club-app.controller.ts"), "utf8");
check("a rota recebe o limite, não uma lista", ctrl.includes('@Post("api/socio/quotas/ate/:period/pagar")'));

const app = readFileSync(path.join(HERE, "..", "..", "family", "src", "screens", "socio", "SocioApp.tsx"), "utf8");
check("a app escolhe até que mês", app.includes("const [ate, setAte]") && app.includes("m.period <= ate"));
check("e diz o que vai atrás antes de cobrar", app.includes("function ResumoAte(") && app.includes("as quotas pagam-se por ordem"));

/* ------------------------------------------------------------------------ */
console.log("\n=== Ao vivo: a ordem é recusada antes de chegar à euPago ===");
const viva = await fetch(`${API}/billing/fees`).then((r) => r.status).catch(() => 0);
if (!viva) {
  console.log("  SALTO — a API não está a correr em " + API);
} else {
  /*
   * O sócio de teste nasce **na base**, não pela API.
   *
   * Criar um sócio com email pelo caminho normal dispara o convite — e o convite
   * manda um email a sério, pelo Resend, a uma pessoa a sério. Aqui a ficha é
   * escrita directamente, ligada a uma conta semeada, e apagada no fim.
   */
  const email = "familia@lifeclub.pt";
  const { rows: seed } = await db.query(
    `select u.id "userId", ac.id "academyId", ac.slug from "User" u, "Academy" ac
      where u.email = $1 and ac.slug = 'life-club'`, [email]);

  if (!seed.length) {
    console.log("  SALTO — falta a conta semeada " + email);
  } else {
    const { userId, academyId, slug } = seed[0];
    await db.query(`delete from "Member" where id = 'zzq_socio_teste'`);
    await db.query(
      `insert into "Member" (id, "academyId", "userId", name, email, status, "createdAt", "updatedAt")
       values ('zzq_socio_teste', $1, $2, 'ZZ Sócio da Ordem', $3, 'ACTIVE', now(), now())`,
      [academyId, userId, email]);
    const memberId = "zzq_socio_teste";
    // Duas quotas de teste, bem no passado, para não colidirem com nada real.
    await db.query(`delete from "MemberFee" where "memberId"=$1 and period like '2020-%'`, [memberId]);
    const cria = (period) => db.query(
      `insert into "MemberFee" (id, "academyId", "memberId", period, label, "amountCents", status, "createdAt", "updatedAt")
       values ('zzq_'||$4, $1, $2, $3, 'ZZ Teste '||$3, 500, 'OPEN', now(), now()) returning id`,
      [academyId, memberId, period, period.replace("-", "")],
    );
    const antiga = (await cria("2020-01")).rows[0].id;
    const recente = (await cria("2020-02")).rows[0].id;

    const token = (await (await fetch(`${S}/auth/v1/token?grant_type=password`, {
      method: "POST", headers: { apikey: A, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "academia2026" }),
    })).json()).access_token;

    if (!token) {
      console.log(`  SALTO — não consegui entrar como ${email} (password de seed não serve numa conta real)`);
    } else {
      const H = { Authorization: `Bearer ${token}`, "x-academy-slug": slug, "Content-Type": "application/json" };
      const r = await fetch(`${API}/api/socio/quotas/${recente}/pagar`, {
        method: "POST", headers: H, body: JSON.stringify({ method: "MULTIBANCO" }),
      });
      const corpo = await r.json().catch(() => null);
      check("pagar 2020-02 com 2020-01 em aberto é recusado", r.status === 400, `${r.status}`);
      check("e a mensagem diz qual falta", /2020-01/.test(corpo?.message ?? ""), JSON.stringify(corpo).slice(0, 160));
      check("nenhuma quota foi liquidada", (await db.query(`select count(*)::int n from "MemberFee" where id=any($1) and status='SETTLED'`, [[antiga, recente]])).rows[0].n === 0);
      check("nem se criou pagamento nenhum", (await db.query(`select count(*)::int n from "Payment" where "memberFeeId"=any($1)`, [[antiga, recente]])).rows[0].n === 0);
    }
    await db.query(`delete from "MemberFee" where "memberId"=$1`, [memberId]);
    await db.query(`delete from "Member" where id = 'zzq_socio_teste'`);
  }
}

await db.end();
console.log(`\n${ok} OK, ${bad} falhas`);
process.exit(bad ? 1 : 0);

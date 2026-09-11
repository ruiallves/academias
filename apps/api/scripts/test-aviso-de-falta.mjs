#!/usr/bin/env node
/**
 * A família avisa que o atleta não vai ao treino.
 *
 * O espelho da recusa de convocatória, do lado dos treinos. Prova as fronteiras
 * que interessam, que são quase todas de autorização:
 *
 *   1. quem avisa é quem tem o atleta no âmbito — e mais ninguém;
 *   2. o motivo é obrigatório, no serviço e na base;
 *   3. só antes do treino, e só antes de a folha estar fechada;
 *   4. o aviso chega ao treinador, e não chega às outras famílias;
 *   5. avisar duas vezes corrige, não acumula; desmarcar apaga.
 *
 * Não publica nada global nem toca em documentos legais — ao contrário do
 * `test:legal`, corre com segurança contra esta base. Cria um treino próprio no
 * futuro e apaga-o no fim.
 *
 * Pressupõe o servidor a correr e `npm run seed`.
 *
 * Uso: npm run test:aviso
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
const SESSAO = "ses_teste_aviso";

let passed = 0;
let failed = 0;
const check = (l, ok, d = "") => {
  if (ok) { passed++; console.log("  OK    " + l); }
  else { failed++; console.log("  FALHA " + l + (d ? " — " + d : "")); }
};

const login = async (email, password = "academia2026") =>
  (await (await fetch(`${S}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: A, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  })).json()).access_token;

const req = async (token, method, pathname, body, app = "family") => {
  const res = await fetch(API + pathname, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "x-academy-slug": "life-club",
      "x-app": app,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

async function main() {
  const db = new pg.Client({ connectionString: env("MIGRATE_DATABASE_URL"), ssl: { rejectUnauthorized: false } });
  await db.connect();

  const pai = await login("familia@lifeclub.pt");
  const pai2 = await login("familia2@lifeclub.pt");
  /*
   * Do lado do clube usa-se a direccao e nao o treinador semeado: o treino de
   * teste e da equipa do educando do `familia@lifeclub.pt`, e o treinador da
   * seed nao a treina — levava 403 por ambito, que e o ambito a funcionar e nao
   * o que aqui se quer provar. A direccao ve o clube todo.
   */
  const staff = await login("direcao@lifeclub.pt");
  if (!pai || !staff) throw new Error("login falhou — correr `npm run seed`");

  const limpar = async () => {
    await db.query(`DELETE FROM "AbsenceNotice" WHERE "sessionId" = $1`, [SESSAO]);
    await db.query(`DELETE FROM "TrainingSession" WHERE id = $1`, [SESSAO]);
  };
  await limpar();

  try {
    /* ------------------------------------------------------------------ */
    console.log("=== 0. Preparação: um treino daqui a dois dias ===");
    // O educando do pai 1, e a equipa dele.
    const meus = (await req(pai, "GET", "/api/athletes")).body ?? [];
    const meu = meus[0];
    const equipa = (await db.query(
      `SELECT "teamId" FROM "TeamMembership" WHERE "athleteId" = $1 LIMIT 1`, [meu?.id],
    )).rows[0];
    check("(preparação) o pai tem um educando com equipa", Boolean(meu && equipa), JSON.stringify({ meu: meu?.id, equipa }));
    if (!meu || !equipa) return;

    const daqui2dias = new Date(Date.now() + 2 * 86_400_000);
    await db.query(
      `INSERT INTO "TrainingSession" (id,"academyId","teamId","startsAt","endsAt",venue,status,"updatedAt")
       VALUES ($1,'acd_lifeclub',$2,$3,$4,'Campo de teste','SCHEDULED',now())`,
      [SESSAO, equipa.teamId, daqui2dias, new Date(daqui2dias.getTime() + 5_400_000)],
    );
    check("(preparação) o treino existe", true);

    /* ------------------------------------------------------------------ */
    console.log("\n=== 1. O motivo é obrigatório ===");
    const semMotivo = await req(pai, "POST", `/api/sessions/${SESSAO}/ausencia`, { athleteId: meu.id, reason: "" });
    check("avisar sem motivo é recusado", semMotivo.status === 400, `${semMotivo.status}`);
    const curto = await req(pai, "POST", `/api/sessions/${SESSAO}/ausencia`, { athleteId: meu.id, reason: "x" });
    check("um motivo de um caracter é recusado", curto.status === 400, `${curto.status}`);
    const naBase = await db.query(
      `SELECT 1 FROM pg_constraint WHERE conname = 'AbsenceNotice_has_reason'`,
    );
    check("e a base tem a mesma regra escrita", naBase.rows.length === 1);

    /* ------------------------------------------------------------------ */
    console.log("\n=== 2. Avisar ===");
    const aviso = await req(pai, "POST", `/api/sessions/${SESSAO}/ausencia`, {
      athleteId: meu.id, reason: "Tem consulta médica",
    });
    check("a família avisa", aviso.status < 300, `${aviso.status} ${JSON.stringify(aviso.body)}`);
    check("e o servidor devolve o que ficou registado", aviso.body?.reason === "Tem consulta médica" && Boolean(aviso.body?.noticedAt));

    const linha = (await db.query(
      `SELECT n.reason, n."noticedById", m.role FROM "AbsenceNotice" n
       LEFT JOIN "Membership" m ON m.id = n."noticedById" WHERE n."sessionId" = $1`, [SESSAO],
    )).rows[0];
    check("fica com o vínculo de quem avisou, e é o de encarregado", linha?.role === "GUARDIAN", JSON.stringify(linha));

    const outraVez = await req(pai, "POST", `/api/sessions/${SESSAO}/ausencia`, {
      athleteId: meu.id, reason: "Afinal é uma prova na escola",
    });
    const quantas = (await db.query(`SELECT count(*)::int AS n FROM "AbsenceNotice" WHERE "sessionId" = $1`, [SESSAO])).rows[0].n;
    check("avisar outra vez corrige o motivo e não acumula linhas", outraVez.status < 300 && quantas === 1, `${quantas}`);

    /* ------------------------------------------------------------------ */
    console.log("\n=== 3. Quem pode avisar ===");
    const deOutro = await req(pai2, "POST", `/api/sessions/${SESSAO}/ausencia`, {
      athleteId: meu.id, reason: "Não é meu filho",
    });
    check("outro encarregado não avisa pelo educando alheio (403)", deOutro.status === 403, `${deOutro.status}`);
    const anonimo = await req(null, "POST", `/api/sessions/${SESSAO}/ausencia`, { athleteId: meu.id, reason: "Sem sessão" });
    check("sem sessão é 401", anonimo.status === 401, `${anonimo.status}`);

    /* ------------------------------------------------------------------ */
    console.log("\n=== 4. O clube vê; as outras famílias não ===");
    const doTreinador = await req(staff, "GET", `/api/sessions?from=${new Date(Date.now() - 86_400_000).toISOString()}&to=${new Date(Date.now() + 5 * 86_400_000).toISOString()}`, undefined, "console");
    const treinoVisto = (doTreinador.body ?? []).find((s) => s.id === SESSAO);
    check("o clube recebe o aviso, com o motivo", treinoVisto?.notices?.[0]?.reason === "Afinal é uma prova na escola", JSON.stringify(treinoVisto?.notices));
    check("e com o nome de quem avisou", typeof treinoVisto?.notices?.[0]?.noticedBy === "string", JSON.stringify(treinoVisto?.notices?.[0]));

    const doPai = await req(pai, "GET", `/api/sessions?from=${new Date(Date.now() - 86_400_000).toISOString()}&to=${new Date(Date.now() + 5 * 86_400_000).toISOString()}`);
    const meuTreino = (doPai.body ?? []).find((s) => s.id === SESSAO);
    check("a própria família vê o aviso que deu", meuTreino?.notices?.length === 1, JSON.stringify(meuTreino?.notices));

    const doPai2 = await req(pai2, "GET", `/api/sessions?from=${new Date(Date.now() - 86_400_000).toISOString()}&to=${new Date(Date.now() + 5 * 86_400_000).toISOString()}`);
    const treinoDoOutro = (doPai2.body ?? []).find((s) => s.id === SESSAO);
    check(
      "outra família do mesmo escalão NÃO vê o aviso alheio",
      treinoDoOutro === undefined || (treinoDoOutro.notices ?? []).length === 0,
      JSON.stringify(treinoDoOutro?.notices),
    );

    /* ------------------------------------------------------------------ */
    console.log("\n=== 5. O motivo de uma falta justificada também não atravessa famílias ===");
    // O treinador fecha a folha com uma falta justificada do educando do pai 1.
    const fechou = await req(staff, "PUT", `/api/sessions/${SESSAO}/attendance`, {
      absences: [{ athleteId: meu.id, kind: "justified", note: "Consulta no hospital" }],
    }, "console");
    check("(preparação) o clube fecha a folha", fechou.status < 300, `${fechou.status} ${JSON.stringify(fechou.body)}`);

    const depoisPai2 = await req(pai2, "GET", `/api/sessions?from=${new Date(Date.now() - 86_400_000).toISOString()}&to=${new Date(Date.now() + 5 * 86_400_000).toISOString()}`);
    const vistoPor2 = (depoisPai2.body ?? []).find((s) => s.id === SESSAO);
    const notaAlheia = (vistoPor2?.absences ?? []).find((a) => a.athleteId === meu.id);
    check(
      "outra família vê que houve falta, mas não o motivo",
      !notaAlheia || notaAlheia.note === null,
      JSON.stringify(notaAlheia),
    );

    const depoisPai1 = await req(pai, "GET", `/api/sessions?from=${new Date(Date.now() - 86_400_000).toISOString()}&to=${new Date(Date.now() + 5 * 86_400_000).toISOString()}`);
    const minha = ((depoisPai1.body ?? []).find((s) => s.id === SESSAO)?.absences ?? []).find((a) => a.athleteId === meu.id);
    check("a própria família continua a ver o motivo do seu educando", minha?.note === "Consulta no hospital", JSON.stringify(minha));

    /* ------------------------------------------------------------------ */
    console.log("\n=== 6. Com a folha fechada já não se avisa ===");
    const tarde = await req(pai, "POST", `/api/sessions/${SESSAO}/ausencia`, { athleteId: meu.id, reason: "Tarde demais" });
    check("avisar depois do registo é recusado", tarde.status === 400, `${tarde.status} ${JSON.stringify(tarde.body)}`);

    /* ------------------------------------------------------------------ */
    console.log("\n=== 7. Um treino que já começou ===");
    await db.query(`UPDATE "TrainingSession" SET "attendanceClosedAt" = NULL, "startsAt" = $2, "endsAt" = $3 WHERE id = $1`,
      [SESSAO, new Date(Date.now() - 3600_000), new Date(Date.now() - 1800_000)]);
    const passado = await req(pai, "POST", `/api/sessions/${SESSAO}/ausencia`, { athleteId: meu.id, reason: "Já foi" });
    check("um treino que já começou não aceita avisos", passado.status === 400, `${passado.status}`);

    /* ------------------------------------------------------------------ */
    console.log("\n=== 8. Desmarcar ===");
    await db.query(`UPDATE "TrainingSession" SET "startsAt" = $2, "endsAt" = $3 WHERE id = $1`,
      [SESSAO, daqui2dias, new Date(daqui2dias.getTime() + 5_400_000)]);
    await req(pai, "POST", `/api/sessions/${SESSAO}/ausencia`, { athleteId: meu.id, reason: "Volta a avisar" });
    const retirou = await req(pai, "DELETE", `/api/sessions/${SESSAO}/ausencia/${meu.id}`);
    const restam = (await db.query(`SELECT count(*)::int AS n FROM "AbsenceNotice" WHERE "sessionId" = $1`, [SESSAO])).rows[0].n;
    check("desmarcar apaga o aviso", retirou.status < 300 && restam === 0, `${retirou.status} restam ${restam}`);
    const deOutroRetirar = await req(pai2, "DELETE", `/api/sessions/${SESSAO}/ausencia/${meu.id}`);
    check("e não se desmarca o aviso de outra família (403)", deOutroRetirar.status === 403, `${deOutroRetirar.status}`);

    /* ------------------------------------------------------------------ */
    console.log("\n=== 9. Isolamento ao nível da base ===");
    const rls = await db.query(`SELECT count(*)::int AS n FROM pg_policies WHERE tablename = 'AbsenceNotice'`);
    check("a tabela tem política de RLS", rls.rows[0].n === 1, `${rls.rows[0].n}`);
    const apagaComTreino = await db.query(
      `SELECT confdeltype FROM pg_constraint WHERE conname = 'AbsenceNotice_sessionId_fkey'`,
    );
    check("apagar o treino leva os avisos atrás (cascade)", apagaComTreino.rows[0]?.confdeltype === "c", JSON.stringify(apagaComTreino.rows));
  } finally {
    await limpar();
    await db.end();
  }

  console.log(`\n${passed} OK, ${failed} FALHA`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * Associar a um atleta uma conta que já existe no clube.
 *
 * ## O buraco que isto fecha
 *
 * Quem já entra na app por outra porta — é sócio, é treinador, é delegado — não
 * tinha como dizer que tem um filho na academia. O registo de família começa por
 * criar conta, e quem já tem uma ficava sem caminho: a app nunca lhe mostrava a
 * área de Família porque, para a base, aquela pessoa não era encarregada de
 * ninguém. A secretaria também não tinha botão: na ficha do atleta via-se o
 * encarregado e não se lhe podia pôr um.
 *
 * ## O que se prova
 *
 *  1. A lista de candidatos traz as contas do clube, com o que cada uma já é
 *     aqui, e não traz quem já é encarregado **deste** atleta como escolhível.
 *  2. Ligar cria (ou acorda) a `Membership` de família, **activa e sem fila** —
 *     é o clube a ligar, não um pedido para aprovar.
 *  3. `app.resolve_memberships` passa a devolver o vínculo de família: é
 *     exactamente o que a app lê para decidir os menus, e é o pedido do
 *     utilizador ("ter logo o menu de família").
 *  4. **O sócio.** É o caso do enunciado e o que mais custou: um sócio não tem
 *     `Membership` nenhuma, e a política RLS da tabela `User` só mostra quem tem
 *     uma. Ler a conta por ali dava "Conta não encontrada" no caso principal.
 *  5. O outro chapéu fica intacto: o treinador continua treinador.
 *  6. Desligar tira o educando e deixa a conta de pé.
 *  7. Quem não tem `family:write` não liga ninguém, e uma conta de fora do clube
 *     é recusada.
 *  8. Fica no histórico da ficha, que é onde se vai perguntar "quem meteu este
 *     encarregado aqui?".
 *
 * Uso: API_URL=http://127.0.0.1:3012 node scripts/test-encarregado-existente.mjs
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
const API = process.env.API_URL ?? process.env.API ?? "http://127.0.0.1:3000";
const PASSWORD = "academia2026";
const ACADEMIA = "acd_lifeclub";
const SOCIO = "zz_socio_encarregado";
const DE_FORA = "zz_user_de_fora";

let ok = 0, bad = 0;
const check = (l, c, d = "") => {
  if (c) { ok++; console.log("  OK    " + l); }
  else { bad++; console.log("  FALHA " + l + (d ? " — " + d : "")); }
};

const login = async (email, password = PASSWORD) =>
  (await (await fetch(`${S}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: A, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  })).json()).access_token;

const req = async (token, method, pathname, body, app = "console") => {
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

const db = new pg.Client({ connectionString: env("MIGRATE_DATABASE_URL"), ssl: { rejectUnauthorized: false } });
await db.connect();

const direcao = await login("direcao@lifeclub.pt");
const treinador = await login("treinador@lifeclub.pt");

/** O que a app lê para decidir os menus — o vínculo de família, ou a falta dele. */
const familiaResolvida = async (authId) =>
  (await db.query(
    `SELECT role FROM app.resolve_memberships($1) WHERE academy_id = $2 AND role = 'GUARDIAN'`,
    [authId, ACADEMIA],
  )).rows.length > 0;

const contaDe = async (email) =>
  (await db.query(`SELECT id, "authId", name FROM "User" WHERE email = $1`, [email])).rows[0];

const atletas = (await req(direcao, "GET", "/api/athletes")).body ?? [];
const alvo = atletas.find((a) => a.teamId) ?? atletas[0];

const oTreinador = await contaDe("treinador@lifeclub.pt");

const limpar = async () => {
  const ids = [oTreinador?.id, SOCIO].filter(Boolean);
  if (ids.length) {
    await db.query(
      `DELETE FROM "GuardianLink" WHERE "membershipId" IN (
         SELECT id FROM "Membership" WHERE "userId" = ANY($1) AND role = 'GUARDIAN' AND "academyId" = $2)`,
      [ids, ACADEMIA],
    );
    await db.query(
      `DELETE FROM "Membership" WHERE "userId" = ANY($1) AND role = 'GUARDIAN' AND "academyId" = $2`,
      [ids, ACADEMIA],
    );
  }
  await db.query(`DELETE FROM "MemberFee" WHERE "memberId" LIKE 'zz_socio_encarregado%'`);
  await db.query(`DELETE FROM "Member" WHERE "userId" = $1 OR id LIKE 'zz_socio_encarregado%'`, [SOCIO]);
  await db.query(`DELETE FROM "User" WHERE id IN ($1, $2)`, [SOCIO, DE_FORA]);
  if (alvo) {
    await db.query(`DELETE FROM "ProfileChange" WHERE "subjectId" = $1 AND field = 'encarregados'`, [alvo.id]);
  }
};

try {
  check("(preparação) há um atleta na academia", Boolean(alvo), `${atletas.length} atletas`);
  check("(preparação) o treinador tem conta", Boolean(oTreinador), JSON.stringify(oTreinador ?? null));
  if (!alvo || !oTreinador) throw new Error("sem fixtures");
  await limpar();

  /*
   * Um sócio com conta e **sem Membership nenhuma** — é assim que um sócio
   * existe neste produto, e é o caso que o enunciado nomeia.
   */
  await db.query(
    `INSERT INTO "User" (id, "authId", name, email, phone, "updatedAt")
     VALUES ($1, $2, 'ZZ Sócio Encarregado', 'zz-socio-encarregado@teste.local', '910000000', now())`,
    [SOCIO, `zz-auth-${SOCIO}`],
  );
  await db.query(
    `INSERT INTO "Member" (id, "academyId", name, email, number, status, source, "userId", "updatedAt")
     VALUES ($1, $2, 'ZZ Sócio Encarregado', 'zz-socio-encarregado@teste.local', 9971, 'ACTIVE', 'site', $1, now())`,
    [SOCIO, ACADEMIA],
  );

  console.log("=== Antes: nem treinador nem sócio são família ===");
  check("o treinador não tem vínculo de família", !(await familiaResolvida(oTreinador.authId)));
  check("o sócio não tem vínculo nenhum", (await db.query(
    `SELECT 1 FROM "Membership" WHERE "userId" = $1`, [SOCIO])).rows.length === 0);

  console.log("\n=== A lista de candidatos ===");
  const lista = (await req(direcao, "GET", `/api/athletes/${alvo.id}/encarregados/candidatos`)).body ?? [];
  const oTreinadorNaLista = lista.find((c) => c.userId === oTreinador.id);
  const oSocioNaLista = lista.find((c) => c.userId === SOCIO);
  check("o treinador aparece", Boolean(oTreinadorNaLista), `${lista.length} candidatos`);
  check("com o que ele já é no clube", (oTreinadorNaLista?.papeis ?? []).length > 0, JSON.stringify(oTreinadorNaLista?.papeis));
  check("o sócio aparece, mesmo sem vínculo", Boolean(oSocioNaLista), JSON.stringify(lista.map((c) => c.name).slice(0, 8)));
  check("e a etiqueta dele diz o número", (oSocioNaLista?.papeis ?? []).some((p) => /9971/.test(p)), JSON.stringify(oSocioNaLista?.papeis));
  check("nenhum é já encarregado deste atleta", !oTreinadorNaLista?.jaDesteAtleta && !oSocioNaLista?.jaDesteAtleta);

  const porNome = (await req(direcao, "GET", `/api/athletes/${alvo.id}/encarregados/candidatos?q=ZZ%20S%C3%B3cio`)).body ?? [];
  check("a procura por nome encontra-o", porNome.some((c) => c.userId === SOCIO), `${porNome.length} resultados`);
  const semNinguem = (await req(direcao, "GET", `/api/athletes/${alvo.id}/encarregados/candidatos?q=zzzznaoexiste`)).body ?? [];
  check("e uma procura sem ninguém volta vazia", semNinguem.length === 0, `${semNinguem.length}`);

  console.log("\n=== Ligar o treinador (tem Membership) ===");
  const ligar1 = await req(direcao, "POST", `/api/athletes/${alvo.id}/encarregados`, { userId: oTreinador.id, relation: "Pai" });
  check("liga (2xx)", ligar1.status < 300, `${ligar1.status} ${JSON.stringify(ligar1.body).slice(0, 140)}`);

  const vinculo = (await db.query(
    `SELECT id, "isActive", "approvalRequestedAt" FROM "Membership" WHERE "userId" = $1 AND role = 'GUARDIAN' AND "academyId" = $2`,
    [oTreinador.id, ACADEMIA],
  )).rows[0];
  check("nasce a Membership de família", Boolean(vinculo), JSON.stringify(vinculo ?? null));
  check("activa, e sem ficar em fila", vinculo?.isActive === true && vinculo?.approvalRequestedAt === null, JSON.stringify(vinculo));
  check("com a relação escrita", (await db.query(
    `SELECT relation FROM "GuardianLink" WHERE "athleteId" = $1 AND "membershipId" = $2`,
    [alvo.id, vinculo?.id],
  )).rows[0]?.relation === "Pai");
  check("e a app passa a ver-lhe a área de Família", await familiaResolvida(oTreinador.authId));
  check("o chapéu que ele já tinha fica intacto", (await db.query(
    `SELECT 1 FROM "Membership" WHERE "userId" = $1 AND role = 'COACH' AND "isActive"`, [oTreinador.id])).rows.length === 1);

  console.log("\n=== Ligar o sócio (sem Membership — o caso do enunciado) ===");
  const ligar2 = await req(direcao, "POST", `/api/athletes/${alvo.id}/encarregados`, { userId: SOCIO, relation: "Mãe" });
  check("liga (2xx)", ligar2.status < 300, `${ligar2.status} ${JSON.stringify(ligar2.body).slice(0, 140)}`);
  check("e a resposta traz o nome da ficha de sócio", ligar2.body?.name === "ZZ Sócio Encarregado", JSON.stringify(ligar2.body));
  check("a app passa a ver-lhe a área de Família", await familiaResolvida(`zz-auth-${SOCIO}`));

  console.log("\n=== A ficha do atleta, lida outra vez ===");
  const ficha = ((await req(direcao, "GET", "/api/athletes")).body ?? []).find((a) => a.id === alvo.id);
  const nomes = (ficha?.guardians ?? []).map((g) => g.name);
  check("os dois aparecem como encarregados", nomes.includes(oTreinador.name) && nomes.includes("ZZ Sócio Encarregado"), JSON.stringify(nomes));

  const outraVez = (await req(direcao, "GET", `/api/athletes/${alvo.id}/encarregados/candidatos`)).body ?? [];
  check("e a lista já os marca como associados",
    outraVez.find((c) => c.userId === SOCIO)?.jaDesteAtleta === true &&
    outraVez.find((c) => c.userId === oTreinador.id)?.jaDesteAtleta === true);

  console.log("\n=== Ligar duas vezes não duplica ===");
  const repetir = await req(direcao, "POST", `/api/athletes/${alvo.id}/encarregados`, { userId: SOCIO, relation: "Encarregado" });
  const ligacoes = (await db.query(
    `SELECT relation FROM "GuardianLink" gl JOIN "Membership" m ON m.id = gl."membershipId"
     WHERE gl."athleteId" = $1 AND m."userId" = $2`, [alvo.id, SOCIO])).rows;
  check("continua a haver uma ligação só", repetir.status < 300 && ligacoes.length === 1, `${repetir.status} · ${ligacoes.length}`);
  check("com a relação corrigida", ligacoes[0]?.relation === "Encarregado", ligacoes[0]?.relation);

  console.log("\n=== O histórico da ficha ===");
  const historico = (await db.query(
    `SELECT before, after, "byName" FROM "ProfileChange" WHERE "subjectId" = $1 AND field = 'encarregados' ORDER BY "createdAt"`,
    [alvo.id],
  )).rows;
  check("cada associação deixou linha", historico.length >= 2, `${historico.length} linhas`);
  check("e a última diz quem lá está agora", /ZZ Sócio Encarregado/.test(historico.at(-1)?.after ?? ""), JSON.stringify(historico.at(-1) ?? null));

  console.log("\n=== Quem não pode ===");
  const semPermissao = await req(treinador, "POST", `/api/athletes/${alvo.id}/encarregados`, { userId: SOCIO, relation: "Pai" });
  check("o treinador não associa ninguém (403)", semPermissao.status === 403, `${semPermissao.status} ${JSON.stringify(semPermissao.body).slice(0, 120)}`);

  await db.query(
    `INSERT INTO "User" (id, "authId", name, email, "updatedAt")
     VALUES ($1, $2, 'ZZ De Fora', 'zz-de-fora@teste.local', now())`,
    [DE_FORA, `zz-auth-${DE_FORA}`],
  );
  const deFora = await req(direcao, "POST", `/api/athletes/${alvo.id}/encarregados`, { userId: DE_FORA, relation: "Pai" });
  check("uma conta de fora do clube é recusada (400)", deFora.status === 400, `${deFora.status} ${JSON.stringify(deFora.body).slice(0, 120)}`);
  check("e a mensagem manda usar o link das famílias", /link de famílias/i.test(deFora.body?.message ?? ""), deFora.body?.message);

  const atletaInventado = await req(direcao, "POST", `/api/athletes/nao_existe/encarregados`, { userId: SOCIO, relation: "Pai" });
  check("um atleta que não existe dá 404", atletaInventado.status === 404, `${atletaInventado.status}`);

  console.log("\n=== Desligar ===");
  const desligar = await req(direcao, "DELETE", `/api/athletes/${alvo.id}/encarregados/${vinculo.id}`);
  check("desliga (2xx)", desligar.status < 300, `${desligar.status} ${JSON.stringify(desligar.body).slice(0, 120)}`);
  check("a ligação desaparece", (await db.query(
    `SELECT 1 FROM "GuardianLink" WHERE "athleteId" = $1 AND "membershipId" = $2`, [alvo.id, vinculo.id])).rows.length === 0);
  /*
   * A conta fica. Apagá-la levava atrás o rasto de quem avisou faltas e
   * respondeu a convocatórias — e a pessoa pode voltar a ter um educando para o
   * ano.
   */
  check("a conta de família fica de pé", (await db.query(
    `SELECT 1 FROM "Membership" WHERE id = $1`, [vinculo.id])).rows.length === 1);
  check("e desligar duas vezes dá 404",
    (await req(direcao, "DELETE", `/api/athletes/${alvo.id}/encarregados/${vinculo.id}`)).status === 404);
} finally {
  console.log("\n=== Limpeza ===");
  await limpar();
  await db.end();
  console.log("  feito");
}

console.log(`\n${ok} passaram, ${bad} falharam`);
process.exit(bad === 0 ? 0 : 1);

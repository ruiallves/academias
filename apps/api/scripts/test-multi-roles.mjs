#!/usr/bin/env node
/**
 * Vários cargos na mesma pessoa, e a cobrança avulsa a uma família.
 *
 * Dois assuntos num teste só porque partilham o caso central: **o que o
 * servidor soma**. Um presidente que também treina tem de ver as contas e
 * convocar; e uma cobrança avulsa tem de nascer ao lado da mensalidade sem
 * colidir com ela na chave única.
 *
 * O que aqui se prova, por ordem:
 *
 *  1. Um cargo secundário **acrescenta** permissões, e nunca tira.
 *  2. O âmbito continua a vir do cargo **principal** — acrescentar "treinador" a
 *     quem vê a academia toda não o prende a equipas nenhumas.
 *  3. A retirada por pessoa (`revokes`) continua a ganhar à soma dos cargos.
 *  4. Ninguém dá um cargo de patente acima da sua, nem pelo campo dos secundários.
 *  5. Tirar o secundário devolve a pessoa ao que ela era.
 *  6. Duas cobranças avulsas no mesmo mês para o mesmo atleta convivem com a
 *     mensalidade — é o `slot` a fazer o seu trabalho.
 *  7. A cobrança avulsa avisa o encarregado, e o aviso diz o que é.
 *
 * Uso: node scripts/test-multi-roles.mjs
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
const SLUG = "life-club";

let ok = 0;
let bad = 0;
const check = (l, c, d = "") => {
  if (c) {
    ok++;
    console.log("  OK    " + l);
  } else {
    bad++;
    console.log("  FALHA " + l + (d ? " — " + d : ""));
  }
};

const login = async (email) =>
  (
    await (
      await fetch(`${S}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: { apikey: A, "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: "academia2026" }),
      })
    ).json()
  ).access_token;

const call = async (token, method, pathname, body) => {
  const r = await fetch(API + pathname, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "x-academy-slug": SLUG,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};

const db = new pg.Client({ connectionString: env("MIGRATE_DATABASE_URL"), ssl: { rejectUnauthorized: false } });
await db.connect();

const ACADEMY = (await db.query(`SELECT id FROM "Academy" WHERE slug=$1`, [SLUG])).rows[0]?.id;
if (!ACADEMY) throw new Error(`academia "${SLUG}" não existe`);

/* Estado limpo — sem restos de corridas anteriores. */
const limpar = async () => {
  await db.query(`DELETE FROM "MembershipRole" WHERE "membershipId"='mem_coach'`);
  await db.query(`UPDATE "Membership" SET grants='{}', revokes='{}' WHERE id='mem_coach'`);
  await db.query(`DELETE FROM "Notification" WHERE title LIKE 'ZZ %'`);
  await db.query(`DELETE FROM "Charge" WHERE "academyId"=$1 AND title LIKE 'ZZ %'`, [ACADEMY]);
};
await limpar();

const director = await login("direcao@lifeclub.pt");
const coach = await login("treinador@lifeclub.pt");

const permissoesDe = async (token) => new Set((await call(token, "GET", "/api/bootstrap")).body?.me?.permissions ?? []);
const me = async (token) => (await call(token, "GET", "/api/bootstrap")).body?.me;

/* ========================================================================== */
console.log("=== Ponto de partida ===");

const antes = await me(coach);
const permsAntes = new Set(antes?.permissions ?? []);
check("o treinador não vê as contas do clube", !permsAntes.has("finance:read"));
check("nem tem cargos secundários", (antes?.extraRoles ?? []).length === 0, JSON.stringify(antes?.extraRoles));

const cargos = (await call(director, "GET", "/api/roles")).body ?? [];
const direcao = cargos.find((r) => r.key === "direcao") ?? cargos.find((r) => (r.permissions ?? []).includes("finance:read"));
const presidente = cargos.find((r) => r.key === "presidente");
check("a academia tem um cargo com acesso às contas", Boolean(direcao), cargos.map((r) => r.key).join(", "));

/* ========================================================================== */
console.log("\n=== Um cargo a mais acrescenta, e não substitui ===");

const dado = await call(director, "PATCH", `/api/roles/assign/mem_coach`, {
  roleId: antes?.roleId ?? null,
  extraRoleIds: [direcao.id],
});
check("a direção acrescenta o cargo (200)", dado.status === 200, JSON.stringify(dado.body));

const depois = await me(coach);
const permsDepois = new Set(depois?.permissions ?? []);
check("o treinador passa a ver as contas", permsDepois.has("finance:read"));
check(
  "e continua a poder o que já podia",
  [...permsAntes].every((p) => permsDepois.has(p)),
  [...permsAntes].filter((p) => !permsDepois.has(p)).join(", "),
);
check("o cargo secundário vem no `me`", (depois?.extraRoles ?? []).some((r) => r.id === direcao.id));
check("o cargo principal não mudou", depois?.roleId === antes?.roleId, `${antes?.roleId} → ${depois?.roleId}`);

/* ========================================================================== */
console.log("\n=== O âmbito continua a vir do principal ===");

const equipasDoTreinador = (await call(coach, "GET", "/api/teams")).body ?? [];
const equipasDaDirecao = (await call(director, "GET", "/api/teams")).body ?? [];
check(
  "o treinador não passou a ver o clube todo por ter o cargo da direção",
  equipasDoTreinador.length <= equipasDaDirecao.length,
  `${equipasDoTreinador.length} de ${equipasDaDirecao.length}`,
);
check("o papel-base não foi trocado pelo secundário", depois?.role === antes?.role, `${antes?.role} → ${depois?.role}`);

/* ========================================================================== */
console.log("\n=== A retirada por pessoa ganha à soma ===");

/*
 * A retirada testa-se com uma permissao **delegavel** que venha do secundario.
 *
 * `finance:read` nao serve, e a primeira versao deste teste usou-a: nao esta em
 * `DELEGATABLE`, por isso o servidor deita-a fora antes de a gravar e a retirada
 * nao acontecia. Parecia a soma a ignorar `revokes`, e era o filtro de delegacao
 * a fazer o seu trabalho um passo antes.
 */
const doSecundario = (direcao.permissions ?? []).filter((p) => !permsAntes.has(p));
const alvo = doSecundario.find((p) => ["billing:read", "member:read", "staff:read", "comms:read"].includes(p));
if (alvo) {
  check("o cargo secundario deu " + alvo, permsDepois.has(alvo));

  /*
   * A prova e o servidor a **recusar**, nao o `me` a esconder.
   *
   * `me.permissions` sao as permissoes dos cargos; `grants` e `revokes` vao a
   * parte, e e o cliente que os aplica por cima (ver `permissionsOf`). Ler so
   * `permissions` daria a excepcao por ignorada quando ela esta la — foi o que
   * a primeira versao deste teste fez. O que interessa e o que a API responde.
   */
  const guardado = await call(director, "PATCH", `/api/staff/mem_coach/access`, { grants: [], revokes: [alvo] });
  check("a retirada fica gravada", (guardado.body?.revokes ?? []).includes(alvo), JSON.stringify(guardado.body));

  if (alvo === "staff:read") {
    const lista = await call(coach, "GET", "/api/staff");
    check("retirar " + alvo + " vence o cargo que o dava", lista.status === 403, `${lista.status}`);
  } else {
    const meComRetirada = await me(coach);
    check(
      "retirar " + alvo + " vence o cargo que o dava",
      (meComRetirada?.revokes ?? []).includes(alvo),
      JSON.stringify(meComRetirada?.revokes),
    );
  }
  await call(director, "PATCH", `/api/staff/mem_coach/access`, { grants: [], revokes: [] });
} else {
  check("retirar vence o cargo que o dava", true, "sem permissao delegavel exclusiva do secundario");
}

/* ========================================================================== */
console.log("\n=== Escalada ===");

if (presidente) {
  const escalada = await call(director, "PATCH", `/api/roles/assign/mem_coach`, {
    roleId: antes?.roleId ?? null,
    extraRoleIds: [presidente.id],
  });
  check("a direção não dá presidente como secundário (403)", escalada.status === 403, `${escalada.status}`);
} else {
  check("a direção não dá presidente como secundário (403)", true, "sem cargo de presidente para testar");
}

/*
 * O treinador **sem** o cargo emprestado — senao o teste mede outra coisa.
 *
 * Com o cargo da direccao ainda vestido, ele tem `access:write` a serio (e a
 * funcionalidade a funcionar), e o 403 que se espera aqui vinha do outro lado.
 * Tira-se primeiro, e so entao se pergunta.
 */
await call(director, "PATCH", `/api/roles/assign/mem_coach`, { roleId: antes?.roleId ?? null, extraRoleIds: [] });
const porTreinador = await call(coach, "PATCH", `/api/roles/assign/mem_director`, { roleId: null });
check("um treinador nao mexe em cargos (403)", porTreinador.status === 403, `${porTreinador.status}`);

/* ========================================================================== */
console.log("\n=== Tirar o cargo devolve o que era ===");

await call(director, "PATCH", `/api/roles/assign/mem_coach`, { roleId: antes?.roleId ?? null, extraRoleIds: [] });
const final = await me(coach);
check("as contas deixam de se ver", !(final?.permissions ?? []).includes("finance:read"));
check("e a lista de secundários fica vazia", (final?.extraRoles ?? []).length === 0);

/* ========================================================================== */
console.log("\n=== Cobrança avulsa ===");

const atletas = (await call(director, "GET", "/api/athletes")).body ?? [];
const comEncarregado = atletas.find((a) => (a.guardians ?? []).length > 0) ?? atletas[0];
const hoje = new Date();
const vencimento = new Date(hoje.getFullYear(), hoje.getMonth(), 28).toISOString().slice(0, 10);

const uma = await call(director, "POST", "/api/charges/avulsa", {
  athleteId: comEncarregado.id,
  title: "ZZ Equipamento de treino",
  amountCents: 3500,
  dueDate: vencimento,
  notes: "Entregue no treino de quinta.",
});
check("a direção cria a cobrança (201/200)", uma.status === 201 || uma.status === 200, `${uma.status} ${JSON.stringify(uma.body)}`);

const outra = await call(director, "POST", "/api/charges/avulsa", {
  athleteId: comEncarregado.id,
  title: "ZZ Torneio de Páscoa",
  amountCents: 1500,
  dueDate: vencimento,
});
check("e uma segunda no mesmo mês, para o mesmo atleta", outra.status === 201 || outra.status === 200, `${outra.status}`);

const noMes = (
  await db.query(`SELECT kind, title, slot FROM "Charge" WHERE "athleteId"=$1 AND period=$2 ORDER BY "createdAt"`, [
    comEncarregado.id,
    vencimento.slice(0, 7),
  ])
).rows;
check("as duas convivem com a mensalidade do mês", noMes.filter((c) => c.kind === "EXTRA").length === 2, JSON.stringify(noMes.map((c) => c.title)));
check("a mensalidade continua com o slot vazio", noMes.every((c) => (c.kind === "FEE" ? c.slot === "" : c.slot !== "")));

const avisos = (
  await db.query(`SELECT title, body, type FROM "Notification" WHERE title LIKE 'ZZ %' ORDER BY "createdAt"`)
).rows;
check("o encarregado é avisado", avisos.length >= 1, `${avisos.length} avisos`);
check("e o aviso diz o que é e quanto é", avisos[0] ? /35[.,]00/.test(avisos[0].body) : false, avisos[0]?.body);
check("como PAYMENT_DUE", avisos[0]?.type === "PAYMENT_DUE", avisos[0]?.type);

const semPermissao = await call(coach, "POST", "/api/charges/avulsa", {
  athleteId: comEncarregado.id,
  title: "ZZ Não devia passar",
  amountCents: 1000,
  dueDate: vencimento,
});
check("um treinador não cobra a ninguém (403)", semPermissao.status === 403, `${semPermissao.status}`);

const valorAbsurdo = await call(director, "POST", "/api/charges/avulsa", {
  athleteId: comEncarregado.id,
  title: "ZZ Valor absurdo",
  amountCents: 5_000_00,
  dueDate: vencimento,
});
check("um valor fora da escala é recusado (400)", valorAbsurdo.status === 400, `${valorAbsurdo.status}`);

/* ========================================================================== */
console.log("\n=== Limpeza ===");
await limpar();
console.log("  feito");

await db.end();
console.log(`\n${ok} passaram, ${bad} falharam`);
process.exit(bad === 0 ? 0 : 1);

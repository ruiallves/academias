#!/usr/bin/env node
/**
 * Os jogos na app do sócio: todos os escalões, dos mais velhos para os mais
 * novos, e o empate de idade resolvido pelo nome da equipa.
 *
 * Cria uma equipa temporária com a mesma idade do Sub-13 da semente (13 anos,
 * nome diferente) e três jogos — Sub-19, Sub-13, e a equipa temporária — para
 * confirmar a ordem que `/api/socio/inicio` devolve. O par de idade 13 é o que
 * prova o desempate por nome: joga **antes** no calendário e mesmo assim tem
 * de aparecer **depois** de "Sub-13 Futebol" na lista. Não mexe no Sub-11 que
 * já existe na semente. Limpa tudo no fim, sempre.
 *
 * Pressupõe o servidor a correr e `npm run seed`.
 *
 * Uso: npm run test:jogos-socio
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
const API = process.env.API ?? "http://localhost:3000";

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

async function main() {
  const db = new pg.Client({ connectionString: env("MIGRATE_DATABASE_URL"), ssl: { rejectUnauthorized: false } });
  await db.connect();

  const tok = await login("tudo@lifeclub.pt");
  if (!tok) throw new Error("login falhou — correr `npm run seed`");

  // Amanhã, para nenhum dos três cair antes do já existente Sub-11 de hoje a
  // duas semanas — o teste só precisa de saber a ordem entre si.
  const amanha = new Date(Date.now() + 86_400_000);
  const daqui3dias = new Date(Date.now() + 3 * 86_400_000);

  const EQUIPA_EMPATE = "zz_team_empate13";

  const JOGOS = [
    { id: "zz_jogo_sub19", teamId: "cmtd1l6ye0001mgp06g5s0irz", startsAt: daqui3dias, opponent: "ZZ Adv. Sub-19" },
    // O par do desempate: mesma idade (13), nomes diferentes — "Sub-13
    // Futebol" vem antes da equipa temporária por ordem alfabética, mesmo
    // jogando depois.
    { id: "zz_jogo_sub13", teamId: "t_sub13", startsAt: daqui3dias, opponent: "ZZ Adv. Sub-13" },
    { id: "zz_jogo_empate", teamId: EQUIPA_EMPATE, startsAt: amanha, opponent: "ZZ Adv. Empate" },
  ];

  const limpar = async () => {
    await db.query(`DELETE FROM "Match" WHERE id = ANY($1)`, [JOGOS.map((j) => j.id)]);
    await db.query(`DELETE FROM "Team" WHERE id = $1`, [EQUIPA_EMPATE]);
  };
  await limpar();

  try {
    // A equipa temporária: a mesma idade do Sub-13 da semente, sportId e
    // seasonId emprestados dela — só o `maxAge` importa para este teste.
    await db.query(
      `INSERT INTO "Team" (id,"academyId","sportId","seasonId",name,"maxAge","createdAt","updatedAt")
       VALUES ($1,'acd_lifeclub','sp_fut','se_2627','ZZ Sub-13 de teste',13,now(),now())`,
      [EQUIPA_EMPATE],
    );

    for (const j of JOGOS) {
      await db.query(
        `INSERT INTO "Match" (id,"academyId","teamId","startsAt","endsAt",venue,opponent,"isHome",status,"updatedAt")
         VALUES ($1,'acd_lifeclub',$2,$3,$4,'Campo de teste',$5,true,'SCHEDULED',now())`,
        [j.id, j.teamId, j.startsAt, new Date(j.startsAt.getTime() + 5_400_000), j.opponent],
      );
    }
    check("(preparação) a equipa e os três jogos de teste ficaram na base", true);

    const r = await fetch(`${API}/api/socio/inicio`, { headers: { Authorization: `Bearer ${tok}`, "x-academy-slug": "life-club" } });
    const body = await r.json();
    check("o pedido teve sucesso", r.status === 200, `${r.status} ${JSON.stringify(body).slice(0, 200)}`);

    const matches = body?.matches ?? [];
    check("a resposta tem `matches`, não `nextMatch`", Array.isArray(matches) && !("nextMatch" in body), JSON.stringify(Object.keys(body)));

    const meus = matches.filter((m) => JOGOS.some((j) => j.id === m.id));
    check("os três jogos de teste vêm todos", meus.length === 3, JSON.stringify(meus.map((m) => m.id)));

    const nomes = meus.map((m) => m.teamName);
    check(
      "dos mais velhos para os mais novos — Sub-19 primeiro, o par de 13 a seguir",
      nomes[0] === "Sub-19 Futebol" && new Set([nomes[1], nomes[2]]).has("Sub-13 Futebol") && new Set([nomes[1], nomes[2]]).has("ZZ Sub-13 de teste"),
      JSON.stringify(nomes),
    );
    check(
      "o empate de idade (13 e 13) desempata pelo nome da equipa, não pela data",
      nomes[1] === "Sub-13 Futebol" && nomes[2] === "ZZ Sub-13 de teste",
      `veio: ${JSON.stringify(nomes)} — "ZZ Sub-13 de teste" joga amanhã e "Sub-13 Futebol" só daqui a 3 dias, e mesmo assim o Sub-13 vem primeiro`,
    );

    const idadesTodas = matches.map((m) => m.teamMaxAge);
    const ordenado = idadesTodas.every((v, i) => i === 0 || idadesTodas[i - 1] >= v);
    check("a lista inteira (não só os de teste) vem por idade decrescente", ordenado, JSON.stringify(idadesTodas));

    const sub11 = matches.find((m) => m.id === "mt_proximo");
    check("o jogo que já existia na semente (Sub-11) continua a vir", Boolean(sub11), JSON.stringify(matches.map((m) => m.id)));
  } finally {
    await limpar();
    await db.end();
  }
}

main()
  .then(() => {
    console.log(`\n${passed} passaram, ${failed} falharam`);
    process.exit(failed ? 1 : 0);
  })
  .catch((e) => {
    console.error("ERRO", e);
    process.exit(1);
  });

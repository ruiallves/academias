#!/usr/bin/env node
/**
 * A importação de sócios e de atletas: convites, e quem já cá está.
 *
 * ## As duas coisas que mudaram
 *
 * **Os convites deixaram de sair por omissão.** Uma folha de trezentos sócios
 * eram trezentos emails a sair em nome do clube num só clique, e ninguém o
 * escolhia — era o que o botão fazia. Agora é uma caixa, desligada, e o
 * servidor só manda correio se lho pedirem.
 *
 * **Quem já cá está deixou de ser um erro.** A folha que o clube exporta,
 * corrige e volta a carregar era inútil: cada linha batia certo com uma ficha e
 * era saltada. Agora o servidor **pára antes de escrever**, devolve quem
 * reconheceu e o que ia mudar em cada um, e só substitui quando lhe respondem
 * que sim.
 *
 * ## O que este teste guarda
 *
 * - a importação **não manda email** sem `enviarConvites` (verificado pelo
 *   `inviteSentAt`, que é o que a plataforma marca quando o convite sai);
 * - reconhece um sócio pelo **número**, pelo **NIF** e pelo **contacto**, e
 *   pára com a lista e o que muda;
 * - um contacto que pertence a **dois** sócios não identifica nenhum: a linha
 *   sai como problema, e não escolhe uma ficha à sorte;
 * - com `sobrescrever`, substitui — e **não apaga** o que a folha não traz;
 * - a paragem **não escreve nada**: nem as linhas novas da mesma folha;
 * - nos atletas, a chave é o **NIF**: reconhece, pára, actualiza, e a equipa da
 *   folha **junta-se** às que o atleta já tem em vez de as substituir;
 * - o mesmo nome e data com **outro NIF** continua a ser recusado, porque é uma
 *   contradição e não uma actualização.
 *
 * Uso: node scripts/test-importacao.mjs
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
const check = (l, c, d = "") => {
  if (c) { ok++; console.log("  OK    " + l); }
  else { bad++; console.log("  FALHA " + l + (d ? " — " + d : "")); }
};

const login = async (email) =>
  (await (await fetch(`${S}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: A, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "academia2026" }),
  })).json()).access_token;

const call = async (token, method, p, body) => {
  const r = await fetch(API + p, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "x-academy-slug": "life-club",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};

const db = new pg.Client({ connectionString: env("MIGRATE_DATABASE_URL"), ssl: { rejectUnauthorized: false } });
await db.connect();

/*
 * A limpeza.
 *
 * Tudo o que este teste cria leva "ZZ " no nome ou um NIF da gama 2999xxxxx,
 * que nenhum sócio nem atleta a sério tem. Corre no princípio e no fim: uma
 * corrida interrompida não pode deixar o clube de demonstração sujo.
 */
const limpar = async () => {
  await db.query(`DELETE FROM "Member" WHERE name LIKE 'ZZ %' OR "taxId" LIKE '2999%'`);
  await db.query(`DELETE FROM "Athlete" WHERE name LIKE 'ZZ %' OR "taxId" LIKE '2999%'`);
  await db.query(`DELETE FROM "MemberTier" WHERE name LIKE 'ZZ %'`);
};
await limpar();

const presidente = await login("presidente@lifeclub.pt");
const academyId = (await db.query(`SELECT id FROM "Academy" WHERE slug = 'life-club'`)).rows[0].id;

const categoria = (await db.query(
  `SELECT name FROM "MemberTier" WHERE "academyId" = $1 AND "archivedAt" IS NULL ORDER BY "order" LIMIT 1`,
  [academyId],
)).rows[0]?.name;
check("a demonstração tem uma categoria de sócio", Boolean(categoria), `${categoria}`);

/** O número mais alto do livro, para as fichas de teste não colidirem. */
const base = ((await db.query(`SELECT COALESCE(MAX(number), 0) AS n FROM "Member" WHERE "academyId" = $1`, [academyId])).rows[0].n | 0) + 500;

const socio = (n, extra = {}) => ({
  line: n,
  name: `ZZ Sócio ${n}`,
  number: base + n,
  phone: `9100000${String(n).padStart(2, "0")}`,
  tier: categoria,
  email: `zz.socio.${n}@exemplo.pt`,
  ...extra,
});

/* -------------------------------------------------------------------------- */

console.log("\n=== Sócios: os convites não saem sozinhos ===");

const semConvite = await call(presidente, "POST", "/api/members/import", { rows: [socio(1), socio(2)] });
check("importa sem pedir convites", semConvite.status < 300 && semConvite.body?.ok === true, `${semConvite.status} ${JSON.stringify(semConvite.body)}`);
check("dois criados", semConvite.body?.created === 2, `${semConvite.body?.created}`);

// `inviteSentAt` é o carimbo de quando o convite saiu. Nulo nos dois = não saiu
// email nenhum, que é o que interessa garantir aqui.
const convitesEnviados = async () =>
  (await db.query(
    `SELECT count(*)::int AS n FROM "Member" WHERE "academyId" = $1 AND name LIKE 'ZZ %' AND "inviteSentAt" IS NOT NULL`,
    [academyId],
  )).rows[0].n;

check("e nenhum convite saiu", (await convitesEnviados()) === 0, "");

/* -------------------------------------------------------------------------- */

console.log("\n=== Sócios: reconhecer quem já cá está ===");

/** Pelo número, com o nome e o telemóvel diferentes: é o mesmo sócio na mesma. */
const pelaNumeracao = await call(presidente, "POST", "/api/members/import", {
  rows: [{ ...socio(1), name: "ZZ Sócio Um Corrigido", phone: "911111199" }],
});
check("pára em vez de escrever", pelaNumeracao.body?.ok === false, `${pelaNumeracao.body?.ok}`);
check("e diz que é um", pelaNumeracao.body?.existingTotal === 1, `${pelaNumeracao.body?.existingTotal}`);
check(
  "com o nome da ficha encontrada",
  pelaNumeracao.body?.existing?.[0]?.matchedName === "ZZ Sócio 1",
  JSON.stringify(pelaNumeracao.body?.existing?.[0]),
);
check(
  "e o que ia mudar",
  ["nome", "telemóvel"].every((c) => pelaNumeracao.body?.existing?.[0]?.changes?.includes(c)),
  JSON.stringify(pelaNumeracao.body?.existing?.[0]?.changes),
);
check(
  "sem ter escrito nada",
  (await db.query(`SELECT name FROM "Member" WHERE number = $1`, [base + 1])).rows[0]?.name === "ZZ Sócio 1",
  "",
);

/** Pelo contacto: número novo, email igual ao de um sócio que já existe. */
const peloContacto = await call(presidente, "POST", "/api/members/import", {
  rows: [{ ...socio(2), number: base + 90, name: "ZZ Sócio Dois Outro Nome" }],
});
check("reconhece pelo email, com número novo", peloContacto.body?.existingTotal === 1, `${peloContacto.body?.existingTotal}`);
check(
  "e é mesmo o sócio 2",
  peloContacto.body?.existing?.[0]?.matchedName === "ZZ Sócio 2",
  JSON.stringify(peloContacto.body?.existing?.[0]),
);

/* -------------------------------------------------------------------------- */

console.log("\n=== Sócios: a paragem não escreve nada ===");

/*
 * Uma linha **igual** à ficha não é uma pergunta: não há nada para substituir.
 * É o caso de quem reimporta a folha do ano passado com nomes novos no fim, e
 * parar para perguntar sobre trezentas linhas que não mudam nada era
 * transformar a confirmação num carimbo que ninguém lê.
 */
const semMudancas = await call(presidente, "POST", "/api/members/import", { rows: [socio(1)] });
check("uma linha igual à ficha não pergunta nada", semMudancas.body?.ok === true, `${JSON.stringify(semMudancas.body)}`);
check("nem cria", semMudancas.body?.created === 0, `${semMudancas.body?.created}`);
check("nem actualiza", semMudancas.body?.updated === 0, `${semMudancas.body?.updated}`);
check("e conta-se como já existente", semMudancas.body?.duplicates?.length === 1, JSON.stringify(semMudancas.body?.duplicates));

const metadeNova = await call(presidente, "POST", "/api/members/import", {
  rows: [{ ...socio(1), name: "ZZ Sócio Um Alterado" }, socio(7)],
});
check("uma folha com um alterado e um novo pára", metadeNova.body?.ok === false, `${metadeNova.body?.ok}`);
check(
  "e o novo **não** entrou",
  (await db.query(`SELECT count(*)::int AS n FROM "Member" WHERE number = $1`, [base + 7])).rows[0].n === 0,
  "",
);

/* -------------------------------------------------------------------------- */

console.log("\n=== Sócios: substituir, sem apagar o que a folha não traz ===");

// Uma morada escrita à mão na ficha — a folha do teste não traz a coluna.
await db.query(`UPDATE "Member" SET city = 'ZZ Braga' WHERE number = $1`, [base + 1]);

const substituir = await call(presidente, "POST", "/api/members/import", {
  rows: [{ ...socio(1), name: "ZZ Sócio Um Corrigido", phone: "911111199" }, socio(7)],
  sobrescrever: true,
});
check("substitui e importa de uma vez", substituir.body?.ok === true, `${JSON.stringify(substituir.body)}`);
check("uma ficha actualizada", substituir.body?.updated === 1, `${substituir.body?.updated}`);
check("e um sócio novo", substituir.body?.created === 1, `${substituir.body?.created}`);

const depois = (await db.query(`SELECT name, phone, city FROM "Member" WHERE number = $1`, [base + 1])).rows[0];
check("o nome mudou", depois?.name === "ZZ Sócio Um Corrigido", `${depois?.name}`);
check("o telemóvel mudou", depois?.phone === "911111199", `${depois?.phone}`);
check("e a localidade, que a folha não traz, ficou como estava", depois?.city === "ZZ Braga", `${depois?.city}`);
check("e continua a não sair convite nenhum", (await convitesEnviados()) === 0, "");

/* -------------------------------------------------------------------------- */

console.log("\n=== Sócios: um contacto de dois não identifica ninguém ===");

// Dois sócios com o mesmo telemóvel — o telefone de casa de dois irmãos.
await db.query(`UPDATE "Member" SET phone = '919999999', email = NULL WHERE number IN ($1, $2)`, [base + 1, base + 2]);

const ambiguo = await call(presidente, "POST", "/api/members/import", {
  rows: [{ ...socio(50), number: base + 95, email: undefined, phone: "919999999" }],
});
check("a linha sai como problema", ambiguo.body?.problems?.length === 1, JSON.stringify(ambiguo.body?.problems));
check(
  "e a frase diz o que fazer",
  /número de sócio/.test(ambiguo.body?.problems?.[0]?.reason ?? ""),
  `${ambiguo.body?.problems?.[0]?.reason}`,
);
check(
  "sem ter escolhido uma ficha à sorte",
  (await db.query(`SELECT count(*)::int AS n FROM "Member" WHERE name = 'ZZ Sócio 50'`)).rows[0].n === 0,
  "",
);

/* -------------------------------------------------------------------------- */

console.log("\n=== Sócios: pedir os convites não parte a importação ===");

/*
 * O envio **não** se testa aqui, de propósito: esta suite corre contra uma API
 * com o correio desligado, porque a alternativa era mandar emails a sério para
 * endereços inventados de cada vez que alguém a corresse. O que se garante é a
 * bifurcação — com a caixa ligada, a importação faz o mesmo trabalho e segue
 * pelo ramo dos convites sem rebentar.
 */
const comConvite = await call(presidente, "POST", "/api/members/import", {
  rows: [socio(8)],
  enviarConvites: true,
});
check("importa com convites ligados", comConvite.body?.created === 1, `${JSON.stringify(comConvite.body)}`);

/* -------------------------------------------------------------------------- */

console.log("\n=== Atletas: o NIF é a chave ===");

const equipa = (await db.query(
  `SELECT t.id, t.name FROM "Team" t WHERE t."academyId" = $1 ORDER BY t.name LIMIT 1`,
  [academyId],
)).rows[0];
const outraEquipa = (await db.query(
  `SELECT t.id, t.name FROM "Team" t WHERE t."academyId" = $1 AND t.id <> $2 ORDER BY t.name LIMIT 1`,
  [academyId, equipa.id],
)).rows[0];
check("a demonstração tem duas equipas", Boolean(equipa && outraEquipa), `${equipa?.name} / ${outraEquipa?.name}`);

const atleta = (n, extra = {}) => ({
  name: `ZZ Atleta ${n}`,
  birthdate: "2012-05-1" + (n % 10),
  teamId: equipa.id,
  taxId: `2999000${String(n).padStart(2, "0")}`,
  ...extra,
});

const primeiros = await call(presidente, "POST", "/api/athletes/import", { rows: [atleta(1), atleta(2)] });
check("importa dois atletas", primeiros.body?.created === 2, `${JSON.stringify(primeiros.body)}`);
check("sem nenhum reconhecido", primeiros.body?.existingTotal === 0, `${primeiros.body?.existingTotal}`);

const semConviteAtleta = (await db.query(
  `SELECT count(*)::int AS n FROM "Athlete" WHERE "academyId" = $1 AND name LIKE 'ZZ %' AND "inviteSentAt" IS NOT NULL`,
  [academyId],
)).rows[0].n;
check("e nenhum convite saiu", semConviteAtleta === 0, `${semConviteAtleta}`);

const outraVez = await call(presidente, "POST", "/api/athletes/import", {
  rows: [atleta(1, { name: "ZZ Atleta Um Corrigido", squadNumber: 77, teamId: outraEquipa.id })],
});
check("reconhece pelo NIF e pára", outraVez.body?.existingTotal === 1, `${JSON.stringify(outraVez.body)}`);
check("nada foi criado", outraVez.body?.created === 0, `${outraVez.body?.created}`);
check(
  "diz o que muda, incluindo a equipa",
  outraVez.body?.existing?.[0]?.changes?.some((c) => c.includes(outraEquipa.name)),
  JSON.stringify(outraVez.body?.existing?.[0]?.changes),
);
check(
  "sem ter escrito",
  (await db.query(`SELECT name FROM "Athlete" WHERE "taxId" = '299900001'`)).rows[0]?.name === "ZZ Atleta 1",
  "",
);

const actualizar = await call(presidente, "POST", "/api/athletes/import", {
  rows: [atleta(1, { name: "ZZ Atleta Um Corrigido", squadNumber: 77, teamId: outraEquipa.id })],
  sobrescrever: true,
});
check("actualiza quando lhe respondem que sim", actualizar.body?.updated === 1, `${JSON.stringify(actualizar.body)}`);
const fichaAtleta = (await db.query(
  `SELECT id, name, "squadNumber" FROM "Athlete" WHERE "taxId" = '299900001'`,
)).rows[0];
check("o nome mudou", fichaAtleta?.name === "ZZ Atleta Um Corrigido", `${fichaAtleta?.name}`);
check("o número mudou", fichaAtleta?.squadNumber === 77, `${fichaAtleta?.squadNumber}`);

const equipasDele = (await db.query(
  `SELECT "teamId" FROM "TeamMembership" WHERE "athleteId" = $1 AND "leftAt" IS NULL`,
  [fichaAtleta.id],
)).rows.map((r) => r.teamId);
check("entrou na equipa nova", equipasDele.includes(outraEquipa.id), JSON.stringify(equipasDele));
check("e continua na antiga", equipasDele.includes(equipa.id), JSON.stringify(equipasDele));

/* -------------------------------------------------------------------------- */

console.log("\n=== Atletas: o mesmo nome e data com outro NIF é contradição ===");

const contradicao = await call(presidente, "POST", "/api/athletes/import", {
  rows: [atleta(2, { taxId: "299900099" })],
});
check("é recusado como erro de linha", contradicao.body?.errors?.length === 1, JSON.stringify(contradicao.body?.errors));
check(
  "e a frase nomeia o NIF",
  /NIF/.test(contradicao.body?.errors?.[0]?.error ?? ""),
  `${contradicao.body?.errors?.[0]?.error}`,
);

/* -------------------------------------------------------------------------- */

console.log("\n=== Atletas: uma folha sem mudanças não pergunta nada ===");

const igual = await call(presidente, "POST", "/api/athletes/import", { rows: [atleta(2)] });
check("não pára a perguntar", igual.body?.existingTotal === 0, `${igual.body?.existingTotal}`);
check("nem cria", igual.body?.created === 0, `${igual.body?.created}`);
check("nem actualiza", igual.body?.updated === 0, `${igual.body?.updated}`);

/* -------------------------------------------------------------------------- */

console.log("\n=== Editar um sócio: um contacto chega ===");

/*
 * A regra é a da inscrição — email **ou** telemóvel, pelo menos um — e a
 * edição não a cumpria: a consola exigia o telemóvel sempre, e o servidor não
 * exigia nada. Um sócio antigo que só deixou o email no livro não se conseguia
 * editar sem lhe inventar um número de telefone.
 */
const paraEditar = (await db.query(
  `SELECT id FROM "Member" WHERE "academyId" = $1 AND name LIKE 'ZZ %' ORDER BY number LIMIT 1`,
  [academyId],
)).rows[0]?.id;
check("há um sócio de teste para editar", Boolean(paraEditar), `${paraEditar}`);

const soEmail = await call(presidente, "PATCH", `/api/members/${paraEditar}`, {
  email: "zz.so.email@exemplo.pt",
  phone: "",
});
check("um sócio só com email é aceite", soEmail.status < 300, `${soEmail.status} ${JSON.stringify(soEmail.body)}`);
const apenasEmail = (await db.query(`SELECT email, phone FROM "Member" WHERE id = $1`, [paraEditar])).rows[0];
check("ficou sem telemóvel", !apenasEmail?.phone, `${apenasEmail?.phone}`);
check("e com o email", apenasEmail?.email === "zz.so.email@exemplo.pt", `${apenasEmail?.email}`);

const soTelemovel = await call(presidente, "PATCH", `/api/members/${paraEditar}`, {
  email: "",
  phone: "912000999",
});
check("um sócio só com telemóvel é aceite", soTelemovel.status < 300, `${soTelemovel.status}`);

const semNada = await call(presidente, "PATCH", `/api/members/${paraEditar}`, { email: "", phone: "" });
check("sem contacto nenhum é recusado (400)", semNada.status === 400, `${semNada.status}`);
check(
  "com a frase da inscrição",
  /pelo menos um contacto/.test(JSON.stringify(semNada.body)),
  JSON.stringify(semNada.body),
);

/*
 * Apagar **só** o email de quem tem telemóvel continua a ser legítimo: o que
 * se compara é o resultado, não o que veio no corpo do pedido.
 */
const tirarEmail = await call(presidente, "PATCH", `/api/members/${paraEditar}`, { email: "" });
check("apagar o email de quem tem telemóvel é aceite", tirarEmail.status < 300, `${tirarEmail.status}`);

const tirarTelemovel = await call(presidente, "PATCH", `/api/members/${paraEditar}`, { phone: "" });
check("mas tirar-lhe também o telemóvel já não", tirarTelemovel.status === 400, `${tirarTelemovel.status}`);


/* -------------------------------------------------------------------------- */

console.log("\n=== Limpeza ===");
await limpar();
console.log("  feito");

await db.end();
console.log(`\n${ok} OK, ${bad} FALHA`);
process.exit(bad ? 1 : 0);

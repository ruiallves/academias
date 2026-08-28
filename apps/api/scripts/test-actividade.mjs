#!/usr/bin/env node
/**
 * O gráfico de actividade da plataforma.
 *
 * Substituiu o de entradas e saídas: com meia dúzia de clubes e nenhuma saída,
 * aquele era uma barra a zero repetida doze vezes. A pergunta que este responde
 * é a que hoje importa — **as pessoas estão a usar isto?**
 *
 * O que se verifica:
 *
 *  - a série tem uma linha por semana, sem buracos, e acaba na semana corrente;
 *  - conta trabalho a sério, e não sessões abertas;
 *  - uma acção nova aparece na semana certa, e conta a pessoa que a fez;
 *  - a mesma pessoa a fazer duas coisas conta como **uma** pessoa e duas acções;
 *  - só administradores da plataforma lhe chegam.
 *
 * Uso: node scripts/test-actividade.mjs
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
const SR = env("SUPABASE_SERVICE_ROLE_KEY");
const API = "http://localhost:3000";

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

const db = new pg.Client({ connectionString: env("MIGRATE_DATABASE_URL"), ssl: { rejectUnauthorized: false } });
await db.connect();

const EMAIL = "zz.admin.actividade@exemplo.pt";
const adminApi = (p, init) =>
  fetch(`${S}/auth/v1/admin/users${p}`, {
    ...init,
    headers: { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });

async function limpar() {
  await db.query(`DELETE FROM "Announcement" WHERE title LIKE 'ZZ %'`);
  await db.query(`DELETE FROM "PlatformAdmin" WHERE email = $1`, [EMAIL]);
  const lista = await (await adminApi(`?page=1&per_page=200`)).json();
  const antigo = (lista.users ?? []).find((u) => u.email === EMAIL);
  if (antigo) await adminApi(`/${antigo.id}`, { method: "DELETE" });
}
await limpar();

const criado = await (
  await adminApi("", { method: "POST", body: JSON.stringify({ email: EMAIL, password: "academia2026", email_confirm: true }) })
).json();
if (!criado.id) throw new Error("supabase: " + JSON.stringify(criado));
await db.query(
  `INSERT INTO "PlatformAdmin" (id, "authId", email, name, role, "isActive", "createdAt", "updatedAt")
   VALUES ('zz_admin_actividade', $1, $2, 'ZZ Admin Actividade', 'OWNER', true, NOW(), NOW())`,
  [criado.id, EMAIL],
);

const plataforma = await login(EMAIL);
const ler = async (qs = "") =>
  (await fetch(`${API}/api/platform/activity${qs}`, { headers: { Authorization: `Bearer ${plataforma}` } })).json();

try {
  console.log("=== A forma da série ===");
  const serie = await ler("?weeks=12");
  check("responde com uma lista", Array.isArray(serie), JSON.stringify(serie).slice(0, 100));
  check("com doze semanas", serie.length === 12, `${serie.length}`);
  check("cada uma com semana, pessoas, academias e acções",
    serie.every((p) => "week" in p && typeof p.people === "number" && typeof p.academies === "number" && typeof p.actions === "number"),
    JSON.stringify(serie[0]));

  /*
   * Sem buracos: `generate_series` produz todas as semanas, mesmo as vazias. Uma
   * semana em falta faria o gráfico encolher a distância entre duas barras e
   * mentir sobre a forma — que é a única coisa que um gráfico destes tem para dar.
   */
  const semanas = serie.map((p) => new Date(p.week + "T00:00:00Z").getTime());
  const espacadas = semanas.every((t, i) => i === 0 || t - semanas[i - 1] === 7 * 86_400_000);
  check("sem buracos entre semanas", espacadas, serie.map((p) => p.week).join(" "));

  const ultima = new Date(serie[serie.length - 1].week + "T00:00:00Z");
  const diasAtras = Math.floor((Date.now() - ultima.getTime()) / 86_400_000);
  check("e a última é a semana corrente", diasAtras >= 0 && diasAtras < 7, `${diasAtras} dias atrás`);

  console.log("\n=== A data é um rótulo, não um instante ===");
  /*
   * O bug que se via no ecrã: o eixo dizia `NaN/8`.
   *
   * `week` era uma coluna `date`, e o driver lê isso como meia-noite **local** —
   * chegava ao browser como `2026-08-09T23:00:00.000Z`. O eixo partia a cadeia
   * pelos hífenes e o dia dava `NaN`. E, de caminho, a segunda-feira 10 aparecia
   * como dia 9 a quem estivesse noutro fuso.
   */
  check(
    "vem como YYYY-MM-DD e nada mais",
    serie.every((p) => /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(p.week)),
    JSON.stringify(serie.slice(0, 2).map((p) => p.week)),
  );
  // O rótulo do eixo, calculado como o cliente o calcula.
  const rotulo = (ymd) => `${Number(ymd.slice(8, 10))}/${Number(ymd.slice(5, 7))}`;
  check("e o rótulo do eixo sai legível", serie.every((p) => !rotulo(p.week).includes("NaN")), serie.map((p) => rotulo(p.week)).join(" "));
  check("com o dia certo — segunda-feira", serie.every((p) => new Date(p.week + "T00:00:00Z").getUTCDay() === 1), serie.map((p) => p.week).join(" "));

  console.log("\n=== E o mesmo na série mensal ===");
  const meses = await (await fetch(`${API}/api/platform/series?months=3`, { headers: { Authorization: `Bearer ${plataforma}` } })).json();
  check("os meses vêm como YYYY-MM", meses.every((m) => /^[0-9]{4}-[0-9]{2}$/.test(m.month)), JSON.stringify(meses.map((m) => m.month)));

  console.log("\n=== Uma acção nova aparece ===");
  const antes = serie[serie.length - 1];

  const academia = (await db.query(`SELECT id FROM "Academy" WHERE slug = 'life-club'`)).rows[0].id;
  const autor = (await db.query(
    `SELECT m.id FROM "Membership" m JOIN "User" u ON u.id = m."userId"
      WHERE m."academyId" = $1 AND u.email = 'direcao@lifeclub.pt'`,
    [academia],
  )).rows[0].id;

  const comunicado = (titulo) =>
    db.query(
      `INSERT INTO "Announcement" (id, "academyId", "authorId", title, body, audience, "createdAt")
       VALUES (gen_random_uuid()::text, $1, $2, $3, 'ZZ corpo', '{"kind":"guardians"}'::jsonb, NOW())`,
      [academia, autor, titulo],
    );

  await comunicado("ZZ Comunicado Um");
  const depois = (await ler("?weeks=12")).at(-1);
  check("a acção conta na semana corrente", depois.actions === antes.actions + 1, `${antes.actions} → ${depois.actions}`);
  check("e a academia aparece", depois.academies >= antes.academies, `${antes.academies} → ${depois.academies}`);

  console.log("\n=== A mesma pessoa duas vezes é uma pessoa ===");
  /*
   * É a distinção que dá sentido ao gráfico: as barras contam **quem**, a linha
   * conta **quanto**. Sem isto, um treinador a fechar trinta presenças aparecia
   * como trinta pessoas e o painel dizia que o produto tinha trinta utilizadores.
   */
  const pessoasAntes = depois.people;
  await comunicado("ZZ Comunicado Dois");
  const terceiro = (await ler("?weeks=12")).at(-1);
  check("as acções sobem", terceiro.actions === depois.actions + 1, `${depois.actions} → ${terceiro.actions}`);
  check("mas as pessoas não", terceiro.people === pessoasAntes, `${pessoasAntes} → ${terceiro.people}`);

  console.log("\n=== Só conta trabalho ===");
  /*
   * A presença ao vivo não entra aqui de propósito: abrir a app não é trabalho.
   * Um `POST /api/presence` marca alguém como online e não deve mexer no gráfico.
   */
  const direcao = await login("direcao@lifeclub.pt");
  await fetch(`${API}/api/presence`, { method: "POST", headers: { Authorization: `Bearer ${direcao}`, "x-academy-slug": "life-club" } });
  const depoisDoPing = (await ler("?weeks=12")).at(-1);
  check("abrir a app não conta como acção", depoisDoPing.actions === terceiro.actions, `${terceiro.actions} → ${depoisDoPing.actions}`);

  console.log("\n=== O período é configurável e tem tecto ===");
  check("aceita quatro semanas", (await ler("?weeks=4")).length === 4, "");
  check("e trava nas 52", (await ler("?weeks=999")).length === 52, "");

  console.log("\n=== Fechado a quem não é da plataforma ===");
  const semSessao = await fetch(`${API}/api/platform/activity`);
  check("sem token, recusa", semSessao.status === 401 || semSessao.status === 403, `${semSessao.status}`);
  const comSessaoDeClube = await fetch(`${API}/api/platform/activity`, {
    headers: { Authorization: `Bearer ${direcao}` },
  });
  check("com sessão de clube, recusa", comSessaoDeClube.status === 401 || comSessaoDeClube.status === 403, `${comSessaoDeClube.status}`);
} finally {
  console.log("\n=== Limpeza ===");
  await limpar();
  await db.end();
  console.log("  feito");
}

console.log(`\n${ok} passaram, ${bad} falharam`);
process.exit(bad === 0 ? 0 : 1);

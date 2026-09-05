#!/usr/bin/env node
/**
 * A mesma conta com vários vínculos ao mesmo clube.
 *
 * ## O que estava partido
 *
 * Um treinador que também é pai (e sócio) tentava entrar na consola pela página
 * do clube e era mandado embora com *"As famílias entram pela aplicação"*.
 *
 * A porta lia **a primeira** membership que o Postgres devolvesse:
 *
 *     var here = (me.academies || []).filter(a => a.slug === slug)[0];
 *     if (here.role === 'GUARDIAN') fail(...)
 *
 * `app.resolve_memberships` não tem `ORDER BY` nenhum. Se calhasse vir primeiro
 * a de encarregado, a conta era recusada; na tentativa seguinte podia entrar. A
 * regra passou a ser "recusa-se quem **só** tem vínculo de família".
 *
 * Uso: node scripts/test-conta-com-varios-papeis.mjs
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const env = (k) => {
  const l = readFileSync(path.join(HERE, "..", ".env"), "utf8").split(/\r?\n/).find((x) => x.startsWith(k + "="));
  if (!l) throw new Error(`${k} não está em .env`);
  return l.slice(k.length + 1).trim().replace(/^"|"$/g, "");
};

const S = env("SUPABASE_URL").replace(/\/$/, "");
const A = env("SUPABASE_ANON_KEY");
const API = process.env.API_URL ?? "http://127.0.0.1:3000";
const SLUG = "life-club";
const AC = "acd_lifeclub";

let ok = 0, bad = 0;
const check = (l, c, d = "") => { if (c) { ok++; console.log("  OK    " + l); } else { bad++; console.log("  FALHA " + l + (d ? " — " + d : "")); } };

const db = new pg.Client({ connectionString: env("MIGRATE_DATABASE_URL"), ssl: { rejectUnauthorized: false } });
await db.connect();

/*
 * O pai semeado passa a ser **também** treinador — é exactamente o caso do
 * relato. A membership extra é criada aqui e apagada no fim; a de encarregado,
 * que é dados a sério, não se toca.
 */
const user = (await db.query(
  `SELECT u.id FROM "User" u WHERE u.email = 'familia@lifeclub.pt'`,
)).rows[0];
const extraId = `zz_ms_${Date.now().toString(36)}`;
await db.query(
  `INSERT INTO "Membership" (id, "academyId", "userId", role, "isActive", "updatedAt")
   VALUES ($1, $2, $3, 'COACH', true, now())`,
  [extraId, AC, user.id],
);

const token = (await (await fetch(`${S}/auth/v1/token?grant_type=password`, {
  method: "POST", headers: { apikey: A, "Content-Type": "application/json" },
  body: JSON.stringify({ email: "familia@lifeclub.pt", password: "academia2026" }),
})).json()).access_token;

/** A regra da porta, tal como a página a aplica agora. Ver `landing.template.ts`. */
const deixaEntrar = (academies, slug) => {
  const meus = (academies || []).filter((a) => a.slug === slug);
  if (meus.length === 0) return "sem-acesso";
  const daStaff = meus.filter((a) => a.role !== "GUARDIAN" && a.role !== "ATHLETE");
  return daStaff.length === 0 ? "so-familia" : "entra";
};

try {
  console.log("=== A conta tem os dois vínculos ===");
  const me = await (await fetch(`${API}/auth/memberships`, {
    headers: { Authorization: `Bearer ${token}` },
  })).json();
  const meus = (me.academies ?? []).filter((a) => a.slug === SLUG);
  console.table(meus.map((a) => ({ clube: a.slug, papel: a.role })));

  check("o endpoint devolve os dois papéis", meus.length === 2, JSON.stringify(meus.map((a) => a.role)));
  check("encarregado e treinador", ["GUARDIAN", "COACH"].every((r) => meus.some((a) => a.role === r)));

  console.log("\n=== A porta da consola ===");
  check("deixa entrar", deixaEntrar(me.academies, SLUG) === "entra", deixaEntrar(me.academies, SLUG));

  /*
   * E deixa entrar **independentemente da ordem**. É o ponto todo: a consulta
   * não ordena, e a porta antiga decidia por sorte. Prova-se com a lista ao
   * contrário, que é o caso que a recusava.
   */
  const aoContrario = { academies: [...(me.academies ?? [])].reverse() };
  check("mesmo com as linhas na ordem inversa", deixaEntrar(aoContrario.academies, SLUG) === "entra");

  /* A regra antiga, para mostrar que a ordem decidia. */
  const antiga = (academies) => {
    const primeiro = (academies || []).filter((a) => a.slug === SLUG)[0];
    return primeiro && (primeiro.role === "GUARDIAN" || primeiro.role === "ATHLETE") ? "so-familia" : "entra";
  };
  const ordens = [me.academies, aoContrario.academies].map(antiga);
  check(
    "e a regra antiga dava respostas diferentes conforme a ordem",
    new Set(ordens).size === 2,
    `as duas ordens deram ${ordens.join(" e ")} — se forem iguais, o caso não ficou provado`,
  );

  console.log("\n=== As duas portas servem a mesma conta ===");
  const comoQuem = async (app) => {
    const r = await fetch(`${API}/auth/me`, {
      headers: { Authorization: `Bearer ${token}`, "x-academy-slug": SLUG, "x-app": app },
    });
    return (await r.json().catch(() => ({}))).role;
  };
  check("com x-app: console entra como treinador", (await comoQuem("console")) === "COACH", await comoQuem("console"));
  check("com x-app: family entra como encarregado", (await comoQuem("family")) === "GUARDIAN", await comoQuem("family"));

  console.log("\n=== A página servida tem mesmo a regra nova ===");
  /*
   * A porta é JavaScript dentro de um template — o que corre é o HTML servido,
   * não o ficheiro. Lê-se a página a sério, para isto não passar por causa de
   * uma alteração que ficou por compilar.
   */
  const html = await (await fetch(`${API}/l/${SLUG}`)).text();
  check("a página do clube abre", html.length > 500, `${html.length} bytes`);
  check("aplica a regra nova", html.includes("daStaff"), "não encontrei o filtro de staff");
  check(
    "e já não decide pela primeira linha",
    !html.includes("a.slug === slug; })[0]"),
    "o filtro antigo com [0] ainda lá está",
  );
} finally {
  console.log("\n=== Limpeza ===");
  await db.query(`DELETE FROM "Membership" WHERE id = $1`, [extraId]);
  const sobrou = Number((await db.query(
    `SELECT count(*) FROM "Membership" WHERE id = $1`, [extraId],
  )).rows[0].count);
  check("a membership de teste foi removida", sobrou === 0, `${sobrou}`);
  await db.end();
}

console.log(`\n${ok} passaram, ${bad} falharam`);
process.exit(bad === 0 ? 0 : 1);

#!/usr/bin/env node
/**
 * Quantos adversários dos jogos marcados na plataforma têm emblema no diretório.
 *
 * Lê os nomes escritos à mão no campo "adversário" dos jogos de todos os
 * clubes e procura cada um em `KnownClub` como a consola procura (todas as
 * palavras, sem acentos). Diz os que não encontra, para se ver o que falta
 * às fontes ou ao emparelhamento.
 *
 * Só leitura, com `MIGRATE_DATABASE_URL` numa transação READ ONLY.
 * Uso: node scripts/emblemas-cobertura.mjs [--todos]
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
require("dotenv").config({ path: path.join(RAIZ, ".env"), quiet: true });
const { Client } = require("pg");
const TODOS = process.argv.includes("--todos");

/** A mesma regra do importador e da API: siglas com pontos juntas ("F.C." → "fc"). */
function fold(s) {
  const tokens = (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9.]+/g, " ").trim().split(" ").filter(Boolean);
  const letra = (t) => /^[a-z]\.?$/.test(t);
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    if (letra(tokens[i])) {
      let j = i;
      while (j < tokens.length && letra(tokens[j])) j++;
      if (j - i >= 2) { out.push(tokens.slice(i, j).map((t) => t[0]).join("")); i = j - 1; continue; }
    }
    out.push(tokens[i].replace(/\./g, ""));
  }
  return out.filter(Boolean).join(" ");
}
/** Sufixos de equipa e ruído que não fazem parte do nome do clube. */
const RUIDO = /\b(b|c|d|a|sad|sub ?\d+|s\d+|fem|feminina|feminino|juniores|iniciados|infantis|benjamins|juvenis|seniores|vs|e outros|jogo treino|basquetebol|futsal|basket|de|do|da|dos|das|e)\b/g;
const limpar = (s) => fold(s).replace(/['"«»]/g, " ").replace(RUIDO, " ").replace(/\s+/g, " ").trim();
/** As mesmas siglas da procura da API (`src/clubes/diretorio.service.ts`). */
const SIGLAS = {
  sc: ["sport clube", "sporting clube", "sport club", "sporting club", "sc"], fc: ["futebol clube", "football club", "fc"], cf: ["clube de futebol", "clube futebol", "cf"],
  cd: ["clube desportivo", "centro desportivo", "cd"], cdr: ["clube desportivo e recreativo", "clube desportivo recreativo", "cdr"], gd: ["grupo desportivo", "gd"],
  gdr: ["grupo desportivo e recreativo", "grupo desportivo recreativo", "gdr"], ad: ["associacao desportiva", "atletico desportivo", "ad"], ac: ["atletico clube", "associacao cultural", "ac"],
  ar: ["associacao recreativa", "ar"], ud: ["uniao desportiva", "ud"], uf: ["uniao futebol", "uniao de futebol", "uf"], cr: ["clube recreativo", "centro recreativo", "cr"],
  cb: ["clube de basquetebol", "clube basquetebol", "cb"], ccd: ["centro cultural e desportivo", "centro cultural desportivo", "ccd"], acd: ["associacao cultural e desportiva", "associacao cultural desportiva", "acd"],
  acr: ["associacao cultural e recreativa", "associacao cultural recreativa", "acr"], adr: ["associacao desportiva e recreativa", "associacao desportiva recreativa", "adr"], afc: ["associacao futebol clube", "atletico futebol clube", "afc"],
  scp: ["sporting clube de portugal", "sporting"], slb: ["sport lisboa e benfica", "benfica"], fcp: ["futebol clube do porto", "fc porto"],
};

const db = new Client({ connectionString: (process.env.MIGRATE_DATABASE_URL ?? "").replace(/[?&]pgbouncer=true/, ""), ssl: { rejectUnauthorized: false } });
await db.connect();
try {
  await db.query("BEGIN TRANSACTION READ ONLY");
  const adversarios = (await db.query(`SELECT a.slug, m.opponent, count(*)::int AS n FROM "Match" m JOIN "Academy" a ON a.id = m."academyId" GROUP BY a.slug, m.opponent ORDER BY a.slug, n DESC`)).rows;
  const clubes = (await db.query(`SELECT id, name, "shortName", "normalizedName", region, "logoKey" IS NOT NULL AS emblema FROM "KnownClub"`)).rows;
  const lixo = (o) => limpar(o).length < 3 || /^(teste|exemplo|asd|asda|uyi|xsa|a definir|varios|ponte)$/.test(limpar(o));

  let encontrados = 0, comEmblema = 0, total = 0;
  const falhados = [];
  for (const a of adversarios) {
    if (lixo(a.opponent)) continue;
    total++;
    const termo = limpar(a.opponent);
    const palavras = termo.split(" ").filter((p) => p.length > 1).map((p) => SIGLAS[p] ?? [p]);
    const candidatos = clubes.filter((c) => palavras.every((alts) => alts.some((p) => c.normalizedName.includes(p) || fold(c.shortName ?? "").includes(p))));
    // O mais curto que bate é o mais provável ("braga" → "Sporting Clube de Braga" antes de "Braga Futebol Clube de Veteranos").
    const melhor = candidatos.sort((x, y) => (y.emblema ? 1 : 0) - (x.emblema ? 1 : 0) || x.name.length - y.name.length)[0];
    if (melhor) {
      encontrados++;
      if (melhor.emblema) comEmblema++;
      if (TODOS) console.log(`  ${a.slug} | ${a.opponent} → ${melhor.name}${melhor.emblema ? "" : " (sem emblema)"}`);
    } else falhados.push(`${a.slug} | ${a.opponent} (${a.n})`);
  }
  console.log(`adversários distintos (sem lixo): ${total}; encontrados no diretório: ${encontrados}; com emblema: ${comEmblema}`);
  console.log(`\nsem correspondência (${falhados.length}):`);
  for (const f of falhados) console.log("  " + f);
} finally {
  await db.query("ROLLBACK").catch(() => {});
  await db.end();
}

#!/usr/bin/env node
/**
 * A plataforma sobrevive a uma função SQL que muda de forma.
 *
 * ## O erro que isto reproduz
 *
 * Em produção, a migração `plano_por_academia` acrescentou a coluna `plan_id` ao
 * `RETURNS TABLE` de `app.platform_academies()`. As ligações que já estavam
 * abertas continuaram com o plano da forma antiga em cache, e o Postgres
 * recusou-se a executá-lo:
 *
 *     0A000 — cached plan must not change result type
 *
 * A partir daí a plataforma inteira ficou em erro — a visão geral e a lista de
 * academias passam ambas pela mesma função — e não se curava sozinha: cada
 * pedido apanhava uma ligação do mesmo lote, com o mesmo plano velho.
 *
 * ## O que se prova aqui
 *
 *  1. o erro acontece mesmo, com a função real e uma ligação Prisma como a do
 *     servidor;
 *  2. **repetir não chega** — a mesma declaração preparada volta a falhar;
 *  3. `resiliente` recupera à primeira, sem intervenção.
 *
 * Não precisa da API a correr: fala directamente com a base, que é onde o
 * problema vive.
 *
 * Uso: node scripts/test-plano-em-cache.mjs
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { PlatformPrisma } from "../dist/platform/platform.prisma.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const env = (k) => {
  const l = readFileSync(path.join(HERE, "..", ".env"), "utf8").split("\n").find((x) => x.startsWith(k + "="));
  if (!l) throw new Error(`${k} não está em .env`);
  return l.slice(k.length + 1).trim().replace(/^"|"$/g, "");
};

let ok = 0, bad = 0;
const check = (l, c, d = "") => {
  if (c) { ok++; console.log("  OK    " + l); }
  else { bad++; console.log("  FALHA " + l + (d ? " — " + d : "")); }
};

// `PLATFORM_DATABASE_URL` é opcional — sem ela, `PlatformPrisma` cai para a de
// migração, tal como em produção.
const opcional = (k) => { try { return env(k); } catch { return null; } };
const url = opcional("PLATFORM_DATABASE_URL") ?? env("MIGRATE_DATABASE_URL");
process.env.PLATFORM_DATABASE_URL = url;

/** A ligação do servidor, tal e qual. */
const plataforma = new PlatformPrisma();
/** Uma ligação à parte, no papel da migração que corre durante o deploy. */
const deploy = new PrismaClient({ datasources: { db: { url } } });

/*
 * Uma função de teste com o mesmo desenho da real: `RETURNS TABLE`, chamada com
 * `SELECT *`. Não se mexe em `app.platform_academies()` — é a função de que a
 * plataforma depende, e partir a real para provar um ponto era exactamente o
 * tipo de coisa que este teste existe para evitar.
 */
const criar = (colunas, corpo) =>
  deploy.$executeRawUnsafe(
    `CREATE FUNCTION app.zz_cache() RETURNS TABLE (${colunas}) LANGUAGE sql STABLE AS $$ ${corpo} $$`,
  );
const largar = () => deploy.$executeRawUnsafe(`DROP FUNCTION IF EXISTS app.zz_cache()`);

const ler = () => plataforma.$queryRawUnsafe(`SELECT * FROM app.zz_cache()`);

try {
  await largar();
  await criar("a int", "SELECT 1");

  console.log("=== Antes do deploy ===");
  const antes = await ler();
  check("a leitura funciona e fica com o plano em cache", antes.length === 1 && antes[0].a === 1, JSON.stringify(antes));

  console.log("\n=== O deploy muda a forma da função ===");
  await largar();
  await criar("a int, b int", "SELECT 1, 2");
  check("a função passou a devolver duas colunas", true);

  console.log("\n=== Sem protecção, parte — e continua partida ===");
  let primeira = null, segunda = null;
  try { await ler(); } catch (e) { primeira = e; }
  check("a leitura seguinte falha com 0A000", primeira?.meta?.code === "0A000", primeira?.meta?.code ?? "não falhou");
  /*
   * O ponto que decidiu a solução: o Postgres **não** deita fora o plano ao
   * falhar. Uma repetição simples — que é o primeiro instinto — não resolve
   * nada, e teria dado um servidor que tenta duas vezes e falha na mesma.
   */
  try { await ler(); } catch (e) { segunda = e; }
  check("e repetir volta a falhar — repetir não é solução", segunda?.meta?.code === "0A000", segunda?.meta?.code ?? "passou");

  console.log("\n=== Com `resiliente`, recupera sozinha ===");
  const recuperada = await plataforma.resiliente(() => ler());
  check("a leitura passa", recuperada.length === 1, JSON.stringify(recuperada));
  check("e traz a coluna nova", recuperada[0].b === 2, JSON.stringify(recuperada[0]));

  console.log("\n=== E continua a funcionar depois disso ===");
  const outra = await plataforma.resiliente(() => ler());
  check("a leitura seguinte não precisa de reconectar", outra[0].b === 2, JSON.stringify(outra[0]));

  console.log("\n=== Um erro que não é do plano sobe na mesma ===");
  /*
   * `resiliente` só trata do 0A000. Alargá-la a todos os `P2010` fazia com que um
   * erro de sintaxe reconectasse a base e falhasse à mesma — a esconder a causa
   * atrás de uma reconexão.
   */
  let outroErro = null;
  try {
    await plataforma.resiliente(() => plataforma.$queryRawUnsafe(`SELECT * FROM app.nao_existe_de_certeza()`));
  } catch (e) {
    outroErro = e;
  }
  check("um erro diferente é relançado", outroErro !== null, "");
  check("e não é confundido com o do plano", outroErro?.meta?.code !== "0A000", `${outroErro?.meta?.code}`);

  console.log("\n=== A função real continua intacta ===");
  const reais = await plataforma.resiliente(
    () => plataforma.$queryRawUnsafe(`SELECT * FROM app.platform_academies()`),
  );
  check("`platform_academies()` responde", Array.isArray(reais) && reais.length > 0, `${reais?.length}`);
  check("com a coluna que a migração acrescentou", "plan_id" in (reais[0] ?? {}), Object.keys(reais[0] ?? {}).join(","));
} finally {
  console.log("\n=== Limpeza ===");
  await largar();
  await plataforma.$disconnect();
  await deploy.$disconnect();
  console.log("  feito");
}

console.log(`\n${ok} passaram, ${bad} falharam`);
process.exit(bad === 0 ? 0 : 1);

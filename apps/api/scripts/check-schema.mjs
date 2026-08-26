#!/usr/bin/env node
/**
 * A base de dados concorda com o `schema.prisma`?
 *
 * ## Porque é que isto existe
 *
 * Porque um dia mudou-se o `schema.prisma` (`Team.ageGroup` passou a
 * `Team.maxAge`), escreveu-se a migração, e **não se correu**. O código passou a
 * pedir uma coluna que a base não tinha; a leitura de equipas rebentava; e sem
 * equipas a consola ficava sem atletas, sem treinos e sem jogos — um ecrã vazio,
 * sem erro visível, que parecia perda de dados e não era.
 *
 * Nenhum teste apanhava isso, porque todos os outros precisam do servidor a
 * responder. Este não precisa de nada: pergunta à base como ela está e compara
 * com o que o código espera.
 *
 * ## O que faz
 *
 * `prisma migrate diff` entre a **base a correr** e o **modelo do código**. Se
 * houver diferença, há migração por aplicar (ou aplicada a meio) e isto falha
 * com o SQL que faltava — que é exactamente o que é preciso ver para decidir.
 *
 * Uso: npm run check:schema
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const API = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const run = spawnSync(
  "npx",
  [
    "prisma",
    "migrate",
    "diff",
    // De: a base de dados a correr, tal como está agora.
    "--from-schema-datasource",
    "prisma/schema.prisma",
    // Para: o modelo que o código espera.
    "--to-schema-datamodel",
    "prisma/schema.prisma",
    "--script",
    // 0 = iguais, 2 = há diferenças. Sem isto, o comando é sempre bem-sucedido.
    "--exit-code",
  ],
  { cwd: API, encoding: "utf8", shell: process.platform === "win32" },
);

if (run.error) {
  console.error(`Não foi possível correr o prisma: ${run.error.message}`);
  process.exit(1);
}

if (run.status === 0) {
  console.log("  OK  a base de dados corresponde ao schema.prisma");
  process.exit(0);
}

if (run.status === 2) {
  console.error("\n  FALHA  a base de dados NÃO corresponde ao schema.prisma\n");
  console.error("  O SQL que faria a base ficar igual ao schema:\n");
  console.error(
    (run.stdout ?? "")
      .split("\n")
      .map((l) => `    ${l}`)
      .join("\n"),
  );
  /*
   * Duas causas, e a diferença importa.
   *
   * Este SQL não é uma receita para correr às cegas: é a descrição da
   * diferença. Da primeira vez que isto correu a sério, metade do que
   * apareceu aqui era a **base** a estar certa e o schema a estar
   * incompleto — dois índices criados por migrações antigas que ninguém
   * tinha declarado. Aplicar o SQL proposto tê-los-ia largado, e as
   * consultas que eles servem passavam a varrer a tabela inteira.
   */
  console.error(`
  Antes de resolver, ler o SQL e decidir de que lado está o erro:

    · falta uma migração  →  npx prisma migrate deploy
    · o schema.prisma é que está incompleto (índices e colunas que já existem
      na base e nunca foram declarados)  →  declarar no schema, sem tocar na base
    · a base tem restos que nenhuma migração largou  →  escrever uma migração

  Um DROP proposto aqui pode ser uma coluna com dados. Verificar antes.
`);
  process.exit(1);
}

console.error(`  ERRO  o prisma saiu com ${run.status}`);
console.error(run.stderr || run.stdout);
process.exit(1);

#!/usr/bin/env node
/**
 * Uma permissão nova chegou aos cargos que já existem?
 *
 * ## Porque é que isto existe
 *
 * Porque os cargos guardam permissões **resolvidas**. `AcademyRole.permissions`
 * é uma fotografia do mapa em código, tirada no dia em que o cargo nasceu — e é
 * essa lista que manda (`basePermissions`), não o mapa. Acrescentar uma
 * permissão ao código dá-a a quem **não tem cargo**, e a mais ninguém.
 *
 * Quem não tem cargo é a academia de demonstração. Quem tem cargo são todos os
 * clubes a sério. O resultado é a pior forma de falhar que este produto tem: os
 * testes passam, a demonstração funciona, e a funcionalidade está morta em
 * produção — sem erro nenhum, só um botão que não aparece.
 *
 * Já aconteceu duas vezes. À segunda (`team:delete`), o presidente de um clube
 * abriu a ficha de uma equipa, não viu o botão de apagar, e foi ele que teve de
 * o dizer — com 24 dos 26 cargos de topo da base sem a permissão.
 *
 * ## O que faz
 *
 * Lê as permissões declaradas em `src/common/permissions.ts` e exige que cada
 * uma esteja em `prisma/permissoes-distribuidas.json`, apontada à migração que a
 * levou aos cargos antigos — ou com a razão escrita de não ter ido.
 *
 * Não verifica a base de dados: corre sem ligação nenhuma, em qualquer máquina,
 * e falha no momento em que a permissão é escrita, que é quando a migração ainda
 * é fácil de escrever. Uma verificação contra a base só falharia depois do
 * deploy — tarde de mais.
 *
 * Uso: npm run check:perms
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.join(HERE, "..");

const fonte = readFileSync(path.join(RAIZ, "src/common/permissions.ts"), "utf8");
const manifesto = JSON.parse(readFileSync(path.join(RAIZ, "prisma/permissoes-distribuidas.json"), "utf8"));

/*
 * O bloco da união de tipos, e só ele.
 *
 * Fora dele há literais com dois pontos por todo o lado — chaves de menu,
 * exemplos em comentários, mensagens — e apanhá-los fazia o guarda queixar-se de
 * permissões que não existem.
 *
 * A união acaba na primeira **linha** que fecha com `;`, e não no primeiro `;`
 * do ficheiro: os comentários de cada permissão citam caminhos como
 * `permissions.ts`);` lá dentro, e cortar aí deixava metade das permissões de
 * fora — que foi exactamente o que aconteceu à primeira tentativa deste guarda.
 */
const linhas = fonte.split("\n");
const primeira = linhas.findIndex((l) => l.startsWith("export type Permission ="));
if (primeira < 0) {
  console.error("  ERRO  não encontrei `export type Permission =` em src/common/permissions.ts");
  process.exit(1);
}
const ultima = linhas.findIndex((l, i) => i > primeira && l.trimEnd().endsWith(";"));
if (ultima < 0) {
  console.error("  ERRO  não encontrei o fim da união de `Permission`");
  process.exit(1);
}
const bloco = linhas.slice(primeira, ultima + 1).join("\n");

const declaradas = [...new Set([...bloco.matchAll(/"([a-z]+:[a-z:]+)"/g)].map((m) => m[1]))].sort();
const conhecidas = new Set(Object.keys(manifesto).filter((k) => !k.startsWith("_")));

const semRegisto = declaradas.filter((p) => !conhecidas.has(p));
// As que estão no manifesto e já não existem no código: lixo que engana quem ler.
const orfas = [...conhecidas].filter((p) => !declaradas.includes(p));

if (semRegisto.length === 0 && orfas.length === 0) {
  console.log(`  OK  ${declaradas.length} permissões — todas com destino conhecido nos cargos já criados.`);
  process.exit(0);
}

if (semRegisto.length > 0) {
  console.error(`\n  FALHA  ${semRegisto.length} permissão(ões) sem registo de distribuição:\n`);
  for (const p of semRegisto) console.error(`    · ${p}`);
  console.error(`
  Os cargos que já existem guardam a lista de permissões que tinham no dia em
  que nasceram. Uma permissão nova não lhes chega sozinha — chega a quem não tem
  cargo, e mais ninguém.

  Escolhe uma das duas:

  1. Escreve a migração que a leva aos cargos antigos (copia
     prisma/migrations/20260831120000_apagar_equipa_nos_cargos) e regista-a em
     prisma/permissoes-distribuidas.json.

  2. Se de propósito não deve ir a ninguém, escreve a razão nesse ficheiro, no
     lugar do nome da migração. Fica no repositório em vez de na cabeça de
     alguém.
`);
}

if (orfas.length > 0) {
  console.error(`  FALHA  ${orfas.length} no manifesto que já não existem no código: ${orfas.join(", ")}`);
  console.error("  Tira-as de prisma/permissoes-distribuidas.json — um manifesto desactualizado não se lê.\n");
}

process.exit(1);

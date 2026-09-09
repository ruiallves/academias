#!/usr/bin/env node
/**
 * Toda a permissão tem de ser dável e tirável por alguém.
 *
 * ## Porque é que isto existe
 *
 * Porque o mesmo buraco já apareceu **três vezes**, sempre igual e sempre em
 * silêncio:
 *
 *  1. `member:*` (Sócios) — nasceu com menu e ecrãs, ficou fora do catálogo de
 *     acessos. Um treinador que a tivesse herdado via Sócios para sempre, e
 *     ninguém encontrava o interruptor para lha tirar.
 *  2. `training:*` (Área técnica) — estava no catálogo do cliente e **não** na
 *     lista de delegáveis do servidor: o painel oferecia o interruptor, e
 *     gravar não gravava nada. Voltava atrás sem uma palavra.
 *  3. `inventory:*` e `finance:*` (Armazém e Contas) — fora dos dois. A direcção
 *     via os menus, queria dá-los a quem trata do material e da tesouraria, e
 *     não tinha por onde.
 *
 * O padrão é sempre o mesmo: escreve-se a permissão, verifica-se no servidor,
 * cria-se o menu — e esquece-se o catálogo que desenha os três editores de
 * acesso (cargos, departamentos e o painel de cada pessoa). Nada falha; o
 * interruptor apenas não existe.
 *
 * ## O que verifica
 *
 * Cada permissão declarada em `apps/api/src/common/permissions.ts` tem de estar:
 *
 *  - no catálogo do cliente (`apps/console/src/lib/access.ts`), que é o que
 *    desenha os editores; e
 *  - na lista `DELEGATABLE` do servidor, que é quem decide o que o painel de
 *    Acesso de uma pessoa aceita gravar.
 *
 * As excepções estão abaixo, cada uma com a razão escrita. Uma lista de
 * excepções sem porquê deixa de proteger no dia em que alguém lhe acrescenta
 * mais uma linha para calar o aviso.
 *
 * Uso: node scripts/check-access-catalog.mjs
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const ler = (p) => readFileSync(path.join(RAIZ, p), "utf8");

/* -------------------------------------------------------------------------- */
/* As excepções, e o porquê de cada uma                                        */
/* -------------------------------------------------------------------------- */

/** Fora do catálogo do cliente — não se mostram em editor nenhum. */
const FORA_DO_CATALOGO = {
  "academy:read":
    "É a fundação: sem ela não há consola nenhuma para configurar. Um interruptor que a desligasse trancava a pessoa fora do produto.",
  "academy:write":
    "Declarada e nunca verificada por serviço nenhum — não abre nada hoje. Entra no catálogo no dia em que algum endpoint a exigir.",
  "ai:read":
    "A Academias AI está construída mas o menu está escondido (ver AI_GROUP em nav.ts). Dar a permissão não abriria ecrã nenhum; entra quando o menu voltar.",
  "ai:write":
    "O par de `ai:read` — mesma razão.",
};

/** Fora da lista de delegáveis do servidor — não se dão pessoa a pessoa. */
const NAO_DELEGAVEIS = {
  "academy:read": "A fundação. Ver acima.",
  "academy:write": "Não abre nada hoje. Ver acima.",
  "ai:read": "Menu escondido. Ver acima.",
  "ai:write": "Menu escondido. Ver acima.",
  "access:write":
    "Quem a pudesse delegar fabricava outros gestores de acesso, e a delegação deixava de ter dono. Concede-se num cargo, com a hierarquia a travar a escalada.",
  "settings:write":
    "Mesma razão de `access:write`: é administração da academia, não uma área de trabalho.",
  "team:delete":
    "Destrutiva — leva treinos e jogos atrás. Vive num cargo, decidida uma vez, não numa excepção por pessoa.",
  "academy:delete":
    "A mais destrutiva que existe: apaga o clube inteiro. Nunca por excepção pontual.",
};

/* -------------------------------------------------------------------------- */

const fonte = ler("apps/api/src/common/permissions.ts");
const linhas = fonte.split("\n");
const primeira = linhas.findIndex((l) => l.startsWith("export type Permission ="));
const ultima = linhas.findIndex((l, i) => i > primeira && l.trimEnd().endsWith(";"));
if (primeira < 0 || ultima < 0) {
  console.error("  ERRO  não encontrei a união de `Permission` em common/permissions.ts");
  process.exit(1);
}
const bloco = linhas.slice(primeira, ultima + 1).join("\n");
const declaradas = [...new Set([...bloco.matchAll(/"([a-z]+:[a-z:]+)"/g)].map((m) => m[1]))].sort();

/* O catálogo do cliente: `read:` e `write:` das áreas. */
const acesso = ler("apps/console/src/lib/access.ts");
const noCatalogo = new Set([...acesso.matchAll(/(?:read|write):\s*"([a-z]+:[a-z:]+)"/g)].map((m) => m[1]));

/* A lista de delegáveis do servidor. */
const servico = ler("apps/api/src/academy/academy.service.ts");
const inicioSet = servico.indexOf("const DELEGATABLE");
const fimSet = servico.indexOf("]);", inicioSet);
if (inicioSet < 0 || fimSet < 0) {
  console.error("  ERRO  não encontrei `DELEGATABLE` em academy.service.ts");
  process.exit(1);
}
const delegaveis = new Set(
  [...servico.slice(inicioSet, fimSet).matchAll(/"([a-z]+:[a-z:]+)"/g)].map((m) => m[1]),
);

const problemas = [];

for (const p of declaradas) {
  if (!noCatalogo.has(p) && !(p in FORA_DO_CATALOGO)) {
    problemas.push(
      `${p} — não está em apps/console/src/lib/access.ts.\n` +
        `      Ninguém a consegue dar nem tirar: os três editores de acesso (cargos,\n` +
        `      departamentos e o painel de cada pessoa) são desenhados a partir desse catálogo.`,
    );
  }
  if (!delegaveis.has(p) && !(p in NAO_DELEGAVEIS)) {
    problemas.push(
      `${p} — não está em DELEGATABLE (apps/api/src/academy/academy.service.ts).\n` +
        `      O painel de Acesso de uma pessoa vai oferecer o interruptor e o servidor\n` +
        `      deita a permissão fora em silêncio — foi o que aconteceu com training:*.`,
    );
  }
}

/* Excepções que já não fazem sentido: a permissão entrou no catálogo, ou deixou
   de existir. Uma lista desactualizada é uma lista que ninguém volta a ler. */
for (const [p, _porque] of Object.entries(FORA_DO_CATALOGO)) {
  if (!declaradas.includes(p)) problemas.push(`${p} — está nas excepções de catálogo e já não existe no código.`);
  else if (noCatalogo.has(p)) problemas.push(`${p} — está nas excepções de catálogo **e** no catálogo. Tira-a das excepções.`);
}
for (const [p, _porque] of Object.entries(NAO_DELEGAVEIS)) {
  if (!declaradas.includes(p)) problemas.push(`${p} — está nas excepções de delegação e já não existe no código.`);
  else if (delegaveis.has(p)) problemas.push(`${p} — está nas excepções de delegação **e** em DELEGATABLE. Tira-a das excepções.`);
}

if (problemas.length === 0) {
  console.log(`  OK  ${declaradas.length} permissões — todas com interruptor, ou com a excepção escrita.`);
  process.exit(0);
}

console.error(`\n  FALHA  ${problemas.length} problema(s) no catálogo de acessos:\n`);
for (const p of problemas) console.error(`    · ${p}\n`);
console.error(`  Uma permissão que não está nestes catálogos é uma permissão sem dono: existe,
  comanda um menu, e ninguém a consegue dar nem tirar. Se for de propósito,
  escreve a razão em scripts/check-access-catalog.mjs — no repositório, e não na
  cabeça de alguém.\n`);
process.exit(1);

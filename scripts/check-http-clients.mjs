#!/usr/bin/env node
/**
 * Ninguém fala com a API por fora.
 *
 * ## O bug que deu origem a isto
 *
 * `lib/callups.ts` tinha um cliente HTTP próprio — base, cabeçalhos e leitura da
 * sessão, tudo copiado. A sessão mudou-se de `sessionStorage` para
 * `localStorage` há muito, o `lib/http.ts` acompanhou, e esta cópia ficou para
 * trás a ler um sítio vazio: **submeter uma convocatória ia sem token**, e o
 * servidor respondia "Falta o token de sessão". Ninguém deu por nada até um
 * clube tentar submeter.
 *
 * O problema não foi o nome do armazenamento. Foi haver dois sítios a saber a
 * mesma coisa — e o segundo não acompanhar quando a primeira mudou. Desde então
 * o `http.ts` ganhou mais responsabilidades (renovar o token, repetir no 401,
 * declarar o `x-app`), e cada cópia paralela é tudo isso a menos, em silêncio.
 *
 * Esta verificação é a rede: falha o CI quando alguém volta a criar um segundo
 * cliente, em vez de se descobrir em produção.
 *
 * ## O que é uma excepção legítima
 *
 * Carregar um ficheiro **directamente para o Supabase** com um endereço assinado
 * — é o desenho de propósito ("os bytes não passam pela API", ver
 * `photos.service.ts`) e não leva sessão nossa nenhuma. E os endpoints públicos
 * de convite, que existem precisamente para quem ainda não tem conta.
 *
 * Cada excepção está listada abaixo com o seu porquê. Uma lista que cresça sem
 * razão escrita é uma lista que deixou de proteger.
 *
 * Uso: node scripts/check-http-clients.mjs
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Os únicos ficheiros que podem falar com a nossa API. */
const CLIENTES = ["apps/console/src/lib/http.ts", "apps/family/src/lib/http.ts", "apps/platform/src/lib/http.ts"];

/** O único ficheiro de cada app que pode ler a sessão do armazenamento. */
const SESSOES = [
  "apps/console/src/lib/session.ts",
  "apps/family/src/lib/session.ts",
  "apps/platform/src/lib/session.ts",
];

/**
 * `fetch` que não vai à nossa API — cada um com a razão de existir.
 *
 * O caminho é o prefixo; a razão é para quem vier a seguir perceber sem ter de
 * abrir o ficheiro.
 */
const EXCEPCOES = [
  ["apps/console/src/lib/photos.ts", "carrega a fotografia directamente para o Supabase, com endereço assinado"],
  ["apps/console/src/lib/training.ts", "carrega a imagem do exercício directamente para o Supabase"],
  ["apps/console/src/components/IdentityPanel.tsx", "carrega o símbolo do clube directamente para o Supabase"],
  ["apps/platform/src/components/NewAcademyDialog.tsx", "carrega o símbolo directamente para o Supabase"],
  ["apps/platform/src/components/LoginGate.tsx", "autentica contra o Supabase — a nossa API não intermedeia logins"],
  ["apps/family/src/lib/push.ts", "usa `getAccessToken()` e o slug da app; é o caminho da subscrição push"],
  ["apps/family/src/screens/Entrar.tsx", "convite de família: endpoints públicos, de quem ainda não tem conta"],
];

const ficheiros = [];
function varrer(dir) {
  for (const nome of readdirSync(dir)) {
    if (nome === "node_modules" || nome === "dist" || nome.startsWith(".")) continue;
    const completo = path.join(dir, nome);
    if (statSync(completo).isDirectory()) varrer(completo);
    else if (/\.(ts|tsx)$/.test(nome)) ficheiros.push(completo);
  }
}
for (const app of ["console", "family", "platform"]) {
  const dir = path.join(RAIZ, "apps", app, "src");
  try {
    varrer(dir);
  } catch {
    /* app que não exista neste momento — não é motivo para falhar */
  }
}

const problemas = [];
const relativo = (f) => path.relative(RAIZ, f).replace(/\\/g, "/");

for (const ficheiro of ficheiros) {
  const rel = relativo(ficheiro);
  const texto = readFileSync(ficheiro, "utf8");
  const linhas = texto.split("\n");

  const eCliente = CLIENTES.includes(rel);
  const eSessao = SESSOES.includes(rel);
  const excepcao = EXCEPCOES.find(([caminho]) => rel === caminho);

  linhas.forEach((linha, i) => {
    const n = i + 1;

    /* ---- Regra 1: um `fetch` para a nossa API só a partir do cliente ---- */
    if (!eCliente && !excepcao && /\bfetch\s*\(/.test(linha)) {
      // O alvo pode estar nesta linha ou na seguinte; olha-se para as duas.
      const alvo = linha + "\n" + (linhas[i + 1] ?? "");
      if (/\/api\//.test(alvo) || /\$\{(BASE|API)\}/.test(alvo)) {
        problemas.push(
          `${rel}:${n} — fala com a API por fora. Usa \`apiGet\`/\`apiPost\`/… de lib/http.ts,\n` +
            `      que trata da sessão, da renovação do token e da repetição no 401.`,
        );
      }
    }

    /* ---- Regra 2: a sessão lê-se pelo `session.ts`, e mais nada ---- */
    if (!eSessao && /(session|Storage)\.getItem\s*\(\s*["'`][^"'`]*session/i.test(linha)) {
      problemas.push(
        `${rel}:${n} — lê a sessão do armazenamento à mão. Usa \`readSession()\` /\n` +
          `      \`getAccessToken()\` de lib/session.ts: foi assim que a convocatória\n` +
          `      ficou a ler um \`sessionStorage\` vazio depois de a sessão se mudar.`,
      );
    }
  });
}

if (problemas.length > 0) {
  console.log("Clientes HTTP paralelos ou leituras de sessão à mão:\n");
  for (const p of problemas) console.log("  " + p + "\n");
  console.log(`${problemas.length} problema(s). Ver o cabeçalho de scripts/check-http-clients.mjs.`);
  process.exit(1);
}

console.log(`  OK  ${ficheiros.length} ficheiros — ninguém fala com a API por fora, ninguém lê a sessão à mão.`);

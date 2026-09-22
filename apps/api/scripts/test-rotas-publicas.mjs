#!/usr/bin/env node
/**
 * Toda a rota pública na raiz do clube tem a sua reescrita no `TenantMiddleware`.
 *
 * O `linkFor` de cada convite monta o endereço na **raiz** do domínio do clube
 * (`{slug}.academias.pt/atleta/:token`, `/socio/:token`, `/familia/:token`, …), e
 * a rota que existe do outro lado é sempre `/l/:slug/…`. Quem os liga é uma linha
 * no `TenantMiddleware`. Já falhou quatro vezes — `/ser-socio`, `/socio`, `/atleta`
 * — sempre igual: nasce um endereço público novo, ninguém acrescenta a linha, e o
 * link do email dá `Cannot GET /…`.
 *
 * Esta é a rede que faltava. Lê o middleware verdadeiro e confirma que cada
 * caminho público conhecido tem lá o seu padrão de reescrita. É uma verificação de
 * fonte de propósito: o bug é sempre "faltou a linha", e é a presença da linha que
 * se garante. Ao contrário: apaga-se a linha do `/atleta/` e este teste falha.
 *
 * Quando nascer um convite público novo, junta-se o caminho a `PUBLICOS` aqui **e**
 * a reescrita no middleware — as duas na mesma alteração.
 *
 * Uso: node scripts/test-rotas-publicas.mjs
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fonte = readFileSync(path.join(HERE, "..", "src", "tenant", "tenant.middleware.ts"), "utf8");

let passed = 0;
let failed = 0;
const check = (label, ok, detail = "") => {
  if (ok) {
    passed++;
    console.log(`  OK   ${label}`);
  } else {
    failed++;
    console.log(`  FALHA ${label}${detail ? ` — ${detail}` : ""}`);
  }
};

/*
 * O primeiro segmento de cada endereço público que um convite gera na raiz do
 * clube — o par da reescrita no middleware. Uma entrada nova aqui por cada
 * convite novo.
 */
const PUBLICOS = [
  { nome: "adesão a sócio", alvo: "/l/${slug}/sersocio" },
  { nome: "convite de staff", alvo: "/l/${slug}/convite/" },
  { nome: "convite de família", alvo: "/l/${slug}/familia/" },
  { nome: "convite de sócio", alvo: "/l/${slug}/socio/" },
  { nome: "convite de atleta", alvo: "/l/${slug}/atleta/" },
  { nome: "repor palavra-passe", alvo: "/l/${slug}/repor-palavra-passe" },
];

console.log("=== Cada rota pública da raiz tem reescrita no TenantMiddleware ===");
for (const p of PUBLICOS) {
  // A reescrita existe se o seu destino `/l/${slug}/…` aparecer numa entrada REWRITES.
  check(`${p.nome} → ${p.alvo} está no middleware`, fonte.includes(p.alvo), "reescrita em falta");
}

// A raiz `/` → landing também tem de lá estar.
check("a raiz / é reescrita para a landing", fonte.includes("`/l/${slug}`"));

/*
 * A outra metade do caminho: a landing tem de **pré-guardar** os três convites
 * no localStorage, com as chaves que a app da família lê. No iOS a app instala-se
 * por "Adicionar ao ecrã principal" e abre pela start_url sem query — é esta
 * semente que faz o token sobreviver. Faltava o de atleta, e nenhum convite de
 * atleta chegou alguma vez ao ecrã certo por essa via.
 */
console.log("\n=== A landing pré-guarda os três convites com as chaves da app ===");
const landing = readFileSync(path.join(HERE, "..", "src", "landing", "landing.template.ts"), "utf8");
for (const chave of ["academia.family.convite", "academia.socio.convite", "academia.atleta.convite"]) {
  check(`a landing semeia ${chave}`, landing.includes(`localStorage.setItem("${chave}"`), "semente em falta");
}

console.log(`\n${failed === 0 ? "TUDO OK" : "HÁ FALHAS"} — ${passed} ok, ${failed} falhas`);
process.exit(failed === 0 ? 0 : 1);

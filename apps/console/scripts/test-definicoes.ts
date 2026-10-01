/**
 * As secções das Definições, e qual delas um endereço abre.
 *
 * ## O que se está a proteger
 *
 * As Definições passaram de uma página só para um submenu com secções. Há uma
 * dúzia de sítios no produto que mandam para lá com um endereço antigo — "gerir
 * locais" num evento, "gerir cargos" num convite — e nenhum deles dá erro se
 * passar a abrir a secção errada: o link funciona, cai no Geral, e a pessoa fica
 * à procura do que lhe prometeram.
 *
 * Por isso o teste **lê os links verdadeiros do código** em vez de os repetir:
 * um link novo com um formato que a regra não conhece faz isto cair.
 *
 * Uso: npm run test:definicoes
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { SECOES, secaoDoEndereco, type SecaoKey } from "../src/lib/definicoes";

let ok = 0;
let bad = 0;
const check = (label: string, cond: unknown, detalhe = "") => {
  if (cond) {
    ok++;
    console.log("  OK    " + label);
  } else {
    bad++;
    console.log("  FALHA " + label + (detalhe ? " — " + detalhe : ""));
  }
};

const TODAS = SECOES.map((s) => s.key);
const SEM_PERIGO = TODAS.filter((k) => k !== "perigo");
const abre = (query: string, disponiveis: readonly SecaoKey[] = TODAS) => {
  const p = new URLSearchParams(query);
  return secaoDoEndereco({ secao: p.get("secao"), painel: p.get("painel"), catalogo: p.get("catalogo") }, disponiveis);
};

/* -------------------------------------------------------------------------- */
console.log("=== 1. O endereço novo ===");

check("sem nada, abre o Geral", abre("") === "geral");
for (const s of SECOES) check(`?secao=${s.key} abre ${s.label}`, abre("secao=" + s.key) === s.key);
check("uma secção que não existe cai no Geral", abre("secao=inventada") === "geral");

/* -------------------------------------------------------------------------- */
console.log("\n=== 2. Os endereços antigos, que o resto do produto ainda usa ===");

check("?painel=cargos abre os Cargos", abre("painel=cargos") === "cargos");
check("?catalogo=consultationTypes abre o Clínico", abre("catalogo=consultationTypes") === "clinico");
for (const c of ["venues", "dressingRooms", "competitions", "eventTypes"]) {
  check(`?catalogo=${c} abre as Modalidades`, abre("catalogo=" + c) === "modalidades");
}
check("o endereço novo ganha ao antigo", abre("secao=legal&catalogo=venues") === "legal");

/* -------------------------------------------------------------------------- */
console.log("\n=== 3. Todos os links que existem no código abrem uma secção a sério ===");

function ficheiros(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? ficheiros(p) : /\.(tsx?|ts)$/.test(f) ? [p] : [];
  });
}
const links = new Set<string>();
for (const f of ficheiros("src")) {
  for (const m of readFileSync(f, "utf8").matchAll(/\/definicoes\?([A-Za-z0-9=&_-]+)/g)) links.add(m[1]);
}
check("há links para as Definições no código", links.size > 0, String(links.size));

/*
 * Cair no Geral é o sintoma do link partido: nenhum dos links do produto pede o
 * Geral (para isso não levavam parâmetros).
 */
for (const q of [...links].sort()) {
  const destino = abre(q);
  check(`/definicoes?${q} → ${destino}`, destino !== "geral", "caiu no Geral: a regra não conhece este formato");
}

/* -------------------------------------------------------------------------- */
console.log("\n=== 4. Só se abre o que a pessoa pode ver ===");

check("quem não pode apagar o clube não abre a zona de perigo", abre("secao=perigo", SEM_PERIGO) === "geral");
check("quem pode, abre", abre("secao=perigo", TODAS) === "perigo");
check("sem Geral disponível, abre a primeira que houver", secaoDoEndereco({}, ["legal"]) === "legal");

/* -------------------------------------------------------------------------- */
console.log("\n=== 5. A lista de secções ===");

check("sem chaves repetidas", new Set(TODAS).size === TODAS.length);
check("o Geral é a primeira", SECOES[0].key === "geral");
check("a zona de perigo é a última, e sozinha", SECOES[SECOES.length - 1].key === "perigo" && SECOES[SECOES.length - 1].grupo === "");
check("todas têm uma frase a dizer o que ali se decide", SECOES.every((s) => s.descricao.length > 20));
/* Os grupos aparecem seguidos: um grupo partido em dois desenhava o título duas vezes. */
const ordem = SECOES.map((s) => s.grupo).filter((g, i, a) => i === 0 || a[i - 1] !== g);
check("cada grupo aparece uma vez só", new Set(ordem).size === ordem.length, ordem.join(" > "));

console.log("");
console.log(`${bad === 0 ? "TUDO OK" : "HÁ FALHAS"} — ${ok} ok, ${bad} falhas`);
process.exit(bad === 0 ? 0 : 1);

#!/usr/bin/env node
/**
 * O token do convite é apanhado da query **e** do caminho.
 *
 * Corre a função verdadeira (`captureFromUrl`) com `window`/`localStorage`
 * simulados — sem browser, sem rede. Prova o bug que deixava o pai preso no login
 * de família: a app instalada abre `…/atleta/<token>`, o token vinha no caminho e
 * não na query, era ignorado, e um token velho de família tomava conta do ecrã.
 *
 * Ao contrário: se `captureFromUrl` voltar a ler só a query, o primeiro caso
 * falha (o token de atleta não é guardado).
 *
 * Uso: node --experimental-strip-types apps/family/scripts/test-convite-captura.mjs
 */
import { captureFromUrl, readAthleteInvite, readMemberInvite, readInvite } from "../src/lib/invite.ts";

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

/** Um localStorage de brincar. */
function makeStorage(seed = {}) {
  const m = new Map(Object.entries(seed));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => void m.set(k, String(v)),
    removeItem: (k) => void m.delete(k),
    _dump: () => Object.fromEntries(m),
  };
}

/** Prepara o mundo do browser para um endereço. */
function comURL({ pathname = "/", search = "", hash = "" }, storageSeed = {}) {
  let url = pathname + search + hash;
  globalThis.localStorage = makeStorage(storageSeed);
  globalThis.window = {
    localStorage: globalThis.localStorage,
    location: { get pathname() { return pathname; }, get search() { return search; }, get hash() { return hash; } },
    history: {
      replaceState: (_s, _t, novo) => {
        url = novo;
        // A localização reflecte a limpeza, como no browser.
        const [p, rest] = novo.split("#");
        const [pp, ss] = p.split("?");
        pathname = pp;
        search = ss ? `?${ss}` : "";
        hash = rest ? `#${rest}` : "";
      },
    },
  };
  return () => url;
}

const T = "y47-7-Y2NqJiVwzkgVVTbfIZ__7sdjRCuCJApRmu9qU";

console.log("=== 1. Convite de atleta pelo CAMINHO (app instalada) — o bug ===");
// Um token de família velho, à espreita, não pode sequestrar.
let urlDe = comURL({ pathname: `/atleta/${T}` }, { "academia.family.convite": "VELHO_FAMILIA" });
captureFromUrl();
check("o token de atleta fica guardado", readAthleteInvite() === T, JSON.stringify(readAthleteInvite()));
check("o token de família velho é limpo", readInvite() === null, JSON.stringify(readInvite()));
check("a barra fica limpa (sem token no caminho)", !urlDe().includes(T), urlDe());

console.log("\n=== 2. Convite de atleta pela QUERY (via landing) — continua a valer ===");
comURL({ pathname: "/", search: `?academia=ad-fafe&atleta=${T}` });
captureFromUrl();
check("o token de atleta fica guardado", readAthleteInvite() === T);

console.log("\n=== 3. Convite de sócio pelo caminho ===");
comURL({ pathname: `/socio/${T}` });
captureFromUrl();
check("o token de sócio fica guardado", readMemberInvite() === T);
check("e não vira atleta", readAthleteInvite() === null);

console.log("\n=== 4. Abrir a app sem convite não apaga um token a meio de um registo ===");
comURL({ pathname: "/", search: "" }, { "academia.atleta.convite": T });
captureFromUrl();
check("o token de atleta em curso sobrevive", readAthleteInvite() === T);

console.log("\n=== 5. O fragmento da sessão (handoff em dev) preserva-se ===");
urlDe = comURL({ pathname: `/atleta/${T}`, hash: "#s=abc" });
captureFromUrl();
check("o #s= sobrevive à limpeza (adoptSessionFromUrl corre a seguir)", urlDe().includes("#s=abc"), urlDe());

console.log(`\n${failed === 0 ? "TUDO OK" : "HÁ FALHAS"} — ${passed} ok, ${failed} falhas`);
process.exit(failed === 0 ? 0 : 1);

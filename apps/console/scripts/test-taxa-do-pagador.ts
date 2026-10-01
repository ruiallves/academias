/**
 * A conta da taxa na consola é a mesma do servidor.
 *
 * `brutoParaLiquido` está escrita duas vezes — no servidor, que é quem cobra, e
 * na consola, que mostra o intervalo enquanto se escreve um preço. Duas
 * fórmulas para a mesma conta divergem, e a que divergir é a que o clube vê:
 * a consola a prometer "a família paga 20,27 €" e a referência a sair com
 * 20,28 €.
 *
 * Este teste corre as duas, lado a lado, sobre os mesmos valores e os mesmos
 * métodos, e exige o mesmo cêntimo.
 *
 * Uso: npm run test:taxa
 */
import { brutoParaLiquido as doServidor } from "../../api/src/billing/taxa-do-pagador";
import { brutoParaLiquido as daConsola, detalheDoPagador, type MetodoComTaxa } from "../src/lib/eupago-fees";

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

const METODOS: MetodoComTaxa[] = [
  { method: "MBWAY", label: "MB Way", fixedCents: 7, percent: 0.7, offered: true },
  { method: "MULTIBANCO", label: "Multibanco", fixedCents: 20, percent: 1.5, offered: true },
  { method: "DIRECT_DEBIT", label: "Débito directo", fixedCents: 45, percent: 0, offered: true },
  { method: "PAYSAFECARD", label: "PaySafeCard", fixedCents: 0, percent: 12, offered: false },
];

console.log("\nA consola e o servidor fazem a mesma conta");
{
  let diferentes = 0;
  let casos = 0;
  let primeiro = "";
  for (const m of METODOS) {
    for (const iva of [0, 23]) {
      for (let v = 1; v <= 60_000; v += v < 3000 ? 1 : 53) {
        casos++;
        const a = doServidor(v, m, iva);
        const b = daConsola(v, m, iva);
        if (a !== b) {
          diferentes++;
          primeiro ||= `${m.method} ${v} (IVA ${iva}): servidor ${a}, consola ${b}`;
        }
      }
    }
  }
  check(`em ${casos} casos, dão o mesmo cêntimo`, diferentes === 0, primeiro);
}

console.log("\nO que a consola mostra por baixo de um preço");
{
  const tabela = { methods: METODOS, vatPercent: 23, source: "teste" };
  const d = detalheDoPagador(2000, tabela)!;
  check("só os métodos que a app oferece", d.porMetodo.length === 3 && !d.porMetodo.some((m) => m.label === "PaySafeCard"));
  check("do mais barato para o mais caro para quem paga", d.porMetodo.every((m, i, l) => i === 0 || l[i - 1].totalCents <= m.totalCents));
  check("o intervalo é o do mais barato ao mais caro", d.minCents === d.porMetodo[0].totalCents && d.maxCents === d.porMetodo[2].totalCents);
  check("a taxa é a diferença para o valor do clube", d.porMetodo.every((m) => m.totalCents - m.surchargeCents === 2000));
  check("sem valor não há conta", detalheDoPagador(0, tabela) === null);
}

console.log(`\n${bad === 0 ? "TUDO OK" : "HÁ FALHAS"} — ${ok} ok, ${bad} falhas`);
process.exit(bad === 0 ? 0 : 1);

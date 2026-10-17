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
import {
  brutoParaLiquido as doServidor,
  METODOS_DA_APP as metodosDoServidor,
  valorACobrar,
} from "../../api/src/billing/taxa-do-pagador";
import {
  brutoParaLiquido as daConsola,
  detalheDoPagador,
  liquidoDe,
  METODOS_DA_APP as metodosDaConsola,
  type MetodoComTaxa,
} from "../src/lib/eupago-fees";

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

console.log("\nA mesma taxa em todos os métodos, dos dois lados");
{
  check(
    "a consola e o servidor contam com os mesmos métodos da app",
    JSON.stringify(metodosDaConsola) === JSON.stringify(metodosDoServidor),
    `consola ${JSON.stringify(metodosDaConsola)}, servidor ${JSON.stringify(metodosDoServidor)}`,
  );

  const tabela = { methods: METODOS, vatPercent: 23, source: "teste" };
  let diferentes = 0;
  let primeiro = "";
  let casos = 0;
  for (let v = 100; v <= 60_000; v += v < 3000 ? 1 : 53) {
    casos++;
    const consola = detalheDoPagador(v, tabela)!.maxCents;
    const servidor = valorACobrar(v, "MBWAY", { feesOnPayer: true }, tabela).totalCents;
    if (consola !== servidor) {
      diferentes++;
      primeiro ||= `${v}: consola ${consola}, servidor ${servidor}`;
    }
  }
  check(`em ${casos} valores, a consola mostra o total que o servidor cobra`, diferentes === 0, primeiro);
}

console.log("\nO que a consola mostra por baixo de um preço");
{
  const tabela = { methods: METODOS, vatPercent: 23, source: "teste" };
  const d = detalheDoPagador(2000, tabela)!;
  check(
    "só MB Way e Multibanco, os métodos que a app aceita (nem débito direto, nem PaySafeCard)",
    d.porMetodo.length === 2 && d.porMetodo.every((m) => m.label === "MB Way" || m.label === "Multibanco"),
    JSON.stringify(d.porMetodo.map((m) => m.label)),
  );
  check("um valor só: a família paga o mesmo por qualquer método", d.minCents === d.maxCents && d.porMetodo.every((m) => m.totalCents === d.maxCents));
  check("e é o do Multibanco, o mais caro: 20,63 €", d.maxCents === 2063, String(d.maxCents));
  check("a taxa é a diferença para o valor do clube", d.porMetodo.every((m) => m.totalCents - m.surchargeCents === 2000));
  check(
    "por cada método o clube recebe pelo menos o valor dele",
    d.porMetodo.every((m) => m.netCents >= 2000) && d.porMetodo.find((m) => m.label === "MB Way")!.netCents > 2000,
    JSON.stringify(d.porMetodo),
  );
  check("o que o clube recebe bate com a conta da euPago", d.porMetodo.every((m) => m.netCents === liquidoDe(2063, METODOS.find((x) => x.label === m.label)!, 23).netCents));
  check("sem valor não há conta", detalheDoPagador(0, tabela) === null);
  check(
    "sem a taxa do Multibanco na tabela, não se inventa um número",
    detalheDoPagador(2000, { methods: METODOS.filter((m) => m.method !== "MULTIBANCO"), vatPercent: 23, source: "teste" }) === null,
  );
}

console.log(`\n${bad === 0 ? "TUDO OK" : "HÁ FALHAS"} — ${ok} ok, ${bad} falhas`);
process.exit(bad === 0 ? 0 : 1);

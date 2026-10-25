/**
 * O mês em que uma mensalidade ou uma quota conta nas Contas
 * (`src/finance/mes-da-receita.ts`).
 *
 * Prova o que o Rui pediu a 25/10/2026: a mensalidade de setembro paga em
 * outubro é receita de setembro; o saldo continua pelo dia do pagamento.
 *
 * Uso: npm run test:mes-da-receita
 */
import { chaveDoMes, mesDaReceita, nomeDoMes } from "../src/finance/mes-da-receita";

let ok = 0;
let falhas = 0;
const igual = (rotulo: string, real: unknown, esperado: unknown) => {
  if (JSON.stringify(real) === JSON.stringify(esperado)) {
    ok++;
    console.log(`  OK   ${rotulo}`);
  } else {
    falhas++;
    console.log(`  FALHA ${rotulo} — ${JSON.stringify(real)} em vez de ${JSON.stringify(esperado)}`);
  }
};

const outubro = new Date("2026-10-12T10:00:00Z");

console.log("\nO mês a que respeita");
igual("mensalidade de setembro paga em outubro conta em setembro", mesDaReceita("2026-09", { pagaEm: outubro }), "2026-09");
igual("mensalidade de novembro paga adiantada em outubro conta em novembro", mesDaReceita("2026-11", { pagaEm: outubro }), "2026-11");
igual("quota anual com cobertura conta no mês em que começa", mesDaReceita("2026-09", { coversFrom: new Date("2026-08-22T00:00:00Z"), pagaEm: outubro }), "2026-08");
igual("período antigo de um ano conta em janeiro", mesDaReceita("2026", { pagaEm: outubro }), "2026-01");
igual("período antigo de trimestre conta no primeiro mês dele", mesDaReceita("2026-T3", { pagaEm: outubro }), "2026-07");
igual("um período que não se percebe cai no mês do pagamento", mesDaReceita("qualquer", { pagaEm: outubro }), "2026-10");
igual("sem período nem pagamento não há mês", mesDaReceita("qualquer"), null);
igual("um mês 13 não é um mês", mesDaReceita("2026-13", { pagaEm: outubro }), "2026-10");

console.log("\nO mês na hora do clube");
igual("o dia 1 às 00:30 em Lisboa (23:30 UTC do dia anterior) já é do mês novo", chaveDoMes(new Date("2026-09-30T23:30:00Z")), "2026-10");
igual("31/12 às 23:30 UTC ainda é dezembro em Lisboa (no inverno Lisboa está em UTC)", chaveDoMes(new Date("2026-12-31T23:30:00Z")), "2026-12");

console.log("\nO nome do mês");
igual("2026-09 lê-se setembro de 2026", nomeDoMes("2026-09"), "setembro de 2026");
igual("o que não é mês volta como veio", nomeDoMes("2026-T3"), "2026-T3");

console.log(`\n${ok} OK, ${falhas} falhas`);
process.exit(falhas ? 1 : 0);

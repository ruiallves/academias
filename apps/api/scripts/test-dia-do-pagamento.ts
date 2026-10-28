/**
 * O dia de uma mensalidade marcada como paga à mão
 * (`src/billing/dia-do-pagamento.ts`).
 *
 * Prova o que o Rui pediu a 28/10/2026: a data escolhe-se, e por omissão cai
 * no mês da mensalidade (a de julho no vencimento de julho, a deste mês hoje).
 *
 * Uso: npm run test:dia-do-pagamento
 */
import { diaNoClube, diaPorOmissao, instanteDoPagamento } from "../src/billing/dia-do-pagamento";
import { chaveDoMes } from "../src/finance/mes-da-receita";

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
const recusa = (rotulo: string, f: () => unknown) => {
  try {
    f();
    falhas++;
    console.log(`  FALHA ${rotulo} — aceitou`);
  } catch {
    ok++;
    console.log(`  OK   ${rotulo}`);
  }
};

const agora = new Date("2026-10-28T15:30:00Z");
const venc = (dia: string) => new Date(`${dia}T00:00:00Z`);

console.log("\nO dia por omissão");
igual("julho, já passado, fica no dia de vencimento de julho", diaPorOmissao("2026-07", venc("2026-07-08"), agora), "2026-07-08");
igual("o mês corrente fica hoje", diaPorOmissao("2026-10", venc("2026-10-08"), agora), "2026-10-28");
igual("um mês futuro (adiantado) fica hoje", diaPorOmissao("2026-12", venc("2026-12-08"), agora), "2026-10-28");
igual("vencimento fora do mês cai no último dia do mês", diaPorOmissao("2026-02", venc("2026-03-05"), agora), "2026-02-28");
igual("sem vencimento cai no último dia do mês", diaPorOmissao("2026-09", null, agora), "2026-09-30");

console.log("\nO instante gravado");
igual("sem dia é agora", instanteDoPagamento(undefined, agora).toISOString(), agora.toISOString());
igual("hoje é agora, com a hora", instanteDoPagamento("2026-10-28", agora).toISOString(), agora.toISOString());
igual("um dia de verão fica ao meio-dia de Lisboa", instanteDoPagamento("2026-07-08", agora).toISOString(), "2026-07-08T11:00:00.000Z");
igual("o dia gravado é o escolhido, na hora do clube", diaNoClube(instanteDoPagamento("2026-03-31", agora)), "2026-03-31");
igual("o último dia de setembro conta em setembro", chaveDoMes(instanteDoPagamento("2026-09-30", agora)), "2026-09");
igual("o primeiro de outubro conta em outubro", chaveDoMes(instanteDoPagamento("2026-10-01", agora)), "2026-10");
recusa("amanhã não se aceita", () => instanteDoPagamento("2026-10-29", agora));
recusa("31 de fevereiro não existe", () => instanteDoPagamento("2026-02-31", agora));
recusa("um texto qualquer não é data", () => instanteDoPagamento("ontem", agora));

console.log(`\n${ok} certos, ${falhas} errados`);
if (falhas > 0) process.exit(1);

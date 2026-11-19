/**
 * As contas de calendário dos vencimentos (`src/finance/vencimentos.ts`).
 *
 * Prova os casos que se enganam em silêncio: o período que começa a meio do
 * mês, o que acabou, o dia 31, o pagamento adiantado, a janela que corta.
 *
 * Uso: npm run test:vencimentos
 */
import {
  diaDePagamento,
  estadoDoMes,
  mesesDevidos,
  mesesEntre,
  periodoValido,
  somarMeses,
  ultimoDiaDoMes,
} from "../src/finance/vencimentos";

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

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

console.log("\nMeses e dias");
igual("somar meses passa o ano", somarMeses("2026-11", 2), "2027-01");
igual("somar meses para trás passa o ano", somarMeses("2026-01", -1), "2025-12");
igual("meses entre", mesesEntre("2026-09", "2027-02"), 5);
igual("fevereiro de 2027 tem 28 dias", ultimoDiaDoMes("2027-02"), 28);
igual("fevereiro de 2028 tem 29 dias", ultimoDiaDoMes("2028-02"), 29);
igual("sem dia marcado vence no último dia", diaDePagamento("2026-11", null), "2026-11-30");
igual("com dia marcado vence nesse dia", diaDePagamento("2026-11", 5), "2026-11-05");
igual("período válido", periodoValido("2026-12"), true);
igual("mês 13 não é válido", periodoValido("2026-13"), false);
igual("ano só não é válido", periodoValido("2026"), false);

console.log("\nO que um período deve");
const emVigor = { id: "s1", amountCents: 60_000, startsOn: d("2026-09-15"), endsOn: null, payDay: null };
const janela = { desde: "2025-12", ate: "2026-11" };
igual(
  "começa no mês de início (o dia 15 não conta) e vai até ao fim da janela",
  mesesDevidos(emVigor, janela).map((m) => m.period),
  ["2026-09", "2026-10", "2026-11"],
);
igual("cada mês vence no último dia", mesesDevidos(emVigor, janela)[0].vence, "2026-09-30");

const acabado = { ...emVigor, id: "s2", endsOn: d("2026-10-31") };
igual("um período que acabou pára no mês do fim", mesesDevidos(acabado, janela).map((m) => m.period), ["2026-09", "2026-10"]);

const acabadoAMeio = { ...emVigor, id: "s3", endsOn: d("2026-10-10") };
igual("acabar a 10 de outubro ainda deve outubro", mesesDevidos(acabadoAMeio, janela).map((m) => m.period), ["2026-09", "2026-10"]);

const antigo = { ...emVigor, id: "s4", startsOn: d("2024-01-01"), endsOn: d("2025-06-30") };
igual("um período fora da janela não deve nada nela", mesesDevidos(antigo, janela), []);

const comDia = { ...emVigor, id: "s5", payDay: 28 };
igual("o dia marcado vale em todos os meses", mesesDevidos(comDia, janela).map((m) => m.vence), ["2026-09-28", "2026-10-28", "2026-11-28"]);

igual(
  "a janela corta o início",
  mesesDevidos({ ...emVigor, id: "s6", startsOn: d("2020-01-01") }, { desde: "2026-10", ate: "2026-11" }).map((m) => m.period),
  ["2026-10", "2026-11"],
);

console.log("\nO estado de cada mês");
const hoje = { ano: 2026, mes: 11, dia: 18 };
const mes = (period: string) => ({ period, amountCents: 1, vence: diaDePagamento(period, null), salaryId: "s" });
igual("um mês pago é pago, seja qual for", estadoDoMes(mes("2026-09"), true, hoje), "pago");
igual("um mês anterior sem pagamento está em atraso", estadoDoMes(mes("2026-10"), false, hoje), "atraso");
igual("o mês corrente por pagar é este mês, mesmo antes de vencer", estadoDoMes(mes("2026-11"), false, hoje), "este-mes");
igual("um mês por vir é futuro", estadoDoMes(mes("2026-12"), false, hoje), "futuro");

console.log(`\n${ok} OK, ${falhas} FALHA${falhas === 1 ? "" : "S"}`);
process.exit(falhas ? 1 : 0);

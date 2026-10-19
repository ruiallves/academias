/**
 * O período de cobrança por escalão, sem base de dados.
 *
 *   npm run test:cobranca-por-escalao
 *
 * O caso que o pediu: um clube em que uns escalões não pagam Agosto e pagam o
 * resto do ano, e outros pagam Agosto e não pagam Julho. Defende:
 *   - do clube todo, tudo como era (os meses do clube valem para toda a gente);
 *   - por escalão, cada atleta segue as equipas em que está, e quem não tem
 *     equipa (ou está numa equipa sem meses próprios) segue os do clube;
 *   - quem está em dois escalões paga o mês se um deles o pagar;
 *   - um mês existe no clube se algum escalão o paga;
 *   - o agendado para a próxima época (modo e meses de cada escalão) só vale a
 *     partir de `billingNextFrom`, e o que não foi agendado fica como hoje.
 */
import { calendarioPara, cobraAoAtleta, cobraNoMes, mesesDaEquipa, type AcademiaComCalendario } from "../src/billing/calendario";

let falhas = 0;
function check(nome: string, ok: boolean, detalhe = "") {
  console.log(`${ok ? "  ok " : "FALHA"}  ${nome}${!ok && detalhe ? ` — ${detalhe}` : ""}`);
  if (!ok) falhas++;
}

const SEM_AGOSTO = [1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12];
const SEM_JULHO = [1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12];

const clube = (extra: Partial<AcademiaComCalendario> = {}): AcademiaComCalendario => ({
  billingMonths: SEM_AGOSTO,
  billingDueDay: 8,
  billingNextFrom: null,
  billingNextMonths: [],
  billingNextDueDay: null,
  billingByTeam: false,
  billingNextByTeam: null,
  ...extra,
});

const equipas = [
  { id: "sub15", billingMonths: SEM_AGOSTO, billingNextMonths: [] as number[] },
  { id: "seniores", billingMonths: SEM_JULHO, billingNextMonths: [] as number[] },
  { id: "nova", billingMonths: [] as number[], billingNextMonths: [] as number[] }, // sem meses próprios
];

console.log("\n=== Do clube todo ===");
{
  const c = calendarioPara(clube(), "2026-08", equipas);
  check("não é por escalão", !c.porEscalao);
  check("Agosto não se cobra a ninguém, nem aos Seniores", !cobraAoAtleta(c, ["seniores"], 8) && !cobraAoAtleta(c, ["sub15"], 8));
  check("Julho cobra-se a toda a gente", cobraAoAtleta(c, ["seniores"], 7));
  check("os meses de uma equipa são os do clube", mesesDaEquipa(c, "seniores").join() === SEM_AGOSTO.join());
  check("Agosto não existe no clube", !cobraNoMes(c, 8));
}

console.log("\n=== Por escalão ===");
{
  const c = calendarioPara(clube({ billingByTeam: true }), "2026-08", equipas);
  check("é por escalão", c.porEscalao);
  check("os Sub-15 não pagam Agosto", !cobraAoAtleta(c, ["sub15"], 8));
  check("os Seniores pagam Agosto", cobraAoAtleta(c, ["seniores"], 8));
  check("os Seniores não pagam Julho", !cobraAoAtleta(c, ["seniores"], 7));
  check("os Sub-15 pagam Julho", cobraAoAtleta(c, ["sub15"], 7));
  check("quem está nos dois paga Agosto e Julho", cobraAoAtleta(c, ["sub15", "seniores"], 8) && cobraAoAtleta(c, ["sub15", "seniores"], 7));
  check("um escalão sem meses próprios segue os do clube", !cobraAoAtleta(c, ["nova"], 8) && mesesDaEquipa(c, "nova").join() === SEM_AGOSTO.join());
  check("quem não tem escalão segue os do clube", !cobraAoAtleta(c, [], 8) && cobraAoAtleta(c, [], 7));
  check("uma equipa que não é desta época segue os do clube", mesesDaEquipa(c, "de-outra-epoca").join() === SEM_AGOSTO.join());
  check("Agosto existe, porque os Seniores o pagam", cobraNoMes(c, 8));

  const ninguem = calendarioPara(
    clube({ billingByTeam: true }),
    "2026-08",
    equipas.map((e) => ({ ...e, billingMonths: SEM_AGOSTO })),
  );
  check("um mês que nenhum escalão nem o clube paga não existe", !cobraNoMes(ninguem, 8));
}

console.log("\n=== Agendado para a próxima época ===");
{
  // Hoje do clube todo; a partir de Agosto de 2027, por escalão, com os Sub-15 a passar a pagar Agosto.
  const a = clube({ billingNextFrom: "2027-08", billingNextByTeam: true });
  const comAgenda = equipas.map((e) => (e.id === "sub15" ? { ...e, billingNextMonths: [8, 9, 10, 11, 12, 1, 2, 3, 4, 5, 6] } : e));

  const antes = calendarioPara(a, "2027-07", comAgenda);
  check("antes da data agendada continua do clube todo", !antes.porEscalao && cobraAoAtleta(antes, ["seniores"], 7));

  const depois = calendarioPara(a, "2027-08", comAgenda);
  check("a partir da data passa a ser por escalão", depois.porEscalao);
  check("os Sub-15 passam a pagar Agosto", cobraAoAtleta(depois, ["sub15"], 8));
  check("os Sub-15 deixam de pagar Julho", !cobraAoAtleta(depois, ["sub15"], 7));
  check("os Seniores, sem agendamento, ficam com os meses de hoje", cobraAoAtleta(depois, ["seniores"], 8) && !cobraAoAtleta(depois, ["seniores"], 7));

  // E o contrário: hoje por escalão, agendado voltar ao clube todo.
  const volta = calendarioPara(clube({ billingByTeam: true, billingNextFrom: "2027-08", billingNextByTeam: false }), "2027-08", equipas);
  check("agendar o clube todo desliga o modo por escalão nessa data", !volta.porEscalao && !cobraAoAtleta(volta, ["seniores"], 8));

  // Sem agendamento do modo (`billingNextByTeam` nulo), fica o de hoje.
  const mesmoModo = calendarioPara(clube({ billingByTeam: true, billingNextFrom: "2027-08", billingNextMonths: [9, 10] }), "2027-08", equipas);
  check("sem modo agendado fica o de hoje", mesmoModo.porEscalao && mesmoModo.meses.join() === "9,10");
}

console.log("\n=== Sem academia (rede) ===");
{
  const c = calendarioPara(null, "2026-08");
  check("onze meses sem Agosto, do clube todo", !c.porEscalao && !cobraAoAtleta(c, ["sub15"], 8) && cobraAoAtleta(c, [], 9));
}

console.log(falhas === 0 ? "\nTudo certo." : `\n${falhas} ${falhas === 1 ? "falha" : "falhas"}.`);
process.exit(falhas === 0 ? 0 : 1);

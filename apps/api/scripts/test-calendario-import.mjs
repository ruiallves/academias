#!/usr/bin/env node
/**
 * As regras da importação de calendário.
 *
 * ## O que se está a proteger
 *
 * Uma importação de calendário é a única do produto que ninguém confere
 * depois: os eventos ficam espalhados por doze meses, e um engano só aparece
 * no dia em que a equipa não está no campo. As duas contas que decidem tudo
 * são estas — **que dias uma linha dá** e **o que choca com o quê** — e as
 * duas erram em silêncio: um intervalo comparado ao contrário deixa passar
 * dois treinos no mesmo balneário, e ninguém dá por isso até lá estarem.
 *
 * Corre sem servidor e sem base de dados, como `test-cobertura-anual.mjs`: as
 * regras vivem sozinhas em `academy/calendario-regras.ts` exactamente para
 * isto.
 *
 * Uso: npm run test:calendario-import
 */
import {
  diasDaSerie,
  kindDoRotulo,
  lerDia,
  planearOcorrencias,
  tituloPorOmissao,
} from "../src/academy/calendario-regras.ts";

let ok = 0;
let bad = 0;
const check = (label, cond, detalhe = "") => {
  if (cond) {
    ok++;
    console.log("  OK    " + label);
  } else {
    bad++;
    console.log("  FALHA " + label + (detalhe ? " — " + detalhe : ""));
  }
};
const eq = (label, a, b) => check(label, JSON.stringify(a) === JSON.stringify(b), JSON.stringify(a));

/* -------------------------------------------------------------- os dias --- */

console.log("=== Os dias de uma linha ===");
const dia = (s) => lerDia(s);
const dias = (xs) => xs.map((x) => `${x.ano}-${String(x.mes).padStart(2, "0")}-${String(x.dia).padStart(2, "0")}`);

eq("sem repetição é um dia só", dias(diasDaSerie(dia("2026-10-07"), {})), ["2026-10-07"]);
eq(
  "terças e quintas até 15 de Outubro",
  dias(diasDaSerie(dia("2026-10-06"), { until: "2026-10-15", freq: "WEEKLY", weekdays: [2, 4] })),
  ["2026-10-06", "2026-10-08", "2026-10-13", "2026-10-15"],
);
eq(
  "sem dias escolhidos, repete no dia da semana da data",
  dias(diasDaSerie(dia("2026-10-06"), { until: "2026-10-20", freq: "WEEKLY" })),
  ["2026-10-06", "2026-10-13", "2026-10-20"],
);
eq(
  "o último dia entra",
  dias(diasDaSerie(dia("2026-10-06"), { until: "2026-10-13", freq: "WEEKLY" })).at(-1),
  "2026-10-13",
);
eq("diária", dias(diasDaSerie(dia("2026-10-06"), { until: "2026-10-09", freq: "DAILY" })), [
  "2026-10-06",
  "2026-10-07",
  "2026-10-08",
  "2026-10-09",
]);
eq(
  "mensal salta os meses sem o dia 31",
  dias(diasDaSerie(dia("2027-01-31"), { until: "2027-06-30", freq: "MONTHLY" })),
  ["2027-01-31", "2027-03-31", "2027-05-31"],
);
check("acabar antes de começar é recusado", "error" in diasDaSerie(dia("2026-10-10"), { until: "2026-10-01" }));
check(
  "nenhum dos dias escolhidos cai no intervalo",
  "error" in diasDaSerie(dia("2026-10-05"), { until: "2026-10-06", freq: "WEEKLY", weekdays: [5] }),
);
check("o tecto por linha é 200", diasDaSerie(dia("2026-01-01"), { until: "2030-01-01", freq: "DAILY" }).length === 200);
check(
  "uma época de treinos bi-semanais são 87 dias",
  diasDaSerie(dia("2026-09-01"), { until: "2027-06-30", freq: "WEEKLY", weekdays: [2, 4] }).length === 87,
);
check("31 de Fevereiro não é um dia", lerDia("2026-02-31") === null);
check("29 de Fevereiro num ano bissexto é", lerDia("2028-02-29")?.dia === 29);

/* -------------------------------------------------------------- o tipo --- */

console.log("\n=== O que o tipo do clube faz do evento ===");
check("Treino", kindDoRotulo("Treino", "") === "TRAINING");
check("acentos e maiúsculas não contam", kindDoRotulo(" TORNEIO ", "") === "TOURNAMENT");
check("um tipo do clube é um evento genérico", kindDoRotulo("Estágio", "") === "OTHER");
check("sem tipo, vale a folha de onde veio", kindDoRotulo("", "MATCH") === "MATCH");
check("o título de um jogo leva o adversário", tituloPorOmissao("MATCH", undefined, "Sub-13", "Académico") === "Jogo · Académico");
check("o de um evento leva o tipo e a equipa", tituloPorOmissao("OTHER", "Estágio", "Sub-13", undefined) === "Estágio · Sub-13");

/* --------------------------------------------------------- os conflitos --- */

console.log("\n=== O que choca, e o que não ===");
const h = (d, hora) => Date.UTC(2026, 8, d, hora, 0);
let n = 0;
const cand = (o) => ({ ref: n++, equipa: null, balnearios: [], rotulo: "novo", ...o });
const A = { id: "t1", nome: "Sub-13" };
const B = { id: "t2", nome: "Sub-15" };

n = 0;
eq(
  "sem nada marcado, entram todos",
  planearOcorrencias([cand({ equipa: A, de: h(1, 18), ate: h(1, 20) }), cand({ equipa: A, de: h(2, 18), ate: h(2, 20) })], [])
    .aceites,
  [0, 1],
);

n = 0;
let r = planearOcorrencias(
  [cand({ equipa: A, de: h(1, 18), ate: h(1, 20) })],
  [{ equipaId: "t1", balnearios: [], de: h(1, 19), ate: h(1, 21), quem: "jogo do Sub-13" }],
);
check(
  "a equipa em dois sítios à mesma hora choca, e diz com quê",
  r.aceites.length === 0 && r.conflitos[0].motivo === "Sub-13 já tem jogo do Sub-13 a esta hora",
  JSON.stringify(r.conflitos),
);

n = 0;
eq(
  "acabar quando o outro começa não é chocar",
  planearOcorrencias(
    [cand({ equipa: A, de: h(1, 19), ate: h(1, 21) })],
    [{ equipaId: "t1", balnearios: [], de: h(1, 17), ate: h(1, 19), quem: "treino" }],
  ).aceites,
  [0],
);

n = 0;
eq(
  "um evento inteiro dentro de outro choca",
  planearOcorrencias(
    [cand({ equipa: A, de: h(1, 18), ate: h(1, 19) })],
    [{ equipaId: "t1", balnearios: [], de: h(1, 17), ate: h(1, 22), quem: "torneio" }],
  ).aceites,
  [],
);

n = 0;
eq(
  "outra equipa à mesma hora entra",
  planearOcorrencias(
    [cand({ equipa: B, de: h(1, 18), ate: h(1, 20) })],
    [{ equipaId: "t1", balnearios: [], de: h(1, 18), ate: h(1, 20), quem: "treino" }],
  ).aceites,
  [0],
);

n = 0;
r = planearOcorrencias(
  [cand({ equipa: B, balnearios: ["Balneário 2"], de: h(1, 18), ate: h(1, 20) })],
  [{ equipaId: "t1", balnearios: ["balneario 2"], de: h(1, 19), ate: h(1, 21), quem: "treino do Sub-13" }],
);
check(
  "o balneário ocupado choca, mesmo escrito de outra maneira",
  r.conflitos[0]?.motivo === "O balneário Balneário 2 está ocupado (treino do Sub-13)",
  JSON.stringify(r.conflitos),
);

n = 0;
eq(
  "o local não é exclusivo: dois escalões dividem o campo",
  planearOcorrencias(
    [cand({ equipa: B, de: h(1, 18), ate: h(1, 20) })],
    [{ equipaId: "t1", balnearios: [], de: h(1, 18), ate: h(1, 20), quem: "treino" }],
  ).aceites,
  [0],
);

n = 0;
r = planearOcorrencias(
  [
    cand({ equipa: A, de: h(1, 18), ate: h(1, 20), rotulo: "Treino (deste ficheiro)" }),
    cand({ equipa: A, de: h(1, 18), ate: h(1, 20) }),
  ],
  [],
);
check(
  "a linha repetida no ficheiro choca com a primeira",
  JSON.stringify(r.aceites) === "[0]" && r.conflitos[0].motivo === "Sub-13 já tem Treino (deste ficheiro) a esta hora",
  JSON.stringify(r),
);

n = 0;
eq(
  "dois escalões no mesmo balneário: entra o primeiro",
  planearOcorrencias(
    [
      cand({ equipa: A, balnearios: ["B1"], de: h(1, 18), ate: h(1, 20) }),
      cand({ equipa: B, balnearios: ["B1"], de: h(1, 19), ate: h(1, 21) }),
    ],
    [],
  ).aceites,
  [0],
);

n = 0;
eq(
  "um evento de toda a academia não tem horário de equipa a defender",
  planearOcorrencias([cand({ de: h(1, 18), ate: h(1, 20) }), cand({ de: h(1, 18), ate: h(1, 20) })], []).aceites,
  [0, 1],
);

console.log(`\n${ok} OK, ${bad} FALHA`);
if (bad > 0) process.exit(1);

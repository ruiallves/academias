#!/usr/bin/env node
/**
 * Os jogos do sócio, dia a dia: o agrupamento, a ordem dentro do dia e a data
 * escrita por inteiro.
 *
 * Corre as funções verdadeiras de `src/lib/jogos-por-dia.ts`, sem browser nem
 * servidor. Prova a queixa que deu origem ao ecrã: quatro domingos da mesma
 * equipa têm de ser quatro dias diferentes, e nenhum pode dizer só "Domingo".
 *
 * Corre com TZ=Europe/Lisbon por omissão (é o relógio do telemóvel dos sócios);
 * passa TZ=UTC para ver que nada depende do fuso da máquina.
 *
 * Uso: npm run test:jogos-por-dia --workspace=@academia/family
 */
process.env.TZ ??= "Europe/Lisbon";

const { jogosPorDia, quandoDoJogo, tituloDoDia, pilulaDoDia, localDoJogo, chaveDoDia } = await import(
  "../src/lib/jogos-por-dia.ts"
);

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

// Sexta, 16 de outubro de 2026, ao fim da tarde.
const agora = new Date(2026, 9, 16, 18, 30);
const em = (dia, h, m = 0) => new Date(2026, 9, dia, h, m).toISOString();

const jogo = (id, dia, h, teamName, teamMaxAge, extra = {}) => ({
  id,
  startsAt: em(dia, h),
  teamName,
  teamMaxAge,
  venue: "Campo do Quinteiro",
  isHome: true,
  opponent: "Adversário",
  ...extra,
});

// A lista como o servidor a manda: por equipa, mais velhos primeiro.
const lista = [
  jogo("fem-18", 18, 15, "Sénior Feminino", 99),
  jogo("fem-25", 25, 15, "Sénior Feminino", 99),
  jogo("fem-01", 32, 15, "Sénior Feminino", 99), // 1 de novembro
  jogo("fem-08", 39, 15, "Sénior Feminino", 99), // 8 de novembro
  jogo("jun-18", 18, 11, "Juniores", 19),
  jogo("juv-18", 18, 9, "Juvenis", 17),
  jogo("sub13-17", 17, 10, "Sub-13", 13),
  jogo("sub13b-17", 17, 9, "Sub-13 B", 13),
];

console.log("\nAgrupar por dia");
const dias = jogosPorDia(lista);
check(
  "os quatro domingos da mesma equipa são quatro dias diferentes",
  ["2026-10-18", "2026-10-25", "2026-11-01", "2026-11-08"].every((c) => dias.some((d) => d.chave === c)),
  JSON.stringify(dias.map((d) => d.chave)),
);
check(
  "os dias vêm por ordem de calendário, não pela ordem do servidor",
  JSON.stringify(dias.map((d) => d.chave)) ===
    JSON.stringify(["2026-10-17", "2026-10-18", "2026-10-25", "2026-11-01", "2026-11-08"]),
  JSON.stringify(dias.map((d) => d.chave)),
);
check("nenhum jogo se perde nem se repete", dias.reduce((n, d) => n + d.jogos.length, 0) === lista.length);

console.log("\nA ordem dentro do dia");
const domingo = dias.find((d) => d.chave === "2026-10-18");
check(
  "o escalão mais velho é o primeiro (o destaque), mesmo jogando mais tarde",
  domingo?.jogos[0].id === "fem-18",
  JSON.stringify(domingo?.jogos.map((j) => j.id)),
);
check(
  "a seguir vêm os mais novos, por idade e não pela hora",
  JSON.stringify(domingo?.jogos.map((j) => j.id)) === JSON.stringify(["fem-18", "jun-18", "juv-18"]),
  JSON.stringify(domingo?.jogos.map((j) => j.id)),
);
const sabado = dias.find((d) => d.chave === "2026-10-17");
check(
  "duas equipas da mesma idade desempatam pelo nome, não pela hora",
  JSON.stringify(sabado?.jogos.map((j) => j.id)) === JSON.stringify(["sub13-17", "sub13b-17"]),
  JSON.stringify(sabado?.jogos.map((j) => j.id)),
);

console.log("\nA data escrita");
const quando = lista.map((j) => quandoDoJogo(new Date(j.startsAt), agora));
check("nenhum cartão diz só o dia da semana", quando.every((q) => /^(Hoje|Amanhã|\S+, \d{1,2} \S+)$/.test(q)), JSON.stringify(quando));
check("domingo dia 18 escreve-se com o número e o mês", quandoDoJogo(new Date(em(18, 15)), agora) === "Domingo, 18 out");
check("domingo dia 25 é outro texto", quandoDoJogo(new Date(em(25, 15)), agora) === "Domingo, 25 out");
check("o dia seguinte é \"Amanhã\"", quandoDoJogo(new Date(em(17, 10)), agora) === "Amanhã");
check("o próprio dia é \"Hoje\", mesmo já passada a hora", quandoDoJogo(new Date(em(16, 9)), agora) === "Hoje");
check("o título do dia diz o mês por extenso", tituloDoDia(new Date(2026, 9, 25), agora) === "Domingo, 25 de outubro");
check(
  "o título só diz o ano quando é outro ano",
  tituloDoDia(new Date(2027, 0, 10), agora) === "Domingo, 10 de janeiro de 2027",
  tituloDoDia(new Date(2027, 0, 10), agora),
);
const p = pilulaDoDia(new Date(2026, 10, 1), agora);
check("a pílula do dia tem dia da semana, número e mês", p.semana === "Dom" && p.numero === "1" && p.mes === "nov", JSON.stringify(p));
check("a pílula de hoje diz \"Hoje\"", pilulaDoDia(new Date(2026, 9, 16), agora).semana === "Hoje");

console.log("\nO dia vem do relógio de quem lê");
// O dia é o do relógio local e não o do UTC: um jogo às 23:30 de sábado não
// pode saltar para domingo, nem um às 00:15 de domingo ficar no sábado.
const tarde = new Date(2026, 9, 17, 23, 30);
check("um jogo às 23:30 fica no seu dia", chaveDoDia(tarde) === "2026-10-17", chaveDoDia(tarde));
const madrugada = new Date(2026, 9, 18, 0, 15);
check("um jogo às 00:15 fica no dia seguinte", chaveDoDia(madrugada) === "2026-10-18", chaveDoDia(madrugada));
// A mudança da hora em Portugal é no último domingo de outubro (25/10/2026).
check("a mudança da hora não estraga a contagem de dias", quandoDoJogo(new Date(2026, 9, 26, 20), new Date(2026, 9, 25, 20)) === "Amanhã");

console.log("\nO local, sem \"fora\" repetido");
const f = localDoJogo("Fora · FC Tadim", false);
check("\"Fora · FC Tadim\" passa a \"FC Tadim\" com a etiqueta Fora", f.lugar === "FC Tadim" && f.fora === true, JSON.stringify(f));
const c = localDoJogo("Campo do Quinteiro", true);
check("um local normal fica igual", c.lugar === "Campo do Quinteiro" && c.fora === false, JSON.stringify(c));
const s = localDoJogo("Fora", false);
check("um local que é só \"Fora\" não fica vazio", s.lugar === "Fora", JSON.stringify(s));
const pav = localDoJogo("Pavilhão Forapalmas", false);
check("um nome que começa por \"Fora\" sem separador não é cortado", pav.lugar === "Pavilhão Forapalmas", JSON.stringify(pav));

console.log(`\n${passed} passaram, ${failed} falharam`);
process.exit(failed ? 1 : 0);

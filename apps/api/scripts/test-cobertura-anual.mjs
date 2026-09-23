#!/usr/bin/env node
/**
 * A aritmética de uma anuidade partida — o preço e as fronteiras.
 *
 * Corre a função verdadeira (`src/members/cobertura.ts`), sem servidor, sem
 * base de dados, sem rede. É dinheiro: partir uma anuidade é contar meses entre
 * duas datas que não caem no dia 1, decidir de que lado fica o mês escolhido, e
 * repartir cêntimos sem que a soma deixe de bater certo.
 *
 * O caso que o clube descreveu está aqui por inteiro: sócio que adere a 22 de
 * Setembro, anuidade de 120 €, quer pagar até Dezembro. "Até Dezembro" **inclui**
 * Dezembro — quatro meses, 40 €, e os 80 € restantes numa segunda quota que
 * começa a 22 de Janeiro.
 *
 * Uso: node --experimental-strip-types scripts/test-cobertura-anual.mjs
 */
import {
  decisaoDoAnoDaFolha,
  distanciaEmMeses,
  fimDaCobertura,
  inicioDaCobertura,
  inicioDaEpoca,
  mesDe,
  mesFinalCoberto,
  mesMais,
  mesesCobertos,
  repartirValor,
  sobrepoem,
} from "../src/members/cobertura.ts";

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
const iso = (d) => d.toISOString().slice(0, 10);

/* ------------------------------------------------------------------ 1 ---- */
console.log("=== 1. O ano de quem adere a 22 de Setembro ===");
const DIA = 22;
const inicio = inicioDaCobertura("2026-09", DIA);
/* Um ano inteiro são doze meses contados do de início, inclusive: Set..Ago. */
const fimDoAno = fimDaCobertura(mesMais("2026-09", 11), DIA);
check("começa a 22/09/2026", iso(inicio) === "2026-09-22", iso(inicio));
check("acaba a 21/09/2027, um ano menos um dia", iso(fimDoAno) === "2027-09-21", iso(fimDoAno));
check("vale 12 meses", mesesCobertos(inicio, fimDoAno) === 12, String(mesesCobertos(inicio, fimDoAno)));

/* ------------------------------------------------------------------ 2 ---- */
console.log("\n=== 2. «Até Dezembro» inclui Dezembro (o caso do clube) ===");
const fimEmDez = fimDaCobertura("2026-12", DIA);
check("a primeira parte acaba a 21/01/2027", iso(fimEmDez) === "2027-01-21", iso(fimEmDez));
const mesesPrimeira = mesesCobertos(inicio, fimEmDez);
check("e vale 4 meses (Set, Out, Nov, Dez)", mesesPrimeira === 4, String(mesesPrimeira));

const inicioSegunda = new Date(fimEmDez.getTime() + 86_400_000);
check("a segunda começa a 22/01/2027", iso(inicioSegunda) === "2027-01-22", iso(inicioSegunda));
check("e vale os 8 meses que faltam", mesesCobertos(inicioSegunda, fimDoAno) === 8, String(mesesCobertos(inicioSegunda, fimDoAno)));

const conta = repartirValor(12000, 12, mesesPrimeira);
check("120 € partidos em 4/12 dão 40 €", conta.primeira === 4000, String(conta.primeira));
check("e 80 € na segunda", conta.segunda === 8000, String(conta.segunda));

/* ------------------------------------------------------------------ 3 ---- */
console.log("\n=== 3. O arredondamento nunca perde nem inventa cêntimos ===");
for (const [total, meses] of [[10000, 12], [9999, 12], [3333, 7], [12345, 11], [5000, 9]]) {
  let soma = 0;
  let ok = true;
  for (let m = 1; m < meses; m++) {
    const r = repartirValor(total, meses, m);
    if (r.primeira + r.segunda !== total) ok = false;
    soma = r.primeira + r.segunda;
  }
  check(`${(total / 100).toFixed(2)} € em ${meses} meses: as partes somam sempre o total`, ok, String(soma));
}
/* 100 € em 12: 4/12 arredondado é 33,33 — a segunda fica com 66,67, não 66,66. */
const cem = repartirValor(10000, 12, 4);
check("100 € a 4/12 → 33,33 + 66,67", cem.primeira === 3333 && cem.segunda === 6667, JSON.stringify(cem));

/* ------------------------------------------------------------------ 4 ---- */
console.log("\n=== 4. Ida e volta: o mês final que se escolheu é o que se lê ===");
for (const dia of [1, 15, 22, 28]) {
  for (const ate of ["2026-09", "2026-12", "2027-01", "2027-08"]) {
    const fim = fimDaCobertura(ate, dia);
    if (mesFinalCoberto(fim) !== ate) {
      check(`dia ${dia}, até ${ate}`, false, `voltou ${mesFinalCoberto(fim)}`);
    }
  }
}
check("em todos os dias e meses testados, fimDaCobertura e mesFinalCoberto são inversos", true);

/* ------------------------------------------------------------------ 5 ---- */
console.log("\n=== 5. Meses curtos não transbordam ===");
/* Quem adere a 31 de Janeiro não tem 31 de Fevereiro. */
const fev = fimDaCobertura("2026-01", 31);
check("aberto a 31/01, cobrar até Janeiro acaba em Fevereiro e não em Março", iso(fev).startsWith("2026-02"), iso(fev));
const bissexto = inicioDaCobertura("2028-02", 31);
check("31 de Fevereiro de 2028 encolhe para 29 (bissexto)", iso(bissexto) === "2028-02-29", iso(bissexto));

/* ------------------------------------------------------------------ 6 ---- */
console.log("\n=== 6. Abertura no dia 1 — o clube que cobra ao mês civil ===");
const p1 = inicioDaCobertura("2026-09", 1);
const f1 = fimDaCobertura("2026-12", 1);
check("de 01/09/2026", iso(p1) === "2026-09-01", iso(p1));
check("a 31/12/2026 — o mês escolhido inteiro", iso(f1) === "2026-12-31", iso(f1));
check("e são 4 meses", mesesCobertos(p1, f1) === 4, String(mesesCobertos(p1, f1)));

/* ------------------------------------------------------------------ 7 ---- */
console.log("\n=== 7. Sobreposições — ninguém deve o mesmo mês duas vezes ===");
const primeira = { de: inicio, ate: fimEmDez };
const segunda = { de: inicioSegunda, ate: fimDoAno };
check("as duas partes de um ano partido NÃO se sobrepõem", !sobrepoem(primeira, segunda));
check("mas o ano inteiro sobrepõe-se a qualquer uma delas", sobrepoem({ de: inicio, ate: fimDoAno }, segunda));
check("um ano seguinte não se sobrepõe", !sobrepoem(
  { de: inicioDaCobertura("2027-09", DIA), ate: fimDaCobertura(mesMais("2027-09", 11), DIA) },
  primeira,
));

/* ------------------------------------------------------------------ 8 ---- */
console.log("\n=== 8. Contas de meses ===");
check("de Setembro a Dezembro são 4", distanciaEmMeses("2026-09", "2026-12") === 4);
check("de Setembro a Setembro é 1", distanciaEmMeses("2026-09", "2026-09") === 1);
check("de Dezembro a Janeiro (ano seguinte) são 2", distanciaEmMeses("2026-12", "2027-01") === 2);
check("o mês anterior dá 0 — é o que trava um fim antes do início", distanciaEmMeses("2026-09", "2026-08") === 0);
check("mesMais atravessa o ano", mesMais("2026-12", 1) === "2027-01");
check("mesDe lê a data em UTC", mesDe(new Date(Date.UTC(2026, 8, 22))) === "2026-09");

/* ------------------------------------------------------------------ 9 ---- */
console.log("\n=== 9. Mudar o mês de abertura e redatar a quota a decorrer ===");
/*
 * O caso do clube: uma quota de Janeiro a Dezembro, e o clube passa a cobrar a
 * partir de 1 de Setembro. Escolhendo "passar também esta para a janela nova",
 * a quota em curso deixa de ser Jan–Dez e passa a 1/09 a 31/08. É a conta que o
 * `definirAnoDeQuotas` faz, e a mesma que o diálogo pré-visualiza.
 */
const hoje = new Date(2026, 8, 23); // 23 de Setembro de 2026 (relógio local, como a função)
const cicloNovo = inicioDaEpoca(hoje, 9, 1);
check("o ciclo que contém hoje, abrindo a 1 de Setembro, é 2026-09", cicloNovo === "2026-09", cicloNovo);
const deNovo = inicioDaCobertura(cicloNovo, 1);
const ateNovo = fimDaCobertura(mesMais(cicloNovo, 11), 1);
check("a quota passa a começar a 01/09/2026", iso(deNovo) === "2026-09-01", iso(deNovo));
check("e a acabar a 31/08/2027", iso(ateNovo) === "2027-08-31", iso(ateNovo));
check("continua a valer doze meses", mesesCobertos(deNovo, ateNovo) === 12);

/* A janela antiga (Jan–Dez 2026) e a nova pisam-se, e é por isso que redatar é
   substituir a mesma linha em vez de criar outra. */
const janelaAntiga = { de: new Date(Date.UTC(2026, 0, 1)), ate: new Date(Date.UTC(2026, 11, 31)) };
check("a janela antiga e a nova sobrepõem-se (daí redatar, não criar)", sobrepoem(janelaAntiga, { de: deNovo, ate: ateNovo }));

/* Antes de a abertura chegar, o ciclo ainda é o de trás — não se salta um ano. */
const emMarco = inicioDaEpoca(new Date(2026, 2, 15), 9, 1);
check("a 15 de Março, com abertura em Setembro, o ciclo é 2025-09", emMarco === "2025-09", emMarco);
/* E no próprio dia da abertura já conta o novo. */
check("no dia 1 de Setembro já é o ciclo novo", inicioDaEpoca(new Date(2026, 8, 1), 9, 1) === "2026-09");
check("na véspera ainda é o anterior", inicioDaEpoca(new Date(2026, 7, 31), 9, 1) === "2025-09");

/* ----------------------------------------------------------------- 10 ---- */
console.log("\n=== 10. A lacuna, e a ponte que a cobre ===");
/*
 * O período morto: quota de Janeiro a Dezembro, e o clube passa a cobrar a 1 de
 * Setembro. Sem fazer nada, o sócio deixa de ser cobrado entre 1 de Janeiro e
 * 31 de Agosto — o ciclo novo só abre em Setembro. A ponte cobre exactamente
 * esse intervalo, ao preço proporcional aos meses.
 */
function lacunaDepoisDe(fimActual, mesAbertura, diaAbertura) {
  const mm = String(mesAbertura).padStart(2, "0");
  let proxima = inicioDaCobertura(`${fimActual.getUTCFullYear()}-${mm}`, diaAbertura);
  if (proxima <= fimActual) proxima = inicioDaCobertura(`${fimActual.getUTCFullYear() + 1}-${mm}`, diaAbertura);
  const de = new Date(fimActual.getTime() + 86_400_000);
  const ate = new Date(proxima.getTime() - 86_400_000);
  if (ate < de) return null;
  return { de, ate, meses: distanciaEmMeses(mesDe(de), mesFinalCoberto(ate)) };
}

const fimJanDez = new Date(Date.UTC(2026, 11, 31)); // 31/12/2026
const g = lacunaDepoisDe(fimJanDez, 9, 1);
check("a lacuna começa a 01/01/2027", iso(g.de) === "2027-01-01", iso(g.de));
check("e acaba a 31/08/2027, véspera da abertura nova", iso(g.ate) === "2027-08-31", iso(g.ate));
check("são 8 meses", g.meses === 8, String(g.meses));
check("a ponte de uma anuidade de 120 € custa 80 €", Math.round((12000 * g.meses) / 12) === 8000);

/* Mudar para Janeiro não deixa lacuna nenhuma: encaixa no dia seguinte. */
check("abertura a 1 de Janeiro depois de um ano que acaba a 31/12: sem lacuna", lacunaDepoisDe(fimJanDez, 1, 1) === null);

/* Uma lacuna curta continua a ser uma lacuna. */
const curta = lacunaDepoisDe(fimJanDez, 2, 1);
check("abertura a 1 de Fevereiro deixa 1 mês", curta !== null && curta.meses === 1, JSON.stringify(curta?.meses));
check("de 01/01/2027 a 31/01/2027", iso(curta.de) === "2027-01-01" && iso(curta.ate) === "2027-01-31");

/* E a ponte não se sobrepõe nem ao ano velho nem ao ciclo novo. */
const anoVelho = { de: new Date(Date.UTC(2026, 0, 1)), ate: fimJanDez };
const cicloDepois = { de: inicioDaCobertura("2027-09", 1), ate: fimDaCobertura(mesMais("2027-09", 11), 1) };
check("a ponte não pisa o ano que acabou", !sobrepoem(anoVelho, { de: g.de, ate: g.ate }));
check("nem o ciclo que abre a seguir", !sobrepoem(cicloDepois, { de: g.de, ate: g.ate }));
check("e os três juntos cobrem tudo sem buracos", iso(new Date(g.ate.getTime() + 86_400_000)) === iso(cicloDepois.de));

/* ----------------------------------------------------------------- 11 ---- */
console.log("");
console.log("=== 11. A coluna do ano de quotas na folha de importação ===");

/*
 * Esta é a regra mais destrutiva da importação: dela sai a decisão de apagar as
 * quotas de um ano. O que se prova aqui é sobretudo **quando é que ela não
 * dispara** — um falso positivo refaz a anuidade de um livro inteiro, e no
 * ida-e-volta normal (exportar, corrigir uma morada, reimportar) a coluna vem
 * preenchida em toda a gente.
 */
const HOJE = { mes: 3, dia: 5 };
const emSetembro = { annualStartMonth: 9, annualStartDay: 22 };

/* Ficha nova. */
const novaVazia = decisaoDoAnoDaFolha(null, null, HOJE);
check("sócio novo sem célula: abre hoje", novaVazia.grava?.mes === 3 && novaVazia.grava?.dia === 5, JSON.stringify(novaVazia));
check("e não há nada a refazer", novaVazia.refaz === false);

const novaCheia = decisaoDoAnoDaFolha("09-22", null, HOJE);
check("sócio novo com célula: abre no que a célula diz", novaCheia.grava?.mes === 9 && novaCheia.grava?.dia === 22, JSON.stringify(novaCheia));
check("e continua sem nada a refazer", novaCheia.refaz === false);

/* Ficha que já cá está. */
const velhaVazia = decisaoDoAnoDaFolha(null, emSetembro, HOJE);
check("sócio existente com célula vazia: não se toca", velhaVazia.grava === null, JSON.stringify(velhaVazia));
check("e não se refaz nada", velhaVazia.refaz === false);

const velhaIgual = decisaoDoAnoDaFolha("09-22", emSetembro, HOJE);
check("célula igual à ficha: não refaz o ano", velhaIgual.refaz === false, JSON.stringify(velhaIgual));
check("e o valor gravado é o mesmo", velhaIgual.grava?.mes === 9 && velhaIgual.grava?.dia === 22);

const velhaOutroDia = decisaoDoAnoDaFolha("09-23", emSetembro, HOJE);
check("um dia diferente refaz o ano", velhaOutroDia.refaz === true, JSON.stringify(velhaOutroDia));
const velhaOutroMes = decisaoDoAnoDaFolha("01-22", emSetembro, HOJE);
check("um mês diferente refaz o ano", velhaOutroMes.refaz === true, JSON.stringify(velhaOutroMes));
check("com a data nova", velhaOutroMes.grava?.mes === 1 && velhaOutroMes.grava?.dia === 22);

/*
 * Quem herda a abertura do clube tem os campos a nulo na base. A folha
 * exportada traz lá a data do clube já resolvida — e reimportá-la **grava-a** e
 * refaz o ano, que é a leitura certa: a partir daí a data é dele e deixa de
 * seguir o clube. É a única maneira de o ida-e-volta não mentir.
 */
const herdeiro = { annualStartMonth: null, annualStartDay: null };
const herdado = decisaoDoAnoDaFolha("09-01", herdeiro, HOJE);
check("quem herdava e recebe a data na folha passa a tê-la", herdado.grava?.mes === 9 && herdado.grava?.dia === 1);
check("e o ano é refeito, porque deixou de seguir o clube", herdado.refaz === true);
check("mas com a célula vazia continua a herdar", decisaoDoAnoDaFolha(null, herdeiro, HOJE).grava === null);

/* O 29 de Fevereiro é uma data válida numa abertura — quem trata dos anos
   não-bissextos é o `aberturaDoSocio`, e não esta decisão. */
const vinteNove = decisaoDoAnoDaFolha("02-29", emSetembro, HOJE);
check("29 de Fevereiro atravessa", vinteNove.grava?.mes === 2 && vinteNove.grava?.dia === 29, JSON.stringify(vinteNove));

console.log(`\n${failed === 0 ? "TUDO OK" : "HÁ FALHAS"} — ${passed} ok, ${failed} falhas`);
process.exit(failed === 0 ? 0 : 1);

/**
 * Os minutos jogados: prolongamento, tempo adicional e vermelhos.
 *
 * Corre `minutosEmCampo` sozinha, sem base de dados. As regras de sempre
 * (titular, entrada, saída, tempo adicional) estão também em
 * `test-tempo-adicional.mjs`, contra a API.
 *
 * Uso: npm run test:minutos-do-jogo --workspace @academia/api
 */
import {
  fimDasPartes, intervalosEmCampo, minutoDaExpulsao, minutosDasPartesParaGravar, minutosEmCampo, partesComTempoAdicional,
  partesDesiguais, partesDoJogo, problemaNasPartes, problemaNoTempoDoJogo, problemaNosIntervalos,
} from "../src/academy/minutos-do-jogo";

let ok = 0;
let bad = 0;
const igual = (l: string, real: unknown, esperado: unknown) => {
  if (JSON.stringify(real) === JSON.stringify(esperado)) {
    ok++;
    console.log("  OK    " + l);
  } else {
    bad++;
    console.log(`  FALHA ${l} — ${JSON.stringify(real)} em vez de ${JSON.stringify(esperado)}`);
  }
};

console.log("=== O que já era assim ===");
igual("titular num jogo de 90", minutosEmCampo({ started: true }, 90), 90);
igual("entrou aos 60", minutosEmCampo({ onMinute: 60 }, 90), 30);
igual("suplente sem entrada não tem minutos", minutosEmCampo({}, 90), 0);
igual("90 com +2 e +3, jogou tudo", minutosEmCampo({ started: true }, 90, [2, 3], 2), 95);
igual("saiu ao intervalo: 45 + 2", minutosEmCampo({ started: true, offMinute: 45 }, 90, [2, 3], 2), 47);

console.log("\n=== O vermelho é uma saída ===");
igual("titular expulso aos 30 joga 30", minutosEmCampo({ started: true, redAt: 30 }, 90), 30);
igual("suplente que entra aos 60 e é expulso aos 75 joga 15", minutosEmCampo({ onMinute: 60, redAt: 75 }, 90), 15);
igual("expulso aos 45+2 (vai como 45) leva a compensação da 1.ª", minutosEmCampo({ started: true, redAt: 45 }, 90, [2, 3], 2), 47);
igual("expulso já no banco: conta a saída", minutosEmCampo({ started: true, offMinute: 50, redAt: 70 }, 90), 50);
igual("futsal: expulso aos 25 de 40", minutosEmCampo({ started: true, redAt: 25 }, 40), 25);

console.log("\n=== O segundo amarelo também é uma saída ===");
igual("titular com dois amarelos (20 e 55) joga 55", minutosEmCampo({ started: true, yellowCards: 2, yellowAt: [55, 20] }, 90), 55);
igual("um amarelo só não tira de campo", minutosEmCampo({ started: true, yellowCards: 1, yellowAt: [20] }, 90), 90);
igual("dois amarelos sem minutos: não se sabe quando saiu", minutosEmCampo({ started: true, yellowCards: 2, yellowAt: [] }, 90), 90);
igual("o vermelho manda sobre os amarelos", minutoDaExpulsao({ redAt: 70, yellowCards: 2, yellowAt: [20, 60] }), 70);
igual("volantes: o segundo amarelo fecha a vez aberta", minutosEmCampo({ started: true, stints: [0, 10, 20], yellowCards: 2, yellowAt: [5, 30] }, 40), 20);

console.log("\n=== Prolongamento ===");
igual("onde acabam as partes num 90 + 2 × 15", fimDasPartes(90, 2, [15, 15]), [45, 90, 105, 120]);
igual("futebol: jogou tudo num 90 + 2 × 15", minutosEmCampo({ started: true }, 90, [], 2, [15, 15]), 120);
igual("entrou aos 100 do prolongamento", minutosEmCampo({ onMinute: 100 }, 90, [], 2, [15, 15]), 20);
igual("saiu aos 80: o prolongamento não lhe conta", minutosEmCampo({ started: true, offMinute: 80 }, 90, [], 2, [15, 15]), 80);
igual(
  "compensação nas quatro partes, jogou tudo: 120 + 2 + 3 + 1 + 2",
  minutosEmCampo({ started: true }, 90, [2, 3, 1, 2], 2, [15, 15]),
  128,
);
igual(
  "saiu aos 90: leva as compensações das duas partes regulamentares",
  minutosEmCampo({ started: true, offMinute: 90 }, 90, [2, 3, 1, 2], 2, [15, 15]),
  95,
);
igual("futsal: 40 + 2 × 5", minutosEmCampo({ started: true }, 40, [], 0, [5, 5]), 50);
igual("basquetebol: 40 + dois prolongamentos de 5", minutosEmCampo({ started: true }, 40, [], 0, [5, 5]), 50);
igual("basquetebol: entrou no 1.º prolongamento (aos 41)", minutosEmCampo({ onMinute: 41 }, 40, [], 0, [5]), 4);
igual("expulso no prolongamento, aos 110", minutosEmCampo({ started: true, redAt: 110 }, 90, [], 2, [15, 15]), 110);

console.log("\n=== Substituições ilimitadas: várias vezes em campo ===");
igual("futsal: titular sai aos 8, volta aos 15, sai aos 30", minutosEmCampo({ started: true, stints: [0, 8, 15, 30] }, 40), 23);
igual("futsal: titular sai aos 8 e volta aos 15 até ao fim", minutosEmCampo({ started: true, stints: [0, 8, 15] }, 40), 33);
igual("suplente entra aos 5, sai aos 12, entra aos 20, sai aos 26", minutosEmCampo({ stints: [5, 12, 20, 26] }, 40), 13);
igual("sai e volta no mesmo minuto", minutosEmCampo({ started: true, stints: [0, 10, 10] }, 40), 40);
igual("os intervalos mandam, mesmo com onMinute", minutosEmCampo({ onMinute: 30, stints: [5, 10] }, 40), 5);
igual("expulso no 2.º intervalo aberto: acaba no vermelho", minutosEmCampo({ started: true, stints: [0, 10, 20], redAt: 25 }, 40), 15);
igual("futebol com descontos: [0,45] leva o +2, [60, fim] leva o +3", minutosEmCampo({ started: true, stints: [0, 45, 60] }, 90, [2, 3], 2), 47 + 33);
igual("futebol: entra ao intervalo não leva o +2 da 1.ª", minutosEmCampo({ stints: [45, 60] }, 90, [2, 3], 2), 15);
igual("com prolongamento: [80, fim] num 90 + 2 × 15", minutosEmCampo({ stints: [80] }, 90, [], 2, [15, 15]), 40);
igual("lista vazia: a regra de sempre", minutosEmCampo({ started: true, stints: [] }, 40), 40);
igual("intervalos lidos", intervalosEmCampo({ stints: [0, 8, 15] }), [{ de: 0, ate: 8 }, { de: 15, ate: null }]);
igual("titular tem de começar aos 0", problemaNosIntervalos([3, 8], true), "Um titular entra ao minuto 0.");
igual("fora de ordem", problemaNosIntervalos([0, 8, 5], true), "As entradas e saídas não estão por ordem.");
igual("por ordem, com o mesmo minuto repetido", problemaNosIntervalos([0, 10, 10, 20], true), null);

console.log("\n=== Partes da equipa (infantis em 3 partes) ===");
igual("sem escolha: as da modalidade (futebol)", partesDoJogo("football", null), 2);
igual("sem escolha: as da modalidade (basquetebol)", partesDoJogo("basketball", null), 4);
igual("modalidade sem perfil: duas", partesDoJogo("natacao", null), 2);
igual("a da equipa ganha", partesDoJogo("football", 3), 3);
igual("tempo adicional nas 3 partes do futebol", partesComTempoAdicional("football", 3), 3);
igual("futsal em 3 partes não tem tempo adicional", partesComTempoAdicional("futsal", 3), 0);
igual("60 em 3 partes dá", problemaNasPartes(60, 3), null);
igual("50 em 3 partes não dá", problemaNasPartes(50, 3) !== null, true);
igual("sem duração não há problema", problemaNasPartes(null, 3), null);
igual("fins de 3 × 20", fimDasPartes(60, 3), [20, 40, 60]);
igual("3 × 20 com +1 +2 +3, jogou tudo", minutosEmCampo({ started: true }, 60, [1, 2, 3], 3), 66);
igual("saiu no fim da 1.ª (aos 20): 20 + 1", minutosEmCampo({ started: true, offMinute: 20 }, 60, [1, 2, 3], 3), 21);
igual("entrou na 2.ª (aos 20) e saiu aos 40: 20 + 2", minutosEmCampo({ onMinute: 20, offMinute: 40 }, 60, [1, 2, 3], 3), 22);
igual("entrou na 3.ª (aos 40) até ao fim: 20 + 3", minutosEmCampo({ onMinute: 40 }, 60, [1, 2, 3], 3), 23);

console.log("\n=== Partes com minutos diferentes (15 + 15 + 40) ===");
igual("fins de 15 + 15 + 40", fimDasPartes(70, 3, [], [15, 15, 40]), [15, 30, 70]);
igual("com prolongamento a seguir", fimDasPartes(70, 3, [10], [15, 15, 40]), [15, 30, 70, 80]);
igual("lista que não bate com as partes: iguais", fimDasPartes(60, 3, [], [30, 30]), [20, 40, 60]);
igual("as partes da equipa", partesDesiguais(3, [15, 15, 40]), [15, 15, 40]);
igual("lista de outro número de partes não conta", partesDesiguais(2, [15, 15, 40]), []);
igual("saiu no fim da 2.ª (aos 30): 30 + 1 + 2", minutosEmCampo({ started: true, offMinute: 30 }, 70, [1, 2, 3], 3, [], [15, 15, 40]), 33);
igual("entrou aos 30 até ao fim: 40 + 3", minutosEmCampo({ onMinute: 30 }, 70, [1, 2, 3], 3, [], [15, 15, 40]), 43);
igual("saiu aos 20, na 2.ª: só leva o +1", minutosEmCampo({ started: true, offMinute: 20 }, 70, [1, 2, 3], 3, [], [15, 15, 40]), 21);
igual("15 + 15 + 40 num jogo de 70 dá", problemaNoTempoDoJogo(70, 3, [15, 15, 40]), null);
igual("somam 70 e o jogo dura 60", problemaNoTempoDoJogo(60, 3, [15, 15, 40]), "As partes somam 70 minutos e o jogo dura 60.");
igual("falta uma parte", problemaNoTempoDoJogo(30, 3, [15, 15]), "Escreve os minutos de cada uma das 3 partes.");
igual("parte de zero minutos", problemaNoTempoDoJogo(30, 2, [30, 0]) !== null, true);
igual("sem lista: a regra das partes iguais", problemaNoTempoDoJogo(50, 3), problemaNasPartes(50, 3));
igual("iguais gravam-se vazias", minutosDasPartesParaGravar([20, 20, 20]), []);
igual("diferentes gravam-se", minutosDasPartesParaGravar([15, 15, 40]), [15, 15, 40]);
console.log(`\n${ok} passaram, ${bad} falharam`);
process.exit(bad ? 1 : 0);

/**
 * O relógio do jogo ao vivo, nas três modalidades.
 *
 * Corre as funções que o `LiveMatch` usa (`relogio.ts`) com os perfis a sério
 * de `sports.ts`: o que se verifica é o que o ecrã mostra e o minuto que vai
 * para a ficha.
 *
 * Uso: npm run test:relogio --workspace @academia/console
 */
import { SPORT_PROFILES } from "@/lib/sports";
import { ajustar, carimbo, descontosDeTempo, mostrador, nomeDaParte, regrasDoJogo, rotulo, tempoAdicional } from "@/components/match/relogio";

let ok = 0;
let bad = 0;
const check = (l: string, c: boolean, d = "") => {
  if (c) {
    ok++;
    console.log("  OK    " + l);
  } else {
    bad++;
    console.log("  FALHA " + l + (d ? " — " + d : ""));
  }
};
const igual = (l: string, real: unknown, esperado: unknown) =>
  check(l, JSON.stringify(real) === JSON.stringify(esperado), `${JSON.stringify(real)} em vez de ${JSON.stringify(esperado)}`);

const min = (m: number, s = 0) => m * 60 + s;

console.log("=== Futebol (2 × 45, relógio do jogo) ===");
const fut = regrasDoJogo(SPORT_PROFILES.football, 90);
igual("a 1.ª parte chama-se assim", nomeDaParte(fut, 1), "1.ª parte");
igual("aos 12:30 da 1.ª", mostrador(fut, 1, min(12, 30)).principal, "12:30");
igual("a 2.ª parte começa nos 45:00", mostrador(fut, 2, 0).principal, "45:00");
igual("aos 21:10 da 2.ª o relógio diz 66:10", mostrador(fut, 2, min(21, 10)).principal, "66:10");
const compensa = mostrador(fut, 1, min(46, 20));
igual("na compensação o relógio fica nos 45:00", compensa.principal, "45:00");
igual("e a compensação conta à parte", compensa.extra, "+01:20");
igual("um golo aos 21:10 da 2.ª é ao minuto 67", carimbo(fut, 2, min(21, 10)), { parte: 2, minuto: 67 });
const g45 = carimbo(fut, 1, min(46, 20));
igual("um golo aos 46:20 da 1.ª é 45+2", rotulo(fut, g45), "45+2′");
igual("e vai para a ficha como 45", g45.minuto, 45);
igual("acertar +1 a 45 passa a 45+1", ajustar(fut, { parte: 1, minuto: 45 }, 1), { parte: 1, minuto: 45, extra: 1 });
igual("acertar −1 a 45+1 volta a 45", ajustar(fut, { parte: 1, minuto: 45, extra: 1 }, -1), { parte: 1, minuto: 45 });
igual("acertar não passa para a parte de antes", ajustar(fut, { parte: 2, minuto: 46 }, -1), { parte: 2, minuto: 46 });
igual("compensação: o jogado a mais, arredondado", tempoAdicional(fut, [min(47, 40), min(49, 10)], []), [3, 4]);
igual("o anunciado é o mínimo", tempoAdicional(fut, [min(45, 20), min(45)], [2, 5]), [2, 5]);
igual("sem descontos de tempo", descontosDeTempo(fut, 1, []), null);

console.log("\n=== Futebol, a ler o relógio da parte ===");
igual("aos 10:28 da 2.ª o relógio diz 10:28", mostrador(fut, 2, min(10, 28), "parte").principal, "10:28");
igual("na compensação da 2.ª fica nos 45:00", mostrador(fut, 2, min(47), "parte").principal, "45:00");
igual("e a compensação conta à parte", mostrador(fut, 2, min(47), "parte").extra, "+02:00");
igual("o golo ao 67 lê-se 22′ (da 2.ª)", rotulo(fut, { parte: 2, minuto: 67 }, "parte"), "22′");
igual("o 90+3 lê-se 45+3′", rotulo(fut, { parte: 2, minuto: 90, extra: 3 }, "parte"), "45+3′");
igual("no prolongamento conta do zero da parte", mostrador(regrasDoJogo(SPORT_PROFILES.football, 90, [15, 15]), 4, min(3), "parte").principal, "03:00");

console.log("\n=== Futebol de formação (2 × 30) ===");
const fut60 = regrasDoJogo(SPORT_PROFILES.football, 60);
igual("a 2.ª parte começa nos 30:00", mostrador(fut60, 2, 0).principal, "30:00");
igual("um golo aos 31:00 da 1.ª é 30+2", rotulo(fut60, carimbo(fut60, 1, min(31))), "30+2′");

console.log("\n=== Futsal (2 × 20, cronómetro por parte) ===");
const fs = regrasDoJogo(SPORT_PROFILES.futsal, 40);
igual("a 2.ª parte começa do zero", mostrador(fs, 2, 0).principal, "00:00");
const fim = mostrador(fs, 1, min(20, 15));
igual("o relógio não passa dos 20:00", fim.principal, "20:00");
check("e diz que a parte acabou", fim.esgotado);
igual("sem compensação", fim.extra, null);
const golo = carimbo(fs, 2, min(4, 30));
igual("um golo aos 4:30 da 2.ª lê-se 5′", rotulo(fs, golo), "5′");
igual("e vai para a ficha como 25", golo.minuto, 25);
igual("acertar não passa dos 20 da parte", ajustar(fs, { parte: 1, minuto: 20 }, 1), { parte: 1, minuto: 20 });
igual("um desconto de tempo por parte", descontosDeTempo(fs, 1, []), { usados: 0, max: 1 });
igual("o da 1.ª não conta na 2.ª", descontosDeTempo(fs, 2, [{ parte: 1 }]), { usados: 0, max: 1 });
igual("sem tempo adicional", tempoAdicional(fs, [min(22), min(25)], [1, 1]), []);

console.log("\n=== Basquetebol (4 × 10, cronómetro por período) ===");
const bb = regrasDoJogo(SPORT_PROFILES.basketball, 40);
igual("o 3.º período chama-se assim", nomeDaParte(bb, 3), "3.º período");
igual("cada período começa do zero", mostrador(bb, 3, min(2, 5)).principal, "02:05");
const cesto = carimbo(bb, 3, min(3, 10));
igual("um cesto aos 3:10 do 3.º lê-se 4′", rotulo(bb, cesto), "4′");
igual("e vai para a ficha como 24", cesto.minuto, 24);
igual("dois descontos de tempo na 1.ª metade", descontosDeTempo(bb, 2, [{ parte: 1 }]), { usados: 1, max: 2 });
igual("três na 2.ª metade", descontosDeTempo(bb, 4, [{ parte: 1 }, { parte: 3 }]), { usados: 1, max: 3 });

console.log("\n=== Minibasquete (4 × 8) ===");
const mini = regrasDoJogo(SPORT_PROFILES.basketball, 32);
igual("períodos de 8", mostrador(mini, 1, min(9)).principal, "08:00");

console.log("\n=== Prolongamento, futebol (2 × 15) ===");
const futP = regrasDoJogo(SPORT_PROFILES.football, 90, [15, 15]);
igual("a 3.ª parte é a 1.ª do prolongamento", nomeDaParte(futP, 3), "1.ª parte do prolongamento");
igual("começa nos 90:00", mostrador(futP, 3, 0).principal, "90:00");
igual("a 2.ª do prolongamento começa nos 105:00", mostrador(futP, 4, 0).principal, "105:00");
igual("um golo aos 10:30 da 2.ª do prolongamento é ao 116", carimbo(futP, 4, min(10, 30)), { parte: 4, minuto: 116 });
igual("na compensação do prolongamento: 120+1", rotulo(futP, carimbo(futP, 4, min(15, 30))), "120+1′");
igual("tempo adicional nas quatro partes", tempoAdicional(futP, [min(46), min(47), min(16), min(15)], []), [1, 2, 1, 0]);
igual("sem descontos de tempo no prolongamento", descontosDeTempo(futP, 3, []), null);

console.log("\n=== Prolongamento, futsal (2 × 5) ===");
const fsP = regrasDoJogo(SPORT_PROFILES.futsal, 40, [5, 5]);
igual("cada parte do prolongamento começa do zero", mostrador(fsP, 3, min(2)).principal, "02:00");
igual("e acaba aos 5", mostrador(fsP, 3, min(6)).principal, "05:00");
const goloP = carimbo(fsP, 4, min(1, 10));
igual("um golo aos 1:10 da 2.ª do prolongamento lê-se 2′", rotulo(fsP, goloP), "2′");
igual("e vai para a ficha como 47", goloP.minuto, 47);
igual("sem descontos de tempo no prolongamento", descontosDeTempo(fsP, 3, []), null);

console.log("\n=== Prolongamento, basquetebol (períodos de 5) ===");
const bbP = regrasDoJogo(SPORT_PROFILES.basketball, 40, [5, 5]);
igual("o 5.º período é o 1.º prolongamento", nomeDaParte(bbP, 5), "1.º prolongamento");
igual("o 6.º é o 2.º prolongamento", nomeDaParte(bbP, 6), "2.º prolongamento");
igual("um cesto aos 3:00 do 2.º prolongamento vai como 49", carimbo(bbP, 6, min(3)).minuto, 49);
igual("um desconto de tempo por prolongamento", descontosDeTempo(bbP, 6, [{ parte: 5 }]), { usados: 0, max: 1 });

console.log("\n=== Sem modalidade ===");
const sem = regrasDoJogo(null, null);
igual("duas partes de 45, relógio do jogo", [sem.partes, sem.duracaoParte, sem.reinicia], [2, 45, false]);

console.log(`\n${ok} passaram, ${bad} falharam`);
process.exit(bad ? 1 : 0);

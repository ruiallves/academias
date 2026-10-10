/**
 * Os minutos jogados: prolongamento, tempo adicional e vermelhos.
 *
 * Corre `minutosEmCampo` sozinha, sem base de dados. As regras de sempre
 * (titular, entrada, saída, tempo adicional) estão também em
 * `test-tempo-adicional.mjs`, contra a API.
 *
 * Uso: npm run test:minutos-do-jogo --workspace @academia/api
 */
import { fimDasPartes, minutosEmCampo } from "../src/academy/minutos-do-jogo";

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

console.log(`\n${ok} passaram, ${bad} falharam`);
process.exit(bad ? 1 : 0);

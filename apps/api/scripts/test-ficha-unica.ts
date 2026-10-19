/**
 * Uma ficha de staff por pessoa: o cargo de um segundo convite junta-se à ficha
 * que existe, e o de maior alcance fica como principal.
 *
 * Corre `juntarCargo` sozinha, sem base de dados. Os casos são os dos clubes:
 * o coordenador que também treina (Santa Maria FC) e a diretora que também
 * treina (Juventude AC), nas duas ordens.
 *
 * Uso: npm run test:ficha-unica --workspace @academia/api
 */
import { juntarCargo, patente, type Cargo } from "../src/invites/ficha-unica";

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

const cargo = (roleId: string, rank: number, role: Cargo["role"]): Cargo => ({ roleId, rank, role, title: roleId, department: null });
const COORDENADOR = cargo("coordenador", 80, "DIRECTOR");
const TREINADOR = cargo("treinador", 40, "COACH");
const DIRETORA = cargo("diretora", 100, "OWNER");
const ENFERMEIRO = cargo("enfermeiro", 40, "MEDICAL");

console.log("=== O de maior alcance fica principal ===");
let f = juntarCargo({ principal: COORDENADOR, secundarios: [] }, TREINADOR);
igual("coordenador que recebe convite de treinador: continua coordenador", f.principal.roleId, "coordenador");
igual("… e o treinador fica secundário", f.secundarios, ["treinador"]);

f = juntarCargo({ principal: TREINADOR, secundarios: [] }, COORDENADOR);
igual("treinador que recebe convite de coordenador: passa a coordenador", f.principal.roleId, "coordenador");
igual("… e o de treinador passa a secundário", f.secundarios, ["treinador"]);
igual("… com o papel-base do coordenador (é o que dá o âmbito)", f.principal.role, "DIRECTOR");

console.log("\n=== Os secundários que já havia ficam ===");
f = juntarCargo({ principal: TREINADOR, secundarios: ["enfermeiro"] }, DIRETORA);
igual("treinadora com enfermeiro, convidada como diretora", f, {
  principal: DIRETORA,
  secundarios: ["enfermeiro", "treinador"],
});

console.log("\n=== Sem repetidos ===");
f = juntarCargo({ principal: DIRETORA, secundarios: ["treinador"] }, TREINADOR);
igual("convite para um cargo que já é secundário não o duplica", f.secundarios, ["treinador"]);
f = juntarCargo({ principal: TREINADOR, secundarios: ["diretora"] }, DIRETORA);
igual("um secundário que passa a principal sai dos secundários", f, { principal: DIRETORA, secundarios: ["treinador"] });
f = juntarCargo({ principal: TREINADOR, secundarios: [] }, TREINADOR);
igual("o mesmo cargo outra vez não muda nada", f, { principal: TREINADOR, secundarios: [] });

console.log("\n=== Empate ===");
f = juntarCargo({ principal: TREINADOR, secundarios: [] }, ENFERMEIRO);
igual("mesma patente: fica o que já lá estava", f.principal.roleId, "treinador");
igual("… e o novo entra como secundário", f.secundarios, ["enfermeiro"]);

console.log("\n=== Fichas antigas, sem cargo ===");
const semCargo: Cargo = { roleId: null, rank: patente(null, null, "COACH"), role: "COACH", title: "Treinador", department: null };
f = juntarCargo({ principal: semCargo, secundarios: [] }, COORDENADOR);
igual("sem cargo vale o papel-base (treinador 40), e o coordenador ganha", f, { principal: COORDENADOR, secundarios: [] });
igual("patente de um cargo usa o rank do cargo", patente("x", 90, "COACH"), 90);
igual("sem cargo usa o papel-base", patente(null, 90, "DIRECTOR"), 80);

console.log(`\n${ok} passaram, ${bad} falharam`);
process.exit(bad ? 1 : 0);

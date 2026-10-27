/**
 * O aviso que chega ao treinador quando a família diz que o atleta não vai.
 *
 * Puro: não toca na base nem no servidor. Prova a escolha de quem recebe e o
 * texto da notificação. Ver `src/academy/aviso-ao-treinador.ts`.
 *
 * Uso: npm run test:aviso-ao-treinador
 */
import { destinatarios, textoDeQuemDa, textoDoAviso } from "../src/academy/aviso-ao-treinador";

let passed = 0;
let failed = 0;
const check = (l: string, ok: boolean, d = "") => {
  if (ok) { passed++; console.log("  OK    " + l); }
  else { failed++; console.log("  FALHA " + l + (d ? " — " + d : "")); }
};

console.log("=== Quem recebe ===");
const equipa = [
  { title: "Treinador principal", userId: "u_principal" },
  { title: "Treinador adjunto", userId: "u_adjunto" },
  { title: "Treinador de guarda-redes", userId: "u_gr" },
  { title: "Delegado", userId: "u_delegado" },
  { title: "Médica", userId: "u_medica" },
  { title: "Coordenador", userId: "u_coord" },
];
const todos = destinatarios(equipa, null, "u_pai");
check("os treinadores da equipa recebem", ["u_principal", "u_adjunto", "u_gr"].every((u) => todos.includes(u)), JSON.stringify(todos));
check("o delegado, a médica e o coordenador não", !todos.some((u) => ["u_delegado", "u_medica", "u_coord"].includes(u)), JSON.stringify(todos));

const comMarcado = destinatarios(equipa, "u_coord", "u_pai");
check("o treinador marcado no treino recebe, mesmo sem título de treinador", comMarcado.includes("u_coord"), JSON.stringify(comMarcado));

const repetido = destinatarios(equipa, "u_principal", "u_pai");
check("quem está nos dois lados recebe uma vez", repetido.filter((u) => u === "u_principal").length === 1, JSON.stringify(repetido));

const treinadorPai = destinatarios(equipa, null, "u_adjunto");
check("o treinador que avisou pelo filho não é avisado de si próprio", !treinadorPai.includes("u_adjunto"), JSON.stringify(treinadorPai));

check("equipa sem treinadores e sem treinador marcado: ninguém", destinatarios([{ title: "Delegado", userId: "u_d" }], null, "u_pai").length === 0);

console.log("\n=== O texto ===");
// 28/10/2026 18:30 em Lisboa = 18:30 UTC (já é hora de Inverno).
const inicio = new Date("2026-10-28T18:30:00Z");

const falta = textoDoAviso({ evento: "treino", atleta: "Tomás Silva", equipa: "Benjamins", inicio, motivo: "Está doente" });
check("treino: o título diz quem não vai", falta.title === "Tomás Silva não vai ao treino", falta.title);
check("treino: o texto diz a equipa, o dia, a hora e o motivo", falta.body.startsWith("Benjamins · ") && falta.body.includes("28 de outubro às 18:30") && falta.body.endsWith(" · Está doente"), falta.body);

const afinal = textoDoAviso({ evento: "treino", atleta: "Tomás Silva", equipa: "Benjamins", inicio, motivo: null });
check("treino retirado: diz que afinal vai", afinal.title === "Tomás Silva afinal vai ao treino", afinal.title);
check("e não deixa um separador solto no fim", !afinal.body.endsWith("·") && !afinal.body.endsWith(" "), afinal.body);

const jogo = textoDoAviso({ evento: "jogo", atleta: "Rui Costa", equipa: "Infantis A", adversario: "AD Fafe", inicio, motivo: "Casamento da tia" });
check("jogo: o título diz quem não vai", jogo.title === "Rui Costa não vai ao jogo", jogo.title);
check("jogo: o texto diz o adversário", jogo.body.startsWith("Infantis A com AD Fafe · "), jogo.body);

const jogoAfinal = textoDoAviso({ evento: "jogo", atleta: "Rui Costa", equipa: "Infantis A", adversario: "AD Fafe", inicio, motivo: null });
check("jogo: voltar atrás diz que afinal vai", jogoAfinal.title === "Rui Costa afinal vai ao jogo", jogoAfinal.title);

console.log("\n=== Quem dá o treino ===");
const um = textoDeQuemDa({ equipa: "Benjamins", inicio, local: "Campo 1" });
check("um treino: 'Vais dar um treino'", um.title === "Vais dar um treino", um.title);
check("com a equipa, a hora e o local", um.body.startsWith("Benjamins · ") && um.body.includes("às 18:30") && um.body.endsWith(" · Campo 1"), um.body);

const serie = textoDeQuemDa({ equipa: "Benjamins", inicio, total: 22, ultimo: new Date("2027-06-17T17:30:00Z"), local: "Campo 1" });
check("uma série é um aviso só, com quantos são", serie.title === "Vais dar 22 treinos", serie.title);
check("e diz até quando", serie.body.includes("a partir de") && serie.body.endsWith("até 17 de junho"), serie.body);

const umSoNaSerie = textoDeQuemDa({ equipa: "Benjamins", inicio, total: 1, ultimo: inicio });
check("uma série que só criou um treino fala de um treino", umSoNaSerie.title === "Vais dar um treino", umSoNaSerie.title);

const saiu = textoDeQuemDa({ equipa: "Benjamins", inicio, saiu: { para: "Rui Costa" } });
check("quem sai: 'Já não dás este treino'", saiu.title === "Já não dás este treino", saiu.title);
check("e para quem passou", saiu.body.endsWith(" · Passou para Rui Costa"), saiu.body);

console.log(`\n${passed} OK, ${failed} FALHA`);
process.exit(failed ? 1 : 0);

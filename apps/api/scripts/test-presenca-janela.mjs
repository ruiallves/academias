#!/usr/bin/env node
/**
 * A janela de presença, sem esperar por ela.
 *
 * `test-presenca.mjs` prova a cadeia toda contra a API a correr, mas não prova o
 * que acontece **depois** — a janela é de dois minutos, e um teste que dorme dois
 * minutos é um teste que ninguém corre.
 *
 * Aqui usa-se o serviço directamente e adianta-se o relógio. É a única parte
 * deste produto onde faz sentido: a lógica é uma comparação de `Date.now()` com
 * uma marca, e é precisamente essa comparação que se quer ver falhar quando o
 * tempo passa.
 *
 * Corre sobre `dist/` — `npm run build:server` antes.
 *
 * Uso: node scripts/test-presenca-janela.mjs
 */
import { PresenceService } from "../dist/presence/presence.service.js";

let ok = 0, bad = 0;
const check = (l, c, d = "") => {
  if (c) { ok++; console.log("  OK    " + l); }
  else { bad++; console.log("  FALHA " + l + (d ? " — " + d : "")); }
};

const relogioReal = Date.now;
/** Adianta o relógio do processo enquanto corre `fn`. */
function daquiA(ms, fn) {
  Date.now = () => relogioReal() + ms;
  try {
    return fn();
  } finally {
    Date.now = relogioReal;
  }
}

const total = (svc, academia) => svc.porAcademia().get(academia)?.total ?? 0;

console.log("=== Enquanto há sinal, conta ===");
const p = new PresenceService();
p.marcar("mem_a", "aca_1", "COACH");
check("logo a seguir a marcar", total(p, "aca_1") === 1, `${total(p, "aca_1")}`);
check("um minuto depois ainda lá está", daquiA(60_000, () => total(p, "aca_1")) === 1, "");

console.log("\n=== Passada a janela, sai ===");
/*
 * Dois minutos é a janela; o cliente bate de 45 em 45 segundos. A folga é de
 * propósito — um sinal perdido não deve fazer alguém piscar para fora da lista.
 */
check("aos 119s ainda conta", daquiA(119_000, () => total(p, "aca_1")) === 1, "");
check("aos 121s já não", daquiA(121_000, () => total(p, "aca_1")) === 0, "");

console.log("\n=== E volta se voltar a dar sinal ===");
p.marcar("mem_a", "aca_1", "COACH");
check("marcar outra vez repõe", total(p, "aca_1") === 1, "");

console.log("\n=== Staff e famílias contam separados ===");
const q = new PresenceService();
q.marcar("mem_dir", "aca_1", "DIRECTOR");
q.marcar("mem_trein", "aca_1", "COACH");
q.marcar("mem_pai", "aca_1", "GUARDIAN");
q.marcar("mem_atleta", "aca_1", "ATHLETE");
const l = q.porAcademia().get("aca_1");
check("dois do lado do staff", l.staff === 2, `${l.staff}`);
check("dois do lado da família", l.family === 2, `${l.family}`);
check("e o total é a soma", l.total === 4, `${l.total}`);

console.log("\n=== Cada clube conta o seu ===");
q.marcar("mem_outro", "aca_2", "DIRECTOR");
check("o primeiro clube não mexeu", q.porAcademia().get("aca_1").total === 4, "");
check("o segundo tem o seu", q.porAcademia().get("aca_2").total === 1, "");
check("e um clube sem ninguém nem aparece", q.porAcademia().get("aca_3") === undefined, "");

console.log("\n=== A mesma pessoa em dois separadores é uma ===");
const r = new PresenceService();
r.marcar("mem_a", "aca_1", "COACH");
r.marcar("mem_a", "aca_1", "COACH");
check("continua a ser um", total(r, "aca_1") === 1, `${total(r, "aca_1")}`);

console.log("\n=== A mesma pessoa em dois clubes está nos dois ===");
/*
 * Acontece a sério: um dirigente de um clube que é pai noutro. São duas
 * memberships, e por isso duas presenças — chavear por utilizador punha-a só num
 * deles, escolhido pelo último pedido.
 */
const t = new PresenceService();
t.marcar("mem_no_clube_a", "aca_1", "DIRECTOR");
t.marcar("mem_no_clube_b", "aca_2", "GUARDIAN");
check("conta no clube onde dirige", t.porAcademia().get("aca_1").staff === 1, "");
check("e no clube onde é pai", t.porAcademia().get("aca_2").family === 1, "");

console.log("\n=== O mapa não cresce para sempre ===");
/*
 * A varredura corre no máximo uma vez por minuto, pendurada nas escritas. Sem
 * ela, um clube com rotação de gente acumulava entradas mortas até ao reinício.
 */
const u = new PresenceService();
for (let i = 0; i < 500; i++) u.marcar(`mem_${i}`, "aca_1", "COACH");
check("500 presentes contam todos", total(u, "aca_1") === 500, `${total(u, "aca_1")}`);
daquiA(200_000, () => u.marcar("mem_novo", "aca_1", "COACH"));
// A varredura correu na escrita adiantada e levou os 500 que já tinham expirado.
check("passada a janela, sobra o que deu sinal", daquiA(200_000, () => total(u, "aca_1")) === 1, "");

console.log(`\n${ok} passaram, ${bad} falharam`);
process.exit(bad === 0 ? 0 : 1);

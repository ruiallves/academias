/**
 * As regras da área comercial, sem base de dados nem servidor.
 *
 * Prova o que acontece a um clube depois de cada resultado de chamada (quando
 * se volta a ligar, quando se desiste, que estado fica), que os seguimentos
 * saltam o fim de semana à mesma hora de Lisboa, e a conta do mês: horas ao
 * minuto e comissões por blocos de reuniões, com o que sobra a passar de mês.
 *
 * Uso: npm run test:comercial --workspace @academia/api
 */
import {
  comissoes,
  efeitoDaChamada,
  inicioDoDiaEDaSemana,
  limitesDoMes,
  MAX_TENTATIVAS,
  mesDe,
  minutosDoTurno,
  pagamento,
  proximoDiaUtil,
} from "../src/platform/comercial.regras";

let ok = 0;
let falhas = 0;
function check(nome: string, cond: boolean, detalhe?: unknown) {
  if (cond) {
    ok++;
    console.log(`  ✓ ${nome}`);
  } else {
    falhas++;
    console.log(`  ✗ ${nome}`, detalhe ?? "");
  }
}
const lisboa = (d: Date) => d.toLocaleString("pt-PT", { timeZone: "Europe/Lisbon", weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

console.log("\nDias úteis");
// Quinta 29/10/2026 às 15:30 em Lisboa (hora de inverno, UTC+0).
const quinta = new Date("2026-10-29T15:30:00Z");
check("quinta + 1 = sexta, mesma hora", lisboa(proximoDiaUtil(quinta, 1)).includes("30/10") && lisboa(proximoDiaUtil(quinta, 1)).includes("15:30"), lisboa(proximoDiaUtil(quinta, 1)));
check("quinta + 2 salta o fim de semana para segunda", lisboa(proximoDiaUtil(quinta, 2)).includes("02/11"), lisboa(proximoDiaUtil(quinta, 2)));
// Sexta 23/10 às 10:00 de verão (UTC+1) → segunda 26/10 às 10:00 de inverno.
const sextaVerao = new Date("2026-10-23T09:00:00Z");
const segunda = proximoDiaUtil(sextaVerao, 1);
check("atravessa a mudança de hora e fica às 10:00 de parede", lisboa(segunda).includes("26/10") && lisboa(segunda).includes("10:00"), lisboa(segunda));

console.log("\nChamadas");
const agora = new Date("2026-11-02T10:00:00Z"); // segunda
let e = efeitoDaChamada({ resultado: "NAO_ATENDEU", agora, estado: "NOVO", tentativas: 0 });
check("1.ª sem atender: fica por contactar", e.status === "NOVO" && e.tentativas === 1);
check("1.ª sem atender: volta amanhã", lisboa(e.nextActionAt!).includes("03/11"), lisboa(e.nextActionAt!));
e = efeitoDaChamada({ resultado: "NAO_ATENDEU", agora, estado: "NOVO", tentativas: 2 });
check("3.ª sem atender: volta daqui a 3 dias úteis", lisboa(e.nextActionAt!).includes("05/11") && e.tentativas === 3, lisboa(e.nextActionAt!));
e = efeitoDaChamada({ resultado: "NAO_ATENDEU", agora, estado: "CONTACTADO", tentativas: MAX_TENTATIVAS - 1 });
check("4.ª sem atender: passa a sem resposta", e.status === "SEM_RESPOSTA" && e.tentativas === MAX_TENTATIVAS);
check("4.ª sem atender: tenta outra vez daqui a duas semanas", lisboa(e.nextActionAt!).includes("16/11"), lisboa(e.nextActionAt!));

const depois = new Date("2026-11-04T17:00:00Z");
e = efeitoDaChamada({ resultado: "LIGAR_MAIS_TARDE", agora, estado: "SEM_RESPOSTA", tentativas: 3, voltarEm: depois, nota: "Presidente só à tarde" });
check("ligar mais tarde: falou-se, tentativas a zero", e.status === "CONTACTADO" && e.tentativas === 0);
check("ligar mais tarde: a data escolhida", e.nextActionAt?.getTime() === depois.getTime());
check("ligar mais tarde: a nota vai no histórico", e.nota.includes("Presidente só à tarde"));
let rebentou = false;
try { efeitoDaChamada({ resultado: "LIGAR_MAIS_TARDE", agora, estado: "NOVO", tentativas: 0 }); } catch { rebentou = true; }
check("ligar mais tarde sem data é recusado", rebentou);

e = efeitoDaChamada({ resultado: "PEDIU_INFO", agora, estado: "NOVO", tentativas: 1 });
check("pediu informação: liga-se daqui a 3 dias úteis", e.status === "CONTACTADO" && lisboa(e.nextActionAt!).includes("05/11"));

e = efeitoDaChamada({ resultado: "SEM_INTERESSE", agora, estado: "CONTACTADO", tentativas: 0, motivo: "JA_USA_OUTRO" });
check("sem interesse: não interessados, com o motivo", e.status === "PERDIDO" && e.lostReason === "JA_USA_OUTRO" && e.nextActionAt === null);
e = efeitoDaChamada({ resultado: "SEM_INTERESSE", agora, estado: "CONTACTADO", tentativas: 0, voltarEm: depois });
check("sem interesse com data: fica para voltar a tentar", e.nextActionAt?.getTime() === depois.getTime() && e.lostReason === "SEM_INTERESSE");

e = efeitoDaChamada({ resultado: "REUNIAO", agora, estado: "SEM_RESPOSTA", tentativas: 2 });
check("reunião: estado reunião, seguimento livre", e.status === "REUNIAO" && e.nextActionAt === null && e.lostReason === null);

e = efeitoDaChamada({ resultado: "REUNIAO", agora, estado: "CLIENTE", tentativas: 0 });
check("um cliente não recua", e.status === "CLIENTE");
e = efeitoDaChamada({ resultado: "PEDIU_INFO", agora, estado: "PERDIDO", tentativas: 0 });
check("um perdido que volta a falar sai de não interessados", e.status === "CONTACTADO" && e.lostReason === null);
e = efeitoDaChamada({ resultado: "NUMERO_ERRADO", agora, estado: "NOVO", tentativas: 1 });
check("número errado: sem resposta e sem seguimento", e.status === "SEM_RESPOSTA" && e.nextActionAt === null);

console.log("\nMês e dia em Lisboa");
const nov = limitesDoMes("2026-11");
check("novembro começa à meia-noite de Lisboa", nov.inicio.toISOString() === "2026-11-01T00:00:00.000Z", nov.inicio.toISOString());
const jul = limitesDoMes("2026-07");
check("julho começa às 23:00 UTC de 30/06 (verão)", jul.inicio.toISOString() === "2026-06-30T23:00:00.000Z", jul.inicio.toISOString());
check("dezembro acaba em janeiro do ano seguinte", limitesDoMes("2026-12").fim.toISOString() === "2027-01-01T00:00:00.000Z");
check("31/07 às 23:30 de Lisboa é julho; 01/08 às 00:30 já é agosto", mesDe(new Date("2026-07-31T22:30:00Z")) === "2026-07" && mesDe(new Date("2026-07-31T23:30:00Z")) === "2026-08");
const { dia, semana } = inicioDoDiaEDaSemana(new Date("2026-11-04T15:00:00Z")); // quarta
check("o dia começa à meia-noite", dia.toISOString() === "2026-11-04T00:00:00.000Z", dia.toISOString());
check("a semana começa na segunda", semana.toISOString() === "2026-11-02T00:00:00.000Z", semana.toISOString());

console.log("\nTurnos e pagamento");
check("turno de 3h05", minutosDoTurno({ startedAt: new Date("2026-11-02T09:00:00Z"), endedAt: new Date("2026-11-02T12:05:59Z") }, agora) === 185);
check("turno aberto conta até agora", minutosDoTurno({ startedAt: new Date("2026-11-02T09:30:00Z"), endedAt: null }, agora) === 30);
const p = pagamento(12 * 60 + 30, 700, 2, 2500);
check("12h30 a 7 €/h = 87,50 €", p.hoursCents === 8750);
check("2 comissões de 25 € = 50 €", p.commissionCents === 5000 && p.totalCents === 13750);
check("1 minuto a 7 €/h arredonda ao cêntimo", pagamento(1, 700, 0, 0).hoursCents === 12);

console.log("\nComissões por blocos");
let c = comissoes(0, 3, 5);
check("3 de 5: nenhuma comissão, faltam 2", c.novas === 0 && c.progresso === 3 && c.faltam === 2);
c = comissoes(3, 2, 5);
check("3 antes + 2 no mês: a primeira comissão cai neste mês", c.novas === 1 && c.progresso === 0 && c.faltam === 5);
c = comissoes(4, 11, 5);
check("4 antes + 11: três blocos fechados neste mês", c.novas === 3 && c.progresso === 0);
c = comissoes(5, 0, 5);
check("mês sem reuniões não paga comissão", c.novas === 0);
c = comissoes(0, 7, 0);
check("X a zero conta como 1 (nunca divide por zero)", c.porComissao === 1 && c.novas === 7);

console.log(`\n${ok} certos, ${falhas} errados\n`);
process.exit(falhas ? 1 : 0);

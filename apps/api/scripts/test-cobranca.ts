/**
 * A cobrança da mensalidade da plataforma, com datas na mão.
 *
 * ## O que isto prova
 *
 * As regras puras de `subscription/cobranca.ts` e a variante antecipada de
 * `avisosDevidos` (`ciclo.ts`), sem base nem relógio:
 *
 *  - o aviso nasce no **início** do período (e o antigo, no fim, continua
 *    igual para o painel);
 *  - os lembretes saem aos 7, 14 e 21 dias, um de cada vez, e uma paragem
 *    comprida do servidor manda **um** e não três;
 *  - um aviso que nasce atrasado começa com os lembretes já passados contados;
 *  - a suspensão é no dia seguinte ao fim do período, nunca sem email enviado,
 *    e nunca com menos de uma semana desde o email;
 *  - "de 5 de outubro a 4 de novembro de 2026", com o ano uma vez só, e as duas
 *    vezes quando o período muda de ano;
 *  - o identificador da euPago começa por `ACADEMIAS-` e distingue-se do dos
 *    clubes;
 *  - o estado da lista do painel (em dia, em falta com dias, suspenso, sem
 *    plano, última paga).
 *
 * Uso: npm run test:cobranca --workspace @academia/api
 */
import { avisosDevidos, chaveDoDia } from "../src/subscription/ciclo";
import {
  AVISO_MINIMO_DIAS,
  deveSuspender,
  diasEntre,
  eDaPlataforma,
  identificadorDaMensalidade,
  lembreteDevido,
  lembretesJaPassados,
  mensalidadeNaLista,
  periodoPorExtenso,
} from "../src/subscription/cobranca";

let ok = 0;
let bad = 0;
const check = (label: string, cond: unknown, detalhe = "") => {
  if (cond) {
    ok++;
    console.log("  OK    " + label);
  } else {
    bad++;
    console.log("  FALHA " + label + (detalhe ? " — " + detalhe : ""));
  }
};

const d = (iso: string) => new Date(iso + "T00:00:00.000Z");

/* ------------------------------------------------------------ o aviso */
console.log("\nO aviso nasce no início do período");
{
  const base = { assinatura: d("2026-09-28"), desde: d("2026-09-28"), periodo: "MONTHLY" as const, jaEmitidos: new Set<string>(), janelaDias: 35 };
  const antigo = avisosDevidos({ ...base, hoje: d("2026-10-05") });
  check("sem `antecipado`, a 5/10 ainda não saiu nada (o antigo sai no fim do período)", antigo.length === 0);

  const novo = avisosDevidos({ ...base, hoje: d("2026-10-05"), antecipado: true });
  check("com `antecipado`, a 5/10 o aviso de 28/09 a 27/10 já é devido", novo.length === 1 && chaveDoDia(novo[0].periodStart) === "2026-09-28");
  check("issuedOn é o início do período", novo.length === 1 && chaveDoDia(novo[0].issuedOn) === "2026-09-28");
  check("periodEnd é o dia antes do próximo início", novo.length === 1 && chaveDoDia(novo[0].periodEnd) === "2026-10-27");

  const dois = avisosDevidos({ ...base, hoje: d("2026-10-28"), antecipado: true });
  check("a 28/10 são dois: o de setembro e o de outubro", dois.length === 2 && chaveDoDia(dois[1].periodStart) === "2026-10-28");

  const janela = avisosDevidos({ ...base, hoje: d("2026-12-15"), antecipado: true });
  check("a janela de 35 dias deixa o passado para trás (só 28/11)", janela.length === 1 && chaveDoDia(janela[0].periodStart) === "2026-11-28");

  const ja = avisosDevidos({ ...base, hoje: d("2026-10-05"), antecipado: true, jaEmitidos: new Set(["2026-09-28"]) });
  check("um aviso que já existe não sai outra vez", ja.length === 0);
}

/* -------------------------------------------------------- os lembretes */
console.log("\nOs lembretes");
{
  const inicio = d("2026-10-05");
  check("dia 6: nada", lembreteDevido(inicio, d("2026-10-06"), 0) === null);
  check("dia 12 (7 dias): o 1.º", lembreteDevido(inicio, d("2026-10-12"), 0) === 1);
  check("dia 13 com o 1.º enviado: nada", lembreteDevido(inicio, d("2026-10-13"), 1) === null);
  check("dia 19 (14 dias): o 2.º", lembreteDevido(inicio, d("2026-10-19"), 1) === 2);
  check("dia 26 (21 dias): o 3.º", lembreteDevido(inicio, d("2026-10-26"), 2) === 3);
  check("dia 30 com os três enviados: nada", lembreteDevido(inicio, d("2026-10-30"), 3) === null);
  check("servidor parado três semanas: sai **um** (o 3.º), não três", lembreteDevido(inicio, d("2026-10-27"), 0) === 3);
  check("lembretes já passados a 5/10 para um período de 28/09: 1", lembretesJaPassados(d("2026-09-28"), d("2026-10-05")) === 1);
  check("lembretes já passados no próprio dia: 0", lembretesJaPassados(inicio, inicio) === 0);
  check("diasEntre conta dias de calendário", diasEntre(d("2026-10-05"), d("2026-11-04")) === 30);
}

/* ---------------------------------------------------------- a suspensão */
console.log("\nA suspensão");
{
  const fim = d("2026-11-04");
  const avisado = d("2026-10-05");
  check("no último dia do período ainda não", !deveSuspender(fim, d("2026-11-04"), null, avisado));
  check("no dia seguinte ao fim, sim", deveSuspender(fim, d("2026-11-05"), null, avisado));
  check("pago: nunca", !deveSuspender(fim, d("2026-11-20"), d("2026-11-01"), avisado));
  check("sem email enviado: nunca", !deveSuspender(fim, d("2026-11-20"), null, null));
  check(`avisado há menos de ${AVISO_MINIMO_DIAS} dias: ainda não`, !deveSuspender(fim, d("2026-11-05"), null, d("2026-11-02")));
  check(`avisado há ${AVISO_MINIMO_DIAS} dias: sim`, deveSuspender(fim, d("2026-11-09"), null, d("2026-11-02")));
}

/* ------------------------------------------------------- o período por extenso */
console.log("\nO período por extenso");
{
  check("5 de outubro a 4 de novembro de 2026", periodoPorExtenso(d("2026-10-05"), d("2026-11-04")) === "5 de outubro a 4 de novembro de 2026");
  check("muda de ano: as duas datas levam ano", periodoPorExtenso(d("2026-12-20"), d("2027-01-19")) === "20 de dezembro de 2026 a 19 de janeiro de 2027");
  check("anual: 28 de setembro de 2026 a 27 de setembro de 2027", periodoPorExtenso(d("2026-09-28"), d("2027-09-27")) === "28 de setembro de 2026 a 27 de setembro de 2027");
  check("1 de março a 31 de março de 2027 (meses com ç)", periodoPorExtenso(d("2027-03-01"), d("2027-03-31")) === "1 de março a 31 de março de 2027");
}

/* --------------------------------------------------------- o identificador */
console.log("\nO identificador");
{
  const id = identificadorDaMensalidade("life-club", d("2026-10-05"), "AB12CD");
  check("ACADEMIAS-<slug>-<AAAAMMDD>-<sufixo>", id === "ACADEMIAS-life-club-20261005-AB12CD", id);
  check("é da plataforma", eDaPlataforma(id));
  check("um identificador de clube não é", !eDaPlataforma("CLUBE-MENS-202610-ANA-RUI-abc"));
}

/* ----------------------------------------------------------- a lista do painel */
console.log("\nA lista do painel");
{
  const hoje = d("2026-10-12");
  const set = { periodStart: d("2026-09-28"), periodEnd: d("2026-10-27"), paidAt: d("2026-09-30"), paidMethod: "MANUAL" };
  const out = { periodStart: d("2026-10-28"), periodEnd: d("2026-11-27"), paidAt: null, paidMethod: null };

  const emDia = mensalidadeNaLista([set], "ACTIVE", null, hoje);
  check("período a correr pago: em dia, com o período", emDia.estado === "em-dia" && emDia.atual?.periodo === "28 de setembro a 27 de outubro de 2026");
  check("última paga é a de setembro, por transferência", emDia.ultimaPaga?.metodo === "MANUAL" && chaveDoDia(emDia.ultimaPaga.periodStart) === "2026-09-28");

  const emFalta = mensalidadeNaLista([{ ...set, paidAt: null, paidMethod: null }], "ACTIVE", null, hoje);
  check("por pagar: em falta, 14 dias", emFalta.estado === "em-falta" && emFalta.emFaltaDias === 14);
  check("nunca pagou", emFalta.ultimaPaga === null);

  const futuro = mensalidadeNaLista([set, out], "ACTIVE", null, hoje);
  check("um período futuro por pagar não conta como em falta", futuro.estado === "em-dia");

  const semPlano = mensalidadeNaLista([set], "TRIALING", null, hoje);
  check("subscrição em avaliação: sem plano, mas com a última paga", semPlano.estado === "sem-plano" && semPlano.ultimaPaga !== null);

  const suspenso = mensalidadeNaLista([{ ...set, paidAt: null, paidMethod: null }], "ACTIVE", d("2026-10-28"), hoje);
  check("suspenso ganha a tudo", suspenso.estado === "suspenso" && suspenso.atual !== null);

  const mbway = mensalidadeNaLista([{ ...set, paidMethod: "MBWAY" }, { ...out, paidAt: d("2026-10-29"), paidMethod: "MULTIBANCO" }], "ACTIVE", null, d("2026-11-02"));
  check("a última paga é a mais recente, por Multibanco", mbway.ultimaPaga?.metodo === "MULTIBANCO");

  check("paga sem fatura conta como fatura em falta", emDia.faturasEmFalta === 1);
  const comFatura = mensalidadeNaLista([{ ...set, invoiceSentAt: d("2026-10-01") }], "ACTIVE", null, hoje);
  check("com a fatura tratada (anexada ou marcada), já não falta", comFatura.faturasEmFalta === 0 && comFatura.estado === "em-dia");
  check("por pagar não pede fatura", emFalta.faturasEmFalta === 0);
}

console.log(`\n${ok} OK, ${bad} falhas`);
process.exit(bad > 0 ? 1 : 0);

import type { SubscriptionBillingPeriod } from "@prisma/client";
import { partesNoFuso } from "../common/fuso";

/**
 * O ciclo de cobrança da subscrição: quando sai o aviso, e que período cobre.
 *
 * ## A regra
 *
 * O relógio é o **dia em que o clube aceitou as condições**. Aceitou a 20 de
 * Setembro, recebe a 20 de Outubro, a 20 de Novembro, e assim por diante. Cada
 * aviso cobre o período que acabou de correr — de 20 de Setembro a 19 de
 * Outubro —, que é o mês que o clube usou.
 *
 * ## Fevereiro, e os meses curtos
 *
 * Quem assina a 31 de Janeiro não pode receber a 31 de Fevereiro, e a 31 de
 * Abril também não. O dia encolhe para o último do mês (28, 29 ou 30) e, no mês
 * seguinte, **volta ao dia da assinatura**.
 *
 * É por isto que cada data se calcula a partir da assinatura e nunca a partir do
 * aviso anterior: somar um mês de cada vez a partir do resultado já encolhido
 * dava 31/01 → 28/02 → 28/03 → 28/04, e ao fim de um ano o clube pagava no dia
 * 28 sem nunca ninguém ter decidido isso. O encolhimento é do mês, não do
 * contrato.
 *
 * Quem assina a 29 de Fevereiro de um ano bissexto recebe a 28 nos três anos
 * seguintes e a 29 no bissexto seguinte, pela mesma conta.
 *
 * ## Que dia é "o dia 20"
 *
 * O do calendário do clube, e não o da máquina. Quem assina à meia-noite e meia
 * de dia 20 em Lisboa assinou, em UTC de Verão, às 23:30 do dia 19 — e o
 * contrato passaria a ter aniversário no dia 19 por causa de uma hora. `diaDoClube`
 * é a passagem entre o instante guardado e o dia que se lê, e usa o mesmo
 * `common/fuso.ts` das horas dos treinos.
 *
 * Feita a passagem, as contas correm todas em UTC à meia-noite: são datas de
 * calendário (`@db.Date`), e usar o fuso da máquina no meio delas era voltar a
 * pôr a avaria onde ela estava.
 */

/** Um passo do ciclo, em meses: mensal é 1, anual é 12. */
export const passoEmMeses = (periodo: SubscriptionBillingPeriod): number => (periodo === "ANNUAL" ? 12 : 1);

/** A data sem horas, em UTC — a forma em que estas contas vivem. */
export function soODia(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * O dia do calendário do clube em que este instante caiu.
 *
 * É por aqui que entram a assinatura e o "hoje": o resto do módulo já só vê
 * datas de calendário.
 */
export function diaDoClube(instante: Date): Date {
  const p = partesNoFuso(instante);
  return new Date(Date.UTC(p.ano, p.mes - 1, p.dia));
}

export const chaveDoDia = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * `base` mais `meses`, com o dia encolhido ao último do mês quando não existe.
 *
 * Nunca se aplica duas vezes: quem precisa do terceiro aviso pede `meses = 3` à
 * assinatura, e não três somas de um mês.
 */
export function somaMeses(base: Date, meses: number): Date {
  const ano = base.getUTCFullYear();
  const mes = base.getUTCMonth() + meses;
  const ultimoDoMes = new Date(Date.UTC(ano, mes + 1, 0)).getUTCDate();
  return new Date(Date.UTC(ano, mes, Math.min(base.getUTCDate(), ultimoDoMes)));
}

export const somaDias = (base: Date, dias: number): Date =>
  new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() + dias));

/** A data do n-ésimo aviso. `n = 0` é o dia da assinatura, `n = 1` o primeiro aviso. */
export function dataDoAviso(assinatura: Date, n: number, periodo: SubscriptionBillingPeriod): Date {
  return somaMeses(soODia(assinatura), n * passoEmMeses(periodo));
}

export type AvisoDevido = {
  /** O dia em que o aviso sai — o aniversário da assinatura. */
  issuedOn: Date;
  /** O período que cobre, inclusivo dos dois lados. */
  periodStart: Date;
  periodEnd: Date;
  /** Quantos períodos passaram desde a assinatura. O primeiro aviso é o 1. */
  numero: number;
};

/**
 * Os avisos que já deviam ter saído e ainda não saíram.
 *
 * ## Porque é que isto devolve uma lista e não "o aviso de hoje"
 *
 * Porque o servidor pode ter estado em baixo no dia 20. Uma varredura que só
 * pergunta "hoje é dia de aviso?" perde o mês inteiro por causa de um deploy —
 * é o mesmo raciocínio da emissão automática de quotas (`member-fees.service`).
 * Aqui pergunta-se o que falta, e o que falta sai.
 *
 * ## E porque é que não sai tudo desde o princípio dos tempos
 *
 * `janelaDias` é o tecto do atraso que se recupera. Sem ele, ligar isto num
 * clube que assinou há um ano mandava-lhe doze avisos de uma vez — uma dívida
 * inventada por um sistema que ontem não existia. O que ficou para trás ficou;
 * quem cobra o passado é uma pessoa, não uma varredura.
 *
 * `desde` é a data de início contratada: um contrato assinado a 20 de Setembro
 * para começar a 1 de Outubro não cobra Setembro.
 */
export function avisosDevidos(input: {
  assinatura: Date;
  /** `SubscriptionOrder.startsOn` — antes disto não há nada a cobrar. */
  desde: Date;
  hoje: Date;
  periodo: SubscriptionBillingPeriod;
  /** As chaves (`AAAA-MM-DD` do `periodStart`) dos avisos que já existem. */
  jaEmitidos: ReadonlySet<string>;
  /** Até quantos dias para trás se recupera um aviso em falta. */
  janelaDias: number;
}): AvisoDevido[] {
  const assinatura = soODia(input.assinatura);
  const hoje = soODia(input.hoje);
  const desde = soODia(input.desde);
  const limite = somaDias(hoje, -Math.abs(input.janelaDias));

  const devidos: AvisoDevido[] = [];
  // O tecto é de segurança: um contrato com uma data disparatada não pode pôr
  // isto a andar para sempre.
  for (let n = 1; n <= 480; n += 1) {
    const issuedOn = dataDoAviso(assinatura, n, input.periodo);
    if (issuedOn > hoje) break;
    if (issuedOn < limite) continue;

    const periodStart = dataDoAviso(assinatura, n - 1, input.periodo);
    const periodEnd = somaDias(issuedOn, -1);
    /*
     * Só períodos **inteiros** dentro do contrato.
     *
     * Um contrato assinado a 20 de Setembro para começar a 1 de Outubro tem um
     * bocado de mês pelo meio (20/09 a 19/10) que é metade antes e metade
     * depois. A varredura não o cobra: partir um período ao meio dava um valor
     * que ninguém combinou, e cobrá-lo inteiro era cobrar dias anteriores ao
     * início. Um acerto desses é uma conversa com o cliente, não uma conta.
     */
    if (periodStart < desde) continue;
    if (input.jaEmitidos.has(chaveDoDia(periodStart))) continue;

    devidos.push({ issuedOn, periodStart, periodEnd, numero: n });
  }
  return devidos;
}

/**
 * Os meses de um vencimento: quais se devem, quando vencem, quais ficaram pagos.
 *
 * ## Porque é que isto é um ficheiro sem base de dados
 *
 * Um vencimento é um período ("600 € por mês desde setembro") e os meses pagos
 * são movimentos com `salaryPeriod`. Tudo o que a folha mostra — este mês por
 * pagar, dois meses em atraso, o que vence até dia 28 — sai dessas duas listas
 * por contas de calendário, e contas de calendário são o que mais se engana em
 * silêncio (o dia 31, o período que acabou a meio do mês, o pagamento adiantado).
 * Ficam aqui, puras, para se provarem com `npm run test:vencimentos`.
 *
 * ## As datas
 *
 * `startsOn` e `endsOn` são `@db.Date`: chegam como meia-noite UTC do dia, e é
 * o dia UTC que conta. O "hoje" chega já partido na hora do clube
 * (`partesNoFuso`), para um pagamento à meia-noite de Lisboa não cair no dia
 * errado quando a API corre em UTC.
 */

export type PeriodoDeVencimento = {
  id: string;
  amountCents: number;
  startsOn: Date;
  endsOn: Date | null;
  /** 1–28; nulo = o último dia do mês. */
  payDay: number | null;
};

export type Dia = { ano: number; mes: number; dia: number };

export type MesDevido = {
  /** `AAAA-MM` */
  period: string;
  amountCents: number;
  /** O dia em que vence, `AAAA-MM-DD`. */
  vence: string;
  /** O período (linha de `Salary`) de onde vem. */
  salaryId: string;
};

/** `AAAA-MM` de uma data `@db.Date` (o dia UTC). */
export function mesDaData(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** `AAAA-MM` de um dia partido. */
export function chaveDoDia(d: Dia): string {
  return `${d.ano}-${String(d.mes).padStart(2, "0")}`;
}

/** `AAAA-MM-DD` de um dia partido. */
export function dataDoDia(d: Dia): string {
  return `${chaveDoDia(d)}-${String(d.dia).padStart(2, "0")}`;
}

/** `AAAA-MM` mais `n` meses (negativo anda para trás). */
export function somarMeses(chave: string, n: number): string {
  const [a, m] = chave.split("-").map(Number);
  const total = a * 12 + (m - 1) + n;
  const ano = Math.floor(total / 12);
  const mes = total - ano * 12 + 1;
  return `${ano}-${String(mes).padStart(2, "0")}`;
}

/** Quantos meses de `a` até `b` (`b` − `a`; negativo se `b` vier antes). */
export function mesesEntre(a: string, b: string): number {
  const [aa, am] = a.split("-").map(Number);
  const [ba, bm] = b.split("-").map(Number);
  return (ba - aa) * 12 + (bm - am);
}

/** O último dia de um mês `AAAA-MM`. */
export function ultimoDiaDoMes(chave: string): number {
  const [a, m] = chave.split("-").map(Number);
  return new Date(Date.UTC(a, m, 0)).getUTCDate();
}

/**
 * O dia em que o mês de um vencimento vence: o `payDay`, ou o último dia do
 * mês quando não há dia marcado. O dia 28 é o máximo aceite, por isso nunca é
 * preciso encostar.
 */
export function diaDePagamento(period: string, payDay: number | null): string {
  const dia = payDay ?? ultimoDiaDoMes(period);
  return `${period}-${String(dia).padStart(2, "0")}`;
}

/**
 * Os meses que este período deve, do primeiro ao último, dentro de uma janela.
 *
 * - começa no mês de `startsOn` (o dia não interessa: um contrato que começa a
 *   15 de setembro vence setembro inteiro — se não for assim, o clube escreve
 *   outubro);
 * - acaba no mês de `endsOn`, ou continua enquanto o período estiver em vigor;
 * - `desde` e `ate` (`AAAA-MM`, inclusivos) cortam a janela: a folha não
 *   precisa de ver 2019, e as previsões não precisam de ver 2030.
 */
export function mesesDevidos(p: PeriodoDeVencimento, janela: { desde: string; ate: string }): MesDevido[] {
  const primeiro = mesDaData(p.startsOn);
  const ultimo = p.endsOn ? mesDaData(p.endsOn) : null;
  let inicio = primeiro > janela.desde ? primeiro : janela.desde;
  const fim = ultimo && ultimo < janela.ate ? ultimo : janela.ate;
  const out: MesDevido[] = [];
  // Um período de um mês só ou já acabado antes da janela não deve nada aqui.
  for (let guarda = 0; inicio <= fim && guarda < 600; guarda++) {
    out.push({ period: inicio, amountCents: p.amountCents, vence: diaDePagamento(inicio, p.payDay), salaryId: p.id });
    inicio = somarMeses(inicio, 1);
  }
  return out;
}

export type EstadoDoMes = "pago" | "atraso" | "este-mes" | "futuro";

/**
 * Em que estado está um mês devido, visto de `hoje`.
 *
 * "Este mês" é o mês corrente ainda por pagar, vencido ou não: é o que a
 * direção está a tratar. "Atraso" é um mês anterior sem pagamento. Um mês que
 * ainda não chegou é "futuro" — aparece nas previsões, não na folha.
 */
export function estadoDoMes(m: MesDevido, pago: boolean, hoje: Dia): EstadoDoMes {
  if (pago) return "pago";
  const mesAtual = chaveDoDia(hoje);
  if (m.period < mesAtual) return "atraso";
  if (m.period === mesAtual) return "este-mes";
  return "futuro";
}

/** `AAAA-MM` bem formado, com o mês entre 01 e 12. */
export function periodoValido(p: string): boolean {
  const m = /^(\d{4})-(\d{2})$/.exec(p);
  return Boolean(m) && Number(m![2]) >= 1 && Number(m![2]) <= 12;
}

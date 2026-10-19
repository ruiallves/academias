/**
 * O calendário de cobrança: em que meses se cobra, a quem, e quando vence.
 *
 * Só contas, sem base de dados, para se poderem testar sozinhas
 * (`npm run test:cobranca-por-escalao`). Quem lê a academia e as equipas é
 * `lerCalendario`, em `billing.service.ts`. A consola tem a mesma regra em
 * `mesesDoEscalao` e `atletaPagaEm` (`lib/api.ts`): ao mexer numa, mexer na outra.
 */

/**
 * O calendário de cobrança por omissão — onze meses, sem Agosto.
 *
 * Espelha o valor por omissão de `Academy.billingMonths` e serve só de rede para
 * uma academia lida antes da migração ter corrido. A resposta verdadeira está
 * sempre na academia.
 */
export const MESES_POR_OMISSAO = [1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12];

/**
 * O calendário de cobrança que vale num período.
 *
 * `meses` são os do clube. Com `porEscalao`, cada equipa tem os seus em
 * `equipas` (só as que os têm), e os do clube ficam para quem não tem escalão e
 * para as equipas sem meses próprios. Ninguém deve ler `meses` diretamente para
 * saber se um atleta paga: é para isso que existem `cobraAoAtleta` e
 * `cobraNoMes`.
 */
export type Calendario = { meses: number[]; dia: number; porEscalao: boolean; equipas: Map<string, number[]> };

/** As colunas da academia de que o calendário precisa. */
export const SELECT_CALENDARIO = {
  billingMonths: true,
  billingDueDay: true,
  billingNextFrom: true,
  billingNextMonths: true,
  billingNextDueDay: true,
  billingByTeam: true,
  billingNextByTeam: true,
} as const;

export type AcademiaComCalendario = {
  billingMonths: number[];
  billingDueDay: number;
  billingNextFrom: string | null;
  billingNextMonths: number[];
  billingNextDueDay: number | null;
  billingByTeam: boolean;
  billingNextByTeam: boolean | null;
};

/** Os meses de cada equipa da época corrente, como estão gravados. */
export type MesesDeEquipa = { id: string; billingMonths: number[]; billingNextMonths: number[] };

/**
 * O calendário que vale para `period`.
 *
 * O clube pode mudar o período de cobrança só a partir da próxima época: fica
 * agendado em `billingNext*`, e a partir de `billingNextFrom` é esse que manda.
 * Toda a gente que pergunta "o clube cobra neste mês?" ou "quando vence?"
 * pergunta aqui, com o período em causa, para uma mensalidade de Agosto de 2027
 * seguir o calendário da época 2027/28 mesmo antes de a época virar.
 *
 * O agendamento vale também para o modo (`billingNextByTeam`) e para os meses
 * de cada escalão (`Team.billingNextMonths`); o que não foi agendado fica como
 * está hoje.
 */
export function calendarioPara(
  academia: AcademiaComCalendario | null,
  period: string,
  equipas: MesesDeEquipa[] = [],
): Calendario {
  if (!academia) return { meses: MESES_POR_OMISSAO, dia: 8, porEscalao: false, equipas: new Map() };
  const proxima = Boolean(academia.billingNextFrom) && period >= (academia.billingNextFrom as string);
  const porEscalao = proxima ? (academia.billingNextByTeam ?? academia.billingByTeam) : academia.billingByTeam;

  const mesesDasEquipas = new Map<string, number[]>();
  if (porEscalao) {
    for (const e of equipas) {
      const meses = proxima && e.billingNextMonths.length ? e.billingNextMonths : e.billingMonths;
      if (meses.length) mesesDasEquipas.set(e.id, meses);
    }
  }

  const atual = { meses: academia.billingMonths, dia: academia.billingDueDay };
  if (!proxima) return { ...atual, porEscalao, equipas: mesesDasEquipas };
  return {
    meses: academia.billingNextMonths.length ? academia.billingNextMonths : atual.meses,
    dia: academia.billingNextDueDay ?? atual.dia,
    porEscalao,
    equipas: mesesDasEquipas,
  };
}

/** Os meses que uma equipa paga. Fora do modo por escalão, e sem equipa, são os do clube. */
export function mesesDaEquipa(c: Calendario, teamId: string | null | undefined): number[] {
  if (!c.porEscalao || !teamId) return c.meses;
  return c.equipas.get(teamId) ?? c.meses;
}

/**
 * Este atleta paga mensalidade neste mês?
 *
 * Por escalão, paga se **alguma** das equipas dele cobra o mês: um atleta no
 * futebol e no futsal, com o futsal sem Agosto, continua a pagar Agosto (só o
 * futebol, ver `lerCobrancaDosAtletas`). Sem equipa, segue os meses do clube.
 */
export function cobraAoAtleta(c: Calendario, equipasDoAtleta: string[], mes: number): boolean {
  if (!c.porEscalao || equipasDoAtleta.length === 0) return c.meses.includes(mes);
  return equipasDoAtleta.some((t) => mesesDaEquipa(c, t).includes(mes));
}

/**
 * O mês existe no clube? Por escalão, existe se algum escalão o cobra (ou quem
 * não tem escalão). É a pergunta das avulsas e da lista de meses das
 * Mensalidades: um mês que ninguém paga não existe para ninguém.
 */
export function cobraNoMes(c: Calendario, mes: number): boolean {
  if (c.meses.includes(mes)) return true;
  return c.porEscalao && [...c.equipas.values()].some((m) => m.includes(mes));
}


/**
 * As horas do clube, e não as da máquina.
 *
 * ## A avaria que isto corrige
 *
 * "Nas convocatórias, se meter 12h e guardar, fica 13h." O servidor recebia
 * `"12:00"` e fazia `setHours(12, 0)` — que usa o fuso **da máquina onde a API
 * corre**. Em produção essa máquina está em UTC, e as 12:00 UTC são as 13:00 em
 * Lisboa no horário de Verão. No PC de quem programa, que está em hora de
 * Lisboa, a conta dava certo, e por isso ninguém a via.
 *
 * O mesmo erro, com outra cara, estava em todos os textos que o servidor escreve
 * com horas lá dentro (a notificação de um jogo, de um plano de treino) e na
 * repetição de treinos: um treino semanal às 18:30 guardava as 17:30 UTC da
 * primeira ocorrência e repetia-as, e depois da mudança de hora de Outubro
 * passava a ser às 17:30 em Lisboa.
 *
 * ## A regra
 *
 * Tudo o que é **hora de relógio** (a que se escreve num formulário, a que se lê
 * numa notificação) é do fuso do clube. Tudo o que é **instante** (o que se
 * guarda na base) é UTC. Este ficheiro é a única passagem entre os dois, e não
 * usa o fuso da máquina em lado nenhum: `Intl` com `timeZone` explícito.
 *
 * Os clubes são todos de Portugal continental por agora, e o fuso é um só. Um
 * clube dos Açores ou da Madeira pede `Academy.timezone`, e quem chama estas
 * funções passa-o em vez de usar o valor por omissão.
 */

export const FUSO_DO_CLUBE = "Europe/Lisbon";

type Partes = { ano: number; mes: number; dia: number; hora: number; minuto: number; diaDaSemana: number };

const formatadores = new Map<string, Intl.DateTimeFormat>();
function formatadorDePartes(fuso: string): Intl.DateTimeFormat {
  let f = formatadores.get(fuso);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: fuso,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
    });
    formatadores.set(fuso, f);
  }
  return f;
}

const SEMANA: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** O que o relógio de parede do clube mostra num dado instante. */
export function partesNoFuso(instante: Date, fuso = FUSO_DO_CLUBE): Partes {
  const p = Object.fromEntries(formatadorDePartes(fuso).formatToParts(instante).map((x) => [x.type, x.value]));
  return {
    ano: Number(p.year),
    mes: Number(p.month),
    dia: Number(p.day),
    hora: Number(p.hour),
    minuto: Number(p.minute),
    diaDaSemana: SEMANA[p.weekday] ?? 0,
  };
}

/** Quantos minutos o fuso está à frente de UTC nesse instante (60 em Lisboa no Verão). */
function desvioEmMinutos(instante: Date, fuso: string): number {
  const p = partesNoFuso(instante, fuso);
  const comoSeFosseUtc = Date.UTC(p.ano, p.mes - 1, p.dia, p.hora, p.minuto);
  return Math.round((comoSeFosseUtc - Math.floor(instante.getTime() / 60_000) * 60_000) / 60_000);
}

/**
 * O instante em que o relógio do clube marca esta data e esta hora.
 *
 * Duas voltas porque o desvio depende do próprio instante: perto da mudança de
 * hora, o primeiro palpite pode cair do lado errado dela.
 */
export function instanteNoFuso(
  ano: number,
  mes: number,
  dia: number,
  hora: number,
  minuto: number,
  fuso = FUSO_DO_CLUBE,
): Date {
  const comoUtc = Date.UTC(ano, mes - 1, dia, hora, minuto);
  let t = comoUtc - desvioEmMinutos(new Date(comoUtc), fuso) * 60_000;
  const segundo = desvioEmMinutos(new Date(t), fuso);
  t = comoUtc - segundo * 60_000;
  return new Date(t);
}

/** `"09:30"` → `{ hora: 9, minuto: 30 }`, ou nulo se não for uma hora. */
export function lerHora(hhmm: string): { hora: number; minuto: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const hora = Number(m[1]);
  const minuto = Number(m[2]);
  if (hora > 23 || minuto > 59) return null;
  return { hora, minuto };
}

/** Um dia de calendário a mais ou a menos, sem passar por fusos. */
export function somarDias(ano: number, mes: number, dia: number, dias: number): { ano: number; mes: number; dia: number } {
  const d = new Date(Date.UTC(ano, mes - 1, dia + dias));
  return { ano: d.getUTCFullYear(), mes: d.getUTCMonth() + 1, dia: d.getUTCDate() };
}

/** A data e hora por extenso, no relógio do clube. */
export function formatarNoFuso(instante: Date, opcoes: Intl.DateTimeFormatOptions, fuso = FUSO_DO_CLUBE): string {
  return instante.toLocaleString("pt-PT", { ...opcoes, timeZone: fuso });
}

/** Só as horas: `"12:00"`. */
export function horaNoFuso(instante: Date, fuso = FUSO_DO_CLUBE): string {
  return formatarNoFuso(instante, { hour: "2-digit", minute: "2-digit" }, fuso);
}

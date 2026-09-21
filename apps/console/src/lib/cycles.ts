import { apiDelete, apiGet, apiPost, apiPut } from "@/lib/http";

/**
 * A periodização: mesociclos e microciclos por equipa.
 *
 * ## Um ciclo não contém treinos
 *
 * Um ciclo é um intervalo de dias com intenção (fase, foco, objetivo, notas).
 * Os treinos e os jogos pertencem-lhe **pela data**: nada nos treinos aponta
 * para aqui. É por isso que este ficheiro só sabe responder a perguntas de
 * datas ("em que micro cai este dia?", "que dia é este em relação ao jogo?"),
 * e que mover ou apagar um treino nunca pede cuidados com os ciclos. Ver
 * `CyclesService` na API.
 *
 * O macrociclo é a época da equipa. Não tem objeto próprio.
 *
 * ## Dias
 *
 * Tudo aqui trabalha em chaves `AAAA-MM-DD` do dia local, que é o do clube
 * (a consola corre em Portugal). As contas fazem-se em UTC ao meio-dia, onde a
 * mudança de hora nunca faz saltar um dia.
 */

export type CycleLevel = "MESO" | "MICRO";

export type Cycle = {
  id: string;
  teamId: string;
  level: CycleLevel;
  startsOn: string;
  endsOn: string;
  name: string | null;
  phase: string | null;
  focus: string[];
  objective: string | null;
  notes: string | null;
  color: string | null;
};

export type CycleInput = Partial<Omit<Cycle, "id">>;

/* ---------------------------------- API ---------------------------------- */

export const listCycles = (teamId: string) =>
  apiGet<Cycle[]>("/api/training/cycles", { teamId }).then((r) => r ?? []);

export const listCyclesIn = (from: string, to: string) =>
  apiGet<Cycle[]>("/api/training/cycles", { from, to }).then((r) => r ?? []);

export const createCycle = (input: CycleInput & { teamId: string; level: CycleLevel; startsOn: string; endsOn: string }) =>
  apiPost<Cycle>("/api/training/cycles", input);

export const updateCycle = (id: string, input: CycleInput) => apiPut<Cycle>(`/api/training/cycles/${id}`, input);

export const deleteCycle = (id: string) => apiDelete<{ ok: true }>(`/api/training/cycles/${id}`);

/**
 * Encher um intervalo de semanas, só onde ainda não há. A consola já não o
 * chama: o mesociclo traz as semanas dele ao nascer (ver `CyclesService`).
 */
export const generateMicros = (input: { teamId: string; from: string; to: string }) =>
  apiPost<{ created: number; cycles: Cycle[] }>("/api/training/cycles/gerar", input);

/* ------------------------------ Vocabulário ------------------------------ */

/**
 * Sugestões de nome para um mesociclo, iguais em todas as modalidades. São sugestões: o campo é
 * texto, e um clube de basquetebol que diga "Fase regular" diz o que quiser.
 */
export const PHASES = ["Pré-época", "Desenvolvimento", "Competição", "Transição", "Férias"] as const;

/** As cores de um mesociclo. Contidas, para a faixa não gritar mais do que os treinos. */
export const PHASE_COLORS = ["#2a8c80", "#3a5cb4", "#b0812a", "#8a4f7d", "#6b7a2e", "#5b6b7a"] as const;

/** A cor por omissão de uma fase, pelo nome: Pré-época verde, Competição azul… */
export function defaultColor(phase: string | null | undefined, index = 0): string {
  const i = PHASES.findIndex((p) => p === phase);
  return PHASE_COLORS[(i >= 0 ? i : index) % PHASE_COLORS.length];
}

/* --------------------------------- Dias ---------------------------------- */

/** A chave do dia local de uma data. */
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** A data (meia-noite local) de uma chave. */
export function keyToDate(k: string): Date {
  const [y, m, d] = k.split("-").map(Number);
  return new Date(y, m - 1, d);
}

const utc = (k: string) => Date.UTC(Number(k.slice(0, 4)), Number(k.slice(5, 7)) - 1, Number(k.slice(8, 10)), 12);
const fromUtc = (t: number) => new Date(t).toISOString().slice(0, 10);

export const addDays = (k: string, n: number) => fromUtc(utc(k) + n * 86_400_000);
export const daysBetween = (a: string, b: string) => Math.round((utc(b) - utc(a)) / 86_400_000);
export const cycleLength = (c: Pick<Cycle, "startsOn" | "endsOn">) => daysBetween(c.startsOn, c.endsOn) + 1;

/** A segunda-feira da semana deste dia. */
export function mondayOf(k: string): string {
  const dow = new Date(utc(k)).getUTCDay();
  return addDays(k, -((dow + 6) % 7));
}

/** Os dias de um intervalo, inclusive. */
export function daysIn(from: string, to: string): string[] {
  const n = daysBetween(from, to);
  return Array.from({ length: Math.max(0, n + 1) }, (_, i) => addDays(from, i));
}

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** "13–19 out", "28 set – 4 out". */
export function rangeLabel(from: string, to: string): string {
  const [, m1, d1] = from.split("-").map(Number);
  const [, m2, d2] = to.split("-").map(Number);
  return m1 === m2 ? `${d1}–${d2} ${MESES[m2 - 1]}` : `${d1} ${MESES[m1 - 1]} – ${d2} ${MESES[m2 - 1]}`;
}

export const monthShort = (k: string) => MESES[Number(k.slice(5, 7)) - 1];

/* ------------------------------ Pertença --------------------------------- */

/** O ciclo deste nível que contém o dia, se houver. */
export function cycleOn(cycles: Cycle[], level: CycleLevel, day: string): Cycle | undefined {
  return cycles.find((c) => c.level === level && c.startsOn <= day && day <= c.endsOn);
}

/**
 * O dia que decide a fase de um micro: o do meio. Numa semana é a quinta-feira,
 * a regra da semana ISO, e é a mesma do servidor ao encher uma fase: uma fase
 * que começa a uma quarta leva a semana inteira.
 */
export const meioDoMicro = (micro: Pick<Cycle, "startsOn" | "endsOn">) =>
  addDays(micro.startsOn, Math.floor((cycleLength(micro) - 1) / 2));

/** A fase de um micro: a que contém o dia do meio dele. */
export function mesoOf(cycles: Cycle[], micro: Cycle): Cycle | undefined {
  return cycleOn(cycles, "MESO", meioDoMicro(micro));
}

/** "Micro 08": a posição do micro entre os da equipa, por data. */
export function microNumber(cycles: Cycle[], micro: Cycle): number {
  return cycles.filter((c) => c.level === "MICRO" && c.startsOn <= micro.startsOn).length;
}

export const microLabel = (cycles: Cycle[], micro: Cycle) => `Micro ${String(microNumber(cycles, micro)).padStart(2, "0")}`;

/**
 * O intervalo que o planeador mostra à volta de um dia: o micro que o contém,
 * ou a semana de segunda a domingo quando não há micro. Quem não periodiza vê
 * sempre a semana, como antes.
 */
export function viewAround(cycles: Cycle[], day: string): { from: string; to: string; micro: Cycle | null } {
  const micro = cycleOn(cycles, "MICRO", day);
  if (micro) return { from: micro.startsOn, to: micro.endsOn, micro };
  const from = mondayOf(day);
  return { from, to: addDays(from, 6), micro: null };
}

/* ------------------------------- Dia de jogo ------------------------------ */

/**
 * O dia em relação ao jogo: "MD-3", "MD+1", "MD" no próprio dia.
 *
 * Calculado, nunca guardado: se o jogo muda de dia, as etiquetas mudam com
 * ele. A regra é a dos microciclos de futebol e futsal (e serve o basquetebol):
 *
 *  - o dia a seguir a um jogo é sempre MD+1 (recuperação), mesmo com outro
 *    jogo logo a seguir;
 *  - com um jogo nos próximos 7 dias conta-se para trás: MD-4, MD-3…;
 *  - senão, até dois dias depois do último jogo ainda é MD+n;
 *  - fora disso (pré-época, paragens) não há etiqueta.
 */
export function matchDayLabel(day: string, matchDays: string[]): string | null {
  if (matchDays.includes(day)) return "MD";
  let prev: string | null = null;
  let next: string | null = null;
  for (const m of matchDays) {
    if (m < day && (!prev || m > prev)) prev = m;
    if (m > day && (!next || m < next)) next = m;
  }
  const depois = prev ? daysBetween(prev, day) : Infinity;
  const antes = next ? daysBetween(day, next) : Infinity;
  if (depois === 1) return "MD+1";
  if (antes <= 7) return `MD-${antes}`;
  if (depois <= 2) return `MD+${depois}`;
  return null;
}

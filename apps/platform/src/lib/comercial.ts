import type { CallOutcome, Contact, Me, SalesMeeting } from "@/lib/types";
import { MEETING_MODE_LABEL } from "@/lib/types";

/**
 * O que os ecrãs da área comercial partilham: a fila do dia, os rótulos dos
 * resultados e a formatação de horas, datas e telefones.
 */

export const OUTCOMES: { id: CallOutcome; label: string; hint: string }[] = [
  { id: "NAO_ATENDEU", label: "Não atendeu", hint: "Volta à fila sozinho" },
  { id: "LIGAR_MAIS_TARDE", label: "Ligar mais tarde", hint: "Escolhe o dia e a hora" },
  { id: "PEDIU_INFO", label: "Pediu informação", hint: "Liga-se daqui a 3 dias" },
  { id: "REUNIAO", label: "Reunião marcada", hint: "Preenche a ficha" },
  { id: "SEM_INTERESSE", label: "Sem interesse", hint: "Diz o motivo" },
  { id: "NUMERO_ERRADO", label: "Número errado", hint: "Sai da fila" },
];

export const OUTCOME_LABEL: Record<CallOutcome, string> = Object.fromEntries(OUTCOMES.map((o) => [o.id, o.label])) as Record<
  CallOutcome,
  string
>;

/** Pode trabalhar este clube: não tem responsável, ou o responsável sou eu. */
export function livreParaMim(c: Contact, me: Me): boolean {
  return !c.owner || c.owner.id === me.id;
}

function fimDeHoje(): number {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

export type Fila = { seguimentos: Contact[]; novos: Contact[]; semResposta: Contact[] };

/**
 * A fila do dia.
 *
 * Seguimentos: tudo o que tem data para hoje ou para trás (menos clientes), pela
 * hora. Novos: nunca contactados, sem data. Sem resposta: os que desistimos e
 * ainda não chegou a data de voltar a tentar (para quem quiser insistir).
 */
export function filaDoDia(todos: Contact[], me: Me): Fila {
  const limite = fimDeHoje();
  const meus = todos.filter((c) => livreParaMim(c, me) && c.status !== "CLIENTE");
  const seguimentos = meus
    .filter((c) => c.nextActionAt && new Date(c.nextActionAt).getTime() <= limite && c.status !== "REUNIAO")
    .sort((a, b) => new Date(a.nextActionAt!).getTime() - new Date(b.nextActionAt!).getTime());
  const novos = meus
    .filter((c) => c.status === "NOVO" && !c.nextActionAt && !c.calledAt && c.noAnswerCount === 0)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  const semResposta = meus
    .filter((c) => c.status === "SEM_RESPOSTA" && (!c.nextActionAt || new Date(c.nextActionAt).getTime() > limite))
    .sort((a, b) => (a.lastContactAt ?? "").localeCompare(b.lastContactAt ?? ""));
  return { seguimentos, novos, semResposta };
}

/** Porque é que o clube está na fila, numa frase curta. */
export function motivoNaFila(c: Contact): string {
  if (c.nextActionAt) {
    const quando = new Date(c.nextActionAt);
    const atraso = diasAte(quando);
    const hora = hhmm(quando);
    const base = c.nextActionNote ?? (c.noAnswerCount > 0 ? `${c.noAnswerCount + 1}.ª tentativa` : "Seguimento");
    if (atraso < 0) return `${base} · atrasado ${-atraso === 1 ? "1 dia" : `${-atraso} dias`}`;
    if (atraso === 0) return `${base} · hoje às ${hora}`;
    return `${base} · ${dataCurta(quando)}`;
  }
  if (c.status === "NOVO") return "Ainda ninguém ligou";
  if (c.status === "SEM_RESPOSTA") return `${c.noAnswerCount || "Várias"} chamadas sem resposta`;
  return "";
}

/* -------------------------------------------------------------------------- */
/* Datas e horas                                                               */
/* -------------------------------------------------------------------------- */

/** Dias de calendário entre hoje e a data (negativo = passou). */
export function diasAte(d: Date): number {
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const alvo = new Date(d);
  alvo.setHours(0, 0, 0, 0);
  return Math.round((alvo.getTime() - hoje.getTime()) / 86_400_000);
}

export function hhmm(d: Date | string): string {
  return new Date(d).toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" });
}

export function dataCurta(d: Date | string): string {
  return new Date(d).toLocaleDateString("pt-PT", { day: "numeric", month: "short" });
}

/** "hoje", "amanhã", "terça, 3 nov." */
export function diaLegivel(d: Date | string): string {
  const data = new Date(d);
  const dias = diasAte(data);
  if (dias === 0) return "Hoje";
  if (dias === 1) return "Amanhã";
  if (dias === -1) return "Ontem";
  const s = data.toLocaleDateString("pt-PT", { weekday: "long", day: "numeric", month: "long" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "Hoje", "Amanhã", "Ter, 3 nov." — para listas estreitas. */
export function diaCurto(d: Date | string): string {
  const data = new Date(d);
  const dias = diasAte(data);
  if (dias === 0) return "Hoje";
  if (dias === 1) return "Amanhã";
  const s = data.toLocaleDateString("pt-PT", { weekday: "short", day: "numeric", month: "short" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** 750 → "12h30". */
export function horas(minutos: number): string {
  return `${Math.floor(minutos / 60)}h${String(minutos % 60).padStart(2, "0")}`;
}

/** Cronómetro: "1:04:09". */
export function cronometro(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/** `<input type="datetime-local">` fala em hora local sem fuso. */
export function paraInputLocal(d: Date | string | null): string {
  if (!d) return "";
  const x = new Date(d);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}T${pad(x.getHours())}:${pad(x.getMinutes())}`;
}

/** Amanhã às 10h, ou a próxima segunda se amanhã for fim de semana. */
export function amanhaAsDez(): Date {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  d.setHours(10, 0, 0, 0);
  return d;
}

/** `2026-11` de uma data local. */
export function mesAtual(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function somarMes(ym: string, n: number): string {
  const [a, m] = ym.split("-").map(Number);
  const d = new Date(a, m - 1 + n, 1);
  return mesAtual(d);
}

export function nomeDoMes(ym: string): string {
  const [a, m] = ym.split("-").map(Number);
  const s = new Date(a, m - 1, 1).toLocaleDateString("pt-PT", { month: "long", year: "numeric" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/* -------------------------------------------------------------------------- */
/* Telefone                                                                    */
/* -------------------------------------------------------------------------- */

/** "912345678" → "912 345 678"; "+351912345678" → "+351 912 345 678". Outros ficam como vieram. */
export function telefoneLegivel(phone: string): string {
  const d = phone.replace(/[^\d+]/g, "");
  const m = /^(\+351)?(\d{9})$/.exec(d);
  if (!m) return phone.trim();
  const n = m[2];
  return `${m[1] ? "+351 " : ""}${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}`;
}

/* -------------------------------------------------------------------------- */
/* Google Calendar para uma reunião                                            */
/* -------------------------------------------------------------------------- */

export function googleReuniaoUrl(m: SalesMeeting, clube: string): string {
  const inicio = new Date(m.scheduledAt);
  const fim = new Date(inicio.getTime() + m.durationMin * 60_000);
  const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const detalhe = [
    `${MEETING_MODE_LABEL[m.mode]}${m.location ? `: ${m.location}` : ""}`,
    `Com: ${m.personName}${m.personRole ? ` (${m.personRole})` : ""}`,
    m.personPhone ? `Telefone: ${m.personPhone}` : null,
    m.athletes ? `Atletas: ${m.athletes}` : null,
    m.teams ? `Modalidades e escalões: ${m.teams}` : null,
    m.currentTool ? `Usam hoje: ${m.currentTool}` : null,
    m.pain ? `O que os incomoda: ${m.pain}` : null,
    m.suggestedPlan ? `Plano indicado: ${m.suggestedPlan}` : null,
    m.notes ? `Notas: ${m.notes}` : null,
    m.bookedByName ? `Marcada por ${m.bookedByName}` : null,
  ]
    .filter(Boolean)
    .join("\n");
  const p = new URLSearchParams({
    action: "TEMPLATE",
    text: `Reunião: ${clube}`,
    dates: `${stamp(inicio)}/${stamp(fim)}`,
    details: detalhe,
    ctz: "Europe/Lisbon",
  });
  if (m.location) p.set("location", m.location);
  return `https://calendar.google.com/calendar/render?${p.toString()}`;
}

/** Saudação pela hora do dia. */
export function saudacao(): string {
  const h = new Date().getHours();
  if (h < 13) return "Bom dia";
  if (h < 20) return "Boa tarde";
  return "Boa noite";
}

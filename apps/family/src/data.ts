/**
 * Dados de demonstração da app das famílias.
 *
 * Uma família com dois educandos em modalidades diferentes — futebol e natação —
 * porque é esse o caso que expõe as decisões: o seletor de atleta, os dois
 * horários, as duas mensalidades. Substituir por `fetch` é trocar este ficheiro.
 */

export const academy = {
  /** Em produção vem do subdomínio (`life-club.academia.pt`); aqui é fixo. */
  slug: "life-club",
  name: "Academia Life Club",
  shortName: "Life Club",
  mark: "LC",
  signalColor: "#0f6b62",
};

export const guardian = { name: "Sandra Bragança", firstName: "Sandra" };

export type Child = {
  id: string;
  name: string;
  firstName: string;
  team: string;
  sport: string;
  coach: string;
  feeCents: number;
};

export const children: Child[] = [
  {
    id: "at_martim",
    name: "Martim Bragança",
    firstName: "Martim",
    team: "Sub-11 Futebol",
    sport: "Futebol",
    coach: "Rui Machado",
    feeCents: 4000,
  },
  {
    id: "at_alice",
    name: "Alice Bragança",
    firstName: "Alice",
    team: "Natação — Iniciação",
    sport: "Natação",
    coach: "Nuno Carvalho",
    feeCents: 4500,
  },
];

export const today = new Date(2026, 7, 15, 9, 20); // sábado, 15 de agosto

export type Training = {
  id: string;
  childId: string;
  start: Date;
  end: Date;
  venue: string;
  /** Uma alteração é a coisa que o pai mais precisa de ver e a que o WhatsApp faz pior. */
  note?: { kind: "changed" | "cancelled"; text: string };
};

export const trainings: Training[] = [
  { id: "tr1", childId: "at_alice", start: at(0, 10, 0), end: at(0, 11, 0), venue: "Piscina municipal" },
  { id: "tr2", childId: "at_martim", start: at(2, 18, 0), end: at(2, 19, 30), venue: "Campo 1" },
  { id: "tr3", childId: "at_alice", start: at(4, 17, 0), end: at(4, 18, 0), venue: "Piscina municipal", note: { kind: "changed", text: "Passou das 17h30 para as 17h00" } },
  { id: "tr4", childId: "at_martim", start: at(4, 18, 0), end: at(4, 19, 30), venue: "Campo 2" },
  { id: "tr5", childId: "at_alice", start: at(7, 10, 0), end: at(7, 11, 0), venue: "Piscina municipal" },
  { id: "tr6", childId: "at_martim", start: at(9, 18, 0), end: at(9, 19, 30), venue: "Campo 1" },
];

export type Payment = {
  id: string;
  childId: string;
  period: string;
  label: string;
  amountCents: number;
  dueDate: Date;
  status: "paid" | "pending" | "processing" | "overdue";
  paidAt?: Date;
  method?: string;
  /** Referência euPago. Em mono, para se poder ler ao telefone sem enganos. */
  reference?: string;
};

export const payments: Payment[] = [
  { id: "p1", childId: "at_martim", period: "2026-08", label: "Agosto", amountCents: 4000, dueDate: new Date(2026, 7, 8), status: "overdue", reference: "912 447 305" },
  { id: "p2", childId: "at_alice", period: "2026-08", label: "Agosto", amountCents: 4500, dueDate: new Date(2026, 7, 8), status: "paid", paidAt: new Date(2026, 7, 6), method: "MB Way" },
  { id: "p3", childId: "at_martim", period: "2026-07", label: "Julho", amountCents: 4000, dueDate: new Date(2026, 6, 8), status: "paid", paidAt: new Date(2026, 6, 7), method: "MB Way" },
  { id: "p4", childId: "at_alice", period: "2026-07", label: "Julho", amountCents: 4500, dueDate: new Date(2026, 6, 8), status: "paid", paidAt: new Date(2026, 6, 7), method: "MB Way" },
  { id: "p5", childId: "at_martim", period: "2026-06", label: "Junho", amountCents: 4000, dueDate: new Date(2026, 5, 8), status: "paid", paidAt: new Date(2026, 5, 9), method: "Multibanco" },
  { id: "p6", childId: "at_alice", period: "2026-06", label: "Junho", amountCents: 4500, dueDate: new Date(2026, 5, 8), status: "paid", paidAt: new Date(2026, 5, 9), method: "Multibanco" },
];

/**
 * Agendamentos clínicos — exames, consultas e reavaliações marcadas pelo
 * departamento clínico da academia. O pai vê-os na app; é a peça que evita o
 * telefonema a perguntar "quando é a consulta?".
 */
export type Appointment = {
  id: string;
  childId: string;
  date: Date;
  time: string;
  title: string;
  kind: "Exame" | "Nutrição" | "Fisioterapia" | "Psicologia";
  location: string;
  note?: string;
};

export const appointments: Appointment[] = [
  {
    id: "ap1",
    childId: "at_martim",
    date: new Date(2026, 7, 26),
    time: "17:30",
    title: "Renovação do exame médico-desportivo",
    kind: "Exame",
    location: "Clínica do Bom Jesus",
    note: "Trazer o boletim de vacinas.",
  },
  {
    id: "ap2",
    childId: "at_alice",
    date: new Date(2026, 8, 3),
    time: "18:15",
    title: "Consulta de nutrição",
    kind: "Nutrição",
    location: "Sede da academia",
  },
];

export const notices = [
  {
    id: "n1",
    title: "Torneio de abertura — 5 e 6 de setembro",
    body: "Sub-11 no Complexo da Rodovia. Concentração às 8h30, transporte assegurado pela academia.",
    from: "Rui Machado",
    at: new Date(2026, 7, 13),
    forChild: "at_martim",
  },
  {
    id: "n2",
    title: "Piscina encerrada a 18 de agosto",
    body: "Manutenção anual. O treino dessa semana passa para quinta-feira à mesma hora.",
    from: "Nuno Carvalho",
    at: new Date(2026, 7, 11),
    forChild: "at_alice",
  },
];

/** Presenças e progresso — o que o pai quer ver sem ter de perguntar ao treinador. */
export const progress: Record<string, { attended: number; total: number; skills: { name: string; score: number }[]; note: string }> = {
  at_martim: {
    attended: 22,
    total: 24,
    skills: [
      { name: "Técnica", score: 4 },
      { name: "Táctica", score: 3 },
      { name: "Físico", score: 4 },
      { name: "Atitude", score: 5 },
    ],
    note: "Evoluiu muito no passe curto e é dos primeiros a chegar. A trabalhar o posicionamento sem bola.",
  },
  at_alice: {
    attended: 15,
    total: 16,
    skills: [
      { name: "Técnica", score: 4 },
      { name: "Resistência", score: 3 },
      { name: "Viragens", score: 4 },
      { name: "Atitude", score: 5 },
    ],
    note: "Domina os 25 m em crol com respiração bilateral. Próximo passo: costas.",
  },
};

function at(dayOffset: number, hour: number, minute: number): Date {
  return new Date(2026, 7, 15 + dayOffset, hour, minute);
}

/**
 * Dados de demonstração.
 *
 * Determinísticos — um gerador com semente fixa — para que o desenho seja avaliável
 * e as capturas de ecrã sejam estáveis entre execuções. Substituir por chamadas HTTP
 * é trocar `src/lib/api.ts`; nada fora dessa fronteira sabe que estes dados existem.
 *
 * A academia é multi-desporto de propósito: futebol, basquetebol e natação convivem,
 * e a natação não tem posições — para que se veja a UI a adaptar-se por ausência.
 */

import type {
  Academy,
  Announcement,
  Athlete,
  ClinicalEntry,
  Evaluation,
  Fee,
  Guardian,
  StaffMember,
  Team,
  TrainingSession,
} from "./types";

/* -------------------------------------------------------------------------- */
/* Gerador com semente — mulberry32                                            */
/* -------------------------------------------------------------------------- */

function rng(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = rng(20260815);
const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
const chance = (p: number) => rand() < p;
const between = (a: number, b: number) => a + Math.floor(rand() * (b - a + 1));

/* -------------------------------------------------------------------------- */
/* Academia                                                                    */
/* -------------------------------------------------------------------------- */

export const academy: Academy = {
  id: "acd_lifeclub",
  slug: "life-club",
  name: "Academia Life Club",
  shortName: "Life Club",
  signalColor: "#0f6b62",
  city: "Braga",
  sports: [
    {
      id: "sp_fut",
      name: "Futebol",
      positions: ["Guarda-redes", "Defesa", "Médio", "Avançado"],
      dominantSideLabel: "Pé dominante",
      matchMinutes: 70, // escalões de formação
    },
    {
      id: "sp_bas",
      name: "Basquetebol",
      positions: ["Base", "Extremo", "Poste"],
      dominantSideLabel: "Mão dominante",
      matchMinutes: 40,
    },
    // Natação sem posições e sem lado dominante — a ficha do atleta adapta-se
    // por ausência, sem um `if (desporto === …)` em lado nenhum.
    { id: "sp_nat", name: "Natação", positions: [] },
  ],
};

/* -------------------------------------------------------------------------- */
/* Equipas e treinadores                                                       */
/* -------------------------------------------------------------------------- */

export const teams: Team[] = [
  { id: "t1", name: "Sub-9 Futebol", sportId: "sp_fut", ageGroup: "Sub-9", season: "2026/27", coachIds: ["c1"], athleteIds: [], schedule: [ { weekday: 2, start: "17:30", end: "19:00", venue: "Campo 1" }, { weekday: 4, start: "17:30", end: "19:00", venue: "Campo 1" } ] },
  { id: "t2", name: "Sub-11 Futebol", sportId: "sp_fut", ageGroup: "Sub-11", season: "2026/27", coachIds: ["c1", "c4"], athleteIds: [], schedule: [ { weekday: 1, start: "18:00", end: "19:30", venue: "Campo 1" }, { weekday: 3, start: "18:00", end: "19:30", venue: "Campo 2" } ] },
  { id: "t3", name: "Sub-13 Futebol", sportId: "sp_fut", ageGroup: "Sub-13", season: "2026/27", coachIds: ["c2"], athleteIds: [], schedule: [ { weekday: 1, start: "19:30", end: "21:00", venue: "Campo 2" }, { weekday: 3, start: "19:30", end: "21:00", venue: "Campo 2" }, { weekday: 5, start: "18:30", end: "20:00", venue: "Campo 1" } ] },
  { id: "t4", name: "Sub-15 Futebol", sportId: "sp_fut", ageGroup: "Sub-15", season: "2026/27", coachIds: ["c2"], athleteIds: [], schedule: [ { weekday: 2, start: "19:15", end: "20:45", venue: "Campo 2" }, { weekday: 4, start: "19:15", end: "20:45", venue: "Campo 2" } ] },
  { id: "t5", name: "Sub-12 Basquetebol", sportId: "sp_bas", ageGroup: "Sub-12", season: "2026/27", coachIds: ["c3"], athleteIds: [], schedule: [ { weekday: 1, start: "17:00", end: "18:30", venue: "Pavilhão" }, { weekday: 4, start: "17:00", end: "18:30", venue: "Pavilhão" } ] },
  { id: "t6", name: "Sub-14 Basquetebol", sportId: "sp_bas", ageGroup: "Sub-14", season: "2026/27", coachIds: ["c3", "c5"], athleteIds: [], schedule: [ { weekday: 2, start: "18:45", end: "20:15", venue: "Pavilhão" }, { weekday: 5, start: "18:45", end: "20:15", venue: "Pavilhão" } ] },
  { id: "t7", name: "Natação — Iniciação", sportId: "sp_nat", ageGroup: "6–9 anos", season: "2026/27", coachIds: ["c6"], athleteIds: [], schedule: [ { weekday: 3, start: "17:00", end: "18:00", venue: "Piscina municipal" }, { weekday: 6, start: "10:00", end: "11:00", venue: "Piscina municipal" } ] },
  { id: "t8", name: "Natação — Aperfeiçoamento", sportId: "sp_nat", ageGroup: "10–14 anos", season: "2026/27", coachIds: ["c6"], athleteIds: [], schedule: [ { weekday: 3, start: "18:00", end: "19:15", venue: "Piscina municipal" }, { weekday: 6, start: "11:00", end: "12:15", venue: "Piscina municipal" } ] },
];

/**
 * Staff da academia — toda a gente, não só quem treina.
 *
 * `role` decide o que a pessoa pode fazer no produto; `title` diz o que ela faz na
 * academia. Um nutricionista e um fisioterapeuta partilham `MEDICAL` e distinguem-se
 * pelo título — ver `StaffMember`.
 */
export const staff: StaffMember[] = [
  // Direção
  { id: "s1", name: "Helena Sá Pereira", email: "helena.pereira@lifeclub.pt", phone: "914 220 517", role: "DIRECTOR", title: "Diretora-geral", department: "direction", teamIds: [], since: "2019-07-01", isActive: true },
  { id: "s2", name: "Joaquim Vaz Beleza", email: "joaquim.beleza@lifeclub.pt", phone: "913 664 208", role: "OWNER", title: "Presidente", department: "direction", teamIds: [], since: "2018-01-10", isActive: true },
  { id: "s3", name: "Marta Vilela", email: "marta.vilela@lifeclub.pt", phone: "917 038 442", role: "COORDINATOR", title: "Diretora desportiva", department: "direction", teamIds: ["t5", "t6"], since: "2020-01-15", isActive: true },

  // Equipa técnica
  { id: "c1", name: "Rui Machado", email: "rui.machado@lifeclub.pt", phone: "912 445 108", role: "COACH", title: "Treinador principal", department: "technical", teamIds: ["t1", "t2"], since: "2022-09-01", isActive: true },
  { id: "c2", name: "Tiago Nogueira", email: "tiago.nogueira@lifeclub.pt", phone: "935 220 771", role: "COACH", title: "Treinador principal", department: "technical", teamIds: ["t3", "t4"], since: "2021-09-01", isActive: true },
  { id: "c3", name: "Marta Vilela", email: "marta.vilela@lifeclub.pt", phone: "917 038 442", role: "COACH", title: "Coordenadora de basquetebol", department: "technical", teamIds: ["t5", "t6"], since: "2020-01-15", isActive: true },
  { id: "c4", name: "André Peixoto", email: "andre.peixoto@lifeclub.pt", phone: "926 771 309", role: "COACH", title: "Treinador adjunto", department: "technical", teamIds: ["t2"], since: "2024-09-01", isActive: true },
  { id: "c5", name: "Sofia Rebelo", email: "sofia.rebelo@lifeclub.pt", phone: "961 884 025", role: "COACH", title: "Treinadora adjunta", department: "technical", teamIds: ["t6"], since: "2025-01-06", isActive: true },
  { id: "c6", name: "Nuno Carvalho", email: "nuno.carvalho@lifeclub.pt", phone: "938 512 664", role: "COACH", title: "Treinador principal", department: "technical", teamIds: ["t7", "t8"], since: "2023-09-04", isActive: true },
  { id: "c7", name: "Hugo Sampaio", email: "hugo.sampaio@lifeclub.pt", phone: "927 105 336", role: "COACH", title: "Preparador físico", department: "technical", teamIds: ["t3", "t4"], since: "2023-09-01", isActive: true },
  { id: "c8", name: "Bruno Cerqueira", email: "bruno.cerqueira@lifeclub.pt", phone: "919 447 260", role: "COACH", title: "Treinador de guarda-redes", department: "technical", teamIds: ["t2", "t3", "t4"], since: "2024-02-12", isActive: true },

  // Departamento clínico — mesmo papel, títulos diferentes.
  { id: "m1", name: "Inês Carvalho Dias", email: "ines.dias@lifeclub.pt", phone: "915 772 401", role: "MEDICAL", title: "Médica desportiva", department: "clinical", teamIds: [], since: "2021-03-01", isActive: true },
  { id: "m2", name: "Pedro Loureiro", email: "pedro.loureiro@lifeclub.pt", phone: "933 018 927", role: "MEDICAL", title: "Fisioterapeuta", department: "clinical", teamIds: [], since: "2022-01-17", isActive: true },
  { id: "m3", name: "Catarina Nunes", email: "catarina.nunes@lifeclub.pt", phone: "962 330 155", role: "MEDICAL", title: "Nutricionista", department: "clinical", teamIds: [], since: "2023-09-11", isActive: true },
  { id: "m4", name: "Vera Antunes", email: "vera.antunes@lifeclub.pt", phone: "918 604 772", role: "MEDICAL", title: "Psicóloga do desporto", department: "clinical", teamIds: [], since: "2024-10-07", isActive: true },

  // Secretaria e operações
  { id: "o1", name: "Cláudia Monteiro", email: "secretaria@lifeclub.pt", phone: "253 210 440", role: "STAFF", title: "Secretaria", department: "operations", teamIds: [], since: "2019-09-02", isActive: true },
  { id: "o2", name: "Álvaro Pinto", email: "alvaro.pinto@lifeclub.pt", phone: "939 225 610", role: "STAFF", title: "Roupeiro e equipamentos", department: "operations", teamIds: [], since: "2020-09-14", isActive: true },
];

/** Só quem trabalha com equipas. Usado onde antes se falava de "treinadores". */
export const coaches = staff.filter((s) => s.teamIds.length > 0);

/* -------------------------------------------------------------------------- */
/* Atletas, famílias                                                           */
/* -------------------------------------------------------------------------- */

// Declarado aqui, e não junto de `makeClinical` lá em baixo: os atletas são
// gerados no topo deste módulo, e um `const` mais abaixo estaria na temporal dead
// zone quando `makeClinical` corresse. O TypeScript não apanha isso — só rebenta
// em execução.
const INJURIES = [
  { title: "Entorse do tornozelo", days: 14 },
  { title: "Contusão no joelho", days: 7 },
  { title: "Distensão muscular (isquiotibiais)", days: 21 },
  { title: "Fractura de escafóide", days: 45 },
  { title: "Tendinite rotuliana", days: 10 },
];

const FIRST_M = ["Afonso", "Tomás", "Duarte", "Martim", "Salvador", "Gaspar", "Vicente", "Rodrigo", "Lourenço", "Dinis", "Gabriel", "Simão", "Bernardo", "Miguel", "Diogo", "Guilherme"];
const FIRST_F = ["Matilde", "Carolina", "Beatriz", "Leonor", "Mariana", "Constança", "Alice", "Íris", "Benedita", "Francisca", "Clara", "Madalena"];
const SURNAMES = ["Ferreira", "Antunes", "Marques", "Teixeira", "Fonseca", "Bragança", "Lourenço", "Pinheiro", "Guimarães", "Barroso", "Amorim", "Salgado", "Moutinho", "Vasconcelos", "Quaresma", "Loureiro", "Botelho", "Faria"];
const PARENT_M = ["Paulo", "Hélder", "Bruno", "Sérgio", "Nelson", "Vítor", "Fernando", "Ricardo"];
const PARENT_F = ["Sandra", "Cláudia", "Isabel", "Patrícia", "Raquel", "Teresa", "Célia", "Mónica"];

const AGE_BY_TEAM: Record<string, [number, number]> = {
  t1: [8, 9], t2: [10, 11], t3: [12, 13], t4: [14, 15],
  t5: [11, 12], t6: [13, 14], t7: [6, 9], t8: [10, 14],
};

const SIZE_BY_TEAM: Record<string, number> = { t1: 16, t2: 18, t3: 17, t4: 15, t5: 12, t6: 13, t7: 14, t8: 11 };

export const athletes: Athlete[] = [];
export const guardians: Guardian[] = [];

const TODAY = new Date(2026, 7, 15); // 15 de agosto de 2026

let aSeq = 0;
let gSeq = 0;

for (const team of teams) {
  const sport = academy.sports.find((s) => s.id === team.sportId)!;
  const [minAge, maxAge] = AGE_BY_TEAM[team.id];

  for (let i = 0; i < SIZE_BY_TEAM[team.id]; i++) {
    const female = chance(0.38);
    const surname = pick(SURNAMES);
    const name = `${pick(female ? FIRST_F : FIRST_M)} ${pick(SURNAMES)} ${surname}`;
    const id = `a${++aSeq}`;

    const years = between(minAge, maxAge);
    const birthdate = new Date(TODAY.getFullYear() - years, between(0, 11), between(1, 28));

    // Uma minoria de fichas médicas já expirou ou expira em breve — é isso que
    // alimenta a lista "Precisa de atenção".
    const medicalOffsetDays = chance(0.08) ? between(-40, -2) : between(20, 320);
    const medicalValidUntil = new Date(TODAY.getTime() + medicalOffsetDays * 86_400_000);

    const guardianName = `${pick(chance(0.6) ? PARENT_F : PARENT_M)} ${surname}`;
    const gid = `g${++gSeq}`;
    const female_g = PARENT_F.includes(guardianName.split(" ")[0]);

    guardians.push({
      id: gid,
      name: guardianName,
      email: `${slug(guardianName)}@mail.pt`,
      phone: `9${pick(["1", "2", "3", "6"])}${between(1000000, 9999999)}`,
      relation: female_g ? "Mãe" : "Pai",
      athleteIds: [id],
      appInstalled: chance(0.72),
    });

    // Altura e peso plausíveis para a idade — servem para a ficha ter escala real
    // e para se poder ver a evolução fazer sentido num Sub-9 vs. um Sub-15.
    const heightCm = Math.round(72 + years * 6.4 + between(-6, 6));
    const weightKg = Math.round((heightCm - 100 + between(-5, 5)) * 10) / 10;

    athletes.push({
      id,
      name,
      birthdate: iso(birthdate),
      teamId: team.id,
      position: sport.positions.length ? pick(sport.positions) : undefined,
      guardianIds: [gid],
      joinedAt: iso(new Date(TODAY.getFullYear() - between(0, 3), between(0, 11), between(1, 28))),
      status: chance(0.04) ? "paused" : "active",
      medicalValidUntil: iso(medicalValidUntil),
      heightCm,
      weightKg: Math.max(20, weightKg),
      // Só onde a modalidade tem um lado dominante — a natação fica sem.
      dominantSide: sport.dominantSideLabel
        ? chance(0.78)
          ? "Direito"
          : chance(0.85)
            ? "Esquerdo"
            : "Ambidestro"
        : undefined,
      squadNumber: sport.positions.length ? between(1, 30) : undefined,
      clinical: makeClinical(id, TODAY, medicalValidUntil),
    });

    team.athleteIds.push(id);
  }
}

/* -------------------------------------------------------------------------- */
/* Mensalidades                                                                */
/* -------------------------------------------------------------------------- */

const FEE_BY_SPORT: Record<string, number> = { sp_fut: 4000, sp_bas: 3500, sp_nat: 4500 };

export const fees: Fee[] = [];
let fSeq = 0;

/** Três períodos: dois fechados e o corrente, que é onde vive a tensão. */
for (const monthOffset of [-2, -1, 0]) {
  const periodDate = new Date(TODAY.getFullYear(), TODAY.getMonth() + monthOffset, 1);
  const period = `${periodDate.getFullYear()}-${String(periodDate.getMonth() + 1).padStart(2, "0")}`;
  const dueDate = new Date(periodDate.getFullYear(), periodDate.getMonth(), 8);
  const current = monthOffset === 0;

  for (const athlete of athletes) {
    if (athlete.status === "left") continue;
    const team = teams.find((t) => t.id === athlete.teamId)!;
    const amountCents = FEE_BY_SPORT[team.sportId];

    let status: Fee["status"];
    if (!current) {
      status = chance(0.97) ? "paid" : "overdue";
    } else {
      const roll = rand();
      status = roll < 0.74 ? "paid" : roll < 0.8 ? "processing" : roll < 0.87 ? "pending" : "overdue";
    }

    const paidAt =
      status === "paid"
        ? iso(new Date(dueDate.getTime() + between(-6, 9) * 86_400_000))
        : undefined;

    fees.push({
      id: `f${++fSeq}`,
      athleteId: athlete.id,
      period,
      amountCents,
      dueDate: iso(dueDate),
      status,
      paidAt,
      method: paidAt ? pick(["MB Way", "MB Way", "Multibanco", "Cartão", "Transferência"] as const) : undefined,
      reference: status === "pending" || status === "processing" ? `${between(100, 999)} ${between(100, 999)} ${between(100, 999)}` : undefined,
    });
  }
}

export const currentPeriod = `${TODAY.getFullYear()}-${String(TODAY.getMonth() + 1).padStart(2, "0")}`;

/* -------------------------------------------------------------------------- */
/* Treinos                                                                     */
/* -------------------------------------------------------------------------- */

export const sessions: TrainingSession[] = [];
let sSeq = 0;

/**
 * Um horizonte largo — meia época para trás — para a ficha do atleta ter
 * assiduidade com significado em vez de três linhas.
 */
for (let dayOffset = -120; dayOffset <= 12; dayOffset++) {
  const day = new Date(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate() + dayOffset);

  for (const team of teams) {
    for (const slot of team.schedule) {
      if (slot.weekday !== day.getDay()) continue;

      const past = dayOffset < 0;
      // Alguns treinos passados ficaram por registar — é uma das linhas de atenção.
      // Só os recentes: mais atrás, assume-se que a época já foi fechada.
      const recorded = past && (dayOffset < -21 || chance(0.86));
      const cancelled = chance(0.03);

      sessions.push({
        id: `s${++sSeq}`,
        teamId: team.id,
        start: isoAt(day, slot.start),
        end: isoAt(day, slot.end),
        venue: slot.venue,
        // Um treino futuro sem treinador é exactamente o tipo de coisa que o
        // diretor tem de saber antes de acontecer.
        coachId: !past && chance(0.04) ? undefined : team.coachIds[0],
        status: cancelled ? "cancelled" : past ? "done" : "scheduled",
        attendance:
          recorded && !cancelled
            ? { absences: drawAbsences(team.athleteIds), recordedAt: isoAt(day, slot.end) }
            : undefined,
      });
    }
  }
}

/**
 * Sorteia quem faltou a um treino. Guarda-se só a excepção — quem não estiver
 * nesta lista esteve presente.
 */
function drawAbsences(roster: string[]) {
  const out: { athleteId: string; kind: "absent" | "justified" | "late" }[] = [];
  for (const athleteId of roster) {
    const roll = rand();
    if (roll < 0.07) out.push({ athleteId, kind: "absent" });
    else if (roll < 0.11) out.push({ athleteId, kind: "justified" });
    else if (roll < 0.135) out.push({ athleteId, kind: "late" });
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Avaliações e comunicação                                                    */
/* -------------------------------------------------------------------------- */

export const SKILLS = ["Técnica", "Táctica", "Físico", "Atitude", "Assiduidade"] as const;

export const evaluations: Evaluation[] = athletes
  .filter(() => chance(0.55))
  .map((a, i) => {
    const team = teams.find((t) => t.id === a.teamId)!;
    return {
      id: `e${i + 1}`,
      athleteId: a.id,
      coachId: team.coachIds[0],
      period: "2026/27 · 1.º período",
      status: chance(0.62) ? "published" : "draft",
      updatedAt: iso(new Date(TODAY.getTime() - between(1, 40) * 86_400_000)),
      scores: Object.fromEntries(SKILLS.map((s) => [s, between(2, 5)])),
    };
  });

export const announcements: Announcement[] = [
  { id: "an1", title: "Torneio de abertura — 5 e 6 de setembro", body: "Sub-11 e Sub-13 no Complexo da Rodovia. Convocatórias enviadas às famílias.", audience: "Sub-11, Sub-13", publishedAt: iso(new Date(TODAY.getTime() - 2 * 86_400_000)), authorId: "c2", reach: 35, read: 29 },
  { id: "an2", title: "Piscina encerrada a 18 de agosto", body: "Manutenção anual. Os treinos de natação dessa semana passam para quinta-feira.", audience: "Natação", publishedAt: iso(new Date(TODAY.getTime() - 4 * 86_400_000)), authorId: "c6", reach: 25, read: 25 },
  { id: "an3", title: "Renovação de inscrições 2026/27", body: "Prazo até 31 de agosto. As famílias podem renovar directamente na app.", audience: "Toda a academia", publishedAt: iso(new Date(TODAY.getTime() - 9 * 86_400_000)), authorId: "c3", reach: 116, read: 88 },
];

/* -------------------------------------------------------------------------- */
/* Utilitários                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Boletim clínico — histórico, não apenas a validade do exame.
 *
 * A maioria dos atletas tem só o exame médico anual; uma minoria tem uma lesão
 * no historial, e alguns dessa minoria continuam indisponíveis (sem `clearedOn`).
 * É essa minoria que dá conteúdo real ao separador clínico da ficha.
 */
function makeClinical(athleteId: string, today: Date, medicalValidUntil: Date): ClinicalEntry[] {
  const entries: ClinicalEntry[] = [];
  let n = 0;

  // O exame médico que produz a validade que já mostramos noutros ecrãs.
  const examDate = new Date(medicalValidUntil.getTime() - 365 * 86_400_000);
  entries.push({
    id: `${athleteId}_c${++n}`,
    date: iso(examDate),
    kind: "exam",
    title: "Exame médico-desportivo",
    detail: `Apto. Válido até ${iso(medicalValidUntil)}.`,
    impact: "none",
    authorId: "m1",
  });

  if (chance(0.28)) {
    const injury = pick(INJURIES);
    const when = new Date(today.getTime() - between(10, 200) * 86_400_000);
    const expectedReturn = new Date(when.getTime() + injury.days * 86_400_000);
    const stillOut = expectedReturn > today;

    entries.push({
      id: `${athleteId}_c${++n}`,
      date: iso(when),
      kind: "injury",
      title: injury.title,
      detail: stillOut
        ? "Em tratamento. Sem treino com bola até reavaliação."
        : "Alta clínica. Retomou os treinos sem limitações.",
      impact: stillOut ? "out" : "out",
      outDays: injury.days,
      expectedReturn: iso(expectedReturn),
      clearedOn: stillOut ? undefined : iso(expectedReturn),
      authorId: "m1",
    });

    // Depois de uma lesão vem quase sempre fisioterapia.
    if (!stillOut && chance(0.6)) {
      entries.push({
        id: `${athleteId}_c${++n}`,
        date: iso(new Date(expectedReturn.getTime() - 5 * 86_400_000)),
        kind: "physio",
        title: "Reabilitação — fase final",
        detail: "Trabalho de força e reintrodução progressiva ao treino de equipa.",
        impact: "none",
        authorId: "m2",
      });
    }
  }

  // Acompanhamento contínuo — não afasta ninguém, mas é o trabalho do dia a dia
  // do departamento clínico e o que enche a agenda de nutrição e psicologia.
  if (chance(0.22)) {
    entries.push({
      id: `${athleteId}_c${++n}`,
      date: iso(new Date(today.getTime() - between(5, 120) * 86_400_000)),
      kind: "nutrition",
      title: pick(["Avaliação nutricional", "Plano alimentar — revisão", "Hidratação em competição"]),
      detail: pick([
        "Reforço de hidratos antes do treino. Rever em 6 semanas.",
        "Composição corporal dentro do esperado para o escalão.",
        "Pequeno-almoço insuficiente nos dias de jogo — plano entregue à família.",
      ]),
      impact: "none",
      authorId: "m3",
    });
  }

  if (chance(0.12)) {
    entries.push({
      id: `${athleteId}_c${++n}`,
      date: iso(new Date(today.getTime() - between(5, 90) * 86_400_000)),
      kind: "psychology",
      title: pick(["Sessão de acompanhamento", "Gestão de ansiedade pré-competição", "Adaptação ao escalão"]),
      detail: "Acompanhamento em curso. Notas de sessão restritas ao departamento clínico.",
      impact: "none",
      authorId: "m4",
    });
  }

  // Um punhado de atletas em trabalho condicionado — o estado intermédio que
  // distingue "não joga" de "não faz nada".
  if (chance(0.05)) {
    entries.push({
      id: `${athleteId}_c${++n}`,
      date: iso(new Date(today.getTime() - between(2, 20) * 86_400_000)),
      kind: "physio",
      title: "Sobrecarga muscular",
      detail: "Treina sem contacto. Não convocável até reavaliação.",
      impact: "limited",
      expectedReturn: iso(new Date(today.getTime() + between(3, 14) * 86_400_000)),
      authorId: "m2",
    });
  }

  // Alguns agendamentos futuros — exames de renovação e reavaliações. É o que dá
  // conteúdo à agenda clínica e ao cartão "próxima consulta" na app da família.
  if (chance(0.18)) {
    const when = new Date(today.getTime() + between(2, 45) * 86_400_000);
    const kind = chance(0.5) ? "exam" : chance(0.5) ? "nutrition" : "physio";
    entries.push({
      id: `${athleteId}_c${++n}`,
      date: iso(when),
      status: "scheduled",
      time: pick(["09:30", "10:00", "14:30", "17:00", "18:15"]),
      location: kind === "exam" ? "Clínica do Bom Jesus" : "Sede da academia",
      kind: kind as ClinicalEntry["kind"],
      title:
        kind === "exam"
          ? "Renovação do exame médico-desportivo"
          : kind === "nutrition"
            ? "Consulta de nutrição"
            : "Reavaliação de fisioterapia",
      detail: kind === "exam" ? "Trazer o boletim de vacinas." : undefined,
      impact: "none",
      authorId: "m1",
    });
  }

  return entries.sort((a, b) => b.date.localeCompare(a.date));
}

/** "Sandra Bragança" → "sandra.braganca". Acentos fora, para endereços de e-mail. */
function slug(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, ".");
}

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function isoAt(d: Date, hhmm: string): string {
  return `${iso(d)}T${hhmm}:00`;
}

/** "Hoje" congelado, para que a demonstração leia sempre igual. */
export const today = TODAY;

// src/data/demo.ts
function rng(seed) {
  let a = seed;
  return () => {
    a |= 0;
    a = a + 1831565813 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
var rand = rng(20260815);
var pick = (xs) => xs[Math.floor(rand() * xs.length)];
var chance = (p) => rand() < p;
var between = (a, b) => a + Math.floor(rand() * (b - a + 1));
var academy = {
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
      positions: ["Guarda-redes", "Defesa", "M\xE9dio", "Avan\xE7ado"],
      dominantSideLabel: "P\xE9 dominante",
      matchMinutes: 70
      // escalões de formação
    },
    {
      id: "sp_bas",
      name: "Basquetebol",
      positions: ["Base", "Extremo", "Poste"],
      dominantSideLabel: "M\xE3o dominante",
      matchMinutes: 40
    },
    // Natação sem posições e sem lado dominante — a ficha do atleta adapta-se
    // por ausência, sem um `if (desporto === …)` em lado nenhum.
    { id: "sp_nat", name: "Nata\xE7\xE3o", positions: [] }
  ]
};
var teams = [
  { id: "t1", name: "Sub-9 Futebol", sportId: "sp_fut", ageGroup: "Sub-9", season: "2026/27", coachIds: ["c1"], athleteIds: [], schedule: [{ weekday: 2, start: "17:30", end: "19:00", venue: "Campo 1" }, { weekday: 4, start: "17:30", end: "19:00", venue: "Campo 1" }] },
  { id: "t2", name: "Sub-11 Futebol", sportId: "sp_fut", ageGroup: "Sub-11", season: "2026/27", coachIds: ["c1", "c4"], athleteIds: [], schedule: [{ weekday: 1, start: "18:00", end: "19:30", venue: "Campo 1" }, { weekday: 3, start: "18:00", end: "19:30", venue: "Campo 2" }] },
  { id: "t3", name: "Sub-13 Futebol", sportId: "sp_fut", ageGroup: "Sub-13", season: "2026/27", coachIds: ["c2"], athleteIds: [], schedule: [{ weekday: 1, start: "19:30", end: "21:00", venue: "Campo 2" }, { weekday: 3, start: "19:30", end: "21:00", venue: "Campo 2" }, { weekday: 5, start: "18:30", end: "20:00", venue: "Campo 1" }] },
  { id: "t4", name: "Sub-15 Futebol", sportId: "sp_fut", ageGroup: "Sub-15", season: "2026/27", coachIds: ["c2"], athleteIds: [], schedule: [{ weekday: 2, start: "19:15", end: "20:45", venue: "Campo 2" }, { weekday: 4, start: "19:15", end: "20:45", venue: "Campo 2" }] },
  { id: "t5", name: "Sub-12 Basquetebol", sportId: "sp_bas", ageGroup: "Sub-12", season: "2026/27", coachIds: ["c3"], athleteIds: [], schedule: [{ weekday: 1, start: "17:00", end: "18:30", venue: "Pavilh\xE3o" }, { weekday: 4, start: "17:00", end: "18:30", venue: "Pavilh\xE3o" }] },
  { id: "t6", name: "Sub-14 Basquetebol", sportId: "sp_bas", ageGroup: "Sub-14", season: "2026/27", coachIds: ["c3", "c5"], athleteIds: [], schedule: [{ weekday: 2, start: "18:45", end: "20:15", venue: "Pavilh\xE3o" }, { weekday: 5, start: "18:45", end: "20:15", venue: "Pavilh\xE3o" }] },
  { id: "t7", name: "Nata\xE7\xE3o \u2014 Inicia\xE7\xE3o", sportId: "sp_nat", ageGroup: "6\u20139 anos", season: "2026/27", coachIds: ["c6"], athleteIds: [], schedule: [{ weekday: 3, start: "17:00", end: "18:00", venue: "Piscina municipal" }, { weekday: 6, start: "10:00", end: "11:00", venue: "Piscina municipal" }] },
  { id: "t8", name: "Nata\xE7\xE3o \u2014 Aperfei\xE7oamento", sportId: "sp_nat", ageGroup: "10\u201314 anos", season: "2026/27", coachIds: ["c6"], athleteIds: [], schedule: [{ weekday: 3, start: "18:00", end: "19:15", venue: "Piscina municipal" }, { weekday: 6, start: "11:00", end: "12:15", venue: "Piscina municipal" }] }
];
var coaches = [
  { id: "c1", name: "Rui Machado", email: "rui.machado@lifeclub.pt", phone: "912 445 108", role: "Treinador principal", teamIds: ["t1", "t2"], since: "2022-09-01" },
  { id: "c2", name: "Tiago Nogueira", email: "tiago.nogueira@lifeclub.pt", phone: "935 220 771", role: "Treinador principal", teamIds: ["t3", "t4"], since: "2021-09-01" },
  { id: "c3", name: "Marta Vilela", email: "marta.vilela@lifeclub.pt", phone: "917 038 442", role: "Coordenador", teamIds: ["t5", "t6"], since: "2020-01-15" },
  { id: "c4", name: "Andr\xE9 Peixoto", email: "andre.peixoto@lifeclub.pt", phone: "926 771 309", role: "Treinador adjunto", teamIds: ["t2"], since: "2024-09-01" },
  { id: "c5", name: "Sofia Rebelo", email: "sofia.rebelo@lifeclub.pt", phone: "961 884 025", role: "Treinador adjunto", teamIds: ["t6"], since: "2025-01-06" },
  { id: "c6", name: "Nuno Carvalho", email: "nuno.carvalho@lifeclub.pt", phone: "938 512 664", role: "Treinador principal", teamIds: ["t7", "t8"], since: "2023-09-04" }
];
var FIRST_M = ["Afonso", "Tom\xE1s", "Duarte", "Martim", "Salvador", "Gaspar", "Vicente", "Rodrigo", "Louren\xE7o", "Dinis", "Gabriel", "Sim\xE3o", "Bernardo", "Miguel", "Diogo", "Guilherme"];
var FIRST_F = ["Matilde", "Carolina", "Beatriz", "Leonor", "Mariana", "Constan\xE7a", "Alice", "\xCDris", "Benedita", "Francisca", "Clara", "Madalena"];
var SURNAMES = ["Ferreira", "Antunes", "Marques", "Teixeira", "Fonseca", "Bragan\xE7a", "Louren\xE7o", "Pinheiro", "Guimar\xE3es", "Barroso", "Amorim", "Salgado", "Moutinho", "Vasconcelos", "Quaresma", "Loureiro", "Botelho", "Faria"];
var PARENT_M = ["Paulo", "H\xE9lder", "Bruno", "S\xE9rgio", "Nelson", "V\xEDtor", "Fernando", "Ricardo"];
var PARENT_F = ["Sandra", "Cl\xE1udia", "Isabel", "Patr\xEDcia", "Raquel", "Teresa", "C\xE9lia", "M\xF3nica"];
var AGE_BY_TEAM = {
  t1: [8, 9],
  t2: [10, 11],
  t3: [12, 13],
  t4: [14, 15],
  t5: [11, 12],
  t6: [13, 14],
  t7: [6, 9],
  t8: [10, 14]
};
var SIZE_BY_TEAM = { t1: 16, t2: 18, t3: 17, t4: 15, t5: 12, t6: 13, t7: 14, t8: 11 };
var athletes = [];
var guardians = [];
var TODAY = new Date(2026, 7, 15);
var aSeq = 0;
var gSeq = 0;
for (const team of teams) {
  const sport = academy.sports.find((s) => s.id === team.sportId);
  const [minAge, maxAge] = AGE_BY_TEAM[team.id];
  for (let i = 0; i < SIZE_BY_TEAM[team.id]; i++) {
    const female = chance(0.38);
    const surname = pick(SURNAMES);
    const name = `${pick(female ? FIRST_F : FIRST_M)} ${pick(SURNAMES)} ${surname}`;
    const id = `a${++aSeq}`;
    const years = between(minAge, maxAge);
    const birthdate = new Date(TODAY.getFullYear() - years, between(0, 11), between(1, 28));
    const medicalOffsetDays = chance(0.08) ? between(-40, -2) : between(20, 320);
    const medicalValidUntil = new Date(TODAY.getTime() + medicalOffsetDays * 864e5);
    const guardianName = `${pick(chance(0.6) ? PARENT_F : PARENT_M)} ${surname}`;
    const gid = `g${++gSeq}`;
    const female_g = PARENT_F.includes(guardianName.split(" ")[0]);
    guardians.push({
      id: gid,
      name: guardianName,
      email: `${slug(guardianName)}@mail.pt`,
      phone: `9${pick(["1", "2", "3", "6"])}${between(1e6, 9999999)}`,
      relation: female_g ? "M\xE3e" : "Pai",
      athleteIds: [id],
      appInstalled: chance(0.72)
    });
    const heightCm = Math.round(72 + years * 6.4 + between(-6, 6));
    const weightKg = Math.round((heightCm - 100 + between(-5, 5)) * 10) / 10;
    athletes.push({
      id,
      name,
      birthdate: iso(birthdate),
      teamId: team.id,
      position: sport.positions.length ? pick(sport.positions) : void 0,
      guardianIds: [gid],
      joinedAt: iso(new Date(TODAY.getFullYear() - between(0, 3), between(0, 11), between(1, 28))),
      status: chance(0.04) ? "paused" : "active",
      medicalValidUntil: iso(medicalValidUntil),
      heightCm,
      weightKg: Math.max(20, weightKg),
      // Só onde a modalidade tem um lado dominante — a natação fica sem.
      dominantSide: sport.dominantSideLabel ? chance(0.78) ? "Direito" : chance(0.85) ? "Esquerdo" : "Ambidestro" : void 0,
      squadNumber: sport.positions.length ? between(1, 30) : void 0,
      clinical: makeClinical(id, TODAY, medicalValidUntil)
    });
    team.athleteIds.push(id);
  }
}
var FEE_BY_SPORT = { sp_fut: 4e3, sp_bas: 3500, sp_nat: 4500 };
var fees = [];
var fSeq = 0;
for (const monthOffset of [-2, -1, 0]) {
  const periodDate = new Date(TODAY.getFullYear(), TODAY.getMonth() + monthOffset, 1);
  const period = `${periodDate.getFullYear()}-${String(periodDate.getMonth() + 1).padStart(2, "0")}`;
  const dueDate = new Date(periodDate.getFullYear(), periodDate.getMonth(), 8);
  const current = monthOffset === 0;
  for (const athlete of athletes) {
    if (athlete.status === "left") continue;
    const team = teams.find((t) => t.id === athlete.teamId);
    const amountCents = FEE_BY_SPORT[team.sportId];
    let status;
    if (!current) {
      status = chance(0.97) ? "paid" : "overdue";
    } else {
      const roll = rand();
      status = roll < 0.74 ? "paid" : roll < 0.8 ? "processing" : roll < 0.87 ? "pending" : "overdue";
    }
    const paidAt = status === "paid" ? iso(new Date(dueDate.getTime() + between(-6, 9) * 864e5)) : void 0;
    fees.push({
      id: `f${++fSeq}`,
      athleteId: athlete.id,
      period,
      amountCents,
      dueDate: iso(dueDate),
      status,
      paidAt,
      method: paidAt ? pick(["MB Way", "MB Way", "Multibanco", "Cart\xE3o", "Transfer\xEAncia"]) : void 0,
      reference: status === "pending" || status === "processing" ? `${between(100, 999)} ${between(100, 999)} ${between(100, 999)}` : void 0
    });
  }
}
var currentPeriod = `${TODAY.getFullYear()}-${String(TODAY.getMonth() + 1).padStart(2, "0")}`;
var sessions = [];
var sSeq = 0;
for (let dayOffset = -120; dayOffset <= 12; dayOffset++) {
  const day = new Date(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate() + dayOffset);
  for (const team of teams) {
    for (const slot of team.schedule) {
      if (slot.weekday !== day.getDay()) continue;
      const past = dayOffset < 0;
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
        coachId: !past && chance(0.04) ? void 0 : team.coachIds[0],
        status: cancelled ? "cancelled" : past ? "done" : "scheduled",
        attendance: recorded && !cancelled ? { absences: drawAbsences(team.athleteIds), recordedAt: isoAt(day, slot.end) } : void 0
      });
    }
  }
}
function drawAbsences(roster) {
  const out = [];
  for (const athleteId of roster) {
    const roll = rand();
    if (roll < 0.07) out.push({ athleteId, kind: "absent" });
    else if (roll < 0.11) out.push({ athleteId, kind: "justified" });
    else if (roll < 0.135) out.push({ athleteId, kind: "late" });
  }
  return out;
}
var SKILLS = ["T\xE9cnica", "T\xE1ctica", "F\xEDsico", "Atitude", "Assiduidade"];
var evaluations = athletes.filter(() => chance(0.55)).map((a, i) => {
  const team = teams.find((t) => t.id === a.teamId);
  return {
    id: `e${i + 1}`,
    athleteId: a.id,
    coachId: team.coachIds[0],
    period: "2026/27 \xB7 1.\xBA per\xEDodo",
    status: chance(0.62) ? "published" : "draft",
    updatedAt: iso(new Date(TODAY.getTime() - between(1, 40) * 864e5)),
    scores: Object.fromEntries(SKILLS.map((s) => [s, between(2, 5)]))
  };
});
var announcements = [
  { id: "an1", title: "Torneio de abertura \u2014 5 e 6 de setembro", body: "Sub-11 e Sub-13 no Complexo da Rodovia. Convocat\xF3rias enviadas \xE0s fam\xEDlias.", audience: "Sub-11, Sub-13", publishedAt: iso(new Date(TODAY.getTime() - 2 * 864e5)), authorId: "c2", reach: 35, read: 29 },
  { id: "an2", title: "Piscina encerrada a 18 de agosto", body: "Manuten\xE7\xE3o anual. Os treinos de nata\xE7\xE3o dessa semana passam para quinta-feira.", audience: "Nata\xE7\xE3o", publishedAt: iso(new Date(TODAY.getTime() - 4 * 864e5)), authorId: "c6", reach: 25, read: 25 },
  { id: "an3", title: "Renova\xE7\xE3o de inscri\xE7\xF5es 2026/27", body: "Prazo at\xE9 31 de agosto. As fam\xEDlias podem renovar directamente na app.", audience: "Toda a academia", publishedAt: iso(new Date(TODAY.getTime() - 9 * 864e5)), authorId: "c3", reach: 116, read: 88 }
];
var INJURIES = [
  { title: "Entorse do tornozelo", days: 14 },
  { title: "Contus\xE3o no joelho", days: 7 },
  { title: "Distens\xE3o muscular (isquiotibiais)", days: 21 },
  { title: "Fractura de escaf\xF3ide", days: 45 },
  { title: "Tendinite rotuliana", days: 10 }
];
function makeClinical(athleteId, today2, medicalValidUntil) {
  const entries = [];
  let n = 0;
  const examDate = new Date(medicalValidUntil.getTime() - 365 * 864e5);
  entries.push({
    id: `${athleteId}_c${++n}`,
    date: iso(examDate),
    kind: "exam",
    title: "Exame m\xE9dico-desportivo",
    detail: `Apto. V\xE1lido at\xE9 ${iso(medicalValidUntil)}.`
  });
  if (chance(0.28)) {
    const injury = pick(INJURIES);
    const when = new Date(today2.getTime() - between(10, 200) * 864e5);
    const expectedReturn = new Date(when.getTime() + injury.days * 864e5);
    const stillOut = expectedReturn > today2;
    entries.push({
      id: `${athleteId}_c${++n}`,
      date: iso(when),
      kind: "injury",
      title: injury.title,
      detail: stillOut ? `Retoma prevista a ${iso(expectedReturn)}.` : "Alta cl\xEDnica. Retomou os treinos sem limita\xE7\xF5es.",
      outDays: injury.days,
      clearedOn: stillOut ? void 0 : iso(expectedReturn)
    });
  }
  return entries.sort((a, b) => b.date.localeCompare(a.date));
}
function slug(name) {
  return name.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/\s+/g, ".");
}
function iso(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function isoAt(d, hhmm) {
  return `${iso(d)}T${hhmm}:00`;
}
var today = TODAY;
export {
  SKILLS,
  academy,
  announcements,
  athletes,
  coaches,
  currentPeriod,
  evaluations,
  fees,
  guardians,
  sessions,
  teams,
  today
};

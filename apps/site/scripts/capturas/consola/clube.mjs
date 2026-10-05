/**
 * O CD Academias: o clube inventado das capturas.
 *
 * Tudo o que a consola mostra nas capturas sai daqui. Nada disto existe em base
 * de dados nenhuma: são objetos em memória, com a forma que a API devolve, e
 * dependem da hora da cena (`agora`). Um treino só tem presenças se já acabou,
 * uma mensalidade só está paga se o pagamento já aconteceu, um jogo só tem
 * resultado depois do apito final. Assim a mesma semana vê-se em dias diferentes
 * sem escrever dois conjuntos de dados.
 *
 * As pessoas, as equipas e a semana vêm do GUIAO.md.
 */

import { criarJogos } from "./jogos.mjs";

/* -------------------------------------------------------------------------- */
/* Tempo                                                                       */
/* -------------------------------------------------------------------------- */

/** Uma hora de relógio de Lisboa como instante. A hora de verão acaba a 25/10/2026. */
export function em(dia, hora = "00:00") {
  const inverno = dia >= "2026-10-25" && dia < "2027-03-28";
  return new Date(`${dia}T${hora}:00${inverno ? "+00:00" : "+01:00"}`);
}
const iso = (dia, hora) => em(dia, hora).toISOString();

/** `AAAA-MM-DD` do dia seguinte, n dias depois. */
function maisDias(dia, n) {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const diaDaSemana = (dia) => new Date(`${dia}T12:00:00Z`).getUTCDay();

/** Um gerador com semente: os mesmos dados em todas as corridas. */
function sorte(semente) {
  let h = 1779033703 ^ semente.length;
  for (let i = 0; i < semente.length; i++) {
    h = Math.imul(h ^ semente.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

const semAcentos = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
const chave = (s) => semAcentos(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/* -------------------------------------------------------------------------- */
/* O clube                                                                     */
/* -------------------------------------------------------------------------- */

export const SUPABASE = "http://127.0.0.1:3998";
export const EMBLEMA_URL = `${SUPABASE}/storage/v1/object/public/clubes/cd-academias/emblema.png`;

export const SPORT = {
  id: "sp-futebol",
  name: "Futebol",
  code: "football",
  positions: [
    "Guarda-redes",
    "Defesa central",
    "Lateral direito",
    "Lateral esquerdo",
    "Médio defensivo",
    "Médio centro",
    "Médio ofensivo",
    "Extremo direito",
    "Extremo esquerdo",
    "Avançado",
  ],
  skills: ["Técnica", "Tática", "Físico", "Atitude"],
  dominantSideLabel: "Pé dominante",
  matchMinutes: 90,
};

export const EPOCA = { id: "ep-2026-27", label: "2026/27", isCurrent: true, startsOn: "2026-08-01", endsOn: "2027-07-31" };
const EPOCA_ANTERIOR = { id: "ep-2025-26", label: "2025/26", isCurrent: false, startsOn: "2025-08-01", endsOn: "2026-07-31" };

const COMPETICOES = {
  sub11: { id: "cp-sub11", label: "Encontros Sub-11" },
  sub13: { id: "cp-sub13", label: "Campeonato Distrital Sub-13" },
  sub15: { id: "cp-sub15", label: "Campeonato Distrital Sub-15" },
  sen: { id: "cp-sen", label: "Divisão de Honra" },
};

/* ---- Staff ---------------------------------------------------------------- */

const STAFF = [
  { id: "st-helena-marques", name: "Helena Marques", role: "OWNER", title: "Presidente", dep: "DIRECTION", cargo: "Presidente", since: "2019-07-01" },
  { id: "st-paulo-rebelo", name: "Paulo Rebelo", role: "DIRECTOR", title: "Diretor", dep: "DIRECTION", cargo: "Diretor", since: "2020-09-01" },
  { id: "st-marta-silva", name: "Marta Silva", role: "STAFF", title: "Secretaria", dep: "OPERATIONS", cargo: "Secretaria", since: "2022-01-10" },
  { id: "st-sergio-almeida", name: "Sérgio Almeida", role: "COORDINATOR", title: "Coordenador técnico", dep: "TECHNICAL", cargo: "Coordenador técnico", since: "2021-07-15" },
  { id: "st-miguel-antunes", name: "Miguel Antunes", role: "COACH", title: "Treinador principal", dep: "TECHNICAL", cargo: "Treinador", since: "2022-08-01", teams: ["t-sub13"] },
  { id: "st-rui-tavares", name: "Rui Tavares", role: "COACH", title: "Treinador adjunto", dep: "TECHNICAL", cargo: "Treinador adjunto", since: "2024-08-01", teams: ["t-sub13"] },
  { id: "st-andre-lopes", name: "André Lopes", role: "COACH", title: "Treinador principal", dep: "TECHNICAL", cargo: "Treinador", since: "2023-08-01", teams: ["t-sub11"] },
  { id: "st-ricardo-fonseca", name: "Ricardo Fonseca", role: "COACH", title: "Treinador principal", dep: "TECHNICAL", cargo: "Treinador", since: "2021-08-01", teams: ["t-sub15"] },
  { id: "st-filipe-moura", name: "Filipe Moura", role: "COACH", title: "Treinador adjunto", dep: "TECHNICAL", cargo: "Treinador adjunto", since: "2025-08-01", teams: ["t-sub15"] },
  { id: "st-nuno-barros", name: "Nuno Barros", role: "COACH", title: "Treinador principal", dep: "TECHNICAL", cargo: "Treinador", since: "2020-08-01", teams: ["t-seniores"] },
  { id: "st-tiago-pires", name: "Tiago Pires", role: "COACH", title: "Treinador de guarda-redes", dep: "TECHNICAL", cargo: "Treinador de guarda-redes", since: "2023-08-01", teams: ["t-sub13", "t-sub15", "t-seniores"] },
  { id: "st-ines-carvalho", name: "Inês Carvalho", role: "MEDICAL", title: "Fisioterapeuta", dep: "CLINICAL", cargo: "Fisioterapeuta", since: "2023-09-01" },
  { id: "st-joao-seabra", name: "João Seabra", role: "MEDICAL", title: "Médico", dep: "CLINICAL", cargo: "Médico", since: "2022-09-01" },
  { id: "st-bruno-teixeira", name: "Bruno Teixeira", role: "SCOUT", title: "Observador", dep: "SCOUTING", cargo: "Observador", since: "2024-02-01" },
];

const DEPARTAMENTOS = {
  DIRECTION: { key: "direction", name: "Direção" },
  TECHNICAL: { key: "technical", name: "Equipa técnica" },
  CLINICAL: { key: "clinical", name: "Departamento clínico" },
  SCOUTING: { key: "scouting", name: "Scouting" },
  OPERATIONS: { key: "operations", name: "Secretaria" },
};

const emailDe = (nome) => `${chave(nome).replace(/-/g, ".")}@cdacademias.pt`;

/* ---- Equipas -------------------------------------------------------------- */

const EQUIPAS = [
  {
    id: "t-sub11", name: "Sub-11", maxAge: 11, feeCents: 3000, matchMinutes: 50, maxCallUps: 14, competicao: COMPETICOES.sub11,
    treinos: [
      { weekday: 2, start: "18:00", end: "19:00", venue: "Campo 2" },
      { weekday: 4, start: "18:00", end: "19:00", venue: "Campo 2" },
    ],
    desde: "2026-09-08", balneario: "Balneário 2",
  },
  {
    id: "t-sub13", name: "Sub-13", maxAge: 13, feeCents: 3500, matchMinutes: 60, maxCallUps: 16, competicao: COMPETICOES.sub13,
    treinos: [
      { weekday: 1, start: "19:00", end: "20:15", venue: "Campo 2" },
      { weekday: 3, start: "19:00", end: "20:15", venue: "Campo 2" },
      { weekday: 5, start: "19:00", end: "20:00", venue: "Campo 2" },
    ],
    desde: "2026-09-11", balneario: "Balneário 1",
  },
  {
    id: "t-sub15", name: "Sub-15", maxAge: 15, feeCents: 3500, matchMinutes: 70, maxCallUps: 18, competicao: COMPETICOES.sub15,
    treinos: [
      { weekday: 2, start: "19:15", end: "20:45", venue: "Campo 1" },
      { weekday: 4, start: "19:15", end: "20:45", venue: "Campo 1" },
      { weekday: 5, start: "18:00", end: "19:15", venue: "Campo 1" },
    ],
    desde: "2026-09-08", balneario: "Balneário 3",
  },
  {
    id: "t-seniores", name: "Seniores", maxAge: 99, feeCents: null, matchMinutes: 90, maxCallUps: 20, competicao: COMPETICOES.sen,
    treinos: [
      { weekday: 2, start: "20:45", end: "22:15", venue: "Campo 1" },
      { weekday: 4, start: "20:45", end: "22:15", venue: "Campo 1" },
      { weekday: 5, start: "20:30", end: "21:45", venue: "Campo 1" },
    ],
    desde: "2026-09-01", balneario: "Balneário 4",
  },
];

/* ---- Atletas -------------------------------------------------------------- */

const GR = "Guarda-redes", DC = "Defesa central", LD = "Lateral direito", LE = "Lateral esquerdo";
const MD = "Médio defensivo", MC = "Médio centro", MO = "Médio ofensivo", ED = "Extremo direito", EE = "Extremo esquerdo", AV = "Avançado";

/** O plantel do guião: número, nome, posição, nascimento, pé, altura, peso. */
const SUB13 = [
  [1, "Afonso Lima", GR, "2014-02-03", "Direito", 158, 46],
  [2, "Bernardo Costa", LD, "2014-06-21", "Direito", 149, 39],
  [3, "Daniel Pinto", DC, "2014-01-17", "Direito", 156, 45],
  [4, "Diogo Reis", DC, "2014-09-02", "Esquerdo", 154, 44],
  [5, "Duarte Matos", LE, "2014-11-12", "Esquerdo", 147, 38],
  [6, "Francisco Sá", MD, "2014-04-08", "Direito", 152, 42],
  [7, "Gabriel Nunes", ED, "2014-07-30", "Direito", 148, 39],
  [8, "Tomás Ferreira", MC, "2014-03-14", "Direito", 151, 41],
  [9, "Henrique Melo", AV, "2014-05-25", "Direito", 155, 44],
  [10, "João Brito", MO, "2014-10-06", "Esquerdo", 150, 40],
  [11, "Lourenço Faria", EE, "2014-08-19", "Esquerdo", 146, 37],
  [12, "Martim Rocha", GR, "2015-01-28", "Direito", 153, 43],
  [13, "Rodrigo Leal", DC, "2014-12-04", "Direito", 153, 43],
  [14, "Salvador Cruz", MC, "2014-03-29", "Direito", 149, 40],
  [15, "Vicente Maia", ED, "2015-02-11", "Direito", 145, 36],
  [16, "Gonçalo Vaz", AV, "2014-06-05", "Ambidestro", 152, 42],
];

const NOMES = {
  "t-sub11": [
    "Simão Alves", "Tiago Borges", "Rafael Cunha", "Miguel Dias", "Leonardo Esteves", "Pedro Fontes", "Santiago Gomes",
    "Guilherme Henriques", "Mateus Jorge", "Lucas Lemos", "Dinis Macedo", "Eduardo Neves", "Filipe Oliveira", "Xavier Paiva",
  ],
  "t-sub15": [
    "André Queirós", "Bruno Ramos", "Carlos Sousa", "David Teles", "Emanuel Urbano", "Fábio Veiga", "Gustavo Xavier",
    "Hugo Abreu", "Ivo Bastos", "Jorge Cardoso", "Kevin Duarte", "Luís Espinho", "Manuel Freitas", "Nelson Guerra",
    "Óscar Honorato", "Paulo Inácio", "Renato Lobo", "Samuel Mota",
  ],
  "t-seniores": [
    "Alexandre Nogueira", "Bernardo Osório", "César Pacheco", "Domingos Quintas", "Edgar Rebelo", "Fernando Salgado",
    "Gil Tomé", "Hélder Ventura", "Igor Azevedo", "Joel Barbosa", "Leandro Campos", "Márcio Delgado", "Nuno Estrela",
    "Orlando Figueira", "Pedro Galvão", "Ricardo Horta", "Sandro Leite", "Telmo Monteiro", "Valter Novais", "Zé Pedro Outeiro",
  ],
};
const POSICOES_11 = [GR, DC, DC, LD, LE, MD, MC, MC, MO, ED, EE, AV, GR, DC, MC, ED, AV, LD, MD, EE];

const MAES = ["Carla", "Sofia", "Ana", "Marta", "Rita", "Joana", "Patrícia", "Sandra", "Cláudia", "Susana", "Vera", "Teresa", "Sílvia", "Catarina", "Mónica", "Paula", "Raquel", "Liliana", "Daniela", "Isabel"];
const PAIS = ["Rui", "Nuno", "Pedro", "Jorge", "Hugo", "Ricardo", "Carlos", "Vítor", "Luís", "Marco", "Sérgio", "Paulo", "António", "Bruno", "Fernando", "Joaquim", "Manuel", "Alberto", "Filipe", "Hélder"];

function atletas() {
  const lista = [];
  const r = sorte("atletas");
  let contador = 0;

  const juntar = (teamId, numero, nome, posicao, nascimento, pe, altura, peso) => {
    const id = `a-${chave(nome)}`;
    const apelido = nome.split(" ").slice(-1)[0];
    const i = contador++;
    const senior = teamId === "t-seniores";
    const encarregados = [];
    if (!senior) {
      const mae = nome === "Tomás Ferreira" ? "Carla" : MAES[(i * 7 + 3) % MAES.length];
      encarregados.push({
        membershipId: `g-${chave(mae + " " + apelido)}`,
        name: `${mae} ${apelido}`,
        email: `${chave(mae)}.${chave(apelido)}@exemplo.pt`,
        phone: `91${String(2000000 + Math.floor(r() * 7999999)).slice(0, 7)}`,
        relation: "Mãe",
        isActive: true,
        // Seis famílias ainda sem a app: é o que a Visão geral aponta.
        appInstalled: !(i % 11 === 5 && nome !== "Tomás Ferreira"),
      });
      if (i % 5 !== 2) {
        const pai = PAIS[(i * 3 + 1) % PAIS.length];
        encarregados.push({
          membershipId: `g-${chave(pai + " " + apelido)}`,
          name: `${pai} ${apelido}`,
          email: `${chave(pai)}.${chave(apelido)}@exemplo.pt`,
          phone: `93${String(2000000 + Math.floor(r() * 7999999)).slice(0, 7)}`,
          relation: "Pai",
          isActive: true,
          appInstalled: i % 3 !== 1,
        });
      }
    }
    lista.push({
      id, name: nome, birthdate: `${nascimento}T00:00:00.000Z`, photoUrl: null, status: "ACTIVE",
      joinedAt: `${i % 4 === 0 ? "2023" : i % 4 === 1 ? "2024" : i % 4 === 2 ? "2025" : "2022"}-09-0${1 + (i % 8)}T00:00:00.000Z`,
      taxId: String(250000000 + Math.floor(r() * 39999999)),
      idDocLabel: null, idDocNumber: null,
      heightCm: altura, weightKg: peso, dominantSide: pe, squadNumber: numero,
      medicalValidUntil: "2027-07-31T00:00:00.000Z",
      teamId, position: posicao,
      equipas: [{ teamId, squadNumber: numero, position: posicao }],
      email: senior ? `${chave(nome).replace(/-/g, ".")}@exemplo.pt` : null,
      app: senior ? "account" : "noemail",
      inviteSentAt: null,
      appInstalled: senior,
      guardians: encarregados,
      availability: "available",
      restriction: null,
      clinical: [],
    });
  };

  for (const [n, nome, pos, nasc, pe, alt, peso] of SUB13) juntar("t-sub13", n, nome, pos, nasc, pe, alt, peso);
  NOMES["t-sub11"].forEach((nome, i) =>
    juntar("t-sub11", i + 1, nome, POSICOES_11[i], `${i % 3 === 0 ? 2017 : 2016}-${String(1 + ((i * 5) % 12)).padStart(2, "0")}-${String(3 + ((i * 7) % 24)).padStart(2, "0")}`, i % 4 === 1 ? "Esquerdo" : "Direito", 134 + (i % 9), 29 + (i % 8)),
  );
  NOMES["t-sub15"].forEach((nome, i) =>
    juntar("t-sub15", i + 1, nome, POSICOES_11[i], `${i % 3 === 0 ? 2013 : 2012}-${String(1 + ((i * 5) % 12)).padStart(2, "0")}-${String(2 + ((i * 7) % 25)).padStart(2, "0")}`, i % 5 === 1 ? "Esquerdo" : "Direito", 158 + (i % 14), 47 + (i % 13)),
  );
  NOMES["t-seniores"].forEach((nome, i) =>
    juntar("t-seniores", i + 1, nome, POSICOES_11[i], `${1994 + ((i * 3) % 13)}-${String(1 + ((i * 5) % 12)).padStart(2, "0")}-${String(2 + ((i * 7) % 25)).padStart(2, "0")}`, i % 5 === 1 ? "Esquerdo" : "Direito", 172 + (i % 16), 68 + (i % 15)),
  );
  return lista;
}

/* -------------------------------------------------------------------------- */
/* A semana, tal como está à hora da cena                                      */
/* -------------------------------------------------------------------------- */

/**
 * O clube à hora `agora`.
 *
 * `opcoes` deixa uma cena desviar um ponto da história sem a reescrever:
 *  - `folhaDeQuarta`: `false` deixa a folha de presenças de quarta por marcar,
 *    mesmo depois de o treino acabar.
 */
export function criarClube(agora, opcoes = {}) {
  const t = agora.getTime();
  const passou = (instante) => new Date(instante).getTime() <= t;

  const A = atletas();
  const porId = Object.fromEntries(A.map((a) => [a.id, a]));
  const daEquipa = (teamId) => A.filter((a) => a.teamId === teamId);
  const id = (nome) => `a-${chave(nome)}`;

  /* ---- Exames médicos: uns a caducar, um caducado, um em falta ------------ */
  porId[id("Rafael Cunha")].medicalValidUntil = "2026-10-06T00:00:00.000Z";
  porId[id("Bruno Ramos")].medicalValidUntil = "2026-10-20T00:00:00.000Z";
  porId[id("Duarte Matos")].medicalValidUntil = "2026-10-28T00:00:00.000Z";
  porId[id("Hugo Abreu")].medicalValidUntil = "2026-11-03T00:00:00.000Z";
  porId[id("Xavier Paiva")].medicalValidUntil = null;

  /* ---- Clínico: o Salvador de baixa desde sexta 2/10 ----------------------- */
  const BAIXA_SALVADOR = {
    id: "cl-salvador-entorse", kind: "injury", status: "done", date: "2026-10-02T00:00:00.000Z", time: null, location: null,
    title: "Entorse do tornozelo direito", detail: "Entorse em inversão no treino de sexta. Gelo, repouso e reavaliação a 14/10.",
    impact: "out", expectedReturn: "2026-10-16T00:00:00.000Z", outDays: 14, clearedOn: null,
    typeId: null, notes: null, confirmationRequired: false, respondBy: "GUARDIAN", reply: null, declineReason: null, respondedAt: null,
  };
  if (passou(em("2026-10-02", "20:30"))) {
    const s = porId[id("Salvador Cruz")];
    s.clinical = [BAIXA_SALVADOR];
    s.availability = "out";
    s.restriction = { id: BAIXA_SALVADOR.id, title: BAIXA_SALVADOR.title, since: BAIXA_SALVADOR.date, expectedReturn: BAIXA_SALVADOR.expectedReturn };
  }
  // Um sub-15 condicionado e um sénior de baixa, para o clínico não ser de um atleta só.
  const sub15Cond = porId[id("Jorge Cardoso")];
  sub15Cond.clinical = [{
    ...BAIXA_SALVADOR, id: "cl-jorge-tendinite", date: "2026-09-28T00:00:00.000Z", title: "Tendinite rotuliana",
    detail: "Treina com carga reduzida, sem saltos nem remates de longe.", impact: "limited", expectedReturn: "2026-10-19T00:00:00.000Z", outDays: null,
  }];
  sub15Cond.availability = "limited";
  sub15Cond.restriction = { id: "cl-jorge-tendinite", title: "Tendinite rotuliana", since: "2026-09-28T00:00:00.000Z", expectedReturn: "2026-10-19T00:00:00.000Z" };

  // Consultas e exames que não afastam ninguém: o dia a dia do departamento clínico.
  const registo = (nome, entrada) => {
    if (entrada.status === "done" && !passou(em(entrada.date, entrada.time ?? "20:00"))) return;
    const a = porId[id(nome)];
    a.clinical = [
      ...(a.clinical ?? []),
      {
        ...BAIXA_SALVADOR, impact: "none", expectedReturn: null, outDays: null, detail: null, location: null, time: null,
        ...entrada, id: `cl-${chave(nome)}-${entrada.date}`, date: `${entrada.date}T00:00:00.000Z`,
      },
    ];
  };
  registo("Gabriel Nunes", { kind: "nutrition", status: "done", date: "2026-10-01", title: "Plano alimentar para os dias de jogo", detail: "Pequeno-almoço reforçado e lanche duas horas antes do jogo.", typeId: "cat-consultationTypes-3" });
  registo("Salvador Cruz", { kind: "physio", status: "done", date: "2026-10-06", title: "Fisioterapia: drenagem e mobilidade", detail: "Edema a reduzir. Já apoia o pé sem dor.", typeId: "cat-consultationTypes-1" });
  registo("Leandro Campos", { kind: "physio", status: "done", date: "2026-10-08", title: "Sobrecarga muscular na coxa esquerda", detail: "Massagem e alongamentos. Treina sem limitações.", typeId: "cat-consultationTypes-1" });
  registo("Rafael Cunha", { kind: "exam", status: "scheduled", date: "2026-10-13", time: "18:00", location: "Gabinete médico", title: "Exame médico-desportivo", typeId: "cat-consultationTypes-2", confirmationRequired: true, reply: "confirmed", respondedAt: "2026-10-09T19:12:00.000Z" });
  registo("Salvador Cruz", { kind: "consultation", status: "scheduled", date: "2026-10-14", time: "17:30", location: "Gabinete médico", title: "Reavaliação do tornozelo", typeId: "cat-consultationTypes-1", confirmationRequired: true, reply: "confirmed", respondedAt: "2026-10-10T08:40:00.000Z" });
  registo("Bruno Ramos", { kind: "exam", status: "scheduled", date: "2026-10-15", time: "18:30", location: "Gabinete médico", title: "Exame médico-desportivo", typeId: "cat-consultationTypes-2", confirmationRequired: true });

  /* ---- Equipas -------------------------------------------------------------- */
  const equipas = EQUIPAS.map((e) => {
    const tecnica = STAFF.filter((s) => s.teams?.includes(e.id));
    const principal = tecnica.find((s) => s.title === "Treinador principal") ?? null;
    return {
      id: e.id, name: e.name, maxAge: e.maxAge, sportId: SPORT.id, season: EPOCA.label,
      schedule: e.treinos, athleteCount: daEquipa(e.id).length,
      coaches: tecnica.map((s) => ({ id: s.id, name: s.name, title: s.title })),
      headCoach: principal ? { id: principal.id, name: principal.name } : null,
      competitions: [e.competicao], feeCents: e.feeCents, matchMinutes: e.matchMinutes, maxCallUps: e.maxCallUps,
    };
  });
  const treinadorDe = (teamId) => equipas.find((e) => e.id === teamId).headCoach;

  /* ---- Staff ---------------------------------------------------------------- */
  const staff = STAFF.map((s) => ({
    id: s.id, name: s.name, email: emailDe(s.name), phone: `96${String(1000000 + (chave(s.name).length * 734561) % 8999999)}`,
    role: s.role, photoUrl: null, title: s.title, department: s.dep, isActive: true, grants: [], revokes: [],
    roleId: `cargo-${chave(s.cargo)}`, roleName: s.cargo, roleDepartment: DEPARTAMENTOS[s.dep], extraRoles: [],
    since: `${s.since}T00:00:00.000Z`, teamIds: s.teams ?? [],
  }));

  /* ---- Treinos -------------------------------------------------------------- */
  const SEM_FOLHA = new Set(["t-sub15|2026-10-09", "t-sub11|2026-10-08"]);
  const sessoes = [];
  for (const e of EQUIPAS) {
    const plantel = daEquipa(e.id);
    const r = sorte(`faltas-${e.id}`);
    for (let dia = e.desde; dia <= "2026-11-29"; dia = maisDias(dia, 1)) {
      const treino = e.treinos.find((x) => x.weekday === diaDaSemana(dia));
      if (!treino) continue;
      const startsAt = iso(dia, treino.start);
      const endsAt = iso(dia, treino.end);
      const quartaSub13 = e.id === "t-sub13" && dia === "2026-10-07";
      let recorded = passou(endsAt) && !SEM_FOLHA.has(`${e.id}|${dia}`);
      if (quartaSub13 && opcoes.folhaDeQuarta === false) recorded = false;

      let absences = [];
      if (recorded) {
        if (e.id === "t-sub13") {
          absences = FALTAS_SUB13[dia] ?? [];
        } else {
          // Uma ou duas faltas na maior parte dos treinos, a rodar pelo plantel.
          const quantas = r() < 0.35 ? 0 : r() < 0.7 ? 1 : 2;
          for (let k = 0; k < quantas; k++) {
            const a = plantel[Math.floor(r() * plantel.length)];
            if (absences.some((x) => x.athleteId === a.id)) continue;
            const tipo = r();
            absences.push({ athleteId: a.id, status: tipo < 0.5 ? "JUSTIFIED" : tipo < 0.8 ? "ABSENT" : "LATE", note: tipo < 0.5 ? "Avisou o treinador" : null });
          }
        }
      }
      const notices =
        quartaSub13 && passou(em("2026-10-07", "17:10"))
          ? [{ athleteId: id("Lourenço Faria"), reason: "Está com febre desde ontem à noite.", noticedAt: iso("2026-10-07", "17:10"), noticedBy: porId[id("Lourenço Faria")].guardians[0].name }]
          : [];
      const treinador = treinadorDe(e.id);
      sessoes.push({
        id: `tr-${e.id.slice(2)}-${dia}`, teamId: e.id, teamName: e.name, startsAt, endsAt, venue: treino.venue,
        dressingRoom: e.balneario, dressingRooms: [e.balneario], status: "SCHEDULED",
        coachId: treinador?.id ?? null, coachName: treinador?.name ?? null, recorded, mine: true, absences, notices,
      });
    }
  }

  /* ---- Mensalidades --------------------------------------------------------- */
  const cobrancas = mensalidades(A, porId, id, passou, t, opcoes);

  /* ---- Jogos ---------------------------------------------------------------- */
  const { jogos, lista: listaDeJogos, detalhe: detalheDoJogo } = criarJogos({ equipas, daEquipa, porId, passou, agora });

  /* ---- Avisos --------------------------------------------------------------- */
  const leitura = (publicado, alcance, lidos) => {
    // A leitura cresce nas primeiras horas: metade na primeira, quase tudo ao fim de quatro.
    const horas = (t - publicado.getTime()) / 3_600_000;
    return Math.round(lidos * Math.min(1, 0.55 + horas * 0.12));
  };
  const avisos = AVISOS.filter((a) => passou(em(a.dia, a.hora))).map((a) => ({
    id: `av-${a.dia}-${chave(a.title).slice(0, 24)}`, title: a.title, body: a.body, audience: a.audience,
    authorId: `st-${chave(a.autor)}`, authorName: a.autor, publishedAt: iso(a.dia, a.hora),
    reach: a.alcance, read: leitura(em(a.dia, a.hora), a.alcance, a.lidos),
  }));

  return {
    agora, atletas: A, porId, id, equipas, staff, sessoes, cobrancas, jogos, listaDeJogos, detalheDoJogo, avisos,
    eventos: EVENTOS.map((e) => ({ ...e })), catalogos: CATALOGOS, notificacoes: [],
    daEquipa, passou,
    bootstrap: {
      academy: {
        id: "ac-cd-academias", slug: "cd-academias", name: "Clube Desportivo Academias", shortName: "CD Academias",
        city: "Vila Nova da Serra", signalColor: "#12936B", logoUrl: EMBLEMA_URL, status: "ACTIVE", trialEndsAt: null,
        createdAt: "2025-07-14T10:00:00.000Z", billingDueDay: 8, billingMonths: [9, 10, 11, 12, 1, 2, 3, 4, 5, 6],
        billingNextFrom: null, billingNextMonths: [], billingNextDueDay: null,
        paymentsEnabled: true, feesOnPayer: false, eupagoConfigured: true,
        membershipHeadline: null, membershipIntro: null, membershipPoints: [],
        memberAnnualStartMonth: 8, memberAnnualStartDay: 1,
      },
      sports: [SPORT],
      season: { id: EPOCA.id, label: EPOCA.label },
      seasons: [EPOCA, EPOCA_ANTERIOR].map((s) => ({ ...s, startsOn: `${s.startsOn}T00:00:00.000Z`, endsOn: `${s.endsOn}T00:00:00.000Z` })),
      me: {
        membershipId: "st-paulo-rebelo", userId: "u-paulo-rebelo", setupOwner: false,
        name: "Paulo Rebelo", email: emailDe("Paulo Rebelo"), role: "DIRECTOR",
        roleId: "cargo-diretor", roleName: "Diretor", extraRoles: [], permissions: [], navKeys: [],
        title: "Diretor", department: "DIRECTION", grants: ["role:write", "role:menu"], revokes: [], scope: {},
      },
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Avisos, eventos e catálogos                                                 */
/* -------------------------------------------------------------------------- */

const AVISOS = [
  {
    dia: "2026-10-09", hora: "17:40", autor: "Miguel Antunes", audience: "Sub-13", alcance: 46, lidos: 41,
    title: "Jogo de sábado em casa",
    body: "Sábado jogamos em casa às 15:00. Concentração às 14:15 no Campo 1.",
  },
  {
    dia: "2026-10-06", hora: "10:20", autor: "Paulo Rebelo", audience: "Pais", alcance: 82, lidos: 71,
    title: "Fotografias de equipa na quinta-feira",
    body: "Na quinta-feira, antes do treino, tiramos as fotografias de equipa da época. Pedimos que os atletas venham com o equipamento principal.",
  },
  {
    dia: "2026-10-01", hora: "09:00", autor: "Marta Silva", audience: "Pais", alcance: 82, lidos: 76,
    title: "Mensalidades de outubro",
    body: "As mensalidades de outubro já estão na app e vencem a dia 8. Podem pagar por MB WAY, Multibanco ou cartão, sem passar pela secretaria.",
  },
  {
    dia: "2026-09-24", hora: "18:05", autor: "Sérgio Almeida", audience: "Geral", alcance: 118, lidos: 97,
    title: "Reunião de início de época",
    body: "A reunião de início de época é no sábado, dia 26, às 10:30, no pavilhão. Apresentamos as equipas técnicas, o calendário e as regras de funcionamento.",
  },
  {
    dia: "2026-09-15", hora: "12:30", autor: "Paulo Rebelo", audience: "Treinadores", alcance: 9, lidos: 9,
    title: "Presenças registadas no próprio dia",
    body: "Lembramos que as presenças se registam na consola no fim de cada treino. As famílias veem o registo no mesmo dia.",
  },
];

const EVENTOS = [
  {
    id: "ev-reuniao-pais", teamId: null, teamName: null, mine: true, kind: "OTHER", title: "Reunião de início de época",
    startsAt: iso("2026-09-26", "10:30"), endsAt: iso("2026-09-26", "12:00"), venue: "Pavilhão", dressingRoom: null, cancelled: false,
    dressingRooms: [], typeLabel: "Reunião de pais", coachId: null, coachName: null,
  },
  {
    id: "ev-fotos", teamId: null, teamName: null, mine: true, kind: "OTHER", title: "Fotografias de equipa",
    startsAt: iso("2026-10-08", "17:15"), endsAt: iso("2026-10-08", "18:00"), venue: "Campo 1", dressingRoom: null, cancelled: false,
    dressingRooms: [], typeLabel: "Sessão fotográfica", coachId: null, coachName: null,
  },
];

const cat = (kind, itens) =>
  itens.map(([label, note, extra], i) => ({
    id: `cat-${kind}-${i + 1}`, kind, label, note: note ?? null, order: i, isSystem: false, archivedAt: null, sportId: null, ...(extra ?? {}),
  }));
const CATALOGOS = [
  ...cat("venues", [["Campo 1", "Relvado sintético, futebol 11"], ["Campo 2", "Relvado sintético, futebol 9"], ["Pavilhão", null], ["Ginásio", null]]),
  ...cat("dressingRooms", [["Balneário 1"], ["Balneário 2"], ["Balneário 3"], ["Balneário 4"], ["Balneário visitantes"]]),
  ...cat("eventTypes", [["Reunião de pais"], ["Sessão fotográfica"], ["Estágio"], ["Torneio"]]),
  ...cat("competitions", Object.values(COMPETICOES).map((c) => [c.label, "Associação de Futebol"])).map((c, i) => ({ ...c, id: Object.values(COMPETICOES)[i].id, sportId: SPORT.id })),
  ...cat("inventoryCategories", [["Equipamento de jogo"], ["Material de treino"], ["Material médico"]]),
  ...cat("financeIncome", [["Mensalidades"], ["Quotas de sócio"], ["Patrocínios"], ["Bar"]]),
  ...cat("financeExpense", [["Arbitragem"], ["Transportes"], ["Instalações"], ["Material"]]),
  ...cat("consultationTypes", [
    ["Fisioterapia", null, { color: "#1c6a86" }], ["Exame médico", null, { color: "#7a5af8" }],
    ["Nutrição", null, { color: "#2f8f5b" }], ["Psicologia", null, { color: "#c2781c" }],
  ]),
];

/** As faltas dos Sub-13, treino a treino. O Tomás faltou uma vez em doze. */
const idDe = (nome) => `a-${chave(nome)}`;
const FALTAS_SUB13 = {
  "2026-09-14": [{ athleteId: idDe("Vicente Maia"), status: "JUSTIFIED", note: "Consulta médica" }],
  "2026-09-18": [{ athleteId: idDe("Gonçalo Vaz"), status: "LATE", note: null }],
  "2026-09-23": [
    { athleteId: idDe("Tomás Ferreira"), status: "JUSTIFIED", note: "Visita de estudo da escola" },
    { athleteId: idDe("Rodrigo Leal"), status: "ABSENT", note: null },
  ],
  "2026-09-28": [{ athleteId: idDe("Bernardo Costa"), status: "JUSTIFIED", note: "Constipado" }],
  "2026-10-02": [{ athleteId: idDe("Martim Rocha"), status: "LATE", note: null }],
  "2026-10-05": [{ athleteId: idDe("Duarte Matos"), status: "ABSENT", note: null }],
  "2026-10-07": [{ athleteId: idDe("Lourenço Faria"), status: "JUSTIFIED", note: "Está com febre desde ontem à noite." }],
  "2026-10-09": [{ athleteId: idDe("Lourenço Faria"), status: "JUSTIFIED", note: "Continua com febre" }],
};

/* -------------------------------------------------------------------------- */
/* Mensalidades                                                                */
/* -------------------------------------------------------------------------- */

const MESES = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"];

function mensalidades(A, porId, id, passou, t, opcoes) {
  const pagantes = A.filter((a) => a.teamId !== "t-seniores");
  const preco = (a) => EQUIPAS.find((e) => e.id === a.teamId).feeCents;
  const r = sorte("mensalidades");
  const linhas = [];

  // Quem nunca chega a pagar, por período. O Carlos Sousa deve os dois meses.
  const NUNCA = {
    "2026-09": new Set([id("Carlos Sousa"), id("Mateus Jorge")]),
    "2026-10": new Set([id("Carlos Sousa"), id("Ivo Bastos")]),
  };
  // Outubro: quem paga já depois de segunda de manhã.
  const TARDE = {
    [id("Tomás Ferreira")]: ["2026-10-05", "09:14", "MBWAY"],
    [id("Pedro Fontes")]: ["2026-10-06", "21:40", "MBWAY"],
    [id("Henrique Melo")]: ["2026-10-07", "13:05", "MULTIBANCO"],
  };
  const METODOS = ["MBWAY", "MBWAY", "MBWAY", "MULTIBANCO", "MBWAY", "CARD", "MBWAY", "MULTIBANCO", "CASH", "MBWAY"];

  for (const periodo of ["2026-09", "2026-10"]) {
    const mes = Number(periodo.slice(5));
    const vencimento = `${periodo}-08`;
    pagantes.forEach((a, i) => {
      let pago = null;
      if (!NUNCA[periodo].has(a.id)) {
        if (periodo === "2026-10" && TARDE[a.id]) {
          const [d, h, m] = TARDE[a.id];
          pago = { quando: em(d, h), metodo: m };
        } else {
          // De 1 a 4 do mês, a horas de quem paga pelo telemóvel.
          const dia = 1 + Math.floor(r() * 4);
          const hora = 7 + Math.floor(r() * 15);
          const minuto = Math.floor(r() * 60);
          pago = {
            quando: em(`${periodo}-0${dia}`, `${String(hora).padStart(2, "0")}:${String(minuto).padStart(2, "0")}`),
            metodo: METODOS[(i + mes) % METODOS.length],
          };
        }
      }
      const liquidada = pago !== null && pago.quando.getTime() <= t;
      const quem = a.guardians[pago && pago.metodo !== "CASH" && a.name !== "Tomás Ferreira" ? i % a.guardians.length : 0];
      const naApp = liquidada && pago.metodo !== "CASH";
      const sufixo = Math.floor(r() * 36 ** 6).toString(36).toUpperCase().padStart(6, "0");
      linhas.push({
        id: `mens-${periodo}-${a.id.slice(2)}`, athleteId: a.id, athleteName: a.name, teamId: a.teamId, period: periodo,
        kind: "FEE", title: null, amountCents: preco(a), dueDate: `${vencimento}T00:00:00.000Z`,
        status: liquidada ? "SETTLED" : "PENDING",
        overdue: !liquidada && em(maisDias(vencimento, 1)).getTime() <= t,
        paidMethod: liquidada ? pago.metodo : null,
        paidAt: liquidada ? pago.quando.toISOString() : null,
        paidBy: naApp ? quem.name : null,
        paidByRelation: naApp ? quem.relation : null,
        // O identificador da euPago existe nos pagamentos pela app. Fica de fora
        // das capturas: com ele a célula "Pagamento" tem quatro linhas e encosta
        // às margens da linha da tabela.
        paymentId: opcoes.comIdentificador && naApp
          ? `CDA-MENS-${MESES[mes - 1]}26-${semAcentos(a.name).toUpperCase().replace(/ /g, "_")}-${semAcentos(quem.name).toUpperCase().replace(/ /g, "_")}-${sufixo}`
          : null,
        paidSurchargeCents: 0,
        changedBy: liquidada && pago.metodo === "CASH" ? "Marta Silva" : null,
        changedAt: liquidada && pago.metodo === "CASH" ? pago.quando.toISOString() : null,
        _pagoEm: pago ? pago.quando.getTime() : Infinity,
      });
    });
  }

  // Por pagar primeiro, depois as pagas da mais recente para a mais antiga:
  // é a ordem em que a secretaria as quer ver, e mantém a linha do Tomás no
  // mesmo sítio antes e depois de pagar.
  linhas.sort((a, b) => b.period.localeCompare(a.period) || b._pagoEm - a._pagoEm);
  return linhas.map(({ _pagoEm, ...resto }) => resto);
}

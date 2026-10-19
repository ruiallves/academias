/**
 * As outras modalidades do CD Academias: futsal e basquetebol.
 *
 * O clube das capturas é de futebol (ver GUIAO.md). Estas modalidades só
 * existem nas cenas que as pedem, com `clube: { multimodalidade: true }`: assim
 * as capturas antigas continuam com o menu lateral que tinham (só Futebol na
 * Área técnica), e as novas mostram o clube com três modalidades.
 *
 * Aqui vivem as modalidades, as duas equipas, o exercício de basquetebol
 * desenhado no campo FIBA e as inscrições federativas (FPF e FPB).
 */

/* -------------------------------------------------------------------------- */
/* Modalidades e equipas                                                       */
/* -------------------------------------------------------------------------- */

export const FUTSAL = {
  id: "sp-futsal",
  name: "Futsal",
  code: "futsal",
  positions: ["Guarda-redes", "Fixo", "Ala", "Pivô", "Universal"],
  skills: ["Técnica", "Tática", "Físico", "Atitude"],
  dominantSideLabel: "Pé dominante",
  matchMinutes: 40,
};

export const BASQUETEBOL = {
  id: "sp-basquetebol",
  name: "Basquetebol",
  code: "basketball",
  positions: ["Base", "Extremo", "Ala", "Ala-poste", "Poste"],
  skills: ["Técnica individual", "Lançamento", "Leitura de jogo", "Defesa", "Físico", "Atitude"],
  dominantSideLabel: "Mão dominante",
  matchMinutes: 40,
};

/**
 * Um clube com modalidades de toda a espécie, para o ecrã das Definições →
 * Modalidades (cena `con-modalidades`, com `clube: { modalidades: "variadas" }`).
 *
 * A plataforma não traz uma lista fechada de desportos: o clube cria os seus.
 * O futebol fica em primeiro, com a federação e a área técnica; os outros são
 * criados pelo clube, cada um com as suas posições (ou nenhumas, como na
 * natação, que é configuração e não um caso especial).
 */
export const MODALIDADES_VARIADAS = [
  {
    id: "sp-andebol", name: "Andebol", code: null,
    positions: ["Guarda-redes", "Central", "Lateral", "Ponta", "Pivô"],
    skills: ["Técnica", "Tática", "Físico", "Atitude"], dominantSideLabel: "Mão dominante", matchMinutes: 60,
  },
  {
    id: "sp-tenis", name: "Ténis", code: null,
    positions: ["Singulares", "Pares"],
    skills: ["Serviço", "Direita", "Esquerda", "Rede", "Físico"], dominantSideLabel: "Mão dominante", matchMinutes: null,
  },
  {
    id: "sp-natacao", name: "Natação", code: null,
    positions: [],
    skills: ["Técnica", "Viragens", "Resistência", "Velocidade"], dominantSideLabel: "Respiração", matchMinutes: null,
  },
  {
    id: "sp-voleibol", name: "Voleibol", code: null,
    positions: ["Distribuidor", "Oposto", "Central", "Recetor", "Líbero"],
    skills: ["Serviço", "Receção", "Ataque", "Bloco", "Atitude"], dominantSideLabel: "Mão dominante", matchMinutes: null,
  },
  {
    id: "sp-ginastica", name: "Ginástica", code: null,
    positions: ["Artística", "Rítmica", "Trampolins"],
    skills: ["Flexibilidade", "Força", "Coordenação", "Execução"], dominantSideLabel: "Lado dominante", matchMinutes: null,
  },
];

/** As equipas das duas modalidades, na forma de `/api/teams`. */
export const EQUIPAS_EXTRA = [
  {
    id: "t-basket-sub14", name: "Sub-14 Basquetebol", maxAge: 14, sportId: BASQUETEBOL.id, season: "2026/27",
    schedule: [
      { weekday: 2, start: "18:30", end: "20:00", venue: "Pavilhão" },
      { weekday: 4, start: "18:30", end: "20:00", venue: "Pavilhão" },
    ],
    athleteCount: 12,
    coaches: [{ id: "st-joana-ribeiro", name: "Joana Ribeiro", title: "Treinadora principal" }],
    headCoach: { id: "st-joana-ribeiro", name: "Joana Ribeiro" },
    competitions: [{ id: "cp-basket-sub14", label: "Campeonato Regional Sub-14" }], feeCents: 3000, matchMinutes: 40, maxCallUps: 12,
  },
  {
    id: "t-futsal-sen", name: "Futsal Seniores", maxAge: 99, sportId: FUTSAL.id, season: "2026/27",
    schedule: [
      { weekday: 1, start: "21:00", end: "22:30", venue: "Pavilhão" },
      { weekday: 3, start: "21:00", end: "22:30", venue: "Pavilhão" },
    ],
    athleteCount: 14,
    coaches: [{ id: "st-hugo-matias", name: "Hugo Matias", title: "Treinador principal" }],
    headCoach: { id: "st-hugo-matias", name: "Hugo Matias" },
    competitions: [{ id: "cp-futsal-sen", label: "Distrital de Futsal" }], feeCents: null, matchMinutes: 40, maxCallUps: 14,
  },
];

/* -------------------------------------------------------------------------- */
/* O exercício de basquetebol                                                  */
/* -------------------------------------------------------------------------- */

const BRANCO = "#f4f1ea";

const at = (id, x, y, label) => ({ id, kind: "player", x, y, label });
const def = (id, x, y, label) => ({ id, kind: "player", x, y, label, color: BRANCO });
const bola = (x, y) => ({ id: "bola", kind: "ball", x, y });
const seta = (id, kind, x1, y1, x2, y2) => ({ id, kind, x1, y1, x2, y2 });

/**
 * Pick & roll central, em meio campo FIBA (28×15, coordenadas em metros).
 *
 * A equipa ataca o cesto da direita (x = 26,4). O base sobe com a bola, o poste
 * sai do garrafão e bloqueia, o base ataca o lado do bloqueio e o poste rola.
 * A ajuda sai do canto do lado contrário para fechar o rolamento, e a bola vai
 * para esse canto, que ficou livre.
 */
const PICK_AND_ROLL = {
  field: "basket-half",
  frames: [
    {
      id: "b1", durationMs: 1500, note: "O base sobe com a bola. O poste sai do garrafão para bloquear o defensor do base.",
      items: [
        bola(16.9, 8.6),
        at("p1", 17.4, 8.2, "1"), at("p2", 21.4, 1.8, "2"), at("p3", 21.2, 13.2, "3"), at("p4", 26.8, 14.3, "4"), at("p5", 24.6, 9.4, "5"),
        def("d1", 18.6, 8.2, "1"), def("d2", 22.2, 2.7, "2"), def("d3", 22.0, 12.3, "3"), def("d4", 26.0, 13.2, "4"), def("d5", 25.3, 8.6, "5"),
      ],
      arrows: [seta("s1", "run", 24.1, 9.0, 19.4, 7.2)],
    },
    {
      id: "b2", durationMs: 1500, note: "Bloqueio direto ao meio. O base ataca o lado do bloqueio e o poste rola para o cesto.",
      items: [
        bola(17.1, 7.6),
        at("p1", 17.6, 8.0, "1"), at("p2", 21.4, 1.8, "2"), at("p3", 21.2, 13.2, "3"), at("p4", 26.8, 14.3, "4"), at("p5", 18.9, 6.9, "5"),
        def("d1", 18.6, 8.2, "1"), def("d2", 22.4, 2.9, "2"), def("d3", 22.0, 12.1, "3"), def("d4", 26.0, 13.0, "4"), def("d5", 20.2, 6.2, "5"),
      ],
      arrows: [seta("s1", "dribble", 17.5, 7.3, 20.4, 4.0), seta("s2", "run", 19.5, 7.2, 24.4, 8.0)],
    },
    {
      id: "b3", durationMs: 1700, note: "A ajuda sai do canto para fechar o rolamento. Passe para o canto que ficou livre e lançamento de três.",
      items: [
        bola(21.2, 4.4),
        at("p1", 20.8, 4.0, "1"), at("p2", 21.8, 1.3, "2"), at("p3", 21.0, 13.0, "3"), at("p4", 26.8, 14.3, "4"), at("p5", 24.4, 8.2, "5"),
        def("d1", 19.8, 4.8, "1"), def("d2", 22.6, 2.2, "2"), def("d3", 21.9, 11.5, "3"), def("d4", 25.3, 9.9, "4"), def("d5", 21.8, 5.0, "5"),
      ],
      arrows: [seta("s1", "pass", 21.5, 4.9, 26.4, 13.8), seta("s2", "shot", 26.9, 13.8, 26.5, 8.2)],
    },
  ],
};

export const EX_PICK_AND_ROLL = "ex-pick-and-roll-central";

const exercicio = (e) => ({
  phase: null, visibility: "CLUB", videoUrl: null, mine: false,
  rules: null, progressions: null, regressions: null, coachingPoints: null, commonErrors: null,
  images: [], editable: true, deletable: true, usedIn: { gameModels: [], setPieces: [] },
  ...e,
});

export const EXERCICIOS_BASQUETEBOL = [
  exercicio({
    id: EX_PICK_AND_ROLL, sportId: BASQUETEBOL.id, name: "Pick & roll central com leitura da ajuda",
    description: "5x5 em meio campo a partir do bloqueio direto ao meio. O ataque lê a ajuda do lado contrário e decide entre o rolamento e o passe para o canto.",
    category: "Ataque", objectives: ["Pick & roll", "Leitura de vantagem"], type: "5x5 condicionado",
    intensity: 6, players: "5x5", durationMin: 18, space: "Meio campo", material: "2 bolas, 5 coletes brancos",
    ageMin: 12, ageMax: 16, complexity: 3, authorName: "Joana Ribeiro", diagram: PICK_AND_ROLL,
    updatedAt: "2026-10-05T21:10:00.000Z",
    rules: "O ataque começa sempre no bloqueio ao meio. Cesto depois de passe para o canto vale três pontos, mesmo que seja de dois.",
    progressions: "A defesa escolhe entre trocar e ajudar e recuperar. Limitar a dois dribles depois do bloqueio.",
    regressions: "Tirar o defensor do canto: 5x4, a ajuda vem sempre do mesmo lado.",
    coachingPoints: "O base ataca o ombro do bloqueador. O poste rola de frente para a bola, com as mãos à vista. O canto não se mexe enquanto a ajuda não sai.",
    commonErrors: "Bloqueio sem ângulo, de frente para o cesto. Passe para o canto antes de a ajuda sair.",
  }),
  exercicio({
    id: "ex-lancamento-5-posicoes", sportId: BASQUETEBOL.id, name: "Lançamento em cinco posições",
    description: "Lançamento de média distância a partir dos cantos, das alas e do topo, com receção em movimento.",
    category: "Técnica individual", objectives: ["Lançamento", "Jogo de pés"], type: "Drill de lançamento",
    intensity: 4, players: "3 por cesto", durationMin: 12, space: "Meio campo", material: "3 bolas por cesto",
    ageMin: 10, ageMax: 18, complexity: 1, authorName: "Joana Ribeiro",
    diagram: {
      field: "basket-half",
      frames: [{
        id: "l1",
        items: [at("p1", 26.8, 0.6, "1"), at("p2", 21.6, 2.2, "2"), at("p3", 19.4, 7.5, "3"), at("p4", 21.6, 12.8, "4"), at("p5", 26.8, 14.4, "5"), bola(19.8, 7.9)],
        arrows: [seta("s1", "shot", 19.9, 7.5, 26.1, 7.5)],
      }],
    },
    updatedAt: "2026-09-22T19:00:00.000Z",
  }),
];

/** A ficha resumida da biblioteca, como em `tecnica.mjs`. */
export const resumoDoExercicio = (e) => {
  const { rules, progressions, regressions, coachingPoints, commonErrors, diagram, images, editable, deletable, usedIn, ...r } = e;
  return {
    ...r, thumbnail: { field: diagram.field, frames: [diagram.frames[0]] }, frames: diagram.frames.length, cover: null, imageCount: 0,
    favorite: e.id === EX_PICK_AND_ROLL, usageCount: e.id === EX_PICK_AND_ROLL ? 4 : 7, lastUsedAt: "2026-10-08T17:30:00.000Z",
  };
};

/* -------------------------------------------------------------------------- */
/* Inscrições federativas                                                      */
/* -------------------------------------------------------------------------- */

const FUTEBOL_ID = "sp-futebol";

/** A chave de um nome, como em `clube.mjs`. */
const chave = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const FPF_CAT = { "09": "Júnior D", "07": "Júnior C", "01": "Sénior" };
const FPB_CAT = { SUB14: "Sub 14" };

/**
 * Uma linha: [nome, nascimento, modalidade, equipa, categoria, tipo, estado,
 * licença, em falta, dias de cada passo (gerada, assinada, entregue, validada)].
 */
const LINHAS = [
  ["Tomás Ferreira", "2014-03-14", FUTEBOL_ID, ["t-sub13", "Sub-13"], "09", "RENEWAL", "DONE", "2213457", [], ["09-08", "09-10", "09-12", "09-19"]],
  ["Afonso Lima", "2014-02-03", FUTEBOL_ID, ["t-sub13", "Sub-13"], "09", "RENEWAL", "DONE", "2209874", [], ["09-08", "09-11", "09-12", "09-19"]],
  ["Bernardo Costa", "2014-06-21", FUTEBOL_ID, ["t-sub13", "Sub-13"], "09", "RENEWAL", "SUBMITTED", "2211320", [], ["09-08", "09-15", "10-02"]],
  ["Daniel Pinto", "2014-01-17", FUTEBOL_ID, ["t-sub13", "Sub-13"], "09", "RENEWAL", "SUBMITTED", "2210088", [], ["09-08", "09-16", "10-02"]],
  ["Diogo Reis", "2014-09-02", FUTEBOL_ID, ["t-sub13", "Sub-13"], "09", "RENEWAL", "SIGNED", "2215541", [], ["09-29", "10-06"]],
  ["Francisco Sá", "2014-04-08", FUTEBOL_ID, ["t-sub13", "Sub-13"], "09", "RENEWAL", "GENERATED", "2212967", [], ["10-08"]],
  ["Gonçalo Vaz", "2014-06-05", FUTEBOL_ID, ["t-sub13", "Sub-13"], "09", "RENEWAL", "SIGNED", "2214402", [], ["09-29", "10-07"]],
  ["Vicente Maia", "2015-02-11", FUTEBOL_ID, ["t-sub13", "Sub-13"], "09", "FIRST", null, null, ["dígito de controlo do CC"], []],
  ["André Queirós", "2013-01-03", FUTEBOL_ID, ["t-sub15", "Sub-15"], "07", "RENEWAL", "DONE", "2101876", [], ["09-03", "09-05", "09-08", "09-16"]],
  ["Ivo Bastos", "2012-10-09", FUTEBOL_ID, ["t-sub15", "Sub-15"], "07", "TRANSFER_NATIONAL", "GENERATED", "1987345", [], ["10-09"]],
  ["Kevin Duarte", "2012-08-11", FUTEBOL_ID, ["t-sub15", "Sub-15"], "07", "FIRST", null, null, ["país de nascimento", "nacionalidade"], []],
  ["Gonçalo Vaz", "2014-06-05", BASQUETEBOL.id, ["t-basket-sub14", "Sub-14 Basquetebol"], "SUB14", "FIRST", "GENERATED", null, [], ["10-08"]],
  ["Duarte Sequeira", "2013-05-12", BASQUETEBOL.id, ["t-basket-sub14", "Sub-14 Basquetebol"], "SUB14", "RENEWAL", "DONE", "318842", [], ["09-15", "09-17", "09-22", "09-30"]],
  ["Martim Bettencourt", "2013-11-02", BASQUETEBOL.id, ["t-basket-sub14", "Sub-14 Basquetebol"], "SUB14", "RENEWAL", "SUBMITTED", "321507", [], ["09-15", "09-24", "10-06"]],
  ["Tiago Moreira", "2014-02-19", BASQUETEBOL.id, ["t-basket-sub14", "Sub-14 Basquetebol"], "SUB14", "FIRST", null, null, ["validade do documento", "morada", "código postal"], []],
  ["Nélson Brandão", "1998-04-11", FUTSAL.id, ["t-futsal-sen", "Futsal Seniores"], "01", "RENEWAL", "DONE", "1764023", [], ["09-01", "09-02", "09-04", "09-11"]],
];

/** A resposta de `GET /api/inscricoes`, na forma de `Lista` (`apps/console/src/lib/inscricoes.ts`). */
export function inscricoes() {
  const quando = (d, h) => (d ? `2026-${d}T${h}:00.000Z` : null);
  const rows = LINHAS.map(([name, nasc, sportId, [teamId, teamName], category, kind, status, license, missing, dias]) => {
    const fpb = sportId === BASQUETEBOL.id;
    const athleteId = `a-${chave(name)}`;
    return {
      athleteId, name, birthdate: `${nasc}T00:00:00.000Z`, sportId, federation: fpb ? "FPB" : "FPF",
      teams: [{ id: teamId, name: teamName }],
      category, categoryLabel: fpb ? FPB_CAT[category] : FPF_CAT[category],
      kind, license, missing,
      registration: status && {
        id: `ins-${athleteId.slice(2)}-${sportId.slice(3)}`, status, kind, category,
        generatedAt: quando(dias[0], "10:15"), generatedByName: "Marta Silva",
        signedAt: quando(dias[1], "19:40"), submittedAt: quando(dias[2], "11:30"), doneAt: quando(dias[3], "16:05"),
        documentId: dias[1] ? `doc-ins-${athleteId.slice(2)}` : null,
      },
    };
  });
  rows.sort((a, b) => a.name.localeCompare(b.name, "pt") || a.sportId.localeCompare(b.sportId));
  return {
    available: true,
    canWrite: true,
    seasons: [{ id: "ep-2026-27", label: "2026/27" }, { id: "ep-2025-26", label: "2025/26" }],
    season: { id: "ep-2026-27", label: "2026/27" },
    club: { association: "Associação de Futebol da Serra", missing: [] },
    sports: [
      { id: FUTEBOL_ID, name: "Futebol", discipline: "football", federation: "FPF", missing: [] },
      { id: FUTSAL.id, name: "Futsal", discipline: "futsal", federation: "FPF", missing: [] },
      { id: BASQUETEBOL.id, name: "Basquetebol", discipline: "basketball", federation: "FPB", missing: [] },
    ],
    rows,
  };
}

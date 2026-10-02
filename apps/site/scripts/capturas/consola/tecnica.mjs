/**
 * A área técnica do CD Academias: exercícios, planos de sessão e periodização.
 *
 * O exercício "Saída a três e finalização" é desenhado à mão, em futebol 9
 * (72×50 m), com quatro frames. O plano de quarta 7/10 tem os blocos do guião.
 * Os planos dos outros treinos são gerados pelo dia da semana, para a carga do
 * microciclo ter desenho.
 */
import { SPORT } from "./clube.mjs";

/* -------------------------------------------------------------------------- */
/* Desenhos                                                                    */
/* -------------------------------------------------------------------------- */

const BRANCO = "#f4f1ea";
const PRETO = "#26231f";

const j = (id, x, y, label) => ({ id, kind: "player", x, y, label });
const adv = (id, x, y, label) => ({ id, kind: "player", x, y, label, color: BRANCO });
const gr = (id, x, y, color) => ({ id, kind: "gk", x, y, label: "GR", ...(color ? { color } : {}) });
const bola = (x, y) => ({ id: "bola", kind: "ball", x, y });
const seta = (id, kind, x1, y1, x2, y2) => ({ id, kind, x1, y1, x2, y2 });
const zona = (id, x, y, w, h, label) => ({ id, kind: "zone", x, y, w, h, label });

/**
 * Saída a três e finalização, em campo de futebol 9.
 *
 * A equipa ataca da esquerda para a direita. O guarda-redes sai curto para o
 * central, os dois defesas abrem, a bola entra no corredor direito, progride
 * por dentro e acaba num cruzamento para finalizar.
 */
export const SAIDA_A_TRES = {
  field: "f9",
  frames: [
    {
      id: "f1", durationMs: 1400, note: "O guarda-redes sai curto. Os defesas laterais abrem e dão largura.",
      items: [
        zona("z1", 14, 25, 26, 46, "Zona de saída"),
        gr("gr", 4.5, 25), bola(6.4, 26.1),
        j("p3", 14, 25, "3"), j("p2", 12, 17, "2"), j("p4", 12, 33, "4"),
        j("p6", 27, 25, "6"), j("p8", 37, 31, "8"),
        j("p7", 46, 8, "7"), j("p11", 46, 42, "11"), j("p9", 54, 25, "9"),
        adv("a1", 25, 19, "10"), adv("a2", 24, 31, "17"),
        adv("a3", 57, 19, "5"), adv("a4", 57, 31, "15"),
        gr("gra", 68, 25, PRETO),
      ],
      arrows: [
        seta("s1", "pass", 6.8, 25.6, 12.4, 25.1),
        seta("s2", "run", 12.4, 15.6, 16.6, 8.6),
        seta("s3", "run", 12.4, 34.4, 16.6, 41.4),
        seta("s4", "press", 24, 19.6, 17.2, 23.6),
      ],
    },
    {
      id: "f2", durationMs: 1400, note: "Com a pressão a fechar por dentro, a bola sai pelo corredor direito.",
      items: [
        zona("z1", 14, 25, 26, 46, "Zona de saída"),
        gr("gr", 6, 25), bola(15.6, 26.4),
        j("p3", 14, 25, "3"), j("p2", 17, 8, "2"), j("p4", 17, 42, "4"),
        j("p6", 25, 28, "6"), j("p8", 37, 31, "8"),
        j("p7", 46, 8, "7"), j("p11", 46, 42, "11"), j("p9", 54, 25, "9"),
        adv("a1", 18.5, 22.6, "10"), adv("a2", 22, 31, "17"),
        adv("a3", 57, 19, "5"), adv("a4", 57, 31, "15"),
        gr("gra", 68, 25, PRETO),
      ],
      arrows: [
        seta("s1", "pass", 14.6, 23.4, 16.6, 10),
        seta("s2", "run", 36.4, 29.6, 32.6, 20.6),
        seta("s3", "run", 47.4, 7.6, 53, 6.6),
        seta("s4", "press", 21, 30, 19, 14),
      ],
    },
    {
      id: "f3", durationMs: 1400, note: "O médio aparece entre linhas e lança o extremo nas costas da defesa.",
      items: [
        zona("z1", 14, 25, 26, 46, "Zona de saída"),
        gr("gr", 7, 25), bola(18.8, 9.2),
        j("p3", 17, 24, "3"), j("p2", 17, 8, "2"), j("p4", 19, 40, "4"),
        j("p6", 27, 24, "6"), j("p8", 33, 20, "8"),
        j("p7", 53, 6.5, "7"), j("p11", 48, 41, "11"), j("p9", 55, 25, "9"),
        adv("a1", 20, 21, "10"), adv("a2", 20, 14.5, "17"),
        adv("a3", 57, 18, "5"), adv("a4", 57, 30, "15"),
        gr("gra", 68, 25, PRETO),
      ],
      arrows: [
        seta("s1", "pass", 18.6, 9.2, 31.6, 19),
        seta("s2", "pass", 34.4, 19, 59.4, 8),
        seta("s3", "run", 54.4, 6.6, 60.4, 7.6),
        seta("s4", "run", 56.2, 24.4, 61.6, 21.6),
        seta("s5", "run", 49, 40, 58.6, 34.6),
      ],
    },
    {
      id: "f4", durationMs: 1600, note: "Cruzamento atrasado e finalização de primeira. O extremo do lado contrário fecha o segundo poste.",
      items: [
        zona("z1", 14, 25, 26, 46, "Zona de saída"),
        gr("gr", 9, 25), bola(62.4, 9.4),
        j("p3", 26, 25, "3"), j("p2", 30, 10, "2"), j("p4", 28, 39, "4"),
        j("p6", 40, 25, "6"), j("p8", 50, 21, "8"),
        j("p7", 61, 8, "7"), j("p11", 60, 34, "11"), j("p9", 62, 21.5, "9"),
        adv("a1", 34, 22, "10"), adv("a2", 36, 14, "17"),
        adv("a3", 57.6, 16.4, "5"), adv("a4", 60, 28.6, "15"),
        gr("gra", 68.4, 26.4, PRETO),
      ],
      arrows: [
        seta("s1", "cross", 61.6, 9.6, 62.2, 19.8),
        seta("s2", "shot", 63.4, 21.6, 71.6, 22.9),
        seta("s3", "run", 50.6, 21.4, 55.6, 24.4),
      ],
    },
  ],
};

/** Desenhos simples para os outros exercícios da biblioteca. */
const RONDO = {
  field: "f9-half",
  frames: [{
    id: "r1",
    items: [
      zona("z", 54, 25, 12, 12, "10×10"),
      j("p1", 48, 19, "1"), j("p2", 60, 19, "2"), j("p3", 60, 31, "3"), j("p4", 48, 31, "4"),
      adv("a1", 53, 24, "1"), adv("a2", 56, 27, "2"), bola(49.4, 20.2),
    ],
    arrows: [seta("s1", "pass", 49, 19, 59, 19), seta("s2", "press", 53.4, 23.4, 50, 20.4)],
  }],
};
const REDUZIDO = {
  field: "f9-half",
  frames: [{
    id: "g1",
    items: [
      zona("z", 54, 25, 30, 36, "40×30"),
      gr("g1", 40, 25), gr("g2", 68, 25, PRETO),
      j("p1", 46, 14, "2"), j("p2", 46, 36, "3"), j("p3", 52, 25, "6"), j("p4", 58, 14, "7"), j("p5", 58, 36, "9"),
      adv("a1", 50, 19, "2"), adv("a2", 50, 31, "3"), adv("a3", 56, 25, "6"), adv("a4", 62, 18, "7"), adv("a5", 62, 32, "9"),
      bola(53.2, 26.2),
    ],
    arrows: [seta("s1", "pass", 52.6, 24.4, 57.4, 14.8), seta("s2", "run", 58.6, 35.4, 63.6, 28.4)],
  }],
};
const FINALIZACAO = {
  field: "f9-half",
  frames: [{
    id: "x1",
    items: [
      gr("g", 69, 25, PRETO),
      j("p1", 44, 12, "7"), j("p2", 44, 38, "11"), j("p3", 50, 25, "9"), j("p4", 42, 25, "8"),
      { id: "c1", kind: "cone", x: 54, y: 16 }, { id: "c2", kind: "cone", x: 54, y: 34 },
      bola(43.2, 26.2),
    ],
    arrows: [seta("s1", "pass", 42.6, 24.4, 44, 13.4), seta("s2", "dribble", 44.8, 12, 58, 12), seta("s3", "cross", 58, 12.4, 62, 23), seta("s4", "run", 50.6, 25, 61, 24.6)],
  }],
};

const primeiro = (d) => ({ field: d.field, frames: [d.frames[0]] });

/* -------------------------------------------------------------------------- */
/* Exercícios                                                                  */
/* -------------------------------------------------------------------------- */

export const EX_SAIDA = "ex-saida-a-tres";

const EXERCICIOS = [
  {
    id: EX_SAIDA, name: "Saída a três e finalização",
    description: "Construção desde o guarda-redes com três defesas, contra dois que pressionam. A bola sai por um corredor, progride por dentro e acaba em cruzamento e finalização.",
    category: "Organização ofensiva", objectives: ["Construção", "Progressão", "Finalização"], type: "Jogo condicionado",
    intensity: 7, players: "8+GR × 4+GR", durationMin: 20, space: "Campo de futebol 9", material: "8 bolas, 5 coletes brancos, 4 cones",
    ageMin: 11, ageMax: 14, complexity: 3, autor: "Miguel Antunes", diagram: SAIDA_A_TRES, usageCount: 6, favorite: true,
    lastUsedAt: "2026-10-07T18:00:00.000Z", updatedAt: "2026-10-06T17:28:00.000Z",
    rules: "Começa sempre no guarda-redes. Os dois avançados de branco só pressionam depois do primeiro passe. Ganha um ponto quem finalizar em menos de 15 segundos depois de passar o meio-campo.",
    progressions: "Juntar um terceiro jogador à pressão. Limitar a dois toques na zona de saída.",
    regressions: "Tirar um dos jogadores que pressionam. Deixar o guarda-redes sair com a bola na mão.",
    coachingPoints: "Corpo orientado para receber de frente para o jogo. Os defesas laterais abrem antes de o guarda-redes ter a bola. O médio só baixa se a linha de passe estiver tapada.",
    commonErrors: "Passe para o defesa de costas para o jogo. Extremos colados ao lateral em vez de darem profundidade.",
  },
  {
    id: "ex-rondo-4v2", name: "Rondo 4×2 com transição",
    description: "Posse em quadrado de 10 metros. Quem recupera sai a conduzir para fora do quadrado.",
    category: "Técnico", objectives: ["Passe", "Receção"], type: "Rondo", intensity: 4, players: "4×2", durationMin: 15,
    space: "10×10 m", material: "4 cones, 2 coletes, 3 bolas", ageMin: 9, ageMax: 15, complexity: 1, autor: "Miguel Antunes",
    diagram: RONDO, usageCount: 14, favorite: true, lastUsedAt: "2026-10-07T18:00:00.000Z", updatedAt: "2026-09-10T18:00:00.000Z",
  },
  {
    id: "ex-jogo-reduzido-6v6", name: "Jogo reduzido 6×6",
    description: "Jogo em campo de 40×30 com balizas de futebol 7. Golo depois de saída a três vale a dobrar.",
    category: "Transições", objectives: ["Transição ofensiva", "Reação à perda"], type: "Jogo reduzido", intensity: 8, players: "5+GR × 5+GR",
    durationMin: 25, space: "40×30 m", material: "2 balizas, 6 coletes, 6 bolas", ageMin: 11, ageMax: 17, complexity: 2, autor: "Rui Tavares",
    diagram: REDUZIDO, usageCount: 9, favorite: false, lastUsedAt: "2026-10-07T18:00:00.000Z", updatedAt: "2026-09-22T19:40:00.000Z",
  },
  {
    id: "ex-finalizacao-cruzamento", name: "Finalização após cruzamento",
    description: "Combinação curta no corredor, condução até à linha de fundo e cruzamento para o avançado atacar o primeiro poste.",
    category: "Organização ofensiva", objectives: ["Finalização", "Criação"], type: "Finalização", intensity: 6, players: "4+GR",
    durationMin: 15, space: "Meio campo", material: "2 cones, 10 bolas", ageMin: 11, ageMax: 17, complexity: 2, autor: "Miguel Antunes",
    diagram: FINALIZACAO, usageCount: 5, favorite: false, lastUsedAt: "2026-10-02T18:00:00.000Z", updatedAt: "2026-09-17T18:12:00.000Z",
  },
];

/* -------------------------------------------------------------------------- */
/* Planos de sessão                                                            */
/* -------------------------------------------------------------------------- */

export const TREINO_DE_QUARTA = "tr-sub13-2026-10-07";

const b = (name, durationMin, category, objective, intensity, players, notes, exerciseId) => ({
  name, durationMin, category, objective, intensity, players, notes: notes ?? null, exerciseId: exerciseId ?? null,
});

const PLANO_DE_QUARTA = {
  objective: "Sair a jogar desde trás com três e chegar à baliza em poucos toques",
  objectives: ["Construção", "Finalização", "Reação à perda"],
  sessionType: "Aquisitivo", intensity: 7, expectedAthletes: 14,
  material: "12 bolas, 10 coletes, 16 cones, 2 balizas de futebol 7",
  planNotes: "O Salvador continua de baixa. O Lourenço avisou que não vem. Trabalhar com 14, dois guarda-redes.",
  blocks: [
    b("Ativação com bola", 15, "Técnico", "Passe", 4, "4×2", "Dois quadrados em simultâneo. Trocar quem está ao meio a cada 90 segundos.", "ex-rondo-4v2"),
    b("Saída a três e finalização", 20, "Organização ofensiva", "Construção", 7, "8+GR × 4+GR", "Três séries de seis minutos. Trocar os dois que pressionam em cada série.", EX_SAIDA),
    b("Jogo reduzido 6×6", 25, "Transições", "Reação à perda", 8, "5+GR × 5+GR", "Quatro partes de cinco minutos. Golo depois de saída a três vale a dobrar.", "ex-jogo-reduzido-6v6"),
    b("Retorno à calma", 15, "Físico", "Recuperação", 2, "Todos", "Corrida leve, alongamentos e conversa final sobre o jogo de sábado.", null),
  ],
};

/** O desenho de um treino pelo dia da semana da equipa: [tipo, intensidade, blocos]. */
const MODELOS = {
  forte: ["Aquisitivo", 7, [
    b("Ativação com bola", 15, "Técnico", "Passe", 4, null),
    b("Organização ofensiva", 25, "Organização ofensiva", "Construção", 7, null),
    b("Jogo condicionado", 25, "Transições", "Transição ofensiva", 8, null),
    b("Retorno à calma", 10, "Físico", "Recuperação", 2, null),
  ]],
  medio: ["Aquisitivo", 6, [
    b("Ativação", 15, "Físico", "Mobilidade", 4, null),
    b("Pressão em bloco médio", 20, "Organização defensiva", "Bloco médio", 6, null),
    b("Posse com apoios", 20, "Organização ofensiva", "Progressão", 7, null),
    b("Jogo livre", 15, "Transições", "Reação à perda", 6, null),
  ]],
  leve: ["Pré-competitivo", 4, [
    b("Ativação com bola", 15, "Técnico", "Receção", 3, null),
    b("Bolas paradas", 20, "Bolas paradas", "Cantos ofensivos", 4, null),
    b("Jogo curto de véspera", 15, "Organização ofensiva", "Finalização", 5, null),
    b("Alongamentos", 10, "Físico", "Recuperação", 2, null),
  ]],
};

export function criarTecnica(clube) {
  const { sessoes, equipas, agora } = clube;

  /* ---- Exercícios ----------------------------------------------------------- */
  const completo = EXERCICIOS.map((e) => {
    const { autor, diagram, usageCount, favorite, lastUsedAt, ...resto } = e;
    return {
      ...resto, phase: null, visibility: "CLUB", videoUrl: null, sportId: SPORT.id,
      mine: false, authorName: autor,
      rules: e.rules ?? null, progressions: e.progressions ?? null, regressions: e.regressions ?? null,
      coachingPoints: e.coachingPoints ?? null, commonErrors: e.commonErrors ?? null,
      diagram, images: [], editable: true, deletable: true, usedIn: { gameModels: [], setPieces: [] },
      _resumo: { thumbnail: primeiro(diagram), frames: diagram.frames.length, cover: null, imageCount: 0, favorite, usageCount, lastUsedAt },
    };
  });
  const exercicios = completo.map(({ rules, progressions, regressions, coachingPoints, commonErrors, diagram, images, editable, deletable, usedIn, _resumo, ...r }) => ({ ...r, ..._resumo }));
  const exercicioPorId = Object.fromEntries(completo.map(({ _resumo, ...e }) => [e.id, e]));
  const miniatura = (id) => (id ? completo.find((e) => e.id === id)?._resumo.thumbnail ?? null : null);

  /* ---- Planos --------------------------------------------------------------- */
  const planos = {};
  for (const s of sessoes) {
    const equipa = equipas.find((e) => e.id === s.teamId);
    const dia = new Date(s.startsAt).toLocaleDateString("sv-SE", { timeZone: "Europe/Lisbon" });
    // O treinador planeia o mesociclo inteiro: há plano até 25 de outubro.
    if (dia > "2026-10-25") continue;
    const semana = new Date(`${dia}T12:00:00Z`).getUTCDay();
    const minutos = Math.round((new Date(s.endsAt) - new Date(s.startsAt)) / 60_000);
    let base;
    if (s.id === TREINO_DE_QUARTA) base = PLANO_DE_QUARTA;
    else {
      const [tipo, intensidadeBase, blocosBase] = MODELOS[semana === 5 ? "leve" : semana === 1 || semana === 2 ? "medio" : "forte"];
      // A carga sobe e desce de semana para semana: duas a subir, uma de descarga.
      const nSemana = Math.floor((new Date(`${dia}T12:00:00Z`).getTime() - Date.UTC(2026, 7, 31, 12)) / (7 * 86_400_000));
      const onda = [-1, 0, 0, 1, 1, 0, 1, -1][((nSemana % 8) + 8) % 8];
      const intensidade = Math.max(2, Math.min(9, intensidadeBase + onda));
      const blocos = blocosBase.map((x, i) => ({ ...x, intensity: i === 1 || i === 2 ? Math.max(2, Math.min(9, x.intensity + onda)) : x.intensity }));
      // Os blocos esticam ou encolhem para a duração do treino desta equipa.
      const total = blocos.reduce((n, x) => n + x.durationMin, 0);
      const ajustados = blocos.map((x) => ({ ...x, durationMin: Math.max(5, Math.round((x.durationMin * minutos) / total / 5) * 5) }));
      // O que o arredondamento deixou de fora vai para o bloco principal.
      ajustados[1].durationMin += minutos - ajustados.reduce((n, x) => n + x.durationMin, 0);
      base = {
        objective: tipo === "Pré-competitivo" ? "Preparar o jogo do fim de semana" : semana === 1 || semana === 2 ? "Pressionar em bloco e recuperar alto" : "Construir e acelerar no último terço",
        objectives: ajustados.slice(1, 3).map((x) => x.objective), sessionType: tipo, intensity: intensidade,
        expectedAthletes: equipa.athleteCount - 1, material: null, planNotes: null, blocks: ajustados,
      };
    }
    planos[s.id] = {
      sessionId: s.id, teamId: s.teamId, teamName: s.teamName, startsAt: s.startsAt, endsAt: s.endsAt, venue: s.venue, status: s.status,
      coachName: s.coachName, mine: true,
      objective: base.objective, objectives: base.objectives, sessionType: base.sessionType, intensity: base.intensity,
      expectedAthletes: base.expectedAthletes, material: base.material, planNotes: base.planNotes, postNotes: null, sharedAt: null,
      blocks: base.blocks.map((x, i) => ({
        id: `bl-${s.id}-${i + 1}`, ...x,
        exerciseName: x.exerciseId ? exercicioPorId[x.exerciseId].name : null,
        exerciseThumb: miniatura(x.exerciseId),
      })),
    };
  }
  const resumos = Object.values(planos).map((p) => ({
    sessionId: p.sessionId, teamId: p.teamId, objective: p.objective, sessionType: p.sessionType, intensity: p.intensity,
    blockCount: p.blocks.length,
    blocks: p.blocks.map((x) => ({ durationMin: x.durationMin, intensity: x.intensity, category: x.category })),
  }));

  /* ---- Periodização --------------------------------------------------------- */
  const ciclos = [];
  for (const e of equipas) {
    const k = e.id.slice(2);
    ciclos.push(
      { id: `meso-${k}-1`, teamId: e.id, level: "MESO", startsOn: "2026-08-31", endsOn: "2026-09-13", name: "Preparação", phase: "Pré-época", focus: ["Físico", "Técnico"], objective: "Chegar ao primeiro jogo com a equipa a conhecer os princípios de saída.", notes: null, color: null },
      { id: `meso-${k}-2`, teamId: e.id, level: "MESO", startsOn: "2026-09-14", endsOn: "2026-10-25", name: "Competição I", phase: "Competição", focus: ["Organização ofensiva", "Transições"], objective: "Consolidar a saída a três e a reação à perda.", notes: null, color: null },
      { id: `meso-${k}-3`, teamId: e.id, level: "MESO", startsOn: "2026-10-26", endsOn: "2026-12-06", name: "Competição II", phase: "Competição", focus: ["Organização defensiva", "Bolas paradas"], objective: "Variar a construção e defender mais alto.", notes: null, color: "#8a4f7d" },
    );
    const MICROS = {
      "2026-09-07": [null, ["Físico", "Técnico"], "Primeiros treinos com bola e avaliação do plantel."],
      "2026-09-14": [null, ["Organização ofensiva", "Técnico"], "Posicionar a equipa em campo e ligar os três setores."],
      "2026-09-21": [null, ["Organização ofensiva", "Bolas paradas"], "Atacar pelos corredores e cruzar para finalizar."],
      "2026-09-28": [null, ["Organização defensiva", "Transições"], "Defender junto e sair rápido."],
      "2026-10-05": [null, ["Organização ofensiva", "Transições"], "Sair a jogar desde trás com três e chegar à baliza em poucos toques."],
      "2026-10-12": [null, ["Organização defensiva", "Transições"], "Pressionar a saída do adversário e recuperar em zona alta."],
      "2026-10-19": [null, ["Organização ofensiva", "Bolas paradas"], "Semana de consolidação antes de fechar o mesociclo."],
    };
    for (let i = 0, seg = "2026-08-31"; seg <= "2026-11-23"; i++) {
      const d = new Date(`${seg}T12:00:00Z`);
      const fim = new Date(d.getTime() + 6 * 86_400_000).toISOString().slice(0, 10);
      const [nome, foco, objetivo] = (e.id === "t-sub13" && MICROS[seg]) || [null, [], null];
      ciclos.push({ id: `micro-${k}-${seg}`, teamId: e.id, level: "MICRO", startsOn: seg, endsOn: fim, name: nome, phase: null, focus: foco, objective: objetivo, notes: null, color: null });
      seg = new Date(d.getTime() + 7 * 86_400_000).toISOString().slice(0, 10);
    }
  }

  const modelos = [
    {
      id: "mod-treino-md3", name: "Quarta de aquisição (MD-3)", visibility: "CLUB", objective: "Construir e acelerar no último terço",
      objectives: ["Construção", "Finalização"], sessionType: "Aquisitivo", intensity: 7, expectedAthletes: 16, material: null, planNotes: null,
      useCount: 4, lastUsedAt: "2026-09-30T18:00:00.000Z", updatedAt: "2026-09-16T10:00:00.000Z", createdAt: "2026-09-16T10:00:00.000Z",
      authorName: "Miguel Antunes", mine: false, blockCount: 4, totalMin: 75,
      blocks: MODELOS.forte[2].map((x) => ({ ...x, exerciseName: null })),
    },
  ];

  const GET = {
    "/api/training/exercises": exercicios,
    "/api/training/summary": {
      exercises: { count: exercicios.length, recent: exercicios.slice(0, 3).map((e) => e.name) },
      gameModels: { count: 0, recent: [] },
      setPieces: { count: 0, recent: [] },
    },
    "/api/training/game-models": [],
    "/api/training/set-pieces": [],
    "/api/training/templates": modelos,
    "/api/training/plans": (q) => {
      const de = q.get("from") ? new Date(q.get("from")).getTime() : -Infinity;
      const ate = q.get("to") ? new Date(q.get("to")).getTime() : Infinity;
      return resumos.filter((r) => {
        const t = new Date(planos[r.sessionId].startsAt).getTime();
        return t >= de && t <= ate;
      });
    },
    "/api/training/cycles": (q) => {
      const equipa = q.get("teamId");
      const de = q.get("from"), ate = q.get("to");
      return ciclos.filter((c) => (!equipa || c.teamId === equipa) && (!de || c.endsOn >= de.slice(0, 10)) && (!ate || c.startsOn <= ate.slice(0, 10)));
    },
  };
  const PADROES = [
    [/^\/api\/training\/exercises\/([^/]+)$/, (m) => exercicioPorId[m[1]]],
    [/^\/api\/training\/sessions\/([^/]+)\/plan$/, (m) => planos[m[1]]],
  ];
  return { GET, PADROES };
}

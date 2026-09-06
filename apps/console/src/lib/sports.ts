import { categoryColor } from "@academia/ui/tokens";
import type { Sport } from "@/data/types";
import { Basketball, Football, Futsal, Goal, Network, Shapes, Timer, type LucideIcon } from "@/lib/icons";
import { academy as storeAcademy } from "@/lib/store";
import {
  FORMAT_PITCH,
  OBJECTIVE_CATEGORIES,
  PRINCIPLE_SECTIONS,
  SET_PIECE_KINDS,
  emptyDiagram,
  fieldFor,
  formatsOf,
  newId,
  type Diagram,
  type DiagramItem,
  type Discipline,
  type EditorVocabulary,
  type GameFormat,
  type ObjectiveCategory,
  type PrincipleSection,
} from "@/lib/training";

/**
 * Os perfis técnicos — o que a Área técnica é em cada modalidade.
 *
 * ## Porque é que isto existe
 *
 * A Área técnica nasceu como o produto de futebol da Academias: Exercícios,
 * Modelos de jogo e Bolas paradas, três menus soltos com vocabulário de futebol
 * embutido nas páginas. Um clube de basquetebol via "Bolas paradas" e um
 * seletor de terreno com "Futebol 9".
 *
 * Passou a haver **uma Área técnica por modalidade**, e o que a define é um
 * perfil: os módulos que tem e como se chamam, o terreno em que se desenha, o
 * vocabulário dos filtros, os sistemas de partida, os lances que se montam
 * sozinhos. O código é o mesmo para todas — os três módulos são sempre uma
 * biblioteca (`Exercise`), um caderno de sistemas (`GameModel`) e uma colecção
 * de situações (`SetPiece`) — e o perfil é o que os veste.
 *
 * ## O que é dado e o que é código
 *
 * A **configuração do clube** é dado: as modalidades que tem e a disciplina
 * (`Sport.code`) de cada uma decidem que entradas aparecem no menu. O **perfil**
 * de cada disciplina é código, aqui: não faz sentido cada clube reescrever o
 * que é uma zona 2-3, e um perfil novo (andebol, voleibol) é acrescentar um
 * objecto a `SPORT_PROFILES` — nenhuma tabela, nenhuma migração, nenhuma
 * página nova.
 *
 * ## Onde é que os módulos se ligam ao resto
 *
 * As chaves dos módulos (`exercises`, `playbook`, `situations`) são estáveis e
 * genéricas; os **rótulos e os caminhos** são do perfil. É por isso que o
 * futebol tem `/modelos-jogo` e o basquetebol `/sistemas-jogo` a apontar para a
 * mesma página — e que essa página não sabe de que modalidade é até lhe
 * perguntar ao perfil.
 */

export type SportCode = Discipline;
export type ModuleKey = "exercises" | "playbook" | "situations";
export const MODULES: ModuleKey[] = ["exercises", "playbook", "situations"];

export type KindOption = { key: string; label: string };
/** Um grupo de tipos — "Reposições", "Final de jogo". Sem rótulo é a lista rasa. */
export type KindGroup = { label: string | null; kinds: KindOption[] };

export type SportProfile = {
  code: SportCode;
  /** O nome canónico — o que a definição sugere ao escolher o padrão. */
  name: string;
  /*
   * O ícone é a marca da modalidade, e é só isso que ela tem.
   *
   * Houve aqui um emoji, usado no menu, na capa e nas Definições. Um emoji não
   * é do produto: desenha-se à maneira do sistema operativo de quem olha, não
   * tem a espessura de traço do resto da consola, e num cabeçalho ao lado de
   * tipografia séria lê-se como um autocolante. Onde era preciso identidade —
   * a capa da modalidade — quem a dá é o **campo desenhado**, que é nosso.
   */
  icon: LucideIcon;
  /** A frase de entrada: "Organiza os teus exercícios, sistemas de jogo e situações especiais." */
  tagline: string;
  /** O que a definição preenche por omissão ao escolher esta disciplina. */
  defaults: { positions: string[]; skills: string[]; dominantSideLabel: string; matchMinutes: number };
  /** O que o editor de campo oferece nesta modalidade. */
  vocabulary: EditorVocabulary;
  defaultFormat: GameFormat;

  exercises: {
    label: string;
    slug: string;
    icon: LucideIcon;
    description: string;
    /** "24 exercícios", "1 exercício" — o contador do cartão de entrada. */
    count: (n: number) => string;
    categories: ObjectiveCategory[];
    types: string[];
    placeholders: { name: string; players: string; space: string; material: string };
  };

  playbook: {
    label: string;
    singular: string;
    slug: string;
    icon: LucideIcon;
    description: string;
    count: (n: number) => string;
    /** Os tipos, onde a modalidade os distingue (ataque/defesa/transição). Nulo = sem tipo. */
    kinds: KindOption[] | null;
    sections: PrincipleSection[];
    /** "Onze-tipo", "Cinco inicial" — o nome do desenho das posições. */
    lineupLabel: string;
    newPlaceholder: string;
  };

  situations: {
    label: string;
    singular: string;
    slug: string;
    icon: LucideIcon;
    description: string;
    count: (n: number) => string;
    groups: KindGroup[];
    /** O lance montado com que uma situação nova nasce. */
    starter: (kind: string, format: GameFormat) => Diagram;
    newPlaceholder: string;
  };
};

/* -------------------------------------------------------------------------- */
/* Lances montados                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Um lance de futebol, à medida da variante.
 *
 * Um canto ofensivo não começa num campo vazio: nasce com a bola no canto, o
 * batedor, a estrutura habitual na área e a defesa a marcar — apaga-se o que
 * sobra, arrasta-se o resto. É a diferença entre desenhar e preencher.
 *
 * As posições são **frações do campo** (0–1) e escalam-se para o terreno de
 * cada variante; o que muda com a variante é o que tem mesmo de mudar: quanta
 * gente entra, porque um canto de futebol 5 não tem seis atacantes na área.
 */
function footballStarter(kind: string, format: GameFormat): Diagram {
  const s = FORMAT_PITCH[format];
  const fullPitch = kind === "goal-clearance";
  const d = emptyDiagram(fieldFor(format, !fullPitch));
  const at = (k: DiagramItem["kind"], fx: number, fy: number, label?: string): DiagramItem => ({
    id: newId(),
    kind: k,
    x: fx * s.w,
    y: fy * s.h,
    ...(label ? { label } : {}),
  });

  /** Quantos jogadores de campo tem esta variante (sem o guarda-redes). */
  const outfield = ({ f11: 10, f9: 8, f7: 6, f5: 4, futsal: 4, basket: 4 } as Record<GameFormat, number>)[format];

  if (kind === "corner-off" || kind === "corner-def") {
    const ours = [
      at("player", 0.981, 0.037, "7"),
      at("player", 0.914, 0.412, "9"),
      at("player", 0.895, 0.5, "10"),
      at("player", 0.914, 0.588, "11"),
      at("player", 0.848, 0.5, "8"),
      at("player", 0.781, 0.353, "6"),
    ].slice(0, Math.min(6, outfield));
    const theirs = [
      at("opponent", 0.933, 0.441, "4"),
      at("opponent", 0.933, 0.559, "5"),
      at("opponent", 0.886, 0.441, "2"),
    ].slice(0, outfield <= 4 ? 2 : 3);
    d.frames[0].items = [at("ball", 0.995, 0.01), ...ours, ...theirs, at("gk", 0.981, 0.5, "GR")];
  } else if (kind === "free-off" || kind === "free-def" || kind === "second-penalty") {
    const barreira = [
      at("opponent", 0.838, 0.397, "2"),
      at("opponent", 0.838, 0.441, "4"),
      at("opponent", 0.838, 0.485, "5"),
    ].slice(0, outfield <= 4 ? 2 : 3);
    const ours = [
      at("player", 0.743, 0.324, "10"),
      at("player", 0.876, 0.588, "9"),
      at("player", 0.857, 0.662, "11"),
    ].slice(0, Math.min(3, outfield));
    if (kind === "second-penalty" && s.secondPenalty) {
      // A marca dos 10 m é a real, e o livre é sem barreira.
      const px = (s.w - s.secondPenalty) / s.w;
      d.frames[0].items = [at("ball", px, 0.5), at("player", px - 0.05, 0.5, "10"), at("gk", 0.985, 0.5, "GR")];
    } else {
      d.frames[0].items = [at("ball", 0.762, 0.353), ...ours, ...barreira, at("gk", 0.985, 0.529, "GR")];
    }
  } else if (kind === "throw-in" || kind === "kick-in") {
    d.frames[0].items = [
      at("ball", 0.81, 0.007),
      at("player", 0.81, 0.022, "2"),
      at("player", 0.857, 0.176, "7"),
      at("player", 0.762, 0.176, "8"),
      at("opponent", 0.838, 0.147, "3"),
    ];
  } else if (kind === "penalty") {
    // A marca é a real da variante, não uma fração: aos 11 m no campo de onze,
    // aos 6 no futsal.
    const px = (s.w - s.penalty) / s.w;
    d.frames[0].items = [at("ball", px, 0.5), at("player", px - 0.03, 0.5, "9"), at("gk", 0.99, 0.5, "GR")];
  } else if (kind === "goal-clearance") {
    // A saída de baliza vê-se no campo inteiro: o GR com a bola na nossa área,
    // a equipa a abrir para receber.
    d.frames[0].items = [
      at("gk", 0.05, 0.5, "GR"),
      at("ball", 0.08, 0.5),
      at("player", 0.25, 0.2, "2"),
      at("player", 0.25, 0.8, "3"),
      at("player", 0.5, 0.35, "8"),
      at("player", 0.65, 0.65, "9"),
      at("opponent", 0.35, 0.5, "5"),
      at("opponent", 0.55, 0.5, "6"),
    ];
  }
  return d;
}

/**
 * Uma situação de basquetebol, montada.
 *
 * O campo é sempre o FIBA de 28×15, por isso as posições estão em metros e não
 * em frações. A nossa equipa ataca o cesto da direita (a 26,4 m); as reposições
 * contra pressão vêem-se no campo inteiro, porque começam debaixo do nosso.
 */
function basketballStarter(kind: string): Diagram {
  const fullCourt = kind === "inbound-press" || kind === "inbound-after-score";
  const d = emptyDiagram(fullCourt ? "basket" : "basket-half");
  const at = (k: DiagramItem["kind"], x: number, y: number, label?: string): DiagramItem => ({
    id: newId(),
    kind: k,
    x,
    y,
    ...(label ? { label } : {}),
  });

  if (kind === "inbound-baseline") {
    // A caixa clássica: quatro na área, o repositor fora da linha de fundo.
    d.frames[0].items = [
      at("playerBall", 28.7, 4.6, "4"),
      at("player", 24.6, 5.4, "1"),
      at("player", 24.6, 9.6, "2"),
      at("player", 22.2, 5.4, "3"),
      at("player", 22.2, 9.6, "5"),
      at("opponent", 27.5, 5.2, "4"),
      at("opponent", 25.4, 6.4, "1"),
      at("opponent", 25.4, 8.6, "2"),
      at("opponent", 23.0, 6.4, "3"),
      at("opponent", 23.0, 8.6, "5"),
    ];
  } else if (kind === "inbound-sideline") {
    d.frames[0].items = [
      at("playerBall", 20.5, -0.7, "1"),
      at("player", 23.5, 3.0, "2"),
      at("player", 18.0, 4.2, "3"),
      at("player", 24.0, 9.5, "4"),
      at("player", 26.0, 5.8, "5"),
      at("opponent", 21.2, 0.6, "1"),
      at("opponent", 22.6, 3.6, "2"),
      at("opponent", 19.0, 5.2, "3"),
      at("opponent", 23.4, 8.6, "4"),
      at("opponent", 25.2, 6.6, "5"),
    ];
  } else if (fullCourt) {
    // Debaixo do nosso cesto (à esquerda), com a defesa a pressionar a saída.
    d.frames[0].items = [
      at("playerBall", -0.7, 6.0, "4"),
      at("player", 3.6, 4.8, "1"),
      at("player", 3.6, 10.2, "2"),
      at("player", 9.5, 3.0, "3"),
      at("player", 12.5, 11.5, "5"),
      at("opponent", 2.4, 6.0, "1"),
      at("opponent", 2.6, 9.4, "2"),
      at("opponent", 8.2, 4.2, "3"),
      at("opponent", 11.0, 10.2, "4"),
      at("opponent", 19.5, 7.5, "5"),
    ];
  } else {
    // O resto — última posse, após timeout, personalizada — parte de um 5-out
    // com a bola no base e a defesa individual à frente de cada um.
    d.frames[0].items = [
      at("playerBall", 17.5, 7.5, "1"),
      at("player", 22.0, 2.0, "2"),
      at("player", 22.0, 13.0, "3"),
      at("player", 26.4, 0.9, "4"),
      at("player", 26.4, 14.1, "5"),
      at("opponent", 19.3, 7.5, "1"),
      at("opponent", 23.2, 3.0, "2"),
      at("opponent", 23.2, 12.0, "3"),
      at("opponent", 26.0, 2.4, "4"),
      at("opponent", 26.0, 12.6, "5"),
    ];
  }
  return d;
}

/* -------------------------------------------------------------------------- */
/* Vocabulário do basquetebol                                                  */
/* -------------------------------------------------------------------------- */

/**
 * As categorias de objectivo do basquetebol. Cores da mesma paleta categórica
 * do futebol, pela mesma ordem: a primeira categoria de cada modalidade tem a
 * mesma cor, e ninguém precisa de aprender duas legendas.
 */
export const BASKET_CATEGORIES: ObjectiveCategory[] = [
  {
    key: "tec",
    label: "Técnica individual",
    color: categoryColor(0),
    subs: ["Passe", "Drible", "Lançamento", "Finalização", "Jogo de pés", "Ressalto"],
  },
  {
    key: "at",
    label: "Ataque",
    color: categoryColor(1),
    subs: ["1x1", "2x2", "3x3", "Pick & roll", "Espaçamento", "Jogo interior", "Leitura de vantagem", "5x5"],
  },
  {
    key: "def",
    label: "Defesa",
    color: categoryColor(2),
    subs: ["1x1 defensivo", "Closeout", "Ajudas e rotações", "Defesa de bloqueios", "Ressalto defensivo", "Defesa de zona"],
  },
  {
    key: "trans",
    label: "Transição",
    color: categoryColor(3),
    subs: ["Contra-ataque", "Transição ofensiva", "Transição defensiva", "Pressão após perda"],
  },
  {
    key: "fis",
    label: "Físico",
    color: categoryColor(6),
    subs: ["Condicionamento", "Velocidade", "Força", "Mobilidade", "Recuperação"],
  },
  {
    key: "dec",
    label: "Tomada de decisão",
    color: categoryColor(5),
    subs: ["Leitura de jogo", "Jogo reduzido", "Vantagem/desvantagem", "Regras condicionadas"],
  },
];

const BASKET_SECTIONS: PrincipleSection[] = [
  { key: "offense", label: "Ataque", topics: ["Espaçamento", "Entrada no sistema", "Leituras do pick & roll", "Jogo interior", "Lançamento e ressalto ofensivo"] },
  { key: "defense", label: "Defesa", topics: ["Pressão à bola", "Ajudas e rotações", "Defesa de bloqueios", "Ressalto defensivo", "Comunicação"] },
  { key: "transition", label: "Transição", topics: ["Contra-ataque", "Transição defensiva", "Pressão após perda", "Reposição defensiva"] },
  { key: "special", label: "Situações especiais", topics: ["Reposições", "Final de jogo", "Após desconto de tempo"] },
];

const BASKET_SITUATIONS: KindGroup[] = [
  {
    label: "Reposições",
    kinds: [
      { key: "inbound-baseline", label: "Reposição de fundo" },
      { key: "inbound-sideline", label: "Reposição lateral" },
      { key: "inbound-after-score", label: "Reposição após cesto" },
      { key: "inbound-press", label: "Reposição contra pressão" },
    ],
  },
  {
    label: "Final de jogo",
    kinds: [
      { key: "endgame-last", label: "Última posse" },
      { key: "endgame-seconds", label: "Últimos segundos" },
      { key: "endgame-ahead", label: "Ataque com vantagem" },
      { key: "endgame-behind", label: "Ataque com desvantagem" },
      { key: "endgame-foul", label: "Falta para parar o relógio" },
      { key: "endgame-defense", label: "Defesa da última posse" },
    ],
  },
  {
    label: "Descontos de tempo",
    kinds: [
      { key: "timeout-play", label: "Jogada após desconto de tempo" },
      { key: "timeout-offense", label: "Ataque especial" },
      { key: "timeout-defense", label: "Defesa especial" },
    ],
  },
  {
    label: "Outras",
    kinds: [
      { key: "foul-situation", label: "Situação de falta" },
      { key: "advantage", label: "Vantagem / desvantagem numérica" },
    ],
  },
];

/* -------------------------------------------------------------------------- */
/* Os perfis                                                                   */
/* -------------------------------------------------------------------------- */

const FOOTBALL_SECTIONS: PrincipleSection[] = PRINCIPLE_SECTIONS.map((s) => ({ key: s.key, label: s.label, topics: s.topics }));
const FOOTBALL_SITUATIONS: KindGroup[] = [{ label: null, kinds: SET_PIECE_KINDS.map((k) => ({ key: k.key, label: k.label })) }];

/** O futsal chama "pontapé de linha lateral" ao lançamento, e tem os 10 m. */
const FUTSAL_SITUATIONS: KindGroup[] = [
  {
    label: null,
    kinds: [
      { key: "corner-off", label: "Cantos ofensivos" },
      { key: "corner-def", label: "Cantos defensivos" },
      { key: "free-off", label: "Livres ofensivos" },
      { key: "free-def", label: "Livres defensivos" },
      { key: "kick-in", label: "Pontapés de linha lateral" },
      { key: "second-penalty", label: "Livres de 10 m" },
      { key: "penalty", label: "Penáltis" },
      { key: "goal-clearance", label: "Saídas de baliza" },
    ],
  },
];

const FOOTBALL_TYPES = ["Posse", "Vaga", "Jogo condicionado", "Jogo reduzido", "Circuito", "Finalização", "Analítico", "Rondo", "Onda/Transição"];
const BASKET_TYPES = ["Analítico", "Drill de lançamento", "1x1 / 2x2 / 3x3", "Jogo reduzido", "5x5 condicionado", "Shell drill", "Circuito", "Competitivo"];

const footballVocabulary = (formats: GameFormat[]): EditorVocabulary => ({
  formats,
  items: ["player", "opponent", "gk", "playerBall", "ball", "cone", "pole", "miniGoal", "goal", "barrier", "ladder", "dummy", "zone", "text"],
  arrows: ["pass", "run", "dribble", "shot", "press", "cross"],
  labels: {},
});

const BASKET_VOCABULARY: EditorVocabulary = {
  formats: formatsOf("basketball"),
  // Sem guarda-redes, balizas, barreiras nem cruzamentos: não existem no jogo.
  items: ["player", "opponent", "playerBall", "ball", "cone", "pole", "ladder", "dummy", "zone", "text"],
  arrows: ["pass", "run", "dribble", "shot", "press"],
  labels: { shot: "Lançamento", dribble: "Drible", press: "Pressão", playerBall: "Jogador c/ bola" },
};

export const SPORT_PROFILES: Record<SportCode, SportProfile> = {
  football: {
    code: "football",
    name: "Futebol",
    icon: Football,
    tagline: "Organiza os teus exercícios, modelos de jogo e bolas paradas.",
    defaults: {
      positions: ["Guarda-redes", "Defesa central", "Lateral", "Médio defensivo", "Médio centro", "Médio ofensivo", "Extremo", "Avançado"],
      skills: ["Técnica", "Táctica", "Físico", "Atitude"],
      dominantSideLabel: "Pé dominante",
      matchMinutes: 90,
    },
    vocabulary: footballVocabulary(formatsOf("football")),
    defaultFormat: "f11",
    exercises: {
      label: "Exercícios",
      slug: "exercicios",
      icon: Shapes,
      description: "A biblioteca do clube — desenhados, filtráveis e prontos a entrar num treino.",
      count: (n) => (n === 1 ? "1 exercício" : `${n} exercícios`),
      categories: OBJECTIVE_CATEGORIES,
      types: FOOTBALL_TYPES,
      placeholders: { name: 'Ex.: "Posse 6v4 — saída sob pressão"', players: "6v4+GR", space: "30×25 m", material: "8 cones, coletes, 2 mini-balizas" },
    },
    playbook: {
      label: "Modelos de jogo",
      singular: "modelo",
      slug: "modelos-jogo",
      icon: Network,
      description: "Como a equipa joga — o sistema desenhado e os princípios escritos, guardados no clube.",
      count: (n) => (n === 1 ? "1 modelo de jogo" : `${n} modelos de jogo`),
      kinds: null,
      sections: FOOTBALL_SECTIONS,
      lineupLabel: "Onze-tipo",
      newPlaceholder: "Ex.: Sub-17 — 4-3-3 pressão alta",
    },
    situations: {
      label: "Bolas paradas",
      singular: "esquema",
      slug: "bolas-paradas",
      icon: Goal,
      description: "Cantos, livres e lançamentos — desenhados, animados e prontos a rever na véspera do jogo.",
      count: (n) => (n === 1 ? "1 bola parada" : `${n} bolas paradas`),
      groups: FOOTBALL_SITUATIONS,
      starter: footballStarter,
      newPlaceholder: 'Ex.: "Canto curto — 2º poste"',
    },
  },

  futsal: {
    code: "futsal",
    name: "Futsal",
    icon: Futsal,
    tagline: "Organiza os teus exercícios, modelos de jogo e bolas paradas.",
    defaults: {
      positions: ["Guarda-redes", "Fixo", "Ala", "Pivô", "Universal"],
      skills: ["Técnica", "Táctica", "Físico", "Atitude"],
      dominantSideLabel: "Pé dominante",
      matchMinutes: 40,
    },
    vocabulary: footballVocabulary(formatsOf("futsal")),
    defaultFormat: "futsal",
    exercises: {
      label: "Exercícios",
      slug: "exercicios",
      icon: Shapes,
      description: "A biblioteca do clube — desenhados no pavilhão, filtráveis e prontos a entrar num treino.",
      count: (n) => (n === 1 ? "1 exercício" : `${n} exercícios`),
      categories: OBJECTIVE_CATEGORIES,
      types: FOOTBALL_TYPES,
      placeholders: { name: 'Ex.: "Rotação 4-0 com saída em paralela"', players: "4v4+GR", space: "20×20 m", material: "8 cones, coletes" },
    },
    playbook: {
      label: "Modelos de jogo",
      singular: "modelo",
      slug: "modelos-jogo",
      icon: Network,
      description: "Como a equipa joga — o sistema desenhado e os princípios escritos, guardados no clube.",
      count: (n) => (n === 1 ? "1 modelo de jogo" : `${n} modelos de jogo`),
      kinds: null,
      sections: FOOTBALL_SECTIONS,
      lineupLabel: "Cinco inicial",
      newPlaceholder: "Ex.: Sub-15 — 3-1 com pivô fixo",
    },
    situations: {
      label: "Bolas paradas",
      singular: "esquema",
      slug: "bolas-paradas",
      icon: Goal,
      description: "Cantos, livres, pontapés de linha lateral e saídas de baliza — desenhados e animados.",
      count: (n) => (n === 1 ? "1 bola parada" : `${n} bolas paradas`),
      groups: FUTSAL_SITUATIONS,
      starter: footballStarter,
      newPlaceholder: 'Ex.: "Canto — bloqueio ao 2º poste"',
    },
  },

  basketball: {
    code: "basketball",
    name: "Basquetebol",
    icon: Basketball,
    tagline: "Organiza os teus exercícios, sistemas de jogo e situações especiais.",
    defaults: {
      positions: ["Base", "Extremo", "Ala", "Ala-poste", "Poste"],
      skills: ["Técnica individual", "Lançamento", "Leitura de jogo", "Defesa", "Físico", "Atitude"],
      dominantSideLabel: "Mão dominante",
      matchMinutes: 40,
    },
    vocabulary: BASKET_VOCABULARY,
    defaultFormat: "basket",
    exercises: {
      label: "Exercícios",
      slug: "exercicios",
      icon: Shapes,
      description: "A biblioteca do clube — do drill de lançamento ao 5x5, desenhados no campo e prontos a entrar num treino.",
      count: (n) => (n === 1 ? "1 exercício" : `${n} exercícios`),
      categories: BASKET_CATEGORIES,
      types: BASKET_TYPES,
      placeholders: { name: 'Ex.: "Pick & roll 2x2 com ajuda"', players: "3x3", space: "Meio campo", material: "2 bolas, 4 cones" },
    },
    playbook: {
      label: "Sistemas de jogo",
      singular: "sistema",
      slug: "sistemas-jogo",
      icon: Network,
      description: "Os princípios e as estruturas — ataque, defesa e transição — com os exercícios que os treinam.",
      count: (n) => (n === 1 ? "1 sistema de jogo" : `${n} sistemas de jogo`),
      kinds: [
        { key: "offense", label: "Ataque" },
        { key: "defense", label: "Defesa" },
        { key: "transition", label: "Transição" },
      ],
      sections: BASKET_SECTIONS,
      lineupLabel: "Posições de partida",
      newPlaceholder: "Ex.: Pick & roll central",
    },
    situations: {
      label: "Situações especiais",
      singular: "situação",
      slug: "situacoes-especiais",
      icon: Timer,
      description: "Reposições, finais de jogo e jogadas após desconto de tempo — o que se prepara e se memoriza.",
      count: (n) => (n === 1 ? "1 situação especial" : `${n} situações especiais`),
      groups: BASKET_SITUATIONS,
      starter: (kind) => basketballStarter(kind),
      newPlaceholder: 'Ex.: "Reposição de fundo — últimos 5 segundos"',
    },
  },
};

/* -------------------------------------------------------------------------- */
/* Consultas                                                                   */
/* -------------------------------------------------------------------------- */

export const isSportCode = (v: unknown): v is SportCode => v === "football" || v === "futsal" || v === "basketball";

/**
 * A disciplina que o **nome** diz. Gémea de `inferSportCode` no servidor
 * (`academy.service.ts`) — ao mexer numa, mexer na outra.
 *
 * Compara sem maiúsculas e sem acentos, e por conteúdo: "FUTEBOL", "futebol ",
 * "Futebol 7", "Futebol Feminino" e "Futeboll" caem todos em futebol. O futsal
 * vem primeiro porque "futebol de salão" **é** futsal.
 */
export function inferSportCode(name: string | undefined | null): SportCode | null {
  const n = (name ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (/futsal|salao|futebol\s*de\s*5/.test(n)) return "futsal";
  if (/futebol|futbol|football|soccer/.test(n)) return "football";
  if (/basquet|basket/.test(n)) return "basketball";
  return null;
}

/**
 * O perfil de uma modalidade — nulo quando ela não tem disciplina.
 *
 * O código gravado ganha, e o **nome** serve de rede: uma modalidade chamada
 * "Futebol" tem área técnica de futebol mesmo que o código ainda não tenha
 * sido escrito. É o que evita repetir o buraco em que a disciplina estava
 * certa na base de dados e o menu aparecia vazio.
 */
export function profileOf(sport: Sport | null | undefined): SportProfile | null {
  if (!sport) return null;
  const code = isSportCode(sport.code) ? sport.code : inferSportCode(sport.name);
  return code ? SPORT_PROFILES[code] : null;
}

/** As modalidades do clube que têm Área técnica, pela ordem do arranque. */
export function profiledSports(sports: Sport[] = storeAcademy.sports): Sport[] {
  return sports.filter((s) => profileOf(s) !== null);
}

/** A modalidade e o perfil, a partir do id — a pergunta que a rota faz. */
export function sportAreaById(sportId: string | null | undefined): { sport: Sport; profile: SportProfile } | null {
  const sport = sportId ? storeAcademy.sports.find((s) => s.id === sportId) : undefined;
  const profile = profileOf(sport);
  return sport && profile ? { sport, profile } : null;
}

/** As categorias de objectivo de uma modalidade — as do futebol quando não há perfil. */
export function categoriesFor(sportId: string | null | undefined): ObjectiveCategory[] {
  return sportAreaById(sportId)?.profile.exercises.categories ?? OBJECTIVE_CATEGORIES;
}

export function moduleSlug(profile: SportProfile, module: ModuleKey): string {
  return profile[module].slug;
}

export function moduleOf(profile: SportProfile, slug: string | undefined): ModuleKey | null {
  return MODULES.find((m) => profile[m].slug === slug) ?? null;
}

export const sportPath = (sportId: string) => `/modalidades/${sportId}`;

export function modulePath(sportId: string, profile: SportProfile, module: ModuleKey, id?: string): string {
  return `${sportPath(sportId)}/${moduleSlug(profile, module)}${id ? `/${id}` : ""}`;
}

/**
 * O caminho para a ficha de um exercício a partir de fora da área — do plano
 * de treino, por exemplo. Com a modalidade conhecida e com perfil vai directo;
 * sem ela cai no caminho antigo, que resolve a modalidade pelo próprio
 * exercício e reencaminha.
 */
export function exercisePath(sportId: string | null | undefined, exerciseId: string): string {
  const area = sportAreaById(sportId);
  return area ? modulePath(area.sport.id, area.profile, "exercises", exerciseId) : `/exercicios/${exerciseId}`;
}

export function allKinds(groups: KindGroup[]): KindOption[] {
  return groups.flatMap((g) => g.kinds);
}

/** O rótulo de um tipo — o próprio texto quando é personalizado. */
export function kindLabel(groups: KindGroup[], key: string): string {
  return allKinds(groups).find((k) => k.key === key)?.label ?? key;
}

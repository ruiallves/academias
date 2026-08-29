import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from "@/lib/http";
import { academy as storeAcademy, teams as storeTeams } from "@/lib/store";
import { categoryColor, type CategoricalColor } from "@academia/ui/tokens";

/**
 * A fronteira de dados da área técnica.
 *
 * Como o scouting, isto **não** entra no bootstrap: uma biblioteca de exercícios
 * a trabalhar acumula centenas de desenhos com frames, e trazê-la toda à entrada
 * seria pagar por uma área que metade das pessoas nem abre. Cada ecrã pede o que
 * precisa.
 *
 * Vive aqui também o **vocabulário do treino** — categorias de objetivos, tipos
 * de bola parada, sistemas — e a **aritmética da carga**. São vocabulário da
 * interface e valores por omissão do futebol de formação, não schema: o que se
 * grava é texto, e um clube que fale diferente escreve diferente.
 */

/* -------------------------------------------------------------------------- */
/* Objetivos                                                                   */
/* -------------------------------------------------------------------------- */

export type ObjectiveCategory = {
  key: string;
  label: string;
  color: CategoricalColor;
  subs: string[];
};

/**
 * A taxonomia de objetivos — o que alimenta o "tempo por objetivo" do plano e a
 * distribuição semanal do dashboard. As cores vêm da paleta categórica, como os
 * escalões no calendário: categoria é preenchimento, nunca estado.
 */
export const OBJECTIVE_CATEGORIES: ObjectiveCategory[] = [
  {
    key: "of",
    label: "Organização ofensiva",
    color: categoryColor(0),
    subs: [
      "Construção",
      "Progressão",
      "Criação",
      "Finalização",
      "Ataque posicional",
      "Jogo entre linhas",
      "Ataque à profundidade",
    ],
  },
  {
    key: "def",
    label: "Organização defensiva",
    color: categoryColor(1),
    subs: [
      "Pressão",
      "Bloco alto",
      "Bloco médio",
      "Bloco baixo",
      "Coberturas",
      "Contenção",
      "Defesa da profundidade",
    ],
  },
  {
    key: "trans",
    label: "Transições",
    color: categoryColor(2),
    subs: ["Transição ofensiva", "Transição defensiva", "Reação à perda", "Reação à recuperação"],
  },
  {
    key: "bp",
    label: "Bolas paradas",
    color: categoryColor(3),
    subs: ["Cantos ofensivos", "Cantos defensivos", "Livres ofensivos", "Livres defensivos", "Lançamentos"],
  },
  {
    key: "fis",
    label: "Físico",
    color: categoryColor(6),
    subs: ["Resistência", "Velocidade", "Aceleração", "Força", "Potência", "Mobilidade", "Recuperação"],
  },
  {
    key: "tec",
    label: "Técnico",
    color: categoryColor(5),
    subs: ["Passe", "Receção", "Condução", "Drible", "Finalização", "Cruzamento"],
  },
];

export function categoryByLabel(label: string | null | undefined): ObjectiveCategory | undefined {
  return OBJECTIVE_CATEGORIES.find((c) => c.label === label);
}

/** Tipos de sessão — vocabulário, não enum. */
export const SESSION_TYPES = [
  "Aquisitivo",
  "Manutenção",
  "Recuperação",
  "Pré-competitivo",
  "Compensatório",
] as const;

/* -------------------------------------------------------------------------- */
/* Carga                                                                       */
/* -------------------------------------------------------------------------- */

export type LoadLabel = "Baixa" | "Moderada" | "Alta" | "Muito alta";

export type SessionLoad = {
  /** Minutos planeados — a soma dos blocos. */
  volume: number;
  /** 0–100: intensidade média ponderada pela duração, ×10. */
  score: number;
  label: LoadLabel;
  tone: "ok" | "signal" | "warn" | "risk";
};

/**
 * A estimativa de carga de uma sessão.
 *
 * Deliberadamente simples — duração × intensidade, ponderada — e deliberadamente
 * **derivada**: nunca se guarda, por isso nunca mente depois de uma edição. O
 * dia em que houver carga realizada (RPE dos atletas, GPS), esta passa a ser "a
 * planeada" e compara-se com a real; a aritmética troca-se aqui e em mais lado
 * nenhum.
 */
export function sessionLoad(
  blocks: { durationMin: number; intensity?: number | null }[],
  sessionIntensity?: number | null,
): SessionLoad {
  const volume = blocks.reduce((acc, b) => acc + b.durationMin, 0);
  const fallback = sessionIntensity ?? 5;
  const weighted = blocks.reduce((acc, b) => acc + b.durationMin * (b.intensity ?? fallback), 0);
  const score = volume > 0 ? Math.round((weighted / volume) * 10) : sessionIntensity ? sessionIntensity * 10 : 0;
  return { volume, score, ...loadLabel(score) };
}

export function loadLabel(score: number): { label: LoadLabel; tone: SessionLoad["tone"] } {
  if (score < 40) return { label: "Baixa", tone: "ok" };
  if (score < 60) return { label: "Moderada", tone: "signal" };
  if (score < 80) return { label: "Alta", tone: "warn" };
  return { label: "Muito alta", tone: "risk" };
}

/** Minutos por categoria de objetivo — a barra "tempo por objetivo". */
export function minutesByCategory(
  blocks: { durationMin: number; category?: string | null }[],
): { category: ObjectiveCategory | undefined; label: string; minutes: number }[] {
  const map = new Map<string, number>();
  for (const b of blocks) {
    const key = b.category?.trim() || "Outro";
    map.set(key, (map.get(key) ?? 0) + b.durationMin);
  }
  return [...map.entries()]
    .map(([label, minutes]) => ({ label, minutes, category: categoryByLabel(label) }))
    .sort((a, b) => b.minutes - a.minutes);
}

/* -------------------------------------------------------------------------- */
/* Desenho tático                                                              */
/* -------------------------------------------------------------------------- */

/**
 * A variante do jogo.
 *
 * Um clube de formação não joga uma modalidade — joga cinco. O Sub-7 faz
 * futebol 5 num campo de 42×25, o Sub-11 faz futebol 7, o Sub-13 futebol 9, e
 * só a partir dos Sub-15 se joga no campo inteiro; o futsal tem o seu pavilhão.
 * Cada uma tem **outras medidas, outras marcações e outros sistemas** — um
 * 2-3-1 não existe em campo de onze, e um 4-3-3 não cabe num campo de 7.
 *
 * Por isso a variante é uma propriedade **do desenho**, como o terreno sempre
 * foi: cada exercício, esquema ou modelo diz em que jogo vive, e a mesma
 * biblioteca serve o clube inteiro sem um "modo" global a decidir por todos.
 */
export type GameFormat = "f11" | "f9" | "f7" | "f5" | "futsal";

export const GAME_FORMATS: GameFormat[] = ["f11", "f9", "f7", "f5", "futsal"];

export const FORMAT_LABEL: Record<GameFormat, string> = {
  f11: "Futebol 11",
  f9: "Futebol 9",
  f7: "Futebol 7",
  f5: "Futebol 5",
  futsal: "Futsal",
};

/**
 * As medidas de cada terreno, em metros — o referencial das coordenadas.
 *
 * São as da FPF para a formação, arredondadas ao que os campos realmente têm.
 * O futsal é o único coberto (`indoor`), e o único com áreas em arco em vez de
 * retangulares — é a diferença que mais salta à vista num desenho.
 */
export type PitchSpec = {
  w: number;
  h: number;
  /** Raio do círculo central. */
  circle: number;
  /** Área de grande penalidade: profundidade × largura. Nula no futsal (arco). */
  box: { depth: number; width: number } | null;
  /** Área pequena, onde existe. */
  goalArea: { depth: number; width: number } | null;
  /** Raio do arco da área — só o futsal. */
  arc: number | null;
  /** Marca de penálti, à linha de fundo. */
  penalty: number;
  /** A segunda marca (10 m) — só o futsal. */
  secondPenalty: number | null;
  /** Largura da baliza. */
  goal: number;
  /** Pavilhão em vez de relva: muda o piso e a espessura das linhas. */
  indoor: boolean;
};

export const FORMAT_PITCH: Record<GameFormat, PitchSpec> = {
  f11: { w: 105, h: 68, circle: 9.15, box: { depth: 16.5, width: 40.32 }, goalArea: { depth: 5.5, width: 18.32 }, arc: null, penalty: 11, secondPenalty: null, goal: 7.32, indoor: false },
  f9: { w: 72, h: 50, circle: 7, box: { depth: 13, width: 26 }, goalArea: { depth: 4, width: 12 }, arc: null, penalty: 9, secondPenalty: null, goal: 6, indoor: false },
  f7: { w: 55, h: 37, circle: 6, box: { depth: 10, width: 20 }, goalArea: null, arc: null, penalty: 8, secondPenalty: null, goal: 6, indoor: false },
  // A área do futebol 5 tem de conter a marca de penálti — com 6 m de
  // profundidade e a marca aos 7, a marca caía fora da própria área.
  f5: { w: 42, h: 25, circle: 4, box: { depth: 8, width: 16 }, goalArea: null, arc: null, penalty: 6, secondPenalty: null, goal: 3, indoor: false },
  futsal: { w: 40, h: 20, circle: 3, box: null, goalArea: null, arc: 6, penalty: 6, secondPenalty: 10, goal: 3, indoor: true },
};

/**
 * O terreno do desenho: a variante mais a extensão (inteiro ou meio campo).
 *
 * `"full"` e `"half"` são os nomes de quando só havia futebol de onze, e ficam
 * para sempre porque estão gravados em desenhos que já existem — `asDiagram`
 * traduz-os para `f11`/`f11-half` na leitura, e a escrita usa só os novos. Um
 * dado antigo nunca se migra por estética.
 */
export type FieldKind = GameFormat | `${GameFormat}-half`;

export function formatOf(f: FieldKind): GameFormat {
  const base = f.endsWith("-half") ? f.slice(0, -5) : f;
  return (GAME_FORMATS as string[]).includes(base) ? (base as GameFormat) : "f11";
}

export const isHalfField = (f: FieldKind) => f.endsWith("-half");
export const isIndoorField = (f: FieldKind) => FORMAT_PITCH[formatOf(f)].indoor;
/** Mantido para quem só quer saber se é pavilhão. Gémeo de `isIndoorField`. */
export const isFutsalField = isIndoorField;

/** O terreno que corresponde a uma variante e a uma extensão. */
export function fieldFor(format: GameFormat, half: boolean): FieldKind {
  return half ? (`${format}-half` as FieldKind) : format;
}

/** As medidas do terreno, em metros — é o referencial das coordenadas. */
export function fieldSize(f: FieldKind): { w: number; h: number } {
  const s = FORMAT_PITCH[formatOf(f)];
  return { w: s.w, h: s.h };
}

export const FIELD_LABEL: Record<FieldKind, string> = Object.fromEntries(
  GAME_FORMATS.flatMap((f) => [
    [f, FORMAT_LABEL[f]],
    [`${f}-half`, `Meio ${FORMAT_LABEL[f].toLowerCase()}`],
  ]),
) as Record<FieldKind, string>;

/** O nome de um desporto diz futsal? Texto, como tudo o resto. */
export const isFutsalSportName = (name: string | undefined | null) => /futsal/i.test(name ?? "");

/**
 * A variante por omissão de uma equipa.
 *
 * Duas fontes, por ordem de confiança:
 *
 *  1. **O nome do desporto**, quando ele o diz — "Futsal", "Futebol 7". É o
 *     que a academia escreveu, e ganha sempre.
 *  2. **A idade da equipa**, que na formação portuguesa decide o formato:
 *     até aos 7 joga-se a 5, aos 9 e 11 a 7, aos 13 a 9, e dos 15 para cima a
 *     11. É a convenção da FPF, e acerta na esmagadora maioria dos casos.
 *
 * É um **ponto de partida**, nunca uma imposição: o seletor está sempre lá, e
 * um clube que jogue de outra forma troca num gesto.
 */
export function teamFormat(teamId: string | null | undefined): GameFormat {
  const team = teamId ? storeTeams.find((t) => t.id === teamId) : undefined;
  const sport = team ? storeAcademy.sports.find((s) => s.id === team.sportId) : undefined;
  const name = sport?.name ?? "";

  if (isFutsalSportName(name)) return "futsal";
  // "Futebol 7", "Futebol de 9" — o número na modalidade é a variante.
  const declared = /\b(?:de\s*)?(5|7|9|11)\b/.exec(name);
  if (declared) return `f${declared[1]}` as GameFormat;

  const age = team?.maxAge ?? 99;
  if (age <= 7) return "f5";
  if (age <= 11) return "f7";
  if (age <= 13) return "f9";
  return "f11";
}

/**
 * A variante mais provável do clube — a que mais equipas jogam.
 *
 * Serve o exercício novo, que não pertence a equipa nenhuma e por isso não tem
 * de quem herdar. Um clube só de futsal criava exercícios em campo de onze e
 * tinha de trocar o terreno de cada vez; assim começa onde trabalha. Empate
 * resolve-se pelo campo maior, que é o mais fácil de encolher a seguir.
 */
export function clubDefaultFormat(): GameFormat {
  const counts = new Map<GameFormat, number>();
  for (const t of storeTeams) counts.set(teamFormat(t.id), (counts.get(teamFormat(t.id)) ?? 0) + 1);
  let best: GameFormat = "f11";
  let most = 0;
  for (const f of GAME_FORMATS) {
    const n = counts.get(f) ?? 0;
    if (n > most) {
      most = n;
      best = f;
    }
  }
  return best;
}

export type ItemKind =
  | "player"
  | "playerBall"
  | "gk"
  | "opponent"
  | "ball"
  | "cone"
  | "pole"
  | "barrier"
  | "goal"
  | "miniGoal"
  | "ladder"
  | "dummy"
  | "zone"
  | "text";

/** Um elemento no campo. Coordenadas em metros de campo: 0–105 × 0–68. */
export type DiagramItem = {
  id: string;
  kind: ItemKind;
  x: number;
  y: number;
  /** Só as zonas (e barreiras) têm dimensões. */
  w?: number;
  h?: number;
  /** Rotação em graus, para o que tem orientação: balizas, barreiras, zonas. */
  rot?: number;
  /** Número do jogador, texto da etiqueta, nome da zona. */
  label?: string;
};

export type ArrowKind = "pass" | "run" | "dribble" | "shot" | "press" | "cross";

export type DiagramArrow = {
  id: string;
  kind: ArrowKind;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

export type DiagramFrame = {
  id: string;
  /** Quanto tempo a animação fica neste frame antes de deslizar para o próximo. */
  durationMs?: number;
  note?: string;
  items: DiagramItem[];
  arrows: DiagramArrow[];
};

export type Diagram = {
  field: FieldKind;
  frames: DiagramFrame[];
};

export const ARROW_LABEL: Record<ArrowKind, string> = {
  pass: "Passe",
  run: "Deslocamento",
  dribble: "Condução",
  shot: "Remate",
  press: "Pressão",
  cross: "Cruzamento",
};

export const ITEM_LABEL: Record<ItemKind, string> = {
  player: "Jogador",
  playerBall: "Jogador c/ bola",
  gk: "Guarda-redes",
  opponent: "Adversário",
  ball: "Bola",
  cone: "Cone",
  pole: "Estaca",
  barrier: "Barreira",
  goal: "Baliza",
  miniGoal: "Mini-baliza",
  ladder: "Escada",
  dummy: "Boneco",
  zone: "Zona",
  text: "Texto",
};

export function emptyDiagram(field: FieldKind = "f11"): Diagram {
  return { field, frames: [{ id: newId(), durationMs: 1200, items: [], arrows: [] }] };
}

/**
 * O terreno de um desenho gravado, traduzido para o vocabulário de hoje.
 *
 * `"full"`/`"half"` são de quando só havia futebol de onze e continuam em
 * desenhos guardados — lêem-se para sempre. Um valor que não se reconheça cai
 * para campo inteiro de 11, que é a leitura segura de um dado estranho.
 */
export function normalizeField(value: unknown): FieldKind {
  if (typeof value !== "string") return "f11";
  if (value === "full") return "f11";
  if (value === "half") return "f11-half";
  const base = value.endsWith("-half") ? value.slice(0, -5) : value;
  if (!(GAME_FORMATS as string[]).includes(base)) return "f11";
  return value as FieldKind;
}

export function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** Lê um diagram vindo da API sem confiar na forma. */
export function asDiagram(value: unknown): Diagram | null {
  const d = value as Diagram | null;
  if (!d || !Array.isArray(d.frames) || d.frames.length === 0) return null;
  return {
    // Ver `normalizeField`: os nomes antigos traduzem-se, o resto passa.
    field: normalizeField(d.field),
    frames: d.frames.map((f) => ({
      id: f.id ?? newId(),
      durationMs: f.durationMs,
      note: f.note,
      items: Array.isArray(f.items) ? f.items : [],
      arrows: Array.isArray(f.arrows) ? f.arrows : [],
    })),
  };
}

/* -------------------------------------------------------------------------- */
/* Bolas paradas e sistemas                                                    */
/* -------------------------------------------------------------------------- */

export const SET_PIECE_KINDS = [
  { key: "corner-off", label: "Cantos ofensivos" },
  { key: "corner-def", label: "Cantos defensivos" },
  { key: "free-off", label: "Livres ofensivos" },
  { key: "free-def", label: "Livres defensivos" },
  { key: "throw-in", label: "Lançamentos" },
  { key: "penalty", label: "Penáltis" },
] as const;

export type SetPieceKindKey = (typeof SET_PIECE_KINDS)[number]["key"];

export function setPieceLabel(key: string): string {
  return SET_PIECE_KINDS.find((k) => k.key === key)?.label ?? key;
}

export type LineupSlot = { id: string; label: string; x: number; y: number };

/**
 * Em que jogo vive um modelo.
 *
 * Era `"football" | "futsal"`, de quando só existiam esses dois. Passou a ser
 * a variante inteira, e a leitura traduz o vocabulário antigo (`asLineupData`).
 */
export type LineupPitch = GameFormat;

/**
 * O `lineup` de um modelo, tal como se grava: o terreno e as posições.
 *
 * Os primeiros modelos gravaram só o array de posições — o terreno era sempre
 * futebol, porque era o único que existia. Lê-se as três formas para sempre;
 * grava-se sempre a mais recente.
 */
export type LineupData = { pitch: LineupPitch; slots: LineupSlot[] };

/** `"football"` era o campo de onze antes de as variantes existirem. */
function asLineupPitch(value: unknown): LineupPitch {
  if (value === "football") return "f11";
  return typeof value === "string" && (GAME_FORMATS as string[]).includes(value) ? (value as GameFormat) : "f11";
}

export function asLineupData(value: unknown): LineupData {
  if (Array.isArray(value)) {
    return { pitch: "f11", slots: (value as LineupSlot[]).filter((s) => s && typeof s.x === "number") };
  }
  const v = value as LineupData | null;
  if (v && Array.isArray(v.slots)) {
    return { pitch: asLineupPitch(v.pitch), slots: v.slots.filter((s) => s && typeof s.x === "number") };
  }
  return { pitch: "f11", slots: [] };
}

type SystemSpec = { label: string; slots: [string, number, number][] };

/**
 * Sistemas de partida — pontos de partida, nunca limites: o treinador arrasta
 * cada posição para onde o modelo dele manda, e o que se grava são coordenadas.
 * Campo horizontal, a nossa equipa a atacar da esquerda para a direita.
 *
 * Cada lista está nos **metros do seu próprio campo** e não em frações: um
 * "DC a 20 metros da linha" lê-se e corrige-se; um `0.19` não diz nada a
 * ninguém, e ao primeiro erro ninguém o apanharia.
 */
export const FOOTBALL_SYSTEMS: SystemSpec[] = [
  {
    label: "4-3-3",
    slots: [
      ["GR", 6, 34],
      ["DD", 24, 10], ["DC", 20, 25], ["DC", 20, 43], ["DE", 24, 58],
      ["MC", 40, 34], ["MI", 52, 20], ["MI", 52, 48],
      ["ED", 72, 10], ["PL", 78, 34], ["EE", 72, 58],
    ],
  },
  {
    label: "4-4-2",
    slots: [
      ["GR", 6, 34],
      ["DD", 24, 10], ["DC", 20, 25], ["DC", 20, 43], ["DE", 24, 58],
      ["MD", 50, 10], ["MC", 44, 26], ["MC", 44, 42], ["ME", 50, 58],
      ["PL", 76, 26], ["PL", 76, 42],
    ],
  },
  {
    label: "4-2-3-1",
    slots: [
      ["GR", 6, 34],
      ["DD", 24, 10], ["DC", 20, 25], ["DC", 20, 43], ["DE", 24, 58],
      ["MDC", 40, 26], ["MDC", 40, 42],
      ["MD", 60, 12], ["MCO", 58, 34], ["ME", 60, 56],
      ["PL", 78, 34],
    ],
  },
  {
    label: "4-1-4-1",
    slots: [
      ["GR", 6, 34],
      ["DD", 24, 10], ["DC", 20, 25], ["DC", 20, 43], ["DE", 24, 58],
      ["MDC", 36, 34],
      ["MD", 54, 10], ["MC", 50, 25], ["MC", 50, 43], ["ME", 54, 58],
      ["PL", 78, 34],
    ],
  },
  {
    // O losango do meio-campo — a variante do 4-4-2 que muda tudo por dentro.
    label: "4-3-1-2 (losango)",
    slots: [
      ["GR", 6, 34],
      ["DD", 24, 10], ["DC", 20, 25], ["DC", 20, 43], ["DE", 24, 58],
      ["MDC", 38, 34], ["MC", 47, 20], ["MC", 47, 48], ["MCO", 58, 34],
      ["PL", 76, 26], ["PL", 76, 42],
    ],
  },
  {
    label: "4-2-2-2",
    slots: [
      ["GR", 6, 34],
      ["DD", 24, 10], ["DC", 20, 25], ["DC", 20, 43], ["DE", 24, 58],
      ["MDC", 40, 26], ["MDC", 40, 42],
      ["MCO", 58, 18], ["MCO", 58, 50],
      ["PL", 76, 27], ["PL", 76, 41],
    ],
  },
  {
    label: "4-4-1-1",
    slots: [
      ["GR", 6, 34],
      ["DD", 24, 10], ["DC", 20, 25], ["DC", 20, 43], ["DE", 24, 58],
      ["MD", 50, 10], ["MC", 44, 26], ["MC", 44, 42], ["ME", 50, 58],
      ["SA", 64, 34], ["PL", 78, 34],
    ],
  },
  {
    label: "4-5-1",
    slots: [
      ["GR", 6, 34],
      ["DD", 24, 10], ["DC", 20, 25], ["DC", 20, 43], ["DE", 24, 58],
      ["MD", 50, 8], ["MC", 45, 22], ["MDC", 42, 34], ["MC", 45, 46], ["ME", 50, 60],
      ["PL", 76, 34],
    ],
  },
  {
    label: "3-4-3",
    slots: [
      ["GR", 6, 34],
      ["DC", 20, 17], ["DC", 18, 34], ["DC", 20, 51],
      ["MD", 46, 8], ["MC", 42, 26], ["MC", 42, 42], ["ME", 46, 60],
      ["ED", 72, 14], ["PL", 78, 34], ["EE", 72, 54],
    ],
  },
  {
    label: "3-4-2-1",
    slots: [
      ["GR", 6, 34],
      ["DC", 20, 17], ["DC", 18, 34], ["DC", 20, 51],
      ["AD", 46, 7], ["MC", 42, 26], ["MC", 42, 42], ["AE", 46, 61],
      ["MCO", 63, 23], ["MCO", 63, 45], ["PL", 78, 34],
    ],
  },
  {
    label: "3-5-2",
    slots: [
      ["GR", 6, 34],
      ["DC", 20, 17], ["DC", 18, 34], ["DC", 20, 51],
      ["AD", 48, 6], ["MC", 42, 22], ["MDC", 38, 34], ["MC", 42, 46], ["AE", 48, 62],
      ["PL", 76, 26], ["PL", 76, 42],
    ],
  },
  {
    label: "5-3-2",
    slots: [
      ["GR", 6, 34],
      ["AD", 28, 6], ["DC", 20, 20], ["DC", 17, 34], ["DC", 20, 48], ["AE", 28, 62],
      ["MC", 44, 20], ["MC", 40, 34], ["MC", 44, 48],
      ["PL", 74, 26], ["PL", 74, 42],
    ],
  },
  {
    label: "5-4-1",
    slots: [
      ["GR", 6, 34],
      ["AD", 28, 6], ["DC", 20, 20], ["DC", 17, 34], ["DC", 20, 48], ["AE", 28, 62],
      ["MD", 48, 12], ["MC", 44, 26], ["MC", 44, 42], ["ME", 48, 56],
      ["PL", 74, 34],
    ],
  },
];

/**
 * Os sistemas do futsal — GR mais quatro, num campo de 40×20.
 *
 * São os quatro clássicos: **3-1** (fixo, duas alas, pivô — o mais jogado),
 * **4-0** (quatro em linha, rotação total, sem pivô fixo), **2-2** (o quadrado)
 * e **1-2-1** (o losango). A "saída a 5" é o power play com GR-jogador.
 */
export const FUTSAL_SYSTEMS: SystemSpec[] = [
  {
    label: "3-1 (pivô)",
    slots: [["GR", 3, 10], ["FX", 13, 10], ["AD", 22, 4], ["AE", 22, 16], ["PV", 31, 10]],
  },
  {
    label: "4-0 (rotação)",
    slots: [["GR", 3, 10], ["U", 19, 3.5], ["U", 17, 7.8], ["U", 17, 12.2], ["U", 19, 16.5]],
  },
  {
    label: "2-2 (quadrado)",
    slots: [["GR", 3, 10], ["D", 15, 6], ["D", 15, 14], ["A", 28, 6], ["A", 28, 14]],
  },
  {
    label: "1-2-1 (losango)",
    slots: [["GR", 3, 10], ["FX", 12, 10], ["AD", 21, 4.5], ["AE", 21, 15.5], ["PV", 30, 10]],
  },
  {
    label: "Saída a 5 (GR-jogador)",
    slots: [["GRJ", 15, 10], ["AD", 24, 3.5], ["AE", 24, 16.5], ["U", 30, 7], ["U", 30, 13]],
  },
];

/**
 * Futebol 9 (GR + 8), em campo de 72×50.
 *
 * O escalão da passagem: já há três linhas a sério, mas ainda sem alas puros —
 * o 3-3-2 e o 3-2-3 são os que a formação portuguesa mais usa para preparar a
 * mudança para o campo inteiro.
 */
export const F9_SYSTEMS: SystemSpec[] = [
  {
    label: "3-3-2",
    slots: [["GR", 5, 25], ["DD", 16, 10], ["DC", 13, 25], ["DE", 16, 40], ["MD", 35, 10], ["MC", 32, 25], ["ME", 35, 40], ["PL", 52, 18], ["PL", 52, 32]],
  },
  {
    label: "3-2-3",
    slots: [["GR", 5, 25], ["DD", 16, 10], ["DC", 13, 25], ["DE", 16, 40], ["MC", 33, 18], ["MC", 33, 32], ["ED", 50, 9], ["PL", 55, 25], ["EE", 50, 41]],
  },
  {
    label: "2-3-3",
    slots: [["GR", 5, 25], ["DC", 14, 17], ["DC", 14, 33], ["MD", 33, 9], ["MC", 30, 25], ["ME", 33, 41], ["ED", 50, 10], ["PL", 54, 25], ["EE", 50, 40]],
  },
  {
    label: "3-4-1",
    slots: [["GR", 5, 25], ["DD", 16, 10], ["DC", 13, 25], ["DE", 16, 40], ["MD", 34, 7], ["MC", 31, 19], ["MC", 31, 31], ["ME", 34, 43], ["PL", 53, 25]],
  },
  {
    label: "2-4-2",
    slots: [["GR", 5, 25], ["DC", 14, 17], ["DC", 14, 33], ["MD", 32, 7], ["MC", 29, 19], ["MC", 29, 31], ["ME", 32, 43], ["PL", 52, 18], ["PL", 52, 32]],
  },
  {
    label: "3-1-3-1",
    slots: [["GR", 5, 25], ["DD", 16, 10], ["DC", 13, 25], ["DE", 16, 40], ["MDC", 26, 25], ["MD", 38, 9], ["MCO", 38, 25], ["ME", 38, 41], ["PL", 54, 25]],
  },
];

/**
 * Futebol 7 (GR + 6), em campo de 55×37.
 *
 * O 2-3-1 é o sistema que a formação usa para ensinar a ocupar o espaço: dois
 * atrás, três a abrir, um em cima. O 3-2-1 (o "pinheiro") é o outro.
 */
export const F7_SYSTEMS: SystemSpec[] = [
  { label: "2-3-1", slots: [["GR", 4, 18.5], ["DD", 13, 10], ["DE", 13, 27], ["MD", 27, 7], ["MC", 24, 18.5], ["ME", 27, 30], ["PL", 41, 18.5]] },
  { label: "3-2-1", slots: [["GR", 4, 18.5], ["DD", 13, 8], ["DC", 11, 18.5], ["DE", 13, 29], ["MC", 26, 13], ["MC", 26, 24], ["PL", 41, 18.5]] },
  { label: "1-3-2", slots: [["GR", 4, 18.5], ["DC", 11, 18.5], ["MD", 24, 8], ["MC", 22, 18.5], ["ME", 24, 29], ["PL", 39, 13], ["PL", 39, 24]] },
  { label: "2-2-2", slots: [["GR", 4, 18.5], ["DD", 12, 12], ["DE", 12, 25], ["MC", 25, 12], ["MC", 25, 25], ["PL", 40, 12], ["PL", 40, 25]] },
  { label: "3-1-2", slots: [["GR", 4, 18.5], ["DD", 13, 8], ["DC", 11, 18.5], ["DE", 13, 29], ["MC", 25, 18.5], ["PL", 40, 13], ["PL", 40, 24]] },
  { label: "2-1-3", slots: [["GR", 4, 18.5], ["DD", 12, 11], ["DE", 12, 26], ["MC", 23, 18.5], ["ED", 38, 7], ["PL", 42, 18.5], ["EE", 38, 30]] },
];

/**
 * Futebol 5 de campo (GR + 4), em 42×25.
 *
 * As formas são as do futsal — é o mesmo jogo de quatro jogadores de campo —
 * mas o terreno é relva e maior, por isso as posições são próprias.
 */
export const F5_SYSTEMS: SystemSpec[] = [
  { label: "1-2-1 (losango)", slots: [["GR", 3.5, 12.5], ["FX", 13, 12.5], ["AD", 22, 5.5], ["AE", 22, 19.5], ["PV", 32, 12.5]] },
  { label: "2-2 (quadrado)", slots: [["GR", 3.5, 12.5], ["D", 15, 7], ["D", 15, 18], ["A", 30, 7], ["A", 30, 18]] },
  { label: "3-1 (pivô)", slots: [["GR", 3.5, 12.5], ["FX", 14, 12.5], ["AD", 23, 5], ["AE", 23, 20], ["PV", 33, 12.5]] },
  { label: "4-0 (rotação)", slots: [["GR", 3.5, 12.5], ["U", 20, 4.5], ["U", 18, 10], ["U", 18, 15], ["U", 20, 20.5]] },
];

const SYSTEMS_BY_FORMAT: Record<GameFormat, SystemSpec[]> = {
  f11: FOOTBALL_SYSTEMS,
  f9: F9_SYSTEMS,
  f7: F7_SYSTEMS,
  f5: F5_SYSTEMS,
  futsal: FUTSAL_SYSTEMS,
};

export function systemsFor(pitch: LineupPitch): SystemSpec[] {
  return SYSTEMS_BY_FORMAT[pitch] ?? FOOTBALL_SYSTEMS;
}

export function systemLineup(label: string, pitch: LineupPitch = "f11"): LineupSlot[] {
  const list = systemsFor(pitch);
  const sys = list.find((s) => s.label === label) ?? list[0];
  return sys.slots.map(([slot, x, y]) => ({ id: newId(), label: slot, x, y }));
}

/** As quatro secções escritas de um modelo de jogo. */
export const PRINCIPLE_SECTIONS = [
  {
    key: "offensive",
    label: "Organização ofensiva",
    topics: ["Saída de bola", "Construção", "Progressão", "Criação", "Finalização"],
  },
  {
    key: "defensive",
    label: "Organização defensiva",
    topics: ["Pressão", "Bloco", "Linha defensiva", "Coberturas", "Comportamento após perda"],
  },
  {
    key: "transitions",
    label: "Transições",
    topics: ["Transição ofensiva", "Transição defensiva"],
  },
  {
    key: "setPieces",
    label: "Bolas paradas",
    topics: ["Cantos", "Livres", "Lançamentos"],
  },
] as const;

export type Principles = Record<string, Record<string, string>>;

/* -------------------------------------------------------------------------- */
/* O que a API devolve                                                         */
/* -------------------------------------------------------------------------- */

export type Visibility = "PRIVATE" | "CLUB";

export type ExerciseSummary = {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  objectives: string[];
  phase: string | null;
  type: string | null;
  intensity: number | null;
  players: string | null;
  durationMin: number | null;
  space: string | null;
  material: string | null;
  ageMin: number | null;
  ageMax: number | null;
  complexity: number | null;
  visibility: Visibility;
  videoUrl: string | null;
  thumbnail: unknown;
  frames: number;
  mine: boolean;
  authorName: string | null;
  favorite: boolean;
  usageCount: number;
  lastUsedAt: string | null;
  updatedAt: string;
};

export type ExerciseImage = { key: string; url: string };

export type ExerciseFull = Omit<ExerciseSummary, "thumbnail" | "frames" | "favorite" | "usageCount" | "lastUsedAt"> & {
  rules: string | null;
  progressions: string | null;
  regressions: string | null;
  coachingPoints: string | null;
  commonErrors: string | null;
  diagram: unknown;
  images: ExerciseImage[];
  editable: boolean;
  /** Editar e apagar são portas diferentes: o que é do clube afina-se por
   * qualquer treinador, mas só a direção o tira da biblioteca. */
  deletable: boolean;
};

/**
 * Um bloco do plano.
 *
 * `space` e `material` saíram: são do **exercício**, e tê-los também aqui era a
 * mesma informação em dois sítios, a divergir à primeira correção. As colunas
 * continuam na base (não se apagam dados por arrumação) mas deixaram de ser
 * escritas — quem precisa das dimensões abre a ficha do exercício, que está a
 * um clique do bloco.
 */
export type PlanBlock = {
  id?: string;
  name: string;
  durationMin: number;
  category: string | null;
  objective: string | null;
  intensity: number | null;
  /** Quantos jogadores entram neste bloco. */
  players: string | null;
  notes: string | null;
  exerciseId: string | null;
  exerciseName?: string | null;
  exerciseThumb?: unknown;
};

export type SessionPlan = {
  sessionId: string;
  teamId: string;
  teamName: string;
  startsAt: string;
  endsAt: string;
  venue: string;
  status: string;
  coachName: string | null;
  mine: boolean;
  objective: string | null;
  objectives: string[];
  sessionType: string | null;
  intensity: number | null;
  expectedAthletes: number | null;
  material: string | null;
  planNotes: string | null;
  postNotes: string | null;
  blocks: PlanBlock[];
};

export type PlanSummary = {
  sessionId: string;
  teamId: string;
  objective: string | null;
  sessionType: string | null;
  intensity: number | null;
  blockCount: number;
  blocks: { durationMin: number; intensity: number | null; category: string | null }[];
};

export type GameModelRow = {
  id: string;
  name: string;
  system: string | null;
  teamId: string | null;
  teamName: string | null;
  visibility: Visibility;
  lineup: unknown;
  principles: unknown;
  notes: string | null;
  mine: boolean;
  editable: boolean;
  deletable: boolean;
  authorName: string | null;
  updatedAt: string;
};

export type SetPieceRow = {
  id: string;
  kind: string;
  name: string;
  description: string | null;
  teamId: string | null;
  teamName: string | null;
  visibility: Visibility;
  diagram: unknown;
  mine: boolean;
  editable: boolean;
  deletable: boolean;
  authorName: string | null;
  updatedAt: string;
};

/* -------------------------------------------------------------------------- */
/* Chamadas                                                                    */
/* -------------------------------------------------------------------------- */

export const listExercises = () => apiGet<ExerciseSummary[]>("/api/training/exercises");
export const getExercise = (id: string) => apiGet<ExerciseFull>(`/api/training/exercises/${id}`);
export const createExercise = (body: Partial<ExerciseFull>) =>
  apiPost<{ id: string }>("/api/training/exercises", body);
export const updateExercise = (id: string, body: Partial<ExerciseFull>) =>
  apiPatch<{ ok: true }>(`/api/training/exercises/${id}`, body);
export const deleteExercise = (id: string) => apiDelete<{ archived: boolean }>(`/api/training/exercises/${id}`);
export const duplicateExercise = (id: string) => apiPost<{ id: string }>(`/api/training/exercises/${id}/duplicate`, {});
export const setExerciseFavorite = (id: string, on: boolean) =>
  apiPut<{ ok: true }>(`/api/training/exercises/${id}/favorite`, { on });

/**
 * Uma imagem para a ficha do exercício — o caminho de três passos das
 * fotografias (`lib/photos.ts`): autorizar, carregar direto para o Supabase,
 * confirmar. Os bytes nunca passam pela nossa API.
 */
export async function uploadExerciseImage(exerciseId: string, file: File): Promise<ExerciseImage> {
  const types = ["image/jpeg", "image/png", "image/webp"];
  if (!types.includes(file.type)) throw new Error("A imagem tem de ser JPEG, PNG ou WebP.");
  if (file.size > 8 * 1024 * 1024) throw new Error("A imagem é grande de mais — o máximo são 8 MB.");

  const signed = await apiPost<{ url: string; token: string; key: string }>(
    `/api/training/exercises/${exerciseId}/images/upload`,
    { contentType: file.type },
  );
  const res = await fetch(signed.url, {
    method: "PUT",
    headers: { "Content-Type": file.type, ...(signed.token ? { Authorization: `Bearer ${signed.token}` } : {}) },
    body: file,
  });
  if (!res.ok) throw new Error("Não foi possível carregar a imagem.");

  return apiPost<ExerciseImage>(`/api/training/exercises/${exerciseId}/images`, { key: signed.key });
}

export const removeExerciseImage = (exerciseId: string, key: string) =>
  apiPost<{ ok: true }>(`/api/training/exercises/${exerciseId}/images/remove`, { key });

export const listPlans = (from?: string, to?: string) =>
  apiGet<PlanSummary[]>("/api/training/plans", { from, to });
export const getPlan = (sessionId: string) => apiGet<SessionPlan>(`/api/training/sessions/${sessionId}/plan`);
export const savePlan = (
  sessionId: string,
  body: Partial<Pick<SessionPlan, "objective" | "objectives" | "sessionType" | "intensity" | "expectedAthletes" | "material" | "planNotes" | "postNotes">> & {
    blocks?: Omit<PlanBlock, "id" | "exerciseName" | "exerciseThumb">[];
  },
) => apiPut<{ ok: true }>(`/api/training/sessions/${sessionId}/plan`, body);

export const listGameModels = () => apiGet<GameModelRow[]>("/api/training/game-models");
export const createGameModel = (body: Partial<GameModelRow>) =>
  apiPost<{ id: string }>("/api/training/game-models", body);
export const updateGameModel = (id: string, body: Partial<GameModelRow>) =>
  apiPatch<{ ok: true }>(`/api/training/game-models/${id}`, body);
export const deleteGameModel = (id: string) => apiDelete<{ ok: true }>(`/api/training/game-models/${id}`);

export const listSetPieces = () => apiGet<SetPieceRow[]>("/api/training/set-pieces");
export const createSetPiece = (body: Partial<SetPieceRow>) =>
  apiPost<{ id: string }>("/api/training/set-pieces", body);
export const updateSetPiece = (id: string, body: Partial<SetPieceRow>) =>
  apiPatch<{ ok: true }>(`/api/training/set-pieces/${id}`, body);
export const deleteSetPiece = (id: string) => apiDelete<{ ok: true }>(`/api/training/set-pieces/${id}`);

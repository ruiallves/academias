import type { ExerciseInput, PlanInput } from "../training/training.service";

/**
 * O planeador de treinos do Adjunto: a parte sem modelo.
 *
 * ## O que é
 *
 * "Faz um plano físico para o treino de amanhã dos sub-11" é um pedido que o
 * modelo da conversa não resolve bem: é redação longa, com estrutura (ativação,
 * parte principal, jogo, retorno à calma), com exercícios que têm de caber no
 * tempo e na idade, e com **desenhos no campo**, as peças e as setas do editor
 * da Área técnica. Por isso a conversa só recolhe o que a pessoa quer
 * (`planear_treino` em `acoes.ts`) e passa o trabalho a um pedido à parte, ao
 * modelo forte, com a resposta numa forma fixa (`ESQUEMA_DO_PLANO`).
 *
 * ## O que aqui vive
 *
 * O esquema da resposta, o texto do pedido, e a leitura do que o modelo devolve
 * para o que a Área técnica grava: `PlanInput` para a sessão e `ExerciseInput`
 * (com `diagram`) para cada exercício novo. O modelo desenha em **percentagem
 * do campo** (0 a 100 da esquerda para a direita e de cima para baixo); aqui
 * converte-se para os metros que o editor usa (ver `lib/training.ts` na
 * consola: 105×68 no futebol de onze, 28×15 no basquetebol). O modelo nunca
 * escreve na base: a proposta vai ao cartão e é a pessoa que confirma.
 */

/* -------------------------------------------------------------------------- */
/* O terreno                                                                   */
/* -------------------------------------------------------------------------- */

/** As variantes do editor, com as medidas em metros. É a cópia de `FORMAT_PITCH` da consola. */
export type Terreno = "f11" | "f9" | "f7" | "f5" | "futsal" | "basket";

export const TERRENOS: Record<Terreno, { w: number; h: number; nome: string; cestos: boolean }> = {
  f11: { w: 105, h: 68, nome: "futebol de 11", cestos: false },
  f9: { w: 72, h: 50, nome: "futebol de 9", cestos: false },
  f7: { w: 55, h: 37, nome: "futebol de 7", cestos: false },
  f5: { w: 42, h: 25, nome: "futebol de 5", cestos: false },
  futsal: { w: 40, h: 20, nome: "futsal", cestos: false },
  basket: { w: 28, h: 15, nome: "basquetebol", cestos: true },
};

/**
 * A variante de uma equipa, como a consola a escolhe (`teamFormat`): a
 * disciplina da modalidade manda; depois o nome ("Futebol 7"); depois a idade,
 * pela convenção da FPF (até aos 7 a cinco, aos 9 e 11 a sete, aos 13 a nove,
 * dos 15 para cima a onze).
 */
export function terrenoDaEquipa(e: { sportCode?: string | null; sportName: string; maxAge: number }): Terreno {
  if (e.sportCode === "basketball") return "basket";
  if (e.sportCode === "futsal" || /futsal/i.test(e.sportName)) return "futsal";
  const dito = /\b(?:de\s*)?(5|7|9|11)\b/.exec(e.sportName);
  if (dito) return `f${dito[1]}` as Terreno;
  if (e.maxAge <= 7) return "f5";
  if (e.maxAge <= 11) return "f7";
  if (e.maxAge <= 13) return "f9";
  return "f11";
}

/* -------------------------------------------------------------------------- */
/* O vocabulário do desenho                                                    */
/* -------------------------------------------------------------------------- */

/** As peças do editor que o modelo pode usar (`ItemKind` na consola, sem o `opponent` antigo). */
export const PECAS = ["player", "playerBall", "gk", "ball", "cone", "pole", "barrier", "goal", "miniGoal", "ladder", "dummy", "zone", "text"] as const;
export const SETAS = ["pass", "run", "dribble", "shot", "press", "cross"] as const;
/** Os coletes do seletor rápido da consola (`QUICK_COLORS`), pelo nome. */
export const CORES: Record<string, string> = {
  azul: "#1d3a5f",
  branco: "#f4f1ea",
  vermelho: "#b3261e",
  amarelo: "#ecc02c",
  verde: "#56c07a",
  preto: "#26231f",
};

const CATEGORIAS = ["Organização ofensiva", "Organização defensiva", "Transições", "Bolas paradas", "Físico", "Técnico"];
const TIPOS_DE_SESSAO = ["Aquisitivo", "Manutenção", "Recuperação", "Pré-competitivo", "Compensatório"];

/* -------------------------------------------------------------------------- */
/* O esquema da resposta                                                       */
/* -------------------------------------------------------------------------- */

const SEM_EXTRAS = { additionalProperties: false } as const;
const texto = { type: "string" } as const;
const textoOuNulo = { type: ["string", "null"] } as const;
const numeroOuNulo = { type: ["number", "null"] } as const;

/**
 * Um exercício novo, com a ficha e o desenho. Serve o bloco de um plano
 * (`ESQUEMA_DO_PLANO`) e a criação de um exercício sozinho na biblioteca
 * (`criar_exercicio`).
 */
export const ESQUEMA_DO_EXERCICIO: Record<string, unknown> = {
  type: "object",
  properties: {
    nome: texto,
    descricao: { ...texto, description: "Como se monta e como corre, em 2 a 5 frases." },
    tipo: { ...textoOuNulo, description: "'Posse', 'Vaga', 'Jogo condicionado', 'Circuito', 'Jogo reduzido'..." },
    categoria: { ...textoOuNulo, description: `Uma de: ${CATEGORIAS.join(", ")}.` },
    jogadores: textoOuNulo,
    espaco: textoOuNulo,
    material: textoOuNulo,
    regras: textoOuNulo,
    pontosDeTreino: { ...textoOuNulo, description: "O que o treinador corrige e reforça." },
    errosComuns: textoOuNulo,
    progressoes: textoOuNulo,
    regressoes: textoOuNulo,
    intensidade: { type: ["integer", "null"] },
    minutos: { type: ["integer", "null"] },
    idadeMin: { type: ["integer", "null"] },
    idadeMax: { type: ["integer", "null"] },
    complexidade: { type: ["integer", "null"], description: "1 a 5." },
    meioCampo: { type: "boolean", description: "true quando o exercício usa só meio campo (uma baliza)." },
    frames: {
      type: "array",
      description: "O desenho, em 2 a 4 momentos que se animam: o 1.º é a montagem; os seguintes mostram a sequência (a bola passou, os jogadores deslocaram-se para onde as setas do momento anterior apontavam). Vazio só se o exercício não se desenha (uma corrida contínua, por exemplo).",
      items: {
        type: "object",
        properties: {
          nota: { ...textoOuNulo, description: "O que acontece neste momento." },
          itens: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string", description: "O nome fixo desta peça, IGUAL em todos os momentos (j1, j2, a1, gr, bola, c1...): é por ele que o editor a anima de um momento para o outro. Uma peça que não muda repete-se em todos os momentos com o mesmo id e o mesmo sítio." },
                tipo: { type: "string", enum: [...PECAS] },
                x: { type: "number", description: "0 a 100, da linha lateral esquerda para a direita (as balizas ficam a 0 e a 100)." },
                y: { type: "number", description: "0 a 100, de cima para baixo." },
                w: { ...numeroOuNulo, description: "Só zonas e barreiras: largura em percentagem do campo. Numa zona, x e y são o CENTRO dela." },
                h: { ...numeroOuNulo, description: "Só zonas: altura em percentagem do campo." },
                rot: { ...numeroOuNulo, description: "Graus. Nas balizas deixa null: o servidor vira-as para o campo." },
                etiqueta: { ...textoOuNulo, description: "O número do jogador, o texto, o nome da zona." },
                cor: { type: ["string", "null"], enum: [...Object.keys(CORES), null], description: "O colete, só em jogadores e guarda-redes." },
              },
              required: ["id", "tipo", "x", "y", "w", "h", "rot", "etiqueta", "cor"],
              ...SEM_EXTRAS,
            },
          },
          setas: {
            type: "array",
            items: {
              type: "object",
              properties: {
                tipo: { type: "string", enum: [...SETAS] },
                x1: { type: "number" },
                y1: { type: "number" },
                x2: { type: "number" },
                y2: { type: "number" },
              },
              required: ["tipo", "x1", "y1", "x2", "y2"],
              ...SEM_EXTRAS,
            },
          },
        },
        required: ["nota", "itens", "setas"],
        ...SEM_EXTRAS,
      },
    },
  },
  required: ["nome", "descricao", "tipo", "categoria", "jogadores", "espaco", "material", "regras", "pontosDeTreino", "errosComuns", "progressoes", "regressoes", "intensidade", "minutos", "idadeMin", "idadeMax", "complexidade", "meioCampo", "frames"],
  ...SEM_EXTRAS,
};

/**
 * A forma fixa da resposta do planeador. `strict`: todos os campos presentes,
 * os opcionais a `null`. A profundidade fica em oito níveis, dentro do limite
 * do fornecedor (dez): bloco → novo → frames → frame → itens → item.
 */
export const ESQUEMA_DO_PLANO: Record<string, unknown> = {
  type: "object",
  properties: {
    objetivo: { ...texto, description: "O objetivo principal da sessão, curto." },
    objetivos: { type: "array", items: texto, description: "Até 4 objetivos secundários." },
    tipo: { ...texto, description: `Um de: ${TIPOS_DE_SESSAO.join(", ")}.` },
    intensidade: { type: "integer", description: "1 a 10, a intensidade planeada da sessão." },
    material: textoOuNulo,
    notas: { ...textoOuNulo, description: "Observações do plano para o treinador: como gerir o tempo, o que vigiar." },
    blocos: {
      type: "array",
      items: {
        type: "object",
        properties: {
          nome: texto,
          minutos: { type: "integer" },
          categoria: { ...textoOuNulo, description: `Uma de: ${CATEGORIAS.join(", ")}.` },
          objetivo: textoOuNulo,
          intensidade: { type: ["integer", "null"], description: "1 a 10." },
          jogadores: { ...textoOuNulo, description: "O formato: '4v4+2', '2 grupos de 6'." },
          espaco: { ...textoOuNulo, description: "'30×25 m'." },
          material: textoOuNulo,
          notas: textoOuNulo,
          exercicioId: { ...textoOuNulo, description: "O id de um exercício da biblioteca do clube, quando se usa um. Senão null e `novo` preenchido." },
          novo: { anyOf: [{ type: "null" }, ESQUEMA_DO_EXERCICIO] },
        },
        required: ["nome", "minutos", "categoria", "objetivo", "intensidade", "jogadores", "espaco", "material", "notas", "exercicioId", "novo"],
        ...SEM_EXTRAS,
      },
    },
  },
  required: ["objetivo", "objetivos", "tipo", "intensidade", "material", "notas", "blocos"],
  ...SEM_EXTRAS,
};

/* -------------------------------------------------------------------------- */
/* O pedido                                                                    */
/* -------------------------------------------------------------------------- */

export type ExercicioDaBiblioteca = {
  id: string;
  nome: string;
  categoria: string | null;
  tipo: string | null;
  minutos: number | null;
  jogadores: string | null;
  intensidade: number | null;
  idadeMin: number | null;
  idadeMax: number | null;
  descricao: string | null;
  comDesenho: boolean;
};

export type PedidoDePlano = {
  clube: string;
  equipa: string;
  /** A idade máxima da equipa ("sub-11" é 11). */
  idade: number;
  modalidade: string;
  terreno: Terreno;
  quando: string;
  duracaoMin: number;
  /** O que a pessoa quer do treino, com as palavras dela. */
  foco: string;
  intensidade?: string;
  /** Material, número de atletas, limitações. */
  notas?: string;
  /** `null`: o planeador decide. */
  usarBiblioteca: boolean | null;
  biblioteca: ExercicioDaBiblioteca[];
  /** O plano que já lá está, se houver, para não o repetir às cegas. */
  planoActual?: { objetivo: string | null; blocos: { nome: string; minutos: number }[] } | null;
  pesquisar: boolean;
};

/**
 * Como se desenha um exercício no campo do editor. Igual para o exercício
 * sozinho e para os exercícios novos de um plano. Escrito a partir dos
 * primeiros desenhos reais (12/11/2026): um só momento, a zona longe dos
 * jogadores (o modelo achava que x,y era o canto), cones espalhados pelo
 * campo, e nada que se animasse.
 */
const REGRAS_DO_DESENHO = [
  "- Cada exercício novo leva um desenho, a não ser que não se desenhe (uma corrida à volta do campo). É para o treinador perceber num relance como se monta e como corre.",
  "- O desenho tem 2 a 4 momentos que se animam. O 1.º é a montagem: o espaço, os jogadores nos lugares de partida, a bola, e as setas da primeira ação. Cada momento seguinte mostra o que aconteceu: a bola onde o passe a levou, os jogadores onde as setas do momento anterior os mandavam, e as setas da ação seguinte. Num rondo ou numa posse: passe, deslocamento de apoio, novo passe. Num jogo reduzido: saída, progressão, finalização.",
  "- Cada peça tem um id fixo (j1, j2, a1, gr, bola, c1...) igual em todos os momentos: é por ele que o editor a faz deslizar de um momento para o outro. Uma peça que não se mexe (cones, balizas, a zona) repete-se em todos os momentos com o mesmo id e o mesmo sítio. A bola tem sempre o id bola.",
  "- O espaço primeiro: decide onde fica o exercício no campo e o tamanho real (por exemplo 20×16 m), e desenha-o com uma zona (x e y são o CENTRO da zona, w e h a largura e a altura em percentagem do campo) ou com quatro cones nos cantos. TODAS as peças do exercício ficam dentro desse espaço: jogadores, bola e setas. Nada de cones soltos pelo resto do campo.",
  "- Legível: até 20 peças por momento, jogadores a pelo menos 4 % uns dos outros, números de 1 em diante. Uma equipa azul, a outra branca; um terceiro grupo (apoios, joker) vermelho ou amarelo. As setas partem de uma peça e acabam onde ela vai estar no momento seguinte.",
  "- Coordenadas em percentagem do campo inteiro: x de 0 (baliza da esquerda) a 100 (baliza da direita), y de 0 (cima) a 100 (baixo). Só meio campo: marca meioCampo e desenha entre x 50 e x 100, com a baliza a x 100.",
];

/** As instruções fixas do planeador: iguais em todos os pedidos, para a cache do fornecedor. */
export function instrucoesDoPlaneador(): string {
  return [
    "És o planeador de treinos de um clube de formação em Portugal. Recebes o treino (equipa, idade, modalidade, duração) e o que o treinador quer trabalhar, e devolves um plano de sessão completo, pronto a dar, na forma pedida.",
    "",
    "Como planeias:",
    "- A estrutura é a de uma sessão real: ativação (10 a 15% do tempo), uma ou duas partes principais, um jogo ou forma jogada, e um retorno à calma curto. Entre 4 e 7 blocos. A soma dos minutos dos blocos é a duração do treino, com uma folga de 5 minutos no máximo.",
    "- Adequa tudo à idade. Até aos 12 anos: tarefas curtas, muito tempo com bola, jogos reduzidos, nada de cargas com peso nem corrida contínua longa; o 'físico' trabalha-se por jogos de perseguição, circuitos de coordenação, estafetas e formas jogadas com espaço grande. Dos 13 aos 15: já com trabalho de velocidade e resistência intermitente por jogo. Dos 16 para cima: trabalho específico com séries e recuperações definidas.",
    "- Usa os exercícios da biblioteca do clube quando servem (manda o id em exercicioId e deixa novo a null); quando não há nenhum que sirva, crias um novo, completo: descrição clara de como se monta e como corre, regras, pontos de treino, erros comuns, progressão e regressão, material, formato e espaço.",
    ...REGRAS_DO_DESENHO,
    "- A duração, a intensidade e a categoria de cada bloco preenchem-se sempre. A intensidade é de 1 a 10; a da sessão é a média ponderada pelo tempo.",
    "- Escreves em português de Portugal, claro e direto, como um treinador escreve para outro. Sem emojis, sem travessões, sem maiúsculas a gritar. Nomes de exercícios curtos e concretos ('Rondo 4v2 com transição', não 'Exercício 3').",
    "- Não inventes dados do clube: só usas os exercícios da biblioteca que te foram dados, com os ids exatos.",
    "- Se te for pedido para procurares na internet, procura exemplos de exercícios recomendados para a idade e o tema, e adapta-os; não copies textos, não ponhas ligações no plano.",
  ].join("\n");
}

/**
 * As instruções para criar **um exercício** para a biblioteca, sem treino
 * nenhum. As mesmas regras de idade, desenho e escrita do planeador, mas a
 * resposta é só a ficha (`ESQUEMA_DO_EXERCICIO`).
 */
export function instrucoesDoExercicio(): string {
  return [
    "És o autor de exercícios de treino de um clube de formação em Portugal. Recebes a equipa (idade, modalidade, terreno) e o que o treinador quer trabalhar, e devolves UM exercício completo, pronto a montar, na forma pedida.",
    "",
    "Como crias:",
    "- Adequa à idade. Até aos 12 anos: tarefas curtas, muito tempo com bola, jogos reduzidos, espaços proporcionais, regras simples; nada de cargas com peso nem corrida contínua longa. Dos 13 aos 15: mais exigência tática e física por jogo. Dos 16 para cima: trabalho específico.",
    "- A ficha é completa: nome curto e concreto ('Rondo 4v2 com transição', não 'Exercício de posse'), descrição clara de como se monta e como corre, regras, pontos de treino (o que o treinador corrige e reforça), erros comuns, uma progressão e uma regressão, material, formato (jogadores), espaço, duração, intensidade de 1 a 10, idades e complexidade de 1 a 5.",
    ...REGRAS_DO_DESENHO,
    "- Escreves em português de Portugal, claro e direto, como um treinador escreve para outro. Sem emojis, sem travessões, sem maiúsculas a gritar.",
    "- Se te for pedido para procurares na internet, procura exemplos de exercícios recomendados para a idade e o tema, e adapta-os; não copies textos, não ponhas ligações na ficha.",
  ].join("\n");
}

/** O pedido de um exercício sozinho, em texto, para o modelo. */
export function pedidoDoExercicio(p: { clube: string; equipa: string; idade: number; modalidade: string; terreno: Terreno; foco: string; intensidade?: string; duracaoMin?: number; notas?: string; pesquisar: boolean; jaHa: string[] }): string {
  const t = TERRENOS[p.terreno];
  return [
    `Clube: ${p.clube}.`,
    `Para: ${p.equipa}, ${p.modalidade}, idade até ${p.idade} anos (sub-${p.idade}).`,
    `Terreno do desenho: ${t.nome}, ${t.w}×${t.h} m${t.cestos ? ", com cestos em vez de balizas" : ""}.`,
    `O que o treinador quer trabalhar: ${p.foco}`,
    p.intensidade ? `Intensidade pedida: ${p.intensidade}.` : "",
    p.duracaoMin ? `Duração: cerca de ${p.duracaoMin} minutos.` : "",
    p.notas ? `Indicações do treinador: ${p.notas}` : "",
    p.jaHa.length ? `A biblioteca do clube já tem estes exercícios desta modalidade; faz um diferente deles: ${p.jaHa.join("; ")}.` : "",
    p.pesquisar ? "Procura na internet exemplos de exercícios recomendados para esta idade e este tema antes de criar." : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** O pedido de um plano, em texto, para o modelo. */
export function pedidoDoPlaneador(p: PedidoDePlano): string {
  const t = TERRENOS[p.terreno];
  const linhas = [
    `Clube: ${p.clube}.`,
    `Equipa: ${p.equipa}, ${p.modalidade}, idade até ${p.idade} anos (sub-${p.idade}).`,
    `Treino: ${p.quando}, ${p.duracaoMin} minutos.`,
    `Terreno do desenho: ${t.nome}, ${t.w}×${t.h} m${t.cestos ? ", com cestos em vez de balizas" : ""}.`,
    `O que o treinador quer: ${p.foco}`,
    p.intensidade ? `Intensidade pedida: ${p.intensidade}.` : "",
    p.notas ? `Indicações do treinador: ${p.notas}` : "",
    p.usarBiblioteca === false ? "Não uses a biblioteca do clube: todos os exercícios são novos." : p.usarBiblioteca === true ? "Usa os exercícios da biblioteca do clube sempre que sirvam." : "",
    p.planoActual ? `Este treino já tem um plano (${p.planoActual.objetivo ?? "sem objetivo"}: ${p.planoActual.blocos.map((b) => `${b.nome} ${b.minutos} min`).join(", ")}). O teu substitui-o; não o repitas por repetir.` : "",
    p.pesquisar ? "Procura na internet exemplos de exercícios recomendados para esta idade e este tema antes de planear." : "",
    "",
    p.biblioteca.length
      ? `Biblioteca do clube (${p.biblioteca.length} exercícios desta modalidade):\n${p.biblioteca
          .map((e) => `- ${e.id}: ${e.nome}${e.categoria ? ` [${e.categoria}]` : ""}${e.tipo ? ` (${e.tipo})` : ""}${e.minutos ? `, ${e.minutos} min` : ""}${e.jogadores ? `, ${e.jogadores}` : ""}${e.intensidade ? `, intensidade ${e.intensidade}` : ""}${e.idadeMin || e.idadeMax ? `, idades ${e.idadeMin ?? "?"}-${e.idadeMax ?? "?"}` : ""}${e.comDesenho ? ", com desenho" : ""}${e.descricao ? `: ${e.descricao}` : ""}`)
          .join("\n")}`
      : "Biblioteca do clube: ainda sem exercícios desta modalidade. Todos os exercícios são novos.",
  ];
  return linhas.filter(Boolean).join("\n");
}

/* -------------------------------------------------------------------------- */
/* A leitura                                                                   */
/* -------------------------------------------------------------------------- */

export type DesenhoItem = { id: string; kind: string; x: number; y: number; w?: number; h?: number; rot?: number; label?: string; color?: string };
export type DesenhoSeta = { id: string; kind: string; x1: number; y1: number; x2: number; y2: number };
export type Desenho = { field: string; frames: { id: string; durationMs?: number; note?: string; items: DesenhoItem[]; arrows: DesenhoSeta[] }[] };

export type ExercicioNovo = ExerciseInput & { diagram: Desenho | null };

export type BlocoLido = {
  nome: string;
  durationMin: number;
  category: string | null;
  objective: string | null;
  intensity: number | null;
  players: string | null;
  space: string | null;
  material: string | null;
  notes: string | null;
  /** Um exercício da biblioteca. */
  exerciseId: string | null;
  /** Ou um novo, a criar ao confirmar. */
  novo: ExercicioNovo | null;
};

export type PlanoLido = {
  sessao: Omit<PlanInput, "blocks" | "postNotes">;
  blocos: BlocoLido[];
};

type Lido = { ok: true; plano: PlanoLido; avisos: string[] } | { ok: false; erro: string };

const MAX_BLOCOS = 10;
const MAX_FRAMES = 4;
const MAX_ITENS = 40;
const MAX_SETAS = 30;

function inteiro(v: unknown, min: number, max: number): number | null {
  const n = typeof v === "number" ? Math.round(v) : typeof v === "string" ? Math.round(Number(v)) : NaN;
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : null;
}

function str(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s.slice(0, max) : null;
}

/** 0 a 100 → metros, dentro do campo. */
function metros(pct: unknown, total: number): number | null {
  const n = typeof pct === "number" ? pct : Number(pct);
  if (!Number.isFinite(n)) return null;
  return Math.round(Math.max(0, Math.min(100, n)) * total) / 100;
}

/**
 * Uma baliza vira-se para o campo pela linha mais perto: à esquerda a rede
 * fica para fora pela esquerda (270°), à direita pela direita (90°), em cima
 * 0° e em baixo 180°. É o que o editor faz à mão quando se pousa uma.
 */
export function rotacaoDaBaliza(x: number, y: number, w: number, h: number): number {
  const distancias: [number, number][] = [
    [x, 270],
    [w - x, 90],
    [y, 0],
    [h - y, 180],
  ];
  return distancias.sort((a, b) => a[0] - b[0])[0][1];
}

/**
 * O desenho em percentagem → o desenho do editor, em metros.
 *
 * O que não se percebe sai (uma peça sem tipo conhecido, uma seta sem
 * coordenadas); o que se percebe é posto dentro do campo. Sem peças em nenhum
 * momento, não há desenho.
 *
 * ## A mesma peça, o mesmo id
 *
 * O editor anima de um momento para o seguinte ligando as peças pelo `id`
 * (ver `DiagramPlayer`): o jogador "j2" do 1.º momento desliza para onde está
 * o "j2" do 2.º. Por isso o id que o modelo dá a cada peça traduz-se sempre no
 * mesmo id do editor, em todos os momentos. Antes cada peça ganhava um id novo
 * em cada momento, e os momentos não se ligavam: não havia animação.
 */
export function lerDesenho(bruto: unknown, terreno: Terreno, meioCampo: boolean, novoId: () => string): Desenho | null {
  if (!Array.isArray(bruto) || bruto.length === 0) return null;
  const t = TERRENOS[terreno];
  // O id do modelo → o id do editor, o mesmo em todos os momentos.
  const idsDoEditor = new Map<string, string>();
  const idDe = (dadoPeloModelo: string, kind: string) => {
    const chave = `${kind}:${dadoPeloModelo}`;
    let id = idsDoEditor.get(chave);
    if (!id) {
      id = novoId();
      idsDoEditor.set(chave, id);
    }
    return id;
  };
  const frames = bruto.slice(0, MAX_FRAMES).map((f) => {
    const fr = (f ?? {}) as { nota?: unknown; itens?: unknown; setas?: unknown };
    const items: DesenhoItem[] = [];
    const usados = new Set<string>();
    for (const i of Array.isArray(fr.itens) ? fr.itens.slice(0, MAX_ITENS) : []) {
      const it = (i ?? {}) as Record<string, unknown>;
      const kind = String(it.tipo ?? "");
      if (!(PECAS as readonly string[]).includes(kind)) continue;
      const x = metros(it.x, t.w);
      const y = metros(it.y, t.h);
      if (x === null || y === null) continue;
      // Sem id, ou com um id repetido no mesmo momento, a peça fica com um id só dela (não se anima, mas aparece).
      const dado = str(it.id, 40);
      let id = dado ? idDe(dado, kind === "playerBall" ? "player" : kind) : novoId();
      if (usados.has(id)) id = novoId();
      usados.add(id);
      const item: DesenhoItem = { id, kind, x, y };
      if (kind === "zone" || kind === "barrier") {
        const w = metros(it.w, t.w);
        const h = metros(it.h, t.h);
        if (w && w > 0) item.w = w;
        if (kind === "zone" && h && h > 0) item.h = h;
      }
      const rot = typeof it.rot === "number" && Number.isFinite(it.rot) ? Math.round(it.rot) % 360 : null;
      if (kind === "goal" || kind === "miniGoal") item.rot = rot ?? rotacaoDaBaliza(x, y, t.w, t.h);
      else if (rot !== null && rot !== 0) item.rot = rot;
      const label = str(it.etiqueta, 12);
      if (label) item.label = label;
      if (["player", "playerBall", "gk"].includes(kind) && typeof it.cor === "string" && CORES[it.cor]) {
        // O azul é a cor de sempre do jogador e a laranja a do guarda-redes: só se grava o que é diferente.
        if (!(kind !== "gk" && it.cor === "azul")) item.color = CORES[it.cor];
      }
      items.push(item);
    }
    const arrows: DesenhoSeta[] = [];
    for (const s of Array.isArray(fr.setas) ? fr.setas.slice(0, MAX_SETAS) : []) {
      const se = (s ?? {}) as Record<string, unknown>;
      const kind = String(se.tipo ?? "");
      if (!(SETAS as readonly string[]).includes(kind)) continue;
      const x1 = metros(se.x1, t.w);
      const y1 = metros(se.y1, t.h);
      const x2 = metros(se.x2, t.w);
      const y2 = metros(se.y2, t.h);
      if (x1 === null || y1 === null || x2 === null || y2 === null) continue;
      if (Math.abs(x1 - x2) < 0.3 && Math.abs(y1 - y2) < 0.3) continue;
      arrows.push({ id: novoId(), kind, x1, y1, x2, y2 });
    }
    const note = str(fr.nota, 300);
    return { id: novoId(), durationMs: 1800, ...(note ? { note } : {}), items, arrows };
  });
  if (frames.every((f) => f.items.length === 0)) return null;
  return { field: meioCampo ? `${terreno}-half` : terreno, frames };
}

/**
 * Um exercício novo como o modelo o devolveu → o que a Área técnica grava
 * (`ExerciseInput` com o desenho já em metros). Sem nome, não há exercício.
 */
export function lerExercicioNovo(bruto: unknown, terreno: Terreno, minutosPorOmissao: number | null, novoId: () => string = idAleatorio): ExercicioNovo | null {
  if (!bruto || typeof bruto !== "object") return null;
  const n = bruto as Record<string, unknown>;
  const nome = str(n.nome, 100);
  if (!nome) return null;
  return {
    name: nome,
    description: str(n.descricao, 4000),
    type: str(n.tipo, 60),
    category: str(n.categoria, 60),
    players: str(n.jogadores, 60),
    space: str(n.espaco, 60),
    material: str(n.material, 300),
    rules: str(n.regras, 2000),
    coachingPoints: str(n.pontosDeTreino, 2000),
    commonErrors: str(n.errosComuns, 2000),
    progressions: str(n.progressoes, 2000),
    regressions: str(n.regressoes, 2000),
    intensity: inteiro(n.intensidade, 1, 10),
    durationMin: inteiro(n.minutos, 1, 240) ?? minutosPorOmissao,
    ageMin: inteiro(n.idadeMin, 4, 99),
    ageMax: inteiro(n.idadeMax, 4, 99),
    complexity: inteiro(n.complexidade, 1, 5),
    diagram: lerDesenho(n.frames, terreno, n.meioCampo === true, novoId),
  };
}

/**
 * O plano como o modelo o devolveu → o que se grava. Um bloco que aponte para
 * um exercício que não é da biblioteca dada fica sem exercício (o nome e os
 * minutos ficam); um bloco sem nome ou sem minutos sai.
 */
export function lerPlanoGerado(bruto: unknown, terreno: Terreno, biblioteca: ReadonlySet<string>, novoId: () => string = idAleatorio): Lido {
  if (!bruto || typeof bruto !== "object") return { ok: false, erro: "O planeador não devolveu um plano" };
  const p = bruto as Record<string, unknown>;
  const avisos: string[] = [];
  const blocos: BlocoLido[] = [];
  for (const b of Array.isArray(p.blocos) ? p.blocos.slice(0, MAX_BLOCOS) : []) {
    const bl = (b ?? {}) as Record<string, unknown>;
    const nome = str(bl.nome, 80);
    const minutos = inteiro(bl.minutos, 1, 240);
    if (!nome || !minutos) continue;
    let exerciseId = str(bl.exercicioId, 60);
    if (exerciseId && !biblioteca.has(exerciseId)) {
      avisos.push(`O bloco "${nome}" apontava para um exercício que não está na biblioteca; ficou sem exercício.`);
      exerciseId = null;
    }
    const novo = !exerciseId && bl.novo ? lerExercicioNovo(bl.novo, terreno, minutos, novoId) : null;
    blocos.push({
      nome,
      durationMin: minutos,
      category: str(bl.categoria, 60),
      objective: str(bl.objetivo, 200),
      intensity: inteiro(bl.intensidade, 1, 10),
      players: str(bl.jogadores, 60),
      space: str(bl.espaco, 60),
      material: str(bl.material, 300),
      notes: str(bl.notas, 1000),
      exerciseId,
      novo,
    });
  }
  if (blocos.length === 0) return { ok: false, erro: "O planeador não devolveu nenhum bloco" };

  const objetivos = Array.isArray(p.objetivos) ? p.objetivos.map((o) => str(o, 80)).filter((o): o is string => !!o).slice(0, 6) : [];
  return {
    ok: true,
    avisos,
    plano: {
      sessao: {
        objective: str(p.objetivo, 120) ?? blocos[0].nome,
        objectives: objetivos,
        sessionType: str(p.tipo, 40),
        intensity: inteiro(p.intensidade, 1, 10),
        material: str(p.material, 500),
        planNotes: str(p.notas, 2000),
      },
      blocos,
    },
  };
}

/** Os ids do editor: curtos e únicos dentro do desenho. */
export function idAleatorio(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** O primeiro momento do desenho: o que um cartão pequeno consegue mostrar. */
export function miniatura(d: Desenho | null): Desenho | null {
  if (!d || d.frames.length === 0) return null;
  return { field: d.field, frames: [d.frames[0]] };
}

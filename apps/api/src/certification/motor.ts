/**
 * O motor da certificação: do estado de cada requisito ao nível do clube.
 *
 * Funções puras, sem base de dados e sem Nest. Recebem o catálogo do manual, o
 * perfil do clube e o valor de cada requisito, e devolvem pontos, patamar e
 * nível. É de propósito a forma do `deriveSteps` dos Primeiros passos e do
 * `calendario-regras.ts`: o que decide o nível de um clube tem de se poder
 * provar com exemplos, sem arrancar uma API (`npm run test:certificacao`).
 *
 * ## Como a FPF decide
 *
 * Três verificações seguidas, e o nível final é o mais baixo dos três tetos:
 *
 * 1. **Acesso** — as equipas inscritas por escalão (`acessoDe`).
 * 2. **Obrigatórias** — cumulativas por patamar. Uma só em falta tira o clube
 *    desse patamar, tenha os pontos que tiver.
 * 3. **Pontos** — 100 em 9 critérios. 50 abre as 3 estrelas, 80 as 4, 90 as 5.
 *
 * O fluxograma do manual (página 31) é a função `avaliar`.
 */

/** A partir de que patamar um requisito é obrigatório. Cumulativos, por esta ordem. */
export type Patamar = "C" | "E" | "T" | "Q";

/**
 * A que clubes um requisito se aplica.
 *
 * `dre` praticantes deslocados das famílias, `nn` recrutamento de não-nacionais
 * não residentes, `rec` o clube faz recrutamento (e não só angariação), `sen`
 * tem equipa sénior.
 */
export type Condicao = "dre" | "nn" | "rec" | "sen";

/** Como um requisito se verifica: dados da plataforma, documento, declaração ou avaliador. */
export type Modo = "data" | "document" | "declaration" | "assessor";

export type Nivel = { label: string; points: number; mandatory?: Patamar };

export type Requisito = {
  /** A numeração do manual: `5.2.1`, ou `D03` nas declarações de compromisso. */
  code: string;
  criterion: number;
  group: string;
  text: string;
  /** Requisito de sim ou não. */
  points?: number;
  /** Requisito por patamares ("OU" no manual): vale o mais alto que se cumpre. */
  tiers?: Nivel[];
  mandatory?: Patamar;
  condition?: Condicao;
  /** Pontos que só o avaliador atribui, depois da visita técnica. */
  assessor?: true;
  mode: Modo;
  /** A área da plataforma de onde a resposta vem (ou virá). */
  source: string;
  /** O que a FPF pede em anexo. */
  evidence?: string;
  note?: string;
};

export type Catalogo = {
  key: string;
  title: string;
  manual: string;
  criteria: { criterion: number; name: string; max: number }[];
  groups: Record<string, string>;
  requirements: Requisito[];
};

/**
 * O perfil da candidatura.
 *
 * As quatro primeiras ligam e desligam grupos de questões. As restantes são o
 * que a plataforma não sabe sozinha sobre o acesso: ninguém regista aqui em que
 * provas se jogou há quatro épocas, nem em que concelho o clube está.
 *
 * O futebol feminino já esteve aqui, perguntado ao clube. Saiu no dia em que as
 * equipas passaram a ter género e os atletas sexo: o que a plataforma sabe não
 * se pergunta (ver `Plantel`).
 */
export type Perfil = {
  hasSenior: boolean;
  recruits: boolean;
  hasDre: boolean;
  nonNationals: boolean;
  /** Teve uma equipa de Sub-15 a sénior em provas nacionais numa das últimas 5 épocas. */
  nationalLast5: boolean;
  /** AF da Madeira, Ponta Delgada, Angra do Heroísmo ou Horta. */
  islands: boolean;
  /** Um dos 165 concelhos de baixa densidade populacional. */
  lowDensity: boolean;
};

export const PERFIL_VAZIO: Perfil = {
  hasSenior: false,
  recruits: false,
  hasDre: false,
  nonNationals: false,
  nationalLast5: false,
  islands: false,
  lowDensity: false,
};

const CONDICAO: Record<Condicao, keyof Perfil> = { dre: "hasDre", nn: "nonNationals", rec: "recruits", sen: "hasSenior" };

/**
 * Os níveis, do mais baixo ao mais alto. O `id` é o que se compara: -1 sem
 * certificação, 0 o reconhecimento como CBFF, 1 a 5 as estrelas.
 */
export const NIVEIS = [
  { id: -1, name: "Sem certificação", short: "Não certificada", stars: 0 },
  { id: 0, name: "Centro Básico de Formação de Futebol", short: "CBFF", stars: 0 },
  { id: 1, name: "Escola de Futebol", short: "1 estrela", stars: 1 },
  { id: 2, name: "Escola de Futebol", short: "2 estrelas", stars: 2 },
  { id: 3, name: "Entidade Formadora", short: "3 estrelas", stars: 3 },
  { id: 4, name: "Entidade Formadora", short: "4 estrelas", stars: 4 },
  { id: 5, name: "Entidade Formadora", short: "5 estrelas", stars: 5 },
] as const;

export const nivelDe = (id: number) => NIVEIS.find((n) => n.id === id) ?? NIVEIS[0];

/**
 * Pontos que mudam com o perfil, como o manual os escreve.
 *
 * "Para as Entidades que não tenham Praticantes D.R.E., esta questão vale 1
 * ponto": os pontos das questões que deixam de se aplicar passam para estas.
 * Só entra aqui o que está escrito — os pontos do alojamento e dos
 * não-nacionais não têm destino no manual, e por isso ficam de fora do máximo
 * ao alcance do clube (`max` em `avaliar`) em vez de serem inventados.
 */
const VALE_MAIS: Record<string, { sem: Condicao; points?: number; tiers?: number[] }> = {
  "2.2.3.3": { sem: "dre", points: 1 },
  "6.2.1": { sem: "dre", tiers: [1, 1.5] },
  "3.2.1.1": { sem: "rec", points: 2 },
  "3.2.3.1": { sem: "rec", points: 4 },
  "3.2.3.2": { sem: "rec", points: 1.25 },
  "4.3.2.1": { sem: "sen", points: 1 },
};

export function aplicaSe(r: Requisito, perfil: Perfil): boolean {
  return !r.condition || Boolean(perfil[CONDICAO[r.condition]]);
}

export function pontosDoNivel(r: Requisito, indice: number, perfil: Perfil): number {
  const mais = VALE_MAIS[r.code];
  if (mais?.tiers && !perfil[CONDICAO[mais.sem]]) return mais.tiers[indice] ?? 0;
  return r.tiers?.[indice]?.points ?? 0;
}

/** O máximo que o requisito pode valer a este clube. */
export function pontosMaximos(r: Requisito, perfil: Perfil): number {
  if (r.tiers) return Math.max(...r.tiers.map((_, i) => pontosDoNivel(r, i, perfil)));
  const mais = VALE_MAIS[r.code];
  if (mais?.points != null && !perfil[CONDICAO[mais.sem]]) return mais.points;
  return r.points ?? 0;
}

/**
 * O valor de um requisito: `1` cumprido e `0` em falta; nos requisitos por
 * patamares, o índice do patamar atingido e `-1` nenhum.
 */
export type Valores = Record<string, number | undefined>;

export function valorDe(r: Requisito, valores: Valores): number {
  const v = valores[r.code];
  if (r.tiers) return v == null ? -1 : Math.max(-1, Math.min(r.tiers.length - 1, Math.trunc(v)));
  return v && v > 0 ? 1 : 0;
}

export function pontosGanhos(r: Requisito, valor: number, perfil: Perfil): number {
  if (r.tiers) return valor >= 0 ? pontosDoNivel(r, valor, perfil) : 0;
  return valor > 0 ? pontosMaximos(r, perfil) : 0;
}

/* -------------------------------------------------------------------------- */
/* Acesso                                                                      */
/* -------------------------------------------------------------------------- */

/** Os sete escalões de formação que o manual nomeia, pela idade máxima. */
export const ESCALOES = [7, 9, 11, 13, 15, 17, 19] as const;
export type Escalao = (typeof ESCALOES)[number];

/** Uma equipa sem limite de idade. Gémea de `SEM_LIMITE` em `lib/team-age.ts`. */
export const SENIORES = 99;

/**
 * O escalão do manual em que uma equipa conta.
 *
 * Um Sub-12 é Infantis como um Sub-13: o manual fala em Petizes (Sub-7),
 * Traquinas (Sub-9), Benjamins (Sub-11), Infantis (Sub-13), Iniciados
 * (Sub-15), Juvenis (Sub-17) e Juniores (Sub-19), e cada idade par cai no
 * escalão de cima. Acima de Sub-19 e abaixo de seniores (uma equipa B, um
 * Sub-23) não conta para o acesso.
 */
export function escalaoDe(maxAge: number): Escalao | "senior" | null {
  if (maxAge >= SENIORES) return "senior";
  for (const e of ESCALOES) if (maxAge <= e) return e;
  return null;
}

/** "Apenas se considera EQUIPA" com 11 inscritos de Sub-13 para cima e 7 abaixo. */
export const minimoDaEquipa = (escalao: Escalao | "senior") => (escalao === "senior" || escalao >= 13 ? 11 : 7);

export type Plantel = {
  /** O maior plantel masculino em cada escalão — é uma equipa que tem de ter o mínimo. */
  squads: Partial<Record<Escalao, number>>;
  /** O maior plantel sénior masculino na plataforma. Só serve para propor o perfil. */
  senior: number;
  /** Quantas equipas femininas chegam ao mínimo do seu escalão. */
  womenTeams: number;
  /** Praticantes femininas nos escalões de formação. Vinte valem como uma equipa. */
  womenPlayers: number;
};

/**
 * O teto do acesso: 5, 4 ou 3 (Entidade Formadora), 1 (Escola de Futebol) ou 0
 * (só o reconhecimento como CBFF).
 */
export function acessoDe(plantel: Plantel, perfil: Perfil): 0 | 1 | 3 | 4 | 5 {
  const tem = (e: Escalao) => (plantel.squads[e] ?? 0) >= minimoDaEquipa(e);
  const formacao = ESCALOES.filter(tem).length;
  // A equipa sénior vem do perfil e não do plantel: muitos clubes só gerem a
  // formação na plataforma, e a inscrição no Score é o clube que a conhece.
  const senior = perfil.hasSenior;
  const reduzido = perfil.islands || perfil.lowDensity;
  const feminino = plantel.womenTeams >= 1 || plantel.womenPlayers >= 20;
  // A exigência das provas nacionais não se aplica às ilhas.
  const nacional = perfil.islands || perfil.nationalLast5;

  if (senior && formacao === ESCALOES.length && feminino && nacional) return 5;
  if (senior && formacao === ESCALOES.length) return 4;
  if (formacao >= (reduzido ? 3 : 4)) return 3;
  if (formacao >= (reduzido ? 2 : 3)) return 1;
  return 0;
}

/**
 * O que falta para o teto de acesso seguinte, em frases.
 *
 * Vazio quando o acesso já chega às 5 estrelas. As frases dizem o que o manual
 * pede e o que o clube tem, para a pessoa não ter de ir ver a tabela.
 */
export function faltaNoAcesso(plantel: Plantel, perfil: Perfil): string[] {
  const acesso = acessoDe(plantel, perfil);
  if (acesso === 5) return [];

  const tem = (e: Escalao) => (plantel.squads[e] ?? 0) >= minimoDaEquipa(e);
  const comEquipa = ESCALOES.filter(tem).length;
  const reduzido = perfil.islands || perfil.lowDensity;

  if (acesso === 0 || acesso === 1) {
    const pede = acesso === 0 ? (reduzido ? 2 : 3) : reduzido ? 3 : 4;
    return [
      `${pede} escalões de formação com equipa, entre Sub-7 e Sub-19. O clube tem ${comEquipa}. Uma equipa conta com 11 atletas de Sub-13 para cima e 7 abaixo.`,
    ];
  }

  const falta: string[] = [];
  if (acesso === 3) {
    if (!perfil.hasSenior) falta.push("Uma equipa sénior masculina inscrita.");
    const semEquipa = ESCALOES.filter((e) => !tem(e));
    if (semEquipa.length) {
      falta.push(
        `Equipa em ${semEquipa.map((e) => `Sub-${e}`).join(", ")}. As 4 estrelas pedem os sete escalões, cada um com 11 atletas de Sub-13 para cima e 7 abaixo.`,
      );
    }
    return falta;
  }

  // Das 4 para as 5 estrelas.
  if (!(plantel.womenTeams >= 1 || plantel.womenPlayers >= 20)) {
    falta.push(
      `Uma equipa feminina, ou 20 praticantes femininas nos escalões de formação. A plataforma conta ${plantel.womenPlayers}.`,
    );
  }
  if (!(perfil.islands || perfil.nationalLast5)) {
    falta.push("Uma equipa de Sub-15 a sénior em provas nacionais numa das últimas 5 épocas.");
  }
  return falta;
}

/* -------------------------------------------------------------------------- */
/* Avaliação                                                                   */
/* -------------------------------------------------------------------------- */

export type Avaliacao = {
  points: number;
  /** O máximo ao alcance deste clube: 100 menos as questões que não se lhe aplicam. */
  max: number;
  /** Dos pontos ao alcance, quantos só o avaliador atribui. */
  assessor: number;
  /** As obrigatórias em falta, por patamar. */
  missing: Record<Patamar, Requisito[]>;
  /** O patamar das obrigatórias: 0 nenhum, 1 CBFF, 2 escolas, 3 três estrelas, 4 quatro e cinco. */
  mandatory: 0 | 1 | 2 | 3 | 4;
  access: number;
  level: number;
  byCriterion: Record<number, { got: number; max: number; total: number; missing: number }>;
};

export function avaliar(catalogo: Catalogo, valores: Valores, perfil: Perfil, access: number): Avaliacao {
  let points = 0;
  let max = 0;
  let assessor = 0;
  const missing: Record<Patamar, Requisito[]> = { C: [], E: [], T: [], Q: [] };
  const byCriterion: Avaliacao["byCriterion"] = {};

  for (const r of catalogo.requirements) {
    const c = (byCriterion[r.criterion] ??= { got: 0, max: 0, total: 0, missing: 0 });
    if (!aplicaSe(r, perfil)) continue;

    const valor = valorDe(r, valores);
    const ganhos = pontosGanhos(r, valor, perfil);
    const cheio = pontosMaximos(r, perfil);
    points += ganhos;
    max += cheio;
    c.got += ganhos;
    c.max += cheio;
    c.total++;
    if (r.assessor) assessor += cheio;

    if (r.tiers) {
      // Cada patamar obrigatório de uma questão por níveis é uma exigência à
      // parte: "médico" para as 3 estrelas, "médico pós-graduado" para as 4.
      r.tiers.forEach((t, i) => {
        if (t.mandatory && valor < i) missing[t.mandatory].push(r);
      });
      if (valor < r.tiers.length - 1) c.missing++;
    } else {
      if (r.mandatory && valor <= 0) missing[r.mandatory].push(r);
      if (valor <= 0) c.missing++;
    }
  }

  const mandatory = missing.C.length ? 0 : missing.E.length ? 1 : missing.T.length ? 2 : missing.Q.length ? 3 : 4;

  // O fluxograma da página 31 do manual, de cima para baixo.
  let level: number;
  if (access >= 5 && mandatory >= 4) level = points >= 90 ? 5 : points >= 80 ? 4 : points >= 50 ? 3 : 2;
  else if (access >= 4 && mandatory >= 4) level = points >= 80 ? 4 : points >= 50 ? 3 : 2;
  else if (access >= 3 && mandatory >= 3) level = points >= 50 ? 3 : 2;
  else if (access >= 1 && mandatory >= 2) level = points >= 50 ? 2 : 1;
  else level = mandatory >= 1 ? 0 : -1;

  return { points, max, assessor, missing, mandatory, access, level, byCriterion };
}

/**
 * Até onde cada verificação deixa chegar, em estrelas (-1 nem CBFF, 0 CBFF).
 *
 * É o que o ecrã mostra lado a lado: o mais baixo dos três é o nível, e é
 * nesse que vale a pena trabalhar primeiro.
 */
export function tetos(a: Avaliacao): { access: number; mandatory: number; points: number } {
  const access = a.access >= 5 ? 5 : a.access >= 4 ? 4 : a.access >= 3 ? 3 : a.access >= 1 ? 2 : 0;
  const mandatory = [-1, 0, 2, 3, 5][a.mandatory];
  // Abaixo dos 50, uma Entidade Formadora desce para Escola de 2 estrelas e
  // uma Escola fica com 1.
  const points = a.points >= 90 ? 5 : a.points >= 80 ? 4 : a.points >= 50 ? 3 : a.access >= 3 && a.mandatory >= 3 ? 2 : 1;
  return { access, mandatory, points };
}

/** O que cada nível pede: acesso mínimo, patamares de obrigatórias e pontos. */
const PEDE: Record<number, { access: number; patamares: Patamar[]; points: number }> = {
  0: { access: 0, patamares: ["C"], points: 0 },
  1: { access: 1, patamares: ["C", "E"], points: 0 },
  2: { access: 1, patamares: ["C", "E"], points: 50 },
  3: { access: 3, patamares: ["C", "E", "T"], points: 50 },
  4: { access: 4, patamares: ["C", "E", "T", "Q"], points: 80 },
  5: { access: 5, patamares: ["C", "E", "T", "Q"], points: 90 },
};

export type Caminho = {
  target: number;
  accessOk: boolean;
  needAccess: number;
  /** As obrigatórias em falta para o nível pretendido, sem repetições. */
  mandatory: { requirement: Requisito; patamar: Patamar }[];
  /** Os pontos que faltam. */
  points: number;
  needPoints: number;
};

/** O que falta para um nível. */
export function caminhoPara(target: number, a: Avaliacao): Caminho {
  const pede = PEDE[target];
  const vistos = new Set<string>();
  const mandatory: Caminho["mandatory"] = [];
  for (const patamar of pede.patamares) {
    for (const requirement of a.missing[patamar]) {
      if (vistos.has(requirement.code)) continue;
      vistos.add(requirement.code);
      mandatory.push({ requirement, patamar });
    }
  }
  return {
    target,
    accessOk: a.access >= pede.access,
    needAccess: pede.access,
    mandatory,
    points: Math.max(0, pede.points - a.points),
    needPoints: pede.points,
  };
}

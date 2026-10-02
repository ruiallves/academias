import { ESCALOES, escalaoDe, type Escalao } from "./motor";

/**
 * O que a plataforma já sabe responder sozinha.
 *
 * Cada regra recebe os **factos** do clube — contagens, nada mais — e devolve
 * o valor do requisito e a frase que o explica. A frase traz sempre os números:
 * um "em falta" sem dizer o que falta é uma checklist, e o pedido foi o
 * contrário disso.
 *
 * ## O que é uma regra e o que não é
 *
 * Só entra aqui o que os dados provam. "O dossier de treino é supervisionado
 * pelo coordenador" não se prova com nada do que existe hoje, e por isso não
 * tem regra: o clube responde à mão. Uma regra que adivinha é pior do que
 * nenhuma — diz a um clube que tem as 3 estrelas quando a FPF vai dizer que
 * não.
 *
 * Quando o clube sabe mais do que os dados (o dossier vive em papel, o médico
 * guarda os exames noutro sistema), a resposta dele ganha ao cálculo. Ver
 * `CertificationService.estado`.
 *
 * ## Os limiares
 *
 * O manual diz "todas as equipas" e "todos os praticantes", mas nenhum clube
 * tem 100% de coisa nenhuma num dia qualquer de outubro: há sempre o miúdo que
 * entrou ontem. `QUASE_TODOS` é a folga, e é uma escolha nossa — está escrita
 * na frase de cada regra para ninguém a tomar por exigência da FPF.
 */
export const QUASE_TODOS = 0.8;

/** Uma equipa de futebol do clube, na época em curso, em números. */
export type FactosDaEquipa = {
  id: string;
  name: string;
  maxAge: number;
  /** A equipa é feminina (`Team.gender`). Sai da contagem do masculino. */
  women: boolean;
  /** Atletas activos com passagem aberta nesta equipa. */
  athletes: number;
  /** Treinos da época que já passaram e não foram cancelados. */
  sessions: number;
  /** Desses, os que têm blocos no plano. */
  sessionsWithBlocks: number;
  mesos: number;
  micros: number;
  microsWithObjective: number;
};

export type Factos = {
  teams: FactosDaEquipa[];
  /** Atletas distintos por escalão, só nas equipas masculinas de formação. */
  athletesByAge: Record<Escalao, number>;
  /** Atletas distintos nas equipas masculinas de formação. */
  formationAthletes: number;
  /** Treinadores distintos atribuídos a essas equipas. */
  coaches: number;
  /**
   * Praticantes femininas nos escalões de formação: atletas com o sexo indicado
   * como feminino, ou que estão numa equipa feminina.
   */
  womenPlayers: number;

  /** Treinos da formação nos últimos 30 dias, e quantos têm plano. */
  recentSessions: number;
  recentSessionsPlanned: number;
  /** Treinos da época com plano, e quantos indicam material. */
  plannedSessions: number;
  plannedSessionsWithMaterial: number;

  /** Jogos da formação já jogados na época. */
  matchesPlayed: number;
  matchesWithCallUp: number;
  matchesWithReport: number;

  /** Atletas da formação com avaliação publicada na época. */
  athletesEvaluated: number;
  /** Registos no boletim clínico durante a época. */
  clinicalEntries: number;
  athletesWithValidExam: number;
  /** Escalões com pelo menos um plano de nutrição publicado. */
  nutritionAgeGroups: number;
  /** Atletas da formação com notas da escola neste ano lectivo ou no anterior. */
  athletesWithGrades: number;

  /** Scouting: prospects da modalidade e observações feitas na época. */
  prospects: number;
  observations: number;
};

export type Calculo = {
  /** `1`/`0`, ou o índice do patamar nas questões por níveis (`-1` nenhum). */
  value: number;
  /** O porquê, com os números. É o que o ecrã mostra por baixo do requisito. */
  detail: string;
  /** Quando a regra é uma proporção, para a barra. */
  progress?: { got: number; of: number };
};

/** As equipas masculinas de formação: Sub-7 a Sub-19. */
export function equipasDeFormacao(f: Factos): FactosDaEquipa[] {
  return f.teams.filter((t) => !t.women && typeof escalaoDe(t.maxAge) === "number");
}

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;
const chega = (got: number, of: number, limiar = QUASE_TODOS) => of > 0 && got / of >= limiar;
const pede = `Conta a partir de ${Math.round(QUASE_TODOS * 100)}%.`;

function piramide(f: Factos, baixo: Escalao[], cima: Escalao[], nomeBaixo: string, nomeCima: string): Calculo {
  const a = baixo.reduce((n, e) => n + f.athletesByAge[e], 0);
  const b = cima.reduce((n, e) => n + f.athletesByAge[e], 0);
  return {
    value: a > b ? 1 : 0,
    detail: `${plural(a, "atleta", "atletas")} em ${nomeBaixo} e ${b} em ${nomeCima}. O manual pede mais nos escalões de baixo.`,
  };
}

/** Uma regra por equipa: cumpre quando todas as equipas de formação passam. */
function todasAsEquipas(f: Factos, passa: (t: FactosDaEquipa) => boolean, frase: (got: number, of: number) => string): Calculo {
  const equipas = equipasDeFormacao(f);
  const got = equipas.filter(passa).length;
  const falta = equipas.filter((t) => !passa(t)).map((t) => t.name);
  const resto = falta.length ? ` Falta em ${falta.slice(0, 4).join(", ")}${falta.length > 4 ? ` e mais ${falta.length - 4}` : ""}.` : "";
  return {
    value: equipas.length > 0 && got === equipas.length ? 1 : 0,
    detail: equipas.length ? frase(got, equipas.length) + resto : "Ainda não há equipas de formação nesta época.",
    progress: { got, of: equipas.length },
  };
}

export const REGRAS: Record<string, (f: Factos) => Calculo> = {
  /* ── 3 · Recrutamento ─────────────────────────────────────────────────── */

  // O manual dá mais pontos a quem usa "uma aplicação de recrutamento" do que
  // a quem usa uma folha de Excel. O módulo de Scouting é essa aplicação — mas
  // só conta se estiver a ser usado.
  "3.2.2.5": (f) => ({
    value: f.prospects > 0 && f.observations > 0 ? 1 : -1,
    detail:
      f.prospects > 0 && f.observations > 0
        ? `${plural(f.prospects, "prospect", "prospects")} e ${plural(f.observations, "observação registada", "observações registadas")} no Scouting nesta época.`
        : "O Scouting conta como aplicação de recrutamento quando tiver prospects e observações desta época.",
  }),

  "3.4.1": (f) => piramide(f, [7, 9, 11], [13, 15], "Petizes, Traquinas e Benjamins", "Infantis e Iniciados"),
  "3.4.2": (f) => piramide(f, [13, 15], [17], "Infantis e Iniciados", "Juvenis"),
  "3.4.3": (f) => piramide(f, [17], [19], "Juvenis", "Juniores"),

  /* ── 4 · Formação desportiva: o dossier de treino ─────────────────────── */

  "4.2.1": (f) =>
    todasAsEquipas(
      f,
      (t) => t.sessionsWithBlocks > 0,
      (got, of) => `${got} de ${plural(of, "equipa planeia", "equipas planeiam")} os treinos na plataforma, todas com a mesma estrutura.`,
    ),

  "4.2.3": (f) => ({
    value: chega(f.recentSessionsPlanned, f.recentSessions) ? 1 : 0,
    detail: f.recentSessions
      ? `${f.recentSessionsPlanned} de ${plural(f.recentSessions, "treino", "treinos")} dos últimos 30 dias com plano. ${pede}`
      : "Não há treinos da formação nos últimos 30 dias.",
    progress: { got: f.recentSessionsPlanned, of: f.recentSessions },
  }),

  "4.2.4": (f) => ({
    value: chega(f.athletesEvaluated, f.formationAthletes) ? 1 : 0,
    detail: f.formationAthletes
      ? `${f.athletesEvaluated} de ${plural(f.formationAthletes, "atleta", "atletas")} com avaliação publicada nesta época. ${pede}`
      : "Ainda não há atletas nas equipas de formação.",
    progress: { got: f.athletesEvaluated, of: f.formationAthletes },
  }),

  "4.2.5": (f) =>
    todasAsEquipas(
      f,
      (t) => t.microsWithObjective > 0,
      (got, of) => `${got} de ${plural(of, "equipa tem", "equipas têm")} microciclos com objetivo escrito.`,
    ),

  "4.2.6": (f) =>
    todasAsEquipas(
      f,
      (t) => t.mesos > 0 && t.micros > 0 && t.sessionsWithBlocks > 0,
      (got, of) => `${got} de ${plural(of, "equipa tem", "equipas têm")} mesociclos, microciclos e treinos realizados com plano.`,
    ),

  // O manual pede "avaliação dos jogos" e avisa que estatística não chega: é
  // o relatório do jogo, com o que correu bem e o que há a melhorar.
  "4.2.8": (f) => {
    const got = Math.min(f.matchesWithCallUp, f.matchesWithReport);
    return {
      value: chega(got, f.matchesPlayed) ? 1 : 0,
      detail: f.matchesPlayed
        ? `${plural(f.matchesPlayed, "jogo", "jogos")} nesta época: ${f.matchesWithCallUp} com convocatória submetida e ${f.matchesWithReport} com relatório do jogo. ${pede}`
        : "Ainda não há jogos da formação nesta época.",
      progress: { got, of: f.matchesPlayed },
    };
  },

  "4.2.9": (f) => ({
    value: chega(f.plannedSessionsWithMaterial, f.plannedSessions) ? 1 : 0,
    detail: f.plannedSessions
      ? `${f.plannedSessionsWithMaterial} de ${plural(f.plannedSessions, "treino planeado indica", "treinos planeados indicam")} o material usado. ${pede}`
      : "Ainda não há treinos planeados nesta época.",
    progress: { got: f.plannedSessionsWithMaterial, of: f.plannedSessions },
  }),

  /* ── 5 · Acompanhamento médico ────────────────────────────────────────── */

  // O boletim clínico é o registo de ocorrências que as escolas têm de ter. O
  // patamar de cima (ficheiro clínico completo, com antecedentes e exame
  // objetivo) não se prova com o que a ficha médica guarda hoje.
  "5.4.2.1": (f) => ({
    value: f.clinicalEntries > 0 ? 0 : -1,
    detail: f.clinicalEntries
      ? `${plural(f.clinicalEntries, "registo", "registos")} no boletim clínico nesta época. O ficheiro clínico completo responde-se à mão.`
      : "O boletim clínico ainda não tem registos nesta época.",
  }),

  "5.4.3.1": (f) => ({
    value: chega(f.athletesWithValidExam, f.formationAthletes, 0.9) ? 1 : 0,
    detail: f.formationAthletes
      ? `${f.athletesWithValidExam} de ${plural(f.formationAthletes, "atleta", "atletas")} com exame médico-desportivo dentro da validade. Conta a partir de 90%.`
      : "Ainda não há atletas nas equipas de formação.",
    progress: { got: f.athletesWithValidExam, of: f.formationAthletes },
  }),

  "5.4.3.4": (f) => ({
    value: f.nutritionAgeGroups >= 2 ? 1 : 0,
    detail: `Planos de nutrição publicados em ${plural(f.nutritionAgeGroups, "escalão", "escalões")}. O manual pede pelo menos dois.`,
    progress: { got: Math.min(f.nutritionAgeGroups, 2), of: 2 },
  }),

  /* ── 6 · Acompanhamento escolar ───────────────────────────────────────── */

  "6.1.3.1": (f) => ({
    value: chega(f.athletesWithGrades, f.formationAthletes) ? 1 : 0,
    detail: f.formationAthletes
      ? `${f.athletesWithGrades} de ${plural(f.formationAthletes, "atleta", "atletas")} com notas da escola submetidas pelo encarregado. ${pede}`
      : "Ainda não há atletas nas equipas de formação.",
    progress: { got: f.athletesWithGrades, of: f.formationAthletes },
  }),

  /* ── 7 · Recursos humanos ─────────────────────────────────────────────── */

  // 1 treinador para 2 equipas, 1 por equipa, 2 por equipa, mais de 2.
  "7.2.2.4": (f) => {
    const equipas = equipasDeFormacao(f).length;
    const racio = equipas ? f.coaches / equipas : 0;
    const value = racio > 2 ? 3 : racio >= 2 ? 2 : racio >= 1 ? 1 : racio >= 0.5 ? 0 : -1;
    return {
      value,
      detail: equipas
        ? `${plural(f.coaches, "treinador", "treinadores")} para ${plural(equipas, "equipa", "equipas")} de formação: ${racio.toLocaleString("pt-PT", { maximumFractionDigits: 2 })} por equipa.`
        : "Ainda não há equipas de formação nesta época.",
    };
  },
};

/** Um mapa de escalões a zero, para somar por cima. */
export const semAtletas = (): Record<Escalao, number> =>
  Object.fromEntries(ESCALOES.map((e) => [e, 0])) as Record<Escalao, number>;

import type { AthleteSex, TeamGender } from "@/data/types";

/**
 * O género de uma equipa e o sexo de um atleta, como se leem.
 *
 * São duas perguntas diferentes. A da equipa é em que competição joga —
 * masculina, feminina, ou mista nos escalões de formação. A do atleta é como
 * está inscrito na federação. Uma rapariga pode jogar numa equipa mista: é por
 * isso que a contagem de praticantes femininas não se tira só das equipas.
 *
 * As duas são opcionais. Há modalidades onde não se perguntam, e as fichas que
 * já existiam não o diziam: vazio lê-se "por indicar", nunca um valor suposto.
 */
export const TEAM_GENDER_LABEL: Record<TeamGender, string> = {
  MALE: "Masculina",
  FEMALE: "Feminina",
  MIXED: "Mista",
};

export const ATHLETE_SEX_LABEL: Record<AthleteSex, string> = {
  FEMALE: "Feminino",
  MALE: "Masculino",
};

export const TEAM_GENDERS = Object.keys(TEAM_GENDER_LABEL) as TeamGender[];
export const ATHLETE_SEXES = Object.keys(ATHLETE_SEX_LABEL) as AthleteSex[];

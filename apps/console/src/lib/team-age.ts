/**
 * A idade de uma equipa, escrita e lida.
 *
 * O escalão deixou de existir como conceito à parte: era a mesma coisa que a
 * equipa, dita duas vezes. O que ficou é um inteiro — a idade máxima — e estas
 * três funções são a única tradução entre esse número e o que aparece no ecrã.
 *
 * Vive num ficheiro próprio porque é usado em muitos sítios (lista de equipas,
 * ficha, barra lateral, convites, importações) e nenhum deles é o dono.
 */

/** Uma equipa sem limite de idade — seniores. Ver `maxAge` no schema. */
export const SEM_LIMITE = 99;

/** O que se mostra: `Sub-11`, ou "Seniores" quando não há tecto. */
export function teamAgeLabel(maxAge: number): string {
  return maxAge >= SEM_LIMITE ? "Seniores" : `Sub-${maxAge}`;
}

/**
 * A idade que um nome de equipa sugere.
 *
 * Serve a importação, onde a equipa chega escrita ("Sub-11 Futebol") e é preciso
 * propor um número antes de alguém confirmar. `null` quando não há nada a ler —
 * e aí quem importa escolhe, em vez de o produto adivinhar.
 *
 * O `\d{1,2}` é deliberado: trava "Sub-2015", que é alguém a escrever o ano de
 * nascimento no sítio da idade e daria um limite absurdo.
 */
export function guessMaxAge(name: string): number | null {
  const m = /sub[\s.-]*(\d{1,2})\b/i.exec(name);
  if (!m) return null;

  const n = Number(m[1]);
  return n >= 4 && n <= SEM_LIMITE ? n : null;
}

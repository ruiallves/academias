/**
 * As épocas, do lado da consola.
 *
 * Uma época desportiva é uma escolha entre poucas, nunca uma coisa que se
 * escreva: `2026/27` e `2026/2027` são a mesma para toda a gente menos para uma
 * procura por igualdade, e o servidor resolve-a pelo rótulo — encontra-a ou
 * cria-a. Um campo de texto era, na prática, um botão para duplicar épocas.
 *
 * Vive aqui e não dentro de um diálogo porque são dois os sítios que precisam
 * disto: criar uma equipa à mão, e criar as equipas em falta durante a
 * importação de atletas.
 */

/**
 * A época a que uma data pertence: `2026/27`.
 *
 * A época vai de agosto a julho — a mesma convenção que o servidor usa ao criar
 * uma (ver `resolveSeason`). De janeiro a julho ainda se está na que começou no
 * ano anterior.
 */
export function seasonOf(date: Date): string {
  const year = date.getFullYear() - (date.getMonth() < 7 ? 1 : 0);
  return `${year}/${String((year + 1) % 100).padStart(2, "0")}`;
}

/**
 * O que um menu de épocas oferece.
 *
 * As épocas que a academia tem (o servidor manda-as da mais recente para trás)
 * mais a **actual e a seguinte**, quando ainda não existirem. As duas calculadas
 * resolvem os dois momentos em que faltaria sempre uma: a academia acabada de
 * criar, que não tem nenhuma, e o clube que em junho começa a montar as equipas
 * do ano que vem.
 *
 * Ordena-se pelo ano de início, da mais recente para trás. Um rótulo que não se
 * consiga ler como ano — um clube com convenção própria — vai para o fim em vez
 * de se perder: continua escolhível, só não se finge saber onde encaixa no tempo.
 */
export function seasonOptions(existing: string[], today = new Date()): string[] {
  const now = seasonOf(today);
  const next = seasonOf(new Date(today.getFullYear() + 1, today.getMonth(), 1));

  const all = [...new Set([...existing, now, next])];

  return all.sort((a, b) => {
    const ya = startYear(a);
    const yb = startYear(b);
    if (ya === null && yb === null) return a.localeCompare(b, "pt");
    if (ya === null) return 1;
    if (yb === null) return -1;
    return yb - ya;
  });
}

function startYear(label: string): number | null {
  const m = label.match(/^(\d{4})/);
  return m ? Number(m[1]) : null;
}

/**
 * A que já vem escolhida.
 *
 * A época de hoje, que é a que quem cria uma equipa quer em quase todos os
 * casos. Se por alguma razão não estiver na lista, a primeira serve — nunca se
 * devolve vazio, porque o servidor recusa uma equipa sem época e o erro chegaria
 * já depois de a pessoa ter carregado no botão.
 */
export function defaultSeason(choices: string[]): string {
  const now = seasonOf(new Date());
  return choices.includes(now) ? now : (choices[0] ?? now);
}

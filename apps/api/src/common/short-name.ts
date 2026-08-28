/**
 * O nome curto de um clube.
 *
 * Vive aqui, e não no módulo da plataforma onde nasceu, porque tem dois donos: a
 * plataforma deriva-o ao abrir o clube, e o clube corrige-o nas Definições. A
 * regra de comprimento tem de ser a mesma dos dois lados — se não fosse, a
 * criação produziria nomes que a edição depois recusava.
 */

/** Cabe "Clube Desportivo de Loureiro" inteiro, que era o ponto. */
export const SHORT_NAME_MAX = 32;

/**
 * O nome curto a partir do nome completo.
 *
 * ## Porque é que deixou de adivinhar
 *
 * Cortava a primeira palavra quando ela era "Academia", "Clube" ou "Associação".
 * Isso funcionava para o caso que lhe deu origem — "Academia Life Club" → "Life
 * Club" — e falhava em quase todos os nomes de clube portugueses, onde a palavra
 * do tipo faz parte do nome e o que sobra não é como ninguém lhe chama:
 *
 *     Clube Desportivo de Loureiro   ->  Desportivo de Loureiro
 *     Associação Desportiva de Fafe  ->  Desportiva de Fafe
 *
 * Um clube chama-se como se chama. Encurtar "Clube Desportivo de Loureiro" para
 * "CD Loureiro" é uma decisão de quem lá trabalha, não uma regra que se escreva
 * — e o produto já diz o mesmo sobre os nomes dos cargos, que também não são
 * adivinháveis. Por isso o nome curto passa a ser o nome, e o clube pode
 * trocá-lo nas Definições.
 *
 * ## O corte
 *
 * O que sobra é um limite de comprimento, não uma opinião sobre o nome — e por
 * isso corta em espaço, nunca a meio de uma palavra. O `slice` cego a 24 dava
 * "Futebol Clube Ferreirens" e "Grupo Desportivo de Chav" — nomes que não são de
 * ninguém e que apareciam no email, na página de sócios e no telemóvel dos pais.
 */
export function shortNameOf(name: string): string {
  const limpo = name.replace(/\s+/g, " ").trim();
  if (limpo.length <= SHORT_NAME_MAX) return limpo;

  // O +1 é para saber se o corte caiu **em** espaço: nesse caso a última palavra
  // está inteira e não há razão para a deitar fora.
  const ate = limpo.slice(0, SHORT_NAME_MAX + 1).lastIndexOf(" ");
  // `ate <= 0` é uma primeira palavra maior que o limite. Aí não há espaço onde
  // cortar e o corte cego é o menos mau — mas é um nome que nenhum clube tem.
  return ate > 0 ? limpo.slice(0, ate) : limpo.slice(0, SHORT_NAME_MAX);
}

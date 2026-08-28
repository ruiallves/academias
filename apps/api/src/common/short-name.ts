/**
 * O nome curto de um clube.
 *
 * Vive aqui, e não no módulo da plataforma onde nasceu, porque tem dois donos: a
 * plataforma deriva-o ao abrir o clube, e o clube corrige-o nas Definições. A
 * regra de comprimento tem de ser a mesma dos dois lados — se não fosse, a
 * criação produziria nomes que a edição depois recusava.
 */

/**
 * O mesmo tecto do nome completo — porque é isso que o nome curto é por omissão.
 *
 * Era 32, escolhido para caber "Clube Desportivo de Loureiro". Escolher um número
 * é escolher os clubes que ficam de fora dele, e ficaram: "Associação Desportiva
 * Oliveirense" tem 33 e perdia "Oliveirense"; "Clube Recreativo e Cultural do
 * Forte da Casa" tem 44 e parava em "do". Não há número certo — há clubes com
 * nomes compridos, e o nome deles é o nome deles.
 *
 * O limite fica só como sanidade, igual ao do `name`: é o que o clube pode
 * escrever à mão nas Definições quando quiser mesmo um nome curto ("CD
 * Loureiro"). Ver `shortNameOf`.
 */
export const SHORT_NAME_MAX = 120;

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
 * ## E porque é que também deixou de cortar
 *
 * Tinha ficado um limite de comprimento — 32 caracteres, cortados num espaço
 * para não partir palavras. Mais honesto que o `slice` cego a 24, que dava
 * "Futebol Clube Ferreirens", mas errado pela mesma razão de fundo: escolher um
 * número é escolher que clubes ficam de fora dele.
 *
 *     Associação Desportiva Oliveirense (33)  ->  Associação Desportiva
 *     Clube Recreativo e Cultural do Forte da Casa (44)
 *                                             ->  Clube Recreativo e Cultural do
 *
 * O segundo nem sequer acaba numa palavra que se leia. E isto aparecia no
 * assunto dos emails, na página de sócios e no telemóvel dos pais.
 *
 * Um clube chama-se pelo nome todo. Onde não couber, é o CSS que trunca — com
 * reticências, no sítio onde está apertado, sem estragar o dado. Encurtar é uma
 * decisão do clube, e tem campo próprio nas Definições.
 */
export function shortNameOf(name: string): string {
  return name.replace(/\s+/g, " ").trim().slice(0, SHORT_NAME_MAX);
}

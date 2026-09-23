/**
 * A aritmética de uma anuidade: que meses cobre, onde acaba, e como se reparte.
 *
 * ## Porque é que isto vive num ficheiro só seu
 *
 * Porque é **dinheiro** e é a parte fácil de enganar. Partir uma anuidade em
 * duas é contar meses entre duas datas que não caem no dia 1, decidir de que
 * lado fica o mês escolhido, e repartir cêntimos sem que a soma deixe de bater
 * certo. Dentro do serviço, nada disto se conseguia exercitar sem uma base de
 * dados e um servidor a correr.
 *
 * Aqui não há Nest, não há Prisma, não há importação nenhuma — e por isso
 * `scripts/test-cobertura-anual.mjs` carrega este ficheiro tal como ele é e
 * verifica as contas com as datas reais de um clube.
 *
 * ## A convenção, uma vez para todas
 *
 * Um mês vai do dia de abertura ao dia anterior do mês seguinte: com o ano a
 * abrir dia 22, "Setembro" é de 22 de Setembro a 21 de Outubro. `coversTo` é
 * sempre **inclusivo**, e o mês que se escolhe para o fim **entra**: cobrar
 * "até Dezembro" cobra Dezembro.
 */

/** `AAAA-MM` de uma data, em UTC (as datas de cobertura são datas puras). */
export function mesDe(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** O número de ordem de um mês, para os comparar e somar. */
function indiceDoMes(period: string): number {
  const [ano, mes] = period.split("-").map(Number);
  return ano * 12 + (mes - 1);
}

/** `n` meses depois de `period`. `mesMais("2026-09", 11)` é `"2027-08"`. */
export function mesMais(period: string, n: number): string {
  const i = indiceDoMes(period) + n;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
}

/** Quantos meses vão de `de` a `ate`, inclusive. Zero ou negativo se `ate` for antes. */
export function distanciaEmMeses(de: string, ate: string): number {
  return indiceDoMes(ate) - indiceDoMes(de) + 1;
}

/**
 * O dia `dia` do mês, sem nunca cair fora dele.
 *
 * Um sócio que adere a 31 de Janeiro não tem 31 de Fevereiro; sem isto o `Date`
 * transbordava para Março e a cobertura saltava um mês inteiro.
 */
function diaSeguro(ano: number, mes: number, dia: number): Date {
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return new Date(Date.UTC(ano, mes - 1, Math.min(dia, ultimo)));
}

/** O primeiro dia coberto por uma quota que abre em `period`. */
export function inicioDaCobertura(period: string, dia: number): Date {
  const [ano, mes] = period.split("-").map(Number);
  return diaSeguro(ano, mes, dia);
}

/**
 * O último dia coberto por quem cobra **até ao fim do mês `ate`, inclusive**.
 *
 * Com o ano a abrir dia 22, cobrar de Setembro até Dezembro vai de 22 de
 * Setembro a 21 de Janeiro — quatro meses, contados de dia 22 a dia 21. Com
 * abertura no dia 1 dá o que se espera: 31 de Dezembro.
 */
export function fimDaCobertura(ate: string, dia: number): Date {
  const [ano, mes] = ate.split("-").map(Number);
  const seguinte = mesMais(`${ano}-${String(mes).padStart(2, "0")}`, 1);
  const [aS, mS] = seguinte.split("-").map(Number);
  return new Date(diaSeguro(aS, mS, dia).getTime() - 86_400_000);
}

/**
 * O último mês **incluído** numa cobertura que acaba em `coversTo`.
 *
 * É o inverso de `fimDaCobertura`, e é o que o ecrã mostra e recebe: quem
 * escolheu "até Dezembro" tem de voltar a ver "Dezembro" ao reabrir a quota.
 */
export function mesFinalCoberto(coversTo: Date): string {
  const seguinte = new Date(coversTo.getTime() + 86_400_000);
  const ano = seguinte.getUTCFullYear();
  const mes = seguinte.getUTCMonth(); // 0-based: já é o mês anterior, em base 1
  return mes === 0 ? `${ano - 1}-12` : `${ano}-${String(mes).padStart(2, "0")}`;
}

/** Quantos meses inteiros uma cobertura vale — é isto que decide o preço. */
export function mesesCobertos(coversFrom: Date, coversTo: Date): number {
  return distanciaEmMeses(mesDe(coversFrom), mesFinalCoberto(coversTo));
}

/**
 * O mês em que abriu o ano a que `agora` pertence — `AAAA-MM`.
 *
 * Antes do dia, o mês de abertura ainda pertence ao ano anterior: a 10 de
 * Setembro, num ano que abre a 15, o ciclo é o que abriu há doze meses.
 *
 * Lê o relógio local de propósito (é o do servidor, que em produção é UTC): é o
 * comportamento que esta função sempre teve, e mudá-lo agora deslocava o ciclo
 * de toda a gente.
 */
export function inicioDaEpoca(agora: Date, inicio = 8, dia = 1): string {
  const m = agora.getMonth() + 1;
  const jaAbriu = m > inicio || (m === inicio && agora.getDate() >= dia);
  const ano = jaAbriu ? agora.getFullYear() : agora.getFullYear() - 1;
  return `${ano}-${String(inicio).padStart(2, "0")}`;
}

/** Duas coberturas que se pisam. Ninguém pode dever o mesmo mês duas vezes. */
export function sobrepoem(a: { de: Date; ate: Date }, b: { de: Date; ate: Date }): boolean {
  return a.de <= b.ate && b.de <= a.ate;
}

/**
 * Repartir o valor de uma anuidade por duas partes, proporcional aos meses.
 *
 * A segunda fica com **o que sobra**, e não com a sua própria conta
 * arredondada: dividir 120 € por 12 e multiplicar de volta dá 120 €, mas 100 €
 * por 12 não — a 4/12 e 8/12 arredondados dá 33,33 + 66,67, e só uma das duas
 * formas garante que somam os 100 € que o sócio deve. É a mesma regra do resto
 * do produto: o total manda, e a última parcela absorve o cêntimo.
 */
export function repartirValor(
  totalCents: number,
  mesesTotais: number,
  mesesDaPrimeira: number,
): { primeira: number; segunda: number } {
  const primeira = Math.round((totalCents * mesesDaPrimeira) / mesesTotais);
  return { primeira, segunda: totalCents - primeira };
}

/**
 * O que a coluna "Início do ano de quotas" faz a uma linha da folha.
 *
 * Vive aqui, sozinha e sem Prisma, porque é a regra mais destrutiva da
 * importação: dela sai a decisão de **apagar as quotas de um ano**. Uma regra
 * dessas não pode estar espalhada por três ramos de um `forEach` de duzentas
 * linhas onde ninguém a consegue ler inteira — nem ser provada só por leitura.
 *
 * As quatro respostas, e o porquê de cada uma:
 *
 * - **ficha nova** — grava o que a célula diz, e o dia de hoje quando ela vem
 *   vazia. É a mesma regra de quem é inscrito à mão: quem adere hoje começa o
 *   ano hoje. Não há nada a refazer, porque ainda não há quotas.
 * - **ficha que já cá está, célula vazia** — não se toca. Vazio não é uma
 *   ordem: é a folha a não trazer a coluna preenchida naquela linha, e a regra
 *   de toda a importação é que um campo que a folha não traz não apaga o que lá
 *   está. Aqui vale a dobrar, porque "assumir hoje" refazia-lhe a anuidade.
 * - **célula igual ao que a ficha tem** — grava-se (é inócuo) e **não se
 *   refaz**. Este é o caso normal do ida-e-volta: a folha exportada traz a
 *   coluna preenchida em toda a gente, e refazer o ano de trezentos sócios por
 *   causa de uma vírgula corrigida noutra coluna seria estragar o livro com um
 *   clique de correção.
 * - **célula diferente** — grava e refaz.
 *
 * `refaz` ainda não quer dizer que alguma coisa vá ser apagada: só as
 * categorias anuais têm anuidade, e quem escreve verifica isso a seguir.
 */
export function decisaoDoAnoDaFolha(
  /** A célula já normalizada em `MM-DD`, ou nulo quando vem vazia. */
  celula: string | null,
  /** A ficha que a linha encontrou no livro, ou nulo quando é um sócio novo. */
  socio: { annualStartMonth: number | null; annualStartDay: number | null } | null,
  /** Hoje, pelo relógio do clube. */
  hoje: { mes: number; dia: number },
): { grava: { mes: number; dia: number } | null; refaz: boolean } {
  const daCelula = celula ? { mes: Number(celula.slice(0, 2)), dia: Number(celula.slice(3, 5)) } : null;

  if (!socio) return { grava: daCelula ?? hoje, refaz: false };
  if (!daCelula) return { grava: null, refaz: false };

  const igual = socio.annualStartMonth === daCelula.mes && socio.annualStartDay === daCelula.dia;
  return { grava: daCelula, refaz: !igual };
}

/**
 * Quem é "o Pedro"?
 *
 * ## Porque é que o código resolve os nomes, e não a IA
 *
 * O treinador diz "faltaram o Pedro e o Rui". O modelo não tem de saber quem
 * são: devolve os nomes tal como foram ditos, e é aqui que se procura cada um
 * no plantel. Se houver dois Pedro, não se adivinha: devolve-se a ambiguidade,
 * e a consola pergunta com botões.
 *
 * Isto faz três coisas de uma vez. O plantel não precisa de ir para o modelo
 * (menos dados de menores a sair, menos tokens). A escolha entre dois nomes é
 * de quem fala, não de uma probabilidade. E o modelo leve chega para a tarefa,
 * porque a parte difícil deixou de ser dele.
 *
 * ## O que conta como o mesmo nome
 *
 * Sem acentos, sem maiúsculas, sem pontuação. "Tomas" encontra "Tomás", "ze
 * pedro" encontra "José Pedro Silva". As alcunhas mais comuns em Portugal estão
 * numa lista curta: "Zé" é José, "Chico" é Francisco. Uma lista longa de
 * alcunhas era adivinhar; esta só desfaz as que toda a gente usa.
 */

export type Pessoa = { id: string; name: string; squadNumber?: number | null; position?: string | null };

export type Resolucao<P extends Pessoa = Pessoa> =
  | { tipo: "unico"; pessoa: P }
  | { tipo: "ambiguo"; opcoes: P[] }
  | { tipo: "nenhum" };

const ALCUNHAS: Record<string, string[]> = {
  ze: ["jose"],
  zeca: ["jose"],
  chico: ["francisco"],
  xico: ["francisco"],
  kiko: ["francisco"],
  quim: ["joaquim"],
  to: ["antonio"],
  toze: ["antonio"],
  tone: ["antonio"],
  nando: ["fernando"],
  gui: ["guilherme"],
  guga: ["gustavo"],
  edu: ["eduardo"],
  rafa: ["rafael", "rafaela"],
  gabi: ["gabriel", "gabriela"],
  leo: ["leonardo", "leonor"],
  manel: ["manuel"],
  nel: ["manuel"],
  tiago: ["thiago"],
  thiago: ["tiago"],
  bea: ["beatriz"],
  carol: ["carolina"],
  cris: ["cristiano", "cristina", "cristiana"],
  dani: ["daniel", "daniela"],
  fabio: ["fabio"],
  vasquinho: ["vasco"],
  tomas: ["tomas"],
  lipe: ["filipe"],
  pipo: ["filipe"],
  rui: ["rui"],
  duda: ["eduarda", "maria eduarda"],
  mica: ["micael", "michael", "micaela"],
};

/** Minúsculas, sem acentos, sem pontuação; só letras, números e espaços. */
export function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** As palavras de um nome, sem as partículas ("de", "da", "dos"). */
export function palavras(nome: string): string[] {
  const PARTICULAS = new Set(["de", "da", "do", "das", "dos", "e"]);
  return normalizar(nome).split(" ").filter((p) => p && !PARTICULAS.has(p));
}

function variantes(palavra: string): string[] {
  return [palavra, ...(ALCUNHAS[palavra] ?? [])];
}

/**
 * Procura um nome dito num plantel.
 *
 * Por ordem, até encontrar exatamente um:
 *   1. o nome inteiro igual;
 *   2. todas as palavras ditas aparecem no nome, pela ordem ("Pedro Sousa" em
 *      "Pedro Miguel Sousa");
 *   3. todas as palavras ditas aparecem no nome, em qualquer ordem;
 *   4. a primeira palavra dita é o primeiro nome ("Pedro" em "Pedro Sousa"),
 *      com as alcunhas desfeitas;
 *   5. qualquer palavra dita começa uma palavra do nome ("Gonç" em "Gonçalo").
 *
 * Em cada degrau, dois ou mais candidatos são uma ambiguidade e param a busca:
 * descer mais um degrau só ia inventar certeza.
 */
export function resolverNome<P extends Pessoa>(dito: string, plantel: readonly P[]): Resolucao<P> {
  const ditas = palavras(dito);
  if (ditas.length === 0) return { tipo: "nenhum" };
  const alvo = ditas.join(" ");

  const indexado = plantel.map((p) => ({ p, palavras: palavras(p.name), inteiro: palavras(p.name).join(" ") }));

  /*
   * Uma palavra só é quase sempre o primeiro nome: "o Pedro" são os Pedro, e
   * não também o José Pedro. Por isso, com uma palavra, o primeiro nome
   * procura-se antes de "aparece em qualquer sítio"; com duas ou mais, a
   * ordem dita é que manda ("Pedro Sousa" em "Pedro Miguel Sousa").
   */
  const primeiroNome = (c: (typeof indexado)[number]) => c.palavras.length > 0 && variantes(ditas[0]).includes(c.palavras[0]);
  const degraus: ((c: (typeof indexado)[number]) => boolean)[] = [
    (c) => c.inteiro === alvo,
    ...(ditas.length === 1 ? [primeiroNome] : []),
    (c) => emOrdem(ditas, c.palavras),
    (c) => ditas.every((d) => c.palavras.some((n) => variantes(d).includes(n))),
    (c) => ditas.every((d) => d.length >= 3 && c.palavras.some((n) => n.startsWith(d))),
  ];

  for (const degrau of degraus) {
    const encontrados = indexado.filter(degrau).map((c) => c.p);
    if (encontrados.length === 1) return { tipo: "unico", pessoa: encontrados[0] };
    if (encontrados.length > 1) return { tipo: "ambiguo", opcoes: encontrados };
  }
  return { tipo: "nenhum" };
}

/** As palavras ditas aparecem no nome, por esta ordem, com variantes de alcunha. */
function emOrdem(ditas: string[], nome: string[]): boolean {
  let i = 0;
  for (const n of nome) {
    if (i < ditas.length && variantes(ditas[i]).includes(n)) i++;
  }
  return i === ditas.length;
}

/**
 * Resolve uma lista de nomes de uma vez, separando o que ficou claro do que
 * precisa de pergunta. Um nome que já saiu resolvido não volta a ser opção
 * para o seguinte: "o Pedro e o Pedro Almeida" dá dois atletas, não um.
 */
export function resolverNomes<P extends Pessoa>(
  ditos: readonly string[],
  plantel: readonly P[],
): { resolvidos: { dito: string; pessoa: P }[]; ambiguos: { dito: string; opcoes: P[] }[]; desconhecidos: string[] } {
  const resolvidos: { dito: string; pessoa: P }[] = [];
  const ambiguos: { dito: string; opcoes: P[] }[] = [];
  const desconhecidos: string[] = [];

  // Duas passagens: primeiro os que resolvem sozinhos, depois os restantes sem
  // esses candidatos, para "Pedro" deixar de ser ambíguo quando "Pedro Almeida"
  // já foi dito na mesma frase.
  const pendentes: string[] = [];
  for (const dito of ditos) {
    const r = resolverNome(dito, plantel);
    if (r.tipo === "unico") resolvidos.push({ dito, pessoa: r.pessoa });
    else pendentes.push(dito);
  }
  const usados = new Set(resolvidos.map((r) => r.pessoa.id));
  const restante = plantel.filter((p) => !usados.has(p.id));
  for (const dito of pendentes) {
    const r = resolverNome(dito, restante);
    if (r.tipo === "unico") {
      resolvidos.push({ dito, pessoa: r.pessoa });
      usados.add(r.pessoa.id);
    } else if (r.tipo === "ambiguo") ambiguos.push({ dito, opcoes: r.opcoes });
    else desconhecidos.push(dito);
  }
  return { resolvidos, ambiguos, desconhecidos };
}

/** "Pedro Sousa (n.º 7, médio)", para as opções da pergunta. */
export function rotuloDe(p: Pessoa): string {
  const extras = [p.squadNumber != null ? `n.º ${p.squadNumber}` : null, p.position || null].filter(Boolean);
  return extras.length ? `${p.name} (${extras.join(", ")})` : p.name;
}

/**
 * O que é comum às duas importações: sócios e atletas.
 *
 * ## Quem já cá está
 *
 * As duas folhas trazem gente que o clube já tem. Antes isso era um erro de
 * linha (atletas) ou uma linha ignorada em silêncio (sócios), e em nenhum dos
 * casos dava para fazer o que os clubes realmente querem: **corrigir um campo
 * em toda a gente de uma vez**, na folha de cálculo, e mandar de volta.
 *
 * Agora o servidor pára antes de escrever e devolve quem reconheceu, com o
 * nome que encontrou e a lista do que ia mudar. Esta é a forma dessa resposta,
 * e o painel que a mostra vive em `components/ConfirmarSobrescrita.tsx`.
 *
 * ## Porque é que o nome encontrado vem sempre
 *
 * Porque a correspondência pode estar errada — um telemóvel de casa partilhado
 * por dois sócios, um NIF mal escrito. Ver o nome da folha ao lado do nome da
 * ficha é o que faz um engano saltar à vista **antes** de ser aplicado. Sem
 * isso, a confirmação seria um "sim" às cegas.
 */

/** Uma linha da folha que corresponde a alguém que já existe. */
export type LinhaExistente = {
  line: number;
  /** O nome como vem na folha. */
  name: string;
  /** O nome de quem foi encontrado na plataforma. */
  matchedName: string;
  /** Os campos que iam mudar, escritos para se lerem. Vazio não aparece. */
  changes: string[];
};

/** A parte da resposta que diz "isto já cá está — continuo?". */
export type RespostaComExistentes = {
  existing: LinhaExistente[];
  /** Quantos ao todo: `existing` vem cortada para a resposta não crescer sem fim. */
  existingTotal: number;
};

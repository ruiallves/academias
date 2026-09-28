/**
 * Reduzir uma fotografia antes de a carregar.
 *
 * ## A conta que isto veio pagar
 *
 * As fotografias entravam como saíam da câmara e ficavam assim para sempre: 108
 * fotografias de atleta a ocupar 57 MB, a maior com 7 MB. Depois apareciam em
 * avatares de 34 pixels e em fichas que não passam dos 400. Cada abertura da
 * lista de atletas descarregava esses 57 MB do armazenamento, e ao fim do mês
 * isso é uma factura.
 *
 * Uma fotografia de ficha reduzida a 1024 pixels fica à volta dos 150 kB. É a
 * mesma imagem em qualquer ecrã onde este produto a mostra, e é quarenta vezes
 * mais barata.
 *
 * ## Porquê no browser e não no servidor
 *
 * Porque o ficheiro **não passa pela API**: vai daqui directamente para o
 * armazenamento, por endereço assinado (ver `photos.service.ts`). Reduzir no
 * servidor obrigaria a atravessar cada imagem no processo que serve toda a
 * gente, só para a tornar mais pequena. Aqui é o telemóvel de quem a escolheu a
 * fazer o trabalho, e o que sobe já é o tamanho final.
 *
 * ## O que não se perde
 *
 * A orientação, que é o erro clássico de quem redesenha uma fotografia num
 * `canvas`: uma foto tirada na vertical tem a rotação escrita nos metadados, e
 * desenhá-la sem a ler põe toda a gente deitada. `createImageBitmap` com
 * `imageOrientation: "from-image"` resolve-o onde existe, e o caminho
 * alternativo deixa a fotografia como está em vez de a estragar.
 *
 * Uma imagem já pequena também não se toca: voltar a comprimir o que já está
 * comprimido só tira qualidade.
 */

/** O lado maior, em pixels. O dobro do maior sítio onde uma foto destas aparece. */
const LADO_MAXIMO = 1024;

/** Abaixo disto não vale a pena mexer: o ganho não paga a perda de qualidade. */
const JA_E_PEQUENA = 400 * 1024;

/** Qualidade do JPEG de saída. Acima de 0,85 o ficheiro cresce sem se ver diferença. */
const QUALIDADE = 0.85;

/**
 * Devolve a fotografia pronta a carregar — reduzida, ou a original quando não
 * há nada a ganhar ou quando o browser não consegue.
 *
 * **Nunca lança.** Uma fotografia grande é um problema de custo; uma fotografia
 * que não carrega é um problema de quem está à espera dela. Perante qualquer
 * falha devolve-se o ficheiro original e segue-se.
 */
export async function reduzirFotografia(file: File): Promise<File> {
  return reduzir(file, { ladoMaximo: LADO_MAXIMO, jaEPequena: JA_E_PEQUENA, qualidade: QUALIDADE });
}

/**
 * Reduzir uma imagem de treino: um quadro tático, uma montagem, uma prancheta.
 *
 * Mais generosa do que a de uma fotografia de pessoa, porque aqui há texto e
 * setas para ler: 2400 pixels no lado maior e JPEG a 0,88. Uma fotografia de
 * telemóvel de um quadro (5 a 12 MB) fica perto de 1 MB e lê-se igual no ecrã
 * e no PDF do exercício. Uma imagem com até 1,5 MB não se toca.
 *
 * O que se ganha também conta no espaço do clube (5 GB por omissão, ver
 * `EspacoService` na API): uma biblioteca de exercícios com fotografias de
 * câmara enchia-o dez vezes mais depressa.
 */
export async function reduzirImagemDeTreino(file: File): Promise<File> {
  return reduzir(file, { ladoMaximo: 2400, jaEPequena: 1.5 * 1024 * 1024, qualidade: 0.88 });
}

async function reduzir(
  file: File,
  opcoes: { ladoMaximo: number; jaEPequena: number; qualidade: number },
): Promise<File> {
  const { ladoMaximo, jaEPequena, qualidade } = opcoes;
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return file;
  if (file.size <= jaEPequena) return file;

  try {
    const bitmap = await desenhavel(file);
    if (!bitmap) return file;

    /*
     * Uma imagem que já cabe no lado máximo fica com escala 1 e só é recomprimida
     * — que é o que baixa os 7 MB de uma câmara sem lhe mexer no tamanho.
     */
    const escala = Math.min(1, ladoMaximo / Math.max(bitmap.width, bitmap.height));
    const largura = Math.round(bitmap.width * escala);
    const altura = Math.round(bitmap.height * escala);

    const canvas = document.createElement("canvas");
    canvas.width = largura;
    canvas.height = altura;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, largura, altura);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", qualidade),
    );
    /* Se o resultado não ficou menor, a original serve — e é sempre melhor. */
    if (!blob || blob.size >= file.size) return file;

    return new File([blob], trocarExtensao(file.name), { type: "image/jpeg", lastModified: Date.now() });
  } catch {
    return file;
  }
}

/** A imagem em algo que o `canvas` saiba desenhar, já com a rotação certa. */
async function desenhavel(file: File): Promise<ImageBitmap | null> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      /* Há browsers que não conhecem a opção. Cai para o caminho de baixo. */
    }
  }

  /*
   * Sem `createImageBitmap` não há forma de ler a orientação, e desenhar a
   * fotografia assim mesmo era arriscar deitá-la. Devolve-se `null`: fica
   * grande, que é o mal menor.
   */
  return null;
}

const trocarExtensao = (nome: string) => `${nome.replace(/\.[^.]+$/, "")}.jpg`;

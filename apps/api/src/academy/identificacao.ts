/**
 * A identificação de um atleta: o NIF, ou outro documento.
 *
 * Um atleta estrangeiro pode não ter NIF português. Nesse caso o clube escreve
 * o nome do documento (só para si: "Passaporte", "Título de residência") e o
 * número. Cada atleta tem de ter um dos dois, e é por eles que a família o
 * reclama na app (com a data de nascimento) e que a importação reconhece uma
 * ficha que já existe.
 *
 * Tudo o que decide vive aqui, sem Nest nem Prisma, para os quatro caminhos que
 * escrevem atletas (inscrição, edição, importação, recrutamento do scouting) e
 * o registo da família dizerem exactamente o mesmo.
 */

/** O NIF como se guarda: só os nove algarismos. */
export function normalizarNif(v: string | null | undefined): string {
  return (v ?? "").replace(/[\s.]/g, "");
}

/**
 * O número do documento como se guarda e se compara.
 *
 * Maiúsculas e sem separadores: "ab 123.456-c" e "AB123456C" são o mesmo
 * passaporte, e a família escreve-o como o tiver à frente.
 */
export function normalizarDocumento(v: string | null | undefined): string {
  return (v ?? "").toUpperCase().replace(/[\s.\-/]/g, "");
}

export const NIF_VALIDO = /^\d{9}$/;
/** Letras e algarismos, de 3 a 30: cobre passaportes, cartões e títulos de residência. */
export const DOCUMENTO_VALIDO = /^[A-Z0-9]{3,30}$/;

export type Identificacao = { taxId: string | null; idDocLabel: string | null; idDocNumber: string | null };

/**
 * A identificação de um atleta novo, a partir do que veio no pedido.
 *
 * Devolve o erro como texto, e não uma excepção: a importação precisa dele
 * como erro de linha e segue para a seguinte.
 */
export function identificacaoNova(dto: {
  taxId?: string | null;
  idDocLabel?: string | null;
  idDocNumber?: string | null;
}): Identificacao | { error: string } {
  const nif = normalizarNif(dto.taxId);
  const doc = normalizarDocumento(dto.idDocNumber);
  if (nif && !NIF_VALIDO.test(nif)) return { error: "O NIF tem nove dígitos" };
  if (doc && !DOCUMENTO_VALIDO.test(doc)) {
    return { error: "O número do documento tem de 3 a 30 letras ou algarismos" };
  }
  if (!nif && !doc) return { error: "Falta a identificação: o NIF ou o número de outro documento" };
  return {
    taxId: nif || null,
    idDocNumber: doc || null,
    // O nome só faz sentido com o número.
    idDocLabel: doc ? dto.idDocLabel?.trim() || null : null,
  };
}

/**
 * A identificação depois de uma edição, a partir da que a ficha tinha.
 *
 * Um campo que não veio fica como estava; um campo que veio vazio limpa-se.
 * Trocar o NIF por um passaporte é mandar os dois de uma vez: o NIF vazio e o
 * documento preenchido. O que nunca pode acontecer é a ficha ficar sem nenhum.
 */
export function identificacaoEditada(
  actual: Identificacao,
  dto: { taxId?: string | null; idDocLabel?: string | null; idDocNumber?: string | null },
): Identificacao | { error: string } {
  const taxId = dto.taxId === undefined ? actual.taxId : normalizarNif(dto.taxId) || null;
  const idDocNumber = dto.idDocNumber === undefined ? actual.idDocNumber : normalizarDocumento(dto.idDocNumber) || null;
  const idDocLabel =
    dto.idDocLabel === undefined ? actual.idDocLabel : dto.idDocLabel?.trim() || null;

  if (taxId && !NIF_VALIDO.test(taxId)) return { error: "O NIF tem nove dígitos" };
  if (idDocNumber && !DOCUMENTO_VALIDO.test(idDocNumber)) {
    return { error: "O número do documento tem de 3 a 30 letras ou algarismos" };
  }
  /*
   * Uma ficha antiga sem identificação nenhuma pode ser editada noutros campos
   * sem ter de a preencher já: só se recusa quando é a edição a apagá-la.
   */
  const tinha = Boolean(actual.taxId || actual.idDocNumber);
  if (tinha && !taxId && !idDocNumber) {
    return { error: "O atleta tem de ficar com o NIF ou com outro documento" };
  }
  return { taxId, idDocNumber, idDocLabel: idDocNumber ? idDocLabel : null };
}

/**
 * As chaves por que uma ficha se reconhece na importação: `NIF:…` e `DOC:…`.
 * Um atleta com os dois é encontrado por qualquer um.
 */
export function chavesDeIdentidade(i: { taxId?: string | null; idDocNumber?: string | null }): string[] {
  return [...(i.taxId ? [`NIF:${i.taxId}`] : []), ...(i.idDocNumber ? [`DOC:${i.idDocNumber}`] : [])];
}

/** O que se mostra quando é preciso dizer qual é a identificação: o NIF, ou o documento. */
export function identificacaoLegivel(i: Identificacao): string {
  if (i.taxId) return `NIF ${i.taxId}`;
  if (i.idDocNumber) return `${i.idDocLabel ?? "Documento"} ${i.idDocNumber}`;
  return "sem identificação";
}

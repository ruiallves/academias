import { BadRequestException } from "@nestjs/common";
import { PaymentMethod } from "@prisma/client";

/**
 * Os valores mais baixos que a euPago aceita, por método.
 *
 * Da documentação da euPago (Setembro de 2026):
 *
 * - MB WAY: "Minimum Amount: 0,50€" (máximo 99 999 €);
 * - Multibanco: "Minimum Amount: 1€" (máximo 99 999 €).
 *
 * São os dois métodos ligados (`METODOS_ATIVOS`). O mínimo de uma cobrança é
 * o mais baixo dos dois, 0,50 €: abaixo disso nenhum método a consegue cobrar.
 * Entre 0,50 € e 1 € só se paga por MB WAY, e a app esconde o Multibanco.
 *
 * O 0 € é outra coisa: é o atleta ou o sócio isento, cuja cobrança nasce paga
 * e nunca chega à euPago (ver `nasceIsenta`).
 */
export const MINIMO_POR_METODO: Partial<Record<PaymentMethod, number>> = {
  [PaymentMethod.MBWAY]: 50,
  [PaymentMethod.MULTIBANCO]: 100,
};

/** O mínimo de uma cobrança: o do método mais barato que está ligado. */
export const MINIMO_COBRAVEL = 50;

const euros = (cents: number) => `${(cents / 100).toFixed(2).replace(".", ",")} €`;

/** Recusa um pagamento que a euPago recusaria, com uma frase que diz o que fazer. */
export function assertMinimoDoMetodo(method: PaymentMethod, amountCents: number): void {
  const minimo = MINIMO_POR_METODO[method];
  if (minimo === undefined || amountCents >= minimo) return;
  if (method === PaymentMethod.MULTIBANCO && amountCents >= (MINIMO_POR_METODO[PaymentMethod.MBWAY] ?? 0)) {
    throw new BadRequestException(`O Multibanco só aceita pagamentos a partir de ${euros(minimo)}. Paga por MB WAY.`);
  }
  throw new BadRequestException(`Este valor (${euros(amountCents)}) é baixo demais para pagar online. Fala com o clube.`);
}

/** Um preço ou uma cobrança: 0 € (isento) ou a partir do mínimo cobrável. */
export function assertZeroOuCobravel(amountCents: number, o = "O valor"): void {
  if (!Number.isInteger(amountCents) || amountCents < 0) throw new BadRequestException(`${o} não é válido`);
  if (amountCents > 0 && amountCents < MINIMO_COBRAVEL) {
    throw new BadRequestException(`${o} tem de ser 0 € ou pelo menos ${euros(MINIMO_COBRAVEL)}: abaixo disso não se consegue pagar online`);
  }
}

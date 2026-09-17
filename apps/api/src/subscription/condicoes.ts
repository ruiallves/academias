import type { SubscriptionBillingPeriod } from "@prisma/client";

/**
 * As frases do período contratual mínimo — num sítio só.
 *
 * O contrato aparece em três lugares que têm de dizer o mesmo: o email que o
 * responsável do clube recebe, o painel onde ele assina (na consola) e o
 * diálogo da plataforma onde alguém o emite. Enquanto era `${meses} meses` em
 * cada um, "sem fidelização" escrevia-se "1 mês" e dois anos escreviam-se "24
 * meses", que é verdade e não é o que se negociou.
 *
 * A regra do produto, decidida com o Rui: **mensal não tem fidelização** (o
 * mínimo é o próprio mês) e **anual tem-na em anos**.
 */

/** Um mínimo de um mês é o próprio mês: não é fidelização nenhuma. */
export const semFidelizacao = (minimumMonths: number): boolean => minimumMonths <= 1;

/** "Sem período mínimo", "2 anos", "18 meses". */
export function periodoMinimoPorExtenso(minimumMonths: number): string {
  if (semFidelizacao(minimumMonths)) return "Sem período mínimo";
  if (minimumMonths % 12 === 0) {
    const anos = minimumMonths / 12;
    return `${anos} ${anos === 1 ? "ano" : "anos"}`;
  }
  return `${minimumMonths} meses`;
}

/** O que se escreve na renovação quando ninguém escreveu nada. */
export function renovacaoPorOmissao(periodo: SubscriptionBillingPeriod, minimumMonths: number): string {
  const cadencia = periodo === "ANNUAL" ? "anualmente" : "mensalmente";
  if (semFidelizacao(minimumMonths)) {
    return `Renova ${cadencia}, sem período contratual mínimo. O clube pode cancelar a qualquer momento.`;
  }
  return `Renova ${cadencia} após o período mínimo de ${periodoMinimoPorExtenso(minimumMonths)}.`;
}

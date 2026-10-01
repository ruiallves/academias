/**
 * Quanto se cobra a quem paga — e se se cobra de todo.
 *
 * Duas decisões do clube (`Academy.paymentsEnabled`, `Academy.feesOnPayer`) e a
 * conta que a segunda obriga a fazer. Sem dependências, de propósito: é o mesmo
 * ficheiro que os testes importam, e a consola tem a cópia de `brutoParaLiquido`
 * em `lib/eupago-fees.ts` para mostrar o intervalo enquanto se escreve um preço.
 *
 * ## A taxa por conta de quem paga
 *
 * Por omissão a comissão da euPago sai do que o clube recebe: 20 € de
 * mensalidade são 20 € para a família e menos para o clube. Com
 * `feesOnPayer`, é ao contrário: **o valor da plataforma é o que o clube
 * recebe**, e quem paga suporta a comissão do método que escolheu.
 *
 * Não basta somar a comissão de 20 € aos 20 €. A percentagem da euPago incide
 * sobre o que se cobra, e o que se cobra passou a incluir a própria comissão:
 * cobrar 20,24 € custa mais do que cobrar 20 €. A conta tem de se fazer ao
 * contrário — procurar o valor que, **depois** de a euPago tirar a parte dela,
 * deixa os 20 € inteiros.
 */

/** A linha de um método na tabela de taxas. A mesma forma de `eupago-fees.ts`. */
export type TaxaDoMetodo = { method: string; label: string; fixedCents: number; percent: number; offered: boolean };

export type TabelaDeTaxas = { methods: TaxaDoMetodo[]; vatPercent: number };

/** As duas decisões do clube sobre os pagamentos pela app. */
export type RegrasDePagamento = { paymentsEnabled: boolean; feesOnPayer: boolean };

/** O código que as apps reconhecem para trocar o botão de pagar pelo aviso. */
export const PAGAMENTOS_DESATIVADOS = "PAYMENTS_DISABLED";

export const MENSAGEM_DESATIVADOS =
  "Os pagamentos pela app estão desativados neste clube. Fala com o clube para saber como pagar.";

/**
 * A comissão que a euPago tira de um pagamento de `amountCents`.
 *
 * Igual a `liquidoDe` em `eupago-fees.ts`: com IVA, arredondada para cima.
 */
function comissaoDe(amountCents: number, taxa: TaxaDoMetodo, vatPercent: number): number {
  return Math.ceil((taxa.fixedCents + (amountCents * taxa.percent) / 100) * (1 + vatPercent / 100));
}

/**
 * O menor valor a cobrar para que ao clube cheguem `liquidoCents`.
 *
 * Parte da fórmula invertida e acerta ao cêntimo, porque a comissão arredonda
 * para cima e a inversa exacta pode ficar um cêntimo ao lado. O que sai daqui
 * cumpre sempre as duas coisas: ao clube chega **pelo menos** o valor dele, e
 * com um cêntimo a menos já não chegava — ninguém paga taxa a mais.
 */
export function brutoParaLiquido(liquidoCents: number, taxa: TaxaDoMetodo, vatPercent: number): number {
  if (!Number.isInteger(liquidoCents) || liquidoCents <= 0) return Math.max(0, liquidoCents | 0);

  const iva = 1 + vatPercent / 100;
  const fatia = (taxa.percent / 100) * iva;
  /*
   * Uma comissão de 100 % ou mais nunca deixa nada: não há valor que chegue.
   * Só acontece com a tabela mal configurada (`EUPAGO_FEES`), e recusar é
   * melhor do que cobrar um número absurdo a uma família.
   */
  if (!(fatia < 1) || !Number.isFinite(fatia) || fatia < 0 || taxa.fixedCents < 0) {
    throw new Error(`Taxa inválida para ${taxa.method}`);
  }

  const chega = (bruto: number) => bruto - comissaoDe(bruto, taxa, vatPercent) >= liquidoCents;

  let bruto = Math.max(liquidoCents, Math.ceil((liquidoCents + taxa.fixedCents * iva) / (1 - fatia)));
  while (!chega(bruto)) bruto++;
  while (bruto > liquidoCents && chega(bruto - 1)) bruto--;
  return bruto;
}

/**
 * O que um pagamento cobra, por este método, neste clube.
 *
 * `valorCents` é o valor da mensalidade (ou a soma das quotas) como está na
 * plataforma. Sem `feesOnPayer` cobra-se esse valor e mais nada. Com ele,
 * cobra-se o bruto, e a diferença é a taxa que quem paga suporta.
 *
 * Um método que a tabela não conhece não se adivinha: com a taxa por conta de
 * quem paga, cobrar sem saber a comissão era o clube receber menos do que o
 * valor que a plataforma lhe promete.
 */
export function valorACobrar(
  valorCents: number,
  method: string,
  regras: Pick<RegrasDePagamento, "feesOnPayer">,
  tabela: TabelaDeTaxas,
): { totalCents: number; surchargeCents: number } {
  if (!regras.feesOnPayer) return { totalCents: valorCents, surchargeCents: 0 };

  const taxa = tabela.methods.find((m) => m.method === method);
  if (!taxa) throw new Error(`Sem taxa conhecida para ${method}`);

  const totalCents = brutoParaLiquido(valorCents, taxa, tabela.vatPercent);
  return { totalCents, surchargeCents: totalCents - valorCents };
}

export type LinhaDaCotacao = { method: string; label: string; surchargeCents: number; totalCents: number };

/**
 * O que as apps mostram antes de alguém escolher o método.
 *
 * `valores` é uma lista porque a família paga **um pagamento por mensalidade**:
 * três meses são três comissões, cada uma com a sua parte fixa. Somar os três
 * e calcular uma comissão só dava um número mais baixo do que o cobrado. As
 * quotas de sócio seguem numa referência só, e chegam aqui já somadas.
 *
 * É só para mostrar. O valor que se cobra calcula-se outra vez no servidor, ao
 * iniciar o pagamento, a partir do que está na base.
 */
export function cotacao(valores: number[], regras: RegrasDePagamento, tabela: TabelaDeTaxas): LinhaDaCotacao[] {
  return tabela.methods
    .filter((m) => m.offered)
    .map((m) => {
      let surchargeCents = 0;
      let totalCents = 0;
      for (const v of valores) {
        const r = valorACobrar(v, m.method, regras, tabela);
        surchargeCents += r.surchargeCents;
        totalCents += r.totalCents;
      }
      return { method: m.method, label: m.label, surchargeCents, totalCents };
    });
}

/**
 * Os valores de uma cotação, lidos de um parâmetro de endereço (`2000,2500`).
 *
 * Vêm do cliente e por isso não se confia neles para nada além de mostrar:
 * inteiros positivos, no máximo 24 de cada vez (dois anos de meses), cada um
 * até ao tecto que uma quota pode ter.
 */
export function valoresDaCotacao(cents: string | undefined): number[] {
  if (!cents) return [];
  const lista = cents
    .split(",")
    .map((x) => Number(x.trim()))
    .filter((n) => Number.isInteger(n) && n > 0 && n <= 10_000_000);
  return lista.slice(0, 24);
}

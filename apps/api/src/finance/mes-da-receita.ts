import { partesNoFuso } from "../common/fuso";

/**
 * O mês a que uma mensalidade ou uma quota diz respeito.
 *
 * ## Onde se usa
 *
 * As receitas das Contas contam pelo dia do pagamento (decisão do Rui a
 * 28/10/2026; entre 25/10 e 28/10 contaram por este mês). Isto serve agora só
 * para dizer de que mês é o que entrou: o "de meses anteriores" do painel e o
 * `referenteA` dos movimentos.
 *
 * Vive aqui, sem base de dados, para se poder provar sozinho
 * (`npm run test:mes-da-receita`).
 */

/** "2026-09" de um instante, na hora do clube. */
export function chaveDoMes(instante: Date): string {
  const p = partesNoFuso(instante);
  return `${p.ano}-${String(p.mes).padStart(2, "0")}`;
}

/**
 * O mês da receita, `AAAA-MM`:
 *
 * - `AAAA-MM` (a mensalidade, a cobrança avulsa, a quota mensal): esse mês;
 * - uma quota anual com cobertura escrita: o mês em que a cobertura começa;
 * - os períodos antigos das quotas, `AAAA` e `AAAA-T3`: o primeiro mês do ano
 *   ou do trimestre;
 * - qualquer outra coisa: o mês do pagamento, que é o que havia antes.
 */
export function mesDaReceita(period: string, opcoes: { coversFrom?: Date | null; pagaEm?: Date | null } = {}): string | null {
  const p = period.trim();
  if (opcoes.coversFrom) {
    // `@db.Date`: meia-noite UTC do dia, e é esse dia que conta.
    const d = opcoes.coversFrom;
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  }
  const mensal = /^(\d{4})-(\d{2})$/.exec(p);
  if (mensal && Number(mensal[2]) >= 1 && Number(mensal[2]) <= 12) return p;
  const trimestre = /^(\d{4})-T([1-4])$/i.exec(p);
  if (trimestre) return `${trimestre[1]}-${String((Number(trimestre[2]) - 1) * 3 + 1).padStart(2, "0")}`;
  if (/^\d{4}$/.test(p)) return `${p}-01`;
  return opcoes.pagaEm ? chaveDoMes(opcoes.pagaEm) : null;
}

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

/** "setembro de 2026" a partir de "2026-09". O que não for um mês volta como veio. */
export function nomeDoMes(chave: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(chave);
  if (!m) return chave;
  const i = Number(m[2]) - 1;
  return MESES[i] ? `${MESES[i]} de ${m[1]}` : chave;
}

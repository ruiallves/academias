/**
 * As contas de tempo de um jogo, sem base de dados à volta.
 *
 * Vivem aqui, e não em `matches.service.ts`, para se poderem testar sozinhas
 * (`npm run test:minutos-do-jogo`). A consola tem a mesma conta em
 * `minutosDerivados` (MatchDetail.tsx): ao mexer numa, mexer na outra.
 */

/**
 * As modalidades com tempo adicional, e em quantas partes.
 *
 * Só o futebol, com duas. O futsal (2 × 20) e o basquetebol (4 × 10) jogam-se
 * com o cronómetro parado e não entram aqui. É o mesmo que `match.addedTime` e
 * `match.periods` de `SPORT_PROFILES` na consola.
 */
export const PARTES_COM_TEMPO_ADICIONAL: Record<string, number> = { football: 2 };

/**
 * O prolongamento de cada modalidade: quantas partes pode ter, e o máximo de
 * minutos de cada uma.
 *
 * Futebol: duas partes, até 15 (Lei 7; na formação joga-se muitas vezes menos).
 * Futsal: duas partes, até 10 (5 nas Leis, mais nalgumas provas de formação).
 * Basquetebol: períodos de 5 (FIBA), tantos quantos for preciso para desempatar;
 * o tecto de 6 é só para travar um engano.
 */
export const PROLONGAMENTO: Record<string, { partes: number; maxMinutos: number }> = {
  football: { partes: 2, maxMinutos: 15 },
  futsal: { partes: 2, maxMinutos: 10 },
  basketball: { partes: 6, maxMinutos: 10 },
};

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/**
 * Onde acaba cada parte, em minutos do jogo: as do tempo regulamentar (iguais
 * entre si) e, a seguir, as do prolongamento.
 */
export function fimDasPartes(duracao: number, partes: number, prolongamento: number[] = []): number[] {
  const fins = Array.from({ length: partes }, (_, i) => (duracao * (i + 1)) / partes);
  let ate = duracao;
  for (const m of prolongamento) {
    ate += m;
    fins.push(ate);
  }
  return fins;
}

/**
 * Os minutos jogados, calculados aqui e não aceites do cliente.
 *
 * O corpo do pedido traz um `minutes`, e durante muito tempo era esse que ficava
 * gravado. Isso punha a verdade dos totais da época na mão de quem faz o pedido:
 * bastava um ecrã desactualizado — ou um pedido à mão — para um atleta ficar com
 * noventa minutos num jogo em que entrou ao 80. Os factos são a titularidade, a
 * entrada e a saída; o tempo é uma consequência deles, e uma consequência
 * calcula-se sempre do mesmo lado.
 *
 * Um titular sem minuto de saída jogou o jogo todo. Um suplente sem minuto de
 * entrada não tem minutos que se saibam — devolve-se zero em vez de um palpite,
 * e é o ecrã que impede que se chegue aqui com essa linha por preencher.
 *
 * `duracao` a zero é uma modalidade sem duração declarada nas Definições; aí o
 * que se souber por diferença é tudo o que há.
 *
 * ## A saída
 *
 * O minuto de saída, ou o do vermelho: um expulso sai de campo nesse minuto.
 * Contava-se só a saída, e o expulso ficava com os minutos do jogo todo.
 *
 * ## O prolongamento
 *
 * O jogo passa a acabar em `duracao` mais as partes do prolongamento: quem joga
 * tudo num 90 + 2 × 15 tem 120.
 *
 * ## O tempo adicional
 *
 * Soma a quem estava em campo quando a parte acabou, prolongamento incluído.
 * Num jogo de 90 com +2 e +3: o titular que joga tudo tem 95; quem sai ao
 * intervalo tem 45 + 2; quem entra ao intervalo tem 45 + 3; quem sai aos 60 tem
 * 60 + 2. A última parte só soma a quem não saiu: uma saída escrita aos 93 já
 * traz os descontos dentro.
 */
export function minutosEmCampo(
  r: { started?: boolean; onMinute?: number | null; offMinute?: number | null; redAt?: number | null },
  duracao: number,
  adicional: number[] = [],
  partes = 0,
  prolongamento: number[] = [],
): number {
  const entrada = r.started ? 0 : r.onMinute;
  if (entrada == null) return 0;
  const sai = r.offMinute ?? r.redAt ?? null;
  const total = duracao + prolongamento.reduce((n, m) => n + m, 0);
  let minutos = (sai ?? total) - entrada;
  if (partes > 0 && duracao > 0) {
    const fins = fimDasPartes(duracao, partes, prolongamento);
    fins.forEach((fim, i) => {
      const ultima = i === fins.length - 1;
      const estavaLa = entrada < fim && (ultima ? sai == null : sai == null || sai >= fim);
      if (estavaLa) minutos += adicional[i] ?? 0;
    });
  }
  return clamp(minutos, 0, 300);
}

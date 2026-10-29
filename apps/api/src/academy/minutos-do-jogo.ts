/**
 * As contas de tempo de um jogo, sem base de dados à volta.
 *
 * Vivem aqui, e não em `matches.service.ts`, para se poderem testar sozinhas
 * (`npm run test:minutos-do-jogo`). A consola tem a mesma conta em
 * `minutosDerivados` (MatchDetail.tsx): ao mexer numa, mexer na outra.
 */

/**
 * As partes de um jogo em cada modalidade, quando a equipa não diz outra coisa
 * (`Team.matchParts`). É o mesmo que `match.periods` de `SPORT_PROFILES` na
 * consola.
 */
export const PARTES_POR_OMISSAO: Record<string, number> = { football: 2, futsal: 2, basketball: 4 };

/**
 * As modalidades com tempo adicional (compensação no fim de cada parte).
 *
 * Só o futebol. O futsal e o basquetebol jogam-se com o cronómetro parado e não
 * entram aqui. É o mesmo que `match.addedTime` na consola.
 */
export const COM_TEMPO_ADICIONAL = new Set(["football"]);

/** Em quantas partes joga esta equipa: as dela, ou as da modalidade. */
export function partesDoJogo(codigo: string | null | undefined, partesDaEquipa: number | null | undefined): number {
  if (partesDaEquipa != null && partesDaEquipa >= 1) return partesDaEquipa;
  return PARTES_POR_OMISSAO[codigo ?? ""] ?? 2;
}

/** As partes que têm tempo adicional neste jogo: as do jogo no futebol, nenhuma nas outras. */
export function partesComTempoAdicional(codigo: string | null | undefined, partesDaEquipa: number | null | undefined): number {
  return COM_TEMPO_ADICIONAL.has(codigo ?? "") ? partesDoJogo(codigo, partesDaEquipa) : 0;
}

/**
 * Porque é que a duração não se divide nestas partes, ou `null` se divide.
 *
 * Cada parte tem de ter minutos certos: o relógio do "Ao vivo" e as contas de
 * minutos partem o jogo em partes iguais. 60 em 3 dá 20; 50 em 3 não dá.
 */
export function problemaNasPartes(duracao: number | null | undefined, partes: number): string | null {
  if (!duracao || duracao <= 0) return null;
  if (duracao % partes === 0) return null;
  return `${duracao} minutos não se dividem em ${partes} partes iguais. Escolhe uma duração que dê minutos certos em cada parte.`;
}

/** O máximo de minutos de uma parte (o mesmo CHECK da base em `Team.matchPartMinutes`). */
export const MAXIMO_DA_PARTE = 120;

/**
 * Os minutos de cada parte, quando a equipa os diz (`Team.matchPartMinutes`),
 * ou vazio para partes iguais. Uma lista que não bate com as partes não conta.
 */
export function partesDesiguais(partes: number, minutosDasPartes: number[] | null | undefined): number[] {
  const lista = minutosDasPartes ?? [];
  return lista.length === partes ? lista : [];
}

/**
 * Porque é que este tempo de jogo não dá, ou `null` se dá.
 *
 * Sem minutos por parte, a duração tem de se dividir nas partes
 * (`problemaNasPartes`). Com eles, uma entrada por parte, cada uma de 1 a 120, e
 * a soma é a duração: 15 + 15 + 40 dá um jogo de 70.
 */
export function problemaNoTempoDoJogo(duracao: number | null | undefined, partes: number, minutosDasPartes: number[] = []): string | null {
  if (minutosDasPartes.length === 0) return problemaNasPartes(duracao, partes);
  if (minutosDasPartes.length !== partes) return `Escreve os minutos de cada uma das ${partes} partes.`;
  if (minutosDasPartes.some((m) => !Number.isInteger(m) || m < 1 || m > MAXIMO_DA_PARTE)) {
    return `Cada parte tem de ter entre 1 e ${MAXIMO_DA_PARTE} minutos.`;
  }
  const soma = minutosDasPartes.reduce((n, m) => n + m, 0);
  if (duracao && soma !== duracao) return `As partes somam ${soma} minutos e o jogo dura ${duracao}.`;
  return null;
}

/**
 * A lista que se grava: vazia quando as partes são todas iguais (20 + 20 + 20
 * é o mesmo que 3 partes de um jogo de 60), para haver uma maneira só de o dizer.
 */
export function minutosDasPartesParaGravar(minutosDasPartes: number[]): number[] {
  return minutosDasPartes.every((m) => m === minutosDasPartes[0]) ? [] : minutosDasPartes;
}

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
 * entre si, ou as de `desiguais`) e, a seguir, as do prolongamento.
 */
export function fimDasPartes(duracao: number, partes: number, prolongamento: number[] = [], desiguais: number[] = []): number[] {
  let soma = 0;
  const fins =
    desiguais.length === partes
      ? desiguais.map((m) => (soma += m))
      : Array.from({ length: partes }, (_, i) => (duracao * (i + 1)) / partes);
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
  r: ComExpulsao & { started?: boolean; onMinute?: number | null; offMinute?: number | null; stints?: number[] | null },
  duracao: number,
  adicional: number[] = [],
  partes = 0,
  prolongamento: number[] = [],
  desiguais: number[] = [],
): number {
  // Com substituições ilimitadas, a soma de cada vez que esteve em campo.
  const intervalos = intervalosEmCampo(r);
  if (intervalos) {
    const soma = intervalos.reduce((n, i) => n + minutosDoIntervalo(i.de, i.ate, duracao, adicional, partes, prolongamento, desiguais), 0);
    return clamp(soma, 0, 300);
  }
  const entrada = r.started ? 0 : r.onMinute;
  if (entrada == null) return 0;
  const sai = r.offMinute ?? minutoDaExpulsao(r);
  return clamp(minutosDoIntervalo(entrada, sai, duracao, adicional, partes, prolongamento, desiguais), 0, 300);
}

type ComExpulsao = { redAt?: number | null; yellowCards?: number | null; yellowAt?: number[] | null };

/**
 * O minuto em que foi expulso, ou `null`: o do vermelho, ou o do segundo
 * amarelo (que também é expulsão). Um expulso sai de campo nesse minuto.
 * Dois amarelos sem os minutos escritos não dizem quando saiu.
 */
export function minutoDaExpulsao(r: ComExpulsao): number | null {
  if (r.redAt != null) return r.redAt;
  const amarelos = [...(r.yellowAt ?? [])].sort((a, b) => a - b);
  if ((r.yellowCards ?? amarelos.length) >= 2 && amarelos.length >= 2) return amarelos[1];
  return null;
}

/**
 * Os minutos de uma vez em campo: de `entrada` até `sai` (nulo é até ao fim),
 * com o tempo adicional das partes que acabaram com ele lá dentro.
 */
function minutosDoIntervalo(
  entrada: number,
  sai: number | null,
  duracao: number,
  adicional: number[],
  partes: number,
  prolongamento: number[],
  desiguais: number[],
): number {
  const total = duracao + prolongamento.reduce((n, m) => n + m, 0);
  let minutos = (sai ?? total) - entrada;
  if (partes > 0 && duracao > 0) {
    const fins = fimDasPartes(duracao, partes, prolongamento, desiguais);
    fins.forEach((fim, i) => {
      const ultima = i === fins.length - 1;
      const estavaLa = entrada < fim && (ultima ? sai == null : sai == null || sai >= fim);
      if (estavaLa) minutos += adicional[i] ?? 0;
    });
  }
  return Math.max(0, minutos);
}

/**
 * As vezes que esteve em campo, lidas de `stints` (entrou, saiu, entrou…).
 *
 * Nulo quando a linha não as tem: aí valem a entrada e a saída. O último
 * intervalo aberto acaba na expulsão, se houve, ou no fim do jogo (`ate` nulo).
 */
export function intervalosEmCampo(r: ComExpulsao & { stints?: number[] | null }): { de: number; ate: number | null }[] | null {
  const t = r.stints ?? [];
  if (t.length === 0) return null;
  const lista: { de: number; ate: number | null }[] = [];
  for (let i = 0; i < t.length; i += 2) {
    lista.push({ de: t[i], ate: i + 1 < t.length ? t[i + 1] : minutoDaExpulsao(r) });
  }
  return lista;
}

/**
 * O que está mal numa lista de entradas e saídas, ou `null` se está certa.
 *
 * Têm de vir por ordem (o mesmo minuto pode fechar uma vez e abrir a seguinte:
 * no futsal sai-se e volta-se no mesmo minuto), e um titular começa aos 0.
 */
export function problemaNosIntervalos(stints: number[], started: boolean): string | null {
  if (stints.length === 0) return null;
  if (started && stints[0] !== 0) return "Um titular entra ao minuto 0.";
  for (let i = 1; i < stints.length; i++) {
    if (stints[i] < stints[i - 1]) return "As entradas e saídas não estão por ordem.";
  }
  return null;
}

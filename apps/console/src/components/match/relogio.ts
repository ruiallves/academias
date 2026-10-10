import type { SportProfile } from "@/lib/sports";

/**
 * O relógio do jogo ao vivo, por modalidade.
 *
 * ## Como cada modalidade conta o tempo
 *
 * - **Futebol** (Lei 7 do IFAB): duas partes, relógio do jogo e não da parte.
 *   A 2.ª parte começa nos 45:00, e o árbitro compensa no fim de cada parte o
 *   tempo perdido. Um golo na compensação é "45+2", não "47".
 * - **Futsal** (Lei 7 do futsal): duas partes de 20 minutos de tempo útil, cada
 *   uma com o seu cronómetro a partir do zero. Cada equipa tem um desconto de
 *   tempo (um minuto) por parte. Não há compensação.
 * - **Basquetebol** (FIBA): quatro períodos de 10 minutos, cada um com o seu
 *   cronómetro. Descontos de tempo: dois na primeira metade e três na segunda.
 *   Não há compensação.
 *
 * Na formação a duração muda por escalão e por associação (2 × 25, 2 × 30,
 * 4 × 8…). Por isso a duração de cada parte é a do jogo da equipa
 * (`Team.matchMinutes`) dividida pelas partes, e não um número fixo.
 *
 * ## O minuto que vai para o servidor
 *
 * A ficha guarda minutos **do jogo** (`onMinute`, `tallyAt`…), e o servidor
 * divide o jogo em partes iguais para saber a quem dá o tempo adicional (ver
 * `minutosEmCampo`). Um cesto aos 4 minutos do 3.º período de 10 vai como 24.
 * A compensação do futebol não entra no número: 45+2 vai como 45, e o tempo a
 * mais é dado pelo `addedMinutes` do jogo. O "+2" fica em `extra`, para o ecrã.
 */

export type Regras = {
  /** As partes do tempo regulamentar. */
  partes: number;
  /** Minutos de cada parte do tempo regulamentar. */
  duracaoParte: number;
  /** Cada parte conta do zero (futsal, basquetebol). */
  reinicia: boolean;
  /** Há compensação no fim de cada parte (futebol). */
  compensacao: boolean;
  timeouts: { parts: number[]; max: number }[] | null;
  nomeDaParte: "parte" | "período";
  /** Como é o prolongamento nesta modalidade. */
  regraDoProlongamento: SportProfile["match"]["overtime"];
  /** Os minutos de cada parte do prolongamento deste jogo. Vazio se não houve. */
  prolongamento: number[];
};

const PROLONGAMENTO_DE_OMISSAO: SportProfile["match"]["overtime"] = { parts: 2, minutes: 15, maxMinutes: 15, repeat: false, timeouts: 0 };

export function regrasDoJogo(profile: SportProfile | null, matchMinutes: number | null | undefined, prolongamento: number[] = []): Regras {
  const m = profile?.match;
  const partes = m?.periods ?? 2;
  const total = matchMinutes && matchMinutes > 0 ? matchMinutes : (profile?.defaults.matchMinutes ?? 90);
  return {
    partes,
    duracaoParte: total / partes,
    reinicia: m?.clockResets ?? false,
    compensacao: m?.addedTime ?? false,
    timeouts: m?.timeouts ?? null,
    nomeDaParte: m?.periodName ?? "parte",
    regraDoProlongamento: m?.overtime ?? PROLONGAMENTO_DE_OMISSAO,
    prolongamento,
  };
}

/** Todas as partes do jogo, prolongamento incluído. */
export const totalDePartes = (r: Regras) => r.partes + r.prolongamento.length;

/** A parte é do prolongamento? */
export const noProlongamento = (r: Regras, parte: number) => parte > r.partes;

/** Minutos que a parte dura. */
export function duracaoDa(r: Regras, parte: number): number {
  return parte <= r.partes ? r.duracaoParte : (r.prolongamento[parte - r.partes - 1] ?? 0);
}

/** O minuto do jogo em que a parte começa: 0, 45, 90, 105… */
export function inicioDa(r: Regras, parte: number): number {
  if (parte <= r.partes) return (parte - 1) * r.duracaoParte;
  return r.partes * r.duracaoParte + r.prolongamento.slice(0, parte - r.partes - 1).reduce((n, m) => n + m, 0);
}

/**
 * "1.ª parte", "3.º período", "2.ª parte do prolongamento", "1.º prolongamento".
 *
 * No basquetebol cada prolongamento é um período só, e é assim que se chama.
 */
export function nomeDaParte(r: Regras, parte: number): string {
  if (!noProlongamento(r, parte)) return `${ordinal(r, parte)} ${r.nomeDaParte}`;
  const k = parte - r.partes;
  return r.regraDoProlongamento.repeat ? `${k}.º prolongamento` : `${k}.ª parte do prolongamento`;
}

/** O nome da parte é feminino? Para o artigo: "a 2.ª parte", "o 3.º período". */
export function feminina(r: Regras, parte: number): boolean {
  if (noProlongamento(r, parte)) return !r.regraDoProlongamento.repeat;
  return r.nomeDaParte === "parte";
}

/** "1.ª", "3.º", "1.ª prol.": a parte dita curta, ao lado de um minuto. */
export function ordinal(r: Regras, parte: number): string {
  if (!noProlongamento(r, parte)) return `${parte}.${r.nomeDaParte === "parte" ? "ª" : "º"}`;
  return `${parte - r.partes}.${r.regraDoProlongamento.repeat ? "º" : "ª"} prol.`;
}

const mmss = (segundos: number) => {
  const s = Math.max(0, Math.floor(segundos));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

/**
 * O que o relógio mostra, com `segundos` contados desde o início da parte.
 *
 * No futebol, passado o tempo da parte, o relógio principal fica parado nos
 * 45:00 (ou 90:00) e a compensação conta à parte: "+1:12". É assim que se lê
 * em qualquer transmissão. Nas modalidades de cronómetro por parte, o relógio
 * não passa do tempo da parte: aí a parte acabou, e `esgotado` diz isso.
 */
/**
 * Como se lê o relógio no futebol: o do jogo (55:28) ou o da parte (10:28 da
 * 2.ª). As duas maneiras existem no banco, e cada um escolhe a sua. Nas
 * modalidades de cronómetro por parte só há a da parte.
 */
export type Contagem = "jogo" | "parte";

export function mostrador(
  r: Regras,
  parte: number,
  segundos: number,
  contagem: Contagem = "jogo",
): { principal: string; extra: string | null; esgotado: boolean } {
  const len = duracaoDa(r, parte) * 60;
  if (r.reinicia) return { principal: mmss(Math.min(segundos, len)), extra: null, esgotado: segundos >= len };
  const antes = contagem === "parte" ? 0 : inicioDa(r, parte) * 60;
  if (segundos <= len) return { principal: mmss(antes + segundos), extra: null, esgotado: false };
  return { principal: mmss(antes + len), extra: `+${mmss(segundos - len)}`, esgotado: true };
}

/** Onde cai um acontecimento: o minuto do jogo, e a compensação à parte. */
export type Momento = { parte: number; minuto: number; extra?: number };

/**
 * O minuto de um acontecimento registado agora.
 *
 * É o minuto **em curso**, como no futebol se diz: aos 00:30 está-se no 1.º
 * minuto, aos 45:30 no 46.º. Passado o tempo da parte, o futebol entra na
 * compensação (45+1); nas outras o minuto fica no último da parte.
 */
export function carimbo(r: Regras, parte: number, segundos: number): Momento {
  const L = duracaoDa(r, parte);
  const antes = inicioDa(r, parte);
  const m = Math.floor(segundos / 60) + 1;
  if (m <= L) return { parte, minuto: antes + m };
  if (r.reinicia) return { parte, minuto: antes + L };
  return { parte, minuto: antes + L, extra: m - L };
}

/**
 * "67′", "45+2′", ou o minuto dentro da parte: nas de cronómetro por parte
 * sempre, no futebol quando se lê o relógio da parte ("22′" da 2.ª, "45+3′").
 */
export function rotulo(r: Regras, a: Momento, contagem: Contagem = "jogo"): string {
  const daParte = r.reinicia || contagem === "parte";
  const minuto = daParte ? a.minuto - inicioDa(r, a.parte) : a.minuto;
  return a.extra ? `${minuto}+${a.extra}′` : `${minuto}′`;
}

/**
 * Acertar um minuto em ±1, sem sair da parte.
 *
 * No futebol a compensação continua a sequência: um passo acima de 45 é 45+1,
 * e um abaixo de 45+1 é 45. Ninguém precisa de saber que são dois campos.
 */
export function ajustar(r: Regras, a: Momento, d: number): Momento {
  const L = duracaoDa(r, a.parte);
  const antes = inicioDa(r, a.parte);
  const dentro = a.minuto - antes + (a.extra ?? 0);
  const p = Math.min(Math.max(dentro + d, 1), r.reinicia ? L : L + 30);
  return p <= L ? { parte: a.parte, minuto: antes + p } : { parte: a.parte, minuto: antes + L, extra: p - L };
}

/** Para ordenar acontecimentos: parte, minuto, compensação. */
export const ordem = (a: Momento & { aoIntervalo?: boolean }) =>
  a.parte * 1_000_000 + a.minuto * 100 + (a.aoIntervalo ? 99 : (a.extra ?? 0));

/** Os descontos de tempo de um lado no grupo de partes desta parte. Nulo onde não há. */
export function descontosDeTempo(
  r: Regras,
  parte: number,
  usados: { parte: number }[],
): { usados: number; max: number } | null {
  // No prolongamento, os da regra dele, parte a parte (nenhum no futsal, um por período no basquetebol).
  if (noProlongamento(r, parte)) {
    const max = r.regraDoProlongamento.timeouts;
    return max > 0 ? { usados: usados.filter((u) => u.parte === parte).length, max } : null;
  }
  const grupo = r.timeouts?.find((g) => g.parts.includes(parte));
  if (!grupo) return null;
  return { usados: usados.filter((u) => grupo.parts.includes(u.parte)).length, max: grupo.max };
}

/**
 * O tempo adicional de cada parte, para o `addedMinutes` do jogo.
 *
 * O jogado a mais, arredondado ao minuto; o anunciado pelo árbitro é o mínimo,
 * porque a Lei 7 deixa aumentar a compensação mas nunca reduzi-la.
 */
export function tempoAdicional(r: Regras, jogados: number[], anunciados: number[]): number[] {
  if (!r.compensacao) return [];
  return Array.from({ length: totalDePartes(r) }, (_, i) => {
    const len = duracaoDa(r, i + 1) * 60;
    return Math.min(30, Math.max(anunciados[i] ?? 0, Math.round(Math.max(0, (jogados[i] ?? 0) - len) / 60)));
  });
}

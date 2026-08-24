import { currentSeason, today } from "@/lib/store";

/**
 * Avaliações e relatórios — o que a consola precisa de saber sem perguntar à API.
 *
 * ## Os períodos
 *
 * Um ano desportivo divide-se em três, e não em doze: avaliar um miúdo todos os
 * meses não mede evolução nenhuma — mede o humor do treinador naquela semana. Três
 * momentos por época dão distância suficiente para haver diferença que se veja, e
 * são poucos para que ninguém desista ao terceiro.
 *
 * O rótulo é texto (`"2026/27 · 1.º período"`) e não uma chave estruturada, porque
 * é isso que a família lê no telemóvel. O servidor guarda-o tal e qual — e uma
 * academia que queira quatro períodos muda esta lista sem migração nenhuma.
 */

export type PeriodOption = { value: string; label: string; months: string };

const PERIODS = [
  { n: 1, label: "1.º período", months: "Setembro a Dezembro", from: 8, to: 11 },
  { n: 2, label: "2.º período", months: "Janeiro a Março", from: 0, to: 2 },
  { n: 3, label: "3.º período", months: "Abril a Junho", from: 3, to: 6 },
];

export function periodsFor(season = currentSeason): PeriodOption[] {
  const prefix = season ? `${season} · ` : "";
  return PERIODS.map((p) => ({ value: `${prefix}${p.label}`, label: p.label, months: p.months }));
}

/**
 * Em que período estamos hoje.
 *
 * Julho e Agosto caem no terceiro — a época acabou, e o que faz sentido abrir é o
 * período que se acabou de fechar, não o que ainda não começou.
 */
export function currentPeriodLabel(season = currentSeason): string {
  const month = today.getMonth();
  const found = PERIODS.find((p) => month >= p.from && month <= p.to) ?? PERIODS[2];
  return season ? `${season} · ${found.label}` : found.label;
}

/* -------------------------------------------------------------------------- */
/* O que a API devolve                                                         */
/* -------------------------------------------------------------------------- */

export type ApiEvaluation = {
  id: string;
  athleteId: string;
  athleteName: string;
  teamId: string | null;
  period: string;
  status: "DRAFT" | "PUBLISHED";
  scores: Record<string, number>;
  note: string | null;
  strengths: string | null;
  focus: string | null;
  coachId: string;
  coachName: string;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ApiReport = {
  id: string;
  athleteId: string;
  athleteName: string;
  teamId: string | null;
  title: string;
  period: string | null;
  body: string;
  visibility: "INTERNAL" | "FAMILY";
  status: "DRAFT" | "PUBLISHED";
  snapshot: {
    attendance?: { attended: number; total: number };
    matches?: number;
    evaluation?: { period: string; scores: Record<string, number> } | null;
    takenAt?: string;
  } | null;
  authorId: string;
  authorName: string;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

/** A escala. Cinco pontos — igual ao servidor, que é quem a impõe. */
export const SCALE = [1, 2, 3, 4, 5] as const;

/**
 * A média de uma avaliação.
 *
 * Serve para ordenar e para dar um número de relance; **não é uma nota**. Por isso
 * aparece sempre com uma casa decimal e ao lado das competências, nunca sozinha a
 * fazer de veredicto.
 */
export function average(scores: Record<string, number>): number | null {
  const values = Object.values(scores ?? {});
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

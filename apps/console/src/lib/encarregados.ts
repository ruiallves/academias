import { apiDelete, apiGet, apiPost } from "./http";

/**
 * Ligar um encarregado que já tem conta no clube.
 *
 * O link das famílias serve quem ainda não tem conta nenhuma: cria a conta e
 * liga-a ao filho, tudo no mesmo passo. Quem **já** entra na app por outra porta
 * (é sócio, é treinador, é delegado) não tinha caminho — e a app não lhe
 * mostrava a área de Família porque, para a base de dados, aquela pessoa não era
 * encarregada de ninguém.
 *
 * Aqui é o clube a apontar: escolhe-se a pessoa na ficha do atleta.
 */

/** Uma conta do clube que pode passar a encarregada deste atleta. */
export type CandidatoAEncarregado = {
  userId: string;
  name: string;
  email: string | null;
  /** "Coordenação", "Sócio n.º 12", "Encarregado" — o que a pessoa já é aqui. */
  papeis: string[];
  /** Quantos educandos já tem. Zero em quem nunca foi encarregado. */
  educandos: number;
  jaEncarregado: boolean;
  /** Já é encarregado **deste** atleta: a lista mostra-o e não o deixa escolher. */
  jaDesteAtleta: boolean;
};

export const candidatosAEncarregado = (athleteId: string, q: string) =>
  apiGet<CandidatoAEncarregado[]>(`/api/athletes/${athleteId}/encarregados/candidatos`, q ? { q } : undefined);

export const ligarEncarregado = (athleteId: string, body: { userId: string; relation: string }) =>
  apiPost<{ ok: true; membershipId: string; name: string; email: string | null; relation: string }>(
    `/api/athletes/${athleteId}/encarregados`,
    body,
  );

export const desligarEncarregado = (athleteId: string, membershipId: string) =>
  apiDelete<{ ok: true }>(`/api/athletes/${athleteId}/encarregados/${membershipId}`);

/**
 * As relações que a lista oferece.
 *
 * O campo é texto livre na base — as famílias não cabem num enum, e há avós,
 * tios e tutores. Estas são as que se escolhem com um clique; o resto
 * escreve-se.
 */
export const RELACOES = ["Mãe", "Pai", "Encarregado"] as const;

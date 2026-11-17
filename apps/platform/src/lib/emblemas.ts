import { apiPost } from "./http";

/**
 * Os emblemas que os clubes carregaram para os adversários, para rever.
 *
 * O clube carregou e ficou logo a valer para ele. Aqui faz-se o "double
 * check": aprovar passa o emblema ao diretório dos clubes (para toda a gente),
 * rejeitar deixa de o mostrar. O clube não é avisado de nenhuma das duas.
 */

export type EstadoDaProposta = "PENDING" | "APPROVED" | "REJECTED";

export type EmblemaProposto = {
  id: string;
  clube: string;
  estado: EstadoDaProposta;
  emblema: { pequeno: string; grande: string };
  quem: string | null;
  em: string;
  academia: { id: string; name: string; slug: string };
  /** O clube do diretório a que foi ligado, quando foi escolhido de lá. */
  noDiretorio: { id: string; nome: string; associacao: string | null; emblema: { pequeno: string; grande: string } | null } | null;
  revisto: { em: string; por: string | null; nota: string | null } | null;
};

export const ESTADO_LABEL: Record<EstadoDaProposta, string> = { PENDING: "Por rever", APPROVED: "Aprovado", REJECTED: "Rejeitado" };

export const aprovarEmblema = (id: string) => apiPost<{ ok: true; knownClubId: string }>(`/api/platform/emblemas/${id}/aprovar`, {});
export const rejeitarEmblema = (id: string, nota?: string) => apiPost<{ ok: true }>(`/api/platform/emblemas/${id}/rejeitar`, nota ? { nota } : {});

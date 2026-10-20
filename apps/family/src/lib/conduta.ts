import { apiGet, apiPost } from "@/lib/http";

/**
 * O canal de denúncia e os documentos do clube, do lado da família.
 *
 * O servidor só devolve a esta app os casos de quem está a ver, e as
 * mensagens que a família pode ver (nunca as notas internas do clube).
 */

export type Categoria = { key: string; label: string };

export type Denuncia = {
  id: string;
  number: number;
  category: string;
  categoryLabel: string;
  status: "NEW" | "IN_REVIEW" | "RESOLVED" | "ARCHIVED";
  statusLabel: string;
  anonymous: boolean;
  athlete: { id: string; name: string; team: string | null } | null;
  happenedOn: string | null;
  place: string | null;
  involved: string | null;
  description: string;
  createdAt: string;
  resolvedAt: string | null;
  lastMessageAt: string | null;
  /** O clube respondeu e ainda não se abriu o caso. */
  unread: boolean;
};

export type Mensagem = {
  id: string;
  fromStaff: boolean;
  authorName: string | null;
  body: string;
  createdAt: string;
};

export type DenunciaCompleta = Denuncia & { messages: Mensagem[] };

export type NovaDenuncia = {
  category: string;
  anonymous: boolean;
  athleteId: string | null;
  happenedOn: string | null;
  place: string | null;
  involved: string | null;
  description: string;
};

export const categorias = () => apiGet<{ categorias: Categoria[] }>("/api/denuncias/opcoes").then((r) => r.categorias);
export const minhasDenuncias = () => apiGet<Denuncia[]>("/api/denuncias/minhas");
export const verDenuncia = (id: string) => apiGet<DenunciaCompleta>(`/api/denuncias/${id}`);
export const enviarDenuncia = (dto: NovaDenuncia) => apiPost<DenunciaCompleta>("/api/denuncias", dto);
export const responder = (id: string, body: string) => apiPost<Mensagem>(`/api/denuncias/${id}/mensagens`, { body });

export type DocumentoDoClube = {
  id: string;
  title: string;
  description: string | null;
  updatedAt: string;
  files: { key: string; name: string; type: string; url: string | null }[];
};

export const documentosDoClube = () => apiGet<DocumentoDoClube[]>("/api/conduta/documentos");

/** O que o estado quer dizer para quem enviou, numa frase curta. */
export const FRASE_DO_ESTADO: Record<Denuncia["status"], string> = {
  NEW: "Enviada. O clube ainda não a abriu.",
  IN_REVIEW: "O clube está a tratar do caso.",
  RESOLVED: "O clube deu o caso como resolvido.",
  ARCHIVED: "O clube arquivou o caso.",
};

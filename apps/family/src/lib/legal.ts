import { apiGet, apiPost } from "./http";

/**
 * Os documentos legais, do lado da app do clube.
 *
 * O mesmo contrato da consola (`apps/console/src/lib/legal.ts`): o servidor diz
 * o que falta e valida o que se aceita; a app só desenha. Marcar não aceita
 * nada — aceita-se quando `/api/legal/accept` grava.
 */

export type LegalDocumentView = {
  id: string;
  type: string;
  slug: string;
  title: string;
  summary: string | null;
  version: string;
  scope: "CLUB" | "USER";
  acceptanceKind: "ACCEPT" | "ACKNOWLEDGE" | "NONE";
  effectiveAt: string;
  changeNote: string | null;
};

export type PendingDocument = LegalDocumentView & { previousVersion: string | null };

export type LegalStatus = {
  audiences: string[];
  canBindClub: boolean;
  /** Pedir "confirmo que represento o clube"? Uma vez por pessoa — ver a API. */
  needsAuthority: boolean;
  pending: PendingDocument[];
  accepted: (LegalDocumentView & { acceptedAt: string })[];
  isUpdate: boolean;
};

export type LegalDocumentFull = LegalDocumentView & { content: string };

export const legalStatus = () => apiGet<LegalStatus>("/api/legal/status");
export const legalDocument = (slug: string) => apiGet<LegalDocumentFull>(`/api/legal/documents/${slug}`);
export const legalDocuments = () => apiGet<LegalDocumentView[]>("/api/legal/documents");
export const legalAccept = (body: { documentIds: string[]; confirmAuthority?: boolean }) =>
  apiPost<LegalStatus>("/api/legal/accept", body);

/** "Aceito os Termos de Utilização" / "Li a Política de Privacidade". */
export function acceptanceLabel(doc: Pick<LegalDocumentView, "title" | "acceptanceKind">): string {
  const t = doc.title.trim();
  if (doc.acceptanceKind === "ACKNOWLEDGE") return `Li a ${t}`;
  const artigo = /^termos/i.test(t) ? "os" : /^(política|politica)/i.test(t) ? "a" : "o";
  return `Aceito ${artigo} ${t}`;
}

export function dataPT(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-PT", { day: "2-digit", month: "2-digit", year: "numeric" });
}

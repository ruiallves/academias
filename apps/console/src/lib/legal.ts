import { apiGet, apiPost } from "./http";

/**
 * Os documentos legais, do lado da consola.
 *
 * Nada aqui decide o que é obrigatório — é o servidor que diz o que falta
 * (`/api/legal/status`) e que valida o que se aceita (`/api/legal/accept`). O
 * cliente só desenha e envia. Marcar uma checkbox não aceita nada: aceita-se
 * quando o servidor grava.
 */

export type LegalDocumentType =
  | "TERMS_OF_SERVICE"
  | "TERMS_OF_USE"
  | "PRIVACY_POLICY"
  | "COOKIE_POLICY"
  | "DPA"
  | "ACCEPTABLE_USE"
  | "ACADEMIAS_AI_TERMS"
  | "DATA_RETENTION_POLICY";

export type LegalDocumentView = {
  id: string;
  type: LegalDocumentType;
  slug: string;
  title: string;
  summary: string | null;
  version: string;
  scope: "CLUB" | "USER";
  acceptanceKind: "ACCEPT" | "ACKNOWLEDGE" | "NONE";
  audiences: string[];
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

export type LegalDocumentFull = LegalDocumentView & { content: string; contentHash: string };

export type LegalAcceptanceRow = {
  id: string;
  type: LegalDocumentType;
  slug: string;
  title: string;
  version: string;
  scope: "CLUB" | "USER";
  onBehalfOfClub: boolean;
  context: "SIGNUP" | "LOGIN_GATE" | "TERMS_UPDATE" | "SETTINGS";
  acceptedAt: string;
  mine: boolean;
  by: string;
};

export const legalStatus = () => apiGet<LegalStatus>("/api/legal/status");

export const legalDocument = (slug: string) => apiGet<LegalDocumentFull>(`/api/legal/documents/${slug}`);

export const legalDocuments = () => apiGet<LegalDocumentView[]>("/api/legal/documents");

export const legalHistory = () => apiGet<LegalAcceptanceRow[]>("/api/legal/history");

export const legalAccept = (body: { documentIds: string[]; confirmAuthority?: boolean; context?: "SETTINGS" }) =>
  apiPost<LegalStatus>("/api/legal/accept", body);

/** "Aceito os Termos de Serviço" / "Li a Política de Privacidade". */
export function acceptanceLabel(doc: Pick<LegalDocumentView, "title" | "acceptanceKind">): string {
  return doc.acceptanceKind === "ACKNOWLEDGE" ? `Li a ${doc.title}` : `Aceito ${artigo(doc.title)}`;
}

/** "os Termos…", "a Política…", "o Acordo…". */
function artigo(title: string): string {
  const t = title.trim();
  if (/^termos/i.test(t)) return `os ${t}`;
  if (/^(política|politica)/i.test(t)) return `a ${t}`;
  return `o ${t}`;
}

/** "10/09/2026" — a data de entrada em vigor, como no rodapé do site. */
export function dataPT(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-PT", { day: "2-digit", month: "2-digit", year: "numeric" });
}

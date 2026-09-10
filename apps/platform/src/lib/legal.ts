import { apiDelete, apiPatch, apiPost } from "./http";

/**
 * Os documentos legais, do lado da plataforma.
 *
 * A gestão das versões: criar rascunho, editar rascunho, publicar, retirar. O
 * servidor (`legal-admin.service.ts`) é quem decide o que é permitido — uma
 * versão publicada não se edita, só `OWNER` publica — e o painel limita-se a
 * mostrar os botões a quem os pode carregar.
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

export type LegalStatus = "DRAFT" | "PUBLISHED" | "RETIRED";
export type LegalScope = "CLUB" | "USER";
export type LegalAudience = "CLUB_OWNER" | "STAFF" | "FAMILY" | "MEMBER";
export type LegalAcceptanceKind = "ACCEPT" | "ACKNOWLEDGE" | "NONE";

export type LegalVersion = {
  id: string;
  type: LegalDocumentType;
  version: string;
  title: string;
  summary: string | null;
  status: LegalStatus;
  scope: LegalScope;
  audiences: LegalAudience[];
  acceptanceKind: LegalAcceptanceKind;
  effectiveAt: string;
  publishedAt: string | null;
  retiredAt: string | null;
  changeNote: string | null;
  createdAt: string;
  updatedAt: string;
  acceptances: number;
  isCurrent: boolean;
};

export type LegalDocumentFull = Omit<LegalVersion, "acceptances" | "isCurrent"> & { content: string; contentHash: string };

export type LegalTypeGroup = {
  type: LegalDocumentType;
  slug: string;
  label: string;
  hint: string;
  defaults: { scope: LegalScope; audiences: LegalAudience[]; acceptanceKind: LegalAcceptanceKind };
  currentId: string | null;
  versions: LegalVersion[];
};

export type LegalStats = {
  academies: number;
  documents: {
    id: string;
    type: LegalDocumentType;
    title: string;
    version: string;
    scope: LegalScope;
    acceptanceKind: LegalAcceptanceKind;
    accepted: number;
    total: number | null;
    pendingAcademies: { id: string; name: string; slug: string; status: string }[];
    acceptedAcademies: { id: string; name: string; slug: string; acceptedAt: string; by: string }[];
  }[];
};

export type LegalAcceptanceRow = {
  id: string;
  type: LegalDocumentType;
  label: string;
  version: string;
  scope: LegalScope;
  onBehalfOfClub: boolean;
  context: "SIGNUP" | "LOGIN_GATE" | "TERMS_UPDATE" | "SETTINGS";
  acceptedAt: string;
  ip: string | null;
  userAgent: string | null;
  user: { name: string; email: string };
  academy: { name: string; slug: string } | null;
};

export type DocumentInput = {
  type: LegalDocumentType;
  version: string;
  title: string;
  summary?: string | null;
  content: string;
  scope?: LegalScope;
  audiences?: LegalAudience[];
  acceptanceKind?: LegalAcceptanceKind;
  effectiveAt?: string | null;
  changeNote?: string | null;
};

export const createDocument = (input: DocumentInput) => apiPost<LegalDocumentFull>("/legal/documents", input);
export const updateDocument = (id: string, input: Partial<DocumentInput>) =>
  apiPatch<LegalDocumentFull>(`/legal/documents/${id}`, input);
export const publishDocument = (id: string, effectiveAt?: string | null) =>
  apiPost<LegalDocumentFull>(`/legal/documents/${id}/publish`, { effectiveAt: effectiveAt ?? null });
export const retireDocument = (id: string) => apiPost<LegalDocumentFull>(`/legal/documents/${id}/retire`, {});
export const deleteDocument = (id: string) => apiDelete<{ ok: true }>(`/legal/documents/${id}`);

export const STATUS_LABEL: Record<LegalStatus, string> = {
  DRAFT: "Rascunho",
  PUBLISHED: "Publicada",
  RETIRED: "Retirada",
};

export const SCOPE_LABEL: Record<LegalScope, string> = {
  CLUB: "Vincula o clube",
  USER: "Vincula a pessoa",
};

export const AUDIENCE_LABEL: Record<LegalAudience, string> = {
  CLUB_OWNER: "Responsável do clube",
  STAFF: "Pessoal",
  FAMILY: "Famílias",
  MEMBER: "Sócios",
};

export const KIND_LABEL: Record<LegalAcceptanceKind, string> = {
  ACCEPT: "Aceita (checkbox)",
  ACKNOWLEDGE: "Toma conhecimento (checkbox «Li»)",
  NONE: "Só se publica",
};

export const CONTEXT_LABEL: Record<LegalAcceptanceRow["context"], string> = {
  SIGNUP: "Primeira entrada",
  LOGIN_GATE: "Porta de entrada",
  TERMS_UPDATE: "Actualização",
  SETTINGS: "Definições",
};

/** "1.0" → "1.1"; "2" → "2.1". O que se sugere ao criar a versão seguinte. */
export function nextVersion(latest: string | undefined): string {
  if (!latest) return "1.0";
  const parts = latest.split(".").map((n) => parseInt(n, 10));
  if (parts.some((n) => Number.isNaN(n))) return latest + ".1";
  if (parts.length === 1) return `${parts[0]}.1`;
  parts[parts.length - 1] += 1;
  return parts.join(".");
}

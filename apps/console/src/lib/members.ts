import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/http";

/**
 * Sócios — a fronteira de dados.
 *
 * Como o scouting, fica fora do bootstrap: um clube com história tem milhares de
 * sócios, e trazê-los todos para o browser à entrada seria pagar por uma área que
 * a maior parte das pessoas nem abre.
 */

export type MemberStatus = "PENDING" | "ACTIVE" | "SUSPENDED" | "CANCELLED";
export type FeePeriod = "MONTHLY" | "QUARTERLY" | "ANNUAL" | "ONCE";
export type Sex = "FEMALE" | "MALE" | "UNSPECIFIED";
export type DocumentKind = "CC" | "PASSPORT" | "RESIDENCE" | "OTHER";

export const STATUS_LABEL: Record<MemberStatus, string> = {
  PENDING: "Por aprovar",
  ACTIVE: "Activo",
  SUSPENDED: "Suspenso",
  CANCELLED: "Cancelado",
};

export const PERIOD_LABEL: Record<FeePeriod, string> = {
  MONTHLY: "por mês",
  QUARTERLY: "por trimestre",
  ANNUAL: "por ano",
  ONCE: "uma vez",
};

export const PERIOD_SHORT: Record<FeePeriod, string> = {
  MONTHLY: "/mês",
  QUARTERLY: "/tri",
  ANNUAL: "/ano",
  ONCE: "único",
};

export const SEX_LABEL: Record<Sex, string> = {
  FEMALE: "Feminino",
  MALE: "Masculino",
  UNSPECIFIED: "Não indicado",
};

export const DOC_LABEL: Record<DocumentKind, string> = {
  CC: "Cartão de cidadão",
  PASSPORT: "Passaporte",
  RESIDENCE: "Título de residência",
  OTHER: "Outro",
};

export type MemberTier = {
  id: string;
  name: string;
  description: string | null;
  benefits: string[];
  feeCents: number | null;
  period: FeePeriod;
  minAge: number | null;
  maxAge: number | null;
  isPublic: boolean;
  order: number;
  members: number;
};

export type MemberRow = {
  id: string;
  number: number | null;
  name: string;
  email: string;
  phone: string;
  phoneCountry: string;
  birthdate: string;
  city: string;
  status: MemberStatus;
  createdAt: string;
  approvedAt: string | null;
  source: string;
  tier: { id: string; name: string; feeCents: number | null; period: FeePeriod } | null;
};

export type MemberDetail = MemberRow & {
  country: string;
  address: string;
  postalCode: string;
  sex: Sex;
  documentKind: DocumentKind;
  documentNumber: string;
  taxId: string;
  notes: string | null;
  /** Carimbos de consentimento. Nulo = não foi dado. Ver o modelo. */
  acceptedTermsAt: string;
  partnerCommsAt: string | null;
  partnerDataAt: string | null;
  approvedBy: string | null;
};

export const listMembers = (filters: { status?: string; tierId?: string; q?: string } = {}) =>
  apiGet<{ members: MemberRow[]; counts: Partial<Record<MemberStatus, number>> }>("/api/members", filters);

export const getMember = (id: string) => apiGet<MemberDetail>(`/api/members/${id}`);

export const updateMember = (id: string, body: Record<string, unknown>) => apiPatch(`/api/members/${id}`, body);

export const listTiers = () => apiGet<MemberTier[]>("/api/members/tiers");

export const createTier = (body: Record<string, unknown>) =>
  apiPost<{ id: string; name: string }>("/api/members/tiers", body);

export const updateTier = (id: string, body: Record<string, unknown>) => apiPatch(`/api/members/tiers/${id}`, body);

export const archiveTier = (id: string) => apiDelete<{ ok: boolean; members: number }>(`/api/members/tiers/${id}`);

/** Idade, que é o que decide se alguém cabe numa categoria. */
export function ageOf(birthdate: string, now = new Date()): number {
  const b = new Date(birthdate);
  let age = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--;
  return age;
}

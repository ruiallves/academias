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

/*
 * Só o nome é garantido.
 *
 * Um sócio inscrito ao balcão traz o nome e um contacto; o resto da ficha
 * completa-se depois, e até lá é **nulo** — não string vazia. A diferença
 * importa nos ecrãs: um vazio desenha-se como campo em branco, um nulo
 * desenha-se como "por preencher", que é uma coisa que se pode ir corrigir.
 */
export type MemberRow = {
  id: string;
  number: number | null;
  name: string;
  email: string | null;
  phone: string | null;
  phoneCountry: string;
  birthdate: string | null;
  city: string | null;
  status: MemberStatus;
  createdAt: string;
  approvedAt: string | null;
  source: string;
  tier: { id: string; name: string; feeCents: number | null; period: FeePeriod } | null;
};

export type MemberDetail = MemberRow & {
  country: string;
  address: string | null;
  postalCode: string | null;
  sex: Sex;
  documentKind: DocumentKind;
  documentNumber: string | null;
  taxId: string | null;
  notes: string | null;
  /** Carimbos de consentimento. Nulo = não foi dado. Ver o modelo. */
  acceptedTermsAt: string | null;
  partnerCommsAt: string | null;
  partnerDataAt: string | null;
  approvedBy: string | null;
};

export const listMembers = (filters: { status?: string; tierId?: string; q?: string } = {}) =>
  apiGet<{ members: MemberRow[]; counts: Partial<Record<MemberStatus, number>> }>("/api/members", filters);

export const createMember = (body: Record<string, unknown>) =>
  apiPost<{ id: string; name: string; number: number | null }>("/api/members", body);

export const getMember = (id: string) => apiGet<MemberDetail>(`/api/members/${id}`);

export const updateMember = (id: string, body: Record<string, unknown>) => apiPatch(`/api/members/${id}`, body);

/**
 * Apagar de vez — só serve para o que nunca chegou a ser sócio.
 *
 * O servidor recusa assim que houver um número atribuído e diz porquê; ver
 * `MembersService.remove`. Quem tem número cancela-se, não se apaga.
 */
export const removeMember = (id: string) => apiDelete<{ ok: boolean }>(`/api/members/${id}`);

export const listTiers = () => apiGet<MemberTier[]>("/api/members/tiers");

export const createTier = (body: Record<string, unknown>) =>
  apiPost<{ id: string; name: string }>("/api/members/tiers", body);

export const updateTier = (id: string, body: Record<string, unknown>) => apiPatch(`/api/members/tiers/${id}`, body);

export const archiveTier = (id: string) => apiDelete<{ ok: boolean; members: number }>(`/api/members/tiers/${id}`);

/* -------------------------------------------------------------------------- */
/* Importação                                                                  */
/* -------------------------------------------------------------------------- */

/** Uma linha da folha, já traduzida para os nomes que a API conhece. */
export type ImportRow = {
  line: number;
  name: string;
  email: string;
  birthdate: string;
  address: string;
  postalCode: string;
  city: string;
  country?: string;
  phoneCountry?: string;
  phone: string;
  documentNumber: string;
  taxId: string;
  sex?: Sex;
  tier?: string;
  number?: number;
};

export type ImportResult = {
  ok: boolean;
  created: number;
  duplicates: { line: number; name: string }[];
  problems: { line: number; reason: string }[];
};

export const importMembers = (rows: ImportRow[]) => apiPost<ImportResult>("/api/members/import", { rows });

/** Idade, que é o que decide se alguém cabe numa categoria. */
export function ageOf(birthdate: string, now = new Date()): number {
  const b = new Date(birthdate);
  let age = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--;
  return age;
}

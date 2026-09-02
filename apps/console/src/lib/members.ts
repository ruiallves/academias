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
  /** A conta da app do clube: reclamada (`userId`) e o carimbo do convite. */
  userId: string | null;
  inviteSentAt: string | null;
};

/* ---------------------------------------------------------------------------- */
/* Quotas e app                                                                  */
/* ---------------------------------------------------------------------------- */

export type MemberFeeRow = {
  id: string;
  period: string;
  label: string | null;
  amountCents: number;
  dueOn: string | null;
  status: "OPEN" | "SETTLED" | "VOID";
  settledAt: string | null;
  method: string | null;
  notes: string | null;
};

export const listMemberFees = (memberId: string) => apiGet<MemberFeeRow[]>(`/api/members/${memberId}/fees`);
export const generateFees = () => apiPost<{ created: number; members: number }>("/api/members/fees/generate", {});
export const settleFee = (id: string, method: "CASH" | "TRANSFER") =>
  apiPost<{ ok: true }>(`/api/members/fees/${id}/settle`, { method });
export const voidFee = (id: string) => apiPost<{ ok: true }>(`/api/members/fees/${id}/void`, {});
export const reopenFee = (id: string) => apiPost<{ ok: true }>(`/api/members/fees/${id}/reopen`, {});

export const inviteMember = (id: string) => apiPost<{ ok: true; email: string }>(`/api/members/${id}/invite`, {});

/* ---------------------------------------------------------------------------- */
/* Sondagens                                                                     */
/* ---------------------------------------------------------------------------- */

export type PollRow = {
  id: string;
  question: string;
  details: string | null;
  status: "DRAFT" | "OPEN" | "CLOSED";
  publishedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  totalVotes: number;
  options: { id: string; label: string; votes: number }[];
};

export const listPolls = () => apiGet<PollRow[]>("/api/polls");
export const createPoll = (body: { question: string; details?: string; options: string[] }) =>
  apiPost<{ id: string }>("/api/polls", body);
export const publishPoll = (id: string) => apiPost<{ ok: true }>(`/api/polls/${id}/publish`, {});
export const closePoll = (id: string) => apiPost<{ ok: true }>(`/api/polls/${id}/close`, {});
export const removePoll = (id: string) => apiDelete<{ ok: true }>(`/api/polls/${id}`);

/* O cartão na app — os dois interruptores das definições do clube. */
export const setMemberCard = (body: { cardEnabled?: boolean; qrEnabled?: boolean }) =>
  apiPatch<{ cardEnabled: boolean; qrEnabled: boolean }>("/api/academy/member-card", body);

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

/**
 * Uma linha da folha, já traduzida para os nomes que a API conhece.
 *
 * Obrigatórios: **nome, número de sócio, telemóvel e categoria**. Tudo o resto é
 * opcional porque a folha do clube não o tem — ver `MemberImportRowDto`.
 */
export type ImportRow = {
  line: number;
  name: string;
  number: number;
  phone: string;
  tier: string;
  email?: string;
  birthdate?: string;
  address?: string;
  postalCode?: string;
  city?: string;
  country?: string;
  phoneCountry?: string;
  documentNumber?: string;
  taxId?: string;
  sex?: Sex;
};

export type ImportResult = {
  ok: boolean;
  created: number;
  duplicates: { line: number; name: string }[];
  problems: { line: number; reason: string }[];
  /**
   * As categorias que a folha traz e o clube não tem, quando a importação parou
   * para perguntar. Vazio em todas as outras respostas.
   */
  unknownTiers: string[];
};

/**
 * `createTiers` responde à pergunta que o servidor faz quando a folha traz
 * categorias novas: criá-las, ou parar. Ver `ImportDialog`.
 */
export const importMembers = (rows: ImportRow[], createTiers = false) =>
  apiPost<ImportResult>("/api/members/import", { rows, createTiers });

/** Idade, que é o que decide se alguém cabe numa categoria. */
export function ageOf(birthdate: string, now = new Date()): number {
  const b = new Date(birthdate);
  let age = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--;
  return age;
}

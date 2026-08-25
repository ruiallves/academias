/** O que a API do painel devolve. Espelha `apps/api/src/platform`. */

export type PlatformRole = "OWNER" | "ADMIN" | "SUPPORT";

export type Me = { id: string; name: string; email: string; role: PlatformRole; mfaEnabled: boolean };

/* -------------------------------------------------------------------------- */
/* Administradores                                                             */
/* -------------------------------------------------------------------------- */

export type Admin = {
  id: string;
  name: string;
  email: string;
  role: PlatformRole;
  isActive: boolean;
  mfaEnabled: boolean;
  createdAt: string;
};

export const ADMIN_ROLE_LABEL: Record<PlatformRole, string> = {
  OWNER: "Dono",
  ADMIN: "Administrador",
  SUPPORT: "Apoio",
};

export type Alert = {
  id: string;
  severity: "risk" | "warn";
  title: string;
  detail: string;
  academyId: string;
  academyName: string;
};

export type Overview = {
  academies: { total: number; setup: number; trial: number; active: number; pastDue: number; cancelled: number; newThisMonth: number; churnThisMonth: number };
  people: { athletes: number; guardians: number; staff: number };
  revenue: { mrrCents: number; arrCents: number };
  usage: number | null;
  alerts: Alert[];
};

export type AcademyStatus = "SETUP" | "TRIAL" | "ACTIVE" | "PAST_DUE" | "CANCELLED";

export type Academy = {
  id: string;
  slug: string;
  name: string;
  status: AcademyStatus;
  createdAt: string;
  trialEndsAt: string | null;
  plan: string | null;
  subscriptionStatus: string | null;
  mrrCents: number;
  athletes: number;
  staff: number;
  guardians: number;
  teams: number;
  onboarding: { done: number; total: number; percent: number };
  lastActivity: string | null;
};

export type SeriesPoint = { month: string; new_academies: number; cancelled: number; active_end: number };

export type Plan = { id: string; name: string; amountCents: number; perAthleteCents: number; includedAthletes: number; trialDays: number };

export type AuditEntry = {
  id: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  detail: Record<string, unknown> | null;
  ip: string | null;
  createdAt: string;
  admin: { name: string; email: string } | null;
};

export const STATUS_LABEL: Record<AcademyStatus, string> = {
  SETUP: "Em montagem",
  TRIAL: "Avaliação",
  ACTIVE: "Ativa",
  PAST_DUE: "Pagamento falhado",
  CANCELLED: "Cancelada",
};

/* -------------------------------------------------------------------------- */
/* Contactos                                                                   */
/* -------------------------------------------------------------------------- */

export type ContactStatus = "NOVO" | "CONTACTADO" | "SEM_RESPOSTA" | "REUNIAO" | "PROPOSTA" | "CLIENTE" | "PERDIDO";
export type ContactChannel = "CHAMADA" | "EMAIL" | "WHATSAPP" | "REUNIAO" | "MENSAGEM" | "OUTRO";

export type ContactTouch = {
  id: string;
  channel: ContactChannel;
  note: string | null;
  status: ContactStatus | null;
  byName: string | null;
  happenedAt: string;
};

export type Contact = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  club: string | null;
  role: string | null;
  status: ContactStatus;
  notes: string | null;
  owner: { id: string; name: string } | null;
  academy: { id: string; name: string; slug: string } | null;
  lastContactAt: string | null;
  nextActionAt: string | null;
  nextActionNote: string | null;
  touchCount: number;
  lastTouch: { channel: ContactChannel; note: string | null; happenedAt: string } | null;
  createdAt: string;
  updatedAt: string;
  /** Só no detalhe — a lista traz apenas `lastTouch`. */
  touches?: ContactTouch[];
};

/**
 * A ordem importa: é a ordem do funil, e é a ordem por que os filtros aparecem.
 * `CLIENTE` e `PERDIDO` no fim porque são fim de linha — deixam de gerar trabalho.
 */
export const CONTACT_STATUS: ContactStatus[] = ["NOVO", "CONTACTADO", "SEM_RESPOSTA", "REUNIAO", "PROPOSTA", "CLIENTE", "PERDIDO"];

export const CONTACT_STATUS_LABEL: Record<ContactStatus, string> = {
  NOVO: "Por contactar",
  CONTACTADO: "Contactado",
  SEM_RESPOSTA: "Sem resposta",
  REUNIAO: "Reunião marcada",
  PROPOSTA: "Proposta enviada",
  CLIENTE: "Cliente",
  PERDIDO: "Perdido",
};

export const CHANNEL_LABEL: Record<ContactChannel, string> = {
  CHAMADA: "Chamada",
  EMAIL: "Email",
  WHATSAPP: "WhatsApp",
  REUNIAO: "Reunião",
  MENSAGEM: "Mensagem",
  OUTRO: "Outro",
};

export type CalendarFeed = { url: string; reachable: boolean; googleAddUrl: string };

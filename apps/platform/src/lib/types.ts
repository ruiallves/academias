/** O que a API do painel devolve. Espelha `apps/api/src/platform`. */

export type Me = { id: string; name: string; email: string; role: "OWNER" | "ADMIN" | "SUPPORT"; mfaEnabled: boolean };

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

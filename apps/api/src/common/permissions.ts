import { Role } from "@prisma/client";

/**
 * A tabela de permissões do servidor.
 *
 * É gémea de `apps/console/src/lib/permissions.ts` — de propósito. A do cliente
 * decide o que se **mostra**; esta decide o que se **pode**. Nunca se confia na
 * primeira: quem sabe o URL chega ao endpoint na mesma.
 */

export type Permission =
  | "academy:read" | "academy:write"
  | "athlete:read" | "athlete:write"
  | "family:read" | "family:write"
  | "team:read" | "team:write"
  | "staff:read" | "staff:write"
  | "calendar:read" | "calendar:write"
  | "attendance:read" | "attendance:write"
  | "billing:read" | "billing:write"
  | "comms:read" | "comms:write"
  | "evaluation:read" | "evaluation:write"
  | "report:read" | "report:write"
  | "settings:write"
  /**
   * Dados de saúde são categoria especial no RGPD, por isso são três permissões:
   *
   * - `clinical:status` — se o atleta está disponível e até quando.
   * - `clinical:read` — o boletim: diagnóstico, notas, exames, consultas.
   * - `clinical:write` — registar e dar alta. **Só o departamento clínico**, para
   *   a origem de um diagnóstico ser sempre rastreável a quem o pode fazer.
   */
  | "clinical:status" | "clinical:read" | "clinical:write";

const READ_ALL: Permission[] = [
  "academy:read", "athlete:read", "family:read", "team:read", "staff:read",
  "calendar:read", "attendance:read", "billing:read", "comms:read",
  "evaluation:read", "report:read", "clinical:status", "clinical:read",
];

const WRITE_ALL: Permission[] = [
  "academy:write", "athlete:write", "family:write", "team:write", "staff:write",
  "calendar:write", "attendance:write", "billing:write", "comms:write",
  "evaluation:write", "report:write", "settings:write",
];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  OWNER: [...READ_ALL, ...WRITE_ALL],
  DIRECTOR: [...READ_ALL, ...WRITE_ALL],

  COORDINATOR: [
    ...READ_ALL.filter((p) => p !== "billing:read"),
    "athlete:write", "team:write", "calendar:write", "attendance:write",
    "comms:write", "evaluation:write", "report:write",
  ],

  // Sem `billing:read`. A regra do produto é que o financeiro só se vê com
  // permissão explícita — que o diretor concede em `Membership.grants`.
  COACH: [
    "academy:read", "athlete:read", "team:read", "calendar:read",
    "attendance:read", "attendance:write", "evaluation:read",
    "evaluation:write", "report:read", "report:write",
    // Lê o boletim — precisa de saber que lesão é para adaptar o treino. Não
    // escreve: o registo clínico é do departamento clínico.
    "clinical:status", "clinical:read",
  ],

  STAFF: ["academy:read", "athlete:read", "family:read", "team:read", "calendar:read", "attendance:read"],

  /**
   * Departamento clínico — médico, fisioterapeuta, nutricionista, psicólogo.
   *
   * Vê a academia toda: uma lesão não conhece escalões. Não vê mensalidades nem
   * avaliações desportivas — não é o trabalho dele, e o produto não lhe deve dar
   * acesso "porque é mais fácil".
   */
  MEDICAL: [
    "academy:read", "athlete:read", "team:read", "calendar:read", "report:read",
    "clinical:status", "clinical:read", "clinical:write",
  ],

  // O pai lê o boletim do próprio filho — o âmbito é que o limita a isso.
  GUARDIAN: ["athlete:read", "calendar:read", "billing:read", "comms:read", "report:read", "clinical:status", "clinical:read"],
  ATHLETE: ["calendar:read", "report:read", "clinical:status", "clinical:read"],
};

/** Âmbito: o que limita um treinador às suas equipas e um pai aos seus filhos. */
export type Scope = { teamIds?: string[]; athleteIds?: string[] };

export type RequestContext = {
  userId: string;
  academyId: string;
  membershipId: string;
  role: Role;
  grants: Permission[];
  scope: Scope;
};

export function can(ctx: RequestContext, permission: Permission): boolean {
  return ROLE_PERMISSIONS[ctx.role].includes(permission) || ctx.grants.includes(permission);
}

/**
 * Estreita um filtro de equipas ao âmbito do utilizador.
 *
 * Chamada em todos os serviços que devolvem dados por equipa. Devolver `undefined`
 * significa "sem limite"; devolver uma lista vazia significa "não vê nada" — e essa
 * distinção tem de ser explícita, senão um bug de âmbito abre a academia inteira.
 */
export function teamScopeFilter(ctx: RequestContext): { in: string[] } | undefined {
  // O departamento clínico entra aqui: obrigá-lo a estar atribuído a equipas para
  // poder tratar um atleta seria burocracia a fingir-se de segurança.
  if (ctx.role === "OWNER" || ctx.role === "DIRECTOR" || ctx.role === "COORDINATOR" || ctx.role === "MEDICAL")
    return undefined;
  return { in: ctx.scope.teamIds ?? [] };
}

export function athleteScopeFilter(ctx: RequestContext): { in: string[] } | undefined {
  if (ctx.role === "GUARDIAN" || ctx.role === "ATHLETE") return { in: ctx.scope.athleteIds ?? [] };
  return undefined;
}

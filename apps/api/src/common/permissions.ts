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
   * Mudar o que os outros vêem — o par do painel "Acesso" na ficha de staff.
   *
   * Separada de `staff:write` de propósito: corrigir um telemóvel é trabalho de
   * secretaria, mudar o **acesso** de alguém é outra coisa — quem o pode fazer pode
   * dar-se a si próprio, através de um terceiro, tudo o que quiser. É gémea da do
   * cliente (`apps/console/src/lib/permissions.ts`); estava só lá, e uma
   * verificação server-side dela era sempre falsa.
   */
  | "access:write"
  /**
   * Dados de saúde são categoria especial no RGPD, por isso são três permissões:
   *
   * - `clinical:status` — se o atleta está disponível e até quando.
   * - `clinical:read` — o boletim: diagnóstico, notas, exames, consultas.
   * - `clinical:write` — registar e dar alta.
   *
   * A rastreabilidade de um diagnóstico não vem de restringir quem escreve — vem
   * de `ClinicalEntry.authorId`, que guarda sempre quem o registou. A direção
   * escreve no boletim como escreve em tudo o resto: numa academia pequena é a
   * diretora que lança a baixa que o fisioterapeuta ditou ao telefone.
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
  "evaluation:write", "report:write", "settings:write", "access:write",
  // A direção pode tudo — incluindo registar no boletim clínico.
  "clinical:write",
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
    // Cria treinos, jogos e outros eventos — mas só para as suas equipas: o
    // âmbito (`teamScopeFilter`) impede-o de criar algo em nome de um escalão
    // que não é dele, e a interface nem lhe oferece "toda a academia" (isAcademyWide).
    "calendar:write",
    // Inscreve e importa atletas — por omissão, e só nas suas equipas. É o
    // treinador que conhece o plantel dele; obrigar tudo a passar pela direção
    // era um estrangulamento no arranque de uma época. A direção pode retirar-lho
    // a um treinador em concreto (`Membership.revokes`), na ficha de staff.
    "athlete:write",
    // Comunica com os pais das suas equipas — um treino que muda de hora, um aviso
    // de equipamento. Só os pais: o público "Geral"/"Treinadores" é da direção, e o
    // âmbito (`teamScopeFilter`) limita-o aos encarregados dos seus atletas.
    "comms:read", "comms:write",
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
  /** Retiradas por baixo do papel. Ganham às concessões — ver `can`. */
  revokes: Permission[];
  scope: Scope;
};

/**
 * O que esta pessoa pode, mesmo.
 *
 * Papel mais concessões, menos retiradas — e as retiradas ganham. Se algo estiver
 * nas duas listas (engano de quem configurou), a leitura segura é a que dá menos
 * acesso: nega-se. É a gémea de `permissionsOf` no cliente.
 */
export function can(ctx: RequestContext, permission: Permission): boolean {
  if (ctx.revokes.includes(permission)) return false;
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

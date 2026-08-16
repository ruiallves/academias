/**
 * Permissões como dados.
 *
 * Nada no produto pergunta `if (role === "coach")`. Pergunta-se sempre
 * `can("billing:read")`. Isto é o que permite que amanhã um diretor dê acesso
 * financeiro a um coordenador sem tocar em código, e é o mesmo mapa que a API
 * usa do lado do servidor — aqui só decide o que se mostra, nunca o que se pode.
 */

export type Permission =
  | "academy:read"
  | "academy:write"
  | "athlete:read"
  | "athlete:write"
  | "family:read"
  | "family:write"
  | "team:read"
  | "team:write"
  | "staff:read"
  | "staff:write"
  | "calendar:read"
  | "calendar:write"
  | "attendance:read"
  | "attendance:write"
  | "billing:read"
  | "billing:write"
  | "comms:read"
  | "comms:write"
  | "evaluation:read"
  | "evaluation:write"
  | "report:read"
  | "report:write"
  | "settings:write"
  /**
   * Dados de saúde são categoria especial no RGPD, por isso continuam a ser duas
   * permissões — mas quem lê o boletim é decisão do produto, não minha:
   *
   * - `clinical:status` — se o atleta está disponível e até quando.
   * - `clinical:read` — o boletim: diagnóstico, notas, exames, consultas.
   * - `clinical:write` — registar e dar alta. **Só o departamento clínico**, para
   *   que a origem de um diagnóstico seja sempre rastreável a quem o pode fazer.
   *
   * O treinador precisa de saber que tipo de fractura é para adaptar o trabalho, e
   * o diretor responde pelo atleta perante a família. Ambos lêem; nenhum escreve.
   */
  | "clinical:status"
  | "clinical:read"
  | "clinical:write";

export type Role =
  | "OWNER"
  | "DIRECTOR"
  | "COORDINATOR"
  | "COACH"
  | "STAFF"
  /** Departamento clínico: médico, fisioterapeuta, nutricionista, psicólogo. */
  | "MEDICAL"
  | "GUARDIAN"
  | "ATHLETE";

const READ_ALL: Permission[] = [
  "academy:read",
  "athlete:read",
  "family:read",
  "team:read",
  "staff:read",
  "calendar:read",
  "attendance:read",
  "billing:read",
  "comms:read",
  "evaluation:read",
  "report:read",
  "clinical:status",
  "clinical:read",
];

const WRITE_ALL: Permission[] = [
  "academy:write",
  "athlete:write",
  "family:write",
  "team:write",
  "staff:write",
  "calendar:write",
  "attendance:write",
  "billing:write",
  "comms:write",
  "evaluation:write",
  "report:write",
  "settings:write",
];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  OWNER: [...READ_ALL, ...WRITE_ALL],
  DIRECTOR: [...READ_ALL, ...WRITE_ALL],

  COORDINATOR: [
    ...READ_ALL.filter((p) => p !== "billing:read"),
    "athlete:write",
    "team:write",
    "calendar:write",
    "attendance:write",
    "comms:write",
    "evaluation:write",
    "report:write",
  ],

  /**
   * O treinador não tem `billing:read`. É deliberado e é a regra do brief:
   * informação financeira só com permissão explícita. Como a navegação é gerada
   * a partir daqui, Mensalidades não aparece — nem sequer desactivado. Um item
   * desactivado ensina que existe algo escondido; a ausência não ensina nada.
   */
  COACH: [
    "academy:read",
    "athlete:read",
    "team:read",
    "calendar:read",
    "attendance:read",
    "attendance:write",
    "evaluation:read",
    "evaluation:write",
    "report:read",
    "report:write",
    // Lê o boletim — precisa de saber que lesão é para adaptar o treino. Não
    // escreve: o registo clínico é do departamento clínico.
    "clinical:status",
    "clinical:read",
  ],

  STAFF: ["academy:read", "athlete:read", "family:read", "team:read", "calendar:read", "attendance:read"],

  /**
   * Departamento clínico.
   *
   * Vê a academia toda — uma lesão não conhece escalões, e o fisioterapeuta trata
   * quem aparecer. Não vê mensalidades nem avaliações desportivas: não é o
   * trabalho dele, e o produto não lhe deve dar acesso "porque é mais fácil".
   */
  MEDICAL: [
    "academy:read",
    "athlete:read",
    "team:read",
    "calendar:read",
    "clinical:status",
    "clinical:read",
    "clinical:write",
    "report:read",
  ],

  // O pai lê o boletim do próprio filho — o âmbito é que o limita a isso.
  GUARDIAN: ["athlete:read", "calendar:read", "billing:read", "comms:read", "report:read", "clinical:status", "clinical:read"],
  ATHLETE: ["calendar:read", "report:read", "clinical:status", "clinical:read"],
};

/**
 * O âmbito é o que separa um treinador de um diretor com os mesmos verbos:
 * o treinador tem `attendance:write`, mas só sobre as suas equipas.
 */
export type Scope = { teamIds?: string[]; athleteIds?: string[] };

export type Session = {
  userId: string;
  name: string;
  role: Role;
  /** Concessões pontuais por cima do papel — o diretor pode dar `billing:read` a um treinador. */
  grants?: Permission[];
  scope?: Scope;
};

export function permissionsOf(session: Session): Set<Permission> {
  return new Set([...ROLE_PERMISSIONS[session.role], ...(session.grants ?? [])]);
}

export function can(session: Session, permission: Permission): boolean {
  return permissionsOf(session).has(permission);
}

/**
 * Verdadeiro quando o utilizador vê a academia toda, falso quando vê só o seu âmbito.
 *
 * O departamento clínico entra aqui: uma lesão não conhece escalões, e obrigar o
 * fisioterapeuta a estar atribuído a equipas para poder tratar um atleta seria
 * burocracia a fingir-se de segurança.
 */
export function isAcademyWide(session: Session): boolean {
  return session.role === "OWNER" || session.role === "DIRECTOR" || session.role === "MEDICAL";
}

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
   * Criar papéis e escolher-lhes as permissões.
   *
   * Delegável — é a razão de existir: a presidência pode passar isto à direção ou
   * a uma pessoa. A escalada é travada noutro sítio, e da mesma forma que já era:
   * só se concede o que se tem, e ninguém edita o papel que veste.
   */
  | "role:write"
  /**
   * Escolher que menus um papel mostra.
   *
   * À parte de `role:write` de propósito. Reorganizar menus é decisão de
   * organização do trabalho; mexer em permissões é decisão de segurança. Juntas
   * numa só, quem quisesse a primeira levava a segunda de borla.
   *
   * **Nunca é uma fronteira de segurança.** Esconder "Mensalidades" não tira
   * `billing:read`, e o servidor responde na mesma a quem souber o URL.
   */
  | "role:menu"
  /**
   * Scouting — prospectos, observações, shortlists e pedidos.
   *
   * O vídeo é separado do resto porque é o dado mais sensível da área: imagem de
   * menores que **não são da academia**. Um coordenador pode ler o dossiê sem ter
   * direito ao vídeo, e essa distinção só é exprimível com quatro permissões.
   */
  | "scouting:read" | "scouting:write"
  | "scouting:video:read" | "scouting:video:write"
  /**
   * Pedir jogadores ao departamento de scouting — e acompanhar os próprios pedidos.
   *
   * Separada de `scouting:read` porque serve **outra pessoa**: um treinador que diz
   * o que lhe falta no plantel não tem de ver os dossiês de miúdos de outros clubes,
   * e dar-lhe `scouting:read` só para ele poder abrir um ticket era abrir-lhe a
   * área inteira. Com esta, vê os pedidos que fez e os nomes que o scouting lá pôs,
   * e mais nada.
   */
  | "scouting:request"
  /**
   * Sócios — o livro do clube.
   *
   * À parte de `athlete:*` porque são vínculos diferentes: um atleta treina, um
   * sócio paga quota e vota. A secretaria que trata de sócios pode não ter nada
   * que ver com a formação, e o contrário também é verdade.
   */
  | "member:read" | "member:write"
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
  "scouting:read",
  "scouting:request",
  "member:read",
];

const WRITE_ALL: Permission[] = [
  "academy:write", "athlete:write", "family:write", "team:write", "staff:write",
  "calendar:write", "attendance:write", "billing:write", "comms:write",
  "evaluation:write", "report:write", "settings:write", "access:write",
  // A direção pode tudo — incluindo registar no boletim clínico.
  "clinical:write",
  "scouting:write",
  "member:write",
];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  // Só a presidência cria papéis por omissão. A direção recebe-o se a presidência
  // lho der — que é precisamente a delegação que a funcionalidade existe para dar.
  OWNER: [...READ_ALL, ...WRITE_ALL, "role:write", "role:menu", "scouting:video:read", "scouting:video:write"],
  DIRECTOR: [...READ_ALL, ...WRITE_ALL, "scouting:video:read", "scouting:video:write"],

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
    // Pede jogadores ao scouting. É o treinador que sabe que lhe falta um lateral
    // esquerdo — e é ele que acompanha os nomes que aparecerem no pedido dele. Não
    // leva `scouting:read` atrás: os dossiês continuam a ser do departamento.
    "scouting:request",
  ],

  // A secretaria é quem está ao balcão quando alguém chega para se fazer sócio.
  STAFF: [
    "academy:read", "athlete:read", "family:read", "team:read", "calendar:read", "attendance:read",
    "member:read", "member:write",
  ],

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

  /**
   * Departamento de scouting.
   *
   * Vê a academia toda — um prospecto não pertence a escalão nenhum — mas o que
   * vê é o dossiê de scouting, e mais nada: sem boletim clínico, sem mensalidades,
   * sem famílias. `athlete:read` e `team:read` existem para o dia em que um
   * prospecto é recrutado e passa a atleta, e para comparar quem se segue com
   * quem já cá está.
   */
  SCOUT: [
    "academy:read", "athlete:read", "team:read", "calendar:read", "report:read",
    "scouting:read", "scouting:write", "scouting:video:read", "scouting:video:write",
    "scouting:request",
  ],

  // O pai lê o boletim do próprio filho — o âmbito é que o limita a isso.
  //
  // `team:read` está cá porque quem paga tem de saber em que equipa o filho anda,
  // quem o treina e a que horas treina — é o cabeçalho da app da família. O
  // âmbito limita-o às equipas dos filhos, e a lista de atletas é filtrada à
  // parte (ver `athletes()`), para "ver a equipa" não virar "ver os colegas".
  /*
   * O pai passa a ler avaliações.
   *
   * Faltava, e era a razão por que a app da família tinha um espaço reservado onde
   * devia estar o boletim do filho: o servidor recusava-o por permissão, muito
   * antes de haver endpoint. O que o pai vê continua limitado por duas coisas
   * independentes desta — o âmbito (só os filhos) e o estado (só o que foi
   * publicado, nunca um rascunho do treinador).
   */
  GUARDIAN: ["athlete:read", "team:read", "calendar:read", "billing:read", "comms:read", "evaluation:read", "report:read", "clinical:status", "clinical:read"],
  ATHLETE: ["team:read", "calendar:read", "evaluation:read", "report:read", "clinical:status", "clinical:read"],
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
  /**
   * As permissões do papel da academia, quando esta pessoa tem um.
   *
   * Substitui — não acumula com — o mapa em código. Nulo significa "o papel-base
   * por omissão", que é o que toda a gente tinha antes de os papéis existirem.
   */
  rolePermissions: Permission[] | null;
  /** O papel da academia, para o cliente o poder mostrar. */
  roleId: string | null;
  roleName: string | null;
  /** Menus que este papel mostra. Vazio = todos os que a permissão deixar. */
  navKeys: string[];
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
  return basePermissions(ctx).includes(permission) || ctx.grants.includes(permission);
}

/**
 * O que o papel desta pessoa dá, antes das excepções.
 *
 * O papel da academia **substitui** o mapa em código, não se soma a ele: se a
 * presidência tirar `billing:read` ao papel "Treinador", nenhum treinador o tem —
 * senão a configuração só saberia dar, e voltávamos a precisar de um papel novo
 * por cada excepção.
 */
export function basePermissions(ctx: RequestContext): Permission[] {
  return ctx.rolePermissions ?? ROLE_PERMISSIONS[ctx.role];
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
  if (
    ctx.role === "OWNER" ||
    ctx.role === "DIRECTOR" ||
    ctx.role === "COORDINATOR" ||
    ctx.role === "MEDICAL" ||
    // O scouting também: um prospecto não pertence a equipa nenhuma, e prendê-lo
    // a escalões era burocracia a fingir-se de segurança — como no clínico.
    ctx.role === "SCOUT"
  )
    return undefined;
  return { in: ctx.scope.teamIds ?? [] };
}

export function athleteScopeFilter(ctx: RequestContext): { in: string[] } | undefined {
  if (ctx.role === "GUARDIAN" || ctx.role === "ATHLETE") return { in: ctx.scope.athleteIds ?? [] };
  return undefined;
}

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
   * Mudar o que os outros vêem.
   *
   * Separada de `staff:write` de propósito. Editar a ficha de alguém — corrigir um
   * telemóvel, mudar um cargo — é trabalho de secretaria. Mudar o **acesso** dessa
   * pessoa é outra coisa: quem o pode fazer pode dar-se a si próprio, através de um
   * terceiro, tudo o que quiser. Juntar as duas faria de cada pessoa com acesso à
   * ficha um administrador do sistema sem que ninguém tivesse decidido isso.
   */
  | "access:write"
  /**
   * Criar papéis e escolher-lhes as permissões.
   *
   * Delegável — é a razão de existir: a presidência passa isto à direção, ou a uma
   * pessoa em concreto, sem lhe dar mais nada. Gémea do servidor.
   */
  | "role:write"
  /**
   * Escolher que menus um papel mostra.
   *
   * À parte de `role:write`: reorganizar menus é organização do trabalho, mexer em
   * permissões é segurança. **E nunca é uma fronteira** — esconder "Mensalidades"
   * não tira `billing:read`, e o servidor responde na mesma a quem souber o URL.
   */
  | "role:menu"
  /** Scouting. O vídeo é separado: é imagem de menores que não são da academia. */
  | "scouting:read"
  | "scouting:write"
  | "scouting:video:read"
  | "scouting:video:write"
  /**
   * Pedir jogadores ao scouting, e acompanhar os próprios pedidos.
   *
   * A porta do treinador para a área, sem lhe abrir os dossiês. Gémea do servidor.
   */
  | "scouting:request"
  /**
   * Sócios — o livro do clube.
   *
   * À parte de `athlete:*`: são vínculos diferentes. Um atleta treina, um sócio
   * paga quota e vota. Gémea do servidor.
   */
  | "member:read"
  | "member:write"
  /**
   * Área técnica — planos de treino, biblioteca de exercícios, modelos de jogo
   * e bolas paradas.
   *
   * À parte de `calendar:*` e `attendance:*`: marcar um treino e desenhar o
   * plano dele são trabalhos diferentes. Gémea do servidor.
   */
  | "training:read"
  | "training:write"
  /**
   * Dados de saúde são categoria especial no RGPD, por isso continuam a ser duas
   * permissões — mas quem lê o boletim é decisão do produto, não minha:
   *
   * - `clinical:status` — se o atleta está disponível e até quando.
   * - `clinical:read` — o boletim: diagnóstico, notas, exames, consultas.
   * - `clinical:write` — registar e dar alta.
   *
   * A rastreabilidade vem de `ClinicalEntry.authorId`, que guarda sempre quem
   * registou — e não de restringir quem escreve. A direção escreve no boletim
   * como escreve em tudo o resto.
   *
   * O treinador precisa de saber que tipo de fractura é para adaptar o trabalho —
   * lê, e não escreve. A direção responde pelo atleta perante a família, e escreve.
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
  /** Departamento de scouting. Vê a academia toda, mas só o dossiê de scouting. */
  | "SCOUT"
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
  "scouting:read",
  "scouting:request",
  "member:read",
  "training:read",
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
  "access:write",
  // A direção pode tudo — incluindo registar no boletim clínico.
  "clinical:write",
  "scouting:write",
  "member:write",
  "training:write",
];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  // Só a presidência cria papéis por omissão. A direção recebe-o se lho derem —
  // que é precisamente a delegação que a funcionalidade existe para permitir.
  OWNER: [...READ_ALL, ...WRITE_ALL, "role:write", "role:menu", "scouting:video:read", "scouting:video:write"],
  DIRECTOR: [...READ_ALL, ...WRITE_ALL, "scouting:video:read", "scouting:video:write"],

  /*
   * Sem `billing:read` e sem `member:read`. Gémeo do servidor.
   *
   * Os sócios são da direcção, por omissão: um coordenador trata de equipas e
   * atletas, e a lista de sócios com quotas e contactos é outra coisa. Quem
   * precisar dela recebe-a num cargo.
   */
  COORDINATOR: [
    ...READ_ALL.filter((p) => p !== "billing:read" && p !== "member:read"),
    "athlete:write",
    "team:write",
    "calendar:write",
    "attendance:write",
    "comms:write",
    "evaluation:write",
    "report:write",
    // A área técnica é o trabalho dele. Gémeo do servidor.
    "training:write",
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
    // Cria treinos, jogos e outros eventos — mas só para as suas equipas. O
    // âmbito (`teamScopeFilter`, no servidor) impede-o de criar em nome de um
    // escalão que não é dele, e a interface nem lhe oferece "toda a academia"
    // (ver `isAcademyWide` em `NewEventDialog`).
    "calendar:write",
    // Inscreve e importa atletas por omissão, só nas suas equipas. A direção pode
    // retirar-lho a um treinador em concreto, na ficha de staff (revokes). Gémeo
    // do servidor.
    "athlete:write",
    // Comunica com os pais das suas equipas (só "Pais" — o servidor limita o
    // público e o âmbito). Gémeo do servidor.
    "comms:read",
    "comms:write",
    /*
     * Vê as famílias — as dos atletas dele, e mais nenhumas.
     *
     * O âmbito não vem daqui nem da interface: a lista de famílias é **derivada**
     * dos atletas (ver `lib/store.ts`), e essa lista já chega filtrada pelo
     * servidor. Um treinador recebe as famílias dos seus atletas porque são as
     * únicas que existem para ele — não porque este ecrã as esconde.
     *
     * O NIF do atleta continua de fora: exige `family:write`, do lado do servidor.
     */
    "family:read",
    // Pede jogadores ao scouting e acompanha os nomes que aparecerem no seu
    // pedido. Sem `scouting:read`: os dossiês continuam a ser do departamento.
    "scouting:request",
    // A área técnica é dele por definição: planeia os treinos das suas equipas,
    // cria exercícios e desenha bolas paradas. Gémeo do servidor.
    "training:read",
    "training:write",
  ],

  /**
   * O âmbito mais fechado. Serve os departamentos que o clube inventar.
   *
   * Trazia `member:read` e `member:write` — a ideia era a secretaria ao balcão.
   * Mas `STAFF` não é "a secretaria": é o que qualquer departamento novo recebe
   * por omissão, e um departamento de equipamentos passava a ver a lista de
   * sócios do clube sem ninguém ter decidido isso. Gémeo do servidor.
   */
  STAFF: [
    "academy:read",
    "athlete:read",
    "family:read",
    "team:read",
    "calendar:read",
    "attendance:read",
  ],

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

  /**
   * Departamento de scouting.
   *
   * Vê a academia toda — um prospecto não pertence a escalão nenhum — mas só o
   * dossiê: sem boletim clínico, sem mensalidades, sem famílias. Gémeo do servidor.
   */
  SCOUT: [
    "academy:read",
    "athlete:read",
    "team:read",
    "calendar:read",
    "report:read",
    "scouting:read",
    "scouting:write",
    "scouting:video:read",
    "scouting:video:write",
    "scouting:request",
  ],

  // O pai lê o boletim do próprio filho — o âmbito é que o limita a isso.
  // `team:read` para a família saber a equipa, o treinador e o horário do filho —
  // o âmbito limita-a às equipas dos filhos. Gémeo do servidor.
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

/**
 * O âmbito é o que separa um treinador de um diretor com os mesmos verbos:
 * o treinador tem `attendance:write`, mas só sobre as suas equipas.
 */
export type Scope = { teamIds?: string[]; athleteIds?: string[] };

export type Session = {
  userId: string;
  name: string;
  role: Role;
  /** A pessoa no quadro de staff. É o que liga a sessão às excepções de acesso. */
  staffId?: string;
  /** Concessões pontuais por cima do papel — o diretor pode dar `billing:read` a um treinador. */
  grants?: Permission[];
  /**
   * Retiradas pontuais por baixo do papel.
   *
   * O par de `grants`, e sem ele o produto só sabia dar. Uma academia que queira um
   * treinador sem acesso ao boletim clínico não tem como o exprimir com concessões
   * — teria de inventar um papel novo por cada excepção, e é assim que uma lista de
   * papéis passa de oito para quarenta.
   */
  revokes?: Permission[];
  /**
   * As permissões do **papel da academia**, resolvidas pelo servidor.
   *
   * Substituem — não se somam a — o mapa em código. Vêm no `me` do bootstrap
   * porque a academia pode tê-lo editado há um minuto; uma cópia local do mapa
   * passava a mentir no dia seguinte a qualquer mudança. Ausentes significa "os
   * valores por omissão do papel-base", que é o que existia antes dos papéis.
   */
  rolePermissions?: Permission[];
  /** O papel da academia, para o poder mostrar por nome. */
  roleId?: string | null;
  roleName?: string | null;
  /** Menus que o papel mostra. Vazio = todos os que a permissão deixar. */
  navKeys?: string[];
  scope?: Scope;
};

/**
 * O que esta pessoa pode, mesmo.
 *
 * Papel primeiro, excepções depois — e as retiradas ganham às concessões. Se
 * alguma coisa aparecer nas duas listas é engano de quem configurou, e nesse caso
 * a leitura segura é a que dá menos acesso.
 */
export function permissionsOf(session: Session): Set<Permission> {
  const base = session.rolePermissions ?? ROLE_PERMISSIONS[session.role];
  const allowed = new Set<Permission>([...base, ...(session.grants ?? [])]);
  for (const p of session.revokes ?? []) allowed.delete(p);
  return allowed;
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
  return (
    session.role === "OWNER" ||
    session.role === "DIRECTOR" ||
    session.role === "MEDICAL" ||
    // O scouting também: um prospecto não pertence a equipa nenhuma.
    session.role === "SCOUT"
  );
}

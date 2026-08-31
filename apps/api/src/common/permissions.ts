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
   * Apagar o clube inteiro.
   *
   * A operação mais destrutiva que existe no produto: leva atrás atletas,
   * famílias, pagamentos, boletins clínicos e o histórico todo, por cascata.
   * Por isso é **permissão própria** e não `settings:write` — configurar o
   * white-label e apagar a casa não são o mesmo nível de decisão, e quem trata
   * das definições não tem de poder fazer as duas.
   *
   * Por omissão: presidência e direção. Delegável como qualquer outra, mas
   * ninguém a recebe sem alguém a ter dado de propósito.
   */
  | "academy:delete"
  /**
   * Apagar uma equipa.
   *
   * À parte de `team:write` (que cria e edita) porque é outra decisão: uma
   * equipa apagada leva atrás os treinos e os jogos dela. Por omissão fica na
   * presidência e na direção — quem coordena o desporto monta plantéis, não
   * desmancha escalões.
   *
   * **Os atletas não são apagados.** Perdem a ligação a esta equipa e ficam por
   * atribuir: uma pessoa não pertence a uma linha de organização do clube.
   */
  | "team:delete"
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
   * Área técnica — planos de treino, biblioteca de exercícios, modelos de jogo
   * e bolas paradas.
   *
   * À parte de `calendar:*` e `attendance:*` de propósito: marcar um treino no
   * calendário e desenhar o plano dele são trabalhos diferentes, e há quem tenha
   * um sem o outro — a secretaria marca, o clínico consulta o calendário, e
   * nenhum dos dois escreve exercícios. O âmbito continua a mandar: um treinador
   * planeia os treinos **das suas equipas** (`teamScopeFilter`), como em tudo.
   */
  | "training:read" | "training:write"
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
  /**
   * O armazém do clube: artigos, tamanhos, stock e o que está com cada atleta.
   *
   * `read` acompanha quem já vê a operação — presidência, direção e coordenação.
   * `write` é presidência e direção, como o resto do `WRITE_ALL`, e delega-se a
   * quem trata do material (secretaria, roupeiro) no editor de cargos: é quase
   * sempre uma pessoa só, e é ela que passa o dia a entregar equipamento.
   *
   * Separadas porque ver quantas t-shirts há e mexer no número são decisões
   * diferentes: um treinador que queira saber se há coletes não tem de poder
   * dar baixa de trinta.
   */
  | "inventory:read" | "inventory:write"
  | "clinical:status" | "clinical:read" | "clinical:write";

const READ_ALL: Permission[] = [
  "academy:read", "athlete:read", "family:read", "team:read", "staff:read",
  "calendar:read", "attendance:read", "billing:read", "comms:read",
  "evaluation:read", "report:read", "clinical:status", "clinical:read",
  "scouting:read",
  "scouting:request",
  "member:read",
  "training:read",
  "inventory:read",
];

const WRITE_ALL: Permission[] = [
  "academy:write", "athlete:write", "family:write", "team:write", "staff:write",
  "calendar:write", "attendance:write", "billing:write", "comms:write",
  "evaluation:write", "report:write", "settings:write", "access:write",
  // Apagar o clube. Fica em WRITE_ALL — logo presidência e direção — e mais
  // ninguém: o coordenador filtra-a abaixo, como filtra o resto.
  "academy:delete",
  // Apagar uma equipa. Presidência e direção, como o apagar do clube — e pela
  // mesma razão: leva treinos e jogos atrás.
  "team:delete",
  // A direção pode tudo — incluindo registar no boletim clínico.
  "clinical:write",
  "scouting:write",
  "member:write",
  "training:write",
  // Mexer no stock: presidência e direção. Quem trata do material recebe-a num
  // cargo — ver a nota da permissão.
  "inventory:write",
];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  // Só a presidência cria papéis por omissão. A direção recebe-o se a presidência
  // lho der — que é precisamente a delegação que a funcionalidade existe para dar.
  OWNER: [...READ_ALL, ...WRITE_ALL, "role:write", "role:menu", "scouting:video:read", "scouting:video:write"],
  DIRECTOR: [...READ_ALL, ...WRITE_ALL, "scouting:video:read", "scouting:video:write"],

  /*
   * Sem `billing:read` e sem `member:read`.
   *
   * Os sócios são da **direcção**, por omissão. Um coordenador desportivo trata
   * de equipas e atletas; a lista de sócios do clube, com quotas e contactos, é
   * outra coisa — e quem precisar dela recebe-a num cargo, que é precisamente
   * para isso que os cargos existem.
   */
  COORDINATOR: [
    /*
     * Sem `billing:read`, `member:read` — e sem `inventory:read`.
     *
     * Os sócios são da direção, o financeiro também, e o armazém é de quem o
     * gere: a primeira pessoa que entra no clube, a presidência e a direção. Um
     * coordenador desportivo monta plantéis e planeia treinos; saber quantas
     * t-shirts há na prateleira não faz parte disso — e quem precisar recebe a
     * permissão num cargo, que é para isso que os cargos existem.
     */
    ...READ_ALL.filter((p) => p !== "billing:read" && p !== "member:read" && p !== "inventory:read"),
    "athlete:write", "team:write", "calendar:write", "attendance:write",
    "comms:write", "evaluation:write", "report:write",
    // A área técnica é o trabalho dele: modelos de jogo do clube, biblioteca
    // global, planos de qualquer escalão.
    "training:write",
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
    /*
     * Vê as famílias — as dos atletas dele, e mais nenhumas.
     *
     * Faltava, e a falta era estranha: o treinador já recebia o nome, o email e o
     * telefone dos encarregados dentro da ficha de cada atleta seu (é assim que a
     * API os devolve), mas não tinha o menu *Famílias* onde os ler numa lista. A
     * permissão que faltava era só a da porta.
     *
     * O âmbito não vem daqui: a lista de famílias é derivada dos atletas, e essa
     * consulta já é filtrada por `teamScopeFilter`. Um treinador que peça as
     * famílias recebe as dos seus atletas porque são as únicas que existem para
     * ele — não porque a interface as esconde.
     *
     * O NIF do atleta continua de fora: passou a exigir `family:write`. Ver a
     * nota em `bootstrap`.
     */
    "family:read",
    // Pede jogadores ao scouting. É o treinador que sabe que lhe falta um lateral
    // esquerdo — e é ele que acompanha os nomes que aparecerem no pedido dele. Não
    // leva `scouting:read` atrás: os dossiês continuam a ser do departamento.
    "scouting:request",
    // A área técnica é dele por definição: planeia os treinos das suas equipas,
    // cria exercícios e desenha bolas paradas. O que pode **planear** continua
    // limitado pelo âmbito — o plano é da sessão, e a sessão é de uma equipa.
    "training:read", "training:write",
  ],

  /**
   * O âmbito mais fechado. Serve os departamentos que o clube inventar.
   *
   * ## Porque é que já não traz sócios
   *
   * Trazia `member:read` e `member:write` — a ideia era a secretaria ao balcão,
   * quem inscreve alguém que chega para se fazer sócio. Mas `STAFF` não é "a
   * secretaria": é o âmbito por omissão de qualquer departamento novo, e um
   * departamento de equipamentos ou de marketing passava a ver a lista de sócios
   * do clube com contactos e quotas, sem ninguém ter decidido isso.
   *
   * Os sócios são da direcção. Um clube que queira a secretaria a tratar deles
   * cria-lhe um cargo com `member:read` e `member:write` — que é exactamente a
   * delegação que os cargos existem para fazer, e fica escrita onde se vê.
   */
  STAFF: [
    "academy:read", "athlete:read", "family:read", "team:read", "calendar:read", "attendance:read",
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

/**
 * O âmbito de quem **lê o calendário** — mais largo do que o de quem escreve.
 *
 * ## Porque é que existe um segundo filtro
 *
 * Um treinador precisa de ver o clube todo para trabalhar: a que horas está o
 * campo ocupado, quando joga o escalão de cima, se o autocarro sai no sábado. O
 * `teamScopeFilter` dava-lhe só as equipas dele, e isso transformava o calendário
 * do clube num calendário pessoal — sem ninguém conseguir saber se o pavilhão
 * estava livre.
 *
 * Ler não é escrever. `teamScopeFilter` continua a mandar em tudo o que **muda**
 * o calendário, e continua a mandar no que é privado de uma equipa: as faltas de
 * um treino, a convocatória de um jogo, a ficha técnica. Este filtro decide só
 * que **linhas** aparecem; o que cada linha mostra decide-se a seguir, e é por
 * isso que os dois têm de existir ao lado um do outro.
 *
 * ## Quem continua estreito
 *
 * As famílias e os atletas. Para eles o calendário é o do educando: alargá-lo
 * seria mostrar a um pai os treinos de escalões onde não tem filho nenhum, e a
 * agenda de um clube inteiro não é informação de família.
 */
export function calendarScopeFilter(ctx: RequestContext): { in: string[] } | undefined {
  if (ctx.role === "GUARDIAN" || ctx.role === "ATHLETE") return { in: ctx.scope.teamIds ?? [] };
  return undefined;
}

/** Esta equipa é minha? — a pergunta que decide o que se mostra de cada linha. */
export function inTeamScope(ctx: RequestContext, teamId: string | null): boolean {
  const scope = teamScopeFilter(ctx);
  if (!scope) return true;
  return teamId !== null && scope.in.includes(teamId);
}

export function athleteScopeFilter(ctx: RequestContext): { in: string[] } | undefined {
  if (ctx.role === "GUARDIAN" || ctx.role === "ATHLETE") return { in: ctx.scope.athleteIds ?? [] };
  return undefined;
}

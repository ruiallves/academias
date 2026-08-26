import { useEffect, useState, useSyncExternalStore } from "react";
import { athletes, guardians, sessions, staff, teams, useStore } from "@/lib/store";
import { useCatalog } from "@/lib/catalogs";
import { loadRoles, useRoles } from "@/lib/roles";
import { usePendingInvites } from "@/lib/invites";
import { listTiers } from "@/lib/members";
import { can, type Permission, type Session } from "@/lib/permissions";

/**
 * Os primeiros passos de uma academia.
 *
 * ## Um passo está feito quando a coisa existe
 *
 * Nada disto é uma caixa que alguém marca. Cada passo é **derivado dos dados**: há
 * equipas ou não há, há atletas ou não há, há treinadores com conta ou não há. É a
 * mesma disciplina da disponibilidade clínica e das mensalidades vencidas, e tem a
 * mesma razão: uma lista de estados guardados à parte diverge da realidade no dia
 * em que alguém apagar uma equipa, e passa a mentir sem ninguém dar por isso.
 *
 * Consequência agradável: se o diretor criar a primeira equipa pelo caminho normal,
 * sem passar por aqui, o passo aparece feito na mesma. A lista acompanha o
 * trabalho, não o contrário.
 *
 * ## Porque é que cada passo tem uma permissão
 *
 * Convidar staff e criar atletas não são coisas que toda a gente possa fazer. Um
 * passo que a pessoa não pode dar não lhe deve aparecer — mandá-la a um ecrã onde
 * vai encontrar um "sem acesso" é pior do que não lhe mostrar nada.
 */

export type Step = {
  id: string;
  label: string;
  /** O que ganha quem o fizer — dito em consequência, não em funcionalidade. */
  hint: string;
  done: boolean;
  to: string;
  requires: Permission;
};

/* -------------------------------------------------------------------------- */
/* Dispensa                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Fechar o painel é uma decisão que tem de durar.
 *
 * Em `localStorage` e não em memória: um painel de boas-vindas que reaparece a
 * cada navegação deixa de ser ajuda e passa a estorvo. Guarda-se por academia,
 * porque quem gere dois clubes está no início de um e a meio do outro.
 */
const KEY = "academia.onboarding.dismissed";

function read(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

let dismissed = read();
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const snapshot = () => dismissed;

export function dismissOnboarding(academySlug: string): void {
  dismissed = new Set([...dismissed, academySlug]);
  try {
    localStorage.setItem(KEY, JSON.stringify([...dismissed]));
  } catch {
    /* modo privado: fica dispensado só nesta sessão */
  }
  emit();
}

/** Para quem o fechou por engano — ou para voltar a ver o que falta. */
export function restoreOnboarding(academySlug: string): void {
  dismissed = new Set([...dismissed].filter((s) => s !== academySlug));
  try {
    localStorage.setItem(KEY, JSON.stringify([...dismissed]));
  } catch {
    /* idem */
  }
  emit();
}

function useDismissed(): Set<string> {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/* -------------------------------------------------------------------------- */
/* Os passos                                                                   */
/* -------------------------------------------------------------------------- */

export type Onboarding = {
  steps: Step[];
  done: number;
  total: number;
  /** Todos os passos dados. O painel muda de tom quando isto for verdade. */
  complete: boolean;
  /** Se o painel deve aparecer de todo. */
  visible: boolean;
  academySlug: string;
};

/** O que os passos precisam de saber. Separado do React para poder ser testado. */
export type Facts = {
  sports: number;
  venues: number;
  dressingRooms: number;
  ageGroups: number;
  staffTitles: number;
  teams: number;
  athletes: number;
  coaches: number;
  invitedCoach: boolean;
  sessions: number;
  guardians: number;
  memberTiers: number;
};

/**
 * Os passos, a partir dos factos.
 *
 * Função pura de propósito: é aqui que estão as decisões — o que conta como feito,
 * e quem pode ver o quê — e são elas que interessa verificar sem montar um browser.
 */
export function deriveSteps(session: Session, facts: Facts): Step[] {
  const all: Step[] = [
    /*
     * As modalidades vêm primeiro, e faltavam por completo.
     *
     * Faltavam por um descuido com consequências: uma academia nova nasce sem
     * modalidade nenhuma, e sem modalidade não há equipas nem escalões — todos
     * os passos seguintes esbarravam num sítio que a lista nunca mencionava.
     * Quem seguisse a lista de cima a baixo chegava a "Criar as equipas" e
     * encontrava um formulário que não deixava escolher desporto.
     */
    {
      id: "sports",
      label: "Escolher as modalidades",
      hint: "Futebol, futsal, natação… é o que organiza escalões, locais e equipas.",
      done: facts.sports > 0,
      to: "/definicoes",
      requires: "settings:write",
    },
    {
      id: "venues",
      label: "Definir os campos e pavilhões",
      hint: "É onde os treinos acontecem — sem isto, o horário fica sem sítio.",
      done: facts.venues > 0,
      to: "/definicoes?catalogo=venues",
      requires: "settings:write",
    },
    {
      id: "dressingRooms",
      label: "Definir os balneários",
      hint: "Escolhe-se ao marcar um treino, e aparece na app das famílias.",
      done: facts.dressingRooms > 0,
      to: "/definicoes?catalogo=dressingRooms",
      requires: "settings:write",
    },
    {
      id: "ageGroups",
      label: "Definir os escalões",
      hint: "Sub-15, Seniores… é a lista que aparece sempre que se cria uma equipa.",
      done: facts.ageGroups > 0,
      to: "/definicoes?catalogo=ageGroups",
      requires: "settings:write",
    },
    {
      id: "staffTitles",
      label: "Criar os cargos",
      /*
       * "Além do de presidente" não é um detalhe da frase: um clube novo abre
       * com esse cargo já criado — é o que a primeira pessoa veste — e sem esta
       * ressalva o passo aparecia por fazer com uma lista que não estava vazia.
       */
      hint: "Direção, treinador, secretaria… além do de presidente, que já existe.",
      done: facts.staffTitles > 1,
      to: "/definicoes?painel=cargos",
      requires: "role:write",
    },
    {
      id: "teams",
      label: "Criar as equipas",
      hint: "Um escalão por equipa. É a partir daqui que tudo o resto se organiza.",
      done: facts.teams > 0,
      to: "/equipas",
      requires: "team:write",
    },
    {
      id: "athletes",
      label: "Adicionar os atletas",
      hint: "Podes criar um a um ou importar de um ficheiro.",
      done: facts.athletes > 0,
      to: "/atletas",
      requires: "athlete:write",
    },
    {
      id: "coaches",
      // O convite conta como passo dado: a direção fez a parte dela, e o resto
      // depende de a pessoa abrir o link. Exigir a conta criada era pôr o diretor
      // à espera de terceiros num ecrã que lhe diz que está atrasado.
      label: "Convidar os treinadores",
      hint: "Cada um recebe um link e escolhe a palavra-passe. Vê só as equipas dele.",
      done: facts.coaches > 0 || facts.invitedCoach,
      to: "/staff",
      requires: "staff:write",
    },
    {
      id: "schedule",
      label: "Marcar os treinos no calendário",
      hint: "É o que faz as presenças e a app das famílias ganharem vida.",
      done: facts.sessions > 0,
      to: "/calendario",
      requires: "calendar:write",
    },
    {
      id: "families",
      label: "Ligar as famílias aos atletas",
      hint: "Só quem está ligado a um atleta recebe avisos e mensalidades na app.",
      done: facts.guardians > 0,
      to: "/familias",
      requires: "family:write",
    },
    {
      id: "members",
      label: "Preparar o livro de sócios",
      hint: "Cria as categorias — é o que aparece na página pública de inscrição.",
      done: facts.memberTiers > 0,
      to: "/socios",
      requires: "member:write",
    },
  ];

  // Um passo que a pessoa não pode dar não lhe aparece — mandá-la a um ecrã onde
  // vai encontrar "sem acesso" é pior do que não lhe mostrar nada.
  return all.filter((s) => can(session, s.requires));
}

export function useOnboarding(session: Session): Onboarding {
  const store = useStore();
  const venues = useCatalog("venues");
  const dressingRooms = useCatalog("dressingRooms");
  const ageGroups = useCatalog("ageGroups");
  const cargos = useRoles();
  const invites = usePendingInvites();
  const closed = useDismissed();

  // Sócios fica fora do bootstrap (ver `lib/members.ts`) — como não há dados já
  // carregados para contar, pergunta-se uma vez, só para saber se o passo está
  // feito. Sem `member:write` nem vale a pena perguntar: o passo não aparece.
  /*
   * Os cargos também ficam fora do bootstrap — vêm de `/api/roles`, que só as
   * Definições costumavam pedir. O passo "Criar os cargos" precisa de os contar,
   * por isso pergunta-se aqui, uma vez. Sem `role:write` o passo não aparece e
   * nem vale a pena perguntar.
   */
  useEffect(() => {
    if (!can(session, "role:write")) return;
    void loadRoles();
  }, [session]);

  const [memberTiers, setMemberTiers] = useState(0);
  useEffect(() => {
    if (!can(session, "member:write")) return;
    listTiers()
      .then((tiers) => setMemberTiers(tiers.length))
      .catch(() => {
        /* sem sócios ainda configurados no servidor: fica 0, o passo continua por fazer */
      });
  }, [session]);

  const steps = deriveSteps(session, {
    sports: store.academy.sports.length,
    venues: venues.length,
    dressingRooms: dressingRooms.length,
    ageGroups: ageGroups.length,
    staffTitles: cargos.roles.length,
    teams: teams.length,
    athletes: athletes.length,
    coaches: staff.filter((s) => s.role === "COACH" && s.isActive).length,
    invitedCoach: invites.some((i) => i.role === "COACH"),
    sessions: sessions.length,
    guardians: guardians.length,
    memberTiers,
  });

  const done = steps.filter((s) => s.done).length;
  const complete = steps.length > 0 && done === steps.length;
  const slug = store.academy.slug;

  return {
    steps,
    done,
    total: steps.length,
    complete,
    /*
     * Some quando não há passos que a pessoa possa dar, quando foi fechado, e —
     * depois de tudo feito — deixa de ter razão de existir.
     *
     * E só aparece a quem o arranque pertence: quem entrou primeiro no clube e o
     * presidente. O **progresso** é o mesmo para os dois — cada passo é derivado
     * dos dados, não de uma caixa que alguém marcou —, por isso vêem sempre o
     * mesmo estado sem nada a sincronizar entre eles.
     *
     * Antes aparecia a toda a gente com `settings:write`, incluindo a quem entrou
     * meses depois para tratar de outra coisa e encontrava uma lista de tarefas
     * que não era dele. Ver `setupOwner` em `academy.service.ts`.
     */
    visible:
      (store.me?.setupOwner ?? true) && steps.length > 0 && !closed.has(slug) && !(complete && closed.has(slug)),
    academySlug: slug,
  };
}

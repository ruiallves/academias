import {
  LayoutGrid,
  Users,
  Home,
  Shield,
  Whistle,
  CalendarDays,
  ClipboardCheck,
  Receipt,
  Megaphone,
  Gauge,
  FileText,
  Settings,
  HeartPulse,
  Stethoscope,
  type LucideIcon,
} from "@/lib/icons";
import type { Permission, Session } from "@/lib/permissions";
import { permissionsOf } from "@/lib/permissions";

export type NavItem = {
  label: string;
  to: string;
  icon: LucideIcon;
  requires: Permission;
  /** Contagem de coisas que precisam de acção. Ausente ≠ zero: zero não se mostra. */
  badge?: (counts: NavCounts) => number | undefined;
};

export type NavGroup = {
  /** Sem rótulo = o primeiro bloco, colado ao topo. Como nas referências. */
  label?: string;
  items: NavItem[];
};

export type NavCounts = {
  overdueFees: number;
  unreadThreads: number;
  pendingEvaluations: number;
  sessionsToRecord: number;
  /** Jogos a chegar com a convocatória por submeter. */
  callUpsToSubmit: number;
  /** Atletas de baixa neste momento — o contador do departamento clínico. */
  athletesOut: number;
};

/**
 * O grupo clínico, partilhado pela direção e pela equipa técnica.
 *
 * É literalmente o mesmo destino nos dois menus: o que muda é o que lá se
 * encontra, porque `listAthletes` já limita ao âmbito de quem entra. Duplicar o
 * ecrã por papel daria duas cópias a divergirem — e uma delas a esquecer-se do
 * filtro mais cedo ou mais tarde.
 *
 * Declarado antes dos menus que o usam: um `const` mais abaixo estaria na
 * temporal dead zone quando os arrays fossem construídos.
 */
const CLINICAL_GROUP: NavGroup = {
  label: "Clínico",
  items: [
    {
      label: "Boletins",
      to: "/clinico",
      icon: HeartPulse,
      requires: "clinical:read",
      badge: (c) => c.athletesOut || undefined,
    },
    { label: "Consultas", to: "/clinico/consultas", icon: Stethoscope, requires: "clinical:read" },
  ],
};

/**
 * A ordem é a que o fundador definiu. Os rótulos de grupo servem só para dar ar
 * às secções — não reordenam nada.
 */
const DIRECTOR_NAV: NavGroup[] = [
  {
    items: [{ label: "Visão geral", to: "/", icon: LayoutGrid, requires: "academy:read" }],
  },
  {
    label: "Pessoas",
    items: [
      { label: "Atletas", to: "/atletas", icon: Users, requires: "athlete:read" },
      { label: "Famílias", to: "/familias", icon: Home, requires: "family:read" },
      { label: "Equipas", to: "/equipas", icon: Shield, requires: "team:read" },
      { label: "Staff", to: "/staff", icon: Whistle, requires: "staff:read" },
    ],
  },
  // A direção responde pelo atleta perante a família e vê o historial clínico de
  // toda a academia. `listAthletes` é que limita o âmbito — o mesmo ecrã serve o
  // treinador, que só vê os seus.
  CLINICAL_GROUP,
  {
    label: "Operação",
    items: [
      { label: "Calendário", to: "/calendario", icon: CalendarDays, requires: "calendar:read" },
      {
        label: "Presenças",
        to: "/presencas",
        icon: ClipboardCheck,
        requires: "attendance:read",
        badge: (c) => c.sessionsToRecord || undefined,
      },
      {
        label: "Convocatórias",
        to: "/convocatorias",
        icon: Megaphone,
        requires: "calendar:read",
        badge: (c) => c.callUpsToSubmit || undefined,
      },
    ],
  },
  {
    label: "Gestão",
    items: [
      {
        label: "Mensalidades",
        to: "/mensalidades",
        icon: Receipt,
        requires: "billing:read",
        badge: (c) => c.overdueFees || undefined,
      },
      {
        label: "Comunicação",
        to: "/comunicacao",
        icon: Megaphone,
        requires: "comms:read",
        badge: (c) => c.unreadThreads || undefined,
      },
    ],
  },
  {
    label: "Desenvolvimento",
    items: [
      { label: "Avaliações", to: "/avaliacoes", icon: Gauge, requires: "evaluation:read" },
      { label: "Relatórios", to: "/relatorios", icon: FileText, requires: "report:read" },
    ],
  },
];

const COACH_NAV: NavGroup[] = [
  {
    items: [{ label: "Visão geral", to: "/", icon: LayoutGrid, requires: "academy:read" }],
  },
  {
    label: "Equipa",
    items: [
      { label: "Equipas", to: "/equipas", icon: Shield, requires: "team:read" },
      { label: "Atletas", to: "/atletas", icon: Users, requires: "athlete:read" },
    ],
  },
  {
    label: "Operação",
    items: [
      // Mesma dualidade que a direção tem: Calendário é a vista de planeamento
      // (mês, jogos, convocatórias); Treinos é a lista de trabalho — o que falta
      // registar. `useEvents`/`listTeams` já limitam tudo às equipas do
      // treinador; não há filtro extra a fazer aqui.
      { label: "Calendário", to: "/calendario", icon: CalendarDays, requires: "calendar:read" },
      {
        // "Presenças" e não "Treinos": o menu diz o que se lá faz, não o que se lá
        // vê. O treinador entra aqui para registar quem faltou — o calendário é
        // que responde a "quando é o próximo treino".
        label: "Presenças",
        to: "/presencas",
        icon: ClipboardCheck,
        requires: "attendance:read",
        badge: (c) => c.sessionsToRecord || undefined,
      },
      {
        label: "Convocatórias",
        to: "/convocatorias",
        icon: Megaphone,
        requires: "calendar:read",
        badge: (c) => c.callUpsToSubmit || undefined,
      },
    ],
  },
  CLINICAL_GROUP,
  {
    label: "Desenvolvimento",
    items: [
      {
        label: "Avaliações",
        to: "/avaliacoes",
        icon: Gauge,
        requires: "evaluation:read",
        badge: (c) => c.pendingEvaluations || undefined,
      },
      { label: "Relatórios", to: "/relatorios", icon: FileText, requires: "report:read" },
    ],
  },
  {
    label: "Famílias",
    items: [
      // O treinador comunica com os pais das suas equipas — o servidor limita o
      // público a "Pais" e o âmbito aos encarregados dos seus atletas.
      { label: "Comunicação", to: "/comunicacao", icon: Megaphone, requires: "comms:read" },
    ],
  },
];

/**
 * Departamento clínico.
 *
 * Vê a academia toda (`isAcademyWide`), mas só o que lhe diz respeito: atletas,
 * equipas e calendário — sem mensalidades, sem avaliações desportivas. O boletim
 * é o ecrã dele, e é o único sítio da aplicação com `clinical:read`.
 */
const MEDICAL_NAV: NavGroup[] = [
  {
    items: [{ label: "Visão geral", to: "/", icon: LayoutGrid, requires: "academy:read" }],
  },
  CLINICAL_GROUP,
  {
    label: "Academia",
    items: [
      { label: "Atletas", to: "/atletas", icon: Users, requires: "athlete:read" },
      { label: "Equipas", to: "/equipas", icon: Shield, requires: "team:read" },
      { label: "Calendário", to: "/calendario", icon: CalendarDays, requires: "calendar:read" },
    ],
  },
];

export const SETTINGS_ITEM: NavItem = {
  label: "Definições",
  to: "/definicoes",
  icon: Settings,
  requires: "settings:write",
};

/**
 * A navegação é derivada das permissões, não do papel. Um treinador a quem o
 * diretor conceda `billing:read` passa a ver Mensalidades sem alterações de código.
 */
export function navFor(session: Session): NavGroup[] {
  const perms = permissionsOf(session);
  const source =
    session.role === "MEDICAL"
      ? MEDICAL_NAV
      : session.role === "COACH" || session.role === "STAFF"
        ? COACH_NAV
        : DIRECTOR_NAV;

  return source
    .map((group) => ({ ...group, items: group.items.filter((i) => perms.has(i.requires)) }))
    .filter((group) => group.items.length > 0);
}

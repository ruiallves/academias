import {
  LayoutGrid,
  Users,
  Home,
  Shield,
  Whistle,
  Binoculars,
  Eye,
  CalendarDays,
  ClipboardCheck,
  Receipt,
  Wallet,
  Boxes,
  Megaphone,
  Trophy,
  Gauge,
  FileText,
  IdCard,
  Send,
  Settings,
  HeartPulse,
  Stethoscope,
  Dumbbell,
  Shapes,
  Brain,
  Film,
  Sparkle,
  Activity,
  Target,
  type LucideIcon,
} from "@/lib/icons";
import type { Permission, Session } from "@/lib/permissions";
import { permissionsOf } from "@/lib/permissions";
import { profileOf, profiledSports, sportPath } from "@/lib/sports";

/**
 * A navegação, como catálogo.
 *
 * Eram três listas — direção, equipa técnica, departamento clínico — escolhidas
 * por `session.role`. Enquanto os papéis estavam em código isso funcionava; a
 * partir do momento em que uma academia cria papéis, deixa de funcionar: um papel
 * novo não teria lista nenhuma, e acrescentar um quarto array por cada papel
 * criado é a definição de não configurável.
 *
 * Passa a haver **uma** lista, com uma chave estável por destino, e duas
 * passagens de filtro:
 *
 *   1. **Permissão** — o que a pessoa pode. É segurança (a sério no servidor;
 *      aqui é só não mostrar o que não abriria).
 *   2. **Menus do papel** (`navKeys`) — o que a academia decidiu mostrar a quem
 *      veste este papel. É **preferência**, nunca segurança: esconder
 *      "Mensalidades" não tira `billing:read`, e quem souber o URL chega lá na
 *      mesma. Quem quiser fechar mesmo, tira a permissão.
 *
 * Sem `navKeys` definidos mostra-se tudo o que a permissão deixa — o
 * comportamento de sempre, e o valor por omissão dos papéis semeados.
 */

export type NavItem = {
  /** Estável. É o que a academia guarda em `AcademyRole.navKeys`; o rótulo pode mudar. */
  key: string;
  label: string;
  to: string;
  icon: LucideIcon;
  requires: Permission;
  /** Contagem de coisas que precisam de acção. Ausente ≠ zero: zero não se mostra. */
  badge?: (counts: NavCounts) => number | undefined;
  /**
   * Ainda em construção — o menu di-lo antes de se lá entrar.
   *
   * A marca vive aqui e não no `Sidebar` porque é uma característica do
   * destino, não do sítio onde ele é desenhado: tirá-la quando a área estiver
   * pronta é apagar uma linha, no mesmo sítio onde ela foi posta.
   */
  beta?: true;
  /**
   * Um item que se desdobra conforme a configuração do clube.
   *
   * `sports` é a Área técnica das modalidades: no catálogo é **um** item (e é
   * assim que o editor de cargos o mostra e guarda — mostra-se ou não), mas no
   * menu vira um item por modalidade com perfil técnico: ⚽ Futebol, 🏀
   * Basquetebol. Um clube só de natação não vê nenhum. Ver `navFor`.
   */
  dynamic?: "sports";
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
  /** Jogos já jogados que continuam sem resultado — a ficha por preencher. */
  matchesToFill: number;
  /** Atletas de baixa neste momento — o contador do departamento clínico. */
  athletesOut: number;
};

/**
 * Uma ordem para toda a gente.
 *
 * A direção via "Atletas" antes de "Equipas" e o treinador o contrário — uma
 * diferença que ninguém pediu e que só existia porque eram listas separadas. Com
 * uma lista só, a ordem é a da academia: primeiro as pessoas, depois o que se faz
 * com elas, depois o dinheiro, depois o desenvolvimento. Quem quiser outra coisa
 * esconde itens; reordenar por papel seria configuração a mais para o que resolve.
 *
 * ## A ordem, e onde entram os dois departamentos
 *
 *   Pessoas · Operação · Gestão · Desenvolvimento · Scouting · Clínico
 *
 * As quatro primeiras são o dia de qualquer clube, e seguem-se umas às outras:
 * quem cá está, o que se faz com eles, quanto custa, como evoluem. **Scouting** e
 * **Clínico** vêm depois porque são departamentos — não são etapas daquela
 * sequência, e a maior parte das pessoas nem os vê (as permissões escondem-nos).
 *
 * Estavam a meio, entre "Pessoas" e "Operação", e partiam a sequência ao meio
 * para quem tem acesso a tudo: lia-se atletas, boletins clínicos, prospectos,
 * calendário. As Definições ficam à parte, no fundo da barra — ver `SETTINGS_ITEM`.
 */
/**
 * Academias AI — **fora de produção, por agora**.
 *
 * Não é uma permissão nem um interruptor de funcionalidade: é uma área que
 * ainda não é para os clubes verem. A diferença importa — uma permissão
 * esconde-se de quem não a tem e mostra-se a quem a tem, e hoje qualquer
 * presidente tem `ai:read` no cargo.
 *
 * Entra no catálogo com um *spread* condicional em vez de uma marca lida em
 * tempo de execução, e a diferença é real: o Vite substitui
 * `import.meta.env.DEV` por `false` na compilação, o que deixa
 * `...(false ? [GRUPO_AI] : [])` sem ninguém a referir `GRUPO_AI` — e o
 * empacotador deita-o fora. Uma marca `devOnly` filtrada no `navFor` deixava
 * os rótulos e os caminhos todos dentro do pacote que o clube descarrega.
 *
 * O lugar é a seguir à Área técnica, que é a sua continuação natural: o vídeo
 * do jogo é o mesmo trabalho de conteúdo do treinador, um passo à frente.
 */
const GRUPO_AI: NavGroup = {
  label: "Academias AI",
  items: [
    { key: "ai-overview", label: "Visão AI", to: "/ai", icon: Brain, requires: "ai:read" },
    { key: "ai-analyses", label: "Análises", to: "/ai/analises", icon: Film, requires: "ai:read" },
    { key: "ai-insights", label: "Insights", to: "/ai/insights", icon: Sparkle, requires: "ai:read" },
    { key: "ai-development", label: "Desenvolvimento", to: "/ai/desenvolvimento", icon: Activity, requires: "ai:read", beta: true },
    { key: "ai-opponents", label: "Adversários", to: "/ai/adversarios", icon: Target, requires: "ai:read", beta: true },
  ],
};

export const NAV_CATALOG: NavGroup[] = [
  {
    items: [{ key: "overview", label: "Visão geral", to: "/", icon: LayoutGrid, requires: "academy:read" }],
  },
  {
    label: "Pessoas",
    items: [
      { key: "athletes", label: "Atletas", to: "/atletas", icon: Users, requires: "athlete:read" },
      { key: "families", label: "Famílias", to: "/familias", icon: Home, requires: "family:read" },
      { key: "teams", label: "Equipas", to: "/equipas", icon: Shield, requires: "team:read" },
      { key: "staff", label: "Staff", to: "/staff", icon: Whistle, requires: "staff:read" },
      // Logo a seguir ao staff: um sócio é o terceiro vínculo com o clube, e o
      // único que não passa por treinar ninguém.
      { key: "members", label: "Sócios", to: "/socios", icon: IdCard, requires: "member:read" },
    ],
  },
  {
    label: "Operação",
    items: [
      { key: "calendar", label: "Calendário", to: "/calendario", icon: CalendarDays, requires: "calendar:read" },
      {
        // "Presenças" e não "Treinos": o menu diz o que lá se faz, não o que se lá
        // vê. O calendário é que responde a "quando é o próximo treino".
        key: "attendance",
        label: "Presenças",
        to: "/presencas",
        icon: ClipboardCheck,
        requires: "attendance:read",
        badge: (c) => c.sessionsToRecord || undefined,
      },
      {
        /*
          Convocar exige `attendance:read` e não `calendar:read`.

          Parece um detalhe e não é: o departamento clínico e o de scouting têm
          calendário — precisam de saber quando é o treino de quem recupera, e
          quando joga o miúdo que estão a seguir — mas convocar não é trabalho de
          nenhum dos dois. Decidir quem joga é da mesma família que registar quem
          esteve, e é essa a permissão que separa as duas coisas.
        */
        key: "callups",
        label: "Convocatórias",
        to: "/convocatorias",
        icon: Megaphone,
        requires: "attendance:read",
        badge: (c) => c.callUpsToSubmit || undefined,
      },
    ],
  },
  /*
    Área técnica — o produto de futebol dentro da Academias.

    Grupo próprio, a seguir a Operação: a Operação é o dia administrativo do
    clube (marcar, registar, convocar); isto é o trabalho de conteúdo do
    treinador — planear o treino, desenhar exercícios, escrever o modelo de
    jogo. **Jogos** mudou-se para cá: um jogo pertence à semana de treino, não
    à secretaria — e o `calendar:read` que o guarda faz o grupo aparecer, só
    com ele lá dentro, ao clínico e ao scouting, que continuam a precisar de
    saber quando se joga.
  */
  {
    label: "Área técnica",
    items: [
      { key: "training", label: "Treinos", to: "/treinos", icon: Dumbbell, requires: "training:read" },
      {
        /*
          Jogos pede `calendar:read` e não `attendance:read`.

          É a diferença entre ver e registar, e são pessoas diferentes: o
          departamento clínico quer saber quando joga o miúdo que está a
          recuperar, e o de scouting quer ver o jogo do que anda a seguir —
          nenhum dos dois preenche fichas. Quem preenche precisa de
          `attendance:write`, e é o serviço que o exige, não este menu.
        */
        key: "matches",
        label: "Jogos",
        to: "/jogos",
        icon: Trophy,
        requires: "calendar:read",
        badge: (c) => c.matchesToFill || undefined,
      },
      /*
        Exercícios, Modelos de jogo e Bolas paradas deixaram de ser três menus
        soltos: vivem dentro de cada modalidade, e o que aparece aqui é um
        item por modalidade com área técnica — ver `dynamic` e `navFor`. O
        ícone e o rótulo deste item só se vêem no editor de cargos.
      */
      { key: "sports", label: "Modalidades (área técnica)", to: "/modalidades", icon: Shapes, requires: "training:read", dynamic: "sports" },
    ],
  },
    {
    label: "Gestão",
    items: [
      {
        key: "fees",
        label: "Mensalidades",
        to: "/mensalidades",
        icon: Receipt,
        requires: "billing:read",
        badge: (c) => c.overdueFees || undefined,
      },
      /*
        As contas do clube — saldo, movimentos, orçamento. Ao lado das
        mensalidades porque é a mesma conversa (dinheiro), mas com permissão
        própria: quem lança mensalidades nem sempre pode ver o saldo do clube.
      */
      { key: "finance", label: "Contas", to: "/contas", icon: Wallet, requires: "finance:read" },
      {
        key: "comms",
        label: "Comunicação",
        to: "/comunicacao",
        icon: Megaphone,
        requires: "comms:read",
        badge: (c) => c.unreadThreads || undefined,
      },
      /*
        O armazém, em Gestão e não numa área própria.
 
        É gestão do clube como as mensalidades e a comunicação — material que se
        compra, entrega e recebe de volta. Uma área nova no topo dizia que é
        maior do que é, e quem entra na consola não vem para aqui todos os dias.
      */
      { key: "inventory", label: "Inventário", to: "/inventario", icon: Boxes, requires: "inventory:read" },
    ],
  },
  {
    label: "Desenvolvimento",
    items: [
      {
        key: "evaluations",
        label: "Avaliações",
        to: "/avaliacoes",
        icon: Gauge,
        requires: "evaluation:read",
        badge: (c) => c.pendingEvaluations || undefined,
      },
      { key: "reports", label: "Relatórios", to: "/relatorios", icon: FileText, requires: "report:read" },
    ],
  },
  /*
    Scouting.

    Grupo próprio e não uma entrada em "Pessoas": um prospecto **não é** uma
    pessoa da academia, e arrumá-lo ao lado de Atletas e Famílias era a primeira
    forma de os confundir.

    Sem "Visão geral": para quem trabalha em scouting ela **é** a página inicial
    (ver `Overview` em `App.tsx`), e um item de menu que repete o logótipo é um
    item a mais. As shortlists também saíram — continuam a existir e abrem-se a
    partir da ficha de cada prospecto, mas não são um destino por onde se comece.

    "Pedidos" é a única entrada que um treinador vê: exige `scouting:request`, não
    `scouting:read`. É a porta para ele dizer o que lhe falta sem lhe abrir os
    dossiês de miúdos de outros clubes.
  */
  {
    label: "Scouting",
    items: [
      { key: "scouting-prospects", label: "Prospects", to: "/scouting/prospects", icon: Eye, requires: "scouting:read" },
      { key: "scouting-observations", label: "Observações", to: "/scouting/observacoes", icon: Binoculars, requires: "scouting:read" },
      { key: "scouting-requests", label: "Pedidos", to: "/scouting/pedidos", icon: Send, requires: "scouting:request" },
    ],
  },
  {
    label: "Clínico",
    items: [
      {
        key: "clinical",
        label: "Boletins",
        to: "/clinico",
        icon: HeartPulse,
        requires: "clinical:read",
        badge: (c) => c.athletesOut || undefined,
      },
      { key: "consultations", label: "Consultas", to: "/clinico/consultas", icon: Stethoscope, requires: "clinical:read" },
    ],
  },
  ...(import.meta.env.DEV ? [GRUPO_AI] : []),
];

export const SETTINGS_ITEM: NavItem = {
  key: "settings",
  label: "Definições",
  to: "/definicoes",
  icon: Settings,
  requires: "settings:write",
};

/** Todos os destinos configuráveis, achatados — é o que o editor de papéis mostra. */
export const NAV_ITEMS: NavItem[] = NAV_CATALOG.flatMap((g) => g.items);

/**
 * A navegação desta pessoa.
 *
 * Derivada das permissões e depois estreitada pelos menus do papel. Um treinador
 * a quem a direção conceda `billing:read` passa a ver Mensalidades sem alterações
 * de código — e continua a passar, agora também sem alterações de configuração.
 */
export function navFor(session: Session): NavGroup[] {
  const perms = permissionsOf(session);
  const chosen = session.navKeys?.length ? new Set(session.navKeys) : null;

  return NAV_CATALOG.map((group) => ({
    ...group,
    items: group.items
      .filter((i) => perms.has(i.requires) && (!chosen || chosen.has(i.key)))
      .flatMap((i) => (i.dynamic === "sports" ? sportItems(i) : [i])),
  })).filter((group) => group.items.length > 0);
}

/**
 * Um item por modalidade com área técnica.
 *
 * A chave leva o id da modalidade para as listas não terem chaves repetidas;
 * a chave de **configuração** (a que o cargo guarda) continua a ser a do item
 * do catálogo, e já foi verificada antes de se chegar aqui.
 */
function sportItems(item: NavItem): NavItem[] {
  return profiledSports().map((sport) => ({
    ...item,
    key: `${item.key}:${sport.id}`,
    label: sport.name,
    to: sportPath(sport.id),
    icon: profileOf(sport)!.icon,
    dynamic: undefined,
  }));
}

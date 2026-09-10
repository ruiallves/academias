/**
 * Um sítio só para ícones.
 *
 * Reexportamos com nomes do nosso domínio ("Whistle" para treinadores) em vez de
 * espalhar nomes da biblioteca pelo código. Trocar de biblioteca — ou desenhar os
 * nossos — passa a ser editar este ficheiro.
 *
 * Traço: 1.5px em toda a app (ver <Icon>), para casar com as hairlines de 1px.
 */
export {
  SquarePen as Pencil,
  LayoutGrid,
  Users,
  Home,
  Shield,
  UserRound as Whistle,
  CalendarDays,
  ClipboardCheck,
  Receipt,
  Megaphone,
  Gauge,
  FileText,
  Settings,
  Search,
  /* Scouting: o binóculo é a área, o olho é a observação. */
  Binoculars,
  Eye,
  /* Sócios: o cartão é o que o clube emite e o sócio guarda. */
  IdCard,
  /* A categoria de sócio — a etiqueta que lhe diz o preço da quota. */
  Tags as Tag,
  Clapperboard as Film,
  Bell,
  Plus,
  Check,
  Copy,
  X,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  ChevronsUpDown,
  ArrowRight,
  ArrowUpRight,
  TrendingUp,
  TrendingDown,
  MoreHorizontal,
  Clock,
  MapPin,
  Mail,
  Phone,
  CreditCard,
  Wallet,
  Download,
  Upload,
  FileSpreadsheet,
  /* A convocatória em papel — a folha que se leva para o campo. */
  Printer,
  SlidersHorizontal,
  LogOut,
  PanelLeft,
  Send,
  CircleCheck,
  TriangleAlert,
  Sparkle,
  Ban,
  Trash2,
  Link2,
  RefreshCw,
  Repeat,
  ExternalLink,
  Loader2,
  Trophy,
  /* Ficha de jogo: o menos fecha o par com o Plus nos contadores. */
  Minus,
  HeartPulse,
  ArrowLeft,
  Ruler,
  Weight,
  Footprints,
  Cake,
  Timer,
  Star,
  Camera,
  Lock,
  Stethoscope,
  Apple,
  Brain,
  Activity,
  /* Academias AI: o alvo é a análise de adversários. */
  Target,
  /* Área técnica: o haltere é o treino, as formas são a biblioteca de
     exercícios, a rede é o modelo de jogo, a baliza são as bolas paradas. */
  Dumbbell,
  Shapes,
  Network,
  Goal,
  Play,
  Pause,
  /* Editor tático: a mão arrasta a vista, as setas circulares rodam o objeto. */
  Hand,
  RotateCw,
  RotateCcw,
  /* Inventário: as caixas são o armazém, a caixa aberta é a entrega, e a seta
     de volta é a devolução. */
  Boxes,
  PackageOpen,
  Undo2,
  /* O manípulo de arrasto de uma lista: três linhas, a convenção de sempre. */
  Menu as DragHandle,
  type LucideIcon,
} from "lucide-react";

/* -------------------------------------------------------------------------- */
/* As modalidades                                                              */
/* -------------------------------------------------------------------------- */

import { createLucideIcon, Goal as GoalIcon } from "lucide-react";

/**
 * A bola de futebol e a de basquetebol, desenhadas na gramática da biblioteca
 * (viewBox 24, traço 2, cantos redondos) para se sentarem ao lado das outras no
 * menu sem parecer que vieram de outro sítio. O futsal usa a baliza (`Goal`),
 * que já existia: é o pavilhão de que o futsal é o jogo.
 */
export const Football = createLucideIcon("Football", [
  ["circle", { cx: "12", cy: "12", r: "10", key: "c" }],
  ["path", { d: "M12 7l4.2 3-1.6 5H9.4L7.8 10z", key: "p" }],
  ["path", { d: "M12 2v5M7.8 10 3.5 8.6M16.2 10l4.3-1.4M9.4 15l-2.7 3.9M14.6 15l2.7 3.9", key: "s" }],
]);

export const Basketball = createLucideIcon("Basketball", [
  ["circle", { cx: "12", cy: "12", r: "10", key: "c" }],
  ["path", { d: "M4.9 4.9a10 10 0 0 0 14.2 14.2M19.1 4.9A10 10 0 0 0 4.9 19.1", key: "a" }],
  ["path", { d: "M2 12h20M12 2v20", key: "x" }],
]);

export const Futsal = GoalIcon;

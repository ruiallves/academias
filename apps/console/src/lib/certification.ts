import { apiDelete, apiGet, apiPut } from "@/lib/http";

/**
 * A Certificação FPF, do lado do cliente.
 *
 * Tipos e chamadas, sem estado e **sem contas**: o nível, os tetos, os pontos e
 * o estado de cada requisito vêm todos calculados do servidor
 * (`apps/api/src/certification`). O que decide o nível de um clube tem um
 * sítio só — duas implementações do fluxograma da FPF era a garantia de um dia
 * darem níveis diferentes.
 *
 * Cada escrita devolve o resumo inteiro já recalculado, e a página troca-o
 * pelo que tinha. Não há nada para fundir nem para invalidar.
 */

/** A partir de que patamar um requisito é obrigatório. */
export type Tier = "C" | "E" | "T" | "Q";

export const TIER_LABEL: Record<Tier, string> = { C: "CBFF", E: "1 e 2★", T: "3★", Q: "4 e 5★" };

export const TIER_LONG: Record<Tier, string> = {
  C: "Obrigatório desde o CBFF",
  E: "Obrigatório a partir de 1 estrela",
  T: "Obrigatório a partir das 3 estrelas",
  Q: "Obrigatório para as 4 e 5 estrelas",
};

export type Status = "met" | "partial" | "missing" | "assessor" | "na";

export const STATUS_LABEL: Record<Status, string> = {
  met: "Cumprido",
  partial: "Parcial",
  missing: "Em falta",
  assessor: "Do avaliador",
  na: "Não se aplica",
};

export type Mode = "data" | "document" | "declaration" | "assessor";

/** Com que se responde a um requisito. Lê-se a seguir a "responde-se com…". */
export const MODE_LABEL: Record<Mode, string> = {
  data: "Dados da plataforma",
  document: "Um documento",
  declaration: "Uma declaração do clube",
  assessor: "A avaliação da FPF",
};

/** As áreas da plataforma de onde uma resposta vem, e onde se resolve. */
export const SOURCE: Record<string, { label: string; to?: string }> = {
  teams: { label: "Equipas e atletas", to: "/equipas" },
  staff: { label: "Staff", to: "/staff" },
  training: { label: "Planeamento", to: "/treinos" },
  matches: { label: "Jogos", to: "/jogos" },
  evaluations: { label: "Avaliações", to: "/avaliacoes" },
  clinical: { label: "Clínico", to: "/clinico" },
  school: { label: "Escola" },
  scouting: { label: "Scouting", to: "/scouting/prospects" },
  finance: { label: "Contas", to: "/contas/orcamento" },
  calendar: { label: "Calendário", to: "/calendario" },
  "club-app": { label: "App do clube" },
  "training-actions": { label: "Formações" },
  facilities: { label: "Instalações" },
  pathway: { label: "Percurso" },
  documents: { label: "Documentos do clube" },
  declaration: { label: "Declaração" },
  assessor: { label: "Avaliador da FPF" },
};

export type Level = { id: number; name: string; short: string; stars: number };

export type Profile = {
  hasSenior: boolean;
  recruits: boolean;
  hasDre: boolean;
  nonNationals: boolean;
  nationalLast5: boolean;
  islands: boolean;
  lowDensity: boolean;
};

export type Requirement = {
  code: string;
  criterion: number;
  group: string;
  text: string;
  mode: Mode;
  source: string;
  evidence: string | null;
  note: string | null;
  condition: "dre" | "nn" | "rec" | "sen" | null;
  mandatory: Tier | null;
  tiers: { label: string; points: number; mandatory: Tier | null }[] | null;
  /** O máximo que vale a este clube. */
  points: number;
  earned: number;
  /** `1`/`0`, ou o índice do patamar (`-1` nenhum). */
  value: number;
  status: Status;
  /** De onde vem o valor: resposta de alguém, cálculo da plataforma, ou nada ainda. */
  origin: "answer" | "auto" | "none";
  /** Trava a subida ao nível seguinte. */
  blocking: boolean;
  /** Os patamares em que é obrigatório, e se cada um já está cumprido. */
  levels: { tier: Tier; met: boolean }[];
  auto: { value: number; detail: string; progress?: { got: number; of: number } } | null;
  answer: { value: number; note: string | null; by: string | null; at: string } | null;
};

export type Summary = {
  available: true;
  catalog: { key: string; title: string; manual: string; season: string };
  canWrite: boolean;
  profile: Profile;
  profileSet: boolean;
  teams: { id: string; name: string; maxAge: number; athletes: number; gender: "MALE" | "FEMALE" | "MIXED" | null }[];
  level: Level;
  /** Até onde cada verificação deixa chegar, em estrelas. `-1` nem CBFF, `0` CBFF. */
  ceilings: { access: number; mandatory: number; points: number };
  points: { got: number; max: number; assessor: number; notApplicable: number };
  mandatory: Record<Tier, { total: number; missing: number }>;
  access: {
    squads: { age: number; athletes: number; need: number; ok: boolean }[];
    senior: { ok: boolean; athletes: number };
    women: { teams: number; players: number; ok: boolean };
    national: boolean;
    missing: string[];
  };
  next: { target: Level; accessOk: boolean; mandatory: string[]; points: number; needPoints: number } | null;
  quickWins: { code: string; gain: number }[];
  criteria: { criterion: number; name: string; max: number; got: number; reach: number; total: number; missing: number; blocking: number }[];
  groups: Record<string, string>;
  requirements: Requirement[];
};

export type Unavailable = { available: false; reason: string };

export const getCertification = () => apiGet<Summary | Unavailable>("/api/certification");

export const saveProfile = (profile: Profile) => apiPut<Summary>("/api/certification/profile", profile);

export const answerRequirement = (code: string, value: number) =>
  apiPut<Summary>(`/api/certification/answers/${encodeURIComponent(code)}`, { value });

/** Apagar a resposta devolve o requisito ao cálculo da plataforma. */
export const clearAnswer = (code: string) => apiDelete<Summary>(`/api/certification/answers/${encodeURIComponent(code)}`);

/**
 * Os níveis, para filtrar os requisitos pelo que cada um pede.
 *
 * `tiers` é tudo o que o nível exige, com os de baixo; `adds` é o patamar que
 * ele acrescenta ao anterior. As 2 e as 5 estrelas não acrescentam requisitos
 * nenhuns: pedem os mesmos da 1 e das 4, e mais pontos (as 5, também equipas).
 * A frase diz o resto que o nível pede e que não é um requisito da lista.
 */
export const LEVELS: { value: string; label: string; tiers: Tier[]; adds: Tier | null; also: string }[] = [
  { value: "0", label: "CBFF", tiers: ["C"], adds: "C", also: "O CBFF não pede equipas nem pontos." },
  { value: "1", label: "1 estrela", tiers: ["C", "E"], adds: "E", also: "Pede também 3 escalões de formação com equipa." },
  { value: "2", label: "2 estrelas", tiers: ["C", "E"], adds: null, also: "Pede também 3 escalões de formação com equipa e 50 pontos." },
  { value: "3", label: "3 estrelas", tiers: ["C", "E", "T"], adds: "T", also: "Pede também 4 escalões de formação com equipa e 50 pontos." },
  { value: "4", label: "4 estrelas", tiers: ["C", "E", "T", "Q"], adds: "Q", also: "Pede também equipa sénior, os sete escalões de formação e 80 pontos." },
  {
    value: "5",
    label: "5 estrelas",
    tiers: ["C", "E", "T", "Q"],
    adds: null,
    also: "Pede também equipa sénior, os sete escalões, futebol feminino, provas nacionais numa das últimas 5 épocas e 90 pontos.",
  },
];

/** Pontos como o manual os escreve: vírgula, e sem zeros a mais. */
export const pts = (n: number) => n.toLocaleString("pt-PT", { maximumFractionDigits: 2 });

/** "3 estrelas", "1 estrela", "CBFF". */
export function ceilingLabel(stars: number): string {
  if (stars >= 1) return `${stars} ${stars === 1 ? "estrela" : "estrelas"}`;
  return stars === 0 ? "CBFF" : "Sem certificação";
}

export function levelTitle(level: Level): string {
  return level.stars > 0 ? `${level.name} · ${level.short}` : level.id === 0 ? "Reconhecido como CBFF" : "Ainda sem certificação";
}

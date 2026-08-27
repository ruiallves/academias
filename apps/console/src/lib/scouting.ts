import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/http";
import { categoryColor } from "@academia/ui/tokens";

/**
 * A fronteira de dados do scouting.
 *
 * Ao contrário do resto da consola, isto **não** entra no bootstrap. O `lib/store`
 * carrega a academia inteira ao arrancar porque uma academia são umas centenas de
 * linhas e cabe toda; um departamento de scouting a trabalhar acumula milhares de
 * prospectos e de observações, e trazê-los todos para dentro do browser à entrada
 * seria pagar por uma área que a maior parte das pessoas nem abre.
 *
 * Cada ecrã pede o que precisa. É a excepção deliberada à regra da casa, e a razão
 * está escrita aqui para não parecer distracção.
 */

export type Stage = "DISCOVERED" | "WATCHING" | "OBSERVED" | "TRIAL" | "RECRUITED" | "REJECTED";

export type Recommendation =
  | "DROP"
  | "KEEP_WATCHING"
  | "OBSERVE_AGAIN"
  | "INVITE_TRAINING"
  | "SHORTLIST"
  | "RECRUIT";

export type ObsContext = "MATCH" | "TRAINING" | "TRIAL" | "VIDEO" | "OTHER";

/**
 * O funil, por palavras da casa.
 *
 * Seis estados, cada um com um facto por trás. "Interessante", "Shortlist" e
 * "Decisão" existiam e saíram: descreviam graus de entusiasmo, não passos — e um
 * estado sem critério claro de entrada é um estado que cada pessoa preenche à sua
 * maneira, até o funil deixar de significar nada.
 *
 * "Descartado" fica à parte no fim: é terminal, mas reversível — um miúdo
 * descartado aos 13 volta a interessar aos 15, e o produto não finge que ele nunca
 * existiu.
 */
export const STAGE_LABEL: Record<Stage, string> = {
  DISCOVERED: "Descoberto",
  WATCHING: "A acompanhar",
  OBSERVED: "Observado",
  TRIAL: "Trial",
  RECRUITED: "Recrutado",
  REJECTED: "Descartado",
};

/**
 * A cor de cada fase do funil.
 *
 * ## Porque é que não deriva da cor do clube
 *
 * Derivava: cada fase era `color-mix(--color-signal, white, 25% + i*14%)`, cinco
 * tons da mesma cor. Duas coisas más de uma vez:
 *
 *  1. **Num clube amarelo saem cinco amarelos** que ninguém distingue — e o
 *     mesmo vale para qualquer matiz clara. A escala só funcionava com cores
 *     escuras, que é meia amostra dos clubes.
 *  2. **A cor do clube é identidade, não taxonomia.** Aqui não se está a dizer
 *     "isto é do clube X" — está-se a distinguir cinco etapas umas das outras.
 *     É a mesma regra que já tirou a cor do clube do menu lateral.
 *
 * A paleta categórica de `@academia/ui` existe exactamente para isto: matizes
 * escolhidas longe do verde-de-pago, do âmbar-de-aviso e do vermelho-de-erro,
 * com saturação baixa. As cinco andam para a frente na paleta, por isso o funil
 * lê-se da esquerda para a direita como uma progressão e não como cinco cores ao
 * acaso.
 *
 * Vive aqui, ao pé de `STAGE_LABEL`, porque é vocabulário do domínio e é lido em
 * dois ecrãs — a Visão geral do scouting e a ficha do prospecto. Duas cópias
 * divergiam, e uma legenda que não bate certo com o gráfico é pior do que não
 * ter legenda.
 *
 * `REJECTED` não entra: não é uma fase do funil, é a saída dele.
 */
const STAGE_COLOR: Record<Exclude<Stage, "REJECTED">, string> = {
  DISCOVERED: categoryColor(4).base, // slate — ainda é só um nome numa lista
  WATCHING: categoryColor(5).base, // cyan
  OBSERVED: categoryColor(1).base, // indigo
  TRIAL: categoryColor(2).base, // violet
  RECRUITED: categoryColor(0).base, // teal — o fim do funil, a cor mais viva
};

/** A cor de uma fase, com saída segura para um estado que ainda não exista. */
export function stageColor(stage: Stage): string {
  return STAGE_COLOR[stage as Exclude<Stage, "REJECTED">] ?? "var(--color-ink-4)";
}

export const STAGE_ORDER: Stage[] = [
  "DISCOVERED",
  "WATCHING",
  "OBSERVED",
  "TRIAL",
  "RECRUITED",
  "REJECTED",
];

export const RECOMMENDATION_LABEL: Record<Recommendation, string> = {
  DROP: "Não avançar",
  KEEP_WATCHING: "Continuar a acompanhar",
  OBSERVE_AGAIN: "Nova observação",
  INVITE_TRAINING: "Convidar para treino",
  SHORTLIST: "Pôr em shortlist",
  RECRUIT: "Avançar para recrutamento",
};

export const CONTEXT_LABEL: Record<ObsContext, string> = {
  MATCH: "Jogo",
  TRAINING: "Treino",
  TRIAL: "Trial",
  VIDEO: "Vídeo",
  OTHER: "Outro",
};

/* -------------------------------------------------------------------------- */

export type Overview = {
  stages: { stage: Stage; count: number }[];
  total: number;
  awaitingDecision: {
    id: string;
    name: string;
    stage: Stage;
    position: string | null;
    lastObservedAt: string | null;
    waitingSince: string;
    owner: string | null;
    observations: number;
  }[];
  goingCold: {
    id: string;
    name: string;
    stage: Stage;
    position: string | null;
    lastObservedAt: string | null;
    since: string;
    owner: string | null;
  }[];
  activity: {
    id: string;
    prospectId: string;
    prospectName: string;
    scout: string | null;
    observedAt: string;
    context: ObsContext;
    recommendation: Recommendation;
  }[];
};

export type ProspectRow = {
  id: string;
  name: string;
  birthdate: string;
  stage: Stage;
  position: string | null;
  currentClub: string | null;
  currentTeam: string | null;
  sportId: string;
  lastObservedAt: string | null;
  ownerId: string | null;
  owner: string | null;
  observations: number;
};

export type Observation = {
  id: string;
  observedAt: string;
  context: ObsContext;
  opponent: string | null;
  competition: string | null;
  venue: string | null;
  minutesObserved: number | null;
  positionObserved: string | null;
  strengths: string[];
  improvements: string[];
  notes: string | null;
  recommendation: Recommendation;
  scout: string | null;
  ratings: { criterionId: string; score: number }[];
};

export type ProspectDetail = {
  id: string;
  name: string;
  birthdate: string;
  stage: Stage;
  sportId: string;
  position: string | null;
  secondaryPositions: string[];
  dominantSide: string | null;
  currentClub: string | null;
  currentTeam: string | null;
  discoveredVia: string | null;
  discoveredAt: string;
  lastObservedAt: string | null;
  notes: string | null;
  athleteId: string | null;
  archivedAt: string | null;
  ownerId: string | null;
  owner: string | null;
  observations: Observation[];
  events: { id: string; kind: string; from: string | null; to: string | null; note: string | null; at: string; actor: string | null }[];
  /** Encaixe com o clube, por dimensão. Vem com o dossiê. */
  fit: { dimensionId: string; value: number }[];
  shortlists: { id: string; shortlist: { id: string; name: string } }[];
};

export type ObservationRow = {
  id: string;
  observedAt: string;
  context: ObsContext;
  opponent: string | null;
  competition: string | null;
  minutesObserved: number | null;
  recommendation: Recommendation;
  strengths: string[];
  improvements: string[];
  notes: string | null;
  prospect: { id: string; name: string; position: string | null; stage: Stage };
  scoutId: string | null;
  scout: string | null;
};

export type Criterion = { id: string; group: string; name: string; order: number };

/* -------------------------------------------------------------------------- */

export const getOverview = () => apiGet<Overview>("/api/scouting/overview");

export const listProspects = (filters: { stage?: string; sportId?: string; q?: string } = {}) =>
  apiGet<ProspectRow[]>("/api/scouting/prospects", filters);

export const getProspect = (id: string) => apiGet<ProspectDetail>(`/api/scouting/prospects/${id}`);

export const createProspect = (body: Record<string, unknown>) =>
  apiPost<{ id: string; name: string }>("/api/scouting/prospects", body);

export const updateProspect = (id: string, body: Record<string, unknown>) =>
  apiPatch(`/api/scouting/prospects/${id}`, body);

export const setStage = (id: string, stage: Stage, note?: string) =>
  apiPost(`/api/scouting/prospects/${id}/stage`, { stage, ...(note ? { note } : {}) });

export const addObservation = (id: string, body: Record<string, unknown>) =>
  apiPost<{ id: string; suggestedStage: Stage }>(`/api/scouting/prospects/${id}/observations`, body);

export const getCriteria = (sportId: string) => apiGet<Criterion[]>("/api/scouting/criteria", { sportId });

export const listObservations = (filters: { scoutId?: string; days?: string } = {}) =>
  apiGet<ObservationRow[]>("/api/scouting/observations", filters);

/* -------------------------------------------------------------------------- */

/** Idade a partir da data de nascimento — o campo por que um scout procura. */
export function ageOf(birthdate: string, now = new Date()): number {
  const b = new Date(birthdate);
  let age = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--;
  return age;
}

/** "há 3 dias", "há 2 meses" — dias soltos não dizem nada a quem gere um funil. */
export function sinceLabel(iso: string | null): string {
  if (!iso) return "nunca";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "hoje";
  if (days === 1) return "ontem";
  if (days < 30) return `há ${days} dias`;
  const months = Math.floor(days / 30);
  return months === 1 ? "há 1 mês" : `há ${months} meses`;
}

/* -------------------------------------------------------------------------- */
/* Shortlists                                                                 */
/* -------------------------------------------------------------------------- */

export type ShortlistRow = {
  id: string;
  name: string;
  description: string | null;
  sportId: string | null;
  ageGroup: string | null;
  profile: string | null;
  createdBy: string | null;
  count: number;
};

export type ShortlistEntry = {
  id: string;
  note: string | null;
  rank: number;
  prospect: {
    id: string;
    name: string;
    birthdate: string;
    stage: Stage;
    position: string | null;
    currentClub: string | null;
    sportId: string;
    lastObservedAt: string | null;
    owner: string | null;
    lastRecommendation: Recommendation | null;
    fit: { dimensionId: string; value: number }[];
  };
};

export type ShortlistDetail = {
  id: string;
  name: string;
  description: string | null;
  sportId: string | null;
  ageGroup: string | null;
  profile: string | null;
  entries: ShortlistEntry[];
};

export const listShortlists = () => apiGet<ShortlistRow[]>("/api/scouting/shortlists");
export const getShortlist = (id: string) => apiGet<ShortlistDetail>(`/api/scouting/shortlists/${id}`);
export const createShortlist = (body: Record<string, unknown>) =>
  apiPost<{ id: string; name: string }>("/api/scouting/shortlists", body);
export const addToShortlist = (id: string, prospectId: string, note?: string) =>
  apiPost(`/api/scouting/shortlists/${id}/entries`, { prospectId, ...(note ? { note } : {}) });
export const removeFromShortlist = (entryId: string) => apiDelete(`/api/scouting/shortlist-entries/${entryId}`);

/* -------------------------------------------------------------------------- */
/* Comparação e fit                                                           */
/* -------------------------------------------------------------------------- */

export type Comparison = {
  criteria: { id: string; group: string; name: string }[];
  dimensions: { id: string; name: string }[];
  prospects: {
    id: string;
    name: string;
    birthdate: string;
    position: string | null;
    stage: Stage;
    currentClub: string | null;
    lastObservedAt: string | null;
    /** Média por critério. `null` = sem dados, nunca zero. */
    ratings: Record<string, number | null>;
    fit: Record<string, number | null>;
  }[];
};

export type FitDimension = { id: string; name: string; order: number; sportId: string | null };

export const compare = (ids: string[]) => apiGet<Comparison>("/api/scouting/compare", { ids: ids.join(",") });
export const getFitDimensions = (sportId?: string) =>
  apiGet<FitDimension[]>("/api/scouting/fit-dimensions", sportId ? { sportId } : {});
export const setFit = (prospectId: string, scores: { dimensionId: string; value: number }[]) =>
  apiPost(`/api/scouting/prospects/${prospectId}/fit`, { scores });

/* -------------------------------------------------------------------------- */
/* Pedidos                                                                    */
/* -------------------------------------------------------------------------- */

export type Urgency = "LOW" | "NORMAL" | "HIGH" | "CRITICAL";
export type ReqStatus = "OPEN" | "IN_PROGRESS" | "FULFILLED" | "CANCELLED";

export const URGENCY_LABEL: Record<Urgency, string> = {
  LOW: "Baixa",
  NORMAL: "Normal",
  HIGH: "Alta",
  CRITICAL: "Crítica",
};

export const REQ_STATUS_LABEL: Record<ReqStatus, string> = {
  OPEN: "Por começar",
  IN_PROGRESS: "Em curso",
  FULFILLED: "Resolvido",
  CANCELLED: "Cancelado",
};

export type ScoutingRequest = {
  id: string;
  title: string;
  sportId: string | null;
  ageGroup: string | null;
  position: string | null;
  profile: string | null;
  traits: string[];
  urgency: Urgency;
  status: ReqStatus;
  dueDate: string | null;
  createdAt: string;
  requestedBy: string | null;
  assignedTo: string | null;
  candidates: {
    id: string;
    note: string | null;
    prospect: { id: string; name: string; stage: Stage; position: string | null };
  }[];
};

export const listRequests = (status?: string) =>
  apiGet<ScoutingRequest[]>("/api/scouting/requests", status ? { status } : {});
export const createRequest = (body: Record<string, unknown>) =>
  apiPost<{ id: string; title: string }>("/api/scouting/requests", body);
export const updateRequest = (id: string, body: Record<string, unknown>) =>
  apiPatch(`/api/scouting/requests/${id}`, body);
export const addCandidate = (id: string, prospectId: string, note?: string) =>
  apiPost(`/api/scouting/requests/${id}/candidates`, { prospectId, ...(note ? { note } : {}) });

/* -------------------------------------------------------------------------- */
/* Vídeo                                                                      */
/* -------------------------------------------------------------------------- */

export type VideoKind = "MATCH" | "TRAINING" | "TRIAL" | "OTHER";
export type MomentKind = "HIGHLIGHT" | "CONCERN" | "NOTE";

export const VIDEO_KIND_LABEL: Record<VideoKind, string> = {
  MATCH: "Jogo",
  TRAINING: "Treino",
  TRIAL: "Trial",
  OTHER: "Outro",
};

export const MOMENT_KIND_LABEL: Record<MomentKind, string> = {
  HIGHLIGHT: "Destaque",
  CONCERN: "Preocupa",
  NOTE: "Nota",
};

export type VideoMoment = {
  id: string;
  atSec: number;
  kind: MomentKind;
  label: string;
  createdBy: string | null;
};

export type Video = {
  id: string;
  title: string;
  kind: VideoKind;
  recordedOn: string | null;
  competition: string | null;
  opponent: string | null;
  durationSec: number | null;
  notes: string | null;
  tags: string[];
  status: "UPLOADING" | "READY" | "FAILED";
  sizeBytes: number | null;
  createdAt: string;
  observationId: string | null;
  uploadedBy: string | null;
  moments: VideoMoment[];
};

export const listVideos = (prospectId: string) => apiGet<Video[]>(`/api/scouting/prospects/${prospectId}/videos`);

export const startUpload = (prospectId: string, body: Record<string, unknown>) =>
  apiPost<{ id: string; storageKey: string; uploadUrl: string; token: string }>(
    `/api/scouting/prospects/${prospectId}/videos`,
    body,
  );

export const completeUpload = (videoId: string, durationSec?: number) =>
  apiPost(`/api/scouting/videos/${videoId}/complete`, durationSec ? { durationSec } : {});

export const playbackUrl = (videoId: string) =>
  apiGet<{ url: string; expiresIn: number }>(`/api/scouting/videos/${videoId}/playback`);

export const deleteVideo = (videoId: string) => apiDelete(`/api/scouting/videos/${videoId}`);

export const addMoment = (videoId: string, body: { atSec: number; kind?: MomentKind; label: string }) =>
  apiPost<{ id: string }>(`/api/scouting/videos/${videoId}/moments`, body);

export const removeMoment = (momentId: string) => apiDelete(`/api/scouting/moments/${momentId}`);

/* -------------------------------------------------------------------------- */
/* Recrutamento                                                               */
/* -------------------------------------------------------------------------- */

export const recruit = (prospectId: string, body: Record<string, unknown>) =>
  apiPost<{ athleteId: string; name: string }>(`/api/scouting/prospects/${prospectId}/recruit`, body);

export type AthleteDossier = {
  prospectId: string;
  discoveredAt: string;
  discoveredVia: string | null;
  owner: string | null;
  observations: number;
  videos: number;
};

export const athleteDossier = (athleteId: string) =>
  apiGet<AthleteDossier | null>(`/api/scouting/athletes/${athleteId}/dossier`);

/* -------------------------------------------------------------------------- */

/**
 * `00:42` — o código de tempo de um momento.
 *
 * Sempre em monoespaçado na interface: são números que se comparam em coluna, e
 * uma fonte proporcional fá-los dançar de linha para linha.
 */
export function timecode(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(sec).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/http";

/**
 * A fronteira de dados da Academias AI.
 *
 * Como o scouting: **não** entra no bootstrap. Uma análise de vídeo é pesada e
 * é de quem trabalha nela — carregar isto ao arrancar a consola seria pagar em
 * todas as sessões o que só algumas usam. Cada ecrã pede o que precisa.
 *
 * ## A regra que atravessa a área inteira
 *
 * Tudo o que vem daqui traz **confidence**. A interface nunca esconde um número
 * baixo — mostra-o e oferece a correção. Fingir precisão seria pior do que não
 * ter a funcionalidade.
 */

export type AnalysisStatus =
  | "DRAFT" | "UPLOADING" | "QUEUED" | "PROCESSING" | "REVIEW" | "COMPLETED" | "FAILED" | "CANCELLED";

export type AnalysisRow = {
  id: string;
  kind: string;
  title: string;
  opponent: string | null;
  competition: string | null;
  playedOn: string | null;
  status: AnalysisStatus;
  progress: number;
  /** Por dimensão, 0–1: { quality: {...}, player_tracking: 0.91, … }. */
  confidence: Record<string, unknown> | null;
  reviewCount: number;
  createdAt: string;
  completedAt: string | null;
  teamId: string;
  teamName: string;
  matchId: string | null;
};

export type SquadEntry = { athleteId: string; name?: string; jerseyNumber: number | null };

export type AnalysisVideo = {
  id: string;
  status: "UPLOADING" | "READY" | "FAILED";
  mimeType: string;
  sizeBytes: number | null;
  durationSec: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  quality: QualityReport | null;
  createdAt: string;
};

/** O relatório da verificação de qualidade, escrito pelo worker. */
export type QualityReport = {
  verdict?: "good" | "acceptable" | "poor";
  /** Viabilidade prevista por dimensão, 0–1. */
  feasibility?: Record<string, number>;
  /** As medições que justificam o veredicto (blur, luz, estabilidade…). */
  metrics?: Record<string, number>;
  notes?: string[];
};

export type AnalysisJob = {
  id: string;
  kind: string;
  status: "PENDING" | "CLAIMED" | "RUNNING" | "DONE" | "FAILED" | "CANCELLED";
  progress: number;
  attempts: number;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  modelVersions: Record<string, string> | null;
  createdAt: string;
};

export type Track = {
  id: string;
  trackNumber: number;
  side: string;
  jerseyNumber: number | null;
  athleteId: string | null;
  athleteName: string | null;
  identityConfidence: number | null;
  trackConfidence: number | null;
  firstMs: number;
  lastMs: number;
  frameCount: number;
  summary: Record<string, unknown> | null;
  status: "auto" | "corrected" | "merged" | "discarded";
};

export type AnalysisDetail = AnalysisRow & {
  failReason: string | null;
  createdBy: string | null;
  squad: SquadEntry[];
  videos: AnalysisVideo[];
  jobs: AnalysisJob[];
  tracks: Track[];
  eventCount: number;
  correctionCount: number;
};

export type Insight = {
  id: string;
  kind: string;
  text: string;
  confidence: number;
  data: Record<string, unknown> | null;
  createdAt: string;
  analysisId: string | null;
  athleteId: string | null;
  athleteName: string | null;
  teamId: string | null;
  teamName: string | null;
};

export type AiDashboard = {
  counts: { processing: number; completed: number; review: number; failed: number };
  recent: AnalysisRow[];
  insights: Insight[];
};

/* -------------------------------------------------------------------------- */
/* Pedidos                                                                     */
/* -------------------------------------------------------------------------- */

export const aiDashboard = () => apiGet<AiDashboard>("/api/ai/dashboard");
export const listAnalyses = () => apiGet<AnalysisRow[]>("/api/ai/analyses");
export const getAnalysis = (id: string) => apiGet<AnalysisDetail>(`/api/ai/analyses/${id}`);

export const createAnalysis = (body: {
  teamId: string;
  matchId?: string;
  title?: string;
  opponent?: string;
  competition?: string;
  playedOn?: string;
  squad: { athleteId: string; jerseyNumber?: number }[];
}) => apiPost<{ id: string }>("/api/ai/analyses", body);

export const updateSquad = (id: string, squad: { athleteId: string; jerseyNumber?: number }[]) =>
  apiPatch(`/api/ai/analyses/${id}/squad`, { squad });

export const deleteAnalysis = (id: string) => apiDelete(`/api/ai/analyses/${id}`);
export const requeueAnalysis = (id: string) => apiPost(`/api/ai/analyses/${id}/process`, {});

export const identifyTrack = (trackId: string, athleteId: string | null) =>
  apiPost(`/api/ai/tracks/${trackId}/identify`, { athleteId });

export const listInsights = () => apiGet<Insight[]>("/api/ai/insights");
export const dismissInsight = (id: string) => apiPost(`/api/ai/insights/${id}/dismiss`, {});

export const videoUrl = (videoId: string) => apiGet<{ url: string; expiresIn: number }>(`/api/ai/videos/${videoId}/url`);

/* -------------------------------------------------------------------------- */
/* Upload                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Os três passos de sempre: autorizar, carregar directo para o Storage,
 * confirmar. `XMLHttpRequest` e não `fetch` porque só ele dá progresso — e um
 * jogo de 2 GB sem barra é um ecrã parado durante vinte minutos.
 */
export async function uploadAnalysisVideo(
  analysisId: string,
  file: File,
  onProgress: (fraction: number) => void,
): Promise<void> {
  const started = await apiPost<{ id: string; uploadUrl: string; token: string }>(
    `/api/ai/analyses/${analysisId}/videos`,
    { mimeType: file.type, sizeBytes: file.size },
  );

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", started.uploadUrl);
    xhr.setRequestHeader("Content-Type", file.type);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Falhou (${xhr.status})`)));
    xhr.onerror = () => reject(new Error("A ligação falhou a meio do carregamento"));
    xhr.send(file);
  });

  await apiPost(`/api/ai/videos/${started.id}/complete`, {});
}

/* -------------------------------------------------------------------------- */
/* Vocabulário                                                                 */
/* -------------------------------------------------------------------------- */

export const STATUS_LABEL: Record<AnalysisStatus, string> = {
  DRAFT: "Rascunho",
  UPLOADING: "A carregar vídeo",
  QUEUED: "Na fila",
  PROCESSING: "A processar",
  REVIEW: "Precisa de revisão",
  COMPLETED: "Concluída",
  FAILED: "Falhou",
  CANCELLED: "Cancelada",
};

export const STATUS_TONE: Record<AnalysisStatus, "ok" | "warn" | "risk" | "neutral" | "signal"> = {
  DRAFT: "neutral",
  UPLOADING: "neutral",
  QUEUED: "signal",
  PROCESSING: "signal",
  REVIEW: "warn",
  COMPLETED: "ok",
  FAILED: "risk",
  CANCELLED: "neutral",
};

/** As etapas do pipeline, ditas na língua de quem lê. */
export const JOB_LABEL: Record<string, string> = {
  quality_check: "Qualidade do vídeo",
  detect_track: "Detecção e tracking",
  field_detect: "Detecção do campo",
  ball_track: "Tracking da bola",
  identify: "Identificação de jogadores",
  metrics: "Métricas",
  events: "Eventos",
  clips: "Clips",
};

/** As dimensões de confiança, na ordem em que se mostram. */
export const CONFIDENCE_LABEL: Record<string, string> = {
  player_tracking: "Tracking de jogadores",
  player_identity: "Identidade de jogadores",
  field_detection: "Detecção do campo",
  ball_tracking: "Tracking da bola",
  event_detection: "Detecção de eventos",
  individual_analysis: "Análise individual",
};

/**
 * A cor de um nível de confiança. Os limiares são os do produto: abaixo de
 * 0.75 pede-se um humano (ver `REVIEW_THRESHOLD` no servidor).
 */
export function confidenceTone(value: number): "ok" | "warn" | "risk" {
  if (value >= 0.85) return "ok";
  if (value >= 0.75) return "warn";
  return "risk";
}

export const pct = (value: number) => `${Math.round(value * 100)}%`;

/** "43:14" a partir de milissegundos de vídeo. */
export function videoTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

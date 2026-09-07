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
  /** `PURGED` = processado e apagado do worker; ficaram os dados, não o ficheiro. */
  status: "UPLOADING" | "READY" | "FAILED" | "PURGED";
  mimeType: string;
  sizeBytes: number | null;
  durationSec: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  quality: QualityReport | null;
  createdAt: string;
  /** O worker que tem o ficheiro no disco. Nulo no caminho antigo (Storage) e depois da purga. */
  holder: string | null;
  purgedAt: string | null;
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

/**
 * Quem está do outro lado a processar — e o que sabe fazer.
 *
 * `online: 0` quer dizer que **nenhuma** máquina de processamento está ligada:
 * a análise fica na fila e não avança. O ecrã diz isso em vez de prometer uma
 * notificação que ninguém vai enviar.
 */
export type WorkersInfo = { online: number; kinds: string[] };

export type AnalysisDetail = AnalysisRow & {
  workers: WorkersInfo;
  /** As pessoas, por tempo de presença. Vazio numa análise anterior à identificação. */
  identities: Identity[];
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

/**
 * Os recortes de uma análise.
 *
 * O worker guarda, por track, os frames em que o jogador está maior e mais
 * nítido — em **folhas**: grelhas de `cols × rows` recortes de `tile` píxeis,
 * uma imagem por folha. Cada track sabe em que folha (`s`) e posição (`i`)
 * estão os seus. O browser descarrega uma folha e recorta dez vezes, em vez
 * de dez imagens.
 *
 * `sheets` vazio = a análise não tem recortes (anterior a esta etapa, ou a
 * etapa por correr). Não é erro, e o ecrã não desenha quadrados partidos.
 */
export type CropRef = { s: number; i: number; ts: number; box: [number, number, number, number] };
export type CropsIndex = {
  tile: [number, number];
  cols: number;
  rows: number;
  /** Um link curto por folha, pela ordem de `s`. Caduca em `expiresIn` segundos. */
  sheets: (string | null)[];
  tracks: Record<string, CropRef[]>;
  expiresIn: number;
};
export const analysisCrops = (analysisId: string) => apiGet<CropsIndex>(`/api/ai/analyses/${analysisId}/crops`);

/* -------------------------------------------------------------------------- */
/* Identidades — as pessoas, por oposição aos tracks                           */
/* -------------------------------------------------------------------------- */

/**
 * O estado de uma identidade — a máquina de estados da revisão.
 *
 *   unknown   — sem proposta; pede um humano
 *   proposed  — a IA propôs abaixo do limiar; pede confirmação
 *   accepted  — a IA propôs acima do limiar; atleta escrito, revisível
 *   confirmed — um humano disse quem é
 *   rejected  — um humano disse que não é do plantel (árbitro, adversário)
 */
export type IdentityStatus = "unknown" | "proposed" | "accepted" | "confirmed" | "rejected";

/**
 * Um jogador visto no jogo — o que o treinador revê.
 *
 * Um jogador real dá dezenas de tracks; a identidade é o grupo deles, com a
 * proposta da IA (quem, com que confiança), o número lido na camisola, e o
 * veredicto. Os tracks continuam a existir como detalhe técnico.
 */
export type Identity = {
  id: string;
  /** "Jogador 3" enquanto não há nome. */
  label: number;
  status: IdentityStatus;
  side: string;
  athleteId: string | null;
  athleteName: string | null;
  proposedAthleteId: string | null;
  proposedConfidence: number | null;
  jerseyNumber: number | null;
  jerseyConfidence: number | null;
  firstMs: number;
  lastMs: number;
  trackCount: number;
  /** Tempo de presença somado pelos tracks, em ms. */
  presenceMs: number;
  summary: {
    /** Até três recortes representativos, nas folhas de `analysisCrops`. */
    crops?: { s: number; i: number; ts: number; track: number }[];
    signals?: Record<string, unknown>;
  } | null;
};

export const IDENTITY_STATUS_LABEL: Record<IdentityStatus, string> = {
  unknown: "Por identificar",
  proposed: "Proposta por confirmar",
  accepted: "Identificado pela IA",
  confirmed: "Confirmado por ti",
  rejected: "Fora do plantel",
};

/**
 * Pede um humano? O gémeo de `recomputeReview` no servidor: sem proposta ou
 * com proposta abaixo do limiar, e com tempo de presença que valha o clique —
 * vinte segundos de figurante não.
 */
export function identityNeedsReview(i: Identity): boolean {
  return (i.status === "unknown" || i.status === "proposed") && i.presenceMs >= 20_000;
}

export const identifyIdentity = (identityId: string, athleteId: string | null) =>
  apiPost<{ ok: true; propagating: boolean }>(`/api/ai/identities/${identityId}/identify`, { athleteId });

/* -------------------------------------------------------------------------- */
/* Upload                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Os três passos de sempre: autorizar, carregar directo para o Storage,
 * confirmar. `XMLHttpRequest` e não `fetch` porque só ele dá progresso — e um
 * jogo de 2 GB sem barra é um ecrã parado durante vinte minutos.
 */
/**
 * Carregar o vídeo de uma análise.
 *
 * ## Dois caminhos, e o de hoje é o directo
 *
 * A API decide por onde vão os bytes. Com um worker exposto
 * (`AI_WORKER_PUBLIC_URL`) responde com `ingestUrl` + `ticket`, e o ficheiro
 * vai **direito ao worker, em blocos**: o Supabase nunca o vê, não há tecto de
 * tamanho, e a ligação pode cair que se continua de onde ficou. Sem worker
 * exposto responde com `uploadUrl`, e é o caminho antigo — um PUT único para o
 * Storage.
 *
 * ## Retoma
 *
 * Cada bloco é confirmado com `received`. Um erro de rede repete o bloco;
 * um `409` diz onde o worker está e realinha-se; e o bilhete fica guardado
 * para que fechar o separador a meio não obrigue a recomeçar — ao voltar à
 * mesma análise, pergunta-se ao worker quanto já lá está.
 */
export async function uploadAnalysisVideo(
  analysisId: string,
  file: File,
  onProgress: (fraction: number) => void,
): Promise<void> {
  const guardado = lerCarregamento(analysisId, file);
  const started =
    guardado ??
    (await apiPost<StartedUpload>(`/api/ai/analyses/${analysisId}/videos`, {
      mimeType: file.type,
      sizeBytes: file.size,
    }));

  if ("ingestUrl" in started && started.ingestUrl) {
    guardarCarregamento(analysisId, file, started);
    await enviarEmBlocos(started, file, onProgress);
    esquecerCarregamento(analysisId);
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", (started as StartedStorage).uploadUrl);
    xhr.setRequestHeader("Content-Type", file.type);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Falhou (${xhr.status})`)));
    xhr.onerror = () => reject(new Error("A ligação falhou a meio do carregamento"));
    xhr.send(file);
  });

  await apiPost(`/api/ai/videos/${started.id}/complete`, {});
}

type StartedIngest = { id: string; ingestUrl: string; ticket: string };
type StartedStorage = { id: string; uploadUrl: string; token: string };
type StartedUpload = StartedIngest | StartedStorage;

const CHUNK = 8 * 1024 * 1024;
const TENTATIVAS_POR_BLOCO = 5;

async function enviarEmBlocos(started: StartedIngest, file: File, onProgress: (f: number) => void): Promise<void> {
  const base = `${started.ingestUrl.replace(/\/$/, "")}/ingest/${started.ticket}`;

  /*
   * O primeiro pedido é também o teste de vida do servidor de análise.
   *
   * Se ele não estiver de pé, o `fetch` atira um `TypeError` cru — "Failed to
   * fetch" — que não diz nada a quem está a olhar: nem que servidor, nem que
   * endereço, nem o que fazer. Aqui traduz-se, com o endereço à frente.
   */
  let abrir: { received: number };
  try {
    abrir = await pedir(base, { method: "POST" });
  } catch (e) {
    throw new Error(motivoDeLigacaoFalhada(started.ingestUrl, e));
  }
  let received = abrir.received;

  while (received < file.size) {
    const bloco = file.slice(received, Math.min(received + CHUNK, file.size));
    let falhas = 0;
    for (;;) {
      try {
        const r = await fetch(`${base}?offset=${received}`, {
          method: "PUT",
          headers: { "Content-Type": "application/octet-stream" },
          body: bloco,
        });
        if (r.status === 409) {
          // O worker está noutro ponto — realinha-se e o ciclo de fora corta o bloco certo.
          received = ((await r.json()) as { received: number }).received;
          break;
        }
        if (!r.ok) throw new Error(await mensagemDe(r));
        received = ((await r.json()) as { received: number }).received;
        break;
      } catch (e) {
        falhas += 1;
        if (falhas >= TENTATIVAS_POR_BLOCO) {
          // "Failed to fetch" a meio quer dizer o mesmo que no princípio: o
          // servidor deixou de responder. O que muda é que aqui não se perde
          // nada — o que já subiu fica lá, e retomar continua de onde ficou.
          const porque = e instanceof TypeError ? motivoDeLigacaoFalhada(started.ingestUrl, e) : e instanceof Error ? e.message : "A ligação falhou";
          throw new Error(`${porque} O que já subiu não se perde: carrega em "Tentar outra vez" e continua de onde ficou.`);
        }
        // Recuo curto e crescente: 1 s, 2 s, 4 s… — uma rede a soluçar recupera nisto.
        await new Promise((ok) => setTimeout(ok, 1000 * 2 ** (falhas - 1)));
        // Antes de repetir, perguntar onde o worker ficou — o bloco pode ter entrado apesar do erro.
        try {
          received = (await pedir(base, { method: "GET" })).received;
          break;
        } catch {
          /* sem resposta: repete o bloco como estava */
        }
      }
    }
    onProgress(received / file.size);
  }

  await pedir(`${base}/complete`, { method: "POST" });
  onProgress(1);
}

async function pedir(url: string, init: RequestInit): Promise<{ received: number }> {
  const r = await fetch(url, init);
  if (!r.ok) throw new Error(await mensagemDe(r));
  return (await r.json()) as { received: number };
}

/**
 * Porque é que não se chegou ao servidor de análise.
 *
 * São três causas, e distinguem-se sem adivinhar: o browser recusa-se a fazer
 * pedidos `http://` a partir de uma página `https://` (mixed content, e é
 * silencioso — parece uma falha de rede); o servidor pode não estar a correr; e
 * pode estar noutro sítio. Um "Failed to fetch" cobre as três e não resolve
 * nenhuma.
 */
function motivoDeLigacaoFalhada(ingestUrl: string, erro: unknown): string {
  const detalhe = erro instanceof Error ? erro.message : String(erro);

  if (window.location.protocol === "https:" && ingestUrl.startsWith("http://")) {
    return (
      `A consola está em HTTPS e o servidor de análise em ${ingestUrl} (HTTP) — o browser bloqueia essa ligação. ` +
      "O servidor de análise tem de estar acessível por HTTPS (ver AI_WORKER_PUBLIC_URL)."
    );
  }

  return (
    `Não foi possível falar com o servidor de análise em ${ingestUrl}. ` +
    `Confirma que ele está a correr (${detalhe}).`
  );
}

async function mensagemDe(r: Response): Promise<string> {
  try {
    const body = (await r.json()) as { error?: string };
    if (body.error) return body.error;
  } catch {
    /* sem JSON */
  }
  if (r.status === 401) return "O bilhete de carregamento caducou — começa a análise outra vez";
  if (r.status === 507) return "O worker não tem espaço em disco para este vídeo";
  return `O worker respondeu ${r.status}`;
}

/*
 * O bilhete, guardado por análise e por ficheiro (nome + tamanho + data), para
 * uma retoma depois de fechar o separador continuar o mesmo carregamento — e
 * nunca outro ficheiro no lugar dele.
 */
const chaveDe = (analysisId: string) => `academia.ai.upload:${analysisId}`;
const assinaturaDe = (file: File) => `${file.name}|${file.size}|${file.lastModified}`;

function lerCarregamento(analysisId: string, file: File): StartedIngest | null {
  try {
    const raw = localStorage.getItem(chaveDe(analysisId));
    if (!raw) return null;
    const saved = JSON.parse(raw) as StartedIngest & { file: string; savedAt: number };
    // O bilhete dura 24 h; ao fim de 20 não vale a pena tentar.
    if (saved.file !== assinaturaDe(file) || Date.now() - saved.savedAt > 20 * 3600 * 1000) return null;
    return { id: saved.id, ingestUrl: saved.ingestUrl, ticket: saved.ticket };
  } catch {
    return null;
  }
}

function guardarCarregamento(analysisId: string, file: File, started: StartedIngest): void {
  try {
    localStorage.setItem(chaveDe(analysisId), JSON.stringify({ ...started, file: assinaturaDe(file), savedAt: Date.now() }));
  } catch {
    /* sem armazenamento: a retoma só vale dentro desta página */
  }
}

function esquecerCarregamento(analysisId: string): void {
  try {
    localStorage.removeItem(chaveDe(analysisId));
  } catch {
    /* idem */
  }
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
  purge_video: "Apagar o vídeo",
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
  jersey_reading: "Leitura de camisolas",
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

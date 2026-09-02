import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { PageHeader } from "@/components/Shell";
import { Bar, Empty, Loading, Panel, PanelHead, Pill, cx, type Tone } from "@/components/primitives";
import { ArrowLeft, Check, CircleCheck, Film, Loader2, TriangleAlert, X } from "@/lib/icons";
import { shortDate } from "@/lib/format";
import { can } from "@/lib/permissions";
import { useSession } from "@/session";
import {
  CONFIDENCE_LABEL,
  JOB_LABEL,
  STATUS_LABEL,
  STATUS_TONE,
  confidenceTone,
  deleteAnalysis,
  getAnalysis,
  identifyTrack,
  pct,
  requeueAnalysis,
  videoTime,
  type AnalysisDetail as Detail,
  type QualityReport,
  type Track,
} from "@/lib/ai";

/**
 * A ficha de uma análise — o centro da Academias AI.
 *
 * ## O contrato com quem lê
 *
 * Tudo o que aqui aparece veio de computer vision com confiança medida, ou de
 * uma correção humana. O que está abaixo do limiar pede revisão em vez de se
 * fazer passar por certo — a secção "Precisa de revisão" é a interface desse
 * contrato, e corrigir aqui corrige o **track inteiro**, não um frame.
 *
 * ## Enquanto processa
 *
 * O ecrã actualiza-se sozinho de cinco em cinco segundos. Sem WebSockets de
 * propósito: um poll barato num ecrã que só está aberto enquanto interessa é
 * infra-estrutura que não se paga nem se avaria.
 */
export default function AnalysisDetail() {
  const { id = "" } = useParams();
  const { session } = useSession();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const mayWrite = can(session, "ai:write");

  const load = useCallback(() => {
    getAnalysis(id)
      .then(setDetail)
      .catch(() => setMissing(true));
  }, [id]);

  useEffect(load, [load]);

  // O poll enquanto a máquina trabalha — e só enquanto trabalha.
  const active = detail && ["UPLOADING", "QUEUED", "PROCESSING"].includes(detail.status);
  useEffect(() => {
    if (!active) return;
    timer.current = setInterval(load, 5000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [active, load]);

  if (missing) {
    return (
      <Panel>
        <Empty icon={TriangleAlert} title="Análise não encontrada" detail="Pode ter sido apagada, ou não é das tuas equipas.">
          <Link to="/ai/analises" className="ctl-outline gap-1">
            <ArrowLeft className="size-3.5" strokeWidth={1.75} />
            Voltar às análises
          </Link>
        </Empty>
      </Panel>
    );
  }
  if (!detail) return <Loading />;

  const quality = detail.videos[0]?.quality ?? null;
  const reviewTracks = detail.tracks.filter(needsReview);

  const remove = async () => {
    if (!window.confirm("Apagar esta análise apaga o vídeo, os tracks e as correções. Continuar?")) return;
    setBusy(true);
    try {
      await deleteAnalysis(detail.id);
      navigate("/ai/analises");
    } finally {
      setBusy(false);
    }
  };

  const reprocess = async () => {
    setBusy(true);
    try {
      await requeueAnalysis(detail.id);
      load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Academias AI"
        title={detail.title}
        subtitle={[detail.teamName, detail.competition, detail.playedOn ? shortDate(new Date(detail.playedOn)) : null]
          .filter(Boolean)
          .join(" · ")}
      >
        <Pill tone={STATUS_TONE[detail.status]}>{STATUS_LABEL[detail.status]}</Pill>
        {mayWrite && (detail.status === "FAILED" || (detail.status === "REVIEW" && detail.tracks.length === 0)) && (
          <button type="button" className="ctl-outline" onClick={reprocess} disabled={busy}>
            {detail.status === "FAILED" ? "Tentar outra vez" : "Processar mesmo assim"}
          </button>
        )}
        {mayWrite && (
          <button type="button" className="ctl-risk" onClick={remove} disabled={busy}>
            Apagar
          </button>
        )}
      </PageHeader>

      {/* A barra de progresso do processamento — só enquanto há máquina a trabalhar. */}
      {active && (
        <Panel className="mb-4">
          <div className="flex items-center gap-3 px-5 py-4">
            <Loader2 className="size-4 shrink-0 animate-spin text-signal" strokeWidth={2} />
            <div className="min-w-0 flex-1">
              <div className="mb-1.5 flex items-baseline justify-between gap-2">
                <span className="text-body font-medium text-ink">
                  {detail.status === "UPLOADING" ? "À espera do vídeo" : currentStage(detail)}
                </span>
                <span className="text-meta tabular text-ink-3">{detail.progress}%</span>
              </div>
              <Bar value={detail.progress / 100} />
            </div>
          </div>
          <p className="border-t border-line px-5 py-2.5 text-meta text-ink-4">
            Podes fechar a consola — recebes uma notificação quando terminar.
          </p>
        </Panel>
      )}

      {detail.status === "FAILED" && detail.failReason && (
        <Panel className="mb-4">
          <div className="flex items-start gap-2.5 px-5 py-4">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-risk" strokeWidth={1.75} />
            <div>
              <p className="text-body font-medium text-ink">O processamento falhou</p>
              <p className="mt-0.5 text-meta text-ink-3">{detail.failReason}</p>
            </div>
          </div>
        </Panel>
      )}

      {/* O que precisa de um humano — primeiro, porque é accionável. */}
      {mayWrite && reviewTracks.length > 0 && (
        <Panel className="mb-4">
          <PanelHead
            title="Precisa de revisão"
            hint={`${reviewTracks.length} ${reviewTracks.length === 1 ? "identidade por confirmar" : "identidades por confirmar"}`}
          />
          <ul className="divide-y divide-line">
            {reviewTracks.map((t) => (
              <ReviewRow key={t.id} track={t} squad={detail.squad} onDone={load} />
            ))}
          </ul>
        </Panel>
      )}

      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          {quality && <QualityPanel quality={quality} video={detail.videos[0]} />}

          <Panel>
            <PanelHead title="Jogadores no vídeo" hint={detail.tracks.length ? `${detail.tracks.length} tracks` : undefined} />
            {detail.tracks.length === 0 ? (
              <Empty
                icon={Film}
                compact
                title="Ainda sem tracking"
                detail={
                  active
                    ? "Os tracks aparecem quando a detecção terminar."
                    : "Esta análise ainda não foi processada."
                }
              />
            ) : (
              <ul className="divide-y divide-line">
                {detail.tracks
                  .filter((t) => t.status !== "discarded")
                  .map((t) => (
                    <TrackRow key={t.id} track={t} />
                  ))}
              </ul>
            )}
          </Panel>
        </div>

        <div className="space-y-4 self-start">
          <Panel>
            <PanelHead title="Confiança" hint="por dimensão, nunca uma média" />
            <ConfidenceList confidence={detail.confidence} quality={quality} />
          </Panel>

          <Panel>
            <PanelHead title="Pipeline" />
            <ul className="divide-y divide-line">
              {detail.jobs.map((j) => (
                <li key={j.id} className="flex items-center gap-2.5 px-5 py-2.5">
                  <JobDot status={j.status} />
                  <span className="min-w-0 flex-1 truncate text-body text-ink-2">{JOB_LABEL[j.kind] ?? j.kind}</span>
                  {j.status === "RUNNING" && <span className="text-meta tabular text-ink-3">{j.progress}%</span>}
                  {j.status === "FAILED" && <Pill tone="risk">falhou</Pill>}
                </li>
              ))}
              {detail.jobs.length === 0 && (
                <li className="px-5 py-3 text-meta text-ink-4">O pipeline arranca quando o vídeo estiver carregado.</li>
              )}
            </ul>
          </Panel>

          <Panel>
            <PanelHead title="Plantel confirmado" hint={`${detail.squad.length} jogadores`} />
            <ul className="max-h-80 divide-y divide-line overflow-y-auto">
              {detail.squad.map((s) => (
                <li key={s.athleteId} className="flex items-center gap-2.5 px-5 py-2">
                  <span className="w-8 shrink-0 text-right font-mono text-meta text-ink-3">
                    {s.jerseyNumber != null ? `#${s.jerseyNumber}` : "—"}
                  </span>
                  <span className="truncate text-body text-ink">{s.name}</span>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Revisão                                                                     */
/* -------------------------------------------------------------------------- */

/** Um track que a IA não teve confiança para nomear. O humano decide; a correção vale para o track inteiro. */
function ReviewRow({
  track,
  squad,
  onDone,
}: {
  track: Track;
  squad: Detail["squad"];
  onDone: () => void;
}) {
  const [choice, setChoice] = useState(track.athleteId ?? "");
  const [saving, setSaving] = useState(false);

  const apply = async (athleteId: string | null) => {
    setSaving(true);
    try {
      await identifyTrack(track.id, athleteId);
      onDone();
    } finally {
      setSaving(false);
    }
  };

  return (
    <li className="flex flex-wrap items-center gap-3 px-5 py-3">
      <div className="min-w-0 flex-1">
        <div className="text-body font-medium text-ink">
          {track.athleteName ?? "Jogador por identificar"}
          {track.jerseyNumber != null && <span className="ml-1.5 font-mono text-meta text-ink-3">#{track.jerseyNumber}</span>}
        </div>
        <div className="text-meta text-ink-3">
          Track {track.trackNumber} · {videoTime(track.firstMs)}–{videoTime(track.lastMs)} ·{" "}
          {track.identityConfidence != null ? `confiança ${pct(track.identityConfidence)}` : "sem proposta"}
        </div>
      </div>
      <select
        aria-label="Quem é este jogador"
        className="h-8 rounded-[var(--radius-control)] border border-line bg-surface px-2 text-meta text-ink"
        value={choice}
        onChange={(e) => setChoice(e.target.value)}
        disabled={saving}
      >
        <option value="">Escolher jogador…</option>
        {squad.map((s) => (
          <option key={s.athleteId} value={s.athleteId}>
            {s.jerseyNumber != null ? `#${s.jerseyNumber} · ` : ""}
            {s.name}
          </option>
        ))}
      </select>
      <button type="button" className="ctl-primary gap-1" disabled={!choice || saving} onClick={() => apply(choice)}>
        <Check className="size-3.5" strokeWidth={2} />
        Confirmar
      </button>
      <button
        type="button"
        className="ctl-outline gap-1"
        disabled={saving}
        onClick={() => apply(null)}
        title="Árbitro, adversário ou engano do tracking"
      >
        <X className="size-3.5" strokeWidth={2} />
        Não é do plantel
      </button>
    </li>
  );
}

function needsReview(t: Track): boolean {
  // O gémeo do servidor (REVIEW_THRESHOLD em ai-jobs.service.ts): abaixo de
  // 0.75, com tempo de jogo relevante, ainda automático, e do nosso lado —
  // ou sem lado, que é como todos nascem enquanto a separação de equipas
  // não existir.
  return (
    t.status === "auto" &&
    (t.side === "ours" || t.side === "unknown") &&
    t.lastMs - t.firstMs >= 20_000 &&
    (t.identityConfidence == null || t.identityConfidence < 0.75)
  );
}

/* -------------------------------------------------------------------------- */
/* Tracks                                                                      */
/* -------------------------------------------------------------------------- */

function TrackRow({ track }: { track: Track }) {
  const summary = track.summary ?? {};
  const distance = typeof summary.distanceM === "number" ? `${(summary.distanceM / 1000).toFixed(1)} km` : null;

  return (
    <li className="flex items-center gap-3 px-5 py-2.5">
      <span
        className={cx(
          "inline-flex size-7 shrink-0 items-center justify-center rounded-full font-mono text-[11px] font-semibold",
          track.side === "ours" ? "bg-signal-soft text-signal-ink" : "bg-sunken text-ink-3",
        )}
      >
        {track.jerseyNumber != null ? track.jerseyNumber : "?"}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-body font-medium text-ink">
            {track.athleteName ?? sideLabel(track.side)}
          </span>
          {track.status === "corrected" && (
            <span title="Confirmado por um humano">
              <CircleCheck className="size-3.5 shrink-0 text-ok" strokeWidth={2} />
            </span>
          )}
        </div>
        <div className="text-meta text-ink-3">
          {videoTime(track.firstMs)}–{videoTime(track.lastMs)}
          {distance ? ` · ~${distance}` : ""}
        </div>
      </div>
      {track.identityConfidence != null && track.status === "auto" && (
        <Pill tone={confidenceTone(track.identityConfidence)}>{pct(track.identityConfidence)}</Pill>
      )}
    </li>
  );
}

function sideLabel(side: string): string {
  if (side === "theirs") return "Adversário";
  if (side === "referee") return "Árbitro";
  return "Por identificar";
}

/* -------------------------------------------------------------------------- */
/* Qualidade e confiança                                                       */
/* -------------------------------------------------------------------------- */

function QualityPanel({ quality, video }: { quality: QualityReport; video: Detail["videos"][0] }) {
  const verdict = quality.verdict ?? "acceptable";
  const tone: Tone = verdict === "good" ? "ok" : verdict === "poor" ? "risk" : "warn";
  const label = { good: "Boa", acceptable: "Aceitável", poor: "Fraca" }[verdict] ?? verdict;

  const tech = [
    video.width && video.height ? `${video.width}×${video.height}` : null,
    video.fps ? `${Math.round(video.fps)} fps` : null,
    video.durationSec ? `${Math.round(video.durationSec / 60)} min` : null,
  ].filter(Boolean);

  return (
    <Panel>
      <PanelHead title="Qualidade do vídeo" hint={tech.join(" · ") || undefined}>
        <Pill tone={tone}>{label}</Pill>
      </PanelHead>
      <div className="space-y-2.5 px-5 py-4">
        {Object.entries(quality.feasibility ?? {}).map(([key, value]) => (
          <ConfidenceBar key={key} label={CONFIDENCE_LABEL[key] ?? key} value={value} />
        ))}
        {(quality.notes ?? []).map((note, i) => (
          <p key={i} className="flex items-start gap-1.5 text-meta leading-relaxed text-ink-3">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warn" strokeWidth={1.75} />
            {note}
          </p>
        ))}
      </div>
    </Panel>
  );
}

/**
 * As dimensões de confiança medidas — e nada mais. A previsão da qualidade
 * (feasibility) tem painel próprio; aqui está o que o processamento **mediu**.
 */
function ConfidenceList({
  confidence,
  quality,
}: {
  confidence: Record<string, unknown> | null;
  quality: QualityReport | null;
}) {
  const measured = Object.entries(confidence ?? {}).filter(
    (e): e is [string, number] => typeof e[1] === "number",
  );

  if (measured.length === 0) {
    return (
      <p className="px-5 py-4 text-meta leading-relaxed text-ink-4">
        {quality
          ? "As confianças medidas aparecem quando o processamento terminar."
          : "Sem processamento ainda não há nada medido — e nada aqui será inventado."}
      </p>
    );
  }

  return (
    <div className="space-y-2.5 px-5 py-4">
      {measured.map(([key, value]) => (
        <ConfidenceBar key={key} label={CONFIDENCE_LABEL[key] ?? key} value={value} />
      ))}
    </div>
  );
}

function ConfidenceBar({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-meta text-ink-2">{label}</span>
        <span className="text-meta font-semibold tabular text-ink">{pct(value)}</span>
      </div>
      <Bar value={value} tone={confidenceTone(value)} />
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function JobDot({ status }: { status: string }) {
  if (status === "DONE") return <CircleCheck className="size-4 shrink-0 text-ok" strokeWidth={2} />;
  if (status === "FAILED") return <X className="size-4 shrink-0 text-risk" strokeWidth={2} />;
  if (status === "RUNNING" || status === "CLAIMED")
    return <Loader2 className="size-4 shrink-0 animate-spin text-signal" strokeWidth={2} />;
  return <span className="mx-1 inline-block size-2 shrink-0 rounded-full bg-ink-4" aria-hidden />;
}

function currentStage(detail: Detail): string {
  const running = detail.jobs.find((j) => j.status === "RUNNING" || j.status === "CLAIMED");
  if (running) return JOB_LABEL[running.kind] ?? running.kind;
  return "Na fila — à espera de um worker";
}

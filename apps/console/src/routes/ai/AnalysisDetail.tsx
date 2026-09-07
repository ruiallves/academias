import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { PageHeader } from "@/components/Shell";
import { Bar, Empty, Loading, Panel, PanelHead, Pill, cx, type Tone } from "@/components/primitives";
import { ArrowLeft, Check, CircleCheck, Film, Loader2, TriangleAlert, Users, X } from "@/lib/icons";
import { shortDate, shortName } from "@/lib/format";
import { can } from "@/lib/permissions";
import { ApiError } from "@/lib/http";
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
  analysisCrops,
  type CropsIndex,
  IDENTITY_STATUS_LABEL,
  identifyIdentity,
  identityNeedsReview,
  type Identity,
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
  /** Uma falha passageira — rede, servidor. Não é "não existe". */
  const [falhou, setFalhou] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const mayWrite = can(session, "ai:write");

  /*
   * Uma falha de rede não é uma análise apagada.
   *
   * Isto apanhava tudo num `catch` só e dizia "Análise não encontrada — pode ter
   * sido apagada, ou não é das tuas equipas". Um 500 de um segundo (o servidor a
   * reiniciar, o portátil a acordar de suspensão com um pedido a meio) fazia o
   * ecrã mentir sobre uma análise que estava lá — e, pior, matava o poll: sem
   * `detail` não há `active`, e a página ficava assim até alguém a recarregar à
   * mão.
   *
   * Agora só o 404 e o 403 dizem que não há: são a resposta do servidor à
   * pergunta. O resto guarda o que já se tinha, di-lo numa faixa, e continua a
   * tentar — a análise pode estar a meio do processamento e a próxima volta do
   * poll resolve sozinha.
   */
  const load = useCallback(() => {
    getAnalysis(id)
      .then((d) => {
        setDetail(d);
        setFalhou(null);
      })
      .catch((e: unknown) => {
        const status = e instanceof ApiError ? e.status : 0;
        if (status === 404 || status === 403) setMissing(true);
        else setFalhou(e instanceof Error ? e.message : "Não foi possível carregar.");
      });
  }, [id]);

  useEffect(load, [load]);

  /*
   * Os recortes chegam à parte, uma vez, e só quando há o que ver.
   *
   * Não vêm com a análise: são folhas de imagens com links assinados, e
   * pedi-los a cada volta do poll de cinco segundos era assinar dez links por
   * nada enquanto o processamento ainda corre. Quando a análise fecha, pede-se
   * uma vez. Uma análise anterior a esta etapa responde vazio, e as linhas
   * ficam sem imagem — nunca com um quadrado partido.
   */
  const [crops, setCrops] = useState<CropsIndex | null>(null);
  const concluida = detail?.status === "REVIEW" || detail?.status === "COMPLETED";
  useEffect(() => {
    if (!concluida) return;
    analysisCrops(id)
      .then(setCrops)
      .catch(() => setCrops(null));
  }, [id, concluida]);

  // O poll enquanto a máquina trabalha — e só enquanto trabalha. Também
  // enquanto houver uma falha por resolver (é o que a faz desaparecer sozinha)
  // e enquanto uma confirmação se propaga: a análise fica em revisão, mas há
  // um job a re-agrupar, e o ecrã quer os nomes novos quando ele acabar.
  const active = !!detail && ["UPLOADING", "QUEUED", "PROCESSING"].includes(detail.status);
  const propagando =
    !!detail &&
    !active &&
    detail.jobs.some((j) => j.kind === "identify" && ["PENDING", "CLAIMED", "RUNNING"].includes(j.status));
  const polling = active || propagando || (falhou !== null && !missing);
  useEffect(() => {
    if (!polling) return;
    timer.current = setInterval(load, 5000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [polling, load]);

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
  if (!detail) {
    // Ainda não há nada para mostrar: ou está a carregar, ou a primeira tentativa
    // falhou. Dizer qual das duas é a diferença entre esperar e ir chamar alguém.
    if (!falhou) return <Loading />;
    return (
      <Panel>
        <Empty icon={TriangleAlert} title="Não foi possível carregar" detail={falhou}>
          <button type="button" className="ctl-outline" onClick={load}>
            Tentar outra vez
          </button>
        </Empty>
      </Panel>
    );
  }

  const quality = detail.videos[0]?.quality ?? null;
  const reviewTracks = detail.tracks.filter(needsReview);

  // As pessoas. Sem identidades — análise anterior à etapa de identificação —
  // o ecrã volta a falar de tracks, e diz porquê.
  const temIdentidades = detail.identities.length > 0;
  const porConfirmar = detail.identities.filter(identityNeedsReview);
  const noPlantel = detail.identities.filter((i) => i.status !== "rejected");
  const foraDoPlantel = detail.identities.filter((i) => i.status === "rejected");

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
            {rodapeDoProgresso(detail)}
          </p>
        </Panel>
      )}

      {/* Já há dados no ecrã, mas a última actualização não chegou. Diz-se, sem
          deitar fora o que se tinha — e o poll continua a tentar. */}
      {falhou && (
        <Panel className="mb-4">
          <div className="flex items-center gap-2.5 px-5 py-3">
            <TriangleAlert className="size-4 shrink-0 text-warn" strokeWidth={1.75} />
            <p className="min-w-0 flex-1 text-meta text-ink-3">
              Os dados podem estar desactualizados — {falhou}
            </p>
            <button type="button" className="ctl-outline shrink-0" onClick={load}>
              Actualizar
            </button>
          </div>
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

      {/*
        O que precisa de um humano — primeiro, porque é accionável.

        Por **pessoa**, não por track. Um jogo real deu 733 tracks para 22
        jogadores; a lista por track pedia 150 confirmações de "Track 77" às
        cegas. Agora o resumo diz quantos a IA identificou sozinha e quantos
        precisam de alguém, e cada pedido traz a imagem, a proposta e a
        confiança — e a resposta vale para o jogador inteiro.
      */}
      {temIdentidades && concluida && (
        <IdentitySummary identities={detail.identities} squadCount={detail.squad.length} propagando={propagando} />
      )}
      {temIdentidades && mayWrite && porConfirmar.length > 0 && (
        <Panel className="mb-4">
          <PanelHead
            title="Precisa da tua confirmação"
            hint={`${porConfirmar.length} ${porConfirmar.length === 1 ? "jogador" : "jogadores"}`}
          />
          <ul className="divide-y divide-line">
            {porConfirmar.map((i) => (
              <IdentityCard key={i.id} identity={i} squad={detail.squad} crops={crops} onDone={load} />
            ))}
          </ul>
        </Panel>
      )}

      {/* Uma análise anterior à identificação: fica a revisão antiga, por
          track, com a razão à vista. Reprocessar o vídeo é o que a traz para
          o modelo novo. */}
      {!temIdentidades && mayWrite && reviewTracks.length > 0 && (
        <Panel className="mb-4">
          <PanelHead
            title="Precisa de revisão"
            hint={`${reviewTracks.length} ${reviewTracks.length === 1 ? "track por confirmar" : "tracks por confirmar"} · análise anterior à identificação`}
          />
          <ul className="divide-y divide-line">
            {reviewTracks.map((t) => (
              <ReviewRow key={t.id} track={t} squad={detail.squad} crops={crops} onDone={load} />
            ))}
          </ul>
        </Panel>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          {quality && <QualityPanel quality={quality} video={detail.videos[0]} />}

          <Panel>
            <PanelHead
              title="Jogadores"
              hint={
                temIdentidades
                  ? `${noPlantel.length} ${noPlantel.length === 1 ? "pessoa vista" : "pessoas vistas"} no vídeo`
                  : detail.tracks.length
                    ? `${detail.tracks.length} tracks · análise anterior à identificação`
                    : undefined
              }
            />
            {detail.tracks.length === 0 ? (
              <Empty
                icon={Film}
                compact
                title="Ainda sem tracking"
                detail={
                  active
                    ? "Os jogadores aparecem quando a detecção e a identificação terminarem."
                    : "Esta análise ainda não foi processada."
                }
              />
            ) : temIdentidades ? (
              <>
                <ul className="divide-y divide-line">
                  {noPlantel.map((i) => (
                    <IdentityRow key={i.id} identity={i} squad={detail.squad} crops={crops} mayWrite={mayWrite} onDone={load} />
                  ))}
                </ul>
                {foraDoPlantel.length > 0 && (
                  <details className="border-t border-line">
                    <summary className="cursor-pointer px-5 py-2.5 text-meta text-ink-3 select-none">
                      Fora do plantel · {foraDoPlantel.length} — árbitros, adversários, enganos que marcaste
                    </summary>
                    <ul className="divide-y divide-line border-t border-line">
                      {foraDoPlantel.map((i) => (
                        <IdentityRow key={i.id} identity={i} squad={detail.squad} crops={crops} mayWrite={mayWrite} onDone={load} />
                      ))}
                    </ul>
                  </details>
                )}
                {/*
                  Os tracks são o dado técnico: o que o tracker produziu, antes
                  de se juntarem em pessoas. Ficam acessíveis — para perceber
                  porque é que um jogador tem vinte fragmentos — mas não são o
                  que se lê. Um treinador não sabe nem quer saber o que é um
                  track, e o ecrã já não lho pede.
                */}
                <details className="border-t border-line">
                  <summary className="cursor-pointer px-5 py-2.5 text-meta text-ink-3 select-none">
                    Detalhes técnicos · {detail.tracks.length} tracks
                  </summary>
                  <ul className="divide-y divide-line border-t border-line">
                    {detail.tracks
                      .filter((t) => t.status !== "discarded")
                      .map((t) => (
                        <TrackRow key={t.id} track={t} crops={crops} />
                      ))}
                  </ul>
                </details>
              </>
            ) : (
              <ul className="divide-y divide-line">
                {detail.tracks
                  .filter((t) => t.status !== "discarded")
                  .map((t) => (
                    <TrackRow key={t.id} track={t} crops={crops} />
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
  crops,
  onDone,
}: {
  track: Track;
  squad: Detail["squad"];
  crops: CropsIndex | null;
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
      {/* O que a IA viu — antes de perguntar quem é. Sem isto o treinador
          confirmava "Track 77" às cegas. */}
      <CropTile crops={crops} trackNumber={track.trackNumber} size="md" />
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

/**
 * Um recorte do jogador, cortado da folha.
 *
 * As folhas são grelhas de `cols × rows` recortes de `tile` píxeis; cada track
 * sabe em que folha e posição estão os seus. Desenha-se com
 * `background-position` — o browser descarrega a folha uma vez e recorta dez
 * vezes, em vez de dez imagens. Escolhe-se o recorte do meio no tempo: o
 * primeiro e o último são os extremos de um track, e o do meio é o mais
 * provável de o mostrar de corpo inteiro.
 *
 * Sem recortes (análise anterior a esta etapa, ou etapa por correr) não se
 * desenha nada: o espaço fica, o quadrado partido não.
 */
const TILE_WIDTH = { sm: 36, md: 56, lg: 84 } as const;

/** Um azulejo de uma folha, por referência explícita — o bloco de que tudo o resto se faz. */
function SheetTile({
  crops,
  at,
  size = "md",
}: {
  crops: CropsIndex | null;
  at: { s: number; i: number; ts: number } | undefined;
  size?: keyof typeof TILE_WIDTH;
}) {
  const url = at ? crops?.sheets[at.s] : null;
  if (!crops || !at || !url) return null;

  const [tw, th] = crops.tile;
  const escala = TILE_WIDTH[size] / tw;
  const col = at.i % crops.cols;
  const row = Math.floor(at.i / crops.cols);

  return (
    <span
      aria-hidden
      title={`Visto aos ${videoTime(at.ts)}`}
      className="shrink-0 overflow-hidden rounded-[6px] bg-sunken"
      style={{
        width: tw * escala,
        height: th * escala,
        backgroundImage: `url("${url}")`,
        backgroundSize: `${crops.cols * tw * escala}px ${crops.rows * th * escala}px`,
        backgroundPosition: `-${col * tw * escala}px -${row * th * escala}px`,
      }}
    />
  );
}

/** O recorte de um track — o do meio no tempo, o mais provável de o mostrar de corpo inteiro. */
function CropTile({ crops, trackNumber, size = "md" }: { crops: CropsIndex | null; trackNumber: number; size?: "sm" | "md" }) {
  const refs = crops?.tracks[String(trackNumber)];
  return <SheetTile crops={crops} at={refs?.[Math.floor((refs.length - 1) / 2)]} size={size} />;
}

/**
 * Os recortes de uma pessoa — até três, espalhados pelos tracks dela.
 *
 * É isto que o treinador vê antes de responder: a mesma pessoa em três
 * momentos do jogo, e não um nome de track. Sem recortes não se desenha nada
 * — o espaço fica, o quadrado partido não.
 */
function IdentityCrops({ identity, crops, size = "md" }: { identity: Identity; crops: CropsIndex | null; size?: keyof typeof TILE_WIDTH }) {
  const refs = identity.summary?.crops ?? [];
  if (!crops || refs.length === 0) return null;
  return (
    <span className="flex shrink-0 gap-1">
      {refs.slice(0, 3).map((r, k) => (
        <SheetTile key={k} crops={crops} at={r} size={size} />
      ))}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Identidades — as pessoas                                                    */
/* -------------------------------------------------------------------------- */

const IDENTITY_TONE: Record<Identity["status"], Tone> = {
  unknown: "risk",
  proposed: "warn",
  accepted: "ok",
  confirmed: "ok",
  rejected: "neutral",
};

/** "12 min em campo", "40 s em campo" — o tempo de presença somado pelos tracks. */
function presenceLabel(ms: number): string {
  if (ms >= 90_000) return `${Math.round(ms / 60_000)} min em campo`;
  return `${Math.round(ms / 1000)} s em campo`;
}

/** O nome de quem a IA propôs, resolvido no plantel da análise. */
function proposedName(identity: Identity, squad: Detail["squad"]): string | null {
  return squad.find((s) => s.athleteId === identity.proposedAthleteId)?.name ?? null;
}

/**
 * O resumo — a frase que responde à pergunta de quem abre a análise.
 *
 * "A IA identificou 16. Preciso de confirmar 2." E os números por trás, em
 * três cores: o que a máquina resolveu sozinha, o que tu já resolveste, e o
 * que falta. As passagens curtas (menos de vinte segundos) não pedem nada e
 * dizem-se à parte — não são jogadores por identificar, são figurantes.
 */
function IdentitySummary({
  identities,
  squadCount,
  propagando,
}: {
  identities: Identity[];
  squadCount: number;
  propagando: boolean;
}) {
  const aceites = identities.filter((i) => i.status === "accepted").length;
  const confirmadas = identities.filter((i) => i.status === "confirmed").length;
  const porConfirmar = identities.filter(identityNeedsReview).length;
  const curtas = identities.filter((i) => (i.status === "unknown" || i.status === "proposed") && !identityNeedsReview(i)).length;
  const fora = identities.filter((i) => i.status === "rejected").length;
  const identificados = aceites + confirmadas;

  return (
    <Panel className="mb-4">
      <div className="flex items-start gap-3 px-5 py-4">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-signal-soft text-signal-ink">
          <Users className="size-4.5" strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-body font-medium text-ink">
            {identificados === 0 && porConfirmar === 0
              ? "A IA não conseguiu identificar ninguém com confiança."
              : porConfirmar === 0
                ? `A IA identificou ${identificados} ${identificados === 1 ? "jogador" : "jogadores"} do plantel de ${squadCount}. Não precisa de mais nada.`
                : `A IA identificou ${identificados} ${identificados === 1 ? "jogador" : "jogadores"} do plantel de ${squadCount}. Precisas de confirmar ${porConfirmar}.`}
          </p>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-meta">
            <span className="flex items-center gap-1.5 text-ink-2">
              <span className="size-2 rounded-full bg-ok" aria-hidden />
              {aceites} {aceites === 1 ? "identificado" : "identificados"} automaticamente
            </span>
            <span className="flex items-center gap-1.5 text-ink-2">
              <span className="size-2 rounded-full bg-signal" aria-hidden />
              {confirmadas} {confirmadas === 1 ? "confirmado" : "confirmados"} por ti
            </span>
            <span className="flex items-center gap-1.5 text-ink-2">
              <span className="size-2 rounded-full bg-risk" aria-hidden />
              {porConfirmar} por identificar
            </span>
            {curtas > 0 && (
              <span className="text-ink-4">
                {curtas} {curtas === 1 ? "passagem curta" : "passagens curtas"}, sem confirmação pedida
              </span>
            )}
            {fora > 0 && (
              <span className="text-ink-4">
                {fora} fora do plantel
              </span>
            )}
          </div>
          {propagando && (
            <p className="mt-2 flex items-center gap-1.5 text-meta text-ink-3">
              <Loader2 className="size-3.5 animate-spin text-signal" strokeWidth={2} />
              A propagar a tua confirmação aos fragmentos parecidos…
            </p>
          )}
        </div>
      </div>
    </Panel>
  );
}

/**
 * Escolher quem é — o único selector da área, e só aparece quando se pede.
 *
 * Nunca à cabeça: primeiro o recorte e a proposta, e só quem diz "é outro" vê
 * a lista. Um dropdown de dezasseis nomes sem contexto é o que se está a
 * substituir.
 */
function IdentityChooser({
  identity,
  squad,
  onDone,
  onCancel,
}: {
  identity: Identity;
  squad: Detail["squad"];
  onDone: () => void;
  onCancel: () => void;
}) {
  const [choice, setChoice] = useState(identity.athleteId ?? identity.proposedAthleteId ?? "");
  const [saving, setSaving] = useState(false);

  const apply = async (athleteId: string | null) => {
    setSaving(true);
    try {
      await identifyIdentity(identity.id, athleteId);
      onDone();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
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
      <button type="button" className="ctl-outline gap-1" disabled={saving} onClick={() => apply(null)} title="Árbitro, adversário ou engano">
        <X className="size-3.5" strokeWidth={2} />
        Não é do plantel
      </button>
      <button type="button" className="ctl-ghost" disabled={saving} onClick={onCancel}>
        Cancelar
      </button>
    </div>
  );
}

/**
 * Um pedido de confirmação — a unidade de trabalho do treinador.
 *
 * Recortes à esquerda, a proposta e a confiança à direita, e os três gestos
 * que interessam: confirmar a proposta num clique, escolher outro, ou dizer
 * que não é ninguém do plantel. A resposta vale para todos os tracks da
 * pessoa — é a razão de o pedido ser por pessoa.
 */
function IdentityCard({
  identity,
  squad,
  crops,
  onDone,
}: {
  identity: Identity;
  squad: Detail["squad"];
  crops: CropsIndex | null;
  onDone: () => void;
}) {
  const [choosing, setChoosing] = useState(false);
  const [saving, setSaving] = useState(false);
  const proposta = proposedName(identity, squad);

  const confirmarProposta = async () => {
    if (!identity.proposedAthleteId) return;
    setSaving(true);
    try {
      await identifyIdentity(identity.id, identity.proposedAthleteId);
      onDone();
    } finally {
      setSaving(false);
    }
  };

  const rejeitar = async () => {
    setSaving(true);
    try {
      await identifyIdentity(identity.id, null);
      onDone();
    } finally {
      setSaving(false);
    }
  };

  return (
    <li className="flex flex-wrap items-start gap-4 px-5 py-4">
      <IdentityCrops identity={identity} crops={crops} size="lg" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-body font-medium text-ink">{proposta ? `Possível jogador: ${proposta}` : "Jogador por identificar"}</span>
          {identity.proposedConfidence != null && (
            <Pill tone={confidenceTone(identity.proposedConfidence)}>{pct(identity.proposedConfidence)}</Pill>
          )}
        </div>
        <div className="mt-0.5 text-meta text-ink-3">
          Jogador {identity.label} · {presenceLabel(identity.presenceMs)} · visto {videoTime(identity.firstMs)}–{videoTime(identity.lastMs)}
          {identity.jerseyNumber != null && (
            <>
              {" · "}
              <span className="font-mono">#{identity.jerseyNumber}</span> lido na camisola
              {identity.jerseyConfidence != null ? ` (${pct(identity.jerseyConfidence)})` : ""}
            </>
          )}
        </div>

        <div className="mt-3">
          {choosing || !identity.proposedAthleteId ? (
            <IdentityChooser identity={identity} squad={squad} onDone={onDone} onCancel={() => setChoosing(false)} />
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className="ctl-primary gap-1" disabled={saving} onClick={confirmarProposta}>
                <Check className="size-3.5" strokeWidth={2} />
                Confirmar {shortName(proposta ?? "")}
              </button>
              <button type="button" className="ctl-outline" disabled={saving} onClick={() => setChoosing(true)}>
                Escolher outro jogador
              </button>
              <button type="button" className="ctl-ghost gap-1" disabled={saving} onClick={rejeitar} title="Árbitro, adversário ou engano">
                <X className="size-3.5" strokeWidth={2} />
                Não é do plantel
              </button>
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

/** Uma pessoa na lista — nome, estado, presença; e "Alterar" para quem pode. */
function IdentityRow({
  identity,
  squad,
  crops,
  mayWrite,
  onDone,
}: {
  identity: Identity;
  squad: Detail["squad"];
  crops: CropsIndex | null;
  mayWrite: boolean;
  onDone: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const nome = identity.athleteName ?? (identity.status === "proposed" ? proposedName(identity, squad) : null);

  return (
    <li className="flex flex-wrap items-center gap-3 px-5 py-2.5">
      <IdentityCrops identity={identity} crops={crops} size="sm" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className={cx("truncate text-body font-medium", identity.status === "rejected" ? "text-ink-3" : "text-ink")}>
            {nome ?? `Jogador ${identity.label}`}
            {identity.status === "proposed" && nome ? "?" : ""}
          </span>
          {identity.status === "confirmed" && (
            <span title="Confirmado por um humano">
              <CircleCheck className="size-3.5 shrink-0 text-ok" strokeWidth={2} />
            </span>
          )}
        </div>
        <div className="text-meta text-ink-3">
          {presenceLabel(identity.presenceMs)} · {videoTime(identity.firstMs)}–{videoTime(identity.lastMs)}
          {identity.jerseyNumber != null ? ` · #${identity.jerseyNumber}` : ""}
          {identity.trackCount > 1 ? ` · ${identity.trackCount} fragmentos` : ""}
        </div>
        {editing && (
          <div className="mt-2">
            <IdentityChooser
              identity={identity}
              squad={squad}
              onDone={() => {
                setEditing(false);
                onDone();
              }}
              onCancel={() => setEditing(false)}
            />
          </div>
        )}
      </div>
      {!editing && (
        <>
          <Pill tone={IDENTITY_TONE[identity.status]}>
            {IDENTITY_STATUS_LABEL[identity.status]}
            {identity.status === "accepted" && identity.proposedConfidence != null ? ` · ${pct(identity.proposedConfidence)}` : ""}
          </Pill>
          {mayWrite && (
            <button type="button" className="ctl-ghost h-7 text-meta" onClick={() => setEditing(true)}>
              Alterar
            </button>
          )}
        </>
      )}
    </li>
  );
}

function TrackRow({ track, crops }: { track: Track; crops: CropsIndex | null }) {
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
      <CropTile crops={crops} trackNumber={track.trackNumber} size="sm" />
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
    // O ficheiro foi-se depois de processar; o que a página mostra são os dados dele.
    video.status === "PURGED" ? "vídeo apagado após o processamento" : null,
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

/**
 * O que se diz por baixo da barra — e o que se deixou de dizer.
 *
 * Dizia sempre "podes fechar a consola, recebes uma notificação quando
 * terminar". Com nenhuma máquina de processamento ligada, isso é uma promessa
 * que ninguém pode cumprir: a análise fica na fila para sempre, o ecrã não
 * explica porquê, e quem espera fica a achar que o produto está avariado — em
 * vez de ir ligar o que falta.
 *
 * São três situações diferentes e três frases diferentes: não há ninguém a
 * processar; há, mas está ocupado; ou está mesmo a trabalhar nesta.
 */
function rodapeDoProgresso(detail: Detail): string {
  if (detail.status === "UPLOADING") return "Não feches este separador enquanto o vídeo sobe.";

  const aTrabalhar = detail.jobs.some((j) => j.status === "RUNNING" || j.status === "CLAIMED");
  if (aTrabalhar) return "Podes fechar a consola — recebes uma notificação quando terminar.";

  if (detail.workers.online === 0) {
    return "Nenhuma máquina de processamento está ligada — a análise fica na fila até haver uma. Nada se perde.";
  }

  // Ligada mas sem saber fazer a etapa: acontece quando o worker não tem os
  // modelos de detecção instalados e só anuncia a verificação de qualidade.
  const etapa = detail.jobs.find((j) => j.status === "PENDING")?.kind;
  if (etapa && !detail.workers.kinds.includes(etapa)) {
    return `A máquina ligada não faz a etapa "${JOB_LABEL[etapa] ?? etapa}" — a análise espera por uma que a faça.`;
  }

  return "Há uma máquina ligada, ocupada com outro trabalho. Esta entra a seguir — podes fechar a consola.";
}

function currentStage(detail: Detail): string {
  const running = detail.jobs.find((j) => j.status === "RUNNING" || j.status === "CLAIMED");
  if (running) return JOB_LABEL[running.kind] ?? running.kind;
  return "Na fila — à espera de um worker";
}

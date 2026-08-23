import { useCallback, useEffect, useRef, useState } from "react";
import { Empty, Loading, Panel, PanelHead, Pill, cx } from "./primitives";
import { Dialog, DialogField, dialogInputClass } from "./Dialog";
import { Plus, Trash2, TriangleAlert, Upload } from "@/lib/icons";
import { can } from "@/lib/permissions";
import type { Session } from "@/lib/permissions";
import {
  MOMENT_KIND_LABEL,
  VIDEO_KIND_LABEL,
  addMoment,
  completeUpload,
  deleteVideo,
  listVideos,
  playbackUrl,
  removeMoment,
  startUpload,
  timecode,
  type MomentKind,
  type Video,
  type VideoKind,
} from "@/lib/scouting";

/**
 * A biblioteca de vídeo do prospecto.
 *
 * ## Não é uma lista de anexos
 *
 * Um anexo é um ficheiro com um nome. Isto é uma gravação com contexto — que jogo,
 * contra quem, que prova, quanto durou — e com **momentos marcados**, que é a
 * única razão pela qual um scout prefere isto a uma pasta partilhada. "00:42 —
 * excelente passe vertical" é o que ele quer mandar ao director; um ficheiro de
 * noventa minutos com "vê aí para o meio" não é.
 *
 * ## A única superfície escura da consola
 *
 * E justificada: vídeo vê-se sobre preto. Tudo à volta continua claro e com
 * hairlines — o escuro é do leitor, não uma decisão de estilo que se espalha.
 *
 * ## Como os bytes viajam
 *
 * O servidor autoriza e devolve um URL assinado; o browser envia os bytes
 * directamente para o Storage. Um vídeo de 400&nbsp;MB a atravessar o processo da
 * API seria o caminho mais curto para o derrubar com três scouts a trabalhar.
 */
export function ProspectVideos({ prospectId, session }: { prospectId: string; session: Session }) {
  const [videos, setVideos] = useState<Video[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [playing, setPlaying] = useState<Video | null>(null);

  const mayRead = can(session, "scouting:video:read");
  const mayWrite = can(session, "scouting:video:write");

  const load = useCallback(() => {
    if (!mayRead) return;
    listVideos(prospectId)
      .then(setVideos)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Não foi possível carregar."));
  }, [prospectId, mayRead]);

  useEffect(load, [load]);

  /*
   * Sem permissão de vídeo, o separador diz porquê em vez de mostrar uma lista
   * vazia. Um ecrã vazio ensina que não há nada; isto ensina que há e que não é
   * para esta pessoa — que é a verdade, e a razão de a permissão existir.
   */
  if (!mayRead) {
    return (
      <Panel>
        <div className="px-5 py-16">
          <Empty
            title="Sem acesso ao vídeo"
            detail="As gravações de prospectos têm permissão própria — são imagem de menores que não pertencem à academia."
          />
        </div>
      </Panel>
    );
  }

  return (
    <>
      <Panel>
        <PanelHead title="Vídeos" hint={videos ? `${videos.length}` : undefined}>
          {mayWrite && (
            <button type="button" className="ctl-primary" onClick={() => setUploading(true)}>
              <Plus className="size-3.5" strokeWidth={2} />
              Carregar vídeo
            </button>
          )}
        </PanelHead>

        {error && <p className="px-5 py-3 text-meta text-risk">{error}</p>}

        {!videos && !error ? (
          <Loading size="panel" />
        ) : videos && videos.length === 0 ? (
          <div className="px-5 py-16">
            <Empty
              icon={Upload}
              title="Ainda sem vídeos"
              detail="Um jogo, um treino, um trial. Com momentos marcados, o dossiê passa a mostrar-se em trinta segundos."
            />
          </div>
        ) : (
          <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
            {videos?.map((v) => (
              <VideoCard key={v.id} video={v} onOpen={() => setPlaying(v)} />
            ))}
          </div>
        )}
      </Panel>

      {uploading && (
        <UploadDialog
          prospectId={prospectId}
          onClose={() => setUploading(false)}
          onDone={() => {
            setUploading(false);
            load();
          }}
        />
      )}

      {playing && (
        <PlayerDialog
          video={playing}
          mayWrite={mayWrite}
          onClose={() => {
            setPlaying(null);
            load();
          }}
        />
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */

function VideoCard({ video, onOpen }: { video: Video; onOpen: () => void }) {
  const highlights = video.moments.filter((m) => m.kind === "HIGHLIGHT").length;
  const concerns = video.moments.filter((m) => m.kind === "CONCERN").length;

  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={video.status !== "READY"}
      className="panel flex flex-col overflow-hidden p-0 text-left transition-colors duration-[120ms] hover:border-line-strong disabled:opacity-60"
    >
      {/* A miniatura é um bloco escuro com o código de tempo — não um frame. Um
          frame exigiria transcodificação no servidor, e o que identifica um vídeo
          de scouting é o título e o adversário, não a imagem parada. */}
      <div className="relative flex h-24 items-center justify-center bg-ink">
        <span className="font-mono text-[13px] text-white/70">
          {video.durationSec ? timecode(video.durationSec) : "—"}
        </span>
        {video.status === "UPLOADING" && (
          <span className="absolute inset-0 flex items-center justify-center bg-ink/80 text-meta text-white">
            a carregar…
          </span>
        )}
        {video.status === "FAILED" && (
          <span className="absolute inset-0 flex items-center justify-center gap-1.5 bg-ink/80 text-meta text-white">
            <TriangleAlert className="size-3.5" strokeWidth={1.75} />
            falhou
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-1.5 p-3">
        <span className="line-clamp-2 text-body font-medium text-ink">{video.title}</span>

        <span className="text-meta text-ink-3">
          {VIDEO_KIND_LABEL[video.kind]}
          {video.recordedOn && ` · ${new Date(video.recordedOn).toLocaleDateString("pt-PT")}`}
          {video.opponent && ` · vs ${video.opponent}`}
        </span>

        <div className="mt-auto flex flex-wrap items-center gap-1 pt-1">
          {highlights > 0 && <Pill tone="ok">{highlights} ★</Pill>}
          {concerns > 0 && <Pill tone="warn">{concerns} ⚠</Pill>}
          {video.tags.slice(0, 2).map((t) => (
            <Pill key={t}>{t}</Pill>
          ))}
        </div>
      </div>
    </button>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * O leitor, com a régua de momentos.
 *
 * Os marcadores vivem na barra de tempo e a lista ao lado; clicar num salta para
 * lá. Com o vídeo a correr, `M` marca o instante actual — o gesto que um scout faz
 * dez vezes por jogo tem de custar uma tecla, não um formulário.
 */
function PlayerDialog({
  video,
  mayWrite,
  onClose,
}: {
  video: Video;
  mayWrite: boolean;
  onClose: () => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [moments, setMoments] = useState(video.moments);
  const [duration, setDuration] = useState(video.durationSec ?? 0);
  const [at, setAt] = useState(0);
  const [marking, setMarking] = useState<number | null>(null);
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState<MomentKind>("HIGHLIGHT");

  useEffect(() => {
    playbackUrl(video.id)
      .then((r) => setUrl(r.url))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Não foi possível abrir o vídeo."));
  }, [video.id]);

  // `M` marca onde o vídeo está. Ignorada enquanto se escreve, senão a tecla
  // roubava letras ao campo de texto.
  useEffect(() => {
    if (!mayWrite) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") return;
      if (e.key.toLowerCase() !== "m") return;
      e.preventDefault();
      setMarking(Math.round(ref.current?.currentTime ?? 0));
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mayWrite]);

  function seek(seconds: number) {
    if (ref.current) {
      ref.current.currentTime = seconds;
      void ref.current.play();
    }
  }

  async function saveMoment() {
    if (marking === null || !label.trim()) return;
    const created = await addMoment(video.id, { atSec: marking, kind, label: label.trim() });
    setMoments((m) =>
      [...m, { id: created.id, atSec: marking, kind, label: label.trim(), createdBy: null }].sort(
        (a, b) => a.atSec - b.atSec,
      ),
    );
    setMarking(null);
    setLabel("");
  }

  return (
    <Dialog
      title={video.title}
      subtitle={[
        VIDEO_KIND_LABEL[video.kind],
        video.opponent ? `vs ${video.opponent}` : null,
        video.competition,
        video.recordedOn ? new Date(video.recordedOn).toLocaleDateString("pt-PT") : null,
      ]
        .filter(Boolean)
        .join(" · ")}
      onClose={onClose}
      width={980}
      labelledBy="video-player"
      footer={
        <>
          {mayWrite && (
            <button
              type="button"
              className="ctl-ghost mr-auto"
              onClick={() => void deleteVideo(video.id).then(onClose)}
            >
              <Trash2 className="size-3.5" strokeWidth={1.75} />
              Apagar vídeo
            </button>
          )}
          <button type="button" className="ctl-primary" onClick={onClose}>
            Fechar
          </button>
        </>
      }
    >
      <div className="grid gap-0 lg:grid-cols-[1fr_300px]">
        <div className="border-b border-line lg:border-r lg:border-b-0">
          <div className="bg-ink">
            {error ? (
              <div className="flex h-64 items-center justify-center px-5 text-center text-meta text-white/70">
                {error}
              </div>
            ) : url ? (
              <video
                ref={ref}
                src={url}
                controls
                className="max-h-[52vh] w-full bg-ink"
                onLoadedMetadata={(e) => {
                  const d = Math.round(e.currentTarget.duration);
                  setDuration(d);
                  // A duração real só se sabe depois de o browser ler o ficheiro —
                  // é aqui que se completa o registo do upload.
                  if (!video.durationSec && Number.isFinite(d)) void completeUpload(video.id, d);
                }}
                onTimeUpdate={(e) => setAt(e.currentTarget.currentTime)}
              />
            ) : (
              <div className="flex h-64 items-center justify-center text-meta text-white/50">a preparar…</div>
            )}
          </div>

          {/* A régua. Cada marcador é um momento, na posição real do vídeo. */}
          <div className="bg-ink px-4 pt-1 pb-4">
            <div className="relative h-6">
              <div className="absolute top-1/2 h-1 w-full -translate-y-1/2 rounded-full bg-white/15" />
              <div
                className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-white/40"
                style={{ width: duration ? `${(at / duration) * 100}%` : 0 }}
              />
              {moments.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  title={`${timecode(m.atSec)} · ${m.label}`}
                  onClick={() => seek(m.atSec)}
                  style={{ left: duration ? `${(m.atSec / duration) * 100}%` : 0 }}
                  className={cx(
                    "absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-ink transition-transform hover:scale-125",
                    m.kind === "HIGHLIGHT" && "bg-ok",
                    m.kind === "CONCERN" && "bg-warn",
                    m.kind === "NOTE" && "bg-white/70",
                  )}
                />
              ))}
            </div>

            <div className="flex items-center justify-between font-mono text-[11px] text-white/50">
              <span>{timecode(at)}</span>
              {mayWrite && <span>tecla M para marcar</span>}
              <span>{duration ? timecode(duration) : "—"}</span>
            </div>
          </div>
        </div>

        {/* Os momentos, em coluna. Códigos de tempo em monoespaçado — são números
            que se comparam, e uma fonte proporcional fá-los dançar. */}
        <div className="flex max-h-[60vh] flex-col">
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <span className="text-group text-ink-3 uppercase">Momentos</span>
            {mayWrite && (
              <button
                type="button"
                className="ctl-ghost"
                onClick={() => setMarking(Math.round(ref.current?.currentTime ?? 0))}
              >
                Marcar
              </button>
            )}
          </div>

          {marking !== null && (
            <div className="space-y-2 border-b border-line bg-sunken/50 px-4 py-3">
              <div className="font-mono text-[13px] text-ink">{timecode(marking)}</div>
              <DialogField label="O que aconteceu">
                <input
                  autoFocus
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void saveMoment()}
                  placeholder="Excelente passe vertical"
                  className={dialogInputClass}
                />
              </DialogField>
              <div className="flex gap-1.5">
                {(Object.keys(MOMENT_KIND_LABEL) as MomentKind[]).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setKind(k)}
                    className={cx(
                      "rounded-[var(--radius-control)] border px-2.5 py-1 text-meta font-medium",
                      kind === k ? "border-transparent bg-ink text-surface" : "border-line text-ink-2",
                    )}
                  >
                    {MOMENT_KIND_LABEL[k]}
                  </button>
                ))}
              </div>
              <div className="flex gap-1.5">
                <button type="button" className="ctl-primary" disabled={!label.trim()} onClick={() => void saveMoment()}>
                  Guardar
                </button>
                <button type="button" className="ctl-ghost" onClick={() => setMarking(null)}>
                  Cancelar
                </button>
              </div>
            </div>
          )}

          <ul className="flex-1 overflow-y-auto">
            {moments.length === 0 ? (
              <li className="px-4 py-10">
                <Empty
                  title="Sem momentos"
                  detail={mayWrite ? "Marca o que interessa com a tecla M." : "Ninguém marcou nada neste vídeo."}
                />
              </li>
            ) : (
              moments.map((m) => (
                <li key={m.id} className="flex items-start gap-2.5 border-b border-line px-4 py-2.5 last:border-0">
                  <button
                    type="button"
                    onClick={() => seek(m.atSec)}
                    className="shrink-0 font-mono text-[12px] font-medium text-signal hover:underline"
                  >
                    {timecode(m.atSec)}
                  </button>
                  <span
                    className={cx(
                      "mt-1.5 size-2 shrink-0 rounded-full",
                      m.kind === "HIGHLIGHT" && "bg-ok",
                      m.kind === "CONCERN" && "bg-warn",
                      m.kind === "NOTE" && "bg-ink-4",
                    )}
                  />
                  <span className="min-w-0 flex-1 text-body text-ink-2">{m.label}</span>
                  {mayWrite && (
                    <button
                      type="button"
                      aria-label="Apagar momento"
                      onClick={() => {
                        void removeMoment(m.id);
                        setMoments((list) => list.filter((x) => x.id !== m.id));
                      }}
                      className="shrink-0 text-ink-4 hover:text-risk"
                    >
                      <Trash2 className="size-3.5" strokeWidth={1.75} />
                    </button>
                  )}
                </li>
              ))
            )}
          </ul>
        </div>
      </div>

      {video.notes && (
        <p className="border-t border-line px-5 py-3 text-body leading-relaxed text-ink-2">{video.notes}</p>
      )}
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Carregar.
 *
 * Dois passos, e o segundo confirma que os bytes chegaram: sem ele, uma rede que
 * cai a meio deixava uma linha a dizer "pronto" com um ficheiro incompleto por
 * trás — e alguém a descobri-lo só ao tentar ver.
 */
function UploadDialog({
  prospectId,
  onClose,
  onDone,
}: {
  prospectId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<VideoKind>("MATCH");
  const [recordedOn, setRecordedOn] = useState("");
  const [opponent, setOpponent] = useState("");
  const [competition, setCompetition] = useState("");
  const [tags, setTags] = useState("");
  const [notes, setNotes] = useState("");

  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const valid = Boolean(file) && title.trim().length >= 2;

  async function submit() {
    if (!file || !valid || progress !== null) return;
    setError(null);
    setProgress(0);
    try {
      const started = await startUpload(prospectId, {
        title: title.trim(),
        kind,
        ...(recordedOn ? { recordedOn } : {}),
        ...(opponent.trim() ? { opponent: opponent.trim() } : {}),
        ...(competition.trim() ? { competition: competition.trim() } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean).slice(0, 12),
        mimeType: file.type,
        sizeBytes: file.size,
      });

      // Directo para o Storage. `XMLHttpRequest` e não `fetch` porque só ele dá
      // progresso de upload — e um vídeo de 400 MB sem barra é um ecrã parado.
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", started.uploadUrl);
        xhr.setRequestHeader("Content-Type", file.type);
        xhr.upload.onprogress = (e) => e.lengthComputable && setProgress(e.loaded / e.total);
        xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Falhou (${xhr.status})`)));
        xhr.onerror = () => reject(new Error("A ligação falhou a meio do carregamento"));
        xhr.send(file);
      });

      await completeUpload(started.id);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível carregar.");
      setProgress(null);
    }
  }

  return (
    <Dialog
      title="Carregar vídeo"
      subtitle="Fica privado — só quem tem acesso ao vídeo de scouting o consegue ver"
      onClose={onClose}
      width={520}
      labelledBy="upload-video"
      footer={
        <>
          {error && <span className="mr-auto text-meta text-risk">{error}</span>}
          <button type="button" className="ctl-ghost" onClick={onClose} disabled={progress !== null}>
            Cancelar
          </button>
          <button type="button" className="ctl-primary" disabled={!valid || progress !== null} onClick={() => void submit()}>
            {progress !== null ? `${Math.round(progress * 100)}%` : "Carregar"}
          </button>
        </>
      }
    >
      <div className="space-y-3 px-5 py-4">
        <DialogField label="Ficheiro" hint="mp4, mov, webm ou mkv">
          <input
            type="file"
            accept="video/mp4,video/quicktime,video/webm,video/x-matroska"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setFile(f);
              if (f && !title) setTitle(f.name.replace(/\.[^.]+$/, ""));
            }}
            className="w-full text-meta text-ink-2 file:mr-3 file:rounded-[var(--radius-control)] file:border file:border-line file:bg-surface file:px-2.5 file:py-1 file:text-meta file:text-ink"
          />
        </DialogField>

        <DialogField label="Título">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="FC X vs FC Y — 2.ª parte"
            className={dialogInputClass}
          />
        </DialogField>

        <div className="grid grid-cols-3 gap-3">
          <DialogField label="Tipo">
            <select value={kind} onChange={(e) => setKind(e.target.value as VideoKind)} className={dialogInputClass}>
              {(Object.keys(VIDEO_KIND_LABEL) as VideoKind[]).map((k) => (
                <option key={k} value={k}>
                  {VIDEO_KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </DialogField>
          <DialogField label="Gravado a" hint="opcional">
            <input type="date" value={recordedOn} onChange={(e) => setRecordedOn(e.target.value)} className={dialogInputClass} />
          </DialogField>
          <DialogField label="Adversário" hint="opcional">
            <input value={opponent} onChange={(e) => setOpponent(e.target.value)} className={dialogInputClass} />
          </DialogField>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <DialogField label="Prova" hint="opcional">
            <input value={competition} onChange={(e) => setCompetition(e.target.value)} className={dialogInputClass} />
          </DialogField>
          <DialogField label="Etiquetas" hint="por vírgulas">
            <input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="Passe, Construção, Pressão"
              className={dialogInputClass}
            />
          </DialogField>
        </div>

        <DialogField label="Notas" hint="opcional">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className={cx(dialogInputClass, "h-auto py-2 leading-relaxed")}
          />
        </DialogField>

        {progress !== null && (
          <div className="h-1 w-full overflow-hidden rounded-full bg-sunken">
            <div
              className="h-full rounded-full bg-signal transition-[width] duration-200"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
        )}
      </div>
    </Dialog>
  );
}

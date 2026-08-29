import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { PageHeader } from "@/components/Shell";
import { DialogField, dialogInputClass } from "@/components/Dialog";
import { DiagramPlayer, FieldEditor } from "@/components/FieldEditor";
import { Empty, Loading, Panel, PanelHead, cx } from "@/components/primitives";
import { Check, Copy, ExternalLink, Trash2, TriangleAlert } from "@/lib/icons";
import { can } from "@/lib/permissions";
import {
  OBJECTIVE_CATEGORIES,
  asDiagram,
  clubDefaultFormat,
  createExercise,
  deleteExercise,
  duplicateExercise,
  emptyDiagram,
  getExercise,
  removeExerciseImage,
  updateExercise,
  uploadExerciseImage,
  type Diagram,
  type ExerciseFull,
  type ExerciseImage,
} from "@/lib/training";

const EXERCISE_TYPES = ["Posse", "Vaga", "Jogo condicionado", "Jogo reduzido", "Circuito", "Finalização", "Analítico", "Rondo", "Onda/Transição"];
import { useSession } from "@/session";

type Draft = Omit<ExerciseFull, "id" | "authorName" | "updatedAt" | "mine" | "editable" | "visibility"> & {
  visibility: "PRIVATE" | "CLUB";
};

const BLANK: Draft = {
  images: [],
  deletable: true,
  name: "",
  description: null,
  category: null,
  objectives: [],
  phase: null,
  type: null,
  intensity: null,
  players: null,
  durationMin: null,
  space: null,
  material: null,
  ageMin: null,
  ageMax: null,
  complexity: null,
  rules: null,
  progressions: null,
  regressions: null,
  coachingPoints: null,
  commonErrors: null,
  videoUrl: null,
  visibility: "CLUB",
  diagram: null,
};

/**
 * A ficha de um exercício — e o sítio onde ele se desenha.
 *
 * O desenho ocupa o lado largo do ecrã porque é o trabalho; a ficha (nome,
 * objetivos, regras, correções) é o que faz o desenho ser reutilizável por
 * outra pessoa daqui a seis meses. Quem só vê (exercício de um colega) tem a
 * animação em vez do editor, e o botão certo é **Duplicar** — a versão dele.
 */
export default function ExerciseDetail() {
  const { id } = useParams();
  const isNew = !id || id === "novo";
  const navigate = useNavigate();
  const { session } = useSession();
  const mayWrite = can(session, "training:write");

  const [draft, setDraft] = useState<Draft | null>(isNew ? BLANK : null);
  const [editable, setEditable] = useState(isNew);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(isNew);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [mode, setMode] = useState<"edit" | "play">("edit");
  /** Da biblioteca base — sem autor e de ninguém. O `Draft` não guarda a
   *  autoria (é só o que se grava), por isso a resposta fica aqui. */
  const [isBase, setIsBase] = useState(false);

  useEffect(() => {
    if (isNew) {
      setDraft(BLANK);
      setEditable(true);
      setMode("edit");
      setIsBase(false);
      return;
    }
    setDraft(null);
    getExercise(id!)
      .then((e) => {
        setDraft({ ...e, visibility: e.visibility });
        setIsBase(!e.authorName && !e.mine);
        setEditable(e.editable && mayWrite);
        setMode(e.editable && mayWrite ? "edit" : "play");
      })
      .catch((e: Error) => setError(e.message));
  }, [id, isNew, mayWrite]);

  const patch = (p: Partial<Draft>) => {
    setDraft((d) => (d ? { ...d, ...p } : d));
    setDirty(true);
    setSaved(false);
  };

  async function save() {
    if (!draft || saving) return;
    if (!draft.name.trim()) {
      alert("Dá um nome ao exercício.");
      return;
    }
    setSaving(true);
    try {
      /*
       * O corpo constrói-se campo a campo, nunca por spread do rascunho.
       *
       * O rascunho vem de `getExercise` e traz o que a leitura traz — `id`,
       * `mine`, `editable`, `authorName`, `updatedAt`, `images` — e o validador
       * do servidor recusa qualquer campo a mais (`forbidNonWhitelisted`). Um
       * spread gravava exercícios novos (que partem do BLANK, certinho) e
       * rebentava só ao editar um existente — o pior tipo de bug para se apanhar.
       */
      const payload = {
        name: draft.name,
        description: draft.description,
        category: draft.category,
        objectives: draft.objectives,
        phase: draft.phase,
        type: draft.type,
        intensity: draft.intensity,
        players: draft.players,
        durationMin: draft.durationMin,
        space: draft.space,
        material: draft.material,
        ageMin: draft.ageMin,
        ageMax: draft.ageMax,
        complexity: draft.complexity,
        rules: draft.rules,
        progressions: draft.progressions,
        regressions: draft.regressions,
        coachingPoints: draft.coachingPoints,
        commonErrors: draft.commonErrors,
        videoUrl: draft.videoUrl,
        visibility: draft.visibility,
        diagram: draft.diagram,
      };
      if (isNew) {
        const { id: newId } = await createExercise(payload);
        navigate(`/exercicios/${newId}`, { replace: true });
      } else {
        await updateExercise(id!, payload);
        setDirty(false);
        setSaved(true);
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : "Não foi possível gravar.");
    } finally {
      setSaving(false);
    }
  }

  async function duplicate() {
    if (isNew) return;
    const { id: copyId } = await duplicateExercise(id!);
    navigate(`/exercicios/${copyId}`);
  }

  async function remove() {
    if (isNew) return;
    if (!confirm("Apagar este exercício? Se já entrou em treinos, é arquivado e o histórico mantém-se.")) return;
    await deleteExercise(id!);
    navigate("/exercicios");
  }

  if (error) {
    return (
      <Panel>
        <Empty title="Exercício não encontrado" detail={error} icon={TriangleAlert}>
          <Link to="/exercicios" className="ctl-outline">
            Voltar à biblioteca
          </Link>
        </Empty>
      </Panel>
    );
  }
  if (!draft) return <Loading />;

  const diagram = asDiagram(draft.diagram);

  return (
    <>
      <PageHeader
        eyebrow="Biblioteca de exercícios"
        title={isNew ? "Novo exercício" : draft.name || "Exercício"}
        /*
         * Três casos, três frases. O que é da biblioteca base precisa de ser
         * dito: quem o abre pergunta-se de onde veio, e a resposta explica ao
         * mesmo tempo porque é que o pode editar e não o pode apagar.
         */
        subtitle={
          isNew
            ? undefined
            : !editable
              ? "Exercício de outro treinador — duplica-o para o adaptar."
              : isBase
                ? "Da biblioteca base, que vem com a Academias — podes afiná-lo à tua maneira, ou duplicá-lo para guardar a tua versão."
                : undefined
        }
      >
        <Link to="/exercicios" className="ctl-ghost">
          Biblioteca
        </Link>
        {!isNew && mayWrite && (
          <button type="button" className="ctl-outline" onClick={duplicate}>
            <Copy className="size-3.5" strokeWidth={1.75} />
            Duplicar
          </button>
        )}
        {!isNew && editable && draft.deletable && (
          <button type="button" className="ctl-ghost text-risk hover:bg-risk-soft hover:text-risk" onClick={remove}>
            <Trash2 className="size-3.5" strokeWidth={1.75} />
          </button>
        )}
        {editable && (
          <button type="button" className="ctl-primary" onClick={save} disabled={saving || (!dirty && !isNew)}>
            {saved && !dirty ? (
              <>
                <Check className="size-3.5" strokeWidth={2} /> Guardado
              </>
            ) : saving ? (
              "A guardar…"
            ) : isNew ? (
              "Criar exercício"
            ) : (
              "Guardar"
            )}
          </button>
        )}
      </PageHeader>

      <div className="grid gap-3 xl:grid-cols-3">
        {/* O desenho */}
        <Panel className="xl:col-span-2 self-start">
          <PanelHead title="Desenho tático" hint={diagram && diagram.frames.length > 1 ? `${diagram.frames.length} frames` : undefined}>
            {editable && diagram && diagram.frames.length >= 1 && (
              <div className="inline-flex overflow-hidden rounded-[var(--radius-control)] border border-line">
                {(
                  [
                    ["edit", "Editar"],
                    ["play", "Animação"],
                  ] as const
                ).map(([m, label]) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMode(m)}
                    className={cx("h-8 px-2.5 text-meta font-medium transition-colors", mode === m ? "bg-ink text-surface" : "bg-surface text-ink-2 hover:bg-sunken")}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </PanelHead>
          <div className="p-4">
            {editable && mode === "edit" ? (
              <FieldEditor
                key={isNew ? "novo" : id}
                initial={draft.diagram ?? emptyDiagram(clubDefaultFormat())}
                onChange={(d: Diagram) => patch({ diagram: d })}
              />
            ) : diagram ? (
              <DiagramPlayer diagram={draft.diagram} />
            ) : (
              <Empty title="Sem desenho" detail="Este exercício foi descrito por palavras — o desenho pode juntar-se a qualquer momento." compact />
            )}
          </div>
        </Panel>

        {/* A ficha */}
        <div className="space-y-3">
          <Panel>
            <PanelHead title="Ficha" />
            <div className="space-y-3.5 p-5">
              <DialogField label="Nome">
                <input className={dialogInputClass} value={draft.name} onChange={(e) => patch({ name: e.target.value })} placeholder='Ex.: "Posse 6v4 — saída sob pressão"' disabled={!editable} />
              </DialogField>

              {editable && (
                <DialogField label="Quem o vê">
                  {/* Dois cartões com a consequência escrita — o padrão dos relatórios. */}
                  <div className="grid grid-cols-2 gap-2">
                    {(
                      [
                        ["CLUB", "Todo o clube", "entra na biblioteca de todos os treinadores"],
                        ["PRIVATE", "Só eu", "fica nos meus exercícios até eu o partilhar"],
                      ] as const
                    ).map(([v, label, hint]) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => patch({ visibility: v })}
                        className={cx(
                          "rounded-[var(--radius-control)] border p-2.5 text-left transition-colors",
                          draft.visibility === v ? "border-line-strong bg-sunken/60" : "border-line hover:border-line-strong",
                        )}
                      >
                        <div className="text-meta font-semibold text-ink">{label}</div>
                        <div className="mt-0.5 text-[11px] leading-snug text-ink-3">{hint}</div>
                      </button>
                    ))}
                  </div>
                </DialogField>
              )}

              <DialogField label="Objetivo">
                <select
                  className={dialogInputClass}
                  value={draft.category ?? ""}
                  onChange={(e) => patch({ category: e.target.value || null })}
                  disabled={!editable}
                >
                  <option value="">Sem categoria</option>
                  {OBJECTIVE_CATEGORIES.map((c) => (
                    <option key={c.key} value={c.label}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </DialogField>

              {draft.category && (
                <DialogField label="Sub-objetivos">
                  <div className="flex flex-wrap gap-1.5">
                    {(OBJECTIVE_CATEGORIES.find((c) => c.label === draft.category)?.subs ?? []).map((s) => {
                      const on = draft.objectives.includes(s);
                      return (
                        <button
                          key={s}
                          type="button"
                          disabled={!editable}
                          onClick={() =>
                            patch({ objectives: on ? draft.objectives.filter((x) => x !== s) : [...draft.objectives, s] })
                          }
                          className={cx(
                            "rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors",
                            on ? "bg-signal-soft text-signal-ink" : "bg-sunken text-ink-3 hover:text-ink",
                          )}
                        >
                          {s}
                        </button>
                      );
                    })}
                  </div>
                </DialogField>
              )}

              <div className="grid grid-cols-2 gap-3">
                <DialogField label="Tipo">
                  {/* Um select como os vizinhos — o datalist desenhava-se
                      diferente do resto do formulário. Um valor antigo fora da
                      lista continua lá, como opção própria. */}
                  <select
                    className={dialogInputClass}
                    value={draft.type ?? ""}
                    onChange={(e) => patch({ type: e.target.value || null })}
                    disabled={!editable}
                  >
                    <option value="">Sem tipo</option>
                    {EXERCISE_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                    {draft.type && !EXERCISE_TYPES.includes(draft.type) && <option value={draft.type}>{draft.type}</option>}
                  </select>
                </DialogField>
                <DialogField label="Jogadores">
                  <input className={dialogInputClass} value={draft.players ?? ""} onChange={(e) => patch({ players: e.target.value || null })} placeholder="6v4+GR" disabled={!editable} />
                </DialogField>
                <DialogField label="Duração (min)">
                  <input type="number" min={1} max={240} className={dialogInputClass} value={draft.durationMin ?? ""} onChange={(e) => patch({ durationMin: e.target.value === "" ? null : Number(e.target.value) })} disabled={!editable} />
                </DialogField>
                <DialogField label="Dimensões">
                  <input className={dialogInputClass} value={draft.space ?? ""} onChange={(e) => patch({ space: e.target.value || null })} placeholder="30×25 m" disabled={!editable} />
                </DialogField>
                <DialogField label="Idades">
                  <div className="flex items-center gap-1.5">
                    <input type="number" min={4} max={99} className={dialogInputClass} value={draft.ageMin ?? ""} onChange={(e) => patch({ ageMin: e.target.value === "" ? null : Number(e.target.value) })} placeholder="8" disabled={!editable} />
                    <span className="text-ink-4">–</span>
                    <input type="number" min={4} max={99} className={dialogInputClass} value={draft.ageMax ?? ""} onChange={(e) => patch({ ageMax: e.target.value === "" ? null : Number(e.target.value) })} placeholder="12" disabled={!editable} />
                  </div>
                </DialogField>
                <DialogField label="Complexidade" hint={draft.complexity ? `${draft.complexity}/5` : undefined}>
                  <input type="range" min={1} max={5} value={draft.complexity ?? 3} onChange={(e) => patch({ complexity: Number(e.target.value) })} className="mt-2.5 w-full accent-[var(--color-signal)]" disabled={!editable} />
                </DialogField>
              </div>

              <DialogField label="Intensidade" hint={draft.intensity ? `${draft.intensity}/10` : "por definir"}>
                <input type="range" min={1} max={10} value={draft.intensity ?? 5} onChange={(e) => patch({ intensity: Number(e.target.value) })} className="w-full accent-[var(--color-signal)]" disabled={!editable} />
              </DialogField>

              <DialogField label="Material">
                <input className={dialogInputClass} value={draft.material ?? ""} onChange={(e) => patch({ material: e.target.value || null })} placeholder="8 cones, coletes, 2 mini-balizas" disabled={!editable} />
              </DialogField>

              <DialogField label="Vídeo" hint="link externo">
                <div className="flex items-center gap-1.5">
                  <input className={dialogInputClass} value={draft.videoUrl ?? ""} onChange={(e) => patch({ videoUrl: e.target.value || null })} placeholder="https://…" disabled={!editable} />
                  {draft.videoUrl && (
                    <a href={draft.videoUrl} target="_blank" rel="noreferrer" className="ctl-outline size-9 shrink-0 justify-center px-0" aria-label="Abrir vídeo">
                      <ExternalLink className="size-4" strokeWidth={1.75} />
                    </a>
                  )}
                </div>
              </DialogField>
            </div>
          </Panel>

          <Panel>
            <PanelHead title="Imagens" hint="montagem, prancheta, quadro" />
            <ImagesPanel
              exerciseId={isNew ? null : id!}
              images={draft.images}
              editable={editable}
              onChange={(images) => setDraft((d) => (d ? { ...d, images } : d))}
            />
          </Panel>

          <Panel>
            <PanelHead title="Como executar" />
            <div className="space-y-3.5 p-5">
              <TextBlock label="Organização e descrição" value={draft.description} onChange={(v) => patch({ description: v })} editable={editable} placeholder="Como se monta, quem faz o quê." />
              <TextBlock label="Regras" value={draft.rules} onChange={(v) => patch({ rules: v })} editable={editable} placeholder="Toques, limites, pontuação." />
              <TextBlock label="Comportamentos esperados" value={draft.coachingPoints} onChange={(v) => patch({ coachingPoints: v })} editable={editable} placeholder="O que o treinador corrige e reforça." />
              <TextBlock label="Erros frequentes" value={draft.commonErrors} onChange={(v) => patch({ commonErrors: v })} editable={editable} />
              <TextBlock label="Progressões" value={draft.progressions} onChange={(v) => patch({ progressions: v })} editable={editable} placeholder="Como dificultar." />
              <TextBlock label="Regressões" value={draft.regressions} onChange={(v) => patch({ regressions: v })} editable={editable} placeholder="Como simplificar." />
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}

/**
 * As imagens do exercício.
 *
 * Gravam-se na hora (autorizar → carregar direto para o Supabase → confirmar,
 * como as fotografias), não à espera do "Guardar" — meio upload pendurado num
 * botão de gravar era a receita para imagens órfãs. Num exercício por criar
 * ainda não há onde as pendurar, e o painel di-lo em vez de fingir que dá.
 */
function ImagesPanel({
  exerciseId,
  images,
  editable,
  onChange,
}: {
  exerciseId: string | null;
  images: ExerciseImage[];
  editable: boolean;
  onChange: (images: ExerciseImage[]) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  async function pick(files: FileList | null) {
    if (!files || !exerciseId) return;
    setBusy(true);
    try {
      for (const file of Array.from(files).slice(0, 6 - images.length)) {
        const img = await uploadExerciseImage(exerciseId, file);
        onChange([...images.filter((i) => i.key !== img.key), img]);
        images = [...images, img];
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : "Não foi possível carregar a imagem.");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function remove(key: string) {
    if (!exerciseId) return;
    await removeExerciseImage(exerciseId, key);
    onChange(images.filter((i) => i.key !== key));
  }

  if (!editable && images.length === 0) {
    return <div className="px-5 py-4 text-meta text-ink-4">Sem imagens.</div>;
  }

  return (
    <div className="space-y-3 p-5">
      {images.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {images.map((img) => (
            <div key={img.key} className="group relative">
              <button type="button" className="block w-full" onClick={() => setPreview(img.url)} aria-label="Ampliar imagem">
                <img src={img.url} alt="" className="aspect-[4/3] w-full rounded-[var(--radius-control)] border border-line object-cover" />
              </button>
              {editable && (
                <button
                  type="button"
                  aria-label="Remover imagem"
                  onClick={() => void remove(img.key)}
                  className="absolute top-1 right-1 inline-flex size-6 items-center justify-center rounded-full bg-black/45 text-white opacity-0 transition-opacity group-hover:opacity-100"
                >
                  <Trash2 className="size-3" strokeWidth={1.75} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {editable &&
        (exerciseId === null ? (
          <p className="text-meta text-ink-4">Cria o exercício primeiro — as imagens juntam-se logo a seguir.</p>
        ) : images.length >= 6 ? (
          <p className="text-meta text-ink-4">Seis imagens é o máximo — remove uma para juntar outra.</p>
        ) : (
          <>
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(e) => void pick(e.target.files)} />
            <button type="button" className="ctl-outline" onClick={() => fileRef.current?.click()} disabled={busy}>
              {busy ? "A carregar…" : "Juntar imagem"}
            </button>
          </>
        ))}

      {preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-6" onClick={() => setPreview(null)}>
          <img src={preview} alt="" className="max-h-full max-w-full rounded-[var(--radius-panel)]" />
        </div>
      )}
    </div>
  );
}

/** Um campo de texto da ficha: textarea a editar, prosa a ler, nada quando vazio. */
function TextBlock({
  label,
  value,
  onChange,
  editable,
  placeholder,
}: {
  label: string;
  value: string | null;
  onChange: (v: string | null) => void;
  editable: boolean;
  placeholder?: string;
}) {
  if (!editable && !value) return null;
  return (
    <DialogField label={label}>
      {editable ? (
        <textarea
          rows={2}
          className={cx(dialogInputClass, "h-auto py-2")}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value || null)}
          placeholder={placeholder}
        />
      ) : (
        <p className="text-body whitespace-pre-wrap text-ink-2">{value}</p>
      )}
    </DialogField>
  );
}

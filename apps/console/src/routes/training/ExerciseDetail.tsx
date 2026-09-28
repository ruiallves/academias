import { useEffect, useRef, useState, type DragEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { PageHeader } from "@/components/Shell";
import { DialogField, dialogInputClass } from "@/components/Dialog";
import { DiagramPlayer, FieldEditor } from "@/components/FieldEditor";
import { Empty, Loading, Panel, PanelHead, cx } from "@/components/primitives";
import { Campo, Check, Copy, Download, Expand, ExternalLink, ImagePlus, Images, Trash2, TriangleAlert, X } from "@/lib/icons";
import { can } from "@/lib/permissions";
import {
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
import { useSession } from "@/session";
import { useSportArea } from "./sport-area-context";

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
  sportId: null,
};

/**
 * Um exercício mostra-se de uma de duas maneiras: desenhado no campo, ou com
 * imagens (a fotografia do quadro, da montagem, de uma prancheta).
 *
 * Não se guarda à parte: um exercício com desenho é de campo, um sem desenho e
 * com imagens é de imagens. Um sem nada abre no campo, que é como sempre abriu.
 */
type Tipo = "campo" | "imagens";

/** Uma imagem escolhida num exercício ainda por criar: sobe depois de ele existir. */
type Pendente = { id: string; file: File; url: string };

/** Até seis imagens por exercício — o mesmo tecto do servidor. */
const MAX_IMAGENS = 6;

/**
 * A ficha de um exercício — e o sítio onde ele se desenha ou se mostra.
 *
 * O desenho (ou as imagens) ocupa o lado largo do ecrã porque é o trabalho; a
 * ficha (nome, objetivos, regras, correções), à direita, é o que faz o exercício
 * ser reutilizável por outra pessoa daqui a seis meses. Esteve a largura toda,
 * com a ficha por baixo, e voltou a isto a pedido do Rui.
 *
 * Quem só vê (exercício de um colega) tem a animação em vez do editor, e o botão
 * certo é **Duplicar** — a versão dele.
 */
export default function ExerciseDetail() {
  const { id } = useParams();
  const isNew = !id || id === "novo";
  const navigate = useNavigate();
  const { session } = useSession();
  const mayWrite = can(session, "training:write");
  /*
   * A modalidade veste a ficha: as categorias de objectivo, os tipos de
   * exercício, os exemplos nos campos e o que o editor oferece vêm do perfil —
   * e o exercício nasce **desta** modalidade (`sportId`), que é o que o põe na
   * biblioteca certa.
   */
  const { sport, profile, path } = useSportArea();
  const categories = profile.exercises.categories;
  const types = profile.exercises.types;
  const ph = profile.exercises.placeholders;
  // O terreno de partida: o das equipas desta modalidade, se cabe no perfil.
  const suggested = clubDefaultFormat(sport.id);
  const startFormat = profile.vocabulary.formats.includes(suggested) ? suggested : profile.defaultFormat;

  const [draft, setDraft] = useState<Draft | null>(isNew ? BLANK : null);
  const [editable, setEditable] = useState(isNew);
  const [error, setError] = useState<string | null>(null);
  /*
   * O PDF, pedido a pedido.
   *
   * `import()` dinâmico: o `jspdf` são umas centenas de kilobytes que só fazem
   * falta a quem carrega no botão. E o erro aparece no ecrã em vez de morrer na
   * consola do browser — quem carrega em Exportar e não vê nada acontecer
   * carrega outra vez.
   */
  const [aExportar, setAExportar] = useState(false);
  async function exportarPdf() {
    if (!draft) return;
    setAExportar(true);
    try {
      const pdf = await import("@/lib/training-pdf");
      await pdf.exportarExercicio(draft!);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível gerar o PDF.");
    } finally {
      setAExportar(false);
    }
  }

  const [dirty, setDirty] = useState(isNew);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [mode, setMode] = useState<"edit" | "play">("edit");
  /** Da biblioteca base — sem autor e de ninguém. O `Draft` não guarda a
   *  autoria (é só o que se grava), por isso a resposta fica aqui. */
  const [isBase, setIsBase] = useState(false);
  /*
   * Campo ou imagens. Mudar não apaga nada até se guardar: o desenho fica no
   * rascunho, e só não vai no pedido se o tipo for imagens. Quem troca e volta
   * atrás encontra o desenho onde o deixou.
   */
  const [tipo, setTipo] = useState<Tipo>("campo");
  /** As imagens escolhidas num exercício por criar. Ver `Pendente`. */
  const [pendentes, setPendentes] = useState<Pendente[]>([]);

  useEffect(() => {
    if (isNew) {
      setDraft(BLANK);
      setEditable(true);
      setMode("edit");
      setIsBase(false);
      setTipo("campo");
      setPendentes([]);
      return;
    }
    setDraft(null);
    getExercise(id!)
      .then((e) => {
        setDraft({ ...e, visibility: e.visibility });
        setIsBase(!e.authorName && !e.mine);
        setEditable(e.editable && mayWrite);
        setMode(e.editable && mayWrite ? "edit" : "play");
        setTipo(!e.diagram && e.images.length > 0 ? "imagens" : "campo");
      })
      .catch((e: Error) => setError(e.message));
  }, [id, isNew, mayWrite]);

  /*
   * As pré-visualizações locais libertam-se ao sair da página, senão ficam em
   * memória. Pela referência e só no fim: um efeito com `pendentes` nas
   * dependências libertava a cada imagem nova as que ainda estão no ecrã.
   */
  const pendentesRef = useRef(pendentes);
  pendentesRef.current = pendentes;
  useEffect(() => () => pendentesRef.current.forEach((p) => URL.revokeObjectURL(p.url)), []);

  function escolherTipo(t: Tipo) {
    if (t === tipo) return;
    setTipo(t);
    setDirty(true);
    setSaved(false);
  }

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
        // Um exercício de imagens não leva desenho: é o que o faz ser de imagens.
        diagram: tipo === "imagens" ? null : draft.diagram,
        sportId: sport.id,
      };
      if (isNew) {
        const { id: newId } = await createExercise(payload);
        /*
         * As imagens escolhidas antes de o exercício existir sobem agora. Uma
         * que falhe não desfaz o exercício: diz-se qual, e junta-se na ficha.
         */
        const falharam: string[] = [];
        if (tipo === "imagens") {
          for (const p of pendentes) {
            try {
              await uploadExerciseImage(newId, p.file);
            } catch {
              falharam.push(p.file.name);
            }
          }
        }
        if (falharam.length > 0) {
          alert(`O exercício foi criado, mas não foi possível carregar: ${falharam.join(", ")}. Podes juntá-las na ficha.`);
        }
        navigate(path("exercises", newId), { replace: true });
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
    navigate(path("exercises", copyId));
  }

  async function remove() {
    if (isNew) return;
    if (!confirm("Apagar este exercício? Se já entrou em treinos, é arquivado e o histórico mantém-se.")) return;
    await deleteExercise(id!);
    navigate(path("exercises"));
  }

  if (error) {
    return (
      <Panel>
        <Empty title="Exercício não encontrado" detail={error} icon={TriangleAlert}>
          <Link to={path("exercises")} className="ctl-outline">
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
        eyebrow={`${sport.name} · ${profile.exercises.label}`}
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
        <Link to={path("exercises")} className="ctl-ghost">
          {profile.exercises.label}
        </Link>
        {/* Sem gravar é uma ficha por acabar — mas um exercício novo ainda sem
            nome não é uma folha, é uma folha em branco. */}
        {!isNew && (
          <button type="button" className="ctl-outline" onClick={() => void exportarPdf()} disabled={aExportar}>
            <Download className="size-3.5" strokeWidth={1.75} />
            {aExportar ? "A gerar…" : "PDF"}
          </button>
        )}
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

      {/*
        Ao criar, a primeira pergunta: como se mostra este exercício. Dois
        cartões com o que cada um dá, e não um selector escondido num canto.
      */}
      {isNew && <EscolhaDoTipo tipo={tipo} onChange={escolherTipo} />}

      <div className="grid gap-3 xl:grid-cols-3">
        {tipo === "campo" ? (
          <Panel className="xl:col-span-2 self-start">
            <PanelHead title="Desenho tático" hint={diagram && diagram.frames.length > 1 ? `${diagram.frames.length} frames` : undefined}>
              <div className="flex items-center gap-2">
                {editable && diagram && diagram.frames.length >= 1 && (
                  <Alternador
                    valor={mode}
                    onChange={setMode}
                    opcoes={[
                      ["edit", "Editar"],
                      ["play", "Animação"],
                    ]}
                  />
                )}
                {editable && !isNew && <TrocarTipo tipo={tipo} onChange={escolherTipo} />}
              </div>
            </PanelHead>
            <div className="p-4">
              {editable && mode === "edit" ? (
                <FieldEditor
                  key={isNew ? "novo" : id}
                  initial={draft.diagram ?? emptyDiagram(startFormat)}
                  onChange={(d: Diagram) => patch({ diagram: d })}
                  vocabulary={profile.vocabulary}
                />
              ) : diagram ? (
                <DiagramPlayer diagram={draft.diagram} />
              ) : (
                <Empty title="Sem desenho" detail="Este exercício foi descrito por palavras — o desenho pode juntar-se a qualquer momento." compact />
              )}
            </div>
          </Panel>
        ) : (
          <Panel className="xl:col-span-2 self-start">
            <PanelHead
              title="Imagens"
              hint={
                draft.images.length + pendentes.length > 0
                  ? `${draft.images.length + pendentes.length} de ${MAX_IMAGENS}`
                  : "o quadro, a montagem, uma prancheta"
              }
            >
              {editable && !isNew && <TrocarTipo tipo={tipo} onChange={escolherTipo} />}
            </PanelHead>
            {/* Trocou de campo para imagens: o desenho só sai ao guardar. */}
            {editable && !isNew && diagram && (
              <p className="border-b border-line bg-warn-soft/50 px-5 py-2 text-meta text-ink-2">
                Este exercício tem um desenho. Ao guardar como imagens, o desenho deixa de fazer parte dele.
              </p>
            )}
            <GaleriaDeImagens
              exerciseId={isNew ? null : id!}
              images={draft.images}
              pendentes={pendentes}
              editable={editable}
              onImages={(images) => setDraft((d) => (d ? { ...d, images } : d))}
              onPendentes={setPendentes}
            />
          </Panel>
        )}

        {/* A ficha, à direita do desenho. */}
        <div className="space-y-3">
          <Panel>
            <PanelHead title="Ficha" />
            <div className="space-y-3.5 p-5">
              <DialogField label="Nome">
                <input className={dialogInputClass} value={draft.name} onChange={(e) => patch({ name: e.target.value })} placeholder={ph.name} disabled={!editable} />
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
                  {categories.map((c) => (
                    <option key={c.key} value={c.label}>
                      {c.label}
                    </option>
                  ))}
                  {/* Uma categoria de outro vocabulário (exercício importado,
                      mudança de perfil) continua lá, como opção própria. */}
                  {draft.category && !categories.some((c) => c.label === draft.category) && (
                    <option value={draft.category}>{draft.category}</option>
                  )}
                </select>
              </DialogField>

              {draft.category && (
                <DialogField label="Sub-objetivos">
                  <div className="flex flex-wrap gap-1.5">
                    {(categories.find((c) => c.label === draft.category)?.subs ?? []).map((s) => {
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
                    {types.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                    {draft.type && !types.includes(draft.type) && <option value={draft.type}>{draft.type}</option>}
                  </select>
                </DialogField>
                <DialogField label="Jogadores">
                  <input className={dialogInputClass} value={draft.players ?? ""} onChange={(e) => patch({ players: e.target.value || null })} placeholder={ph.players} disabled={!editable} />
                </DialogField>
                <DialogField label="Duração (min)">
                  <input type="number" min={1} max={240} className={dialogInputClass} value={draft.durationMin ?? ""} onChange={(e) => patch({ durationMin: e.target.value === "" ? null : Number(e.target.value) })} disabled={!editable} />
                </DialogField>
                <DialogField label="Dimensões">
                  <input className={dialogInputClass} value={draft.space ?? ""} onChange={(e) => patch({ space: e.target.value || null })} placeholder={ph.space} disabled={!editable} />
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
                <input className={dialogInputClass} value={draft.material ?? ""} onChange={(e) => patch({ material: e.target.value || null })} placeholder={ph.material} disabled={!editable} />
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

          {/*
            Onde este exercício entra — os sistemas e as situações que o
            escolheram para se treinarem. É a ligação inversa da ficha do
            sistema, e é o que diz a quem edita o exercício para que é que ele
            serve na metodologia do clube.
          */}
          {draft.usedIn && (draft.usedIn.gameModels.length > 0 || draft.usedIn.setPieces.length > 0) && (
            <Panel>
              <PanelHead title="Onde entra" hint="o que se treina com ele" />
              <ul className="divide-y divide-line">
                {draft.usedIn.gameModels.map((g) => (
                  <li key={g.id} className="flex items-center gap-2 px-5 py-2.5">
                    <span className="w-28 shrink-0 text-meta text-ink-4">{profile.playbook.label}</span>
                    <Link to={path("playbook", g.id)} className="min-w-0 flex-1 truncate text-body text-ink hover:underline">
                      {g.name}
                    </Link>
                  </li>
                ))}
                {draft.usedIn.setPieces.map((p) => (
                  <li key={p.id} className="flex items-center gap-2 px-5 py-2.5">
                    <span className="w-28 shrink-0 text-meta text-ink-4">{profile.situations.label}</span>
                    <Link to={path("situations", p.id)} className="min-w-0 flex-1 truncate text-body text-ink hover:underline">
                      {p.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          {/*
            Um exercício de campo com imagens de antes desta escolha: as
            imagens continuam lá, e mostram-se aqui em vez de desaparecerem.
          */}
          {tipo === "campo" && draft.images.length > 0 && (
            <Panel>
              <PanelHead title="Imagens" hint="montagem, prancheta, quadro" />
              <ImagesPanel
                exerciseId={isNew ? null : id!}
                images={draft.images}
                editable={editable}
                onChange={(images) => setDraft((d) => (d ? { ...d, images } : d))}
              />
            </Panel>
          )}

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

/* -------------------------------------------------------------------------- */
/* Campo ou imagens                                                            */
/* -------------------------------------------------------------------------- */

const TIPOS: { value: Tipo; titulo: string; texto: string; Icon: typeof Campo }[] = [
  {
    value: "campo",
    titulo: "Desenhar no campo",
    texto: "Jogadores, bolas e setas no terreno da modalidade, com animação por frames.",
    Icon: Campo,
  },
  {
    value: "imagens",
    titulo: "Com imagens",
    texto: "A fotografia do quadro, da montagem ou de uma prancheta. Até seis imagens.",
    Icon: Images,
  },
];

/**
 * A primeira pergunta de um exercício novo, em dois cartões.
 *
 * Cartões e não um selector: é uma decisão que muda o resto da página, e cada
 * cartão diz o que dá. O escolhido levanta-se com a borda e o fundo, sem a cor
 * do clube, como o resto dos controlos de escolha (ver `Segmented`).
 */
function EscolhaDoTipo({ tipo, onChange }: { tipo: Tipo; onChange: (t: Tipo) => void }) {
  return (
    <div className="mb-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]" role="radiogroup" aria-label="Como se mostra o exercício">
      {TIPOS.map(({ value, titulo, texto, Icon }) => {
        const on = tipo === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(value)}
            className={cx(
              "panel flex items-start gap-3.5 p-4 text-left transition-[border-color,background-color,box-shadow] duration-150",
              on ? "border-line-strong bg-sunken/50 shadow-[0_1px_2px_rgb(26_25_23/0.06)]" : "hover:border-line-strong",
            )}
          >
            <span
              className={cx(
                "flex size-11 shrink-0 items-center justify-center rounded-[12px] transition-colors",
                on ? "bg-ink text-surface" : "bg-sunken text-ink-3",
              )}
            >
              <Icon className="size-5" strokeWidth={1.6} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="text-body font-semibold text-ink">{titulo}</span>
                {on && <Check className="size-3.5 text-ink-2" strokeWidth={2.25} />}
              </span>
              <span className="mt-0.5 block text-meta leading-snug text-ink-3">{texto}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** O mesmo alternador compacto dos dois modos do editor, para trocar de tipo depois de criado. */
function TrocarTipo({ tipo, onChange }: { tipo: Tipo; onChange: (t: Tipo) => void }) {
  return (
    <Alternador
      valor={tipo}
      onChange={onChange}
      opcoes={[
        ["campo", "Campo"],
        ["imagens", "Imagens"],
      ]}
    />
  );
}

function Alternador<T extends string>({
  valor,
  onChange,
  opcoes,
}: {
  valor: T;
  onChange: (v: T) => void;
  opcoes: [T, string][];
}) {
  return (
    <div className="inline-flex overflow-hidden rounded-[var(--radius-control)] border border-line">
      {opcoes.map(([v, label]) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          aria-pressed={valor === v}
          className={cx(
            "h-8 px-2.5 text-meta font-medium transition-colors",
            valor === v ? "bg-ink text-surface" : "bg-surface text-ink-2 hover:bg-sunken",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/**
 * As imagens de um exercício de imagens: uma grande, as outras por baixo.
 *
 * ## Como se juntam
 *
 * Escolhendo ou arrastando para cima do painel. Num exercício que já existe,
 * cada imagem sobe na hora (autorizar, carregar direto para o armazenamento,
 * confirmar), como sempre. Num exercício por criar ainda não há onde a
 * pendurar: fica na página (`Pendente`) e sobe quando se carrega em "Criar
 * exercício". Antes disto o painel dizia "cria o exercício primeiro", e quem
 * queria um exercício só de imagens criava-o vazio para depois as juntar.
 *
 * As imagens são reduzidas antes de subir (ver `uploadExerciseImage`), por isso
 * uma fotografia de telemóvel de 10 MB entra sem aviso nenhum.
 */
function GaleriaDeImagens({
  exerciseId,
  images,
  pendentes,
  editable,
  onImages,
  onPendentes,
}: {
  exerciseId: string | null;
  images: ExerciseImage[];
  pendentes: Pendente[];
  editable: boolean;
  onImages: (images: ExerciseImage[]) => void;
  onPendentes: (p: Pendente[]) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [activa, setActiva] = useState(0);
  const [ampliada, setAmpliada] = useState<string | null>(null);
  const [aArrastar, setAArrastar] = useState(false);

  const todas = [
    ...images.map((i) => ({ key: i.key, url: i.url, pendente: false })),
    ...pendentes.map((p) => ({ key: p.id, url: p.url, pendente: true })),
  ];
  const livres = MAX_IMAGENS - todas.length;
  const actual = todas[Math.min(activa, todas.length - 1)];

  async function juntar(files: FileList | File[] | null) {
    if (!files || !editable) return;
    const escolhidas = Array.from(files)
      .filter((f) => /^image\/(jpeg|png|webp)$/.test(f.type))
      .slice(0, livres);
    if (escolhidas.length === 0) {
      setErro(livres === 0 ? `São ${MAX_IMAGENS} imagens no máximo.` : "Só JPEG, PNG ou WebP.");
      return;
    }
    setErro(null);

    if (!exerciseId) {
      onPendentes([
        ...pendentes,
        ...escolhidas.map((file) => ({ id: `p-${crypto.randomUUID()}`, file, url: URL.createObjectURL(file) })),
      ]);
      setActiva(todas.length);
      return;
    }

    setBusy(true);
    let actuais = images;
    try {
      for (const file of escolhidas) {
        const img = await uploadExerciseImage(exerciseId, file);
        actuais = [...actuais.filter((i) => i.key !== img.key), img];
        onImages(actuais);
      }
      setActiva(actuais.length - 1);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível carregar a imagem.");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function tirar(key: string, pendente: boolean) {
    if (pendente) {
      const p = pendentes.find((x) => x.id === key);
      if (p) URL.revokeObjectURL(p.url);
      onPendentes(pendentes.filter((x) => x.id !== key));
    } else if (exerciseId) {
      await removeExerciseImage(exerciseId, key);
      onImages(images.filter((i) => i.key !== key));
    }
    setActiva((a) => Math.max(0, Math.min(a, todas.length - 2)));
  }

  const arrastar = {
    onDragOver: (e: DragEvent) => {
      if (!editable || livres <= 0) return;
      e.preventDefault();
      setAArrastar(true);
    },
    onDragLeave: () => setAArrastar(false),
    onDrop: (e: DragEvent) => {
      if (!editable) return;
      e.preventDefault();
      setAArrastar(false);
      void juntar(e.dataTransfer.files);
    },
  };

  const escolher = (
    <input
      ref={fileRef}
      type="file"
      accept="image/jpeg,image/png,image/webp"
      multiple
      hidden
      onChange={(e) => void juntar(e.target.files)}
    />
  );

  if (todas.length === 0) {
    if (!editable) {
      return (
        <div className="p-4">
          <Empty title="Sem imagens" detail="Este exercício ainda não tem imagens." compact />
        </div>
      );
    }
    return (
      <div className="p-4" {...arrastar}>
        {escolher}
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className={cx(
            "flex aspect-[16/9] max-h-[62vh] w-full flex-col items-center justify-center gap-3 rounded-[var(--radius-panel)] border border-dashed transition-colors duration-150",
            aArrastar ? "border-line-strong bg-sunken" : "border-line-strong/70 bg-sunken/40 hover:bg-sunken/70",
          )}
        >
          <span className="flex size-14 items-center justify-center rounded-full bg-surface text-ink-3 shadow-[0_1px_2px_rgb(26_25_23/0.06)]">
            <ImagePlus className="size-6" strokeWidth={1.5} />
          </span>
          <span className="text-body font-medium text-ink">{busy ? "A carregar…" : "Arrasta as imagens para aqui, ou escolhe-as"}</span>
          <span className="text-meta text-ink-3">Até {MAX_IMAGENS} · JPEG, PNG ou WebP · as grandes são reduzidas sozinhas</span>
        </button>
        {erro && <p className="mt-2 text-meta text-risk">{erro}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-3 p-4" {...arrastar}>
      {escolher}

      {/* A imagem grande: inteira, sem cortes, sobre um fundo neutro. */}
      <div
        className={cx(
          "group relative flex items-center justify-center overflow-hidden rounded-[var(--radius-panel)] bg-sunken transition-shadow",
          aArrastar && "ring-2 ring-line-strong",
        )}
      >
        <img src={actual.url} alt="" className="max-h-[70vh] w-full object-contain" />
        <button
          type="button"
          onClick={() => setAmpliada(actual.url)}
          aria-label="Ampliar"
          className="absolute top-2.5 right-2.5 inline-flex size-8 items-center justify-center rounded-full bg-black/45 text-white opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
        >
          <Expand className="size-4" strokeWidth={1.75} />
        </button>
        {actual.pendente && (
          <span className="absolute bottom-2.5 left-2.5 rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-medium text-white">
            Sobe ao criar o exercício
          </span>
        )}
      </div>

      {/* As miniaturas, e o espaço para a seguinte. */}
      <div className="flex flex-wrap gap-2">
        {todas.map((img, i) => (
          <div key={img.key} className="group relative">
            <button
              type="button"
              onClick={() => setActiva(i)}
              aria-label={`Imagem ${i + 1}`}
              aria-pressed={i === activa}
              className={cx(
                "block overflow-hidden rounded-[var(--radius-control)] border-2 transition-colors",
                i === activa ? "border-ink" : "border-transparent hover:border-line-strong",
              )}
            >
              <img src={img.url} alt="" className={cx("h-16 w-[5.5rem] object-cover", img.pendente && "opacity-80")} />
            </button>
            {editable && (
              <button
                type="button"
                aria-label="Tirar imagem"
                onClick={() => void tirar(img.key, img.pendente)}
                className="absolute -top-1.5 -right-1.5 inline-flex size-5 items-center justify-center rounded-full bg-ink text-surface opacity-0 shadow transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
              >
                <X className="size-3" strokeWidth={2.25} />
              </button>
            )}
          </div>
        ))}
        {editable && livres > 0 && (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            aria-label="Juntar imagem"
            className="flex h-[4.25rem] w-[5.75rem] flex-col items-center justify-center gap-0.5 rounded-[var(--radius-control)] border border-dashed border-line-strong/70 text-ink-3 transition-colors hover:bg-sunken/60 hover:text-ink"
          >
            <ImagePlus className="size-4" strokeWidth={1.6} />
            <span className="text-[11px] font-medium">{busy ? "A carregar…" : "Juntar"}</span>
          </button>
        )}
      </div>

      {erro && <p className="text-meta text-risk">{erro}</p>}

      {ampliada && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/70 p-6" onClick={() => setAmpliada(null)}>
          <img src={ampliada} alt="" className="max-h-full max-w-full rounded-[var(--radius-panel)]" />
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

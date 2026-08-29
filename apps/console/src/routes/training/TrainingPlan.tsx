import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { PageHeader } from "@/components/Shell";
import { Dialog, DialogField, dialogInputClass } from "@/components/Dialog";
import { FieldView, THUMB_RATIO } from "@/components/FieldEditor";
import { Empty, Loading, Panel, PanelHead, Pill, cx } from "@/components/primitives";
import { Check, ChevronDown, ChevronRight, Clock, DragHandle, Plus, Search, Star, Trash2, TriangleAlert, Whistle, X } from "@/lib/icons";
import { can } from "@/lib/permissions";
import { longDate, time } from "@/lib/format";
import {
  OBJECTIVE_CATEGORIES,
  SESSION_TYPES,
  getPlan,
  listExercises,
  minutesByCategory,
  savePlan,
  sessionLoad,
  type ExerciseSummary,
  type PlanBlock,
  type SessionPlan,
} from "@/lib/training";
import { useSession } from "@/session";

/**
 * O plano de uma sessão.
 *
 * ## A estrutura é a peça central
 *
 * Um treino constrói-se como uma sequência de blocos — ativação, técnica,
 * posse, jogo — e é essa lista que ocupa o ecrã. Os campos da sessão (objetivo,
 * tipo, intensidade) ficam ao lado, porque se preenchem uma vez; os blocos
 * mexem-se a tarde toda.
 *
 * ## Nada grava sozinho
 *
 * Trabalha-se local e grava-se num gesto ("Guardar plano"). Um plano é uma peça
 * que se compõe — gravar a cada tecla encheria a história da sessão de estados
 * a meio, e um treinador no campo com rede fraca quer decidir quando envia.
 */
export default function TrainingPlan() {
  const { id = "" } = useParams();
  const { session } = useSession();

  const [plan, setPlan] = useState<SessionPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  /*
   * A quem se destina o exercício que se for buscar.
   *
   * `"new"` cria um bloco a partir dele; um índice liga-o ao bloco que já
   * existe — que era o caminho que faltava: quem criasse um bloco à mão ficava
   * sem forma de lhe anexar um exercício da biblioteca a seguir.
   */
  const [picking, setPicking] = useState<"new" | number | null>(null);
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    setPlan(null);
    setError(null);
    getPlan(id)
      .then(setPlan)
      .catch((e: Error) => setError(e.message));
  }, [id]);

  const editable = Boolean(plan?.mine) && can(session, "training:write");

  const patch = (p: Partial<SessionPlan>) => {
    setPlan((cur) => (cur ? { ...cur, ...p } : cur));
    setDirty(true);
    setSaved(false);
  };

  const patchBlock = (ix: number, b: Partial<PlanBlock>) => {
    setPlan((cur) => (cur ? { ...cur, blocks: cur.blocks.map((x, i) => (i === ix ? { ...x, ...b } : x)) } : cur));
    setDirty(true);
    setSaved(false);
  };

  /*
   * Arrastar para reordenar.
   *
   * ## Porque é que os blocos fecham enquanto se arrasta
   *
   * Um bloco aberto ocupa meio ecrã. A arrastar, o alvo tem de estar à vista —
   * senão reordena-se às cegas, com a lista a saltar por baixo do dedo. Fecham
   * todos ao pegar e reabre-se o que estava, já no lugar novo, ao largar.
   *
   * ## Porque é que não é o `draggable` do HTML
   *
   * Porque não funciona em toque, e o produto é para ser usado no tablet à
   * beira do campo. Pointer events servem os dois com o mesmo código — a mesma
   * escolha do editor tático.
   */
  const [dragging, setDragging] = useState<number | null>(null);
  /*
   * O bloco que estava aberto quando o arrasto começou.
   *
   * Guarda-se a **referência ao bloco**, não o índice: se arrastares o bloco 1
   * com o bloco 4 aberto, o 4 passa a estar noutro número — e reabrir "o
   * índice 4" abriria o bloco errado. As referências sobrevivem ao `splice`,
   * por isso `indexOf` encontra-o onde quer que ele tenha ficado.
   */
  const abertoAntes = useRef<PlanBlock | null>(null);
  const arrastou = useRef(false);

  const startDrag = (ix: number, e: React.PointerEvent) => {
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    abertoAntes.current = open === null ? null : (plan?.blocks[open] ?? null);
    arrastou.current = false;
    setOpen(null);
    setDragging(ix);
  };

  const onDragMove = (e: React.PointerEvent) => {
    if (dragging === null) return;
    // Onde é que o dedo está — o `<li>` por baixo diz o índice de destino.
    const alvo = document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-block]");
    const to = alvo ? Number(alvo.getAttribute("data-block")) : NaN;
    if (Number.isNaN(to) || to === dragging) return;

    // A lista reordena-se **ao vivo**: os blocos afastam-se para dar lugar, e
    // vê-se o resultado antes de largar. `dirty` fica para o fim, senão um
    // arrasto de três linhas marcava o plano por gravar três vezes.
    setPlan((cur) => {
      if (!cur) return cur;
      const blocks = [...cur.blocks];
      const [movido] = blocks.splice(dragging, 1);
      blocks.splice(to, 0, movido);
      return { ...cur, blocks };
    });
    arrastou.current = true;
    setDragging(to);
  };

  const endDrag = () => {
    if (dragging === null) return;
    // O que estava aberto reabre — no sítio onde agora está. O `plan` do
    // closure já é o reordenado: o largar é um evento novo, depois do redesenho.
    const antes = abertoAntes.current;
    const volta = antes ? (plan?.blocks.indexOf(antes) ?? -1) : -1;
    setOpen(volta >= 0 ? volta : null);
    if (arrastou.current) {
      setDirty(true);
      setSaved(false);
    }
    setDragging(null);
    abertoAntes.current = null;
  };

  const addBlock = (b: Partial<PlanBlock>) => {
    setPlan((cur) =>
      cur
        ? {
            ...cur,
            blocks: [
              ...cur.blocks,
              {
                name: "",
                durationMin: 15,
                category: null,
                objective: null,
                intensity: null,
                players: null,
                notes: null,
                exerciseId: null,
                ...b,
              },
            ],
          }
        : cur,
    );
    setOpen(plan ? plan.blocks.length : 0);
    setDirty(true);
    setSaved(false);
  };

  const removeBlock = (ix: number) => {
    setPlan((cur) => (cur ? { ...cur, blocks: cur.blocks.filter((_, i) => i !== ix) } : cur));
    setOpen(null);
    setDirty(true);
    setSaved(false);
  };

  async function save() {
    if (!plan || saving) return;
    setSaving(true);
    try {
      await savePlan(plan.sessionId, {
        objective: plan.objective,
        objectives: plan.objectives,
        sessionType: plan.sessionType,
        intensity: plan.intensity,
        expectedAthletes: plan.expectedAthletes,
        material: plan.material,
        planNotes: plan.planNotes,
        postNotes: plan.postNotes,
        blocks: plan.blocks.map((b) => ({
          name: b.name || "Bloco",
          durationMin: b.durationMin,
          category: b.category,
          objective: b.objective,
          intensity: b.intensity,
          players: b.players,
          notes: b.notes,
          exerciseId: b.exerciseId,
        })),
      });
      setDirty(false);
      setSaved(true);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Não foi possível gravar o plano.");
    } finally {
      setSaving(false);
    }
  }

  if (error) {
    return (
      <Panel>
        <Empty title="Treino não encontrado" detail={error} icon={TriangleAlert} />
      </Panel>
    );
  }
  if (!plan) return <Loading />;

  const start = new Date(plan.startsAt);
  const end = new Date(plan.endsAt);
  const scheduledMin = Math.round((end.getTime() - start.getTime()) / 60_000);
  const load = sessionLoad(plan.blocks, plan.intensity);
  const byCat = minutesByCategory(plan.blocks);
  const past = end < new Date();
  const allObjectiveValues = OBJECTIVE_CATEGORIES.flatMap((c) => [c.label, ...c.subs]);

  return (
    <>
      <PageHeader
        eyebrow="Plano de treino"
        title={`${plan.teamName} · ${time(start)}`}
        subtitle={`${longDate(start)} · ${plan.venue}${plan.coachName ? ` · ${plan.coachName}` : ""}`}
      >
        <Link to="/treinos" className="ctl-ghost">
          Todos os treinos
        </Link>
        {past && (
          <Link to="/presencas" className="ctl-outline">
            <Whistle className="size-3.5" strokeWidth={1.75} />
            Presenças
          </Link>
        )}
        {editable && (
          <button type="button" className="ctl-primary" onClick={save} disabled={saving || (!dirty && !saved)}>
            {saved && !dirty ? (
              <>
                <Check className="size-3.5" strokeWidth={2} /> Guardado
              </>
            ) : saving ? (
              "A guardar…"
            ) : (
              "Guardar plano"
            )}
          </button>
        )}
      </PageHeader>

      <div className="grid gap-3 xl:grid-cols-3">
        {/* A sessão */}
        <div className="space-y-3">
          <Panel>
            <PanelHead title="Sessão" hint={`${scheduledMin} min marcados`} />
            <div className="space-y-3.5 p-5">
              {/* Selects como no resto da consola. Eram `input list=…`, que o
                  browser desenha à maneira dele — sem seta, com um menu de
                  sugestões que não é o dos outros campos. */}
              <DialogField label="Objetivo principal">
                <select
                  className={dialogInputClass}
                  value={plan.objective ?? ""}
                  onChange={(e) => patch({ objective: e.target.value || null })}
                  disabled={!editable}
                >
                  <option value="">Sem objetivo definido</option>
                  {OBJECTIVE_CATEGORIES.map((c) => (
                    <optgroup key={c.key} label={c.label}>
                      <option value={c.label}>{c.label} (geral)</option>
                      {c.subs.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                  {/* Um objetivo escrito à mão antes desta mudança não se perde. */}
                  {plan.objective && !allObjectiveValues.includes(plan.objective) && (
                    <option value={plan.objective}>{plan.objective}</option>
                  )}
                </select>
              </DialogField>

              <DialogField label="Objetivos secundários" hint="escolhe e junta">
                <ObjectiveChips
                  values={plan.objectives}
                  onChange={(objectives) => patch({ objectives })}
                  disabled={!editable}
                />
              </DialogField>

              <div className="grid grid-cols-2 gap-3">
                <DialogField label="Tipo de treino">
                  <select
                    className={dialogInputClass}
                    value={plan.sessionType ?? ""}
                    onChange={(e) => patch({ sessionType: e.target.value || null })}
                    disabled={!editable}
                  >
                    <option value="">Sem tipo</option>
                    {SESSION_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                    {plan.sessionType && !SESSION_TYPES.includes(plan.sessionType as (typeof SESSION_TYPES)[number]) && (
                      <option value={plan.sessionType}>{plan.sessionType}</option>
                    )}
                  </select>
                </DialogField>
                <DialogField label="Atletas esperados">
                  <input
                    type="number"
                    min={0}
                    max={99}
                    className={dialogInputClass}
                    value={plan.expectedAthletes ?? ""}
                    onChange={(e) => patch({ expectedAthletes: e.target.value === "" ? null : Number(e.target.value) })}
                    disabled={!editable}
                  />
                </DialogField>
              </div>

              <DialogField label="Intensidade planeada" hint={plan.intensity ? `${plan.intensity}/10` : "por definir"}>
                <input
                  type="range"
                  min={1}
                  max={10}
                  value={plan.intensity ?? 5}
                  onChange={(e) => patch({ intensity: Number(e.target.value) })}
                  className="w-full accent-[var(--color-signal)]"
                  disabled={!editable}
                />
              </DialogField>

              <DialogField label="Material">
                <textarea
                  rows={2}
                  className={cx(dialogInputClass, "h-auto py-2")}
                  value={plan.material ?? ""}
                  onChange={(e) => patch({ material: e.target.value || null })}
                  placeholder="Coletes (2 cores), 12 cones, 2 mini-balizas…"
                  disabled={!editable}
                />
              </DialogField>

              <DialogField label="Observações do plano">
                <textarea
                  rows={3}
                  className={cx(dialogInputClass, "h-auto py-2")}
                  value={plan.planNotes ?? ""}
                  onChange={(e) => patch({ planNotes: e.target.value || null })}
                  disabled={!editable}
                />
              </DialogField>
            </div>
          </Panel>

          {/* O resumo da carga */}
          <Panel>
            <PanelHead title="Carga estimada" hint="derivada dos blocos" />
            <div className="space-y-3 p-5">
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-metric text-ink tabular">{load.volume}</span>
                    <span className="text-meta text-ink-3">min planeados</span>
                  </div>
                  {load.volume !== scheduledMin && load.volume > 0 && (
                    <div className={cx("mt-0.5 text-meta", Math.abs(load.volume - scheduledMin) > 10 ? "text-warn" : "text-ink-4")}>
                      {load.volume > scheduledMin
                        ? `${load.volume - scheduledMin} min acima do marcado`
                        : `faltam ${scheduledMin - load.volume} min para preencher`}
                    </div>
                  )}
                </div>
                <div className="text-right">
                  <Pill tone={load.tone}>{load.label}</Pill>
                  <div className="mt-1 text-meta text-ink-3 tabular">{load.score}/100</div>
                </div>
              </div>

              {byCat.length > 0 && (
                <div className="space-y-1.5">
                  <div className="flex h-2 overflow-hidden rounded-full bg-sunken">
                    {byCat.map((c) => (
                      <span
                        key={c.label}
                        style={{ width: `${(c.minutes / load.volume) * 100}%`, background: c.category?.color.base ?? "var(--color-ink-4)" }}
                      />
                    ))}
                  </div>
                  {byCat.map((c) => (
                    <div key={c.label} className="flex items-center justify-between text-meta">
                      <span className="inline-flex items-center gap-1.5 text-ink-2">
                        <span className="size-2 rounded-full" style={{ background: c.category?.color.base ?? "var(--color-ink-4)" }} />
                        {c.label}
                      </span>
                      <span className="text-ink-3 tabular">{c.minutes} min</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Panel>

          {past && (
            <Panel>
              <PanelHead title="Pós-treino" hint="o que ficou" />
              <div className="p-5">
                <textarea
                  rows={4}
                  className={cx(dialogInputClass, "h-auto py-2")}
                  value={plan.postNotes ?? ""}
                  onChange={(e) => patch({ postNotes: e.target.value || null })}
                  placeholder="Como correu, quem se destacou, o que fica para o próximo…"
                  disabled={!editable}
                />
              </div>
            </Panel>
          )}
        </div>

        {/* A estrutura */}
        <Panel className="xl:col-span-2 self-start">
          <PanelHead title="Estrutura do treino" hint={plan.blocks.length ? `${plan.blocks.length} blocos` : undefined}>
            {editable && (
              <>
                <button type="button" className="ctl-outline" onClick={() => setPicking("new")}>
                  <Search className="size-3.5" strokeWidth={1.75} />
                  Importar exercício
                </button>
                <button type="button" className="ctl-primary" onClick={() => addBlock({})}>
                  <Plus className="size-3.5" strokeWidth={1.75} />
                  Bloco
                </button>
              </>
            )}
          </PanelHead>

          {plan.blocks.length === 0 ? (
            <Empty
              title="O treino ainda não tem estrutura"
              detail={
                editable
                  ? "Junta blocos — ativação, técnica, posse, jogo — à mão ou a partir da biblioteca de exercícios."
                  : "Quem treina esta equipa ainda não desenhou o plano."
              }
              icon={Clock}
            >
              {editable && (
                <button type="button" className="ctl-primary" onClick={() => addBlock({ name: "Ativação", durationMin: 10, category: "Físico" })}>
                  Começar pela ativação
                </button>
              )}
            </Empty>
          ) : (
            <ul className="divide-y divide-line">
              {plan.blocks.map((b, ix) => (
                <BlockRow
                  key={ix}
                  block={b}
                  index={ix}
                  open={open === ix}
                  editable={editable}
                  onToggle={() => setOpen(open === ix ? null : ix)}
                  onPatch={(p) => patchBlock(ix, p)}
                  onRemove={() => removeBlock(ix)}
                  onImport={() => setPicking(ix)}
                  dragging={dragging === ix}
                  onDragStart={(e) => startDrag(ix, e)}
                  onDragMove={onDragMove}
                  onDragEnd={endDrag}
                />
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {picking !== null && (
        <ExercisePicker
          toBlock={typeof picking === "number" ? plan.blocks[picking]?.name || `Bloco ${picking + 1}` : undefined}
          onClose={() => setPicking(null)}
          onPick={(e) => {
            /*
             * O nome e a miniatura entram já.
             *
             * Vêm do servidor no `GET` do plano, e sem os preencher aqui o
             * bloco ficava sem desenho até alguém recarregar a página — o
             * exercício estava lá, mas não se via, que é o mesmo que não estar.
             */
            const doExercicio = {
              name: e.name,
              durationMin: e.durationMin ?? 15,
              category: e.category,
              objective: e.objectives[0] ?? null,
              intensity: e.intensity,
              players: e.players,
              exerciseId: e.id,
              exerciseName: e.name,
              exerciseThumb: e.thumbnail,
            };
            if (picking === "new") addBlock(doExercicio);
            else {
              // Num bloco que já existe, o que ele já tem escrito manda: só se
              // preenche o que estiver vazio, e nunca se apaga trabalho feito.
              const b = plan.blocks[picking];
              patchBlock(picking, {
                ...doExercicio,
                name: b.name?.trim() ? b.name : e.name,
                durationMin: b.durationMin || (e.durationMin ?? 15),
                category: b.category ?? e.category,
                objective: b.objective ?? e.objectives[0] ?? null,
                intensity: b.intensity ?? e.intensity,
                players: b.players ?? e.players,
              });
            }
            setPicking(null);
          }}
        />
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Bloco                                                                       */
/* -------------------------------------------------------------------------- */

function BlockRow({
  block,
  index,
  open,
  editable,
  onToggle,
  onPatch,
  onRemove,
  onImport,
  dragging,
  onDragStart,
  onDragMove,
  onDragEnd,
}: {
  block: PlanBlock;
  index: number;
  open: boolean;
  editable: boolean;
  onToggle: () => void;
  onPatch: (p: Partial<PlanBlock>) => void;
  onRemove: () => void;
  /** Abrir a biblioteca para este bloco em concreto. */
  onImport: () => void;
  /** Este é o bloco que está a ser arrastado. */
  dragging: boolean;
  onDragStart: (e: React.PointerEvent) => void;
  onDragMove: (e: React.PointerEvent) => void;
  onDragEnd: () => void;
}) {
  const cat = OBJECTIVE_CATEGORIES.find((c) => c.label === block.category);

  return (
    // `data-block` é o que o arrasto lê para saber onde larga — ver `onDragMove`.
    <li data-block={index} className={cx(dragging && "opacity-50")}>
      {/* A linha fechada lê-se como o exemplo do quadro: "3. Posse — 20 min". */}
      <div
        className={cx("flex w-full cursor-pointer items-center gap-3 px-5 py-2.5 transition-colors", !open && "hover:bg-sunken/50")}
        onClick={onToggle}
      >
        {editable && (
          /*
            O manípulo é a única parte que arrasta.

            A linha inteira abre e fecha o bloco; se ela também arrastasse, cada
            toque seria uma aposta entre as duas coisas. `touch-none` impede o
            ecrã de rolar por baixo do dedo no tablet.
          */
          <button
            type="button"
            aria-label={`Arrastar o bloco ${index + 1}`}
            title="Arrastar para reordenar"
            className="-ml-1.5 shrink-0 cursor-grab touch-none rounded p-1 text-ink-4 transition-colors hover:bg-sunken hover:text-ink-2 active:cursor-grabbing"
            onClick={(e) => e.stopPropagation()}
            onPointerDown={onDragStart}
            onPointerMove={onDragMove}
            onPointerUp={onDragEnd}
            onPointerCancel={onDragEnd}
          >
            <DragHandle className="size-3.5" strokeWidth={2} />
          </button>
        )}
        <span
          className="inline-flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold tabular"
          style={cat ? { background: cat.color.soft, color: cat.color.ink } : { background: "var(--color-sunken)", color: "var(--color-ink-2)" }}
        >
          {index + 1}
        </span>
        <div className="min-w-0 flex-1">
          <span className="text-body font-medium text-ink">{block.name || "Bloco sem nome"}</span>
          <span className="ml-2 text-meta text-ink-3">
            {block.durationMin} min
            {block.category ? ` · ${block.category}` : ""}
            {block.intensity ? ` · int. ${block.intensity}` : ""}
            {block.players ? ` · ${block.players} jogadores` : ""}
          </span>
        </div>
        {block.exerciseName && (
          <Link
            to={`/exercicios/${block.exerciseId}`}
            onClick={(e) => e.stopPropagation()}
            className="hidden shrink-0 items-center gap-1.5 text-meta text-signal-ink hover:underline sm:inline-flex"
          >
            {block.exerciseThumb ? <FieldView diagram={block.exerciseThumb} className="h-7 w-11 rounded" /> : null}
            {block.exerciseName}
          </Link>
        )}
        {open ? <ChevronDown className="size-4 shrink-0 text-ink-4" strokeWidth={1.75} /> : <ChevronRight className="size-4 shrink-0 text-ink-4" strokeWidth={1.75} />}
      </div>

      {open && (
        <div className="space-y-3 border-t border-line bg-sunken/30 px-5 py-4">
          {/*
            O exercício vem primeiro, e com o desenho à vista.
            
            É a pergunta que se faz ao abrir um bloco — *qual é o exercício?* —
            e a resposta é uma imagem, não um nome. Um bloco sem exercício diz
            que se pode ir buscar um; um bloco com exercício mostra-o, e deixa
            trocar ou soltar sem apagar o que já está escrito à volta.
          */}
          <div className="flex items-center gap-3 rounded-[var(--radius-control)] border border-line bg-surface p-2.5">
            {block.exerciseThumb ? (
              <FieldView diagram={block.exerciseThumb} className="h-16 w-24 shrink-0 rounded" ratio={3 / 2} />
            ) : (
              <div className="flex h-16 w-24 shrink-0 items-center justify-center rounded bg-sunken text-[11px] text-ink-4">
                Sem desenho
              </div>
            )}
            <div className="min-w-0 flex-1">
              {block.exerciseId ? (
                <>
                  <div className="truncate text-body font-medium text-ink">{block.exerciseName ?? "Exercício da biblioteca"}</div>
                  <Link to={`/exercicios/${block.exerciseId}`} target="_blank" className="text-meta text-signal-ink hover:underline">
                    Abrir ficha do exercício
                  </Link>
                </>
              ) : (
                <div className="text-meta text-ink-3">
                  Este bloco não tem exercício da biblioteca — podes importar um, com o desenho e os metadados dele.
                </div>
              )}
            </div>
            {editable && (
              <div className="flex shrink-0 items-center gap-1.5">
                <button type="button" className="ctl-outline h-8" onClick={onImport}>
                  <Search className="size-3.5" strokeWidth={1.75} />
                  {block.exerciseId ? "Trocar" : "Importar da biblioteca"}
                </button>
                {block.exerciseId && (
                  <button
                    type="button"
                    className="ctl-ghost size-8 justify-center px-0"
                    aria-label="Soltar o exercício"
                    title="Soltar o exercício — o bloco fica, com o que já lá está escrito"
                    onClick={() => onPatch({ exerciseId: null, exerciseName: null, exerciseThumb: null })}
                  >
                    <X className="size-4" strokeWidth={1.75} />
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-[1fr_110px_150px]">
            <DialogField label="Nome do bloco">
              <input className={dialogInputClass} value={block.name} onChange={(e) => onPatch({ name: e.target.value })} placeholder="Posse 6v4" disabled={!editable} />
            </DialogField>
            <DialogField label="Minutos">
              <input
                type="number"
                min={1}
                max={240}
                className={dialogInputClass}
                value={block.durationMin}
                onChange={(e) => onPatch({ durationMin: Math.max(1, Number(e.target.value) || 1) })}
                disabled={!editable}
              />
            </DialogField>
            <DialogField label="Intensidade" hint={block.intensity ? `${block.intensity}/10` : "da sessão"}>
              <input
                type="range"
                min={1}
                max={10}
                value={block.intensity ?? 5}
                onChange={(e) => onPatch({ intensity: Number(e.target.value) })}
                className="mt-2.5 w-full accent-[var(--color-signal)]"
                disabled={!editable}
              />
            </DialogField>
          </div>

          <div className="grid gap-3 sm:grid-cols-[1fr_150px]">
            <DialogField label="Objetivo">
              <select
                className={dialogInputClass}
                value={block.category && block.objective ? `${block.category}::${block.objective}` : block.category ? `${block.category}::` : ""}
                onChange={(e) => {
                  const [category, objective] = e.target.value.split("::");
                  onPatch({ category: category || null, objective: objective || null });
                }}
                disabled={!editable}
              >
                <option value="">Sem objetivo</option>
                {OBJECTIVE_CATEGORIES.map((c) => (
                  <optgroup key={c.key} label={c.label}>
                    <option value={`${c.label}::`}>{c.label} (geral)</option>
                    {c.subs.map((s) => (
                      <option key={s} value={`${c.label}::${s}`}>
                        {s}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </DialogField>
            <DialogField label="Nº de jogadores">
              <input
                className={dialogInputClass}
                value={block.players ?? ""}
                onChange={(e) => onPatch({ players: e.target.value || null })}
                placeholder="Ex.: 12"
                disabled={!editable}
              />
            </DialogField>
          </div>

          {/*
            Material e dimensões saíram do bloco.

            São do **exercício**, e estavam a ser copiados para cá — a mesma
            informação em dois sítios, a divergir à primeira correção. Quem
            precisa delas abre a ficha do exercício, que está a um clique aqui
            em cima. O bloco fica com o que é dele: o que se faz, quanto tempo,
            com que intensidade, para que objetivo, com quantos, e a nota do dia.
          */}
          <DialogField label="Observações">
            <input className={dialogInputClass} value={block.notes ?? ""} onChange={(e) => onPatch({ notes: e.target.value || null })} disabled={!editable} />
          </DialogField>

          {editable && (
            <div className="flex items-center gap-1.5 pt-1">
              <span className="inline-flex items-center gap-1.5 text-meta text-ink-4">
                <DragHandle className="size-3" strokeWidth={2} />
                Arrasta por aqui para mudar a ordem
              </span>
              <button type="button" className="ctl-ghost ml-auto h-7 text-risk hover:bg-risk-soft hover:text-risk" onClick={onRemove}>
                <Trash2 className="size-3.5" strokeWidth={1.75} />
                Remover bloco
              </button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

/* -------------------------------------------------------------------------- */
/* Escolher da biblioteca                                                      */
/* -------------------------------------------------------------------------- */

/**
 * A biblioteca dentro do plano — favoritos primeiro, porque é assim que se monta
 * um treino em minutos: os exercícios de sempre estão a um toque.
 */
function ExercisePicker({
  onClose,
  onPick,
  toBlock,
}: {
  onClose: () => void;
  onPick: (e: ExerciseSummary) => void;
  /** O bloco que o vai receber, quando não é um bloco novo. */
  toBlock?: string;
}) {
  const [all, setAll] = useState<ExerciseSummary[] | null>(null);
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<"fav" | "mine" | "all">("fav");

  useEffect(() => {
    listExercises()
      .then((rows) => {
        setAll(rows);
        // Sem favoritos ainda, o separador certo é "Todos" — não uma lista vazia.
        if (!rows.some((r) => r.favorite)) setTab("all");
      })
      .catch(() => setAll([]));
  }, []);

  const rows = useMemo(() => {
    if (!all) return [];
    const needle = q.trim().toLowerCase();
    return all
      .filter((e) => (tab === "fav" ? e.favorite : tab === "mine" ? e.mine : true))
      .filter((e) => !needle || e.name.toLowerCase().includes(needle) || (e.category ?? "").toLowerCase().includes(needle) || e.objectives.some((o) => o.toLowerCase().includes(needle)))
      .sort((a, b) => b.usageCount - a.usageCount);
  }, [all, q, tab]);

  return (
    <Dialog
      title={toBlock ? "Importar exercício" : "Juntar exercício"}
      subtitle={
        toBlock
          ? `Para o bloco "${toBlock}" — o que já lá está escrito mantém-se.`
          : "Escolhe da biblioteca — o bloco herda a duração e o objetivo."
      }
      onClose={onClose}
      width={780}
    >
      <div className="space-y-3 p-5">
        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              ["fav", "Favoritos"],
              ["mine", "Os meus"],
              ["all", "Todos"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={cx(
                "h-8 rounded-full px-3 text-meta font-medium transition-colors",
                tab === key ? "bg-ink text-surface" : "bg-sunken text-ink-2 hover:text-ink",
              )}
            >
              {label}
            </button>
          ))}
          <div className="relative ml-auto">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-4" strokeWidth={1.75} />
            <input
              autoFocus
              className={cx(dialogInputClass, "h-8 w-52 pl-8")}
              placeholder="Procurar…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          {/* Noutro separador: o plano em curso não se perde. */}
          <a href={`${import.meta.env.BASE_URL}exercicios/novo`} target="_blank" rel="noreferrer" className="ctl-outline h-8" title="Desenhar um exercício novo — abre noutro separador">
            <Plus className="size-3.5" strokeWidth={1.75} />
            Criar
          </a>
        </div>

        {all === null ? (
          <Loading size="panel" />
        ) : rows.length === 0 ? (
          <Empty
            title={tab === "fav" ? "Ainda não tens favoritos" : "Nada encontrado"}
            detail={tab === "fav" ? "Marca exercícios com a estrela na biblioteca e passam a estar aqui, a um toque." : "Cria o exercício na biblioteca e volta cá."}
            compact
          >
            {/* Noutro separador, de propósito: o plano em curso não se perde.
                O `BASE_URL` é o mesmo `base` do Vite — `/consola/` em produção. */}
            <a href={`${import.meta.env.BASE_URL}exercicios/novo`} target="_blank" rel="noreferrer" className="ctl-primary">
              Criar exercício
            </a>
          </Empty>
        ) : (
          /*
            Grelha de cartões, não uma lista de linhas.

            Um exercício reconhece-se pelo desenho antes de se ler o nome — é a
            mesma razão pela qual a biblioteca são cartões. Numa lista com a
            miniatura a 64px ninguém distinguia uma posse de um circuito, e
            escolher passava por ler nomes um a um.
          */
          <ul className="grid max-h-[26rem] grid-cols-2 gap-2 overflow-y-auto pr-1 sm:grid-cols-3">
            {rows.map((e) => (
              <li key={e.id}>
                <button
                  type="button"
                  onClick={() => onPick(e)}
                  className="group block w-full overflow-hidden rounded-[var(--radius-control)] border border-line text-left transition-colors hover:border-line-strong"
                >
                  {e.thumbnail ? (
                    <FieldView diagram={e.thumbnail} className="block w-full" ratio={THUMB_RATIO} />
                  ) : (
                    <div className="flex aspect-[4/3] w-full items-center justify-center bg-sunken text-[11px] text-ink-4">
                      Sem desenho
                    </div>
                  )}
                  <div className="p-2">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-meta font-semibold text-ink">{e.name}</span>
                      {e.favorite && <Star className="size-3 shrink-0 fill-warn text-warn" strokeWidth={1.75} />}
                    </div>
                    <div className="truncate text-[11px] text-ink-3">
                      {[e.category, e.durationMin ? `${e.durationMin} min` : null, e.players, e.usageCount ? `usado ${e.usageCount}×` : null]
                        .filter(Boolean)
                        .join(" · ") || "Sem detalhes"}
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Escolher junta um chip; o X tira-o. Era um campo de texto com datalist — o
 * menu de sugestões do browser, diferente de tudo o resto — e "escrever para
 * juntar" ninguém descobria sozinho. Um select que se limpa depois de escolher
 * é o gesto que o resto da consola já ensinou.
 */
function ObjectiveChips({
  values,
  onChange,
  disabled,
}: {
  values: string[];
  onChange: (v: string[]) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      {values.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {values.map((v) => (
            <span key={v} className="inline-flex items-center gap-1 rounded-full bg-sunken px-2 py-0.5 text-[11px] font-medium text-ink-2">
              {v}
              {!disabled && (
                <button type="button" aria-label={`Remover ${v}`} onClick={() => onChange(values.filter((x) => x !== v))}>
                  <X className="size-3 text-ink-4 hover:text-ink" strokeWidth={2} />
                </button>
              )}
            </span>
          ))}
        </div>
      )}
      {!disabled && (
        <select
          className={dialogInputClass}
          value=""
          onChange={(e) => {
            const v = e.target.value;
            if (v && !values.includes(v)) onChange([...values, v]);
          }}
        >
          <option value="">Juntar objetivo…</option>
          {OBJECTIVE_CATEGORIES.map((c) => (
            <optgroup key={c.key} label={c.label}>
              {c.subs
                .filter((s) => !values.includes(s))
                .map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
      )}
    </div>
  );
}

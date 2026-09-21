import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { PageHeader } from "@/components/Shell";
import { Dialog, DialogField, dialogInputClass } from "@/components/Dialog";
import { FieldView, THUMB_RATIO } from "@/components/FieldEditor";
import { Empty, Loading, Panel, PanelHead, Pill, cx } from "@/components/primitives";
import { Check, ChevronDown, ChevronRight, Clock, Copy, DragHandle, Download, Plus, Search, Star, Trash2, TriangleAlert, Whistle, X } from "@/lib/icons";
import { teamById } from "@/lib/api";
import { can, isAcademyWide } from "@/lib/permissions";
import { longDate, shortDate, time } from "@/lib/format";
import { categoriesFor, exercisePath } from "@/lib/sports";
import {
  SESSION_TYPES,
  applyTemplate,
  deleteTemplate,
  getExercise,
  getPlan,
  listExercises,
  listTemplates,
  saveTemplate,
  minutesByCategory,
  savePlan,
  sessionLoad,
  type ExerciseSummary,
  type ObjectiveCategory,
  type PlanBlock,
  type SessionTemplateRow,
  type SessionPlan,
} from "@/lib/training";
import { useSession } from "@/session";
import { sharePlan } from "@/lib/training";
import { matches } from "@/lib/store";
import { cycleOn, dayKey, listCycles, matchDayLabel, mesoOf, microLabel, type Cycle } from "@/lib/cycles";
import { Users } from "@/lib/icons";

/**
 * O vocabulário do plano — as categorias de objectivo da modalidade da equipa
 * e a modalidade em si, para os blocos e os selectores lá dentro.
 *
 * Um plano do Sub-14 de basquetebol oferece "Tomada de decisão" e não
 * "Bolas paradas"; a ficha do exercício abre-se na área técnica certa. Vai por
 * contexto e não por props porque atravessa três níveis de componentes que
 * não têm mais nada a ver com isto.
 */
const PlanVocab = createContext<{ categories: ObjectiveCategory[]; sportId: string | null }>({
  categories: categoriesFor(null),
  sportId: null,
});

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
    if (!plan || dirty) return;
    setAExportar(true);
    try {
      const pdf = await import("@/lib/training-pdf");
      await pdf.exportarPlano(plan!, getExercise);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível gerar o PDF.");
    } finally {
      setAExportar(false);
    }
  }

  /*
   * Este plano acabou de ser aplicado a partir de um modelo.
   *
   * Serve para não perguntar "queres guardar como modelo?" a seguir a gravar um
   * plano que **é** um modelo — que é a forma mais rápida de encher a lista de
   * cópias do mesmo treino. Vive em estado e não na base: a pergunta é sobre
   * esta sessão de trabalho, não sobre o treino para sempre.
   */
  const [veioDeModelo, setVeioDeModelo] = useState(false);
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
  /*
   * Modelos de treino.
   *
   * `aPerguntar` abre a seguir a uma gravação com blocos — é o momento em que o
   * treinador acabou de montar o treino e sabe se ele vale a pena guardar.
   * Perguntar antes seria pedir uma decisão sobre trabalho por acabar; num menu
   * escondido, ninguém saberia que a hipótese existe.
   */
  const [aPerguntar, setAPerguntar] = useState(false);
  const [aEscolher, setAEscolher] = useState(false);
  /*
   * Pergunta-se uma vez por visita.
   *
   * Um plano grava-se cinco ou seis vezes enquanto se monta. A mesma janela a
   * aparecer a cada gravação deixava de ser uma pergunta e passava a ser um
   * obstáculo, do tipo que se fecha sem ler. Quem disser "agora não" e mudar de
   * ideias tem o botão "Modelos" — não fica sem caminho.
   */
  const jaPerguntou = useRef(false);

  const [picking, setPicking] = useState<"new" | number | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  /* A janela da partilha — abre a seguir a gravar. Ver `PartilharComAtletasDialog`. */
  const [aPartilhar, setAPartilhar] = useState(false);
  /* Uma vez por visita, pela mesma razão da do modelo: um plano grava-se cinco
     ou seis vezes enquanto se monta. */
  const respondeuPartilha = useRef(false);

  /**
   * A pergunta do modelo — sozinha, ou a seguir à da partilha.
   *
   * As duas são do fim, e nenhuma pode tapar a outra: empilhadas, a segunda era
   * fechada sem ler. Esta abre quando a da partilha se fechar.
   */
  function perguntarModelo() {
    if (!plan || plan.blocks.length === 0 || veioDeModelo || jaPerguntou.current) return;
    jaPerguntou.current = true;
    setAPerguntar(true);
  }

  useEffect(() => {
    setPlan(null);
    setError(null);
    getPlan(id)
      .then(setPlan)
      .catch((e: Error) => setError(e.message));
  }, [id]);

  /*
   * Onde este treino cai na periodização da equipa: o micro, a fase e o dia em
   * relação ao jogo. Só leitura, e só se a equipa periodizar. O treino não sabe
   * do ciclo: é o dia dele que o põe lá (ver `lib/cycles.ts`).
   */
  const [ciclos, setCiclos] = useState<Cycle[]>([]);
  const teamDoPlano = plan?.teamId;
  useEffect(() => {
    if (!teamDoPlano) return;
    let vivo = true;
    listCycles(teamDoPlano)
      .then((c) => vivo && setCiclos(c))
      .catch(() => vivo && setCiclos([]));
    return () => {
      vivo = false;
    };
  }, [teamDoPlano]);

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
      /*
       * Um treino sem blocos não dá modelo — e um treino que **veio** de um
       * modelo já lá está. Perguntar nesses dois casos era ruído a seguir a
       * cada gravação.
       */
      /*
       * As perguntas do fim, por ordem.
       *
       * Partilhar é sobre **este** treino, e é a que interessa a quem acabou de
       * o montar; guardar como modelo é sobre os treinos seguintes. A do modelo
       * fica para quando a da partilha se fechar — ver `perguntarModelo`.
       */
      if (plan.blocks.length > 0 && !respondeuPartilha.current) {
        respondeuPartilha.current = true;
        setAPartilhar(true);
      } else {
        perguntarModelo();
      }
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
  // A modalidade é a da equipa do treino — é ela que dá o vocabulário.
  const sportId = teamById(plan.teamId)?.sportId ?? null;
  const categories = categoriesFor(sportId);
  const allObjectiveValues = categories.flatMap((c) => [c.label, ...c.subs]);

  const dia = dayKey(start);
  const micro = cycleOn(ciclos, "MICRO", dia);
  const fase = micro ? mesoOf(ciclos, micro) : cycleOn(ciclos, "MESO", dia);
  const diasDeJogo = [
    ...new Set(matches.filter((m) => m.teamId === plan.teamId && m.status !== "CANCELLED").map((m) => dayKey(new Date(m.startsAt)))),
  ];
  const md = matchDayLabel(dia, diasDeJogo);
  const contexto = [micro ? microLabel(ciclos, micro) : null, md && md !== "MD" ? md : null, fase ? fase.name ?? fase.phase : null].filter(Boolean);

  return (
    <PlanVocab.Provider value={{ categories, sportId }}>
    <>
      <PageHeader
        eyebrow={["Plano de treino", ...contexto].join(" · ")}
        title={`${plan.teamName} · ${time(start)}`}
        subtitle={`${longDate(start)} · ${plan.venue}${plan.coachName ? ` · ${plan.coachName}` : ""}${
          plan.sharedAt ? " · Partilhado com os atletas" : ""
        }`}
      >
        <Link to={`/treinos?equipa=${plan.teamId}`} className="ctl-ghost">
          Planeamento
        </Link>
        {/*
          Um botão, e não dois.

          "Usar modelo" e "guardar como modelo" são o mesmo assunto, e o
          cabeçalho já leva cinco acções — em telemóvel, a sexta empurrava a
          linha para fora. Abre-se a lista, e é de lá que também se guarda.
        */}
        {editable && (
          <button type="button" className="ctl-outline" onClick={() => setAEscolher(true)}>
            <Copy className="size-3.5" strokeWidth={1.75} />
            Modelos Favoritos
          </button>
        )}
        {/*
          Leva os exercícios do plano atrás — ver `exportarPlano`. É por isso que
          demora mais do que os outros: vai buscar cada ficha à API.

          E só com o plano gravado. Um PDF de um plano por gravar é uma folha que
          o clube leva para o campo e que não corresponde ao que está no sistema —
          o treinador imprime, fecha o separador sem gravar, e fica com a única
          cópia do treino em papel. O botão diz porque está travado.
        */}
        {/* O `title` vai no <span> e não no <button>: um botão desactivado não
            recebe eventos do rato, e a dica nunca chegava a aparecer. */}
        <span title={dirty ? "Grava o plano primeiro — o PDF sai do que está gravado." : undefined}>
          <button
            type="button"
            className="ctl-outline"
            onClick={() => void exportarPdf()}
            disabled={aExportar || dirty}
          >
            <Download className="size-3.5" strokeWidth={1.75} />
            {aExportar ? "A gerar…" : "PDF"}
          </button>
        </span>
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

      {/*
        A intenção do micro, à vista de quem desenha o treino. É aqui que ela
        serve: o objetivo da semana ao lado do objetivo da sessão.
      */}
      {micro && (micro.objective || micro.focus.length > 0) && (
        <div className="mb-3 flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-[var(--radius-panel)] border border-line bg-sunken/50 px-4 py-2.5 text-meta">
          <span className="font-semibold text-ink">{microLabel(ciclos, micro)}</span>
          {micro.objective && (
            <span className="text-ink-2">
              <span className="text-ink-4">Objetivo </span>
              {micro.objective}
            </span>
          )}
          {micro.focus.length > 0 && (
            <span className="text-ink-2">
              <span className="text-ink-4">Foco </span>
              {micro.focus.join(", ")}
            </span>
          )}
        </div>
      )}

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
                  {categories.map((c) => (
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
          sportId={sportId}
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

      {aPartilhar && plan && (
        <PartilharComAtletasDialog
          plan={plan}
          onMudou={(sharedAt) => setPlan((cur) => (cur ? { ...cur, sharedAt } : cur))}
          onClose={() => {
            setAPartilhar(false);
            perguntarModelo();
          }}
        />
      )}

      {aPerguntar && plan && (
        <GuardarModeloDialog
          plan={plan}
          onClose={() => setAPerguntar(false)}
          onGuardado={() => setAPerguntar(false)}
        />
      )}

      {aEscolher && plan && (
        <ModelosDialog
          sessionId={plan.sessionId}
          temPlano={plan.blocks.length > 0}
          /* Guardar o que está no ecrã só faz sentido se o que está no ecrã já
             estiver gravado — senão guardava-se um plano que a base não tem. */
          podeGuardar={editable && plan.blocks.length > 0 && !dirty}
          onGuardar={() => {
            setAEscolher(false);
            setAPerguntar(true);
          }}
          onClose={() => setAEscolher(false)}
          onAplicado={(novo) => {
            setPlan(novo);
            setAEscolher(false);
            setVeioDeModelo(true);
            setDirty(false);
            setSaved(true);
          }}
        />
      )}
    </>
    </PlanVocab.Provider>
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
  const { categories, sportId } = useContext(PlanVocab);
  const cat = categories.find((c) => c.label === block.category);

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
            to={exercisePath(sportId, block.exerciseId ?? "")}
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
                  <Link to={exercisePath(sportId, block.exerciseId)} target="_blank" className="text-meta text-signal-ink hover:underline">
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

          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_110px_150px]">
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

          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_150px]">
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
                {categories.map((c) => (
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
  sportId,
}: {
  onClose: () => void;
  onPick: (e: ExerciseSummary) => void;
  /** O bloco que o vai receber, quando não é um bloco novo. */
  toBlock?: string;
  /** A modalidade do treino — só a biblioteca dela faz sentido aqui. */
  sportId?: string | null;
}) {
  const [all, setAll] = useState<ExerciseSummary[] | null>(null);
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<"fav" | "mine" | "all">("fav");

  useEffect(() => {
    listExercises(sportId ?? undefined)
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
  const { categories } = useContext(PlanVocab);
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
          {categories.map((c) => (
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

/* -------------------------------------------------------------------------- */
/* Partilhar o plano com os atletas                                           */
/* -------------------------------------------------------------------------- */

/**
 * "Partilhar este plano com os atletas?", a seguir a gravar.
 *
 * ## Porque é que a pergunta não é um botão
 *
 * Pela mesma razão da do modelo, e por mais duas. Um botão "partilhar" está
 * sempre lá — incluindo com o plano a meio, e o que os atletas leriam era um
 * treino por acabar. E o cabeçalho já levava cinco acções: a sexta empurrava a
 * linha para fora no telemóvel, que é onde o treinador monta o treino à beira
 * do campo.
 *
 * A seguir a gravar, o que está no ecrã é o que está no sistema — e é isso que
 * eles vão ler.
 *
 * ## Uma vez por visita, e nos dois sentidos
 *
 * Abre-se uma vez por visita: a mesma janela a cada gravação deixava de ser uma
 * pergunta e passava a ser um obstáculo, do tipo que se fecha sem ler. Traz
 * sempre as duas direcções — quem partilhou e se arrependeu fecha-o aqui, sem
 * procurar o gesto noutro sítio.
 *
 * O estado fica dito no subtítulo da página ("· Partilhado com os atletas"),
 * que é informação e não acção: nunca é preciso abrir isto só para saber.
 */
function PartilharComAtletasDialog({
  plan,
  onMudou,
  onClose,
}: {
  plan: SessionPlan;
  onMudou: (sharedAt: string | null) => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const partilhado = Boolean(plan.sharedAt);
  const total = plan.blocks.reduce((n, b) => n + (b.durationMin || 0), 0);

  async function alternar() {
    if (busy) return;
    setBusy(true);
    setErro(null);
    try {
      const r = await sharePlan(plan.sessionId, !partilhado);
      onMudou(r.sharedAt);
      onClose();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível partilhar.");
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={partilhado ? "Os atletas vêem este plano" : "Partilhar com os atletas?"}
      subtitle={`${plan.blocks.length} ${plan.blocks.length === 1 ? "bloco" : "blocos"} · ${total} min`}
      onClose={onClose}
      width={440}
      footer={
        <>
          <button type="button" className="ctl-ghost" onClick={onClose}>
            {partilhado ? "Manter partilhado" : "Agora não"}
          </button>
          <button
            type="button"
            className={partilhado ? "ctl-outline" : "ctl-primary"}
            onClick={() => void alternar()}
            disabled={busy}
          >
            {busy ? (
              "Um momento…"
            ) : partilhado ? (
              "Deixar de partilhar"
            ) : (
              <>
                <Users className="size-3.5" strokeWidth={1.75} />
                Partilhar
              </>
            )}
          </button>
        </>
      }
    >
      <div className="space-y-3 px-5 py-4">
        <p className="text-body leading-relaxed text-ink-2">
          {partilhado
            ? "Os atletas da equipa abrem este plano na app do clube, dentro do treino. O que acabaste de gravar é o que eles passam a ler."
            : "Os atletas da equipa passam a ver este plano na app do clube, dentro do treino — e recebem um aviso."}
        </p>

        {/* O que eles vêem, e o que não vêem. Dito antes de decidir, e não
            descoberto depois: `postNotes` é o balanço do treinador para si. */}
        <ul className="space-y-1.5 rounded-[var(--radius-control)] bg-sunken px-3 py-2.5 text-meta leading-relaxed text-ink-3">
          <li>Vêem o objetivo, o tipo de sessão e os blocos — com minutos e observações.</li>
          <li>Não vêem os desenhos dos exercícios nem as tuas notas do pós-treino.</li>
          <li>As famílias não vêem o plano: é para quem treina.</li>
        </ul>

        {erro && <p className="rounded-[var(--radius-control)] bg-risk-soft px-3 py-2 text-meta text-risk">{erro}</p>}
      </div>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* Modelos de treino                                                          */
/* -------------------------------------------------------------------------- */

/**
 * "Queres guardar este treino como modelo?", a seguir a gravar.
 *
 * ## Porque é que a pergunta aparece aqui e não num botão
 *
 * Porque é aqui que ela tem resposta. Um botão "guardar como modelo" no
 * cabeçalho está sempre lá, incluindo quando o plano está a meio — e quem o
 * carrega nessa altura guarda um treino por acabar. A seguir a gravar, o
 * treinador acabou de olhar para o plano inteiro e sabe se o vai voltar a usar.
 *
 * Sai com Escape ou "Agora não": a pergunta faz-se uma vez e não insiste.
 */
function GuardarModeloDialog({
  plan,
  onClose,
  onGuardado,
}: {
  plan: SessionPlan;
  onClose: () => void;
  onGuardado: () => void;
}) {
  /* Um nome de partida que já diz o que o treino é — quase sempre serve. */
  const [nome, setNome] = useState(plan.objective?.trim() || plan.sessionType?.trim() || "");
  const [soMeu, setSoMeu] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [feito, setFeito] = useState(false);

  const total = plan.blocks.reduce((n, b) => n + (b.durationMin || 0), 0);

  async function guardar() {
    if (!nome.trim() || guardando) return;
    setGuardando(true);
    setErro(null);
    try {
      await saveTemplate(plan.sessionId, {
        name: nome.trim(),
        visibility: soMeu ? "PRIVATE" : "CLUB",
      });
      setFeito(true);
      setTimeout(onGuardado, 900);
    } catch (e) {
      /*
       * O servidor recusa por duas razões — o nome já existe, ou o plano já
       * está guardado com outro nome — e diz qual em português. Mostra-se o que
       * ele disse: "não foi possível guardar" mandava o treinador adivinhar.
       */
      setErro(e instanceof Error ? e.message : "Não foi possível guardar o modelo.");
      setGuardando(false);
    }
  }

  return (
    <Dialog
      title="Guardar como modelo?"
      subtitle={`${plan.blocks.length} ${plan.blocks.length === 1 ? "bloco" : "blocos"} · ${total} min — para voltares a usar noutro treino.`}
      onClose={onClose}
      width={440}
      footer={
        <>
          <button type="button" className="ctl-ghost" onClick={onClose}>
            Agora não
          </button>
          <button type="button" className="ctl-primary" onClick={() => void guardar()} disabled={guardando || !nome.trim() || feito}>
            {feito ? (
              <>
                <Check className="size-3.5" strokeWidth={2} /> Guardado
              </>
            ) : guardando ? (
              "A guardar…"
            ) : (
              "Guardar modelo"
            )}
          </button>
        </>
      }
    >
      <div className="space-y-3 px-5 py-4">
        <DialogField label="Nome do modelo" hint="É por aqui que o vais encontrar na lista">
          <input
            autoFocus
            className={dialogInputClass}
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void guardar()}
            placeholder="Terça — posse em bloco médio"
            maxLength={80}
          />
        </DialogField>

        <div className="rounded-[var(--radius-control)] border border-line">
          <label className="flex cursor-pointer items-start gap-2.5 px-3 py-2.5">
            <input
              type="checkbox"
              checked={soMeu}
              onChange={(e) => setSoMeu(e.target.checked)}
              className="mt-0.5 size-3.5 accent-[var(--color-signal)]"
            />
            <span className="min-w-0">
              <span className="block text-body text-ink">Só para mim</span>
              <span className="mt-0.5 block text-meta leading-relaxed text-ink-3">
                Por omissão fica disponível a toda a equipa técnica — é a razão de existir uma
                biblioteca. Marca isto se for um treino teu que ainda estás a afinar.
              </span>
            </span>
          </label>
        </div>

        {erro && (
          <p role="alert" className="rounded-[var(--radius-control)] bg-risk-soft px-3 py-2 text-meta leading-relaxed text-risk">
            {erro}
          </p>
        )}
      </div>
    </Dialog>
  );
}

/**
 * Um modelo na lista: o que se vê sem abrir, e o que se vê ao abrir.
 *
 * Fechado responde a "serve-me?": nome, de quem é, carga, volume, blocos,
 * quando nasceu e quantas vezes já foi usado. Aberto responde a "o que é que
 * isto traz?": os blocos por ordem, com o tempo e o exercício de cada um, que
 * é o que ninguém conseguia ver sem aplicar o modelo e depois desfazer.
 */
function ModeloDaLista({
  modelo: m,
  aberto,
  onAbrir,
  aplicar,
  aAplicar,
  aApagar,
  pedirApagar,
  apagar,
}: {
  modelo: SessionTemplateRow;
  aberto: boolean;
  onAbrir: () => void;
  aplicar: () => void;
  aAplicar: string | null;
  aApagar: boolean;
  pedirApagar: () => void;
  apagar: () => void;
}) {
  /*
   * Apagar é só o que é meu, ou tudo para quem manda no clube. É a mesma regra
   * do servidor (`deleteTemplate`): mostrar o caixote a quem levaria com um 403
   * é prometer um botão que não funciona.
   */
  const { session } = useSession();
  const podeApagar = m.mine || isAcademyWide(session);
  /* A mesma carga que o plano mostra — ver `sessionLoad`, que é onde vive a conta. */
  const carga = sessionLoad(m.blocks, m.intensity);
  /* Modelos guardados antes de o servidor mandar a data ficam sem ela. */
  const criado = m.createdAt ? new Date(m.createdAt) : null;
  const usado = m.lastUsedAt ? new Date(m.lastUsedAt) : null;

  return (
    <li className="border-b border-line last:border-0">
      <div className="flex items-start gap-3 px-5 py-3">
        <button
          type="button"
          onClick={onAbrir}
          aria-expanded={aberto}
          className="min-w-0 flex-1 text-left"
        >
          <span className="flex flex-wrap items-center gap-2">
            <span className="truncate text-body font-medium text-ink">{m.name}</span>
            {/* Quem o vê, que é outra coisa de quem o fez: um modelo meu pode
                estar partilhado com o clube, e o separador "Do clube" é dos
                modelos dos outros. */}
            {m.visibility === "PRIVATE" ? <Pill tone="neutral">Só meu</Pill> : <Pill tone="neutral">Partilhado</Pill>}
            {m.sessionType && <Pill tone="neutral">{m.sessionType}</Pill>}
            {/* A carga estimada, com o mesmo tom do resto do plano. */}
            {m.blockCount > 0 && <Pill tone={carga.tone}>{`Carga ${carga.label.toLowerCase()}`}</Pill>}
          </span>
          <span className="mt-1 block truncate text-meta text-ink-2">
            {m.blockCount} {m.blockCount === 1 ? "bloco" : "blocos"} · {m.totalMin} min
            {m.blockCount > 0 ? ` · intensidade ${(carga.score / 10).toFixed(1)}/10` : ""}
            {m.expectedAthletes ? ` · ${m.expectedAthletes} atletas` : ""}
          </span>
          <span className="mt-0.5 block truncate text-meta text-ink-3">
            {m.objective ?? m.objectives.join(" · ") ?? ""}
            {m.objective || m.objectives.length > 0 ? " · " : ""}
            {m.mine ? "criado por mim" : m.authorName ? `criado por ${m.authorName}` : "autor desconhecido"}
            {criado && !Number.isNaN(criado.getTime()) ? ` · ${shortDate(criado)}` : ""}
            {/* Quantas vezes já foi usado: é o que distingue o modelo de
                terça-feira de um que se guardou uma vez e nunca mais. */}
            {m.useCount > 0 ? ` · usado ${m.useCount}×` : " · nunca usado"}
            {usado ? ` (última vez ${shortDate(usado)})` : ""}
          </span>
        </button>

        <span className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            className="ctl-outline"
            onClick={aplicar}
            disabled={aAplicar !== null}
          >
            {aAplicar === m.id ? "A aplicar…" : "Usar"}
          </button>
          {/*
            Fora do botão de abrir, e não lá dentro: um <button> dentro de outro
            não é HTML válido, e apagar não pode ser um clique na linha.
          */}
          {podeApagar &&
            (aApagar ? (
              <button type="button" className="ctl-ghost text-risk" onClick={apagar}>
                Apagar?
              </button>
            ) : (
              <button
                type="button"
                aria-label={`Apagar o modelo ${m.name}`}
                className="ctl-ghost size-8 justify-center px-0 text-ink-4 hover:text-risk"
                onClick={pedirApagar}
              >
                <Trash2 className="size-3.5" strokeWidth={1.75} />
              </button>
            ))}
          <ChevronDown
            className={cx("size-4 text-ink-4 transition-transform", aberto && "rotate-180")}
            strokeWidth={1.75}
          />
        </span>
      </div>

      {aberto && (
        <div className="border-t border-line bg-sunken/50 px-5 py-3">
          {m.blocks.length === 0 ? (
            <p className="text-meta text-ink-3">Este modelo não tem blocos.</p>
          ) : (
            <ol className="space-y-1.5">
              {m.blocks.map((b, idx) => (
                <li key={`${b.name}-${idx}`} className="flex items-baseline gap-2 text-meta">
                  <span className="num w-10 shrink-0 text-right text-ink-3">{b.durationMin}′</span>
                  <span className="min-w-0 flex-1">
                    <span className="text-ink-2">{b.name}</span>
                    {b.exerciseName && <span className="text-ink-3">{` · ${b.exerciseName}`}</span>}
                    {b.category && <span className="text-ink-4">{` · ${b.category}`}</span>}
                    {b.intensity != null && <span className="text-ink-4">{` · int. ${b.intensity}/10`}</span>}
                  </span>
                </li>
              ))}
            </ol>
          )}
          {m.material && (
            <p className="mt-2.5 text-meta text-ink-3">
              <span className="font-medium text-ink-2">Material:</span> {m.material}
            </p>
          )}
          {m.planNotes && <p className="mt-1.5 text-meta whitespace-pre-line text-ink-3">{m.planNotes}</p>}
        </div>
      )}
    </li>
  );
}

/** Separadores da lista de modelos: de quem são. */
type AbaDeModelos = "todos" | "meus" | "clube";

/** Como se ordena a lista. */
type OrdemDeModelos = "usados" | "recentes" | "nome";

/**
 * A lista de modelos — escolher um, ou guardar este treino como mais um.
 *
 * As duas coisas no mesmo sítio porque são a mesma pergunta vista dos dois
 * lados, e porque separá-las custava outro botão no cabeçalho.
 *
 * ## Porque é que cada modelo diz tanto
 *
 * Era uma lista de nomes, e um nome não chega para decidir: "Terça" não diz se
 * é um treino de 60 ou de 100 minutos, se é leve ou se rebenta com o plantel,
 * se é meu ou do colega, nem se é de há duas semanas ou da época passada.
 * Agora cada linha traz a carga estimada (a mesma aritmética do plano, ver
 * `sessionLoad`), o volume, o tipo de sessão, quem o fez, quando o fez, quantas
 * vezes já foi usado, e abre para mostrar os blocos que traz.
 *
 * Os separadores respondem à pergunta de quem procura: **os meus** e os **do
 * clube** (os que os colegas partilharam). Não há modelos de fora do clube: a
 * biblioteca é de cada academia, e um "comunidade" com o que os colegas
 * partilharam chamava comunidade a outra coisa.
 *
 * Aplicar deixou de ser um clique na linha: a linha abre, e quem aplica carrega
 * em "Usar este modelo". O aviso de que aplicar **substitui** está à vista antes
 * de escolher, e não numa confirmação por cima: quem carregou decidiu, e uma
 * segunda janela a perguntar "de certeza?" carrega-se sem ler.
 */
function ModelosDialog({
  sessionId,
  temPlano,
  podeGuardar,
  onGuardar,
  onClose,
  onAplicado,
}: {
  sessionId: string;
  temPlano: boolean;
  podeGuardar: boolean;
  onGuardar: () => void;
  onClose: () => void;
  onAplicado: (plan: SessionPlan) => void;
}) {
  const [modelos, setModelos] = useState<SessionTemplateRow[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aAplicar, setAAplicar] = useState<string | null>(null);
  /* Apagar pede confirmação no próprio sítio: o segundo toque no caixote. */
  const [aApagar, setAApagar] = useState<string | null>(null);
  const [aba, setAba] = useState<AbaDeModelos>("todos");
  const [ordem, setOrdem] = useState<OrdemDeModelos>("usados");
  const [procura, setProcura] = useState("");
  /* Um modelo aberto de cada vez: aberto às pilhas, a lista deixa de se ler. */
  const [aberto, setAberto] = useState<string | null>(null);

  useEffect(() => {
    listTemplates()
      .then(setModelos)
      .catch((e: Error) => setErro(e.message));
  }, []);

  async function aplicar(id: string) {
    if (aAplicar) return;
    setAAplicar(id);
    setErro(null);
    try {
      onAplicado(await applyTemplate(sessionId, id));
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível aplicar o modelo.");
      setAAplicar(null);
    }
  }

  async function apagar(id: string) {
    setErro(null);
    try {
      await deleteTemplate(id);
      setModelos((atuais) => (atuais ?? []).filter((m) => m.id !== id));
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível apagar o modelo.");
    } finally {
      setAApagar(null);
    }
  }

  /* Quantos há de cada lado — o separador di-lo antes de se lá ir. */
  const meus = (modelos ?? []).filter((m) => m.mine).length;
  const doClube = (modelos ?? []).length - meus;

  const termo = procura.trim().toLowerCase();
  const lista = (modelos ?? [])
    .filter((m) => (aba === "meus" ? m.mine : aba === "clube" ? !m.mine : true))
    .filter(
      (m) =>
        !termo ||
        [m.name, m.objective, m.sessionType, m.authorName, ...m.objectives]
          .filter(Boolean)
          .some((t) => String(t).toLowerCase().includes(termo)),
    )
    .sort((a, b) =>
      ordem === "nome"
        ? a.name.localeCompare(b.name, "pt")
        : ordem === "recentes"
          ? b.createdAt.localeCompare(a.createdAt)
          : b.useCount - a.useCount || b.updatedAt.localeCompare(a.updatedAt),
    );

  return (
    <Dialog
      title="Modelos de treino"
      subtitle={
        temPlano
          ? "O plano que está aqui é substituído pelo do modelo."
          : "O plano deste treino passa a ser o do modelo."
      }
      onClose={onClose}
      width={640}
      footer={
        <>
          {podeGuardar && (
            <button type="button" className="ctl-outline mr-auto" onClick={onGuardar}>
              <Star className="size-3.5" strokeWidth={1.75} />
              Guardar este treino
            </button>
          )}
          <button type="button" className="ctl-ghost" onClick={onClose}>
            Fechar
          </button>
        </>
      }
    >
      {erro && (
        <p role="alert" className="border-b border-line bg-risk-soft px-5 py-2.5 text-meta text-risk">
          {erro}
        </p>
      )}

      {modelos === null ? (
        <div className="px-5 py-12"><Loading size="panel" /></div>
      ) : modelos.length === 0 ? (
        <div className="px-5 py-10">
          <Empty
            title="Ainda não há modelos"
            detail="Monta um treino, grava-o, e guarda-o como modelo — passa a estar aqui para os próximos."
          />
        </div>
      ) : (
        <>
          {/*
            A barra de cima: de quem são, por que ordem, e a procura. Fica
            colada ao topo porque a lista corre por baixo dela.
          */}
          <div className="sticky top-0 z-10 space-y-2.5 border-b border-line bg-surface px-5 py-3">
            <div className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  ["todos", `Todos (${modelos.length})`],
                  ["meus", `Criados por mim (${meus})`],
                  ["clube", `Do clube (${doClube})`],
                ] as [AbaDeModelos, string][]
              ).map(([chave, rotulo]) => (
                <button
                  key={chave}
                  type="button"
                  onClick={() => setAba(chave)}
                  className={cx(
                    "h-8 rounded-full px-3 text-meta font-medium transition-colors",
                    aba === chave ? "bg-ink text-surface" : "bg-sunken text-ink-2 hover:text-ink",
                  )}
                >
                  {rotulo}
                </button>
              ))}
              <select
                aria-label="Ordenar os modelos"
                value={ordem}
                onChange={(e) => setOrdem(e.target.value as OrdemDeModelos)}
                className="ml-auto h-8 rounded-full bg-sunken px-3 text-meta font-medium text-ink-2"
              >
                <option value="usados">Mais usados</option>
                <option value="recentes">Mais recentes</option>
                <option value="nome">Por nome</option>
              </select>
            </div>
            <div className="relative">
              <Search className="absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-ink-4" strokeWidth={1.75} />
              <input
                value={procura}
                onChange={(e) => setProcura(e.target.value)}
                placeholder="Procurar por nome, objectivo ou autor"
                className={cx(dialogInputClass, "h-9 pl-8")}
              />
            </div>
          </div>

          {lista.length === 0 ? (
            <div className="px-5 py-10">
              <Empty
                title="Nada por aqui"
                detail={
                  termo
                    ? "Nenhum modelo com esse nome, objectivo ou autor."
                    : aba === "meus"
                      ? "Ainda não guardaste nenhum modelo. Monta um treino, grava-o, e guarda-o aqui."
                      : "Nenhum colega partilhou modelos com o clube."
                }
              />
            </div>
          ) : (
            <ul>
              {lista.map((m) => (
                <ModeloDaLista
                  key={m.id}
                  modelo={m}
                  aberto={aberto === m.id}
                  onAbrir={() => setAberto((cur) => (cur === m.id ? null : m.id))}
                  aplicar={() => void aplicar(m.id)}
                  aAplicar={aAplicar}
                  aApagar={aApagar === m.id}
                  pedirApagar={() => setAApagar(m.id)}
                  apagar={() => void apagar(m.id)}
                />
              ))}
            </ul>
          )}
        </>
      )}
    </Dialog>
  );
}

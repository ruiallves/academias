import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { PageHeader } from "@/components/Shell";
import { Dialog, DialogField, dialogInputClass } from "@/components/Dialog";
import { Pitch, baseView, itemScale } from "@/components/FieldEditor";
import { LineupThumb, lineupField } from "@/components/training/LineupThumb";
import { RelatedExercisesPanel } from "@/components/training/RelatedExercises";
import { Empty, Loading, Panel, PanelHead, Pill, SelectField, cx } from "@/components/primitives";
import { Check, ChevronDown, ChevronRight, Download, Plus, Shield, Trash2, TriangleAlert } from "@/lib/icons";
import { listTeams } from "@/lib/api";
import { can } from "@/lib/permissions";
import { kindLabel } from "@/lib/sports";
import {
  FORMAT_LABEL,
  asLineupData,
  createGameModel,
  deleteGameModel,
  fieldSize,
  listGameModels,
  listSetPieces,
  systemLineup,
  systemsFor,
  teamFormat,
  updateGameModel,
  type GameModelRow,
  type LineupData,
  type LineupPitch,
  type LineupSlot,
  type Principles,
  type SetPieceRow,
} from "@/lib/training";
import { useSession } from "@/session";
import { useSportArea } from "./sport-area-context";

/**
 * Modelos de jogo — ou sistemas de jogo, conforme a modalidade.
 *
 * ## O sistema é um desenho, não um enum
 *
 * "4-3-3" é o ponto de partida: aplica posições ao quadro e a partir daí cada
 * bolinha arrasta-se para onde o modelo manda — o que se grava são coordenadas.
 * Um treinador que jogue com o lateral por dentro desenha exatamente isso.
 *
 * As secções escritas são a outra metade: o desenho diz *onde*, o texto diz
 * *como*. E os exercícios relacionados dizem *como se ensina*.
 *
 * ## O que vem da modalidade
 *
 * O nome do módulo ("Modelos de jogo" / "Sistemas de jogo"), os terrenos e os
 * sistemas de partida, as secções dos princípios e — no basquetebol — o
 * **tipo** (ataque, defesa, transição): um 5-out e uma zona 2-3 não são o
 * mesmo objecto, e o treinador arruma-os em colunas diferentes. No futebol o
 * modelo é o todo da equipa e não tem tipo.
 */
export default function GameModels() {
  const { sport, profile, path } = useSportArea();
  const { session } = useSession();
  const navigate = useNavigate();
  const mayWrite = can(session, "training:write");
  const kinds = profile.playbook.kinds;

  const [rows, setRows] = useState<GameModelRow[] | null>(null);
  const [kind, setKind] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    setRows(null);
    listGameModels(sport.id).then(setRows).catch(() => setRows([]));
  }, [sport.id]);

  const filtered = useMemo(() => (rows ?? []).filter((r) => !kind || r.kind === kind), [rows, kind]);

  if (rows === null) return <Loading />;

  return (
    <>
      <PageHeader title={profile.playbook.label} subtitle={profile.playbook.description}>
        {mayWrite && (
          <button type="button" className="ctl-primary" onClick={() => setCreating(true)}>
            <Plus className="size-3.5" strokeWidth={1.75} />
            Novo {profile.playbook.singular}
          </button>
        )}
      </PageHeader>

      <div className="space-y-3">
        {kinds && rows.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setKind("")}
              className={cx("h-8 rounded-full px-3 text-meta font-medium transition-colors", !kind ? "bg-ink text-surface" : "bg-sunken text-ink-2 hover:text-ink")}
            >
              Todos
            </button>
            {kinds.map((k) => {
              const count = rows.filter((r) => r.kind === k.key).length;
              return (
                <button
                  key={k.key}
                  type="button"
                  onClick={() => setKind(kind === k.key ? "" : k.key)}
                  className={cx(
                    "h-8 rounded-full px-3 text-meta font-medium transition-colors",
                    kind === k.key ? "bg-ink text-surface" : "bg-sunken text-ink-2 hover:text-ink",
                  )}
                >
                  {k.label}
                  {count > 0 && <span className="ml-1.5 text-[10px] opacity-70 tabular">{count}</span>}
                </button>
              );
            })}
          </div>
        )}

        {filtered.length === 0 ? (
          <Panel>
            <Empty
              title={rows.length === 0 ? `Ainda não há ${profile.playbook.label.toLowerCase()}` : "Nada deste tipo"}
              detail={`Um ${profile.playbook.singular} guarda as posições, os princípios e os exercícios com que se treina — e fica no clube, época após época.`}
              icon={Shield}
            >
              {mayWrite && rows.length === 0 && (
                <button type="button" className="ctl-primary" onClick={() => setCreating(true)}>
                  Criar o primeiro
                </button>
              )}
            </Empty>
          </Panel>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {filtered.map((m) => {
              const to = path("playbook", m.id);
              return (
                <div
                  key={m.id}
                  role="link"
                  tabIndex={0}
                  onClick={() => navigate(to)}
                  onKeyDown={(e) => e.key === "Enter" && navigate(to)}
                  className="panel cursor-pointer overflow-hidden transition-colors hover:border-line-strong"
                >
                  <LineupThumb data={asLineupData(m.lineup)} />
                  <div className="space-y-1 p-3.5">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="min-w-0 truncate text-body font-semibold text-ink">{m.name}</h3>
                      {m.system && <Pill tone="signal">{m.system}</Pill>}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 text-meta text-ink-3">
                      {kinds && m.kind && <Pill>{kindLabel([{ label: null, kinds }], m.kind)}</Pill>}
                      <span>
                        {m.teamName ?? "Todo o clube"}
                        {m.visibility === "PRIVATE" ? " · só meu" : ""}
                        {m.authorName ? ` · ${m.authorName}` : ""}
                        {m.exercises.length > 0 ? ` · ${m.exercises.length} exerc.` : ""}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {creating && <NewModelDialog onClose={() => setCreating(false)} onCreated={(id) => navigate(path("playbook", id))} />}
    </>
  );
}

function NewModelDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const { sport, profile } = useSportArea();
  const { session } = useSession();
  // Só as equipas desta modalidade: um modelo de futsal não é do Sub-11 de futebol.
  const teams = listTeams(session).filter((t) => t.sportId === sport.id);
  const formats = profile.vocabulary.formats;
  const kinds = profile.playbook.kinds;

  const suggested = teamFormat(teams[0]?.id);
  const [name, setName] = useState("");
  const [teamId, setTeamId] = useState(teams[0]?.id ?? "");
  const [kind, setKind] = useState(kinds?.[0]?.key ?? "");
  const [pitch, setPitch] = useState<LineupPitch>(() => (formats.includes(suggested) ? suggested : profile.defaultFormat));
  const [system, setSystem] = useState(() => systemsFor(formats.includes(suggested) ? suggested : profile.defaultFormat)[0].label);
  const [busy, setBusy] = useState(false);

  // Mudar de equipa muda a variante por omissão — um Sub-13 de futebol 9 não
  // começa num 4-3-3 de campo de onze. Continua a poder trocar-se à mão.
  const chooseTeam = (id: string) => {
    setTeamId(id);
    const p = teamFormat(id);
    if (formats.includes(p) && p !== pitch) choosePitch(p);
  };

  const choosePitch = (p: LineupPitch) => {
    setPitch(p);
    setSystem(systemsFor(p)[0].label);
  };

  async function create() {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      const { id } = await createGameModel({
        name: name.trim(),
        system,
        kind: kinds ? kind || null : null,
        teamId: teamId || null,
        sportId: sport.id,
        lineup: { pitch, slots: systemLineup(system, pitch) },
        visibility: "CLUB",
      });
      onCreated(id);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Não foi possível criar.");
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={`Novo ${profile.playbook.singular}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="ctl-outline" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="ctl-primary" onClick={create} disabled={!name.trim() || busy}>
            Criar
          </button>
        </>
      }
    >
      <div className="space-y-3.5 p-5">
        <DialogField label="Nome">
          <input autoFocus className={dialogInputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder={profile.playbook.newPlaceholder} />
        </DialogField>
        {kinds && (
          <DialogField label="Tipo">
            <select className={dialogInputClass} value={kind} onChange={(e) => setKind(e.target.value)}>
              {kinds.map((k) => (
                <option key={k.key} value={k.key}>
                  {k.label}
                </option>
              ))}
            </select>
          </DialogField>
        )}
        {formats.length > 1 && (
          <DialogField label="Variante" hint="a equipa sugere, tu decides">
            <select className={dialogInputClass} value={pitch} onChange={(e) => choosePitch(e.target.value as LineupPitch)}>
              {formats.map((f) => (
                <option key={f} value={f}>
                  {FORMAT_LABEL[f]}
                </option>
              ))}
            </select>
          </DialogField>
        )}
        <div className="grid grid-cols-2 gap-3">
          <DialogField label="Equipa">
            <select className={dialogInputClass} value={teamId} onChange={(e) => chooseTeam(e.target.value)}>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
              <option value="">Todo o clube</option>
            </select>
          </DialogField>
          <DialogField label="Sistema de partida">
            <select className={dialogInputClass} value={system} onChange={(e) => setSystem(e.target.value)}>
              {systemsFor(pitch).map((s) => (
                <option key={s.label} value={s.label}>
                  {s.label}
                </option>
              ))}
            </select>
          </DialogField>
        </div>
      </div>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* Ficha do modelo                                                             */
/* -------------------------------------------------------------------------- */

export function GameModelDetail() {
  const { id = "" } = useParams();
  const { sport, profile, path } = useSportArea();
  const navigate = useNavigate();
  const { session } = useSession();
  const mayWrite = can(session, "training:write");
  const teams = listTeams(session).filter((t) => t.sportId === sport.id);
  const formats = profile.vocabulary.formats;
  const kinds = profile.playbook.kinds;

  const [model, setModel] = useState<GameModelRow | null>(null);
  /** As situações que partem deste sistema — a ligação inversa. */
  const [linkedSituations, setLinkedSituations] = useState<SetPieceRow[]>([]);
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
    if (!model) return;
    setAExportar(true);
    try {
      const pdf = await import("@/lib/training-pdf");
      await pdf.exportarModelo(model!);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível gerar o PDF.");
    } finally {
      setAExportar(false);
    }
  }

  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [openSection, setOpenSection] = useState<string | null>(profile.playbook.sections[0]?.key ?? null);

  useEffect(() => {
    listGameModels(sport.id)
      .then((rows) => {
        const m = rows.find((r) => r.id === id);
        if (!m) setError("Este modelo não existe ou não é visível para ti.");
        else setModel(m);
      })
      .catch((e: Error) => setError(e.message));
    listSetPieces(sport.id)
      .then((rows) => setLinkedSituations(rows.filter((r) => r.gameModelId === id)))
      .catch(() => setLinkedSituations([]));
  }, [id, sport.id]);

  const editable = Boolean(model?.editable) && mayWrite;

  const patch = (p: Partial<GameModelRow>) => {
    setModel((m) => (m ? { ...m, ...p } : m));
    setDirty(true);
    setSaved(false);
  };

  async function save() {
    if (!model || saving) return;
    setSaving(true);
    try {
      await updateGameModel(model.id, {
        name: model.name,
        kind: model.kind,
        system: model.system,
        teamId: model.teamId,
        visibility: model.visibility,
        lineup: model.lineup,
        principles: model.principles,
        notes: model.notes,
        exerciseIds: model.exercises.map((e) => e.id),
      } as Partial<GameModelRow> & { exerciseIds: string[] });
      setDirty(false);
      setSaved(true);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Não foi possível gravar.");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!model) return;
    if (!confirm(`Apagar este ${profile.playbook.singular}?`)) return;
    await deleteGameModel(model.id);
    navigate(path("playbook"));
  }

  if (error) {
    return (
      <Panel>
        <Empty title="Não encontrado" detail={error} icon={TriangleAlert}>
          <Link to={path("playbook")} className="ctl-outline">
            Voltar
          </Link>
        </Empty>
      </Panel>
    );
  }
  if (!model) return <Loading />;

  const lineupData = asLineupData(model.lineup);
  const pitch = lineupData.pitch;
  const principles = (model.principles as Principles | null) ?? {};

  /** Trocar de variante recomeça do primeiro sistema dela — terrenos e
   *  sistemas diferentes, posições que não se traduzem uma a uma. */
  const setPitch = (p: LineupPitch) => {
    if (p === pitch) return;
    const first = systemsFor(p)[0].label;
    patch({ system: first, lineup: { pitch: p, slots: systemLineup(first, p) } });
  };

  const eyebrow = [capitalize(profile.playbook.count(1).replace(/^1 /, "")), kinds && model.kind ? kindLabel([{ label: null, kinds }], model.kind) : null]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      <PageHeader eyebrow={eyebrow} title={model.name} subtitle={model.teamName ?? "Todo o clube"}>
        <Link to={path("playbook")} className="ctl-ghost">
          {profile.playbook.label}
        </Link>
        <button type="button" className="ctl-outline" onClick={() => void exportarPdf()} disabled={aExportar}>
          <Download className="size-3.5" strokeWidth={1.75} />
          {aExportar ? "A gerar…" : "PDF"}
        </button>
        {editable && model.deletable && (
          <button type="button" className="ctl-ghost text-risk hover:bg-risk-soft hover:text-risk" onClick={remove}>
            <Trash2 className="size-3.5" strokeWidth={1.75} />
          </button>
        )}
        {editable && (
          <button type="button" className="ctl-primary" onClick={save} disabled={saving || !dirty}>
            {saved && !dirty ? (
              <>
                <Check className="size-3.5" strokeWidth={2} /> Guardado
              </>
            ) : saving ? (
              "A guardar…"
            ) : (
              "Guardar"
            )}
          </button>
        )}
      </PageHeader>

      <div className="grid gap-3 xl:grid-cols-3">
        <div className="space-y-3 xl:col-span-2">
          <Panel className="self-start">
            <PanelHead title={profile.playbook.lineupLabel} hint={editable ? "arrasta as posições" : undefined}>
              {editable && (
                <>
                  {formats.length > 1 && (
                    <SelectField
                      aria-label="Variante"
                      size="sm"
                      value={pitch}
                      onChange={(p) => setPitch(p as LineupPitch)}
                      options={formats.map((f) => ({ value: f, label: FORMAT_LABEL[f] }))}
                    />
                  )}
                  <SelectField
                    aria-label="Sistema"
                    size="sm"
                    value={model.system ?? systemsFor(pitch)[0].label}
                    /*
                     * Trocar o sistema já aplica as posições dele — não há um
                     * segundo passo. Um "4-3-3" escolhido e ignorado (as
                     * bolinhas a ficar onde estavam do 4-4-2 anterior) confundia
                     * mais do que ajudava: quem troca de sistema quer vê-lo no
                     * quadro, e quem só quer o rótulo sem mexer nas posições
                     * continua a poder arrastar a seguir.
                     */
                    onChange={(s) => patch({ system: s, lineup: { pitch, slots: systemLineup(s, pitch) } })}
                    options={systemsFor(pitch).map((x) => ({ value: x.label, label: x.label }))}
                  />
                </>
              )}
            </PanelHead>
            <div className="p-4">
              <LineupBoard data={lineupData} editable={editable} onChange={(slots) => patch({ lineup: { pitch, slots } })} />
            </div>
          </Panel>

          <Panel>
            <RelatedExercisesPanel
              sportId={sport.id}
              exercises={model.exercises}
              editable={editable}
              onChange={(next) => patch({ exercises: next })}
              hint={`com que se treina este ${profile.playbook.singular}`}
            />
          </Panel>

          {linkedSituations.length > 0 && (
            <Panel>
              <PanelHead title={`${profile.situations.label} que partem daqui`} hint="a ligação inversa" />
              <ul className="divide-y divide-line">
                {linkedSituations.map((s) => (
                  <li key={s.id} className="flex items-center gap-2.5 px-5 py-2.5">
                    <Pill>{kindLabel(profile.situations.groups, s.kind)}</Pill>
                    <Link to={path("situations", s.id)} className="min-w-0 flex-1 truncate text-body text-ink hover:underline">
                      {s.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>

        <div className="space-y-3">
          <Panel>
            <PanelHead title="Ficha" />
            <div className="space-y-3.5 p-5">
              <DialogField label="Nome">
                <input className={dialogInputClass} value={model.name} onChange={(e) => patch({ name: e.target.value })} disabled={!editable} />
              </DialogField>
              {kinds && (
                <DialogField label="Tipo">
                  <select className={dialogInputClass} value={model.kind ?? ""} onChange={(e) => patch({ kind: e.target.value || null })} disabled={!editable}>
                    <option value="">Sem tipo</option>
                    {kinds.map((k) => (
                      <option key={k.key} value={k.key}>
                        {k.label}
                      </option>
                    ))}
                  </select>
                </DialogField>
              )}
              <DialogField label="Equipa">
                <select className={dialogInputClass} value={model.teamId ?? ""} onChange={(e) => patch({ teamId: e.target.value || null })} disabled={!editable}>
                  <option value="">Todo o clube</option>
                  {teams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </DialogField>
              {editable && (
                <DialogField label="Quem o vê">
                  <div className="grid grid-cols-2 gap-2">
                    {(
                      [
                        ["CLUB", "Todo o clube"],
                        ["PRIVATE", "Só eu"],
                      ] as const
                    ).map(([v, label]) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => patch({ visibility: v })}
                        className={cx(
                          "rounded-[var(--radius-control)] border p-2 text-meta font-semibold transition-colors",
                          model.visibility === v ? "border-line-strong bg-sunken/60 text-ink" : "border-line text-ink-2 hover:border-line-strong",
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </DialogField>
              )}
              <DialogField label="Notas">
                <textarea rows={3} className={cx(dialogInputClass, "h-auto py-2")} value={model.notes ?? ""} onChange={(e) => patch({ notes: e.target.value || null })} disabled={!editable} />
              </DialogField>
            </div>
          </Panel>

          <Panel>
            <PanelHead title="Princípios" hint="o como, por escrito" />
            <ul className="divide-y divide-line">
              {profile.playbook.sections.map((section) => {
                const open = openSection === section.key;
                const filled = section.topics.filter((t) => principles[section.key]?.[t]?.trim()).length;
                return (
                  <li key={section.key}>
                    <button
                      type="button"
                      onClick={() => setOpenSection(open ? null : section.key)}
                      className="flex w-full items-center gap-2 px-5 py-2.5 text-left transition-colors hover:bg-sunken/50"
                    >
                      {open ? <ChevronDown className="size-4 text-ink-4" strokeWidth={1.75} /> : <ChevronRight className="size-4 text-ink-4" strokeWidth={1.75} />}
                      <span className="flex-1 text-body font-medium text-ink">{section.label}</span>
                      <span className="text-meta text-ink-4 tabular">
                        {filled}/{section.topics.length}
                      </span>
                    </button>
                    {open && (
                      <div className="space-y-3 border-t border-line bg-sunken/30 px-5 py-4">
                        {section.topics.map((topic) => {
                          const value = principles[section.key]?.[topic] ?? "";
                          if (!editable && !value) return null;
                          return (
                            <DialogField key={topic} label={topic}>
                              {editable ? (
                                <textarea
                                  rows={2}
                                  className={cx(dialogInputClass, "h-auto py-2")}
                                  value={value}
                                  onChange={(e) =>
                                    patch({
                                      principles: {
                                        ...principles,
                                        [section.key]: { ...principles[section.key], [topic]: e.target.value },
                                      },
                                    })
                                  }
                                  placeholder={`Como jogamos: ${topic.toLowerCase()}`}
                                />
                              ) : (
                                <p className="text-body whitespace-pre-wrap text-ink-2">{value}</p>
                              )}
                            </DialogField>
                          );
                        })}
                        {!editable && filled === 0 && <p className="text-meta text-ink-4">Por escrever.</p>}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </Panel>
        </div>
      </div>
    </>
  );
}

const capitalize = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/* -------------------------------------------------------------------------- */
/* O quadro do sistema                                                         */
/* -------------------------------------------------------------------------- */

/** O quadro grande: cada posição arrasta-se; o rótulo edita-se ao selecionar. */
function LineupBoard({
  data,
  editable,
  onChange,
}: {
  data: LineupData;
  editable: boolean;
  onChange: (slots: LineupSlot[]) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const drag = useRef<{ id: string; dx: number; dy: number } | null>(null);
  const field = lineupField(data.pitch);
  const lineup = data.slots;
  const k = itemScale(field);
  // O limite do arrasto é o terreno da variante — era um par fixo (futsal ou
  // campo de onze) e deixava o futebol 7 arrastar posições para fora do campo.
  const size = fieldSize(field);
  const max = { x: size.w, y: size.h };
  const v = baseView(field);

  const toField = (clientX: number, clientY: number) => {
    const rect = svgRef.current!.getBoundingClientRect();
    const scale = Math.min(rect.width / v.w, rect.height / v.h);
    const padX = (rect.width - v.w * scale) / 2;
    const padY = (rect.height - v.h * scale) / 2;
    return { x: v.x + (clientX - rect.left - padX) / scale, y: v.y + (clientY - rect.top - padY) / scale };
  };

  const slot = lineup.find((s) => s.id === selected) ?? null;

  return (
    <div>
      <svg
        ref={svgRef}
        viewBox={`${v.x} ${v.y} ${v.w} ${v.h}`}
        className="w-full touch-none rounded-[var(--radius-control)]"
        preserveAspectRatio="xMidYMid meet"
        onPointerDown={(e) => {
          if (!editable) return;
          const id = (e.target as Element).closest("[data-id]")?.getAttribute("data-id");
          if (!id) {
            setSelected(null);
            return;
          }
          (e.currentTarget as Element).setPointerCapture(e.pointerId);
          setSelected(id);
          const p = toField(e.clientX, e.clientY);
          const s = lineup.find((x) => x.id === id)!;
          drag.current = { id, dx: s.x - p.x, dy: s.y - p.y };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const p = toField(e.clientX, e.clientY);
          onChange(
            lineup.map((s) =>
              s.id === d.id
                ? { ...s, x: Math.max(0, Math.min(max.x, p.x + d.dx)), y: Math.max(0, Math.min(max.y, p.y + d.dy)) }
                : s,
            ),
          );
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
      >
        <Pitch field={field} />
        {lineup.map((s) => (
          <g key={s.id} data-id={s.id} transform={`translate(${s.x} ${s.y}) scale(${k})`} className={editable ? "cursor-move" : undefined}>
            <circle
              r={2.4}
              fill="#1d3a5f"
              stroke={selected === s.id ? "#ffd65a" : "rgba(255,255,255,0.85)"}
              strokeWidth={selected === s.id ? 0.5 : 0.28}
            />
            <text y={0.85} textAnchor="middle" fontSize={2} fontWeight={700} fill="#fff" style={{ userSelect: "none" }}>
              {s.label}
            </text>
          </g>
        ))}
      </svg>

      {editable && (
        <div className="mt-2 flex min-h-8 items-center gap-2">
          {slot ? (
            <>
              <span className="text-meta text-ink-3">Posição</span>
              <input
                value={slot.label}
                onChange={(e) => onChange(lineup.map((s) => (s.id === slot.id ? { ...s, label: e.target.value.slice(0, 4).toUpperCase() } : s)))}
                className="h-7 w-20 rounded-[var(--radius-control)] border border-line bg-surface px-2 text-meta text-ink focus:border-line-strong focus:outline-none"
              />
            </>
          ) : (
            <span className="text-meta text-ink-4">Arrasta cada posição para onde o modelo manda. Toca numa para lhe mudar o rótulo.</span>
          )}
        </div>
      )}
    </div>
  );
}

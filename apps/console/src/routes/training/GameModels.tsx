import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { PageHeader } from "@/components/Shell";
import { Dialog, DialogField, dialogInputClass } from "@/components/Dialog";
import { Pitch, THUMB_RATIO, baseView, itemScale, pitchBackground } from "@/components/FieldEditor";
import { Empty, Loading, Panel, PanelHead, Pill, SelectField, cx } from "@/components/primitives";
import { Check, ChevronDown, ChevronRight, Plus, Shield, Trash2, TriangleAlert } from "@/lib/icons";
import { listTeams } from "@/lib/api";
import { can } from "@/lib/permissions";
import {
  FORMAT_LABEL,
  GAME_FORMATS,
  PRINCIPLE_SECTIONS,
  asLineupData,
  createGameModel,
  deleteGameModel,
  listGameModels,
  systemLineup,
  systemsFor,
  teamFormat,
  updateGameModel,
  type FieldKind,
  type GameModelRow,
  type LineupData,
  type LineupPitch,
  type LineupSlot,
  type Principles,
} from "@/lib/training";
import { useSession } from "@/session";

/**
 * Modelos de jogo.
 *
 * ## O sistema é um desenho, não um enum
 *
 * "4-3-3" é o ponto de partida: aplica posições ao quadro e a partir daí cada
 * bolinha arrasta-se para onde o modelo manda — o que se grava são coordenadas.
 * Um treinador que jogue com o lateral por dentro desenha exatamente isso.
 *
 * As secções escritas (organização ofensiva/defensiva, transições, bolas
 * paradas) são a outra metade: o desenho diz *onde*, o texto diz *como*.
 */
export default function GameModels() {
  const { session } = useSession();
  const navigate = useNavigate();
  const mayWrite = can(session, "training:write");

  const [rows, setRows] = useState<GameModelRow[] | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    listGameModels().then(setRows).catch(() => setRows([]));
  }, []);

  if (rows === null) return <Loading />;

  return (
    <>
      <PageHeader title="Modelos de jogo" subtitle="Como a equipa joga — o sistema desenhado e os princípios escritos, guardados no clube.">
        {mayWrite && (
          <button type="button" className="ctl-primary" onClick={() => setCreating(true)}>
            <Plus className="size-3.5" strokeWidth={1.75} />
            Novo modelo
          </button>
        )}
      </PageHeader>

      {rows.length === 0 ? (
        <Panel>
          <Empty
            title="Ainda não há modelos de jogo"
            detail="Um modelo guarda o sistema, os posicionamentos e os princípios de uma equipa — e fica no clube, época após época."
            icon={Shield}
          >
            {mayWrite && (
              <button type="button" className="ctl-primary" onClick={() => setCreating(true)}>
                Criar o primeiro
              </button>
            )}
          </Empty>
        </Panel>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((m) => (
            <div
              key={m.id}
              role="link"
              tabIndex={0}
              onClick={() => navigate(`/modelos-jogo/${m.id}`)}
              onKeyDown={(e) => e.key === "Enter" && navigate(`/modelos-jogo/${m.id}`)}
              className="panel cursor-pointer overflow-hidden transition-colors hover:border-line-strong"
            >
              <LineupThumb data={asLineupData(m.lineup)} />
              <div className="space-y-1 p-3.5">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="min-w-0 truncate text-body font-semibold text-ink">{m.name}</h3>
                  {m.system && <Pill tone="signal">{m.system}</Pill>}
                </div>
                <div className="text-meta text-ink-3">
                  {m.teamName ?? "Todo o clube"}
                  {m.visibility === "PRIVATE" ? " · só meu" : ""}
                  {m.authorName ? ` · ${m.authorName}` : ""}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {creating && (
        <NewModelDialog
          onClose={() => setCreating(false)}
          onCreated={(id) => navigate(`/modelos-jogo/${id}`)}
        />
      )}
    </>
  );
}

function NewModelDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const { session } = useSession();
  const teams = listTeams(session);
  const [name, setName] = useState("");
  const [teamId, setTeamId] = useState(teams[0]?.id ?? "");
  const [pitch, setPitch] = useState<LineupPitch>(() => teamFormat(teams[0]?.id));
  const [system, setSystem] = useState(() => systemsFor(teamFormat(teams[0]?.id))[0].label);
  const [busy, setBusy] = useState(false);

  // Mudar de equipa muda a modalidade por omissão — um Sub-13 de futsal não
  // começa num 4-3-3 de campo de onze. Continua a poder trocar-se à mão.
  const chooseTeam = (id: string) => {
    setTeamId(id);
    const p = teamFormat(id);
    if (p !== pitch) choosePitch(p);
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
        teamId: teamId || null,
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
      title="Novo modelo de jogo"
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
          <input autoFocus className={dialogInputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Sub-17 — 4-3-3 pressão alta" />
        </DialogField>
        <DialogField label="Variante" hint="a equipa sugere, tu decides">
          <select className={dialogInputClass} value={pitch} onChange={(e) => choosePitch(e.target.value as LineupPitch)}>
            {GAME_FORMATS.map((f) => (
              <option key={f} value={f}>
                {FORMAT_LABEL[f]}
              </option>
            ))}
          </select>
        </DialogField>
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
  const navigate = useNavigate();
  const { session } = useSession();
  const mayWrite = can(session, "training:write");
  const teams = listTeams(session);

  const [model, setModel] = useState<GameModelRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [openSection, setOpenSection] = useState<string | null>("offensive");

  useEffect(() => {
    listGameModels()
      .then((rows) => {
        const m = rows.find((r) => r.id === id);
        if (!m) setError("Este modelo não existe ou não é visível para ti.");
        else setModel(m);
      })
      .catch((e: Error) => setError(e.message));
  }, [id]);

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
        system: model.system,
        teamId: model.teamId,
        visibility: model.visibility,
        lineup: model.lineup,
        principles: model.principles,
        notes: model.notes,
      });
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
    if (!confirm("Apagar este modelo de jogo?")) return;
    await deleteGameModel(model.id);
    navigate("/modelos-jogo");
  }

  if (error) {
    return (
      <Panel>
        <Empty title="Modelo não encontrado" detail={error} icon={TriangleAlert}>
          <Link to="/modelos-jogo" className="ctl-outline">
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

  /** Trocar de modalidade recomeça do primeiro sistema dela — terrenos e
   *  sistemas diferentes, posições que não se traduzem uma a uma. */
  const setPitch = (p: LineupPitch) => {
    if (p === pitch) return;
    const first = systemsFor(p)[0].label;
    patch({ system: first, lineup: { pitch: p, slots: systemLineup(first, p) } });
  };

  return (
    <>
      <PageHeader eyebrow="Modelo de jogo" title={model.name} subtitle={model.teamName ?? "Todo o clube"}>
        <Link to="/modelos-jogo" className="ctl-ghost">
          Modelos
        </Link>
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
        <Panel className="xl:col-span-2 self-start">
          <PanelHead title="Sistema e posicionamento" hint={editable ? "arrasta as posições" : undefined}>
            {editable && (
              <>
                <SelectField
                  aria-label="Variante"
                  size="sm"
                  value={pitch}
                  onChange={(p) => setPitch(p as LineupPitch)}
                  options={GAME_FORMATS.map((f) => ({ value: f, label: FORMAT_LABEL[f] }))}
                />
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

        <div className="space-y-3">
          <Panel>
            <PanelHead title="Ficha" />
            <div className="space-y-3.5 p-5">
              <DialogField label="Nome">
                <input className={dialogInputClass} value={model.name} onChange={(e) => patch({ name: e.target.value })} disabled={!editable} />
              </DialogField>
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
              {PRINCIPLE_SECTIONS.map((section) => {
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

/* -------------------------------------------------------------------------- */
/* O quadro do sistema                                                         */
/* -------------------------------------------------------------------------- */

/** O terreno de um lineup: a variante é, ela própria, o campo inteiro dela. */
const fieldOf = (pitch: LineupPitch): FieldKind => pitch;

function LineupThumb({ data }: { data: LineupData }) {
  const field = fieldOf(data.pitch);
  const v = baseView(field);
  const k = itemScale(field);
  return (
    // Moldura fixa e fundo do piso, como nas outras grelhas: um modelo de futsal
    // (1,8) e um de futebol (1,5) lado a lado deixavam a caixa mais baixa com
    // branco por baixo do texto. Ver `THUMB_RATIO`.
    <svg
      viewBox={`${v.x} ${v.y} ${v.w} ${v.h}`}
      className="block w-full"
      style={{ background: pitchBackground(field), aspectRatio: String(THUMB_RATIO) }}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden
    >
      <Pitch field={field} />
      {data.slots.map((s) => (
        <g key={s.id} transform={`translate(${s.x} ${s.y}) scale(${k})`}>
          <circle r={2.2} fill="#1d3a5f" stroke="rgba(255,255,255,0.85)" strokeWidth={0.25} />
          <text y={0.8} textAnchor="middle" fontSize={1.9} fontWeight={700} fill="#fff">
            {s.label}
          </text>
        </g>
      ))}
    </svg>
  );
}

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
  const field = fieldOf(data.pitch);
  const lineup = data.slots;
  const k = itemScale(field);
  const max = data.pitch === "futsal" ? { x: 40, y: 20 } : { x: 105, y: 68 };
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

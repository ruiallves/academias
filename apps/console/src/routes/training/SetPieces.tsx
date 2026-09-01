import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { PageHeader } from "@/components/Shell";
import { Dialog, DialogField, dialogInputClass } from "@/components/Dialog";
import { DiagramPlayer, FieldEditor, FieldView, THUMB_RATIO } from "@/components/FieldEditor";
import { Empty, Loading, Panel, PanelHead, Pill, cx } from "@/components/primitives";
import { Check, Download, Plus, Sparkle, Trash2, TriangleAlert } from "@/lib/icons";
import { listTeams } from "@/lib/api";
import { can } from "@/lib/permissions";
import {
  FORMAT_LABEL,
  FORMAT_PITCH,
  GAME_FORMATS,
  SET_PIECE_KINDS,
  asDiagram,
  fieldFor,
  createSetPiece,
  deleteSetPiece,
  emptyDiagram,
  listSetPieces,
  newId,
  setPieceLabel,
  teamFormat,
  updateSetPiece,
  type Diagram,
  type DiagramItem,
  type GameFormat,
  type SetPieceRow,
} from "@/lib/training";
import { useSession } from "@/session";

/**
 * Bolas paradas.
 *
 * Metade dos golos da formação nasce aqui, e é a área onde um desenho vale mais
 * do que qualquer texto: quem ataca o primeiro poste, quem bloqueia, quem fica à
 * entrada da área. Os esquemas organizam-se pelo lance (canto ofensivo, livre
 * defensivo, lançamento) e cada um é um desenho em meio campo, com frames — o
 * bloqueio no frame 1, o movimento no 2, a finalização no 3.
 */
export default function SetPieces() {
  const { session } = useSession();
  const navigate = useNavigate();
  const mayWrite = can(session, "training:write");

  const [rows, setRows] = useState<SetPieceRow[] | null>(null);
  const [kind, setKind] = useState<string>("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    listSetPieces().then(setRows).catch(() => setRows([]));
  }, []);

  const filtered = useMemo(() => (rows ?? []).filter((r) => !kind || r.kind === kind), [rows, kind]);

  if (rows === null) return <Loading />;

  return (
    <>
      <PageHeader title="Bolas paradas" subtitle="Cantos, livres e lançamentos — desenhados, animados e prontos a rever na véspera do jogo.">
        {mayWrite && (
          <button type="button" className="ctl-primary" onClick={() => setCreating(true)}>
            <Plus className="size-3.5" strokeWidth={1.75} />
            Novo esquema
          </button>
        )}
      </PageHeader>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setKind("")}
            className={cx("h-8 rounded-full px-3 text-meta font-medium transition-colors", !kind ? "bg-ink text-surface" : "bg-sunken text-ink-2 hover:text-ink")}
          >
            Todos
          </button>
          {SET_PIECE_KINDS.map((k) => {
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

        {filtered.length === 0 ? (
          <Panel>
            <Empty
              title={rows.length === 0 ? "Ainda não há esquemas" : "Nada neste lance"}
              detail="Um canto ensaiado à quarta-feira ganha jogos ao sábado. Desenha o primeiro — jogadores, bloqueios, ataques ao poste."
              icon={Sparkle}
            >
              {mayWrite && rows.length === 0 && (
                <button type="button" className="ctl-primary" onClick={() => setCreating(true)}>
                  Desenhar o primeiro
                </button>
              )}
            </Empty>
          </Panel>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {filtered.map((p) => (
              <div
                key={p.id}
                role="link"
                tabIndex={0}
                onClick={() => navigate(`/bolas-paradas/${p.id}`)}
                onKeyDown={(e) => e.key === "Enter" && navigate(`/bolas-paradas/${p.id}`)}
                className="panel cursor-pointer overflow-hidden transition-colors hover:border-line-strong"
              >
                {asDiagram(p.diagram) ? (
                  <FieldView diagram={p.diagram} className="block w-full" ratio={THUMB_RATIO} />
                ) : (
                  <div className="flex aspect-[4/3] w-full items-center justify-center bg-[#527a5e] text-[11px] text-white/70">Sem desenho</div>
                )}
                <div className="space-y-1 p-3.5">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="min-w-0 truncate text-body font-semibold text-ink">{p.name}</h3>
                    <Pill tone="signal">{setPieceLabel(p.kind)}</Pill>
                  </div>
                  <div className="text-meta text-ink-3">
                    {p.teamName ?? "Todo o clube"}
                    {p.visibility === "PRIVATE" ? " · só meu" : ""}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {creating && <NewSetPieceDialog onClose={() => setCreating(false)} onCreated={(id) => navigate(`/bolas-paradas/${id}`)} />}
    </>
  );
}

/**
 * Um lance montado, à medida da variante.
 *
 * Um canto ofensivo não começa num campo vazio: nasce com a bola no canto, o
 * batedor, a estrutura habitual na área e a defesa a marcar — apaga-se o que
 * sobra, arrasta-se o resto. É a diferença entre desenhar e preencher.
 *
 * ## Porque é que as posições são frações
 *
 * Eram duas cópias em metros — uma do campo de onze, outra do futsal — e com
 * cinco variantes seriam cinco, a divergir umas das outras à primeira correção.
 * Aqui o lance descreve-se **uma vez** em frações do campo (0–1) e escala-se
 * para o terreno de cada uma; o que muda com a variante é o que tem mesmo de
 * mudar: **quanta gente entra**, porque um canto de futebol 5 não tem seis
 * atacantes na área.
 */
function starterDiagram(kind: string, format: GameFormat = "f11"): Diagram {
  const s = FORMAT_PITCH[format];
  const d = emptyDiagram(fieldFor(format, true));
  /** Uma posição em frações do campo → metros do terreno desta variante. */
  const at = (k: DiagramItem["kind"], fx: number, fy: number, label?: string): DiagramItem => ({
    id: newId(),
    kind: k,
    x: fx * s.w,
    y: fy * s.h,
    ...(label ? { label } : {}),
  });

  /** Quantos jogadores de campo tem esta variante (sem o guarda-redes). */
  const outfield = { f11: 10, f9: 8, f7: 6, f5: 4, futsal: 4 }[format];

  if (kind === "corner-off" || kind === "corner-def") {
    // Do mais importante para o menos: o batedor, quem ataca os postes, quem
    // sobra atrás. Corta-se pelo fim conforme a variante.
    const ours = [
      at("player", 0.981, 0.037, "7"),
      at("player", 0.914, 0.412, "9"),
      at("player", 0.895, 0.5, "10"),
      at("player", 0.914, 0.588, "11"),
      at("player", 0.848, 0.5, "8"),
      at("player", 0.781, 0.353, "6"),
    ].slice(0, Math.min(6, outfield));
    const theirs = [
      at("opponent", 0.933, 0.441, "4"),
      at("opponent", 0.933, 0.559, "5"),
      at("opponent", 0.886, 0.441, "2"),
    ].slice(0, outfield <= 4 ? 2 : 3);
    d.frames[0].items = [at("ball", 0.995, 0.01), ...ours, ...theirs, at("gk", 0.981, 0.5, "GR")];
  } else if (kind === "free-off" || kind === "free-def") {
    const barreira = [
      at("opponent", 0.838, 0.397, "2"),
      at("opponent", 0.838, 0.441, "4"),
      at("opponent", 0.838, 0.485, "5"),
    ].slice(0, outfield <= 4 ? 2 : 3);
    const ours = [
      at("player", 0.743, 0.324, "10"),
      at("player", 0.876, 0.588, "9"),
      at("player", 0.857, 0.662, "11"),
    ].slice(0, Math.min(3, outfield));
    d.frames[0].items = [at("ball", 0.762, 0.353), ...ours, ...barreira, at("gk", 0.985, 0.529, "GR")];
  } else if (kind === "throw-in") {
    d.frames[0].items = [
      at("ball", 0.81, 0.007),
      at("player", 0.81, 0.022, "2"),
      at("player", 0.857, 0.176, "7"),
      at("player", 0.762, 0.176, "8"),
      at("opponent", 0.838, 0.147, "3"),
    ];
  } else if (kind === "penalty") {
    // A marca é a real da variante, não uma fração: aos 11 m no campo de onze,
    // aos 6 no futsal.
    const px = (s.w - s.penalty) / s.w;
    d.frames[0].items = [at("ball", px, 0.5), at("player", px - 0.03, 0.5, "9"), at("gk", 0.99, 0.5, "GR")];
  }
  return d;
}

function NewSetPieceDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const { session } = useSession();
  const teams = listTeams(session);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<string>("corner-off");
  const [teamId, setTeamId] = useState(teams[0]?.id ?? "");
  const [pitch, setPitch] = useState<GameFormat>(() => teamFormat(teams[0]?.id));
  const [busy, setBusy] = useState(false);

  // A equipa traz a modalidade por omissão — um canto de futsal não nasce num
  // campo de onze. Continua a poder trocar-se à mão.
  const chooseTeam = (id: string) => {
    setTeamId(id);
    setPitch(teamFormat(id));
  };

  async function create() {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      const { id } = await createSetPiece({
        kind,
        name: name.trim(),
        teamId: teamId || null,
        visibility: "CLUB",
        diagram: starterDiagram(kind, pitch),
      });
      onCreated(id);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Não foi possível criar.");
      setBusy(false);
    }
  }

  return (
    <Dialog
      title="Novo esquema"
      subtitle="Nasce com o lance já montado — depois é arrastar e desenhar os movimentos."
      onClose={onClose}
      footer={
        <>
          <button type="button" className="ctl-outline" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="ctl-primary" onClick={create} disabled={!name.trim() || busy}>
            Criar e desenhar
          </button>
        </>
      }
    >
      <div className="space-y-3.5 p-5">
        <DialogField label="Lance">
          <select className={dialogInputClass} value={kind} onChange={(e) => setKind(e.target.value)}>
            {SET_PIECE_KINDS.map((k) => (
              <option key={k.key} value={k.key}>
                {k.label}
              </option>
            ))}
          </select>
        </DialogField>
        <DialogField label="Nome">
          <input autoFocus className={dialogInputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder='Ex.: "Canto curto — 2º poste"' />
        </DialogField>
        <DialogField label="Variante" hint="a equipa sugere, tu decides">
          <select className={dialogInputClass} value={pitch} onChange={(e) => setPitch(e.target.value as GameFormat)}>
            {GAME_FORMATS.map((f) => (
              <option key={f} value={f}>
                {FORMAT_LABEL[f]}
              </option>
            ))}
          </select>
        </DialogField>
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
      </div>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* Ficha do esquema                                                            */
/* -------------------------------------------------------------------------- */

export function SetPieceDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { session } = useSession();
  const mayWrite = can(session, "training:write");
  const teams = listTeams(session);

  const [piece, setPiece] = useState<SetPieceRow | null>(null);
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
    if (!piece) return;
    setAExportar(true);
    try {
      const pdf = await import("@/lib/training-pdf");
      await pdf.exportarBolaParada(piece!);
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
  const [mode, setMode] = useState<"edit" | "play">("edit");

  useEffect(() => {
    listSetPieces()
      .then((rows) => {
        const p = rows.find((r) => r.id === id);
        if (!p) setError("Este esquema não existe ou não é visível para ti.");
        else {
          setPiece(p);
          setMode(p.editable && mayWrite ? "edit" : "play");
        }
      })
      .catch((e: Error) => setError(e.message));
  }, [id, mayWrite]);

  const editable = Boolean(piece?.editable) && mayWrite;

  const patch = (p: Partial<SetPieceRow>) => {
    setPiece((cur) => (cur ? { ...cur, ...p } : cur));
    setDirty(true);
    setSaved(false);
  };

  async function save() {
    if (!piece || saving) return;
    setSaving(true);
    try {
      await updateSetPiece(piece.id, {
        kind: piece.kind,
        name: piece.name,
        description: piece.description,
        teamId: piece.teamId,
        visibility: piece.visibility,
        diagram: piece.diagram,
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
    if (!piece) return;
    if (!confirm("Apagar este esquema?")) return;
    await deleteSetPiece(piece.id);
    navigate("/bolas-paradas");
  }

  if (error) {
    return (
      <Panel>
        <Empty title="Esquema não encontrado" detail={error} icon={TriangleAlert}>
          <Link to="/bolas-paradas" className="ctl-outline">
            Voltar
          </Link>
        </Empty>
      </Panel>
    );
  }
  if (!piece) return <Loading />;

  return (
    <>
      <PageHeader eyebrow={setPieceLabel(piece.kind)} title={piece.name} subtitle={piece.teamName ?? "Todo o clube"}>
        <Link to="/bolas-paradas" className="ctl-ghost">
          Bolas paradas
        </Link>
        <button type="button" className="ctl-outline" onClick={() => void exportarPdf()} disabled={aExportar}>
          <Download className="size-3.5" strokeWidth={1.75} />
          {aExportar ? "A gerar…" : "PDF"}
        </button>
        {editable && piece.deletable && (
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
          <PanelHead title="Desenho">
            {editable && (
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
              <FieldEditor key={id} initial={piece.diagram ?? starterDiagram(piece.kind)} onChange={(d) => patch({ diagram: d })} />
            ) : (
              <DiagramPlayer diagram={piece.diagram} />
            )}
          </div>
        </Panel>

        <Panel className="self-start">
          <PanelHead title="Ficha" />
          <div className="space-y-3.5 p-5">
            <DialogField label="Nome">
              <input className={dialogInputClass} value={piece.name} onChange={(e) => patch({ name: e.target.value })} disabled={!editable} />
            </DialogField>
            <DialogField label="Lance">
              <select className={dialogInputClass} value={piece.kind} onChange={(e) => patch({ kind: e.target.value })} disabled={!editable}>
                {SET_PIECE_KINDS.map((k) => (
                  <option key={k.key} value={k.key}>
                    {k.label}
                  </option>
                ))}
              </select>
            </DialogField>
            <DialogField label="Equipa">
              <select className={dialogInputClass} value={piece.teamId ?? ""} onChange={(e) => patch({ teamId: e.target.value || null })} disabled={!editable}>
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
                        piece.visibility === v ? "border-line-strong bg-sunken/60 text-ink" : "border-line text-ink-2 hover:border-line-strong",
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </DialogField>
            )}
            <DialogField label="Descrição">
              <textarea
                rows={5}
                className={cx(dialogInputClass, "h-auto py-2")}
                value={piece.description ?? ""}
                onChange={(e) => patch({ description: e.target.value || null })}
                placeholder="Quem bate, sinais, variantes, quem fica na cobertura defensiva…"
                disabled={!editable}
              />
            </DialogField>
          </div>
        </Panel>
      </div>
    </>
  );
}

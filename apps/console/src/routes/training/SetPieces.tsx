import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { PageHeader } from "@/components/Shell";
import { Dialog, DialogField, dialogInputClass } from "@/components/Dialog";
import { DiagramPlayer, FieldEditor, FieldView, THUMB_RATIO } from "@/components/FieldEditor";
import { RelatedExercisesPanel } from "@/components/training/RelatedExercises";
import { Empty, Loading, Panel, PanelHead, Pill, cx } from "@/components/primitives";
import { Check, Download, Plus, Sparkle, Trash2, TriangleAlert } from "@/lib/icons";
import { listTeams } from "@/lib/api";
import { can } from "@/lib/permissions";
import { allKinds, kindLabel, type KindGroup } from "@/lib/sports";
import {
  FORMAT_LABEL,
  asDiagram,
  createSetPiece,
  deleteSetPiece,
  listGameModels,
  listSetPieces,
  teamFormat,
  updateSetPiece,
  type GameFormat,
  type GameModelRow,
  type SetPieceRow,
} from "@/lib/training";
import { useSession } from "@/session";
import { useSportArea } from "./sport-area-context";

/** O valor do seletor que quer dizer "um tipo que eu escrevo". */
const CUSTOM = "__outra__";

/**
 * Bolas paradas — ou situações especiais, conforme a modalidade.
 *
 * No futebol, metade dos golos da formação nasce aqui, e é a área onde um
 * desenho vale mais do que qualquer texto: quem ataca o primeiro poste, quem
 * bloqueia, quem fica à entrada da área. No basquetebol são as reposições, os
 * finais de jogo e as jogadas após desconto de tempo — o que o treinador
 * prepara e quer memorizado.
 *
 * ## O que vem da modalidade
 *
 * Os tipos e os seus grupos (`profile.situations.groups`), o lance montado com
 * que uma situação nova nasce (`starter`), o terreno do editor e os nomes. Os
 * tipos são vocabulário, não uma lista fechada: quem precisa de um que não
 * existe escreve-o, e ele passa a filtrar como os outros.
 */
export default function SetPieces() {
  const { sport, profile, path } = useSportArea();
  const { session } = useSession();
  const navigate = useNavigate();
  const mayWrite = can(session, "training:write");
  const groups = profile.situations.groups;
  const flat = groups.length === 1 && groups[0].label === null;

  const [rows, setRows] = useState<SetPieceRow[] | null>(null);
  const [kind, setKind] = useState<string>("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    setRows(null);
    listSetPieces(sport.id).then(setRows).catch(() => setRows([]));
  }, [sport.id]);

  const filtered = useMemo(() => (rows ?? []).filter((r) => !kind || r.kind === kind), [rows, kind]);

  /** Os tipos escritos à mão que existem nas linhas — filtram-se como os outros. */
  const customKinds = useMemo(() => {
    const known = new Set(allKinds(groups).map((k) => k.key));
    return [...new Set((rows ?? []).map((r) => r.kind))].filter((k) => !known.has(k));
  }, [rows, groups]);

  if (rows === null) return <Loading />;

  const chip = (key: string, label: string, count: number) => (
    <button
      key={key}
      type="button"
      onClick={() => setKind(kind === key ? "" : key)}
      className={cx(
        "h-8 rounded-full px-3 text-meta font-medium transition-colors",
        kind === key ? "bg-ink text-surface" : "bg-sunken text-ink-2 hover:text-ink",
      )}
    >
      {label}
      {count > 0 && <span className="ml-1.5 text-[10px] opacity-70 tabular">{count}</span>}
    </button>
  );
  const countOf = (key: string) => rows.filter((r) => r.kind === key).length;
  const allChip = (
    <button
      type="button"
      onClick={() => setKind("")}
      className={cx("h-8 rounded-full px-3 text-meta font-medium transition-colors", !kind ? "bg-ink text-surface" : "bg-sunken text-ink-2 hover:text-ink")}
    >
      Todos
    </button>
  );

  return (
    <>
      <PageHeader title={profile.situations.label} subtitle={profile.situations.description}>
        {mayWrite && (
          <button type="button" className="ctl-primary" onClick={() => setCreating(true)}>
            <Plus className="size-3.5" strokeWidth={1.75} />
            {profile.situations.singular === "situação" ? "Nova situação" : "Novo esquema"}
          </button>
        )}
      </PageHeader>

      <div className="space-y-3">
        {flat ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {allChip}
            {groups[0].kinds.map((k) => chip(k.key, k.label, countOf(k.key)))}
            {customKinds.map((k) => chip(k, k, countOf(k)))}
          </div>
        ) : (
          /*
           * Com grupos, uma linha por grupo — "Reposições", "Final de jogo" —
           * porque quinze pílulas em fila não se lêem, e o treinador de
           * basquetebol pensa nas situações por estes quatro capítulos.
           */
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="w-32 shrink-0 text-meta text-ink-4" />
              {allChip}
              {customKinds.map((k) => chip(k, k, countOf(k)))}
            </div>
            {groups.map((g) => (
              <div key={g.label} className="flex flex-wrap items-center gap-1.5">
                <span className="w-32 shrink-0 truncate text-meta text-ink-4">{g.label}</span>
                {g.kinds.map((k) => chip(k.key, k.label, countOf(k.key)))}
              </div>
            ))}
          </div>
        )}

        {filtered.length === 0 ? (
          <Panel>
            <Empty
              title={rows.length === 0 ? `Ainda não há ${profile.situations.label.toLowerCase()}` : "Nada deste tipo"}
              detail={
                profile.code === "basketball"
                  ? "Uma reposição de fundo ensaiada à quarta-feira ganha o jogo ao sábado. Desenha a primeira — quem repõe, quem bloqueia, quem sai para o lançamento."
                  : "Um canto ensaiado à quarta-feira ganha jogos ao sábado. Desenha o primeiro — jogadores, bloqueios, ataques ao poste."
              }
              icon={Sparkle}
            >
              {mayWrite && rows.length === 0 && (
                <button type="button" className="ctl-primary" onClick={() => setCreating(true)}>
                  Desenhar a primeira
                </button>
              )}
            </Empty>
          </Panel>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {filtered.map((p) => {
              const to = path("situations", p.id);
              return (
                <div
                  key={p.id}
                  role="link"
                  tabIndex={0}
                  onClick={() => navigate(to)}
                  onKeyDown={(e) => e.key === "Enter" && navigate(to)}
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
                      <Pill tone="signal">{kindLabel(groups, p.kind)}</Pill>
                    </div>
                    <div className="text-meta text-ink-3">
                      {p.teamName ?? "Todo o clube"}
                      {p.gameModelName ? ` · ${p.gameModelName}` : ""}
                      {p.visibility === "PRIVATE" ? " · só meu" : ""}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {creating && <NewSetPieceDialog onClose={() => setCreating(false)} onCreated={(id) => navigate(path("situations", id))} />}
    </>
  );
}

/**
 * O seletor de tipo — com os grupos como `optgroup` quando existem, e a opção
 * de escrever um tipo próprio. Um tipo gravado que não esteja no vocabulário
 * (escrito à mão, ou de um perfil anterior) aparece como opção sua.
 */
function KindSelect({
  groups,
  value,
  onChange,
  disabled,
}: {
  groups: KindGroup[];
  value: string;
  onChange: (kind: string) => void;
  disabled?: boolean;
}) {
  const known = allKinds(groups).some((k) => k.key === value);
  const [custom, setCustom] = useState(!known && value !== "");
  const [text, setText] = useState(known ? "" : value);
  const flat = groups.length === 1 && groups[0].label === null;

  const options = (kinds: KindGroup["kinds"]) =>
    kinds.map((k) => (
      <option key={k.key} value={k.key}>
        {k.label}
      </option>
    ));

  return (
    <div className="space-y-2">
      <select
        className={dialogInputClass}
        value={custom ? CUSTOM : value}
        disabled={disabled}
        onChange={(e) => {
          if (e.target.value === CUSTOM) {
            setCustom(true);
            if (text.trim()) onChange(text.trim());
            return;
          }
          setCustom(false);
          onChange(e.target.value);
        }}
      >
        {flat
          ? options(groups[0].kinds)
          : groups.map((g) => (
              <optgroup key={g.label ?? ""} label={g.label ?? ""}>
                {options(g.kinds)}
              </optgroup>
            ))}
        <option value={CUSTOM}>Outra…</option>
      </select>
      {custom && (
        <input
          className={dialogInputClass}
          value={text}
          disabled={disabled}
          autoFocus
          placeholder="O nome do tipo — ex.: Saída de pressão"
          onChange={(e) => {
            setText(e.target.value);
            if (e.target.value.trim()) onChange(e.target.value.trim().slice(0, 40));
          }}
        />
      )}
    </div>
  );
}

function NewSetPieceDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const { sport, profile } = useSportArea();
  const { session } = useSession();
  const teams = listTeams(session).filter((t) => t.sportId === sport.id);
  const formats = profile.vocabulary.formats;
  const groups = profile.situations.groups;

  const suggested = teamFormat(teams[0]?.id);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<string>(allKinds(groups)[0]?.key ?? "");
  const [teamId, setTeamId] = useState(teams[0]?.id ?? "");
  const [pitch, setPitch] = useState<GameFormat>(() => (formats.includes(suggested) ? suggested : profile.defaultFormat));
  const [busy, setBusy] = useState(false);

  // A equipa traz a variante por omissão — um canto de futsal não nasce num
  // campo de onze. Continua a poder trocar-se à mão.
  const chooseTeam = (id: string) => {
    setTeamId(id);
    const p = teamFormat(id);
    if (formats.includes(p)) setPitch(p);
  };

  async function create() {
    if (!name.trim() || !kind.trim() || busy) return;
    setBusy(true);
    try {
      const { id } = await createSetPiece({
        kind,
        name: name.trim(),
        teamId: teamId || null,
        sportId: sport.id,
        visibility: "CLUB",
        diagram: profile.situations.starter(kind, pitch),
      });
      onCreated(id);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Não foi possível criar.");
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={profile.situations.singular === "situação" ? "Nova situação" : "Novo esquema"}
      subtitle="Nasce com o lance já montado — depois é arrastar e desenhar os movimentos."
      onClose={onClose}
      footer={
        <>
          <button type="button" className="ctl-outline" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="ctl-primary" onClick={create} disabled={!name.trim() || !kind.trim() || busy}>
            Criar e desenhar
          </button>
        </>
      }
    >
      <div className="space-y-3.5 p-5">
        <DialogField label={profile.situations.singular === "situação" ? "Situação" : "Lance"}>
          <KindSelect groups={groups} value={kind} onChange={setKind} />
        </DialogField>
        <DialogField label="Nome">
          <input autoFocus className={dialogInputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder={profile.situations.newPlaceholder} />
        </DialogField>
        {formats.length > 1 && (
          <DialogField label="Variante" hint="a equipa sugere, tu decides">
            <select className={dialogInputClass} value={pitch} onChange={(e) => setPitch(e.target.value as GameFormat)}>
              {formats.map((f) => (
                <option key={f} value={f}>
                  {FORMAT_LABEL[f]}
                </option>
              ))}
            </select>
          </DialogField>
        )}
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
/* Ficha                                                                       */
/* -------------------------------------------------------------------------- */

export function SetPieceDetail() {
  const { id = "" } = useParams();
  const { sport, profile, path } = useSportArea();
  const navigate = useNavigate();
  const { session } = useSession();
  const mayWrite = can(session, "training:write");
  const teams = listTeams(session).filter((t) => t.sportId === sport.id);
  const groups = profile.situations.groups;

  const [piece, setPiece] = useState<SetPieceRow | null>(null);
  /** Os sistemas de jogo desta modalidade — para ligar a situação a um. */
  const [models, setModels] = useState<GameModelRow[]>([]);
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
    listSetPieces(sport.id)
      .then((rows) => {
        const p = rows.find((r) => r.id === id);
        if (!p) setError("Isto não existe ou não é visível para ti.");
        else {
          setPiece(p);
          setMode(p.editable && mayWrite ? "edit" : "play");
        }
      })
      .catch((e: Error) => setError(e.message));
    listGameModels(sport.id).then(setModels).catch(() => setModels([]));
  }, [id, mayWrite, sport.id]);

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
        gameModelId: piece.gameModelId,
        visibility: piece.visibility,
        diagram: piece.diagram,
        exerciseIds: piece.exercises.map((e) => e.id),
      } as Partial<SetPieceRow> & { exerciseIds: string[] });
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
    if (!confirm(`Apagar est${profile.situations.singular === "situação" ? "a situação" : "e esquema"}?`)) return;
    await deleteSetPiece(piece.id);
    navigate(path("situations"));
  }

  if (error) {
    return (
      <Panel>
        <Empty title="Não encontrado" detail={error} icon={TriangleAlert}>
          <Link to={path("situations")} className="ctl-outline">
            Voltar
          </Link>
        </Empty>
      </Panel>
    );
  }
  if (!piece) return <Loading />;

  const playbookOne = profile.playbook.count(1).replace(/^1 /, "");

  return (
    <>
      <PageHeader eyebrow={kindLabel(groups, piece.kind)} title={piece.name} subtitle={piece.teamName ?? "Todo o clube"}>
        <Link to={path("situations")} className="ctl-ghost">
          {profile.situations.label}
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
        <div className="space-y-3 xl:col-span-2">
          <Panel className="self-start">
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
                <FieldEditor
                  key={id}
                  initial={piece.diagram ?? profile.situations.starter(piece.kind, profile.defaultFormat)}
                  onChange={(d) => patch({ diagram: d })}
                  vocabulary={profile.vocabulary}
                />
              ) : (
                <DiagramPlayer diagram={piece.diagram} />
              )}
            </div>
          </Panel>

          <Panel>
            <RelatedExercisesPanel
              sportId={sport.id}
              exercises={piece.exercises}
              editable={editable}
              onChange={(next) => patch({ exercises: next })}
              hint={`com que se ensaia ${profile.situations.singular === "situação" ? "esta situação" : "este esquema"}`}
            />
          </Panel>
        </div>

        <Panel className="self-start">
          <PanelHead title="Ficha" />
          <div className="space-y-3.5 p-5">
            <DialogField label="Nome">
              <input className={dialogInputClass} value={piece.name} onChange={(e) => patch({ name: e.target.value })} disabled={!editable} />
            </DialogField>
            <DialogField label={profile.situations.singular === "situação" ? "Situação" : "Lance"}>
              <KindSelect groups={groups} value={piece.kind} onChange={(k) => patch({ kind: k })} disabled={!editable} />
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
            {/*
              O sistema de que a situação parte — "a reposição de fundo que
              acaba no 5-out". Uma só: a situação é a execução de um sistema
              num momento concreto. Só aparece quando há sistemas para ligar.
            */}
            {(models.length > 0 || piece.gameModelId) && (
              <DialogField label={playbookOne[0].toUpperCase() + playbookOne.slice(1)} hint="de que parte">
                <select
                  className={dialogInputClass}
                  value={piece.gameModelId ?? ""}
                  disabled={!editable}
                  onChange={(e) => {
                    const gm = models.find((m) => m.id === e.target.value);
                    patch({ gameModelId: gm?.id ?? null, gameModelName: gm?.name ?? null });
                  }}
                >
                  <option value="">Nenhum</option>
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                  {piece.gameModelId && !models.some((m) => m.id === piece.gameModelId) && (
                    <option value={piece.gameModelId}>{piece.gameModelName ?? "Sistema"}</option>
                  )}
                </select>
                {piece.gameModelId && (
                  <Link to={path("playbook", piece.gameModelId)} className="mt-1 inline-block text-meta text-signal-ink hover:underline">
                    Abrir {playbookOne}
                  </Link>
                )}
              </DialogField>
            )}
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
                placeholder={
                  profile.code === "basketball"
                    ? "Quem repõe, sinais, opções de leitura, o que fazer se a primeira opção fechar…"
                    : "Quem bate, sinais, variantes, quem fica na cobertura defensiva…"
                }
                disabled={!editable}
              />
            </DialogField>
          </div>
        </Panel>
      </div>
    </>
  );
}

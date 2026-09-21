import { useState, type ReactNode } from "react";
import { Dialog, DialogField, dialogInputClass } from "@/components/Dialog";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { cx } from "@/components/primitives";
import { Check, Plus, Trash2, X } from "@/lib/icons";
import { ApiError } from "@/lib/http";
import { categoriesFor } from "@/lib/sports";
import {
  PHASES,
  PHASE_COLORS,
  createCycle,
  addDays,
  cycleLength,
  mondayOf,
  defaultColor,
  deleteCycle,
  rangeLabel,
  updateCycle,
  type Cycle,
  type CycleLevel,
} from "@/lib/cycles";

/** Uma segunda-feira qualquer: o `min` dos campos de data, a que o `step` de 7 dias se agarra. */
const SEGUNDA_DE_REFERENCIA = "2020-01-06";

const textarea =
  "min-h-20 w-full rounded-[var(--radius-control)] border border-line bg-surface px-2.5 py-2 text-body text-ink focus:border-line-strong focus:outline-none";

/**
 * Um mesociclo ou um microciclo, a criar ou a editar.
 *
 * O mesmo diálogo para os dois níveis, porque são a mesma coisa: um intervalo
 * de dias com intenção. O mesociclo tem nome e cor, que é o que a faixa da época
 * desenha; o micro numera-se sozinho e só pede a intenção.
 *
 * O nome e o foco são texto livre com sugestões ao lado: as sugestões poupam
 * escrever o costume, e quem trabalha com outras palavras escreve-as. A cor não
 * depende do nome: escolher "Competição" não pinta o mesociclo de coisa nenhuma.
 *
 * Mudar as datas não mexe em treinos: os que ficarem de fora deixam de
 * pertencer a este ciclo e mais nada. O texto do diálogo di-lo, porque é a
 * pergunta que qualquer treinador faz antes de carregar em Guardar.
 */
export function CycleDialog({
  level,
  teamId,
  sportId,
  cycle,
  initial,
  label,
  mesoCount = 0,
  onClose,
  onSaved,
}: {
  level: CycleLevel;
  teamId: string;
  sportId: string | null;
  /** O ciclo a editar. Sem ele, cria-se um novo. */
  cycle?: Cycle;
  /** As datas propostas para um ciclo novo. */
  initial?: { startsOn: string; endsOn: string };
  /** "Micro 08", para o título ao editar um micro. */
  label?: string;
  /** Quantos mesociclos a equipa já tem: a cor do novo é a seguinte da paleta. */
  mesoCount?: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const meso = level === "MESO";
  // Os mesociclos antigos podiam ter só o tipo: passa a ser o nome.
  const [name, setName] = useState(cycle?.name ?? cycle?.phase ?? "");
  const [startsOn, setStartsOn] = useState(
    cycle?.startsOn ?? (initial?.startsOn && (meso ? mondayOf(initial.startsOn) : initial.startsOn)) ?? "",
  );
  const [endsOn, setEndsOn] = useState(
    cycle?.endsOn ?? (initial?.endsOn && (meso ? addDays(mondayOf(initial.endsOn), 6) : initial.endsOn)) ?? "",
  );
  const semanasDoMeso =
    meso && startsOn && endsOn && endsOn >= startsOn ? Math.round(cycleLength({ startsOn, endsOn }) / 7) : null;
  const [objective, setObjective] = useState(cycle?.objective ?? "");
  const [focus, setFocus] = useState<string[]>(cycle?.focus ?? []);
  const [outroFoco, setOutroFoco] = useState("");
  const [notes, setNotes] = useState(cycle?.notes ?? "");
  const [color, setColor] = useState<string>(
    cycle?.color ??
      (cycle
        ? defaultColor(cycle.phase)
        : PHASE_COLORS[mesoCount % PHASE_COLORS.length]),
  );
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const categorias = categoriesFor(sportId);
  const sugeridos = new Set(categorias.map((c) => c.label));
  const escritosAMao = focus.filter((f) => !sugeridos.has(f));
  const mesma = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  const corLivre = !PHASE_COLORS.some((c) => mesma(c, color));

  const alternar = (f: string) =>
    setFocus(focus.includes(f) ? focus.filter((x) => x !== f) : [...focus, f]);

  function juntarFoco() {
    const f = outroFoco.trim().slice(0, 60);
    if (!f) return;
    if (!focus.some((x) => mesma(x, f))) {
      if (focus.length >= 8) return setErro("No máximo 8 focos.");
      setFocus([...focus, f]);
    }
    setOutroFoco("");
  }

  async function guardar() {
    if (!startsOn || !endsOn) return setErro("Escolhe o início e o fim.");
    if (endsOn < startsOn) return setErro("O fim é antes do início.");
    setBusy(true);
    setErro(null);
    // As datas só vão quando mudam: um mesociclo antigo, de antes das semanas
    // inteiras, continua a aceitar um nome ou um objetivo sem ser recusado.
    const datasMudaram = !cycle || startsOn !== cycle.startsOn || endsOn !== cycle.endsOn;
    const campos = {
      ...(meso && datasMudaram ? { startsOn, endsOn } : {}),
      objective: objective.trim() || null,
      focus,
      notes: notes.trim() || null,
      // O tipo de fase morreu no nome: limpa-se o antigo para não ficarem dois.
      ...(meso ? { name: name.trim() || null, phase: null, color } : {}),
    };
    try {
      if (cycle) await updateCycle(cycle.id, campos);
      else await createCycle({ teamId, level, startsOn, endsOn, ...campos });
      onSaved();
    } catch (e) {
      setErro(
        e instanceof ApiError || e instanceof Error
          ? e.message
          : "Não foi possível guardar.",
      );
      setBusy(false);
    }
  }

  /* Apagar pergunta primeiro, num diálogo nosso por cima deste. */
  const [aApagar, setAApagar] = useState(false);

  async function apagar() {
    if (!cycle) return;
    await deleteCycle(cycle.id);
    onSaved();
  }

  const titulo = cycle
    ? meso
      ? "Editar mesociclo"
      : `Editar ${label ?? "microciclo"}`
    : meso
      ? "Novo mesociclo"
      : "Novo microciclo";

  return (
    <>
      <Dialog
        title={titulo}
        subtitle={
          meso
            ? "Um bloco da época, com o seu objetivo"
            : "Uma semana de treino, de segunda a domingo"
        }
        onClose={onClose}
        width={520}
        footer={
          <>
            {cycle && (
              <button
                type="button"
                onClick={() => setAApagar(true)}
                disabled={busy}
                className="ctl-ghost mr-auto text-ink-3 hover:text-risk"
              >
                <Trash2 className="size-3.5" strokeWidth={1.75} />
                Apagar
              </button>
            )}
            <button type="button" onClick={onClose} className="ctl-ghost">
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => void guardar()}
              disabled={busy}
              className="ctl-primary"
            >
              Guardar
            </button>
          </>
        }
      >
        <div className="space-y-4 px-5 py-4">
          {meso && (
            <Grupo label="Nome">
              <input
                className={dialogInputClass}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Escreve, ou escolhe uma sugestão"
                maxLength={60}
                autoFocus
                aria-label="Nome do mesociclo"
              />
              <div className="mt-2 flex flex-wrap gap-1.5">
                {PHASES.map((p) => (
                  <Sugestao
                    key={p}
                    on={name.trim() === p}
                    onClick={() => setName(name.trim() === p ? "" : p)}
                  >
                    {p}
                  </Sugestao>
                ))}
              </div>
            </Grupo>
          )}

          {/* A semana não se escolhe: um microciclo é sempre de segunda a domingo. */}
          {meso ? (
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
              <DialogField label="Início">
                {/*
                  Só segundas-feiras: `step` de 7 dias a partir de uma segunda
                  faz o próprio calendário do browser desligar os outros dias.
                  Uma data escrita à mão encosta-se à segunda dessa semana.
                */}
                <input
                  type="date"
                  className={dialogInputClass}
                  value={startsOn}
                  min={SEGUNDA_DE_REFERENCIA}
                  step={7}
                  onChange={(e) => e.target.value && setStartsOn(mondayOf(e.target.value))}
                />
              </DialogField>
              <DialogField
                label="Fim"
                hint={
                  semanasDoMeso
                    ? `${semanasDoMeso} ${semanasDoMeso === 1 ? "semana" : "semanas"}`
                    : undefined
                }
              >
                {/* Só domingos, pela mesma razão. */}
                <input
                  type="date"
                  className={dialogInputClass}
                  value={endsOn}
                  min={startsOn ? addDays(startsOn, 6) : addDays(SEGUNDA_DE_REFERENCIA, 6)}
                  step={7}
                  onChange={(e) => e.target.value && setEndsOn(addDays(mondayOf(e.target.value), 6))}
                />
              </DialogField>
            </div>
          ) : (
            startsOn &&
            endsOn && (
              <p className="text-meta text-ink-2">
                Semana de {rangeLabel(startsOn, endsOn)}
              </p>
            )
          )}

          <DialogField label="Objetivo">
            <input
              className={dialogInputClass}
              value={objective}
              onChange={(e) => setObjective(e.target.value)}
              placeholder={
                meso
                  ? "Consolidar a organização defensiva"
                  : "Transição ofensiva depois da recuperação"
              }
              maxLength={300}
              autoFocus={!meso}
            />
          </DialogField>

          {/*
          Um grupo, e não um <label>: um clique em qualquer sítio de um label
          carrega no primeiro botão lá dentro, e era isso que escolhia sempre a
          primeira sugestão ao clicar no espaço entre elas.
        */}
          <Grupo label="Foco" hint="o que mais se vai treinar">
            <div className="flex flex-wrap gap-1.5">
              {categorias.map((c) => (
                <Sugestao
                  key={c.key}
                  on={focus.includes(c.label)}
                  onClick={() => alternar(c.label)}
                  cor={c.color.base}
                >
                  {c.label}
                </Sugestao>
              ))}
              {escritosAMao.map((f) => (
                <Sugestao key={f} on onClick={() => alternar(f)} tirar>
                  {f}
                </Sugestao>
              ))}
            </div>
            <div className="mt-2 flex gap-2">
              <input
                className={dialogInputClass}
                value={outroFoco}
                onChange={(e) => setOutroFoco(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    juntarFoco();
                  }
                }}
                placeholder="Outro foco"
                maxLength={60}
                aria-label="Outro foco"
              />
              <button
                type="button"
                className="ctl-outline h-9 shrink-0"
                onClick={juntarFoco}
                disabled={!outroFoco.trim()}
              >
                <Plus className="size-3.5" strokeWidth={2} />
                Juntar
              </button>
            </div>
          </Grupo>

          <DialogField label="Notas">
            <textarea
              className={textarea}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={2000}
              placeholder={
                meso
                  ? "O que se quer deste mesociclo, e como se mede."
                  : "Contexto da semana: o adversário, lesões, o que ficou do último jogo."
              }
            />
          </DialogField>

          {meso && (
            <Grupo label="Cor">
              <div className="flex flex-wrap items-center gap-2">
                {PHASE_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-label={`Cor ${c}`}
                    aria-pressed={mesma(c, color)}
                    onClick={() => setColor(c)}
                    className={cx(
                      "size-7 rounded-full ring-offset-2 ring-offset-surface transition-shadow",
                      mesma(c, color) && "ring-2 ring-ink",
                    )}
                    style={{ background: c }}
                  />
                ))}
                <span className="mx-1 h-5 w-px bg-line" aria-hidden />
                {/* A cor livre: o seletor do sistema, com a cor escolhida à vista quando é dele. */}
                <label
                  className={cx(
                    "relative flex size-7 cursor-pointer items-center justify-center overflow-hidden rounded-full border border-line ring-offset-2 ring-offset-surface transition-shadow",
                    corLivre && "ring-2 ring-ink",
                  )}
                  style={{
                    background: corLivre
                      ? color
                      : "conic-gradient(#e5484d, #f5a524, #30a46c, #3e63dd, #8e4ec6, #e5484d)",
                  }}
                  title="Escolher outra cor"
                >
                  <input
                    type="color"
                    value={color}
                    onChange={(e) => setColor(e.target.value)}
                    className="absolute inset-0 cursor-pointer opacity-0"
                    aria-label="Escolher outra cor"
                  />
                </label>
                <span className="text-meta text-ink-3">Outra cor</span>
              </div>
            </Grupo>
          )}

          <p className="text-meta text-ink-3">
            {meso
              ? "As semanas (microciclos) deste mesociclo criam-se sozinhas, de segunda a domingo. Os treinos e os jogos entram pela data, e mudar as datas não mexe em nenhum treino."
              : "Os treinos e os jogos destes dias entram neste microciclo pela data."}
          </p>

          {erro && (
            <p className="rounded-[var(--radius-control)] bg-risk-soft px-3 py-2 text-meta text-risk">
              {erro}
            </p>
          )}
        </div>
      </Dialog>
      {aApagar && cycle && (
        <ConfirmDialog
          title={meso ? "Apagar este mesociclo?" : "Apagar este microciclo?"}
          onConfirm={apagar}
          onClose={() => setAApagar(false)}
        >
          {meso ? (
            <>
              <p>
                <strong className="font-semibold text-ink">
                  {name.trim() || "Este mesociclo"}
                </strong>{" "}
                ({rangeLabel(cycle.startsOn, cycle.endsOn)}) deixa de existir.
              </p>
              <p className="text-meta text-ink-3">
                As semanas dele que ainda estão vazias vão com ele. As que já
                têm objetivo, foco ou notas ficam. Os treinos e os jogos ficam
                onde estão.
              </p>
            </>
          ) : (
            <>
              <p>
                <strong className="font-semibold text-ink">
                  {label ?? "Este microciclo"}
                </strong>{" "}
                ({rangeLabel(cycle.startsOn, cycle.endsOn)}) deixa de existir,
                com o objetivo, o foco e as notas.
              </p>
              <p className="text-meta text-ink-3">
                Os treinos e os jogos dessa semana ficam onde estão.
              </p>
            </>
          )}
        </ConfirmDialog>
      )}
    </>
  );
}

/** Um campo sem `<label>` à volta: para grupos de botões, que o label estragava. */
function Grupo({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div role="group" aria-label={label}>
      <div className="mb-1.5 flex items-baseline justify-between gap-1.5">
        <span className="text-meta font-medium text-ink">{label}</span>
        {hint && <span className="text-[11px] text-ink-4">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

/** Uma sugestão que se liga e desliga. `tirar` mostra o X de um foco escrito à mão. */
function Sugestao({
  on,
  onClick,
  cor,
  tirar,
  children,
}: {
  on: boolean;
  onClick: () => void;
  cor?: string;
  tirar?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-meta transition-colors",
        on
          ? "border-line-strong bg-sunken font-medium text-ink"
          : "border-line text-ink-2 hover:border-line-strong",
      )}
    >
      {cor && (
        <span className="size-2 rounded-full" style={{ background: cor }} />
      )}
      {children}
      {on &&
        (tirar ? (
          <X className="size-3" strokeWidth={2.25} />
        ) : (
          <Check className="size-3" strokeWidth={2.25} />
        ))}
    </button>
  );
}

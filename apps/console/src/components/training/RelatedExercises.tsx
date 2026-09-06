import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Dialog } from "@/components/Dialog";
import { FieldView, THUMB_RATIO } from "@/components/FieldEditor";
import { PanelHead, cx } from "@/components/primitives";
import { Check, Search, Shapes, X } from "@/lib/icons";
import { exercisePath } from "@/lib/sports";
import { listExercises, type ExerciseSummary, type TechnicalRef } from "@/lib/training";

/**
 * Os exercícios ligados a um sistema de jogo ou a uma situação especial.
 *
 * "Para treinar o pick & roll central, estes três." É a ligação que faz de um
 * caderno de sistemas uma metodologia: o sistema diz *o quê*, os exercícios
 * dizem *como se ensina*. A lista é curta, com o nome a abrir a ficha; quem
 * edita escolhe numa grelha com os desenhos à vista — da mesma modalidade, que
 * é a única que faz sentido ligar.
 *
 * O componente não grava: entrega a lista nova a quem o monta, que a mete no
 * rascunho e grava com o resto (`exerciseIds`). Uma ligação gravada à parte do
 * "Guardar" seria a única coisa da ficha a comportar-se de outra maneira.
 */
export function RelatedExercisesPanel({
  sportId,
  exercises,
  editable,
  onChange,
  hint = "com que se treina",
}: {
  sportId: string;
  exercises: TechnicalRef[];
  editable: boolean;
  onChange: (next: TechnicalRef[]) => void;
  hint?: string;
}) {
  const [picking, setPicking] = useState(false);

  return (
    <>
      <PanelHead title="Exercícios relacionados" hint={hint}>
        {editable && (
          <button type="button" className="ctl-outline h-8" onClick={() => setPicking(true)}>
            Escolher
          </button>
        )}
      </PanelHead>

      {exercises.length === 0 ? (
        <p className="px-5 py-4 text-meta leading-relaxed text-ink-4">
          {editable ? "Nenhum ainda — liga os exercícios com que isto se treina." : "Sem exercícios ligados."}
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {exercises.map((e) => (
            <li key={e.id} className="flex items-center gap-2.5 px-5 py-2.5">
              <Shapes className="size-4 shrink-0 text-ink-4" strokeWidth={1.75} />
              <Link to={exercisePath(sportId, e.id)} className="min-w-0 flex-1 truncate text-body text-ink hover:underline">
                {e.name}
              </Link>
              {editable && (
                <button
                  type="button"
                  aria-label={`Tirar ${e.name}`}
                  className="ctl-ghost size-7 justify-center px-0 text-ink-3 hover:text-risk"
                  onClick={() => onChange(exercises.filter((x) => x.id !== e.id))}
                >
                  <X className="size-3.5" strokeWidth={1.75} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {picking && (
        <ExercisePickerDialog
          sportId={sportId}
          selected={exercises}
          onClose={() => setPicking(false)}
          onConfirm={(next) => {
            onChange(next);
            setPicking(false);
          }}
        />
      )}
    </>
  );
}

/**
 * A escolha — a biblioteca da modalidade em cartões pequenos, com o desenho à
 * vista, porque um exercício reconhece-se pela imagem antes do nome.
 */
function ExercisePickerDialog({
  sportId,
  selected,
  onClose,
  onConfirm,
}: {
  sportId: string;
  selected: TechnicalRef[];
  onClose: () => void;
  onConfirm: (next: TechnicalRef[]) => void;
}) {
  const [rows, setRows] = useState<ExerciseSummary[] | null>(null);
  const [q, setQ] = useState("");
  const [chosen, setChosen] = useState<Map<string, string>>(() => new Map(selected.map((e) => [e.id, e.name])));

  useEffect(() => {
    listExercises(sportId).then(setRows).catch(() => setRows([]));
  }, [sportId]);

  const filtered = useMemo(() => {
    if (!rows) return [];
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter(
      (e) =>
        e.name.toLowerCase().includes(needle) ||
        (e.category ?? "").toLowerCase().includes(needle) ||
        e.objectives.some((o) => o.toLowerCase().includes(needle)),
    );
  }, [rows, q]);

  const toggle = (e: ExerciseSummary) =>
    setChosen((cur) => {
      const next = new Map(cur);
      if (next.has(e.id)) next.delete(e.id);
      else next.set(e.id, e.name);
      return next;
    });

  return (
    <Dialog
      title="Exercícios relacionados"
      subtitle="Escolhe os exercícios com que isto se treina — da biblioteca desta modalidade."
      onClose={onClose}
      width={760}
      footer={
        <>
          <button type="button" className="ctl-outline" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="button"
            className="ctl-primary"
            onClick={() => onConfirm([...chosen].map(([id, name]) => ({ id, name })))}
          >
            Guardar escolha{chosen.size > 0 ? ` (${chosen.size})` : ""}
          </button>
        </>
      }
    >
      <div className="space-y-3 p-5">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-4" strokeWidth={1.75} />
          <input
            autoFocus
            className="h-9 w-full rounded-[var(--radius-control)] border border-line bg-surface pl-8 pr-2.5 text-body text-ink focus:border-line-strong focus:outline-none"
            placeholder="Procurar por nome ou objetivo…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>

        {rows === null ? (
          <p className="py-6 text-center text-meta text-ink-4">A carregar a biblioteca…</p>
        ) : filtered.length === 0 ? (
          <p className="py-6 text-center text-meta text-ink-4">
            {rows.length === 0 ? "A biblioteca desta modalidade ainda está vazia." : "Nada com esse nome."}
          </p>
        ) : (
          <div className="grid max-h-[52vh] gap-2 overflow-y-auto sm:grid-cols-2 md:grid-cols-3">
            {filtered.map((e) => {
              const on = chosen.has(e.id);
              return (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => toggle(e)}
                  aria-pressed={on}
                  className={cx(
                    "panel relative overflow-hidden text-left transition-colors",
                    on ? "border-line-strong ring-2 ring-[var(--color-signal)]" : "hover:border-line-strong",
                  )}
                >
                  {e.thumbnail ? (
                    <FieldView diagram={e.thumbnail} className="block w-full" ratio={THUMB_RATIO} />
                  ) : (
                    <div className="flex aspect-[4/3] items-center justify-center bg-sunken text-[11px] text-ink-4">Sem desenho</div>
                  )}
                  {on && (
                    <span className="absolute top-2 right-2 inline-flex size-6 items-center justify-center rounded-full bg-[var(--color-signal)] text-white">
                      <Check className="size-3.5" strokeWidth={2.5} />
                    </span>
                  )}
                  <div className="p-2.5">
                    <div className="truncate text-meta font-semibold text-ink">{e.name}</div>
                    <div className="truncate text-[11px] text-ink-4">{[e.category, e.players, e.durationMin ? `${e.durationMin} min` : null].filter(Boolean).join(" · ") || "—"}</div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </Dialog>
  );
}

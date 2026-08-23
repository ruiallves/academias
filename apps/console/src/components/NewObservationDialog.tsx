import { useState, type FormEvent } from "react";
import { sportById } from "@/lib/api";
import {
  CONTEXT_LABEL,
  RECOMMENDATION_LABEL,
  addObservation,
  type Criterion,
  type ObsContext,
  type ProspectDetail,
  type Recommendation,
} from "@/lib/scouting";
import { Dialog, DialogField, dialogInputClass } from "./Dialog";
import { cx } from "./primitives";

/**
 * Registar uma ida ao campo.
 *
 * ## Porque é que a recomendação é obrigatória
 *
 * Porque é a única coisa que faz o funil andar. Uma observação sem recomendação é
 * uma nota bonita que ninguém volta a ler: descreve o que o scout viu e não diz o
 * que o clube deve fazer a seguir. Com ela, a ficha passa a ter uma proposta —
 * e alguém tem de a aceitar ou recusar.
 *
 * **Não move o dossiê sozinha.** A recomendação sugere; quem move é uma pessoa,
 * com um clique na régua do funil, e fica registado quem foi. Uma automação aqui
 * daria dossiês a andarem sozinhos e deixava "quem decidiu dispensá-lo?" sem
 * resposta.
 *
 * ## As notas por critério são opcionais
 *
 * De propósito. Vinte minutos de um jogo à chuva não dão para pontuar dezasseis
 * competências, e um formulário que o exija ensina a inventar números. Quem tiver
 * base para pontuar, pontua; quem não tiver, escreve o texto e segue.
 */
export function NewObservationDialog({
  prospect,
  criteria,
  onClose,
  onCreated,
}: {
  prospect: ProspectDetail;
  criteria: Criterion[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [observedAt, setObservedAt] = useState(new Date().toISOString().slice(0, 10));
  const [context, setContext] = useState<ObsContext>("MATCH");
  const [opponent, setOpponent] = useState("");
  const [competition, setCompetition] = useState("");
  const [venue, setVenue] = useState("");
  const [minutes, setMinutes] = useState("");
  const [positionObserved, setPositionObserved] = useState(prospect.position ?? "");
  const [strengths, setStrengths] = useState("");
  const [improvements, setImprovements] = useState("");
  const [notes, setNotes] = useState("");
  const [recommendation, setRecommendation] = useState<Recommendation>("KEEP_WATCHING");
  const [ratings, setRatings] = useState<Record<string, number>>({});

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const positions = sportById(prospect.sportId)?.positions ?? [];
  const groups = [...new Set(criteria.map((c) => c.group))];
  const valid = observedAt !== "";

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      await addObservation(prospect.id, {
        observedAt,
        context,
        ...(opponent.trim() ? { opponent: opponent.trim() } : {}),
        ...(competition.trim() ? { competition: competition.trim() } : {}),
        ...(venue.trim() ? { venue: venue.trim() } : {}),
        ...(minutes ? { minutesObserved: Number(minutes) } : {}),
        ...(positionObserved ? { positionObserved } : {}),
        // Uma linha por ponto. Vírgulas obrigavam a decidir o que fazer com
        // "recuperação, defensiva" — e alguém escreveria sempre uma.
        strengths: splitLines(strengths),
        improvements: splitLines(improvements),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        recommendation,
        ratings: Object.entries(ratings).map(([criterionId, score]) => ({ criterionId, score })),
      });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível guardar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      title="Registar observação"
      subtitle={prospect.name}
      onClose={onClose}
      width={640}
      labelledBy="new-observation"
      footer={
        <>
          {error && <span className="mr-auto text-meta text-risk">{error}</span>}
          <button type="button" className="ctl-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" form="new-observation-form" className="ctl-primary" disabled={!valid || busy}>
            {busy ? "A guardar…" : "Guardar observação"}
          </button>
        </>
      }
    >
      <form id="new-observation-form" onSubmit={submit}>
        {/* --- Onde e quando ------------------------------------------------ */}
        <section className="space-y-3 border-b border-line px-5 py-4">
          <div className="grid grid-cols-2 gap-3">
            <DialogField label="Data">
              <input
                type="date"
                value={observedAt}
                onChange={(e) => setObservedAt(e.target.value)}
                className={dialogInputClass}
              />
            </DialogField>

            <DialogField label="Contexto">
              <select
                value={context}
                onChange={(e) => setContext(e.target.value as ObsContext)}
                className={dialogInputClass}
              >
                {(Object.keys(CONTEXT_LABEL) as ObsContext[]).map((c) => (
                  <option key={c} value={c}>
                    {CONTEXT_LABEL[c]}
                  </option>
                ))}
              </select>
            </DialogField>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <DialogField label="Adversário" hint="opcional">
              <input value={opponent} onChange={(e) => setOpponent(e.target.value)} className={dialogInputClass} />
            </DialogField>
            <DialogField label="Prova" hint="opcional">
              <input
                value={competition}
                onChange={(e) => setCompetition(e.target.value)}
                className={dialogInputClass}
              />
            </DialogField>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <DialogField label="Local" hint="opcional">
              <input value={venue} onChange={(e) => setVenue(e.target.value)} className={dialogInputClass} />
            </DialogField>

            {/* Vinte minutos não valem o mesmo que noventa, e sem este número as
                observações parecem todas iguais na ficha. */}
            <DialogField label="Minutos vistos" hint="opcional">
              <input
                value={minutes}
                onChange={(e) => setMinutes(e.target.value.replace(/\D/g, "").slice(0, 3))}
                inputMode="numeric"
                className={dialogInputClass}
              />
            </DialogField>

            {positions.length > 0 && (
              <DialogField label="Jogou a" hint="opcional">
                <select
                  value={positionObserved}
                  onChange={(e) => setPositionObserved(e.target.value)}
                  className={dialogInputClass}
                >
                  <option value="">—</option>
                  {positions.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </DialogField>
            )}
          </div>
        </section>

        {/* --- O que se viu ------------------------------------------------- */}
        <section className="space-y-3 border-b border-line px-5 py-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <DialogField label="Pontos fortes" hint="um por linha">
              <textarea
                value={strengths}
                onChange={(e) => setStrengths(e.target.value)}
                rows={4}
                placeholder={"Passe vertical\nLeitura do espaço"}
                className={cx(dialogInputClass, "h-auto py-2 leading-relaxed")}
              />
            </DialogField>

            <DialogField label="A desenvolver" hint="um por linha">
              <textarea
                value={improvements}
                onChange={(e) => setImprovements(e.target.value)}
                rows={4}
                placeholder={"Duelo aéreo\nRitmo sem bola"}
                className={cx(dialogInputClass, "h-auto py-2 leading-relaxed")}
              />
            </DialogField>
          </div>

          <DialogField label="Notas" hint="opcional">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="O que viste, por palavras tuas."
              className={cx(dialogInputClass, "h-auto py-2 leading-relaxed")}
            />
          </DialogField>
        </section>

        {/* --- Notas por critério ------------------------------------------- */}
        {criteria.length > 0 && (
          <section className="border-b border-line px-5 py-4">
            <div className="mb-1 text-group text-ink-3 uppercase">Avaliação</div>
            <p className="mb-3 text-meta leading-relaxed text-ink-3">
              Opcional, e de 1 a 5. Uma escala fina fingiria uma precisão que ninguém tem a olhar para um
              miúdo durante meia hora — e pontuar tudo o que não se viu é pior do que deixar em branco.
            </p>

            <div className="space-y-4">
              {groups.map((group) => (
                <div key={group}>
                  <div className="mb-1.5 text-meta font-medium text-ink">{group}</div>
                  <ul>
                    {criteria
                      .filter((c) => c.group === group)
                      .map((c) => (
                        <li key={c.id} className="flex items-center gap-3 border-b border-line py-1.5 last:border-0">
                          <span className="min-w-0 flex-1 truncate text-body text-ink-2">{c.name}</span>
                          <div className="flex shrink-0 gap-1">
                            {[1, 2, 3, 4, 5].map((n) => (
                              <button
                                key={n}
                                type="button"
                                onClick={() =>
                                  setRatings((r) => {
                                    const next = { ...r };
                                    if (next[c.id] === n) delete next[c.id];
                                    else next[c.id] = n;
                                    return next;
                                  })
                                }
                                className={cx(
                                  "size-6 rounded-[var(--radius-control)] border text-[11px] font-semibold tabular transition-colors duration-[120ms]",
                                  ratings[c.id] === n
                                    ? "border-transparent bg-ink text-surface"
                                    : "border-line text-ink-3 hover:border-line-strong",
                                )}
                              >
                                {n}
                              </button>
                            ))}
                          </div>
                        </li>
                      ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* --- O que fazer a seguir ------------------------------------------ */}
        <section className="px-5 py-4">
          <div className="mb-1 text-group text-ink-3 uppercase">Recomendação</div>
          <p className="mb-2.5 text-meta leading-relaxed text-ink-3">
            É o que faz o dossiê andar. Sugere o passo seguinte — mover o prospecto continua a ser um clique
            de alguém na régua do funil, e fica registado quem foi.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(RECOMMENDATION_LABEL) as Recommendation[]).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRecommendation(r)}
                className={cx(
                  "rounded-[var(--radius-control)] border px-2.5 py-1 text-meta font-medium transition-colors duration-[120ms]",
                  recommendation === r
                    ? "border-transparent bg-ink text-surface"
                    : "border-line text-ink-2 hover:border-line-strong",
                )}
              >
                {RECOMMENDATION_LABEL[r]}
              </button>
            ))}
          </div>
        </section>
      </form>
    </Dialog>
  );
}

function splitLines(value: string): string[] {
  return value
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 12);
}

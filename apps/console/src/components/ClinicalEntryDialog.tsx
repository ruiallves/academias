import { useMemo, useState, type FormEvent } from "react";
import { Dialog, DialogField, dialogInputClass } from "./Dialog";
import { cx, Monogram, SelectField } from "./primitives";
import { Search, X } from "@/lib/icons";
import { listAthletes, teamById } from "@/lib/api";
import { addClinicalEntry, IMPACT_LABEL, isoToday, KIND_LABEL } from "@/lib/clinical";
import { shortName } from "@/lib/format";
import type { Session } from "@/lib/permissions";
import type { Athlete, ClinicalImpact, ClinicalKind } from "@/data/types";

const KINDS: ClinicalKind[] = ["injury", "physio", "exam", "nutrition", "psychology", "note"];
const IMPACTS: ClinicalImpact[] = ["none", "limited", "out"];

/**
 * Registar no boletim, ou agendar.
 *
 * Um formulário para as duas coisas porque é a mesma entidade em dois momentos —
 * ver `ClinicalStatus`. O impacto na disponibilidade é um campo explícito e não
 * uma consequência do tipo: há lesões que não afastam ninguém e há consultas de
 * nutrição que acabam em paragem. Deixar o sistema adivinhar daria baixas erradas.
 *
 * `athlete` é opcional. A partir da ficha de um atleta já se sabe de quem se
 * trata; a partir dos ecrãs do departamento clínico não, e aí aparece um selector
 * — é o que evita ter de navegar até à ficha só para registar uma consulta.
 */
export function ClinicalEntryDialog({
  athlete,
  session,
  onClose,
  defaultMode = "done",
}: {
  athlete?: Athlete;
  session: Session;
  onClose: () => void;
  defaultMode?: "done" | "scheduled";
}) {
  const [picked, setPicked] = useState<Athlete | undefined>(athlete);

  const [mode, setMode] = useState<"done" | "scheduled">(defaultMode);
  const [kind, setKind] = useState<ClinicalKind>(defaultMode === "scheduled" ? "exam" : "injury");
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [impact, setImpact] = useState<ClinicalImpact>("out");
  const [date, setDate] = useState(isoToday());
  const [time, setTime] = useState("10:00");
  const [location, setLocation] = useState("");
  const [expectedReturn, setExpectedReturn] = useState("");

  const scheduling = mode === "scheduled";

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!picked) return;

    const outDays =
      !scheduling && impact !== "none" && expectedReturn
        ? Math.max(0, Math.round((new Date(expectedReturn).getTime() - new Date(date).getTime()) / 86_400_000))
        : undefined;

    addClinicalEntry(picked.id, {
      date,
      status: scheduling ? "scheduled" : "done",
      time: scheduling ? time : undefined,
      location: scheduling ? location.trim() || undefined : undefined,
      kind,
      title: title.trim() || KIND_LABEL[kind],
      detail: detail.trim() || undefined,
      // Um agendamento futuro não afasta ninguém hoje.
      impact: scheduling ? "none" : impact,
      expectedReturn: !scheduling && impact !== "none" && expectedReturn ? expectedReturn : undefined,
      outDays,
      authorId: session.userId,
    });
    onClose();
  }

  return (
    <Dialog
      labelledBy="registo-clinico"
      title={scheduling ? "Agendar" : "Novo registo clínico"}
      subtitle={picked?.name}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className="ctl-ghost">
            Cancelar
          </button>
          <button type="submit" form="form-clinico" className="ctl-primary" disabled={!picked}>
            Guardar
          </button>
        </>
      }
    >
      <form id="form-clinico" onSubmit={submit} className="space-y-4 p-5">
        <div className="inline-flex items-center gap-px rounded-[var(--radius-control)] bg-sunken p-0.5">
          {(["done", "scheduled"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              aria-pressed={mode === m}
              className={cx(
                "h-7 rounded-[6px] px-3 text-meta font-medium transition-colors duration-[120ms]",
                mode === m ? "bg-surface text-ink shadow-[0_1px_2px_rgb(26_25_23/0.06)]" : "text-ink-3 hover:text-ink-2",
              )}
            >
              {m === "done" ? "Registar" : "Agendar"}
            </button>
          ))}
        </div>

        {/* Só quando não se veio da ficha de alguém. */}
        {!athlete && <AthletePicker session={session} picked={picked} onPick={setPicked} />}

        <div className="grid grid-cols-2 gap-3">
          <DialogField label="Tipo">
            <SelectField
              className="w-full"
              value={kind}
              onChange={(v) => setKind(v as ClinicalKind)}
              options={KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] }))}
            />
          </DialogField>
          <DialogField label="Data">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={dialogInputClass} required />
          </DialogField>
        </div>

        {scheduling && (
          <div className="grid grid-cols-[auto_1fr] gap-3">
            <DialogField label="Hora">
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={dialogInputClass} required />
            </DialogField>
            <DialogField label="Local" hint="opcional">
              <input
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Clínica, sede da academia…"
                className={dialogInputClass}
              />
            </DialogField>
          </div>
        )}

        <DialogField label="Descrição" hint="opcional">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={KIND_LABEL[kind]}
            className={dialogInputClass}
          />
        </DialogField>

        <DialogField label="Notas" hint={scheduling ? "a família vê esta nota" : "fica no boletim"}>
          <textarea
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
            rows={3}
            className={cx(dialogInputClass, "h-auto resize-none py-2")}
          />
        </DialogField>

        {scheduling ? (
          <p className="rounded-[var(--radius-control)] border border-line bg-sunken/40 p-3 text-meta text-ink-3">
            O agendamento aparece na app da família e na agenda do departamento clínico. A
            disponibilidade do atleta só muda quando registares o resultado.
          </p>
        ) : (
          <div className="rounded-[var(--radius-control)] border border-line bg-sunken/40 p-3">
            <DialogField label="Impacto na disponibilidade">
              <SelectField
                className="w-full"
                value={impact}
                onChange={(v) => setImpact(v as ClinicalImpact)}
                options={IMPACTS.map((i) => ({ value: i, label: IMPACT_LABEL[i] }))}
              />
            </DialogField>

            {impact !== "none" && (
              <div className="mt-3">
                <DialogField label="Retoma prevista" hint="o treinador vê esta data">
                  <input
                    type="date"
                    value={expectedReturn}
                    onChange={(e) => setExpectedReturn(e.target.value)}
                    className={dialogInputClass}
                  />
                </DialogField>
                <p className="mt-2 text-meta text-ink-3">
                  Ao guardar, o atleta fica marcado em toda a aplicação — ficha, plantel,
                  convocatórias e registo de presenças.
                </p>
              </div>
            )}
          </div>
        )}
      </form>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Escolher o atleta.
 *
 * Uma lista com cento e tal nomes num `<select>` é intragável — escrever duas
 * letras e escolher é o gesto natural. Mostra só seis resultados de cada vez: uma
 * lista mais longa obriga a percorrer em vez de refinar a pesquisa.
 */
function AthletePicker({
  session,
  picked,
  onPick,
}: {
  session: Session;
  picked?: Athlete;
  onPick: (a: Athlete | undefined) => void;
}) {
  const [query, setQuery] = useState("");
  const athletes = listAthletes(session);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return athletes.filter((a) => a.name.toLowerCase().includes(q)).slice(0, 6);
  }, [athletes, query]);

  if (picked) {
    return (
      <DialogField label="Atleta">
        <div className="flex items-center gap-2.5 rounded-[var(--radius-control)] border border-line bg-surface px-2.5 py-2">
          <Monogram name={picked.name} size="sm" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-body font-medium text-ink">{picked.name}</div>
            <div className="text-meta text-ink-3">{teamById(picked.teamId)?.name}</div>
          </div>
          <button
            type="button"
            onClick={() => {
              onPick(undefined);
              setQuery("");
            }}
            className="flex size-7 shrink-0 items-center justify-center rounded-[6px] text-ink-4 hover:bg-sunken hover:text-ink"
            aria-label="Escolher outro atleta"
          >
            <X className="size-3.5" strokeWidth={1.75} />
          </button>
        </div>
      </DialogField>
    );
  }

  return (
    <DialogField label="Atleta">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-4" strokeWidth={1.75} />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Escrever o nome…"
          className={cx(dialogInputClass, "pl-8")}
        />
      </div>

      {matches.length > 0 && (
        <ul className="mt-1.5 overflow-hidden rounded-[var(--radius-control)] border border-line">
          {matches.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                onClick={() => onPick(a)}
                className="flex w-full items-center gap-2.5 border-b border-line px-2.5 py-2 text-left last:border-0 hover:bg-sunken/60"
              >
                <Monogram name={a.name} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body text-ink">{shortName(a.name)}</span>
                  <span className="block truncate text-meta text-ink-3">{teamById(a.teamId)?.name}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {query.trim() && matches.length === 0 && (
        <p className="mt-1.5 text-meta text-ink-3">Nenhum atleta com esse nome.</p>
      )}
    </DialogField>
  );
}

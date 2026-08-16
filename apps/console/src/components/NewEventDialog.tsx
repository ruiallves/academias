import { Link } from "react-router-dom";
import { useState, type FormEvent } from "react";
import { categoryColor } from "@academia/ui/tokens";
import { KIND_LABEL, addEvent, type EventKind } from "@/lib/calendar";
import { listTeams } from "@/lib/api";
import { useActiveCatalog } from "@/lib/catalogs";
import { longDate } from "@/lib/format";
import { Settings } from "@/lib/icons";
import type { Session } from "@/lib/permissions";
import { Dialog, DialogField, dialogInputClass } from "./Dialog";
import { cx, SelectField } from "./primitives";

const KINDS: EventKind[] = ["training", "match", "tournament", "other"];

/**
 * Criar evento.
 *
 * Seis campos e nenhum obrigatório sem razão. O título preenche-se sozinho a partir
 * do tipo e do escalão — "Jogo · Sub-13 Futebol" — porque em nove de cada dez casos
 * é isso que a pessoa ia escrever, e continua editável para o décimo.
 *
 * Escolher "Toda a academia" tira a cor ao evento de propósito: a ausência de cor é
 * o que distingue um evento da casa de um evento de escalão.
 */
export function NewEventDialog({
  session,
  day,
  onClose,
}: {
  session: Session;
  day: Date;
  onClose: () => void;
}) {
  const teams = listTeams(session);
  const venues = useActiveCatalog("venues");

  const [kind, setKind] = useState<EventKind>("training");
  const [teamId, setTeamId] = useState(teams[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(toInputDate(day));
  const [start, setStart] = useState("18:00");
  const [end, setEnd] = useState("19:30");
  const [venue, setVenue] = useState(venues[0]?.label ?? "");

  const teamName = teams.find((t) => t.id === teamId)?.name;
  const suggested = teamId ? `${KIND_LABEL[kind]} · ${teamName}` : `${KIND_LABEL[kind]} · toda a academia`;

  function submit(e: FormEvent) {
    e.preventDefault();
    const [y, m, d] = date.split("-").map(Number);
    const [sh, sm] = start.split(":").map(Number);
    const [eh, em] = end.split(":").map(Number);

    addEvent({
      kind,
      teamId: teamId || undefined,
      title: title.trim() || suggested,
      start: new Date(y, m - 1, d, sh, sm),
      end: new Date(y, m - 1, d, eh, em),
      venue,
    });
    onClose();
  }

  return (
    <Dialog
      labelledBy="novo-evento"
      title="Novo evento"
      subtitle={capitalize(longDate(new Date(`${date}T00:00:00`)))}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className="ctl-ghost">
            Cancelar
          </button>
          <button type="submit" form="form-novo-evento" className="ctl-primary" disabled={venues.length === 0}>
            Agendar
          </button>
        </>
      }
    >
      <form id="form-novo-evento" onSubmit={submit} className="space-y-4 p-5">
        <fieldset>
          <legend className="mb-1.5 text-meta font-medium text-ink">Tipo</legend>
          <div className="inline-flex items-center gap-px rounded-[var(--radius-control)] bg-sunken p-0.5">
            {KINDS.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                aria-pressed={kind === k}
                className={cx(
                  "h-7 rounded-[6px] px-2.5 text-meta font-medium transition-colors duration-[120ms]",
                  kind === k ? "bg-surface text-ink shadow-[0_1px_2px_rgb(26_25_23/0.06)]" : "text-ink-3 hover:text-ink-2",
                )}
              >
                {KIND_LABEL[k]}
              </button>
            ))}
          </div>
        </fieldset>

        <DialogField label="Escalão">
          <div className="flex items-center gap-2">
            <span
              className="size-2.5 shrink-0 rounded-full"
              style={{
                background: teamId
                  ? categoryColor(teams.findIndex((t) => t.id === teamId)).base
                  : "var(--color-ink-4)",
              }}
              aria-hidden
            />
            <SelectField
              className="flex-1"
              value={teamId}
              onChange={setTeamId}
              options={[
                ...teams.map((t) => ({ value: t.id, label: t.name })),
                { value: "", label: "Toda a academia (sem cor)" },
              ]}
            />
          </div>
        </DialogField>

        <DialogField label="Título" hint="opcional">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={suggested} className={dialogInputClass} />
        </DialogField>

        <div className="grid grid-cols-[1.4fr_1fr_1fr] gap-3">
          <DialogField label="Data">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={dialogInputClass} required />
          </DialogField>
          <DialogField label="Início">
            <input type="time" value={start} onChange={(e) => setStart(e.target.value)} className={dialogInputClass} required />
          </DialogField>
          <DialogField label="Fim">
            <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} className={dialogInputClass} required />
          </DialogField>
        </div>

        <DialogField
          label="Local"
          hint={
            <Link to="/definicoes?catalogo=venues" className="inline-flex items-center gap-1 text-ink-3 hover:text-ink">
              <Settings className="size-3" strokeWidth={1.75} />
              gerir locais
            </Link>
          }
        >
          {venues.length > 0 ? (
            <SelectField
              className="w-full"
              value={venue}
              onChange={setVenue}
              options={venues.map((v) => ({ value: v.label, label: v.label }))}
            />
          ) : (
            <p className="rounded-[var(--radius-control)] border border-dashed border-line bg-sunken/50 px-2.5 py-2 text-meta text-ink-3">
              Ainda não há locais.{" "}
              <Link to="/definicoes?catalogo=venues" className="font-medium text-ink underline">
                Criar o primeiro
              </Link>
            </p>
          )}
        </DialogField>
      </form>
    </Dialog>
  );
}

function toInputDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const capitalize = (s: string) => s[0].toUpperCase() + s.slice(1);

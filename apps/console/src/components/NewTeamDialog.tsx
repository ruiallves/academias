import { Link } from "react-router-dom";
import { useState, type FormEvent } from "react";
import { academy, listCoaches, listTeams } from "@/lib/api";
import { useActiveCatalog } from "@/lib/catalogs";
import { createTeam } from "@/lib/roster";
import { Plus, Settings, Trash2 } from "@/lib/icons";
import type { Session } from "@/lib/permissions";
import type { Team } from "@/data/types";
import { Dialog, DialogField, dialogInputClass } from "./Dialog";
import { SelectField } from "./primitives";

const WEEKDAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

type Slot = { weekday: number; start: string; end: string; venue: string };

/**
 * Criar equipa.
 *
 * Modalidade e escalão vêm primeiro porque o nome se sugere a partir deles —
 * "Sub-9 Futebol" — o mesmo truque do Novo evento. O escalão vem do catálogo
 * (Definições → Catálogos), não de texto livre: é o que impede "Sub-9", "sub9" e
 * "Sub 9" de coexistirem na mesma academia.
 */
export function NewTeamDialog({ session, onClose }: { session: Session; onClose: () => void }) {
  const coaches = listCoaches();
  const ageGroups = useActiveCatalog("ageGroups");
  const venues = useActiveCatalog("venues");
  const existingTeams = listTeams(session);

  const [sportId, setSportId] = useState(academy.sports[0]?.id ?? "");
  const [ageGroup, setAgeGroup] = useState(ageGroups[0]?.label ?? "");
  const [name, setName] = useState("");
  const [coachId, setCoachId] = useState("");
  const [season, setSeason] = useState(guessSeason(existingTeams));
  const [slots, setSlots] = useState<Slot[]>([{ weekday: 1, start: "18:00", end: "19:30", venue: venues[0]?.label ?? "" }]);

  const sport = academy.sports.find((s) => s.id === sportId);
  const suggested = ageGroup && sport ? `${ageGroup} ${sport.name}` : "";

  const updateSlot = (i: number, patch: Partial<Slot>) =>
    setSlots((xs) => xs.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));

  function submit(e: FormEvent) {
    e.preventDefault();
    createTeam({
      name: name.trim() || suggested,
      sportId,
      ageGroup,
      season: season.trim(),
      coachId: coachId || undefined,
      schedule: slots.filter((s) => s.venue),
    });
    onClose();
  }

  return (
    <Dialog
      labelledBy="nova-equipa"
      title="Nova equipa"
      subtitle={academy.name}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className="ctl-ghost">
            Cancelar
          </button>
          <button type="submit" form="form-nova-equipa" className="ctl-primary" disabled={!ageGroup}>
            Criar equipa
          </button>
        </>
      }
    >
      <form id="form-nova-equipa" onSubmit={submit} className="space-y-4 p-5">
        <div className="grid grid-cols-2 gap-3">
          <DialogField label="Modalidade">
            <SelectField
              className="w-full"
              value={sportId}
              onChange={setSportId}
              options={academy.sports.map((s) => ({ value: s.id, label: s.name }))}
            />
          </DialogField>

          <DialogField
            label="Escalão"
            hint={
              <Link to="/definicoes?catalogo=ageGroups" className="inline-flex items-center gap-1 text-ink-3 hover:text-ink">
                <Settings className="size-3" strokeWidth={1.75} />
                gerir
              </Link>
            }
          >
            {ageGroups.length > 0 ? (
              <SelectField
                className="w-full"
                value={ageGroup}
                onChange={setAgeGroup}
                options={ageGroups.map((g) => ({ value: g.label, label: g.label }))}
              />
            ) : (
              <p className="rounded-[var(--radius-control)] border border-dashed border-line bg-sunken/50 px-2.5 py-2 text-meta text-ink-3">
                Sem escalões.{" "}
                <Link to="/definicoes?catalogo=ageGroups" className="font-medium text-ink underline">
                  Criar um
                </Link>
              </p>
            )}
          </DialogField>
        </div>

        <DialogField label="Nome" hint="opcional">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={suggested || "Nome da equipa"} className={dialogInputClass} />
        </DialogField>

        <div className="grid grid-cols-2 gap-3">
          <DialogField label="Treinador principal" hint="opcional">
            <SelectField
              className="w-full"
              value={coachId}
              onChange={setCoachId}
              options={[{ value: "", label: "Por atribuir" }, ...coaches.map((c) => ({ value: c.id, label: c.name }))]}
            />
          </DialogField>

          <DialogField label="Época">
            <input value={season} onChange={(e) => setSeason(e.target.value)} className={dialogInputClass} required />
          </DialogField>
        </div>

        <fieldset>
          <legend className="mb-1.5 text-meta font-medium text-ink">Horário de treinos</legend>

          {venues.length === 0 ? (
            <p className="rounded-[var(--radius-control)] border border-dashed border-line bg-sunken/50 px-2.5 py-2 text-meta text-ink-3">
              Sem locais ainda.{" "}
              <Link to="/definicoes?catalogo=venues" className="font-medium text-ink underline">
                Criar um
              </Link>{" "}
              antes de marcar o horário — pode ficar por fazer e adicionar-se depois.
            </p>
          ) : (
            <div className="space-y-2">
              {slots.map((slot, i) => (
                <div key={i} className="grid grid-cols-[1.2fr_0.85fr_0.85fr_1.1fr_auto] items-end gap-1.5">
                  <SelectField
                    className="w-full"
                    value={String(slot.weekday)}
                    onChange={(v) => updateSlot(i, { weekday: Number(v) })}
                    options={WEEKDAYS.map((w, wi) => ({ value: String(wi), label: w }))}
                  />
                  <input type="time" value={slot.start} onChange={(e) => updateSlot(i, { start: e.target.value })} className={dialogInputClass} />
                  <input type="time" value={slot.end} onChange={(e) => updateSlot(i, { end: e.target.value })} className={dialogInputClass} />
                  <SelectField
                    className="w-full"
                    value={slot.venue}
                    onChange={(v) => updateSlot(i, { venue: v })}
                    options={venues.map((v) => ({ value: v.label, label: v.label }))}
                  />
                  <button
                    type="button"
                    onClick={() => setSlots((xs) => xs.filter((_, idx) => idx !== i))}
                    disabled={slots.length === 1}
                    className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-control)] text-ink-4 hover:bg-risk-soft hover:text-risk disabled:opacity-0"
                    aria-label="Remover horário"
                  >
                    <Trash2 className="size-3.5" strokeWidth={1.75} />
                  </button>
                </div>
              ))}

              <button
                type="button"
                onClick={() => setSlots((xs) => [...xs, { weekday: 1, start: "18:00", end: "19:30", venue: venues[0]?.label ?? "" }])}
                className="ctl-ghost h-8 gap-1.5 text-meta text-ink-3"
              >
                <Plus className="size-3.5" strokeWidth={2} />
                Mais um dia
              </button>
            </div>
          )}
        </fieldset>
      </form>
    </Dialog>
  );
}

function guessSeason(teams: Team[]): string {
  const counts = new Map<string, number>();
  for (const t of teams) counts.set(t.season, (counts.get(t.season) ?? 0) + 1);
  let best = "";
  let bestCount = 0;
  for (const [season, count] of counts) {
    if (count > bestCount) {
      best = season;
      bestCount = count;
    }
  }
  return best || "2026/27";
}

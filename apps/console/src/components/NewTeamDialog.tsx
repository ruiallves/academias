import { Link } from "react-router-dom";
import { useState, type FormEvent } from "react";
import { academy, listCoachCandidates } from "@/lib/api";
import { apiPost } from "@/lib/http";
import { reloadAcademy, seasons as knownSeasons } from "@/lib/store";
import { useActiveCatalog } from "@/lib/catalogs";
import { Plus, Settings, Trash2 } from "@/lib/icons";
import { Dialog, DialogField, dialogInputClass } from "./Dialog";
import { PersonPicker } from "./PersonPicker";
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
 *
 * **A época segue o mesmo princípio, e passou a segui-lo tarde de mais.** Era um
 * campo para escrever, e o servidor resolve a época pelo rótulo — encontra-a ou
 * cria-a. Quem escrevesse "2026/2027" num clube que já tinha "2026/27" não via
 * erro nenhum: ficava com duas épocas e com as equipas do ano repartidas entre
 * elas. Nada disto é uma coisa que se redija; é uma escolha entre poucas.
 */
export function NewTeamDialog({ onClose }: { onClose: () => void }) {
  const coaches = listCoachCandidates();
  const ageGroups = useActiveCatalog("ageGroups");
  const venues = useActiveCatalog("venues");
  const seasonChoices = seasonOptions(knownSeasons);

  const [sportId, setSportId] = useState(academy.sports[0]?.id ?? "");
  const [ageGroup, setAgeGroup] = useState(ageGroups[0]?.label ?? "");
  const [name, setName] = useState("");
  const [coachId, setCoachId] = useState("");
  const [season, setSeason] = useState(defaultSeason(seasonChoices));
  const [slots, setSlots] = useState<Slot[]>([{ weekday: 1, start: "18:00", end: "19:30", venue: venues[0]?.label ?? "" }]);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sport = academy.sports.find((s) => s.id === sportId);
  const suggested = ageGroup && sport ? `${ageGroup} ${sport.name}` : "";

  const updateSlot = (i: number, patch: Partial<Slot>) =>
    setSlots((xs) => xs.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await apiPost("/api/teams", {
        name: name.trim() || suggested,
        sportId,
        ageGroup,
        season: season.trim(),
        ...(coachId ? { coachId } : {}),
        schedule: slots.filter((s) => s.venue),
      });
      await reloadAcademy();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível criar a equipa.");
    } finally {
      setBusy(false);
    }
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
          <button type="submit" form="form-nova-equipa" className="ctl-primary" disabled={!ageGroup || busy}>
            {busy ? "A criar…" : "Criar equipa"}
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
          {/*
            Escrever o nome, em vez de o procurar numa lista.

            E a lista deixou de ser "quem já treina alguma equipa" — que numa
            academia nova é ninguém, e por isso não havia forma de atribuir a
            primeira equipa. Ver `listCoachCandidates`.
          */}
          <DialogField label="Treinador principal" hint="opcional">
            <PersonPicker
              pessoas={coaches.map((c) => ({ id: c.id, name: c.name, sub: c.title }))}
              value={coachId}
              onChange={setCoachId}
              emptyLabel="Por atribuir"
              placeholder="Escrever um nome…"
            />
          </DialogField>

          {/*
            Um menu, e não um campo para escrever.

            Era um `input` de texto livre, e o servidor resolve a época pelo
            rótulo — encontra-a ou cria-a. Escrever "2026/2027" onde o clube já
            tinha "2026/27" não dava erro nenhum: criava uma segunda época, e as
            equipas do ano ficavam repartidas por duas, sem ninguém perceber
            porquê. A época é uma escolha entre poucas, não uma coisa que se
            redige — o mesmo que já acontece com o escalão, ali em cima.
          */}
          <DialogField label="Época">
            <SelectField
              className="w-full"
              value={season}
              onChange={setSeason}
              options={seasonChoices.map((s) => ({ value: s, label: s }))}
            />
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
              {/*
                Duas linhas por treino, e não cinco colunas.

                Eram cinco campos lado a lado — dia, início, fim, local, apagar —
                dentro de um diálogo de 460px. Os dois campos de hora ficavam com
                menos de 60px cada e o relógio do browser saía cortado.

                Agora o **dia e o local** ficam em cima (é assim que se diz um
                treino: "terça, no Campo 1") e as **horas** por baixo, com "das" e
                "às" a ligá-las. As horas ganham a largura que precisam, e a linha
                lê-se como uma frase.
              */}
              {slots.map((slot, i) => (
                <div key={i} className="rounded-[var(--radius-control)] border border-line bg-sunken/30 p-2">
                  <div className="flex items-center gap-1.5">
                    <SelectField
                      className="min-w-0 flex-1"
                      value={String(slot.weekday)}
                      onChange={(v) => updateSlot(i, { weekday: Number(v) })}
                      options={WEEKDAYS.map((w, wi) => ({ value: String(wi), label: w }))}
                    />
                    <SelectField
                      className="min-w-0 flex-1"
                      value={slot.venue}
                      onChange={(v) => updateSlot(i, { venue: v })}
                      options={venues.map((v) => ({ value: v.label, label: v.label }))}
                    />
                    <button
                      type="button"
                      onClick={() => setSlots((xs) => xs.filter((_, idx) => idx !== i))}
                      disabled={slots.length === 1}
                      className="flex size-9 shrink-0 items-center justify-center rounded-[var(--radius-control)] text-ink-4 hover:bg-risk-soft hover:text-risk disabled:opacity-0"
                      aria-label="Remover horário"
                    >
                      <Trash2 className="size-3.5" strokeWidth={1.75} />
                    </button>
                  </div>

                  <div className="mt-1.5 flex items-center gap-2 pr-9">
                    <span className="shrink-0 text-meta text-ink-3">das</span>
                    <input
                      type="time"
                      value={slot.start}
                      onChange={(e) => updateSlot(i, { start: e.target.value })}
                      aria-label="Hora de início"
                      className={`${dialogInputClass} min-w-0 flex-1`}
                    />
                    <span className="shrink-0 text-meta text-ink-3">às</span>
                    <input
                      type="time"
                      value={slot.end}
                      onChange={(e) => updateSlot(i, { end: e.target.value })}
                      aria-label="Hora de fim"
                      className={`${dialogInputClass} min-w-0 flex-1`}
                    />
                  </div>
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

        {error && (
          <p className="rounded-[var(--radius-control)] bg-risk-soft px-3 py-2 text-meta text-risk">{error}</p>
        )}
      </form>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* As épocas                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * A época a que hoje pertence: `2026/27`.
 *
 * A época desportiva vai de agosto a julho — a mesma convenção que o servidor
 * usa ao criar uma (ver `resolveSeason`). De janeiro a julho ainda se está na
 * que começou no ano anterior.
 */
function seasonOf(date: Date): string {
  const year = date.getFullYear() - (date.getMonth() < 7 ? 1 : 0);
  return `${year}/${String((year + 1) % 100).padStart(2, "0")}`;
}

/**
 * O que o menu oferece.
 *
 * As épocas que a academia tem (o servidor manda-as da mais recente para trás)
 * mais a **actual e a seguinte**, quando ainda não existirem. As duas
 * calculadas resolvem os dois momentos em que faltaria sempre uma: a academia
 * acabada de criar, que não tem nenhuma, e o clube que em junho começa a montar
 * as equipas do ano que vem.
 *
 * Ordena-se pelo ano de início, da mais recente para trás. Um rótulo que não se
 * consiga ler como ano — um clube com convenção própria — vai para o fim em vez
 * de se perder: continua escolhível, só não se finge saber onde encaixa no
 * tempo.
 */
export function seasonOptions(existing: string[], today = new Date()): string[] {
  const now = seasonOf(today);
  const next = seasonOf(new Date(today.getFullYear() + 1, today.getMonth(), 1));

  const all = [...new Set([...existing, now, next])];

  return all.sort((a, b) => {
    const ya = startYear(a);
    const yb = startYear(b);
    if (ya === null && yb === null) return a.localeCompare(b, "pt");
    if (ya === null) return 1;
    if (yb === null) return -1;
    return yb - ya;
  });
}

function startYear(label: string): number | null {
  const m = label.match(/^(\d{4})/);
  return m ? Number(m[1]) : null;
}

/**
 * A que já vem escolhida.
 *
 * A época de hoje, que é a que quem cria uma equipa quer em quase todos os
 * casos. Se por alguma razão não estiver na lista, a primeira serve — nunca se
 * abre o diálogo com o campo vazio.
 */
function defaultSeason(choices: string[]): string {
  const now = seasonOf(new Date());
  return choices.includes(now) ? now : (choices[0] ?? now);
}

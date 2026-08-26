import { Link } from "react-router-dom";
import { useState, type FormEvent } from "react";
import { academy, listCoachCandidates } from "@/lib/api";
import { apiPost } from "@/lib/http";
import { reloadAcademy, seasons as knownSeasons } from "@/lib/store";
import { useActiveCatalog } from "@/lib/catalogs";
import { defaultSeason, seasonOptions } from "@/lib/seasons";
import { SEM_LIMITE, teamAgeLabel } from "@/lib/team-age";
import { Plus, Trash2 } from "@/lib/icons";
import { Dialog, DialogField, dialogInputClass } from "./Dialog";
import { PersonPicker } from "./PersonPicker";
import { cx, SelectField } from "./primitives";

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
  const venues = useActiveCatalog("venues");
  const seasonChoices = seasonOptions(knownSeasons);

  const [sportId, setSportId] = useState(academy.sports[0]?.id ?? "");
  /*
   * A idade em texto, e não em número.
   *
   * Um `useState<number>` obrigava a escolher um valor inicial, e qualquer um
   * seria uma sugestão que ninguém pediu — a equipa nasceria "Sub-11" por
   * omissão e passaria assim para metade dos clubes. Vazio é a única resposta
   * honesta antes de alguém escrever, e vazio não é um número.
   */
  const [age, setAge] = useState("");
  const [name, setName] = useState("");
  const [coachId, setCoachId] = useState("");
  const [season, setSeason] = useState(defaultSeason(seasonChoices));
  /*
   * Sem horário nenhum, de início.
   *
   * Nascia com uma linha já preenchida — segunda, 18:00, primeiro campo da lista
   * — e a linha não se podia apagar. Uma equipa que ainda não tem horário
   * marcado, que é o caso normal de quem está a montar o clube em Agosto, ficava
   * com um treino inventado à segunda-feira. O horário é opcional: marca-se aqui
   * a quem já o sabe, e na ficha da equipa a quem ainda não.
   */
  const [slots, setSlots] = useState<Slot[]>([]);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sport = academy.sports.find((s) => s.id === sportId);
  const maxAge = Number(age);
  const ageOk = /^\d{1,2}$/.test(age) && maxAge >= 4 && maxAge <= SEM_LIMITE;
  const suggested = ageOk && sport ? `${teamAgeLabel(maxAge)} ${sport.name}` : "";

  const updateSlot = (i: number, patch: Partial<Slot>) =>
    setSlots((xs) => xs.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || !ageOk) return;
    setBusy(true);
    setError(null);
    try {
      await apiPost("/api/teams", {
        name: name.trim() || suggested,
        sportId,
        maxAge,
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
          <button type="submit" form="form-nova-equipa" className="ctl-primary" disabled={!ageOk || busy}>
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

          {/*
            "Sub-" fixo, e o número escrito.

            Substituiu um menu de escalões vindo de um catálogo. O escalão e a
            equipa eram a mesma coisa: um clube criava "Sub-11" nas Definições
            para depois criar a equipa "Sub-11 Futebol" — dois passos e dois
            sítios para uma decisão só.

            O prefixo colado ao campo faz o trabalho que a lista fazia (ninguém
            escreve "sub 11" nem "Iniciados") sem obrigar a manter um vocabulário
            à parte. E o que fica gravado é o número, que é o que a convocatória
            precisa de comparar com a idade do atleta.
          */}
          <DialogField label="Idade máxima" hint="dos atletas">
            <div
              className={cx(
                "flex h-9 items-center rounded-[var(--radius-control)] border bg-surface px-2.5",
                "focus-within:border-signal",
                age && !ageOk ? "border-risk" : "border-line",
              )}
            >
              <span aria-hidden className="select-none text-body font-medium text-ink-3">
                Sub-
              </span>
              <input
                value={age}
                onChange={(e) => setAge(e.target.value.replace(/\D/g, "").slice(0, 2))}
                inputMode="numeric"
                aria-label="Idade máxima dos atletas da equipa"
                placeholder="11"
                className="w-full min-w-0 bg-transparent text-body text-ink outline-none placeholder:text-ink-4"
              />
            </div>
          </DialogField>
        </div>

        {/* Só depois de haver número: antes disso não há nada de útil a dizer. */}
        {ageOk && (
          <p className="-mt-1 text-meta text-ink-3">
            Entram atletas até aos {maxAge} anos. É esta idade que decide quem pode ser convocado de outra equipa.
          </p>
        )}

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
          <legend className="mb-1.5 flex items-baseline gap-2 text-meta font-medium text-ink">
            Horário de treinos
            <span className="font-normal text-ink-4">opcional</span>
          </legend>

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
                    {/* Sempre activo: a última linha também se apaga, e ficar sem
                        horário nenhum é um estado legítimo. */}
                    <button
                      type="button"
                      onClick={() => setSlots((xs) => xs.filter((_, idx) => idx !== i))}
                      className="flex size-9 shrink-0 items-center justify-center rounded-[var(--radius-control)] text-ink-4 hover:bg-risk-soft hover:text-risk"
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
                {slots.length === 0 ? "Marcar um treino" : "Mais um dia"}
              </button>

              {slots.length === 0 && (
                <p className="text-meta text-ink-4">
                  Sem horário, a equipa fica criada na mesma — marca-se depois, na ficha dela.
                </p>
              )}
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

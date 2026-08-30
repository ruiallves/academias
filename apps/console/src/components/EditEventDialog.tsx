import { Link } from "react-router-dom";
import { useState, type FormEvent } from "react";
import { KIND_LABEL, type CalendarEvent } from "@/lib/calendar";
import { teamById } from "@/lib/api";
import { apiPut } from "@/lib/http";
import { reloadAcademy } from "@/lib/store";
import { useActiveCatalog } from "@/lib/catalogs";
import { longDate } from "@/lib/format";
import { Settings, TriangleAlert } from "@/lib/icons";
import { Dialog, DialogField, dialogInputClass } from "./Dialog";
import { cx, SelectField } from "./primitives";

/**
 * Editar um evento que já existe.
 *
 * ## O que não se edita, e porquê
 *
 * **O tipo e o escalão.** Um treino vive numa tabela, um jogo noutra, um evento
 * genérico numa terceira — e cada um leva atrás a sua folha de presenças, a sua
 * convocatória e a sua ficha. Transformar um treino num jogo não é editar: é
 * apagar um e criar outro, e o que se perde pelo caminho não é evidente para
 * quem carrega no botão. Quem se enganou no tipo cancela e marca de novo, que é
 * uma acção que se percebe. O servidor tem a mesma fronteira (`updateEvent`).
 *
 * O que se edita é o que muda na vida real: a hora que o adversário pediu para
 * trocar, o campo que ficou alagado, o balneário que passou a ser outro.
 *
 * ## Só o que mexeu
 *
 * Envia-se apenas os campos alterados. Não é economia de bytes — é para o
 * servidor distinguir "não toquei nisto" de "quero isto vazio", que num corpo
 * com o objecto todo se confundem. Ver `EditEventDto`.
 */
export function EditEventDialog({ event, onClose }: { event: CalendarEvent; onClose: () => void }) {
  const venues = useActiveCatalog("venues");
  const dressingRooms = useActiveCatalog("dressingRooms");
  const team = event.teamId ? teamById(event.teamId) : undefined;

  const isMatch = event.kind === "match";
  const competicoes = team?.competitions ?? [];

  const [title, setTitle] = useState(event.title);
  const [date, setDate] = useState(toInputDate(event.start));
  const [start, setStart] = useState(toInputTime(event.start));
  const [end, setEnd] = useState(toInputTime(event.end));
  const [venue, setVenue] = useState(event.venue);
  const [dressingRoom, setDressingRoom] = useState(event.dressingRoom ?? "");
  const [opponent, setOpponent] = useState(event.match?.opponent ?? "");
  const [isHome, setIsHome] = useState(event.match?.home ?? true);
  const [competitionId, setCompetitionId] = useState(event.match?.competition?.id ?? competicoes[0]?.id ?? "");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /*
   * O local de um jogo fora é texto livre, como na criação.
   *
   * O catálogo são os campos da academia; oferecê-los para um jogo em Fafe
   * convidava a marcar "Campo 1" onde a equipa nem vai jogar. Pela mesma razão o
   * balneário desaparece nos jogos: fora, é o que o adversário der.
   */
  const localLivre = isMatch && !isHome;
  const valid = start < end && (!isMatch || opponent.trim().length > 0) && (!isMatch || competitionId !== "");

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || !valid) return;
    setBusy(true);
    setError(null);

    const startsAt = new Date(`${date}T${start}`);
    const endsAt = new Date(`${date}T${end}`);

    /** Só o que mexeu — ver a nota do cabeçalho. */
    const mudou: Record<string, unknown> = {};
    if (startsAt.getTime() !== event.start.getTime()) mudou.startsAt = startsAt.toISOString();
    if (endsAt.getTime() !== event.end.getTime()) mudou.endsAt = endsAt.toISOString();
    if (venue !== event.venue) mudou.venue = venue.trim();
    if (!isMatch && dressingRoom !== (event.dressingRoom ?? "")) mudou.dressingRoom = dressingRoom;
    // O título de um treino é sempre "Treino" e o de um jogo é derivado do
    // adversário — só um evento genérico tem título seu para editar.
    if (event.kind !== "training" && !isMatch && title.trim() && title !== event.title) mudou.title = title.trim();
    if (isMatch) {
      if (opponent.trim() !== event.match?.opponent) mudou.opponent = opponent.trim();
      if (isHome !== event.match?.home) mudou.isHome = isHome;
      if (competitionId && competitionId !== event.match?.competition?.id) mudou.competitionId = competitionId;
    }

    // Nada mudou: fechar em silêncio é a resposta honesta — um pedido ao
    // servidor para não alterar nada só serviria para gerar um registo falso.
    if (Object.keys(mudou).length === 0) {
      onClose();
      return;
    }

    try {
      await apiPut(`/api/events/${event.id}`, mudou);
      // A gaveta guarda o **id** e relê do store — por isso fica aberta e já com
      // a informação nova, que é o que se quer depois de trocar uma hora.
      await reloadAcademy();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível guardar as alterações.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      labelledBy="editar-evento"
      title="Editar evento"
      subtitle={`${KIND_LABEL[event.kind]}${team ? ` · ${team.name}` : ""} · ${capitalize(longDate(event.start))}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className="ctl-ghost" disabled={busy}>
            Cancelar
          </button>
          <button
            type="submit"
            form="form-editar-evento"
            className="ctl-primary"
            disabled={busy || !valid}
            title={!valid ? "O fim tem de ser depois do início, e um jogo precisa de adversário e prova" : undefined}
          >
            {busy ? "A guardar…" : "Guardar"}
          </button>
        </>
      }
    >
      <form id="form-editar-evento" onSubmit={submit} className="space-y-4 p-5">
        {/* O tipo e o escalão dizem-se, não se escolhem — ver a nota do cabeçalho. */}
        <p className="rounded-[var(--radius-control)] bg-sunken/60 px-3 py-2 text-meta leading-relaxed text-ink-3">
          O tipo e o escalão não se alteram aqui: cada tipo de evento guarda coisas diferentes — presenças, convocatória,
          ficha. Para mudar um deles, cancela este e marca outro.
        </p>

        {isMatch && (
          <div className="grid grid-cols-[1fr_auto] gap-3">
            <DialogField label="Adversário">
              <input
                value={opponent}
                onChange={(e) => setOpponent(e.target.value)}
                placeholder="ex.: SC Vilarinho"
                className={dialogInputClass}
                required
              />
            </DialogField>

            <DialogField label="Onde">
              <div className="inline-flex h-9 items-center gap-px rounded-[var(--radius-control)] bg-sunken p-0.5">
                {[
                  { value: true, label: "Casa" },
                  { value: false, label: "Fora" },
                ].map((o) => (
                  <button
                    key={o.label}
                    type="button"
                    onClick={() => {
                      setIsHome(o.value);
                      // O local trocou de natureza: um campo nosso não serve fora,
                      // e o nome de um recinto de fora não é um campo nosso.
                      setVenue(o.value ? (venues[0]?.label ?? "") : "");
                    }}
                    aria-pressed={isHome === o.value}
                    className={cx(
                      "h-8 rounded-[6px] px-3 text-meta font-medium transition-colors duration-[120ms]",
                      isHome === o.value
                        ? "bg-surface text-ink shadow-[0_1px_2px_rgb(26_25_23/0.06)]"
                        : "text-ink-3 hover:text-ink-2",
                    )}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </DialogField>
          </div>
        )}

        {/* A prova é a da equipa e não o catálogo do clube — a convocatória
            herda-a daqui. Ver `NewEventDialog`. */}
        {isMatch && (
          <DialogField label="Competição">
            {competicoes.length > 0 ? (
              <SelectField
                className="w-full"
                value={competitionId}
                onChange={setCompetitionId}
                options={competicoes.map((c) => ({ value: c.id, label: c.label }))}
              />
            ) : (
              <p className="rounded-[var(--radius-control)] border border-dashed border-line bg-sunken/50 px-2.5 py-2 text-meta text-ink-3">
                Esta equipa não tem competições. Junta-as na ficha da equipa.
              </p>
            )}
          </DialogField>
        )}

        {/* Um treino chama-se "Treino" e um jogo chama-se pelo adversário — o
            título só se edita onde é mesmo escrito à mão. */}
        {event.kind !== "training" && !isMatch && (
          <DialogField label="Título">
            <input value={title} onChange={(e) => setTitle(e.target.value)} className={dialogInputClass} required />
          </DialogField>
        )}

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

        {localLivre ? (
          <DialogField label="Local" hint="opcional">
            <input
              value={venue}
              onChange={(e) => setVenue(e.target.value)}
              placeholder={opponent.trim() ? `Campo do ${opponent.trim()}` : "Recinto do adversário"}
              className={dialogInputClass}
            />
          </DialogField>
        ) : (
          <DialogField
            label="Local"
            hint={
              <Link to="/definicoes?catalogo=venues" className="inline-flex items-center gap-1 text-ink-3 hover:text-ink">
                <Settings className="size-3" strokeWidth={1.75} />
                gerir locais
              </Link>
            }
          >
            {venues.length > 0 || venue ? (
              <SelectField
                className="w-full"
                value={venue}
                onChange={setVenue}
                /*
                 * O local actual entra na lista mesmo que já não esteja no
                 * catálogo. Um campo arquivado depois de o evento ser marcado não
                 * pode fazer o selector cair, em silêncio, no primeiro da lista e
                 * mudar o sítio do treino sem ninguém ter pedido nada.
                 */
                options={[
                  ...(venue && !venues.some((v) => v.label === venue)
                    ? [{ value: venue, label: `${venue} (fora do catálogo)` }]
                    : []),
                  ...venues.map((v) => ({ value: v.label, label: v.label })),
                ]}
              />
            ) : (
              <p className="rounded-[var(--radius-control)] border border-dashed border-line bg-sunken/50 px-2.5 py-2 text-meta text-ink-3">
                Ainda não há locais no catálogo.
              </p>
            )}
          </DialogField>
        )}

        {/* O balneário não existe num jogo — só o treino e os eventos da casa o
            guardam (ver `updateEvent`). */}
        {!isMatch && dressingRooms.length > 0 && (
          <DialogField
            label="Balneário"
            hint={
              <Link to="/definicoes?catalogo=dressingRooms" className="inline-flex items-center gap-1 text-ink-3 hover:text-ink">
                <Settings className="size-3" strokeWidth={1.75} />
                gerir balneários
              </Link>
            }
          >
            <SelectField
              className="w-full"
              value={dressingRoom}
              onChange={setDressingRoom}
              options={[
                { value: "", label: "Sem balneário atribuído" },
                ...(dressingRoom && !dressingRooms.some((b) => b.label === dressingRoom)
                  ? [{ value: dressingRoom, label: `${dressingRoom} (fora do catálogo)` }]
                  : []),
                ...dressingRooms.map((b) => ({ value: b.label, label: b.label })),
              ]}
            />
          </DialogField>
        )}

        {error && (
          <p className="flex items-start gap-1.5 text-meta text-risk">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.75} />
            {error}
          </p>
        )}
      </form>
    </Dialog>
  );
}

function toInputDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function toInputTime(d: Date) {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

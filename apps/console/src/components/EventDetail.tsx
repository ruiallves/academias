import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { CategoricalColor } from "@academia/ui/tokens";
import {
  KIND_LABEL,
  resultOutcome,
  tallyNoun,
  toggleCancelled,
  updateMatch,
  type CallUp,
  type CallUpStatus,
  type CalendarEvent,
} from "@/lib/calendar";
import { apiPatch } from "@/lib/http";
import { events as storeEvents, matches as storeMatches, reloadAcademy } from "@/lib/store";
import { athleteById, coachById, listAthletes, teamById } from "@/lib/api";
import { availabilityOf, isUnavailable, useClinicalRecords } from "@/lib/clinical";
import { longDate, shortName, time } from "@/lib/format";
import { Ban, Check, MapPin, Plus, RefreshCw, Trash2, TriangleAlert, Whistle, X, type LucideIcon } from "@/lib/icons";
import { can } from "@/lib/permissions";
import type { Session } from "@/lib/permissions";
import { AvailabilityTag, cx, Monogram, Pill, SelectField } from "./primitives";

/**
 * O painel de detalhe.
 *
 * A mesma gaveta serve os quatro tipos de evento — o que muda é o que aparece
 * abaixo dos factos básicos. Um jogo é o único que ganha uma segunda vida depois de
 * acontecer: antes, mostra a convocatória; depois de haver resultado, mostra a
 * estatística. Nunca as duas ao mesmo tempo — misturá-las obrigaria a explicar
 * porque é que um jogo "concluído" ainda tem uma lista de confirmações por fechar.
 */
export function EventDetail({
  event,
  session,
  color,
  onClose,
}: {
  event: CalendarEvent;
  session: Session;
  color?: CategoricalColor;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const coach = event.coachId ? coachById(event.coachId) : undefined;
  // O nome vem com o evento: a lista de staff chega vazia a um treinador, e
  // procurar lá dizia "Sem treinador atribuído" nos treinos dele próprio.
  const coachName = event.coachName ?? coach?.name;
  const team = event.teamId ? teamById(event.teamId) : undefined;
  const editable = can(session, "calendar:write") || can(session, "attendance:write");
  const past = event.end < new Date();

  /*
   * O que está na base e o que ainda é local.
   *
   * Um evento genérico vive em `store.events`, um jogo a sério em `store.matches`
   * — tabelas diferentes, mas o mesmo `PATCH /api/events/:id` alcança as duas. O
   * que sobra (jogos de demonstração semeados no browser) continua a cancelar-se
   * localmente. Sem contar os jogos aqui, cancelar um jogo real caía no caminho
   * local e não fazia nada de visível.
   */
  const isApiEvent =
    storeEvents.some((e) => e.id === event.id) || storeMatches.some((m) => m.id === event.id);
  const [cancelling, setCancelling] = useState(false);

  async function toggleCancel() {
    if (cancelling) return;
    if (!isApiEvent) {
      // Jogo semeado (ou treino recorrente): comportamento local, como antes.
      toggleCancelled(event.id);
      return;
    }
    setCancelling(true);
    try {
      await apiPatch(`/api/events/${event.id}`, { cancelled: !event.cancelled });
      await reloadAcademy();
    } finally {
      setCancelling(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-ink/20" onClick={onClose} aria-hidden />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="detalhe-evento"
        className="relative flex h-full w-full max-w-[440px] flex-col border-l border-line bg-surface shadow-[var(--shadow-pop)]"
      >
        <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <div className="mb-1.5 flex items-center gap-1.5">
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ background: color?.base ?? "var(--color-ink-4)" }}
                aria-hidden
              />
              <span className="text-meta font-medium text-ink-3">
                {team ? team.name : "Toda a academia"} · {KIND_LABEL[event.kind]}
              </span>
            </div>
            <h2 id="detalhe-evento" className={cx("text-page text-ink", event.cancelled && "text-ink-4 line-through")}>
              {event.title}
            </h2>
          </div>
          <button type="button" onClick={onClose} className="ctl-ghost size-8 shrink-0 justify-center px-0" aria-label="Fechar">
            <X className="size-4" strokeWidth={1.75} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto">
          {event.cancelled && (
            <div className="flex items-center gap-2 border-b border-line bg-risk-soft px-5 py-2.5 text-meta font-medium text-risk">
              <Ban className="size-3.5 shrink-0" strokeWidth={1.75} />
              Este evento foi cancelado
            </div>
          )}

          {/* Factos básicos — sempre presentes, sejam quais forem o tipo e o estado. */}
          <dl className="space-y-2.5 border-b border-line px-5 py-4">
            <Fact label={capitalize(longDate(event.start))} sub={`${time(event.start)} – ${time(event.end)}`} />
            <Fact icon={MapPin} label={event.venue} sub={event.dressingRoom ?? undefined} />
            <Fact
              icon={Whistle}
              label={coachName ?? "Sem treinador atribuído"}
              tone={coach ? undefined : "risk"}
            />
          </dl>

          {event.kind === "match" && event.match && event.teamId && (
            <MatchBody
              event={event}
              teamId={event.teamId}
              match={event.match}
              session={session}
              editable={editable && !event.cancelled}
              past={past}
            />
          )}

          {event.kind === "training" && (
            <div className="px-5 py-4">
              <Link
                to={session.role === "COACH" || session.role === "STAFF" ? "/treinos" : "/presencas"}
                className="ctl-outline w-full justify-center"
              >
                Ver presenças deste treino
              </Link>
            </div>
          )}
        </div>

        {can(session, "calendar:write") && (
          <footer className="border-t border-line px-5 py-3">
            <button
              type="button"
              onClick={toggleCancel}
              disabled={cancelling}
              className={cx("ctl-ghost w-full justify-center", event.cancelled ? "text-ok" : "text-risk")}
            >
              {cancelling ? "A guardar…" : event.cancelled ? "Reativar evento" : "Cancelar evento"}
            </button>
          </footer>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function Fact({
  icon: Icon,
  label,
  sub,
  tone,
}: {
  icon?: LucideIcon;
  label: string;
  sub?: string;
  tone?: "risk";
}) {
  return (
    <div className="flex items-center gap-2.5">
      {Icon ? (
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-sunken text-ink-3">
          <Icon className="size-3.5" strokeWidth={1.75} />
        </span>
      ) : (
        <span className="size-7 shrink-0" />
      )}
      <div className="min-w-0">
        <div className={cx("truncate text-body font-medium", tone === "risk" ? "text-risk" : "text-ink")}>{label}</div>
        {sub && <div className="truncate text-meta text-ink-3">{sub}</div>}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Corpo de um jogo                                                            */
/* -------------------------------------------------------------------------- */

function MatchBody({
  event,
  teamId,
  match,
  session,
  editable,
  past,
}: {
  event: CalendarEvent;
  teamId: string;
  match: NonNullable<CalendarEvent["match"]>;
  session: Session;
  editable: boolean;
  past: boolean;
}) {
  return (
    <div className="border-b border-line px-5 py-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-body text-ink-2">
          {match.home ? "Casa" : "Fora"} · vs <strong className="font-semibold text-ink">{match.opponent}</strong>
        </span>
        {match.source?.provider === "zerozero" && (
          <span
            className="inline-flex items-center gap-1 rounded-full bg-sunken px-2 py-0.5 text-[11px] font-medium text-ink-3"
            title={`Importado de ${match.source.url}`}
          >
            <RefreshCw className="size-2.5" strokeWidth={2} />
            ZeroZero
          </span>
        )}
      </div>

      {match.result ? (
        <Statistics teamId={teamId} match={match} editable={editable} eventId={event.id} />
      ) : (
        <CallUps teamId={teamId} match={match} session={session} editable={editable} past={past} eventId={event.id} />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Convocatória                                                                */
/* -------------------------------------------------------------------------- */

function CallUps({
  teamId,
  match,
  session,
  editable,
  past,
  eventId,
}: {
  teamId: string;
  match: NonNullable<CalendarEvent["match"]>;
  session: Session;
  editable: boolean;
  past: boolean;
  eventId: string;
}) {
  const [recording, setRecording] = useState(false);

  // Redesenha quando o departamento clínico dá baixa ou alta a alguém.
  useClinicalRecords();

  const roster = listAthletes(session).filter((a) => a.teamId === teamId && a.status === "active");
  const byAthlete = new Map(match.callUps.map((c) => [c.athleteId, c.status]));
  const confirmed = match.callUps.filter((c) => c.status === "confirmed").length;
  // Um atleta de baixa não é convocável. Não é um aviso — é o botão desaparecer.
  const unavailable = roster.filter((a) => isUnavailable(a.id)).length;

  const setStatus = (athleteId: string, status: CallUpStatus) => {
    updateMatch(eventId, (m) => {
      const exists = m.callUps.some((c) => c.athleteId === athleteId);
      const callUps: CallUp[] = exists
        ? m.callUps.map((c) => (c.athleteId === athleteId ? { ...c, status } : c))
        : [...m.callUps, { athleteId, status }];
      return { ...m, callUps };
    });
  };

  const remove = (athleteId: string) => {
    updateMatch(eventId, (m) => ({ ...m, callUps: m.callUps.filter((c) => c.athleteId !== athleteId) }));
  };

  if (recording) {
    return <ResultForm teamId={teamId} match={match} eventId={eventId} onDone={() => setRecording(false)} />;
  }

  return (
    <>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-panel text-ink">Convocatória</h3>
        <span className="text-meta text-ink-3 tabular">
          {confirmed} confirmados de {match.callUps.length} convocados
        </span>
      </div>

      {unavailable > 0 && (
        <p className="mb-2 rounded-[var(--radius-control)] bg-risk-soft px-2.5 py-1.5 text-meta text-risk">
          {unavailable} {unavailable === 1 ? "atleta indisponível" : "atletas indisponíveis"} por indicação clínica —
          não podem ser convocados.
        </p>
      )}

      <ul className="space-y-1">
        {roster.map((a) => {
          const status = byAthlete.get(a.id);
          const availability = availabilityOf(a.id);
          const blocked = availability === "out";

          return (
            <li key={a.id} className="flex items-center gap-2.5 rounded-[var(--radius-control)] px-1 py-1">
              <Monogram name={a.name} size="sm" />
              <span className={cx("min-w-0 flex-1 truncate text-body", blocked ? "text-ink-4" : "text-ink-2")}>
                {shortName(a.name)}
              </span>

              {blocked ? (
                // Sem controlos: quem está de baixa não se convoca por engano.
                <AvailabilityTag availability={availability} size="sm" />
              ) : editable ? (
                status ? (
                  <span className="flex shrink-0 items-center gap-1">
                    <CallUpToggle status={status} onChange={(s) => setStatus(a.id, s)} />
                    <button
                      type="button"
                      onClick={() => remove(a.id)}
                      className="flex size-6 items-center justify-center rounded-[6px] text-ink-4 hover:bg-sunken hover:text-ink-2"
                      aria-label={`Retirar ${a.name} da convocatória`}
                    >
                      <X className="size-3" strokeWidth={1.75} />
                    </button>
                  </span>
                ) : (
                  <button type="button" onClick={() => setStatus(a.id, "called")} className="ctl-ghost h-7 shrink-0 text-meta text-ink-3">
                    <Plus className="size-3" strokeWidth={2} />
                    Convocar
                  </button>
                )
              ) : status ? (
                <StatusPill status={status} />
              ) : (
                <span className="shrink-0 text-meta text-ink-4">—</span>
              )}
            </li>
          );
        })}
      </ul>

      {past && editable && (
        <button type="button" onClick={() => setRecording(true)} className="ctl-primary mt-3 w-full">
          Registar resultado
        </button>
      )}
      {past && !editable && match.callUps.length > 0 && (
        <p className="mt-3 flex items-center gap-1.5 text-meta text-ink-3">
          <TriangleAlert className="size-3.5 shrink-0" strokeWidth={1.75} />
          O jogo já aconteceu e ainda não tem resultado registado.
        </p>
      )}
    </>
  );
}

function CallUpToggle({ status, onChange }: { status: CallUpStatus; onChange: (s: CallUpStatus) => void }) {
  const options: { value: CallUpStatus; label: string }[] = [
    { value: "called", label: "Convocado" },
    { value: "confirmed", label: "Confirmado" },
    { value: "declined", label: "Falta" },
  ];
  return (
    <span className="inline-flex items-center gap-px rounded-[7px] bg-sunken p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={status === o.value}
          title={o.label}
          className={cx(
            "flex h-6 w-6 items-center justify-center rounded-[5px] text-[10px] font-bold transition-colors duration-[120ms]",
            status === o.value
              ? o.value === "declined"
                ? "bg-risk-soft text-risk"
                : o.value === "confirmed"
                  ? "bg-ok-soft text-ok"
                  : "bg-surface text-ink shadow-[0_1px_2px_rgb(26_25_23/0.06)]"
              : "text-ink-4 hover:text-ink-2",
          )}
        >
          {o.label[0]}
        </button>
      ))}
    </span>
  );
}

function StatusPill({ status }: { status: CallUpStatus }) {
  if (status === "confirmed") return <Pill tone="ok">Confirmado</Pill>;
  if (status === "declined") return <Pill tone="risk">Falta</Pill>;
  return <Pill>Convocado</Pill>;
}

/* -------------------------------------------------------------------------- */
/* Registar resultado                                                          */
/* -------------------------------------------------------------------------- */

function ResultForm({
  teamId,
  match,
  eventId,
  onDone,
}: {
  teamId: string;
  match: NonNullable<CalendarEvent["match"]>;
  eventId: string;
  onDone: () => void;
}) {
  const [ourScore, setOurScore] = useState(0);
  const [theirScore, setTheirScore] = useState(0);
  const [scorers, setScorers] = useState<{ athleteId: string; tally: number }[]>([]);
  const [pickAthlete, setPickAthlete] = useState("");

  const eligible = match.callUps.filter((c) => c.status !== "declined");
  const noun = tallyNoun(teamId);
  const available = eligible.filter((c) => !scorers.some((s) => s.athleteId === c.athleteId));

  const addScorer = () => {
    if (!pickAthlete) return;
    setScorers((s) => [...s, { athleteId: pickAthlete, tally: 1 }]);
    setPickAthlete("");
  };

  return (
    <>
      <h3 className="mb-3 text-panel text-ink">Registar resultado</h3>

      <div className="mb-4 flex items-center justify-center gap-3 rounded-[var(--radius-control)] border border-line bg-sunken/40 p-3">
        <ScoreInput value={ourScore} onChange={setOurScore} label="Nós" />
        <span className="text-ink-4">–</span>
        <ScoreInput value={theirScore} onChange={setTheirScore} label={match.opponent} />
      </div>

      <div className="mb-2 text-meta font-medium text-ink">
        {noun[0].toUpperCase()}
        {noun.slice(1)}s
      </div>

      <ul className="mb-2 space-y-1">
        {scorers.map((s) => (
          <li key={s.athleteId} className="flex items-center gap-2 rounded-[var(--radius-control)] bg-sunken/50 px-2 py-1.5">
            <span className="min-w-0 flex-1 truncate text-body text-ink-2">{shortName(athleteById(s.athleteId)?.name ?? "—")}</span>
            <input
              type="number"
              min={1}
              value={s.tally}
              onChange={(e) =>
                setScorers((xs) => xs.map((x) => (x.athleteId === s.athleteId ? { ...x, tally: Number(e.target.value) || 1 } : x)))
              }
              className="h-6 w-12 rounded-[5px] border border-line bg-surface px-1.5 text-center text-meta tabular focus:border-line-strong focus:outline-none"
            />
            <button
              type="button"
              onClick={() => setScorers((xs) => xs.filter((x) => x.athleteId !== s.athleteId))}
              className="flex size-6 items-center justify-center rounded-[5px] text-ink-4 hover:bg-sunken hover:text-risk"
              aria-label="Remover"
            >
              <Trash2 className="size-3" strokeWidth={1.75} />
            </button>
          </li>
        ))}
      </ul>

      {available.length > 0 && (
        <div className="mb-4 flex items-center gap-1.5">
          <SelectField
            size="sm"
            className="flex-1"
            aria-label="Adicionar marcador"
            value={pickAthlete}
            onChange={setPickAthlete}
            options={[
              { value: "", label: "Adicionar atleta…" },
              ...available.map((c) => ({ value: c.athleteId, label: athleteById(c.athleteId)?.name ?? "—" })),
            ]}
          />
          <button type="button" onClick={addScorer} disabled={!pickAthlete} className="ctl-outline h-8">
            <Plus className="size-3.5" strokeWidth={2} />
          </button>
        </div>
      )}

      <div className="flex items-center gap-2">
        <button type="button" onClick={onDone} className="ctl-ghost flex-1 justify-center">
          Cancelar
        </button>
        <button
          type="button"
          onClick={() => {
            updateMatch(eventId, (m) => ({ ...m, result: { ourScore, theirScore, scorers } }));
            onDone();
          }}
          className="ctl-primary flex-1 justify-center"
        >
          <Check className="size-3.5" strokeWidth={2} />
          Guardar
        </button>
      </div>
    </>
  );
}

function ScoreInput({ value, onChange, label }: { value: number; onChange: (n: number) => void; label: string }) {
  return (
    <label className="flex flex-col items-center gap-1">
      <span className="max-w-[92px] truncate text-[11px] text-ink-3">{label}</span>
      <input
        type="number"
        min={0}
        value={value}
        onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))}
        className="h-11 w-14 rounded-[var(--radius-control)] border border-line bg-surface text-center text-[22px] font-semibold text-ink tabular focus:border-line-strong focus:outline-none"
      />
    </label>
  );
}

/* -------------------------------------------------------------------------- */
/* Estatística                                                                 */
/* -------------------------------------------------------------------------- */

function Statistics({
  teamId,
  match,
  editable,
  eventId,
}: {
  teamId: string;
  match: NonNullable<CalendarEvent["match"]>;
  editable: boolean;
  eventId: string;
}) {
  const [editing, setEditing] = useState(false);
  const result = match.result!;
  const outcome = resultOutcome(match);
  const noun = tallyNoun(teamId);

  if (editing) {
    return <ResultForm teamId={teamId} match={match} eventId={eventId} onDone={() => setEditing(false)} />;
  }

  const tone = outcome === "win" ? "ok" : outcome === "loss" ? "risk" : "neutral";
  const label = outcome === "win" ? "Vitória" : outcome === "loss" ? "Derrota" : "Empate";

  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-panel text-ink">Estatística</h3>
        {editable && (
          <button type="button" onClick={() => setEditing(true)} className="ctl-ghost h-7 text-meta">
            Editar
          </button>
        )}
      </div>

      <div
        className={cx(
          "mb-4 flex items-center justify-center gap-4 rounded-[var(--radius-panel)] border p-4",
          tone === "ok" && "border-ok/25 bg-ok-soft",
          tone === "risk" && "border-risk/25 bg-risk-soft",
          tone === "neutral" && "border-line bg-sunken/50",
        )}
      >
        <div className="text-center">
          <div className="text-[36px] leading-none font-semibold tracking-[-0.02em] text-ink tabular">
            {result.ourScore} – {result.theirScore}
          </div>
          <Pill tone={tone}>{label}</Pill>
        </div>
      </div>

      {result.scorers.length > 0 && (
        <ul className="space-y-1">
          {[...result.scorers]
            .sort((a, b) => b.tally - a.tally)
            .map((s) => {
              const a = athleteById(s.athleteId);
              return (
                <li key={s.athleteId} className="flex items-center gap-2.5 px-1 py-1">
                  <Monogram name={a?.name ?? "?"} size="sm" />
                  <span className="min-w-0 flex-1 truncate text-body text-ink-2">{shortName(a?.name ?? "—")}</span>
                  <span className="shrink-0 text-meta font-semibold text-ink tabular">
                    {s.tally} {noun}
                    {s.tally > 1 ? "s" : ""}
                  </span>
                </li>
              );
            })}
        </ul>
      )}
    </>
  );
}

const capitalize = (s: string) => s[0].toUpperCase() + s.slice(1);

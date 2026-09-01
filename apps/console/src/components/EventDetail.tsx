import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { CategoricalColor } from "@academia/ui/tokens";
import {
  KIND_LABEL,
  matchPagePath,
  resultOutcome,
  tallyNoun,
  toggleCancelled,
  updateMatch,
  type CalendarEvent,
} from "@/lib/calendar";
import { apiPatch } from "@/lib/http";
import { events as storeEvents, matches as storeMatches, sessions as storeSessions, reloadAcademy } from "@/lib/store";
import { athleteById, coachById, teamById } from "@/lib/api";
import { longDate, shortName, time } from "@/lib/format";
import { Ban, Check, ClipboardCheck, MapPin, Pencil, Plus, RefreshCw, Trash2, TriangleAlert, Trophy, Whistle, X, type LucideIcon } from "@/lib/icons";
import { can } from "@/lib/permissions";
import type { Session } from "@/lib/permissions";
import { cx, Monogram, Pill, SelectField } from "./primitives";
import { EditEventDialog } from "./EditEventDialog";
import { EventFinance } from "./finance/EventFinance";

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
  /*
   * Ver o clube todo, mexer só no que é meu.
   *
   * O calendário passou a mostrar os treinos e jogos de todas as equipas — um
   * treinador precisa de saber quando o campo está ocupado. O que ele pode
   * **fazer** não mudou: registar presenças, editar, cancelar e abrir a ficha
   * continuam a ser das equipas dele.
   *
   * `mine` vem do servidor (ver `inTeamScope`), que já recusa a escrita de
   * qualquer maneira. Isto é para a interface não oferecer um botão que vai
   * levar com um 403 — e não é o que fecha a porta.
   */
  const meu = event.mine ?? true;
  const editable = meu && (can(session, "calendar:write") || can(session, "attendance:write"));
  const past = event.end < new Date();

  /*
   * O que está na base e o que ainda é local.
   *
   * Um evento genérico vive em `store.events`, um jogo em `store.matches` e um
   * **treino em `store.sessions`** — três tabelas, e o mesmo
   * `PATCH /api/events/:id` alcança as três (ver `setEventCancelled`). O que
   * sobra (jogos de demonstração semeados no browser) continua a cancelar-se
   * localmente.
   *
   * Os treinos faltavam nesta conta, e era esse o bug: `isApiEvent` dava falso
   * para todos eles, o cancelamento caía no caminho local — que só mexe numa
   * cópia em memória — e não acontecia **nada**. O servidor sabia cancelar
   * treinos desde sempre; ninguém lho chegava a pedir.
   */
  const isApiEvent =
    storeEvents.some((e) => e.id === event.id) ||
    storeMatches.some((m) => m.id === event.id) ||
    storeSessions.some((t) => t.id === event.id);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  /*
   * Editar é do mesmo lote que cancelar.
   *
   * Quem pode desmarcar um treino pode trocar-lhe a hora — e é o mesmo
   * `calendar:write` que o servidor exige nos dois caminhos. Só faz sentido no
   * que vive mesmo na base: um jogo de demonstração semeado no browser não tem
   * a quem pedir a alteração.
   */
  const mayEdit = meu && can(session, "calendar:write") && isApiEvent;

  async function toggleCancel() {
    if (cancelling) return;
    if (!isApiEvent) {
      // Jogo semeado: comportamento local, como antes.
      toggleCancelled(event.id);
      return;
    }
    setCancelling(true);
    setCancelError(null);
    try {
      await apiPatch(`/api/events/${event.id}`, { cancelled: !event.cancelled });
      // O painel fica aberto: o calendário guarda o **id** e relê do store, por
      // isso o evento redesenha-se já cancelado e o botão passa a "Reativar" —
      // que é o que se quer à mão quando o cancelamento foi engano.
      await reloadAcademy();
    } catch (e) {
      /*
       * O erro tem de aparecer.
       *
       * Havia um `try/finally` sem `catch`: uma recusa do servidor — "um treino
       * com presenças registadas não se desmarca", que é uma regra a sério —
       * morria na consola do browser e o botão voltava ao estado normal, como se
       * nada tivesse acontecido. Quem carregava ficava a achar que o produto
       * estava avariado, quando o produto lhe estava a dizer que não.
       */
      setCancelError(e instanceof Error ? e.message : "Não foi possível alterar o evento.");
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
                {team?.name ?? event.teamName ?? "Toda a academia"} · {KIND_LABEL[event.kind]}
              </span>
            </div>
            <h2 id="detalhe-evento" className={cx("text-page text-ink", event.cancelled && "text-ink-4 line-through")}>
              {event.title}
            </h2>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {/* Editar mora no cabeçalho, ao pé do que se está a editar — e longe
                do rodapé, onde "Cancelar evento" é irreversível de outra maneira. */}
            {mayEdit && (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="ctl-ghost h-8 px-2.5"
                title="Editar a informação deste evento"
              >
                <Pencil className="size-3.5" strokeWidth={1.75} />
                Editar
              </button>
            )}
            <button type="button" onClick={onClose} className="ctl-ghost size-8 justify-center px-0" aria-label="Fechar">
              <X className="size-4" strokeWidth={1.75} />
            </button>
          </div>
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
            {/* A prova de um jogo é um facto básico como a hora: é ela que sai
                impressa na convocatória, e vê-la aqui poupa abrir a página. */}
            {event.match?.competition && <Fact icon={Trophy} label={event.match.competition.label} />}
          </dl>

          {event.kind === "match" && event.match && event.teamId && (
            <MatchBody
              event={event}
              teamId={event.teamId}
              match={event.match}
              editable={editable && !event.cancelled}
              past={past}
            />
          )}

          {/*
            Os atalhos de um jogo.

            Clicar num jogo no calendário levava-o direito à página dele e a
            gaveta nunca chegava a abrir. O atalho fazia falta — a ficha e a
            convocatória são o que se vem cá fazer — mas roubava a quem só queria
            saber a hora e o campo a pré-visualização que todos os outros eventos
            tinham. Agora abre a gaveta, e o atalho está aqui.

            `matchPagePath` continua a decidir se **há** página: um jogo semeado
            no browser ou de uma equipa que não é minha não tem nenhuma, e um
            botão que não leva a lado nenhum é pior do que a ausência dele.
          */}
          {event.kind === "match" && (
            <div className="space-y-2 px-5 py-4">
              {matchPagePath(event) && (
                <Link to={matchPagePath(event) as string} className="ctl-primary w-full justify-center">
                  Abrir jogo
                </Link>
              )}
              {can(session, "attendance:read") && (
                <Link to="/convocatorias" className="ctl-outline w-full justify-center">
                  <ClipboardCheck className="size-3.5" strokeWidth={1.75} />
                  Ver convocatória
                </Link>
              )}
            </div>
          )}

          {/* As presenças são de quem tem a equipa: sem `meu`, o link levava a
              uma página onde este treino nem aparece. O plano lê-se por qualquer
              pessoa da área técnica — a metodologia do clube ganha em ver-se. */}
          {event.kind === "training" && (
            <div className="space-y-2 px-5 py-4">
              {can(session, "training:read") && (
                <Link to={`/treinos/${event.id}`} className="ctl-primary w-full justify-center">
                  Abrir plano de treino
                </Link>
              )}
              {meu && (
                <Link to="/presencas" className="ctl-outline w-full justify-center">
                  Ver presenças deste treino
                </Link>
              )}
            </div>
          )}

          {/*
            O dinheiro do evento — só para quem pode ver as Contas.

            Um jogo liga-se pelo jogo, o resto pelo evento genérico; um treino
            fica de fora porque não tem custos próprios (o campo e o material
            são do clube, não da sessão). E só o que vive na base entra: um
            jogo semeado no browser não tem a quem pendurar uma despesa.
          */}
          {can(session, "finance:read") && event.kind === "match" && storeMatches.some((m) => m.id === event.id) && (
            <EventFinance session={session} link={{ matchId: event.id }} eventLabel={event.title} />
          )}
          {can(session, "finance:read") &&
            event.kind !== "match" &&
            event.kind !== "training" &&
            storeEvents.some((e2) => e2.id === event.id) && (
              <EventFinance session={session} link={{ calendarEventId: event.id }} eventLabel={event.title} />
            )}
        </div>

        {/* Um evento de outra equipa lê-se e não se toca. Dizê-lo é melhor do que
            um painel sem botões, que se lê como uma falta de permissão. */}
        {!meu && (
          <footer className="border-t border-line px-5 py-3">
            <p className="text-meta leading-relaxed text-ink-3">
              {(team?.name ?? event.teamName) ? `Este evento é do ${team?.name ?? event.teamName}.` : "Este evento é de outra equipa."} Aparece no calendário
              para saberes o que está marcado; quem o gere é quem tem essa equipa.
            </p>
          </footer>
        )}

        {meu && can(session, "calendar:write") && (
          <footer className="border-t border-line px-5 py-3">
            <button
              type="button"
              onClick={toggleCancel}
              disabled={cancelling}
              className={cx("ctl-ghost w-full justify-center", event.cancelled ? "text-ok" : "text-risk")}
            >
              {cancelling ? "A guardar…" : event.cancelled ? "Reativar evento" : "Cancelar evento"}
            </button>
            {cancelError && (
              <p className="mt-2 flex items-start gap-1.5 text-meta text-risk">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.75} />
                {cancelError}
              </p>
            )}
          </footer>
        )}
      </div>

      {editing && <EditEventDialog event={event} onClose={() => setEditing(false)} />}
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

/**
 * O que a gaveta mostra de um jogo.
 *
 * ## Já não é aqui que se convoca
 *
 * Havia aqui o plantel inteiro, com os botões de convocar e de confirmar. Era
 * trabalho a sério dentro de uma pré-visualização: a gaveta abre para se saber a
 * que horas é e onde, e vinha com trinta linhas de lista por baixo — e o mesmo
 * plantel estava, melhor apresentado, na página do jogo e no ecrã das
 * Convocatórias, que é onde as famílias são avisadas.
 *
 * Ficam os factos e dois botões: *Abrir jogo* e *Ver convocatória*. O estado da
 * convocatória diz-se numa linha, porque é informação; montá-la é noutro sítio,
 * porque é uma tarefa.
 *
 * Depois de haver resultado, o jogo ganha a segunda vida — a estatística — e
 * essa continua aqui: é leitura, e é curta.
 */
function MatchBody({
  event,
  teamId,
  match,
  editable,
  past,
}: {
  event: CalendarEvent;
  teamId: string;
  match: NonNullable<CalendarEvent["match"]>;
  editable: boolean;
  past: boolean;
}) {
  const convocados = match.callUps.length;
  const confirmados = match.callUps.filter((c) => c.status === "confirmed").length;
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
        <>
          <p className="text-meta text-ink-3">
            {convocados === 0
              ? "Convocatória por montar."
              : `${confirmados} confirmados de ${convocados} convocados.`}
          </p>
          {/* Um jogo que já passou e não tem resultado é uma coisa por fazer, e
              vale a pena dizê-lo — mas registá-lo é na ficha do jogo. */}
          {past && (
            <p className="mt-2 flex items-center gap-1.5 text-meta text-ink-3">
              <TriangleAlert className="size-3.5 shrink-0" strokeWidth={1.75} />
              O jogo já aconteceu e ainda não tem resultado registado.
            </p>
          )}
        </>
      )}
    </div>
  );
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
                  <Monogram name={a?.name ?? "?"} photoUrl={a?.photoUrl} size="sm" />
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

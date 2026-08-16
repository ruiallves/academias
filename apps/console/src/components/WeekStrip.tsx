import { Link } from "react-router-dom";
import type { TrainingSession } from "@/data/types";
import { sessionsOnDay, teamById, today, weekOf } from "@/lib/api";
import { dayShort, longDate, time } from "@/lib/format";
import type { Session } from "@/lib/permissions";
import { cx, Panel, PanelHead } from "./primitives";

/**
 * A semana da academia.
 *
 * É o elemento que devolve o "pulso" — uma academia corre a semanas, não a
 * trimestres. Sete colunas, o dia de hoje marcado, e cada treino como uma linha
 * legível: hora, equipa, sítio.
 *
 * Deliberadamente não é um calendário. Um calendário serve para agendar; isto serve
 * para ler. Agendar acontece em /calendario.
 */
export function WeekStrip({ session, to = "/calendario" }: { session: Session; to?: string }) {
  const days = weekOf(today);
  const first = days[0];
  const last = days[6];

  return (
    <Panel>
      <PanelHead
        title="Esta semana"
        hint={`${first.getDate()}–${last.getDate()} de ${longDate(last).split(" de ")[1]}`}
      >
        <Link to={to} className="ctl-ghost">
          Calendário
        </Link>
      </PanelHead>

      <div className="grid grid-cols-2 divide-line sm:grid-cols-4 sm:divide-x lg:grid-cols-7">
        {days.map((day) => {
          const isToday = day.toDateString() === today.toDateString();
          const items = sessionsOnDay(session, day);

          return (
            <div key={day.toISOString()} className={cx("min-h-[136px] border-b border-line p-2.5 lg:border-b-0", isToday && "bg-signal-soft/35")}>
              <div className="mb-2 flex items-baseline gap-1.5 px-0.5">
                <span className={cx("text-meta font-semibold", isToday ? "text-signal-ink" : "text-ink-3")}>
                  {dayShort(day)}
                </span>
                <span className={cx("text-meta tabular", isToday ? "text-signal-ink" : "text-ink-4")}>
                  {day.getDate()}
                </span>
                {isToday && <span className="ml-auto size-1.5 rounded-full bg-signal" aria-label="hoje" />}
              </div>

              <div className="space-y-1">
                {items.length === 0 ? (
                  <span className="block px-0.5 text-[11px] text-ink-4">—</span>
                ) : (
                  items.map((s) => <SessionChip key={s.id} session={s} />)
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

function SessionChip({ session: s }: { session: TrainingSession }) {
  const team = teamById(s.teamId);
  const cancelled = s.status === "cancelled";
  // Um treino agendado sem treinador é a única coisa nesta faixa que precisa de
  // saltar à vista — por isso é a única que leva cor de aviso.
  const unassigned = s.status === "scheduled" && !s.coachId;

  return (
    <div
      className={cx(
        "rounded-[6px] border px-1.5 py-1 text-[11px] leading-tight",
        cancelled && "border-line bg-sunken/60 text-ink-4",
        unassigned && "border-risk/25 bg-risk-soft text-risk",
        !cancelled && !unassigned && "border-line bg-surface text-ink-2",
      )}
      title={`${team?.name} · ${s.venue}`}
    >
      <div className="flex items-center gap-1">
        <span className="font-mono text-[10px] tabular">{time(new Date(s.start))}</span>
        {cancelled && <span className="font-semibold">cancelado</span>}
        {unassigned && <span className="font-semibold">sem treinador</span>}
      </div>
      <div className={cx("truncate font-medium", cancelled ? "line-through" : "text-ink")}>{team?.name}</div>
    </div>
  );
}

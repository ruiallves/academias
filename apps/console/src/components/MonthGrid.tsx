import { Fragment, useState } from "react";
import type { CategoricalColor } from "@academia/ui/tokens";
import { KIND_LABEL, dayKey, groupByDay, monthGrid, type CalendarEvent } from "@/lib/calendar";
import { today } from "@/lib/api";
import { time } from "@/lib/format";
import { Plus } from "@/lib/icons";
import { cx } from "./primitives";

const WEEKDAYS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

/**
 * Vista de mês.
 *
 * Serve uma pergunta diferente da agenda: a agenda responde "o que se segue?", a
 * grelha responde "onde é que há espaço e como está distribuída a carga?". É por
 * isso que valem as duas — e por isso a grelha é a vista onde se cria um evento:
 * marcar um jogo é uma decisão que se toma a olhar para o mês.
 *
 * Cor = escalão (preenchimento). Estado = contorno e etiqueta. Nunca o mesmo canal.
 */
export function MonthGrid({
  anchor,
  events,
  colors,
  onAdd,
  onSelect,
}: {
  anchor: Date;
  events: CalendarEvent[];
  colors: Map<string, CategoricalColor>;
  onAdd: (day: Date) => void;
  onSelect: (event: CalendarEvent) => void;
}) {
  const days = monthGrid(anchor);
  const byDay = groupByDay(events);
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div>
      <div className="grid grid-cols-7 border-b border-line bg-sunken/60">
        {WEEKDAYS.map((d) => (
          <div key={d} className="px-3 py-2 text-meta font-medium text-ink-3">
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {days.map((day, i) => {
          const key = dayKey(day);
          const items = byDay.get(key) ?? [];
          const outside = day.getMonth() !== anchor.getMonth();
          const isToday = day.toDateString() === today.toDateString();
          const isWeekend = day.getDay() === 0 || day.getDay() === 6;
          const open = expanded === key;
          const visible = open ? items : items.slice(0, 3);

          return (
            <Fragment key={key}>
              <div
                className={cx(
                  "group relative min-h-[124px] border-r border-b border-line p-1.5",
                  i % 7 === 6 && "border-r-0",
                  i >= 35 && "border-b-0",
                  outside && "bg-canvas/60",
                  !outside && isWeekend && "bg-sunken/25",
                )}
              >
                <div className="mb-1 flex items-center justify-between px-1">
                  <span
                    className={cx(
                      "text-meta font-semibold tabular",
                      isToday
                        ? "flex size-5 items-center justify-center rounded-full bg-signal text-white"
                        : outside
                          ? "text-ink-4"
                          : "text-ink-2",
                    )}
                  >
                    {day.getDate()}
                  </span>

                  {/* O botão só existe ao passar o rato: 42 sinais de mais numa
                      grelha seriam ruído permanente. */}
                  <button
                    type="button"
                    onClick={() => onAdd(day)}
                    aria-label={`Agendar a ${day.getDate()}`}
                    className="flex size-5 items-center justify-center rounded-[5px] text-ink-4 opacity-0 transition-opacity duration-[120ms] group-hover:opacity-100 hover:bg-sunken hover:text-ink focus-visible:opacity-100"
                  >
                    <Plus className="size-3.5" strokeWidth={2} />
                  </button>
                </div>

                <div className="space-y-1">
                  {visible.map((e) => (
                    <EventChip key={e.id} event={e} color={e.teamId ? colors.get(e.teamId) : undefined} onClick={() => onSelect(e)} />
                  ))}

                  {items.length > 3 && (
                    <button
                      type="button"
                      onClick={() => setExpanded(open ? null : key)}
                      className="w-full px-1 text-left text-[11px] font-medium text-ink-3 hover:text-ink"
                    >
                      {open ? "mostrar menos" : `+${items.length - 3} mais`}
                    </button>
                  )}
                </div>
              </div>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

/**
 * A pastilha de evento.
 *
 * Três informações em duas linhas de 11px: hora, nome, e — só quando é preciso —
 * o estado. O ponto à esquerda leva a cor do escalão mesmo quando o fundo está
 * neutralizado por um alerta, para a leitura por cor não se perder.
 */
function EventChip({
  event,
  color,
  onClick,
}: {
  event: CalendarEvent;
  color?: CategoricalColor;
  onClick: () => void;
}) {
  const alert = event.alert === "unassigned";

  return (
    <button
      type="button"
      onClick={onClick}
      title={`${KIND_LABEL[event.kind]} · ${event.title} · ${event.venue}`}
      className={cx(
        "flex w-full items-center gap-1.5 rounded-[5px] border px-1.5 py-1 text-left text-[11px] leading-tight transition-[filter] duration-[120ms] hover:brightness-[0.97]",
        event.cancelled && "border-line bg-sunken/60 text-ink-4",
        alert && !event.cancelled && "border-risk/40 bg-risk-soft",
        !alert && !event.cancelled && "border-transparent",
      )}
      style={
        !alert && !event.cancelled && color
          ? { background: color.soft, color: color.ink }
          : !alert && !event.cancelled
            ? { background: "var(--color-sunken)", color: "var(--color-ink-2)" }
            : undefined
      }
    >
      <span
        className="size-1.5 shrink-0 rounded-full"
        style={{ background: color?.base ?? "var(--color-ink-4)" }}
        aria-hidden
      />
      <span className="shrink-0 font-mono tabular opacity-80">{time(event.start)}</span>
      <span className={cx("min-w-0 flex-1 truncate font-medium", event.cancelled && "line-through")}>
        {event.title}
      </span>
      {alert && <span className="shrink-0 font-semibold text-risk">sem treinador</span>}
    </button>
  );
}

import { CalendarOff, Clock, MapPin } from "lucide-react";
import { useChild } from "@/App";
import { appointments, today, trainings } from "@/data";
import { Card, Tag, cx, dayName, dayShort, time, whenLabel } from "@/ui";

/**
 * Agenda.
 *
 * Lista, não grelha. Num telemóvel a grelha mensal obriga a apertar quadrados de
 * 40px para descobrir o que lá está; a lista diz logo. Agrupada por dia, com a
 * data numa régua à esquerda para o olho descer depressa.
 */
export default function Agenda() {
  const { child } = useChild();
  const upcoming = trainings.filter((t) => t.childId === child.id && t.end >= today);
  const childAppointments = appointments
    .filter((a) => a.childId === child.id && a.date >= today)
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  const byDay = new Map<string, typeof upcoming>();
  for (const t of upcoming) {
    const key = t.start.toDateString();
    byDay.set(key, [...(byDay.get(key) ?? []), t]);
  }

  return (
    <div className="space-y-4 pt-2">
      <div className="px-1">
        <h1 className="text-[26px] leading-tight font-semibold tracking-[-0.02em] text-ink">Agenda</h1>
        <p className="mt-0.5 text-meta text-ink-3">{child.team}</p>
      </div>

      {byDay.size === 0 ? (
        <Card className="p-8 text-center">
          <span className="mx-auto mb-3 flex size-11 items-center justify-center rounded-full bg-sunken text-ink-3">
            <CalendarOff className="size-5" strokeWidth={1.75} />
          </span>
          <p className="text-body font-semibold text-ink">Nada agendado</p>
          <p className="mt-1 text-meta text-ink-3">Recebes uma notificação assim que houver treinos marcados.</p>
        </Card>
      ) : (
        <ul className="space-y-3">
          {[...byDay.entries()].map(([key, items]) => {
            const day = new Date(key);
            const isToday = day.toDateString() === today.toDateString();

            return (
              <li key={key} className="flex gap-3">
                <div className="w-12 shrink-0 pt-1 text-center">
                  <div className={cx("text-[11px] font-semibold uppercase", isToday ? "text-signal" : "text-ink-3")}>
                    {dayShort(day)}
                  </div>
                  <div className={cx("text-[22px] leading-tight font-semibold tabular", isToday ? "text-signal-ink" : "text-ink")}>
                    {day.getDate()}
                  </div>
                </div>

                <div className="min-w-0 flex-1 space-y-2">
                  {items.map((t) => (
                    <Card key={t.id} className={cx("p-3.5", t.note?.kind === "cancelled" && "opacity-60")}>
                      <div className="mb-1.5 flex flex-wrap items-center gap-2">
                        <span className="text-body font-semibold text-ink">{child.team}</span>
                        {t.note?.kind === "changed" && <Tag tone="warn">Alterado</Tag>}
                        {t.note?.kind === "cancelled" && <Tag tone="risk">Cancelado</Tag>}
                        <span className="ml-auto text-meta text-ink-3">{whenLabel(t.start, today)}</span>
                      </div>

                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-meta text-ink-2">
                        <span className="inline-flex items-center gap-1.5">
                          <Clock className="size-3.5 text-ink-4" strokeWidth={1.75} />
                          <span className="font-mono tabular">
                            {time(t.start)}–{time(t.end)}
                          </span>
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                          <MapPin className="size-3.5 text-ink-4" strokeWidth={1.75} />
                          {t.venue}
                        </span>
                      </div>

                      {t.note && <p className="mt-2 text-meta text-warn">{t.note.text}</p>}
                    </Card>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {childAppointments.length > 0 && (
        <section className="pt-2">
          <h2 className="mb-2.5 px-1 text-[15px] font-semibold text-ink">Consultas e exames</h2>
          <div className="space-y-2">
            {childAppointments.map((a) => (
              <Card key={a.id} className="flex items-start gap-3 p-3.5">
                <span className="flex size-10 shrink-0 flex-col items-center justify-center rounded-[10px] bg-signal-soft">
                  <span className="text-[9px] font-semibold text-signal-ink uppercase">
                    {a.date.toLocaleDateString("pt-PT", { month: "short" }).replace(".", "")}
                  </span>
                  <span className="text-meta font-semibold text-signal-ink tabular">{a.date.getDate()}</span>
                </span>
                <div className="min-w-0 flex-1">
                  <div className="mb-0.5 flex flex-wrap items-center gap-2">
                    <span className="text-body font-semibold text-ink">{a.title}</span>
                    <Tag tone="signal">{a.kind}</Tag>
                  </div>
                  <p className="text-meta text-ink-2">
                    <span className="font-mono tabular">{a.time}</span> · {a.location}
                  </p>
                  {a.note && <p className="mt-1 text-meta text-warn">{a.note}</p>}
                </div>
              </Card>
            ))}
          </div>
        </section>
      )}

      <p className="px-1 pt-1 text-meta text-ink-4">
        Todos os treinos de {dayName(today)} a domingo. As alterações chegam por notificação.
      </p>
    </div>
  );
}

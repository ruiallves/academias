import { CalendarOff, MapPin } from "lucide-react";
import { useChild } from "@/App";
import { appointments, today, trainings } from "@/data";
import { cx, dayName, dayShort, monthShort, time, whenLabel } from "@/ui";

/**
 * Agenda — uma linha do tempo, não uma grelha.
 *
 * Num telemóvel a grelha mensal obriga a apertar quadrados de 40px; a linha do
 * tempo diz logo. Treinos e consultas vivem na mesma coluna, por ordem, cada um com
 * a sua marca de cor à esquerda — o olho desce e percebe o que vem aí sem ler tudo.
 */

type Item = {
  id: string;
  start: Date;
  end?: Date;
  kind: "training" | "appointment";
  title: string;
  place: string;
  tag?: { text: string; tone: "warn" | "risk" | "signal" };
  note?: string;
};

export default function Agenda() {
  const { child } = useChild();

  const items: Item[] = [
    ...trainings
      .filter((t) => t.childId === child.id && t.end >= today)
      .map<Item>((t) => ({
        id: t.id,
        start: t.start,
        end: t.end,
        kind: "training",
        title: child.team,
        place: t.venue,
        tag: t.note?.kind === "changed" ? { text: "Alterado", tone: "warn" } : t.note?.kind === "cancelled" ? { text: "Cancelado", tone: "risk" } : undefined,
        note: t.note?.text,
      })),
    ...appointments
      .filter((a) => a.childId === child.id && a.date >= today)
      .map<Item>((a) => ({
        id: a.id,
        start: new Date(a.date.getFullYear(), a.date.getMonth(), a.date.getDate(), Number(a.time.split(":")[0]), Number(a.time.split(":")[1])),
        kind: "appointment",
        title: a.title,
        place: a.location,
        tag: { text: a.kind, tone: "signal" },
        note: a.note,
      })),
  ].sort((a, b) => a.start.getTime() - b.start.getTime());

  const byDay = new Map<string, Item[]>();
  for (const it of items) {
    const key = it.start.toDateString();
    byDay.set(key, [...(byDay.get(key) ?? []), it]);
  }

  return (
    <div className="pt-3">
      <header className="px-1">
        <h1 className="text-[30px] leading-tight font-semibold tracking-[-0.03em] text-ink">Agenda</h1>
        <p className="mt-0.5 text-meta text-ink-3">{child.team}</p>
      </header>

      {byDay.size === 0 ? (
        <div className="mt-6 rounded-[var(--radius-xl)] bg-surface p-10 text-center" style={{ boxShadow: "var(--shadow-soft)" }}>
          <span className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-sunken text-ink-3">
            <CalendarOff className="size-6" strokeWidth={1.75} />
          </span>
          <p className="text-body font-semibold text-ink">Nada agendado</p>
          <p className="mt-1 text-meta text-ink-3">Recebes uma notificação assim que houver treinos marcados.</p>
        </div>
      ) : (
        <div className="mt-5 space-y-7">
          {[...byDay.entries()].map(([key, dayItems], di) => {
            const day = new Date(key);
            const isToday = day.toDateString() === today.toDateString();

            return (
              <section key={key} className="rise" style={{ ["--i" as string]: di }}>
                {/* Cabeçalho do dia — a data grande, o resto discreto. */}
                <div className="mb-3 flex items-center gap-3 px-1">
                  <span className={cx("num text-[26px] font-semibold leading-none", isToday ? "text-signal-ink" : "text-ink")}>
                    {day.getDate()}
                  </span>
                  <span className="leading-tight">
                    <span className={cx("block text-[13px] font-semibold uppercase", isToday ? "text-signal" : "text-ink-2")}>
                      {isToday ? "Hoje" : dayName(day)}
                    </span>
                    <span className="block text-[12px] text-ink-4">{dayShort(day)}, {monthShort(day)}</span>
                  </span>
                </div>

                <ul className="space-y-2.5">
                  {dayItems.map((it) => (
                    <EventRow key={it.id} item={it} />
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      <p className="mt-8 px-1 pb-1 text-meta text-ink-4">As alterações chegam por notificação, no momento em que acontecem.</p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function EventRow({ item }: { item: Item }) {
  const cancelled = item.tag?.tone === "risk";
  const accent = item.kind === "training" ? "var(--color-signal)" : "var(--color-ink)";
  const tagCls = { warn: "bg-warn-soft text-warn", risk: "bg-risk-soft text-risk", signal: "bg-signal-soft text-signal-ink" };

  return (
    <li className={cx("flex gap-3", cancelled && "opacity-55")}>
      {/* Coluna da hora, com a marca de cor do tipo de evento. */}
      <div className="flex w-14 shrink-0 flex-col items-end pt-3.5">
        <span className="num text-[15px] font-semibold text-ink">{time(item.start)}</span>
        {item.end && <span className="num text-[12px] text-ink-4">{time(item.end)}</span>}
      </div>

      <div className="relative flex-1 overflow-hidden rounded-[var(--radius-lg)] bg-surface p-4 shadow-[var(--shadow-soft)]">
        <span className="absolute inset-y-0 left-0 w-1" style={{ background: accent }} aria-hidden />
        <div className="mb-1 flex flex-wrap items-center gap-2">
          {item.tag && <span className={cx("chip", tagCls[item.tag.tone])}>{item.tag.text}</span>}
          <span className="ml-auto text-[12px] font-medium text-ink-4">{whenLabel(item.start, today)}</span>
        </div>
        <p className="text-body font-semibold text-ink">{item.title}</p>
        <p className="mt-1 inline-flex items-center gap-1.5 text-meta text-ink-2">
          <MapPin className="size-3.5 shrink-0 text-ink-4" strokeWidth={1.9} />
          {item.place}
        </p>
        {item.note && <p className="mt-2 text-meta font-medium text-warn">{item.note}</p>}
      </div>
    </li>
  );
}

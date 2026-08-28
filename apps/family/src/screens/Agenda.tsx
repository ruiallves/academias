import { CalendarOff, MapPin } from "lucide-react";
import { useChild } from "@/App";
import { useStore } from "@/lib/store";
import { cx, dayName, dayShort, monthShort, time, whenLabel } from "@/ui";

/**
 * Agenda — uma linha do tempo, não uma grelha.
 *
 * Num telemóvel a grelha mensal obriga a apertar quadrados de 40px; a linha do
 * tempo diz logo. Treinos e jogos vivem na mesma coluna, por ordem, cada um com a
 * sua marca de cor à esquerda — o olho desce e percebe o que vem aí sem ler tudo.
 */

type Item = {
  id: string;
  start: Date;
  end: Date;
  kind: "training" | "match";
  title: string;
  place: string;
  /** Balneário. Só os treinos o têm, e só quando a academia o atribui. */
  room?: string;
  cancelled: boolean;
  calledUp?: boolean;
};

export default function Agenda() {
  const { child } = useChild();
  const store = useStore();
  const now = new Date();

  const items: Item[] = [
    ...store.trainings
      .filter((t) => t.childId === child.id && t.end >= now)
      .map<Item>((t) => ({
        id: t.id,
        start: t.start,
        end: t.end,
        kind: "training",
        title: child.team,
        place: t.venue,
        room: t.dressingRoom,
        cancelled: t.cancelled,
      })),
    ...store.matches
      .filter((m) => m.childId === child.id && m.end >= now)
      .map<Item>((m) => ({
        id: m.id,
        start: m.start,
        end: m.end,
        kind: "match",
        title: `${m.isHome ? "vs" : "@"} ${m.opponent}`,
        place: m.venue,
        cancelled: m.cancelled,
        calledUp: m.calledUp,
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
            const isToday = day.toDateString() === now.toDateString();

            return (
              <section key={key} className="rise" style={{ ["--i" as string]: di }}>
                {/* Cabeçalho do dia — a data grande, o resto discreto. */}
                <div className="mb-3 flex items-center gap-3 px-1">
                  <span className={cx("num text-[26px] leading-none font-semibold", isToday ? "text-signal-ink" : "text-ink")}>
                    {day.getDate()}
                  </span>
                  <span className="leading-tight">
                    <span className={cx("block text-[13px] font-semibold uppercase", isToday ? "text-signal-ink" : "text-ink-2")}>
                      {isToday ? "Hoje" : dayName(day)}
                    </span>
                    <span className="block text-[12px] text-ink-4">
                      {dayShort(day)}, {monthShort(day)}
                    </span>
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

      <p className="mt-8 px-1 pb-1 text-meta text-ink-4">
        As alterações chegam por notificação, no momento em que acontecem.
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function EventRow({ item }: { item: Item }) {
  const accent = item.kind === "match" ? "var(--color-ink)" : "var(--color-signal)";

  return (
    <li className={cx("flex gap-3", item.cancelled && "opacity-55")}>
      {/* Coluna da hora, com a marca de cor do tipo de evento. */}
      <div className="flex w-14 shrink-0 flex-col items-end pt-3.5">
        <span className="num text-[15px] font-semibold text-ink">{time(item.start)}</span>
        <span className="num text-[12px] text-ink-4">{time(item.end)}</span>
      </div>

      <div className="relative flex-1 overflow-hidden rounded-[var(--radius-lg)] bg-surface p-4 shadow-[var(--shadow-soft)]">
        <span className="absolute inset-y-0 left-0 w-1" style={{ background: accent }} aria-hidden />
        <div className="mb-1 flex flex-wrap items-center gap-2">
          {item.cancelled && <span className="chip bg-risk-soft text-risk">Cancelado</span>}
          {item.kind === "match" && !item.cancelled && (
            <span className={cx("chip", item.calledUp ? "bg-ok-soft text-ok" : "bg-sunken text-ink-3")}>
              {item.calledUp ? "Convocado" : "Jogo"}
            </span>
          )}
          <span className="ml-auto text-[12px] font-medium text-ink-4">{whenLabel(item.start, new Date())}</span>
        </div>
        <p className="text-body font-semibold text-ink">{item.title}</p>
        <p className="mt-1 inline-flex items-center gap-1.5 text-meta text-ink-2">
          <MapPin className="size-3.5 shrink-0 text-ink-4" strokeWidth={1.9} />
          {item.place}
          {/* O balneário a seguir ao local, na mesma linha e mais apagado: é o
              detalhe que só interessa depois de se saber onde é. */}
          {item.room && <span className="text-ink-4">· {item.room}</span>}
        </p>
      </div>
    </li>
  );
}

import { useNavigate, useParams } from "react-router-dom";
import { CalendarOff, ChevronLeft, Clock, DoorOpen, MapPin, Users } from "lucide-react";
import { useStore } from "@/lib/store";
import { dateShort, dayName, time } from "@/ui";

/**
 * Um evento do clube que não é treino nem jogo: um torneio, uma reunião de pais,
 * um estágio.
 *
 * Mais simples do que o ecrã de um treino ou de um jogo, porque não há nada a
 * responder: é quando, onde, e de quem. Existe para a linha da agenda abrir como
 * as outras — um cartão que não abre parece avaria.
 */
export default function EventoDoClube() {
  const { id } = useParams<{ id: string }>();
  const { clubEvents } = useStore();
  const navigate = useNavigate();
  const e = clubEvents.find((x) => x.id === id);

  if (!e) {
    return (
      <div className="mt-10 rounded-[var(--radius-xl)] bg-surface p-10 text-center shadow-[var(--shadow-soft)]">
        <span className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-sunken text-ink-3">
          <CalendarOff className="size-6" strokeWidth={1.75} />
        </span>
        <p className="text-[15px] font-semibold text-ink">Este evento já não existe</p>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-3">Pode ter sido desmarcado.</p>
        <button type="button" onClick={() => navigate("/agenda")} className="mt-4 rounded-full bg-ink px-4 py-2 text-[14px] font-semibold text-white">
          Ver a agenda
        </button>
      </div>
    );
  }

  const factos = [
    { icone: Clock, rotulo: "Quando", valor: `${dayName(e.start)}, ${dateShort(e.start)} · ${time(e.start)}–${time(e.end)}` },
    { icone: MapPin, rotulo: "Onde", valor: e.venue },
    ...(e.rooms.length ? [{ icone: DoorOpen, rotulo: "Balneário", valor: e.rooms.join(", ") }] : []),
    { icone: Users, rotulo: "Para", valor: e.teamName ?? "Toda a academia" },
  ];

  return (
    <div className="pt-2">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="-ml-2 mb-2 inline-flex items-center gap-1 rounded-full px-2 py-1.5 text-[14px] font-medium text-ink-2"
      >
        <ChevronLeft className="size-4" strokeWidth={2.2} />
        Voltar
      </button>

      <header className="px-1">
        <p className="text-[13px] font-semibold tracking-[0.04em] text-ink-3 uppercase">{e.typeLabel}</p>
        <h1 className="mt-0.5 text-[26px] leading-tight font-semibold tracking-[-0.02em] text-ink">{e.title}</h1>
        {e.cancelled && (
          <p className="mt-2 inline-flex rounded-full bg-risk-soft px-2.5 py-1 text-[12px] font-semibold text-risk">Cancelado</p>
        )}
      </header>

      <section className="mt-4 overflow-hidden rounded-[var(--radius-xl)] bg-surface shadow-[var(--shadow-soft)]">
        {factos.map(({ icone: Icone, rotulo, valor }) => (
          <div key={rotulo} className="flex items-start gap-3 border-b border-ink/5 px-4 py-3 last:border-0">
            <Icone className="mt-0.5 size-[18px] shrink-0 text-ink-4" strokeWidth={1.9} />
            <span className="min-w-0 flex-1">
              <span className="block text-[12px] text-ink-3">{rotulo}</span>
              <span className="block text-[15px] font-medium text-ink">{valor}</span>
            </span>
          </div>
        ))}
      </section>
    </div>
  );
}

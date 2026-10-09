import { CalendarOff, ChevronRight, MapPin } from "lucide-react";
import { Link } from "react-router-dom";
import { useChild } from "@/App";
import { consultaPorResponder, useStore, type CallUpState } from "@/lib/store";
import { cx, dayName, dayShort, monthShort, time, whenLabel } from "@/ui";

/**
 * Agenda — uma linha do tempo, não uma grelha.
 *
 * Num telemóvel a grelha mensal obriga a apertar quadrados de 40px; a linha do
 * tempo diz logo. Tudo o que o filho tem vive na mesma coluna, por ordem, cada um
 * com a sua marca de cor à esquerda — o olho desce e percebe o que vem aí sem ler
 * tudo.
 *
 * "Tudo" são quatro coisas: os treinos, os jogos, as **consultas** marcadas pelo
 * departamento clínico e os **eventos do clube** (torneios, reuniões, estágios).
 * As duas últimas só apareciam no Início e na área do atleta, e uma consulta às
 * 18:00 de terça não se via ao lado do treino das 18:30 do mesmo dia — que é
 * exactamente o choque que a família precisa de ver.
 */

type Item = {
  id: string;
  /** Para onde a linha abre: `/evento/treino/:id` ou `/evento/jogo/:id`. */
  href: string;
  start: Date;
  end: Date;
  kind: "training" | "match" | "appointment" | "event";
  title: string;
  place: string;
  /** Uma consulta sem hora marcada: fica no topo do dia, sem relógio. */
  semHora?: boolean;
  /** Uma consulta só tem hora de início. */
  semFim?: boolean;
  /** O rótulo por cima do título, quando o tipo não é óbvio. */
  chip?: { label: string; className: string };
  /** Balneário. Só os treinos o têm, e só quando a academia o atribui. */
  room?: string;
  cancelled: boolean;
  /** Onde é que este filho está na convocatória. Só nos jogos. */
  callUp?: CallUpState;
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
        href: `/evento/treino/${t.sessionId}`,
        start: t.start,
        end: t.end,
        kind: "training",
        title: t.team || child.team,
        place: t.venue,
        room: t.dressingRoom,
        cancelled: t.cancelled,
      })),
    ...store.matches
      .filter((m) => m.childId === child.id && m.end >= now)
      .map<Item>((m) => ({
        id: m.id,
        href: `/evento/jogo/${m.matchId}`,
        start: m.start,
        end: m.end,
        kind: "match",
        // Com duas equipas, diz de qual é o jogo.
        title: `${child.teamIds.length > 1 && m.team ? `${m.team} · ` : ""}${m.isHome ? "vs" : "@"} ${m.opponent}`,
        place: m.venue,
        cancelled: m.cancelled,
        callUp: m.callUp,
      })),
    /*
     * As consultas do boletim: a data vem sem hora (`@db.Date`) e a hora vem em
     * texto, como a médica a escreveu. Juntam-se aqui no relógio de quem lê.
     */
    ...child.appointments.map<Item>((a) => {
      const [h, mi] = (a.time ?? "").split(":").map(Number);
      const temHora = Number.isFinite(h) && Number.isFinite(mi);
      const start = new Date(a.date.getFullYear(), a.date.getMonth(), a.date.getDate(), temHora ? h : 0, temHora ? mi : 0);
      const pedeResposta = consultaPorResponder(a, store.atleta);
      return {
        id: `consulta-${a.id}`,
        href: `/consulta/${a.id}`,
        start,
        end: start,
        kind: "appointment",
        title: a.title,
        place: a.location ?? "Local por indicar",
        semHora: !temHora,
        semFim: true,
        cancelled: false,
        chip: pedeResposta
          ? { label: "Confirma a presença", className: "bg-warn-soft text-warn" }
          : a.reply
            ? a.reply.going
              ? { label: "Consulta · confirmada", className: "bg-ok-soft text-ok" }
              : { label: "Consulta · não vai", className: "bg-risk-soft text-risk" }
            : { label: "Consulta", className: "bg-sunken text-ink-3" },
      };
    }),
    /* Os eventos do clube: os da equipa do filho e os de toda a academia. */
    ...store.clubEvents
      .filter((e) => (e.teamId === null || child.teamIds.includes(e.teamId)) && e.end >= now)
      .map<Item>((e) => ({
        id: `evento-${e.id}`,
        href: `/evento/clube/${e.id}`,
        start: e.start,
        end: e.end,
        kind: "event",
        title: e.title,
        place: e.venue,
        room: e.rooms[0],
        cancelled: e.cancelled,
        chip: { label: e.teamId === null ? `${e.typeLabel} · toda a academia` : e.typeLabel, className: "bg-sunken text-ink-3" },
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
          <p className="mt-1 text-meta text-ink-3">Recebes uma notificação assim que houver alguma coisa marcada.</p>
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

/** O que o cartão diz de um jogo, num rótulo só. Ver `CallUpState`. */
const CALLUP_CHIP: Record<CallUpState, { label: string; className: string }> = {
  pending: { label: "Convocatória por lançar", className: "bg-sunken text-ink-3" },
  out: { label: "Não convocado", className: "bg-warn-soft text-warn" },
  in: { label: "Convocado", className: "bg-ok-soft text-ok" },
  cancelled: { label: "Cancelado", className: "bg-risk-soft text-risk" },
};

/**
 * Uma linha da agenda — e agora uma porta.
 *
 * Era um `div`, e tocar nele não fazia nada. Um cartão que mostra "Pavilhão
 * Municipal · 19:00" e não abre deixa o pai sem saber a que porta se entra nem
 * se o filho está mesmo convocado — e não ter para onde ir parece avaria.
 */
/* A marca de cor de cada tipo, à esquerda do cartão. */
const ACCENT: Record<Item["kind"], string> = {
  training: "var(--color-signal)",
  match: "var(--color-ink)",
  appointment: "var(--color-warn)",
  event: "var(--color-ink-4)",
};

function EventRow({ item }: { item: Item }) {
  const accent = ACCENT[item.kind];
  const estado = item.kind === "match" ? CALLUP_CHIP[item.callUp ?? "pending"] : (item.chip ?? null);

  return (
    <li className={cx("flex gap-3", item.cancelled && "opacity-55")}>
      {/* Coluna da hora, com a marca de cor do tipo de evento. */}
      <div className="flex w-14 shrink-0 flex-col items-end pt-3.5">
        <span className="num text-[15px] font-semibold text-ink">{item.semHora ? "—" : time(item.start)}</span>
        {!item.semFim && <span className="num text-[12px] text-ink-4">{time(item.end)}</span>}
      </div>

      <Link
        to={item.href}
        className="relative block flex-1 overflow-hidden rounded-[var(--radius-lg)] bg-surface p-4 text-left shadow-[var(--shadow-soft)] active:opacity-80"
      >
        <span className="absolute inset-y-0 left-0 w-1" style={{ background: accent }} aria-hidden />
        <div className="mb-1 flex flex-wrap items-center gap-2">
          {item.cancelled ? (
            <span className="chip bg-risk-soft text-risk">Cancelado</span>
          ) : (
            estado && <span className={cx("chip", estado.className)}>{estado.label}</span>
          )}
          <span className="ml-auto text-[12px] font-medium text-ink-4">{whenLabel(item.start, new Date())}</span>
        </div>
        <p className="flex items-center gap-1 text-body font-semibold text-ink">
          <span className="min-w-0 flex-1 truncate">{item.title}</span>
          <ChevronRight className="size-4 shrink-0 text-ink-4" strokeWidth={2} />
        </p>
        <p className="mt-1 inline-flex items-center gap-1.5 text-meta text-ink-2">
          <MapPin className="size-3.5 shrink-0 text-ink-4" strokeWidth={1.9} />
          {item.place}
          {/* O balneário a seguir ao local, na mesma linha e mais apagado: é o
              detalhe que só interessa depois de se saber onde é. */}
          {item.room && <span className="text-ink-4">· {item.room}</span>}
        </p>
      </Link>
    </li>
  );
}
